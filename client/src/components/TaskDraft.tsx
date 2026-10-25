import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { leaseContext } from "../lease-links";
import { useTenantAttemptContext } from "../tenant-write-access";
import { api, ApiError } from "../api";
import { formatDate } from "../dates";
import { useEditorBusy } from "./EditorDialog";
import { monitorOperation } from "../operations";
export type TaskDraftKind="lease_create"|"lease_renewal"|"inspection";
export type TaskDraft={companyId:string;id:string;unavailable?:boolean;sourceIssue?:string;kind:TaskDraftKind;propertyId:string;sourceId:string|null;version:number;actionKey:string;values:Record<string,unknown>;context:Record<string,string>;sourceVersions:Record<string,{id:string;version:number}>;title:string;savedAt:string;expiresAt:string;stale:boolean;property?:{id:string;name:string}};
function sameDraftValues(left:unknown,right:unknown):boolean {
 const canonical=(value:unknown):unknown=>value && typeof value==="object" ? Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)])):value;
 return JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
}
const leaseNames=["unitId","residentId","residentContactId","startsOn","endsOn","monthlyRent","status","rentDueDay","graceDays","paymentInstructions"];
export function leaseDraftValues(payload:Record<string,unknown>):Record<string,string>{return Object.fromEntries(leaseNames.filter(name=>payload[name]!==undefined&&payload[name]!==null).map(name=>[name,String(payload[name])]));}
export function readLeaseDraft(element:HTMLElement|null,contactId?:string):Record<string,string>{
 const form=element?.querySelector<HTMLFormElement>("form[data-task-values]");if(!form)throw new Error("Open the task details before saving a draft.");
 for(const field of form.querySelectorAll<HTMLInputElement>("input[name]"))if(leaseNames.includes(field.name)&&field.validity.badInput)throw new Error("Complete a partly entered number or date, or clear that field, before saving this task draft.");
 const data=new FormData(form),values=Object.fromEntries(leaseNames.filter(name=>data.has(name)).map(name=>[name,String(data.get(name)||"")]));
 if(contactId){delete values.residentId;values.residentContactId=contactId;}return values;
}
export function useTaskDraft({kind,propertyId,sourceId=null,initial,element,readValues,disabled=false}:{kind:TaskDraftKind;propertyId:string;sourceId?:string|null;initial?:TaskDraft;element:RefObject<HTMLElement>;readValues:()=>Record<string,unknown>;disabled?:boolean}){
 const editor=useEditorBusy(),registration=useId(),location=useLocation(),navigate=useNavigate();
 const {data:auth,refreshUser}=useAuth();
 const context=useTenantAttemptContext(auth,initial?.companyId);
 const blockedFeature = auth?.companyFeatures?.leasing !== undefined && auth.companyFeatures.leasing !== "enabled" ||
   kind === "inspection" && auth?.companyFeatures?.inspections !== undefined && auth.companyFeatures.inspections !== "enabled";
 const writeBlocked=!!auth?.impersonation || blockedFeature;
 const [accessDenied,setAccessDenied]=useState(false),[uncertain,setUncertain]=useState(false),[sourceUnavailable,setSourceUnavailable]=useState(false);
 const [currentRecord,setCurrentRecord]=useState<TaskDraft|null>(null),[checkingCurrent,setCheckingCurrent]=useState(false),[currentError,setCurrentError]=useState(""),[currentLoaded,setCurrentLoaded]=useState(false),[acceptCurrent,setAcceptCurrent]=useState(false),[useCurrentRequested,setUseCurrentRequested]=useState(false);
 const isReadDenied=(error:unknown)=>error instanceof ApiError && (error.status===401||error.status===404||error.status===403&&["ACCESS_DENIED","COMPANY_ACCESS_DENIED","FEATURE_DISABLED","IMPERSONATION_UNAVAILABLE","EMAIL_VERIFICATION_REQUIRED"].includes(error.code));
 const originContext=useRef((()=>{const params=new URLSearchParams(location.search),context:Record<string,string>=leaseContext(params);for(const [input,key]of [["q","leaseListQ"],["status","leaseListStatus"],["propertyId","leaseListProperty"],["unitId","leaseListUnit"]]){const value=params.get(input);if(value)context[key]=value;}const nested=location.pathname.match(/^\/company\/properties\/([^/]+)\/leases$/);if(nested){try{context.leaseListProperty=decodeURIComponent(nested[1]);context.leaseListNested="true";}catch{/* Invalid route text is not retained as return context. */}}return context;})());
 const [record,setRecord]=useState<TaskDraft|undefined>(initial),[busy,setBusy]=useState(false),[error,setError]=useState(""),[acknowledged,setAcknowledged]=useState(false);
 const row=useRef(record);row.current=record;
 const createKey=useRef(crypto.randomUUID()),pending=useRef<{path:string;method:string;body:unknown;uncertain?:boolean}|null>(null),latestRead=useRef(readValues),saving=useRef(false);latestRead.current=readValues;
 const save=useCallback(async(values?:Record<string,unknown>,reviewSources=false)=>{
  if(saving.current)throw new Error("Wait for the current task save before continuing.");
  saving.current=true;
  setBusy(true);setError("");
  const wasUncertain=!!pending.current?.uncertain;
  try{
   if(currentRecord)throw new Error("Review the current saved task and explicitly resolve the earlier draft request before continuing.");
   if(!context.current())throw new Error("Your company or account changed. Reload the workspace before saving this task.");
   if(writeBlocked)throw new Error("This task area is read-only under your current company access settings. Your unfinished work is kept.");
   if(disabled || editor.uncertain && !pending.current)throw new Error("Recover the submitted request first. Submitted requests cannot become new drafts.");
   const current=row.current;
   const request=pending.current||{path:`/api/company/task-drafts${current?`/${encodeURIComponent(current.id)}`:""}`,method:current?"PATCH":"POST",body:current?{values:values||latestRead.current(),context:current.context,expectedVersion:current.version,submissionKey:crypto.randomUUID(),reviewSources}:{kind,propertyId,sourceId,values:values||latestRead.current(),context:originContext.current,submissionKey:createKey.current}};
   pending.current=request;
   const result=await monitorOperation("draft.save",()=>api<TaskDraft>(request.path,{method:request.method,body:request.body,expectedCompanyId:context.companyId}));
   if(!context.current() || result.companyId!==context.companyId)throw new ApiError("Your task context changed before the save was acknowledged. Keep the original request for recovery.",409,"TASK_CONTEXT_CHANGED",true);
   if(result.unavailable){pending.current=null;setUncertain(false);row.current=result;setRecord(result);setSourceUnavailable(true);editor.completed(element.current||undefined);return result;}
   const attemptedValues=(request.body as {values?:unknown}).values;
   if(wasUncertain && !sameDraftValues(attemptedValues,result.values)){
    setCurrentRecord(result);setCurrentLoaded(false);setAcceptCurrent(false);setUncertain(true);
    throw new ApiError("The saved task has changed since this request. Review its current saved values before deciding whether to stop retrying.",409,"TASK_CURRENT_REVIEW_REQUIRED",true);
   }
   pending.current=null;setUncertain(false);row.current=result;setRecord(result);editor.draftSaved(element.current||undefined);return result;
  }catch(caught){
   if(isReadDenied(caught)){setAccessDenied(true);void refreshUser();}
   if(pending.current && caught instanceof ApiError && caught.submissionUncertain){pending.current.uncertain=true;setUncertain(true);}
   else if(!wasUncertain && caught instanceof ApiError)pending.current=null;
   setError(caught instanceof Error?caught.message:"Unable to save this draft.");throw caught;
  }finally{saving.current=false;setBusy(false);}
 },[disabled,editor.uncertain,editor.draftSaved,kind,propertyId,sourceId,writeBlocked,currentRecord]);
 useEffect(()=>{editor.recovery(registration,uncertain);return()=>editor.recovery(registration,false);},[uncertain,editor.recovery,registration]);
 useEffect(()=>{editor.register(registration,busy);return()=>editor.register(registration,false);},[busy,editor.register,registration]);
 useEffect(()=>{editor.durable(registration,{element,save:()=>save()});return()=>editor.durable(registration,null);},[editor.durable,element,registration,save]);
 const review=async()=>{if(currentRecord)throw new Error("Resolve the interrupted task save against the current saved task before continuing.");if(row.current?.stale&&!acknowledged)throw new Error("Review the changed source records and confirm the source check before continuing.");if(row.current){const next=await save(undefined,true);if(next.unavailable)throw new Error("The saved source no longer supports this task. Review or remove the saved task before continuing.");setAcknowledged(false);return next;}return undefined;};
 const beforeCommit=async(payload:Record<string,unknown>)=>{if(!row.current)return payload;const next=await save(leaseDraftValues(payload));if(next.unavailable)throw new Error("The saved source is unavailable. Review or remove the task before continuing.");if(next.stale)throw new Error("Source records changed after review. Return to the task details and review the current records before saving.");return{...payload,submissionKey:next.actionKey};};
 const finish=async()=>{const current=row.current;if(!current||!context.current())return;try{await monitorOperation("draft.delete",()=>api(`/api/company/task-drafts/${encodeURIComponent(current.id)}`,{method:"DELETE",body:{expectedVersion:current.version},expectedCompanyId:context.companyId}));}catch{/* A retained task keeps its same action key; it cannot create a second source. */}};
 const reviewCurrent=async()=>{
  const id=currentRecord?.id||row.current?.id;if(!id)return;
  setCheckingCurrent(true);setCurrentError("");setAcceptCurrent(false);setCurrentLoaded(false);
  try{if(!context.current())throw new Error("Reload the workspace before reviewing this task.");
   const result=await api<TaskDraft>(`/api/company/task-drafts/${encodeURIComponent(id)}`,{expectedCompanyId:context.companyId});
   if(!context.current())return;if(result.companyId!==context.companyId||result.id!==id)throw new Error("This task context changed. Reload the workspace before continuing.");
   setCurrentRecord(result);setCurrentLoaded(true);
  }catch(error){if(isReadDenied(error)){setAccessDenied(true);void refreshUser();}setCurrentError(error instanceof Error?error.message:"Unable to review the current task.");}
  finally{setCheckingCurrent(false);}
 };
 const useCurrent=()=>{
  if(!acceptCurrent||!currentRecord||!currentLoaded||checkingCurrent||busy||!context.current())return;
  pending.current=null;setUncertain(false);editor.recovery(registration,false);editor.completed(element.current||undefined);setUseCurrentRequested(true);
 };
 useEffect(()=>{
  if(!useCurrentRequested||uncertain||editor.uncertain||busy||!currentRecord||!context.current())return;
  navigate(`/company/drafts?${new URLSearchParams({draftId:currentRecord.id,taskVersion:String(currentRecord.version)})}`);
 },[useCurrentRequested,uncertain,editor.uncertain,busy,currentRecord,navigate]);
 const observeBusinessError=(error:unknown)=>{const denied=isReadDenied(error);if(denied){setAccessDenied(true);void refreshUser();}return denied;};
 const recheck=async()=>{
  setBusy(true);setError("");
  try{await refreshUser();if(!context.current())return;const current=row.current;
   const response=await api<TaskDraft & {companyId:string;id?:string}>(`/api/company/task-drafts${current?`/${encodeURIComponent(current.id)}`:""}`,{expectedCompanyId:context.companyId});
   if(context.current()&&response.companyId===context.companyId&&(!current||response.id===current.id)){if(current&&response.unavailable){row.current=response;setRecord(response);setSourceUnavailable(true);}setAccessDenied(false);}
  }catch{/* Keep private task details hidden until a fresh scoped read succeeds. */}finally{setBusy(false);}
 };
 return{record,busy,error,acknowledged,setAcknowledged,save,review,beforeCommit,finish,uncertain,writeBlocked,accessDenied,recheck,current:context.current,companyId:context.companyId,sourceUnavailable,currentRecord,checkingCurrent,currentError,currentLoaded,acceptCurrent,setAcceptCurrent,reviewCurrent,useCurrent,useCurrentRequested,observeBusinessError};
}
export function TaskDraftPanel({task}:{task:ReturnType<typeof useTaskDraft>}){
 return <section className="notice" aria-label="Saved task draft">
  <p>{task.record?<>Saved {new Date(task.record.savedAt).toLocaleString("en-US",{month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}. Expires {new Date(task.record.expiresAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}.</>:"Save this unfinished task to continue after leaving or signing in again."} <Link to="/company/drafts">Saved drafts</Link></p>
  {task.writeBlocked&&<p role="status">This task area is read-only. Your saved draft and unfinished details are retained.</p>}
  {task.uncertain&&<p role="status">The task save may already be recorded. Retry with the original task details before continuing.</p>}
  {task.record?.stale&&<><p role="alert">Source records changed since this draft was saved. Check the current property, tenant, unit and lease before continuing. Saving a draft does not apply its changes.</p><label className="checkbox-label"><input type="checkbox" checked={task.acknowledged} disabled={task.uncertain||task.writeBlocked} onChange={e=>task.setAcknowledged(e.target.checked)}/>I checked the current source records and will review this task before submitting.</label></>}
  <button type="button" className="secondary" disabled={task.busy||task.writeBlocked||!!task.currentRecord} onClick={()=>void task.save().catch(()=>{})}>{task.busy?"Saving draft…":task.uncertain?"Retry saving task draft":"Save task draft"}</button>
  {(task.uncertain||task.currentRecord) && (task.record||task.currentRecord) && <button type="button" className="secondary" disabled={task.checkingCurrent||task.busy} onClick={()=>void task.reviewCurrent()}>Review current saved task</button>}
  {task.currentRecord&&<section className="editor-section" aria-label="Resolve interrupted task save"><h3>Review the current saved task</h3>{!task.currentLoaded&&<p>Load the current saved task before acknowledging its values.</p>}<p>Current saved version {task.currentRecord.version} · Original reviewed version {task.record?.version ?? "new task"}. This comparison does not confirm who saved the current details.</p>{task.currentRecord.unavailable?<p>{task.currentRecord.sourceIssue}</p>:<details><summary>Current saved task values</summary><CurrentTaskValues task={task.currentRecord}/><Link target="_blank" rel="noopener noreferrer" to={`/company/drafts?${new URLSearchParams({draftId:task.currentRecord.id,taskVersion:String(task.currentRecord.version)})}`}>Open the current task in a separate tab</Link></details>}<label className="checkbox-label"><input type="checkbox" checked={task.acceptCurrent} disabled={!task.currentLoaded||task.checkingCurrent||task.busy} onChange={event=>task.setAcceptCurrent(event.target.checked)}/>I reviewed the current saved task. Stop retrying my earlier draft save and use this record as it is.</label><p className="help">This clears only the interrupted draft request kept on this page. It does not update the saved task or its source.</p><button type="button" className="secondary" disabled={!task.currentLoaded||!task.acceptCurrent||task.checkingCurrent||task.busy} onClick={task.useCurrent}>Use current saved task</button>{task.useCurrentRequested&&<Link to={`/company/drafts?${new URLSearchParams({draftId:task.currentRecord.id,taskVersion:String(task.currentRecord.version)})}`}>Open current saved task</Link>}</section>}
  {task.currentError&&<p role="alert" className="notice error">{task.currentError}</p>}
  {task.error&&<p role="alert" className="notice error">{task.error}</p>}
 </section>;
}

export function TaskDraftAccessNotice({task}:{task:ReturnType<typeof useTaskDraft>}){return <section className="notice error" role="alert"><p>Task access is unavailable. Its private details are hidden; an interrupted request is kept on this page for recovery.</p><button type="button" className="secondary" disabled={task.busy} onClick={()=>void task.recheck()}>{task.busy?"Checking access…":"Reload workspace"}</button></section>;}

export function TaskSourceUnavailable({task}:{task:ReturnType<typeof useTaskDraft>}){return <section className="notice" role="status"><p>The task save is recorded, but its source no longer supports this task. Its private task fields are hidden.</p><Link to={task.record?`/company/drafts?draftId=${encodeURIComponent(task.record.id)}`:"/company/drafts"}>Review or remove the unavailable saved task</Link></section>;}

function CurrentTaskValues({task}:{task:TaskDraft}) {
 const values=task.values || {};
 const fields=task.kind==="inspection" ? [["kind","Inspection type"],["inspectedOn","Inspection date"]] : [["startsOn","Start date"],["endsOn","End date"],["monthlyRent","Monthly rent (USD)"],["status","Lease status"],["rentDueDay","Rent due day"],["graceDays","Grace period (days)"],["paymentInstructions","Shared payment instructions"]];
 const shown=(key:string)=>{const value=String(values[key]??"");return ["startsOn","endsOn","inspectedOn"].includes(key)&&/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)?formatDate(value,value):value;};
 return <><dl className="lease-review-summary">{fields.map(([key,label])=><div key={key}><dt>{label}</dt><dd className="preserve-lines">{shown(key)||"Not supplied"}</dd></div>)}</dl>{task.kind==="inspection"&&Array.isArray(values.items)&&<ol>{values.items.map((raw,index)=>{const item=raw as Record<string,unknown>;return <li key={String(item.key??index)}><strong>{String(item.area||"Area not supplied")} · {String(item.item||"Item not supplied")}</strong><p>{String(item.condition||"Not checked")}</p><p className="preserve-lines">{String(item.notes||"No observation notes")}</p></li>;})}</ol>}</>;
}
