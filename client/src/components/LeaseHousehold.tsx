import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useResource } from "../useResource";
import { formatDate } from "../dates";
import { Form } from "../pages/Workspace";
import { DateField } from "./DateField";
import { useAuth } from "../context/AuthContext";

type Participant = {id:string;userId:string|null;name:string;email:string|null;phone:string|null;role:string;startsOn:string;endsOn:string|null;removedAt:string|null;version:number};
type Household = {businessDate:string;lease:{residentId:string;version:number;resident:{name:string|null;email:string};startsOn:string;endsOn:string|null};items:Participant[];candidates:{userId:string;contactName:string|null;user:{name:string|null;email:string;emailVerified:boolean}}[]};
export function LeaseHousehold({leaseId,onChange}:{leaseId:string;onChange?:()=>void}) {
  const editable=useAuth().can("members.manage");
  const url=`/api/company/leases/${encodeURIComponent(leaseId)}/participants`,r=useResource<Household>(url,true,true);
  const [adding,setAdding]=useState(false),[selected,setSelected]=useState<Participant|null>(null),[key,setKey]=useState(()=>crypto.randomUUID());
  const [removing,setRemoving]=useState<Participant|null>(null);
  const [primarySelection,setPrimarySelection]=useState<{id:string;version:number}|null>(null);
  const changed=()=>{r.reload();onChange?.();};
  if(!r.data)return <div>{r.error?<p role="alert">{r.error} <button onClick={r.reload}>Try again</button></p>:<p role="status">Loading household…</p>}</div>;
  const data=r.data;
  return <section aria-label="Lease household">
    <div className="section-heading"><div><h2>Leaseholders and occupants</h2><p>One unit, one lease, one shared rent and deposit balance.</p></div>{editable&&<button disabled={!!r.error} onClick={()=>setAdding(true)}>Add resident</button>}</div>
    {r.error&&<p role="alert">{r.error} <button onClick={r.reload}>Refresh household</button></p>}
    <ul className="record-list household-list">
      {!data.items.some(p=>p.userId===data.lease.residentId)&&<li><div><h3>{data.lease.resident.name||data.lease.resident.email}</h3><p>Leaseholder · Primary contact</p><p className="help">{data.lease.resident.email}</p></div><span className="badge">Primary</span></li>}
      {data.items.map(p=><li key={p.id}><div><h3>{p.name}</h3><p>{p.role==="leaseholder"?"Leaseholder":"Occupant"}{p.userId===data.lease.residentId?" · Primary contact":""} · {p.removedAt?"Removed":p.userId?"Account linked":"Record only"}</p><p className="help">{formatDate(p.startsOn)} through {formatDate(p.endsOn,"Open ended")}{p.removedAt?` · Removed ${new Date(p.removedAt).toLocaleString("en-US",{month:"long",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"})}`:""}</p>{(p.email||p.phone)&&<p className="help">{[p.email,p.phone].filter(Boolean).join(" · ")}</p>}</div>{editable&&!p.removedAt&&<button className="secondary" aria-label={`Manage resident ${p.name}`} disabled={!!r.error} onClick={()=>setSelected(p)}>Manage</button>}</li>)}
    </ul>
    <p className="help">Leaseholders with a verified, active account and current property access can see shared balances, including before move-in. Their recorded end date or removal ends access. Occupants have no lease financial access. A record alone never creates a login.</p>
    {editable&&<details className="editor-section"><summary>Primary contact · {data.lease.resident.name||data.lease.resident.email}</summary><Form label="Update primary contact" operation="lease.update" secondaryActions={primarySelection?<button type="button" className="secondary" onClick={()=>{setPrimarySelection(null);r.reload();}}>Discard primary-contact change</button>:undefined} submit={async f=>{await api(`/api/company/leases/${encodeURIComponent(leaseId)}/primary-resident`,{method:"POST",body:{participantId:f.get("participantId"),expectedVersion:primarySelection?.version??data.lease.version}});setPrimarySelection(null);changed();}}><label>Primary leaseholder contact<select name="participantId" required value={primarySelection?.id??data.items.find(p=>p.userId===data.lease.residentId)?.id??""} onChange={e=>setPrimarySelection({id:e.target.value,version:data.lease.version})}><option value="">Choose a current linked leaseholder</option>{data.items.filter(p=>p.userId&&p.role==="leaseholder"&&!p.removedAt&&(!p.endsOn||p.endsOn.slice(0,10)>=data.businessDate)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><p className="help">Changing the primary contact preserves every resident and all lease money records. Remove a departed resident separately to revoke their shared lease access.</p></Form></details>}
    {(adding||selected)&&<ParticipantForm key={selected?`${selected.id}:${selected.version}`:key} data={data} value={selected} remove={selected?()=>setRemoving(selected):undefined} cancel={()=>{setAdding(false);setSelected(null);setKey(crypto.randomUUID());}} save={async body=>{await api(selected?`${url}/${encodeURIComponent(selected.id)}`:url,{method:selected?"PATCH":"POST",body:{...body,...(selected?{expectedVersion:selected.version}:{submissionKey:key})}});setAdding(false);setSelected(null);setKey(crypto.randomUUID());changed();}}/>}
    {removing&&<Form key={removing.id} label={`Confirm removal of ${removing.name}`} operation="lease.update" secondaryActions={<button type="button" className="secondary" onClick={()=>setRemoving(null)}>Keep resident</button>} submit={async()=>{await api(`${url}/${encodeURIComponent(removing.id)}/remove`,{method:"POST",body:{expectedVersion:removing.version}});setRemoving(null);setSelected(null);changed();}}><p className="notice">Remove {removing.name} from this household? Their access to this shared lease ends immediately. Their historical record and all rent/deposit transactions remain. Other leases and property access are managed separately.</p></Form>}
  </section>;
}
function ParticipantForm({data,value,cancel,save,remove}:{data:Household;value:Participant|null;cancel:()=>void;remove?:()=>void;save:(body:Record<string,unknown>)=>Promise<void>}){
  const fields=useRef<HTMLFieldSetElement>(null);
  useEffect(()=>{fields.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();},[]);
  const [linked,setLinked]=useState("");
  const candidate=data.candidates.find(c=>c.userId===linked);
  const [role,setRole]=useState(value?.role||"occupant");
  return <Form label={value?"Save household resident":"Add to household"} operation="lease.update" secondaryActions={<><button type="button" className="secondary" onClick={cancel}>Discard resident changes</button>{remove&&<button type="button" className="secondary" onClick={remove}>Remove this resident</button>}</>} submit={async f=>save({name:f.get("name"),email:f.get("email")||null,phone:f.get("phone")||null,role,startsOn:f.get("startsOn"),endsOn:f.get("endsOn")||null,...(!value?{userId:linked||null}:{})})}>
    <fieldset ref={fields} className="form-section"><legend>{value?"Edit household resident":"Resident details"}</legend>
      <p className="help">Name, role and start date are required. Contact details and end date are optional.</p>
      {!value&&<label>Link an existing resident account<select value={linked} onChange={e=>setLinked(e.target.value)}><option value="">Keep a record without a login</option>{data.candidates.filter(c=>c.userId!==data.lease.residentId&&!data.items.some(p=>p.userId===c.userId)).map(c=><option key={c.userId} value={c.userId}>{c.contactName||c.user.name||c.user.email}{c.user.emailVerified?"":" · Verification needed"}</option>)}</select></label>}
      <div className="form-grid">
        <label>Resident full name<input key={linked} name="name" required maxLength={200} defaultValue={value?.name||candidate?.contactName||candidate?.user.name||""}/></label>
        <label>Resident role<select value={role} onChange={e=>setRole(e.target.value)}><option value="occupant">Occupant · no financial access</option><option value="leaseholder">Leaseholder · shared financial access</option></select></label>
        <label>Resident contact email<input key={linked} name="email" type="email" maxLength={254} defaultValue={value?.email||candidate?.user.email||""}/></label>
        <label>Resident contact phone<input name="phone" type="tel" maxLength={40} defaultValue={value?.phone||""}/></label>
        <label>Resident start date<DateField name="startsOn" aria-label="Resident start date" required defaultValue={(value?.startsOn||data.lease.startsOn).slice(0,10)}/></label>
        <label>Resident end date<DateField name="endsOn" aria-label="Resident end date" defaultValue={value?.endsOn?.slice(0,10)}/></label>
      </div>
      <p className="help">Use an end date to retain a departed resident’s history. The end date is inclusive; access ends the following day. This updates the household record without changing rent, deposits or signed documents.</p>
      {role==="leaseholder"&&<p className="notice">Confirm this person belongs on the lease. A linked leaseholder will be able to see the entire shared lease balance, including before move-in. Individual rent shares are not created.</p>}
    </fieldset>
  </Form>;
}
