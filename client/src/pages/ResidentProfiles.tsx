import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Form, InvitationForm, Invitations } from "./Workspace";

type Profile = {
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
type Detail = Profile & {
  assignments: { property: { id: string; name: string; address: string } }[];
  activity: { id: string; action: string; createdAt: string }[];
};
const fields = {
  contactName: "Contact name",
  contactPhone: "Contact phone",
  emergencyContactName: "Emergency contact name",
  emergencyContactPhone: "Emergency contact phone",
} as const;
export function ResidentProfiles() {
  const { data } = useAuth();
  return (
    <Directory
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}`}
    />
  );
}
function Directory() {
  const [params] = useSearchParams();
  const r = useResource<Profile[]>(
    "/api/company/resident-profiles",
    true,
    true,
  );
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(params.get("residentId") || ""),
    [inviting, setInviting] = useState(false),
    [invitationRevision, setInvitationRevision] = useState(0);
  const rows = r.data?.filter((p) =>
    `${p.contactName || ""} ${p.user.name || ""} ${p.user.email}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const { can, data } = useAuth();
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">People</p>
        <h1>Tenants</h1>
        <p>
          Contact information, property access and activity for residents in
          your company.
        </p>
        {can("members.manage") && (
          <button onClick={() => setInviting(true)}>Invite tenant</button>
        )}
      </header>
      <section className="panel">
        <div className="section-heading">
          <h2>Resident directory</h2>
          <span className="badge">{rows?.length ?? "…"} residents</span>
        </div>
        <label className="search-field">
          Find resident
          <input
            placeholder="Name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {r.error && (
          <p role="alert">
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
            <h3>{query ? "No matching residents" : "No residents yet"}</h3>
            <p>
              {query
                ? "Try another name or email."
                : "Invite a tenant here. They appear in this directory after accepting."}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="tenant-directory">
              <thead>
                <tr>
                  <th>Resident</th>
                  <th>Contact</th>
                  <th>Access</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.userId}>
                    <td>
                      <strong>
                        {p.contactName || p.user.name || p.user.email}
                      </strong>
                      <span className="cell-detail">{p.user.email}</span>
                    </td>
                    <td data-label="Contact">{p.contactPhone || "No phone recorded"}</td>
                    <td data-label="Access">
                      <span className="badge">
                        {p.status === "active" && p.user.status === "active"
                          ? p.user.emailVerified
                            ? "Active"
                            : "Email verification needed"
                          : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => setSelected(p.userId)}
                      >
                        Manage resident
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {can("members.manage") && (
        <>
          <EditorDialog
            open={inviting}
            title="Invite tenant"
            onClose={() => setInviting(false)}
          >
            <InvitationForm
              companyId={data?.membership?.companyId}
              audience="tenants"
              reload={() => setInvitationRevision((v) => v + 1)}
            />
          </EditorDialog>
          <Invitations key={invitationRevision} audience="tenants" />
        </>
      )}
      {selected && (
        <ResidentEditor
          id={selected}
          close={() => {
            setSelected("");
            r.reload();
          }}
        />
      )}
    </>
  );
}
function ResidentEditor({ id, close }: { id: string; close: () => void }) {
  const { can } = useAuth();
  const [accessEditing, setAccessEditing] = useState(false);
  const endpoint = `/api/company/resident-profiles/${encodeURIComponent(id)}`;
  const r = useResource<Detail>(endpoint);
  const [draft, setDraft] = useState<Profile>();
  const [editing, setEditing] = useState(false);
  const person = r.data;
  return (
    <EditorDialog
      open
      title={
        person
          ? `Resident · ${person.contactName || person.user.name || person.user.email}`
          : "Resident profile"
      }
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
                {Object.entries(fields).map(([name, label]) => (
                  <label key={name}>
                    {label}
                    <input
                      name={name}
                      type={name.includes("Phone") ? "tel" : "text"}
                      maxLength={name.includes("Phone") ? 40 : 200}
                      defaultValue={draft[name as keyof typeof fields] || ""}
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
              {Object.entries(fields).map(([name, label]) => (
                <div key={name}>
                  <dt>{label}</dt>
                  <dd>
                    {person[name as keyof typeof fields] || "Not supplied"}
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
          {can("members.manage") && (
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
          <section className="editor-section">
            <h3>Property access</h3>
            {person.assignments.length ? (
              <ul className="record-list">
                {person.assignments.map(({ property }) => (
                  <li key={property.id}>
                    <div>
                      <Link
                        to={`/company/properties/${encodeURIComponent(property.id)}/residents`}
                      >
                        {property.name}
                      </Link>
                      <p>{property.address}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No properties assigned.</p>
            )}
            <p className="help">
              Use Manage residents in a property's workspace to change
              assignments.
            </p>
          </section>
          <details className="editor-section">
            <summary>Resident activity</summary>
            <p className="help">
              Latest 100 events for this resident in this company.
            </p>
            {person.activity.length ? (
              <ol className="activity-list">
                {person.activity.map((e) => (
                  <li key={e.id}>
                    <strong>{e.action.replace(/\./g, " ")}</strong>
                    <time dateTime={e.createdAt}>
                      {new Date(e.createdAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No recorded activity.</p>
            )}
          </details>
        </>
      )}
    </EditorDialog>
  );
}
