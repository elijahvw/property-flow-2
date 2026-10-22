import { randomUUID } from 'node:crypto';
import type { FastifyInstance, preValidationHookHandler } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AccessError } from './access.js';
import { assignmentId } from './application.js';
import { audit, conflict, input, mutation, sameSubmission, scoped, submission, version, type Tx } from './operational.js';
import { companyDay } from './reports.js';

const missing = () => new AccessError(404,'NOT_FOUND','Shared document is unavailable.');
const person = { id:true, name:true, emailVerified:true, status:true, membership:{select:{companyId:true,role:true,status:true,assignments:{select:{propertyId:true}}}} } as const;
const residentSelect = { id:true, version:true, leaseId:true, sharedAt:true, receivedAt:true, documentVersionId:true, document:{select:{title:true}}, documentVersion:{select:{number:true,filename:true,byteLength:true}}, lease:{select:{property:{select:{name:true}},unit:{select:{label:true}}}} } as const;
function page(query:Record<string,unknown>,search=false) {
  if(Object.keys(query).some(k=>!['page',...(search?['q']:[])].includes(k)))throw new AccessError(400,'INVALID_INPUT','Unknown document filter.');
  const value=query.page??'1', q=query.q??'';
  if(typeof value!=='string'||! /^[1-9][0-9]{0,4}$/.test(value)||typeof q!=='string'||q.length>160)throw new AccessError(400,'INVALID_INPUT','Choose a valid document page or search.');
  return {page:Number(value),q:q.trim(),skip:(Number(value)-1)*25};
}
async function today(tx:Tx,companyId:string) {
  const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}});
  return new Date(`${companyDay(company.timezone)}T00:00:00.000Z`);
}
async function managementDocument(tx:Tx,companyId:string,leaseId:string,documentId:string,lock=false) {
  if(lock)await tx.$queryRaw`SELECT id FROM "PrivateDocument" WHERE id=${documentId} AND "companyId"=${companyId} FOR UPDATE`;
  const doc=await tx.privateDocument.findFirst({where:{id:documentId,companyId,leaseId},select:{id:true,version:true,archivedAt:true,lease:{select:{id:true,propertyId:true,status:true}}}});
  if(!doc?.lease)throw missing();
  return doc;
}
async function participants(tx:Tx,companyId:string,leaseId:string,propertyId:string) {
  const on=await today(tx,companyId);
  const rows=await tx.leaseParticipant.findMany({where:{companyId,leaseId,removedAt:null,portalApproved:true,role:{in:['leaseholder','occupant']},OR:[{endsOn:null},{endsOn:{gte:on}}]},select:{id:true,name:true,role:true,user:{select:person},contact:{select:{user:{select:person}}}},orderBy:[{name:'asc'},{id:'asc'}],take:201});
  if(rows.length>200)throw new AccessError(409,'HOUSEHOLD_SCOPE_TOO_LARGE','Review this household before sharing a document.');
  return rows.flatMap(p=>{
    const user=p.user??p.contact?.user,member=user?.membership;
    return user&&user.status==='active'&&user.emailVerified&&member?.companyId===companyId&&member.role==='resident'&&member.status==='active'&&member.assignments.some(a=>a.propertyId===propertyId)?[{id:p.id,name:p.name,role:p.role,userId:user.id}]:[];
  });
}
async function visible(tx:Tx,companyId:string,userId:string):Promise<Prisma.DocumentShareWhereInput> {
  return {companyId,recipientId:userId,revokedAt:null,document:{archivedAt:null},documentVersion:{scanStatus:'clean'},lease:{companyId,status:{not:'draft'},property:{assignments:{some:{companyId,userId}}}},participant:{companyId,removedAt:null,portalApproved:true,role:{in:['leaseholder','occupant']},AND:[{OR:[{userId},{userId:null,contact:{userId}}]},{OR:[{endsOn:null},{endsOn:{gte:await today(tx,companyId)}}]}]}};
}
function dto(row:Prisma.DocumentShareGetPayload<{select:typeof residentSelect}>) {
  return {id:row.id,version:row.version,title:row.document.title,number:row.documentVersion.number,filename:row.documentVersion.filename,byteLength:row.documentVersion.byteLength,property:row.lease.property.name,unit:row.lease.unit.label,sharedAt:row.sharedAt,receivedAt:row.receivedAt};
}
async function residentShare(tx:Tx,companyId:string,userId:string,id:string) {
  const where={...await visible(tx,companyId,userId),id};
  const first=await tx.documentShare.findFirst({where,select:{documentId:true,participantId:true,participant:{select:{userId:true,contactId:true}}}});
  if(!first)throw missing();
  await tx.$queryRaw`SELECT id FROM "LeaseParticipant" WHERE id=${first.participantId} AND "companyId"=${companyId} FOR SHARE`;
  if(!first.participant.userId&&first.participant.contactId)await tx.$queryRaw`SELECT id FROM "ResidentContact" WHERE id=${first.participant.contactId} AND "companyId"=${companyId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "PrivateDocument" WHERE id=${first.documentId} AND "companyId"=${companyId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "DocumentShare" WHERE id=${id} AND "companyId"=${companyId} FOR UPDATE`;
  const row=await tx.documentShare.findFirst({where,select:residentSelect});
  if(!row)throw missing();
  return row;
}
export function registerDocumentSharing(server:FastifyInstance,db:PrismaClient,authenticate:preValidationHookHandler,origin:string) {
  type Params={leaseId:string;documentId:string;shareId:string};
  const base='/api/company/leases/:leaseId/documents/:documentId/shares';
  server.get<{Params:Params;Querystring:Record<string,unknown>}>(base,{preValidation:authenticate},request=>{
    const leaseId=assignmentId(request.params.leaseId),documentId=assignmentId(request.params.documentId),filter=page(request.query);
    return scoped(db,request,'lease.manage',async(tx,companyId)=>{
      const doc=await managementDocument(tx,companyId,leaseId,documentId);
      const where={companyId,leaseId,documentId};
      const [eligible,total,rows,versions]=await Promise.all([participants(tx,companyId,leaseId,doc.lease!.propertyId),tx.documentShare.count({where}),tx.documentShare.findMany({where,orderBy:[{sharedAt:'desc'},{id:'desc'}],skip:filter.skip,take:25,select:{id:true,version:true,sharedAt:true,revokedAt:true,receivedAt:true,participantId:true,recipientId:true,participant:{select:{name:true}},documentVersion:{select:{number:true,filename:true,scanStatus:true}},actions:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:6,select:{action:true,createdAt:true}}}}),tx.documentVersion.findMany({where:{companyId,documentId,scanStatus:'clean'},select:{id:true,number:true,filename:true,scanStatus:true},orderBy:{number:'desc'},take:50})]);
      return {expectedDocumentVersion:doc.version,versions,eligible:doc.archivedAt||doc.lease!.status==='draft'?[]:eligible.map(({userId,...p})=>p),items:rows.map(row=>({id:row.id,version:row.version,recipient:row.participant.name,available:!row.revokedAt&&!doc.archivedAt&&doc.lease!.status!=='draft'&&row.documentVersion.scanStatus==='clean'&&eligible.some(p=>p.id===row.participantId&&p.userId===row.recipientId),number:row.documentVersion.number,filename:row.documentVersion.filename,sharedAt:row.sharedAt,revokedAt:row.revokedAt,receivedAt:row.receivedAt,history:row.actions.slice(0,5),historyLimited:row.actions.length>5})),total,page:filter.page,pageSize:25};
    });
  });
  server.post<{Params:Params}>(base,{preValidation:authenticate},request=>{
    mutation(request,origin);const b=input(request,['documentVersionId','participantId','expectedDocumentVersion','submissionKey']);
    const leaseId=assignmentId(request.params.leaseId),documentId=assignmentId(request.params.documentId),versionId=assignmentId(b.documentVersionId),participantId=assignmentId(b.participantId),expected=version(b.expectedDocumentVersion),key=submission(b.submissionKey,[leaseId,documentId,versionId,participantId,expected]);
    return scoped(db,request,'lease.manage',async(tx,companyId)=>{
      // Pin the intended account before locking the document; fresh eligibility
      // below is checked again after the same recipient fence used by revocation.
      const target=await tx.leaseParticipant.findFirst({where:{id:participantId,companyId,leaseId},select:{userId:true,contactId:true,contact:{select:{userId:true}}}}),userId=target?.userId??target?.contact?.userId;
      if(!userId)throw new AccessError(409,'RECIPIENT_UNAVAILABLE','Choose a currently approved resident with portal access.');
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "LeaseParticipant" WHERE id=${participantId} AND "companyId"=${companyId} FOR SHARE`;
      if(!target?.userId&&target?.contactId)await tx.$queryRaw`SELECT id FROM "ResidentContact" WHERE id=${target.contactId} AND "companyId"=${companyId} FOR SHARE`;
      const doc=await managementDocument(tx,companyId,leaseId,documentId,true),eligible=await participants(tx,companyId,leaseId,doc.lease!.propertyId);
      if(doc.archivedAt||doc.lease!.status==='draft'||!eligible.some(p=>p.id===participantId&&p.userId===userId))throw new AccessError(409,'RECIPIENT_UNAVAILABLE','This document or resident is no longer available for sharing. Refresh and review current access.');
      const original=await tx.documentVersion.findFirst({where:{id:versionId,documentId,companyId},select:{scanStatus:true}});
      if(!original)throw missing();
      if(original.scanStatus!=='clean')throw new AccessError(409,'FILE_QUARANTINED','Only an exact version cleared by scanning can be shared.');
      const previous=await tx.documentShare.findFirst({where:{companyId,createdById:request.principal!.id,submissionKey:key.submissionKey}});
      if(previous){sameSubmission(previous.submissionHash,key.submissionHash);return {id:previous.id,version:previous.version,revokedAt:previous.revokedAt};}
      if(doc.version!==expected)throw conflict();
      if(await tx.documentShare.findFirst({where:{companyId,participantId,documentVersionId:versionId,revokedAt:null}}))throw new AccessError(409,'ALREADY_SHARED','This exact version is already shared with this resident.');
      const row=await tx.documentShare.create({data:{companyId,leaseId,documentId,documentVersionId:versionId,participantId,recipientId:userId,createdById:request.principal!.id,...key}});
      await audit(tx,request,companyId,row.id,'document.shared',{documentId,versionId,participantId,leaseId});
      return {id:row.id,version:row.version,revokedAt:null};
    });
  });
  server.post<{Params:Params}>(`${base}/:shareId/revoke`,{preValidation:authenticate},request=>{
    mutation(request,origin);const b=input(request,['expectedVersion','submissionKey']),leaseId=assignmentId(request.params.leaseId),documentId=assignmentId(request.params.documentId),id=assignmentId(request.params.shareId),expected=version(b.expectedVersion),key=submission(b.submissionKey,['revoke',leaseId,documentId,id,expected]);
    return scoped(db,request,'lease.manage',async(tx,companyId)=>{
      await managementDocument(tx,companyId,leaseId,documentId,true);
      const row=await tx.documentShare.findFirst({where:{id,companyId,leaseId,documentId}});if(!row)throw missing();
      const previous=await tx.documentShareAction.findFirst({where:{companyId,actorId:request.principal!.id,submissionKey:key.submissionKey}});
      if(previous){sameSubmission(previous.submissionHash,key.submissionHash);return {id:row.id,version:row.version,revokedAt:row.revokedAt};}
      if(row.version!==expected)throw conflict();
      if(row.revokedAt)throw new AccessError(409,'SHARE_REVOKED','Access to this shared copy is already revoked.');
      const result=await tx.documentShare.update({where:{id},data:{version:{increment:1},revokedAt:new Date()},select:{id:true,version:true,revokedAt:true}});
      await tx.documentShareAction.create({data:{companyId,shareId:id,actorId:request.principal!.id,action:'revoked',...key}});
      await audit(tx,request,companyId,id,'document.share.revoked',{documentId,leaseId});return result;
    });
  });
  server.get<{Querystring:Record<string,unknown>}>('/api/resident/documents',{preValidation:authenticate},request=>{
    const filter=page(request.query,true);
    return scoped(db,request,'resident.self',async(tx,companyId)=>{
      const where:Prisma.DocumentShareWhereInput={...await visible(tx,companyId,request.principal!.id),...(filter.q?{OR:[{document:{title:{contains:filter.q,mode:'insensitive'}}},{lease:{property:{name:{contains:filter.q,mode:'insensitive'}}}},{lease:{unit:{label:{contains:filter.q,mode:'insensitive'}}}}]}:{})};
      const total=await tx.documentShare.count({where}),rows=await tx.documentShare.findMany({where,orderBy:[{sharedAt:'desc'},{id:'desc'}],skip:filter.skip,take:25,select:residentSelect});
      return {items:rows.map(dto),total,page:filter.page,pageSize:25};
    });
  });
  server.get<{Params:{shareId:string}}>('/api/resident/documents/:shareId/download',{preValidation:authenticate},async(request,reply)=>{
    const id=assignmentId(request.params.shareId);
    const result=await scoped(db,request,'resident.self',async(tx,companyId)=>{
      const row=await residentShare(tx,companyId,request.principal!.id,id),file=await tx.documentVersion.findFirst({where:{id:row.documentVersionId,companyId,scanStatus:'clean'},select:{content:true,filename:true,mediaType:true}});if(!file)throw missing();
      await tx.documentShareAction.create({data:{companyId,shareId:id,actorId:request.principal!.id,action:'downloaded',...submission(randomUUID(),['download',id])}});
      await audit(tx,request,companyId,id,'document.share.downloaded',{});
      return {filename:file.filename,mediaType:file.mediaType,contentBase64:Buffer.from(file.content).toString('base64')};
    });
    return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').send(result);
  });
  server.post<{Params:{shareId:string}}>('/api/resident/documents/:shareId/received',{preValidation:authenticate},request=>{
    mutation(request,origin);const b=input(request,['expectedVersion','submissionKey']),id=assignmentId(request.params.shareId),expected=version(b.expectedVersion),key=submission(b.submissionKey,['received',id,expected]);
    return scoped(db,request,'resident.self',async(tx,companyId)=>{
      const row=await residentShare(tx,companyId,request.principal!.id,id),previous=await tx.documentShareAction.findFirst({where:{companyId,actorId:request.principal!.id,submissionKey:key.submissionKey}});
      if(previous){sameSubmission(previous.submissionHash,key.submissionHash);return {id:row.id,version:row.version,receivedAt:row.receivedAt};}
      if(row.version!==expected)throw conflict();
      if(row.receivedAt)throw new AccessError(409,'ALREADY_RECEIVED','You already confirmed receipt of this exact document version.');
      const result=await tx.documentShare.update({where:{id},data:{version:{increment:1},receivedAt:new Date()},select:{id:true,version:true,receivedAt:true}});
      await tx.documentShareAction.create({data:{companyId,shareId:id,actorId:request.principal!.id,action:'received',...key}});
      await audit(tx,request,companyId,id,'document.share.received',{});return result;
    });
  });
}
