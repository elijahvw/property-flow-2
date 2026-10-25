import { activityLabel } from "../activity-label";
import { RecordIdentity } from "./RecordIdentity";
import { useEffect, useRef, useState } from "react";
import { useResource } from "../useResource";
import { useDebouncedValue } from "../useDebouncedValue";
import { formatActivityTime } from "../dates";

type Event = { id:string;action:string;actorId:string;actorLabel?:string;actor?:{name:string|null;email:string}|null;companyName?:string|null;companyId?:string|null;createdAt:string };
type Page = {items:Event[];total:number;page:number;pageSize:number};
export function ActivityLog({id,revision}:{id?:string;revision?:string}) {
  const [page,setPage]=useState(1),[query,setQuery]=useState('');
  const search=useDebouncedValue(query.trim());
  const params=new URLSearchParams({page:String(page),...(id?{targetId:id}:{}),...(search?{q:search}:{})});
  const r=useResource<Page|Event[]>(`/api/platform/audit?${params}`);
  const previous=useRef(revision);
  useEffect(()=>{if(previous.current!==revision){previous.current=revision;r.reload();}},[revision]);
  const result=Array.isArray(r.data)?{items:r.data,total:r.data.length,page:1,pageSize:100}:r.data;
  return <>
    <p className="help">Recorded access and administration changes. Times use your browser timezone.</p>
    <label>Filter activity by event<input type="search" value={query} placeholder="For example, invitation or membership" maxLength={100} onChange={event=>{setQuery(event.target.value);setPage(1);}}/></label>
    {r.error?<p role="alert">{r.error} <button onClick={r.reload}>Try again</button></p>:!result?<p role="status">Loading activity…</p>:<>
      <p role="status">{result.total} matching {result.total===1?'event':'events'}</p>
      {!result.items.length?<p>{query?'No recorded activity matches these filters.':id?'No recorded activity for this account.':'No recorded activity yet.'}</p>:<ol className="activity-list">{result.items.map(event=><li key={event.id}>
        <strong>{activityLabel(event.action)}</strong><time dateTime={event.createdAt}>{formatActivityTime(event.createdAt)}</time>
        <span className="cell-detail">Actor: {event.actorLabel||event.actor?.name||event.actor?.email||'Account'}{!id&&` · ${event.companyName||(event.companyId?'Company':'Platform')}`}</span>
        <RecordIdentity id={event.actorId} label="Actor"/>
      </li>)}</ol>}
      <div className="actions"><button className="secondary" disabled={page<=1} onClick={()=>setPage(value=>value-1)}>Previous activity</button><span>Page {page} of {Math.max(1,Math.ceil(result.total/result.pageSize))}</span><button className="secondary" disabled={page*result.pageSize>=result.total} onClick={()=>setPage(value=>value+1)}>Next activity</button></div>
    </>}
  </>;
}
export function UserActivity({id,revision}:{id:string;revision?:string}) {
  return <details className="editor-section"><summary>Account activity</summary><ActivityLog key={id} id={id} revision={revision}/></details>;
}
