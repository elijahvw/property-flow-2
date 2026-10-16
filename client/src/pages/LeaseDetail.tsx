import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { api } from "../api";
import { formatDate } from "../dates";
import { LeaseTerms, LeaseRenewal, type Lease } from "./Leasing";
import { LeaseHousehold } from "../components/LeaseHousehold";
import { LeaseInvitations } from "../components/LeaseInvitations";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "./Workspace";
import { dollars } from "./Finances";
import { leaseContext,leaseDirectoryPath } from "../lease-links";
import { TenantReturnLink } from "../components/TenantReturnLink";
import { statementPath } from "../statement";

export function LeaseDetail(){
  const {leaseId=""}=useParams(),{data}=useAuth();
  return <LeaseWorkspace key={`${leaseId}:${data?.user.id}:${data?.membership?.companyId}:${data?.permissions.join(",")}`} id={leaseId}/>;
}
function LeaseWorkspace({id}:{id:string}){
  const {can}=useAuth();
  const r=useResource<Lease>(`/api/company/leases/${encodeURIComponent(id)}`,true,true),navigate=useNavigate();
  const [params,setParams]=useSearchParams(),[editing,setEditing]=useState(false),[renewing,setRenewing]=useState(false);
  const [draftLease,setDraftLease]=useState<Lease|null>(null),[renewalDraft,setRenewalDraft]=useState<Lease|null>(null),[visited,setVisited]=useState<string[]>([]);
  const section=["overview","household","invitations","renewal"].includes(params.get("section")||"")?params.get("section")!:params.has("onboarding")?"household":"overview";
  useEffect(()=>{setVisited(previous=>previous.includes(section)?previous:[...previous,section]);},[section]);
  if(!r.data)return <section className="panel"><Link to="/company/leases">← All leases</Link>{r.error?<><h1>Lease unavailable</h1><p role="alert">{r.error}</p><button onClick={r.reload}>Try again</button></>:<p role="status">Loading lease workspace…</p>}</section>;
  const lease=r.data;
  const context=leaseContext(params),directory=leaseDirectoryPath(params);
  const editTerms=()=>{setDraftLease(previous=>previous||lease);setEditing(true);};
  const tab=(value:string)=>setParams({...context,section:value});
  const source=(module:string)=>`/company/${module}?${new URLSearchParams({...context,leaseId:id,leaseReturn:id})}`;
  return <div className="lease-workspace">
    <TenantReturnLink />
    <nav className="record-breadcrumb" aria-label="Breadcrumb"><Link to={directory}>← All leases</Link><span>/</span><Link to={`/company/properties/${encodeURIComponent(lease.propertyId)}`}>{lease.property.name}</Link><span>/</span><span>{lease.unit.label}</span></nav>
    <header className="page-heading"><p className="record-kicker">Lease workspace</p><h1>{lease.property.name} · {lease.unit.label}</h1><p>{lease.resident.name||lease.resident.email} · {lease.status} · {formatDate(lease.startsOn)} through {formatDate(lease.endsOn,"Open ended")}</p></header>
    {r.error&&<p className="notice error" role="alert">{r.error} <button onClick={r.reload}>Refresh lease</button></p>}
    <nav className="lease-section-nav" aria-label="Lease sections">{[["overview","Overview & next steps"],["household","Leaseholders & occupants"],["invitations","Invitations & approvals"],["renewal","Renewal"]].map(([value,label])=><button key={value} className={section===value?"":"secondary"} aria-current={section===value?"page":undefined} onClick={()=>tab(value)}>{label}</button>)}</nav>
    {section==="overview"&&<section className="panel"><h2>{lease.status==="draft"?"Finish lease onboarding":"Manage this lease"}</h2><p>Work through the lease in order. Each step keeps this property, unit and household together.</p><ol className="lease-next-steps">
      <li><div><h3>Confirm the household</h3><p>Add leaseholders and occupants, including residents who do not need portal access.</p></div><button className="secondary" onClick={()=>tab("household")}>Review household</button></li>
      <li><div><h3>Approve and invite residents</h3><p>Review requested roles and share approved, verified-email invitation links.</p></div><button className="secondary" onClick={()=>tab("invitations")}>Review invitations</button></li>
      <li><div><h3>Review the lease terms</h3><p>{dollars(lease.rentCents)} per month · Due day {lease.rentDueDay??1} · {lease.graceDays??0} days grace. {lease.status==="draft"?"Activate only when the record is ready.":"Changes preserve posted financial history."}</p></div><button className="secondary" disabled={!!r.error} onClick={editTerms}>Review lease terms</button></li>
      <li><div><h3>Set up the deposit and rent</h3><p>Review the deposit requirement, posted rent and recurring billing. Each source keeps its own recorded history.</p></div><div className="actions"><Link to={source("deposits")}>Open deposit</Link><Link to={source("rent")}>Open rent & billing</Link></div></li>
    <li><div><h3>Review the tenant statement</h3><p>See rent activity, shared balances and the separate security deposit together. Download a traceable statement for your records.</p></div>{can("finance.manage")&&<Link to={statementPath(id,false,{...context,statementFrom:"lease"})}>View statement →</Link>}</li>
    </ol><p className="help">These are guided next steps, not a claim that documents are signed, invitations accepted or money received.</p></section>}
    {(section==="household"||visited.includes("household"))&&<section className="panel" hidden={section!=="household"}><LeaseHousehold leaseId={id} onChange={r.reload}/><button className="secondary" onClick={()=>tab("invitations")}>Continue to invitations →</button></section>}
    {(section==="invitations"||visited.includes("invitations"))&&<section className="panel" hidden={section!=="invitations"}><LeaseInvitations leaseId={id} startsOn={lease.startsOn}/><button className="secondary" onClick={()=>tab("overview")}>Return to next steps</button></section>}
    {section==="renewal"&&<section className="panel"><h2>Renew this lease</h2><ol className="lease-next-steps"><li>Review the existing term, household, balances and deposit.</li><li>Set an end date on the current lease and prepare the next term as a linked draft.</li><li>Review the renewal’s household, new terms, deposit and billing before ending the old term and activating the new one.</li></ol><p className="help">The current lease keeps its financial history. A renewal draft does not post rent or end the current lease automatically. Household additions are reviewed on the new term.</p>{lease.previousLeaseId&&<p>Previous term: <Link to={`/company/leases/${encodeURIComponent(lease.previousLeaseId)}`}>Open previous lease</Link></p>}{lease.renewals?.length?<p><Link className="button" to={`/company/leases/${encodeURIComponent(lease.renewals[0].id)}`}>Continue renewal draft</Link></p>:lease.status==="draft"?<p>Finish this draft before preparing a following term.</p>:!lease.endsOn?<button onClick={editTerms}>Set the current lease end date</button>:<button onClick={()=>{setRenewalDraft(previous=>previous||lease);setRenewing(true);}} disabled={!!r.error}>Prepare linked renewal</button>}</section>}
    <EditorDialog open={editing} title="Review lease terms" onClose={()=>setEditing(false)}>{draftLease&&<Form key={`${draftLease.id}:${draftLease.version}`} label="Save lease terms" operation="lease.update" secondaryActions={<button type="button" className="secondary" onClick={()=>{setDraftLease(null);setEditing(false);r.reload();}}>Discard lease changes</button>} submit={async f=>{await api(`/api/company/leases/${encodeURIComponent(id)}`,{method:"PATCH",body:{...Object.fromEntries(f),endsOn:f.get("endsOn")||null,rentDueDay:Number(f.get("rentDueDay")),graceDays:Number(f.get("graceDays")),paymentInstructions:f.get("paymentInstructions")||null,expectedVersion:draftLease.version}});setEditing(false);setDraftLease(null);r.reload();}}><LeaseTerms prefix="Lease" value={draftLease}/></Form>}</EditorDialog>
    <EditorDialog open={renewing} title="Prepare linked renewal" onClose={()=>setRenewing(false)}>{renewalDraft?.endsOn&&<LeaseRenewal previous={renewalDraft} saved={row=>{setRenewing(false);setRenewalDraft(null);navigate(`/company/leases/${encodeURIComponent(row.id)}?onboarding=household`);}}/>}</EditorDialog>
  </div>;
}
