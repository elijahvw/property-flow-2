import { TenantInvitation } from "./TenantInvitation";
import { Address } from "./Address";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { Form } from "./Form";
import { useEditorBusy } from "./EditorDialog";
import { hasTenantSaveRecovery, tenantEditorScope, tenantLeasingWriteBlock, tenantPortalAvailabilityNote, tenantSaveStorageKey, useTenantAttemptContext } from "../tenant-write-access";
import { prospectContext } from "../prospect-context";
import "./LandlordForms.css";
export type TenantContact = {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  version: number;
  preferredName?: string | null;
  alternatePhone?: string | null;
  preferredContact?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyRelationship?: string | null;
  managementNotes?: string | null;
};
type Draft = Record<string, string>;
type TenantAttempt = Record<string, unknown>;
function tenantReadDenied(error: unknown, editing: boolean) {
  return error instanceof ApiError && (error.status === 401 || (editing && error.status === 404) ||
    (error.status === 403 && ["ACCESS_DENIED", "COMPANY_ACCESS_DENIED", "FEATURE_DISABLED", "IMPERSONATION_UNAVAILABLE", "EMAIL_VERIFICATION_REQUIRED"].includes(error.code)));
}
const groups = [
  {
    title: "Tenant contact",
    help: "Enter the full name and sign-in email. Saving creates or reuses one sign-in account and saves tenant details. Portal access is managed separately.",
    fields: [
      ["name", "Full name", 200],
      ["email", "Contact email", 254],
      ["preferredName", "Preferred name", 200],
      ["phone", "Primary phone", 40],
      ["alternatePhone", "Alternate phone", 40],
    ],
  },
  {
    title: "Mailing address",
    help: "Optional. Use the address where this tenant currently receives correspondence.",
    fields: [
      ["addressLine1", "Address line 1", 200],
      ["addressLine2", "Address line 2", 200],
      ["city", "City", 100],
      ["region", "State / region", 100],
      ["postalCode", "Postal code", 30],
      ["country", "Country", 100],
    ],
  },
  {
    title: "Emergency contact",
    help: "Optional. An emergency contact is separate from a resident or leaseholder and receives no portal access.",
    fields: [
      ["emergencyContactName", "Emergency contact name", 200],
      ["emergencyRelationship", "Relationship to tenant", 100],
      ["emergencyContactPhone", "Emergency contact phone", 40],
    ],
  },
] as const;
const comparisonFields = groups.flatMap(group => group.fields as readonly (readonly [string, string, number])[]);
const recoveryFields = [...comparisonFields, ["preferredContact", "Preferred contact", 100] as const,
  ["managementNotes", "Management notes", 2000] as const, ["status", "Tenant record status", 100] as const];
type TenantFormProps = {
  inviteInitially?: boolean;
  value?: TenantContact;
  saved: (row: TenantContact) => void;
  cancel?: () => void;
};
function OptionalTenantSection({ title, initialOpen, children }: { title: string; initialOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  return <details className="editor-section" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{title} · optional</summary>{children}
  </details>;
}
export function TenantForm(props: TenantFormProps) {
  const { data } = useAuth();
  return <TenantFormWorkspace key={`${props.value?.id || "new"}:${tenantEditorScope(data)}`} {...props}/>;
}
function TenantFormWorkspace({
  value,
  saved,
  cancel,
  inviteInitially = false,
}: TenantFormProps) {
  const editor = useEditorBusy();
  const { data: auth, can, refreshUser } = useAuth(),
    storageKey = tenantSaveStorageKey(auth, value?.id);
  const [params] = useSearchParams();
  const writeBlock = tenantLeasingWriteBlock(auth?.companyFeatures);
  const portalNote = tenantPortalAvailabilityNote(auth?.companyFeatures);
  const [initial] = useState(() => {
    try {
      const retained = JSON.parse(sessionStorage.getItem(storageKey) || "null") as {
        draft: Draft;
        key: string;
        review?: Draft;
        pending?: boolean;
        baseVersion?: number;
        payload?: TenantAttempt;
        companyId?: string;
      } | null;
      return retained?.pending ? retained : null;
    } catch {
      return null;
    }
  });
  const context = useTenantAttemptContext(auth, initial?.companyId);
  const [created, setCreated] = useState<TenantContact | null>(null);
  const [attempt, setAttempt] = useState<TenantAttempt | null>(initial?.payload || null);
  const [baseVersion] = useState(initial?.baseVersion ?? value?.version);
  const [key, setKey] = useState(initial?.key || crypto.randomUUID());
  const [draft, setDraft] = useState<Draft>(
    initial?.draft || {
      invitePortal: inviteInitially ? "yes" : "no",
      ...(Object.fromEntries(
        Object.entries(value || {}).filter(([, v]) => typeof v === "string"),
      ) as Draft),
    },
  );
  const [review, setReview] = useState<Draft | null>(initial?.review || null),
    [pending, setPending] = useState(initial?.pending || false),
    [duplicate, setDuplicate] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<TenantContact | null>(null),
    [checkingCurrent, setCheckingCurrent] = useState(false),
    [currentError, setCurrentError] = useState(""),
    [acceptCurrent, setAcceptCurrent] = useState(false),
    [submitting, setSubmitting] = useState(false),
    [recoveryAccessDenied, setRecoveryAccessDenied] = useState(false),
    [rejectedDetails, setRejectedDetails] = useState(false),
    [comparisonStarted, setComparisonStarted] = useState(false),
    [originalOpen, setOriginalOpen] = useState(true),
    [recoveringDuplicate, setRecoveringDuplicate] = useState(false),
    [separatePersonConfirmed, setSeparatePersonConfirmed] = useState(false);
  const matchingTenants = (search: string, archived: boolean) => `/company/residents?${new URLSearchParams({
    ...prospectContext(params), q: search.slice(0, 200), ...(archived ? { records: "archived" } : {}),
  })}`;
  const recoveryName = String(attempt?.name ?? review?.name ?? ""), recoveryEmail = String(attempt?.email ?? review?.email ?? "");
  const comparison = currentRecord ? recoveryFields.map(([name, label]) => {
    const proposed = attempt && Object.prototype.hasOwnProperty.call(attempt, name) ? attempt[name]
      : name === "status" ? value?.status : review?.[name];
    return { name, label, current: String(currentRecord[name as keyof TenantContact] ?? ""), proposed: String(proposed ?? ""),
      submitted: Object.prototype.hasOwnProperty.call(attempt || review || {}, name) || (!attempt && name === "status" && !!value) };
  }) : [];
  const differences = comparison.filter(field => field.submitted && field.current !== field.proposed);
  const compareFields = (fields: typeof comparison) => <dl className="lease-review-summary">
    {fields.map(field => <div key={field.name}><dt>{field.label}</dt><dd><strong>Current saved:</strong> {field.current || "Not supplied"}<br/><strong>{field.name === "status" ? "Original reviewed:" : "Your proposed:"}</strong> {field.proposed || "Not supplied"}</dd></div>)}
  </dl>;
  const fieldRequired = (name: string) => name === "name" ||
    (name === "email" && (!value || draft.invitePortal === "yes" || draft.preferredContact === "email")) ||
    (name === "phone" && draft.preferredContact === "phone") ||
    (name === "emergencyContactName" && !!(draft.emergencyContactPhone || draft.emergencyRelationship));
  const remember = (
    next: Draft,
    reviewed: Draft | null = review,
    uncertain = pending,
    payload = attempt,
  ) => {
    if (!uncertain) { sessionStorage.removeItem(storageKey); return; }
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        draft: next,
        key,
        review: reviewed,
        pending: uncertain,
        baseVersion,
        payload,
        companyId: context.companyId,
      }),
    );
  };
  const finish = (row: TenantContact) => {
    if (!context.current()) return;
    setCreated(null);
    setDraft({ invitePortal: inviteInitially ? "yes" : "no" });
    setReview(null);
    setPending(false);
    setAttempt(null);
    setCurrentRecord(null);
    setAcceptCurrent(false);
    setRejectedDetails(false);
    setComparisonStarted(false);
    setOriginalOpen(true);
    setRecoveringDuplicate(false);
    setSeparatePersonConfirmed(false);
    setKey(crypto.randomUUID());
    saved(row);
  };
  const clear = () => {
    if (pending) return;
    sessionStorage.removeItem(storageKey);
    setDraft(
      Object.fromEntries(
        Object.entries(value || {}).filter(([, v]) => typeof v === "string"),
      ) as Draft,
    );
    setReview(null);
    setPending(false);
    setAttempt(null);
    setDuplicate(false);
    setComparisonStarted(false);
    setOriginalOpen(true);
    setRecoveringDuplicate(false);
    setSeparatePersonConfirmed(false);
    setKey(crypto.randomUUID());
    cancel?.();
  };
  if (recoveryAccessDenied) return <div className="notice error" role="alert">
    <p>Tenant access is unavailable. {pending ? "The original interrupted request is kept for recovery; its private details are hidden." : "Your draft is hidden until access is confirmed."}</p>
    <button type="button" className="secondary" disabled={checkingCurrent} onClick={async () => {
      setCheckingCurrent(true);
      try {
        await refreshUser();
        if (!context.current()) return;
        if (value) {
          const current = await api<TenantContact>(`/api/company/resident-contacts/${encodeURIComponent(value.id)}`, { expectedCompanyId: context.companyId });
          if (current.id !== value.id) return;
        } else {
          const directory = await api<{ companyId: string }>("/api/company/resident-profiles/directory", { expectedCompanyId: context.companyId });
          if (directory.companyId !== context.companyId) return;
        }
        if (context.current()) setRecoveryAccessDenied(false);
      } catch { /* Keep the private edit hidden until a fresh authorized read succeeds. */ }
      finally { setCheckingCurrent(false); }
    }}>{checkingCurrent ? "Reloading workspace…" : "Reload workspace"}</button>
  </div>;
  if (created)
    return (
      <div>
        <p className="notice" role="status">
          Account created. Their tenant details are saved even if you finish the
          invitation later.
        </p>
        <TenantInvitation contactId={created.id} done={() => finish(created)} />
        <button
          type="button"
          className="secondary"
          onClick={() => finish(created)}
        >
          Continue to tenant record
        </button>
      </div>
    );
  return (
    <div className="tenant-form">
      <ol className="lease-setup-progress" aria-label="Tenant setup progress">
        <li aria-current={!review ? "step" : undefined}>1. Contact details</li>
        <li aria-current={review ? "step" : undefined}>2. Review & save</li>
        {!value && <li>3. Optional portal invitation</li>}
      </ol>
      {writeBlock && <p className="notice" role="status">{writeBlock}</p>}
      {review && (
        <details className={comparisonStarted ? "editor-section" : undefined} open={originalOpen} onToggle={event => setOriginalOpen(event.currentTarget.open)}>
        <summary hidden={!comparisonStarted}>Original interrupted edit and retry</summary>
        <fieldset disabled={!!writeBlock} className="editor-contents"><Form
          recovering={pending}
          label={value ? "Save tenant details" : "Save tenant"}
          operation="membership.update"
          feedbackText={
            value
              ? "Tenant details saved."
              : "Tenant saved. You can record a lease now."
          }
          submit={async (f) => {
            if (!context.current()) throw new ApiError("Your company or account context changed. Reload the workspace before continuing this tenant save.", 409, "TENANT_CONTEXT_CHANGED", pending);
            if (writeBlock) throw new Error(writeBlock);
            const wasRecovering = pending || hasTenantSaveRecovery(auth, value?.id);
            const payload: TenantAttempt = attempt || {
              ...Object.fromEntries(Object.entries(review).filter(([name]) => name !== "invitePortal")),
              ...(value
                ? { expectedVersion: baseVersion, status: value.status }
                : { submissionKey: key, duplicateReviewed: f.get("duplicateReviewed") === "on" }),
            };
            setAttempt(payload);
            remember(review, review, true, payload);
            setPending(true);
            setSubmitting(true);
            setRejectedDetails(false);
            try {
              const row = await api<TenantContact>(
                value
                  ? `/api/company/resident-contacts/${encodeURIComponent(value.id)}`
                  : "/api/company/resident-contacts",
                {
                  method: value ? "PATCH" : "POST",
                  body: payload,
                  expectedCompanyId: context.companyId,
                },
              );
              if (!context.current()) throw new ApiError("Your company or account context changed before the result was acknowledged. The original tenant save is kept for recovery.", 409, "TENANT_CONTEXT_CHANGED", true);
              sessionStorage.removeItem(storageKey);
              editor.completed();
              if (!value && review.invitePortal === "yes") setCreated(row);
              else finish(row);
            } catch (e) {
              if (tenantReadDenied(e, !!value)) {
                setRecoveryAccessDenied(true);
                void refreshUser();
              }
              if (wasRecovering && !value && e instanceof ApiError && e.status === 409 && e.code === "POSSIBLE_DUPLICATE" && payload.duplicateReviewed !== true) {
                setRecoveringDuplicate(true);
                setSeparatePersonConfirmed(false);
              }
              if (
                !wasRecovering && e instanceof ApiError && !e.submissionUncertain &&
                !["IMPERSONATION_CONTEXT_CHANGED", "SUBMISSION_MISMATCH"].includes(e.code) &&
                [400, 403, 404, 409].includes(e.status)
              ) {
                setPending(false);
                setAttempt(null);
                remember(review, review, false);
                setRejectedDetails(true);
                if (e.code === "POSSIBLE_DUPLICATE") setDuplicate(true);
              }
              if (e instanceof ApiError && ["IMPERSONATION_CONTEXT_CHANGED", "SUBMISSION_MISMATCH"].includes(e.code)) e.submissionUncertain = true;
              throw e;
            } finally {
              setSubmitting(false);
            }
          }}
          secondaryActions={
            !pending ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setReview(null);
                  remember(draft, null, false);
                }}
              >
                Back to contact details
              </button>
            ) : undefined
          }
        >
          <h3>Review tenant details</h3>
          {rejectedDetails && <p className="help">The tenant details were rejected. Review the response before correcting them.</p>}
          <p className="help">
            Confirm the person and contact details before saving. The sign-in account and tenant details are saved first; portal access is optional.
          </p>
          <dl className="lease-review-summary">
            <div>
              <dt>Full name</dt>
              <dd>{review.name}</dd>
            </div>
            <div>
              <dt>Contact email</dt>
              <dd>{review.email || "Not supplied"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{review.phone || "Not supplied"}</dd>
            </div>
            <div>
              <dt>Contact preference</dt>
              <dd>{review.preferredContact || "No preference"}</dd>
            </div>
            <div>
              <dt>Mailing address</dt>
              <dd>
                <Address
                  street={review.addressLine1}
                  line2={review.addressLine2}
                  city={review.city}
                  region={review.region}
                  postalCode={review.postalCode}
                  country={review.country}
                />
              </dd>
            </div>
            <div>
              <dt>Emergency contact</dt>
              <dd>
                {[
                  review.emergencyContactName,
                  review.emergencyRelationship,
                  review.emergencyContactPhone,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Not supplied"}
              </dd>
            </div>
            <div>
              <dt>Internal notes</dt>
              <dd className="preserve-lines">
                {review.managementNotes || "None"}
              </dd>
            </div>
          </dl>
          {!value && (
            <p className="notice">
              {review.invitePortal === "yes"
                ? "Next: review portal access and send or share an invitation."
                : "Portal access: Not invited. You can invite this tenant later from their profile."}
            </p>
          )}
          {duplicate && (
            <label className="checkbox-label">
              <input name="duplicateReviewed" type="checkbox" required />I
              reviewed the existing tenants and confirm this is a separate
              person. Records and balances will not be merged.
            </label>
          )}
          {pending && !value && attempt?.duplicateReviewed === true && <p className="help">Your confirmation that this is a separate person is kept with the original retry.</p>}
        </Form></fieldset>
        </details>
      )}
      {!value && pending && recoveringDuplicate && attempt?.duplicateReviewed !== true && <section className="editor-section" aria-label="Review separate tenant recovery">
        <h3>Review matching tenants before retrying</h3>
        <p className="help">A tenant with the same name or email exists. Review the active and archived records in separate tabs; this original interrupted save stays here.</p>
        {recoveryName && <p><strong>Name:</strong> {recoveryName}<br/>
          <Link target="_blank" rel="noopener noreferrer" to={matchingTenants(recoveryName, false)}>Active name matches</Link>{" · "}
          <Link target="_blank" rel="noopener noreferrer" to={matchingTenants(recoveryName, true)}>Archived name matches</Link>
        </p>}
        {recoveryEmail && <p><strong>Email:</strong> {recoveryEmail}<br/>
          <Link target="_blank" rel="noopener noreferrer" to={matchingTenants(recoveryEmail, false)}>Active email matches</Link>{" · "}
          <Link target="_blank" rel="noopener noreferrer" to={matchingTenants(recoveryEmail, true)}>Archived email matches</Link>
          {recoveryEmail.length > 200 && <span className="help"> Searches use the first 200 characters of this email.</span>}
        </p>}
        <label className="checkbox-label"><input type="checkbox" checked={separatePersonConfirmed} disabled={submitting || !!writeBlock} onChange={event => { if (!submitting && !writeBlock && context.current()) setSeparatePersonConfirmed(event.target.checked); }}/>I reviewed the existing tenants and confirm this is a separate person. Records and balances will not be merged.</label>
        <p className="help">Confirmation keeps the original person details, company and submission identity. Then retry Save tenant with that same request.</p>
        <button type="button" className="secondary" disabled={!separatePersonConfirmed || submitting || !!writeBlock} onClick={() => {
          if (!separatePersonConfirmed || submitting || writeBlock || !context.current() || !pending || !review || !attempt || attempt.duplicateReviewed === true) return;
          const confirmed = { ...attempt, duplicateReviewed: true };
          remember(draft, review, true, confirmed);
          setAttempt(confirmed);
          setRecoveringDuplicate(false);
          setSeparatePersonConfirmed(false);
        }}>Confirm separate person for original retry</button>
      </section>}
      {value && pending && <section className="editor-section" aria-label="Review current tenant record">
        <h3>{currentRecord ? "Compare saved tenant details" : "Review current tenant record"}</h3>
        {!currentRecord && <p className="help">Review the current saved details before deciding whether to stop retrying your earlier edit. This review makes no changes.</p>}
        <button type="button" className="secondary" disabled={checkingCurrent || submitting} onClick={async () => {
          setComparisonStarted(true);
          setCheckingCurrent(true); setCurrentRecord(null); setCurrentError(""); setAcceptCurrent(false);
          try {
            if (!context.current()) throw new Error("Reload the workspace before reviewing this tenant record.");
            const current = await api<TenantContact>(`/api/company/resident-contacts/${encodeURIComponent(value.id)}`, { expectedCompanyId: context.companyId });
            if (!context.current()) return;
            if (current.id !== value.id) throw new Error("This tenant record changed. Reload the workspace before continuing.");
            setCurrentRecord(current);
            setOriginalOpen(false);
          } catch (error) {
            if (error instanceof ApiError && [401, 403, 404].includes(error.status)) setRecoveryAccessDenied(true);
            setCurrentError(error instanceof Error ? error.message : "The current tenant record is unavailable.");
          }
          finally { setCheckingCurrent(false); }
        }}>{checkingCurrent ? "Loading current tenant record…" : currentRecord ? "Refresh current tenant record" : "Review current tenant record"}</button>
        {currentError && <p role="alert">{currentError} The original interrupted edit is still kept.</p>}
        {currentRecord && <>
          <p className="help">Current saved version {currentRecord.version} · Original reviewed version {String(attempt?.expectedVersion ?? baseVersion)}</p>
          {differences.length ? <><p>{differences.length} submitted {differences.length === 1 ? "field differs" : "fields differ"} from the current saved values.</p>{compareFields(differences)}</> : <p>The proposed tenant fields match the current saved values.</p>}
          <p className="help">This comparison does not confirm who saved the current details.</p>
          <label className="checkbox-label"><input type="checkbox" checked={acceptCurrent} onChange={event => setAcceptCurrent(event.target.checked)}/>I reviewed the current saved details. Stop retrying my earlier edit and use the record as it is.</label>
          <p className="help">This clears only the interrupted edit kept in this browser. It does not save, undo or change any tenant or account details.</p>
          <button type="button" className="secondary" disabled={!acceptCurrent || checkingCurrent || submitting} onClick={() => {
            if (!acceptCurrent || submitting || !context.current()) return;
            sessionStorage.removeItem(storageKey); finish(currentRecord);
          }}>Use current record</button>
          <details className="editor-section"><summary>Review all fields</summary>{compareFields(comparison)}</details>
        </>}
      </section>}
      <div
        hidden={!!review}
        onChange={(e) => {
          const target = e.target;
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement
          ) {
            const next = { ...draft, [target.name]: target.value };
            setDraft(next);
            remember(next, null, false);
          }
        }}
      >
        <fieldset disabled={!!writeBlock} className="editor-contents"><Form
          key={key}
          reviewOnly
          label="Review tenant"
          operation="page.data.load"
          secondaryActions={
            cancel ? (
              <button type="button" className="secondary" onClick={clear}>
                Discard tenant draft
              </button>
            ) : undefined
          }
          submit={async (f) => {
            if (!context.current()) throw new Error("Reload the workspace before reviewing this tenant draft.");
            if (writeBlock) throw new Error(writeBlock);
            const next = Object.fromEntries(f) as Draft;
            setDraft(next);
            setReview(next);
            remember(next, next, false);
          }}
        >
          {value?.userId && (
            <p className="help">
              Contact email is for correspondence. Editing it does not change
              the linked account’s sign-in email.
            </p>
          )}
          {groups.map((group, index) => {
            const content = (
              <fieldset
                className={index === 1 ? "address-section" : "form-section"}
              >
                <legend className={index === 1 ? "sr-only" : undefined}>
                  {group.title}
                </legend>
                <p className="help">{group.help}</p>
                {index === 0 && <p className="required-field-key"><span aria-hidden="true">*</span> Required fields</p>}
                <div className={index === 1 ? "address-fields" : "form-grid"}>
                  {group.fields.map(([name, label, max]) => (
                    <label
                      key={name}
                      className={
                        name.startsWith("addressLine")
                          ? "address-street"
                          : name === "city"
                            ? "address-city"
                            : name === "region"
                              ? "address-region"
                              : name === "postalCode"
                                ? "address-postal"
                                : name === "country"
                                  ? "address-country"
                                  : name === "emergencyContactName"
                                    ? "field-full"
                                    : undefined
                      }
                    >
                      <span>{label}{name === "name" ? " *" : ""}{name !== "name" && fieldRequired(name) && <span className="required-field-mark" aria-hidden="true">*</span>}</span>
                      <input
                        name={name}
                        aria-label={`${label}${name === "name" ? " *" : ""}`}
                        type={
                          name === "email"
                            ? "email"
                            : name.toLowerCase().includes("phone")
                              ? "tel"
                              : "text"
                        }
                        maxLength={max}
                        required={fieldRequired(name)}
                        defaultValue={draft[name] || ""}
                        autoComplete={
                          name === "name"
                            ? "name"
                            : name === "email"
                              ? "email"
                              : name.toLowerCase().includes("phone")
                                ? "tel"
                                : (
                                    {
                                      addressLine1: "address-line1",
                                      addressLine2: "address-line2",
                                      city: "address-level2",
                                      region: "address-level1",
                                      postalCode: "postal-code",
                                      country: "country-name",
                                    } as Record<string, string>
                                  )[name] || "off"
                        }
                      />
                    </label>
                  ))}
                  {index === 0 && (
                    <label>
                      Preferred contact method
                      <select
                        name="preferredContact"
                        defaultValue={draft.preferredContact || ""}
                      >
                        <option value="">No preference</option>
                        <option value="email">Email</option>
                        <option value="phone">Phone</option>
                      </select>
                    </label>
                  )}
                </div>
              </fieldset>
            );
            return index > 0 ? (
              <OptionalTenantSection
                key={group.title}
                title={group.title}
                initialOpen={group.fields.some(([name]) => !!draft[name])}
              >
                {content}
              </OptionalTenantSection>
            ) : (
              <div key={group.title}>{content}</div>
            );
          })}
          {!value && (
            <fieldset className="form-section">
              <legend>Invite to the portal?</legend>
              <p className="help">
                Every tenant gets a profile for your records. Invitation and
                portal access are managed separately.
              </p>
              {portalNote && <p className="help">{portalNote}</p>}
              <label>
                Portal invitation
                <select
                  name="invitePortal"
                  defaultValue={draft.invitePortal || "no"}
                  disabled={!can("members.manage")}
                >
                  <option value="no">No · save the account without portal access</option>
                  <option value="yes">
                    Yes · review access and send or share an invitation
                  </option>
                </select>
              </label>
              {!can("members.manage") && (
                <p className="help">
                  An owner can approve portal invitations after you save the
                  tenant.
                </p>
              )}
            </fieldset>
          )}
          <fieldset className="form-section">
            <legend>Internal notes</legend>
            <label>
              Management notes
              <textarea
                name="managementNotes"
                rows={4}
                maxLength={2000}
                defaultValue={draft.managementNotes || ""}
              />
            </label>
            <p className="help">
              For authorized owners and managers only. Up to 2,000 characters.
            </p>
          </fieldset>
        </Form></fieldset>
      </div>
      {writeBlock && !pending && cancel && <button type="button" className="secondary" onClick={clear}>Discard tenant draft</button>}
    </div>
  );
}
