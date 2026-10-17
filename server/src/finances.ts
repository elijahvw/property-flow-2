import type { FastifyInstance, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { lockRentLease, allocateRentCredit } from "./rent.js";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { audit, boundedText, cents, choice, conflict, date, input, mutation, page, sameSubmission, scoped, submission, version } from "./operational.js";
const select = { movementId:true,movement:{select:{id:true,leaseId:true,reference:true,kind:true}}, depositReceiptId:true,depositReceipt:{select:{leaseId:true,reference:true}},reference:true, leaseId:true, id:true, propertyId:true, occurredOn:true, amountCents:true, currency:true, kind:true, category:true, memo:true, version:true, voidedAt:true, voidReason:true, property:{select:{name:true}} } as const;
export function registerFinances(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
 const auth = { preValidation: authenticate };
 server.post("/api/company/finances", auth, request => {
  mutation(request, origin);
  const b = input(request,["propertyId","occurredOn","amount","kind","category","memo","submissionKey"]);
  const propertyId=assignmentId(b.propertyId), occurredOn=date(b.occurredOn,"transaction date"), amountCents=cents(b.amount);
  if (!amountCents) throw new AccessError(400,"INVALID_INPUT","Amount must be greater than zero.");
  const kind=choice(b.kind,["income","expense"],"entry type"), category=choice(b.category,kind==="income"?["rent","other"]:["repairs","utilities","insurance","property_tax","other"],"category");
  const memo=b.memo===null||b.memo===""?null:boundedText(b.memo,500,"Memo");
  const key=submission(b.submissionKey,[propertyId,occurredOn,amountCents,kind,category,memo]);
  return scoped(db,request,"finance.manage",async(tx,companyId)=>{
   const previous=await tx.ledgerEntry.findFirst({where:{companyId,createdById:request.principal!.id,submissionKey:key.submissionKey},select:{...select,submissionHash:true}});
   if(previous){sameSubmission(previous.submissionHash,key.submissionHash);const {submissionHash:_hash,...row}=previous;return row;}
   if(!await tx.property.findFirst({where:{companyId,id:propertyId},select:{id:true}}))throw new AccessError(404,"NOT_FOUND","Property not found.");
   const row=await tx.ledgerEntry.create({data:{companyId,propertyId,createdById:request.principal!.id,occurredOn,amountCents,kind,category,memo,...key},select});
   await audit(tx,request,companyId,row.id,"finance.created",{propertyId,kind});return row;
  });
 });
 server.get<{Querystring:{propertyId?:string;dateFrom?:string;dateTo?:string;cursor?:string}}>("/api/company/finances",auth,request=>{
  const q=request.query;if(Object.keys(q).some(k=>!["propertyId","dateFrom","dateTo","cursor"].includes(k)))throw new AccessError(400,"INVALID_INPUT","Unknown filter.");
  const propertyId=q.propertyId===undefined?undefined:assignmentId(q.propertyId),cursor=q.cursor===undefined?undefined:assignmentId(q.cursor);
  const from=q.dateFrom===undefined?undefined:date(q.dateFrom,"start date"),to=q.dateTo===undefined?undefined:date(q.dateTo,"end date");
  if(from&&to&&from>to)throw new AccessError(400,"INVALID_INPUT","End date cannot precede the start date.");
  return scoped(db,request,"finance.manage",async(tx,companyId)=>{
   if(propertyId&&!await tx.property.findFirst({where:{id:propertyId,companyId},select:{id:true}}))throw new AccessError(404,"NOT_FOUND","Property not found.");
   const where={companyId,...(propertyId?{propertyId}:{}),...(from||to?{occurredOn:{gte:from,lte:to}}:{})};
   const rows=await tx.ledgerEntry.findMany({where:{...where,...(cursor?{id:{lt:cursor}}:{})},select,take:51,orderBy:{id:"desc"}});
   // SUM returns bigint. Serialize exact decimal cents and summarize the whole filter,
   // never the current page; voided entries stay in history but leave totals.
   const [totals]=await tx.$queryRaw<{income:bigint;expense:bigint;deposit:bigint;rentRefund:bigint;depositRefund:bigint}[]>(Prisma.sql`SELECT COALESCE(SUM("amountCents") FILTER (WHERE kind='income'),0)::bigint income, COALESCE(SUM("amountCents") FILTER (WHERE kind='expense'),0)::bigint expense, COALESCE(SUM("amountCents") FILTER (WHERE kind='deposit'),0)::bigint deposit, COALESCE(SUM("amountCents") FILTER (WHERE kind='refund' AND category='rent'),0)::bigint "rentRefund", COALESCE(SUM("amountCents") FILTER (WHERE kind='refund' AND category='security_deposit'),0)::bigint "depositRefund" FROM "LedgerEntry" WHERE "companyId"=${companyId} AND "voidedAt" IS NULL ${propertyId?Prisma.sql`AND "propertyId"=${propertyId}`:Prisma.empty} ${from?Prisma.sql`AND "occurredOn">=${from}`:Prisma.empty} ${to?Prisma.sql`AND "occurredOn"<=${to}`:Prisma.empty}`);
   return {...page(rows),summary:{incomeCents:String(totals.income),expenseCents:String(totals.expense),netCents:String(totals.income-totals.expense-totals.rentRefund),depositReceivedCents:String(totals.deposit),rentRefundCents:String(totals.rentRefund),depositRefundCents:String(totals.depositRefund),cashMovementCents:String(totals.income-totals.expense-totals.rentRefund+totals.deposit-totals.depositRefund)}};
  });
 });
 server.post<{Params:{entryId:string}}>("/api/company/finances/:entryId/void",auth,request=>{
  mutation(request,origin);const entryId=assignmentId(request.params.entryId),b=input(request,["expectedVersion","reason"]),expectedVersion=version(b.expectedVersion),reason=boundedText(b.reason,300,"Correction reason");
  return scoped(db,request,"finance.manage",async(tx,companyId)=>{
   const previous=await tx.ledgerEntry.findFirst({where:{companyId,id:entryId},select});
   if(!previous)throw new AccessError(404,"NOT_FOUND","Entry not found.");
   if(previous.movementId)throw new AccessError(409,"MOVEMENT_CORRECTION_REQUIRED","Use the lease money-movement history to correct this linked refund.");
   if(previous.depositReceiptId)throw new AccessError(409,"DEPOSIT_CORRECTION_REQUIRED","Use the deposit ledger to correct this linked receipt.");
   if(previous.leaseId) {
    await lockRentLease(tx,companyId,previous.leaseId);
    if(await tx.leaseMovement.findFirst({where:{companyId,paymentId:entryId,reversal:null},select:{id:true}}))throw new AccessError(409,"REFUND_CORRECTION_REQUIRED","Correct the linked refunds before voiding this payment receipt.");
   }
   if(previous.voidedAt){if(previous.voidReason!==reason)throw conflict();return previous;}
   if(previous.version!==expectedVersion)throw conflict();
   const result=await tx.ledgerEntry.updateMany({where:{id:entryId,companyId,version:expectedVersion,voidedAt:null},data:{voidedAt:new Date(),voidReason:reason,version:{increment:1}}});
   if(result.count!==1)throw conflict();
   await audit(tx,request,companyId,entryId,"finance.voided");
   if(previous.leaseId) await allocateRentCredit(tx,request,companyId,previous.leaseId);
   return tx.ledgerEntry.findFirstOrThrow({where:{id:entryId,companyId},select});
  });
 });
}
