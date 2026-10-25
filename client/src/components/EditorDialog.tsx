import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFeedback } from "./Feedback";
import { useEditorNavigationGuard } from "./PageLeaveGuard";
import "./EditorDialog.css";

const EditorContext = createContext<{
  busy: boolean;
  register: (id: string, busy: boolean) => void;
  completed: (form?: HTMLElement) => void;
  uncertain: boolean;
  recovery: (id: string, active: boolean) => void;
  durable:(id:string,adapter:{element:{current:HTMLElement|null};save:()=>Promise<unknown>}|null)=>void;
  draftSaved:(element?:HTMLElement)=>void;
}>({ busy: false, register: () => {}, completed: () => {}, uncertain: false, recovery: () => {},durable:()=>{},draftSaved:()=>{} });
export const useEditorBusy = () => useContext(EditorContext);

// Dialogs retain edits after an explicit draft save. Page editors also retain
// them when browser Back returns to their directory. State stays in memory on
// this page; nothing is replayed.
export function EditorDialog({
  open,
  title,
  description,
  onClose,
  onDiscard,
  onSaveDraft,
  draftable = true,
  hasChanges = false,
  changeVersion = 0,
  children,
  busy = false,
  presentation = "dialog",
  backLabel = "Back",
  eyebrow,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onDiscard?: () => void;
  onSaveDraft?: (recovery?: boolean) => void;
  draftable?: boolean;
  hasChanges?: boolean;
  changeVersion?: number;
  children: ReactNode;
  busy?: boolean;
  presentation?: "dialog" | "page";
  backLabel?:string;
  eyebrow?: string;
}) {
  const dialog = useRef<HTMLElement | null>(null),
    pageConfirmation = useRef<HTMLDialogElement>(null),
    titleId = useId(),
    descriptionId = useId();
  const [visited, setVisited] = useState(open),
    [busyForms, setBusyForms] = useState<Set<string>>(() => new Set());
  const [recoveries, setRecoveries] = useState<Set<string>>(() => new Set());
  const uncertain = recoveries.size > 0;
  const recovery = useCallback((id: string, active: boolean) => {
    setRecoveries(previous => {
      if (previous.has(id) === active) return previous;
      const next = new Set(previous);
      if (active) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const [dirty, setDirty] = useState(false),
    [confirming, setConfirming] = useState(false),
    [savedDraft, setSavedDraft] = useState(false);
  const [persisting,setPersisting]=useState(false),[draftError,setDraftError]=useState("");
  const durableAdapters=useRef(new Map<string,{element:{current:HTMLElement|null};save:()=>Promise<unknown>}>()),persisted=useRef(false);
  const durable=useCallback((id:string,adapter:{element:{current:HTMLElement|null};save:()=>Promise<unknown>}|null)=>{if(adapter)durableAdapters.current.set(id,adapter);else durableAdapters.current.delete(id);},[]);
  const closingAdapter=useRef<{element:{current:HTMLElement|null};save:()=>Promise<unknown>}|null>(null);
  const releaseNavigation=useRef<()=>void>(()=>{});
  const previousChange = useRef(changeVersion);
  const structuralDirty = useRef(false);
  useEffect(() => {
    // Structural edits (such as removing an observation) have no native input
    // event. A new edit must invalidate an explicitly retained draft too.
    if (open && draftable && previousChange.current !== changeVersion) {
      structuralDirty.current = true;
      setDirty(true);
    }
    previousChange.current = changeVersion;
  }, [changeVersion, open, draftable]);
  const retained = useRef(false),
    baseline = useRef(new Map<Element, string>()),
    reviewed = useRef(false),
    keepEditing = useRef<HTMLButtonElement>(null);
  const notify = useFeedback();
  const fields = () => Array.from(dialog.current?.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), select, textarea') || [])
    .filter(field => !('readOnly' in field && field.readOnly));
  const fieldValue = (field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
    if (field instanceof HTMLInputElement) {
      if (['checkbox', 'radio'].includes(field.type)) return String(field.checked);
      if (field.type === 'file') return JSON.stringify(Array.from(field.files || [],
        file => [file.name, file.size, file.lastModified]));
    }
    if (field instanceof HTMLSelectElement && field.multiple)
      return JSON.stringify(Array.from(field.selectedOptions, option => option.value));
    return field.value;
  };
  const capture = () => {
    for (const field of fields())
      if (!baseline.current.has(field)) baseline.current.set(field, fieldValue(field));
  };
  const changed = (event: { target: EventTarget | null }) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "search") return;
    if (draftable) setDirty(structuralDirty.current || reviewed.current || fields().some(field =>
      baseline.current.has(field) && baseline.current.get(field) !== fieldValue(field)));
  };
  const completed = useCallback((form?: HTMLElement) => {
    // Several access editors contain independent forms. Saving one must not
    // erase the close warning for unfinished changes in another.
    const current = fields();
    if (form) {
      const adapters = [...durableAdapters.current.values()];
      const completedTask = adapters.some(adapter => adapter.element.current === form);
      for (const field of current)
        // A task's shared property selector is context for the completed work.
        // Keep independent task containers dirty, including hidden drafts.
        if (form.contains(field) || completedTask &&
          !adapters.some(adapter => adapter.element.current?.contains(field)))
          baseline.current.set(field, fieldValue(field));
    } else baseline.current.clear();
    reviewed.current = false;
    structuralDirty.current = false;
    const remaining = !!form && current.some(field => baseline.current.has(field) &&
      baseline.current.get(field) !== fieldValue(field));
    setDirty(remaining);
    if (!remaining) {
      releaseNavigation.current();
      setSavedDraft(false);
      retained.current = false;
    }
  }, []);
  const draftSaved = useCallback((element?: HTMLElement) => {
    const current = fields(), adapters = [...durableAdapters.current.values()];
    for (const field of current)
      if (!element || element.contains(field) || !adapters.some(adapter => adapter.element.current?.contains(field)))
        baseline.current.set(field, fieldValue(field));
    const remaining = current.some(field => baseline.current.has(field) && baseline.current.get(field) !== fieldValue(field));
    // The durable save has been acknowledged. Clear only its busy registration
    // now, before closing; the task hook's effect cleanup may run a render later.
    const completedIds = [...durableAdapters.current].filter(([, adapter]) => adapter.element.current === element).map(([id]) => id);
    setBusyForms(previous => {
      if (!completedIds.some(id => previous.has(id))) return previous;
      const next = new Set(previous);
      for (const id of completedIds) next.delete(id);
      return next;
    });
    reviewed.current = false;
    structuralDirty.current = false;
    setDirty(remaining);
    retained.current = true;
    persisted.current = true;
    setSavedDraft(true);
    if (!remaining) releaseNavigation.current();
  }, []);
  const discard = () => {
    if (uncertain) return;
    completed();
    setConfirming(false);
    setVisited(false);
    (onDiscard || onClose)();
  };
  const keepRecovery = () => {
    retained.current = true;
    setSavedDraft(false);
    setConfirming(false);
    (onSaveDraft || onClose)(true);
    notify("Interrupted request kept for recovery. Retry the original request before starting another.");
  };
  const saveDraft = async () => {
    if (uncertain) { keepRecovery(); return; }
    const adapter=confirming?closingAdapter.current:[...durableAdapters.current.values()].find(item=>!!item.element.current?.getClientRects().length);
    if(adapter){setPersisting(true);setDraftError("");try{await adapter.save();draftSaved(adapter.element.current||undefined);setConfirming(false);(onSaveDraft||onClose)();notify("Task draft saved. Reopen it from Saved drafts after signing in.");}catch(error){setDraftError(error instanceof Error?error.message:"Unable to save this task draft.");}finally{setPersisting(false);}return;}
    retained.current = true;
    // Keep the original baseline: submitting one section later must still
    // recognize unfinished values in the other sections of a saved draft.
    reviewed.current = false;
    setDirty(false);
    setConfirming(false);
    setSavedDraft(true);
    (onSaveDraft || onClose)();
    notify("Draft saved for this page. Leaving or refreshing clears it.");
  };
  const requestClose = () => {
    if (blocked) return;
    closingAdapter.current=[...durableAdapters.current.values()].find(item=>!!item.element.current?.getClientRects().length)||null;
    if (uncertain || (draftable && (dirty || (hasChanges && !retained.current)))) setConfirming(true);
    else if (retained.current) (onSaveDraft || onClose)();
    else discard();
  };
  const register = useCallback((id: string, active: boolean) => {
    setBusyForms((previous) => {
      if (previous.has(id) === active) return previous;
      const next = new Set(previous);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const blocked = busy || busyForms.size > 0 || persisting;
  releaseNavigation.current=useEditorNavigationGuard({
    active: visited && (dirty || (hasChanges&&!retained.current) || (savedDraft&&!persisted.current) || uncertain || blocked),
    busy: blocked,
    uncertain,
  });
  useEffect(() => {
    if (open) setVisited(true);
    // Access refresh can conceal an open editor while a request is in flight
    // or its outcome is unknown. Close the dialog, but retain the mounted form
    // and its original retry payload/key until authorization is restored.
    else if (presentation === "dialog" && visited && (blocked || uncertain)) {
      retained.current = true;
      setConfirming(false);
    }
    // Browser Back can return a page editor to its directory without using its
    // close control. Keep that in-memory form available on the same page.
    else if (presentation === "page" && visited && (dirty || uncertain || retained.current)) {
      retained.current = true;
      if (!uncertain) setSavedDraft(true);
      setConfirming(false);
    }
    else if (!retained.current) { setVisited(false); baseline.current.clear(); reviewed.current = false; structuralDirty.current = false; setDirty(false); setSavedDraft(false); setConfirming(false); }
  }, [open]);
  useLayoutEffect(() => { if (!open || !visited) return; capture(); const observer = new MutationObserver(capture); if (dialog.current) observer.observe(dialog.current,{childList:true,subtree:true}); return () => observer.disconnect(); }, [open,visited]);
  useLayoutEffect(() => {
    const node = pageConfirmation.current;
    if (presentation !== "page" || !open || !confirming || !node) return;
    node.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (node.open) node.close();
      document.body.style.overflow = old;
    };
  }, [confirming, open, presentation]);
  useLayoutEffect(() => { if (confirming) keepEditing.current?.focus(); }, [confirming]);
  const protectBeforeUnload = useRef(false);
  protectBeforeUnload.current = uncertain || dirty || (open && hasChanges && !retained.current) || (savedDraft && !persisted.current) || blocked;
  useEffect(() => {
    // Read current protection at event time: a settled save must not leave a
    // stale listener warning during the interval before passive cleanup runs.
    const warn = (event: BeforeUnloadEvent) => { if (protectBeforeUnload.current) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    const node = dialog.current;
    if (!node || !visited) return;
    if (presentation === "page") {
      if (open) {
        node.scrollIntoView({ block: "start" });
        node.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
      }
      return;
    }
    if (!(node instanceof HTMLDialogElement)) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (open && !node.open) {
      node.showModal();
      node.scrollTop = 0;
    }
    if (!open && node.open) node.close();
    if (!open) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
      if (node.open) node.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [open, visited, presentation]);
  const previousTitle = useRef(title);
  useLayoutEffect(() => {
    const changed = previousTitle.current !== title;
    previousTitle.current = title;
    const node = dialog.current;
    if (changed && open && node && (presentation === "page" || (node instanceof HTMLDialogElement && node.open))) {
      node.scrollTop = 0;
      node
        .querySelector<HTMLElement>(".editor-heading h1, .editor-heading h2")
        ?.focus({ preventScroll: true });
    }
  }, [title, open, presentation]);
  if (!visited) return null;
  const confirmationTitle = uncertain ? "Recover the submitted request" : "Close without saving changes?";
  const confirmationContents = <>
    <h3>{confirmationTitle}</h3>
    <p id={`${titleId}-close-help`}>{uncertain ? "The response was interrupted and the request may already be saved. Keep its original details and retry identity to avoid creating it twice. Closing keeps recovery available on this page; it does not create a new draft." : closingAdapter.current ? "Keep editing, discard this form’s unfinished changes, or save this task to your account. You can resume it from Saved drafts after signing in again. Closing does not undo a request that was already submitted." : "Keep editing, discard this form’s unfinished changes, or explicitly save a draft for this page. Closing does not undo a request that was already submitted."}</p>
    {draftError && <p role="alert" className="notice error">{draftError}</p>}
    <div className="actions"><button ref={keepEditing} type="button" onClick={() => setConfirming(false)}>Keep editing</button>{uncertain ? <button type="button" className="secondary" onClick={keepRecovery}>Close &amp; keep recovery</button> : <><button type="button" className="secondary" onClick={discard}>Close without saving</button><button type="button" className="secondary" onClick={saveDraft}>Save draft &amp; close</button></>}</div>
  </>;
  const contents = <>
      <div className="editor-heading">
        <div>
          <p className="eyebrow">{eyebrow || (presentation === "page" ? "Task details" : "Property Flow")}</p>
          {presentation === "page" ? <h1 id={titleId} tabIndex={-1}>{title}</h1> : <h2 id={titleId} tabIndex={-1}>{title}</h2>}
        </div>
        {!confirming && <button
          type="button"
          className="secondary"
          disabled={blocked}
          onClick={requestClose}
        >
          {presentation === "page" ? backLabel : "Close"}
        </button>}
      </div>
      {confirming && presentation === "dialog" && <section className="editor-body" role="alertdialog" aria-label={confirmationTitle} aria-describedby={`${titleId}-close-help`}>{confirmationContents}</section>}
      <div className="editor-body" hidden={confirming}
        onFocusCapture={capture} onInputCapture={changed} onChangeCapture={changed}
        onSubmitCapture={() => { if (draftable) { reviewed.current = true; setDirty(true); } }}>
        {savedDraft && <p className="help">{persisted.current?"Task draft saved. Available from Saved drafts after signing in.":"Saved draft · available only while this page stays open."}</p>}
        {draftError&&<p role="alert" className="notice error">{draftError}</p>}
        {description && (
          <p id={descriptionId} className="help">
            {description}
          </p>
        )}
        <EditorContext.Provider value={{ busy: blocked, register, completed, uncertain, recovery,durable,draftSaved }}>
          <fieldset disabled={blocked} className="editor-contents">
            {children}
          </fieldset>
        </EditorContext.Provider>
        {uncertain ? <div className="actions"><button type="button" className="secondary" disabled={blocked} onClick={keepRecovery}>Close &amp; keep recovery</button></div> : draftable && (dirty || (hasChanges && !retained.current)) && <div className="actions"><button type="button" className="secondary" disabled={blocked} onClick={saveDraft}>Save as draft</button></div>}
      </div>
    </>;
  if (presentation === "page") return <><section
    ref={node => { dialog.current = node; }}
    className="page-editor"
    role="region"
    aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    hidden={!open}
  >{contents}</section>{open && confirming && createPortal(<dialog
    ref={pageConfirmation}
    className="editor-dialog page-editor-confirmation"
    role="alertdialog"
    aria-label={confirmationTitle}
    aria-describedby={`${titleId}-close-help`}
    onCancel={event => { event.preventDefault(); setConfirming(false); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
  ><div className="editor-body">{confirmationContents}</div></dialog>, document.body)}</>;
  return createPortal(
    <dialog
      ref={node => { dialog.current = node; }}
      className="editor-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) { if (confirming) setConfirming(false); else requestClose(); }
      }}
    >{contents}</dialog>,
    document.body,
  );
}
