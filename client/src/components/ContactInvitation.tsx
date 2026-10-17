import { formatDate } from "../dates";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { AcceptInvitation, Form } from "../pages/Workspace";
export function InvitationEntry() {
  const { user, loading, error, signIn, refreshUser } = useAuth();
  const [setupMessage,setSetupMessage]=useState("");
  if (loading) return <p role="status">Restoring your sign-in…</p>;
  const token = sessionStorage.getItem("pf-invitation");
  if (!token)
    return (
      <section className="panel">
        <h1>Open your invitation</h1>
        <p>Use the full private link provided by the owner.</p>
      </section>
    );
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
          You have been invited to Property Flow. Your Property Flow account is ready. Choose a password if needed, then sign in to review your access.
        </p>
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
            <button onClick={signIn}>Sign in to review invitation</button>
          </li>
        </ol>
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
          <button onClick={() => void refreshUser()}>
            I’ve verified my email
          </button>
        </div>
      </section>
    );
  return <AcceptInvitation />;
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
