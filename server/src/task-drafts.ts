import { randomUUID } from "node:crypto";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId, opaqueUserId } from "./application.js";
import { audit, choice, conflict, input, mutation, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";
import { companyFeatures, requireFeatures } from "./company-features.js";

const invalid = (message: string) => new AccessError(400, "INVALID_INPUT", message);
const missing = () => new AccessError(404, "NOT_FOUND", "Saved draft is unavailable.");
const kinds = ["lease_create", "lease_renewal", "inspection"];
const leaseFields = ["unitId","residentId","residentContactId","startsOn","endsOn","monthlyRent","status","rentDueDay","graceDays","paymentInstructions"];
// PostgreSQL JSONB text adds separator spacing. Leave room below its 64 KiB
// values / 2 KiB context constraints, including the bounded item/key overhead.
const MAX_DRAFT_VALUE_BYTES = 48 * 1024;
const MAX_DRAFT_CONTEXT_BYTES = 1536;
function boundedJson<T>(value: T, maxBytes: number, message: string): T {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) throw invalid(message);
  return value;
}
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw invalid("Save only supported task fields. Files, credentials and submitted requests cannot be saved as drafts.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, label: string) {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw invalid(`${label} must be text of at most ${max} characters.`);
  return value;
}
export function taskDraftValues(kind: string, raw: unknown): Record<string, Prisma.InputJsonValue> {
  if (!kinds.includes(kind)) throw invalid("Choose a supported draft task.");
  if (kind !== "inspection") {
    const b = object(raw, leaseFields), result: Record<string,string> = {};
    for (const [key,value] of Object.entries(b)) result[key] = text(value, key === "paymentInstructions" ? 1000 : key === "residentId" ? 4096 : 200, key);
    for (const id of ["unitId","residentContactId"]) if (result[id]) assignmentId(result[id]);
    if (result.residentId) opaqueUserId(result.residentId);
    if (result.residentId && result.residentContactId) throw invalid("Choose one tenant source.");
    return boundedJson(result, MAX_DRAFT_VALUE_BYTES, "This task draft is too large. Shorten its notes or payment instructions before saving.");
  }
  const b = object(raw, ["leaseId","inspectionId","kind","inspectedOn","baselineRevisionId","items"]);
  const result: Record<string,Prisma.InputJsonValue> = {};
  for (const key of ["leaseId","inspectionId","kind","inspectedOn","baselineRevisionId"]) if (b[key] !== undefined) result[key] = text(b[key],200,key);
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 100) throw invalid("Keep between 1 and 100 inspection items.");
  const itemKeys=new Set<string>();
  result.items = b.items.map(raw => {
    const i = object(raw,["key","area","item","condition","notes"]);
    const key=assignmentId(i.key);if(itemKeys.has(key))throw invalid("Keep each inspection item identifier unique.");itemKeys.add(key);
    return {key,area:text(i.area,80,"Area"),item:text(i.item,120,"Item"),condition:text(i.condition,40,"Condition"),notes:text(i.notes,1000,"Notes")};
  });
  return boundedJson(result, MAX_DRAFT_VALUE_BYTES, "This inspection draft is too large. Shorten the observation notes or keep fewer items before saving the task draft.");
}
export function taskDraftContext(raw: unknown) {
  const allowed = ["leaseListProperty","leaseListUnit","leaseListStatus","leaseListQ","leaseListNested","leaseListAttention","leaseListApprovals",
    "unitListQ","unitListStatus","unitListCursor","prospectId","prospectQ","prospectProperty","prospectStage","prospectDue","prospectCursor",
    "tenantContact","tenantId","tenantQ","tenantAccess","tenantProperty","tenantRental","tenantRecords","tenantCursor","tenantBefore","tenantHistoryCursor","tenantHistoryBefore","tenantSection"];
  const b = object(raw ?? {}, allowed), result:Record<string,string> = {};
  for (const [key,value] of Object.entries(b)) result[key] = text(value, /^tenant(?:History)?(?:Cursor|Before)$/.test(key) ? 512 : 200, key);
  for (const key of ["leaseListProperty","leaseListUnit"]) if(result[key]) assignmentId(result[key]);
  return boundedJson(result, MAX_DRAFT_CONTEXT_BYTES, "This draft's directory context is too large. Shorten the directory search or clear its filters before saving.");
}
async function sources(tx: Tx, companyId: string, propertyId: string, kind: string, sourceId: string | null, values: Record<string,Prisma.InputJsonValue>) {
  if(kind==="lease_create"&&sourceId)throw invalid("A new lease draft has no previous lease source.");
  if(kind==="inspection"&&sourceId!==values.leaseId)throw invalid("The inspection draft must keep its source lease.");
  const property = await tx.property.findFirst({where:{id:propertyId,companyId},select:{id:true,name:true,version:true}});
  if(!property) throw missing();
  const snapshots:Record<string,Prisma.InputJsonValue> = {property:{id:property.id,version:property.version}};
  let lease: Awaited<ReturnType<typeof tx.lease.findFirst>> = null;
  if(kind !== "lease_create") {
    const leaseId = kind === "lease_renewal" ? sourceId : values.leaseId;
    if(typeof leaseId !== "string") throw invalid("Choose the source lease.");
    lease = await tx.lease.findFirst({where:{id:leaseId,companyId,propertyId}});
    if(!lease) throw missing();
    snapshots.lease = {id:lease.id,version:lease.version};
    if(kind === "lease_renewal" && !lease.endsOn) throw invalid("Record a current lease end date before saving a renewal task.");
  }
  if(kind === "lease_create" && values.unitId) {
    const unit = await tx.unit.findFirst({where:{id:String(values.unitId),companyId,propertyId},select:{id:true,version:true,status:true}});
    if(!unit || unit.status !== "active") throw missing();
    snapshots.unit = {id:unit.id,version:unit.version};
  }
  if(kind === "lease_create" && values.residentContactId) {
    const contact=await tx.residentContact.findFirst({where:{id:String(values.residentContactId),companyId,status:"active"},select:{id:true,version:true,userId:true}});
    if(!contact || !contact.userId) throw missing();
    const account=await tx.user.findFirst({where:{id:contact.userId,status:"active"},select:{id:true}});
    if(!account) throw missing();
    snapshots.tenant={id:contact.id,version:contact.version};
  }
  if(kind === "lease_create" && values.residentId) {
    const member = await tx.companyMembership.findFirst({where:{companyId,userId:String(values.residentId),role:"resident",status:"active"},include:{user:true}});
    if(!member || member.user.status !== "active") throw missing();
    snapshots.account={id:member.userId,version:member.version};
  }
  if(kind === "inspection") {
    if(values.inspectionId) {
      const row=await tx.leaseInspection.findFirst({where:{id:String(values.inspectionId),companyId,leaseId:lease!.id}});
      if(!row || row.status !== "in_progress") throw missing();
      snapshots.inspection={id:row.id,version:row.version};
    }
    if(values.baselineRevisionId) {
      const baseline=await tx.inspectionRevision.findFirst({where:{id:String(values.baselineRevisionId),companyId,leaseId:lease!.id,action:"complete"}});
      if(!baseline) throw missing();
    }
  }
  return {snapshots,property,title:`${kind === "lease_create" ? "New lease" : kind === "lease_renewal" ? "Lease renewal" : "Inspection observations"} · ${property.name}`.slice(0,240)};
}
function canonical(value: unknown): unknown {return value && typeof value === "object" ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])) : value;}
function snapshotsMatch(saved: unknown,current: unknown) {return JSON.stringify(canonical(saved))===JSON.stringify(canonical(current));}
async function context(tx: Tx,userId: string) {await tx.$queryRaw`SELECT set_config('app.task_draft_user_id', ${userId}, true)`;}
type DraftRow = Prisma.TaskDraftGetPayload<Record<string, never>>;
function summary(row: DraftRow) {
 return {companyId:row.companyId,id:row.id,title:row.title,kind:row.kind,version:row.version,savedAt:row.updatedAt,expiresAt:row.expiresAt,href:`/company/drafts?draftId=${encodeURIComponent(row.id)}`};
}
function unavailable(row: DraftRow) {
 return {...summary(row),unavailable:true,stale:true,sourceIssue:"The saved source no longer supports this task. Review the source separately or delete this saved draft; other tasks are unchanged."};
}
function dto(row: DraftRow, stale=false) {
 return {...summary(row),propertyId:row.propertyId,sourceId:row.sourceId,actionKey:row.actionKey,values:row.values,context:row.context,sourceVersions:row.sourceVersions,stale};
}
async function taskFeatures(tx: Tx, companyId: string, kind: string, method: string) {
 requireFeatures(await companyFeatures(tx,companyId),kind === "inspection" ? ["leasing","inspections"] : ["leasing"],method);
}
async function currentDraft(tx: Tx, companyId: string, row: DraftRow) {
 try {
  const current=await sources(tx,companyId,row.propertyId,row.kind,row.sourceId,row.values as Record<string,Prisma.InputJsonValue>);
  return {...dto(row,!snapshotsMatch(row.sourceVersions,current.snapshots)),property:current.property};
 } catch(error) {
  // Ownership and current company/feature authority were already checked.
  // Only minimal personal task metadata survives an unavailable source.
  if(error instanceof AccessError && [400,404].includes(error.statusCode))return unavailable(row);
  throw error;
 }
}
export function registerTaskDrafts(server: FastifyInstance,db: PrismaClient,authenticate: preValidationHookHandler,origin: string) {
 const auth={preValidation:authenticate},base="/api/company/task-drafts";
 server.get(base,auth,request=>scoped(db,request,"lease.manage",async(tx,companyId)=>{
  const userId=request.principal!.id;await context(tx,userId);
  const rows=await tx.taskDraft.findMany({where:{companyId,userId,expiresAt:{gt:new Date()}},orderBy:[{updatedAt:"desc"},{id:"desc"}],take:101});
  const items=[];
  const policy = await companyFeatures(tx,companyId);
  for(const row of rows.slice(0,100)) {
   try {
    requireFeatures(policy,row.kind === "inspection" ? ["leasing","inspections"] : ["leasing"],"GET");
    await sources(tx,companyId,row.propertyId,row.kind,row.sourceId,row.values as Record<string,Prisma.InputJsonValue>);
    items.push(summary(row));
   } catch(error) {
    if (!(error instanceof AccessError)) throw error;
    if ([400,404].includes(error.statusCode)) items.push(unavailable(row));
    else if (error.statusCode !== 403) throw error;
   }
  }
  return {companyId,items,hasMore:rows.length>100};
 }));
 server.get<{Params:{draftId:string}}>(base+"/:draftId",auth,request=>scoped(db,request,"lease.manage",async(tx,companyId)=>{
  const userId=request.principal!.id;await context(tx,userId);
  const row=await tx.taskDraft.findFirst({where:{id:assignmentId(request.params.draftId),companyId,userId,expiresAt:{gt:new Date()}}});if(!row)throw missing();
  await taskFeatures(tx,companyId,row.kind,"GET");
  return currentDraft(tx,companyId,row);
 }));
 server.post(base,auth,request=>{
  mutation(request,origin);const b=input(request,["kind","propertyId","sourceId","values","context","submissionKey"]);
  const kind=choice(b.kind,kinds,"task"),propertyId=assignmentId(b.propertyId),sourceId=b.sourceId?assignmentId(b.sourceId):null,values=taskDraftValues(kind,b.values),ctx=taskDraftContext(b.context),key=submission(b.submissionKey,[kind,propertyId,sourceId,values,ctx]);
  return scoped(db,request,"lease.manage",async(tx,companyId)=>{
   const userId=request.principal!.id;await context(tx,userId);await taskFeatures(tx,companyId,kind,"POST");
   const existing=await tx.taskDraft.findFirst({where:{companyId,userId,submissionKey:key.submissionKey}});if(existing){sameSubmission(existing.submissionHash,key.submissionHash);if(existing.expiresAt<=new Date())throw missing();return currentDraft(tx,companyId,existing);}
   const current=await sources(tx,companyId,propertyId,kind,sourceId,values);
   await tx.taskDraft.deleteMany({where:{companyId,userId,expiresAt:{lte:new Date()}}});
   if(await tx.taskDraft.count({where:{companyId,userId}})>=100)throw invalid("Delete an old saved draft before saving another. You can keep 100 tasks.");
   const row=await tx.taskDraft.create({data:{companyId,userId,propertyId,kind,sourceId,values,context:ctx,sourceVersions:current.snapshots,title:current.title,actionKey:randomUUID(),...key,expiresAt:new Date(Date.now()+30*86400000)}});
   await audit(tx,request,companyId,row.id,"task_draft.saved",{kind,propertyId});return dto(row);
  });
 });
 server.patch<{Params:{draftId:string}}>(base+"/:draftId",auth,request=>{
  mutation(request,origin);const b=input(request,["values","context","expectedVersion","submissionKey","reviewSources"]),expected=version(b.expectedVersion),id=assignmentId(request.params.draftId);
  if(b.reviewSources!==undefined && typeof b.reviewSources!=="boolean")throw invalid("Confirm source review explicitly.");
  return scoped(db,request,"lease.manage",async(tx,companyId)=>{
   const userId=request.principal!.id;await context(tx,userId);const row=await tx.taskDraft.findFirst({where:{id,companyId,userId,expiresAt:{gt:new Date()}}});if(!row)throw missing();
   await taskFeatures(tx,companyId,row.kind,"PATCH");
   const values=taskDraftValues(row.kind,b.values),ctx=taskDraftContext(b.context),key=submission(b.submissionKey,[id,expected,values,ctx,b.reviewSources===true]);
   if(row.lastMutationKey===key.submissionKey){sameSubmission(row.lastMutationHash!,key.submissionHash);return currentDraft(tx,companyId,row);}
   if(row.version!==expected)throw conflict();
   const current=await sources(tx,companyId,row.propertyId,row.kind,row.sourceId,values);
   // Changing selected sources captures their fresh version; unchanged sources
   // keep their original snapshot until the user explicitly reviews changes.
   const baseline=row.sourceVersions as Record<string,Prisma.JsonValue>,snapshots={...current.snapshots};
   if(!b.reviewSources)for(const [name,snapshot]of Object.entries(snapshots)){const old=baseline[name] as {id?:string}|undefined;if(old?.id===(snapshot as {id?:string}).id)snapshots[name]=old as Prisma.InputJsonValue;}
   const updated=await tx.taskDraft.update({where:{id,companyId,userId,version:expected},data:{values,context:ctx,sourceVersions:snapshots,title:current.title,version:{increment:1},lastMutationKey:key.submissionKey,lastMutationHash:key.submissionHash,expiresAt:new Date(Date.now()+30*86400000)}});
   await audit(tx,request,companyId,id,"task_draft.saved",{kind:row.kind,propertyId:row.propertyId});return dto(updated,!snapshotsMatch(updated.sourceVersions,current.snapshots));
  });
 });
 server.delete<{Params:{draftId:string}}>(base+"/:draftId",auth,request=>{
  mutation(request,origin);const b=input(request,["expectedVersion"]),expected=version(b.expectedVersion),id=assignmentId(request.params.draftId);
  return scoped(db,request,"lease.manage",async(tx,companyId)=>{const userId=request.principal!.id;await context(tx,userId);const row=await tx.taskDraft.findFirst({where:{id,companyId,userId}});if(!row)return{deleted:true};await taskFeatures(tx,companyId,row.kind,"DELETE");if(row.version!==expected)throw conflict();await tx.taskDraft.delete({where:{id,companyId,userId,version:expected}});await audit(tx,request,companyId,id,"task_draft.deleted",{kind:row.kind});return{deleted:true};});
 });
}
