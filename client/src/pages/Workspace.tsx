import {
  UserProvisioning,
  UserVerificationControls,
} from "../components/UserProvisioning";
import React, { useEffect, useState } from "react";
import { useUserDirectory } from "../useUserDirectory";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { monitorOperation } from "../operations";
import { useResource } from "../useResource";
import OwnerOnboarding from "../components/OwnerOnboarding";
import type { OperationName } from "../operation-lifecycle";

type Company = {
  id: string;
  name: string;
  status: string;
  _count?: { memberships: number };
  memberships?: Member[];
};
type Member = {
  userId: string;
  companyId: string;
  role: string;
  status: string;
  version?: number;
  user: { name: string | null; email: string; status: string };
};
type Person = {
  emailVerified?: boolean;
  firstSignedInAt?: string | null;
  id: string;
  name: string | null;
  email: string;
  status: string;
  platformRole: string | null;
  companyId: string | null;
  role: string;
  membership: (Member & { company: Company }) | null;
};
const roles = ["owner", "manager", "staff", "resident"];
function LoadState({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <div className="notice error" role="alert">
      <p>{error}</p>
      <button className="secondary" onClick={retry}>
        Try again
      </button>
    </div>
  ) : (
    <p role="status">Loading records…</p>
  );
}
export function Form({
  children,
  submit,
  label = "Save changes",
  operation = "account.update",
}: {
  children: React.ReactNode;
  submit: (data: FormData) => Promise<void>;
  label?: string;
  operation?: OperationName;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        setSaved(false);
        try {
          await monitorOperation(operation, () => submit(data));
          setSaved(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unable to save changes.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        {children}
        <div className="actions">
          <button type="submit">{busy ? "Saving…" : label}</button>
          {saved && <span role="status">Saved.</span>}
        </div>
      </fieldset>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
const text = (data: FormData, key: string) => String(data.get(key) || "");
function Field({
  name,
  label,
  value = "",
  type = "text",
  required = true,
}: {
  name: string;
  label: string;
  value?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        defaultValue={value}
        type={type}
        required={required}
        maxLength={type === "email" ? 254 : 200}
      />
    </label>
  );
}
function RoleSelect({
  value = "resident",
  owner = false,
}: {
  value?: string;
  owner?: boolean;
}) {
  return (
    <label>
      Company role
      <select name="role" defaultValue={value}>
        {roles
          .filter((role) => owner || role !== "owner")
          .map((role) => (
            <option key={role} value={role}>
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </option>
          ))}
      </select>
    </label>
  );
}
function AssignmentCompanySelect({
  companies,
  initialValue,
}: {
  companies: Company[];
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const unavailable =
    !!value && !companies.some((c) => c.id === value && c.status === "active");
  return (
    <>
      <label htmlFor="person-company">
        Company
        <select
          id="person-company"
          required
          name="companyId"
          aria-describedby={unavailable ? "company-availability" : undefined}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="" disabled>
            Select company
          </option>
          {value && !companies.some((c) => c.id === value) && (
            <option value={value} disabled>
              Previously selected company (unavailable)
            </option>
          )}
          {companies
            .filter((c) => c.status === "active" || c.id === value)
            .map((c) => (
              <option key={c.id} value={c.id} disabled={c.status !== "active"}>
                {c.name}
                {c.status !== "active" ? " (suspended)" : ""}
              </option>
            ))}
        </select>
      </label>
      {unavailable && (
        <span id="company-availability" role="alert">
          The selected company is unavailable. Choose an active company before
          saving.
        </span>
      )}
    </>
  );
}
function StatusSelect({ value = "active" }: { value?: string }) {
  return (
    <label>
      Access
      <select name="status" defaultValue={value}>
        <option value="active">Active</option>
        <option value="disabled">Disabled</option>
      </select>
    </label>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>;
}

export { Companies, CompanyDetail } from "./CompanyAdministration";
function InvitationForm({
  companyId,
  owner = false,
  reload,
}: {
  companyId?: string;
  owner?: boolean;
  reload?: () => void;
}) {
  const [url, setUrl] = useState("");
  return (
    <>
      <Form
        label="Create invitation"
        operation="invitation.create"
        submit={async (data) => {
          setUrl("");
          const result = await api<{ acceptanceUrl: string }>(
            "/api/invitations",
            {
              method: "POST",
              body: {
                email: text(data, "email"),
                role: text(data, "role"),
                ...(companyId ? { companyId } : {}),
              },
            },
          );
          setUrl(result.acceptanceUrl);
          reload?.();
        }}
      >
        <Field name="email" label="Email address" type="email" />
        <RoleSelect owner={owner} />
        <p className="help">
          Expires after 72 hours. Only the person with this verified email can
          accept. Share the link with them directly.
        </p>
      </Form>
      {url && (
        <label className="notice">
          Invitation link
          <input
            className="dd-privacy-hidden"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Invitation acceptance link"
          />
          <span>Copy this link now. It is shown only once.</span>
        </label>
      )}
    </>
  );
}
export function People() {
  const { data } = useAuth();
  return (
    <PeopleWorkspace key={`${data?.user.id}:${data?.permissions.join(",")}`} />
  );
}
function PeopleWorkspace() {
  const r = useResource<Person[]>("/api/platform/users", true),
    companies = useResource<Company[]>("/api/platform/companies", true, true);
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(params.get("userId") || "");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const directory = useUserDirectory(r.reload);
  const [draft, setDraft] = useState<Person | null>(null);
  const currentPerson = r.data?.find((p) => p.id === selected);
  const person =
    draft?.id === selected
      ? {
          ...draft,
          emailVerified: currentPerson?.emailVerified ?? draft.emailVerified,
          status: currentPerson?.status ?? draft.status,
        }
      : currentPerson;
  useEffect(() => {
    if (currentPerson && draft?.id !== selected) setDraft(currentPerson);
  }, [selected, currentPerson, draft?.id]);
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Platform</p>
        <h1>Users</h1>
        <p>
          All sign-in accounts appear here automatically, including people who
          have not signed in. Assign company access when you are ready.
        </p>
      </header>
      <button onClick={() => setCreating((value) => !value)}>
        {creating ? "Cancel new user" : "Add user"}
      </button>
      {creating && (
        <UserProvisioning
          saved={(id) => {
            r.reload();
            if (id) setSelected(id);
            setCreating(false);
          }}
        />
      )}
      <p className="help">
        New accounts start without a company role. Existing roles and disabled
        access are preserved.
      </p>
      {params.get("companyId") && (
        <section className="panel">
          <h2>Invite by email</h2>
          <p>
            Create an invitation for{" "}
            {companies.data?.find((c) => c.id === params.get("companyId"))
              ?.name || "this company"}
            . The person signs in when accepting; no separate first login is
            needed.
          </p>
          <InvitationForm companyId={params.get("companyId")!} owner />
        </section>
      )}
      <section className="panel">
        <h2>All users</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.trim()))
              directory.refresh(query.trim());
          }}
        >
          <label>
            Search users
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email"
            />
          </label>
          <button type="submit" disabled={directory.syncing}>
            Search
          </button>
        </form>
        {directory.syncing && <p role="status">Checking for new accounts…</p>}
        {directory.error && (
          <div role="alert">
            <p>
              {directory.error} Some accounts may be missing. Existing users
              remain available.
            </p>
            <button className="secondary" onClick={() => directory.refresh()}>
              Try again
            </button>
          </div>
        )}
        {r.data && r.error && <p role="alert">{r.error}</p>}
        {directory.limited && (
          <p role="status">
            The sign-in provider lists at most 1,000 accounts. Search a complete
            email to find an account beyond that list.
          </p>
        )}
        {!!directory.conflicts.length && (
          <details>
            <summary>
              {directory.conflicts.length} accounts need identity review
            </summary>
            <ul>
              {directory.conflicts.map((c) => (
                <li key={c.id}>
                  {c.email} ({c.id}): {c.message}
                </li>
              ))}
            </ul>
          </details>
        )}
        {!r.data ? (
          <LoadState error={r.error} retry={r.reload} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Email verification</th>
                  <th>Company</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.data
                  .filter((p) =>
                    `${p.name || ""} ${p.email}`
                      .toLowerCase()
                      .includes(query.trim().toLowerCase()),
                  )
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name || p.email}</strong>
                        <span className="cell-detail">{p.email}</span>
                      </td>
                      <td>
                        {p.emailVerified ? "Verified" : "Not verified"}
                        <span className="cell-detail">
                          {p.firstSignedInAt
                            ? "Has signed in"
                            : "Awaiting first sign-in"}
                        </span>
                      </td>
                      <td>
                        {p.membership?.company.name || "Unassigned"}
                        {!p.membership && p.companyId && (
                          <span className="cell-detail">
                            Previous assignment needs review
                          </span>
                        )}
                      </td>
                      <td>
                        {p.platformRole === "owner"
                          ? "Platform owner"
                          : p.membership?.role || "No role assigned"}
                      </td>
                      <td>{p.status}</td>
                      <td>
                        <button
                          className="secondary"
                          onClick={() => {
                            setDraft(p);
                            setSelected(p.id);
                          }}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!r.data.some((p) =>
              `${p.name || ""} ${p.email}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
            ) && (
              <p>
                {query
                  ? "No users match this search. Search a complete email to check for a newly created account."
                  : "No users yet."}
              </p>
            )}
          </div>
        )}
      </section>
      {person && (
        <section className="panel" key={person.id}>
          <div className="section-heading">
            <h2>Access for {person.name || person.email}</h2>
            <button className="secondary" onClick={() => setSelected("")}>
              Close
            </button>
          </div>
          {!companies.data ? (
            <LoadState error={companies.error} retry={companies.reload} />
          ) : (
            <Form
              key={`${person.id}:${person.membership?.version ?? 0}`}
              operation="company.user.assign"
              submit={async (data) => {
                try {
                  const changed = await api<Member>(
                    `/api/platform/users/${encodeURIComponent(person.id)}/membership`,
                    {
                      method: "PUT",
                      body: {
                        expectedVersion: person.membership?.version ?? null,
                        companyId: text(data, "companyId"),
                        role: text(data, "role"),
                        status: text(data, "status"),
                      },
                    },
                  );
                  setDraft({
                    ...person,
                    companyId: null,
                    role: "unassigned",
                    membership: {
                      ...changed,
                      company: companies.data!.find(
                        (c) => c.id === changed.companyId,
                      )!,
                    },
                  });
                  r.reload();
                } catch (error) {
                  if (
                    error instanceof ApiError &&
                    error.code === "RECORD_CHANGED"
                  )
                    r.reload();
                  throw error;
                }
              }}
            >
              <div className="form-grid">
                <AssignmentCompanySelect
                  companies={companies.data}
                  initialValue={
                    person.membership?.companyId ||
                    params.get("companyId") ||
                    ""
                  }
                />
                <RoleSelect
                  value={person.membership?.role || "resident"}
                  owner
                />
                <StatusSelect value={person.membership?.status} />
              </div>
              <p className="help">
                Changing the company removes access to the previous company. An
                active company must retain an owner.
              </p>
            </Form>
          )}
          <UserVerificationControls
            key={person.id}
            id={person.id}
            verified={person.emailVerified}
            saved={r.reload}
          />
          {person.platformRole !== "owner" && (
            <div className="divider">
              <h3>Platform account</h3>
              <Form
                operation="account.status"
                label="Update account status"
                submit={async (data) => {
                  await api(
                    `/api/platform/users/${encodeURIComponent(person.id)}/status`,
                    { method: "PATCH", body: { status: text(data, "status") } },
                  );
                  r.reload();
                }}
              >
                <StatusSelect value={person.status} />
              </Form>
            </div>
          )}
        </section>
      )}
      <Invitations platform />
    </>
  );
}

export function Properties() {
  const { can } = useAuth();
  const r = useResource<
    {
      id: string;
      name: string;
      address: string;
      city: string;
      state: string;
      zip: string;
    }[]
  >("/api/company/properties");
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState<{id: string; name: string} | null>(null);
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Company</p>
        <h1>Properties</h1>
        <p>Your company’s property directory.</p>
        {can("property.write") && (
          <button onClick={() => setAdding((v) => !v)}>
            {adding ? "Close form" : "Add property"}
          </button>
        )}
      </header>
      <OwnerOnboarding properties={r} onAddProperty={() => setAdding(true)} />
      {adding && can("property.write") && (
        <section className="panel">
          <h2>Add a property</h2>
          <Form
            operation="property.create"
            label="Create property"
            submit={async (data) => {
              await api("/api/company/properties", {
                method: "POST",
                body: Object.fromEntries(data),
              });
              setAdding(false);
              r.reload();
            }}
          >
            <div className="form-grid">
              <Field name="name" label="Property name" />
              <Field name="address" label="Street address" />
              <Field name="city" label="City" />
              <Field name="state" label="State / region" />
              <Field name="zip" label="Postal code" />
            </div>
          </Form>
        </section>
      )}
      <section className="panel">
        {!r.data ? (
          <LoadState error={r.error} retry={r.reload} />
        ) : r.data.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Street address</th>
                  <th>Location</th>
                  {can("resident.assignment.manage") && <th>Residents</th>}
                </tr>
              </thead>
              <tbody>
                {r.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/company/properties/${encodeURIComponent(p.id)}`}>{p.name}</Link>
                    </td>
                    <td>{p.address}</td>
                    <td>
                      {p.city}, {p.state} {p.zip}
                    </td>
                    {can("resident.assignment.manage") && <td><button className="secondary" onClick={() => setManaging(p)}>Manage residents</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No properties have been added to your company.</p>
        )}
      </section>
      {managing && can("resident.assignment.manage") && <ManageResidents key={managing.id} property={managing} close={() => setManaging(null)} />}
    </>
  );
}
export function Team() {
  const r = useResource<Member[]>("/api/company/members");
  const { user, data, refreshUser } = useAuth();
  const [selected, setSelected] = useState("");
  const [invitationRevision, setInvitationRevision] = useState(0);
  const member = r.data?.find((m) => m.userId === selected);
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Company</p>
        <h1>Team</h1>
        <p>Invite people and control their access to your company.</p>
      </header>
      <section className="panel">
        {!r.data ? (
          <LoadState error={r.error} retry={r.reload} />
        ) : (
          <ul className="record-list">
            {r.data.map((m) => (
              <li key={m.userId}>
                <div>
                  <strong>{m.user.name || m.user.email}</strong>
                  <p>{m.user.email}</p>
                </div>
                <Badge>{m.role}</Badge>
                <Badge>{m.status}</Badge>
                {m.role !== "owner" && (
                  <button
                    className="secondary"
                    onClick={() => setSelected(m.userId)}
                  >
                    Edit access
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {member && (
        <section className="panel" key={member.userId}>
          <h2>{member.user.name || member.user.email}</h2>
          <Form
            operation="membership.update"
            submit={async (data) => {
              await api(
                `/api/company/members/${encodeURIComponent(member.userId)}`,
                {
                  method: "PATCH",
                  body: {
                    role: text(data, "role"),
                    status: text(data, "status"),
                  },
                },
              );
              setSelected("");
              r.reload();
            }}
          >
            <RoleSelect value={member.role} />
            <StatusSelect value={member.status} />
          </Form>
        </section>
      )}
      <div className="split">
        <section className="panel">
          <h2>Invite a person</h2>
          <InvitationForm
            companyId={data?.membership?.companyId}
            reload={() => setInvitationRevision((v) => v + 1)}
          />
        </section>
        <section className="panel">
          <h2>Transfer ownership</h2>
          <p>You will become a manager after transferring ownership.</p>
          <Form
            label="Transfer ownership"
            operation="ownership.transfer"
            submit={async (data) => {
              await api("/api/company/transfer-ownership", {
                method: "POST",
                body: { userId: text(data, "userId") },
              });
              await refreshUser();
            }}
          >
            <label>
              New owner
              <select required name="userId" defaultValue="">
                <option value="" disabled>
                  Choose an active member
                </option>
                {r.data
                  ?.filter(
                    (m) =>
                      m.userId !== user?.id &&
                      m.status === "active" &&
                      m.user.status === "active",
                  )
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.user.name || m.user.email}
                    </option>
                  ))}
              </select>
            </label>
          </Form>
        </section>
      </div>
      <Invitations key={invitationRevision} />
    </>
  );
}
function Invitations({ platform = false }: { platform?: boolean }) {
  const r = useResource<
    {
      id: string;
      email: string;
      role: string;
      expiresAt: string;
      acceptedAt: string | null;
      revokedAt: string | null;
    }[]
  >("/api/invitations");
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <h2>{platform ? "Platform invitations" : "Invitations"}</h2>
      {error && <p role="alert">{error}</p>}
      {!r.data ? (
        <LoadState error={r.error} retry={r.reload} />
      ) : r.data.length ? (
        <ul className="record-list">
          {r.data.map((i) => {
            const pending =
              !i.acceptedAt &&
              !i.revokedAt &&
              Date.parse(i.expiresAt) > Date.now();
            return (
              <li key={i.id}>
                <div>
                  <strong>{i.email}</strong>
                  <p>
                    {i.role} · Expires{" "}
                    {new Date(i.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge>
                  {i.acceptedAt
                    ? "Accepted"
                    : i.revokedAt
                      ? "Revoked"
                      : pending
                        ? "Pending"
                        : "Expired"}
                </Badge>
                {pending && (
                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        await api(`/api/invitations/${i.id}/revoke`, {
                          method: "POST",
                          body: {},
                        });
                        r.reload();
                      } catch {
                        setError("Unable to revoke invitation. Try again.");
                      }
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No invitations yet.</p>
      )}
    </section>
  );
}
export function CompanySettings() {
  const { data, refreshUser } = useAuth();
  return (
    <>
      <header className="page-heading">
        <h1>Company settings</h1>
      </header>
      <section className="panel">
        <Form
          operation="company.update"
          submit={async (form) => {
            await api("/api/company", {
              method: "PATCH",
              body: { name: text(form, "name") },
            });
            await refreshUser();
          }}
        >
          <Field
            name="name"
            label="Company name"
            value={data?.membership?.company.name}
          />
        </Form>
      </section>
    </>
  );
}
export function Account() {
  const { user, data, refreshUser } = useAuth();
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Account</p>
        <h1>My profile</h1>
        <p>Your identity and company access.</p>
      </header>
      <section className="panel">
        <Form
          submit={async (form) => {
            await api("/api/account", {
              method: "PATCH",
              body: { name: text(form, "name") },
            });
            await refreshUser();
          }}
        >
          <Field name="name" label="Display name" value={user?.name || ""} />
          <p>
            <strong>Sign-in email</strong>
            <br />
            {user?.email} · {user?.emailVerified ? "Verified" : "Not verified"}
          </p>
          <p className="help">
            Your sign-in email is managed by your identity provider.
          </p>
        </Form>
        <dl className="details">
          <dt>Company</dt>
          <dd>{data?.membership?.company.name || "Not assigned"}</dd>
          <dt>Role</dt>
          <dd>
            {user?.platformRole === "owner"
              ? "Platform owner"
              : data?.membership?.role || "Not assigned"}
          </dd>
        </dl>
      </section>
    </>
  );
}
export function AccessStatus() {
  const { data, refreshUser } = useAuth();
  const suspended =
    data?.user.status !== "active" ||
    data?.membership?.status === "disabled" ||
    data?.membership?.company.status === "suspended";
  return (
    <section className="status-panel">
      <h1>{suspended ? "Access is disabled" : "Account access pending"}</h1>
      <p>
        {suspended
          ? "Contact your administrator to restore access."
          : "Your administrator will create your company and assign its initial owner. Your account is waiting for an active company assignment. If you received an invitation, open its link to accept it."}
      </p>
      <button onClick={() => void refreshUser()}>Check access again</button>
      <Link to="/account">View my profile</Link>
    </section>
  );
}
function ManageResidents({ property, close }: { property: { id: string; name: string }; close: () => void }) {
  const base = `/api/company/properties/${encodeURIComponent(property.id)}/residents`;
  const eligible = useResource<{ userId: string; user: { name: string | null; email: string } }[]>("/api/company/residents");
  const assigned = useResource<{ userId: string; membership: { user: { name: string | null; email: string } } }[]>(base);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const choices = eligible.data?.filter(person => !assigned.data?.some(row => row.userId === person.userId));
  const change = async (userId: string, method: "PUT" | "DELETE") => {
    setBusy(true); setError("");
    try { await api(`${base}/${encodeURIComponent(userId)}`, { method }); assigned.reload(); eligible.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to update assignment."); }
    finally { setBusy(false); }
  };
  return <section className="panel">
    <div className="section-heading"><h2>Residents for {property.name}</h2><button className="secondary" onClick={close}>Close</button></div>
    <p className="help">An assignment provides property access. It is not a lease or proof of occupancy. Pending invitations are not eligible; residents must accept first.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!eligible.data || !assigned.data ? <LoadState error={eligible.error || assigned.error} retry={() => { eligible.reload(); assigned.reload(); }} /> : <>
      {assigned.data.length ? <ul className="record-list">{assigned.data.map(row => <li key={row.userId}><strong>{row.membership.user.name || row.membership.user.email}</strong><Badge>Assigned</Badge><button disabled={busy} className="secondary" onClick={() => change(row.userId, "DELETE")}>Remove assignment</button></li>)}</ul> : <p>No residents assigned.</p>}
      {choices?.length ? <form onSubmit={event => { event.preventDefault(); if (!busy) void change(String(new FormData(event.currentTarget).get("resident")), "PUT"); }}><fieldset disabled={busy}><label>Accepted resident<select name="resident" required defaultValue=""><option value="" disabled>Choose a resident</option>{choices.map(person => <option key={person.userId} value={person.userId}>{person.user.name || person.user.email}</option>)}</select></label><button type="submit">{busy ? "Updating…" : "Assign resident"}</button></fieldset></form> : <p>No additional active accepted residents available.</p>}
    </>}
  </section>;
}
export function Resident() {
  const r = useResource<{ id: string; name: string; address: string }[]>("/api/resident/properties");
  return <>
    <header className="page-heading"><p className="eyebrow">Resident</p><h1>My properties</h1><p>These associations are not leases or proof of occupancy.</p></header>
    {!r.data ? <LoadState error={r.error} retry={r.reload} /> : r.data.length ? r.data.map(property => <section className="panel" key={property.id}><h2>{property.name}</h2><p>{property.address}</p></section>) : <section className="panel"><h2>No properties assigned</h2><p>Your company membership is active. Contact your property manager for a property assignment.</p></section>}
    <p className="help">Use My requests for maintenance. Lease and financial records are managed by your property manager.</p>
  </>;
}
export function AcceptInvitation() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const token = sessionStorage.getItem("pf-invitation") || "";
  return (
    <section className="panel">
      <h1>Accept your invitation</h1>
      <p>Use the account whose verified email matches the invitation.</p>
      {token ? (
        <Form
          label="Accept invitation"
          operation="invitation.accept"
          submit={async () => {
            await api("/api/invitations/accept", {
              method: "POST",
              body: { token },
            });
            sessionStorage.removeItem("pf-invitation");
            await refreshUser();
            navigate("/dashboard");
          }}
        >
          <p>This will assign your account to the inviting company.</p>
        </Form>
      ) : (
        <p>Open the full invitation link sent by your administrator.</p>
      )}
    </section>
  );
}
export function Audit() {
  const r = useResource<
    {
      id: string;
      action: string;
      actorId: string;
      companyId: string | null;
      targetId: string | null;
      createdAt: string;
    }[]
  >("/api/platform/audit");
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Platform</p>
        <h1>Activity</h1>
        <p>The 100 most recent recorded access and administration events.</p>
      </header>
      <section className="panel">
        {!r.data ? (
          <LoadState error={r.error} retry={r.reload} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Actor</th>
                  <th>Company</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {r.data.map((e) => (
                  <tr key={e.id}>
                    <td>{e.action}</td>
                    <td className="identifier">{e.actorId}</td>
                    <td className="identifier">{e.companyId || "Platform"}</td>
                    <td>{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
