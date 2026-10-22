import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import type { TaskDraft } from "../components/TaskDraft";
import { LeaseCreate,LeaseRenewal,type Lease } from "./Leasing";
import { SavedInspectionTask } from "../components/LeaseInspections";
import { monitorOperation } from "../operations";
export function SavedDrafts(){const [params]=useSearchParams(),{data}=useAuth(),id=params.get("draftId"),scope=`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}`;return id?<SavedTask key={`${scope}:${id}`} id={id}/>:<DraftList key={scope}/>;}
function DraftList(){
 const r=useResource<{items:Pick<TaskDraft,"id"|"title"|"kind"|"version"|"savedAt"|"expiresAt">[];hasMore:boolean}>("/api/company/task-drafts",true,true),[error,setError]=useState(""),[deleting,setDeleting]=useState<string|null>(null);
 return <><header className="page-heading"><p className="eyebrow">Your work</p><h1>Saved drafts</h1><p>Continue your unfinished lease, renewal or inspection tasks. Drafts are private to your account and company. Saving a draft never posts money, changes a lease or submits an inspection.</p></header>{error&&<p role="alert" className="notice error">{error}</p>}{r.error?<p role="alert">{r.error} <button onClick={r.reload}>Try again</button></p>:!r.data?<p role="status">Loading saved drafts…</p>:<section className="panel" aria-label="Your saved tasks">{!r.data.items.length?<p>No saved drafts. Choose Save task draft in a supported task when you want to continue later.</p>:<ul>{r.data.items.map(row=><li className="record-card" key={row.id}><h2><Link to={`?draftId=${encodeURIComponent(row.id)}`}>{row.title}</Link></h2><p>Saved {new Date(row.savedAt).toLocaleString("en-US",{month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"})} · Expires {new Date(row.expiresAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</p><div className="actions"><Link className="button" to={`?draftId=${encodeURIComponent(row.id)}`}>Continue task</Link><button className="secondary" disabled={deleting===row.id} onClick={async()=>{if(!window.confirm("Delete this saved draft? Your source records will remain unchanged."))return;setDeleting(row.id);setError("");try{await monitorOperation("draft.delete",()=>api(`/api/company/task-drafts/${encodeURIComponent(row.id)}`,{method:"DELETE",body:{expectedVersion:row.version}}));r.reload();}catch(error){setError(error instanceof Error?error.message:"Unable to delete this draft.");}finally{setDeleting(null);}}}>Delete draft</button></div></li>)}</ul>}<p className="help">Drafts expire 30 days after the latest save. Uploaded files and pending submitted financial requests are not stored here.</p></section>}</>;
}
function SavedTask({id}:{id:string}){
 const r=useResource<TaskDraft>(`/api/company/task-drafts/${encodeURIComponent(id)}`,true,true),navigate=useNavigate();
 if(!r.data)return <section className="status-panel"><h1>Saved task</h1>{r.error?<p role="alert">{r.error} <button onClick={r.reload}>Try again</button></p>:<p role="status">Loading your saved task…</p>}<Link to="/company/drafts">Back to saved drafts</Link></section>;
 return <EditorDialog presentation="page" title={r.data.title} open onClose={()=>navigate("/company/drafts")} backLabel="Back to saved drafts"><SavedTaskContent key={r.data.id} task={r.data}/></EditorDialog>;
}
function SavedTaskContent({task}:{task:TaskDraft}){
 const navigate=useNavigate();
 if(task.kind==="lease_create")return <LeaseCreate propertyId={task.propertyId} propertyName={task.property?.name||"Property"} initialTask={task} saved={row=>navigate(`/company/leases/${encodeURIComponent(row.id)}?onboarding=household`)}/>;
 if(task.kind==="inspection")return <SavedInspectionTask task={task} saved={id=>navigate(`/company/leases/${encodeURIComponent(task.sourceId!)}?section=inspections&inspectionId=${encodeURIComponent(id)}`)}/>;
 return <RenewalTask task={task}/>;
}

function RenewalTask({task}:{task:TaskDraft}){const navigate=useNavigate(),lease=useResource<Lease>(`/api/company/leases/${encodeURIComponent(task.sourceId!)}`,true,true);if(!lease.data)return <p role={lease.error?"alert":"status"}>{lease.error||"Loading the current lease…"}</p>;return <LeaseRenewal previous={lease.data} initialTask={task} saved={row=>navigate(`/company/leases/${encodeURIComponent(row.id)}`)}/>;}
