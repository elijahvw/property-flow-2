import type { FastifySchema } from "fastify";
import { FEATURE_CATALOG } from "../company-features.js";

// Documentation only. The Swagger transform consumes these; runtime handlers,
// validators, response serializers and database authorization remain unchanged.
type S = Record<string, any>;
const o = (properties: Record<string, S>, required = Object.keys(properties), description?: string): S => ({ type: "object", additionalProperties: false, properties, required, ...(description ? { description } : {}) });
const t: S = { type: "string" }, n: S = { type: "integer", minimum: 0 }, b: S = { type: "boolean" };
const nullable = (schema: S): S => ({ ...schema, nullable: true, ...(schema.enum ? { enum: [...schema.enum, null] } : {}) });
const list = (items: S, maxItems?: number): S => ({ type: "array", items, ...(maxItems === undefined ? {} : { maxItems }) });
const id: S = { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9_|:@.\\-]{0,199}$" };
const opaqueUser: S = { type: "string", minLength: 1, description: "Exact opaque account ID, at most4096 UTF-8 bytes and without NUL. It is not an email or a company record identifier." };
const v: S = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const dt: S = { type: "string", format: "date-time", description: "Serialized Date as an ISO timestamp; database date-only columns also serialize as timestamps on these handlers unless stated otherwise." };
const day: S = { type: "string", format: "date", pattern: "^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$" };
const month: S = { type: "string", pattern: "^[1-9][0-9]{3}-(?:0[1-9]|1[0-2])$" };
const bounded = (maxLength: number): S => ({ type: "string", minLength: 1, maxLength, description: "Trimmed; must contain non-whitespace text and no NUL." });
const optionalText = (maxLength: number): S => ({ type: "string", nullable: true, maxLength, description: "Omitted, null or empty means null. Other values are trimmed, nonblank and contain no NUL." });
const uuid: S = { type: "string", format: "uuid", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", description: "One retained UUIDv4 for the exact intended operation. Reuse with its original payload after an uncertain response; changed payload conflicts." };
const money: S = { type: "string", pattern: "^(?:(?:0|[1-9][0-9]{0,5})(?:\\.[0-9]{1,2})?|1000000(?:\\.0{1,2})?)$", description: "USD decimal string, at most two fractional digits and at most1,000,000; converted to exact integer cents." };
const cents: S = { type: "integer", minimum: 0, maximum: 100000000 };
const bigCents: S = { type: "string", pattern: "^-?[0-9]+$", description: "Exact aggregate cents serialized as a decimal integer string, not dollars." };
const hash: S = { type: "string", pattern: "^[a-f0-9]{64}$" };
const featureNames = FEATURE_CATALOG.map(feature => feature.key);
const feature: S = { type: "string", enum: featureNames };
const modes: S = { type: "string", enum: ["enabled", "read_only", "disabled"] };
const featureProperties = Object.fromEntries(featureNames.map(key => [key, modes]));
const overrides = o(featureProperties, []);
const effective = o(featureProperties);
const catalog = list(o({ key: feature, label: t, description: t }));
const cursorQuery = o({ cursor: id }, [], "Newest ID first, up to50 records. Cursor is a forward exclusive ID boundary; no page-number or arbitrary page-size parameter.");
const ignoredQuery: S = { type: "object", additionalProperties: true, description: "This handler ignores query keys; they do not filter records or change authority." };
const profileFields: Record<string, S> = {
  name: bounded(200), legalName: optionalText(200), contactName: optionalText(200),
  contactEmail: { ...optionalText(254), description: "Optional email matching the server's non-whitespace local@host.suffix check; normalized lowercase." },
  contactPhone: optionalText(40), website: { ...optionalText(500), description: "Optional absolute HTTP/HTTPS URL without username/password; normalized through URL.href." },
  addressLine1: optionalText(200), addressLine2: optionalText(200), city: optionalText(100), region: optionalText(100), postalCode: optionalText(30),
  country: { ...optionalText(2), description: "Optional two ASCII letters; normalized uppercase." },
  timezone: { ...bounded(80), description: "Valid Intl/IANA timezone. Omission resets/defaults to America/New_York; it does not retain the previous value." },
};
const companyScalars: Record<string, S> = {
  id, name: t, domain: nullable(t), legalName: nullable(t), contactName: nullable(t), contactEmail: nullable(t), contactPhone: nullable(t), website: nullable(t),
  addressLine1: nullable(t), addressLine2: nullable(t), city: nullable(t), region: nullable(t), postalCode: nullable(t), country: nullable(t), timezone: t,
  adminNotes: nullable(t), version: v, createdAt: dt, updatedAt: dt, status: { type: "string", enum: ["active", "suspended", "deleted"] }, deletedAt: nullable(dt),
};
const companyRow = o(companyScalars);
const ownerProfileFields = Object.fromEntries(Object.entries(companyScalars).filter(([key]) => !["adminNotes", "createdAt", "deletedAt"].includes(key)));
const ownerProfile = o(ownerProfileFields);
const member = o({ userId: opaqueUser, companyId: id, role: { type: "string", enum: ["owner", "manager", "staff", "resident"] }, status: t, version: v, createdAt: dt, updatedAt: dt,
  user: o({ id: opaqueUser, email: t, name: nullable(t), status: t, emailVerified: b, platformRole: nullable(t) }) });
const companyDetail = o({ ...companyScalars, salesDemo: nullable(o({ id, status: t, setup: nullable(o({ status: t })) })), memberships: list(member) });
const companyList = list(o({ ...companyScalars, _count: o({ memberships: n, properties: n }) }));
const address = o({ addressLine1: nullable(t), addressLine2: nullable(t), city: nullable(t), region: nullable(t), postalCode: nullable(t), country: nullable(t) });
const plan = o({ id, name: t, version: v, currency: { type: "string", enum: ["USD"] }, monthlyPriceCents: cents, features: { ...list(feature), uniqueItems: true }, archivedAt: nullable(dt), createdAt: dt });
const subscriptionProperties = {
  companyId: id, version: v, planId: nullable(id), status: { type: "string", enum: ["trial", "active", "expired", "suspended", "cancelled"] },
  trialEndsAt: nullable(dt), billingEmail: nullable(t), currentPeriodStart: nullable(dt), currentPeriodEnd: nullable(dt), featureOverrides: overrides,
  overrideExpiresAt: nullable(dt), updatedAt: dt, plan: nullable(plan),
};
const subscription = o(subscriptionProperties);
const platformSubscription = o({ ...subscriptionProperties, overrideReason: nullable(t) });
const subscriptionView = (platform: boolean) => o({ subscription: nullable(platform ? platformSubscription : subscription),
  ...(platform ? { plans: list(plan), billingProfile: o({ name: t, email: nullable(t), companyVersion: v, address }) } : {}),
  catalog, effectiveFeatures: effective, collectionMode: { type: "string", enum: ["manual"] } });
const invoiceProperties = {
  id, companyId: id, number: v, billingName: t, billingEmail: nullable(t), planName: t, planVersion: v, monthlyPriceCents: cents,
  periodStart: dt, periodEnd: dt, issuedAt: dt, dueOn: dt, status: { type: "string", enum: ["issued", "void"] }, version: v,
  currency: { type: "string", enum: ["USD"] }, reference: { type: "string", pattern: "^INV-[0-9]+$" }, paidCents: n, balanceCents: n,
  paymentState: { type: "string", enum: ["void", "paid", "partially_paid", "unpaid"] },
};
const invoice = o(invoiceProperties);
const invoiceEventDetail: S = { oneOf: [
  o({ number: v, planId: id, periodStart: day, periodEnd: day, monthlyPriceCents: cents }),
  o({ reason: t, number: v }), o({ paymentId: id, amountCents: cents, receivedOn: day }), o({ paymentId: id, amountCents: cents, reason: t }),
] };
const invoiceDetail = o({ invoice: o({ ...invoiceProperties, billingAddress: address }), payments: list(o({ id, amountCents: cents, receivedOn: dt, paymentReference: t, createdAt: dt,
  reversal: nullable(o({ id, reason: t, createdAt: dt })) })), events: list(o({ id, action: { type: "string", enum: ["invoice.issued", "invoice.voided", "payment.recorded", "payment.reversed"] }, detail: invoiceEventDetail, createdAt: dt })) });
const invoiceList = o({ items: list(invoice, 50), nextCursor: nullable(id), total: n, totalOutstandingCents: n });
const usage = o({ companyId: id, timezone: { type: "string", enum: ["UTC"] }, from: day, to: day,
  areas: list(o({ key: feature, label: t, successfulReads: n, successfulWrites: n, total: n })),
  resources: o({ properties: n, activeUnits: n, activeLeases: n, activeMembers: n, documentVersions: n, documentBytes: n }),
  resourceDefinitions: o({ properties: t, activeUnits: t, activeLeases: t, activeMembers: t, documentVersions: t, documentBytes: t }),
  trackingStartedAt: nullable(dt), definition: t });
const usageQuery = o({ from: day, to: day }, [], "Inclusive UTC day range of1–366 days; omitted from/to mean current UTC month start/today. Future ranges are not forbidden. Resources are current retained counts independently of the activity range.");

function failure(description: string, codes?: string[]): S {
  return { description, ...o({ error: t, code: codes?.length ? { type: "string", enum: [...new Set(codes)] } : t, requestId: t }) };
}
function failures(write: boolean, extra: Record<number, string[]> = {}): Record<number, S> {
  const base: Record<number, string[]> = {
    400: ["INVALID_INPUT", "INVALID_ID", "REQUEST_400"], 401: ["SIGN_IN_REQUIRED"],
    403: ["ACCESS_DENIED", "COMPANY_ACCESS_DENIED", "ORIGIN_REJECTED", "EMAIL_VERIFICATION_REQUIRED", "IMPERSONATION_UNAVAILABLE", "FEATURE_DISABLED", ...(write ? ["CSRF_REJECTED", "CSRF_INVALID", "IMPERSONATION_READ_ONLY", "SUBSCRIPTION_READ_ONLY"] : [])],
    404: ["NOT_FOUND", "REQUEST_404"], 409: ["IMPERSONATION_CONTEXT_CHANGED", "ACCESS_CONFLICT", "REQUEST_409"], 503: ["REQUEST_503"],
  };
  if (write) {
    base[413] = ["REQUEST_413"];
    base[415] = ["REQUEST_415"];
  }
  for (const [status, codes] of Object.entries(extra)) base[Number(status)] = [...(base[Number(status)] || []), ...codes];
  return Object.fromEntries(Object.entries(base).map(([status, codes]) => [status, failure(Number(status) === 503 ? "Service failure; a submitted write can have an uncertain outcome. Preserve the exact request and inspect its source before retrying." : "Current request, authority, source or review state rejects this operation; code identifies the reason.", codes)]));
}
function reviewed(method: string, path: string, file: string, capability: string, summary: string, success: S, options: S = {}): FastifySchema {
  const write = !["GET", "HEAD", "OPTIONS"].includes(method), platform = path.startsWith("/api/platform/");
  const params = Object.fromEntries([...path.matchAll(/:([A-Za-z]+)/g)].map(match => [match[1], match[1] === "userId" ? opaqueUser : id]));
  const { description = "", errors = {}, querystring = ignoredQuery, response = {}, body, ...rest } = options;
  const permission = platform ? "An active verified platform owner with platform.manage; company membership alone grants no access." : capability === "property.read" ? "Active company owner/manager/staff with property.read; staff receive only their current selected-property scope." : capability === "property.write" ? "Active company owner/manager with property.write." : capability === "maintenance.manage" ? "Active company owner/manager with maintenance.manage." : capability === "subscription.read" ? "Active company owner with subscription.read; a suspended company retains this owner's billing/usage read capability." : "Active company owner with " + capability + ".";
  return {
    operationId: (method.toLowerCase() + " " + path).replace(/[^A-Za-z0-9]+(.)/g, (_: string, char: string) => char.toUpperCase()),
    summary, tags: [platform ? "Platform administration" : "Company operations"], security: [{ sessionCookie: [] }],
    "x-pf-contract-status": "source-reviewed", "x-pf-validation-status": "not-handler-verified",
    "x-pf-sources": ["server/src/" + file, "server/src/operational.ts", "server/src/access.ts", "server/src/sessions.ts", "server/src/request-errors.ts"],
    "x-pf-authentication": ["Fresh browser session; signed-in actor must have verified email. Hosted edge-origin validation applies.", ...(write ? ["Exact configured Origin and current session X-CSRF-Token are required."] : [])],
    "x-pf-authorization": [permission, platform ? "Path company IDs designate explicitly authorized platform administration; they never grant arbitrary company business access." : "X-Company-ID, when supplied, must equal current membership company. Company scope and current authority are rechecked inside the transaction; relevant feature disabled/read-only policy still applies."],
    "x-pf-support": [write ? "Business mutations are centrally denied during impersonation." : "Exact X-Impersonation-ID acknowledgement is required in support view; current target company/role/property scope applies. Platform support authority alone does not grant platform.manage."],
    description: description + " Source-reviewed documentation only; not a claim of handler/provider acceptance. Error envelopes use error, code and requestId.",
    headers: { type: "object", additionalProperties: true, required: write ? ["origin", "x-csrf-token"] : [], properties: {
      "x-impersonation-id": { ...t, description: "Current exact support-view context from bootstrap; empty/omitted in own-account context." },
      ...(!platform ? { "x-company-id": { ...t, description: "Optional exact current membership company fence; cannot select another company." } } : {}),
      ...(write ? { origin: { ...t, description: "Configured application origin exactly." }, "x-csrf-token": { ...t, description: "Current session CSRF value; never embed a real value in documentation." } } : {}),
    } }, querystring, ...(Object.keys(params).length ? { params: o(params) } : {}), ...(body ? { body, consumes: ["application/json"] } : {}),
    response: { 200: { description: "Current authorized result.", ...success }, ...failures(write, errors), ...response }, ...rest,
  } as FastifySchema;
}

const definitions: Record<string, FastifySchema> = {};
function add(method: string, path: string, file: string, capability: string, summary: string, success: S, options: S = {}) {
  definitions[`${method} ${path}`] = reviewed(method, path, file, capability, summary, success, options);
}

add("GET", "/api/platform/companies", "company-administration.ts", "platform.manage", "List retained non-deleted companies", companyList, {
  description: "Complete unpaged company array ordered by name then ID; deleted companies are excluded. Counts cover all memberships and properties, not just active ones. publicRow removes creation/deletion submission keys/hashes and actor IDs, while platform-only adminNotes remain visible.",
});
add("GET", "/api/platform/companies/:companyId", "company-administration.ts", "platform.manage", "Read company administration and membership access", companyDetail, {
  description: "Can return a deleted company by its exact ID. Records platform.company.viewed. Memberships expose only explicit access fields and limited account identity; private resident contact profiles are excluded.",
});
add("POST", "/api/platform/companies", "company-administration.ts", "platform.manage", "Create a company with durable submission identity", companyRow, {
  body: o({ ...profileFields, adminNotes: optionalText(2000), submissionKey: uuid }, ["name", "submissionKey"]),
  description: "Creates company metadata; no membership or sign-in account is provisioned. Optional profile omissions normalize to null and omitted timezone defaults America/New_York. Same actor/key and identical normalized profile replay the existing company; changed details conflict.",
  errors: { 409: ["SUBMISSION_MISMATCH"] },
});
add("PATCH", "/api/platform/companies/:companyId", "company-administration.ts", "platform.manage", "Replace company administration profile and operating status", companyRow, {
  body: o({ ...profileFields, adminNotes: optionalText(2000), status: { type: "string", enum: ["active", "suspended"] }, expectedVersion: v }, ["name", "status", "expectedVersion"]),
  description: "Full profile replacement, not a sparse patch: optional omitted profile fields become null and timezone defaults. Increments version atomically with audit. Deleted companies cannot be reactivated. No durable submission key; after uncertainty reread the version and source before another edit.",
  errors: { 409: ["RECORD_CHANGED", "COMPANY_DELETED"] },
});
add("DELETE", "/api/platform/companies/:companyId", "company-administration.ts", "platform.manage", "Retire company access while retaining business history", companyRow, {
  body: o({ confirmationName: bounded(200), expectedVersion: v, submissionKey: uuid }),
  description: "Requires exact current company name after trimming and reviewed version. Marks company deleted, disables memberships, revokes open invitations and affected sessions, and preserves business/audit records. Demo and setup must both already be retired. Only the same deleting actor and original key/payload replay a completed deletion; another request returns COMPANY_DELETED.",
  errors: { 409: ["RECORD_CHANGED", "COMPANY_DELETED", "DEMO_TEARDOWN_REQUIRED", "SUBMISSION_MISMATCH"] },
});

add("GET", "/api/company", "company-profile.ts", "company.manage", "Read the owner's company profile", ownerProfile);
add("GET", "/api/company/roles", "company-profile.ts", "company.manage", "Read the base company role guide", o({ roles: list(o({ role: { type: "string", enum: ["owner", "manager", "staff", "resident"] }, label: t, permissions: list(t) })) }), {
  description: "Static base role guide, not another account's current effective permissions. Staff maintenance execution is an explicit grant and is not included in base staff permissions; platform authority remains separate.",
});
add("GET", "/api/company/profile-history", "company-profile.ts", "company.manage", "Page immutable company profile revisions", o({ items: list(o({ id, version: v, before: ownerProfile, after: ownerProfile, createdById: opaqueUser, createdAt: dt, actor: t }), 50), nextBeforeVersion: nullable(v) }), {
  querystring: o({ beforeVersion: { type: "string", pattern: "^[1-9][0-9]{0,8}$" } }, []),
  description: "Up to50 revisions by descending version, using exclusive beforeVersion; nextBeforeVersion=null ends history. No total count. Actor label falls back from current name to email to Recorded user. Snapshots contain the selected owner-profile fields and omit platform adminNotes.",
});
add("PATCH", "/api/company", "company-profile.ts", "company.manage", "Save company profile with versioned history or legacy name edit", { anyOf: [ownerProfile, o({ saved: { type: "boolean", enum: [true] }, version: v })] }, {
  body: { oneOf: [o({ name: bounded(200) }), o({ ...profileFields, expectedVersion: v, submissionKey: uuid }, ["name", "expectedVersion", "submissionKey"])] },
  description: "Exact body {name} is the supported legacy name-only branch: no version or durable key, no profile-revision receipt, but version/audit update. Every other accepted body requires expectedVersion/submissionKey and performs profile replacement with optional omissions reset. New saves return the profile; exact receipt replay returns {saved:true,version:originalRevisionVersion}. Admin notes are never accepted or returned here.",
  errors: { 409: ["RECORD_CHANGED", "SUBMISSION_MISMATCH"] },
});

const propertyFields = { id, name: t, address: t, city: t, state: t, zip: t,
  propertyType: nullable({ type: "string", enum: ["single_family", "multi_family", "condo", "townhouse", "commercial", "mixed_use", "other"] }), yearBuilt: nullable({ type: "integer", minimum: 1000, maximum: 2100 }), parcelId: nullable(t), countryCode: nullable(t), notes: nullable(t), version: v };
add("GET", "/api/company/properties/:propertyId", "property-detail.ts", "property.read", "Read an authorized property", o(propertyFields), {
  description: "Exact company property and current selected-property staff scope required; unavailable/other-scope properties return404. Records property.viewed without returning unrelated tenancy or financial data.",
});
add("PATCH", "/api/company/properties/:propertyId", "property-detail.ts", "property.write", "Replace property details at the reviewed version", o(propertyFields), {
  body: o({ name: bounded(200), address: bounded(200), city: bounded(200), state: bounded(100), zip: bounded(30), expectedVersion: v,
    propertyType: { anyOf: [propertyFields.propertyType, { type: "string", enum: [""] }], description: "Null, empty or omitted clears the value; otherwise one of the supported property types." },
    yearBuilt: { anyOf: [nullable({ type: "integer", minimum: 1000, maximum: 2100 }), { type: "string", pattern: "^[0-9]*$", description: "Empty clears; nonempty whole-number text must be1000–2100." }] },
    parcelId: optionalText(100), countryCode: { ...optionalText(2), description: "Optional two ASCII letters, normalized uppercase." }, notes: optionalText(2000),
  }, ["name", "address", "city", "state", "zip", "expectedVersion"]),
  description: "Atomic optimistic update increments version and records property.updated. Required address/name fields must be resubmitted; omitted optional fields clear. No durable key or auto-replay guarantee: reread after an uncertain response before changing the reviewed version.", errors: { 409: ["RECORD_CHANGED"] },
});

const scopeState = o({ scope: { type: "string", enum: ["all", "selected"] }, propertyIds: list(id, 5000) });
add("GET", "/api/company/members/:userId/property-access", "staff-property-access.ts", "members.manage", "Review a staff member's property and maintenance grants", o({ expectedVersion: v, scope: { type: "string", enum: ["all", "selected"] }, maintenanceExecution: b, propertyIds: list(id),
  properties: list(o({ id, name: t, address: t })), history: list(o({ id, createdAt: dt, detail: o({ from: scopeState, to: scopeState, version: v }), actorName: t }), 10) }), {
  description: "Only current-company staff memberships are targets. Properties include all retained company properties sorted name/ID; grants sorted property ID; at most10 most recent property-access audit events. History actor IDs are replaced by actorName (fallback Company administrator). Maintenance-only audit is a separate action and is not in this history.",
});
add("PUT", "/api/company/members/:userId/property-access", "staff-property-access.ts", "members.manage", "Set the reviewed staff property scope and maintenance execution", o({ version: v }), {
  body: o({ scope: { type: "string", enum: ["all", "selected"] }, propertyIds: { ...list(id, 5000), uniqueItems: true }, expectedVersion: v, maintenanceExecution: b }, ["scope", "propertyIds", "expectedVersion"]),
  description: "All scope requires an empty propertyIds array; selected scope can be empty. Every selected property must belong to this company. Omitted maintenanceExecution retains its current value. A matching identical PUT returns current version before the stale-version check, safely avoiding a second audit; changed values require the reviewed version. Enabling execution requires active staff account/membership and grants no finance/lease/document authority.", errors: { 409: ["RECORD_CHANGED", "ACCOUNT_DISABLED"] },
});

for (const [path, platform] of [["/api/company/usage", false], ["/api/platform/companies/:companyId/usage", true]] as const)
  add("GET", path, "company-usage.ts", platform ? "platform.manage" : "subscription.read", "Read UTC feature activity and current retained resource counts", usage, {
    querystring: usageQuery,
    description: "Activity counts successful requests including repeats/retries, not unique users/jobs or billing quantities. Tracking is best effort and excludes support views, auth, administration and billing; no earlier activity is backfilled. Complete range aggregates per feature and current resource counts. Platform scope can inspect an existing retained company; owner scope remains its own membership.",
  });

add("GET", "/api/company/property-directory", "overview.ts", "property.read", "Read current scoped property operation counts", o({ today: day, items: list(o({ id, activeUnits: n, occupiedUnits: n, draftLeases: n, openMaintenance: n }, ["id", "activeUnits"])) }), {
  querystring: o({}), description: "Complete permitted property-ID array ordered by property name/ID; names/details come from property records. Today uses company timezone. All staff property filters apply. occupiedUnits/draftLeases are omitted without lease.manage or when leasing is disabled; openMaintenance is omitted without maintenance.manage or when maintenance is disabled. Omission is unavailable authority, not zero. Active occupancy uses leases in effect today, not merely active status.",
});
const collections = o({ pastDueCents: bigCents, afterGraceCents: bigCents, withinGraceCents: bigCents, pastDueLeaseCount: n, afterGraceLeaseCount: n });
add("GET", "/api/company/overview", "overview.ts", "property.read", "Read a role-projected company or property operations overview", o({
  company: o({ name: t, timezone: t }), property: nullable(o({ id, name: t })), today: day, generatedAt: dt, propertyCount: n, activeUnitCount: n,
  properties: list(o({ id, name: t, address: t, city: t, state: t, _count: o({ units: n }) }), 6),
  residentApprovals: o({ pendingCount: n }),
  leases: o({ inEffectCount: n, monthlyRentCents: bigCents, draftCount: n, endingSoonCount: n, pastEndCount: n, withoutCurrentLease: n,
    endingSoon: list(o({ id, propertyId: id, endsOn: nullable(dt), property: o({ name: t }), unit: o({ label: t }) }), 5),
  }, ["inEffectCount", "draftCount", "endingSoonCount", "pastEndCount", "withoutCurrentLease", "endingSoon"]),
  maintenance: o({ openCount: n, reviewCount: n, overdueCount: n, highPriorityCount: n, latest: list(o({ id, propertyId: id, title: t, status: t, priority: t, property: o({ name: t }) }), 5) }),
  billingIssues: o({ count: n }), rentCollections: collections,
  cash: o({ dateFrom: day, dateTo: day, incomeCents: bigCents, expenseCents: bigCents, rentRefundCents: bigCents, netCents: bigCents }, ["dateFrom", "dateTo", "incomeCents", "expenseCents", "netCents"]),
}, ["company", "property", "today", "generatedAt", "propertyCount", "activeUnitCount", "properties"]), {
  querystring: o({ propertyId: id }, []),
  description: "All counts are scoped to the current company and optional authorized property, with staff property restrictions. Properties is a preview capped at6, not the complete directory. residentApprovals requires members.manage and enabled leasing/resident portal; leases requires lease.manage and leasing; its monthlyRentCents additionally requires finances. Maintenance requires maintenance.manage and feature availability. billingIssues/rentCollections/cash require finance.manage plus finances and leasing. Missing sections are unavailable, not empty/zero. Lease ending previews cap5 within30 company-calendar days; maintenance latest caps5. Cash is current-month-to-today exact aggregate cents; rentRefundCents appears only when positive. Current authority is reread inside the protected snapshot.",
});
const calendarItem = o({ id, kind: { type: "string", enum: ["schedule", "request"] }, title: t, dueOn: dt, timezone: t, priority: t, status: t, propertyId: id, unitId: nullable(id), propertyName: t, unitLabel: nullable(t), overdue: b });
add("GET", "/api/company/work-calendar", "work-calendar.ts", "maintenance.manage", "Read a monthly maintenance calendar and selected-day page", o({ month, day: nullable(day), today: day, timezone: t,
  days: list(o({ dueOn: dt, total: n, schedules: n, requests: n, overdue: n })), items: list(calendarItem, 25), total: n, monthTotal: n, page: v, pageSize: { type: "integer", enum: [25] } }), {
  querystring: o({ month, day, propertyId: id, kind: { type: "string", enum: ["all", "schedule", "request", ""] }, page: { type: "string", pattern: "^[1-9][0-9]{0,5}$" } }, []),
  description: "Unknown query keys fail. Month defaults to current company month, kind defaults all (also for empty string), page defaults1. Optional day must belong to selected month. Includes active plans at nextOn and unresolved requests at targetOn; generated occurrences are requests after the source plan advances. Items are ordered dueOn/kind/title/ID,25 per page. Days and monthTotal cover the filtered month even when a day is selected; total covers selected day or month. Overdue uses each event's timezone, not browser timezone. Raw dueOn dates serialize as ISO timestamps; top-level day/today are YYYY-MM-DD.",
});

add("GET", "/api/platform/plans", "company-billing.ts", "platform.manage", "List every published plan version and implemented feature catalog", o({ items: list(plan), catalog }), {
  description: "Complete unpaged list includes archived plans, sorted name ascending/version descending. Immutable versions retain their original feature list and price; no payment provider or billing amount is activated by this read.",
});
add("POST", "/api/platform/plans", "company-billing.ts", "platform.manage", "Publish a new immutable monthly plan version", plan, {
  body: o({ name: bounded(100), monthlyPrice: money, features: { ...list(feature, featureNames.length), uniqueItems: true }, submissionKey: uuid }),
  description: "Publishes next version under the exact trimmed plan name, serialized against concurrent publications. Features must be unique implemented keys and are stored in catalog order. Zero price is allowed. Actor/key exact payload replay returns the original publication; changed details conflict. No tenant ledger, provider charge or message is produced.", errors: { 409: ["SUBMISSION_MISMATCH"] },
});
add("PATCH", "/api/platform/plans/:planId/archive", "company-billing.ts", "platform.manage", "Archive or restore plan availability", plan, {
  body: o({ archived: b, expectedArchivedAt: { type: "string", nullable: true, description: "Current archivedAt ISO timestamp or null. The parser permits any Date.parse-finite string, but a state-changing request must match the stored ISO timestamp exactly." } }),
  description: "An already-matching archived state returns current plan before the expectedArchivedAt comparison; changed state requires the reviewed original timestamp. No durable key is supported. Archiving prevents new assignment while keeping existing subscriptions and plan history intact.", errors: { 409: ["RECORD_CHANGED"] },
});
for (const [path, platform] of [["/api/company/subscription", false], ["/api/platform/companies/:companyId/subscription", true]] as const)
  add("GET", path, "company-billing.ts", platform ? "platform.manage" : "subscription.read", "Read manual subscription and current feature policy", subscriptionView(platform), {
    description: "Subscription is null before assignment. Platform projection includes every plan version, billingProfile/current company version and overrideReason; owner projection omits those platform fields. Catalog/effectiveFeatures remain present with manual collection mode. Platform reads retain deleted-company history; own-company read depends on subscription.read, including the active owner of a suspended company.",
  });
add("GET", "/api/platform/companies/:companyId/subscription/history", "company-billing.ts", "platform.manage", "Page immutable subscription revisions", o({ items: list(o({ id, version: v, snapshot: platformSubscription, reason: t, actorId: opaqueUser, createdAt: dt }), 50), nextCursor: nullable(id) }), {
  querystring: cursorQuery, description: "Exclusive ID cursor, descending ID, up to50 immutable revision snapshots. No total. Snapshot is the saved platform subscription DTO, not recomputed current policy. Preserves the actor, reason and original plan version.",
});
const instantInput: S = { type: "string", nullable: true, pattern: "^(?:$|[0-9]{4}-[0-9]{2}-[0-9]{2}T)", description: "Omitted, null or empty clears. Otherwise must begin YYYY-MM-DDT and be Date.parse-finite; canonical clients should include an explicit timezone offset. A configured expiry must be future when applying a fresh update." };
add("PUT", "/api/platform/companies/:companyId/subscription", "company-billing.ts", "platform.manage", "Assign reviewed subscription settings and feature overrides", subscriptionView(true), {
  body: o({ expectedVersion: nullable(v), planId: { anyOf: [nullable(id), { type: "string", enum: [""] }] }, status: { type: "string", enum: ["trial", "active", "expired", "suspended", "cancelled"] },
    trialEndsAt: instantInput, billingEmail: { ...optionalText(254), description: "Optional syntactically checked email, normalized lowercase." }, featureOverrides: overrides,
    overrideReason: optionalText(500), overrideExpiresAt: instantInput, reason: bounded(500), submissionKey: uuid,
  }, ["expectedVersion", "planId", "status", "reason", "submissionKey"]),
  description: "Null expectedVersion means no existing subscription. Null/empty planId removes plan assignment; archived plan is allowed only when retaining the same current plan. Trial requires a future trialEndsAt. Nonempty overrides require an overrideReason; empty overrides clear its reason/expiry. Revisions and audit are atomic with version update. Durable exact company/key replay returns CURRENT subscription view before stale-version/time checks; changed key payload fails. Deleted companies are read-only. Source parser's legacy String(mode) coercion can accept wrapped mode arrays; the canonical contract uses string modes and this noncanonical edge remains a documented parser discrepancy, not a new behavior guarantee.",
  errors: { 409: ["RECORD_CHANGED", "PLAN_UNAVAILABLE", "SUBMISSION_MISMATCH", "COMPANY_DELETED"] },
});
for (const [path, platform] of [["/api/company/billing", false], ["/api/platform/companies/:companyId/billing", true]] as const)
  add("GET", path, "company-billing.ts", platform ? "platform.manage" : "subscription.read", "Page SaaS invoices and complete company receivable totals", invoiceList, {
    querystring: cursorQuery, description: "At most50 invoices by descending ID. total counts all retained company invoices independently of cursor; totalOutstandingCents sums issued invoice prices less non-reversed receipts across all company invoices, not just the displayed page. List omits billingAddress; detail retains it. These SaaS receivables are separate from tenant rent/cash/deposits and are not a provider reconciliation.",
  });
for (const [path, platform] of [["/api/company/billing/invoices/:invoiceId", false], ["/api/platform/companies/:companyId/billing/invoices/:invoiceId", true]] as const)
  add("GET", path, "company-billing.ts", platform ? "platform.manage" : "subscription.read", "Read retained invoice, manual receipts and correction history", invoiceDetail, {
    description: "Exact invoice must belong to authorized company. Returns full saved billing address/profile and original plan terms; payments/events are retained, newest createdAt/ID first. Reversal exposes only id/reason/createdAt, not submission internals. Voided invoices have zero balance and paymentState=void; zero-price issued invoices are paid. Values do not prove provider collection or refund.",
  });
const billingRoot = "/api/platform/companies/:companyId/billing/invoices";
add("POST", billingRoot, "company-billing.ts", "platform.manage", "Issue one reviewed manual SaaS invoice for a billing month", invoiceDetail, {
  body: o({ period: month, dueOn: day, expectedSubscriptionVersion: v, expectedCompanyVersion: v, submissionKey: uuid }),
  description: "Requires an active subscription with a plan and exact company/subscription versions; trials are not invoiced. Due date cannot precede billing month. Saves the original profile/address/plan snapshot; periodEnd is exclusive next-month start. Only one issued invoice per month; a voided original remains retained and permits a replacement. Exact company/key replay returns original invoice detail before revalidation. No automatic collection or mail.",
  errors: { 409: ["SUBMISSION_MISMATCH", "BILLING_NOT_CONFIGURED", "PERIOD_ALREADY_INVOICED", "BILLING_REVIEW_CHANGED", "COMPANY_DELETED"] },
});
add("POST", billingRoot + "/:invoiceId/void", "company-billing.ts", "platform.manage", "Void an issued invoice after reversing its manual receipts", invoiceDetail, {
  body: o({ expectedVersion: v, reason: bounded(500), submissionKey: uuid }),
  description: "Fresh action requires issued invoice/current version and no unreversed receipts. Increments version and writes immutable invoice.voided event/audit. A matching durable event receipt replays current invoice detail before checking current version/status. Voiding never refunds money or deletes original billing evidence.",
  errors: { 409: ["RECORD_CHANGED", "SUBMISSION_MISMATCH", "INVOICE_VOID", "INVOICE_HAS_PAYMENTS", "COMPANY_DELETED"] },
});
add("POST", billingRoot + "/:invoiceId/payments", "company-billing.ts", "platform.manage", "Record a positive SaaS payment already received", invoiceDetail, {
  body: o({ amount: { ...money, not: { enum: ["0", "0.0", "0.00"] } }, receivedOn: day, paymentReference: bounded(200), expectedVersion: v, submissionKey: uuid }),
  description: "Evidence/reference is required. Receipt date must not be in the future in the company's timezone; positive amount cannot exceed the currently issued invoice's remaining balance. Persists payment, increments invoice version and writes event/audit atomically. Exact original receipt key/payload replays current invoice detail; a new key never represents an automatic retry. This records money already received and does not initiate a provider payment.",
  errors: { 409: ["RECORD_CHANGED", "SUBMISSION_MISMATCH", "INVOICE_VOID", "PAYMENT_EXCEEDS_BALANCE", "COMPANY_DELETED"] },
});
add("POST", billingRoot + "/:invoiceId/payments/:paymentId/reverse", "company-billing.ts", "platform.manage", "Record an immutable correction to an invoice receipt", invoiceDetail, {
  body: o({ expectedVersion: v, reason: bounded(500), submissionKey: uuid }),
  description: "Current issued invoice/version and exact company/invoice payment are required. Creates one retained reversal, increments invoice version and writes event/audit. Prior matching event receipt replays before current-version/reversed checks; a distinct second correction fails. Changes receivable balances without refunding money or deleting the original receipt.",
  errors: { 409: ["RECORD_CHANGED", "SUBMISSION_MISMATCH", "INVOICE_VOID", "PAYMENT_ALREADY_REVERSED", "COMPANY_DELETED"] },
});

const demoEnvironment = o({ name: t, origin: { type: "string", format: "uri" }, identityIssuer: nullable(t), provisioningAllowed: b });
const blueprint = o({ format: { type: "integer", enum: [1] }, seedVersion: v, anchorOn: day, environment: demoEnvironment, planHash: hash,
  inventory: o({ properties: n, unitsPerProperty: n, occupiedUnits: n, notOccupiedUnits: n, readyUnits: n, turnoverUnits: n }),
  roles: list(o({ key: t, role: t, name: t, login: b })), coverage: list(o({ key: feature, label: t, sources: list(t) })),
  effects: o({ dedicatedCompanies: n, preparedAccounts: n, issuedLogins: n, sendsExternalMessages: { type: "boolean", enum: [false] }, movesMoney: { type: "boolean", enum: [false] }, signsAgreements: { type: "boolean", enum: [false] }, editsCustomerRecords: { type: "boolean", enum: [false] }, preservesRetiredHistory: { type: "boolean", enum: [true] } }),
  walkthrough: list(o({ role: t, task: t })),
});
const scenarioKeys = ["plannedMoveOutId", "offlineContactId", "offlineLeaseId", "pendingContactId", "invitationId", "formerContactId", "endedLeaseId", "baselineInspectionId", "moveOutInspectionId", "reviewedAgreementId", "sharedDocumentId", "receivedShareId", "archivedDocumentId", "readyUnitId", "turnoverUnitId", "restoredUnitId", "pausedScheduleId", "pausedPreventivePlanId", "privateUpdateId", "voidedExpenseId", "reversedCreditId", "approvedApplicationId", "rejectedApplicationId", "unitImportId", "invalidUnitImportId", "expenseImportId", "duplicateExpenseImportId"];
const manifestIds = ["occupantId", "managerId", "staffId", "vendorId", "preventivePlanId", "inspectionId", "agreementId", "documentId", "documentVersionId", "prospectId", "followUpId", "applicationId", "savedTaskId", "scheduleId", "renewalId"];
const demoManifest: S = {
  type: "object", additionalProperties: true,
  description: "Retained versioned fixture source-ID manifest. Current seedVersion7 known fields are described; older generations retain their original JSON and may omit these or include extra historical fields. The handler reads the stored snapshot unchanged; it neither fabricates missing sources nor upgrades the manifest on read. Additional fields are intentional historical JSON, not an unspecified business response.",
  "x-pf-schema-intent": "versioned-historical-json",
  properties: {
    today: day, fixtureVersion: v, presentation: o({ anchorOn: day, fictional: b, retainedHistory: b }),
    properties: list(id), units: list(id), leases: list(id), residents: list(opaqueUser), requests: list(id),
    ...Object.fromEntries(manifestIds.map(key => [key, key.endsWith("Id") && ["occupantId", "managerId", "staffId"].includes(key) ? opaqueUser : id])),
    scenarios: { type: "object", additionalProperties: true, properties: { ...Object.fromEntries(scenarioKeys.map(key => [key, id])), readNotificationId: nullable(id) } },
  },
};
const demoRowProperties = { id, companyId: id, ownerId: opaqueUser, createdById: opaqueUser,
  submissionKey: { ...t, description: "Retained creation receipt key. Current creates use UUIDv4; historical generations can retain earlier arbitrary string keys. This response field does not relax new-request validation." },
  submissionHash: { ...t, description: "Retained creation fingerprint string; older generations may predate the current SHA-256 representation. Returned unchanged, without recomputing historical identity." },
  seedVersion: v, status: t, version: v, manifest: demoManifest, createdAt: dt, retiredAt: nullable(dt) };
const demoRow = o(demoRowProperties);
const demoList = o({ seedVersion: v,
  items: list(o({ ...demoRowProperties, company: o({ name: t, status: t }), owner: o({ email: t, name: nullable(t) }),
    setup: nullable(o({ id, status: t, sourceDemoId: nullable(id) })), replacementSetups: list(o({ id, status: t }), 1) }), 50),
  setups: list(o({ id, status: t, createdAt: dt, sourceDemoId: nullable(id), accountsPrepared: n }), 50),
});
const ownershipForeign = o({ userId: opaqueUser, name: nullable(t), email: t, role: t, status: t, platformRole: nullable(t), reviewPath: t, supportPath: nullable(t) });
const ownershipChanged = o({ userId: opaqueUser, name: nullable(t), email: t, accountKey: nullable(t), expectedEmail: nullable(t), platformRole: nullable(t),
  reasons: list({ type: "string", enum: ["platform_authority", "legacy_company_assignment", "email_changed", "other_company_membership", "identity_mapping_changed", "password_change_pending"] }), reviewPath: t, supportPath: nullable(t) });
const lifecycle = o({
  id, intent: { type: "string", enum: ["inspect", "retire", "rebuild"] }, planHash: hash, expectedVersion: v, seedVersion: nullable(v), latestSeedVersion: v, anchorOn: nullable(day), status: t,
  company: nullable(o({ id, name: t, status: t })), automatic: b, environment: demoEnvironment, generatedAccounts: n, companyMembers: n, blockers: list(t), replacement: nullable(o({ id, status: t })),
  ownershipReview: o({ foreignMembers: list(ownershipForeign), changedAccounts: list(ownershipChanged) }), canRebuild: b,
  effects: o({ retiresCurrentCompany: b, disablesGeneratedAccounts: b, preservesExistingPresenter: b, preservesPostedAndAuditHistory: { type: "boolean", enum: [true] }, deletesSourceRecords: { type: "boolean", enum: [false] }, createsFreshCompanyOnRebuild: { type: "boolean", enum: [true] }, rewritesPostedHistory: { type: "boolean", enum: [false] } }),
  coverage: list(o({ key: feature, complete: b })),
  stops: list(o({ title: t, role: t, source: t, route: t, state: t, suffix: t, appendSource: b, path: t }, ["title", "role", "source", "route", "state", "path"])),
});
const credentialSheet = o({ id, companyId: id, credentials: list(o({ role: t, name: t, email: { ...t, readOnly: true },
  password: { type: "string", format: "password", readOnly: true, "x-pf-sensitive": true, description: "Generated demo-only secret returned by this freshly authorized, audited, no-store operation. Schema only: no examples/defaults/real values are stored in the reference. Do not log or persist the response in browser storage." },
})) });
const demoConflicts = ["DEMO_SETUP_BUSY", "DEMO_RETIRED", "DEMO_PROVIDER_CHANGED", "DEMO_ENVIRONMENT_CHANGED", "DEMO_PLAN_INVALID", "DEMO_PLAN_EXPIRED", "DEMO_PLAN_CHANGED", "DEMO_OWNERSHIP_CHANGED", "DEMO_ACCOUNT_ASSIGNED", "DEMO_PASSWORD_CHANGED", "DEMO_IDENTITY_CONFLICT", "DEMO_REBUILD_REVIEW_CHANGED", "PASSWORD_OPERATION_IN_PROGRESS"];
const demoProviderFailures = ["IDENTITY_NOT_CONFIGURED", "IDENTITY_PROVIDER_UNAVAILABLE", "DEMO_PROVIDER_RETRY", "DEMO_BLOCK_RETRY", "DEMO_CREDENTIALS_UNAVAILABLE", "DEMO_ENVIRONMENT_UNAVAILABLE", "DEMO_SEED_FAILED"];
const demoErrors = { 409: demoConflicts, 429: ["IDENTITY_PROVIDER_UNAVAILABLE"], 503: demoProviderFailures };
const sensitiveResponse = { 200: { description: "Freshly authorized generated login sheet; successful receipt is not external sign-in acceptance. Never save real credential values in documentation, logs or browser storage.", ...credentialSheet,
  headers: { "cache-control": { type: "string", enum: ["no-store"] }, pragma: { type: "string", enum: ["no-cache"] } } },
  429: { ...failure("Provider quota/cooldown; wait Retry-After and resume the original generation and request.", ["IDENTITY_PROVIDER_UNAVAILABLE"]), headers: { "retry-after": { ...t, description: "Seconds until the provider retry window; do not reset durable setup or operation identity." } } },
};
add("GET", "/api/platform/sales-demos/blueprint", "sales-demo.ts", "platform.manage", "Inspect the current fictional demo blueprint without provisioning", blueprint, {
  description: "Read-only current fixture/day/environment plan and deterministic hash; no accounts, companies, source records, messages, signatures or money are created. Anchor day is America/New_York. provisioningAllowed requires configured dev/development/test/disposable_test environment and ready identity connection; it does not grant action permission or establish live provider acceptance. Roles include prepared tenants without issued logins.",
});
add("GET", "/api/platform/sales-demos", "sales-demo.ts", "platform.manage", "Read retained demo generations and unfinished setups", demoList, {
  description: "Latest50 demos ordered createdAt/ID descending, including retired generations; separately latest50 non-retired setups without an attached demo. These are capped lists with no cursor or complete totals. Demo items retain raw SalesDemo scalar fields including submission identity/fingerprint and versioned manifest, plus limited company/owner/setup projections. Encrypted credentials, operation lease, owned-account provider snapshots and passwords are never in this list. accountsPrepared counts saved provider confirmations, not successful logins.",
});
add("GET", "/api/platform/sales-demos/:demoId/plan", "sales-demo.ts", "platform.manage", "Review the exact generation's retirement or rebuild consequences", lifecycle, {
  querystring: { ...o({ intent: { type: "string", enum: ["inspect", "retire", "rebuild", ""] } }, []), additionalProperties: true },
  description: "Intent defaults inspect (also for empty string); other query keys are ignored. Hash binds exact current company, accounts, memberships, ownership reasons, unfinished password changes, replacement reservation and fresh fixture context. No business/provider write occurs. Missing generation/setup is404; mismatched ownership is409. canRebuild is a current planning predicate, not authorization or completed retirement. Review links identify the exact platform account/support grant; coverage/stops come only from retained source IDs. Version-one plans preserve an existing presenter.",
  errors: { 409: ["DEMO_OWNERSHIP_CHANGED", "DEMO_PLAN_INVALID"] },
});
add("POST", "/api/platform/sales-demos", "sales-demo.ts", "platform.manage", "Build or resume one durably reserved demo generation", credentialSheet, {
  body: o({ submissionKey: uuid, planHash: hash }, ["submissionKey"]), errors: demoErrors, response: sensitiveResponse,
  description: "Configured identity demo provider and allowed development/test environment required. UI/operator workflow reviews blueprint and sends hash; legacy direct API permits omitted hash. Supplied mismatch fails409. Actor/key reserves one generation with encrypted credentials before provider calls; the same original key resumes/returns it without generating fresh passwords. One bounded110-second provider budget and five-minute operation lease protect progress; already confirmed issuer/connection-bound subjects are not recreated. Only dedicated fictional company/accounts are seeded through current business handlers. Success returns the generated credential sheet, not the raw setup or company. Every role and each intended source relationship still needs separate acceptance.",
});
add("POST", "/api/platform/sales-demos/:demoId/resume", "sales-demo.ts", "platform.manage", "Resume the same reserved demo setup without new submission identity", credentialSheet, {
  body: o({}), errors: demoErrors, response: sensitiveResponse,
  description: "Requires an explicit empty JSON object. Continues only the exact pending generation; ready generations pass through current credential reveal checks. Original environment/fixture/business-day/issuer/connection ownership must remain valid; stale fixture/day fails rather than silently rebasing posted history. A reserved rebuild resumes original retirement before new source construction. Keep this ID and original request after uncertain/provider failures; no new key or generation is issued by resume.",
});
add("POST", "/api/platform/sales-demos/:demoId/credentials", "sales-demo.ts", "platform.manage", "Reveal the exact ready demo's generated role logins", credentialSheet, {
  body: o({}), errors: { 409: demoConflicts, 503: ["DEMO_CREDENTIALS_UNAVAILABLE"] }, response: { 200: sensitiveResponse[200] },
  description: "Requires an explicit empty JSON object and ready setup/demo with active company. Fresh exact identity/member/verification/issuer checks reject reassigned, disabled or administratively password-changed accounts; reveal is audited. Returns only issued role logins; offline/pending/former prepared identities are excluded. No provider fetch or password reset is performed. Schema contains no credential values/examples. API explorer cannot execute this write.",
});
add("POST", "/api/platform/sales-demos/:demoId/rebuild", "sales-demo.ts", "platform.manage", "Reserve and build one reviewed successor while retaining old generation history", credentialSheet, {
  body: o({ expectedVersion: v, planHash: hash, confirmed: { type: "boolean", enum: [true] }, submissionKey: uuid }),
  errors: { ...demoErrors, 409: [...demoConflicts, "DEMO_NOT_READY", "DEMO_REBUILD_EXISTS"] }, response: sensitiveResponse,
  description: "Unlike legacy create/teardown, reviewed hash and confirmed=true are mandatory. Exact original version/hash, generated-account ownership, no foreign members/password work and no active successor are required. Durably reserves one successor then retires original generation through its safe cleanup, finally builds a new dedicated company/accounts. Source change returns DEMO_REBUILD_REVIEW_CHANGED rather than rewriting review. Exact actor/key replay resumes same replacement before revalidation; another active successor is blocked. One shared110-second provider-work budget spans old cleanup and new account preparation. Return is successor credential sheet. Old posted/source/audit history remains retained.",
});
add("POST", "/api/platform/sales-demos/:demoId/teardown", "sales-demo.ts", "platform.manage", "Retire exact demo access and finish owned-identity cleanup", { anyOf: [o({ id, status: { type: "string", enum: ["retired"] } }), demoRow] }, {
  body: o({ expectedVersion: v, planHash: hash }, ["expectedVersion"]),
  errors: { ...demoErrors, 409: [...demoConflicts, "RECORD_CHANGED", "DEMO_FOREIGN_MEMBER"] },
  response: { 429: sensitiveResponse[429] },
  description: "UI/operator workflow sends reviewed retirement hash; legacy API can omit it, in which case fresh ownership checks do not prove the caller reviewed a plan. An automatic setup first checks exact issuer/connection/local ownership and pending password reservations, suspends company and disables generated local access/sessions atomically, then blocks only marked provider accounts with durable per-subject progress. Partial provider failure leaves local access disabled and must resume this same teardown. Cleanup does not require today's fixture/day or provisioning-enabled flag, but does require original known environment/issuer context. Completed automatic setup returns {id,status:'retired'}; legacy version-one demo returns full retained SalesDemo scalar row and preserves its pre-existing presenter. Repeated retired legacy response bypasses stale-version/hash checks, while fresh retirement checks current version. Neither path deletes business/audit records or refunds money.",
});

export const platformApiContracts: Record<string, FastifySchema> = definitions;
