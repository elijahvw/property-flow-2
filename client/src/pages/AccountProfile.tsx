import { Link } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { api } from "../api";
import { Form } from "../components/Form";
import { EditorDialog } from "../components/EditorDialog";
import { Address } from "../components/Address";
import { DraftReset } from "../components/DraftReset";
import { formatDate } from "../dates";
import "./AccountProfile.css";
export type Profile = {
  name: string | null;
  email: string;
  emailVerified: boolean;
  version: number;
  nameVersion: string;
  companyId: string | null;
  contactVersion: number | null;
  contactEmail: string | null;
  sharedWithManagement: boolean;
  details: Record<string, string | null>;
  updatedAt: string | null;
  assignments: {
    id: string;
    startsOn: string;
    endsOn: string | null;
    property: { name: string; address: string };
    unit: { label: string };
  }[];
};
const labels: Record<string, string> = {
  preferredName: "Preferred name",
  phone: "Primary phone",
  alternatePhone: "Alternate phone",
  preferredContact: "Contact preference",
  addressLine1: "Street address",
  addressLine2: "Apartment / suite",
  city: "City",
  region: "State / region",
  postalCode: "Postal code",
  country: "Country",
  emergencyContactName: "Emergency contact name",
  emergencyContactPhone: "Emergency contact phone",
  emergencyRelationship: "Relationship",
};
type Review = {
  body: Record<string, unknown>;
  changes?: [string, string, string][];
  attempted?: boolean;
};
function retained(key: string): Review | null {
  try {
    const r = JSON.parse(sessionStorage.getItem(key) || "null");
    return r && r.body && typeof r.body.submissionKey === "string" ? r : null;
  } catch {
    return null;
  }
}
export function AccountProfile() {
  const { data } = useAuth();
  return (
    <PersonalProfile key={`${data?.user.id}:${data?.membership?.companyId}`} />
  );
}
function PersonalProfile() {
  const { data: auth, refreshUser } = useAuth(),
    r = useResource<Profile>("/api/account", false, true),
    key = `pf:profile:${auth?.user.id}:${auth?.membership?.companyId}`;
  const [section, setSection] = useState("personal"),
    [editing, setEditing] = useState("personal");
  const [draft, setDraft] = useState<Profile | null>(null),
    [review, setReview] = useState<Review | null>(() => retained(key)),
    [open, setOpen] = useState(false);
  const p = r.data,
    isResident = auth?.membership?.role === "resident",
    isOwner = auth?.membership?.role === "owner",
    roleLabel =
      (
        {
          owner: "Company owner",
          manager: "Manager",
          staff: "Staff",
          resident: "Resident",
        } as Record<string, string>
      )[auth?.membership?.role || ""] || "Not assigned";
  const clear = () => {
    sessionStorage.removeItem(key);
    setReview(null);
    setDraft(null);
    setOpen(false);
  };
  return (
    <div className="profile-page">
      <header className="page-heading">
        <p className="record-kicker">Account</p>
        <h1>My profile</h1>
        <p>Keep your contact details current and see where you’re connected.</p>
      </header>
      {r.error && (
        <p className="notice error" role="alert">
          {r.error}{" "}
          <button className="secondary" onClick={r.reload}>
            Refresh profile
          </button>
        </p>
      )}
      {!p && !r.error && <p role="status">Loading your profile…</p>}
      {p && (
        <>
          <div className="account-identity-card">
            <div className="account-monogram" aria-hidden="true">
              {(p.details.preferredName || p.name || p.email)
                .trim()
                .slice(0, 1)}
            </div>
            <div>
              <h2>{p.details.preferredName || p.name || "Your profile"}</h2>
              <p>{p.email}</p>
            </div>
            <span className="tenant-status">
              {p.emailVerified ? "Verified" : "Verify email"}
            </span>
          </div>
          <nav className="profile-tabs" aria-label="Profile sections">
            {[
              ["personal", "Personal"],
              ["contact", "Contact"],
              ["address", "Mailing address"],
              ["emergency", "Emergency contact"],
              [
                "access",
                isResident
                  ? "Home & access"
                  : auth?.membership
                    ? "Company & access"
                    : "Account access",
              ],
            ].map(([id, label]) => (
              <button
                key={id}
                className="profile-tab"
                aria-current={section === id ? "page" : undefined}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <section className="panel account-content-card">
            <div className="section-heading">
              <div>
                <h2>
                  {
                    {
                      personal: "Personal details",
                      contact: "Contact details",
                      address: "Mailing address",
                      emergency: "Emergency contact",
                      access: isResident
                        ? "Your home & access"
                        : auth?.membership
                          ? "Company & access"
                          : "Account access",
                    }[section]
                  }
                </h2>
                <p>
                  {section === "access"
                    ? isResident
                      ? "Your property team manages assignments and access."
                      : isOwner
                        ? "You manage this company’s details, team and properties."
                        : "Your sign-in identity and workspace role."
                    : p.sharedWithManagement && section !== "personal"
                      ? "Shared with your property management team."
                      : "Keep your personal account information up to date."}
                </p>
              </div>
              {section !== "access" && (
                <button
                  className="secondary"
                  onClick={() => {
                    if (!draft) setEditing(section);
                    setDraft((previous) => previous || p);
                    setOpen(true);
                  }}
                >
                  {draft
                    ? "Continue editing"
                    : `Edit ${section === "emergency" ? "emergency contact" : section === "address" ? "mailing address" : section === "contact" ? "contact details" : "personal details"}`}
                </button>
              )}
            </div>
            {section === "personal" && (
              <>
                <dl className="profile-facts">
                  <div>
                    <dt>Display name</dt>
                    <dd>{p.name || "—"}</dd>
                  </div>
                  <div>
                    <dt>Preferred name</dt>
                    <dd>{p.details.preferredName || "—"}</dd>
                  </div>
                </dl>
                <p className="help">
                  Your display name is for your account.
                  {isResident &&
                    " Management maintains the tenant name used in lease records."}
                </p>
              </>
            )}
            {section === "contact" && (
              <dl className="profile-facts">
                <div>
                  <dt>Primary phone</dt>
                  <dd>{p.details.phone || "—"}</dd>
                </div>
                <div>
                  <dt>Alternate phone</dt>
                  <dd>{p.details.alternatePhone || "—"}</dd>
                </div>
                <div>
                  <dt>Contact email</dt>
                  <dd>{p.contactEmail || "—"}</dd>
                </div>
                <div>
                  <dt>Contact preference</dt>
                  <dd>
                    {p.details.preferredContact === "email"
                      ? "Email"
                      : p.details.preferredContact === "phone"
                        ? "Primary phone"
                        : "No preference"}
                  </dd>
                </div>
              </dl>
            )}
            {section === "address" && (
              <div className="account-address-block">
                {p.details.addressLine1 || p.details.city ? (
                  <Address
                    street={p.details.addressLine1}
                    line2={p.details.addressLine2}
                    city={p.details.city}
                    region={p.details.region}
                    postalCode={p.details.postalCode}
                    country={p.details.country}
                  />
                ) : (
                  <div className="account-empty">
                    <h3>No mailing address yet</h3>
                    <p>
                      Add the address where you receive mail. This does not
                      change your assigned home.
                    </p>
                  </div>
                )}
              </div>
            )}
            {section === "emergency" && (
              <>
                {p.details.emergencyContactName ? (
                  <dl className="profile-facts">
                    <div>
                      <dt>Name</dt>
                      <dd>{p.details.emergencyContactName}</dd>
                    </div>
                    <div>
                      <dt>Relationship</dt>
                      <dd>{p.details.emergencyRelationship || "—"}</dd>
                    </div>
                    <div>
                      <dt>Phone</dt>
                      <dd>{p.details.emergencyContactPhone || "—"}</dd>
                    </div>
                  </dl>
                ) : (
                  <div className="account-empty">
                    <h3>No emergency contact yet</h3>
                    <p>
                      {isResident
                        ? "Add someone management can contact in an emergency."
                        : "Keep someone to contact in an emergency on your personal profile."}
                    </p>
                  </div>
                )}
                <p className="help">
                  {isResident
                    ? "An emergency contact has no household membership or portal access."
                    : "Adding an emergency contact does not create a user account or grant company access."}
                </p>
              </>
            )}
            {section === "access" && (
              <>
                <dl className="profile-facts">
                  <div>
                    <dt>Sign-in email</dt>
                    <dd>
                      {p.email}
                      <span className="section-caption">
                        {p.emailVerified ? "Verified" : "Verification needed"}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Company</dt>
                    <dd>{auth?.membership?.company.name || "Not assigned"}</dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>
                      {auth?.user.platformRole === "owner"
                        ? `Platform owner${auth.membership ? ` · ${roleLabel}` : ""}`
                        : roleLabel}
                    </dd>
                  </div>
                </dl>
                {auth?.membership?.role === "resident" && (
                  <div className="profile-emergency">
                    <h3>Your home</h3>
                    {p.assignments.length ? (
                      p.assignments.map((a) => (
                        <div className="profile-home" key={a.id}>
                          <strong>
                            {a.property.name} · {a.unit.label}
                          </strong>
                          <p>{a.property.address}</p>
                          <p className="section-caption">
                            {formatDate(a.startsOn)} —{" "}
                            {formatDate(a.endsOn, "Open ended")}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p>No current or upcoming home is available to show.</p>
                    )}
                    <p className="account-hint">
                      Contact management to correct your unit, household or
                      lease. These assignments cannot be changed from your
                      profile.
                    </p>
                  </div>
                )}
                <p className="help">
                  Sign-in email is managed by your identity provider.
                  {isResident
                    ? " Your property team manages your unit, lease and access."
                    : isOwner
                      ? " You can manage company details and your team from this workspace."
                      : auth?.user.platformRole === "owner"
                        ? " Manage companies and users from platform administration."
                        : " Company owners manage workspace roles and access."}
                </p>
                {isOwner && (
                  <div className="actions">
                    <Link className="button secondary" to="/company/settings">
                      Manage company details
                    </Link>
                    <Link className="button secondary" to="/company/members">
                      Manage team
                    </Link>
                    <Link to="/company/settings?section=roles">
                      Roles & permissions →
                    </Link>
                  </div>
                )}
                {!auth?.membership && auth?.user.platformRole === "owner" && (
                  <Link to="/platform/companies">
                    Open platform administration →
                  </Link>
                )}
              </>
            )}
            {p.updatedAt && (
              <footer className="account-card-footer">
                Updated {formatDate(p.updatedAt)}
                <span>Profile version {p.version}</span>
              </footer>
            )}
          </section>
        </>
      )}
      {review && (
        <div className="notice movement-pending">
          <span>An unfinished profile save is retained.</span>
          <button className="secondary" onClick={() => setOpen(true)}>
            Resume profile review
          </button>
          <DraftReset reset={clear} />
        </div>
      )}
      <EditorDialog
        open={open}
        title={
          review
            ? "Review profile changes"
            : `Edit ${editing === "address" ? "mailing address" : editing === "emergency" ? "emergency contact" : editing === "contact" ? "contact details" : "personal details"}`
        }
        onClose={() => setOpen(false)}
      >
        {review ? (
          <>
            <p>Review the details that will change.</p>
            <dl className="profile-facts profile-review">
              {(
                review.changes ||
                Object.entries({ name: "Display name", ...labels }).map(
                  ([k]) =>
                    [k, "", String(review.body[k] || "")] as [
                      string,
                      string,
                      string,
                    ],
                )
              ).map(([k, old, next]) => (
                <div key={k}>
                  <dt>{k === "name" ? "Display name" : labels[k]}</dt>
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
              label="Save my profile"
              feedbackText="Your profile was saved."
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
                    Back to profile details
                  </button>
                ) : undefined
              }
              submit={async () => {
                const attempt = { ...review, attempted: true };
                sessionStorage.setItem(key, JSON.stringify(attempt));
                setReview(attempt);
                await api("/api/account", {
                  method: "PATCH",
                  body: attempt.body,
                });
                clear();
                r.reload();
                await refreshUser();
              }}
            >
              <p className="help">
                {p?.sharedWithManagement
                  ? "Contact, mailing and emergency details update your linked tenant profile for management. Your recorded tenant name, unit, lease and access stay under management control."
                  : "This updates your personal account details."}{" "}
                Retry an interrupted save using this same review.
              </p>
              <DraftReset reset={clear} />
            </Form>
          </>
        ) : null}
        {draft && (
          <div hidden={!!review}>
            <Form
              label="Review profile changes"
              successText="Ready to review."
              submit={async (form) => {
                const values = {
                  name: form.has("name")
                    ? String(form.get("name"))
                    : draft.name,
                  ...Object.fromEntries(
                    Object.keys(labels).map((k) => [
                      k,
                      form.has(k)
                        ? form.get(k) || null
                        : (draft.details[k] ?? null),
                    ]),
                  ),
                };
                const changes = Object.keys(values)
                  .filter(
                    (k) =>
                      String(values[k as keyof typeof values] || "") !==
                      String(
                        (k === "name" ? draft.name : draft.details[k]) || "",
                      ),
                  )
                  .map(
                    (k) =>
                      [
                        k,
                        String(
                          (k === "name" ? draft.name : draft.details[k]) || "",
                        ),
                        String(values[k as keyof typeof values] || ""),
                      ] as [string, string, string],
                  );
                if (!changes.length)
                  throw new Error("Change a detail before reviewing.");
                const body = {
                  ...values,
                  expectedVersion: draft.version,
                  expectedNameVersion: draft.nameVersion,
                  expectedContactVersion: draft.contactVersion,
                  expectedCompanyId: draft.companyId,
                  submissionKey: crypto.randomUUID(),
                };
                const next = { body, changes };
                sessionStorage.setItem(key, JSON.stringify(next));
                setReview(next);
              }}
            >
              <fieldset
                className="form-section"
                hidden={editing !== "personal" && !!draft.name}
                disabled={editing !== "personal" && !!draft.name}
              >
                <legend>About you</legend>
                <div className="profile-fields">
                  <label>
                    Display name
                    <input
                      name="name"
                      defaultValue={draft.name || ""}
                      required
                      maxLength={200}
                      autoComplete="name"
                    />
                  </label>
                  <label>
                    Preferred name · optional
                    <input
                      name="preferredName"
                      defaultValue={draft.details.preferredName || ""}
                      maxLength={200}
                      autoComplete="nickname"
                    />
                  </label>
                </div>
                <p className="help">
                  Your display name is for your account.
                  {isResident &&
                    " Management maintains the tenant name used in lease records."}
                </p>
              </fieldset>
              <fieldset
                className="form-section"
                hidden={editing !== "contact"}
                disabled={editing !== "contact"}
              >
                <legend>Contact details</legend>
                <div className="profile-fields">
                  <label>
                    Primary phone
                    <input
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      maxLength={40}
                      defaultValue={draft.details.phone || ""}
                    />
                  </label>
                  <label>
                    Alternate phone
                    <input
                      name="alternatePhone"
                      type="tel"
                      maxLength={40}
                      defaultValue={draft.details.alternatePhone || ""}
                    />
                  </label>
                  <label>
                    Contact preference
                    <select
                      name="preferredContact"
                      defaultValue={draft.details.preferredContact || ""}
                    >
                      <option value="">No preference</option>
                      <option value="email" disabled={!draft.contactEmail}>
                        Email
                      </option>
                      <option value="phone">Primary phone</option>
                    </select>
                  </label>
                  <div>
                    <span className="section-caption">Contact email</span>
                    <p>{draft.contactEmail || "Not supplied"}</p>
                    {draft.sharedWithManagement && (
                      <p className="help">
                        Ask management to update this contact email.
                      </p>
                    )}
                  </div>
                </div>
              </fieldset>
              <fieldset
                className="form-section"
                hidden={editing !== "address"}
                disabled={editing !== "address"}
              >
                <legend>Mailing address · optional</legend>
                <PersonalAddressFields value={draft.details} />
                <p className="help">
                  A mailing address is a contact detail. It does not change your
                  assigned unit or lease.
                </p>
              </fieldset>
              <fieldset
                className="form-section"
                hidden={editing !== "emergency"}
                disabled={editing !== "emergency"}
              >
                <legend>Emergency contact · optional</legend>
                <div className="profile-fields">
                  <label>
                    Emergency contact name
                    <input
                      name="emergencyContactName"
                      defaultValue={draft.details.emergencyContactName || ""}
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Relationship
                    <input
                      name="emergencyRelationship"
                      defaultValue={draft.details.emergencyRelationship || ""}
                      maxLength={100}
                    />
                  </label>
                  <label>
                    Emergency contact phone
                    <input
                      name="emergencyContactPhone"
                      type="tel"
                      defaultValue={draft.details.emergencyContactPhone || ""}
                      maxLength={40}
                    />
                  </label>
                </div>
                <p className="help">
                  Provide a name when recording a phone number or relationship.
                </p>
              </fieldset>
              <DraftReset reset={clear} />
            </Form>
          </div>
        )}
      </EditorDialog>
    </div>
  );
}
export function PersonalAddressFields({
  value = {},
  required = false,
}: {
  value?: Record<string, string | null>;
  required?: boolean;
}) {
  return (
    <>
      <label>
        Street address
        <input
          name="addressLine1"
          maxLength={200}
          autoComplete="address-line1"
          required={required}
          defaultValue={value.addressLine1 || ""}
        />
      </label>
      <label>
        Apartment / suite · optional
        <input
          name="addressLine2"
          maxLength={200}
          autoComplete="address-line2"
          defaultValue={value.addressLine2 || ""}
        />
      </label>
      <div className="address-fields">
        <label className="address-city">
          City
          <input
            name="city"
            maxLength={100}
            autoComplete="address-level2"
            required={required}
            defaultValue={value.city || ""}
          />
        </label>
        <label>
          State / region
          <input
            name="region"
            maxLength={100}
            autoComplete="address-level1"
            defaultValue={value.region || ""}
          />
        </label>
        <label>
          Postal code
          <input
            name="postalCode"
            maxLength={30}
            autoComplete="postal-code"
            defaultValue={value.postalCode || ""}
          />
        </label>
      </div>
      <label>
        Country
        <input
          name="country"
          maxLength={100}
          autoComplete="country-name"
          required={required}
          defaultValue={value.country || ""}
        />
      </label>
    </>
  );
}
