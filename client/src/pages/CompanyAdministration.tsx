import { Address } from "../components/Address";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { PlatformCompanySubscription } from "../components/CompanySubscription";
import { SalesDemo } from "../components/SalesDemo";
export type CompanyProfile = {
  id: string;
  name: string;
  status: string;
  version: number;
  legalName?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  timezone?: string;
  adminNotes?: string | null;
  _count?: { memberships: number; properties?: number };
  memberships?: {
    userId: string;
    role: string;
    status: string;
    user: {
      name: string | null;
      email: string;
      emailVerified: boolean;
      status: string;
    };
  }[];
};
const fields = {
  legalName: "Legal business name",
  contactName: "Primary contact name",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
  website: "Website",
  addressLine1: "Address line 1",
  addressLine2: "Address line 2",
  city: "City",
  region: "State / region",
  postalCode: "Postal code",
  country: "Country code",
  adminNotes: "Internal platform notes",
};
const limits = {
  legalName: 200,
  contactName: 200,
  contactEmail: 254,
  contactPhone: 40,
  website: 500,
  addressLine1: 200,
  addressLine2: 200,
  city: 100,
  region: 100,
  postalCode: 30,
  country: 2,
  adminNotes: 2000,
};
function Load({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <div role="alert">
      <p>{error}</p>
      <button onClick={retry}>Try again</button>
    </div>
  ) : (
    <p role="status">Loading company records…</p>
  );
}
function ProfileFields({ value }: { value?: CompanyProfile }) {
  const field = (name: keyof typeof fields) => (
    <label key={name} className={name.startsWith("addressLine")?"address-street":name==="city"?"address-city":name==="region"?"address-region":name==="postalCode"?"address-postal":name==="country"?"address-country":undefined}>
      {fields[name]}
      <input
        name={name}
        type={
          name === "contactEmail"
            ? "email"
            : name === "website"
              ? "url"
              : "text"
        }
        maxLength={limits[name]}
        defaultValue={value?.[name] || ""}
      />
    </label>
  );
  return (
    <>
      <fieldset>
        <legend>Business identity</legend>
        <div className="form-grid">
          <label>
            Company name
            <input
              name="name"
              required
              maxLength={200}
              defaultValue={value?.name}
            />
          </label>
          {field("legalName")}
          {field("website")}
          <label>
            Timezone
            <input
              name="timezone"
              required
              maxLength={80}
              defaultValue={value?.timezone || "America/New_York"}
              placeholder="America/New_York"
            />
          </label>
        </div>
        <p className="help">
          Company name is required. Other business details are optional. Use an
          IANA timezone such as America/New_York.
        </p>
      </fieldset>
      <fieldset>
        <legend>Primary contact</legend>
        <div className="form-grid">
          {field("contactName")}
          {field("contactEmail")}
          {field("contactPhone")}
        </div>
        <p className="help">
          Contact details are administrative records. They do not create a login
          or grant company access.
        </p>
      </fieldset>
      <fieldset>
        <legend>Mailing address</legend>
        <div className="address-fields">
          {(
            [
              "addressLine1",
              "addressLine2",
              "city",
              "region",
              "postalCode",
              "country",
            ] as const
          ).map(field)}
        </div>
        <p className="help">Use a two-letter country code such as US.</p>
      </fieldset>
      <label>
        Internal platform notes
        <textarea
          name="adminNotes"
          maxLength={2000}
          defaultValue={value?.adminNotes || ""}
        />
      </label>
    </>
  );
}
function payload(form: FormData) {
  return Object.fromEntries(form);
}
export function Companies() {
  const { data } = useAuth();
  return (
    <CompanyDirectory key={`${data?.user.id}:${data?.permissions.join(",")}`} />
  );
}
function CompanyDirectory() {
  const r = useResource<CompanyProfile[]>(
      "/api/platform/companies",
      true,
      true,
    ),
    navigate = useNavigate();
  const [adding, setAdding] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID()),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all");
  const rows = r.data?.filter(
    (c) =>
      (status === "all" || c.status === status) &&
      `${c.name} ${c.legalName || ""} ${c.contactEmail || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Platform administration</p>
        <h1>Companies</h1>
        <p>Manage business profiles, owner setup and company access.</p>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true);
            }}
          >
            Add company
          </button>
        )}
      </header>
      <EditorDialog
        open={adding}
        title="Create company profile"
        onClose={() => setAdding(false)} onDiscard={() => { setAdding(false); setKey(crypto.randomUUID()); }}
      >
        <p>
          Save the business profile first, then assign an existing sign-in
          account or invite the initial owner.
        </p>
        <Form
          key={key}
          operation="company.create"
          label="Create company"
          submit={async (form) => {
            const company = await api<CompanyProfile>(
              "/api/platform/companies",
              {
                method: "POST",
                body: { ...payload(form), submissionKey: key },
              },
            );
            navigate(`/platform/companies/${company.id}`);
          }}
        >
          <ProfileFields />
          <p className="help">
            If a response fails, retry with the same details. The submission is
            protected from duplicate creation.
          </p>
        </Form>
      </EditorDialog>
      <SalesDemo onChange={r.reload} />
      <section className="panel">
        <h2>Company directory</h2>
        <div className="form-grid">
          <label>
            Find company
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or contact email"
            />
          </label>
          <label>
            Filter company status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>
        </div>
        {r.data && r.error && <Load error={r.error} retry={r.reload} />}
        {!r.data ? (
          <Load error={r.error} retry={r.reload} />
        ) : !rows?.length ? (
          <p>
            {r.data.length
              ? "No companies match these filters."
              : "No companies yet. Add your first company to begin."}
          </p>
        ) : (
          <>
            <p>{rows.length} matching companies</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Assigned people</th>
                    <th>Status</th>
                    <th>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link to={`/platform/companies/${c.id}`}>{c.name}</Link>
                        {c.legalName && (
                          <span className="cell-detail">{c.legalName}</span>
                        )}
                      </td>
                      <td>{c.contactEmail || "Not supplied"}</td>
                      <td>{c._count?.memberships || 0}</td>
                      <td>{c.status}</td>
                      <td>
                        <Link to={`/platform/companies/${c.id}`}>
                          Manage {c.name}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
export function CompanyDetail() {
  const { data } = useAuth(),
    { companyId } = useParams();
  return (
    <CompanyRecord
      key={`${data?.user.id}:${companyId}:${data?.permissions.join(",")}`}
    />
  );
}
function CompanyRecord() {
  const { companyId = "" } = useParams(),
    r = useResource<CompanyProfile>(
      `/api/platform/companies/${encodeURIComponent(companyId)}`,
    ),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<CompanyProfile | null>(null),
    [error, setError] = useState("");
  if (!r.data) return <Load error={r.error} retry={r.reload} />;
  const c = r.data,
    owner = c.memberships?.some(
      (m) =>
        m.role === "owner" &&
        m.status === "active" &&
        m.user.status === "active",
    );
  return (
    <>
      <Link to="/platform/companies">← Companies</Link>
      <header className="page-heading">
        <p className="eyebrow">Company administration</p>
        <h1>{c.name}</h1>
        <p>
          {c.status === "active"
            ? "Active company"
            : "Suspended — company access is blocked"}{" "}
          · {c.memberships?.length || 0} assigned people
        </p>
      </header>
      {error && <p role="alert">{error}</p>}
      <section className="panel">
        <div className="section-heading">
          <h2>Company profile</h2>
          <button
            className="secondary"
            onClick={() => {
              setDraft(previous => previous || c);
              setEditing(true);
              setError("");
            }}
          >
            {editing ? "Cancel profile edit" : "Edit company profile"}
          </button>
        </div>
        <EditorDialog
          open={editing}
          title="Edit company profile"
          onClose={() => setEditing(false)}
          onDiscard={() => { setDraft(null); setEditing(false); r.reload(); }}
        >
          <Form
            key={(draft || c).version}
            operation="company.update"
            label="Save company profile"
            submit={async (form) => {
              try {
                await api(`/api/platform/companies/${c.id}`, {
                  method: "PATCH",
                  body: { ...payload(form), expectedVersion: (draft || c).version },
                });
                setEditing(false);
                setDraft(null);
                r.reload();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Unable to save company.",
                );
                throw e;
              }
            }}
          >
            <ProfileFields value={draft || c} />
            <label>
              Company status
              <select name="status" defaultValue={(draft || c).status}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </label>
            <p className="help">
              Suspension blocks access for every member, including owners. This
              does not delete records.
            </p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setEditing(false);
                setDraft(null);
                r.reload();
              }}
            >
              Discard edits and reload
            </button>
          </Form>
        </EditorDialog>
        <>
          <dl>
            <dt>Legal business name</dt>
            <dd>{c.legalName || "Not supplied"}</dd>
            <dt>Primary contact</dt>
            <dd>
              {[c.contactName, c.contactEmail, c.contactPhone]
                .filter(Boolean)
                .join(" · ") || "Not supplied"}
            </dd>
            <dt>Website</dt>
            <dd>{c.website || "Not supplied"}</dd>
            <dt>Mailing address</dt>
            <dd>
              <Address street={c.addressLine1} line2={c.addressLine2} city={c.city} region={c.region} postalCode={c.postalCode} country={c.country}/>
            </dd>
            <dt>Timezone</dt>
            <dd>{c.timezone}</dd>
            <dt>Internal notes</dt>
            <dd>{c.adminNotes || "None"}</dd>
          </dl>
        </>
      </section>
      <PlatformCompanySubscription companyId={c.id}/>
      <section className="panel">
        <h2>People and owner setup</h2>
        <p>
          {owner
            ? "An active owner is assigned. Manage people and invitations below."
            : "This company needs an active owner. Add an existing Auth0 account or invite an owner by email."}
        </p>
        <div className="actions">
          <Link
            className="button"
            to={`/platform/users?companyId=${encodeURIComponent(c.id)}`}
          >
            Add existing person to {c.name}
          </Link>
          <Link
            className="button secondary"
            to={`/platform/users?companyId=${encodeURIComponent(c.id)}&invite=1`}
          >
            Invite a person to {c.name}
          </Link>
        </div>
        <p className="help">
          Existing sign-in accounts can be added before their first login. The
          email must be verified before company access is enabled.
        </p>
        {!c.memberships?.length ? (
          <p>No people assigned yet.</p>
        ) : (
          <ul className="record-list">
            {c.memberships.map((m) => (
              <li key={m.userId}>
                <strong>{m.user.name || m.user.email}</strong>
                <p>
                  {m.user.email} · {m.role} · {m.status} ·{" "}
                  {m.user.emailVerified
                    ? "Email verified"
                    : "Email not verified"}
                </p>
                <Link
                  to={`/platform/users?companyId=${c.id}&userId=${encodeURIComponent(m.userId)}`}
                >
                  Manage access for {m.user.email}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
