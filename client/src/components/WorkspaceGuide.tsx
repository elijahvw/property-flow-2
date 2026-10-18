import "../pages/Help.css";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { monitorOperation } from "../operations";
import { EditorDialog } from "./EditorDialog";

type Guide = { eligible: boolean; guideKey: string; status: string; step: string; version: number; steps: { id: string; title: string; description: string; path: string; action: string; help: string }[] };
export function WorkspaceGuide() {
  const { data, user } = useAuth(), location = useLocation();
  const eligible = !!user?.emailVerified && user.status === "active" && !!data?.permissions.length;
  const scope = location.pathname.startsWith("/platform/") && data?.permissions.includes("platform.manage") ? "platform" : data?.permissions.includes("property.read") ? "company" : data?.permissions.includes("resident.self") ? "resident" : "platform";
  return eligible && location.pathname !== "/invite" ? <GuidePanel key={`${user.id}:${data?.membership?.companyId}:${scope}:${data?.permissions.join(",")}`} scope={scope} auto={!location.pathname.startsWith("/help") && location.pathname !== "/account"}/> : null;
}
function GuidePanel({ scope, auto }: { scope: string; auto: boolean }) {
  const endpoint = `/api/account/guide?workspace=${scope}`, r = useResource<Guide>(endpoint), navigate = useNavigate();
  const [guide, setGuide] = useState<Guide | null>(null), [open, setOpen] = useState(false), [index, setIndex] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const shown = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (r.data?.eligible && Array.isArray(r.data.steps)) { setGuide(r.data); if (auto && r.data.status === "new" && !shown.current) { shown.current = true; setIndex(Math.max(0,r.data.steps.findIndex(step=>step.id===r.data!.step))); setOpen(true); } } }, [r.data, auto]);
  useEffect(() => { const replay = () => { shown.current = true; setIndex(guide?.status === "complete" ? 0 : Math.max(0,guide?.steps.findIndex(step=>step.id===guide.step) || 0)); setOpen(true); if (!guide) r.reload(); }; window.addEventListener("pf-guide-replay", replay); return () => window.removeEventListener("pf-guide-replay", replay); }, [guide]);
  useEffect(() => { if(open) heading.current?.focus(); }, [index,open]);
  async function save(status: string, nextIndex = index) {
    if (!guide || busy) return;
    setBusy(true); setError("");
    try {
      const result = await monitorOperation("onboarding.update",()=>api<Guide>(endpoint,{method:"PUT",body:{expectedVersion:guide.version,guideKey:guide.guideKey,status,step:guide.steps[nextIndex].id}}));
      setGuide(result); setIndex(nextIndex); return true;
    } catch(failure) { setError(failure instanceof Error ? failure.message : "Walkthrough progress could not be saved."); return false; }
    finally { setBusy(false); }
  }
  const dismiss = () => { if(busy)return;setOpen(false);void save("dismissed"); };
  const current = guide?.steps[index];
  return <>
    {!open && error && <p className="notice" role="status">Your walkthrough progress could not be saved. You can keep working and replay it from <Link to="/help">Help</Link>.</p>}
    <EditorDialog open={open} title="Welcome to Property Flow" onClose={dismiss} busy={busy}>
      {r.error && !guide ? <p role="alert">{r.error} <button onClick={r.reload}>Reload walkthrough</button></p> : !current ? <p role="status">Loading your walkthrough…</p> : <>
        <p className="help">Step {index+1} of {guide!.steps.length} · You can leave and replay this walkthrough from Help.</p>
        <ol className="guide-progress" aria-label="Walkthrough progress">{guide!.steps.map((step,i)=><li key={step.id} className={i<=index?"current":""} aria-label={`Step ${i+1}: ${step.title}${i===index?", current":""}`}/>)}</ol>
        <h3 ref={heading} tabIndex={-1}>{current.title}</h3><p className="guide-description">{current.description}</p>
        <div className="actions"><button className="secondary" disabled={busy} onClick={async()=>{if(await save("in_progress")){setOpen(false);navigate(current.path);}}}>{current.action}</button><Link to={`/help/${current.help}`} onClick={()=>{setOpen(false);void save("in_progress");}}>Read the guide</Link></div>
        {error&&<p className="notice error" role="alert">{error} <button type="button" className="text-button" onClick={r.reload}>Reload progress</button></p>}
        <div className="guide-footer"><button className="text-button" disabled={busy} onClick={dismiss}>Skip for now</button><span className="action-spacer"/><button className="secondary" disabled={busy||index===0} onClick={()=>void save("in_progress",index-1)}>Back</button><button disabled={busy} onClick={async()=>{if(index===guide!.steps.length-1){if(await save("complete"))setOpen(false);}else await save("in_progress",index+1);}}>{busy?"Saving…":index===guide!.steps.length-1?"Finish walkthrough":"Next"}</button></div>
      </>}
    </EditorDialog>
  </>;
}
