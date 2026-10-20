import { publishNotification, type NotificationPublisher } from "./notification-events.js";
import type { FastifyInstance, preValidationHookHandler, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AccessError, permissions } from './access.js';
import { assignmentId, opaqueUserId } from './application.js';
import { audit, boundedText, choice, conflict, input, mutation, page, sameSubmission, scoped, submission, version, type Tx } from './operational.js';
const safeSelect={id:true,propertyId:true,title:true,description:true,priority:true,category:true,targetOn:true,status:true,version:true,executionStatus:true,property:{select:{name:true}},unit:{select:{label:true}}} as const;
export function registerWorkOrders(server:FastifyInstance,db:PrismaClient,authenticate:preValidationHookHandler,origin:string,publish:NotificationPublisher=publishNotification) {
  const auth={preValidation:authenticate}, denied=()=>new AccessError(404,'NOT_FOUND','Assigned work not found.');
  const management=(request:FastifyRequest)=>permissions(request.principal!).includes('maintenance.manage');
  const authority=(request:FastifyRequest)=>management(request)?'maintenance.manage' as const:'maintenance.execute' as const;
  const record=async(tx:Tx,companyId:string,id:string,request:FastifyRequest,propertyIds:string[]|null)=>{
    const row=await tx.maintenanceRequest.findFirst({where:{id,companyId,...(!management(request)?{assigneeId:request.principal!.id,...(propertyIds?{propertyId:{in:propertyIds}}:{})}:{})},select:{...safeSelect,assigneeId:true}});
    if(!row)throw denied();return row;
  };
  const eligibleWhere=(companyId:string,propertyId:string)=>({companyId,role:'staff',status:'active',maintenanceExecution:true,user:{status:'active',emailVerified:true},OR:[{staffPropertyScope:'all'},{staffPropertyScope:'selected',staffProperties:{some:{companyId,propertyId}}}]});
  server.get<{Params:{userId:string}}>('/api/company/members/:userId/maintenance-access',auth,request=>scoped(db,request,'members.manage',async(tx,companyId)=>{
    const member=await tx.companyMembership.findFirst({where:{companyId,userId:opaqueUserId(request.params.userId),role:'staff'},select:{version:true,maintenanceExecution:true}});
    if(!member)throw denied();return member;
  }));
  server.put<{Params:{userId:string}}>('/api/company/members/:userId/maintenance-access',auth,request=>{
    mutation(request,origin);const userId=opaqueUserId(request.params.userId), b=input(request,['enabled','expectedVersion']), expectedVersion=version(b.expectedVersion);
    if(typeof b.enabled!=='boolean')throw new AccessError(400,'INVALID_INPUT','Choose whether to grant maintenance execution.');const enabled=b.enabled;
    return scoped(db,request,'members.manage',async(tx,companyId)=>{
      await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${userId} RETURNING id`;
      const member=await tx.companyMembership.findFirst({where:{companyId,userId,role:'staff'}});if(!member)throw denied();
      if(member.maintenanceExecution===enabled)return {version:member.version};if(member.version!==expectedVersion)throw conflict();
      const row=await tx.companyMembership.update({where:{userId},data:{maintenanceExecution:enabled,version:{increment:1}},select:{version:true}});
      await audit(tx,request,companyId,userId,'staff.maintenance_access.updated',{from:member.maintenanceExecution,to:enabled});return row;
    });
  });
  server.get<{Querystring:{cursor?:string;status?:string;q?:string}}>('/api/company/work-orders',auth,request=>{
    if(Object.keys(request.query).some(k=>!['status','cursor','q'].includes(k)))throw new AccessError(400,'INVALID_INPUT','Unknown work filter.');
    const status=request.query.status===undefined?undefined:choice(request.query.status,['assigned','accepted','pending_review','complete'],'work status'), cursor=request.query.cursor===undefined?undefined:assignmentId(request.query.cursor), q=request.query.q===undefined?undefined:boundedText(request.query.q,200,'Search');
    return scoped(db,request,'maintenance.execute',async(tx,companyId,propertyIds)=>{
      const where={companyId,assigneeId:request.principal!.id,executionStatus:status,...(propertyIds?{propertyId:{in:propertyIds}}:{}),...(q?{title:{contains:q,mode:'insensitive' as const}}:{})};
      const boundary=cursor?await tx.maintenanceRequest.findFirst({where:{...where,id:cursor},select:{id:true}}):null;
      if(cursor&&!boundary)throw denied();
      const rows=await tx.maintenanceRequest.findMany({where:{...where,...(cursor?{id:{gt:cursor}}:{})},select:safeSelect,orderBy:{id:'asc'},take:51});return page(rows);
    });
  });
  server.get<{Params:{requestId:string}}>('/api/company/work-orders/:requestId',auth,request=>scoped(db,request,authority(request),async(tx,companyId,propertyIds)=>{
    const row=await record(tx,companyId,assignmentId(request.params.requestId),request,propertyIds);
    const actions=await tx.workOrderAction.findMany({where:{companyId,requestId:row.id},select:{id:true,action:true,note:true,createdAt:true,actorId:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:101});
    const actors=management(request)?await tx.user.findMany({where:{id:{in:[...new Set(actions.map(e=>e.actorId))]}},select:{id:true,name:true}}):[];
    const eligible=management(request)?await tx.companyMembership.findMany({where:eligibleWhere(companyId,row.propertyId),select:{userId:true,user:{select:{name:true}}},orderBy:{userId:'asc'},take:2001}):[];
    const {assigneeId,...safe}=row;
    const assignee=management(request)&&assigneeId?await tx.user.findUnique({where:{id:assigneeId},select:{name:true}}):null;
    return {...safe,...(management(request)?{assigneeId,assigneeName:assignee?.name||null,eligible:eligible.slice(0,2000).map(m=>({id:m.userId,name:m.user.name||'Staff member'})),eligibleLimited:eligible.length>2000}:{}),actions:actions.slice(0,100).map(({actorId,...event})=>({...event,author:management(request)?actors.find(a=>a.id===actorId)?.name||'Recorded team member':actorId===request.principal!.id?'You':'Property team'})),historyLimited:actions.length>100};
  }));
  server.post<{Params:{requestId:string}}>('/api/company/work-orders/:requestId/actions',auth,request=>{
    mutation(request,origin);const b=input(request,['action','assigneeId','note','expectedVersion','submissionKey']), id=assignmentId(request.params.requestId), action=choice(b.action,['assign','accept','progress','submit','approve','reopen'],'work action'), note=boundedText(b.note,4000,'Work note'), expectedVersion=version(b.expectedVersion);
    if(action!=='assign' && b.assigneeId!==undefined)throw new AccessError(400,'INVALID_INPUT','Only an assignment can choose an assignee.');
    const assigneeId=action==='assign'?(b.assigneeId===null?null:opaqueUserId(b.assigneeId)):undefined;
    const key=submission(b.submissionKey,[id,action,assigneeId??null,note,expectedVersion]);
    return scoped(db,request,authority(request),async(tx,companyId,propertyIds)=>{
      const row=await record(tx,companyId,id,request,propertyIds), manage=management(request);
      if(['assign','approve','reopen'].includes(action)&&!manage)throw new AccessError(403,'ACCESS_DENIED','Management must assign, review and reopen work.');
      // Replay follows current assignment/property authorization, never the old grant.
      const previous=await tx.workOrderAction.findFirst({where:{companyId,actorId:request.principal!.id,submissionKey:key.submissionKey}});
      if(previous){sameSubmission(previous.submissionHash,key.submissionHash);return {version:row.version};}
      if(row.version!==expectedVersion)throw conflict();
      let executionStatus=row.executionStatus, status=row.status;
      if(action==='assign'){
        if(row.status==='resolved')throw new AccessError(409,'REOPEN_REQUIRED','Reopen this request before assigning work.');
        if(assigneeId){
          await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${assigneeId} RETURNING id`;
          if(!await tx.companyMembership.findFirst({where:{...eligibleWhere(companyId,row.propertyId),userId:assigneeId},select:{userId:true}}))throw new AccessError(409,'ASSIGNEE_INELIGIBLE','Choose active staff with maintenance execution and access to this property.');
        }
        executionStatus=assigneeId?'assigned':'unassigned';status='open';
      } else if(action==='accept' && executionStatus==='assigned') {executionStatus='accepted';status='in_progress';}
      else if(action==='progress' && executionStatus==='accepted') { /* Note only; still increments reviewed version. */ }
      else if(action==='submit' && executionStatus==='accepted'){executionStatus='pending_review';status='in_progress';}
      else if(action==='approve' && executionStatus==='pending_review'){executionStatus='complete';status='resolved';}
      else if(action==='reopen' && (executionStatus==='pending_review'||status==='resolved')){executionStatus=row.assigneeId?'assigned':'unassigned';status='open';}
      else throw new AccessError(409,'WORK_STATE_CHANGED','This action is unavailable in the current work state. Reload the request.');
      if(!manage&&row.assigneeId!==request.principal!.id)throw denied();
      const changed=await tx.maintenanceRequest.updateMany({where:{id,companyId,version:expectedVersion},data:{executionStatus,status,...(action==='assign'?{assigneeId}:{}),version:{increment:1}}});if(changed.count!==1)throw conflict();
      const event=await tx.workOrderAction.create({data:{companyId,requestId:id,actorId:request.principal!.id,action,note,...key}});
      await audit(tx,request,companyId,id,'maintenance.work.changed',{action,eventId:event.id,from:row.executionStatus,to:executionStatus,previousAssigneeId:row.assigneeId,assigneeId:action==='assign'?assigneeId??null:row.assigneeId});
      if(status!==row.status)await audit(tx,request,companyId,id,'maintenance.status.changed',{from:row.status,to:status});
      const eventInput={companyId,actorId:request.principal!.id,requestId:id,eventKey:event.id};
      if(action==='assign'&&assigneeId)await publish(tx,{...eventInput,kind:'work.assigned'});
      if(action==='reopen')await publish(tx,{...eventInput,kind:'work.reopened'});
      if(action==='approve')await publish(tx,{...eventInput,kind:'work.approved'});
      if(action==='submit')await publish(tx,{...eventInput,kind:'work.review'});
      if(status!==row.status)await publish(tx,{...eventInput,kind:'maintenance.status'});
      return {version:row.version+1};
    });
  });
}
