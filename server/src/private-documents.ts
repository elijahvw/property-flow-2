import { createHash } from 'node:crypto';
import type { FastifyInstance, preValidationHookHandler } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AccessError } from './access.js';
import { assignmentId } from './application.js';
import { audit, boundedText, conflict, input, mutation, sameSubmission, scoped, submission, version, type Tx } from './operational.js';
import { documentAvailable } from './document-status.js';
import { revokeDocumentShares } from './lease-document-shares.js';
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const metadata = { id:true, number:true, filename:true, mediaType:true, byteLength:true, sha256:true, scanStatus:true, scannedAt:true, createdAt:true } as const;
export function validateDocument(filename: unknown, mediaType: unknown, base64: unknown) {
  const name = boundedText(filename,180,'Filename');
  if (/[\x00-\x1f\x7f/\\]/.test(name) || name==='.' || name==='..') throw new AccessError(400,'INVALID_FILE','Use a filename without paths or control characters.');
  if (typeof base64!=='string' || !base64.length || base64.length>Math.ceil(MAX_DOCUMENT_BYTES/3)*4 || base64.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new AccessError(400,'INVALID_FILE','Choose a file between 1 byte and 5 MB.');
  const bytes=Buffer.from(base64,'base64');
  if (!bytes.length || bytes.length>MAX_DOCUMENT_BYTES || bytes.toString('base64')!==base64) throw new AccessError(400,'INVALID_FILE','Choose a file between 1 byte and 5 MB.');
  const supported = mediaType==='application/pdf' && /\.pdf$/i.test(name) && bytes.subarray(0,5).toString()==='%PDF-'
    || mediaType==='image/png' && /\.png$/i.test(name) && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    || mediaType==='image/jpeg' && /\.jpe?g$/i.test(name) && bytes[0]===255 && bytes[1]===216 && bytes[2]===255
    || mediaType==='text/plain' && /\.txt$/i.test(name) && !bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes);
  if(!supported) throw new AccessError(400,'INVALID_FILE','Choose a PDF, PNG, JPEG or UTF-8 text file with matching content and extension.');
  return {filename:name,mediaType:mediaType as string,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function registerPrivateDocuments(server:FastifyInstance,db:PrismaClient,authenticate:preValidationHookHandler,origin:string) {
  for(const source of ['leases','maintenance'] as const) {
    const permission=source==='leases'?'lease.manage':'maintenance.manage', base=`/api/company/${source}/:sourceId/documents`;
    const sourceRecord=async(tx:Tx,companyId:string,id:string)=>{
      const row=source==='leases' ? await tx.lease.findFirst({where:{id,companyId},select:{id:true}}) : await tx.maintenanceRequest.findFirst({where:{id,companyId},select:{id:true}});
      if(!row)throw new AccessError(404,'NOT_FOUND','Document source not found.');
    };
    const sourceWhere=(id:string)=>source==='leases'?{leaseId:id}:{requestId:id};
    type Params={sourceId:string;documentId:string;versionId:string};
    const document=async(tx:Tx,companyId:string,p:Params)=>{
      await sourceRecord(tx,companyId,assignmentId(p.sourceId));
      const row=await tx.privateDocument.findFirst({where:{id:assignmentId(p.documentId),companyId,...sourceWhere(p.sourceId)}});
      if(!row)throw new AccessError(404,'NOT_FOUND','Document not found at this source.');
      return row;
    };
    server.get<{Params:Params}>(base,{preValidation:authenticate},request=>scoped(db,request,permission,async(tx,companyId)=>{
      await sourceRecord(tx,companyId,assignmentId(request.params.sourceId));
      const items=await tx.privateDocument.findMany({where:{companyId,...sourceWhere(request.params.sourceId)},select:{id:true,title:true,version:true,archivedAt:true,createdAt:true,versions:{select:metadata,orderBy:{number:'desc'}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:201});
      if(items.length>200)throw new AccessError(409,'DOCUMENT_LIMIT','This source exceeds the document limit. Ask your administrator to review retention.');
      return {items};
    }));
    server.post<{Params:Params}>(base,{preValidation:authenticate,bodyLimit:Math.ceil(MAX_DOCUMENT_BYTES/3)*4+8192},request=>{
      mutation(request,origin);
      const b=input(request,['title','filename','mediaType','contentBase64','submissionKey','documentId','expectedVersion']);
      const id=assignmentId(request.params.sourceId), title=boundedText(b.title,160,'Document title'), file=validateDocument(b.filename,b.mediaType,b.contentBase64), documentId=b.documentId==null?null:assignmentId(b.documentId), expectedVersion=documentId?version(b.expectedVersion):null;
      const key=submission(b.submissionKey,[source,id,title,file.filename,file.mediaType,file.sha256,documentId,expectedVersion]);
      return scoped(db,request,permission,async(tx,companyId)=>{
        await sourceRecord(tx,companyId,id);
        const previous=await tx.documentVersion.findFirst({where:{companyId,createdById:request.principal!.id,submissionKey:key.submissionKey},select:{...metadata,submissionHash:true,document:{select:{id:true,archivedAt:true,...(source==='leases'?{leaseId:true}:{requestId:true})}}}});
        if(previous){sameSubmission(previous.submissionHash,key.submissionHash);return {documentId:previous.document.id,versionId:previous.id};}
        const [companyUsage, sourceUsage] = await Promise.all([
          tx.documentVersion.aggregate({where:{companyId},_sum:{byteLength:true}}),
          tx.documentVersion.aggregate({where:{companyId,document:sourceWhere(id)},_sum:{byteLength:true}}),
        ]);
        if((companyUsage._sum.byteLength||0)+file.bytes.length>1024*1024*1024 || (sourceUsage._sum.byteLength||0)+file.bytes.length>100*1024*1024)
          throw new AccessError(409,'STORAGE_LIMIT','Private document storage has reached its retention limit. Ask your administrator to review storage before adding more originals.');
        let doc=documentId?await document(tx,companyId,{...request.params,documentId}):null;
        if(doc?.archivedAt)throw new AccessError(409,'DOCUMENT_ARCHIVED','Archived documents retain their originals. Add a separate document.');
        if(doc && doc.version!==expectedVersion)throw conflict();
        if(!doc){
          if(await tx.privateDocument.count({where:{companyId,...sourceWhere(id)}})>=200)throw new AccessError(409,'DOCUMENT_LIMIT','This source already has 200 documents.');
          doc=await tx.privateDocument.create({data:{companyId,...sourceWhere(id),title}});
        } else {
          if(doc.title!==title)throw new AccessError(400,'INVALID_INPUT','Keep the original title when uploading a new version.');
          if(await tx.documentVersion.count({where:{companyId,documentId:doc.id}})>=50)throw new AccessError(409,'VERSION_LIMIT','This document already has 50 retained versions.');
          await tx.privateDocument.update({where:{id:doc.id},data:{version:{increment:1}}});
        }
        const nextNumber=(await tx.documentVersion.aggregate({where:{companyId,documentId:doc.id},_max:{number:true}}))._max.number||0;
        const row=await tx.documentVersion.create({data:{companyId,documentId:doc.id,number:nextNumber+1,filename:file.filename,mediaType:file.mediaType,byteLength:file.bytes.length,sha256:file.sha256,content:file.bytes,scanStatus:'unscanned',scannedAt:null,createdById:request.principal!.id,...key},select:metadata});
        await audit(tx,request,companyId,doc.id,'document.uploaded',{versionId:row.id,source,sourceId:id,number:row.number,scanStatus:'unscanned'});
        return {documentId:doc.id,versionId:row.id};
      });
    });
    server.get<{Params:Params}>(`${base}/:documentId/versions/:versionId/download`,{preValidation:authenticate},async(request,reply)=>{
      const result=await scoped(db,request,permission,async(tx,companyId)=>{
        const doc=await document(tx,companyId,request.params), row=await tx.documentVersion.findFirst({where:{id:assignmentId(request.params.versionId),companyId,documentId:doc.id},select:{...metadata,content:true}});
        if(!row)throw new AccessError(404,'NOT_FOUND','Version not found.');
        if(!documentAvailable(row.scanStatus))throw new AccessError(409,'FILE_QUARANTINED','This original has a recorded rejection or unavailable file status. Download is blocked.');
        await audit(tx,request,companyId,doc.id,'document.downloaded',{versionId:row.id,scanStatus:row.scanStatus});
        return {filename:row.filename,contentBase64:Buffer.from(row.content).toString('base64'),mediaType:row.mediaType};
      });
      return reply.header('Cache-Control','private, no-store').header('X-Content-Type-Options','nosniff').send(result);
    });
    server.patch<{Params:Params}>(`${base}/:documentId`,{preValidation:authenticate},request=>{
      mutation(request,origin);const b=input(request,['expectedVersion','archived']), expectedVersion=version(b.expectedVersion);
      if(typeof b.archived!=='boolean')throw new AccessError(400,'INVALID_INPUT','Choose whether to archive this document.');
      const archived=b.archived;
      return scoped(db,request,permission,async(tx,companyId)=>{
        const doc=await document(tx,companyId,request.params);
        if(!!doc.archivedAt===archived)return {version:doc.version};
        if(doc.version!==expectedVersion)throw conflict();
        const row=await tx.privateDocument.update({where:{id:doc.id},data:{archivedAt:archived?new Date():null,version:{increment:1}},select:{version:true}});
        if(archived && source==='leases')await revokeDocumentShares(tx,request,companyId,doc.id);
        await audit(tx,request,companyId,doc.id,archived?'document.archived':'document.restored',{});return row;
      });
    });
  }
}
