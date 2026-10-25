import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import {
  defaultNotificationSettings, lockPreferenceSave, notificationSettings,
  preferenceFields, type NotificationSettings,
} from "./notification-preferences.js";
import {
  audit,
  choice,
  conflict,
  input,
  mutation,
  page,
  paging,
  sameSubmission,
  scoped,
  submission,
  version,
  type Tx,
} from "./operational.js";

const templates: Record<string, string> = {
  "maintenance.created": "New maintenance request",
  "maintenance.status": "Maintenance status changed",
  "maintenance.update": "New maintenance update",
  "maintenance.reply": "Resident replied to maintenance request",
  "work.assigned": "Work assigned to you",
  "work.reopened": "Your assigned work was reopened",
  "work.approved": "Your completed work was approved",
  "work.review": "Completed work needs review",
  "inspection.review": "Inspection needs review",
  "agreement.review": "Agreement preparation needs review",
  "agreement.approved": "Agreement preparation approved",
  "agreement.changes": "Agreement preparation needs changes",
};
const select = {
  id: true,
  version: true,
  audience: true,
  readAt: true,
  createdAt: true,
  event: {
    select: {
      kind: true,
      sourceType: true,
      requestId: true,
      leaseId: true,
      inspectionId: true,
      agreementId: true,
      property: { select: { name: true } },
      request: { select: { title: true, unit: { select: { label: true } } } },
      lease: { select: { unit: { select: { label: true } } } },
      agreement: { select: { title: true } },
    },
  },
} as const;
type Row = Prisma.InboxNotificationGetPayload<{ select: typeof select }>;
function filters(query: Record<string, unknown>) {
  if (Object.keys(query).some((k) => !["status", "type", "page"].includes(k)))
    throw new AccessError(400, "INVALID_INPUT", "Unknown notification filter.");
  const status = choice(
      query.status ?? "all",
      ["all", "unread", "read"],
      "read status",
    ),
    type = choice(
      query.type ?? "all",
      ["all", "maintenance", "work", "inspections", "agreements"],
      "notification type",
    );
  const value = query.page ?? "1";
  if (typeof value !== "string" || !/^[1-9][0-9]{0,4}$/.test(value))
    throw new AccessError(400, "INVALID_INPUT", "Choose a valid inbox page.");
  return { status, type, page: Number(value) };
}
async function visible(
  tx: Tx,
  companyId: string,
  userId: string,
): Promise<Prisma.InboxNotificationWhereInput> {
  await tx.$queryRaw`SELECT set_config('app.notification_user_id', ${userId}, true)`;
  const member = await tx.companyMembership.findFirstOrThrow({
    where: { companyId, userId, status: "active" },
  });
  let source: Prisma.InboxNotificationWhereInput = { id: { in: [] } };
  if (["owner", "manager"].includes(member.role))
    source = { audience: "management", event: { companyId } };
  else if (member.role === "staff" && member.maintenanceExecution)
    source = {
      audience: "staff",
      event: {
        companyId,
        sourceType: "work",
        request: {
          companyId,
          assigneeId: userId,
          ...(member.staffPropertyScope === "selected"
            ? { property: { staffAccess: { some: { companyId, userId } } } }
            : member.staffPropertyScope === "all"
              ? {}
              : { id: { in: [] } }),
        },
      },
    };
  else if (member.role === "resident")
    source = {
      audience: "requester",
      event: {
        companyId,
        sourceType: "maintenance",
        request: {
          companyId,
          requesterId: userId,
          property: { assignments: { some: { companyId, userId } } },
        },
      },
    };
  return { companyId, userId, ...source };
}
function dto(row: Row) {
  return {
    id: row.id,
    version: row.version,
    readAt: row.readAt,
    createdAt: row.createdAt,
    type: row.event.sourceType,
    title: templates[row.event.kind],
    sourceTitle:
      row.event.request?.title ??
      row.event.agreement?.title ??
      "Lease inspection",
    property: row.event.property.name,
    unit: row.event.request?.unit?.label ?? row.event.lease?.unit.label ?? null,
  };
}
function sourceHref(row: Row, context: ReturnType<typeof filters>) {
  const e = row.event,
    id = encodeURIComponent;
  const path =
    e.sourceType === "maintenance"
      ? `${row.audience === "requester" ? "/resident" : "/company"}/maintenance/${id(e.requestId!)}`
      : e.sourceType === "work"
        ? row.audience === "staff"
          ? `/company/work-orders/${id(e.requestId!)}`
          : `/company/maintenance/${id(e.requestId!)}`
        : `/company/leases/${id(e.leaseId!)}`;
  const query = new URLSearchParams({
    noticeReturn: "inbox",
    noticeStatus: context.status,
    noticeType: context.type,
    noticePage: String(context.page),
  });
  if (e.inspectionId) {
    query.set("section", "inspections");
    query.set("inspectionId", e.inspectionId);
  }
  if (e.agreementId) {
    query.set("section", "agreements");
    query.set("agreementId", e.agreementId);
  }
  return `${path}?${query}`;
}
export function registerNotifications(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate },
    base = "/api/account/notifications";
  const ownPreferences = async (tx: Tx, companyId: string, userId: string) => {
    await tx.$queryRaw`SELECT set_config('app.notification_user_id', ${userId}, true)`;
    const row = await tx.notificationPreference.findUnique({ where: { companyId_userId: { companyId, userId } } });
    return { companyId, settings: row ? notificationSettings(row) : { ...defaultNotificationSettings }, version: row?.version ?? 0 };
  };
  server.get<{ Querystring: Record<string, unknown> }>(base + "/preferences", auth, request => {
    if (Object.keys(request.query).length)
      throw new AccessError(400, "INVALID_INPUT", "Unknown preference filter.");
    return scoped(db, request, "notification.read", (tx, companyId) => ownPreferences(tx, companyId, request.principal!.id));
  });
  server.get<{ Querystring: { cursor?: string } }>(base + "/preferences/history", auth, request => {
    const cursor = paging(request.query);
    return scoped(db, request, "notification.read", async (tx, companyId) => {
      const userId = request.principal!.id;
      await tx.$queryRaw`SELECT set_config('app.notification_user_id', ${userId}, true)`;
      const where = { companyId, userId };
      const boundary = cursor ? await tx.notificationPreferenceAction.findFirst({ where: { ...where, id: cursor }, select: { id: true, createdAt: true } }) : null;
      if (cursor && !boundary) throw new AccessError(404, "NOT_FOUND", "Preference history is unavailable.");
      const rows = await tx.notificationPreferenceAction.findMany({
        where: { ...where, ...(boundary ? { OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
      });
      return { companyId, ...page(rows.map(row => ({ id: row.id, createdAt: row.createdAt, appliedVersion: row.appliedVersion, settings: notificationSettings(row), changed: row.changed }))) };
    });
  });
  server.post(base + "/preferences", auth, request => {
    mutation(request, origin);
    const b = input(request, [...preferenceFields, "expectedVersion", "expectedCompanyId", "submissionKey"]);
    if (preferenceFields.some(field => typeof b[field] !== "boolean"))
      throw new AccessError(400, "INVALID_INPUT", "Choose whether to receive notices for each of the four areas.");
    if (!Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 0)
      throw new AccessError(400, "INVALID_INPUT", "The opening preference version is required.");
    const expectedVersion = Number(b.expectedVersion), expectedCompanyId = assignmentId(b.expectedCompanyId), settings = notificationSettings(b as NotificationSettings);
    const key = submission(b.submissionKey, [expectedCompanyId, settings, expectedVersion]);
    return scoped(db, request, "notification.read", async (tx, companyId) => {
      if (companyId !== expectedCompanyId)
        throw new AccessError(409, "COMPANY_CONTEXT_CHANGED", "Your company workspace changed. Reload the workspace before editing notification preferences.");
      const userId = request.principal!.id;
      await tx.$queryRaw`SELECT set_config('app.notification_user_id', ${userId}, true)`;
      const previous = await tx.notificationPreferenceAction.findFirst({ where: { companyId, userId, submissionKey: key.submissionKey } });
      if (previous) {
        sameSubmission(previous.submissionHash, key.submissionHash);
        return { ...await ownPreferences(tx, companyId, userId), receipt: { appliedVersion: previous.appliedVersion, appliedSettings: notificationSettings(previous), changed: previous.changed, replayed: true } };
      }
      await lockPreferenceSave(tx, companyId);
      const current = await ownPreferences(tx, companyId, userId);
      if (current.version !== expectedVersion) throw conflict();
      const changed = preferenceFields.some(field => current.settings[field] !== settings[field]);
      let appliedVersion = current.version;
      if (current.version === 0) {
        await tx.notificationPreference.create({ data: { companyId, userId, ...settings } });
        appliedVersion = 1;
      } else if (changed) {
        const updated = await tx.notificationPreference.updateMany({ where: { companyId, userId, version: expectedVersion }, data: { ...settings, version: { increment: 1 } } });
        if (updated.count !== 1) throw conflict();
        appliedVersion += 1;
      }
      const action = await tx.notificationPreferenceAction.create({ data: { companyId, userId, ...key, ...settings, appliedVersion, changed } });
      await audit(tx, request, companyId, action.id, "notification.preferences.saved", { changed, version: appliedVersion });
      return { companyId, settings, version: appliedVersion, receipt: { appliedVersion, appliedSettings: settings, changed, replayed: false } };
    });
  });
  server.get(base + "/summary", auth, (request) =>
    scoped(db, request, "notification.read", async (tx, companyId) => {
      const where = await visible(tx, companyId, request.principal!.id);
      return {
        unread: await tx.inboxNotification.count({
          where: { AND: [where, { readAt: null }] },
        }),
      };
    }),
  );
  server.get<{ Querystring: Record<string, unknown> }>(
    base,
    auth,
    (request) => {
      const f = filters(request.query);
      return scoped(db, request, "notification.read", async (tx, companyId) => {
        const accessible = await visible(tx, companyId, request.principal!.id),
          where: Prisma.InboxNotificationWhereInput = {
            AND: [
              accessible,
              ...(f.status === "all"
                ? []
                : [{ readAt: f.status === "unread" ? null : { not: null } }]),
              ...(f.type === "all" ? [] : [{ event: { sourceType: f.type } }]),
            ],
          };
        const [total, unread, rows] = await Promise.all([
          tx.inboxNotification.count({ where }),
          tx.inboxNotification.count({
            where: { AND: [accessible, { readAt: null }] },
          }),
          tx.inboxNotification.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (f.page - 1) * 25,
            take: 25,
            select,
          }),
        ]);
        return {
          items: rows.map(dto),
          total,
          unread,
          page: f.page,
          pageSize: 25,
        };
      });
    },
  );
  server.post<{ Params: { notificationId: string } }>(
    base + "/:notificationId",
    auth,
    (request) => {
      mutation(request, origin);
      const notificationId = assignmentId(request.params.notificationId),
        b = input(request, [
          "action",
          "expectedVersion",
          "submissionKey",
          "status",
          "type",
          "page",
        ]),
        action = choice(
          b.action,
          ["read", "unread", "open"],
          "notification action",
        ),
        expectedVersion = version(b.expectedVersion),
        context = filters({ status: b.status, type: b.type, page: b.page });
      const key = submission(b.submissionKey, [
        notificationId,
        action,
        expectedVersion,
        context,
      ]);
      return scoped(db, request, "notification.read", async (tx, companyId) => {
        const userId = request.principal!.id,
          where = await visible(tx, companyId, userId);
        const row = await tx.inboxNotification.findFirst({
          where: { AND: [where, { id: notificationId }] },
          select,
        });
        if (!row)
          throw new AccessError(
            404,
            "NOT_FOUND",
            "This notification or its source is no longer available to you.",
          );
        const previous = await tx.notificationAction.findFirst({
          where: { companyId, userId, submissionKey: key.submissionKey },
        });
        if (previous) {
          sameSubmission(previous.submissionHash, key.submissionHash);
          return {
            saved: true,
            replayed: true,
            version: row.version,
            ...(action === "open" ? { href: sourceHref(row, context) } : {}),
          };
        }
        if (row.version !== expectedVersion) throw conflict();
        const changed =
          action === "unread" ? row.readAt !== null : row.readAt === null;
        if (changed) {
          const updated = await tx.inboxNotification.updateMany({
            where: {
              id: notificationId,
              companyId,
              userId,
              version: expectedVersion,
            },
            data: {
              readAt: action === "unread" ? null : new Date(),
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw conflict();
        }
        const resultVersion = row.version + (changed ? 1 : 0);
        await tx.notificationAction.create({
          data: {
            companyId,
            notificationId,
            userId,
            action,
            ...key,
            resultVersion,
            changed,
          },
        });
        await audit(
          tx,
          request,
          companyId,
          notificationId,
          `notification.${action}`,
          { changed, version: resultVersion },
        );
        return {
          saved: true,
          replayed: false,
          version: resultVersion,
          ...(action === "open" ? { href: sourceHref(row, context) } : {}),
        };
      });
    },
  );
}
