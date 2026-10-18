import { leasePath } from "../lease-links";
import { formatDate } from "../dates";
import { TenantForm } from "../components/TenantForm";
import { useEffect, useId, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { tenantPath, contactPath, tenantDirectorySearch, tenantLedgerContext } from "../tenant-links";
import { tenantPortalState } from "../tenant-status";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Invitations } from "./Workspace";
import { Form } from "../components/Form";

export type Profile = {
  userId: string;
  status: string;
  version: number;
  contactName: string | null;
  contactPhone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  managementNotes: string | null;
  user: {
    name: string | null;
    email: string;
    status: string;
    emailVerified: boolean;
  };
};
export type ResidentProfileDetail = Profile & {
  contactId?: string | null;
  assignments: { property: { id: string; name: string; address: string } }[];
  activity: { id: string; action: string; createdAt: string }[];
};
export const residentContactFields = {
  contactName: "Contact name",
  contactPhone: "Contact phone",
  emergencyContactName: "Emergency contact name",
  emergencyContactPhone: "Emergency contact phone",
} as const;
export function ResidentProfiles() {
  const { data } = useAuth();
  const [params] = useSearchParams();
  if (params.get("residentId")) return <Navigate replace to={tenantPath(params.get("residentId")!, params)} />;
  return (
    <Directory
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}`}
    />
  );
}
type DirectoryProfile = Omit<Profile, "userId" | "user"> & {
  userId: string | null;
  user: Profile["user"] | null;
  contactId?: string;
  recordStatus?: string;
  portalState?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  canArchive?: boolean;
  rentals?: {
    leaseId: string;
    propertyId: string;
    propertyName: string;
    unitLabel: string;
    role: string;
    status: string;
    startsOn: string;
    endsOn: string | null;
  }[];
};
function Directory() {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false),
    [inviteInitially, setInviteInitially] = useState(false),
    [formRevision, setFormRevision] = useState(0);
  const [params, setParams] = useSearchParams();
  const r = useResource<DirectoryProfile[]>(
    "/api/company/resident-profiles",
    true,
    true,
  );
  const query = params.get("q") || "",
    access = [
      "active",
      "verification",
      "disabled",
      "offline",
      "pending",
    ].includes(params.get("access") || "")
      ? params.get("access")!
      : "all";

  const { can } = useAuth();
  const property = params.get("propertyId") || "",
    rental = params.get("rental") || "all";
  const propertyChoices = [
    ...new Map(
      r.data
        ?.flatMap((p) => p.rentals || [])
        .map((r) => [r.propertyId, r.propertyName]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const rows = r.data?.filter(
    (p) =>
      `${p.contactName || p.name || ""} ${p.user?.name || ""} ${p.email || p.user?.email || ""} ${p.phone || p.contactPhone || ""} ${(p.rentals || []).map((r) => `${r.propertyName} ${r.unitLabel}`).join(" ")}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (access === "all" || tenantPortalState(p) === access) &&
      (rental === "unassigned"
        ? !property && !p.rentals?.length
        : (!property && rental === "all") ||
          (p.rentals || []).some(
            (r) =>
              (!property || r.propertyId === property) &&
              (rental === "all" || r.status === rental),
          )) &&
      (p.recordStatus || "active") ===
        (params.get("records") === "archived" ? "archived" : "active"),
  );
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(tenantDirectorySearch(params));
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <div className="tenant-directory-page">
      <header className="page-heading page-heading-row">
        <div>
          <p className="record-kicker">People / Tenants</p>
          <h1>Tenants</h1>
          <p>People, rental history and portal access in one place.</p>
        </div>
        <div className="actions">
          <button
            onClick={() => {
              setInviteInitially(false);
              setAdding(true);
            }}
          >
            Add tenant
          </button>
          {can("members.manage") && (
            <button
              className="secondary"
              onClick={() => {
                setInviteInitially(true);
                setAdding(true);
              }}
            >
              Invite tenant
            </button>
          )}
        </div>
      </header>
      <EditorDialog
        open={adding}
        title="Add tenant"
        description="Save one account and tenant profile. You can activate portal access separately."
        onClose={() => {
          setAdding(false);
          setFormRevision((v) => v + 1);
          r.reload();
        }}
      >
        <TenantForm
          key={`${inviteInitially}:${formRevision}`}
          inviteInitially={inviteInitially}
          saved={(row) => {
            setAdding(false);
            r.reload();
            navigate(contactPath(row.id));
          }}
          cancel={() => setAdding(false)}
        />
      </EditorDialog>
      <section
        className="panel tenant-directory-panel"
        aria-label="Tenant directory"
      >
        <div className="tenant-directory-toolbar">
          <label className="tenant-search">
            Find resident
            <input
              type="search"
              placeholder="Name, email, property or unit"
              value={query}
              maxLength={200}
              onChange={(e) => filter("q", e.target.value)}
            />
          </label>
          <label>
            Property
            <select aria-label="Property"
              value={property}
              onChange={(e) => filter("propertyId", e.target.value)}
            >
              <option value="">All properties</option>
              {propertyChoices.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rental relationship
            <select aria-label="Rental relationship"
              value={rental}
              onChange={(e) => filter("rental", e.target.value)}
            >
              <option value="all">All relationships</option>
              <option value="current">Current lease</option>
              <option value="upcoming">Upcoming lease</option>
              <option value="draft">Draft lease</option>
              <option value="former">Former tenant</option>
              <option value="unassigned">No lease recorded</option>
            </select>
          </label>
          <label>
            Portal access
            <select
              aria-label="Portal access"
              value={access}
              onChange={(e) => filter("access", e.target.value)}
            >
              <option value="all">All access</option>
              <option value="offline">Not invited</option>
              <option value="pending">Invitation pending</option>
              <option value="active">Active</option>
              <option value="verification">Verification needed</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label>
            Tenant records
            <select
              aria-label="Tenant records"
              value={
                params.get("records") === "archived" ? "archived" : "active"
              }
              onChange={(e) =>
                filter(
                  "records",
                  e.target.value === "archived" ? "archived" : "all",
                )
              }
            >
              <option value="active">Not archived</option>
              <option value="archived">Archived records</option>
            </select>
          </label>
          <span className="directory-count" role="status">
            {rows
              ? `${rows.length} ${rows.length === 1 ? "tenant" : "tenants"}`
              : "Loading tenants…"}
          </span>
        </div>
        {r.error && (
          <p role="alert" className="notice error">
            {r.error}{" "}
            <button className="secondary" onClick={r.reload}>
              Try again
            </button>
          </p>
        )}
        {!r.data ? (
          !r.error && <p role="status">Loading residents…</p>
        ) : !rows?.length ? (
          <div className="empty-state">
            <h2>
              {query || property || rental !== "all" || access !== "all"
                ? "No matching tenants"
                : params.get("records") === "archived"
                  ? "No archived tenants"
                  : "Your tenant directory starts here"}
            </h2>
            <p>
              {query || property || rental !== "all" || access !== "all"
                ? "Try a different name, property, unit or access filter."
                : params.get("records") === "archived"
                  ? "Former tenants appear here after you archive their records. Their history stays available."
                  : "Add a tenant without a login, then record their lease. Portal access can be arranged separately."}
            </p>
            {(query || property || rental !== "all" || access !== "all") && (
              <button className="secondary" onClick={() => setParams({})}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tenant-directory">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Property &amp; unit</th>
                  <th>Portal access</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const name =
                      p.name ||
                      p.contactName ||
                      p.user?.name ||
                      p.email ||
                      p.user?.email ||
                      "Tenant",
                    path = p.contactId
                      ? contactPath(p.contactId, params)
                      : tenantPath(p.userId!, params),
                    portal = tenantPortalState(p);
                  return (
                    <tr key={p.contactId || p.userId}>
                      <td>
                        <div className="tenant-person">
                          <span
                            className="tenant-avatar small"
                            aria-hidden="true"
                          >
                            {name.slice(0, 1).toUpperCase()}
                          </span>
                          <div>
                            <Link className="tenant-name" to={path}>
                              {name}
                            </Link>
                            <span className="cell-detail">
                              {p.email || p.user?.email || "Email not supplied"}
                            </span>
                            {(p.phone || p.contactPhone) && (
                              <span className="cell-detail">
                                {p.phone || p.contactPhone}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td data-label="Property & unit">
                        <div className="tenant-rental-associations">
                          {p.rentals?.length ? (
                            p.rentals.map((rental) => (
                              <div
                                className="tenant-rental-association"
                                key={rental.leaseId}
                              >
                                <Link
                                  to={leasePath(rental.leaseId,tenantLedgerContext(p.contactId||p.userId!,params,!!p.contactId))}
                                >
                                  {rental.propertyName}
                                  <span className="cell-detail">
                                    {rental.unitLabel}
                                  </span>
                                </Link>
                                <span
                                  className={`tenant-rental-state ${rental.status}`}
                                >
                                  {rental.status === "current"
                                    ? "Current"
                                    : rental.status === "upcoming"
                                      ? "Upcoming"
                                      : rental.status === "draft"
                                        ? "Draft lease"
                                        : "Former"}{" "}
                                  ·{" "}
                                  {rental.role === "occupant"
                                    ? "Occupant"
                                    : "Leaseholder"}
                                </span>
                                <span className="cell-detail">
                                  {formatDate(rental.startsOn)} –{" "}
                                  {rental.endsOn
                                    ? formatDate(rental.endsOn)
                                    : "Open ended"}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span className="section-caption">
                              No lease association recorded
                            </span>
                          )}
                        </div>
                      </td>
                      <td data-label="Portal access">
                        <span
                          className={`tenant-status ${portal === "active" ? "" : "neutral"}`}
                        >
                          {portal === "active"
                            ? "Active"
                            : portal === "verification"
                              ? "Verification needed"
                              : portal === "offline"
                                ? "Not invited"
                                : portal === "pending"
                                  ? "Invitation pending"
                                  : "Disabled"}
                        </span>
                      </td>
                      <td>
                        <div className="tenant-directory-actions">
                          <Link
                            className="tenant-row-action"
                            to={path}
                            aria-label={`View tenant ${name}`}
                          >
                            View tenant <span aria-hidden="true">→</span>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {can("members.manage") && (
        <details className="panel directory-support">
          <summary>
            Tenant invitations{" "}
            <span>Review pending, accepted and expired portal invitations</span>
          </summary>
          <Invitations audience="tenants" />
        </details>
      )}
    </div>
  );
}
export function ResidentEditor({ id, close, mode = "contact", open = true }: { id: string; close: () => void; mode?: "contact" | "access"; open?: boolean }) {
  const { can } = useAuth();
  const helpId = useId();
  const [accessEditing, setAccessEditing] = useState(mode === "access");
  const endpoint = `/api/company/resident-profiles/${encodeURIComponent(id)}`;
  const r = useResource<ResidentProfileDetail>(endpoint);
  const [draft, setDraft] = useState<Profile>();
  const [editing, setEditing] = useState(true);
  const person = r.data;
  useEffect(() => { if (person && !draft) setDraft(person); }, [person, draft]);
  return (
    <EditorDialog
      open={open}
      title={mode === "access" ? "Tenant portal access" : "Tenant contact information"}
      onClose={close}
    >
      {r.error && (
        <p role="alert">
          {r.error} <button onClick={r.reload}>Try again</button>
        </p>
      )}
      {!person ? (
        !r.error && <p role="status">Loading profile…</p>
      ) : (
        <>
          {mode === "contact" && <>
          <div className="profile-summary">
            <span className="avatar">
              {(person.contactName || person.user.name || person.user.email)
                .slice(0, 1)
                .toUpperCase()}
            </span>
            <div>
              <strong>
                {person.contactName || person.user.name || person.user.email}
              </strong>
              <p>{person.user.email}</p>
            </div>
            <span className="badge">{person.status}</span>
          </div>
          <div className="section-heading">
            <h3>Contact information</h3>
            {!editing && (
              <button
                onClick={() => {
                  setDraft(person);
                  setEditing(true);
                }}
              >
                Edit resident profile
              </button>
            )}
          </div>
          {editing && draft ? (
            <Form
              key={draft.version}
              label="Save resident profile"
              operation="membership.update"
              submit={async (form) => {
                await api(endpoint, {
                  method: "PATCH",
                  body: {
                    ...Object.fromEntries(form),
                    expectedVersion: draft.version,
                  },
                });
                setEditing(false);
                r.reload();
              }}
            >
              <p className="help">All fields are optional. Add the details your team needs to contact this tenant and manage their rental.</p>
              {([
                { title: "Tenant contact", fields: ["contactName", "contactPhone"] as const, help: "These details do not change the tenant’s sign-in email or company role." },
                { title: "Emergency contact", fields: ["emergencyContactName", "emergencyContactPhone"] as const, help: "A person to contact in an emergency. This does not add a roommate or grant portal access." },
              ]).map((section, index) => (
                <fieldset key={section.title} className="form-section" aria-describedby={`${helpId}-${index}`}>
                  <legend>{section.title}</legend>
                  <p className="help" id={`${helpId}-${index}`}>{section.help}</p>
                  <div className="form-grid">
                    {section.fields.map(name => (
                      <label key={name}>
                        {residentContactFields[name]}
                        <input
                          name={name}
                          type={name.includes("Phone") ? "tel" : "text"}
                          maxLength={name.includes("Phone") ? 40 : 200}
                          defaultValue={draft[name] || ""}
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <fieldset className="form-section">
                <legend>Internal notes</legend>
                <label>
                  Internal management notes
                  <textarea
                    name="managementNotes"
                    aria-describedby={`${helpId}-notes`}
                    defaultValue={draft.managementNotes || ""}
                    maxLength={2000}
                    rows={4}
                  />
                </label>
                <p className="help" id={`${helpId}-notes`}>
                  Contact details and notes are visible to company owners and managers. Notes can contain up to 2,000 characters.
                </p>
              </fieldset>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditing(false);
                  r.reload();
                }}
              >
                Discard edits
              </button>
            </Form>
          ) : (
            <dl className="details">
              {Object.entries(residentContactFields).map(([name, label]) => (
                <div key={name}>
                  <dt>{label}</dt>
                  <dd>
                    {person[name as keyof typeof residentContactFields] || "Not supplied"}
                  </dd>
                </div>
              ))}
              <div>
                <dt>Internal management notes</dt>
                <dd className="preserve-lines">
                  {person.managementNotes || "None"}
                </dd>
              </div>
            </dl>
          )}
          </>}
          {mode === "access" && can("members.manage") && (
            <section className="editor-section">
              <h3>Company access</h3>
              {accessEditing ? (
                <Form
                  key={person.version}
                  label="Save tenant access"
                  operation="membership.update"
                  submit={async (form) => {
                    await api(
                      `/api/company/members/${encodeURIComponent(id)}`,
                      {
                        method: "PATCH",
                        body: {
                          role: "resident",
                          status: String(form.get("status")),
                          expectedVersion: person.version,
                        },
                      },
                    );
                    setAccessEditing(false);
                    r.reload();
                  }}
                >
                  <label>
                    Tenant access
                    <select name="status" defaultValue={person.status}>
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </label>
                  <p className="help">
                    Disabling access removes property assignments. Reactivation
                    requires assigning properties again. The sign-in account
                    remains managed by the platform administrator.
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setAccessEditing(false)}
                  >
                    Cancel access changes
                  </button>
                </Form>
              ) : (
                <>
                  <p>
                    {person.status === "active"
                      ? "Active company membership"
                      : "Disabled company membership"}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => setAccessEditing(true)}
                  >
                    Edit tenant access
                  </button>
                </>
              )}
            </section>
          )}
        </>
      )}
    </EditorDialog>
  );
}
