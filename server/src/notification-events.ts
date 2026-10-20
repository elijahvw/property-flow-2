import { randomUUID } from "node:crypto";
import { AccessError } from "./access.js";
import type { Tx } from "./operational.js";

type RequestKind =
  | "maintenance.created"
  | "maintenance.status"
  | "maintenance.update"
  | "work.assigned"
  | "work.reopened"
  | "work.approved"
  | "work.review";
type LeaseKind =
  | "inspection.review"
  | "agreement.review"
  | "agreement.approved"
  | "agreement.changes";
export type NotificationInput = {
  companyId: string;
  actorId: string;
  eventKey: string;
} & (
  | { kind: RequestKind; requestId: string }
  | { kind: LeaseKind; sourceId: string }
);
export type NotificationPublisher = (
  tx: Tx,
  input: NotificationInput,
) => Promise<void>;

// Called only by successful source transactions. Templates and recipients are
// determined here; callers cannot supply arbitrary inbox content or recipients.
export const publishNotification: NotificationPublisher = async (tx, input) => {
  const { companyId, actorId, kind } = input;
  const eventKey = `${kind}:${input.eventKey}`;
  let propertyId: string,
    requestId: string | null = null,
    leaseId: string | null = null,
    inspectionId: string | null = null,
    agreementId: string | null = null,
    recipientId: string | null = null,
    audience = "management";
  const sourceType = kind.startsWith("work.")
    ? "work"
    : kind.startsWith("maintenance.")
      ? "maintenance"
      : kind.startsWith("inspection.")
        ? "inspections"
        : "agreements";
  if ("requestId" in input) {
    const row = await tx.maintenanceRequest.findFirstOrThrow({
      where: { companyId, id: input.requestId },
      select: {
        id: true,
        propertyId: true,
        requesterId: true,
        assigneeId: true,
      },
    });
    requestId = row.id;
    propertyId = row.propertyId;
    if (["maintenance.status", "maintenance.update"].includes(kind)) {
      audience = "requester";
      recipientId = row.requesterId;
      // Management-created work has no resident requester delivery contract.
      const creation = await tx.auditEvent.findFirst({
        where: { companyId, targetId: row.id, action: "maintenance.created" },
        select: { detail: true },
      });
      if (
        !creation ||
        (creation.detail as { source?: string } | null)?.source !== "resident"
      )
        return;
    } else if (
      ["work.assigned", "work.reopened", "work.approved"].includes(kind)
    ) {
      audience = "staff";
      recipientId = row.assigneeId;
    }
  } else if (kind === "inspection.review") {
    const row = await tx.leaseInspection.findFirstOrThrow({
      where: { id: input.sourceId, companyId },
      select: {
        id: true,
        leaseId: true,
        lease: { select: { propertyId: true } },
      },
    });
    inspectionId = row.id;
    leaseId = row.leaseId;
    propertyId = row.lease.propertyId;
  } else {
    const row = await tx.leaseAgreement.findFirstOrThrow({
      where: { id: input.sourceId, companyId },
      select: {
        id: true,
        leaseId: true,
        lease: { select: { propertyId: true } },
        revisions: {
          where: { companyId, version: 1 },
          select: { actorId: true },
        },
      },
    });
    agreementId = row.id;
    leaseId = row.leaseId;
    propertyId = row.lease.propertyId;
    if (kind !== "agreement.review") {
      recipientId = row.revisions[0]?.actorId ?? null;
      if (!recipientId) return;
    }
  }
  if (audience !== "management" && !recipientId) return;
  const candidates = await tx.companyMembership.findMany({
    where: {
      companyId,
      status: "active",
      userId: { not: actorId, ...(recipientId ? { equals: recipientId } : {}) },
      user: { status: "active", emailVerified: true },
      ...(audience === "management"
        ? { role: { in: ["owner", "manager"] } }
        : audience === "staff"
          ? {
              role: "staff",
              maintenanceExecution: true,
              OR: [
                { staffPropertyScope: "all" },
                {
                  staffPropertyScope: "selected",
                  staffProperties: { some: { companyId, propertyId } },
                },
              ],
            }
          : {
              role: "resident",
              assignments: { some: { companyId, propertyId } },
            }),
    },
    select: { userId: true },
    take: 1001,
  });
  if (candidates.length > 1000)
    throw new AccessError(
      409,
      "NOTIFICATION_RECIPIENT_LIMIT",
      "The company notification recipient limit needs review.",
    );
  // An existing event is never backfilled or marked unread by a business retry.
  const id = randomUUID();
  const added = await tx.notificationEvent.createMany({
    data: [
      {
        id,
        companyId,
        actorId,
        eventKey,
        kind,
        sourceType,
        propertyId,
        requestId,
        leaseId,
        inspectionId,
        agreementId,
      },
    ],
    skipDuplicates: true,
  });
  if (!added.count || !candidates.length) return;
  await tx.inboxNotification.createMany({
    data: candidates.map((c) => ({
      id: randomUUID(),
      companyId,
      eventId: id,
      userId: c.userId,
      audience,
    })),
    skipDuplicates: true,
  });
};
