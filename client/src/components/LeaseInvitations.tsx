import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { formatDate } from "../dates";
import { Form } from "../pages/Workspace";
import { DateField } from "./DateField";
import { EditorDialog } from "./EditorDialog";

type Invitation={id:string;email:string;participantName:string;participantRole:string;approvedAt:string|null;acceptedAt:string|null;revokedAt:string|null;expiresAt:string};
export function LeaseInvitations({leaseId,startsOn,resident=false}:{leaseId:string;startsOn:string;resident?:boolean}){
  const url=`/api/${resident?"resident":"company"}/leases/${encodeURIComponent(leaseId)}/invitations`,r=useResource<Invitation[]>(url,true,true);
  const owner=useAuth().can("members.manage");
  const [link,setLink]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function action(id:string,action:string){if(busy)return;setBusy(true);setError("");try{const row=await api<{acceptanceUrl?:string}>(`${url}/${encodeURIComponent(id)}/${action}`,{method:"POST",body:{}});if(row.acceptanceUrl)setLink(row.acceptanceUrl);}catch(e){setError(e instanceof Error?e.message:"Unable to update invitation. Refresh its status before retrying. If an approved link was not copied, revoke the invitation and create another.");}finally{setBusy(false);r.reload();}}
  return <section aria-label="Resident invitations">
    <h2>{owner?"Invite and approve residents":"Request a resident invitation"}</h2>
    <p>Owners approve every new resident. Only leaseholders receive access to the shared lease finances; occupants do not.</p>
    <Form label={owner?"Create resident invitation":"Request owner approval"} operation="invitation.create" successText={owner?"Invitation ready. Copy the approved link.":"Request awaiting owner approval."} feedbackText={owner?"Resident invitation created. Copy the approved link.":"Resident request submitted for owner approval."} submit={async f=>{setLink("");try{const row=await api<{acceptanceUrl:string|null}>(url,{method:"POST",body:{name:f.get("name"),email:f.get("email"),role:f.get("role"),startsOn:f.get("startsOn")}});setLink(row.acceptanceUrl||"");}finally{r.reload();}}}>
      <fieldset className="form-section"><legend>Invitation details</legend><p className="help">All four fields are required. No email is sent automatically. Approved links expire after 72 hours and require the recipient’s matching verified email.</p><div className="form-grid">
        <label>Invited resident name<input name="name" required maxLength={200}/></label>
        <label>Invited resident email<input name="email" type="email" required maxLength={254}/></label>
        <label>Requested resident role<select name="role" aria-label="Requested resident role" defaultValue="occupant"><option value="occupant">Occupant · no financial access</option><option value="leaseholder">Leaseholder · shared financial access</option></select></label>
        <label>Invited resident start date<DateField aria-label="Invited resident start date" name="startsOn" required defaultValue={startsOn.slice(0,10)}/></label>
      </div></fieldset>
      <p className="help">Owner approval saves a tenant profile for tracking. Verified acceptance connects their login and adds the approved household access. To invite a profile you already recorded, use Leaseholders & occupants. It does not change the rent, sign an agreement or split the balance.</p>
    </Form>
    {link&&<label className="notice">Approved invitation link<input className="dd-privacy-hidden" readOnly value={link} aria-label="Resident invitation acceptance link" onFocus={e=>e.currentTarget.select()}/><span>Copy and share this link now. It is shown once.</span></label>}
    {error&&<p role="alert" className="notice error">{error}</p>}
    {r.error?<p role="alert">{r.error} <button onClick={r.reload}>Refresh invitations</button></p>:!r.data?<p role="status">Loading invitations…</p>:!r.data.length?<p className="help">No resident invitations yet.</p>:<ul className="record-list">{r.data.map(i=>{
      const status=i.acceptedAt?"Accepted":i.revokedAt?"Revoked":new Date(i.expiresAt).getTime()<=Date.now()?"Expired":!i.approvedAt?"Awaiting owner approval":"Awaiting verified acceptance";
      return <li key={i.id}><div><h3>{i.participantName}</h3><p>{i.email} · {i.participantRole}</p><p className="help">{status} · Expires {new Date(i.expiresAt).toLocaleString("en-US",{month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"})}</p></div>{!i.acceptedAt&&!i.revokedAt&&status!=="Expired"&&(owner||!i.approvedAt)&&<div className="actions">{owner&&!i.approvedAt&&<button disabled={busy} onClick={()=>void action(i.id,"approve")}>Approve resident {i.participantName}</button>}<button disabled={busy} className="secondary" onClick={()=>void action(i.id,"revoke")}>{owner?"Revoke":"Cancel"} invitation for {i.participantName}</button></div>}</li>;
    })}</ul>}
  </section>;
}

type ResidentLease={id:string;startsOn:string;endsOn:string|null;property:{name:string};unit:{label:string}};
export function ResidentLeaseInvitations(){
  const r=useResource<ResidentLease[]>("/api/resident/leases",true,true);
  return <section className="panel"><h2>Your lease household</h2><p>Leaseholders can request invitations for additional residents. Owners approve every addition and control resident changes.</p>{r.error?<p role="alert">{r.error} <button onClick={r.reload}>Try again</button></p>:!r.data?<p role="status">Loading your leases…</p>:!r.data.length?<p className="help">No leaseholder invitation access. Contact your owner or manager to update your household.</p>:r.data.map(lease=><ResidentLeaseInvitation key={lease.id} lease={lease}/>)}</section>;
}
function ResidentLeaseInvitation({lease}:{lease:ResidentLease}){
  const [open,setOpen]=useState(false);
  return <div className="editor-section"><h3>{lease.property.name} · {lease.unit.label}</h3><p>{formatDate(lease.startsOn)} through {formatDate(lease.endsOn,"Open ended")}</p><button className="secondary" onClick={()=>setOpen(true)}>Invite a resident · {lease.unit.label}</button><EditorDialog open={open} title={`Request resident invitation · ${lease.unit.label}`} onClose={()=>setOpen(false)}><LeaseInvitations leaseId={lease.id} startsOn={lease.startsOn} resident/></EditorDialog></div>;
}
