import { AccessError } from "./access.js";
import type { Tx } from "./operational.js";
export const movementSelect = {
  id:true, reference:true, leaseId:true, accountId:true, chargeId:true, paymentId:true,
  kind:true, effectiveOn:true, amountCents:true, reason:true, payee:true, method:true, createdAt:true,
  reversal:{select:{id:true,reference:true,effectiveOn:true,reason:true,createdAt:true}},
  cashEntries:{select:{id:true,reference:true,amountCents:true,voidedAt:true}},
} as const;
export async function readLeaseMovements(tx:Tx, companyId:string, leaseIds:string[]) {
  const rows=await tx.leaseMovement.findMany({where:{companyId,leaseId:{in:leaseIds}},select:movementSelect,orderBy:[{effectiveOn:"asc"},{id:"asc"}],take:10001});
  if(rows.length>10000)throw new AccessError(422,"MOVEMENT_SCOPE_TOO_LARGE","Too many money movements for a complete view. Choose a lease; no partial balances are shown.");
  for(const row of rows) if(row.kind!=="deposit_application" && (row.cashEntries.length!==1 || row.cashEntries[0].amountCents!==row.amountCents || !!row.cashEntries[0].voidedAt!==!!row.reversal))
    throw new AccessError(503,"MOVEMENT_SOURCE_UNAVAILABLE","Refund source is incomplete. No partial balances are shown.");
  return rows;
}
export type Movement = Awaited<ReturnType<typeof readLeaseMovements>>[number];
export function depositMovementTotals(rows:Movement[], accountId:string) {
  let applied=0n,returned=0n;
  for(const row of rows)if(row.accountId===accountId && !row.reversal) {
    if(row.kind==="deposit_application")applied+=BigInt(row.amountCents);
    if(row.kind==="deposit_refund")returned+=BigInt(row.amountCents);
  }
  return {applied,returned};
}
