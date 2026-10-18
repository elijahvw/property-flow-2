import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useFeedback } from "./components/Feedback";

// A saved form stays attached to its original record/version. Switching records
// is explicit, and an interrupted write must be recovered before replacing it.
export function useEditorSelection<T>(initial: T) {
  const [value, setValue] = useState(initial), [open, setOpen] = useState(!!initial);
  const current = useRef(initial), saved = useRef(false), recovery = useRef(false);
  const notify = useFeedback();
  const select: Dispatch<SetStateAction<T>> = useCallback(next => {
    const selected = typeof next === "function" ? (next as (value: T) => T)(current.current) : next;
    const previous = current.current;
    const same = previous === selected || !!(previous && selected &&
      typeof previous === "object" && typeof selected === "object" &&
      "id" in previous && "id" in selected && previous.id === selected.id);
    if (selected && !same && recovery.current) {
      notify("Recover the interrupted request before opening another record.");
      setOpen(true);
      return;
    }
    if (selected && !same && saved.current &&
      !window.confirm("Discard the saved draft and open another record? Cancel keeps your draft.")) return;
    if (!same) {
      saved.current = false;
      recovery.current = false;
      current.current = selected;
    }
    setValue(current.current);
    setOpen(!!selected);
  }, [notify]);
  const closeDraft = useCallback((interrupted = false) => {
    saved.current = true;
    recovery.current = interrupted;
    setOpen(false);
  }, []);
  return [value, select, open, closeDraft] as const;
}
