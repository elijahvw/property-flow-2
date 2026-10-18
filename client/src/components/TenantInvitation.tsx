import { useState } from "react";
import { api } from "../api";
import { useResource } from "../useResource";
import { Form } from "./Form";
import { formatDate } from "../dates";
export type ContactInvitationState = {
  id: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};
type InviteContact = {
  name: string;
  email: string | null;
  version: number;
  userId: string | null;
  portal?: {state:string}|null;
  status: string;
  leases: {
    id: string;
    leaseId: string;
    role: string;
    version: number;
    lease: {
      version: number;
      startsOn: string;
      endsOn: string | null;
      property: { name: string };
      unit: { label: string };
    };
  }[];
};
export function TenantInvitation({
  contactId,
  done,
}: {
  contactId: string;
  done?: () => void;
}) {
  const r = useResource<InviteContact>(
    `/api/company/resident-contacts/${encodeURIComponent(contactId)}`,
  );
  const [link, setLink] = useState<{
      acceptanceUrl: string;
      expiresAt: string;
    } | null>(null),
    [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false);
  if (link)
    return (
      <div className="invitation-result">
        <h3>Invitation link ready</h3>
        <p>
          The Auth0 sign-in account is ready. Share this private link with the tenant. They can request password
          setup emails, verify their email, then sign in and accept. It connects
          to the profile you already saved.
        </p>
        <label>
          Private invitation link
          <input
            readOnly
            value={link.acceptanceUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        <p className="help">
          Expires {formatDate(link.expiresAt)}. Replacing the invitation revokes
          older links.
        </p>
        {copyError && (
          <p role="status">Select the link above and copy it manually.</p>
        )}
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(link.acceptanceUrl)
                .then(() => setCopied(true))
                .catch(() => setCopyError(true));
            }}
          >
            {copied ? "Copied" : "Copy invitation link"}
          </button>
          {done && (
            <button type="button" className="secondary" onClick={done}>
              Done
            </button>
          )}
        </div>
      </div>
    );
  if (!r.data)
    return (
      <div>
        {r.error ? (
          <p role="alert">
            {r.error} <button onClick={r.reload}>Try again</button>
          </p>
        ) : (
          <p role="status">Loading invitation review…</p>
        )}
      </div>
    );
  const person = r.data;
  if (person.portal)
    return <p>This account already has portal access configured. Manage its access from the tenant record.</p>;
  if (!person.email || person.status !== "active")
    return (
      <p>
        Add a contact email and keep this tenant active before inviting them.
      </p>
    );
  return (
    <Form
      key={JSON.stringify([person.version, person.leases])}
      secondaryActions={
        <button type="button" className="secondary" onClick={r.reload}>
          Refresh invitation review
        </button>
      }
      label="Create invitation link"
      operation="invitation.create"
      submit={async () =>
        setLink(
          await api(
            `/api/company/resident-contacts/${encodeURIComponent(contactId)}/invitations`,
            {
              method: "POST",
              body: {
                expectedVersion: person.version,
                approvals: person.leases.map((p) => ({
                  id: p.id,
                  leaseId: p.leaseId,
                  role: p.role,
                  version: p.version,
                  leaseVersion: p.lease.version,
                })),
              },
            },
          ),
        )
      }
    >
      <h3>Invite {person.name}</h3>
      <p>
        The person signing in must verify <strong>{person.email}</strong>. Their
        existing tenant profile, household records and balances stay connected.
      </p>
      {person.leases.length ? (
        <>
          <p>Review the household access this invitation approves:</p>
          <ul className="invitation-scope">
            {person.leases.map((p) => (
              <li key={p.id}>
                <strong>
                  {p.lease.property.name} · {p.lease.unit.label}
                </strong>
                <span>
                  {p.role === "leaseholder"
                    ? "Leaseholder · shared rent and deposit balances"
                    : "Occupant · no lease financial access"}
                </span>
                <span>
                  {formatDate(p.lease.startsOn)} through{" "}
                  {formatDate(p.lease.endsOn, "Open ended")}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="notice">
          This profile has no current lease. Accepting creates a company
          resident account; lease access is added through the owner’s household
          workflow.
        </p>
      )}
      <label className="checkbox-label">
        <input type="checkbox" required />I approve this person and the access
        shown above.
      </label>
      <p className="help">
        You’ll get a private link to share. This invitation uses their existing Auth0 account. It does not create another user, send an
        email or activate portal access. The tenant completes setup and verified
        acceptance first.
      </p>
    </Form>
  );
}
