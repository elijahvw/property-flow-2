import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";
type State={active:boolean;busy:boolean;uncertain:boolean};
const Context=createContext<((id:string,state:State|null)=>void)|null>(null);
export function editorNavigationChangesSource(currentLocation:{pathname:string;search:string},nextLocation:{pathname:string;search:string}) {
 const current=new URLSearchParams(currentLocation.search),next=new URLSearchParams(nextLocation.search);
 return currentLocation.pathname!==nextLocation.pathname || ["propertyId","draftId","taskVersion","contactId","leaseId","unitId","inspectionId","prospectId","section"].some(key=>current.get(key)!==next.get(key));
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
 const waited=useRef(false);
 useEffect(()=>{
  if(blocker.state!=="blocked"){waited.current=false;return;}
  const active=[...records.current.values()].filter(row=>row.active);
  if(active.some(row=>row.busy)){waited.current=true;return;}
  if(!active.length){blocker.proceed();return;}
  // A failed request retains its form and error. A successful Form.completed
  // clears the guard before its queued result redirect is allowed through.
  if(waited.current){blocker.reset();return;}
  const recovery=active.some(row=>row.uncertain);
  const message=recovery?"Leave while this request still needs recovery? The request may already be saved. Check existing records before starting another request. Details kept only on this page will be cleared.":"Leave this page and discard its unsaved changes? Changes kept only on this page will be cleared. Select Cancel to keep editing.";
  if(window.confirm(message))blocker.proceed();else blocker.reset();
 },[blocker,revision]);
 return <Context.Provider value={register}>{children}{blocker.state==="blocked"&&[...records.current.values()].some(row=>row.active&&row.busy)&&<p className="notice" role="status">Finishing the current request before leaving…</p>}</Context.Provider>;
}
export function useEditorNavigationGuard(state:State){
 const register=useContext(Context),id=useRef(crypto.randomUUID());
 useEffect(()=>{register?.(id.current,state);return()=>register?.(id.current,null);},[register,state.active,state.busy,state.uncertain]);
 return useCallback(()=>register?.(id.current,{active:false,busy:false,uncertain:false}),[register]);
}
export const usePageLeaveGuard=useEditorNavigationGuard;
