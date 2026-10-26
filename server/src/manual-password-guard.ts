import type { Prisma } from "@prisma/client";
import { AccessError } from "./access.js";

// A committed administrative password intent stays bound to this exact local
// account until the provider result or explicit uncertain-attempt review.
export async function assertPasswordOperationAvailable(tx: Prisma.TransactionClient, userId: string, exceptOperationId?: string) {
  const operation = await tx.manualPasswordOperation.findFirst({ where: {
    userId, status: { in: ["pending", "uncertain"] }, ...(exceptOperationId ? { id: { not: exceptOperationId } } : {}),
  }, select: { id: true } });
  if (operation) throw new AccessError(409, "PASSWORD_OPERATION_IN_PROGRESS", "An administrative password change needs completion or review before this account's access can change.");
}
