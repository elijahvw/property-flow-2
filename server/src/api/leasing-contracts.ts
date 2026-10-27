import type { FastifySchema } from "fastify";

// Reference-only contracts. The Swagger transform consumes these; business
// route.schema, request validation and response serialization remain unchanged.
type LcSchema = Record<string, unknown>;
const lcObject = (properties: Record<string, LcSchema>, required = Object.keys(properties), description?: string): LcSchema => ({ type: "object", additionalProperties: false, properties, required, ...(description ? { description } : {}) });
const lcString: LcSchema = { type: "string" };
const lcNull = (schema: LcSchema): LcSchema => ({ ...schema, nullable: true, ...(Array.isArray(schema.enum) ? { enum: [...new Set([...schema.enum, null])] } : {}) });
const lcEnum = (values: string[]): LcSchema => ({ type: "string", enum: values });
const lcText = (maxLength: number): LcSchema => ({ type: "string", minLength: 1, maxLength, description: "Trimmed nonempty text; NUL is rejected." });
const lcOptionalText = (maxLength: number): LcSchema => ({ type: "string", maxLength, nullable: true, description: "Omitted, null or empty means absent; other values are trimmed nonempty text without NUL." });
const lcId: LcSchema = { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9_|:@.\\-]{0,199}$" };
const lcUserId: LcSchema = { type: "string", minLength: 1, description: "Exact opaque account ID; at most 4096 UTF-8 bytes and no NUL. Not a tenant-contact ID, and not constrained to the ordinary record-ID grammar." };
const lcVersion: LcSchema = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const lcCount: LcSchema = { type: "integer", minimum: 0 };
const lcTimestamp: LcSchema = { type: "string", format: "date-time" };
const lcDay: LcSchema = { type: "string", format: "date", pattern: "^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$", description: "Validated YYYY-MM-DD business day, not a timestamp." };
const lcOptionalDay: LcSchema = { type: "string", nullable: true, description: "Omitted, null or empty means absent; otherwise a validated YYYY-MM-DD business day." };
const lcMoney: LcSchema = { type: "string", pattern: "^(0|[1-9][0-9]{0,6})(\\.[0-9]{1,2})?$", description: "Exact USD decimal string with at most two fractional places; shared cents() additionally caps the amount at 1000000 dollars. No exponent, sign, grouping or leading zeroes." };
const lcCentAmount: LcSchema = { type: "integer", minimum: 0, maximum: 100000000 };
const lcKey: LcSchema = { type: "string", format: "uuid", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", description: "One UUIDv4 for the intended action. Retain the exact original payload/key after response loss; changed details with the same key conflict." };
const lcQueryIgnored: LcSchema = { type: "object", additionalProperties: true, description: "The handler does not inspect query parameters; they do not add filters or change authority." };
const lcPageInput: LcSchema = { type: "string", pattern: "^[1-9][0-9]{0,4}$", description: "Decimal string 1 through 99999; omitted means page 1. The response page is an integer." };
const lcSearch: LcSchema = { type: "string", maxLength: 200, description: "Case-insensitive trimmed search; NUL is rejected. Empty means no search." };
const lcReason = lcText(500);
const lcCursor: LcSchema = { ...lcId, description: "Forward source-ID cursor for this endpoint's ordering. It is not a full count or an authorization grant." };
const lcPolicyInput = { rentDueDay: { type: "integer", minimum: 1, maximum: 31 }, graceDays: { type: "integer", minimum: 0, maximum: 30 }, paymentInstructions: lcOptionalText(1000) };
const lcPolicyOutput = { rentDueDay: { type: "integer", minimum: 1, maximum: 31 }, graceDays: { type: "integer", minimum: 0, maximum: 30 }, paymentInstructions: lcNull(lcString) };
const lcLeaseStatus = lcEnum(["draft", "active", "ended"]);
const lcUnitStatus = lcEnum(["active", "archived"]);
const lcStages = ["inquiry", "tour", "application", "review", "approved", "declined", "withdrawn", "converted"];
const lcApplicationStates = ["draft", "submitted", "in_review", "approved", "rejected", "withdrawn"];
const lcSources = ["phone", "email", "walk_in", "referral", "other"];
const lcProperty = lcObject({ id: lcId, name: lcString });
const lcUnitReference = lcObject({ id: lcId, label: lcString });
const lcNameEmail = lcObject({ name: lcNull(lcString), email: lcString });
const lcNameNullableEmail = lcObject({ name: lcString, email: lcNull(lcString) });
const lcUnitOutput = {
  id: lcId, propertyId: lcId, label: lcString, status: lcUnitStatus, version: lcVersion,
  bedrooms: lcNull({ type: "integer", minimum: 0, maximum: 100 }),
  bathroomsHundredths: lcNull({ type: "integer", minimum: 0, maximum: 10000, multipleOf: 25 }),
  squareFeet: lcNull({ type: "integer", minimum: 1, maximum: 10000000 }), marketRentCents: lcNull(lcCentAmount), floor: lcNull(lcString), notes: lcNull(lcString),
};
const lcUnitFields = {
  bedrooms: { anyOf: [{ type: "integer", minimum: 0, maximum: 100 }, { type: "string", pattern: "^\\d*$", nullable: true }], description: "Optional integer or digits string, including leading zeroes, from 0 through 100. Omitted/null/empty becomes null." },
  bathrooms: { type: "string", nullable: true, description: "Optional decimal STRING, from 0 through 100 in quarter increments. Omitted/null/empty becomes null; nonempty values also obey cents()'s canonical decimal grammar." },
  squareFeet: { anyOf: [{ type: "integer", minimum: 1, maximum: 10000000 }, { type: "string", pattern: "^\\d*$", nullable: true }], description: "Optional integer or digits string, including leading zeroes, from 1 through 10000000. Omitted/null/empty becomes null." },
  marketRent: { type: "string", nullable: true, description: "Optional exact USD decimal string using cents() up to 1000000 dollars. Omitted/null/empty becomes null." },
  floor: lcOptionalText(40), notes: lcOptionalText(2000),
};
const lcLeaseFields: Record<string, LcSchema> = {
  id: lcId, propertyId: lcId, unitId: lcId, residentId: lcNull(lcUserId), residentContactId: lcNull(lcId),
  resident: lcNameEmail, residentContact: lcNull(lcNameNullableEmail), startsOn: lcTimestamp, endsOn: lcNull(lcTimestamp),
  rentCents: lcCentAmount, currency: { type: "string", enum: ["USD"] }, status: lcLeaseStatus, version: lcVersion,
  ...lcPolicyOutput, unit: lcObject({ label: lcString }), property: lcObject({ name: lcString }),
  previousLeaseId: lcNull(lcId), previousLease: lcNull(lcObject({ id: lcId, endsOn: lcNull(lcTimestamp), status: lcLeaseStatus })),
  renewals: { type: "array", maxItems: 1, items: lcObject({ id: lcId, status: lcLeaseStatus, startsOn: lcTimestamp }) },
};
const lcLease = lcObject(lcLeaseFields);
const lcCurrentLease = lcObject({ ...lcLeaseFields, hasTermHistory: { type: "boolean" } });
const lcProspectRaw: Record<string, LcSchema> = {
  id: lcId, companyId: lcId, propertyId: lcId, unitId: lcNull(lcId), name: lcString, email: lcNull(lcString), phone: lcNull(lcString),
  source: lcEnum(lcSources), desiredMoveIn: lcNull(lcTimestamp), followUpOn: lcNull(lcTimestamp), notes: lcNull(lcString),
  stage: lcEnum(lcStages), version: lcVersion, contactId: lcNull(lcId), leaseId: lcNull(lcId), createdById: lcUserId, createdAt: lcTimestamp, updatedAt: lcTimestamp,
};
const { createdById: _lcCreator, ...lcProspectSelected } = lcProspectRaw;
const lcProspectFields = { ...lcProspectSelected, property: lcProperty, unit: lcNull(lcUnitReference) };
const lcProspect = lcObject(lcProspectFields);
const { companyId: _lcCompany, createdById: _lcSafeCreator, ...lcProspectSafe } = lcProspectRaw;
const lcAcquisitionProspect = lcObject({ ...lcProspectSafe, status: lcEnum(["open", "closed"]), property: lcProperty, unit: lcNull(lcUnitReference) });
const lcProspectMutation = lcObject({ prospect: lcProspect });
const lcProspectInput: Record<string, LcSchema> = {
  unitId: { anyOf: [lcId, { type: "string", nullable: true, enum: ["", null] }], description: "Optional active same-property unit. Empty/null/omitted means no preferred unit." },
  name: lcText(200), email: { ...lcOptionalText(254), description: "Optional trimmed, lowercased complete contact email. Email or phone must be present; it never establishes identity or links accounts." },
  phone: lcOptionalText(40), source: lcEnum(lcSources), desiredMoveIn: lcOptionalDay, followUpOn: lcOptionalDay, notes: lcOptionalText(2000),
};
// History contains known retained snapshot variants: ordinary source-selected
// prospect snapshots, and an application conversion's raw Prospect snapshot.
const lcProspectSnapshot = {
  anyOf: [
    lcObject({ ...lcProspectFields, reviewedContactVersion: lcVersion, reviewedLeaseVersion: lcVersion, reviewedAccountId: lcUserId, previousContactId: lcId, previousLeaseId: lcId }, Object.keys(lcProspectFields)),
    lcObject({ ...lcProspectRaw, applicationId: lcId, reviewedContactVersion: lcVersion, reviewedAccountId: lcUserId }),
  ],
  description: "Immutable historical snapshot, not current authority. Ordinary prospect actions retain selected source fields and optional reviewed/previous-link metadata. Application conversion retains raw Prospect fields plus application/account review metadata; no invented universal current-state envelope.",
};
const lcProspectHistory = lcObject({
  items: { type: "array", maxItems: 50, items: lcObject({ id: lcId, version: lcVersion, action: lcString, snapshot: lcProspectSnapshot, reason: lcString, actorId: lcUserId, createdAt: lcTimestamp }) },
  nextCursor: lcNull(lcId),
});
const lcFollowUp = lcObject({ id: lcId, propertyId: lcId, prospectId: lcId, kind: lcEnum(["tour", "task"]), title: lcString, dueOn: lcTimestamp, notes: lcString, status: lcEnum(["open", "completed", "cancelled"]), version: lcVersion, createdAt: lcTimestamp, updatedAt: lcTimestamp });
const lcApplicationFields = {
  id: lcId, propertyId: lcId, unitId: lcId, prospectId: lcId, notes: lcString, status: lcEnum(lcApplicationStates), version: lcVersion,
  contactId: lcNull(lcId), leaseId: lcNull(lcId), createdAt: lcTimestamp, updatedAt: lcTimestamp,
  property: lcProperty, unit: lcNull(lcUnitReference), prospect: lcObject({ id: lcId, name: lcString, email: lcNull(lcString) }),
};
const lcApplication = lcObject(lcApplicationFields);
const lcAdmissionEvent = lcObject({ id: lcId, entityType: lcString, action: lcString, actorName: lcString, version: lcVersion, createdAt: lcTimestamp, reason: lcNull(lcString) });
const lcAdmissionsPage = lcObject({ items: { type: "array", maxItems: 25, items: lcAdmissionEvent }, total: lcCount, page: { type: "integer", minimum: 1, maximum: 99999 }, pageSize: { type: "integer", enum: [25] } });
const lcPage25 = (items: LcSchema, company = false): LcSchema => lcObject({ ...(company ? { companyId: lcId } : {}), items: { type: "array", maxItems: 25, items }, total: lcCount, page: { type: "integer", minimum: 1, maximum: 99999 }, pageSize: { type: "integer", enum: [25] } });
const lcCursor50 = (items: LcSchema): LcSchema => lcObject({ items: { type: "array", maxItems: 50, items }, nextCursor: lcNull(lcId) });
const lcError = (description: string, codes: string[]): LcSchema => ({ description, ...lcObject({ error: lcString, code: { type: "string", description: `Known source codes: ${[...new Set(codes)].join(", ")}. Framework/driver failures use their existing normalized REQUEST_<status> code.` }, requestId: lcString }) });
type LcDefinition = {
  file: string; summary: string; description: string; permission?: "lease.manage" | "property.read" | "property.write";
  query?: LcSchema; params?: LcSchema; body?: LcSchema; response: LcSchema;
  bad?: string[]; conflicts?: string[]; unprocessable?: string[]; provider?: boolean;
};
function lcContract(operation: string, definition: LcDefinition): FastifySchema {
  const [method, path] = operation.split(" "), write = !["GET", "HEAD", "OPTIONS"].includes(method), permission = definition.permission ?? "lease.manage";
  const features = path.includes("/prospects") || path.includes("/applications") || path.includes("/rental-listing") ? ["leasing", "properties"] : permission.startsWith("property.") ? ["properties"] : ["leasing"];
  const response: Record<number, LcSchema> = {
    200: { description: "Current authorized source projection or durable operation result, using the exact handler DTO.", ...definition.response },
    400: lcError("Invalid identifier, query, field, review input or JSON body.", ["INVALID_ID", "INVALID_INPUT", ...(definition.bad ?? []), ...(write ? ["REQUEST_400"] : [])]),
    401: lcError("Current browser session is missing or expired.", ["SIGN_IN_REQUIRED"]),
    403: lcError("Current role, company/source, feature, CSRF, verification or support context denies access.", ["ACCESS_DENIED", "COMPANY_ACCESS_DENIED", "ORIGIN_REJECTED", "EMAIL_VERIFICATION_REQUIRED", "FEATURE_DISABLED", "IMPERSONATION_UNAVAILABLE", ...(write ? ["CSRF_REJECTED", "CSRF_INVALID", "IMPERSONATION_READ_ONLY", "SUBSCRIPTION_READ_ONLY"] : [])]),
    404: lcError("The source is unavailable in the actor's current authorized company/property scope.", ["NOT_FOUND", "REQUEST_404"]),
    409: lcError("Current support/source/version/submission state conflicts. Preserve uncertain original work before a new review.", ["IMPERSONATION_CONTEXT_CHANGED", "ACCESS_CONFLICT", ...(definition.conflicts ?? [])]),
    503: lcError("Service failure; a submitted operation may be uncertain. Provider preparation, when applicable, is outside the final database transaction.", ["REQUEST_503", ...(definition.provider ? ["IDENTITY_NOT_CONFIGURED", "IDENTITY_PROVIDER_UNAVAILABLE", "IDENTITY_PROFILE_INVALID"] : [])]),
  };
  if (write) { response[413] = lcError("The production JSON request exceeds its body limit.", ["REQUEST_413"]); response[415] = lcError("Unsupported request content type.", ["REQUEST_415"]); }
  if (definition.unprocessable?.length) response[422] = lcError("The requested complete source or required account cannot be represented safely.", definition.unprocessable);
  if (definition.provider) response[429] = { ...lcError("Identity service is throttled; retain the original operation and honor Retry-After when supplied.", ["IDENTITY_PROVIDER_UNAVAILABLE"]), headers: { "retry-after": { type: "string", description: "Seconds until a paced provider retry is appropriate, when supplied by the provider adapter." } } };
  const schema: FastifySchema & Record<string, unknown> = {
    operationId: `leasing_${method.toLowerCase()}_${path.replace(/^\//, "").replace(/[:/\-]/g, "_")}`,
    tags: [path.includes("/prospects") ? "Prospects" : path.includes("/applications") || path.includes("/rental-listing") ? "Rental applications" : permission.startsWith("property.") ? "Properties and units" : "Leasing"],
    summary: definition.summary,
    description: `${definition.description} Requires current ${permission}; company owners/managers normally hold this capability${permission === "property.read" ? ", with staff restricted to their granted property scope" : "; staff, residents and platform-only accounts receive no implicit management grant"}. Required company features: ${features.join(" and ")}. Feature read-only rejects mutations; disabled rejects this area. Optional X-Company-ID must match current membership. IDs are scoped through current server checks and transaction-local company RLS. Authorized support views can read permitted target projections; writes are denied while impersonating. JSON responses retain the existing no-store policy.`,
    security: [{ sessionCookie: [] }],
    headers: { type: "object", additionalProperties: true, required: write ? ["origin", "x-csrf-token"] : [], properties: {
      "x-company-id": { ...lcString, description: "Optional current membership-company fence, not an arbitrary company selector." },
      "x-impersonation-id": { ...lcString, description: "Exact current bootstrap support context; empty/omitted in own-account context." },
      ...(write ? { origin: { ...lcString, description: "Must equal configured application origin." }, "x-csrf-token": { ...lcString, description: "Current session CSRF value from bootstrap; never embed a real value in examples." } } : {}),
    } },
    querystring: definition.query ?? lcQueryIgnored,
    ...(definition.params ? { params: definition.params } : {}), ...(definition.body ? { body: definition.body } : {}), response,
    "x-pf-contract-status": "source-reviewed", "x-pf-validation-status": "not-handler-verified",
    "x-pf-sources": [definition.file, "server/src/operational.ts", "server/src/access.ts", "server/src/sessions.ts", "server/src/company-features.ts", "server/src/request-errors.ts"],
  };
  return schema;
}

const lcDefinitions: Record<string, LcDefinition> = {};

Object.assign(lcDefinitions, {
  "GET /api/company/units/:unitId": {
    file: "server/src/leasing.ts:GET /api/company/units/:unitId", permission: "property.read", summary: "Read one unit without household or financial projections",
    description: "Returns only unitSelect fields. Unknown query parameters are rejected. A staff reader's selected-property grant is intersected before finding the unit; an inaccessible unit is not disclosed.",
    params: lcObject({ unitId: lcId }), query: lcObject({}), response: lcObject(lcUnitOutput),
  },
  "GET /api/company/properties/:propertyId/units": {
    file: "server/src/leasing.ts:GET property units", permission: "property.read", summary: "List a property's units and business-date occupancy",
    description: "Up to 50 units ordered by ID descending; nextCursor does not imply a complete total. Search matches unit label or floor. Active/archived is record status. Occupancy is separately occupied only for a current active lease whose start/end includes the company business date; future/draft/ended leases do not occupy today. This does not establish physical readiness, listing intent or household/financial access. Staff property scope applies.",
    params: lcObject({ propertyId: lcId }), query: lcObject({ cursor: lcCursor, status: lcUnitStatus, q: lcSearch }, []),
    response: lcObject({ items: { type: "array", maxItems: 50, items: lcObject({ ...lcUnitOutput, occupancy: lcEnum(["occupied", "not_occupied"]) }) }, nextCursor: lcNull(lcId), occupancyAsOf: lcDay }),
  },
  "POST /api/company/properties/:propertyId/units": {
    file: "server/src/leasing.ts:POST property units", permission: "property.write", summary: "Create one property unit with a retained submission key",
    description: "Requires label and submissionKey; optional unit detail fields may be absent. Exact names are unique within the property, including archived records. Durable replay is company+creating-actor+key scoped and returns the current selected unit. Default/absent detail fingerprints preserve older clients' exact retries. The result is the unit DTO; no occupancy projection is added on creation.",
    params: lcObject({ propertyId: lcId }), body: lcObject({ label: lcText(80), submissionKey: lcKey, ...lcUnitFields }, ["label", "submissionKey"]), response: lcObject(lcUnitOutput), conflicts: ["SUBMISSION_MISMATCH", "UNIT_NAME_EXISTS"],
  },
  "PATCH /api/company/units/:unitId": {
    file: "server/src/leasing.ts:PATCH /api/company/units/:unitId", permission: "property.write", summary: "Review unit details or archive/restore its record",
    description: "Requires complete label/status/opening expectedVersion; only submitted optional detail keys change. Explicit null/empty clears an optional field; omitted detail keys retain it. Version is checked before the no-op comparison. An actual change increments version and records history. Archiving is blocked by any active lease record. Exact same-name collision is rejected. This endpoint has no submissionKey receipt; after an interrupted edit check the source/version before a new review.",
    params: lcObject({ unitId: lcId }), body: lcObject({ label: lcText(80), status: lcUnitStatus, expectedVersion: lcVersion, ...lcUnitFields }, ["label", "status", "expectedVersion"]), response: lcObject(lcUnitOutput), conflicts: ["RECORD_CHANGED", "ACTIVE_LEASE_EXISTS", "UNIT_NAME_EXISTS"],
  },
  "GET /api/company/leases": {
    file: "server/src/leasing.ts:GET /api/company/leases", summary: "List current authorized lease records with effective payment terms",
    description: "Up to 50 leases ordered by ID descending, with forward cursor and no full total. Search matches property/unit and primary tenant account/contact name/email. unitId must belong to the selected property when both are supplied; a verified unit filter adds its metadata to the response. status and attention are mutually exclusive; approvals cannot combine with either. approvals=pending requires company owner and considers unexpired pending resident invitations. Attention uses the company business date: ending_soon through 30 days, past_end, or in_effect. Effective payment terms are projected with hasTermHistory; primary resident labels prefer the retained contact. No portal grant follows from a lease record.",
    query: lcObject({ cursor: lcCursor, propertyId: lcId, unitId: lcId, status: lcLeaseStatus, attention: lcEnum(["ending_soon", "past_end", "in_effect"]), approvals: lcEnum(["pending"]), q: lcSearch }, []),
    response: lcObject({ items: { type: "array", maxItems: 50, items: lcCurrentLease }, nextCursor: lcNull(lcId), unit: lcObject({ id: lcId, label: lcString, propertyId: lcId, status: lcUnitStatus, version: lcVersion }) }, ["items", "nextCursor"]), unprocessable: ["TERM_SCOPE_TOO_LARGE"],
  },
  "POST /api/company/leases": {
    file: "server/src/leasing.ts:POST /api/company/leases; server/src/resident-accounts.ts; server/src/resident-contacts.ts", summary: "Create a canonical lease or a linked renewal draft",
    description: "Choose exactly one non-null primary residentContactId or legacy residentId. Contact IDs are company tenant records; residentId is an exact opaque account ID. endsOn must be explicitly null or a valid date, never before startsOn; ended status requires an end date. Payment policy fields default to due day 1/grace 0/no instructions. Optional previousLeaseId requires expectedPreviousVersion and the exact same property/unit/primary tenant; only one linked draft renewal may follow a non-draft prior term with an end date strictly before the new start. Existing eligible household members are copied with separate account preparation and portal approval false; invitations, money and portal access are not copied. Non-null account preparation may contact Auth0 before the final fresh transaction and cannot be atomically rolled back with it. Durable replay reuses company/creator/submission fingerprint and returns the existing selected lease, even after tenant access changes. Active status reserves the unit's single active lease slot; historical financial state is not created or recalculated.",
    body: {
      ...lcObject({ propertyId: lcId, unitId: lcId, residentId: lcNull(lcUserId), residentContactId: lcNull(lcId), startsOn: lcDay, endsOn: lcNull(lcDay), monthlyRent: lcMoney, status: lcLeaseStatus, submissionKey: lcKey, previousLeaseId: lcNull(lcId), expectedPreviousVersion: lcVersion, ...lcPolicyInput }, ["propertyId", "unitId", "startsOn", "endsOn", "monthlyRent", "status", "submissionKey"]),
      allOf: [
        { oneOf: [
          { required: ["residentId"], properties: { residentId: lcUserId, residentContactId: { type: "string", nullable: true, enum: [null] } } },
          { required: ["residentContactId"], properties: { residentContactId: lcId, residentId: { type: "string", nullable: true, enum: [null] } } },
        ] },
        { anyOf: [
          { properties: { previousLeaseId: { type: "string", nullable: true, enum: [null] } }, not: { required: ["expectedPreviousVersion"] } },
          { required: ["previousLeaseId", "expectedPreviousVersion"], properties: { previousLeaseId: lcId, expectedPreviousVersion: lcVersion } },
        ] },
        { anyOf: [ { properties: { status: lcEnum(["draft", "active"]) } }, { properties: { status: lcEnum(["ended"]), endsOn: lcDay } } ] },
      ],
    },
    response: lcLease, conflicts: ["SUBMISSION_MISMATCH", "RECORD_CHANGED", "RESIDENT_INELIGIBLE", "TENANT_ARCHIVED", "UNIT_ARCHIVED", "ACTIVE_LEASE_EXISTS", "ACCOUNT_REQUIRED", "IDENTITY_CONFLICT", "IDENTITY_EMAIL_CONFLICT", "IDENTITY_AMBIGUOUS", "CONTACT_LINK_CONFLICT", "RESIDENT_CONTACT_UNAVAILABLE", "RENEWAL_EXISTS", "RENEWAL_TERMS_INVALID"], unprocessable: ["HOUSEHOLD_SCOPE_TOO_LARGE", "ACCOUNT_EMAIL_REQUIRED"], provider: true,
  },
  "GET /api/company/leases/:leaseId": {
    file: "server/src/leasing.ts:GET /api/company/leases/:leaseId; server/src/lease-term-policy.ts", summary: "Read a lease, effective terms and current setup facts",
    description: "Unknown query parameters are rejected. Projects effective company-date payment terms and hasTermHistory. overview.householdCount counts only nonremoved participants effective today, not future/former household. Pending approvals are omitted when resident_portal is disabled. When finances is disabled, overview omits schedule/deposit facts and returns financeAvailable=false; otherwise scheduleStatus is active/paused/null and depositRecorded means an account exists, not that money was received. Read projections never imply physical move-in, first sign-in or portal access.",
    params: lcObject({ leaseId: lcId }), query: lcObject({}),
    response: lcObject({ ...lcLeaseFields, hasTermHistory: { type: "boolean" }, overview: lcObject({ householdCount: lcCount, pendingApprovals: lcCount, scheduleStatus: lcNull(lcEnum(["active", "paused"])), depositRecorded: { type: "boolean" }, financeAvailable: { type: "boolean", enum: [false] } }, ["householdCount"]) }), unprocessable: ["TERM_SCOPE_TOO_LARGE"],
  },
  "PATCH /api/company/leases/:leaseId": {
    file: "server/src/leasing.ts:PATCH /api/company/leases/:leaseId; server/src/lease-term-policy.ts; server/src/payment-policy.ts", summary: "Review and change permitted recorded lease dates/status/setup",
    description: "Requires startsOn, explicitly nullable endsOn, monthlyRent, status and expectedVersion; optional policy fields patch only when present. This is a version-based edit, not a durable submission-key operation. Retained term changes preserve the baseline: use future-term review to change payment terms, and do not shorten dates over retained changes. Linked renewal boundaries must remain ordered. Active/paused recurring schedules block billing-affecting edits. Posted rent, payments and recorded deposits prevent conflicting date/status changes or a return to draft; amounts are never recalculated. Ended historical records can be edited after resident access changes; other statuses require an eligible primary tenant and active unit, and active status checks the unit's single active lease slot. The returned DTO uses current effective terms.",
    params: lcObject({ leaseId: lcId }), body: lcObject({ startsOn: lcDay, endsOn: lcNull(lcDay), monthlyRent: lcMoney, status: lcLeaseStatus, expectedVersion: lcVersion, ...lcPolicyInput }, ["startsOn", "endsOn", "monthlyRent", "status", "expectedVersion"]), response: lcCurrentLease,
    conflicts: ["RECORD_CHANGED", "LEASE_VERSIONED_TERMS", "LEASE_TERM_CONFLICT", "RENEWAL_TERMS_INVALID", "RENEWAL_TERM_CONFLICT", "LEASE_SCHEDULE_CONFLICT", "LEASE_DEPOSIT_CONFLICT", "LEASE_RENT_CONFLICT", "RESIDENT_INELIGIBLE", "TENANT_ARCHIVED", "UNIT_ARCHIVED", "ACTIVE_LEASE_EXISTS"], unprocessable: ["TERM_SCOPE_TOO_LARGE"],
  },
  "GET /api/company/prospects": {
    file: "server/src/prospects.ts:GET /api/company/prospects", summary: "List inquiries with complete stage counts and follow-up views",
    description: "Up to 50 prospects ordered by ID descending. Search covers name/email/phone/property/unit. due uses the company business date: overdue, today, or today through 7 days for upcoming, excluding declined/withdrawn/converted. counts covers every defined stage under property/search/due filters before selected-stage and cursor filtering; total is the selected stage count or their sum. The visible page alone is not the total. Forward source-ID cursor has no previous-page field. A prospect is a contact inquiry, not an account or tenant grant.",
    query: lcObject({ propertyId: lcId, q: lcSearch, stage: lcEnum(lcStages), due: lcEnum(["overdue", "today", "upcoming"]), cursor: lcCursor }, []),
    response: lcObject({ today: lcDay, timezone: lcString, items: { type: "array", maxItems: 50, items: lcProspect }, counts: lcObject(Object.fromEntries(lcStages.map(stage => [stage, lcCount]))), total: lcCount, nextCursor: lcNull(lcId) }),
  },
  "POST /api/company/prospects": {
    file: "server/src/prospects.ts:POST /api/company/prospects", summary: "Record one inquiry with contact details and a creation reason",
    description: "Requires propertyId/name/source/reason/submissionKey and at least one nonempty email or phone. Optional unit must be active in that property. Omitted/null/empty optional values become null. Creates stage inquiry/version 1 and immutable action/audit. Durable company-wide submission receipt returns the current source on an exact replay; changing the payload/key pairing conflicts. Contact email is normalized for contact use, never an identity link.",
    body: lcObject({ propertyId: lcId, ...lcProspectInput, reason: lcReason, submissionKey: lcKey }, ["propertyId", "name", "source", "reason", "submissionKey"]), response: lcProspectMutation, bad: ["CONTACT_REQUIRED"], conflicts: ["SUBMISSION_MISMATCH", "UNIT_UNAVAILABLE"],
  },
  "GET /api/company/prospects/recovery/:submissionKey": {
    file: "server/src/prospects.ts:GET prospect recovery", summary: "Check whether this actor's inquiry submission has a visible receipt",
    description: "The path key is validated as UUIDv4. Looks up an action for current company and exact effective actor; receipt absence is not proof that an in-flight request cannot later commit. Returns a current selected prospect when visible and a safe review summary either way. Stopping browser retry does not cancel an already submitted operation. Other query fields are ignored.",
    params: lcObject({ submissionKey: lcKey }), response: lcObject({ companyId: lcId, receiptRecorded: { type: "boolean" }, prospect: lcNull(lcProspect), request: lcObject({ id: lcKey, title: lcString, version: lcNull(lcVersion), status: lcString, notes: lcString }) }),
  },
  "GET /api/company/prospects/:prospectId": {
    file: "server/src/prospects.ts:GET prospect detail", summary: "Read an inquiry and its first retained action-history page",
    description: "Returns current selected prospect plus up to 50 actions, ID descending. History snapshots are immutable historical values, not current access. Additional action pages use the separate history endpoint; no complete history total is supplied. Query parameters are ignored.",
    params: lcObject({ prospectId: lcId }), response: lcObject({ prospect: lcProspect, history: lcProspectHistory }),
  },
  "GET /api/company/prospects/:prospectId/history": {
    file: "server/src/prospects.ts:GET prospect history", summary: "Page the inquiry's immutable prospect action history",
    description: "Only the optional cursor query is accepted. Current prospect access is checked before returning up to 50 actions in descending ID order. This is the ProspectAction log; acquisition/follow-up history is a separate projection. There is no complete total or previous cursor.",
    params: lcObject({ prospectId: lcId }), query: lcObject({ cursor: lcCursor }, []), response: lcProspectHistory,
  },
  "PATCH /api/company/prospects/:prospectId": {
    file: "server/src/prospects.ts:PATCH prospect", summary: "Review and replace an inquiry's mutable contact/source details",
    description: "This PATCH supplies name/source/reason/version/key and replaces the complete mutable detail set: omitted optional fields clear to null. Requires email or phone. Current record is locked before durable receipt replay; an exact previous receipt returns current source before stale-version checks. Converted inquiries are retained and cannot be edited here. Submitted/in-review/approved unconverted applications block contact-detail changes. The property cannot be changed; optional unit must remain active in that property. Actual updates increment version and retain the action reason.",
    params: lcObject({ prospectId: lcId }), body: lcObject({ expectedVersion: lcVersion, ...lcProspectInput, reason: lcReason, submissionKey: lcKey }, ["expectedVersion", "name", "source", "reason", "submissionKey"]), response: lcProspectMutation, bad: ["CONTACT_REQUIRED"], conflicts: ["SUBMISSION_MISMATCH", "PROSPECT_CONVERTED", "RECORD_CHANGED", "APPLICATION_REVIEW_ACTIVE", "UNIT_UNAVAILABLE"],
  },
  "POST /api/company/prospects/:prospectId/stage": {
    file: "server/src/prospects.ts:POST prospect stage", summary: "Record a reasoned inquiry-stage decision",
    description: "The recorded stage may be any defined stage except converted, which belongs to explicit source conversion. An already converted source is immutable here. Declined/withdrawn sources must first reopen into inquiry or review before another decision. An exact company-wide submission receipt returns current prospect before the version/state review. Each new decision increments version and records reason/history.",
    params: lcObject({ prospectId: lcId }), body: lcObject({ expectedVersion: lcVersion, stage: lcEnum(lcStages.filter(stage => stage !== "converted")), reason: lcReason, submissionKey: lcKey }), response: lcProspectMutation, conflicts: ["SUBMISSION_MISMATCH", "PROSPECT_CONVERTED", "RECORD_CHANGED", "REOPEN_REVIEW_REQUIRED"],
  },
  "GET /api/company/prospects/:prospectId/conversion-options": {
    file: "server/src/prospects.ts:GET conversion options", summary: "Review eligible existing tenants and leases for an approved inquiry",
    description: "Requires approved prospect. Contacts are active current-company profiles with an active exact existing account binding and compatible current/no membership; no account/name/email auto-link occurs. Contact search and cursor apply independently from a selected contact's leaseCursor. When contactId is selected, eligible draft/active leases must use that exact primary contact and property/preferred unit and an active unit. Each list is independently bounded to50; there are no complete totals. Selected contacts outside current eligibility fail instead of falling back.",
    params: lcObject({ prospectId: lcId }), query: lcObject({ q: lcSearch, cursor: lcCursor, contactId: lcId, leaseCursor: lcCursor }, []),
    response: lcObject({ contacts: { type: "array", maxItems: 50, items: lcObject({ id: lcId, name: lcString, email: lcNull(lcString), version: lcVersion }) }, nextCursor: lcNull(lcId), leases: { type: "array", maxItems: 50, items: lcObject({ id: lcId, version: lcVersion, propertyId: lcId, unitId: lcId, startsOn: lcTimestamp, endsOn: lcNull(lcTimestamp), status: lcEnum(["draft", "active"]), unit: lcUnitReference }) }, nextLeaseCursor: lcNull(lcId) }), conflicts: ["APPROVAL_REQUIRED", "CONTACT_UNAVAILABLE"],
  },
  "POST /api/company/prospects/:prospectId/convert": {
    file: "server/src/prospects.ts:POST convert; server/src/resident-accounts.ts:requireContactAccount", summary: "Link an approved inquiry to an explicitly reviewed existing tenant and lease",
    description: "Requires literal confirmedMatch=true and current prospect/contact/lease versions. Existing contact must have exact prepared account identity and compatible active company access; an email alone never establishes a match. The lease must belong to the exact tenant contact and property/preferred unit, be draft/active, use an active unit and not already be linked to another prospect. No people or leases are merged or created and no portal grant follows. Conversion sets stage converted and retains reviewed account/source IDs. Exact company-wide submission receipt returns current source; stale reviews otherwise conflict.",
    params: lcObject({ prospectId: lcId }), body: lcObject({ expectedVersion: lcVersion, contactId: lcId, expectedContactVersion: lcVersion, leaseId: lcId, expectedLeaseVersion: lcVersion, confirmedMatch: { type: "boolean", enum: [true] }, reason: lcReason, submissionKey: lcKey }), response: lcProspectMutation, bad: ["MATCH_REVIEW_REQUIRED"], conflicts: ["SUBMISSION_MISMATCH", "PROSPECT_CONVERTED", "RECORD_CHANGED", "APPROVAL_REQUIRED", "ACCOUNT_REQUIRED", "CONTACT_UNAVAILABLE", "LEASE_PARTY_MISMATCH", "LEASE_UNAVAILABLE", "UNIT_ARCHIVED", "LEASE_ALREADY_LINKED"],
  },
  "POST /api/company/prospects/:prospectId/reopen-conversion": {
    file: "server/src/prospects.ts:POST reopen conversion", summary: "Deliberately reopen only the inquiry's retained conversion link",
    description: "Requires literal confirmedUnlink=true, reason, current expectedVersion and durable key. Only a converted source with contact/lease links can reopen. Clears this prospect's links and returns to review; existing tenant, lease, money, household and access remain unchanged. Previous contact/lease IDs stay in immutable history. Exact receipt replay returns current source without recreating or changing the linked business records.",
    params: lcObject({ prospectId: lcId }), body: lcObject({ expectedVersion: lcVersion, confirmedUnlink: { type: "boolean", enum: [true] }, reason: lcReason, submissionKey: lcKey }), response: lcProspectMutation, bad: ["UNLINK_REVIEW_REQUIRED"], conflicts: ["SUBMISSION_MISMATCH", "RECORD_CHANGED", "CONVERSION_REQUIRED"],
  },
} satisfies Record<string, LcDefinition>);

Object.assign(lcDefinitions, {
  "POST /api/company/units/:unitId/rental-listing": {
    file: "server/src/rental-applications.ts:POST rental listing", summary: "Record an owner's explicit rental-listing intent",
    description: "Additionally requires an active current company owner, not merely lease.manage. forRent is independent of physical availability/readiness and occupancy. Both expectedVersion and expectedAvailabilityVersion are required and explicitly null for an absent respective record. Current listing and readiness versions must match before a new action; an active unit is required. Listing for rent preserves the existing listedAt or sets now; unlisting clears it. Every nonreplayed action increments/creates listing version and retains admissions/audit history. Exact actor/company submission replay returns current listing fields, or null if no current listing remains; no public listing/provider integration is created.",
    params: lcObject({ unitId: lcId }), body: lcObject({ forRent: { type: "boolean" }, expectedVersion: lcNull(lcVersion), expectedAvailabilityVersion: lcNull(lcVersion), reason: lcReason, submissionKey: lcKey }),
    response: lcNull(lcObject({ version: lcVersion, forRent: { type: "boolean" }, listedAt: lcNull(lcTimestamp) })), conflicts: ["SUBMISSION_MISMATCH", "RECORD_CHANGED", "UNIT_ARCHIVED"],
  },
  "GET /api/company/units/:unitId/rental-listing/history": {
    file: "server/src/rental-applications.ts:GET rental listing history", summary: "Page retained rental-listing decisions for an authorized unit",
    description: "Requires the unit in the current company and only the optional page query. Returns 25 admission events at most, createdAt descending then ID descending, with complete history total and page/pageSize. actorName is the current recorded actor name or the safe management fallback; raw snapshots and submission hashes are not returned.",
    params: lcObject({ unitId: lcId }), query: lcObject({ page: lcPageInput }, []), response: lcAdmissionsPage,
  },
  "GET /api/company/prospects/:prospectId/follow-ups": {
    file: "server/src/rental-applications.ts:GET prospect follow-ups", summary: "List an inquiry's tours and follow-up tasks",
    description: "Requires the current company inquiry. status defaults to all, including when its query value is empty; kind similarly defaults to all. page is a decimal string. Returns up to 25 matching records ordered dueOn ascending then ID ascending, complete filtered total and integer page/pageSize. Safe output omits companyId and no provider/calendar event is implied.",
    params: lcObject({ prospectId: lcId }), query: lcObject({ page: lcPageInput, status: lcEnum(["", "all", "open", "completed", "cancelled"]), kind: lcEnum(["", "all", "tour", "task"]) }, []), response: lcPage25(lcFollowUp),
  },
  "GET /api/company/prospects/:prospectId/acquisition": {
    file: "server/src/rental-applications.ts:GET prospect acquisition", summary: "Read an inquiry with connected follow-ups, applications and recent history",
    description: "Returns the safe decorated inquiry with derived status open/closed, the first 25 follow-ups (dueOn/ID ascending), first 25 applications (createdAt/ID descending) and first 25 admissions-history items. followUpTotal, applicationTotal and historyTotal are complete respective counts; embedded arrays are bounded previews, not full histories. Application/history pagination has separate endpoints. The admissions history combines prospect events and follow-up events whose retained snapshot references this prospect; it is distinct from the ProspectAction snapshot log.",
    params: lcObject({ prospectId: lcId }), response: lcObject({ companyId: lcId, prospect: lcAcquisitionProspect, followUps: { type: "array", maxItems: 25, items: lcFollowUp }, applications: { type: "array", maxItems: 25, items: lcApplication }, followUpTotal: lcCount, applicationTotal: lcCount, history: { type: "array", maxItems: 25, items: lcAdmissionEvent }, historyTotal: lcCount }),
  },
  "GET /api/company/prospects/:prospectId/acquisition-history": {
    file: "server/src/rental-applications.ts:GET acquisition history", summary: "Page inquiry acquisition/follow-up event summaries",
    description: "Only the optional decimal-string page is accepted. Checks current inquiry access and returns 25 event summaries at most, complete total and integer page/pageSize. Includes inquiry events plus follow-up events linked through their retained prospectId snapshot. No raw snapshot, submission key/hash or actor identifier is exposed by this projection.",
    params: lcObject({ prospectId: lcId }), query: lcObject({ page: lcPageInput }, []), response: lcAdmissionsPage,
  },
  "GET /api/company/applications/:id/history": {
    file: "server/src/rental-applications.ts:GET application history", summary: "Page an application's retained decision history",
    description: "Only the optional decimal-string page is accepted. Checks current application access; returns 25 event summaries at most in createdAt/ID descending order with complete total. Returned reason is the retained string when present, otherwise null. Raw snapshots, submission hashes and private provider values are not returned.",
    params: lcObject({ id: lcId }), query: lcObject({ page: lcPageInput }, []), response: lcAdmissionsPage,
  },
  "GET /api/company/prospects/:prospectId/follow-ups/:followUpId": {
    file: "server/src/rental-applications.ts:GET follow-up detail", summary: "Read one follow-up at its exact parent inquiry",
    description: "Checks both the company inquiry and the exact follow-up's prospectId/company binding. Safe follow-up fields include the source property and prospect IDs but omit company/internal creation/submission fields. No external tour booking is implied.",
    params: lcObject({ prospectId: lcId, followUpId: lcId }), response: lcObject({ companyId: lcId, followUp: lcFollowUp }),
  },
  "POST /api/company/prospects/:prospectId/follow-ups": {
    file: "server/src/rental-applications.ts:POST follow-up", summary: "Record an inquiry tour or follow-up task",
    description: "Requires kind/title/dueOn/submissionKey; optional notes null/empty/omitted becomes an empty string. dueOn is a validated business day stored/returned as DateTime JSON. New follow-ups require an open prospect stage: declined, withdrawn and converted inquiries must reopen first. Durable receipts are current company+actor scoped; exact replay returns the current safe follow-up after the parent remains accessible. No external calendar event, reminder delivery or source-stage change is created.",
    params: lcObject({ prospectId: lcId }), body: lcObject({ kind: lcEnum(["tour", "task"]), title: lcText(160), dueOn: lcDay, notes: lcOptionalText(2000), submissionKey: lcKey }, ["kind", "title", "dueOn", "submissionKey"]), response: lcFollowUp, conflicts: ["SUBMISSION_MISMATCH", "PROSPECT_CLOSED"],
  },
  "PATCH /api/company/prospects/:prospectId/follow-ups/:followUpId": {
    file: "server/src/rental-applications.ts:PATCH follow-up", summary: "Review follow-up details and record completion/cancellation",
    description: "Requires the entire kind/title/dueOn/status detail set plus expectedVersion/submissionKey. Omitted/null/empty notes clears to empty string. Current parent and exact follow-up are checked before returning an exact previous receipt. New edits require the current follow-up version, increment it and retain an edited event; changing this follow-up does not change prospect stage. Unlike creation, this handler does not prohibit edits merely because the parent is now closed.",
    params: lcObject({ prospectId: lcId, followUpId: lcId }), body: lcObject({ kind: lcEnum(["tour", "task"]), title: lcText(160), dueOn: lcDay, notes: lcOptionalText(2000), status: lcEnum(["open", "completed", "cancelled"]), expectedVersion: lcVersion, submissionKey: lcKey }, ["kind", "title", "dueOn", "status", "expectedVersion", "submissionKey"]), response: lcFollowUp, conflicts: ["SUBMISSION_MISMATCH", "RECORD_CHANGED"],
  },
  "GET /api/company/applications": {
    file: "server/src/rental-applications.ts:GET applications", summary: "List filtered rental applications with complete counts",
    description: "Uses database-filtered pagination, up to 25 rows ordered createdAt descending then ID descending. Optional property/unit/prospect filters remain current-company scoped; when propertyId is supplied unitId must belong to it. Search matches prospect name/email; empty q means no search. status omitted/empty means all. Unknown query keys are rejected; page is a decimal string. Response has complete filtered total, integer page/pageSize and decorated source property/unit/prospect labels. Application notes/decisions are management records, not screening-provider results.",
    query: lcObject({ propertyId: lcId, unitId: lcId, prospectId: lcId, q: lcSearch, status: lcEnum(["", "all", ...lcApplicationStates]), page: lcPageInput }, []), response: lcPage25(lcApplication, true),
  },
  "POST /api/company/applications": {
    file: "server/src/rental-applications.ts:POST applications", summary: "Prepare a draft application from an existing inquiry",
    description: "Requires prospectId/unitId/current expectedProspectVersion/submissionKey. Optional notes clears to empty when null/empty/omitted. Prospect must remain open and have a complete email; unit must be active in the inquiry's property. Another draft/submitted/in-review/approved application for this prospect/unit with no linked lease blocks duplication. Creates a draft/version 1, admission history and audit. Exact company+actor key replay returns the current decorated application after the inquiry remains accessible. No approval, tenant identity, signed lease or payment is created.",
    body: lcObject({ prospectId: lcId, unitId: lcId, notes: lcOptionalText(2000), expectedProspectVersion: lcVersion, submissionKey: lcKey }, ["prospectId", "unitId", "expectedProspectVersion", "submissionKey"]), response: lcApplication, conflicts: ["SUBMISSION_MISMATCH", "PROSPECT_CLOSED", "RECORD_CHANGED", "UNIT_ARCHIVED", "APPLICATION_EXISTS"],
  },
  "GET /api/company/applications/:id": {
    file: "server/src/rental-applications.ts:GET application detail", summary: "Read an application, its inquiry and recent decision summaries",
    description: "Checks the exact current company application and its parent prospect. Returns safe decorated source records, first 25 admission summaries and complete historyTotal. Embedded history is a preview; use the history endpoint to page it. Internal company/creator/submission fields are omitted from safe records; derived inquiry status is open/closed and remains distinct from application status.",
    params: lcObject({ id: lcId }), response: lcObject({ companyId: lcId, application: lcApplication, prospect: lcAcquisitionProspect, history: { type: "array", maxItems: 25, items: lcAdmissionEvent }, historyTotal: lcCount }),
  },
  "PATCH /api/company/applications/:id": {
    file: "server/src/rental-applications.ts:PATCH application notes", summary: "Review and replace an unconverted application's management notes",
    description: "Requires expectedVersion/submissionKey; notes omitted/null/empty clears to an empty string. Exact company+actor receipt returns current application before checking a newer source version. New edits require the current version and no linked lease; converted application notes remain retained. Each new edit increments version and records immutable history. Unit, applicant identity, prospect and decision status are not editable here.",
    params: lcObject({ id: lcId }), body: lcObject({ notes: lcOptionalText(2000), expectedVersion: lcVersion, submissionKey: lcKey }, ["expectedVersion", "submissionKey"]), response: lcApplication, conflicts: ["SUBMISSION_MISMATCH", "RECORD_CHANGED", "APPLICATION_CONVERTED"],
  },
  "POST /api/company/applications/:id/actions": {
    file: "server/src/rental-applications.ts:POST application actions", summary: "Record an explicitly reviewed application-stage decision",
    description: "Requires current application and prospect versions, a nonempty reason up to 1000 characters and a retained key. Allowed source stages: submit from draft; review from submitted; approve/reject from in_review; withdraw from draft/submitted/in_review/approved; reopen from approved/rejected/withdrawn (withdrawn reopens to draft, other decisions to in_review). A linked lease blocks new decisions. submit/review/approve also require an open prospect. Reopening cannot create a second open application for the same inquiry/unit. Exact company+actor replay returns current application before a new stage review; it does not reapply an old decision. All new actions increment version and retain the reason.",
    params: lcObject({ id: lcId }), body: lcObject({ action: lcEnum(["submit", "review", "approve", "reject", "withdraw", "reopen"]), reason: lcText(1000), expectedVersion: lcVersion, expectedProspectVersion: lcVersion, submissionKey: lcKey }), response: lcApplication,
    conflicts: ["SUBMISSION_MISMATCH", "RECORD_CHANGED", "APPLICATION_CONVERTED", "PROSPECT_CLOSED", "APPLICATION_STAGE_CHANGED", "APPLICATION_EXISTS"],
  },
  "GET /api/company/applications/:id/conversion-candidates": {
    file: "server/src/rental-applications.ts:GET conversion candidates", summary: "Find current tenant profiles for an explicit application conversion review",
    description: "Checks current company application and parent inquiry. Candidates are active profiles with contact email matching the inquiry case-insensitively; name search is optional. They may have no account yet or an active account with no membership/current resident membership. The list itself neither grants portal access nor proves an exact identity. No application approval is required just to read these candidates; actual conversion performs a new review. Returns up to 25 records ordered name then ID ascending with complete count. userId is an opaque account ID or null; email remains nullable in the underlying projection, not an invented account identifier.",
    params: lcObject({ id: lcId }), query: lcObject({ q: lcSearch, page: lcPageInput }, []),
    response: lcPage25(lcObject({ id: lcId, name: lcString, email: lcNull(lcString), userId: lcNull(lcUserId), version: lcVersion, status: lcEnum(["active"]) })),
  },
  "POST /api/company/applications/:id/convert": {
    file: "server/src/rental-applications.ts:POST convert; server/src/resident-accounts.ts:prepareAccount/saveAccount; server/src/payment-policy.ts", summary: "Prepare one exact tenant account/profile and a linked draft lease",
    description: "Requires literal confirmedMatch=true, current application/prospect versions, reason, start date, exact monthly rent and retained key. Application must be approved, unlinked and belong to an open prospect with a complete email. Optional contactId chooses an existing current profile and requires expectedContactVersion; without contactId that version field is ignored and the handler prepares a profile only if no existing profile needs explicit review. A selected email must still match the inquiry; exact Auth0 issuer/subject binding is checked. Optional endsOn null/empty/omitted is open-ended and otherwise cannot precede startsOn; payment policy defaults to due day 1/grace 0/no instructions. Provider account preparation occurs outside final DB locks and may outlive a later source conflict; no automatic rollback/merge by email is promised. The final transaction rechecks all versions/unit/account/contact scope, creates one draft lease and primary leaseholder with portalApproved=false, retains conversion history and links the prospect. It sends no invitation, collects no money and starts no recurring billing. Exact company+actor replay returns current linked sources. leaseHref/contactHref are internal JSON links, not HTTP redirects.",
    params: lcObject({ id: lcId }),
    body: {
      ...lcObject({ expectedVersion: lcVersion, expectedProspectVersion: lcVersion, confirmedMatch: { type: "boolean", enum: [true] }, reason: lcReason, contactId: lcNull(lcId), expectedContactVersion: { description: "Required positive safe integer when contactId is non-null; otherwise this field is ignored without type validation." }, startsOn: lcDay, endsOn: lcOptionalDay, monthlyRent: lcMoney, ...lcPolicyInput, submissionKey: lcKey }, ["expectedVersion", "expectedProspectVersion", "confirmedMatch", "reason", "startsOn", "monthlyRent", "submissionKey"]),
      anyOf: [
        { required: ["contactId", "expectedContactVersion"], properties: { contactId: lcId, expectedContactVersion: lcVersion } },
        { properties: { contactId: { type: "string", nullable: true, enum: [null] } } },
      ],
    },
    response: lcObject({ application: lcApplication, contactId: lcId, leaseId: lcId, leaseHref: { type: "string", pattern: "^/company/leases/", description: "Exact created/replayed draft lease link with onboarding=household." }, contactHref: { type: "string", pattern: "^/company/tenants/" } }),
    conflicts: ["SUBMISSION_MISMATCH", "RECORD_CHANGED", "PROSPECT_CLOSED", "APPLICATION_NOT_CONVERTIBLE", "CONTACT_EMAIL_CHANGED", "IDENTITY_CONFLICT", "IDENTITY_EMAIL_CHANGED", "IDENTITY_EMAIL_CONFLICT", "IDENTITY_AMBIGUOUS", "UNIT_UNAVAILABLE", "CONTACT_REVIEW_REQUIRED", "TENANT_ARCHIVED", "CONTACT_LINK_CONFLICT"], unprocessable: ["ACCOUNT_EMAIL_REQUIRED"], provider: true,
  },
} satisfies Record<string, LcDefinition>);

const lcMainContracts: Record<string, FastifySchema> = Object.fromEntries(Object.entries(lcDefinitions).map(([operation, definition]) => [operation, lcContract(operation, definition)]));


// Source-reviewed reference schemas only; never attach to runtime route.schema.
type LaJson = Record<string, unknown>;
type LaDoc = FastifySchema & Record<string, unknown>;
const laText: LaJson = { type: "string" };
const laBool: LaJson = { type: "boolean" };
const laVersion: LaJson = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const laCount: LaJson = { type: "integer", minimum: 0 };
const laTimestamp: LaJson = { type: "string", format: "date-time" };
const laNullableTimestamp: LaJson = { ...laTimestamp, nullable: true };
const laDay: LaJson = { type: "string", format: "date", pattern: "^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$" };
const laNullableDay: LaJson = { ...laDay, nullable: true };
const laId: LaJson = { type: "string", minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9][A-Za-z0-9_|:@.\\-]{0,199}$" };
const laNullableId: LaJson = { ...laId, nullable: true };
const laKey: LaJson = {
  type: "string", format: "uuid",
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
  description: "UUIDv4 retained with the original reviewed payload; shared helper normalizes case before durable comparison.",
};
const laStates = ["occupied", "future_occupancy", "ready", "turnover", "unavailable", "unconfirmed", "archived"];
const laConditions = ["ready", "turnover", "unavailable", "unconfirmed"];
function laObject(properties: Record<string, LaJson>, required = Object.keys(properties), description?: string): LaJson {
  return { type: "object", properties, required, additionalProperties: false, ...(description ? { description } : {}) };
}
function laNonNul(max: number, description?: string): LaJson {
  return { type: "string", maxLength: max, pattern: "^[^\\u0000]*$", ...(description ? { description } : {}) };
}
function laRequiredText(max: number): LaJson {
  return { type: "string", minLength: 1, maxLength: max, pattern: "^[^\\u0000]*$", description: "Must contain non-whitespace text; trimmed by the existing validator." };
}
const laIgnoredQuery: LaJson = { type: "object", additionalProperties: true, description: "The handler does not inspect query parameters. They add no filters, paging or scope." };
function laHeaders(write: boolean): LaJson {
  return {
    type: "object", additionalProperties: true,
    required: write ? ["origin", "x-csrf-token"] : [],
    properties: {
      "x-company-id": { ...laText, description: "Optional scope fence: when supplied must match the effective actor's current membership company, never a company selector or permission grant." },
      "x-impersonation-id": { ...laText, description: "Exact current bootstrap support-view context; omitted/empty in ordinary account context. Stale tabs are rejected." },
      ...(write ? {
        origin: { ...laText, description: "Configured same-origin application origin." },
        "x-csrf-token": { ...laText, description: "Current session CSRF value; no real credential belongs in documentation examples." },
      } : {}),
    },
  };
}
function laError(description: string, codes: string[]): LaJson {
  return { description, ...laObject({ error: laText, code: { type: "string", enum: [...new Set(codes)] }, requestId: laText }) };
}
function laErrors(write: boolean, bad: string[] = [], missing: string[] = [], conflicts: string[] = []): Record<number, LaJson> {
  const responses: Record<number, LaJson> = {
    401: laError("Missing, expired or invalid server session.", ["SIGN_IN_REQUIRED"]),
    403: laError("Current role, company, feature, verification, support view, origin or CSRF authority rejects this request.", [
      "ORIGIN_REJECTED", "EMAIL_VERIFICATION_REQUIRED", "IMPERSONATION_UNAVAILABLE", "ACCESS_DENIED", "COMPANY_ACCESS_DENIED", "FEATURE_DISABLED",
      ...(write ? ["CSRF_REJECTED", "CSRF_INVALID", "IMPERSONATION_READ_ONLY", "SUBSCRIPTION_READ_ONLY"] : []),
    ]),
    409: laError("Context/transaction changed or the operation conflicts with a reviewed source; preserve uncertain work before a fresh review.", ["IMPERSONATION_CONTEXT_CHANGED", "ACCESS_CONFLICT", ...conflicts]),
    503: laError("Unexpected service failure; a submitted write can have an uncertain outcome.", ["REQUEST_503"]),
  };
  if (bad.length || write) responses[400] = laError("Invalid parameters, JSON/body fields or current business input.", [...bad, ...(write ? ["REQUEST_400"] : [])]);
  if (missing.length) responses[404] = laError("The current authorized source is unavailable.", missing);
  if (write) {
    responses[413] = laError("The request exceeds this route's production body-size limit.", ["REQUEST_413"]);
    responses[415] = laError("Submit the supported JSON content type.", ["REQUEST_415"]);
  }
  return responses;
}
function laReviewed(source: string, capability: "lease.manage" | "property.write", write: boolean, schema: LaDoc): FastifySchema {
  return {
    ...schema,
    security: [{ sessionCookie: [] }],
    headers: laHeaders(write),
    "x-pf-contract-status": "source-reviewed",
    "x-pf-validation-status": "not-handler-verified",
    "x-pf-sources": [source, "server/src/operational.ts", "server/src/application.ts:assignmentId/serializable", "server/src/company-features.ts", "server/src/sessions.ts", "server/src/request-errors.ts"],
    "x-pf-access": {
      capability,
      audience: "Current active company owner/manager with the required capability; staff, residents and platform-only authority do not acquire it.",
      scope: "Fresh effective actor membership, matching optional company header, transaction-local company context/RLS and exact current source checks.",
      support: write ? "Writes are rejected during impersonation." : "Authorized target reads only, with exact support context and current source authority.",
    },
  } as LaDoc;
}

const laPropertySummary = laObject({ id: laId, name: laText, version: laVersion });
const laAvailabilityCurrent = laObject({
  version: laVersion,
  condition: { type: "string", enum: laConditions },
  availableOn: laNullableTimestamp,
  reason: laText,
  updatedAt: laTimestamp,
}, undefined, "PUT returns DateTime-serialized availableOn from currentSelect. The availability board instead emits YYYY-MM-DD business-day strings.");
const laBoardLease = laObject({ id: laId, startsOn: laDay, endsOn: laNullableDay, status: { type: "string", enum: ["active"] } });
const laBoardItem = laObject({
  unit: laObject({
    id: laId, propertyId: laId, label: laText, status: { type: "string", enum: ["active", "archived"] }, version: laVersion,
    marketRentCents: { type: "integer", minimum: 0, nullable: true },
    property: laObject({ id: laId, name: laText }),
  }),
  availability: { ...laObject({ version: laVersion, condition: { type: "string", enum: laConditions }, availableOn: laNullableDay, reason: laText, updatedAt: laTimestamp }), nullable: true },
  state: { type: "string", enum: laStates }, readinessStale: laBool,
  listing: laObject({ version: { ...laVersion, nullable: true }, forRent: laBool, listedAt: laNullableTimestamp }),
  currentLease: { ...laBoardLease, nullable: true }, nextLease: { ...laBoardLease, nullable: true }, latestLeaseEnd: laNullableDay,
});
const laAvailabilityResponse = laObject({
  planningDate: laDay, today: laDay, timezone: laText, definition: laText,
  items: { type: "array", maxItems: 50, items: laBoardItem },
  counts: laObject(Object.fromEntries(laStates.map(state => [state, laCount]))),
  total: laCount, nextCursor: laNullableId,
});
const laUnitDetailOutput = laObject({
  bedrooms: { type: "integer", minimum: 0, maximum: 100, nullable: true },
  bathroomsHundredths: { type: "integer", minimum: 0, maximum: 10000, multipleOf: 25, nullable: true },
  squareFeet: { type: "integer", minimum: 1, maximum: 10000000, nullable: true },
  marketRentCents: { type: "integer", minimum: 0, maximum: 100000000, nullable: true },
  floor: { type: "string", maxLength: 40, nullable: true }, notes: { type: "string", maxLength: 2000, nullable: true },
});
const laCsvValues = laObject({
  propertyId: laText, label: laText, bedrooms: laText, bathrooms: laText,
  squareFeet: laText, marketRent: laText, floor: laText, notes: laText,
}, ["propertyId", "label"], "Raw CSV cell strings; optional columns are absent when not in the submitted header. No coercion or trimming is represented in this raw source projection.");
const laImportIssue = laObject({ column: laText, message: laText });
const laPreviewRow = laObject({
  row: { type: "integer", minimum: 2 }, values: laCsvValues,
  propertyId: laNullableId, label: { type: "string", nullable: true }, details: { ...laUnitDetailOutput, nullable: true },
  property: { ...laPropertySummary, nullable: true }, existingUnitId: laId,
  issues: { type: "array", items: laImportIssue },
}, ["row", "values", "propertyId", "label", "details", "property", "issues"]);
const laImportPreview = laObject({
  rowCount: { type: "integer", minimum: 1, maximum: 500 }, validCount: laCount, errorCount: laCount,
  rows: { type: "array", minItems: 1, maxItems: 500, items: laPreviewRow },
});
const laImportedUnit = laObject({ row: { type: "integer", minimum: 2 }, unitId: laId, propertyId: laId, label: laText });
const laImportResult = laObject({ createdCount: laCount, items: { type: "array", maxItems: 500, items: laImportedUnit } });
const laImportAction = {
  oneOf: [
    laObject({ id: laId, action: { type: "string", enum: ["preview"] }, detail: laObject({ rowCount: laCount, errorCount: laCount }), createdAt: laTimestamp }),
    laObject({ id: laId, action: { type: "string", enum: ["cancel"] }, detail: laObject({ reason: laText }), createdAt: laTimestamp }),
    laObject({ id: laId, action: { type: "string", enum: ["commit"] }, detail: laImportResult, createdAt: laTimestamp }),
  ],
};
const laImportStatus = { type: "string", enum: ["preview", "committed", "cancelled"] };
const laImportDetail = laObject({
  id: laId, companyId: laId, status: laImportStatus, version: laVersion, fileName: laText,
  createdAt: laTimestamp, committedAt: laNullableTimestamp, cancelledAt: laNullableTimestamp,
  preview: laImportPreview, result: { ...laImportResult, nullable: true },
  actions: { type: "array", items: laImportAction },
});
const laImportListItem = laObject({
  id: laId, status: laImportStatus, version: laVersion, fileName: laText,
  createdAt: laTimestamp, committedAt: laNullableTimestamp, cancelledAt: laNullableTimestamp,
  rowCount: laCount, errorCount: laCount, createdCount: { type: "integer", minimum: 0, nullable: true },
});

const laDraftKinds = ["lease_create", "lease_renewal", "inspection"];
const laLeaseDraftValues = laObject({
  unitId: laNonNul(200), residentId: laNonNul(4096, "Opaque account subject; a nonempty value also has the existing 4096 UTF-8-byte bound."),
  residentContactId: laNonNul(200), startsOn: laNonNul(200), endsOn: laNonNul(200), monthlyRent: laNonNul(200),
  status: laNonNul(200), rentDueDay: laNonNul(200), graceDays: laNonNul(200), paymentInstructions: laNonNul(1000),
}, [], "Unfinished form values are strings, not validated lease dates, status enums or monetary records. Nonempty unitId/residentContactId use the normal identifier grammar, and residentId is opaque. Both resident sources cannot be nonempty together. JSON UTF-8 serialized values must fit 49152 bytes.");
const laInspectionDraftValues = laObject({
  leaseId: laNonNul(200), inspectionId: laNonNul(200), kind: laNonNul(200), inspectedOn: laNonNul(200), baselineRevisionId: laNonNul(200),
  items: { type: "array", minItems: 1, maxItems: 100, items: laObject({ key: laId, area: laNonNul(80), item: laNonNul(120), condition: laNonNul(40), notes: laNonNul(1000) }) },
}, ["leaseId", "items"], "Each item's key must be unique; empty string text is allowed. Source validation requires the correct existing lease and any selected in-progress inspection/completed baseline. Observations are unfinished strings. Serialized values have a 49152 UTF-8-byte bound.");
const laDraftValues: LaJson = { oneOf: [laLeaseDraftValues, laInspectionDraftValues] };
const laContextKeys = [
  "leaseListProperty", "leaseListUnit", "leaseListStatus", "leaseListQ", "leaseListNested", "leaseListAttention", "leaseListApprovals",
  "unitListQ", "unitListStatus", "unitListCursor", "prospectId", "prospectQ", "prospectProperty", "prospectStage", "prospectDue", "prospectCursor",
  "tenantContact", "tenantId", "tenantQ", "tenantAccess", "tenantProperty", "tenantRental", "tenantRecords", "tenantCursor", "tenantBefore", "tenantHistoryCursor", "tenantHistoryBefore", "tenantSection",
];
const laDraftContext = laObject(Object.fromEntries(laContextKeys.map(key => [key, laNonNul(/^tenant(?:History)?(?:Cursor|Before)$/.test(key) ? 512 : 200)])), [], "Only named directory-return fields; no credentials/files/submitted requests. Serialized context has a 1536 UTF-8-byte bound. Nonempty leaseListProperty/leaseListUnit use the normal identifier grammar.");
const laDraftSnapshot = laObject({ id: laText, version: laVersion });
const laDraftSnapshots = laObject({ property: laDraftSnapshot, lease: laDraftSnapshot, unit: laDraftSnapshot, tenant: laDraftSnapshot, account: laDraftSnapshot, inspection: laDraftSnapshot }, ["property"]);
const laDraftSummaryFields: Record<string, LaJson> = {
  companyId: laId, id: laId, title: { type: "string", maxLength: 240 }, kind: { type: "string", enum: laDraftKinds }, version: laVersion,
  savedAt: laTimestamp, expiresAt: laTimestamp, href: { type: "string", pattern: "^/company/drafts\\?draftId=" },
};
const laDraftSummary = laObject(laDraftSummaryFields);
const laUnavailableDraft = laObject({
  ...laDraftSummaryFields,
  unavailable: { type: "boolean", enum: [true] }, stale: { type: "boolean", enum: [true] }, sourceIssue: laText,
}, undefined, "Minimal own-task metadata when a saved source becomes invalid/unavailable; private values/context/source IDs and actionKey are omitted.");
const laFullDraft = laObject({
  ...laDraftSummaryFields,
  propertyId: laId, sourceId: laNullableId, actionKey: { type: "string", format: "uuid" },
  values: laDraftValues, context: laDraftContext, sourceVersions: laDraftSnapshots, stale: laBool,
  property: laPropertySummary,
}, [...Object.keys(laDraftSummaryFields), "propertyId", "sourceId", "actionKey", "values", "context", "sourceVersions", "stale"], "GET and replay currentDraft responses add property; a fresh POST/PATCH dto omits that property field.");
const laDraftDetail: LaJson = { oneOf: [laFullDraft, laUnavailableDraft] };

const auxiliaryLeasingApiContracts: Record<string, FastifySchema> = {
  "GET /api/company/availability": laReviewed("server/src/unit-availability.ts:GET /api/company/availability/dto", "lease.manage", false, {
    operationId: "getCompanyAvailability", tags: ["Leasing"], summary: "Read the unit availability and turnover planning board",
    description: "Requires lease.manage plus leasing and properties features in the current company. Unknown query keys are rejected. Lease projections use asOf (default current company business day), while readiness/listing represent latest management decisions, not historical occupancy. Draft leases do not reserve units. Filtered rows order by unit ID descending and page at 50. counts cover property/unit/listing/search filters before the selected state; total uses the selected state's count when status is present. cursor is a bounded ID boundary, not a validated anchor. readinessStale is normalized to a boolean. Board date projections differ from PUT's DateTime values.",
    querystring: laObject({
      propertyId: laId, unitId: laId, q: laNonNul(200), status: { type: "string", enum: laStates }, asOf: laDay,
      cursor: laId, listing: { type: "string", enum: ["for_rent", "not_listed"] },
    }, []),
    response: { 200: { description: "Complete state counts and one bounded board page.", ...laAvailabilityResponse }, ...laErrors(false, ["INVALID_INPUT", "INVALID_ID"], ["NOT_FOUND"]) },
  }),
  "PUT /api/company/units/:unitId/availability": laReviewed("server/src/unit-availability.ts:PUT /api/company/units/:unitId/availability", "lease.manage", true, {
    operationId: "reviewUnitAvailability", tags: ["Leasing"], summary: "Record a reasoned unit readiness review with durable replay",
    description: "Requires leasing+properties enabled for write. expectedVersion must be explicitly null when no readiness record exists, otherwise current positive version. ready uses the supplied date or today's company business date and rejects a future date, current active occupancy or a date on/before the latest tenancy end. unconfirmed forces availableOn=null. turnover/unavailable can retain an estimated date. Unit lock, exact current company and source state apply. An existing matching submission receipt returns CURRENT availability before archived/status/version checks; different details for the same key conflict. Archived units cannot receive a new review. No lease is ended and no listing decision is changed.",
    params: laObject({ unitId: laId }), querystring: laIgnoredQuery,
    body: laObject({
      expectedVersion: { ...laVersion, nullable: true }, condition: { type: "string", enum: laConditions },
      availableOn: { type: "string", nullable: true, description: "Optional YYYY-MM-DD calendar day; omitted/null/empty means absent. ready defaults to today's company day; unconfirmed discards the supplied date after validation." },
      reason: laRequiredText(500), submissionKey: laKey,
    }, ["expectedVersion", "condition", "reason", "submissionKey"]),
    response: {
      200: { description: "Current readiness state, including for a durable exact replay.", ...laObject({ availability: laAvailabilityCurrent }) },
      ...laErrors(true, ["INVALID_INPUT", "INVALID_ID", "FUTURE_READINESS"], ["NOT_FOUND"], ["SUBMISSION_MISMATCH", "RECORD_CHANGED", "UNIT_ARCHIVED", "UNIT_OCCUPIED", "READINESS_PRECEDES_TENANCY"]),
    },
  }),
  "GET /api/company/units/:unitId/availability/history": laReviewed("server/src/unit-availability.ts:GET /api/company/units/:unitId/availability/history", "lease.manage", false, {
    operationId: "getUnitAvailabilityHistory", tags: ["Leasing"], summary: "Read immutable unit readiness reviews",
    description: "Requires lease.manage and leasing+properties read availability. Checks the exact company unit; only cursor is accepted. Returns up to 50 immutable revisions by ID descending; cursor is an ID boundary and need not name an existing revision. No complete total is returned. Stored snapshots serialize availableOn and updatedAt as DateTime strings, not board business-day projections.",
    params: laObject({ unitId: laId }), querystring: laObject({ cursor: laId }, []),
    response: {
      200: { description: "One readiness revision window.", ...laObject({
        items: { type: "array", maxItems: 50, items: laObject({ id: laId, version: laVersion, snapshot: laAvailabilityCurrent, reason: laText, actorId: laText, createdAt: laTimestamp }) },
        nextCursor: laNullableId,
      }) }, ...laErrors(false, ["INVALID_INPUT", "INVALID_ID"], ["NOT_FOUND"]),
    },
  }),
  "GET /api/company/imports/units": laReviewed("server/src/unit-imports.ts:GET /api/company/imports/units", "property.write", false, {
    operationId: "listUnitImports", tags: ["Portfolio and people"], summary: "List company unit-import batches and summary counts",
    description: "Requires property.write even though this is a read, plus properties feature availability. Returns up to 50 batches by ID descending. Only cursor is allowed and is an ID boundary, not an ownership-validated anchor. total counts every company batch, independent of cursor. companyId, raw CSV/source rows and full preview/action details are not present in this list projection.",
    querystring: laObject({ cursor: laId }, []),
    response: {
      200: { description: "Bounded batch summaries, complete company total and next cursor.", ...laObject({ items: { type: "array", maxItems: 50, items: laImportListItem }, total: laCount, nextCursor: laNullableId }) },
      ...laErrors(false, ["INVALID_INPUT", "INVALID_ID"]),
    },
  }),
  "POST /api/company/imports/units/preview": laReviewed("server/src/unit-imports.ts:POST /preview/validate/detail; server/src/csv.ts; server/src/unit-import-csv.ts; server/src/property-fields.ts:unitDetails", "property.write", true, {
    operationId: "previewUnitImport", tags: ["Portfolio and people"], summary: "Create or recover a complete reviewed unit-inventory CSV preview",
    description: "Requires properties enabled and property.write. JSON body limit 532480 bytes; csv is nonempty well-formed UTF-8 text of at most 262144 bytes, at most 500 data rows, no NUL, strict RFC4180 quoting and header-only supported columns. Required header columns propertyId,label; optional bedrooms,bathrooms,squareFeet,marketRent,floor,notes. Duplicate/unsupported headers or wrong cell counts fail the entire preview. Per-row business issues are retained in a successful preview, including unavailable properties, archived/existing names and within-file duplicates. Unit details use existing exact validators: bedrooms 0..100, squareFeet 1..10000000, bathroom quarter increments 0..100, USD decimal-string rent <=1000000, floor<=40, notes<=2000. No units are created here. Submission hash binds trimmed fileName and SHA256 of the EXACT CSV text; matching receipt returns CURRENT detail, a reused action key with different ownership/details conflicts.",
    querystring: laIgnoredQuery,
    body: laObject({ csv: { type: "string", minLength: 1, description: "UTF-8 CSV text <=262144 bytes; 1..500 data rows; exact original bytes participate in replay identity." }, fileName: laRequiredText(200), submissionKey: laKey }),
    response: { 200: { description: "Current retained preview batch with full per-row issues and ordered actions.", ...laImportDetail }, ...laErrors(true, ["INVALID_INPUT", "INVALID_CSV", "INVALID_CSV_HEADERS", "IMPORT_TOO_LARGE"], [], ["SUBMISSION_MISMATCH"]) },
  }),
  "GET /api/company/imports/units/:batchId": laReviewed("server/src/unit-imports.ts:GET /:batchId/detail", "property.write", false, {
    operationId: "getUnitImport", tags: ["Portfolio and people"], summary: "Read an exact company unit-import preview, result and action history",
    description: "Requires property.write and properties read availability. The exact batch must belong to the current company. Returns retained full preview, nullable committed result and all batch actions ascending by createdAt then ID. Query parameters are ignored. Does not revalidate a saved preview against current property/unit state; commit does that separately.",
    params: laObject({ batchId: laId }), querystring: laIgnoredQuery,
    response: { 200: { description: "Current exact import batch with original preview and retained history.", ...laImportDetail }, ...laErrors(false, ["INVALID_ID"], ["NOT_FOUND"]) },
  }),
  "POST /api/company/imports/units/:batchId/commit": laReviewed("server/src/unit-imports.ts:POST /:batchId/commit/detail/validate", "property.write", true, {
    operationId: "commitUnitImport", tags: ["Portfolio and people"], summary: "Atomically create all units from an unchanged reviewed valid preview",
    description: "Requires properties enabled and property.write. The exact reviewed version must still be in preview with zero row issues. Revalidates every stored source row after locking referenced properties; changed property versions, new duplicate names or uniqueness conflict reject the whole commit as IMPORT_REVIEW_CHANGED. Creates connected units and immutable batch/unit audit history atomically. A matching durable action receipt returns CURRENT batch detail before version/status checks; same key with different details or another batch conflicts. No partial import, lease, money or property access grant is created.",
    params: laObject({ batchId: laId }), querystring: laIgnoredQuery,
    body: laObject({ expectedVersion: laVersion, submissionKey: laKey }),
    response: { 200: { description: "Current import batch with committed unit IDs and retained original preview/actions.", ...laImportDetail }, ...laErrors(true, ["INVALID_INPUT", "INVALID_ID"], ["NOT_FOUND"], ["SUBMISSION_MISMATCH", "RECORD_CHANGED", "IMPORT_FINALIZED", "IMPORT_INVALID", "IMPORT_REVIEW_CHANGED"]) },
  }),
  "POST /api/company/imports/units/:batchId/cancel": laReviewed("server/src/unit-imports.ts:POST /:batchId/cancel/detail", "property.write", true, {
    operationId: "cancelUnitImport", tags: ["Portfolio and people"], summary: "Cancel an exact reviewed unit-import preview with retained reason/history",
    description: "Requires properties enabled and property.write. Requires exact current version and preview status; retains the preview/source/history rather than deleting it. A matching durable action receipt returns CURRENT batch detail before version/status checks. Reusing the key with different fields or another batch conflicts. A cancelled or committed batch is not reopened by this route.",
    params: laObject({ batchId: laId }), querystring: laIgnoredQuery,
    body: laObject({ expectedVersion: laVersion, reason: laRequiredText(500), submissionKey: laKey }),
    response: { 200: { description: "Current cancelled batch and its original preview/action history.", ...laImportDetail }, ...laErrors(true, ["INVALID_INPUT", "INVALID_ID"], ["NOT_FOUND"], ["SUBMISSION_MISMATCH", "RECORD_CHANGED", "IMPORT_FINALIZED", "IMPORT_REVIEW_CHANGED"]) },
  }),
  "GET /api/company/task-drafts": laReviewed("server/src/task-drafts.ts:GET /api/company/task-drafts/summary/unavailable/sources", "lease.manage", false, {
    operationId: "listSavedTaskDrafts", tags: ["Saved work"], summary: "List the account's own unexpired saved task drafts",
    description: "Requires lease.manage and leasing read availability; only current company/account drafts are selected with separate user RLS context. Reads at most 101 unexpired rows ordered updatedAt descending then ID; considers the first 100. Inspection rows additionally require inspections read availability: denied-feature rows are omitted, missing/invalid sources produce minimal unavailable metadata. hasMore reports whether the raw selected set exceeded 100, not a filtered complete total. This route accepts no paging/filter contract and ignores query values.",
    querystring: laIgnoredQuery,
    response: { 200: { description: "Own task summaries and minimal unavailable-source rows.", ...laObject({ companyId: laId, items: { type: "array", maxItems: 100, items: { oneOf: [laDraftSummary, laUnavailableDraft] } }, hasMore: laBool }) }, ...laErrors(false) },
  }),
  "GET /api/company/task-drafts/:draftId": laReviewed("server/src/task-drafts.ts:GET /:draftId/currentDraft/dto/sources", "lease.manage", false, {
    operationId: "getSavedTaskDraft", tags: ["Saved work"], summary: "Read an own saved draft with current source availability/staleness",
    description: "Requires own unexpired company/account draft, lease.manage and leasing plus inspections for an inspection draft. Missing, foreign or expired drafts are NOT_FOUND. When source checks still succeed, returns private saved values/context/actionKey/sourceVersions plus current property and stale comparison. A now-missing/invalid source produces only minimal unavailable metadata, omitting private draft/source fields; feature denials remain403. This reads a task draft, not a submitted operation or business record.",
    params: laObject({ draftId: laId }), querystring: laIgnoredQuery,
    response: { 200: { description: "Current full draft or minimal unavailable-source metadata.", ...laDraftDetail }, ...laErrors(false, ["INVALID_ID"], ["NOT_FOUND"]) },
  }),
  "POST /api/company/task-drafts": laReviewed("server/src/task-drafts.ts:POST /api/company/task-drafts/taskDraftValues/taskDraftContext/sources/dto", "lease.manage", true, {
    operationId: "saveNewTaskDraft", tags: ["Saved work"], summary: "Save an own unfinished lease or inspection task without submitting the business action",
    description: "Requires leasing enabled, lease.manage and inspections enabled for inspection kind. Kinds lease_create/lease_renewal/inspection determine unfinished values and source validation. lease_create has no previous source; lease_renewal requires an exact same-property source lease with end date; inspection requires sourceId equal values.leaseId and any selected in-progress inspection/completed baseline. A selected tenant contact must have an active exact account; residentId uses an active company resident account; the two sources remain distinct. At most 100 own tasks after expired cleanup; new tasks expire in 30 days and receive a separate actionKey. Saving accepts unfinished STRING terms, not a valid/active lease, payment or inspection submission. Durable key binds normalized kind/property/source/values/context. Matching unexpired receipt returns CURRENT draft (possibly minimal unavailable); an expired receipt returns404 and does not recreate it.",
    querystring: laIgnoredQuery,
    body: laObject({
      kind: { type: "string", enum: laDraftKinds }, propertyId: laId,
      sourceId: { anyOf: [laId, { type: "string", nullable: true, enum: ["", null] }, { type: "boolean", enum: [false] }, { type: "number", enum: [0] }], description: "Optional prior/source lease ID. The current parser normalizes any falsy value (omitted/null/empty/false/zero) to no source; nonempty IDs and kind-specific existing-source checks apply." },
      values: laDraftValues, context: { ...laDraftContext, nullable: true }, submissionKey: laKey,
    }, ["kind", "propertyId", "values", "submissionKey"]),
    response: { 200: { description: "Fresh full DTO without property, or CURRENT replay full/minimal source projection.", ...laDraftDetail }, ...laErrors(true, ["INVALID_INPUT", "INVALID_ID"], ["NOT_FOUND"], ["SUBMISSION_MISMATCH"]) },
  }),
  "PATCH /api/company/task-drafts/:draftId": laReviewed("server/src/task-drafts.ts:PATCH /:draftId/taskDraftValues/taskDraftContext/sources/dto", "lease.manage", true, {
    operationId: "updateSavedTaskDraft", tags: ["Saved work"], summary: "Update an own saved task while preserving its reviewed source versions",
    description: "Requires exact own unexpired task, current positive version, leasing enabled and inspections enabled for inspection kind. Existing kind/property/sourceId cannot be changed. Replaces unfinished values after validation against that saved kind; omitted/null context resets to the empty object instead of merging old context. Newly selected source IDs capture current versions; unchanged source IDs retain original versions unless reviewSources=true explicitly acknowledges their new versions. Returns stale when retained versions differ. Increments task version and extends expiry 30 days. Recovery recognizes only the saved lastMutationKey/hash and returns CURRENT draft before expectedVersion comparison; it is not an immutable all-history receipt journal. Older mutation keys cannot bypass current version checks. A new PATCH with unavailable source fails; replay may return minimal unavailable metadata.",
    params: laObject({ draftId: laId }), querystring: laIgnoredQuery,
    body: laObject({ values: laDraftValues, context: { ...laDraftContext, nullable: true }, expectedVersion: laVersion, submissionKey: laKey, reviewSources: laBool }, ["values", "expectedVersion", "submissionKey"]),
    response: { 200: { description: "Fresh updated DTO without property, or CURRENT replay projection/minimal source metadata.", ...laDraftDetail }, ...laErrors(true, ["INVALID_INPUT", "INVALID_ID"], ["NOT_FOUND"], ["RECORD_CHANGED", "SUBMISSION_MISMATCH"]) },
  }),
  "DELETE /api/company/task-drafts/:draftId": laReviewed("server/src/task-drafts.ts:DELETE /:draftId", "lease.manage", true, {
    operationId: "deleteSavedTaskDraft", tags: ["Saved work"], summary: "Delete an own saved draft without changing its source business records",
    description: "Requires lease.manage and leasing enabled. Requires expectedVersion even when an own draft no longer exists. An absent/foreign draft returns deleted=true without revealing existence. Existing drafts, including expired ones, require exact version and inspections enabled when inspection kind. No submission key is accepted. Missing-state replay is idempotent; the deletion retains an audit event and does not submit/cancel/delete a lease or inspection source.",
    params: laObject({ draftId: laId }), querystring: laIgnoredQuery,
    body: laObject({ expectedVersion: laVersion }),
    response: { 200: { description: "The own draft is deleted or already absent.", ...laObject({ deleted: { type: "boolean", enum: [true] } }) }, ...laErrors(true, ["INVALID_INPUT", "INVALID_ID"], [], ["RECORD_CHANGED"]) },
  }),
};

export const leasingApiContracts: Record<string, FastifySchema> = { ...lcMainContracts, ...auxiliaryLeasingApiContracts };
