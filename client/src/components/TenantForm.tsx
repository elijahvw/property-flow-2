import { TenantInvitation } from "./TenantInvitation";
import { Address } from "./Address";
import { useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { Form } from "../pages/Workspace";
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
const groups = [
  {
    title: "Tenant contact",
    help: "Enter the full name and sign-in email. Saving creates or reuses one Auth0 account and saves tenant details. Portal access is managed separately.",
    fields: [
      ["name", "Full name", 200],
      ["preferredName", "Preferred name", 200],
      ["email", "Contact email", 254],
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
export function TenantForm({
  value,
  saved,
  cancel,
  inviteInitially = false,
}: {
  inviteInitially?: boolean;
  value?: TenantContact;
  saved: (row: TenantContact) => void;
  cancel?: () => void;
}) {
  const { data: auth, can } = useAuth(),
    storageKey = `pf:tenant-draft:${auth?.user.id}:${auth?.membership?.companyId}:${value?.id ?? "new"}`;
  const [initial] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || "null") as {
        draft: Draft;
        key: string;
        review?: Draft;
        pending?: boolean;
        baseVersion?: number;
      } | null;
    } catch {
      return null;
    }
  });
  const [created, setCreated] = useState<TenantContact | null>(null);
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
  const remember = (
    next: Draft,
    reviewed: Draft | null = review,
    uncertain = pending,
  ) =>
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        draft: next,
        key,
        review: reviewed,
        pending: uncertain,
        baseVersion,
      }),
    );
  const finish = (row: TenantContact) => {
    setCreated(null);
    setDraft({ invitePortal: inviteInitially ? "yes" : "no" });
    setReview(null);
    setPending(false);
    setKey(crypto.randomUUID());
    saved(row);
  };
  const clear = () => {
    sessionStorage.removeItem(storageKey);
    setDraft(
      Object.fromEntries(
        Object.entries(value || {}).filter(([, v]) => typeof v === "string"),
      ) as Draft,
    );
    setReview(null);
    setPending(false);
    setDuplicate(false);
    setKey(crypto.randomUUID());
    cancel?.();
  };
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
      {review && (
        <Form
          label={value ? "Save tenant details" : "Save tenant"}
          operation="membership.update"
          feedbackText={
            value
              ? "Tenant details saved."
              : "Tenant saved. You can record a lease now."
          }
          submit={async (f) => {
            remember(review, review, true);
            setPending(true);
            try {
              const row = await api<TenantContact>(
                value
                  ? `/api/company/resident-contacts/${encodeURIComponent(value.id)}`
                  : "/api/company/resident-contacts",
                {
                  method: value ? "PATCH" : "POST",
                  body: {
                    ...Object.fromEntries(
                      Object.entries(review).filter(
                        ([name]) => name !== "invitePortal",
                      ),
                    ),
                    ...(value
                      ? { expectedVersion: baseVersion, status: value.status }
                      : {
                          submissionKey: key,
                          duplicateReviewed:
                            f.get("duplicateReviewed") === "on",
                        }),
                  },
                },
              );
              sessionStorage.removeItem(storageKey);
              if (!value && review.invitePortal === "yes") setCreated(row);
              else finish(row);
            } catch (e) {
              if (
                e instanceof ApiError &&
                [400, 403, 404, 409].includes(e.status)
              ) {
                setPending(false);
                remember(review, review, false);
                if (e.code === "POSSIBLE_DUPLICATE") setDuplicate(true);
              }
              throw e;
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
          <p className="help">
            Confirm the person and contact details before saving. The Auth0 account and tenant details are saved first; portal access is optional.
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
                ? "Next: review portal access and create an invitation link."
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
          {pending && (
            <p className="notice" role="status">
              A previous save may have succeeded. Retry keeps the same details
              and submission identity.
            </p>
          )}
        </Form>
      )}
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
        <Form
          key={key}
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
                      {label}
                      {name === "name" ? " *" : ""}
                      <input
                        name={name}
                        type={
                          name === "email"
                            ? "email"
                            : name.toLowerCase().includes("phone")
                              ? "tel"
                              : "text"
                        }
                        maxLength={max}
                        required={
                          name === "name" ||
                          (name === "email" &&
                            (!value || draft.invitePortal === "yes" ||
                              draft.preferredContact === "email")) ||
                          (name === "phone" &&
                            draft.preferredContact === "phone") ||
                          (name === "emergencyContactName" &&
                            !!(
                              draft.emergencyContactPhone ||
                              draft.emergencyRelationship
                            ))
                        }
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
            return index === 1 ? (
              <details
                key={group.title}
                className="editor-section"
                open={!!(initial?.draft.addressLine1 || value?.addressLine1)}
              >
                <summary>Mailing address · optional</summary>
                {content}
              </details>
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
              <label>
                Portal invitation
                <select
                  name="invitePortal"
                  defaultValue={draft.invitePortal || "no"}
                  disabled={!can("members.manage")}
                >
                  <option value="no">No · save the account without portal access</option>
                  <option value="yes">
                    Yes · review access and create an invitation link
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
        </Form>
      </div>
    </div>
  );
}
