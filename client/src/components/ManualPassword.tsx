import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { monitorOperation } from "../operations";
import { FormActions, FormField, FormSection } from "./FormFields";
import { formatActivityTime } from "../dates";
import { useEditorBusy } from "./EditorDialog";

type Attempt = { id: string; userId: string; status: string; reviewAfter: string };
type Review = { userId: string; name: string | null; email: string; reviewHash: string | null; canSetPassword?: boolean; unavailableReason?: string | null; operation: Attempt | null };
export function ManualPassword({ id, platform = false, active = true }: { id: string; platform?: boolean; active?: boolean }) {
  const { data } = useAuth();
  const scope = JSON.stringify([data?.user.id, data?.user.status, data?.membership, data?.permissions, data?.impersonation?.contextId, id]);
  const allowed = !data?.impersonation && !!data?.permissions.includes(platform ? "platform.manage" : "members.manage");
  return allowed && active ? <PasswordReview key={scope} id={id} platform={platform}/> : null;
}
function PasswordReview({ id, platform }: { id: string; platform: boolean }) {
  const { data } = useAuth();
  const base = `/api/${platform ? "platform" : "company"}/users/${encodeURIComponent(id)}/password`;
  const [open, setOpen] = useState(false), [review, setReview] = useState<Review | null>(null), [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState(""), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID()), [submitted, setSubmitted] = useState(false);
  const current = useRef(true);
  const editor = useEditorBusy(), formId = useId();
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  useEffect(() => { editor.register(formId, busy); return () => editor.register(formId, false); }, [busy, editor.register, formId]);
  const companyId = platform ? undefined : data?.membership?.companyId;
  const clear = () => { setPassword(""); setConfirmation(""); };
  async function load(key?: string) {
    setBusy(true); setError("");
    try {
      const result = await api<Review>(base + (key ? `?submissionKey=${encodeURIComponent(key)}` : ""), { expectedCompanyId: companyId });
      if (current.current) { setReview(result); if (result.operation?.status === "applied") setMessage("Password set. Existing Property Flow sessions were revoked."); }
    } catch (failure) { if (current.current) { setReview(null); setError(failure instanceof Error ? failure.message : "Password review is unavailable."); } }
    finally { if (current.current) setBusy(false); }
  }
  function close() { clear(); setReview(null); setOpen(false); setError(""); setMessage(""); }
  const pending = review?.operation && ["pending", "uncertain"].includes(review.operation.status);
  return <section className="divider" aria-label="Manual password management">
    <h3>Administrative password change</h3>
    <p className="help">Set a password for an existing email/password sign-in account. Property Flow requests no password-reset email and does not verify the email or grant company access. Password fields are cleared on close and after every attempt; they cannot be saved as a draft.</p>
    {!open ? <button type="button" className="secondary" onClick={() => { setOpen(true); void load(submitted ? submissionKey : undefined); }}>Set password manually</button> : <>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <><p role="status">{message}</p>{id === data?.user.id && <p><a href="/api/auth/login?switchAccount=1">Sign in again with your account</a></p>}</>}
      {busy && <p role="status">Checking or applying this password attempt…</p>}
      {review && <>
        <p>Account: <strong>{review.name || review.email}</strong> · {review.email}</p>
        {pending ? <div className="notice">
          <p>This attempt is {review.operation!.status === "pending" ? "awaiting confirmation" : "unconfirmed"}. Do not repeat the password write automatically. Check its status or review release after {formatActivityTime(review.operation!.reviewAfter)}.</p>
          <button className="secondary" type="button" disabled={busy} onClick={() => void load(submitted ? submissionKey : undefined)}>Check attempt status</button>
          <button className="secondary" type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError("");
            try { await api(base + "/release", { method: "POST", expectedCompanyId: companyId, body: { operationId: review.operation!.id, confirmed: true } }); if (current.current) { setSubmitted(false); setSubmissionKey(crypto.randomUUID()); clear(); await load(); } }
            catch (failure) { if (current.current) setError(failure instanceof Error ? failure.message : "This attempt could not be released."); }
            finally { if (current.current) setBusy(false); }
          }}>Release reviewed attempt</button>
          <p className="help">Release acknowledges that the prior result is unknown and allows a fresh password entry. It does not claim the previous password worked.</p>
        </div> : review.canSetPassword === false ? <p className="notice">{review.unavailableReason || "New password writes are unavailable for this account. Existing attempts remain reviewable."}</p> : <form className="workflow-form" autoComplete="off" onSubmit={async event => {
          event.preventDefault(); if (busy || submitted) return;
          setBusy(true); setError(""); setMessage(""); setSubmitted(true);
          try {
            const result = await monitorOperation("account.password.set", () => api<{ message: string }>(base, { method: "POST", expectedCompanyId: companyId, timeoutMs: 70000,
              body: { password, confirmation, reviewHash: review.reviewHash, submissionKey } }));
            if (current.current) { clear(); setMessage(result.message); setReview(null); }
          } catch (failure) {
            if (current.current) { clear(); const problem = failure instanceof Error ? failure.message : "The password result could not be confirmed."; await load(submissionKey); if (current.current) setError(problem); }
          } finally { if (current.current) { clear(); setBusy(false); } }
        }}>
          <fieldset disabled={busy || submitted} className="editor-contents">
            <FormSection title="Set an account password" description="The sign-in provider's password policy applies. Existing Property Flow sessions, including support sessions for this user, will end when this attempt is dispatched.">
              <FormField label="New account password" required><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)}/></FormField>
              <FormField label="Confirm new account password" required error={confirmation && confirmation !== password ? "The passwords must match." : undefined}><input type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></FormField>
            </FormSection>
            <FormActions><button type="submit" disabled={!password || password !== confirmation}>Set account password</button></FormActions>
          </fieldset>
        </form>}
      </>}
      <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => { clear(); setSubmitted(false); setSubmissionKey(crypto.randomUUID()); setMessage(""); void load(); }}>Refresh password review</button><button type="button" className="text-button" disabled={busy} onClick={close}>Close and clear password fields</button></div>
    </>}
  </section>;
}
