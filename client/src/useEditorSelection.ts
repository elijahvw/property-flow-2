import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

// Separate a selected record from visibility so explicit page-only drafts can
// retain their exact record/version while the dialog is closed.
export function useEditorSelection<T>(initial: T) {
  const [value, setValue] = useState(initial), [open, setOpen] = useState(!!initial);
  const select: Dispatch<SetStateAction<T>> = useCallback(next => {
    setValue(previous => {
      const selected = typeof next === "function" ? (next as (value:T)=>T)(previous) : next;
      if (previous && selected && typeof previous === "object" && typeof selected === "object" && "id" in previous && "id" in selected && previous.id === selected.id) return previous;
      return selected;
    });
    setOpen(typeof next === "function" || !!next);
  }, []);
  const closeDraft = useCallback(() => setOpen(false), []);
  return [value, select, open, closeDraft] as const;
}
