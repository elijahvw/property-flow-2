import { recordReference } from "../record-reference";

// Internal source IDs remain in exports and diagnostics. Everyday screens show
// a plain-language reference when one exists, without an empty details menu.
export function RecordIdentity({
  reference,
}: {
  id: string;
  reference?: string;
  label?: string;
}) {
  return reference ? (
    <span className="reference-code">{recordReference(reference)}</span>
  ) : null;
}
