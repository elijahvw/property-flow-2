import { useEffect,useState } from "react";
import { api } from "../api";
import { formatDate } from "../dates";
import { Form } from "../pages/Workspace";

type Preview={company:string;property:string;unit:string;name:string;role:string;startsOn:string;leaseStartsOn:string;leaseEndsOn:string|null;leaseStatus:string};
export function LeaseInvitationReview({token,accepted}:{token:string;accepted:()=>Promise<void>}){
  const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(""),[revision,setRevision]=useState(0);
  useEffect(()=>{const controller=new AbortController();setPreview(null);setError("");void api<Preview>("/api/invitations/preview",{method:"POST",body:{token},signal:controller.signal}).then(row=>{if(!controller.signal.aborted)setPreview(row);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Unable to review invitation.");});return()=>controller.abort();},[token,revision]);
  if(error)return <div><p role="alert" className="notice error">{error}</p><button className="secondary" onClick={()=>setRevision(v=>v+1)}>Review invitation again</button></div>;
  if(!preview)return <p role="status">Loading your lease invitation…</p>;
  return <Form label="Accept household invitation" operation="invitation.accept" feedbackText="Household invitation accepted." submit={async()=>{await api("/api/invitations/accept",{method:"POST",body:{token}});await accepted();}}>
    <dl className="lease-review-summary"><div><dt>Owner company</dt><dd>{preview.company}</dd></div><div><dt>Your rental</dt><dd>{preview.property} · {preview.unit}</dd></div><div><dt>Your name and role</dt><dd>{preview.name} · {preview.role==="leaseholder"?"Leaseholder":"Occupant"}</dd></div><div><dt>Resident start date</dt><dd>{formatDate(preview.startsOn)}</dd></div><div><dt>Lease term</dt><dd>{formatDate(preview.leaseStartsOn)} through {formatDate(preview.leaseEndsOn,"Open ended")} · {preview.leaseStatus}</dd></div></dl>
    <p className="notice">{preview.role==="leaseholder"?"As a leaseholder, you can see the shared rent and deposit balances when this lease is active, including before move-in. Individual rent shares are not created.":"As an occupant, this invitation does not give you access to the lease’s financial information."} Owners approve and manage household changes.</p>
    <p className="help">Accepting links this verified account to the household and property. It does not sign a lease, process a payment or change an existing company role. Contact the owner if these details are incorrect.</p>
  </Form>;
}
