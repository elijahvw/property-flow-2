import { createHash, randomUUID } from "node:crypto";
import type {
  FastifyInstance,
  preValidationHookHandler,
  FastifyRequest,
} from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { AccessError, requirePermission } from "./access.js";
import { assignmentId } from "./application.js";
import {
  audit,
  boundedText,
  cents,
  conflict,
  date,
  input,
  mutation,
  sameSubmission,
  scoped,
  submission,
  version,
  type Tx,
} from "./operational.js";
import { lockRentLease, readRentSources } from "./rent.js";
import { readDepositDetail } from "./deposits.js";
import { buildRentStatement } from "./statements.js";
import { createLeaseMovement } from "./lease-movements.js";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = <T>(value: T) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
const optional = (value: unknown, max: number, label: string) =>
  value == null || value === "" ? null : boundedText(value, max, label);
const revisionSelect = {
  id: true,
  reference: true,
  version: true,
  action: true,
  movedOutOn: true,
  reason: true,
  forwarding: true,
  snapshot: true,
  sourceHash: true,
  createdById: true,
  createdAt: true,
} as const;
const profileKeys = {
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
  region: 100,
  postalCode: 30,
  country: 100,
  email: 254,
  phone: 40,
};
function parse(b: Record<string, unknown>) {
  const movedOutOn = date(b.movedOutOn, "actual move-out date"),
    reason = boundedText(b.reason, 500, "Reason shown to the tenant"),
    expectedLeaseVersion = version(b.expectedLeaseVersion);
  if (
    !Number.isSafeInteger(b.expectedSettlementVersion) ||
    Number(b.expectedSettlementVersion) < 0
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Review the settlement version.",
    );
  if (
    !b.forwarding ||
    typeof b.forwarding !== "object" ||
    Array.isArray(b.forwarding)
  )
    throw new AccessError(400, "INVALID_INPUT", "Review forwarding details.");
  const f = b.forwarding as Record<string, unknown>;
  if (
    Object.keys(f).some(
      (k) => !["status", ...Object.keys(profileKeys)].includes(k),
    ) ||
    !["provided", "not_supplied"].includes(String(f.status))
  )
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Choose provided or not supplied for forwarding details.",
    );
  const forwarding =
    f.status === "not_supplied"
      ? { status: "not_supplied" }
      : {
          status: "provided",
          ...Object.fromEntries(
            Object.entries(profileKeys).map(([k, max]) => [
              k,
              optional(f[k], max, k),
            ]),
          ),
        };
  if (f.status === "provided") {
    for (const key of ["addressLine1", "city", "country"])
      if (!f[key])
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Add street, city and country for the forwarding address.",
        );
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.email)))
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Enter a complete forwarding email.",
      );
  }
  if (!Array.isArray(b.applications) || b.applications.length > 25)
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Review up to 25 deposit applications at a time.",
    );
  const applications = b.applications.map((raw: unknown) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some(
        (k) => !["chargeId", "amount", "evidenceReference"].includes(k),
      )
    )
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Review each itemized application.",
      );
    const r = raw as Record<string, unknown>,
      amountCents = cents(r.amount);
    if (!amountCents)
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Each application must be greater than zero.",
      );
    return {
      chargeId: assignmentId(r.chargeId),
      amountCents,
      evidenceReference: boundedText(
        r.evidenceReference,
        500,
        "Tenant-visible evidence or lease reference",
      ),
    };
  });
  if (new Set(applications.map((a) => a.chargeId)).size !== applications.length)
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Combine applications for the same charge into one reviewed line.",
    );
  if (typeof b.pauseBilling !== "boolean")
    throw new AccessError(
      400,
      "INVALID_INPUT",
      "Review whether recurring billing should be paused.",
    );
  return {
    movedOutOn,
    reason,
    forwarding,
    applications,
    pauseBilling: b.pauseBilling,
    expectedLeaseVersion,
    expectedSettlementVersion: Number(b.expectedSettlementVersion),
  };
}
async function context(
  tx: Tx,
  companyId: string,
  leaseId: string,
  residentId?: string,
) {
  const deposit = await readDepositDetail(tx, companyId, leaseId, residentId),
    sources = await readRentSources(tx, companyId, [leaseId]);
  const schedules = await tx.rentSchedule.findMany({
    where: { companyId, leaseId },
    select: { id: true, status: true, version: true, nextPeriodOn: true },
    orderBy: { id: "asc" },
    take: 1001,
  });
  if (schedules.length > 1000)
    throw new AccessError(
      422,
      "SETTLEMENT_SCOPE_TOO_LARGE",
      "Too many billing records for a complete settlement.",
    );
  const financial = buildRentStatement(
    sources,
    deposit.businessDate,
    null,
    null,
  );
  const snapshot = {
    basis:
      "Current recorded sources at this saved review. Deposit applications are not cash receipts; amounts available to return are not money already returned. Saving does not end the lease or waive remaining debt.",
    lease: {
      id: deposit.lease.id,
      status: deposit.lease.status,
      startsOn: deposit.lease.startsOn,
      endsOn: deposit.lease.endsOn,
      property: deposit.lease.property,
      unit: deposit.lease.unit,
    },
    financial,
    deposit: deposit.account
      ? {
          id: deposit.account.id,
          reference: deposit.account.reference,
          ...deposit.account.summary,
          receipts: deposit.account.receipts.map((r) => ({
            id: r.id,
            reference: r.reference,
            occurredOn: r.occurredOn,
            amountCents: r.amountCents,
            voidedAt: r.cashEntry.voidedAt,
          })),
          movements: deposit.account.movements,
        }
      : null,
    schedules,
  };
  // Include every immutable source/status and billing cursor. Never accept a
  // browser-provided balance/snapshot, or hash a generation timestamp.
  const sourceHash = hash({
    businessDate: deposit.businessDate,
    lease: {
      id: deposit.lease.id,
      version: deposit.lease.version,
      status: deposit.lease.status,
      startsOn: deposit.lease.startsOn,
      endsOn: deposit.lease.endsOn,
      property: deposit.lease.property,
      unit: deposit.lease.unit,
    },
    sources,
    deposit: deposit.account
      ? {
          id: deposit.account.id,
          version: deposit.account.version,
          requiredCents: deposit.account.requiredCents,
          dueOn: deposit.account.dueOn,
          receipts: deposit.account.receipts.map((r) => ({
            id: r.id,
            amountCents: r.amountCents,
            occurredOn: r.occurredOn,
            cash: {
              id: r.cashEntry.id,
              version: r.cashEntry.version,
              amountCents: r.cashEntry.amountCents,
              voidedAt: r.cashEntry.voidedAt,
            },
          })),
        }
      : null,
    schedules,
  });
  return {
    businessDate: deposit.businessDate,
    snapshot,
    sourceHash,
    deposit,
    sources,
    schedules,
  };
}
async function plan(
  tx: Tx,
  companyId: string,
  leaseId: string,
  data: ReturnType<typeof parse>,
) {
  const current = await context(tx, companyId, leaseId),
    head = await tx.leaseSettlement.findUnique({
      where: { companyId_leaseId: { companyId, leaseId } },
    });
  if (
    current.deposit.lease.version !== data.expectedLeaseVersion ||
    (head?.version ?? 0) !== data.expectedSettlementVersion
  )
    throw conflict();
  if (head?.status === "finalized")
    throw new AccessError(
      409,
      "SETTLEMENT_FINALIZED",
      "Reopen the saved settlement before recording a revised version.",
    );
  if (current.deposit.lease.status === "draft")
    throw new AccessError(
      409,
      "DRAFT_LEASE",
      "A draft lease cannot have an actual move-out settlement.",
    );
  if (
    data.movedOutOn.toISOString().slice(0, 10) > current.businessDate ||
    data.movedOutOn < current.deposit.lease.startsOn
  )
    throw new AccessError(
      400,
      "MOVE_OUT_DATE",
      "Choose an actual move-out date from the lease start through today.",
    );
  const active = current.schedules.filter((s) => s.status === "active");
  if (active.length && !data.pauseBilling)
    throw new AccessError(
      409,
      "ACTIVE_BILLING",
      "Pause the reviewed recurring schedules as part of saving, or review billing before finalizing.",
    );
  const charges = new Map(
    current.snapshot.financial.items
      .filter((i) => i.type === "charge" && !i.voidedAt)
      .map((i) => [i.id, i]),
  );
  let applied = 0n;
  for (const a of data.applications) {
    const charge = charges.get(a.chargeId);
    if (!charge)
      throw new AccessError(
        404,
        "NOT_FOUND",
        "A selected charge is unavailable on this lease.",
      );
    if (BigInt(a.amountCents) > BigInt(charge.remainingCents))
      throw new AccessError(
        409,
        "CHARGE_CHANGED",
        "An application exceeds the charge's current unpaid balance.",
      );
    applied += BigInt(a.amountCents);
  }
  const held = BigInt(current.deposit.account?.summary.heldCents ?? "0");
  if (applied > held)
    throw new AccessError(
      409,
      "FUNDS_CHANGED",
      "Applications exceed currently held deposit funds.",
    );
  return {
    ...current,
    head,
    active,
    plannedAppliedCents: String(applied),
    after: {
      outstandingCents: String(
        BigInt(current.snapshot.financial.current.outstandingCents) - applied,
      ),
      depositHeldCents: String(held - applied),
      paymentCreditCents: current.snapshot.financial.current.creditCents,
    },
    applications: data.applications.map((a) => ({
      ...a,
      charge: charges.get(a.chargeId)!,
    })),
  };
}
function publicRevision<
  T extends { forwarding: unknown; sourceHash: string; createdById: string },
>(revision: T, resident: boolean) {
  const { forwarding, sourceHash, createdById, ...rest } = revision;
  return resident ? rest : revision;
}
export function registerLeaseSettlements(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate },
    root = "/api/company/leases/:leaseId/settlement";
  for (const resident of [false, true])
    server.get<{
      Params: { leaseId: string };
      Querystring: { beforeVersion?: string };
    }>(
      resident ? "/api/resident/leases/:leaseId/settlement" : root,
      auth,
      (request) => {
        if (Object.keys(request.query).some((k) => k !== "beforeVersion"))
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "Unknown settlement filter.",
          );
        const leaseId = assignmentId(request.params.leaseId),
          before = request.query.beforeVersion;
        if (before !== undefined && !/^[1-9]\d{0,8}$/.test(before))
          throw new AccessError(
            400,
            "INVALID_INPUT",
            "Choose a valid history page.",
          );
        return scoped(
          db,
          request,
          resident ? "resident.self" : "finance.manage",
          async (tx, companyId) => {
            const c = await context(
              tx,
              companyId,
              leaseId,
              resident ? request.principal!.id : undefined,
            );
            const head = await tx.leaseSettlement.findUnique({
              where: { companyId_leaseId: { companyId, leaseId } },
            });
            const latest = head
              ? await tx.leaseSettlementRevision.findUniqueOrThrow({
                  where: {
                    settlementId_version: {
                      settlementId: head.id,
                      version: head.version,
                    },
                  },
                  select: revisionSelect,
                })
              : null;
            const revisions = head
              ? await tx.leaseSettlementRevision.findMany({
                  where: {
                    companyId,
                    settlementId: head.id,
                    ...(before ? { version: { lt: Number(before) } } : {}),
                  },
                  select: revisionSelect,
                  orderBy: { version: "desc" },
                  take: 51,
                })
              : [];
            const actors = resident
              ? []
              : await tx.user.findMany({
                  where: {
                    id: {
                      in: [
                        ...revisions.map((r) => r.createdById),
                        ...(latest ? [latest.createdById] : []),
                      ],
                    },
                  },
                  select: { id: true, name: true, email: true },
                });
            const present = (r: NonNullable<typeof latest>) => ({
              ...publicRevision(r, resident),
              ...(resident
                ? {}
                : {
                    actorLabel:
                      actors.find((a) => a.id === r.createdById)?.name ||
                      actors.find((a) => a.id === r.createdById)?.email ||
                      "Recorded user",
                  }),
            });
            return {
              businessDate: c.businessDate,
              lease: c.deposit.lease,
              settlement: head
                ? { id: head.id, status: head.status, version: head.version }
                : null,
              latest: latest ? present(latest) : null,
              revisions: revisions.slice(0, 50).map(present),
              nextBeforeVersion:
                revisions.length > 50 ? revisions[49].version : null,
              sourceChanged: latest
                ? latest.sourceHash !== c.sourceHash
                : false,
              ...(resident
                ? {}
                : {
                    sourceHash: c.sourceHash,
                    current: c.snapshot,
                    activeBillingCount: c.schedules.filter(
                      (s) => s.status === "active",
                    ).length,
                  }),
            };
          },
        );
      },
    );
  const fields = [
    "movedOutOn",
    "reason",
    "forwarding",
    "applications",
    "pauseBilling",
    "expectedLeaseVersion",
    "expectedSettlementVersion",
  ];
  for (const preview of [true, false])
    server.post<{ Params: { leaseId: string } }>(
      root + (preview ? "/preview" : ""),
      auth,
      (request) => {
        mutation(request, origin);
        const leaseId = assignmentId(request.params.leaseId),
          b = input(
            request,
            preview
              ? fields
              : [...fields, "sourceHash", "confirmed", "submissionKey"],
          ),
          data = parse(b);
        if (
          !preview &&
          (b.confirmed !== true ||
            typeof b.sourceHash !== "string" ||
            !/^[0-9a-f]{64}$/.test(b.sourceHash))
        )
          throw new AccessError(
            400,
            "REVIEW_REQUIRED",
            "Confirm the reviewed sources, authorization and remaining balances.",
          );
        const key = preview
          ? null
          : submission(b.submissionKey, [leaseId, data, b.sourceHash, true]);
        return scoped(db, request, "finance.manage", async (tx, companyId) => {
          requirePermission(request.principal!, "lease.manage");
          if (!preview) {
            const previous = await tx.leaseSettlementRevision.findFirst({
              where: {
                companyId,
                createdById: request.principal!.id,
                submissionKey: key!.submissionKey,
              },
              select: { ...revisionSelect, submissionHash: true },
            });
            if (previous) {
              sameSubmission(previous.submissionHash, key!.submissionHash);
              const { submissionHash: _hash, ...row } = previous;
              return row;
            }
          }
          await lockRentLease(tx, companyId, leaseId);
          const p = await plan(tx, companyId, leaseId, data);
          if (preview)
            return {
              sourceHash: p.sourceHash,
              before: p.snapshot,
              after: p.after,
              applications: p.applications,
              pauseSchedules: p.active,
              plannedAppliedCents: p.plannedAppliedCents,
            };
          if (b.sourceHash !== p.sourceHash)
            throw new AccessError(
              409,
              "SETTLEMENT_SOURCES_CHANGED",
              "Lease, billing or financial activity changed. Refresh the sources and review again.",
            );
          let available = BigInt(p.deposit.account?.summary.heldCents ?? "0");
          const movements = [];
          for (const a of data.applications) {
            const movement = await createLeaseMovement(
              tx,
              request,
              {
                companyId,
                propertyId: p.deposit.lease.propertyId,
                leaseId,
                accountId: p.deposit.account!.id,
                chargeId: a.chargeId,
                kind: "deposit_application",
                effectiveOn: new Date(p.businessDate + "T00:00:00Z"),
                amountCents: a.amountCents,
                reason: `Move-out settlement: ${a.evidenceReference}`.slice(
                  0,
                  500,
                ),
                createdById: request.principal!.id,
                ...submission(randomUUID(), [key!.submissionKey, a]),
              },
              available,
            );
            available -= BigInt(a.amountCents);
            movements.push({
              id: movement.id,
              reference: movement.reference,
              chargeId: a.chargeId,
              amountCents: a.amountCents,
              evidenceReference: a.evidenceReference,
            });
          }
          for (const s of p.active) {
            await tx.rentSchedule.update({
              where: { id: s.id },
              data: { status: "paused", version: { increment: 1 } },
            });
            await audit(tx, request, companyId, s.id, "rent.schedule.paused", {
              leaseId,
              reason: "Reviewed move-out settlement",
              fromVersion: s.version,
            });
          }
          const after = await context(tx, companyId, leaseId),
            next = (p.head?.version ?? 0) + 1;
          const head = p.head
            ? await tx.leaseSettlement.update({
                where: { id: p.head.id },
                data: { version: next, status: "finalized" },
              })
            : await tx.leaseSettlement.create({
                data: {
                  companyId,
                  propertyId: p.deposit.lease.propertyId,
                  leaseId,
                  version: next,
                  status: "finalized",
                },
              });
          const snapshot = json({
            ...after.snapshot,
            itemizedApplications: movements,
            reviewedApplications: data.applications,
            pausedScheduleIds: p.active.map((s) => s.id),
            reviewedAt: new Date().toISOString(),
          });
          const row = await tx.leaseSettlementRevision.create({
            data: {
              companyId,
              propertyId: p.deposit.lease.propertyId,
              leaseId,
              settlementId: head.id,
              version: next,
              action: "finalized",
              movedOutOn: data.movedOutOn,
              reason: data.reason,
              forwarding: json(data.forwarding),
              snapshot,
              sourceHash: after.sourceHash,
              createdById: request.principal!.id,
              ...key!,
            },
            select: revisionSelect,
          });
          await audit(
            tx,
            request,
            companyId,
            head.id,
            "lease.settlement.finalized",
            {
              leaseId,
              version: next,
              revisionId: row.id,
              applicationIds: movements.map((m) => m.id),
              billingPaused: p.active.map((s) => s.id),
              movedOutOn: data.movedOutOn.toISOString().slice(0, 10),
            },
          );
          return row;
        });
      },
    );
  server.post<{ Params: { leaseId: string } }>(
    root + "/reopen",
    auth,
    (request) => {
      mutation(request, origin);
      const leaseId = assignmentId(request.params.leaseId),
        b = input(request, [
          "reason",
          "expectedLeaseVersion",
          "expectedSettlementVersion",
          "submissionKey",
        ]),
        reason = boundedText(
          b.reason,
          500,
          "Tenant-visible reason for reopening",
        ),
        expectedLease = version(b.expectedLeaseVersion),
        expected = version(b.expectedSettlementVersion),
        key = submission(b.submissionKey, [
          leaseId,
          reason,
          expectedLease,
          expected,
        ]);
      return scoped(db, request, "finance.manage", async (tx, companyId) => {
        requirePermission(request.principal!, "lease.manage");
        const previous = await tx.leaseSettlementRevision.findFirst({
          where: {
            companyId,
            createdById: request.principal!.id,
            submissionKey: key.submissionKey,
          },
        });
        if (previous) {
          sameSubmission(previous.submissionHash, key.submissionHash);
          return { id: previous.id, reference: previous.reference };
        }
        const lease = await lockRentLease(tx, companyId, leaseId),
          head = await tx.leaseSettlement.findUnique({
            where: { companyId_leaseId: { companyId, leaseId } },
          });
        if (!head)
          throw new AccessError(
            404,
            "NOT_FOUND",
            "No saved settlement exists.",
          );
        if (
          head.version !== expected ||
          lease.version !== expectedLease ||
          head.status !== "finalized"
        )
          throw conflict();
        const last = await tx.leaseSettlementRevision.findUniqueOrThrow({
            where: {
              settlementId_version: {
                settlementId: head.id,
                version: head.version,
              },
            },
          }),
          c = await context(tx, companyId, leaseId);
        await tx.leaseSettlement.update({
          where: { id: head.id },
          data: { version: { increment: 1 }, status: "open" },
        });
        const row = await tx.leaseSettlementRevision.create({
          data: {
            companyId,
            propertyId: lease.propertyId,
            leaseId,
            settlementId: head.id,
            version: head.version + 1,
            action: "reopened",
            movedOutOn: last.movedOutOn,
            reason,
            forwarding: last.forwarding as Prisma.InputJsonValue,
            snapshot: json(c.snapshot),
            sourceHash: c.sourceHash,
            createdById: request.principal!.id,
            ...key,
          },
        });
        await audit(
          tx,
          request,
          companyId,
          head.id,
          "lease.settlement.reopened",
          { leaseId, version: row.version, revisionId: row.id },
        );
        return { id: row.id, reference: row.reference };
      });
    },
  );
}
