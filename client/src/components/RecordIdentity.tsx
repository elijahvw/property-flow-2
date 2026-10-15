import { useState } from "react";
export function RecordIdentity({
  id,
  reference,
  label = "Record",
}: {
  id: string;
  reference?: string;
  label?: string;
}) {
  const [copy, setCopy] = useState("");
  return (
    <div className="record-identity">
      {reference && <span className="reference-code">{reference}</span>}
      <details>
        <summary>{label} details</summary>
        <p className="help">
          Internal ID: <code className="identifier">{id}</code>
        </p>
        <button
          type="button"
          className="text-button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(id);
              setCopy("ID copied.");
            } catch {
              setCopy("Select the ID above to copy it.");
            }
          }}
        >
          Copy internal ID
        </button>
        {copy && <span role="status">{copy}</span>}
      </details>
    </div>
  );
}
