import { useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { useResource } from '../useResource';
import { useDebouncedValue } from '../useDebouncedValue';
import { formatActivityTime } from '../dates';
import { Form } from '../components/Form';
import './ResidentDocuments.css';
type SharedDocument={id:string;version:number;title:string;number:number;filename:string;byteLength:number;property:string;unit:string;sharedAt:string;receivedAt:string|null};
type Result={items:SharedDocument[];total:number;page:number;pageSize:number};
export function ResidentDocuments(){const {data}=useAuth();return <Documents key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(',')}`}/>;}
function Documents(){
 const [params,setParams]=useSearchParams(),search=params.get('q')||'',q=useDebouncedValue(search.trim(),250),page=/^[1-9][0-9]{0,4}$/.test(params.get('page')||'')?Number(params.get('page')):1,query=new URLSearchParams({page:String(page),...(q?{q}:{})}),r=useResource<Result>(`/api/resident/documents?${query}`,true,true);
 const change=(value:string,nextPage=1)=>setParams({...value?{q:value}:{},...nextPage>1?{page:String(nextPage)}:{}},{replace:true});
 return <><header className="page-heading"><Link to="/resident">← My rental</Link><h1>My documents</h1><p>Copies your property team has shared with you. Each record identifies the exact version you received.</p></header>
 <section className="panel resident-document-search" aria-label="Find shared documents"><label>Search shared documents<input type="search" maxLength={160} value={search} onChange={e=>change(e.target.value)} placeholder="Document title, property or unit"/></label>{search&&<button className="secondary" onClick={()=>change('')}>Clear document search</button>}</section>
 <section className="panel" aria-label="Shared document results"><div className="section-heading"><h2>Shared with you</h2>{r.data&&<span role="status">{r.data.total} {r.data.total===1?'document':'documents'}</span>}</div>
 {r.error&&<p role="alert">{r.error} <button className="secondary" onClick={r.reload}>Try documents again</button></p>}{!r.data?(!r.error&&<p role="status">Loading shared documents…</p>):!r.data.items.length?<p>{search?'No shared documents match this search. Try another title, property or unit.':'No documents have been shared with you yet. Your property team can share a cleared copy from your lease.'}</p>:<ul className="resident-document-list">{r.data.items.map(row=><ResidentDocument key={row.id} row={row} changed={r.reload}/>)}</ul>}
 {r.data&&<nav className="actions" aria-label="Shared document pages">{page>1&&<button className="secondary" onClick={()=>change(search,page-1)}>Previous documents</button>}{page*25<r.data.total&&<button className="secondary" onClick={()=>change(search,page+1)}>Next documents</button>}</nav>}
 <p className="help">Confirming receipt records that you received this version. It does not sign the document or change your lease. Uploads and other private files are not included.</p></section></>;
}
function ResidentDocument({row,changed}:{row:SharedDocument;changed:()=>void}){
 const pending=useRef<{expectedVersion:number;submissionKey:string}|null>(null),endpoint=`/api/resident/documents/${encodeURIComponent(row.id)}`;
 return <li className="resident-document-card"><div><h3>{row.title}</h3><p>{row.property} · {row.unit}</p><p>Version {row.number} · {row.filename} · {Math.max(1,Math.ceil(row.byteLength/1024))} KB</p><p>Shared {formatActivityTime(row.sharedAt)}</p></div>
 <div className="resident-document-actions"><Form operation="document.download" label={`Download ${row.title}`} feedbackText="Download prepared." submit={async()=>{const file=await api<{filename:string;contentBase64:string}>(`${endpoint}/download`),bytes=Uint8Array.from(atob(file.contentBase64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),link=document.createElement('a');link.href=url;link.download=file.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}}><span className="help">Your access is checked for every download.</span></Form>
 {row.receivedAt?<p className="notice" role="status">Receipt confirmed {formatActivityTime(row.receivedAt)}</p>:<Form operation="document.receipt" label={`Confirm received · ${row.title}`} feedbackText="Receipt confirmed for this version. This is not a signature." submit={async()=>{pending.current??={expectedVersion:row.version,submissionKey:crypto.randomUUID()};try{await api(`${endpoint}/received`,{method:'POST',body:pending.current});pending.current=null;changed();}catch(e){if(!(e instanceof ApiError&&e.submissionUncertain))pending.current=null;throw e;}}}><span className="help">Confirm receipt of version {row.number}; this is not a signature.</span></Form>}
 </div></li>;
}
