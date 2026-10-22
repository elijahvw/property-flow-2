import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { useResource } from '../useResource';
import { formatActivityTime } from '../dates';
import { Form } from './Form';
import './DocumentSharing.css';
type Version={id:string;number:number;filename:string;scanStatus:string};
type Share={id:string;version:number;recipient:string;available:boolean;number:number;filename:string;sharedAt:string;revokedAt:string|null;receivedAt:string|null;history:{action:string;createdAt:string}[];historyLimited:boolean};
type Result={expectedDocumentVersion:number;versions:Version[];eligible:{id:string;name:string;role:string}[];items:Share[];total:number;page:number;pageSize:number};
export function DocumentSharing({leaseId,document}:{leaseId:string;document:{id:string;title:string;version:number;archivedAt:string|null;versions:Version[]}}){
 const {data}=useAuth(),[opened,setOpened]=useState(false);
 return <details className="document-sharing" onToggle={event=>{if(event.currentTarget.open)setOpened(true);}}><summary>Resident sharing · {document.title}</summary>{opened&&<SharingPanel key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(',')}`} leaseId={leaseId} document={document}/>}</details>;
}
function SharingPanel({leaseId,document}:{leaseId:string;document:{id:string;title:string;version:number;archivedAt:string|null;versions:Version[]}}){
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0),endpoint=`/api/company/leases/${encodeURIComponent(leaseId)}/documents/${encodeURIComponent(document.id)}/shares`,r=useResource<Result>(`${endpoint}?page=${page}`,true,true);
 const clean=r.data?.versions||[],[refreshing,setRefreshing]=useState(false),refreshingFrom=useRef<Result>();
 const refresh=()=>{refreshingFrom.current=r.data;setRefreshing(true);r.reload();};
 useEffect(()=>{if(refreshing&&((r.data&&r.data!==refreshingFrom.current)||r.error)){setRevision(x=>x+1);setRefreshing(false);}},[refreshing,r.data,r.error]);
 return <div className="document-sharing-body"><p>Choose a cleared version and one approved resident. Sharing never includes later uploads or other private files.</p>
 {r.error&&<p role="alert">{r.error} <button className="secondary" onClick={r.reload}>Refresh sharing</button></p>}{!r.data?(!r.error&&<p role="status">Loading resident sharing…</p>):<>
 {refreshing?<p role="status">Refreshing sharing options…</p>:!document.archivedAt&&!!clean.length&&!!r.data.eligible.length?<ShareForm key={revision} endpoint={endpoint} versions={clean} expectedVersion={r.data.expectedDocumentVersion} eligible={r.data.eligible} refresh={refresh} saved={()=>{setRevision(x=>x+1);r.reload();}}/>:<p className="help">{document.archivedAt?'Restore this document before sharing it.':!clean.length?'A retained version must clear scanning before it can be shared.':'No approved resident with current portal access is eligible. Review the lease household and property access before sharing.'}</p>}
 <div className="section-heading"><h4>Sharing history</h4><span>{r.data.total} {r.data.total===1?'record':'records'}</span></div>
 {!r.data.items.length?<p>This document has not been shared with residents.</p>:<ul className="document-share-list">{r.data.items.map(row=><li key={row.id}><strong>{row.recipient} · Version {row.number}</strong><p>{row.filename} · Shared {formatActivityTime(row.sharedAt)}</p><p>{row.revokedAt?`Access revoked ${formatActivityTime(row.revokedAt)}`:row.available===false?'Shared copy unavailable under current household or document access.':row.receivedAt?`Receipt confirmed ${formatActivityTime(row.receivedAt)}`:'Shared · Receipt not confirmed'}</p>
 {!row.revokedAt&&<RevokeShare endpoint={`${endpoint}/${encodeURIComponent(row.id)}/revoke`} row={row} saved={r.reload}/>}
 {!!row.history.length&&<details><summary>Recent activity</summary><ol>{row.history.map((event,i)=><li key={`${event.createdAt}:${i}`}>{({downloaded:'Document downloaded',received:'Receipt confirmed',revoked:'Access revoked'} as Record<string,string>)[event.action]||'Sharing updated'} · {formatActivityTime(event.createdAt)}</li>)}</ol>{row.historyLimited&&<p className="help">Showing the latest five events. Earlier history is retained.</p>}</details>}
 </li>)}</ul>}
 <nav className="actions" aria-label="Sharing history pages">{page>1&&<button className="secondary" onClick={()=>setPage(x=>x-1)}>Previous sharing records</button>}{page*25<r.data.total&&<button className="secondary" onClick={()=>setPage(x=>x+1)}>Next sharing records</button>}</nav>
 <p className="help">Confirming receipt is not signing or agreeing to the document. Revoking access prevents future downloads; it cannot remove a copy already downloaded.</p></>}
 </div>;
}
function ShareForm({endpoint,versions,expectedVersion,eligible,refresh,saved}:{endpoint:string;versions:Version[];expectedVersion:number;eligible:Result['eligible'];refresh:()=>void;saved:()=>void}){
 const [selectedVersion,setSelectedVersion]=useState(''),[selectedPerson,setSelectedPerson]=useState(''),[openingVersion]=useState(expectedVersion),key=useRef(crypto.randomUUID());
 return <Form secondaryActions={<button type="button" className="secondary" onClick={refresh}>Refresh sharing options</button>} operation="document.share" label="Share selected version" feedbackText="Document version shared with the selected resident." submit={async data=>{await api(endpoint,{method:'POST',body:{documentVersionId:String(data.get('documentVersionId')),participantId:String(data.get('participantId')),expectedDocumentVersion:openingVersion,submissionKey:key.current}});saved();}}>
 <div className="form-grid"><label>Document version (required)<select name="documentVersionId" required value={selectedVersion} onChange={e=>setSelectedVersion(e.target.value)}><option value="">Choose a cleared version</option>{versions.map(v=><option key={v.id} value={v.id}>Version {v.number} · {v.filename}</option>)}</select></label><label>Share with (required)<select name="participantId" required value={selectedPerson} onChange={e=>setSelectedPerson(e.target.value)}><option value="">Choose one resident</option>{eligible.map(p=><option key={p.id} value={p.id}>{p.name} · {p.role==='occupant'?'Occupant':'Leaseholder'}</option>)}</select></label></div>
 {selectedVersion&&selectedPerson&&<p className="document-share-review">Share version {versions.find(v=>v.id===selectedVersion)?.number} with {eligible.find(p=>p.id===selectedPerson)?.name}. This gives access only to this exact copy.</p>}
 </Form>;
}
function RevokeShare({endpoint,row,saved}:{endpoint:string;row:Share;saved:()=>void}){
 const pending=useRef<{expectedVersion:number;submissionKey:string}|null>(null);
 return <Form operation="document.share" label={`Revoke access for ${row.recipient}`} feedbackText="Access revoked. Sharing and receipt history retained." submit={async()=>{pending.current??={expectedVersion:row.version,submissionKey:crypto.randomUUID()};try{await api(endpoint,{method:'POST',body:pending.current});pending.current=null;saved();}catch(e){if(!(e instanceof ApiError&&e.submissionUncertain))pending.current=null;throw e;}}}><p className="help">Stops future access to version {row.number} for this resident.</p></Form>;
}
