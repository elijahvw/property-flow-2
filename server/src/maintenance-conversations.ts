import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { assignmentId } from "./application.js";
import { AccessError } from "./access.js";
import { audit, boundedText, input, mutation, sameSubmission, scoped, submission } from "./operational.js";
import { publishNotification, type NotificationPublisher } from "./notification-events.js";

// Management writes and both timelines keep using MaintenanceUpdate. This adds
// the requester reply operation without widening finance/staff/property access.
export function registerMaintenanceConversations(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
  publish: NotificationPublisher = publishNotification,
) {
  server.post<{ Params: { requestId: string } }>(
    "/api/resident/maintenance/:requestId/updates",
    { preValidation: authenticate },
    request => {
      mutation(request, origin);
      const id = assignmentId(request.params.requestId);
      const b = input(request, ["content", "submissionKey"]);
      const content = boundedText(b.content, 4000, "Reply");
      const key = submission(b.submissionKey, [id, content, "resident", "resident"]);
      return scoped(db, request, "resident.self", async (tx, companyId) => {
        const record = await tx.maintenanceRequest.findFirst({
          where: {
            id, companyId, requesterId: request.principal!.id,
            property: { assignments: { some: { companyId, userId: request.principal!.id } } },
          },
          select: { id: true },
        });
        if (!record) throw new AccessError(404, "NOT_FOUND", "Request not found.");
        const creation = await tx.auditEvent.findFirst({
          where: { companyId, targetId: id, action: "maintenance.created" },
          select: { detail: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        if (!creation || (creation.detail as { source?: string } | null)?.source === "management")
          throw new AccessError(404, "NOT_FOUND", "Resident conversation not found.");
        const previous = await tx.maintenanceUpdate.findFirst({
          where: { companyId, createdById: request.principal!.id, submissionKey: key.submissionKey },
          select: { id: true, content: true, visibility: true, createdAt: true, submissionHash: true },
        });
        if (previous) {
          sameSubmission(previous.submissionHash, key.submissionHash);
          const { submissionHash: _hash, ...safe } = previous;
          return { ...safe, author: "You" };
        }
        const row = await tx.maintenanceUpdate.create({
          data: { companyId, requestId: id, content, visibility: "resident", authorType: "resident", createdById: request.principal!.id, ...key },
          select: { id: true, content: true, visibility: true, createdAt: true },
        });
        await audit(tx, request, companyId, id, "maintenance.reply.recorded", { updateId: row.id, visibility: "resident" });
        await publish(tx, { companyId, actorId: request.principal!.id, kind: "maintenance.reply", requestId: id, eventKey: row.id });
        return { ...row, author: "You" };
      });
    },
  );
}
