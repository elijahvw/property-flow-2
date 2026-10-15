import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

const EditorContext = createContext<{
  busy: boolean;
  register: (id: string, busy: boolean) => void;
}>({ busy: false, register: () => {} });
export const useEditorBusy = () => useContext(EditorContext);

// Keep a closed editor mounted: dismissing a failed request must not discard its
// fields or rotate its durable submission key. Only a successful save/start-over
// should create a new logical submission.
export function EditorDialog({
  open,
  title,
  description,
  onClose,
  children,
  busy = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId(),
    descriptionId = useId();
  const [visited, setVisited] = useState(open),
    [busyForms, setBusyForms] = useState<Set<string>>(() => new Set());
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
  }, [open]);
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
  if (!visited) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="editor-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!blocked) onClose();
      }}
    >
      <div className="editor-heading">
        <div>
          <p className="eyebrow">Property Flow</p>
          <h2 id={titleId}>{title}</h2>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={blocked}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="editor-body">
        {description && (
          <p id={descriptionId} className="help">
            {description}
          </p>
        )}
        <EditorContext.Provider value={{ busy: blocked, register }}>
          <fieldset disabled={blocked} className="editor-contents">{children}</fieldset>
        </EditorContext.Provider>
      </div>
    </dialog>,
    document.body,
  );
}
