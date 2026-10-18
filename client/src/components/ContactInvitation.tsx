import { formatDate } from "../dates";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { AcceptInvitation } from "../pages/Workspace";
import { Form } from "./Form";
export function InvitationEntry() {
  const { user, loading, error, signIn, switchAccount, refreshUser } = useAuth();
  const [setupMessage,setSetupMessage]=useState("");
  const [entry,setEntry]=useState<{company:string;role:string;kind:string}|null>(null),[entryError,setEntryError]=useState(""),[entryRevision,setEntryRevision]=useState(0);
  const [invitationToken,setInvitationToken]=useState(()=>sessionStorage.getItem("pf-invitation"));
  useEffect(()=>{const changed=()=>{setEntry(null);setEntryError("");setSetupMessage("");setInvitationToken(sessionStorage.getItem("pf-invitation"));};window.addEventListener("pf-invitation-changed",changed);return()=>window.removeEventListener("pf-invitation-changed",changed);},[]);
  useEffect(()=>{if(!invitationToken)return;setEntryError("");const controller=new AbortController();void api<NonNullable<typeof entry>>("/api/invitations/entry",{method:"POST",body:{token:invitationToken},signal:controller.signal}).then(value=>{
    if(controller.signal.aborted)return;setEntry(value);
    if(value.kind){sessionStorage.setItem("pf-contact-invitation",String(value.kind==="contact"));sessionStorage.setItem("pf-lease-invitation",String(value.kind==="lease"));}
  }).catch(failure=>{if(!controller.signal.aborted)setEntryError(failure instanceof Error?failure.message:"Unable to open this invitation.");});return()=>controller.abort();},[invitationToken,entryRevision]);
  if (loading) return <p role="status">Restoring your sign-in…</p>;
  const token = invitationToken;
  if (!token)
    return (
      <section className="panel">
        <h1>Open your invitation</h1>
        <p>Use the full private link provided by the owner.</p>
      </section>
    );
  if(!entry&&!entryError) return <p role="status">Loading your invitation…</p>;
  if(entryError) return <section className="panel"><h1>Invitation unavailable</h1><p role="alert">{entryError}</p><p>Your existing account and rental records are unchanged. Ask the current owner to send a fresh invitation.</p><div className="actions"><button className="secondary" onClick={()=>setEntryRevision(value=>value+1)}>Try invitation again</button><Link to="/help/invitations">Get invitation help</Link></div></section>;
  if (error)
    return (
      <section className="panel">
        <h1>Unable to load your account</h1>
        <p role="alert">{error}</p>
        <button onClick={() => void refreshUser()}>Try again</button>
      </section>
    );
  if (!user)
    return (
      <section className="panel invitation-welcome">
        <p className="record-kicker">Your Property Flow account</p>
        <h1>Welcome to Property Flow</h1>
        <p>
          {entry?.company ? `${entry.company} has invited you as a ${entry.role}.` : "You have been invited to Property Flow."} Sign in to review the invitation. If you need a password, use the setup option below.
        </p>
        <div className="actions"><button onClick={signIn}>Sign in to review invitation</button><Link to="/help/invitations">Invitation help</Link></div>
        <details className="editor-section"><summary>First time signing in or need a password?</summary>
        <ol className="lease-next-steps">
          <li>
            <h2>Choose your password</h2>
            <p>
              Request a setup email for your existing account. Choose your password using the link, then sign in below. This does not create another user.
            </p>
            <Form
              label="Email me a setup link"
              operation="invitation.accept"
              submit={async () => {
                const result=await api<{message:string}>("/api/invitations/setup-account", {
                  method: "POST",
                  body: { token },
                });
                setSetupMessage(result.message);
              }}
              feedbackText="Account setup request completed."
            >
              {null}
            </Form>
            {setupMessage && <p role="status">{setupMessage}</p>}
          </li>
          <li>
            <h2>Sign in & accept</h2>
            <p>
              Already have an account? Sign in with the invited email. You’ll
              review the invitation before accepting.
            </p>
            <p>After setting your password, return here and use Sign in to review invitation.</p>
          </li>
        </ol></details>
      </section>
    );
  if (!user.emailVerified)
    return (
      <section className="panel">
        <h1>Verify your email to continue</h1>
        <p>Verify {user.email}, then return here to review your invitation.</p>
        <div className="actions">
          <Link className="button secondary" to="/account">
            Account & verification
          </Link>
          <button className="secondary" onClick={switchAccount}>Use a different account</button>
          <button onClick={() => void refreshUser()}>
            I’ve verified my email
          </button>
        </div>
      </section>
    );
  return <>{entry?.kind!=="team"&&<p className="help">Signed in as {user.email}. <button className="text-button" onClick={switchAccount}>Use a different account</button></p>}<AcceptInvitation /></>;
}
export function ContactInvitationReview({
  token,
  accepted,
}: {
  token: string;
  accepted: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<{
      company: string;
      name: string;
      accepted?: boolean;
      leaseApprovals: { role: string }[];
      leases?: {
        property: string;
        unit: string;
        role: string;
        startsOn: string;
        endsOn: string | null;
        leaseStartsOn: string;
        leaseEndsOn: string | null;
      }[];
    } | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setPreview(null);
    void api<typeof preview>("/api/invitations/preview", {
      method: "POST",
      body: { token },
      signal: controller.signal,
    })
      .then(setPreview)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [token, revision]);
  if (error)
    return (
      <>
        <p role="alert">{error}</p>
        <button onClick={() => setRevision((v) => v + 1)}>
          Review invitation again
        </button>
      </>
    );
  if (!preview) return <p role="status">Loading your invitation…</p>;
  if (preview.accepted)
    return (
      <Form
        label="Continue to resident portal"
        operation="invitation.accept"
        submit={async () => {
          await api("/api/invitations/accept", {
            method: "POST",
            body: { token },
          });
          await accepted();
        }}
      >
        <h2>Your profile is connected</h2>
        <p>
          This account is already linked to {preview.name} at {preview.company}.
          Continue to view your current access.
        </p>
      </Form>
    );
  return (
    <Form
      label="Accept tenant invitation"
      operation="invitation.accept"
      submit={async () => {
        await api("/api/invitations/accept", {
          method: "POST",
          body: { token },
        });
        await accepted();
      }}
    >
      <dl className="lease-review-summary">
        <div>
          <dt>Owner company</dt>
          <dd>{preview.company}</dd>
        </div>
        <div>
          <dt>Your existing tenant profile</dt>
          <dd>{preview.name}</dd>
        </div>
      </dl>
      {preview.leases?.length ? (
        <ul className="invitation-scope">
          {preview.leases.map((p, i) => (
            <li key={i}>
              <strong>
                {p.property} · {p.unit}
              </strong>
              <span>
                {p.role === "leaseholder" ? "Leaseholder" : "Occupant"} ·{" "}
                {formatDate(p.startsOn)} through{" "}
                {formatDate(p.endsOn, "Open ended")}
              </span>
              <span>
                Lease: {formatDate(p.leaseStartsOn)} through{" "}
                {formatDate(p.leaseEndsOn, "Open ended")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        Accepting connects this verified account to your existing profile. Your
        owner approves household changes.
      </p>
      <p className="notice">
        {preview.leaseApprovals?.some((p) => p.role === "leaseholder")
          ? "Approved leaseholders can see the shared rent and deposit balances for their leases. Occupants have no lease financial access."
          : "This invitation gives no lease financial access. Only owner-approved leaseholders can see shared balances."}
      </p>
    </Form>
  );
}
