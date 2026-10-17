import { EditorDialog } from "./EditorDialog";
import { TenantInvitation } from "./TenantInvitation";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useResource } from "../useResource";
import { formatDate } from "../dates";
import { Form } from "../pages/Workspace";
import { DateField } from "./DateField";
import { useAuth } from "../context/AuthContext";

type Participant = {id:string;contactId?:string|null;userId:string|null;name:string;email:string|null;phone:string|null;role:string;startsOn:string;endsOn:string|null;removedAt:string|null;portalApproved?:boolean;version:number};
type Household = {contacts?:{id:string;userId:string|null;name:string;email:string|null;phone:string|null}[];businessDate:string;lease:{residentId:string|null;residentContactId?:string|null;version:number;resident:{name:string|null;email:string};startsOn:string;endsOn:string|null};items:Participant[];candidates:{userId:string;contactName:string|null;user:{name:string|null;email:string;emailVerified:boolean}}[]};
export function LeaseHousehold({leaseId,onChange}:{leaseId:string;onChange?:()=>void}) {
  const editable=useAuth().can("members.manage");
  const url=`/api/company/leases/${encodeURIComponent(leaseId)}/participants`,r=useResource<Household>(url,true,true);
  const [inviteContact,setInviteContact]=useState<string|null>(null);
  const [existingOnly,setExistingOnly]=useState(false);
  const [adding,setAdding]=useState(false),[selected,setSelected]=useState<Participant|null>(null),[key,setKey]=useState(()=>crypto.randomUUID());
  const [removing,setRemoving]=useState<Participant|null>(null);
  const [primarySelection,setPrimarySelection]=useState<{id:string;version:number}|null>(null);
  const changed=()=>{r.reload();onChange?.();};
  if(!r.data)return <div>{r.error?<p role="alert">{r.error} <button onClick={r.reload}>Try again</button></p>:<p role="status">Loading household…</p>}</div>;
  const data=r.data;
  const primary=(p:Participant)=>p.contactId&&data.lease.residentContactId?p.contactId===data.lease.residentContactId:!!p.userId&&p.userId===data.lease.residentId;
  return <section aria-label="Lease household">
    <div className="section-heading"><div><h2>Leaseholders and occupants</h2><p>One unit, one lease, one shared rent and deposit balance.</p></div>{editable&&<div className="actions"><button className="secondary" disabled={!!r.error||adding||!!selected} onClick={()=>{setExistingOnly(true);setAdding(true);setSelected(null);setKey(crypto.randomUUID());}}>Add existing tenant</button><button disabled={!!r.error||adding||!!selected} onClick={()=>{setExistingOnly(false);setAdding(true);setSelected(null);setKey(crypto.randomUUID());}}>Add resident</button></div>}</div>
    {r.error&&<p role="alert">{r.error} <button onClick={r.reload}>Refresh household</button></p>}
    <ul className="record-list household-list">
      {!data.items.some(primary)&&<li><div><h3>{data.lease.resident.name||data.lease.resident.email}</h3><p>Leaseholder · Primary contact</p><p className="help">{data.lease.resident.email}</p></div><span className="badge">Primary</span></li>}
      {data.items.map(p=><li key={p.id}><div><h3>{p.name}</h3><p>{p.role==="leaseholder"?"Leaseholder":"Occupant"}{primary(p)?" · Primary contact":""} · {p.removedAt?"Removed":p.userId&&p.role==="leaseholder"&&p.portalApproved===false?"Owner review required":p.userId?"Account linked":"Record only"}</p><p className="help">{formatDate(p.startsOn)} through {formatDate(p.endsOn,"Open ended")}{p.removedAt?` · Removed ${new Date(p.removedAt).toLocaleString("en-US",{month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"})}`:""}</p>{(p.email||p.phone)&&<p className="help">{[p.email,p.phone].filter(Boolean).join(" · ")}</p>}{p.contactId&&<Link className="tenant-row-action" to={`/company/tenants/${encodeURIComponent(p.contactId)}`}>View profile{!p.userId?" & portal invitation":""} →</Link>}</div>{editable&&!p.removedAt&&<button className="secondary" aria-label={`Manage resident ${p.name}`} disabled={!!r.error} onClick={()=>setSelected(p)}>Manage</button>}</li>)}
    </ul>
    <p className="help">Leaseholders with a verified, active account and current property access can see shared balances, including before move-in. Their recorded end date or removal ends access. Occupants have no lease financial access. Every leaseholder and occupant requires an Auth0 sign-in account; portal access is approved separately.</p>
    {editable&&<details className="editor-section"><summary>Primary contact · {data.lease.resident.name||data.lease.resident.email}</summary><Form label="Update primary contact" operation="lease.update" feedbackText="Primary leaseholder contact updated." secondaryActions={primarySelection?<button type="button" className="secondary" onClick={()=>{setPrimarySelection(null);r.reload();}}>Discard primary-contact change</button>:undefined} submit={async f=>{await api(`/api/company/leases/${encodeURIComponent(leaseId)}/primary-resident`,{method:"POST",body:{participantId:f.get("participantId"),expectedVersion:primarySelection?.version??data.lease.version}});setPrimarySelection(null);changed();}}><label>Primary leaseholder contact<select name="participantId" aria-label="Primary leaseholder contact" required value={primarySelection?.id??data.items.find(primary)?.id??""} onChange={e=>setPrimarySelection({id:e.target.value,version:data.lease.version})}><option value="">Choose a current leaseholder</option>{data.items.filter(p=>p.role==="leaseholder"&&(!p.userId||p.portalApproved!==false)&&!p.removedAt&&(!p.endsOn||p.endsOn.slice(0,10)>=data.businessDate)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="help">Changing the primary contact preserves every resident and all lease money records. Remove a departed resident separately to revoke their shared lease access.</p></Form></details>}
    {(adding||selected)&&<ParticipantForm key={selected?`${selected.id}:${selected.version}`:key} data={data} value={selected} existingOnly={existingOnly} remove={selected?()=>setRemoving(selected):undefined} cancel={()=>{setAdding(false);setSelected(null);setKey(crypto.randomUUID());}} save={async(body,invite)=>{const row=await api<Participant>(selected?`${url}/${encodeURIComponent(selected.id)}`:url,{method:selected?"PATCH":"POST",body:{...body,...(selected?{expectedVersion:selected.version}:{submissionKey:key})}});setAdding(false);setSelected(null);setKey(crypto.randomUUID());if(invite&&row.contactId)setInviteContact(row.contactId);changed();}}/>}
    <EditorDialog open={!!inviteContact} title="Invite household resident" onClose={()=>{setInviteContact(null);changed();}}>{inviteContact&&<TenantInvitation key={inviteContact} contactId={inviteContact} done={()=>{setInviteContact(null);changed();}}/>}</EditorDialog>
    {removing&&<Form key={removing.id} label={`Confirm removal of ${removing.name}`} operation="lease.update" feedbackText="Resident removed. Shared lease access revoked." secondaryActions={<button type="button" className="secondary" onClick={()=>setRemoving(null)}>Keep resident</button>} submit={async()=>{await api(`${url}/${encodeURIComponent(removing.id)}/remove`,{method:"POST",body:{expectedVersion:removing.version}});setRemoving(null);setSelected(null);changed();}}><p className="notice">Remove {removing.name} from this household? Their access to this shared lease ends immediately. Their historical record and all rent/deposit transactions remain. Other leases and property access are managed separately.</p></Form>}
  </section>;
}
function ParticipantForm({data,value,cancel,save,remove,existingOnly=false}:{data:Household;value:Participant|null;existingOnly?:boolean;cancel:()=>void;remove?:()=>void;save:(body:Record<string,unknown>,invite:boolean)=>Promise<void>}){
  const fields=useRef<HTMLFieldSetElement>(null);
  useEffect(()=>{fields.current?.querySelector<HTMLInputElement|HTMLSelectElement>(existingOnly?'select[aria-label="Tenant profile"]':'input[name="name"]')?.focus();},[existingOnly]);
  const [linked,setLinked]=useState(""),[invitePortal,setInvitePortal]=useState(false);
  const contact=data.contacts?.find(c=>c.id===linked);
  const candidate=contact?undefined:data.candidates.find(c=>c.userId===linked);
  const [role,setRole]=useState(value?.role||"occupant"),[portalApproved,setPortalApproved]=useState(value?.portalApproved??true);
  return <Form label={value?"Save household resident":"Add to household"} operation="lease.update" feedbackText={value?"Household resident details saved.":"Resident added to this household."} secondaryActions={<><button type="button" className="secondary" onClick={cancel}>Discard resident changes</button>{remove&&<button type="button" className="secondary" onClick={remove}>Remove this resident</button>}</>} submit={async f=>save({name:f.get("name"),email:f.get("email")||null,phone:f.get("phone")||null,role,portalApproved,startsOn:f.get("startsOn"),endsOn:f.get("endsOn")||null,...(!value?contact?{contactId:contact.id}:{userId:linked||null}:{})},invitePortal)}>
    <fieldset ref={fields} className="form-section"><legend>{value?"Edit household resident":"Resident details"}</legend>
      <p className="help">Name, role and start date are required. A new tenant also needs a sign-in email. End date and phone are optional.</p>
      {!value&&<label>Tenant profile<select aria-label="Tenant profile" required={existingOnly} value={linked} onChange={e=>setLinked(e.target.value)}><option value="">{existingOnly?"Choose an existing tenant":"Create a new tenant profile"}</option>{data.contacts?data.contacts.filter(c=>c.id!==data.lease.residentContactId&&!data.items.some(p=>p.contactId===c.id)).map(c=><option key={c.id} value={c.id}>{c.name}{c.email?` · ${c.email}`:""}</option>):data.candidates.filter(c=>c.userId!==data.lease.residentId&&!data.items.some(p=>p.userId===c.userId)).map(c=><option key={c.userId} value={c.userId}>{c.contactName||c.user.name||c.user.email}</option>)}</select><span className="help">Every resident has a tenant profile. Saving this household resident creates or reuses their Auth0 account. Invite from their profile to activate portal access.</span></label>}

      {(contact||candidate)&&<p className="notice">This reuses the existing tenant and account. An active portal account will be connected to this property. Leaseholders can see shared balances only when approved below; occupants have no financial access. Rent, deposits and earlier records stay the same.</p>}
      <div className="form-grid">
        <label>Resident full name<input key={linked} name="name" required maxLength={200} defaultValue={value?.name||contact?.name||candidate?.contactName||candidate?.user.name||""}/></label>
        <label>Resident role<select aria-label="Resident role" value={role} onChange={e=>setRole(e.target.value)}><option value="occupant">Occupant · no financial access</option><option value="leaseholder">Leaseholder · shared financial access</option></select></label>
        <label>Resident contact email<input key={linked} name="email" type="email" required={(!value&&!contact&&!candidate)||invitePortal} maxLength={254} defaultValue={value?.email||contact?.email||candidate?.user.email||""}/></label>
        <label>Resident contact phone<input name="phone" type="tel" maxLength={40} key={linked} defaultValue={value?.phone||contact?.phone||""}/></label>
        <label>Resident start date<DateField name="startsOn" aria-label="Resident start date" required defaultValue={(value?.startsOn||data.lease.startsOn).slice(0,10)}/></label>
        <label>Resident end date<DateField name="endsOn" aria-label="Resident end date" defaultValue={value?.endsOn?.slice(0,10)}/></label>
      </div>
      {!(value?.userId||contact?.userId||candidate)&&<label>Invite to the portal?<select aria-label="Invite household resident to portal" value={invitePortal?"yes":"no"} onChange={e=>setInvitePortal(e.target.value==="yes")}><option value="no">No · keep a profile for tracking</option><option value="yes">Yes · review access and create a link after saving</option></select><span className="help">Their tenant profile is saved either way. An invitation connects their verified login to that same profile.</span></label>}
      {role==="leaseholder"&&(contact?.userId||candidate||value?.userId)&&<label className="checkbox-label"><input type="checkbox" checked={portalApproved} onChange={e=>setPortalApproved(e.target.checked)}/>Approve this leaseholder’s portal access<p className="help">Check only after reviewing this person for this lease. Unreviewed renewal participants cannot see the new lease. Residents contact management for household changes.</p></label>}
      <p className="help">Use an end date to retain a departed resident’s history. The end date is inclusive; access ends the following day. This updates the household record without changing rent, deposits or signed documents.</p>
      {role==="leaseholder"&&<p className="notice">Confirm this person belongs on the lease. An approved, linked leaseholder can see the entire shared lease balance, including before move-in. Individual rent shares are not created.</p>}
    </fieldset>
  </Form>;
}
