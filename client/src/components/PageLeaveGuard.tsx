import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";
type State={active:boolean;busy:boolean;uncertain:boolean};
const Context=createContext<((id:string,state:State|null)=>void)|null>(null);
export function editorNavigationChangesSource(currentLocation:{pathname:string;search:string},nextLocation:{pathname:string;search:string}) {
 const current=new URLSearchParams(currentLocation.search),next=new URLSearchParams(nextLocation.search);
 if(currentLocation.pathname!==nextLocation.pathname)return true;
 // An open lease intake pins its unit hint when it mounts. Updating that URL
 // hint cannot replace the selected unit or any edited terms in its draft.
 const pinnedLeaseIntake=/^\/company\/(?:leases|properties\/[^/]+\/leases)\/?$/.test(currentLocation.pathname) && current.get("new")==="lease" && next.get("new")==="lease";
 return ["propertyId","draftId","taskVersion","contactId","leaseId","unitId","inspectionId","prospectId","section"].some(key=>current.get(key)!==next.get(key) && !(key==="unitId" && pinnedLeaseIntake));
}
// One supported router blocker owns every mounted editor. It covers links,
// Back/Forward and navigate(), while query-only directory returns retain state.
export function EditorNavigationProvider({children}:{children:ReactNode}){
 const records=useRef(new Map<string,State>()),[revision,setRevision]=useState(0);
 const register=useCallback((id:string,state:State|null)=>{if(state)records.current.set(id,state);else records.current.delete(id);setRevision(value=>value+1);},[]);
 const blocker=useBlocker(({currentLocation,nextLocation})=>{
  if(!editorNavigationChangesSource(currentLocation,nextLocation))return false;
  return [...records.current.values()].some(row=>row.active);
 });
 const waited=useRef<typeof blocker|null>(null), settled=useRef<typeof blocker|null>(null);
 useEffect(()=>{
  if(blocker.state!=="blocked"){waited.current=null;return;}
  // Registry cleanup can rerun this effect before the router's new state is
  // rendered. An attempt may be decided only once, even during that interval.
  if(settled.current===blocker)return;
  const active=[...records.current.values()].filter(row=>row.active);
  if(active.some(row=>row.busy)){waited.current=blocker;return;}
  if(!active.length){settled.current=blocker;blocker.proceed();return;}
  // A failed request retains its form and error. A successful Form.completed
  // clears the guard before its queued result redirect is allowed through.
  // A replacement destination is a new intent. It cannot inherit a previous
  // result redirect's wait flag while the router is still settling its reset.
  if(waited.current===blocker){settled.current=blocker;blocker.reset();return;}
  const recovery=active.some(row=>row.uncertain);
  const message=recovery?"Leave while this request still needs recovery? The request may already be saved. Check existing records before starting another request. Details kept only on this page will be cleared.":"Leave this page and discard its unsaved changes? Changes kept only on this page will be cleared. Select Cancel to keep editing.";
  settled.current=blocker;
  if(window.confirm(message))blocker.proceed();else blocker.reset();
 },[blocker,revision]);
 return <Context.Provider value={register}>{children}{blocker.state==="blocked"&&[...records.current.values()].some(row=>row.active&&row.busy)&&<p className="notice" role="status">Finishing the current request before leaving…</p>}</Context.Provider>;
}
export function useEditorNavigationGuard(state:State){
 const register=useContext(Context),id=useRef(crypto.randomUUID());
 // Keep the registry consistent with enabled/disabled editor controls before
 // paint. A passive effect can leave a stale busy record after the UI enables.
 useLayoutEffect(()=>{register?.(id.current,state);return()=>register?.(id.current,null);},[register,state.active,state.busy,state.uncertain]);
 return useCallback(()=>register?.(id.current,{active:false,busy:false,uncertain:false}),[register]);
}
export const usePageLeaveGuard=useEditorNavigationGuard;
