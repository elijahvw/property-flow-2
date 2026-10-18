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

const EditorContext = createContext<{
  busy: boolean;
  register: (id: string, busy: boolean) => void;
  completed: (form?: HTMLFormElement) => void;
  uncertain: boolean;
  recovery: (id: string, active: boolean) => void;
}>({ busy: false, register: () => {}, completed: () => {}, uncertain: false, recovery: () => {} });
export const useEditorBusy = () => useContext(EditorContext);

// Only an explicit draft save keeps an editor mounted after closing. Its state,
// files and reviewed versions stay in memory on this page; nothing is replayed.
export function EditorDialog({
  open,
  title,
  description,
  onClose,
  onDiscard,
  onSaveDraft,
  draftable = true,
  hasChanges = false,
  children,
  busy = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onDiscard?: () => void;
  onSaveDraft?: (recovery?: boolean) => void;
  draftable?: boolean;
  hasChanges?: boolean;
  children: ReactNode;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
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
  const retained = useRef(false),
    baseline = useRef(new Map<Element, string>()),
    reviewed = useRef(false),
    keepEditing = useRef<HTMLButtonElement>(null);
  const notify = useFeedback();
  const fields = () => Array.from(dialog.current?.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea') || [])
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
  const changed = () => {
    if (draftable) setDirty(reviewed.current || fields().some(field =>
      baseline.current.has(field) && baseline.current.get(field) !== fieldValue(field)));
  };
  const completed = useCallback((form?: HTMLFormElement) => {
    // Several access editors contain independent forms. Saving one must not
    // erase the close warning for unfinished changes in another.
    const current = fields();
    if (form) {
      for (const field of current)
        if (form.contains(field)) baseline.current.set(field, fieldValue(field));
    } else baseline.current.clear();
    reviewed.current = false;
    const remaining = !!form && current.some(field => baseline.current.has(field) &&
      baseline.current.get(field) !== fieldValue(field));
    setDirty(remaining);
    if (!remaining) {
      setSavedDraft(false);
      retained.current = false;
    }
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
  const saveDraft = () => {
    if (uncertain) { keepRecovery(); return; }
    retained.current = true;
    baseline.current.clear();
    capture();
    reviewed.current = false;
    setDirty(false);
    setConfirming(false);
    setSavedDraft(true);
    (onSaveDraft || onClose)();
    notify("Draft saved for this page. Leaving or refreshing clears it.");
  };
  const requestClose = () => {
    if (blocked) return;
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
  const blocked = busy || busyForms.size > 0;
  useEffect(() => {
    if (open) setVisited(true);
    else if (!retained.current) { setVisited(false); baseline.current.clear(); reviewed.current = false; setDirty(false); setSavedDraft(false); setConfirming(false); }
  }, [open]);
  useLayoutEffect(() => { if (!open || !visited) return; capture(); const observer = new MutationObserver(capture); if (dialog.current) observer.observe(dialog.current,{childList:true,subtree:true}); return () => observer.disconnect(); }, [open,visited]);
  useLayoutEffect(() => { if (confirming) keepEditing.current?.focus(); }, [confirming]);
  useEffect(() => { if (!uncertain && (!open || !(dirty || hasChanges))) return; const warn = (event:BeforeUnloadEvent) => { event.preventDefault(); }; window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn); }, [open,dirty,hasChanges,uncertain]);
  useEffect(() => {
    const node = dialog.current;
    if (!node || !visited) return;
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
  }, [open, visited]);
  const previousTitle = useRef(title);
  useLayoutEffect(() => {
    const changed = previousTitle.current !== title;
    previousTitle.current = title;
    const node = dialog.current;
    if (changed && open && node?.open) {
      node.scrollTop = 0;
      node
        .querySelector<HTMLElement>(".editor-heading h2")
        ?.focus({ preventScroll: true });
    }
  }, [title, open]);
  if (!visited) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="editor-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) { if (confirming) setConfirming(false); else requestClose(); }
      }}
    >
      <div className="editor-heading">
        <div>
          <p className="eyebrow">Property Flow</p>
          <h2 id={titleId} tabIndex={-1}>
            {title}
          </h2>
        </div>
        {!confirming && <button
          type="button"
          className="secondary"
          disabled={blocked}
          onClick={requestClose}
        >
          Close
        </button>}
      </div>
      {confirming && <section className="editor-body" role="alertdialog" aria-label={uncertain ? "Recover the submitted request" : "Close without saving changes?"} aria-describedby={`${titleId}-close-help`}>
        <h3>{uncertain ? "Recover the submitted request" : "Close without saving changes?"}</h3>
        <p id={`${titleId}-close-help`}>{uncertain ? "The response was interrupted and the request may already be saved. Keep its original details and retry identity to avoid creating it twice. Closing keeps recovery available on this page; it does not create a new draft." : "Keep editing, discard this form’s unfinished changes, or explicitly save a draft for this page. Closing does not undo a request that was already submitted."}</p>
        <div className="actions"><button ref={keepEditing} type="button" onClick={() => setConfirming(false)}>Keep editing</button>{uncertain ? <button type="button" className="secondary" onClick={keepRecovery}>Close &amp; keep recovery</button> : <><button type="button" className="secondary" onClick={discard}>Close without saving</button><button type="button" className="secondary" onClick={saveDraft}>Save draft &amp; close</button></>}</div>
      </section>}
      <div className="editor-body" hidden={confirming}
        onFocusCapture={capture} onInputCapture={changed} onChangeCapture={changed}
        onSubmitCapture={() => { if (draftable) { reviewed.current = true; setDirty(true); } }}>
        {savedDraft && <p className="help">Saved draft · available only while this page stays open.</p>}
        {description && (
          <p id={descriptionId} className="help">
            {description}
          </p>
        )}
        <EditorContext.Provider value={{ busy: blocked, register, completed, uncertain, recovery }}>
          <fieldset disabled={blocked} className="editor-contents">
            {children}
          </fieldset>
        </EditorContext.Provider>
        {uncertain ? <div className="actions"><button type="button" className="secondary" disabled={blocked} onClick={keepRecovery}>Close &amp; keep recovery</button></div> : draftable && (dirty || (hasChanges && !retained.current)) && <div className="actions"><button type="button" className="secondary" disabled={blocked} onClick={saveDraft}>Save as draft</button></div>}
      </div>
    </dialog>,
    document.body,
  );
}
