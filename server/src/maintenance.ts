import { createHash } from "node:crypto";
import type {
  FastifyInstance,
  FastifyRequest,
  preValidationHookHandler,
} from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError, companyScope } from "./access.js";
import { assignmentId, serializable } from "./application.js";
import { date, version, conflict, submission, sameSubmission, paging, page } from "./operational.js";
const statuses = ["open", "in_progress", "resolved"];
const categories = [
  "plumbing",
  "electrical",
  "hvac",
  "appliance",
  "structural",
  "safety",
  "other",
];
const select = {
  id: true,
  propertyId: true,
  unitId: true,
  category: true,
  targetOn: true,
  version: true,
  title: true,
  description: true,
  priority: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  property: { select: { name: true } },
  unit: { select: { label: true } },
} as const;
const updateSelect = {
  id: true,
  content: true,
  visibility: true,
  createdAt: true,
  creator: { select: { name: true } },
} as const;
function choice(value: unknown, values: string[], label: string) {
  if (typeof value !== "string" || !values.includes(value))
    throw new AccessError(400, "INVALID_INPUT", `Choose a valid ${label}.`);
  return value;
}
function body(request: FastifyRequest, keys: string[]) {
  const b = request.body;
  if (
    !b ||
    typeof b !== "object" ||
    Array.isArray(b) ||
    Object.keys(b).some((k) => !keys.includes(k))
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Submit only the requested fields.",
    );
  return b as Record<string, unknown>;
}
function text(value: unknown, max: number, label: string) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      `${label} is required (maximum ${max} characters).`,
    );
  return value.trim();
}
export function registerMaintenance(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  const mutate = (request: FastifyRequest) => {
    if (
      request.headers.origin !== origin ||
      !request.appSession ||
      request.headers["x-csrf-token"] !== request.appSession.csrfToken
    )
      throw new AccessError(403, "CSRF_INVALID", "Refresh and try again.");
  };
  const scoped = <T>(
    request: FastifyRequest,
    resident: boolean,
    run: (tx: Prisma.TransactionClient, companyId: string) => Promise<T>,
  ) => {
    const permission = resident ? "resident.self" : "maintenance.manage";
    const companyId = companyScope(
      request.principal!,
      permission,
      request.headers["x-company-id"],
    );
    return serializable(db, async (tx) => {
      // The same authorization fence orders create/replay and queued revocation.
      if (request.method === "GET")
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${request.principal!.id} FOR SHARE`;
      else
        await tx.$queryRaw`UPDATE "User" SET "updatedAt" = "updatedAt" WHERE id = ${request.principal!.id} RETURNING id`;
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR SHARE`;
      const current = await tx.user.findUnique({
        where: { id: request.principal!.id },
        include: { membership: { include: { company: true } } },
      });
      if (!current)
        throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      companyScope(current, permission, companyId);
      await tx.$queryRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
      return run(tx, companyId);
    });
  };
  const audit = (
    tx: Prisma.TransactionClient,
    request: FastifyRequest,
    companyId: string,
    targetId: string,
    action: string,
    detail?: Prisma.InputJsonValue,
  ) =>
    tx.auditEvent.create({
      data: {
        companyId,
        targetId,
        actorId: request.principal!.id,
        action,
        detail,
        requestId: request.id,
      },
    });
  const unit = async (
    tx: Prisma.TransactionClient,
    companyId: string,
    propertyId: string,
    unitId: string | null,
  ) => {
    if (
      unitId &&
      !(await tx.unit.findFirst({
        where: { id: unitId, propertyId, companyId, status: "active" },
        select: { id: true },
      }))
    )
      throw new AccessError(
        404,
        "NOT_FOUND",
        "Active unit not found in this property.",
      );
  };
  const requestRecord = async (tx: Prisma.TransactionClient, companyId: string, id: string, request: FastifyRequest, resident: boolean) => {
    const row = await tx.maintenanceRequest.findFirst({
      where: {
        id, companyId,
        ...(resident ? {
          requesterId: request.principal!.id,
          property: { assignments: { some: { companyId, userId: request.principal!.id } } },
        } : {}),
      },
      select: { ...select, requesterId: true },
    });
    if (!row) throw new AccessError(404, "NOT_FOUND", "Request not found.");
    return row;
  };
  const residentUpdatesAvailable = async (tx: Prisma.TransactionClient, companyId: string, requestId: string) => {
    // Before management intake existed, only residents could create requests.
    const creation = await tx.auditEvent.findFirst({
      where: { companyId, targetId: requestId, action: "maintenance.created" },
      select: { detail: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return !!creation && !(creation.detail && typeof creation.detail === "object" && !Array.isArray(creation.detail) && creation.detail.source === "management");
  };
  for (const resident of [true, false])
    server.post(
      resident ? "/api/resident/maintenance" : "/api/company/maintenance",
      auth,
      async (request) => {
        mutate(request);
        const b = body(request, [
          "propertyId",
          "title",
          "description",
          "priority",
          "category",
          "submissionKey",
          ...(!resident ? ["unitId", "targetOn"] : []),
        ]);
        const propertyId = assignmentId(b.propertyId),
          title = text(b.title, 160, "Title"),
          description = text(b.description, 4000, "Description"),
          priority = choice(b.priority, ["low", "normal", "high"], "priority"),
          category =
            b.category === undefined
              ? "other"
              : choice(b.category, categories, "category");
        const unitId = b.unitId == null ? null : assignmentId(b.unitId),
          targetOn =
            b.targetOn == null ? null : date(b.targetOn, "target date");
        const key = b.submissionKey;
        if (
          typeof key !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            key,
          )
        )
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "A UUID submission key is required.",
          );
        const submissionKey = key.toLowerCase();
        // Retain fingerprints of existing resident submissions for safe retry after deployment.
        const fingerprint: unknown[] = [
          propertyId,
          title,
          description,
          priority,
        ];
        if (unitId || targetOn || category !== "other")
          fingerprint.push({ unitId, category, targetOn });
        const submissionHash = createHash("sha256")
          .update(JSON.stringify(fingerprint))
          .digest("hex");
        return scoped(request, resident, async (tx, companyId) => {
          const previous = await tx.maintenanceRequest.findFirst({
            where: {
              companyId,
              requesterId: request.principal!.id,
              submissionKey,
            },
            select: { ...select, submissionHash: true },
          });
          if (resident) {
            if (
              !(await tx.residentPropertyAssignment.findFirst({
                where: {
                  companyId,
                  propertyId: previous?.propertyId || propertyId,
                  userId: request.principal!.id,
                },
              }))
            )
              throw new AccessError(
                404,
                "NOT_FOUND",
                "Assigned property not found.",
              );
          } else if (
            !(await tx.property.findFirst({
              where: { id: propertyId, companyId },
              select: { id: true },
            }))
          )
            throw new AccessError(404, "NOT_FOUND", "Property not found.");
          if (previous) {
            if (previous.submissionHash !== submissionHash)
              throw new AccessError(
                409,
                "SUBMISSION_MISMATCH",
                "This submission was already used with different details. Restore the original details to retry, or start a new request.",
              );
            const { submissionHash: _hash, ...row } = previous;
            return row;
          }
          await unit(tx, companyId, propertyId, unitId);
          const row = await tx.maintenanceRequest.create({
            data: {
              companyId,
              propertyId,
              unitId,
              category,
              targetOn,
              requesterId: request.principal!.id,
              title,
              description,
              priority,
              submissionKey,
              submissionHash,
            },
            select,
          });
          await audit(tx, request, companyId, row.id, "maintenance.created", {
            propertyId,
            unitId,
            category,
            priority,
            source: resident ? "resident" : "management",
          });
          return row;
        });
      },
    );
  for (const resident of [true, false]) {
    const base = resident
      ? "/api/resident/maintenance"
      : "/api/company/maintenance";
    server.get<{ Params: { requestId: string }; Querystring: { cursor?: string } }>(`${base}/:requestId/updates`, auth, request => {
      const id = assignmentId(request.params.requestId), cursor = paging(request.query);
      return scoped(request, resident, async (tx, companyId) => {
        await requestRecord(tx, companyId, id, request, resident);
        const where = { companyId, requestId: id, ...(resident ? { visibility: "resident" } : {}) };
        const boundary = cursor ? await tx.maintenanceUpdate.findFirst({ where: { ...where, id: cursor }, select: { id: true, createdAt: true } }) : null;
        if (cursor && !boundary) throw new AccessError(404, "NOT_FOUND", "Update page not found.");
        const rows = await tx.maintenanceUpdate.findMany({
          where: { ...where, ...(boundary ? { OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] } : {}) },
          select: { ...updateSelect, creator: resident ? false : updateSelect.creator },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
        });
        return page(rows.map(row => {
          const { creator, ...safe } = row;
          return { ...safe, author: resident ? "Property team" : creator?.name || "Recorded team member" };
        }));
      });
    });
    server.get<{
      Querystring: {
        status?: string;
        propertyId?: string;
        priority?: string;
        q?: string;
        workStatus?: string;
      };
    }>(base, auth, async (request) => {
      if (
        Object.keys(request.query).some(
          (k) => !["status", "propertyId", "priority", "q", ...(!resident ? ["workStatus"] : [])].includes(k),
        )
      )
        throw new AccessError(400, "INVALID_INPUT", "Unknown filter.");
      const status =
        request.query.status === undefined
          ? undefined
          : choice(request.query.status, ["unresolved", ...statuses], "status");
      const propertyId =
        request.query.propertyId === undefined
          ? undefined
          : assignmentId(request.query.propertyId);
      const priority =
        request.query.priority === undefined
          ? undefined
          : choice(
              request.query.priority,
              ["low", "normal", "high"],
              "priority",
            );
      const q =
        request.query.q === undefined
          ? undefined
          : text(request.query.q, 200, "Search");
      const workStatus = request.query.workStatus === undefined ? undefined : choice(request.query.workStatus, ["unassigned", "assigned", "accepted", "pending_review", "complete"], "work status");
      return scoped(request, resident, async (tx, companyId) => {
        if (
          propertyId &&
          !(await tx.property.findFirst({
            where: { id: propertyId, companyId },
          }))
        )
          throw new AccessError(404, "NOT_FOUND", "Property not found.");
        return tx.maintenanceRequest.findMany({
          where: {
            companyId,
            status:
              status === "unresolved"
                ? { in: ["open", "in_progress"] }
                : status,
            propertyId,
            priority,
            executionStatus: workStatus,
            ...(q
              ? {
                  OR: [
                    { title: { contains: q, mode: "insensitive" } },
                    { description: { contains: q, mode: "insensitive" } },
                    {
                      property: { name: { contains: q, mode: "insensitive" } },
                    },
                    { unit: { label: { contains: q, mode: "insensitive" } } },
                  ],
                }
              : {}),
            ...(resident
              ? {
                  requesterId: request.principal!.id,
                  property: {
                    assignments: {
                      some: { companyId, userId: request.principal!.id },
                    },
                  },
                }
              : {}),
          },
          select: { ...select, ...(!resident ? { executionStatus: true } : {}) },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
      });
    });
    server.get<{ Params: { requestId: string } }>(
      `${base}/:requestId`,
      auth,
      (request) => {
        const id = assignmentId(request.params.requestId);
        if (Object.keys(request.query as object).length)
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "Unknown request detail filter.",
          );
        return scoped(request, resident, async (tx, companyId) => {
          const row = await requestRecord(tx, companyId, id, request, resident);
          const events = await tx.auditEvent.findMany({
            where: {
              companyId,
              targetId: id,
              action: {
                in: resident
                  ? ["maintenance.created", "maintenance.status.changed"]
                  : [
                      "maintenance.created",
                      "maintenance.status.changed",
                      "maintenance.updated",
                    ],
              },
            },
            select: {
              id: true,
              action: true,
              createdAt: true,
              actorId: true,
              detail: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 101,
          });
          const actors = resident
            ? []
            : await tx.user.findMany({
                where: {
                  id: {
                    in: [row.requesterId, ...events.map((e) => e.actorId)],
                  },
                },
                select: { id: true, name: true },
              });
          const { requesterId, ...safe } = row;
          return {
            ...safe,
            ...(!resident
              ? {
                  recordedBy:
                    actors.find((a) => a.id === requesterId)?.name ||
                    "Recorded user",
                  residentUpdatesAvailable: await residentUpdatesAvailable(tx, companyId, id),
                }
              : {}),
            activity: events.slice(0, 100).map((e) => {
              const detail =
                e.detail &&
                typeof e.detail === "object" &&
                !Array.isArray(e.detail)
                  ? e.detail
                  : {};
              const changes =
                detail.changes &&
                typeof detail.changes === "object" &&
                !Array.isArray(detail.changes)
                  ? { ...detail.changes }
                  : undefined;
              if (changes?.unitId)
                changes.unitId = detail.unitLabels || {
                  from: "Previous recorded unit",
                  to: "Updated recorded unit",
                };
              return {
                id: e.id,
                action: e.action,
                createdAt: e.createdAt,
                ...(!resident
                  ? {
                      actorName:
                        actors.find((a) => a.id === e.actorId)?.name ||
                        "Recorded user",
                      changes,
                    }
                  : {}),
                ...(e.action === "maintenance.status.changed"
                  ? { from: detail.from, to: detail.to }
                  : {}),
              };
            }),
            historyLimited: events.length > 100,
          };
        });
      },
    );
  }
  server.post<{ Params: { requestId: string } }>("/api/company/maintenance/:requestId/updates", auth, request => {
    mutate(request);
    const id = assignmentId(request.params.requestId), b = body(request, ["content", "visibility", "submissionKey"]),
      content = text(b.content, 4000, "Update"), visibility = choice(b.visibility, ["internal", "resident"], "update audience"),
      key = submission(b.submissionKey, [id, content, visibility]);
    return scoped(request, false, async (tx, companyId) => {
      await requestRecord(tx, companyId, id, request, false);
      const previous = await tx.maintenanceUpdate.findFirst({ where: { companyId, createdById: request.principal!.id, submissionKey: key.submissionKey }, select: { ...updateSelect, submissionHash: true } });
      if (previous) {
        sameSubmission(previous.submissionHash, key.submissionHash);
        const { creator, submissionHash: _hash, ...safe } = previous;
        return { ...safe, author: creator.name || "Recorded team member" };
      }
      if (visibility === "resident" && !(await residentUpdatesAvailable(tx, companyId, id)))
        throw new AccessError(409, "NO_RESIDENT_REQUESTER", "This is a management-created request. Record an internal note instead.");
      const row = await tx.maintenanceUpdate.create({ data: { companyId, requestId: id, content, visibility, createdById: request.principal!.id, ...key }, select: updateSelect });
      await audit(tx, request, companyId, id, "maintenance.update.recorded", { updateId: row.id, visibility });
      const { creator, ...safe } = row;
      return { ...safe, author: creator.name || "Recorded team member" };
    });
  });
  server.patch<{ Params: { requestId: string } }>(
    "/api/company/maintenance/:requestId",
    auth,
    async (request) => {
      mutate(request);
      const b = body(request, [
        "status",
        "expectedVersion",
        "title",
        "description",
        "priority",
        "category",
        "targetOn",
        "unitId",
      ]);
      const id = assignmentId(request.params.requestId),
        status = choice(b.status, statuses, "status"),
        expectedVersion = version(b.expectedVersion);
      const patch = {
        ...(b.title !== undefined
          ? { title: text(b.title, 160, "Title") }
          : {}),
        ...(b.description !== undefined
          ? { description: text(b.description, 4000, "Description") }
          : {}),
        ...(b.priority !== undefined
          ? {
              priority: choice(
                b.priority,
                ["low", "normal", "high"],
                "priority",
              ),
            }
          : {}),
        ...(b.category !== undefined
          ? { category: choice(b.category, categories, "category") }
          : {}),
        ...(b.targetOn !== undefined
          ? {
              targetOn:
                b.targetOn === null ? null : date(b.targetOn, "target date"),
            }
          : {}),
        ...(b.unitId !== undefined
          ? { unitId: b.unitId === null ? null : assignmentId(b.unitId) }
          : {}),
      };
      return scoped(request, false, async (tx, companyId) => {
        const previous = await tx.maintenanceRequest.findFirst({
          where: { id, companyId },
          select: { ...select, assigneeId: true },
        });
        if (!previous)
          throw new AccessError(404, "NOT_FOUND", "Request not found.");
        if (previous.version !== expectedVersion) throw conflict();
        if (previous.assigneeId && previous.status !== status)
          throw new AccessError(409, "WORK_REVIEW_REQUIRED", "Use assigned work to accept, review completion or reopen this request.");
        if (patch.unitId !== undefined && patch.unitId !== previous.unitId)
          await unit(tx, companyId, previous.propertyId, patch.unitId);
        const changes: Record<
          string,
          { from: string | null; to: string | null }
        > = {};
        const value = (v: unknown) =>
          v instanceof Date
            ? v.toISOString().slice(0, 10)
            : v == null
              ? null
              : String(v);
        for (const [key, next] of Object.entries({ ...patch, status })) {
          const old = value(previous[key as keyof typeof previous]),
            changed = value(next);
          if (old !== changed) changes[key] = { from: old, to: changed };
        }
        if (!Object.keys(changes).length) return previous;
        const nextUnit =
          changes.unitId && patch.unitId
            ? await tx.unit.findFirst({
                where: {
                  id: patch.unitId,
                  propertyId: previous.propertyId,
                  companyId,
                },
                select: { label: true },
              })
            : null;
        const unitLabels = changes.unitId
          ? {
              from: previous.unit?.label || "Property-wide",
              to: nextUnit?.label || "Property-wide",
            }
          : undefined;
        const result = await tx.maintenanceRequest.updateMany({
          where: { id, companyId, version: expectedVersion },
          data: { ...patch, status, version: { increment: 1 } },
        });
        if (result.count !== 1) throw conflict();
        await audit(
          tx,
          request,
          companyId,
          id,
          previous.status !== status
            ? "maintenance.status.changed"
            : "maintenance.updated",
          {
            from: previous.status,
            to: status,
            changes,
            ...(unitLabels ? { unitLabels } : {}),
          },
        );
        return tx.maintenanceRequest.findFirstOrThrow({
          where: { id, companyId },
          select,
        });
      });
    },
  );
}
