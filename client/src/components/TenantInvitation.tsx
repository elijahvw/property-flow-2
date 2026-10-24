import { InvitationDelivery, type InvitationResult } from "./InvitationDelivery";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useResource } from "../useResource";
import { Form } from "./Form";
import { formatDate } from "../dates";
import { useAuth } from "../context/AuthContext";
import { tenantEditorScope, tenantLeasingWriteBlock, tenantPortalAvailabilityNote, useTenantAttemptContext, useTenantEditorRecord } from "../tenant-write-access";
export type ContactInvitationState = {
  id: string;
  version?: number;
  leaseId?: string | null;
  approvedAt?: string | null;
  deliveryStatus?: string;
  deliveryRequestedAt?: string | null;
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
type TenantInvitationProps = { contactId: string; done?: () => void };
export function TenantInvitation(props: TenantInvitationProps) {
  const { data } = useAuth();
  return <TenantInvitationWorkspace key={`${props.contactId}:${tenantEditorScope(data)}`} {...props}/>;
}
function TenantInvitationWorkspace({
  contactId,
  done,
}: TenantInvitationProps) {
  const { data: auth } = useAuth();
  const context = useTenantAttemptContext(auth);
  const writeBlock = tenantLeasingWriteBlock(auth?.companyFeatures), portalNote = tenantPortalAvailabilityNote(auth?.companyFeatures);
  const r = useResource<InviteContact>(
    `/api/company/resident-contacts/${encodeURIComponent(contactId)}`,
  );
  const [submissionKey,setSubmissionKey] = useState(() => crypto.randomUUID());
  const [link, setLink] = useState<InvitationResult | null>(null);
  const record = useTenantEditorRecord(r, `${contactId}:${tenantEditorScope(auth)}`);
  const [reviewed, setReviewed] = useState<InviteContact | null>(null);
  useEffect(() => { if (!reviewed && record && !r.loading) setReviewed(record); }, [reviewed, record, r.loading]);
  const denied = [401, 403, 404].includes(r.errorStatus || 0);
  const person = denied ? undefined : reviewed || record;
  if (link && !denied) return <InvitationDelivery initial={link} reviewAccess={()=>{setLink(null);setSubmissionKey(crypto.randomUUID());r.reload();}} done={()=>{setLink(null);setSubmissionKey(crypto.randomUUID());r.reload();done?.();}}/>;
  if (!person)
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
  if (person.portal)
    return <p>This account already has portal access configured. Manage its access from the tenant record.</p>;
  if (!person.email || person.status !== "active")
    return (
      <p>
        Add a contact email and keep this tenant active before inviting them.
      </p>
    );
  return (
    <>
    {writeBlock && <p className="notice" role="status">{writeBlock}</p>}
    {portalNote && <p className="help">{portalNote}</p>}
    {r.error && <p role="alert">{r.error} Refresh the invitation review before creating a link. <button type="button" className="secondary" onClick={r.reload}>Retry invitation review</button></p>}
    <fieldset disabled={!!writeBlock || !!r.error || (!reviewed && r.loading)} className="editor-contents"><Form
      key={JSON.stringify([person.version, person.leases])}
      secondaryActions={
        <button type="button" className="secondary" onClick={() => { setReviewed(null); setSubmissionKey(crypto.randomUUID()); r.reload(); }}>
          Refresh invitation review
        </button>
      }
      label="Create invitation link"
      operation="invitation.create"
      submit={async () => {
        if (!context.current()) throw new Error("Reload the workspace before creating this invitation.");
        if (writeBlock) throw new Error(writeBlock);
        if (r.error) throw new Error("Refresh the invitation review before creating a link.");
        const result = await api<InvitationResult>(
            `/api/company/resident-contacts/${encodeURIComponent(contactId)}/invitations`,
            {
              method: "POST",
              expectedCompanyId: context.companyId,
              body: {
                expectedVersion: person.version,
                submissionKey,
                approvals: person.leases.map((p) => ({
                  id: p.id,
                  leaseId: p.leaseId,
                  role: p.role,
                  version: p.version,
                  leaseVersion: p.lease.version,
                })),
              },
            },
          );
        if (!context.current()) throw new ApiError("Your account or company changed before the invitation result was acknowledged.", 409, "TENANT_CONTEXT_CHANGED", true);
        setLink(result);
      }}
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
        Review this access first. You can then send an email invitation or share a private link. Portal access starts only after the tenant signs in and accepts.
      </p>
    </Form></fieldset>
    </>
  );
}
