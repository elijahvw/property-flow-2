import type { Prisma } from "@prisma/client";
import { AccessError } from "./access.js";

// Call after the target User write fence. Generation ownership is a durable
// reservation through provider completion, including interrupted cleanup;
// expiring the operator lease must not free an identity for customer access.
// Legacy demos have no setup and never reserve their pre-existing presenter.
export async function assertDemoIdentityAvailable(tx: Prisma.TransactionClient, userId: string) {
  const reserved = await tx.$queryRaw<{ present: number }[]>`
    SELECT 1 AS present FROM "SalesDemoSetup" AS setup
    WHERE setup.status IN ('pending', 'retiring')
      AND EXISTS (
        SELECT 1 FROM jsonb_each(setup.accounts) AS account
        WHERE account.value->>'user_id' = ${userId}
      )
    LIMIT 1`;
  if (reserved.length)
    throw new AccessError(409, "DEMO_OPERATION_IN_PROGRESS", "This generated account is reserved by an unfinished demo operation. Finish or retry its cleanup before changing account access.");
}
