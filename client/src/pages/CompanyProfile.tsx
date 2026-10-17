import { RoleGuide } from "../components/RoleGuide";
import { useSearchParams } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { api } from "../api";
import { Form } from "./Workspace";
import { EditorDialog } from "../components/EditorDialog";
import { DraftReset } from "../components/DraftReset";
import { Address } from "../components/Address";
import { formatDate } from "../dates";
import "./AccountProfile.css";
type Company = {
  id: string;
  version: number;
  name: string;
  timezone: string;
  status: string;
  domain: string | null;
  updatedAt: string;
} & Record<string, string | number | null>;
const labels: Record<string, string> = {
  name: "Company name",
  legalName: "Legal business name",
  contactName: "Primary contact",
  contactEmail: "Business email",
  contactPhone: "Business phone",
  website: "Website",
  addressLine1: "Street address",
  addressLine2: "Apartment / suite",
  city: "City",
  region: "State / region",
  postalCode: "Postal code",
  country: "Country code",
  timezone: "Company timezone",
};
const sections = [
  {
    id: "roles",
    title: "Roles & permissions",
    short: "Roles",
    description: "Understand what each role can do in this company.",
    keys: [],
  },
  {
    id: "business",
    title: "Business profile",
    short: "Business",
    description: "The name and website used to identify your company.",
    keys: ["name", "legalName", "website"],
  },
  {
    id: "contact",
    title: "Business contacts",
    short: "Contacts",
    description: "Who to contact and how to reach your business.",
    keys: ["contactName", "contactEmail", "contactPhone"],
  },
  {
    id: "address",
    title: "Mailing address",
    short: "Address",
    description:
      "Your company’s mailing address. Property addresses are managed separately.",
    keys: [
      "addressLine1",
      "addressLine2",
      "city",
      "region",
      "postalCode",
      "country",
    ],
  },
  {
    id: "preferences",
    title: "Operating preferences",
    short: "Preferences",
    description: "Set the company time used by billing and reports.",
    keys: ["timezone"],
  },
  {
    id: "history",
    title: "Change history",
    short: "History",
    description: "Review who changed company details and the previous values.",
    keys: [],
  },
];
type Review = {
  body: Record<string, unknown>;
  changes: [string, string, string][];
  attempted?: boolean;
};
function retained(key: string): Review | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(key) || "null");
    return r &&
      typeof r.body?.submissionKey === "string" &&
      Array.isArray(r.changes)
      ? r
      : null;
  } catch {
    return null;
  }
}
export function CompanyProfile() {
  const { data } = useAuth();
  return (
    <CompanyDetails key={`${data?.user.id}:${data?.membership?.companyId}`} />
  );
}
function CompanyDetails() {
  const { data: auth, refreshUser } = useAuth(),
    key = `pf:company-profile:${auth?.user.id}:${auth?.membership?.companyId}`,
    r = useResource<Company>("/api/company", false, true);
  const [params, setParams] = useSearchParams(),
    section = sections.some((s) => s.id === params.get("section"))
      ? params.get("section")!
      : "business",
    setSection = (value: string) => setParams({ section: value });
  const [editing, setEditing] = useState("business"),
    [draft, setDraft] = useState<Company | null>(null),
    [review, setReview] = useState<Review | null>(() => retained(key)),
    [open, setOpen] = useState(false),
    [before, setBefore] = useState<number | null>(null);
  const history = useResource<{
    items: {
      id: string;
      version: number;
      actor: string;
      createdAt: string;
      before: Company;
      after: Company;
    }[];
    nextBeforeVersion: number | null;
  }>(
    `/api/company/profile-history${before ? `?beforeVersion=${before}` : ""}`,
    false,
    true,
  );
  const c = r.data,
    active = sections.find((s) => s.id === section)!,
    editor = sections.find((s) => s.id === editing)!,
    clear = () => {
      sessionStorage.removeItem(key);
      setReview(null);
      setDraft(null);
      setOpen(false);
    };
  const edit = () => {
    if (!draft) setEditing(section);
    setDraft((old) => old || c!);
    setOpen(true);
  };
  const value = (k: string) => String(c?.[k] || "—");
  return (
    <div className="company-profile-page">
      <header className="page-heading">
        <p className="record-kicker">Administration</p>
        <h1>Company settings</h1>
        <p>Manage your business details, one section at a time.</p>
      </header>
      {r.error ? (
        <p className="notice error" role="alert">
          {r.error}{" "}
          <button className="secondary" onClick={r.reload}>
            Refresh company details
          </button>
        </p>
      ) : !c ? (
        <p role="status">Loading company details…</p>
      ) : (
        <>
          <div className="account-identity-card">
            <div className="account-monogram" aria-hidden="true">
              {c.name.trim().slice(0, 1)}
            </div>
            <div>
              <h2>{c.name}</h2>
              <p>{c.legalName || "Company workspace"}</p>
            </div>
            <span className="tenant-status">
              {c.status === "active" ? "Active" : "Suspended"}
            </span>
          </div>
          <nav className="profile-tabs" aria-label="Company settings sections">
            {[...sections.filter((s) => s.id !== "roles"), sections[0]].map(
              (s) => (
                <button
                  key={s.id}
                  className="profile-tab"
                  aria-current={section === s.id ? "page" : undefined}
                  onClick={() => setSection(s.id)}
                >
                  {s.short}
                </button>
              ),
            )}
          </nav>
          {review && (
            <div className="notice movement-pending">
              <span>Company changes are ready to review.</span>
              <button className="secondary" onClick={() => setOpen(true)}>
                Resume company review
              </button>
              <DraftReset reset={clear} />
            </div>
          )}
          <section className="panel account-content-card">
            <div className="section-heading">
              <div>
                <h2>{active.title}</h2>
                <p>{active.description}</p>
              </div>
              {!["history", "roles"].includes(section) && (
                <button className="secondary" onClick={edit}>
                  {draft
                    ? "Continue editing"
                    : `Edit ${active.short.toLowerCase()}`}
                </button>
              )}
            </div>
            {section === "roles" && <RoleGuide />}
            {section === "business" && (
              <dl className="profile-facts">
                <div>
                  <dt>Company name</dt>
                  <dd>{c.name}</dd>
                </div>
                <div>
                  <dt>Legal business name</dt>
                  <dd>{value("legalName")}</dd>
                </div>
                <div className="wide">
                  <dt>Website</dt>
                  <dd>
                    {c.website ? (
                      <a
                        href={String(c.website)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {String(c.website)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            )}
            {section === "contact" && (
              <>
                {!c.contactName && !c.contactEmail && !c.contactPhone ? (
                  <div className="account-empty">
                    <h3>Add a business contact</h3>
                    <p>
                      A name, email and phone number help keep company
                      communication organized.
                    </p>
                  </div>
                ) : (
                  <dl className="profile-facts">
                    <div className="wide">
                      <dt>Primary contact</dt>
                      <dd>{value("contactName")}</dd>
                    </div>
                    <div>
                      <dt>Business email</dt>
                      <dd>{value("contactEmail")}</dd>
                    </div>
                    <div>
                      <dt>Business phone</dt>
                      <dd>{value("contactPhone")}</dd>
                    </div>
                  </dl>
                )}
              </>
            )}
            {section === "address" && (
              <div className="account-address-block">
                {c.addressLine1 || c.city ? (
                  <Address
                    street={c.addressLine1 as string | null}
                    line2={c.addressLine2 as string | null}
                    city={c.city as string | null}
                    region={c.region as string | null}
                    postalCode={c.postalCode as string | null}
                    country={c.country as string | null}
                  />
                ) : (
                  <div className="account-empty">
                    <h3>No mailing address yet</h3>
                    <p>Add the address where your business receives mail.</p>
                  </div>
                )}
              </div>
            )}
            {section === "preferences" && (
              <>
                <dl className="profile-facts">
                  <div className="wide">
                    <dt>Company timezone</dt>
                    <dd>{c.timezone.replace(/_/g, " ")}</dd>
                  </div>
                </dl>
                <p className="account-hint">
                  Billing and reporting use the business date in this timezone.
                  Posted records keep their original dates.
                </p>
                <details className="account-disclosure">
                  <summary>Platform-managed settings</summary>
                  <dl className="profile-facts">
                    <div>
                      <dt>Company status</dt>
                      <dd>{c.status}</dd>
                    </div>
                    <div>
                      <dt>Company domain</dt>
                      <dd>{value("domain")}</dd>
                    </div>
                  </dl>
                  <p className="help">
                    Contact the platform administrator to change status or
                    domain.
                  </p>
                </details>
              </>
            )}
            {section === "history" && (
              <>
                {history.error ? (
                  <p className="notice error" role="alert">
                    {history.error}{" "}
                    <button className="secondary" onClick={history.reload}>
                      Refresh company history
                    </button>
                  </p>
                ) : !history.data ? (
                  <p role="status">Loading profile activity…</p>
                ) : history.data.items.length ? (
                  <>
                    {history.data.items.map((h) => (
                      <details className="account-disclosure" key={h.id}>
                        <summary>
                          <span>Version {h.version}</span>
                          <span>
                            {formatDate(h.createdAt)} · {h.actor}
                          </span>
                        </summary>
                        <dl className="profile-facts">
                          {Object.entries(labels)
                            .filter(([k]) => h.before[k] !== h.after[k])
                            .map(([k, label]) => (
                              <div key={k}>
                                <dt>{label}</dt>
                                <dd>
                                  <span className="section-caption">
                                    Previous:{" "}
                                    {String(h.before[k] || "Not supplied")}
                                  </span>
                                  {String(h.after[k] || "Not supplied")}
                                </dd>
                              </div>
                            ))}
                        </dl>
                      </details>
                    ))}
                    <nav className="actions" aria-label="Company history pages">
                      {before && (
                        <button
                          className="secondary"
                          onClick={() => setBefore(null)}
                        >
                          Latest changes
                        </button>
                      )}
                      {history.data.nextBeforeVersion && (
                        <button
                          className="secondary"
                          onClick={() =>
                            setBefore(history.data!.nextBeforeVersion)
                          }
                        >
                          Older changes
                        </button>
                      )}
                    </nav>
                  </>
                ) : (
                  <div className="account-empty">
                    <h3>No profile changes yet</h3>
                    <p>
                      Saved changes will show the previous values and the person
                      who made them.
                    </p>
                  </div>
                )}
              </>
            )}
            <footer className="account-card-footer">
              Updated {formatDate(c.updatedAt)}
              <span>Version {c.version}</span>
            </footer>
          </section>
        </>
      )}
      <EditorDialog
        open={open}
        title={
          review
            ? "Review company changes"
            : `Edit ${editor.title.toLowerCase()}`
        }
        onClose={() => setOpen(false)}
      >
        {review ? (
          <>
            <p>Only the changes below will be saved.</p>
            <dl className="profile-facts profile-review">
              {review.changes.map(([k, old, next]) => (
                <div key={k}>
                  <dt>{labels[k]}</dt>
                  <dd>
                    <span className="section-caption">
                      Previous: {old || "Not supplied"}
                    </span>
                    {next || "Not supplied"}
                  </dd>
                </div>
              ))}
            </dl>
            <Form
              label="Save company details"
              operation="company.update"
              feedbackText="Company details saved with change history."
              secondaryActions={
                !review.attempted && draft ? (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      sessionStorage.removeItem(key);
                      setReview(null);
                    }}
                  >
                    Back to company details
                  </button>
                ) : undefined
              }
              submit={async () => {
                const attempt = { ...review, attempted: true };
                sessionStorage.setItem(key, JSON.stringify(attempt));
                setReview(attempt);
                await api("/api/company", {
                  method: "PATCH",
                  body: attempt.body,
                });
                clear();
                setBefore(null);
                r.reload();
                history.reload();
                await refreshUser();
              }}
            >
              {review.changes.some(([k]) => k === "timezone") && (
                <p className="notice">
                  The new timezone changes the business date used by billing and
                  reports.
                </p>
              )}
              <DraftReset reset={clear} />
            </Form>
          </>
        ) : null}
        {draft && (
          <div hidden={!!review}>
            <Form
              label="Review company details"
              operation="page.data.load"
              successText="Ready to confirm."
              submit={async (form) => {
                const values = Object.fromEntries(
                  Object.keys(labels).map((k) => [
                    k,
                    form.has(k) ? form.get(k) || null : (draft[k] ?? null),
                  ]),
                );
                const changes = Object.keys(labels)
                  .filter((k) => (values[k] || "") !== (draft[k] || ""))
                  .map(
                    (k) =>
                      [k, String(draft[k] || ""), String(values[k] || "")] as [
                        string,
                        string,
                        string,
                      ],
                  );
                if (!changes.length)
                  throw new Error("Change a detail before reviewing.");
                const next = {
                  body: {
                    ...values,
                    expectedVersion: draft.version,
                    submissionKey: crypto.randomUUID(),
                  },
                  changes,
                };
                sessionStorage.setItem(key, JSON.stringify(next));
                setReview(next);
              }}
            >
              <p className="help">{editor.description}</p>
              {editing === "business" && (
                <>
                  <label>
                    Company name
                    <input
                      name="name"
                      required
                      maxLength={200}
                      defaultValue={draft.name}
                      autoComplete="organization"
                    />
                  </label>
                  <label>
                    Legal business name · optional
                    <input
                      name="legalName"
                      maxLength={200}
                      defaultValue={String(draft.legalName || "")}
                    />
                  </label>
                  <label>
                    Website · optional
                    <input
                      name="website"
                      type="url"
                      maxLength={500}
                      placeholder="https://example.com"
                      defaultValue={String(draft.website || "")}
                    />
                  </label>
                </>
              )}
              {editing === "contact" && (
                <>
                  <label>
                    Primary contact
                    <input
                      name="contactName"
                      maxLength={200}
                      defaultValue={String(draft.contactName || "")}
                    />
                  </label>
                  <label>
                    Business email
                    <input
                      name="contactEmail"
                      type="email"
                      maxLength={254}
                      defaultValue={String(draft.contactEmail || "")}
                    />
                  </label>
                  <label>
                    Business phone
                    <input
                      name="contactPhone"
                      type="tel"
                      maxLength={40}
                      defaultValue={String(draft.contactPhone || "")}
                    />
                  </label>
                </>
              )}
              {editing === "address" && (
                <>
                  <label>
                    Street address
                    <input
                      name="addressLine1"
                      maxLength={200}
                      autoComplete="address-line1"
                      defaultValue={String(draft.addressLine1 || "")}
                    />
                  </label>
                  <label>
                    Apartment / suite · optional
                    <input
                      name="addressLine2"
                      maxLength={200}
                      autoComplete="address-line2"
                      defaultValue={String(draft.addressLine2 || "")}
                    />
                  </label>
                  <div className="address-fields">
                    <label className="address-city">
                      City
                      <input
                        name="city"
                        maxLength={100}
                        defaultValue={String(draft.city || "")}
                      />
                    </label>
                    <label>
                      State / region
                      <input
                        name="region"
                        maxLength={100}
                        defaultValue={String(draft.region || "")}
                      />
                    </label>
                    <label>
                      Postal code
                      <input
                        name="postalCode"
                        maxLength={30}
                        defaultValue={String(draft.postalCode || "")}
                      />
                    </label>
                  </div>
                  <label>
                    Country code
                    <input
                      name="country"
                      maxLength={2}
                      pattern="[A-Za-z]{2}"
                      placeholder="US"
                      autoComplete="country"
                      defaultValue={String(draft.country || "")}
                    />
                  </label>
                  <p className="help">
                    Use the two-letter country code, such as US or CA.
                  </p>
                </>
              )}
              {editing === "preferences" && (
                <>
                  <label>
                    Company timezone
                    <input
                      name="timezone"
                      required
                      maxLength={80}
                      list="company-timezones"
                      defaultValue={draft.timezone}
                    />
                    <datalist id="company-timezones">
                      {[
                        "America/New_York",
                        "America/Chicago",
                        "America/Denver",
                        "America/Los_Angeles",
                        "America/Phoenix",
                        "America/Anchorage",
                        "Pacific/Honolulu",
                        "UTC",
                      ].map((z) => (
                        <option key={z} value={z} />
                      ))}
                    </datalist>
                  </label>
                  <p className="help">
                    Use an IANA timezone, such as America/New_York. Confirm
                    carefully before changing it.
                  </p>
                </>
              )}
              <DraftReset reset={clear} />
            </Form>
          </div>
        )}
      </EditorDialog>
    </div>
  );
}
