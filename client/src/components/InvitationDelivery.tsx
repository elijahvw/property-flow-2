import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatDate } from "../dates";
import { useResource } from "../useResource";
import { Form } from "./Form";

export type InvitationResult = { id: string; approvedAt?: string | null; version?: number; acceptanceUrl?: string | null; expiresAt: string; deliveryStatus?: string; deliveryRequestedAt?: string | null; recovered?: boolean };
export function invitationDeliveryLabel(row: Pick<InvitationResult, "deliveryStatus" | "deliveryRequestedAt">) {
  if (row.deliveryStatus === "accepted") return "Email accepted for sending";
  if (row.deliveryStatus === "failed") return "Email request failed";
  if (row.deliveryStatus === "unknown" || (row.deliveryStatus === "requesting" && Date.now() - Date.parse(row.deliveryRequestedAt || "") > 60000)) return "Email outcome unconfirmed";
  return row.deliveryStatus === "requesting" ? "Email request in progress" : "Private link";
}

export function InvitationDelivery({ initial, changed = () => {}, done }: { initial: InvitationResult; changed?: () => void; done?: () => void }) {
  const [row, setRow] = useState(initial), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false);
  const availability = useResource<{ emailAvailable: boolean }>("/api/invitations/delivery");
  // Freeze the exact payload on a failed/ambiguous request. Explicit completion
  // creates a fresh key; clicking Retry cannot rotate another private link.
  const [attempt, setAttempt] = useState<{ submissionKey: string; expectedVersion: number; delivery: "email" | "link" } | null>(null);
  const run = async (delivery: "email" | "link") => {
    if (attempt && attempt.delivery !== delivery) throw new Error("Retry the pending action first. Refresh invitation history before starting a different action.");
    const body = attempt || { submissionKey: crypto.randomUUID(), expectedVersion: row.version || 1, delivery };
    setAttempt(body);
    const result = await api<InvitationResult>(`/api/invitations/${encodeURIComponent(row.id)}/replace`, { method: "POST", body, timeoutMs: 20000 });
    setAttempt(null); setRow(result); setCopied(false); changed();
  };
  return <section className="invitation-result" aria-label="Invitation delivery">
    <h3>{row.acceptanceUrl ? "Invitation link ready" : "Invitation saved"}</h3>
    <p>{row.acceptanceUrl ? "Send the invitation by email or share this private link. The recipient reviews their access before accepting." : "The invitation is saved. Generate a replacement link or send it by email to continue. Older links will stop working."}</p>
    {row.acceptanceUrl && <label>Private invitation link<input readOnly value={row.acceptanceUrl} className="dd-privacy-hidden" onFocus={event => event.currentTarget.select()} /></label>}
    <p className="help">Expires {formatDate(row.expiresAt)}. <Link to="/help/invitations">How invitations work</Link></p>
    {row.deliveryStatus && row.deliveryStatus !== "not_requested" && <p role="status">{invitationDeliveryLabel(row)}. {row.deliveryStatus === "accepted" ? "This confirms the provider accepted the message, not that it reached the inbox. Check spam if it does not arrive." : row.deliveryStatus === "failed" || row.deliveryStatus === "unknown" ? "You can share the private link, or explicitly request another email after a minute." : "Refresh invitation history if the outcome does not appear."}</p>}
    {row.acceptanceUrl && <div className="actions"><button type="button" className="secondary" onClick={() => void (navigator.clipboard?.writeText(row.acceptanceUrl!) || Promise.reject()).then(() => { setCopied(true); setCopyError(false); }).catch(() => setCopyError(true))}>{copied ? "Copied" : "Copy invitation link"}</button></div>}
    {copyError && <p role="status">Select the link above and copy it manually.</p>}
    {availability.data?.emailAvailable ? <Form label={attempt ? "Retry invitation email" : "Send invitation email"} operation="invitation.send" feedbackText="Invitation email request finished. Review its status." successText="Request finished." submit={async () => run("email")}><p className="help">Sending creates a fresh private link and replaces the earlier one.</p></Form> : <p className="help">{availability.error ? <>Email availability could not load. <button className="text-button" type="button" onClick={availability.reload}>Try again</button></> : availability.data ? "Email invitations are not enabled for this workspace yet. Use the private link." : "Checking email availability…"}</p>}
    {(!row.acceptanceUrl || !!attempt && attempt.delivery === "link") && <Form label={attempt ? "Retry replacement link" : "Create replacement link"} operation="invitation.create" feedbackText="Replacement invitation ready." submit={async () => run("link")}><span className="help">Only the replacement link will work.</span></Form>}
    {done && <button type="button" className="secondary" onClick={done}>Done</button>}
  </section>;
}
