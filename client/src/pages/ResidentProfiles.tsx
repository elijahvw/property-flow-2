import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { tenantPath, tenantDirectorySearch } from "../tenant-links";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Form, InvitationForm, Invitations } from "./Workspace";

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
function Directory() {
  const [params, setParams] = useSearchParams();
  const r = useResource<Profile[]>("/api/company/resident-profiles", true, true);
  const query = params.get("q") || "", access = ["active", "disabled"].includes(params.get("access") || "") ? params.get("access")! : "all";
  const [inviting, setInviting] = useState(false),
    [invitationRevision, setInvitationRevision] = useState(0);
  const { can, data } = useAuth();
  const rows = r.data?.filter(p =>
    `${p.contactName || ""} ${p.user.name || ""} ${p.user.email}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (access === "all" || (access === "disabled" ? p.status !== "active" || p.user.status !== "active" : p.status === "active" && p.user.status === "active")));
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(tenantDirectorySearch(params));
    if (value && value !== "all") next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  return <div className="tenant-directory-page">
    <header className="page-heading page-heading-row">
      <div><p className="record-kicker">People / Tenants</p><h1>Tenants</h1><p>People, rental history and portal access in one place.</p></div>
      {can("members.manage") && <button onClick={() => setInviting(true)}>Invite tenant</button>}
    </header>
    <section className="panel tenant-directory-panel" aria-label="Tenant directory">
      <div className="tenant-directory-toolbar">
        <label className="tenant-search">Find resident<input type="search" placeholder="Search name or email" value={query} maxLength={200} onChange={e => filter("q", e.target.value)} /></label>
        <label>Portal access<select aria-label="Portal access" value={access} onChange={e => filter("access", e.target.value)}><option value="all">All access</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
        <span className="directory-count" role="status">{rows ? `${rows.length} ${rows.length === 1 ? "tenant" : "tenants"}` : "Loading tenants…"}</span>
      </div>
      {r.error && <p role="alert" className="notice error">{r.error} <button className="secondary" onClick={r.reload}>Try again</button></p>}
      {!r.data ? (!r.error && <p role="status">Loading residents…</p>) : !rows?.length ? <div className="empty-state"><h2>{query || access !== "all" ? "No matching tenants" : "Your tenant directory starts here"}</h2><p>{query || access !== "all" ? "Try a different name or access filter." : "Invite a tenant to your company. They appear here after accepting."}</p>{(query || access !== "all") && <button className="secondary" onClick={() => setParams({})}>Clear filters</button>}</div> : <div className="table-wrap"><table className="tenant-directory"><thead><tr><th>Tenant</th><th>Phone</th><th>Portal access</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map(p => <tr key={p.userId}>
        <td><div className="tenant-person"><span className="tenant-avatar small" aria-hidden="true">{(p.contactName || p.user.name || p.user.email).slice(0,1).toUpperCase()}</span><div><Link className="tenant-name" to={tenantPath(p.userId, params)}>{p.contactName || p.user.name || p.user.email}</Link><span className="cell-detail">{p.user.email}</span></div></div></td>
        <td data-label="Phone">{p.contactPhone || "—"}</td><td data-label="Portal access"><span className={`tenant-status ${p.status === "active" && p.user.status === "active" ? "" : "neutral"}`}>{p.status === "active" && p.user.status === "active" ? p.user.emailVerified ? "Active" : "Verification needed" : "Disabled"}</span></td>
        <td><Link className="tenant-row-action" to={tenantPath(p.userId, params)} aria-label={`View tenant ${p.contactName || p.user.name || p.user.email}`}>View tenant <span aria-hidden="true">→</span></Link></td>
      </tr>)}</tbody></table></div>}
    </section>
    {can("members.manage") && <><EditorDialog open={inviting} title="Invite tenant" onClose={() => setInviting(false)}><InvitationForm companyId={data?.membership?.companyId} audience="tenants" reload={() => setInvitationRevision(v => v + 1)} /></EditorDialog><Invitations key={invitationRevision} audience="tenants" /></>}
  </div>;
}
export function ResidentEditor({ id, close, mode = "contact", open = true }: { id: string; close: () => void; mode?: "contact" | "access"; open?: boolean }) {
  const { can } = useAuth();
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
              <div className="form-grid">
                {Object.entries(residentContactFields).map(([name, label]) => (
                  <label key={name}>
                    {label}
                    <input
                      name={name}
                      type={name.includes("Phone") ? "tel" : "text"}
                      maxLength={name.includes("Phone") ? 40 : 200}
                      defaultValue={draft[name as keyof typeof residentContactFields] || ""}
                    />
                  </label>
                ))}
              </div>
              <label>
                Internal management notes
                <textarea
                  name="managementNotes"
                  defaultValue={draft.managementNotes || ""}
                  maxLength={2000}
                  rows={4}
                />
              </label>
              <p className="help">
                Contact details are optional and visible to company owners and
                managers. This form does not change the sign-in email or company
                role.
              </p>
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
