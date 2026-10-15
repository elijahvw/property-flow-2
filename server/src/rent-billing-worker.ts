import { recordBillingRun } from "./tracing.js";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { serializable } from "./application.js";
import { AccessError } from "./access.js";
import { generateRentOccurrence } from "./rent-schedules.js";
export type BillingCursor = { companyId?: string; scheduleId?: string };
// Each process may run this worker. Lease write fences and durable occurrences
// coordinate replicas and crashes. No elevated database credential or RLS bypass.
export async function billingSweep(
  db: PrismaClient,
  cursor: BillingCursor = {},
  options: {
    now?: Date;
    budgetMs?: number;
    onError?: (code: string) => void;
  } = {},
) {
  const until = Date.now() + (options.budgetMs ?? 20000),
    now = options.now ?? new Date();
  let companyId = cursor.companyId,
    scheduleId = cursor.scheduleId;
  while (Date.now() < until) {
    const company = await db.company.findFirst({
      where: {
        status: "active",
        ...(companyId
          ? { id: { ...(scheduleId ? { gte: companyId } : { gt: companyId }) } }
          : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    if (!company) return {};
    if (company.id !== companyId) scheduleId = undefined;
    companyId = company.id;
    const schedules = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.company_id',${company.id},true)`;
      return tx.rentSchedule.findMany({
        where: {
          companyId: company.id,
          status: "active",
          ...(scheduleId ? { id: { gt: scheduleId } } : {}),
        },
        select: { id: true, version: true },
        orderBy: { id: "asc" },
        take: 100,
      });
    });
    for (const row of schedules) {
      const checked = new Date();
      try {
        await serializable(db, async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${company.id} FOR SHARE`;
          await tx.$queryRaw`SELECT set_config('app.company_id',${company.id},true)`;
          return generateRentOccurrence(
            tx,
            company.id,
            row.id,
            {
              id: `billing:${row.id}:${now.toISOString()}`,
              principal: { id: "system:rent-billing" },
            },
            now,
          );
        });
      } catch (error) {
        const code =
          error instanceof AccessError ? error.code : "BILLING_RETRY_REQUIRED";
        options.onError?.(code);
        // Mark a failed attempt only if this exact schedule version is still current.
        // A newer successful run or a pause/stop must not be overwritten by old work.
        await db
          .$transaction(async (tx) => {
            await tx.$queryRaw`SELECT set_config('app.company_id',${company.id},true)`;
            await tx.rentSchedule.updateMany({
              where: {
                id: row.id,
                companyId: company.id,
                status: "active",
                version: row.version,
                OR: [
                  { lastCheckedAt: null },
                  { lastCheckedAt: { lte: checked } },
                ],
              },
              data: { lastCheckedAt: checked, lastErrorCode: code },
            });
          })
          .catch(() => options.onError?.("BILLING_STATUS_UNAVAILABLE"));
      }
      scheduleId = row.id;
      if (Date.now() >= until) return { companyId, scheduleId };
    }
    if (schedules.length === 100) continue;
    scheduleId = undefined; // next company, not the same company's first page
  }
  return { companyId, scheduleId };
}
export function registerRentBillingWorker(
  server: FastifyInstance,
  db: PrismaClient,
) {
  let cursor: BillingCursor = {},
    running: Promise<void> | undefined,
    timer: ReturnType<typeof setInterval> | undefined,
    closed = false;
  const tick = () => {
    if (running || closed) return;
    const started = performance.now();
    let failed = false;
    running = billingSweep(db, cursor, {
      onError: (code) => {
        failed = true;
        server.log.warn({ code }, "Rent billing attempt needs retry");
      },
    })
      .then((next) => {
        cursor = next;
      })
      .catch(() => {
        failed = true;
        server.log.warn(
          { code: "BILLING_SWEEP_UNAVAILABLE" },
          "Rent billing will retry",
        );
      })
      .finally(() => {
        recordBillingRun(started, failed);
        running = undefined;
      });
  };
  server.addHook("onReady", async () => {
    timer = setInterval(tick, 60000);
    timer.unref();
    tick();
  });
  server.addHook("onClose", async () => {
    closed = true;
    if (timer) clearInterval(timer);
    await running;
  });
}
