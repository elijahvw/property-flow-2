import {readTermChanges,termInstallment} from "./lease-term-policy.js";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { assignmentId } from "./application.js";
import { AccessError } from "./access.js";
import {
  audit,
  boundedText,
  conflict,
  input,
  mutation,
  sameSubmission,
  scoped,
  submission,
  version,
  type Tx,
} from "./operational.js";
import { lockRentLease, allocateRentCredit } from "./rent.js";
import { installment, isoDay, monthStart } from "./billing-dates.js";
import { companyDay } from "./reports.js";
async function reviewed(
  tx: Tx,
  companyId: string,
  scheduleId: string,
  occurrenceId: string,
) {
  const schedule = await tx.rentSchedule.findFirst({
    where: { id: scheduleId, companyId },
  });
  if (!schedule)
    throw new AccessError(404, "NOT_FOUND", "Billing schedule not found.");
  const lease = await lockRentLease(tx, companyId, schedule.leaseId),
    current = await tx.rentSchedule.findFirstOrThrow({
      where: { id: scheduleId, companyId },
    });
  const occurrence = await tx.rentScheduleOccurrence.findFirst({
    where: { id: occurrenceId, companyId, scheduleId, leaseId: lease.id },
  });
  if (!occurrence)
    throw new AccessError(
      404,
      "NOT_FOUND",
      "Processed installment not found for this schedule.",
    );
  const item = termInstallment({...current,paymentInstructions:lease.paymentInstructions},await readTermChanges(tx,companyId,[lease.id]),occurrence.periodOn),
    company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timezone: true },
    }),
    today = companyDay(company.timezone);
  if (
    lease.status === "draft" ||
    occurrence.periodOn < monthStart(lease.startsOn) ||
    (lease.endsOn && occurrence.periodOn > lease.endsOn) ||
    isoDay(item.postOn) > today
  )
    throw new AccessError(
      409,
      "REPOST_PERIOD_INVALID",
      "This installment cannot be reposted under the current lease term or before its posting date.",
    );
  if (
    await tx.rentCharge.findFirst({
      where: {
        companyId,
        leaseId: lease.id,
        periodOn: occurrence.periodOn,
        voidedAt: null,
      },
      select: { id: true },
    })
  )
    throw new AccessError(
      409,
      "RENT_ALREADY_POSTED",
      "An active charge already exists for this month. Review the ledger instead.",
    );
  return { schedule: current, lease, occurrence, item, today };
}
const select = {
  id: true,
  reference: true,
  periodOn: true,
  dueOn: true,
  amountCents: true,
  graceDays: true,
  scheduleId: true,
  version: true,
} as const;
export function registerRentRecovery(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  for (const preview of [true, false])
    server.post<{ Params: { scheduleId: string } }>(
      `/api/company/rent-schedules/:scheduleId/${preview ? "repost-preview" : "reposts"}`,
      auth,
      (request) => {
        mutation(request, origin);
        const scheduleId = assignmentId(request.params.scheduleId),
          b = input(
            request,
            preview
              ? ["occurrenceId"]
              : [
                  "occurrenceId",
                  "expectedLeaseVersion",
                  "expectedScheduleVersion",
                  "reason",
                  "submissionKey",
                ],
          ),
          occurrenceId = assignmentId(b.occurrenceId);
        const details = preview
          ? null
          : {
              expectedLeaseVersion: version(b.expectedLeaseVersion),
              expectedScheduleVersion: version(b.expectedScheduleVersion),
              reason: boundedText(b.reason, 300, "Reason for reposting"),
            };
        const key = details
          ? submission(b.submissionKey, [
              "schedule.repost",
              scheduleId,
              occurrenceId,
              details,
            ])
          : null;
        return scoped(db, request, "finance.manage", async (tx, companyId) => {
          if (key) {
            const old = await tx.rentCharge.findFirst({
              where: {
                companyId,
                createdById: request.principal!.id,
                submissionKey: key.submissionKey,
              },
              select: { ...select, submissionHash: true },
            });
            if (old) {
              sameSubmission(old.submissionHash, key.submissionHash);
              const { submissionHash: _hash, ...row } = old;
              return row;
            }
          }
          const value = await reviewed(tx, companyId, scheduleId, occurrenceId);
          if (preview)
            return {
              scheduleId,
              occurrenceId,
              leaseId: value.lease.id,
              expectedLeaseVersion: value.lease.version,
              expectedScheduleVersion: value.schedule.version,
              periodOn: value.item.periodOn,
              dueOn: value.item.dueOn,
              postOn: value.item.postOn,
              amountCents: value.item.amountCents,
              graceDays: value.item.graceDays,
              businessDate: value.today,
            };
          if (
            value.lease.version !== details!.expectedLeaseVersion ||
            value.schedule.version !== details!.expectedScheduleVersion
          )
            throw conflict();
          const charge = await tx.rentCharge.create({
            data: {
              companyId,
              propertyId: value.lease.propertyId,
              leaseId: value.lease.id,
              scheduleId,
              createdById: request.principal!.id,
              ...key!,
              periodOn: value.item.periodOn,
              dueOn: value.item.dueOn,
              amountCents: value.item.amountCents,
              graceDays: value.item.graceDays,
              memo: null,
            },
            select,
          });
          await audit(
            tx,
            request,
            companyId,
            charge.id,
            "rent.schedule.reposted",
            {
              scheduleId,
              occurrenceId,
              leaseId: value.lease.id,
              periodOn: isoDay(value.item.periodOn),
              reason: details!.reason,
              reference: charge.reference,
            },
          );
          await allocateRentCredit(tx, request, companyId, value.lease.id);
          return charge;
        });
      },
    );
}
