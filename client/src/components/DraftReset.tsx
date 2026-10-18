import { useState } from "react";
import { useEditorBusy } from "./EditorDialog";
export function DraftReset({ reset }: { reset: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const editor = useEditorBusy();
  if (editor.uncertain) return <p className="help">Recover the interrupted request before starting another record.</p>;
  return confirm ? (
    <div className="draft-confirm" role="group" aria-label="Discard this draft">
      <p>
        Discard this form? If a previous save was interrupted, check your
        records before creating another.
      </p>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          setConfirm(false);
          editor.completed();
          reset();
        }}
      >
        Discard draft
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => setConfirm(false)}
      >
        Keep editing
      </button>
    </div>
  ) : (
    <button
      type="button"
      className="text-button"
      onClick={() => setConfirm(true)}
    >
      Clear draft
    </button>
  );
}
