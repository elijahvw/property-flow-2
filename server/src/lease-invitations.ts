import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { Invitation, PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { audit, boundedText, choice, date, input, mutation, scoped, type Tx } from "./operational.js";
import { householdLease, sharedLeaseAccess } from "./lease-participants.js";
import { companyDay } from "./reports.js";
import { digest } from "./sessions.js";

const invitationSelect={id:true,email:true,participantName:true,participantRole:true,participantStartsOn:true,approvedAt:true,acceptedAt:true,revokedAt:true,expiresAt:true,createdBy:true} as const;
async function invitationTerm(tx:Tx,companyId:string,record:{status:string;startsOn:Date;endsOn:Date|null},startsOn?:Date){
  const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}}),today=new Date(companyDay(company.timezone)+"T00:00:00Z");
  if(record.status==="ended"||(record.endsOn&&record.endsOn<today))throw new AccessError(409,"INVITATION_TERM_ENDED","This lease term has ended. Record historical residents without granting new portal access, or use the renewal workspace.");
  if(startsOn&&(startsOn<record.startsOn||(record.endsOn&&startsOn>record.endsOn)))throw new AccessError(400,"INVALID_INPUT","The invited resident must start within this lease term.");
}
async function residentLease(tx:Tx,companyId:string,userId:string,id:string){
  const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}}),today=new Date(companyDay(company.timezone)+"T00:00:00Z");
  const record=await tx.lease.findFirst({where:{id,companyId,status:{in:["draft","active"]},AND:[{OR:[{endsOn:null},{endsOn:{gte:today}}]},sharedLeaseAccess(companyId,userId,today,true)]},select:{id:true,propertyId:true,residentId:true,status:true,version:true,startsOn:true,endsOn:true}});
  if(!record)throw new AccessError(404,"NOT_FOUND","An upcoming or current lease with approved leaseholder access is required.");
  return record;
}
export function registerLeaseInvitations(server:FastifyInstance,db:PrismaClient,authenticate:preValidationHookHandler,origin:string){
  const auth={preValidation:authenticate};
  server.get("/api/resident/leases",auth,request=>{
    if(Object.keys(request.query as object).length)throw new AccessError(400,"INVALID_INPUT","Unknown resident lease filter.");
    return scoped(db,request,"resident.self",async(tx,companyId)=>{
      const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}}),today=new Date(companyDay(company.timezone)+"T00:00:00Z");
      const items=await tx.lease.findMany({where:{companyId,status:{in:["draft","active"]},AND:[{OR:[{endsOn:null},{endsOn:{gte:today}}]},sharedLeaseAccess(companyId,request.principal!.id,today,true)]},select:{id:true,startsOn:true,endsOn:true,property:{select:{name:true}},unit:{select:{label:true}}},orderBy:{id:"desc"},take:101});
      if(items.length>100)throw new AccessError(422,"LEASE_SCOPE_TOO_LARGE","Too many active leases to show a complete invitation workspace.");
      return items;
    });
  });
  for(const resident of [false,true]){
    const root=resident?"/api/resident/leases/:leaseId/invitations":"/api/company/leases/:leaseId/invitations";
    server.get<{Params:{leaseId:string}}>(root,auth,request=>{
      const id=assignmentId(request.params.leaseId);
      if(Object.keys(request.query as object).length)throw new AccessError(400,"INVALID_INPUT","Unknown invitation filter.");
      return scoped(db,request,resident?"resident.self":"lease.manage",async(tx,companyId)=>{
        if(resident)await residentLease(tx,companyId,request.principal!.id,id);else await householdLease(tx,companyId,id);
        const actor=await tx.companyMembership.findFirstOrThrow({where:{companyId,userId:request.principal!.id}});
        const items=await tx.invitation.findMany({where:{companyId,leaseId:id,...(actor.role!=="owner"?{createdBy:request.principal!.id}:{})},select:invitationSelect,orderBy:{createdAt:"desc"},take:201});
        if(items.length>200)throw new AccessError(422,"INVITATION_SCOPE_TOO_LARGE","Too many invitations to show a complete history.");
        return items;
      });
    });
    server.post<{Params:{leaseId:string}}>(root,auth,request=>{
      mutation(request,origin);
      const id=assignmentId(request.params.leaseId),b=input(request,["email","name","role","startsOn"]),email=boundedText(b.email,254,"Recipient email").toLowerCase(),name=boundedText(b.name,200,"Recipient name"),role=choice(b.role,["occupant","leaseholder"],"household role"),startsOn=date(b.startsOn,"resident start date"),token=randomBytes(32).toString("base64url");
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new AccessError(400,"INVALID_INPUT","Enter a complete recipient email.");
      return scoped(db,request,resident?"resident.self":"lease.manage",async(tx,companyId)=>{
        const record=resident?await residentLease(tx,companyId,request.principal!.id,id):await householdLease(tx,companyId,id,true);
        await invitationTerm(tx,companyId,record,startsOn);
        if(resident&&email===request.principal!.email.toLowerCase())throw new AccessError(409,"HOUSEHOLD_DUPLICATE","You are already on this lease.");
        const existing=await tx.invitation.findFirst({where:{companyId,leaseId:id,email,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true}});
        if(existing)throw new AccessError(409,"INVITATION_EXISTS","An invitation is already pending for this email. Review or revoke it before creating another.");
        if(await tx.invitation.count({where:{companyId,leaseId:id}})>=200)throw new AccessError(422,"INVITATION_SCOPE_TOO_LARGE","This lease already has 200 invitation records.");
        const actor=await tx.companyMembership.findFirstOrThrow({where:{companyId,userId:request.principal!.id}});
        const approved=actor.role==="owner";
        const row=await tx.invitation.create({data:{companyId,leaseId:id,propertyId:record.propertyId,email,role:"resident",participantName:name,participantRole:role,participantStartsOn:startsOn,tokenHash:digest(token),createdBy:request.principal!.id,expiresAt:new Date(Date.now()+72*3600000),approvedAt:approved?new Date():null,approvedBy:approved?request.principal!.id:null},select:invitationSelect});
        await audit(tx,request,companyId,id,"lease.invitation.created",{invitationId:row.id,role,approvalRequired:!approved});
        return {...row,acceptanceUrl:approved?`${origin}/invite?lease=1#${token}`:null};
      });
    });
    server.post<{Params:{leaseId:string;invitationId:string}}>(root+"/:invitationId/revoke",auth,request=>{
      mutation(request,origin);input(request,[]);
      const id=assignmentId(request.params.leaseId),invitationId=assignmentId(request.params.invitationId);
      return scoped(db,request,resident?"resident.self":"lease.manage",async(tx,companyId)=>{
        if(resident)await residentLease(tx,companyId,request.principal!.id,id);else await householdLease(tx,companyId,id,true);
        const actor=await tx.companyMembership.findFirstOrThrow({where:{companyId,userId:request.principal!.id}});
        const row=await tx.invitation.findFirst({where:{id:invitationId,companyId,leaseId:id,acceptedAt:null,revokedAt:null,...(actor.role!=="owner"?{createdBy:request.principal!.id,approvedAt:null}:{})},select:{id:true}});
        if(!row)throw new AccessError(404,"NOT_FOUND","Pending invitation not found.");
        await tx.invitation.update({where:{id:row.id},data:{revokedAt:new Date()}});
        await audit(tx,request,companyId,id,"lease.invitation.revoked",{invitationId});return {success:true};
      });
    });
  }
  server.post<{Params:{leaseId:string;invitationId:string}}>("/api/company/leases/:leaseId/invitations/:invitationId/approve",auth,request=>{
    mutation(request,origin);input(request,[]);
    const id=assignmentId(request.params.leaseId),invitationId=assignmentId(request.params.invitationId),token=randomBytes(32).toString("base64url");
    return scoped(db,request,"members.manage",async(tx,companyId)=>{
      const record=await householdLease(tx,companyId,id,true);await invitationTerm(tx,companyId,record);
      const row=await tx.invitation.findFirst({where:{id:invitationId,companyId,leaseId:id,acceptedAt:null,revokedAt:null,approvedAt:null,participantRole:{in:["leaseholder","occupant"]},expiresAt:{gt:new Date()}},select:{id:true}});
      if(!row)throw new AccessError(404,"NOT_FOUND","Resident approval request not found. Refresh the invitation status; revoke and recreate it if its one-time link was lost.");
      await tx.invitation.update({where:{id:row.id},data:{approvedAt:new Date(),approvedBy:request.principal!.id,tokenHash:digest(token),expiresAt:new Date(Date.now()+72*3600000)}});
      await audit(tx,request,companyId,id,"lease.invitation.approved",{invitationId});return {acceptanceUrl:`${origin}/invite?lease=1#${token}`};
    });
  });
}

// Called only by the verified-email invitation acceptance transaction. No token
// or guessed email alone authorizes membership, property access or lease access.
export async function acceptLeaseInvitation(tx:Tx,request:FastifyRequest,invitation:Invitation){
  const user=request.principal!;
  if(!invitation.leaseId||!invitation.propertyId||!invitation.participantStartsOn||!invitation.participantName||!invitation.participantRole||!invitation.approvedAt||!invitation.approvedBy)
    throw new AccessError(403,"INVITATION_INVALID","This lease invitation is not approved.");
  await tx.$queryRaw`SELECT set_config('app.company_id', ${invitation.companyId}, true)`;
  await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${user.id} RETURNING id`;
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${invitation.companyId} FOR SHARE`;
  const record=await householdLease(tx,invitation.companyId,invitation.leaseId,true);
  await invitationTerm(tx,invitation.companyId,record,invitation.participantStartsOn);
  // A departed/revoked inviter cannot leave usable access grants behind. An
  // owner's explicit leaseholder approval is an independent current authority.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${invitation.approvedBy} FOR SHARE`;
  const author=await tx.user.findUnique({where:{id:invitation.approvedBy},include:{membership:true}});
  if(!author||author.status!=="active"||!author.emailVerified||author.membership?.companyId!==invitation.companyId||author.membership.status!=="active"||author.membership.role!=="owner")throw new AccessError(403,"INVITATION_INVALID","The approving owner no longer has access.");
  if(record.residentId===user.id||await tx.leaseParticipant.findFirst({where:{companyId:invitation.companyId,leaseId:record.id,userId:user.id},select:{id:true}}))throw new AccessError(409,"HOUSEHOLD_DUPLICATE","This account is already recorded on the lease.");
  const membership=await tx.companyMembership.findUnique({where:{userId:user.id}});
  if(membership&&(membership.companyId!==invitation.companyId||membership.role!=="resident"||membership.status!=="active"))throw new AccessError(409,"ALREADY_ASSIGNED","Your existing company assignment cannot be changed by an invitation.");
  if(!membership)await tx.companyMembership.create({data:{userId:user.id,companyId:invitation.companyId,role:"resident"}});
  await tx.residentPropertyAssignment.upsert({where:{propertyId_userId:{userId:user.id,propertyId:invitation.propertyId}},create:{userId:user.id,propertyId:invitation.propertyId,companyId:invitation.companyId},update:{}});
  const participant=await tx.leaseParticipant.create({data:{companyId:invitation.companyId,propertyId:invitation.propertyId,leaseId:record.id,userId:user.id,name:invitation.participantName,email:invitation.email,role:invitation.participantRole,startsOn:invitation.participantStartsOn,createdById:invitation.createdBy,submissionKey:invitation.id,submissionHash:digest(invitation.id)}});
  await tx.lease.update({where:{id:record.id},data:{version:{increment:1}}});
  await audit(tx,request,invitation.companyId,record.id,"lease.invitation.accepted",{invitationId:invitation.id,participantId:participant.id,role:participant.role});
}

export async function replayLeaseAcceptance(tx:Tx,request:FastifyRequest,invitation:Invitation){
  await tx.$queryRaw`SELECT set_config('app.company_id', ${invitation.companyId}, true)`;
  const membership=await tx.companyMembership.findUnique({where:{userId:request.principal!.id}});
  const participant=await tx.leaseParticipant.findFirst({where:{companyId:invitation.companyId,leaseId:invitation.leaseId!,userId:request.principal!.id,removedAt:null},select:{id:true}});
  if(!membership||membership.companyId!==invitation.companyId||membership.role!=="resident"||membership.status!=="active"||!participant)
    throw new AccessError(403,"INVITATION_INVALID","This invitation is unavailable for your account.");
  // Acknowledgement only: never recreate membership, assignments or a removed
  // roster entry after an accepted response was lost.
  return {success:true};
}

export async function previewLeaseInvitation(tx:Tx,invitation:Invitation){
  if(!invitation.leaseId||!invitation.approvedAt||!invitation.approvedBy)throw new AccessError(403,"INVITATION_INVALID","This resident invitation is not approved.");
  await tx.$queryRaw`SELECT set_config('app.company_id', ${invitation.companyId}, true)`;
  const record=await householdLease(tx,invitation.companyId,invitation.leaseId);
  await invitationTerm(tx,invitation.companyId,record,invitation.participantStartsOn!);
  const owner=await tx.user.findUnique({where:{id:invitation.approvedBy},include:{membership:true}});
  if(!owner||owner.status!=="active"||!owner.emailVerified||owner.membership?.companyId!==invitation.companyId||owner.membership.status!=="active"||owner.membership.role!=="owner")throw new AccessError(403,"INVITATION_INVALID","The approving owner no longer has access.");
  const company=await tx.company.findUniqueOrThrow({where:{id:invitation.companyId},select:{name:true}});
  return {company:company.name,property:record.property.name,unit:record.unit.label,name:invitation.participantName,role:invitation.participantRole,startsOn:invitation.participantStartsOn,leaseStartsOn:record.startsOn,leaseEndsOn:record.endsOn,leaseStatus:record.status};
}
