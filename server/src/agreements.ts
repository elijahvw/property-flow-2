import { documentAvailable } from "./document-status.js";
import { publishNotification, type NotificationPublisher } from "./notification-events.js";
import { createHash } from "node:crypto";
import type {
  FastifyInstance,
  FastifyRequest,
  preValidationHookHandler,
} from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId, opaqueUserId } from "./application.js";
import {
  audit,
  boundedText,
  choice,
  conflict,
  input,
  mutation,
  sameSubmission,
  scoped,
  submission,
  version,
  type Tx,
} from "./operational.js";

type Package = {
  notes: string;
  documentVersionIds: string[];
  partyIds: string[];
  companySignerId: string | null;
};
const signature = {
  state: "not_configured",
  signed: false,
  message:
    "Electronic signatures have not been activated. Agreement packages remain unsigned and no invitations are sent.",
} as const;
const invalid = (message: string) =>
  new AccessError(400, "INVALID_INPUT", message);
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const accountSelect = {
  id: true,
  name: true,
  email: true,
  status: true,
  emailVerified: true,
  membership: { select: { companyId: true, role: true, status: true } },
} as const;
const editable = [
  "title",
  "kind",
  "notes",
  "documentVersionIds",
  "partyIds",
  "companySignerId",
];
function ids(value: unknown, max: number, label: string) {
  if (!Array.isArray(value) || value.length > max)
    throw invalid(`Choose at most ${max} ${label}.`);
  const values = value.map(assignmentId);
  if (new Set(values).size !== values.length)
    throw invalid(`Choose each ${label} once.`);
  return values.sort();
}
function fields(b: Record<string, unknown>) {
  if (
    typeof b.notes !== "string" ||
    b.notes.length > 4000 ||
    b.notes.includes("\0")
  )
    throw invalid("Preparation notes must be at most 4,000 characters.");
  const pkg: Package = {
    notes: b.notes.trim(),
    documentVersionIds: ids(b.documentVersionIds, 10, "document versions"),
    partyIds: ids(b.partyIds, 20, "leaseholder signers"),
    companySignerId:
      b.companySignerId == null ? null : opaqueUserId(b.companySignerId),
  };
  return {
    title: boundedText(b.title, 160, "Agreement title"),
    kind: choice(
      b.kind,
      ["lease", "renewal", "addendum", "other"],
      "agreement type",
    ),
    package: pkg,
  };
}
async function context(tx: Tx, companyId: string, leaseId: string) {
  const lease = await tx.lease.findFirst({
    where: { id: leaseId, companyId },
    select: {
      id: true,
      version: true,
      status: true,
      propertyId: true,
      unitId: true,
      startsOn: true,
      endsOn: true,
      rentCents: true,
      currency: true,
      rentDueDay: true,
      graceDays: true,
      paymentInstructions: true,
      residentId: true,
      residentContactId: true,
      property: { select: { name: true } },
      unit: { select: { label: true } },
      resident: { select: accountSelect },
      residentContact: {
        select: {
          id: true,
          name: true,
          status: true,
          userId: true,
          user: { select: accountSelect },
        },
      },
    },
  });
  if (!lease) throw new AccessError(404, "NOT_FOUND", "Lease not found.");
  const participants = await tx.leaseParticipant.findMany({
    where: { companyId, leaseId },
    select: {
      id: true,
      version: true,
      name: true,
      role: true,
      startsOn: true,
      endsOn: true,
      removedAt: true,
      userId: true,
      contactId: true,
      user: { select: accountSelect },
      contact: {
        select: {
          name: true,
          status: true,
          userId: true,
          user: { select: accountSelect },
        },
      },
    },
    orderBy: { id: "asc" },
    take: 201,
  });
  const members = await tx.companyMembership.findMany({
    where: {
      companyId,
      status: "active",
      role: { in: ["owner", "manager"] },
      user: { status: "active" },
    },
    select: {
      userId: true,
      version: true,
      role: true,
      user: { select: { name: true, email: true, emailVerified: true } },
    },
    orderBy: { userId: "asc" },
    take: 201,
  });
  if (participants.length > 200 || members.length > 200)
    throw new AccessError(
      422,
      "AGREEMENT_SCOPE_TOO_LARGE",
      "Too many household or management records to show a complete signer selection.",
    );
  type Account = NonNullable<typeof lease.resident>;
  const eligible = (user: Account | null) =>
    !!user &&
    user.status === "active" &&
    (!user.membership ||
      (user.membership.companyId === companyId &&
        user.membership.status === "active"));
  const leaseholders: {
    id: string;
    userId: string;
    name: string;
    email: string;
    emailVerified: boolean;
    startsOn: string;
    endsOn: string | null;
    version: number;
  }[] = [];
  let unavailableLeaseholders = 0;
  const candidate = (
    id: string,
    name: string,
    user: Account | null,
    startsOn: Date,
    endsOn: Date | null,
    v: number,
    valid: boolean,
  ) => {
    if (!valid || !eligible(user)) {
      unavailableLeaseholders++;
      return;
    }
    leaseholders.push({
      id,
      userId: user!.id,
      name,
      email: user!.email,
      emailVerified: user!.emailVerified,
      startsOn: startsOn.toISOString().slice(0, 10),
      endsOn: endsOn?.toISOString().slice(0, 10) || null,
      version: v,
    });
  };
  for (const p of participants) {
    if (p.removedAt || p.role !== "leaseholder") continue;
    const user = p.user || p.contact?.user || null;
    candidate(
      p.id,
      p.contact?.name || p.name,
      user,
      p.startsOn,
      p.endsOn,
      p.version,
      (!p.contact || p.contact.status === "active") &&
        (!p.userId || !p.contact?.userId || p.userId === p.contact.userId),
    );
  }
  const primaryRecorded = participants.some(
    (p) =>
      (!!lease.residentId && p.userId === lease.residentId) ||
      (!!lease.residentContactId && p.contactId === lease.residentContactId),
  );
  if (!primaryRecorded && (lease.residentId || lease.residentContactId)) {
    const user = lease.resident || lease.residentContact?.user || null;
    // Bind a primary-only choice to its account, so changing the lease's
    // primary cannot silently retarget an existing intended signer selection.
    candidate(
      `primary-${hash(user?.id || "unlinked")}`,
      lease.residentContact?.name || user?.name || "Primary leaseholder",
      user,
      lease.startsOn,
      lease.endsOn,
      lease.version,
      (!lease.residentContact || lease.residentContact.status === "active") &&
        (!lease.residentId ||
          !lease.residentContact?.userId ||
          lease.residentId === lease.residentContact.userId),
    );
  }
  const { resident, residentContact, residentId, residentContactId, ...terms } =
    lease;
  return {
    lease: json(terms),
    leaseholders,
    unavailableLeaseholders,
    companySigners: members.map((m) => ({
      userId: m.userId,
      name: m.user.name || m.user.email,
      email: m.user.email,
      emailVerified: m.user.emailVerified,
      role: m.role,
      version: m.version,
    })),
    signature,
  };
}
async function resolve(
  tx: Tx,
  companyId: string,
  leaseId: string,
  pkg: Package,
  strict = false,
) {
  const c = await context(tx, companyId, leaseId),
    blockers: string[] = [];
  const originals = await tx.documentVersion.findMany({
    where: {
      companyId,
      id: { in: pkg.documentVersionIds },
      document: { companyId, leaseId },
    },
    select: {
      id: true,
      number: true,
      filename: true,
      mediaType: true,
      byteLength: true,
      scanStatus: true,
      documentId: true,
      document: {
        select: {
          title: true,
          version: true,
          archivedAt: true,
          versions: {
            where: { companyId },
            select: { id: true, number: true, scanStatus: true },
            orderBy: { number: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (new Set(originals.map((o) => o.documentId)).size !== originals.length) {
    if (strict)
      throw invalid("Choose one retained version per agreement document.");
    blockers.push("Choose one retained version per agreement document.");
  }
  const files = pkg.documentVersionIds.map((id) => {
    const row = originals.find((v) => v.id === id);
    if (!row) {
      if (strict)
        throw invalid("Choose document versions retained at this exact lease.");
      blockers.push("A selected original is unavailable at this lease.");
      return { id, unavailable: true };
    }
    if (!documentAvailable(row.scanStatus))
      blockers.push(
        `The selected version of “${row.document.title}” has a recorded rejection or unavailable file status.`,
      );
    if (row.document.archivedAt)
      blockers.push(
        `Restore “${row.document.title}” before completing preparation review.`,
      );
    const { document, ...version } = row;
    return {
      ...version,
      title: document.title,
      documentVersion: document.version,
      archivedAt: document.archivedAt?.toISOString() || null,
      latest: document.versions[0] || null,
    };
  });
  const parties = pkg.partyIds.map((id) => {
    const party = c.leaseholders.find((p) => p.id === id);
    if (!party) {
      if (strict)
        throw invalid(
          "Choose intended signers from the lease's current recorded leaseholders.",
        );
      blockers.push(
        "An intended leaseholder signer is no longer eligible in the current records.",
      );
      return { id, unavailable: true };
    }
    return party;
  });
  const representative =
    c.companySigners.find((s) => s.userId === pkg.companySignerId) || null;
  if (pkg.companySignerId && !representative) {
    if (strict)
      throw invalid(
        "Choose an active owner or manager of this company as the intended company signer.",
      );
    blockers.push(
      "The intended company signer is no longer an active owner or manager.",
    );
  }
  if (!pkg.documentVersionIds.length)
    blockers.push("Select at least one retained agreement document version.");
  if (!pkg.partyIds.length)
    blockers.push("Select at least one intended leaseholder signer.");
  if (!representative) blockers.push("Select an intended company signer.");
  const userIds = parties.flatMap((p) => ("userId" in p ? [p.userId] : []));
  if (new Set(userIds).size !== userIds.length) {
    if (strict) throw invalid("Select each intended leaseholder account once.");
    blockers.push(
      "The same account is listed as more than one intended leaseholder signer.",
    );
  }
  const source = json({
    lease: c.lease,
    files,
    parties,
    companySigner: representative,
  });
  return { source, sourceHash: hash(source), blockers };
}
export function registerAgreements(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
  publish: NotificationPublisher = publishNotification,
) {
  const auth = { preValidation: authenticate },
    base = "/api/company/leases/:leaseId/agreements";
  type Params = { leaseId: string; agreementId: string };
  const run = <T>(
    request: FastifyRequest,
    work: (tx: Tx, companyId: string) => Promise<T>,
  ) => scoped(db, request, "lease.manage", work);
  const params = (p: Params) => ({
    leaseId: assignmentId(p.leaseId),
    agreementId: assignmentId(p.agreementId),
  });
  const source = async (tx: Tx, companyId: string, leaseId: string) => {
    if (
      !(await tx.lease.findFirst({
        where: { id: leaseId, companyId },
        select: { id: true },
      }))
    )
      throw new AccessError(404, "NOT_FOUND", "Lease not found.");
  };
  const record = async (tx: Tx, companyId: string, p: Params) => {
    const row = await tx.leaseAgreement.findFirst({
      where: { id: p.agreementId, leaseId: p.leaseId, companyId },
    });
    if (!row)
      throw new AccessError(
        404,
        "NOT_FOUND",
        "Agreement package not found at this lease.",
      );
    return row;
  };
  const cleanQuery = (request: FastifyRequest) => {
    if (Object.keys(request.query as object).length)
      throw invalid("Unknown agreement filter.");
  };
  const replay = async (
    tx: Tx,
    companyId: string,
    request: FastifyRequest,
    key: ReturnType<typeof submission>,
  ) => {
    const row = await tx.agreementRevision.findFirst({
      where: {
        companyId,
        actorId: request.principal!.id,
        submissionKey: key.submissionKey,
      },
      select: { agreementId: true, version: true, submissionHash: true },
    });
    if (!row) return null;
    sameSubmission(row.submissionHash, key.submissionHash);
    return {
      saved: true,
      agreementId: row.agreementId,
      version: row.version,
      recovered: true,
    };
  };
  const retain = async (
    tx: Tx,
    companyId: string,
    request: FastifyRequest,
    row: Awaited<ReturnType<typeof record>>,
    action: string,
    reason: string | null,
    key: ReturnType<typeof submission>,
  ) => {
    const snapshot = json({
      title: row.title,
      kind: row.kind,
      status: row.status,
      package: row.package,
      source: row.source,
    });
    const revision = await tx.agreementRevision.create({
      data: {
        companyId,
        leaseId: row.leaseId,
        agreementId: row.id,
        version: row.version,
        action,
        reason,
        snapshot,
        actorId: request.principal!.id,
        ...key,
      },
    });
    const pkg = row.package as Package;
    if (pkg.documentVersionIds.length)
      await tx.agreementFile.createMany({
        data: pkg.documentVersionIds.map((versionId) => ({
          companyId,
          revisionId: revision.id,
          versionId,
        })),
      });
    await audit(tx, request, companyId, row.id, `agreement.${action}`, {
      leaseId: row.leaseId,
      version: row.version,
      revisionId: revision.id,
    });
    if (["submit", "approve", "request_changes"].includes(action)) await publish(tx, { companyId, actorId: request.principal!.id, kind: action === "submit" ? "agreement.review" : action === "approve" ? "agreement.approved" : "agreement.changes", sourceId: row.id, eventKey: revision.id });
    return { saved: true, agreementId: row.id, version: row.version };
  };
  server.get<{ Params: Params }>(`${base}/context`, auth, (request) => {
    cleanQuery(request);
    const leaseId = assignmentId(request.params.leaseId);
    return run(request, (tx, companyId) => context(tx, companyId, leaseId));
  });
  server.get<{ Params: Params; Querystring: Record<string, string> }>(
    base,
    auth,
    (request) => {
      const q = request.query;
      if (Object.keys(q).some((k) => !["q", "status", "page"].includes(k)))
        throw invalid("Unknown agreement filter.");
      const search =
          q.q === undefined ? null : boundedText(q.q, 200, "Agreement search"),
        status =
          q.status === undefined
            ? "active"
            : choice(
                q.status,
                [
                  "active",
                  "all",
                  "preparing",
                  "awaiting_review",
                  "reviewed",
                  "cancelled",
                ],
                "agreement status",
              );
      if (q.page !== undefined && !/^[1-9]\d{0,5}$/.test(q.page))
        throw invalid("Choose a valid agreement page.");
      const currentPage = Number(q.page || 1),
        leaseId = assignmentId(request.params.leaseId);
      return run(request, async (tx, companyId) => {
        await source(tx, companyId, leaseId);
        const where: Prisma.LeaseAgreementWhereInput = {
          companyId,
          leaseId,
          ...(search
            ? { title: { contains: search, mode: "insensitive" } }
            : {}),
          ...(status === "active"
            ? { status: { not: "cancelled" } }
            : status !== "all"
              ? { status }
              : {}),
        };
        return {
          items: await tx.leaseAgreement.findMany({
            where,
            select: {
              id: true,
              title: true,
              kind: true,
              status: true,
              version: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip: (currentPage - 1) * 25,
            take: 25,
          }),
          total: await tx.leaseAgreement.count({ where }),
          page: currentPage,
          pageSize: 25,
          signature,
        };
      });
    },
  );
  server.get<{ Params: Params; Querystring: { beforeVersion?: string } }>(
    `${base}/:agreementId`,
    auth,
    (request) => {
      const p = params(request.params),
        q = request.query;
      if (
        Object.keys(q).some((k) => k !== "beforeVersion") ||
        (q.beforeVersion !== undefined &&
          !/^[1-9]\d{0,8}$/.test(q.beforeVersion))
      )
        throw invalid("Choose a valid agreement history page.");
      return run(request, async (tx, companyId) => {
        await source(tx, companyId, p.leaseId);
        const row = await record(tx, companyId, p),
          current = await resolve(
            tx,
            companyId,
            p.leaseId,
            row.package as Package,
          );
        const revisions = await tx.agreementRevision.findMany({
          where: {
            companyId,
            leaseId: p.leaseId,
            agreementId: row.id,
            ...(q.beforeVersion
              ? { version: { lt: Number(q.beforeVersion) } }
              : {}),
          },
          select: {
            id: true,
            version: true,
            action: true,
            reason: true,
            snapshot: true,
            createdAt: true,
            actor: { select: { name: true } },
          },
          orderBy: { version: "desc" },
          take: 26,
        });
        const {
          sourceHash,
          companyId: company,
          leaseId,
          createdAt,
          updatedAt,
          ...agreement
        } = row;
        return {
          agreement,
          currentSource: current.source,
          sourceChanged: sourceHash !== current.sourceHash,
          blockers: current.blockers,
          signature,
          revisions: revisions.slice(0, 25).map(({ actor, ...r }) => ({
            ...r,
            actorName: actor.name || "Recorded teammate",
          })),
          nextBeforeVersion:
            revisions.length > 25 ? revisions[24].version : null,
        };
      });
    },
  );
  server.post<{ Params: Params }>(base, auth, (request) => {
    mutation(request, origin);
    cleanQuery(request);
    const leaseId = assignmentId(request.params.leaseId),
      b = input(request, [...editable, "submissionKey"]),
      data = fields(b),
      key = submission(b.submissionKey, ["create", leaseId, data]);
    return run(request, async (tx, companyId) => {
      await source(tx, companyId, leaseId);
      const previous = await replay(tx, companyId, request, key);
      if (previous) return previous;
      if (
        (await tx.leaseAgreement.count({ where: { companyId, leaseId } })) >=
        100
      )
        throw new AccessError(
          409,
          "AGREEMENT_LIMIT",
          "This lease already retains 100 agreement packages.",
        );
      const current = await resolve(tx, companyId, leaseId, data.package, true);
      const row = await tx.leaseAgreement.create({
        data: {
          companyId,
          leaseId,
          ...data,
          ...{ source: current.source, sourceHash: current.sourceHash },
        },
      });
      return retain(tx, companyId, request, row, "create", null, key);
    });
  });
  server.post<{ Params: Params }>(`${base}/:agreementId`, auth, (request) => {
    mutation(request, origin);
    cleanQuery(request);
    const p = params(request.params),
      b = input(request, [
        ...editable,
        "action",
        "reason",
        "confirmed",
        "expectedVersion",
        "submissionKey",
      ]),
      action = choice(
        b.action,
        ["edit", "submit", "approve", "request_changes", "reopen", "cancel"],
        "agreement action",
      ),
      expectedVersion = version(b.expectedVersion);
    const data = action === "edit" ? fields(b) : null,
      reason = ["approve", "request_changes", "reopen", "cancel"].includes(
        action,
      )
        ? boundedText(b.reason, 1000, "Review reason")
        : null;
    if (action !== "edit" && editable.some((k) => Object.hasOwn(b, k)))
      throw invalid(
        "Review actions use the saved package; save a new version to change its contents.",
      );
    if (
      action === "edit" &&
      (Object.hasOwn(b, "confirmed") || Object.hasOwn(b, "reason"))
    )
      throw invalid("Save package details separately from review actions.");
    if (action === "submit" && Object.hasOwn(b, "reason"))
      throw invalid("Submission uses the saved preparation notes.");
    if (action !== "edit" && b.confirmed !== true)
      throw invalid("Confirm the reviewed agreement action.");
    const key = submission(b.submissionKey, [
      action,
      p,
      expectedVersion,
      data,
      reason,
    ]);
    return run(request, async (tx, companyId) => {
      await source(tx, companyId, p.leaseId);
      let row = await record(tx, companyId, p);
      const previous = await replay(tx, companyId, request, key);
      if (previous) return previous;
      if (row.version !== expectedVersion) throw conflict();
      const allowed: Record<string, string[]> = {
        edit: ["preparing"],
        submit: ["preparing"],
        approve: ["awaiting_review"],
        request_changes: ["awaiting_review"],
        reopen: ["reviewed", "cancelled"],
        cancel: ["preparing", "awaiting_review", "reviewed"],
      };
      if (!allowed[action].includes(row.status))
        throw new AccessError(
          409,
          "AGREEMENT_STATE",
          "This action is unavailable for the package's current state. Reload and review it.",
        );
      const current = await resolve(
        tx,
        companyId,
        p.leaseId,
        data?.package || (row.package as Package),
        !!data,
      );
      if (action === "submit" || action === "approve") {
        if (current.sourceHash !== row.sourceHash)
          throw new AccessError(
            409,
            "AGREEMENT_SOURCES_CHANGED",
            "Lease details, intended signers or document versions changed. Return the package to preparation and save a new version with the current sources before reviewing it.",
          );
        if (current.blockers.length)
          throw new AccessError(
            409,
            "AGREEMENT_NOT_READY",
            "Resolve the preparation blockers before submitting or approving this package.",
          );
      }
      const status =
        action === "submit"
          ? "awaiting_review"
          : action === "approve"
            ? "reviewed"
            : action === "cancel"
              ? "cancelled"
              : "preparing";
      const changed = await tx.leaseAgreement.updateMany({
        where: {
          id: row.id,
          companyId,
          leaseId: p.leaseId,
          version: expectedVersion,
        },
        data: {
          ...(data
            ? {
                ...data,
                source: current.source,
                sourceHash: current.sourceHash,
              }
            : {}),
          status,
          version: { increment: 1 },
        },
      });
      if (!changed.count) throw conflict();
      row = await record(tx, companyId, p);
      return retain(tx, companyId, request, row, action, reason, key);
    });
  });
}
