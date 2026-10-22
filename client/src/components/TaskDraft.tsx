import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, ApiError } from "../api";
import { useEditorBusy } from "./EditorDialog";
import { monitorOperation } from "../operations";
export type TaskDraftKind="lease_create"|"lease_renewal"|"inspection";
export type TaskDraft={id:string;kind:TaskDraftKind;propertyId:string;sourceId:string|null;version:number;actionKey:string;values:Record<string,unknown>;context:Record<string,string>;sourceVersions:Record<string,{id:string;version:number}>;title:string;savedAt:string;expiresAt:string;stale:boolean;property?:{id:string;name:string}};
const leaseNames=["unitId","residentId","residentContactId","startsOn","endsOn","monthlyRent","status","rentDueDay","graceDays","paymentInstructions"];
export function leaseDraftValues(payload:Record<string,unknown>):Record<string,string>{return Object.fromEntries(leaseNames.filter(name=>payload[name]!==undefined&&payload[name]!==null).map(name=>[name,String(payload[name])]));}
export function readLeaseDraft(element:HTMLElement|null,contactId?:string):Record<string,string>{
 const form=element?.querySelector<HTMLFormElement>("form[data-task-values]");if(!form)throw new Error("Open the task details before saving a draft.");
 const data=new FormData(form),values=Object.fromEntries(leaseNames.filter(name=>data.has(name)).map(name=>[name,String(data.get(name)||"")]));
 if(contactId){delete values.residentId;values.residentContactId=contactId;}return values;
}
export function useTaskDraft({kind,propertyId,sourceId=null,initial,element,readValues,disabled=false}:{kind:TaskDraftKind;propertyId:string;sourceId?:string|null;initial?:TaskDraft;element:RefObject<HTMLElement>;readValues:()=>Record<string,unknown>;disabled?:boolean}){
 const editor=useEditorBusy(),registration=useId(),location=useLocation();
 const originContext=useRef((()=>{const params=new URLSearchParams(location.search),context:Record<string,string>={};for(const [input,key]of [["q","leaseListQ"],["status","leaseListStatus"],["propertyId","leaseListProperty"],["unitId","leaseListUnit"]]){const value=params.get(input);if(value)context[key]=value;}const nested=location.pathname.match(/^\/company\/properties\/([^/]+)\/leases$/);if(nested){context.leaseListProperty=decodeURIComponent(nested[1]);context.leaseListNested="true";}return context;})());
 const [record,setRecord]=useState<TaskDraft|undefined>(initial),[busy,setBusy]=useState(false),[error,setError]=useState(""),[acknowledged,setAcknowledged]=useState(false);
 const row=useRef(record);row.current=record;
 const createKey=useRef(crypto.randomUUID()),pending=useRef<{path:string;method:string;body:unknown}|null>(null),latestRead=useRef(readValues);latestRead.current=readValues;
 const save=useCallback(async(values?:Record<string,unknown>,reviewSources=false)=>{
  setBusy(true);setError("");
  try{
   if(disabled||editor.uncertain)throw new Error("Recover the submitted request first. Submitted requests cannot become new drafts.");
   const current=row.current;
   const request=pending.current||{path:`/api/company/task-drafts${current?`/${encodeURIComponent(current.id)}`:""}`,method:current?"PATCH":"POST",body:current?{values:values||latestRead.current(),context:current.context,expectedVersion:current.version,submissionKey:crypto.randomUUID(),reviewSources}:{kind,propertyId,sourceId,values:values||latestRead.current(),context:originContext.current,submissionKey:createKey.current}};
   pending.current=request;
   const result=await monitorOperation("draft.save",()=>api<TaskDraft>(request.path,{method:request.method,body:request.body}));
   pending.current=null;row.current=result;setRecord(result);editor.draftSaved(element.current||undefined);return result;
  }catch(caught){if(caught instanceof ApiError&&!caught.submissionUncertain)pending.current=null;setError(caught instanceof Error?caught.message:"Unable to save this draft.");throw caught;}finally{setBusy(false);}
 },[disabled,editor.uncertain,editor.draftSaved,kind,propertyId,sourceId]);
 useEffect(()=>{editor.register(registration,busy);return()=>editor.register(registration,false);},[busy,editor.register,registration]);
 useEffect(()=>{editor.durable(registration,{element,save:()=>save()});return()=>editor.durable(registration,null);},[editor.durable,element,registration,save]);
 const review=async()=>{if(row.current?.stale&&!acknowledged)throw new Error("Review the changed source records and confirm the source check before continuing.");if(row.current){const next=await save(undefined,true);setAcknowledged(false);return next;}return undefined;};
 const beforeCommit=async(payload:Record<string,unknown>)=>{if(!row.current)return payload;const next=await save(leaseDraftValues(payload));if(next.stale)throw new Error("Source records changed after review. Return to the task details and review the current records before saving.");return{...payload,submissionKey:next.actionKey};};
 const finish=async()=>{const current=row.current;if(!current)return;try{await monitorOperation("draft.delete",()=>api(`/api/company/task-drafts/${encodeURIComponent(current.id)}`,{method:"DELETE",body:{expectedVersion:current.version}}));}catch{/* A retained task keeps its same action key; it cannot create a second source. */}};
 return{record,busy,error,acknowledged,setAcknowledged,save,review,beforeCommit,finish};
}
export function TaskDraftPanel({task}:{task:ReturnType<typeof useTaskDraft>}){
 return <section className="notice" aria-label="Saved task draft">
  <p>{task.record?<>Saved {new Date(task.record.savedAt).toLocaleString("en-US",{month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})}. Expires {new Date(task.record.expiresAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}.</>:"Save this unfinished task to continue after leaving or signing in again."} <Link to="/company/drafts">Saved drafts</Link></p>
  {task.record?.stale&&<><p role="alert">Source records changed since this draft was saved. Check the current property, tenant, unit and lease before continuing. Saving a draft does not apply its changes.</p><label className="checkbox-label"><input type="checkbox" checked={task.acknowledged} onChange={e=>task.setAcknowledged(e.target.checked)}/>I checked the current source records and will review this task before submitting.</label></>}
  <button type="button" className="secondary" disabled={task.busy} onClick={()=>void task.save().catch(()=>{})}>{task.busy?"Saving draft…":"Save task draft"}</button>
  {task.error&&<p role="alert" className="notice error">{task.error}</p>}
 </section>;
}
