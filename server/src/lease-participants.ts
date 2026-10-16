import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId, opaqueUserId } from "./application.js";
import { audit, boundedText, choice, conflict, date, input, mutation, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";
import { companyDay } from "./reports.js";

const select = { id:true, userId:true, name:true, email:true, phone:true, role:true, startsOn:true, endsOn:true, removedAt:true, version:true } as const;
const fields = ["name","email","phone","role","startsOn","endsOn"];
const optional = (v:unknown,max:number,label:string) => v===null||v===undefined||v==="" ? null : boundedText(v,max,label);
function details(b:Record<string,unknown>) {
  const name=boundedText(b.name,200,"Resident name"), email=optional(b.email,254,"Contact email"),phone=optional(b.phone,40,"Contact phone");
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AccessError(400,"INVALID_INPUT","Enter a complete contact email.");
  const role=choice(b.role,["leaseholder","occupant"],"resident role"),startsOn=date(b.startsOn,"resident start date"),endsOn=b.endsOn===null?null:date(b.endsOn,"resident end date");
  if(endsOn&&endsOn<startsOn)throw new AccessError(400,"INVALID_INPUT","Resident end date cannot precede their start date.");
  return {name,email,phone,role,startsOn,endsOn};
}
export async function householdLease(tx:Tx,companyId:string,id:string,lock=false){
  if(lock)await tx.$queryRaw`UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=${id} AND "companyId"=${companyId} RETURNING id`;
  const row=await tx.lease.findFirst({where:{id,companyId},select:{id:true,propertyId:true,residentId:true,status:true,version:true,startsOn:true,endsOn:true,resident:{select:{name:true,email:true}},unit:{select:{label:true}},property:{select:{name:true}}}});
  if(!row)throw new AccessError(404,"NOT_FOUND","Lease not found.");
  return row;
}
async function linked(tx:Tx,companyId:string,propertyId:string,userId:string,requireEligible:boolean){
  await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${userId} RETURNING id`;
  const member=await tx.companyMembership.findFirst({where:{companyId,userId,role:"resident"},include:{user:true,assignments:{where:{propertyId}}}});
  if(requireEligible&&(!member||member.status!=="active"||member.user.status!=="active"||!member.assignments.length))
    throw new AccessError(409,"RESIDENT_INELIGIBLE","Choose a current resident assigned to this property. An unlinked record can be kept without portal access.");
}
// Existing primary access stays compatible. Additional leaseholders must be
// linked to the current user and still assigned to the property. Upcoming
// leaseholders need approved portal access before move-in to review deposits.
// scoped() independently fences current company, membership and verification.
export function sharedLeaseAccess(companyId:string,userId:string,today:Date,includeDraft=false):Prisma.LeaseWhereInput {
  return { OR:[{residentId:userId,participants:{none:{userId,OR:[{removedAt:{not:null}},{endsOn:{lt:today}},{role:{not:"leaseholder"}}]}}},{...(!includeDraft?{status:{not:"draft"}}:{}),participants:{some:{companyId,userId,role:"leaseholder",removedAt:null,OR:[{endsOn:null},{endsOn:{gte:today}}]}}}],
    property:{assignments:{some:{companyId,userId}}} };
}
export function registerLeaseParticipants(server:FastifyInstance,db:PrismaClient,authenticate:preValidationHookHandler,origin:string){
  const auth={preValidation:authenticate};
  server.get<{Params:{leaseId:string}}>("/api/company/leases/:leaseId/participants",auth,request=>{
    const id=assignmentId(request.params.leaseId);
    if(Object.keys(request.query as object).length)throw new AccessError(400,"INVALID_INPUT","Unknown household filter.");
    return scoped(db,request,"lease.manage",async(tx,companyId)=>{
      const record=await householdLease(tx,companyId,id);
      const items=await tx.leaseParticipant.findMany({where:{companyId,leaseId:id},select,orderBy:[{startsOn:"asc"},{id:"asc"}],take:201});
      const candidates=await tx.companyMembership.findMany({where:{companyId,role:"resident",status:"active",user:{status:"active"},assignments:{some:{propertyId:record.propertyId}}},select:{userId:true,contactName:true,user:{select:{name:true,email:true,emailVerified:true}}},orderBy:{userId:"asc"},take:1001});
      if(items.length>200||candidates.length>1000)throw new AccessError(422,"HOUSEHOLD_SCOPE_TOO_LARGE","Too many household records or eligible residents to show a complete selection.");
      const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}});
      return {lease:record,items,candidates,businessDate:companyDay(company.timezone)};
    });
  });
  server.post<{Params:{leaseId:string}}>("/api/company/leases/:leaseId/participants",auth,request=>{
    mutation(request,origin);
    const id=assignmentId(request.params.leaseId),b=input(request,[...fields,"userId","submissionKey"]),data=details(b),userId=b.userId===null||b.userId===undefined?null:opaqueUserId(b.userId);
    const key=submission(b.submissionKey,[id,userId,data]);
    return scoped(db,request,"members.manage",async(tx,companyId)=>{
      const record=await householdLease(tx,companyId,id,true);
      const old=await tx.leaseParticipant.findFirst({where:{companyId,createdById:request.principal!.id,submissionKey:key.submissionKey},select:{...select,submissionHash:true}});
      if(old){sameSubmission(old.submissionHash,key.submissionHash);const {submissionHash:_hash,...row}=old;return row;}
      if(userId===record.residentId)throw new AccessError(409,"HOUSEHOLD_DUPLICATE","This resident is already the lease's primary contact.");
      if(userId){await linked(tx,companyId,record.propertyId,userId,true);if(await tx.leaseParticipant.findFirst({where:{companyId,leaseId:id,userId},select:{id:true}}))throw new AccessError(409,"HOUSEHOLD_DUPLICATE","This resident is already recorded. Edit their existing household record.");}
      if(await tx.leaseParticipant.count({where:{companyId,leaseId:id}})>=200)throw new AccessError(422,"HOUSEHOLD_SCOPE_TOO_LARGE","This lease already has 200 household records. No record was added.");
      const row=await tx.leaseParticipant.create({data:{companyId,propertyId:record.propertyId,leaseId:id,userId,...data,createdById:request.principal!.id,...key},select});
      await tx.lease.update({where:{id},data:{version:{increment:1}}});
      await audit(tx,request,companyId,id,"lease.participant.added",{participantId:row.id,role:row.role,userId,startsOn:row.startsOn.toISOString(),endsOn:row.endsOn?.toISOString()??null});
      return row;
    });
  });
  server.patch<{Params:{leaseId:string;participantId:string}}>("/api/company/leases/:leaseId/participants/:participantId",auth,request=>{
    mutation(request,origin);
    const id=assignmentId(request.params.leaseId),participantId=assignmentId(request.params.participantId),b=input(request,[...fields,"expectedVersion"]),data=details(b),expectedVersion=version(b.expectedVersion);
    return scoped(db,request,"members.manage",async(tx,companyId)=>{
      const record=await householdLease(tx,companyId,id,true),old=await tx.leaseParticipant.findFirst({where:{id:participantId,companyId,leaseId:id},select});
      if(!old)throw new AccessError(404,"NOT_FOUND","Household resident not found.");
      if(old.version!==expectedVersion)throw conflict();
      if(old.removedAt)throw new AccessError(409,"RESIDENT_REMOVED","This resident was removed. Their historical record is retained.");
      if(old.userId===record.residentId&&data.role!=="leaseholder")throw new AccessError(409,"PRIMARY_CONTACT_REQUIRED","Choose another primary leaseholder before changing the current primary's role.");
      // Lock the linked user even when removing access, ordering portal reads and
      // assignment/membership changes against the roster mutation.
      if(old.userId)await linked(tx,companyId,record.propertyId,old.userId,false);
      const row=await tx.leaseParticipant.update({where:{id:participantId},data:{...data,version:{increment:1}},select});
      await tx.lease.update({where:{id},data:{version:{increment:1}}});
      await audit(tx,request,companyId,id,"lease.participant.updated",{participantId,from:{role:old.role,startsOn:old.startsOn.toISOString(),endsOn:old.endsOn?.toISOString()??null},to:{role:row.role,startsOn:row.startsOn.toISOString(),endsOn:row.endsOn?.toISOString()??null}});
      return row;
    });
  });
  server.post<{Params:{leaseId:string;participantId:string}}>("/api/company/leases/:leaseId/participants/:participantId/remove",auth,request=>{
    mutation(request,origin);const id=assignmentId(request.params.leaseId),participantId=assignmentId(request.params.participantId),b=input(request,["expectedVersion"]),expectedVersion=version(b.expectedVersion);
    return scoped(db,request,"members.manage",async(tx,companyId)=>{
      const record=await householdLease(tx,companyId,id,true);
      const old=await tx.leaseParticipant.findFirst({where:{id:participantId,companyId,leaseId:id},select});
      if(!old)throw new AccessError(404,"NOT_FOUND","Household resident not found.");
      if(old.removedAt){if(old.version===expectedVersion+1)return old;throw conflict();}
      if(old.version!==expectedVersion)throw conflict();
      if(old.userId)await linked(tx,companyId,record.propertyId,old.userId,false);
      const row=await tx.leaseParticipant.update({where:{id:participantId},data:{removedAt:new Date(),version:{increment:1}},select});
      await tx.lease.update({where:{id},data:{version:{increment:1}}});
      await audit(tx,request,companyId,id,"lease.participant.removed",{participantId,userId:old.userId,role:old.role});return row;
    });
  });
  server.post<{Params:{leaseId:string}}>("/api/company/leases/:leaseId/primary-resident",auth,request=>{
    mutation(request,origin);const id=assignmentId(request.params.leaseId),b=input(request,["participantId","expectedVersion"]),participantId=assignmentId(b.participantId),expectedVersion=version(b.expectedVersion);
    return scoped(db,request,"members.manage",async(tx,companyId)=>{
      const record=await householdLease(tx,companyId,id,true);
      if(record.version!==expectedVersion)throw conflict();
      const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}}),today=new Date(companyDay(company.timezone)+"T00:00:00Z");
      const target=await tx.leaseParticipant.findFirst({where:{id:participantId,companyId,leaseId:id,userId:{not:null},role:"leaseholder",removedAt:null,OR:[{endsOn:null},{endsOn:{gte:today}}]},select});
      if(!target?.userId)throw new AccessError(409,"PRIMARY_CONTACT_REQUIRED","Choose a current linked leaseholder as the primary contact.");
      await linked(tx,companyId,record.propertyId,target.userId,true);
      if(record.residentId===target.userId)return {success:true};
      await tx.lease.update({where:{id},data:{residentId:target.userId,version:{increment:1}}});
      await audit(tx,request,companyId,id,"lease.primary.changed",{from:record.residentId,to:target.userId,participantId});return {success:true};
    });
  });
}
