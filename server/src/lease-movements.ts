import type {FastifyInstance,preValidationHookHandler} from "fastify";
import type {PrismaClient,Prisma} from "@prisma/client";
import {AccessError} from "./access.js";
import {assignmentId} from "./application.js";
import {audit,boundedText,cents,choice,conflict,date,input,mutation,sameSubmission,scoped,submission,version,type Tx,type AuditRequest} from "./operational.js";
import {allocateRentCredit,lockRentLease,readRentSources,rentBalances} from "./rent.js";
import {readDepositDetail} from "./deposits.js";
import {companyDay} from "./reports.js";
import {readLeaseMovements,movementSelect} from "./movement-sources.js";
async function businessDate(tx:Tx, companyId:string,effectiveOn?:Date) {
 const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}}),today=companyDay(company.timezone);
 if(effectiveOn && effectiveOn.toISOString().slice(0,10)>today)throw new AccessError(400,"FUTURE_MOVEMENT","Record a date on or before today for money already returned or a deposit application.");
 return today;
}
export async function createLeaseMovement(tx:Tx,request:AuditRequest,data:Prisma.LeaseMovementUncheckedCreateInput,availableBefore:bigint) {
 const row=await tx.leaseMovement.create({data,select:movementSelect});
 if(data.kind!=="deposit_application")await tx.ledgerEntry.create({data:{companyId:data.companyId,propertyId:data.propertyId,movementId:row.id,createdById:data.createdById,occurredOn:data.effectiveOn,amountCents:data.amountCents,kind:"refund",category:data.kind==="deposit_refund"?"security_deposit":"rent",memo:`Manual refund · ${row.reference}`,submissionKey:data.submissionKey,submissionHash:data.submissionHash}});
 await audit(tx,request,data.companyId,row.id,`lease.${data.kind}.recorded`,{leaseId:data.leaseId,accountId:data.accountId??null,chargeId:data.chargeId??null,paymentId:data.paymentId??null,amountCents:data.amountCents,availableBeforeCents:String(availableBefore),confirmed:true});
 return tx.leaseMovement.findUniqueOrThrow({where:{id:row.id},select:movementSelect});
}
export function registerLeaseMovements(server:FastifyInstance,db:PrismaClient,authenticate:preValidationHookHandler,origin:string) {
 const auth={preValidation:authenticate};
 for(const resident of [false,true])server.get<{Params:{leaseId:string}}>(`/api/${resident?"resident":"company"}/lease-movements/:leaseId`,auth,request=>{
  const leaseId=assignmentId(request.params.leaseId);
  return scoped(db,request,resident?"resident.self":"finance.manage",async(tx,companyId)=>{
   const deposit=await readDepositDetail(tx,companyId,leaseId,resident?request.principal!.id:undefined),today=deposit.businessDate;
   const sources=await readRentSources(tx,companyId,[leaseId]),balance=rentBalances(sources,today);
   const privateReferences=resident?[]:await tx.leaseMovement.findMany({where:{companyId,leaseId},select:{id:true,paymentReference:true},take:10001});
   const refs=new Map(privateReferences.map(m=>[m.id,m.paymentReference]));
   return {businessDate:today,lease:deposit.lease,deposit:deposit.account?{id:deposit.account.id,version:deposit.account.version,...deposit.account.summary}:null,
    payments:sources.payments.filter(p=>!p.voidedAt).map(p=>({id:p.id,reference:p.reference,version:p.version,occurredOn:p.occurredOn,amountCents:p.amountCents,availableCents:String(BigInt(p.amountCents)-(balance.paymentApplied.get(p.id)??0n)-(balance.refundedByPayment.get(p.id)??0n))})),
    charges:sources.charges.filter(c=>!c.voidedAt).map(c=>({id:c.id,reference:c.reference,version:c.version,kind:c.kind,description:c.kind==="one_time"?c.memo:null,dueOn:c.dueOn,periodOn:c.periodOn,remainingCents:String(BigInt(c.amountCents)-(balance.chargeApplied.get(c.id)??0n))})),
    movements:sources.movements.map(m=>({...m,...(resident?{}:{paymentReference:refs.get(m.id)??null})}))};
  });
 });
 server.post<{Params:{leaseId:string}}>("/api/company/lease-movements/:leaseId",auth,request=>{
  mutation(request,origin);const leaseId=assignmentId(request.params.leaseId);
  const b=input(request,["kind","effectiveOn","amount","reason","payee","method","paymentReference","chargeId","paymentId","expectedLeaseVersion","expectedAccountVersion","expectedSourceVersion","expectedAvailableCents","expectedRemainingCents","confirmed","submissionKey"]);
  const kind=choice(b.kind,["deposit_application","deposit_refund","rent_refund"],"money movement"),effectiveOn=date(b.effectiveOn,"movement date"),amountCents=cents(b.amount),reason=boundedText(b.reason,500,"Tenant-visible reason"),expectedLease=version(b.expectedLeaseVersion);
  if(!amountCents)throw new AccessError(400,"INVALID_INPUT","Enter an amount greater than zero.");
  if(b.confirmed!==true)throw new AccessError(400,"REVIEW_REQUIRED",kind==="deposit_application"?"Confirm that this deposit application is authorized under the lease/agreement.":"Confirm that the money has already been returned outside Property Flow.");
  const chargeId=kind==="deposit_application"?assignmentId(b.chargeId):null,paymentId=kind==="rent_refund"?assignmentId(b.paymentId):null;
  const payee=kind==="deposit_application"?null:boundedText(b.payee,200,"Person paid"),method=kind==="deposit_application"?null:choice(b.method,["bank_transfer","cash","check","other"],"return method"),paymentReference=kind==="deposit_application"?null:b.paymentReference?boundedText(b.paymentReference,100,"Payment reference"):null;
  if(method==="check" && !paymentReference)throw new AccessError(400,"INVALID_INPUT","Add the check number or reference.");
  if(typeof b.expectedAvailableCents!=="string" || !/^\d{1,20}$/.test(b.expectedAvailableCents))throw new AccessError(400,"INVALID_INPUT","Review the available funds again.");
  const expectedSource=kind==="deposit_refund"?null:version(b.expectedSourceVersion),expectedAccount=kind==="rent_refund"?null:version(b.expectedAccountVersion);
  if(kind==="deposit_application" && (typeof b.expectedRemainingCents!=="string" || !/^\d{1,20}$/.test(b.expectedRemainingCents)))throw new AccessError(400,"INVALID_INPUT","Review the unpaid charge again.");
  const key=submission(b.submissionKey,[kind,leaseId,effectiveOn,amountCents,reason,payee,method,paymentReference,chargeId,paymentId,expectedLease,expectedSource,expectedAccount,b.expectedAvailableCents,b.expectedRemainingCents??null,true]);
  return scoped(db,request,"finance.manage",async(tx,companyId)=>{
   const previous=await tx.leaseMovement.findFirst({where:{companyId,createdById:request.principal!.id,submissionKey:key.submissionKey},select:{...movementSelect,submissionHash:true}});
   if(previous){sameSubmission(previous.submissionHash,key.submissionHash);const{submissionHash:_hash,...row}=previous;return row;}
   const lease=await lockRentLease(tx,companyId,leaseId);if(lease.version!==expectedLease)throw conflict();
   if(lease.status==="draft")throw new AccessError(409,"DRAFT_LEASE","Activate the lease record before recording money movements.");
   const today=await businessDate(tx,companyId,effectiveOn),sources=await readRentSources(tx,companyId,[leaseId]),balance=rentBalances(sources,today);
   let available:bigint,accountId:string|null=null;
   if(kind==="rent_refund") {
    const payment=sources.payments.find(p=>p.id===paymentId && !p.voidedAt);if(!payment)throw new AccessError(404,"NOT_FOUND","Lease payment not found.");
    if(payment.version!==expectedSource)throw conflict();
    if(effectiveOn<payment.occurredOn)throw new AccessError(400,"INVALID_INPUT","A refund cannot precede its receipt.");
    available=BigInt(payment.amountCents)-(balance.paymentApplied.get(payment.id)??0n)-(balance.refundedByPayment.get(payment.id)??0n);
   }else{
    const detail=await readDepositDetail(tx,companyId,leaseId);if(!detail.account)throw new AccessError(409,"DEPOSIT_REQUIRED","Set up and record a deposit receipt first.");
    if(detail.account.version!==expectedAccount)throw conflict();accountId=detail.account.id;available=BigInt(detail.account.summary.heldCents);
    // A backdated action cannot spend deposits before they existed. Use current
    // correction status, with source dates through the reviewed effective date.
    const received=detail.account.receipts.filter(r=>!r.cashEntry.voidedAt && r.occurredOn<=effectiveOn).reduce((s,r)=>s+BigInt(r.amountCents),0n);
    const used=sources.movements.filter(m=>m.accountId===accountId && !m.reversal).reduce((s,m)=>s+BigInt(m.amountCents),0n);
    if(received-used<BigInt(amountCents))throw new AccessError(409,"DEPOSIT_DATE_FUNDS","This date does not have enough recorded deposit funds. Review the receipt dates.");
   }
   if(available!==BigInt(b.expectedAvailableCents as string) || BigInt(amountCents)>available)throw new AccessError(409,"FUNDS_CHANGED","Available funds changed or are too low. Refresh and review before saving.");
   if(chargeId){const charge=sources.charges.find(c=>c.id===chargeId && !c.voidedAt);if(!charge)throw new AccessError(404,"NOT_FOUND","Unpaid charge not found on this lease.");const remaining=BigInt(charge.amountCents)-(balance.chargeApplied.get(charge.id)??0n);if(charge.version!==expectedSource || String(remaining)!==b.expectedRemainingCents || BigInt(amountCents)>remaining)throw new AccessError(409,"CHARGE_CHANGED","The unpaid charge changed or the amount is too high. Refresh and review again.");}
   return createLeaseMovement(tx,request,{companyId,propertyId:lease.propertyId,leaseId,accountId,chargeId,paymentId,kind,effectiveOn,amountCents,reason,payee,method,paymentReference,createdById:request.principal!.id,...key},available);
  });
 });
 server.post<{Params:{leaseId:string;movementId:string}}>("/api/company/lease-movements/:leaseId/:movementId/reverse",auth,request=>{
  mutation(request,origin);const leaseId=assignmentId(request.params.leaseId),id=assignmentId(request.params.movementId),b=input(request,["effectiveOn","reason","expectedLeaseVersion","confirmed","submissionKey"]),effectiveOn=date(b.effectiveOn,"correction date"),reason=boundedText(b.reason,500,"Correction reason"),expected=version(b.expectedLeaseVersion);
  if(b.confirmed!==true)throw new AccessError(400,"REVIEW_REQUIRED","Confirm this is correcting a record, not recording new money received.");
  const key=submission(b.submissionKey,[id,leaseId,effectiveOn,reason,expected,true]);
  return scoped(db,request,"finance.manage",async(tx,companyId)=>{
   const previous=await tx.leaseMovementReversal.findFirst({where:{companyId,createdById:request.principal!.id,submissionKey:key.submissionKey}});if(previous){sameSubmission(previous.submissionHash,key.submissionHash);return{id:previous.id,reference:previous.reference};}
   const lease=await lockRentLease(tx,companyId,leaseId);if(lease.version!==expected)throw conflict();await businessDate(tx,companyId,effectiveOn);
   const movement=await tx.leaseMovement.findFirst({where:{id,companyId,leaseId},select:movementSelect});if(!movement)throw new AccessError(404,"NOT_FOUND","Money movement not found.");if(movement.reversal)throw new AccessError(409,"ALREADY_CORRECTED","This record has already been reversed or corrected. Refresh its history.");if(effectiveOn<movement.effectiveOn)throw new AccessError(400,"INVALID_INPUT","Correction cannot precede the original movement.");
   const row=await tx.leaseMovementReversal.create({data:{companyId,propertyId:lease.propertyId,leaseId,movementId:id,effectiveOn,reason,createdById:request.principal!.id,...key}});
   if(movement.kind!=="deposit_application")await tx.ledgerEntry.update({where:{movementId:id},data:{voidedAt:new Date(),voidReason:reason.slice(0,300),version:{increment:1}}});
   await allocateRentCredit(tx,request,companyId,leaseId);
   await audit(tx,request,companyId,row.id,"lease.movement.reversed",{leaseId,movementId:id,kind:movement.kind,amountCents:movement.amountCents});
   return{id:row.id,reference:row.reference};
  });
 });
}
