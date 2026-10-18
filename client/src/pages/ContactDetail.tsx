import { InvitationDelivery } from "../components/InvitationDelivery";
import { Address } from "../components/Address";
import {
  TenantInvitation,
  type ContactInvitationState,
} from "../components/TenantInvitation";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { useEditorSelection } from "../useEditorSelection";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { TenantForm, type TenantContact } from "../components/TenantForm";
import { TenantFinancials } from "./ResidentDetail";
import { ResidentEditor } from "./ResidentProfiles";
import { Form } from "../components/Form";
import { tenantDirectorySearch } from "../tenant-links";
import { formatDate } from "../dates";
type Contact = TenantContact & {
  user?: {id:string;email:string;emailVerified:boolean;firstSignedInAt:string|null}|null;
  canArchive?: boolean;
  invitations: ContactInvitationState[];
  portal: {
    userId: string;
    state: string;
    manageable: boolean;
    membershipVersion: number | null;
  } | null;
  activity: { id: string; action: string; createdAt: string }[];
};
export function ContactDetail() {
  const { contactId = "" } = useParams(),
    { data } = useAuth();
  return (
    <ContactWorkspace
      key={`${contactId}:${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}`}
      id={contactId}
    />
  );
}
function ContactWorkspace({ id }: { id: string }) {
  const { can } = useAuth(),
    [params] = useSearchParams(),
    r = useResource<Contact>(
      `/api/company/resident-contacts/${encodeURIComponent(id)}`,
      true,
      true,
    );
  const [invite, setInvite] = useState(false),[delivery,setDelivery]=useState<ContactInvitationState|null>(null);
  const [editing, setEditing] = useState(false),
    [access, setAccess, accessOpen, saveAccessDraft] = useEditorSelection(false),
    [archive, setArchive] = useState(false);
  const [draft, setDraft] = useState<Contact | null>(null),
    person = r.data;
  const directory =
    "/company/residents" +
    (tenantDirectorySearch(params) ? `?${tenantDirectorySearch(params)}` : "");
  if (!person)
    return (
      <section className="panel">
        <Link to={directory}>← All tenants</Link>
        {r.error ? (
          <>
            <h1>Tenant unavailable</h1>
            <p role="alert">{r.error}</p>
            <button onClick={r.reload}>Try again</button>
          </>
        ) : (
          <p role="status">Loading tenant…</p>
        )}
      </section>
    );
  const pending = person.invitations?.find(
    (i) =>
      !i.acceptedAt &&
      !i.revokedAt &&
      new Date(i.expiresAt).getTime() > Date.now(),
  );
  return (
    <div className="tenant-workspace">
      <nav className="record-breadcrumb" aria-label="Breadcrumb">
        <Link to={directory}>← All tenants</Link>
        <span>/</span>
        <span>{person.name}</span>
      </nav>
      <header className="tenant-record-header">
        <span className="tenant-avatar" aria-hidden="true">
          {person.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="tenant-record-title">
          <p className="record-kicker">Tenant record</p>
          <h1>{person.name}</h1>
          <p>
            {person.preferredName ? `Goes by ${person.preferredName} · ` : ""}
            {person.email || "Email not supplied"}
          </p>
        </div>
        <span className="tenant-status neutral">
          {person.status === "archived"
            ? "Archived"
            : !person.portal
              ? pending
                ? "Invitation pending"
                : "Not invited"
              : person.portal.state === "active"
                ? "Portal active"
                : person.portal.state === "verification"
                  ? "Verification needed"
                  : "Portal disabled"}
        </span>
        <button
          className="secondary"
          disabled={!!r.error}
          onClick={() => {
            setDraft(person);
            setEditing(true);
          }}
        >
          Edit tenant details
        </button>
      </header>

      {r.error && (
        <p role="alert" className="notice error">
          {r.error} <button onClick={r.reload}>Refresh tenant</button>
        </p>
      )}
      <div className="tenant-content-grid">
        <div className="tenant-primary">
          {can("finance.manage") && can("lease.manage") ? <TenantFinancials id={id} contact setup={{ name: person.preferredName || person.name, active: person.status === "active" }} /> : <section className="panel"><h2>Lease and financial information</h2><p>Your current permissions do not include this information.</p></section>}
          <section className="panel">
            <h2>Recent activity</h2>
            {person.activity.length ? (
              <ol className="tenant-timeline">
                {person.activity.map((e) => (
                  <li key={e.id}>
                    <strong>{e.action.replace(/\./g, " ")}</strong>
                    <time dateTime={e.createdAt}>
                      {formatDate(e.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No activity recorded yet.</p>
            )}
          </section>
        </div>
        <aside className="tenant-secondary">
          <section className="panel">
            <h2>Contact details</h2>
            <dl className="tenant-facts">
              <div>
                <dt>Email</dt>
                <dd>{person.email || "Not supplied"}</dd>
              </div>
              <div>
                <dt>Primary phone</dt>
                <dd>{person.phone || "Not supplied"}</dd>
              </div>
              <div>
                <dt>Alternate phone</dt>
                <dd>{person.alternatePhone || "Not supplied"}</dd>
              </div>
              <div>
                <dt>Preferred contact</dt>
                <dd>{person.preferredContact || "No preference"}</dd>
              </div>
              <div>
                <dt>Mailing address</dt>
                <dd>
                  <Address
                    street={person.addressLine1}
                    line2={person.addressLine2}
                    city={person.city}
                    region={person.region}
                    postalCode={person.postalCode}
                    country={person.country}
                  />
                </dd>
              </div>
            </dl>
          </section>
          <section className="panel">
            <h2>Emergency contact</h2>
            <p>{person.emergencyContactName || "Not supplied"}</p>
            <p>
              {[person.emergencyRelationship, person.emergencyContactPhone]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="help">
              Emergency contacts are separate from household residents and have
              no portal access.
            </p>
          </section>
          <section className="panel">
            <h2>Account & portal access</h2>
            {person.user&&<p>Sign-in account ready · {person.user.email} · {person.user.firstSignedInAt?"Has signed in":"No sign-in recorded"}. Email {person.user.emailVerified?"verified":"not yet verified"}.</p>}
            {can("members.manage") && person.userId && <Form label="Send password reset email" operation="account.verification" submit={async()=>{await api(`/api/company/resident-contacts/${encodeURIComponent(id)}/password-reset`,{method:"POST",body:{}});}} feedbackText="Password reset email requested for the existing account."><p className="help">Your sign-in provider sends the reset link. This uses the same account and does not change company or lease access.</p></Form>}
            {!person.portal ? (
              <>
                <p>
                  {pending
                    ? "An invitation is pending. This tenant keeps the same profile when they verify their email and accept."
                    : "Their sign-in account is ready. Invite them when you want to offer portal access."}
                </p>
                {pending?.leaseId&&!pending.approvedAt?<p><Link to={`/company/leases/${encodeURIComponent(pending.leaseId)}?section=invitations`}>Review household invitation approval</Link></p>:can("members.manage") && person.status === "active" && (
                  <button className="secondary" onClick={() => pending?setDelivery(pending):setInvite(true)}>
                    {pending ? "Send or replace invitation" : "Invite to portal"}
                  </button>
                )}
                {pending && can("members.manage") && (
                  <Form
                    label="Revoke invitation"
                    operation="invitation.create"
                    submit={async () => {
                      await api(
                        `/api/invitations/${encodeURIComponent(pending.id)}/revoke`,
                        { method: "POST", body: {expectedVersion:pending.version} },
                      );
                      r.reload();
                    }}
                  >
                    <p className="help">
                      Revoking cancels this link and keeps the tenant profile.
                    </p>
                  </Form>
                )}
              </>
            ) : (
              <>
                <p>
                  Contact details are separate from the sign-in identity.
                  Leaseholder/occupant roles and current assignments still
                  control shared lease access.
                </p>
                {can("members.manage") && person.portal.manageable && (
                  <button className="secondary" onClick={() => setAccess(true)}>
                    Manage tenant portal access
                  </button>
                )}
              </>
            )}
          </section>
          <section className="panel tenant-private-notes">
            <div className="section-heading">
              <h2>Management notes</h2>
              <span className="tenant-private-label">Internal</span>
            </div>
            <p className="preserve-lines">
              {person.managementNotes || "No internal notes added."}
            </p>
          </section>
          <details className="tenant-record-options">
            <summary>More tenant actions</summary>
            <p>
              {person.canArchive === false && person.status !== "archived"
                ? "Review current, upcoming or draft lease relationships before archiving this tenant."
                : "Archive former tenants when their lease relationships have ended. History and recorded money remain searchable."}
            </p>
            <button
              className="text-button"
              disabled={!!r.error || (person.status !== "archived" && person.canArchive === false)}
              onClick={() => {
                setDraft(person);
                setArchive(true);
              }}
            >
              {person.status === "archived"
                ? "Restore tenant"
                : "Archive tenant"}
            </button>
          </details>
        </aside>
      </div>
      <EditorDialog
        open={invite}
        title="Review tenant invitation"
        onClose={() => {
          setInvite(false);
          r.reload();
        }}
      >
        <TenantInvitation
          contactId={id}
          done={() => {
            setInvite(false);
            r.reload();
          }}
        />
      </EditorDialog>
      <EditorDialog
        open={editing}
        title="Edit tenant details"
        onClose={() => setEditing(false)} onDiscard={() => { setEditing(false); setDraft(null); r.reload(); }}
      >
        {draft && (
          <TenantForm
            key={`${draft.id}:${draft.version}`}
            value={draft}
            saved={() => {
              setEditing(false);
              setDraft(null);
              r.reload();
            }}
            cancel={() => {
              setEditing(false);
              setDraft(null);
              r.reload();
            }}
          />
        )}
      </EditorDialog>
      <EditorDialog
        open={archive}
        title={
          person.status === "archived" ? "Restore tenant" : "Archive tenant"
        }
        onClose={() => setArchive(false)}
      >
        {draft && (
          <Form
            label={
              draft.status === "archived"
                ? "Confirm restore"
                : "Confirm archive"
            }
            operation="membership.update"
            submit={async () => {
              const {
                id: _id,
                userId: _user,
                version: expectedVersion,
                status,
                ...rest
              } = draft;
              const keys = [
                "name",
                "preferredName",
                "email",
                "phone",
                "alternatePhone",
                "preferredContact",
                "addressLine1",
                "addressLine2",
                "city",
                "region",
                "postalCode",
                "country",
                "emergencyContactName",
                "emergencyContactPhone",
                "emergencyRelationship",
                "managementNotes",
              ];
              await api(
                `/api/company/resident-contacts/${encodeURIComponent(id)}`,
                {
                  method: "PATCH",
                  body: {
                    ...Object.fromEntries(
                      Object.entries(rest).filter(([key]) =>
                        keys.includes(key),
                      ),
                    ),
                    expectedVersion,
                    status: status === "archived" ? "active" : "archived",
                  },
                },
              );
              setArchive(false);
              setDraft(null);
              r.reload();
            }}
          >
            <p>
              {draft.status === "archived"
                ? "Restore this tenant so they can be selected for a lease again?"
                : "Archive this tenant? Active/draft leases must be reviewed first. Their rental, financial and audit history will remain."}
            </p>
          </Form>
        )}
      </EditorDialog>
      {delivery&&<EditorDialog open draftable={false} title={`Invitation for ${person.name}`} onClose={()=>{setDelivery(null);r.reload();}}><InvitationDelivery key={delivery.id} initial={delivery} changed={r.reload} done={()=>{setDelivery(null);r.reload();}} reviewAccess={!delivery.leaseId?()=>{setDelivery(null);setInvite(true);}:undefined}/></EditorDialog>}
      {access && person.userId && (
        <ResidentEditor
          id={person.userId}
          mode="access"
          open={accessOpen}
          onSaveDraft={saveAccessDraft}
          close={() => {
            setAccess(false);
            r.reload();
          }}
        />
      )}
    </div>
  );
}
