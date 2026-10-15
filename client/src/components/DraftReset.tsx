import { useState } from "react";
export function DraftReset({ reset }: { reset: () => void }) {
  const [confirm, setConfirm] = useState(false);
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
