import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { Form } from "./Form";

export function TeamInvitationReview({ token, accepted }: { token: string; accepted: () => Promise<void> }) {
  const [preview, setPreview] = useState<{ company: string; role: string; accepted?: boolean } | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const { user, switchAccount } = useAuth();
  useEffect(() => {
    const controller = new AbortController(); setPreview(null); setError("");
    void api<NonNullable<typeof preview>>("/api/invitations/preview", { method: "POST", body: { token }, signal: controller.signal }).then(setPreview).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to review the invitation."); });
    return () => controller.abort();
  }, [token, revision]);
  if (error) return <div><p className="notice error" role="alert">{error}</p><div className="actions"><button onClick={() => setRevision(value => value + 1)}>Review invitation again</button><button className="secondary" onClick={switchAccount}>Use a different account</button><Link to="/help/invitations">Invitation help</Link></div></div>;
  if (!preview) return <p role="status">Loading your invitation…</p>;
  return <Form label={preview.accepted ? "Continue to workspace" : "Accept invitation"} operation="invitation.accept" feedbackText="Invitation accepted." submit={async () => { await api("/api/invitations/accept", { method: "POST", body: { token } }); await accepted(); }}>
    <dl className="lease-review-summary"><div><dt>Company</dt><dd>{preview.company}</dd></div><div><dt>Your role</dt><dd>{({ owner: "Company owner", manager: "Manager", staff: "Staff", resident: "Resident" } as Record<string, string>)[preview.role] || preview.role}</dd></div><div><dt>Signed in as</dt><dd>{user?.email}</dd></div></dl>
    <p>{preview.accepted ? "This invitation is already accepted. Continue with your current access." : "Accepting adds this account to the company in the role shown. It cannot transfer you from another company or restore disabled access."}</p>
    <button type="button" className="text-button" onClick={switchAccount}>Use a different account</button>
  </Form>;
}
