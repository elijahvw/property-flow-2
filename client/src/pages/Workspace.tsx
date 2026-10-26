import { useEditorSelection } from "../useEditorSelection";
import { TeamInvitationReview } from "../components/TeamInvitationReview";
import { InvitationHistory } from "../components/InvitationHistory";
import { InvitationDelivery, type InvitationResult } from "../components/InvitationDelivery";
import {formatDate} from "../dates";
import {CompanyProfile} from "./CompanyProfile";
import {AccountProfile} from "./AccountProfile";
import { ContactInvitationReview } from "../components/ContactInvitation";
import { Address, PropertyAddressFields } from "../components/Address";
import { RecordIdentity } from "../components/RecordIdentity";
import { ResidentLeaseInvitations } from "../components/LeaseInvitations";
import { ResidentRentSummary } from "../components/ResidentRentSummary";
import { LeaseInvitationReview } from "../components/LeaseInvitationReview";
import {
  UserProvisioning,
  UserVerificationControls,
} from "../components/UserProvisioning";
import { DraftReset } from "../components/DraftReset";
import { PropertyFields } from "../components/PropertyFields";
import { EditorDialog } from "../components/EditorDialog";
import "./WorkspaceExperience.css";
import { DirectoryPagination, useDirectoryPage } from "../components/DirectoryPagination";
import { UserActivity, ActivityLog } from "../components/UserActivity";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUserDirectory } from "../useUserDirectory";
import { ManualPassword } from "../components/ManualPassword";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { availableFeatureRoute } from "../company-features";
import { monitorOperation } from "../operations";
import { LoadingState } from "../components/LoadingState";
import { useResource } from "../useResource";
import { formatActivityTime } from "../dates";
import OwnerOnboarding from "../components/OwnerOnboarding";

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
  createdAt?:string;
  user: { name: string | null; email: string; status: string; passwordManageable?: boolean };
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
import { Form } from "../components/Form";
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
  audience,
}: {
  value?: string;
  owner?: boolean;
  audience?: "team" | "tenants";
}) {
  return (
    <label>
      Company role
      <select aria-label="Company role" name="role" defaultValue={value}>
        {roles
          .filter(
            (role) =>
              (owner || role !== "owner") &&
              (!audience ||
                (audience === "team"
                  ? role !== "resident"
                  : role === "resident")),
          )
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
  changed,
}: {
  companies: Company[];
  initialValue: string;
  changed?:(value:string)=>void;
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
          name="companyId"
          aria-describedby={unavailable ? "company-availability" : undefined}
          value={value}
          onChange={(event) => {setValue(event.target.value);changed?.(event.target.value);}}
        >
          <option value="">
            No company access
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
function MembershipFields({companies,person,initial}:{companies:Company[];person:Person;initial:string}) {
  const [company,setCompany]=useState(initial);
  return <div className="membership-fields"><AssignmentCompanySelect companies={companies} initialValue={initial} changed={setCompany}/><fieldset disabled={!company} className="form-grid editor-contents"><legend className="sr-only">Company permissions</legend><RoleSelect value={person.membership?.role||"resident"} owner/><StatusSelect value={person.membership?.status}/></fieldset>{!company&&<p className="help">This person can sign in but will have no company workspace access. Their existing business history is retained.</p>}</div>;
}

export function InvitationForm({
  companyId,
  owner = false,
  reload,
  audience,
  done,
}: {
  companyId?: string;
  owner?: boolean;
  reload?: () => void;
  audience?: "team" | "tenants";
  done?: () => void;
}) {
  const [result, setResult] = useState<InvitationResult | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  if (result) return <InvitationDelivery initial={result} changed={reload} done={() => { setResult(null); setKey(crypto.randomUUID()); reload?.(); done?.(); }} />;
  return <Form label="Create invitation" operation="invitation.create" successText="Invitation ready." submit={async data => {
    const row = await api<InvitationResult>("/api/invitations", { method:"POST", body: { email:text(data,"email"), name:text(data,"name"), role:text(data,"role"), submissionKey:key, ...(companyId ? {companyId} : {}) } });
    setResult(row); reload?.();
  }}><Field name="name" label="Name (optional)" required={false}/><Field name="email" label="Email address" type="email"/><RoleSelect owner={owner} audience={audience} value={audience === "team" ? "manager" : "resident"}/><p className="help">Review the role, then send an email invitation or copy a private link. It expires after 72 hours and only the intended person can accept.</p></Form>;
}
export function People() {
  const { data } = useAuth();
  return (
    <PeopleWorkspace key={`${data?.user.id}:${data?.permissions.join(",")}:${data?.impersonation?.contextId || ""}`} />
  );
}
function PeopleWorkspace() {
  const { data: authority } = useAuth();
  const readOnly = !!authority?.impersonation;
  const r = useResource<Person[]>("/api/platform/users", true),
    companies = useResource<Company[]>("/api/platform/companies", true, true);
  const [params,setParams] = useSearchParams();
  const [selected, setSelected, selectedOpen, saveSelectedDraft] = useEditorSelection(params.get("userId") || "");
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const directory = useUserDirectory(r.reload, !readOnly);
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
  const rows = r.data?.filter((p) =>
    `${p.name || ""} ${p.email}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (!accountFilter || p.status === accountFilter) &&
    (!companyFilter || (companyFilter === "unassigned" ? !p.membership : p.membership?.companyId === companyFilter)),
  );
  const userPage = useDirectoryPage(rows, JSON.stringify([query, companyFilter, accountFilter]));
  const companyAccess = (p: Person) => {
    if (!p.membership) return "No company access";
    if (p.status !== "active") return "Account disabled";
    if (p.emailVerified === false) return "Verification required";
    if (p.membership.status !== "active") return "Membership disabled";
    const company = companies.data?.find(c => c.id === p.membership!.companyId) || p.membership.company;
    return company.status === "suspended" ? "Company suspended" : "Active company access";
  };
  return (
    <>
      <header className="page-heading page-heading-row admin-directory-heading">
        <div>
          <p className="eyebrow">Platform / Accounts &amp; access</p>
          <h1>Users</h1>
          <p>Find a sign-in account, check its access, and open the right next action.</p>
        </div>
        <button disabled={readOnly} onClick={() => setCreating(true)}>Add user</button>
      </header>
      <EditorDialog
        open={creating}
        title="Add user"
        onClose={() => setCreating(false)}
        description="Create a sign-in account, then assign company access. Save a draft explicitly to keep it on this page."
      >
        <UserProvisioning
          saved={(id) => {
            r.reload();
            if (id) setSelected(id);
            setCreating(false);
          }}
        />
      </EditorDialog>

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
          <fieldset disabled={readOnly} className="editor-contents"><InvitationForm companyId={params.get("companyId")!} owner /></fieldset>
        </section>
      )}
      <section className="panel admin-directory directory-workbench" aria-label="User directory">
        <div className="admin-directory-intro">
          <div><h2>All users</h2><p>Account creation, email verification and company access are separate. New accounts start without a company role.</p></div>
          {r.data && <span className="directory-count">{r.data.length} synced {r.data.length === 1 ? "account" : "accounts"}</span>}
        </div>
        <div className="admin-directory-toolbar directory-toolbar">
        <form className="admin-directory-search"
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
              type="search"
              maxLength={254}
              aria-describedby="user-search-help"
            />
          </label>
          <button type="submit" className="secondary" disabled={directory.syncing || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query.trim())}>
            Check exact email
          </button>
        </form>
        <div className="admin-directory-filters">
          <label>Filter by company<select value={companyFilter} onChange={event => setCompanyFilter(event.target.value)}>
            <option value="">All companies</option>
            <option value="unassigned">No company assigned</option>
            {companies.data?.map(company => <option key={company.id} value={company.id}>{company.name}{company.status !== "active" ? " (suspended)" : ""}</option>)}
          </select></label>
          <label>Filter account status<select value={accountFilter} onChange={event => setAccountFilter(event.target.value)}>
            <option value="">All account statuses</option>
            <option value="active">Active account</option>
            <option value="disabled">Disabled account</option>
          </select></label>
        </div>
        </div>
        <p className="help" id="user-search-help">Filter synced accounts as you type. Enter a complete email and choose Check exact email to look for an account beyond the provider's directory limit.</p>
        <div className="admin-directory-summary directory-result-summary">
          <div><p aria-live="polite">{rows ? `${rows.length} matching ${rows.length === 1 ? "account" : "accounts"}` : "Loading accounts…"}{r.error && rows ? " · last loaded records" : ""}</p>
          <span className="directory-sync-status" role="status">{directory.syncing ? "Checking for new accounts…" : ""}</span></div>
          {(query || companyFilter || accountFilter) && <button className="text-button" type="button" onClick={() => { setQuery(""); setCompanyFilter(""); setAccountFilter(""); }}>Clear user filters</button>}
        </div>
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
                  {c.email}: {c.message}
                  <RecordIdentity id={c.id} label="Account" />
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="user-directory-results-region">
        {!r.data ? (
          r.error ? <LoadState error={r.error} retry={r.reload} /> : <LoadingState label="Loading accounts…" />
        ) : (
          <div className="table-wrap admin-directory-results">
            <table className="admin-record-table">
              <caption className="sr-only">Synced sign-in accounts and their current company access</caption>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Sign-in account</th>
                  <th>Company &amp; role</th>
                  <th>Company access</th>
                  <th>Platform authority</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {userPage.items?.map((p) => (
                    <tr key={p.id}>
                      <td className="admin-record-identity">
                        <strong>{p.name || p.email}</strong>
                        <span className="cell-detail">{p.email}</span>
                      </td>
                      <td data-label="Sign-in account">
                        <span className={`admin-status ${p.status === "active" ? "is-active" : "is-blocked"}`}>{p.status === "active" ? "Active account" : "Account disabled"}</span>
                        <span className="cell-detail">{p.emailVerified ? "Verified" : "Not verified"}</span>
                        <span className="cell-detail">
                          {p.firstSignedInAt
                            ? "Has signed in"
                            : "Awaiting first sign-in"}
                        </span>
                      </td>
                      <td data-label="Company & role">
                        <strong>{p.membership?.company.name || "Unassigned"}</strong>
                        {!p.membership && p.companyId && (
                          <span className="cell-detail">
                            Previous assignment needs review
                          </span>
                        )}
                        <span className="cell-detail admin-role">{p.platformRole === "owner" ? "Platform owner" : p.membership?.role || "No role assigned"}</span>
                        {p.platformRole === "owner" && p.membership && <span className="cell-detail">Company role: {p.membership.role}</span>}
                      </td>
                      <td data-label="Company access"><span className={`admin-status ${companyAccess(p) === "Active company access" ? "is-active" : "is-pending"}`}>{companyAccess(p)}</span></td>
                      <td data-label="Platform authority"><span className="cell-detail">{p.platformRole === "owner" ? "Platform owner" : p.platformRole === "support" ? "Platform support" : "None"}</span>{p.platformRole === "support" && <Link to={`/platform/impersonation?supportUserId=${encodeURIComponent(p.id)}`}>Review platform support access</Link>}</td>
                      <td className="admin-record-actions">
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
            <DirectoryPagination name="Users" {...userPage} total={rows?.length || 0} />
            {!rows?.length && (
              <p>
                {query || companyFilter || accountFilter
                  ? "No users match these filters. Clear the filters or search a complete email to check for a newly created account."
                  : "No users yet."}
              </p>
            )}
          </div>
        )}
        </div>
      </section>
      {person && (
        <EditorDialog
          key={selected}
          open={selectedOpen}
          onSaveDraft={saveSelectedDraft}
          title={`Manage ${person.name || person.email}`}
          onClose={() => {
            setSelected("");
            setDraft(null);
          }}
          description="Manage the application profile, company membership, sign-in assistance and account status in one place."
        >
          <fieldset disabled={readOnly} className="editor-contents">
          <div className="profile-summary">
            <span className="avatar">
              {(person.name || person.email).slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{person.name || person.email}</strong>
              <p>{person.email}</p>
            </div>
            <Badge>{person.status}</Badge>
          </div>
          <p><strong>Platform authority:</strong> {person.platformRole === "owner" ? "Platform owner" : person.platformRole === "support" ? "Platform support" : "None"}. Company ownership does not grant platform support or impersonation.</p>
          {person.platformRole === "support" && <p><Link to={`/platform/impersonation?supportUserId=${encodeURIComponent(person.id)}`}>Review platform support access for this account</Link></p>}
          <nav className="account-section-nav" aria-label="Account management sections">
            {[["profile", "Profile"], ["access", "Company access"], ["signin", "Sign-in & status"], ["activity", "Activity"]].map(([section, label]) => <button key={section} type="button" className="secondary" onClick={() => {
              const target = document.getElementById(`manage-user-${section}`);
              const disclosure = target instanceof HTMLDetailsElement ? target : target?.querySelector("details");
              if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
              target?.focus();
              target?.scrollIntoView({ block: "start" });
            }}>{label}</button>)}
          </nav>
          <details id="manage-user-profile" tabIndex={-1} open className="editor-section account-workspace-section">
            <summary>Application profile</summary>
            <Form
              label="Save display name"
              submit={async (form) => {
                const changed = await api<{ name: string }>(
                  `/api/platform/users/${encodeURIComponent(person.id)}/profile`,
                  { method: "PATCH", body: { name: text(form, "name") } },
                );
                setDraft({ ...person, name: changed.name });
                r.reload();
              }}
            >
              <Field
                name="name"
                label="Display name"
                value={person.name || ""}
              />
              <p className="help">
                Sign-in email and identity are managed by Auth0. Company roles
                are managed below.
              </p>
            </Form>
          </details>
          <details id="manage-user-access" tabIndex={-1} open className="editor-section account-workspace-section">
            <summary>Company access</summary>
            {!companies.data ? (
              <LoadState error={companies.error} retry={companies.reload} />
            ) : (
              <Form
                key={`${person.id}:${person.membership?.version ?? 0}`}
                operation="company.user.assign"
                submit={async (data) => {
                  try {
                    if(!text(data,"companyId")){
                      await api(`/api/platform/users/${encodeURIComponent(person.id)}/membership`,{method:"DELETE",body:{expectedVersion:person.membership?.version??null,expectedCompanyId:person.membership?.companyId??null,expectedCreatedAt:person.membership?.createdAt??null}});
                      if(params.has("companyId")){const next=new URLSearchParams(params);next.delete("companyId");setParams(next,{replace:true});}
                      setDraft({...person,membership:null,companyId:null,role:"unassigned"});r.reload();return;
                    }
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
                <MembershipFields companies={companies.data} person={person} initial={person.membership?.companyId||params.get("companyId")||""}/>
                <p className="help">
                  Changing the company removes access to the previous company.
                  An active company must retain an owner.
                </p>
              </Form>
            )}
          </details>
          <section id="manage-user-signin" tabIndex={-1} className="account-workspace-section" aria-label="Sign-in assistance and account status">
          <UserVerificationControls
            key={person.id}
            id={person.id}
            verified={person.emailVerified}
            saved={r.reload}
            active={selectedOpen && !readOnly}
          />
          {person.platformRole !== "owner" && (
            <div className="divider">
              <h3>Account status</h3>
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
          <section id="manage-user-activity" tabIndex={-1} className="account-workspace-section" aria-label="Account activity">
            <UserActivity id={person.id} revision={`${person.name}:${person.membership?.version}:${person.status}:${person.emailVerified}`} />
          </section>
          </fieldset>
        </EditorDialog>
      )}
      <fieldset disabled={readOnly} className="editor-contents"><Invitations platform /></fieldset>
    </>
  );
}

export function Properties() {
  const { data } = useAuth();
  return (
    <PropertyDirectory
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`}
    />
  );
}
type PropertyDirectoryRow = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  propertyType?: string | null;
};
type PropertyActivity = {
  id: string;
  activeUnits: number;
  occupiedUnits?: number;
  draftLeases?: number;
  openMaintenance?: number;
};
function PropertyDirectory() {
  const [propertyKey, setPropertyKey] = useState(() => crypto.randomUUID());
  const [propertySuccess, setPropertySuccess] = useState("");
  const { can, data: auth } = useAuth();
  const propertyReadOnly = auth?.companyFeatures?.properties === "read_only";
  const tenantAccessReadOnly = propertyReadOnly || auth?.companyFeatures?.leasing === "read_only";
  const authority = JSON.stringify([auth?.user.id, auth?.user.email, auth?.user.status, auth?.user.emailVerified,
    auth?.membership?.companyId, auth?.membership?.version, auth?.membership?.role, auth?.membership?.status,
    auth?.membership?.company.status, auth?.permissions, auth?.impersonation?.contextId]);
  const original = useRef({ authority, companyId: auth?.membership?.companyId });
  const latestAuthority = useRef(authority);
  latestAuthority.current = authority;
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentAttempt = () => mounted.current && !!original.current.companyId && original.current.authority === latestAuthority.current;
  const [params, setParams] = useSearchParams();
  const r = useResource<PropertyDirectoryRow[]>(
    "/api/company/properties",
    true,
    true,
  );
  const activity = useResource<{ today: string; items: PropertyActivity[] }>(
    "/api/company/property-directory",
    true,
    true,
  );
  const [adding, setAdding] = useState(params.get("new") === "property");
  const [managing, setManaging] = useState<{ id: string; name: string } | null>(
    null,
  );
  const query = params.get("q") || "",
    view = ["no_units","without_lease","maintenance"].includes(params.get("view")||"")?params.get("view")!:"all";
  const hasCounts=!!activity.data?.items&&!activity.error;
  const counts = new Map(hasCounts?activity.data!.items.map(row=>[row.id,row]):[]);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const rows = r.data?.filter((p) => {
    const count = counts.get(p.id);
    return (
      `${p.name} ${p.address} ${p.city} ${p.state} ${p.zip}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (!hasCounts || view === "all" ||
        (view === "no_units" && count?.activeUnits === 0) ||
        (view === "without_lease" &&
          count?.occupiedUnits !== undefined &&
          count.activeUnits > count.occupiedUnits) ||
        (view === "maintenance" && !!count?.openMaintenance))
    );
  });
  const propertyPage = useDirectoryPage(rows, JSON.stringify([query, view]));
  const total = (key: keyof Omit<PropertyActivity, "id">) => {
    const items=hasCounts?activity.data?.items:undefined;
    return items && items.every(p=>p[key]!==undefined) ? items.reduce((sum,p)=>sum+p[key]!,0) : undefined;
  };
  return (
    <>
      <header className="page-heading page-heading-row">
        <div>
          <p className="record-kicker">Workspace / Portfolio</p>
          <h1>Properties</h1>
          <p>Your properties, units and day-to-day work in one place.</p>
        </div>
        {can("property.write") && (
          <button disabled={propertyReadOnly} onClick={() => setAdding(true)}>Add property</button>
        )}
      </header>
      {!propertyReadOnly && <OwnerOnboarding properties={r} onAddProperty={() => setAdding(true)} />}
      {!!r.data?.length && (
        <div className="portfolio-summary" aria-label="Portfolio summary">
          <div>
            <span>Properties</span>
            <strong>{r.data.length}</strong>
          </div>
          <div>
            <span>Active units</span>
            <strong>{total("activeUnits") ?? "—"}</strong>
          </div>
          {can("lease.manage") && (
            <div>
              <span>Units on a current lease</span>
              <strong>{total("occupiedUnits") ?? "—"}</strong>
            </div>
          )}
          {can("maintenance.manage") && (
            <div>
              <span>Open maintenance</span>
              <strong>{total("openMaintenance") ?? "—"}</strong>
            </div>
          )}
        </div>
      )}
      {activity.data?.today&&!!r.data?.length&&<p className="section-caption">Current lease coverage as of {formatDate(activity.data.today)}. Units without a current lease may include future move-ins.</p>}
      {can("property.write") && (
        <EditorDialog
          open={adding}
          title="Add a property"
          onClose={() => setAdding(false)} onDiscard={() => { setAdding(false); setPropertyKey(crypto.randomUUID()); }}
          description="Start with the address. Add units and residents from the property workspace after saving."
        >
          {propertyReadOnly && <p className="notice">Property creation is read-only under the current company settings. Your unfinished details are kept.</p>}
          <Form
            key={propertyKey}
            locked={propertyReadOnly}
            operation="property.create"
            secondaryActions={
              <DraftReset reset={() => setPropertyKey(crypto.randomUUID())} />
            }
            label="Create property"
            submit={async (data) => {
              if (propertyReadOnly) throw new Error("Property creation is read-only under the current company settings.");
              if (!currentAttempt()) throw new ApiError("Your company or account changed. Reopen the property workspace before continuing.", 409, "PROPERTY_CONTEXT_CHANGED");
              await api("/api/company/properties", {
                method: "POST",
                expectedCompanyId: original.current.companyId,
                body: {
                  ...Object.fromEntries(data),
                  submissionKey: propertyKey,
                },
              });
              if (!currentAttempt()) throw new ApiError("Your company or account changed before the result was acknowledged. Review the original company before starting another property.", 409, "PROPERTY_CONTEXT_CHANGED", true);
              setPropertyKey(crypto.randomUUID());
              setPropertySuccess(
                "Property created. Open it to add units and assign residents.",
              );
              setAdding(false);
              r.reload();
              activity.reload();
            }}
          >
            <PropertyAddressFields />
            <PropertyFields />
          </Form>
        </EditorDialog>
      )}
      {propertySuccess && (
        <p role="status" className="notice">
          {propertySuccess}
        </p>
      )}
      <section className="panel property-filter-panel directory-workbench" aria-labelledby="property-filter-heading">
        <div className="section-heading"><div><h2 id="property-filter-heading">Find a property</h2><p className="help">Search your portfolio or choose the work you need to review.</p></div>
          {(query || view !== "all") && <button className="text-button" onClick={() => { const next = new URLSearchParams(params); next.delete("q"); next.delete("view"); setParams(next, {replace:true}); }}>Clear filters</button>}
        </div>
        <div className="directory-toolbar">
          <label className="directory-search">
            Find property
            <input
              type="search"
              placeholder="Name, address, city or postal code"
              value={query}
              maxLength={200}
              onChange={(e) => update("q", e.target.value)}
            />
          </label>
          <label>
            Property view
            <select
              value={view}
              onChange={(e) => update("view", e.target.value)}
              disabled={!hasCounts}
            >
              <option value="all">All properties</option>
              <option value="no_units">No active units</option>
              {can("lease.manage") && (
                <option value="without_lease">
                  Units without a current lease
                </option>
              )}
              {can("maintenance.manage") && (
                <option value="maintenance">Open maintenance</option>
              )}
            </select>
          </label>
        </div>
      </section>
      <section className="panel directory-panel property-results-panel" aria-label="Property directory">
        <div className="section-heading">
          <h2>{query || view !== "all" ? "Matching properties" : "Property directory"}</h2>
          <span className="directory-count" role="status" aria-live="polite">
            {rows && r.data ? `${rows.length} of ${r.data.length} ${r.data.length === 1 ? "property" : "properties"}` : "Loading properties…"}
          </span>
        </div>
        {r.error && <LoadState error={r.error} retry={r.reload} />}
        {activity.error && (
          <p className="notice error" role="alert">
            Activity counts and filters are unavailable. Showing properties matching your search.{" "}
            <button className="text-button" onClick={activity.reload}>
              Retry counts
            </button>
          </p>
        )}
        {!r.data ? (
          !r.error && <LoadState retry={r.reload} />
        ) : !rows?.length ? (
          <div className="empty-state">
            <h3>
              {r.data.length ? "No matching properties" : "No properties yet"}
            </h3>
            <p>
              {r.data.length
                ? "Try a different search or property view."
                : "Add a property to begin organizing its units, people and work."}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="core-table property-directory">
              <thead>
                <tr>
                  <th>Property &amp; address</th>
                  <th>Units</th>
                  {can("lease.manage") && <th>Leasing</th>}
                  {can("maintenance.manage") && <th>Maintenance</th>}
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {propertyPage.items?.map((p) => {
                  const count = counts.get(p.id),
                    root = `/company/properties/${encodeURIComponent(p.id)}`;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link className="table-primary" to={root}>
                          {p.name}
                        </Link>
                        <Address
                          street={p.address}
                          city={p.city}
                          region={p.state}
                          postalCode={p.zip}
                        />
                      </td>
                      <td data-label="Units">
                        <Link to={`${root}/units`}>
                          {count ? `${count.activeUnits} active` : "View units"}
                        </Link>
                        {count?.occupiedUnits !== undefined && (
                          <span className="cell-detail">
                            {Math.max(
                              0,
                              count.activeUnits - count.occupiedUnits,
                            )}{" "}
                            without a current lease
                          </span>
                        )}
                      </td>
                      {can("lease.manage") && (
                        <td data-label="Leasing">
                          <Link to={`${root}/leases`}>
                            {count?.occupiedUnits !== undefined
                              ? `${count.occupiedUnits} current`
                              : "View leases"}
                          </Link>
                          {!!count?.draftLeases && (
                            <span className="cell-detail">
                              {count.draftLeases} draft{" "}
                              {count.draftLeases === 1 ? "lease" : "leases"}
                            </span>
                          )}
                        </td>
                      )}
                      {can("maintenance.manage") && (
                        <td data-label="Maintenance">
                          <Link
                            className={
                              count?.openMaintenance ? "work-attention" : ""
                            }
                            to={`${root}/maintenance?status=unresolved`}
                          >
                            {count?.openMaintenance === undefined
                              ? "View requests"
                              : `${count.openMaintenance} open`}
                          </Link>
                        </td>
                      )}
                      <td>
                        <div className="row-actions">
                          <Link className="tenant-row-action" to={root}>
                            View property →
                          </Link>
                          {can("resident.assignment.manage") && availableFeatureRoute(`${root}/residents`, auth?.companyFeatures, auth?.membership?.role) && (
                            tenantAccessReadOnly ? <Link className="text-button" to={`${root}/residents`}>View tenant access</Link> : <button className="text-button" onClick={() => setManaging(p)}>Manage residents</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows && <DirectoryPagination name="Properties" {...propertyPage} total={rows.length} />}
      </section>
      {managing && can("resident.assignment.manage") && (
        <ManageResidents
          key={managing.id}
          property={managing}
          close={() => setManaging(null)}
        />
      )}
    </>
  );
}

export function Team() {
  const { data } = useAuth();
  return (
    <TeamDirectory
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`}
    />
  );
}
type StaffPropertyScope = {
  expectedVersion: number;
  maintenanceExecution?: boolean;
  scope: string;
  propertyIds: string[];
  properties: { id: string; name: string; address: string }[];
  history: { id: string; actorName: string; createdAt: string; detail: { from: { scope: string; propertyIds: string[] }; to: { scope: string; propertyIds: string[] } } }[];
};
function StaffPropertyEditor({ member, saved }: { member: Member; saved: () => void }) {
  const r = useResource<StaffPropertyScope>(`/api/company/members/${encodeURIComponent(member.userId)}/property-access`);
  return r.data ? <StaffPropertyForm value={r.data} member={member} saved={saved} /> : <LoadState error={r.error} retry={r.reload} />;
}
function StaffPropertyForm({ value, member, saved }: { value: StaffPropertyScope; member: Member; saved: () => void }) {
  const [scope, setScope] = useState(value.scope);
  const [maintenanceExecution,setMaintenanceExecution] = useState(value.maintenanceExecution || false);
  const [selected, setSelected] = useState(value.propertyIds);
  const [search, setSearch] = useState("");
  const shown = value.properties.filter(p => `${p.name} ${p.address}`.toLowerCase().includes(search.trim().toLowerCase()));
  const describe = (v: { scope: string; propertyIds: string[] }) => v.scope === "all" ? "All company properties" : v.propertyIds.length ? `${v.propertyIds.length} selected ${v.propertyIds.length === 1 ? "property" : "properties"}` : "No properties";
  return <>
    <p>Staff can view property and unit records. Financial records, leases, tenant profiles and maintenance management require separate authority.</p>
    {scope === "selected" && <label>Find a property<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>}
    <Form operation="membership.update" feedbackText="Staff property access saved." label="Save staff access" submit={async () => {
      await api(`/api/company/members/${encodeURIComponent(member.userId)}/property-access`, { method: "PUT", body: { scope, propertyIds: scope === "all" ? [] : selected, maintenanceExecution, expectedVersion: value.expectedVersion } });
      saved();
    }}>
      <label>Property access<select aria-label="Property access" value={scope} onChange={e => setScope(e.target.value)}>
        <option value="all">All company properties</option>
        <option value="selected">Selected properties only</option>
      </select></label>
      {scope === "all" ? <p>Includes current properties and properties added later.</p> : <fieldset>
        <legend>Choose properties</legend>
        <p>{selected.length ? `${selected.length} selected` : "No properties selected. Saving revokes all property access."}</p>
        {!value.properties.length ? <p>Add a property to the company before granting access.</p> : !shown.length ? <p>No properties match your search.</p> : <div className="staff-property-options">{shown.map(p => <label className="staff-property-option" key={p.id}>
          <input type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />
          <span><strong>{p.name}</strong><small>{p.address}</small></span>
        </label>)}</div>}
      </fieldset>}
      <label className="checkbox-label"><input type="checkbox" checked={maintenanceExecution} onChange={e=>setMaintenanceExecution(e.target.checked)}/>Allow maintenance execution</label><p className="help">Within this property scope, the teammate can accept assigned work, record progress and submit completion for management review. Financial, lease, tenant and document access stays restricted.</p>
      <p><strong>After saving:</strong> {describe({ scope, propertyIds: selected })}. Property viewing remains read-only. Separately granted maintenance execution also follows this property scope. Changes apply on the next request.</p>
    </Form>
    {value.history.length > 0 && <details><summary>Recent property access changes</summary><ul>{value.history.map(h => <li key={h.id}>
      {formatActivityTime(h.createdAt)} · {h.actorName}: {describe(h.detail.from)} → {describe(h.detail.to)}
    </li>)}</ul></details>}
  </>;
}
function TeamDirectory() {
  const r = useResource<Member[]>("/api/company/members");
  const { user, data, refreshUser } = useAuth();
  const [params] = useSearchParams();
  const [inviting, setInviting] = useState(params.has("invite")),
    [transferring, setTransferring] = useState(false);
  const [selected, setSelected, selectedOpen, saveSelectedDraft] = useEditorSelection("");
  const scope = JSON.stringify([data?.user.id, data?.user.status, data?.user.emailVerified, data?.membership?.companyId, data?.membership?.version, data?.permissions, data?.impersonation?.contextId, data?.companyFeatures]);
  const [memberDraft, setMemberDraft] = useState<{ member: Member; scope: string } | null>(null);
  const [propertyMember, setPropertyMember, propertyMemberOpen, savePropertyDraft] = useEditorSelection("");
  const [teamQuery, setTeamQuery] = useState(""), [teamStatus, setTeamStatus] = useState(""), [teamRole, setTeamRole] = useState(""), [teamPage, setTeamPage] = useState(0);
  const [invitationRevision, setInvitationRevision] = useState(0);
  const [passwordMember, setPasswordMember] = useState<Member | null>(null);
  const team = r.data?.filter((m) => m.role !== "resident");
  const denied = r.errorStatus !== undefined && [401, 403, 404].includes(r.errorStatus);
  const currentMember = team?.find(m => m.userId === selected);
  const member = !denied && (!memberDraft || memberDraft.scope === scope) && (r.loading || !!r.error || !!currentMember)
    ? memberDraft?.member.userId === selected ? memberDraft.member : currentMember
    : undefined;
  useEffect(() => {
    if (denied || memberDraft && memberDraft.scope !== scope || selected && !r.loading && !r.error && r.data && !team?.some(m => m.userId === selected)) {
      setMemberDraft(null);
      setSelected("");
    } else if (selected && member && memberDraft?.member.userId !== selected) {
      setMemberDraft({ member, scope });
    }
  }, [denied, scope, selected, member, memberDraft, r.loading, r.error, r.data, setSelected]);
  const filteredTeam = team?.filter(m => (!teamStatus || (m.status === "active" && m.user.status === "active" ? "active" : "disabled") === teamStatus) && (!teamRole || m.role === teamRole) && `${m.user.name || ""} ${m.user.email}`.toLowerCase().includes(teamQuery.trim().toLowerCase()));
  useEffect(()=>{const last=Math.max(0,Math.ceil((filteredTeam?.length||0)/25)-1);if(r.data&&teamPage>last)setTeamPage(last);},[filteredTeam?.length,teamPage,r.data]);
  const teamRows = filteredTeam?.slice(teamPage * 25, (teamPage + 1) * 25);
  return (
    <>
      <header className="page-heading page-heading-row admin-directory-heading">
        <div><p className="eyebrow">Company / People &amp; access</p><h1>Team</h1><p>Manage owners, managers and staff. Keep property scope separate from company roles.</p></div>
        <button onClick={() => setInviting(true)}>Invite team member</button>
      </header>
      <nav className="admin-related-links" aria-label="People workspaces"><Link to="/company/residents">Manage tenants</Link><Link to="/company/settings?section=roles">Roles &amp; permissions →</Link><button className="text-button" onClick={() => setTransferring(true)}>Transfer ownership</button></nav>
      <section className="panel admin-directory directory-workbench team-directory" aria-label="Team directory">
        <div className="admin-directory-intro"><div><h2>Company team</h2><p>Tenant contact records and portal access are managed in Tenants.</p></div>{team && <span className="directory-count">{team.length} team {team.length === 1 ? "member" : "members"}</span>}</div>
        <div className="filters directory-toolbar"><label>Find team member<input type="search" maxLength={200} value={teamQuery} onChange={e=>{setTeamQuery(e.target.value);setTeamPage(0);}}/></label><label>Team role<select value={teamRole} onChange={e=>{setTeamRole(e.target.value);setTeamPage(0);}}><option value="">All roles</option><option value="owner">Company owner</option><option value="manager">Manager</option><option value="staff">Staff</option></select></label><label>Team status<select value={teamStatus} onChange={e=>{setTeamStatus(e.target.value);setTeamPage(0);}}><option value="">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label></div>
        <div className="admin-directory-summary directory-result-summary"><p aria-live="polite">{filteredTeam ? `${filteredTeam.length} matching ${filteredTeam.length === 1 ? "member" : "members"}` : "Loading team…"}</p>{(teamQuery || teamStatus || teamRole) && <button className="text-button" type="button" onClick={() => { setTeamQuery(""); setTeamStatus(""); setTeamRole(""); setTeamPage(0); }}>Clear team filters</button>}</div>
        {!r.data ? (
          <LoadState error={r.error} retry={r.reload} />
        ) : (
          <ul className="record-list team-record-list">
            {teamRows?.map((m) => (
              <li key={m.userId}>
                <div className="team-record-identity">
                  <span className="admin-avatar" aria-hidden="true">{(m.user.name || m.user.email).slice(0, 1).toUpperCase()}</span>
                  <div><strong>{m.user.name || m.user.email}</strong><p>{m.user.email}</p></div>
                </div>
                <div className="team-record-status"><Badge>{m.role}</Badge><span className={`admin-status ${m.user.status === "active" && m.status === "active" ? "is-active" : "is-blocked"}`}>{m.user.status !== "active" ? "Account disabled" : m.status === "active" ? "Active access" : "Membership disabled"}</span></div>
                <div className="team-record-actions">
                {m.user.status === "active" && m.status === "active" && m.user.passwordManageable !== false && m.userId.startsWith("auth0|") && !data?.impersonation && <button className="secondary" onClick={() => setPasswordMember(m)}>Manage password</button>}
                {m.role === "staff" && <button className="secondary" onClick={() => setPropertyMember(m.userId)}>Staff access</button>}
                {m.role !== "owner" && (
                  <button
                    className="secondary"
                    onClick={() => setSelected(m.userId)}
                  >
                    Edit access
                  </button>
                )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {r.data && !filteredTeam?.length && <p>No team members match these filters.</p>}
        {(filteredTeam?.length || 0) > 25 && <nav className="admin-directory-pagination directory-pagination" aria-label="Team pages"><p>Showing {teamPage * 25 + 1}–{Math.min((teamPage + 1) * 25, filteredTeam!.length)} of {filteredTeam!.length} matching members</p><div className="actions"><button className="secondary" disabled={!teamPage} onClick={()=>setTeamPage(p=>p-1)}>Previous team members</button><span>Page {teamPage+1}</span><button className="secondary" disabled={(teamPage+1)*25>=filteredTeam!.length} onClick={()=>setTeamPage(p=>p+1)}>Next team members</button></div></nav>}
      </section>
      {passwordMember && <EditorDialog open title={`Password for ${passwordMember.user.name || passwordMember.user.email}`} draftable={false} onClose={() => setPasswordMember(null)}><ManualPassword id={passwordMember.userId}/></EditorDialog>}
      {team?.find(m => m.userId === propertyMember) && <EditorDialog key={propertyMember} open={propertyMemberOpen} onSaveDraft={savePropertyDraft} title={`Staff access for ${team.find(m => m.userId === propertyMember)!.user.name || team.find(m => m.userId === propertyMember)!.user.email}`} onClose={() => setPropertyMember("")}>
        <StaffPropertyEditor key={propertyMember} member={team.find(m => m.userId === propertyMember)!} saved={() => { setPropertyMember(""); r.reload(); }} />
      </EditorDialog>}
      {member && (
        <EditorDialog
          key={selected}
          open={selectedOpen}
          onSaveDraft={saveSelectedDraft}
          title={`Access for ${member.user.name || member.user.email}`}
          onClose={() => { setSelected(""); setMemberDraft(null); }}
        >
          {r.loading && <p role="status">Checking current team access…</p>}
          {r.error && <LoadState error={r.error} retry={r.reload} />}
          <Form
            operation="membership.update"
            locked={r.loading || !!r.error}
            submit={async (data) => {
              if (r.loading || r.error) throw new Error("Reload current team access before saving.");
              try { await api(
                `/api/company/members/${encodeURIComponent(member.userId)}`,
                {
                  method: "PATCH",
                  body: {
                    role: text(data, "role"),
                    status: text(data, "status"),
                    expectedVersion: member.version,
                  },
                },
              ); } catch (error) {
                if (error instanceof ApiError && error.code === "STALE_MEMBERSHIP") r.reload();
                throw error;
              }
              setSelected("");
              setMemberDraft(null);
              r.reload();
            }}
          >
            <RoleSelect value={member.role} audience="team" />
            <StatusSelect value={member.status} />
          </Form>
        </EditorDialog>
      )}
      <EditorDialog
        open={inviting}
        title="Invite team member"
        onClose={() => setInviting(false)}
      >
        <InvitationForm
          companyId={data?.membership?.companyId}
          audience="team"
          done={() => setInviting(false)}
          reload={() => setInvitationRevision((v) => v + 1)}
        />
      </EditorDialog>
      <EditorDialog
        open={transferring}
        title="Transfer ownership"
        onClose={() => setTransferring(false)}
      >
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
                    m.role !== "resident" &&
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
      </EditorDialog>
      <Invitations key={invitationRevision} audience="team" />
    </>
  );
}
export function Invitations(props: {platform?:boolean;audience?:"team"|"tenants"}) { return <InvitationHistory {...props}/>; }
export function CompanySettings() { return <CompanyProfile/>; }
export function Account() { return <AccountProfile/>; }
export function AccessStatus() {
  const { data, refreshUser } = useAuth();
  const suspended =
    data?.user.status !== "active" ||
    data?.membership?.status === "disabled" ||
    data?.membership?.company.status === "suspended";
  if (data?.destination && data.destination !== "/access")
    return <Navigate to={data.destination} replace />;
  return (
    <section className="status-panel">
      <h1>{suspended ? "Access is disabled" : "Account access pending"}</h1>
      <p>
        {suspended
          ? "Contact your administrator to restore access."
          : "Your account is waiting for an active company assignment. If you received an invitation, review and accept it to join your workspace."}
      </p>
      {!suspended && sessionStorage.getItem("pf-invitation") && <Link className="button" to="/invite">Review your invitation</Link>}
      <button onClick={() => void refreshUser()}>Check access again</button>
      <Link to="/account">View my profile</Link>
    </section>
  );
}
export function ManageResidents({
  property,
  close,
}: {
  property: { id: string; name: string };
  close: () => void;
}) {
  const { can, data: auth } = useAuth();
  const accessReadOnly = (["properties", "leasing"] as const).some(key => auth?.companyFeatures?.[key] !== undefined && auth.companyFeatures[key] !== "enabled");
  const canChangeAccess = can("resident.assignment.manage") && !accessReadOnly;
  const base = `/api/company/properties/${encodeURIComponent(property.id)}/residents`;
  const eligible = useResource<
    { userId: string; user: { name: string | null; email: string } }[]
  >("/api/company/residents");
  const assigned = useResource<
    {
      userId: string;
      membership: { user: { name: string | null; email: string } };
    }[]
  >(base);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [residentChoice, setResidentChoice] = useState("");
  const choices = eligible.data?.filter(
    (person) => !assigned.data?.some((row) => row.userId === person.userId),
  );
  const change = async (userId: string, method: "PUT" | "DELETE") => {
    if (!canChangeAccess || busy || assigned.loading || eligible.loading || assigned.error || eligible.error) return;
    setBusy(true);
    setError("");
    try {
      await api(`${base}/${encodeURIComponent(userId)}`, { method });
      if (method === "PUT") setResidentChoice("");
      assigned.reload();
      eligible.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update assignment.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorDialog
      open
      title={`Residents for ${property.name}`}
      draftable={false}
      onClose={close}
      busy={busy}
    >
      <p className="help">
        An assignment provides property access. It is not a lease or proof of
        occupancy. Pending invitations are not eligible; residents must accept
        first.
      </p>
      {accessReadOnly && <p className="notice" role="status">Tenant property access is read-only under the current company settings. New assignments and removals are unavailable.</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!eligible.data || !assigned.data ? (
        <LoadState
          error={eligible.error || assigned.error}
          retry={() => {
            eligible.reload();
            assigned.reload();
          }}
        />
      ) : (
        <>
          {assigned.data.length ? (
            <ul className="record-list">
              {assigned.data.map((row) => (
                <li key={row.userId}>
                  <strong>
                    {row.membership.user.name || row.membership.user.email}
                  </strong>
                  <Badge>Assigned</Badge>
                  <button
                    disabled={busy || !canChangeAccess || assigned.loading || eligible.loading || !!assigned.error || !!eligible.error}
                    className="secondary"
                    onClick={() => change(row.userId, "DELETE")}
                  >
                    Remove assignment
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No residents assigned.</p>
          )}
          {choices?.length ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy && canChangeAccess)
                  void change(
                    String(new FormData(event.currentTarget).get("resident")),
                    "PUT",
                  );
              }}
            >
              <fieldset disabled={busy || !canChangeAccess || assigned.loading || eligible.loading || !!assigned.error || !!eligible.error}>
                <label>
                  Accepted resident
                  <select name="resident" required value={residentChoice} onChange={event => setResidentChoice(event.target.value)}>
                    <option value="" disabled>
                      Choose a resident
                    </option>
                    {choices.map((person) => (
                      <option key={person.userId} value={person.userId}>
                        {person.user.name || person.user.email}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">
                  {busy ? "Updating…" : "Assign resident"}
                </button>
              </fieldset>
            </form>
          ) : (
            <p>No additional active accepted residents available.</p>
          )}
        </>
      )}
    </EditorDialog>
  );
}
export function Resident() {
  const { data: auth } = useAuth();
  const available = (path: string) => availableFeatureRoute(path, auth?.companyFeatures, auth?.membership?.role);
  const r = useResource<{ id: string; name: string; address: string }[]>(
    "/api/resident/properties",
  );
  return (
    <>
      <header className="page-heading resident-home-heading">
        <p className="eyebrow">Resident</p>
        <h1>My rental</h1>
        <p>View your rental records and updates from your property team.</p>
      </header>
      <ResidentRentSummary />
      <nav className="resident-service-grid" aria-label="Resident services">
        {available("/resident/rent") && <div><Link to="/resident/rent">View rent & payments</Link><p>Check charges, recorded payments and your balance. Find your payment instructions.</p></div>}
        {available("/resident/maintenance") && <div><Link to="/resident/maintenance">Maintenance requests</Link><p>Report a problem and follow updates from your property team.</p></div>}
        {available("/resident/documents") && <div><Link to="/resident/documents">Shared documents</Link><p>Read files your property team has shared with you and confirm receipt.</p></div>}
        {available("/resident/deposits") && <div><Link to="/resident/deposits">View security deposit</Link><p>Review your deposit requirement, receipts and any recorded returns.</p></div>}
        <div><Link to="/account">My profile</Link><p>Keep your contact details and emergency contact up to date.</p></div>
      </nav>
      {!r.data ? (
        <LoadState error={r.error} retry={r.reload} />
      ) : r.data.length ? (
        r.data.map((property) => (
          <section className="panel" key={property.id}>
            <h2>{property.name}</h2>
            <p>{property.address}</p>
          </section>
        ))
      ) : (
        <section className="panel">
          <h2>No properties assigned</h2>
          <p>
            Your company membership is active. Contact your property manager for
            a property assignment.
          </p>
        </section>
      )}
      {available("/resident/leases") && <ResidentLeaseInvitations />}
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
      {token&&sessionStorage.getItem("pf-contact-invitation")==="true"&&sessionStorage.getItem("pf-lease-invitation")!=="true"?<ContactInvitationReview token={token} accepted={async()=>{sessionStorage.removeItem("pf-invitation");sessionStorage.removeItem("pf-contact-invitation");await refreshUser();navigate("/resident");}}/>:token&&sessionStorage.getItem("pf-lease-invitation")==="true"?<LeaseInvitationReview token={token} accepted={async()=>{sessionStorage.removeItem("pf-invitation");sessionStorage.removeItem("pf-lease-invitation");await refreshUser();navigate("/resident");}}/>:token ? (
        <TeamInvitationReview token={token} accepted={async()=>{sessionStorage.removeItem("pf-invitation");await refreshUser();navigate("/dashboard");}}/>
      ) : (
        <p>Open the full invitation link sent by your administrator.</p>
      )}
    </section>
  );
}
export function Audit() {
  return <><header className="page-heading"><p className="eyebrow">Platform</p><h1>Activity</h1><p>Find recorded access and administration changes across the platform.</p></header><section className="panel"><ActivityLog/></section></>;
}
