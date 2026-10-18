import { useState } from 'react';
import '../components/PrivateDocuments.css';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useResource } from '../useResource';
import { useDebouncedValue } from '../useDebouncedValue';
import { formatDate, formatActivityTime } from '../dates';
import { Form } from '../components/Form';
import { EditorDialog, useEditorBusy } from '../components/EditorDialog';
type Work={id:string;title:string;description:string;version:number;executionStatus:string;status:string;priority:string;targetOn:string|null;property:{name:string};unit:{label:string}|null;assigneeId?:string|null;assigneeName?:string|null;eligible?:{id:string;name:string}[];eligibleLimited?:boolean;actions:{id:string;action:string;note:string;createdAt:string;author?:string}[];historyLimited?:boolean};
const labels:Record<string,string>={unassigned:'Unassigned',assigned:'Awaiting acceptance',accepted:'In progress',pending_review:'Completion awaiting review',complete:'Completion approved',assign:'Assignment changed',accept:'Work accepted',progress:'Progress recorded',submit:'Completion submitted',approve:'Completion approved',reopen:'Reopened'};
export function WorkOrders() {
  const [params,setParams]=useSearchParams(), status=params.get('status')||'', search=params.get('q')||'', q=useDebouncedValue(search.trim(),250);
  const cursor=params.get('cursor')||'';
  const query=new URLSearchParams({...status?{status}:{},...q?{q}:{},...cursor?{cursor}:{}}), r=useResource<{items:Work[];nextCursor:string|null}>(`/api/company/work-orders?${query}`,true,true);
  const items=r.data?.items||[];
  const filter=(key:string,value:string)=>{setParams(previous=>{const next=new URLSearchParams(previous);if(key!=='cursor')next.delete('cursor');value?next.set(key,value):next.delete(key);return next;});};
  return <section className="panel"><h1>Assigned work</h1><p>Accept work assigned to you, record progress, then submit completion for management review.</p><div className="filters"><label>Find assigned work<input type="search" value={search} onChange={e=>filter('q',e.target.value)}/></label><label>Work status<select value={status} onChange={e=>filter('status',e.target.value)}><option value="">All assigned work</option>{['assigned','accepted','pending_review','complete'].map(s=><option key={s} value={s}>{labels[s]}</option>)}</select></label></div>
    {r.error?<p role="alert">{r.error}<button onClick={r.reload}>Reload assigned work</button></p>:!r.data?<p role="status">Loading assigned work…</p>:!items.length?<p>No assigned work matches these filters.</p>:<ul className="assigned-work-list">{items.map(row=><li key={row.id}><h2><Link to={`/company/work-orders/${encodeURIComponent(row.id)}`}>{row.title}</Link></h2><p>{row.property.name} · {row.unit?.label||'Property-wide'} · {labels[row.executionStatus]}</p><p>Target {formatDate(row.targetOn,'Not set')} · {row.priority} priority</p></li>)}</ul>}
    {cursor&&<button onClick={()=>filter('cursor','')}>Back to first page</button>}
    {r.data?.nextCursor&&<button onClick={()=>filter('cursor',r.data!.nextCursor!)}>Next page of work</button>}
  </section>;
}
export function AssignedWorkDetail(){const {requestId=''}=useParams(),{data}=useAuth();return <><Link to="/company/work-orders">← Assigned work</Link><WorkOrderPanel key={`${requestId}:${data?.membership?.version}:${data?.permissions.join(',')}`} id={requestId}/></>;}
export function WorkOrderPanel({id,management=false,changed=()=>{}}:{id:string;management?:boolean;changed?:()=>void}) {
  const endpoint=`/api/company/work-orders/${encodeURIComponent(id)}`,r=useResource<Work>(endpoint,true,true),row=r.data;
  const [draft,setDraft]=useState<{row:Work;key:string;action:string}|null>(null),[open,setOpen]=useState(false);
  const begin=(action:string)=>{setDraft(current=>current||{row:row!,key:crypto.randomUUID(),action});setOpen(true);};
  return <section className="panel"><h2>{management?'Assigned work':'Work details'}</h2>
    {r.error&&<p role="alert">{r.error}<button onClick={r.reload}>Reload work details</button></p>}
    {!row?.executionStatus?(!r.error&&<p role="status">Loading work details…</p>):<>
      {!management&&<><h1>{row.title}</h1><p>{row.property.name} · {row.unit?.label||'Property-wide'} · Target {formatDate(row.targetOn,'Not set')}</p><p className="preserve-lines">{row.description}</p></>}
      <p><strong>{labels[row.executionStatus]}</strong>{management&&row.assigneeId?` · ${row.assigneeName||'Recorded staff member'}`:''}</p>
      <p className="help">Team work notes stay with this job. Existing internal management notes and financial records are separate. Completion records no payment.</p>
      {management&&row.eligibleLimited&&<p className="notice">Showing the first 2,000 eligible staff. Review company team access if the intended assignee is missing.</p>}
      <div className="actions">{management&&row.status!=='resolved'&&<button onClick={()=>begin('assign')}>Assign or reassign work</button>}
        {row.executionStatus==='assigned'&&<button onClick={()=>begin('accept')}>Accept work</button>}
        {row.executionStatus==='accepted'&&<><button onClick={()=>begin('progress')}>Record progress</button><button onClick={()=>begin('submit')}>Submit completion for review</button></>}
        {management&&row.executionStatus==='pending_review'&&<button onClick={()=>begin('approve')}>Approve completion</button>}
        {management&&(row.executionStatus==='pending_review'||row.status==='resolved')&&<button onClick={()=>begin('reopen')}>Reopen work</button>}
      </div>
      <h3>Work history</h3>{row.historyLimited&&<p>Showing the latest 100 work events. Earlier events remain retained.</p>}
      {!row.actions?.length?<p>No delegated work recorded.</p>:<ol>{row.actions.map(event=><li key={event.id}><strong>{labels[event.action]}</strong> · {formatActivityTime(event.createdAt)}{event.author?` · ${event.author}`:''}<p className="preserve-lines">{event.note}</p></li>)}</ol>}
      {draft&&<EditorDialog open={open} title={labels[draft.action]||'Update assigned work'} onClose={()=>setOpen(false)} onDiscard={()=>{setDraft(null);setOpen(false);r.reload();}}><WorkAction key={draft.key} endpoint={endpoint} draft={draft} saved={()=>{setDraft(null);setOpen(false);r.reload();changed();}} discard={()=>{setDraft(null);setOpen(false);r.reload();}} /></EditorDialog>}
    </>}
  </section>;
}
function WorkAction({endpoint,draft,saved,discard}:{endpoint:string;draft:{row:Work;key:string;action:string};saved:()=>void;discard:()=>void}) {
  const { uncertain } = useEditorBusy();
  return <Form operation="maintenance.work" feedbackText={`${labels[draft.action]}.`} label={draft.action==='assign'?'Save assignment':draft.action==='accept'?'Confirm acceptance':draft.action==='submit'?'Submit for review':draft.action==='approve'?'Confirm completion approval':draft.action==='reopen'?'Confirm reopening':'Save progress'} submit={async data=>{
    await api(`${endpoint}/actions`,{method:'POST',body:{action:draft.action,note:String(data.get('note')),expectedVersion:draft.row.version,submissionKey:draft.key,...(draft.action==='assign'?{assigneeId:data.get('assigneeId')||null}:{})}});saved();
  }} secondaryActions={<button type="button" className="secondary" disabled={uncertain} onClick={discard}>Discard and reload work</button>}>
    {draft.action==='assign'&&<label>Assign to<select name="assigneeId" aria-label="Assign to" defaultValue={draft.row.eligible?.some(p=>p.id===draft.row.assigneeId)?draft.row.assigneeId||'':''}><option value="">Unassigned</option>{draft.row.eligible?.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select><span className="help">Only active staff with owner-granted execution and property access appear. A new assignment requires acceptance again.</span></label>}
    <label>Work note<textarea name="note" required maxLength={4000}/></label>
    <p>{draft.action==='approve'?'Management approval resolves this request. It does not record a payment or expense.':draft.action==='submit'?'Management will review this completion before the request is resolved.':'This note is visible to the currently assigned teammate and management.'}</p>
  </Form>;
}
