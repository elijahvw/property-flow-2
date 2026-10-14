import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { monitorOperation, startOperation } from "../operations";
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
  user: { name: string | null; email: string; status: string };
};
type Person = {
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
export function useResource<T>(url: string) {
  const { data: auth } = useAuth();
  const scope = `${auth?.user.id}:${auth?.user.status}:${auth?.membership?.companyId}:${auth?.membership?.version}:${auth?.permissions.join(",")}`;
  const key = `${scope}:${url}`;
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>({ key });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ key });
    const operation = startOperation(
      url === "/api/platform/users"
        ? "admin.users.load"
        : url === "/api/platform/companies"
          ? "admin.companies.load"
          : "page.data.load",
    );
    void api<T>(url, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          operation.succeed();
          setResult({ key, data });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          operation.fail(error);
          setResult({
            key,
            error:
              error instanceof Error
                ? error.message
                : "Unable to load this page.",
          });
        }
      });
    return () => {
      controller.abort();
      operation.abandon();
    };
  }, [url, key, revision]);
  return {
    data: result.key === key ? result.data : undefined,
    error: result.key === key ? result.error : undefined,
    reload: () => setRevision((v) => v + 1),
  };
}
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

export function Companies() {
  const r = useResource<Company[]>("/api/platform/companies");
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Platform</p>
        <h1>Companies</h1>
        <p>Create and oversee the businesses on Property Flow.</p>
      </header>
      <div className="split">
        <section className="panel">
          <h2>Company directory</h2>
          {!r.data ? (
            <LoadState error={r.error} retry={r.reload} />
          ) : r.data.length === 0 ? (
            <p>No companies yet. Create your first company to begin.</p>
          ) : (
            <ul className="record-list">
              {r.data.map((c) => (
                <li key={c.id}>
                  <div>
                    <Link to={`/platform/companies/${c.id}`}>{c.name}</Link>
                    <p>{c._count?.memberships || 0} assigned people</p>
                  </div>
                  <Badge>{c.status}</Badge>
                  <Link
                    className="button secondary"
                    to={`/platform/companies/${c.id}`}
                  >
                    Manage
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2>Create a company</h2>
          <Form
            label="Create company"
            operation="company.create"
            submit={async (data) => {
              await api("/api/platform/companies", {
                method: "POST",
                body: { name: text(data, "name") },
              });
              r.reload();
            }}
          >
            <Field name="name" label="Company name" />
          </Form>
        </section>
      </div>
    </>
  );
}
export function CompanyDetail() {
  const { companyId } = useParams();
  const r = useResource<Company>(
    `/api/platform/companies/${encodeURIComponent(companyId || "")}`,
  );
  if (!r.data) return <LoadState error={r.error} retry={r.reload} />;
  const company = r.data;
  return (
    <>
      <Link to="/platform/companies">← Companies</Link>
      <header className="page-heading">
        <p className="eyebrow">Company administration</p>
        <h1>{company.name}</h1>
        <p>
          Changes here apply only to this company and are recorded in Activity.
        </p>
      </header>
      <div className="split">
        <section className="panel">
          <h2>Company profile</h2>
          <Form
            key={company.name + company.status}
            operation="company.update"
            submit={async (data) => {
              await api(`/api/platform/companies/${company.id}`, {
                method: "PATCH",
                body: {
                  name: text(data, "name"),
                  status: text(data, "status"),
                },
              });
              r.reload();
            }}
          >
            <Field name="name" label="Company name" value={company.name} />
            <label>
              Company status
              <select name="status" defaultValue={company.status}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
            <p className="help">
              Suspension blocks all company access, including its owners.
            </p>
          </Form>
        </section>
        <section className="panel">
          <h2>Invite a person</h2>
          <InvitationForm companyId={company.id} owner />
        </section>
      </div>
      <section className="panel">
        <h2>Assigned people</h2>
        {company.memberships?.length ? (
          <ul className="record-list">
            {company.memberships.map((m) => (
              <li key={m.userId}>
                <div>
                  <strong>{m.user.name || m.user.email}</strong>
                  <p>{m.user.email}</p>
                </div>
                <Badge>{m.role}</Badge>
                <Badge>{m.status}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No memberships assigned. Invite an owner or assign an existing
            person.
          </p>
        )}
        <Link to="/platform/users">Manage people and assignments</Link>
      </section>
    </>
  );
}
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
  const r = useResource<Person[]>("/api/platform/users"),
    companies = useResource<Company[]>("/api/platform/companies");
  const [selected, setSelected] = useState("");
  const person = r.data?.find((p) => p.id === selected);
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Platform</p>
        <h1>People & access</h1>
        <p>
          Each person has one company assignment. These are people who have
          signed into Property Flow.
        </p>
      </header>
      <section className="panel">
        {!r.data ? (
          <LoadState error={r.error} retry={r.reload} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Company</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name || p.email}</strong>
                      <span className="cell-detail">{p.email}</span>
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
                        onClick={() => setSelected(p.id)}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              operation="company.user.assign"
              submit={async (data) => {
                await api(
                  `/api/platform/users/${encodeURIComponent(person.id)}/membership`,
                  {
                    method: "PUT",
                    body: {
                      companyId: text(data, "companyId"),
                      role: text(data, "role"),
                      status: text(data, "status"),
                    },
                  },
                );
                r.reload();
              }}
            >
              <div className="form-grid">
                <label>
                  Company
                  <select
                    required
                    name="companyId"
                    defaultValue={
                      person.membership?.companyId || person.companyId || ""
                    }
                  >
                    <option value="" disabled>
                      Select company
                    </option>
                    {companies.data
                      .filter((c) => c.status === "active")
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
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
                </tr>
              </thead>
              <tbody>
                {r.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>{p.address}</td>
                    <td>
                      {p.city}, {p.state} {p.zip}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No properties have been added to your company.</p>
        )}
      </section>
    </>
  );
}
export function Team() {
  const r = useResource<Member[]>("/api/company/members");
  const { user, refreshUser } = useAuth();
  const [selected, setSelected] = useState("");
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
          <InvitationForm reload={r.reload} />
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
      <Invitations />
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
          : "Your account needs an active company assignment. Accept your invitation or contact your administrator."}
      </p>
      <button onClick={() => void refreshUser()}>Check access again</button>
      <Link to="/account">View my profile</Link>
    </section>
  );
}
export function Resident() {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Resident</p>
        <h1>My rental</h1>
      </header>
      <section className="panel">
        <h2>No rental records available</h2>
        <p>
          Your company membership is active. Lease, payment and maintenance
          features are not available yet. Contact your property manager for
          rental documents or requests.
        </p>
      </section>
    </>
  );
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
