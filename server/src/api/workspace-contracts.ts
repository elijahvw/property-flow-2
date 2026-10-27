import type { FastifySchema } from "fastify";

// Documentation-only schemas, consumed by the Swagger transform. Never assign
// them to business route.schema: that would change parsing/serialization.
type DocumentationSchema = FastifySchema & Record<string, unknown>;
type JsonSchema = Record<string, unknown>;

const object = (properties: Record<string, JsonSchema>, required = Object.keys(properties), description?: string): JsonSchema => ({
  type: "object", additionalProperties: false, properties, required,
  ...(description ? { description } : {}),
});
const text: JsonSchema = { type: "string" };
const positiveVersion: JsonSchema = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const openingVersion: JsonSchema = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const identifier: JsonSchema = {
  type: "string", minLength: 1, maxLength: 200,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_|:@.\\-]{0,199}$",
};
const submissionKey: JsonSchema = {
  type: "string", format: "uuid",
  pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
  description: "UUIDv4 generated once for this intended operation; exact retry retains the original key and body. Case is normalized by the existing submission helper.",
};
const timestamp: JsonSchema = { type: "string", format: "date-time" };
const nullableTimestamp: JsonSchema = { type: "string", format: "date-time", nullable: true };
const count: JsonSchema = { type: "integer", minimum: 0 };
const ignoredQuery: JsonSchema = {
  type: "object", additionalProperties: true,
  description: "This handler does not inspect query parameters. They do not add filters or change scope.",
};
const supportHeader: JsonSchema = {
  type: "string",
  description: "Exact current impersonation context returned by bootstrap. Empty or omitted in ordinary own-account context; required to match when viewing another account. It grants no authority.",
};
function headers(write: boolean, company: boolean): JsonSchema {
  return {
    type: "object", additionalProperties: true,
    required: write ? ["origin", "x-csrf-token"] : [],
    properties: {
      "x-impersonation-id": supportHeader,
      ...(company ? { "x-company-id": { ...text, description: "Optional opening-company fence; when supplied it must equal the effective actor's current membership company. It cannot select another company." } } : {}),
      ...(write ? {
        origin: { ...text, description: "Must equal the configured application origin; supplied by same-origin browsers." },
        "x-csrf-token": { ...text, description: "Current session CSRF value from bootstrap; never embed or persist a real token in documentation." },
      } : {}),
    },
  };
}
function error(description: string, codes: string[]): JsonSchema {
  return {
    description,
    ...object({ error: text, code: { type: "string", enum: [...new Set(codes)] }, requestId: text }),
  };
}
function failures(write: boolean, company: boolean, domain: { badRequest?: string[]; notFound?: string[]; conflict?: string[]; forbidden?: string[] } = {}): Record<number, JsonSchema> {
  const result: Record<number, JsonSchema> = {
    401: error("The server session is missing, expired or invalid.", ["SIGN_IN_REQUIRED"]),
    403: error("Current session, support, verification, feature or operation authority rejects the request.", [
      "ORIGIN_REJECTED", "EMAIL_VERIFICATION_REQUIRED", "IMPERSONATION_UNAVAILABLE",
      ...(write ? ["CSRF_REJECTED", "CSRF_INVALID", "IMPERSONATION_READ_ONLY"] : []),
      ...(company ? ["ACCESS_DENIED", "COMPANY_ACCESS_DENIED", "FEATURE_DISABLED", ...(write ? ["SUBSCRIPTION_READ_ONLY"] : [])] : []),
      ...(domain.forbidden ?? []),
    ]),
    409: error("The current support context, transaction, reviewed source or original submission conflicts; preserve uncertain work before reviewing again.", [
      "IMPERSONATION_CONTEXT_CHANGED", "ACCESS_CONFLICT", ...(domain.conflict ?? []),
    ]),
    503: error("The service could not finish normally; a submitted write may have an uncertain outcome.", ["REQUEST_503"]),
  };
  if (domain.badRequest?.length)
    result[400] = error("Request fields, query, identifier or opening version are invalid.", domain.badRequest);
  if (domain.notFound?.length)
    result[404] = error("The current authorized source or history boundary is unavailable.", domain.notFound);
  if (write) {
    result[413] = error("The JSON request exceeds the server body-size limit.", ["REQUEST_413"]);
    result[415] = error("Submit using the supported JSON content type.", ["REQUEST_415"]);
  }
  return result;
}
function reviewed(source: string[], schema: DocumentationSchema): FastifySchema {
  return {
    ...schema,
    security: [{ sessionCookie: [] }],
    "x-pf-contract-status": "source-reviewed",
    "x-pf-validation-status": "not-handler-verified",
    "x-pf-sources": [...source, "server/src/sessions.ts:authenticate", "server/src/request-errors.ts:registerRequestErrors"],
  } as DocumentationSchema;
}

const guideQuery = object({
  workspace: {
    type: "string", enum: ["company", "resident", "platform"],
    description: "Optional requested walkthrough. Only an authorized platform request overrides role-derived selection; other values do not switch the effective actor or grant workspace access.",
  },
}, []);
const guideStep = object({ id: text, title: text, description: text, path: text, action: text, help: text });
const guideResponse = object({
  eligible: { type: "boolean", description: "Active, verified actor with at least one capability. Not proof that every linked destination is currently available under feature/source rules." },
  steps: { type: "array", items: guideStep },
  guideKey: { ...text, description: "Opaque guide identity derived from selected workspace, membership and execution capability. Retain the returned key." },
  status: { type: "string", enum: ["new", "in_progress", "dismissed", "complete"] },
  step: { ...text, description: "Current step ID from this guide's steps." },
  version: positiveVersion,
});
const guideAccess = "Authenticated effective actor's own guide state. No company-management capability is required merely to read the guide; ineligible accounts may receive metadata with eligible=false. Company/staff/resident/platform steps are selected from current capabilities. The requested workspace and the returned links never grant destination access. The guide endpoint itself has no company feature dependency. Authorized support views can read the target's guide; business writes during impersonation are denied by the session guard.";

const settingsProperties: Record<string, JsonSchema> = {
  maintenanceEnabled: { type: "boolean" }, workEnabled: { type: "boolean" },
  inspectionsEnabled: { type: "boolean" }, agreementsEnabled: { type: "boolean" },
};
const settings = object(settingsProperties);
const preferenceResponse = object({
  companyId: identifier,
  settings,
  version: { ...openingVersion, description: "Zero represents unsaved all-enabled defaults; persisted preferences start at version one." },
});
const receipt = object({
  appliedVersion: positiveVersion,
  appliedSettings: settings,
  changed: { type: "boolean" },
  replayed: { type: "boolean" },
});
const preferenceMutationResponse = object({
  companyId: identifier, settings, version: openingVersion, receipt,
}, undefined, "A replay returns the current preferences plus the original immutable action receipt. Current settings/version can differ from receipt.appliedSettings/appliedVersion after a later save.");
const notificationAccess = "Requires notification.read in the current effective actor's active company membership, optional matching X-Company-ID and the notifications feature. A resident also requires resident_portal. Scoped transactions recheck current authority and set company/user row-level context. Owners/managers receive their own management notices; staff see their own assigned work only while maintenance execution and current property/assignment scope permit; residents see their own maintenance notices with current property assignment. A platform-only account gains no company inbox from platform authority. Authorized support views may read permitted target data; notification and preference writes are denied during impersonation. Preferences affect future publication only and grant no source access.";
const notificationSources = ["server/src/notifications.ts", "server/src/notification-preferences.ts", "server/src/operational.ts:scoped", "server/src/company-features.ts:memberRouteFeatures"];
const statusFilter: JsonSchema = { type: "string", enum: ["all", "unread", "read"], description: "Omitted or null in an action body means all." };
const typeFilter: JsonSchema = { type: "string", enum: ["all", "maintenance", "work", "inspections", "agreements"], description: "Omitted or null in an action body means all." };
const pageFilter: JsonSchema = {
  type: "string", pattern: "^[1-9][0-9]{0,4}$",
  description: "Decimal STRING from 1 through 99999, including in an action's JSON body. Omitted or null in that body means page 1. Returned page is an integer.",
};
const notificationItem = object({
  id: identifier, version: positiveVersion, readAt: nullableTimestamp, createdAt: timestamp,
  type: { type: "string", enum: ["maintenance", "work", "inspections", "agreements"] },
  title: text, sourceTitle: text, property: text, unit: { type: "string", nullable: true },
});

export const workspaceApiContracts: Record<string, FastifySchema> = {
  "GET /api/account/guide": reviewed(["server/src/workspace-guide.ts:definition", "server/src/workspace-guide.ts:own", "server/src/workspace-guide.ts:GET /api/account/guide"], {
    operationId: "getWorkspaceGuide", tags: ["Account"], summary: "Read the current account's walkthrough and saved progress",
    description: guideAccess,
    headers: headers(false, false), querystring: guideQuery,
    response: {
      200: { description: "Role-derived guide, eligibility and own saved progress; first read returns new at the first step.", ...guideResponse },
      ...failures(false, false, { badRequest: ["INVALID_INPUT"], forbidden: ["ACCESS_CHANGED"] }),
    },
  }),
  "PUT /api/account/guide": reviewed(["server/src/workspace-guide.ts:definition", "server/src/workspace-guide.ts:own", "server/src/workspace-guide.ts:PUT /api/account/guide", "server/src/operational.ts:mutation/version/input"], {
    operationId: "saveWorkspaceGuide", tags: ["Account"], summary: "Save or dismiss the current walkthrough progress",
    description: guideAccess + " Updates require eligible=true, the exact current guideKey and a step from the current steps. A changed state requires the current expectedVersion. Repeating an already-current identical state returns it without a version increment even if the supplied opening version is older. This is version/state-based recovery, not a submissionKey receipt protocol; no submissionKey is accepted.",
    headers: headers(true, false), querystring: guideQuery,
    body: object({
      expectedVersion: positiveVersion,
      guideKey: { type: "string", maxLength: 300, description: "Use the current returned guideKey; an unmatched value is a GUIDE_CHANGED conflict." },
      status: { type: "string", enum: ["in_progress", "dismissed", "complete"] },
      step: { ...text, description: "Must identify an item in the current returned guide.steps." },
    }),
    response: {
      200: { description: "Current guide and saved progress, with incremented version only when state changed.", ...guideResponse },
      ...failures(true, false, { badRequest: ["INVALID_INPUT", "REQUEST_400"], forbidden: ["ACCESS_CHANGED"], conflict: ["GUIDE_CHANGED"] }),
    },
  }),
  "GET /api/account/notifications/preferences": reviewed(notificationSources, {
    operationId: "getNotificationPreferences", tags: ["Notifications"], summary: "Read the account's own in-app notification preferences",
    description: notificationAccess + " Returns all-enabled defaults and version=0 when no preference record exists; it does not create a preference record. Query parameters are rejected.",
    headers: headers(false, true), querystring: object({}, []),
    response: {
      200: { description: "Own company-scoped settings and opening version.", ...preferenceResponse },
      ...failures(false, true, { badRequest: ["INVALID_INPUT"] }),
    },
  }),
  "POST /api/account/notifications/preferences": reviewed(notificationSources, {
    operationId: "saveNotificationPreferences", tags: ["Notifications"], summary: "Save the four notification preferences with an immutable replay receipt",
    description: notificationAccess + " Requires all four boolean choices, opening version (zero for defaults), exact expectedCompanyId and one retained UUIDv4 submissionKey. A current new-company mismatch fails COMPANY_CONTEXT_CHANGED. A durable exact replay returns current settings plus the original applied receipt before checking a newer opening version; a changed payload for that key fails SUBMISSION_MISMATCH. An all-default first save creates version1 with changed=false; an unchanged later save can retain its version while recording an action. The dedicated publication fence orders saves against future notification delivery.",
    headers: headers(true, true), querystring: ignoredQuery,
    body: object({ ...settingsProperties, expectedVersion: openingVersion, expectedCompanyId: identifier, submissionKey }),
    response: {
      200: { description: "Current preferences and the immutable action's original applied result/replay flag.", ...preferenceMutationResponse },
      ...failures(true, true, { badRequest: ["INVALID_INPUT", "INVALID_ID", "REQUEST_400"], conflict: ["COMPANY_CONTEXT_CHANGED", "RECORD_CHANGED", "SUBMISSION_MISMATCH"] }),
    },
  }),
  "GET /api/account/notifications/preferences/history": reviewed(notificationSources, {
    operationId: "getNotificationPreferenceHistory", tags: ["Notifications"], summary: "Page through the account's own preference save history",
    description: notificationAccess + " Up to 50 immutable actions, newest createdAt then ID first. The optional cursor must identify an existing action belonging to this same company/account. The result has no full-history total; nextCursor=null means no next page. Unknown query keys are rejected.",
    headers: headers(false, true), querystring: object({ cursor: identifier }, []),
    response: {
      200: { description: "Own action history window and next cursor.", ...object({
        companyId: identifier,
        items: { type: "array", maxItems: 50, items: object({ id: identifier, createdAt: timestamp, appliedVersion: positiveVersion, settings, changed: { type: "boolean" } }) },
        nextCursor: { ...identifier, nullable: true },
      }) },
      ...failures(false, true, { badRequest: ["INVALID_INPUT", "INVALID_ID"], notFound: ["NOT_FOUND"] }),
    },
  }),
  "GET /api/account/notifications/summary": reviewed(notificationSources, {
    operationId: "getNotificationSummary", tags: ["Notifications"], summary: "Count currently visible unread notifications",
    description: notificationAccess + " Returns a complete unread count across the account's currently accessible notifications, without list filters. Query parameters are ignored, not interpreted as filters.",
    headers: headers(false, true), querystring: ignoredQuery,
    response: {
      200: { description: "Unread count across current authorized source scope.", ...object({ unread: count }) },
      ...failures(false, true),
    },
  }),
  "GET /api/account/notifications": reviewed(notificationSources, {
    operationId: "listNotifications", tags: ["Notifications"], summary: "List the account's current authorized in-app inbox",
    description: notificationAccess + " Filters are status=all|unread|read, type=all|maintenance|work|inspections|agreements, page as a decimal string; omitted values mean all/all/1. Unknown filters are rejected. Order is createdAt descending then ID descending. total covers all records matching these filters; unread covers all accessible unread records independently of the selected filters. A page has up to 25 items. Neither count grants continuing access to a source.",
    headers: headers(false, true),
    querystring: object({ status: statusFilter, type: typeFilter, page: pageFilter }, []),
    response: {
      200: { description: "Filtered inbox page, complete filtered total and independent accessible unread count.", ...object({
        items: { type: "array", maxItems: 25, items: notificationItem },
        total: count, unread: count, page: { type: "integer", minimum: 1, maximum: 99999 }, pageSize: { type: "integer", enum: [25] },
      }) },
      ...failures(false, true, { badRequest: ["INVALID_INPUT"] }),
    },
  }),
  "POST /api/account/notifications/:notificationId": reviewed(notificationSources, {
    operationId: "actOnNotification", tags: ["Notifications"], summary: "Mark a notification read/unread or prepare its current authorized source link",
    description: notificationAccess + " The action must read the currently accessible notification/source before looking up a previous receipt; replay cannot recover access to a revoked source. read and open mark unread notices read; unread reverses read state. A no-op read-state action retains the current version but records a durable receipt. Open returns an internal href with retained inbox filters/page and source section context; it is a JSON link, not an HTTP redirect. Exact replay returns replayed=true and the current notification version/href after current scope checks. A changed key payload or stale unreceipted source version conflicts.",
    headers: headers(true, true), querystring: ignoredQuery,
    params: object({ notificationId: identifier }),
    body: object({
      action: { type: "string", enum: ["read", "unread", "open"] }, expectedVersion: positiveVersion, submissionKey,
      status: { ...statusFilter, nullable: true, enum: ["all", "unread", "read", null] }, type: { ...typeFilter, nullable: true, enum: ["all", "maintenance", "work", "inspections", "agreements", null] }, page: { ...pageFilter, nullable: true },
    }, ["action", "expectedVersion", "submissionKey"]),
    response: {
      200: { description: "Saved/replayed action and current version. href is present exactly for action=open.", ...object({
        saved: { type: "boolean", enum: [true] }, replayed: { type: "boolean" }, version: positiveVersion,
        href: { type: "string", pattern: "^/", description: "Only for open; an internal current source link preserving inbox return context." },
      }, ["saved", "replayed", "version"]) },
      ...failures(true, true, { badRequest: ["INVALID_INPUT", "INVALID_ID", "REQUEST_400"], notFound: ["NOT_FOUND"], conflict: ["RECORD_CHANGED", "SUBMISSION_MISMATCH"] }),
    },
  }),
};
