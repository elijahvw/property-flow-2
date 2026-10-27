import type { FastifySchema } from "fastify";
import { routeFeatures } from "../company-features.js";

// Documentation projections of the selections and validators in the five
// maintenance registrars. Never attach these schemas to the live handlers.
type S = Record<string, any>;
const str: S = { type: "string" }, bool: S = { type: "boolean" };
const integer: S = { type: "integer", minimum: 0 };
const version: S = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const id: S = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_|:@.\\-]{0,199}$", minLength: 1, maxLength: 200 };
const userId: S = { type: "string", minLength: 1, description: "Opaque persisted account ID; no NUL, maximum 4096 UTF-8 bytes. Never normalize provider punctuation." };
const timestamp: S = { type: "string", format: "date-time" };
const day: S = { type: "string", format: "date", pattern: "^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$" };
const key: S = { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$", description: "UUIDv4 retained with the exact original payload after uncertainty. Existing helpers normalize its case; a different payload with the same actor/company key conflicts." };
const nullable = (schema: S): S => ({ ...schema, nullable: true, ...(schema.enum ? { enum: [...schema.enum, null] } : {}) });
const object = (properties: S, required = Object.keys(properties), description?: string): S => ({ type: "object", additionalProperties: false, properties, required, ...(description ? { description } : {}) });
const array = (items: S): S => ({ type: "array", items });
const choice = (...values: string[]): S => ({ type: "string", enum: values });
const text = (maxLength: number): S => ({ type: "string", minLength: 1, maxLength, description: "Nonblank, no NUL; the handler trims surrounding whitespace." });
const optional = (maxLength: number): S => ({ type: "string", maxLength, nullable: true, description: "Omitted, null or blank input clears this field. Nonblank input is trimmed and cannot contain NUL." });
const name = object({ name: nullable(str) });
const property = object({ name: str });
const unit = nullable(object({ label: str }));
const status = choice("open", "in_progress", "resolved");
const priority = choice("low", "normal", "high");
const category = choice("plumbing", "electrical", "hvac", "appliance", "structural", "safety", "other");
const executionStatus = choice("unassigned", "assigned", "accepted", "pending_review", "complete");
const emptyQuery = object({});
const ignoredQuery: S = { type: "object", additionalProperties: true, description: "This handler does not interpret query parameters; they do not change authorization or source selection." };
const cursorQuery = object({ cursor: id }, []);
const pageQuery = object({ page: { type: "string", pattern: "^[1-9][0-9]{0,5}$", default: "1" } }, []);
const cursorPage = (items: S, extra: S = {}): S => object({ items: { ...array(items), maxItems: 50 }, nextCursor: nullable(id), ...extra }, undefined, "At most 50 ordered records; nextCursor is the last returned ID only when another window exists. This is not a total-count response.");
const numberedPage = (items: S, extra: S = {}): S => object({ items: { ...array(items), maxItems: 25 }, total: integer, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", enum: [25] }, ...extra });
const error = (description: string, codes: string[]): S => ({ ...object({ error: str, code: { type: "string", enum: codes }, requestId: str }), description });
function failures(write: boolean, conflicts: string[] = []): S {
  const result: S = {
    400: error("Invalid identifier, unknown/invalid input or malformed JSON.", ["INVALID_INPUT", "INVALID_ID", "INVALID_DIRECTORY_CURSOR", "REQUEST_400"]),
    401: error("No valid current application session.", ["SIGN_IN_REQUIRED"]),
    403: error("Current account, company, capability, feature or support authority denies access.", ["ORIGIN_REJECTED", "CSRF_REJECTED", "ACCESS_DENIED", "COMPANY_ACCESS_DENIED", "EMAIL_VERIFICATION_REQUIRED", "FEATURE_DISABLED", "IMPERSONATION_UNAVAILABLE", ...(write ? ["CSRF_INVALID", "IMPERSONATION_READ_ONLY", "SUBSCRIPTION_READ_ONLY"] : [])]),
    404: error("The source, current assignment or cursor is unavailable in the authorized scope.", ["NOT_FOUND", "DIRECTORY_CURSOR_UNAVAILABLE", "REQUEST_404"]),
    409: error("Review current state. Preserve any uncertain submitted payload/key before retrying.", ["RECORD_CHANGED", "SUBMISSION_MISMATCH", "IMPERSONATION_CONTEXT_CHANGED", "ACCESS_CONFLICT", "REQUEST_409", ...conflicts]),
    503: error("The server could not complete normally; a submitted mutation can have an uncertain result.", ["REQUEST_503"]),
  };
  if (write) Object.assign(result, { 413: error("Request body exceeds the configured JSON body limit.", ["REQUEST_413"]), 415: error("Unsupported content type; use application/json.", ["REQUEST_415"]) });
  return result;
}
const management = "Internal application API. Requires maintenance.manage (active company owner or manager), active verified account, current company membership and applicable enabled features. X-Company-ID is an optional fence matching that membership, never a company selector. Scoped transactions recheck authority and set company row-level context. Platform authority alone grants no company data.";
const resident = "Internal resident application API. Requires resident.self, resident_portal and maintenance features, and current assignment to the request's property. Only requests originally recorded by the effective resident are visible; lease occupancy or possession of a request ID is insufficient. Company/property scope is rechecked inside the transaction.";
const support = " Reads may use an authorized, current support view of the effective account; send its exact X-Impersonation-ID from bootstrap. Stale/missing context conflicts. All business mutations are rejected during impersonation, including a platform owner viewing another account. Ordinary writes require the exact configured Origin and current X-CSRF-Token. Documentation grants no access and executes no operations.";
const retry = " Read requests may be repeated with current session/context. Mutation replay follows fresh source authorization. Retain the original UUID and exact body where submissionKey is accepted; never generate a replacement key while the result is uncertain. Version-only edits require reload/review after RECORD_CHANGED and must not silently rebase.";
const contracts: Record<string, FastifySchema> = {};
function add(method: string, path: string, summary: string, source: string, access: string, response: S, options: { body?: S; query?: S; conflicts?: string[]; description?: string } = {}) {
  const write = method !== "GET";
  const parameters = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map(match => match[1]);
  contracts[`${method} ${path}`] = {
    operationId: `${method.toLowerCase()}_${path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    summary, tags: ["Maintenance"], security: [{ sessionCookie: [] }],
    description: `${access}${support}${retry} ${options.description ?? ""}`,
    ...(parameters.length ? { params: object(Object.fromEntries(parameters.map(key => [key, key === "userId" ? userId : id]))) } : {}),
    headers: { type: "object", additionalProperties: true, required: write ? ["origin", "x-csrf-token"] : [], properties: {
      "x-company-id": { ...id, description: "Optional exact membership-company fence." },
      "x-impersonation-id": { ...str, description: "Exact current support context from bootstrap; omit in own-account context." },
      ...(write ? { origin: { ...str, description: "Exact configured application origin." }, "x-csrf-token": { ...str, description: "Current session CSRF value from bootstrap; never embed a real value in docs." } } : {}),
    } },
    querystring: options.query ?? (write ? ignoredQuery : emptyQuery),
    ...(options.body ? { body: options.body } : {}),
    response: { 200: { ...response, description: "Successful current authorized result; existing create/action handlers return 200, not 201." }, ...failures(write, options.conflicts) },
    "x-pf-contract-status": "source-reviewed", "x-pf-validation-status": "not-handler-verified",
    "x-pf-audience": "internal application; no public developer API credentials",
    "x-pf-features": routeFeatures(path),
    "x-pf-sources": [`server/src/${source}`, "server/src/operational.ts", "server/src/sessions.ts", "server/src/company-features.ts", "server/src/request-errors.ts"],
  } as FastifySchema;
}

const requestProperties = { id, propertyId: id, unitId: nullable(id), category, targetOn: nullable(timestamp), version, title: str, description: str, priority, status, createdAt: timestamp, updatedAt: timestamp, property, unit };
const requestRecord = object(requestProperties);
const updateRecord = (isResident: boolean): S => object({ id, content: str, visibility: isResident ? choice("resident") : choice("internal", "resident"), createdAt: timestamp, author: str, ...(!isResident ? { authorType: choice("requester", "team") } : {}) });
const change = object({ from: nullable(str), to: nullable(str) });
const changes = object(Object.fromEntries(["title", "description", "priority", "category", "targetOn", "unitId", "status"].map(key => [key, change])), []);
for (const isResident of [true, false]) {
  const base = `/api/${isResident ? "resident" : "company"}/maintenance`, access = isResident ? resident : management;
  add("POST", base, isResident ? "Record an assigned resident's maintenance request" : "Record management maintenance intake", "maintenance.ts", access, requestRecord, {
    body: object({ propertyId: id, title: text(160), description: text(4000), priority, category: { ...category, default: "other" }, submissionKey: key, ...(!isResident ? { unitId: nullable(id), targetOn: nullable(day) } : {}) }, ["propertyId", "title", "description", "priority", "submissionKey"]),
    description: "Replay uses company, requester and submissionKey plus a normalized payload fingerprint; returns the current selected request. Management intake has no resident requester/reply permission. Target dates are input calendar dates and serialize as midnight-UTC date-time values.",
  });
  const commonFilters = { status: choice("unresolved", "open", "in_progress", "resolved"), propertyId: id, priority, q: text(200), ...(!isResident ? { workStatus: executionStatus, due: choice("overdue", "today", "upcoming", "unscheduled"), assignee: text(200) } : {}) };
  add("GET", base, "Read the complete bounded maintenance list", "maintenance.ts", access,
    { ...array(object({ ...requestProperties, ...(!isResident ? { executionStatus, assigneeId: nullable(userId), assigneeName: nullable(str) } : {}) })), maxItems: 1000 },
    { query: object(commonFilters, []), conflicts: ["MAINTENANCE_DIRECTORY_LIMIT"], description: "Complete filtered array only when at most 1,000 requests match; otherwise 409 MAINTENANCE_DIRECTORY_LIMIT directs callers to the paged directory. Ordered createdAt then ID descending. Search covers title, description, property and unit; due filters use the company's local day and exclude resolved requests. assignee accepts unassigned or a name/email search. No cursor accepted here." });
  const directoryProperties = { id, propertyId: id, unitId: nullable(id), title: str, category, priority, status, createdAt: timestamp, targetOn: nullable(timestamp), property, unit, ...(!isResident ? { executionStatus, assigneeName: nullable(str) } : {}) };
  add("GET", `${base}/directory`, "Page the current maintenance directory with complete filtered counts", "maintenance.ts", access,
    object({ companyId: id, items: { ...array(object(directoryProperties)), maxItems: 50 }, total: integer, statusCounts: object({ open: integer, in_progress: integer, resolved: integer }), pageSize: { type: "integer", enum: [50] }, nextCursor: nullable(str), previousCursor: nullable(str) }), {
      query: object({ ...commonFilters, cursor: { ...str, maxLength: 512, pattern: "^[A-Za-z0-9_-]+$" }, before: { ...str, maxLength: 512, pattern: "^[A-Za-z0-9_-]+$" } }, []),
      description: "Use only one returned opaque cursor or before token. Tokens bind actor/company/resident projection and filters, plus the current company day when a due filter is selected; they validate a still-visible anchor. Changing context requires first page. nextCursor seeks older, previousCursor uses before for newer; returned rows remain newest first. total/statusCounts cover all current filtered matches, not just this page. Counts/pages are live, not a frozen snapshot.",
    });
  const activity = object({ id, action: choice("maintenance.created", "maintenance.status.changed", ...(!isResident ? ["maintenance.updated"] : [])), createdAt: timestamp, ...(!isResident ? { actorName: str, changes } : {}), from: {}, to: {} }, ["id", "action", "createdAt", ...(!isResident ? ["actorName"] : [])], "from/to exist only for a status event and retain historical JSON values. changes is optional for management; units use recorded labels, never requester IDs.");
  add("GET", `${base}/:requestId`, "Read maintenance source and bounded activity", "maintenance.ts", access,
    object({ ...requestProperties, ...(!isResident ? { recordedBy: str, residentUpdatesAvailable: bool } : {}), activity: { ...array(activity), maxItems: 100 }, historyLimited: bool }),
    { description: "Residents receive safe activity without actor IDs/names, internal changes or internal notes. Management gets recordedBy and whether the original intake supports resident conversation. historyLimited explicitly signals more than 100 events. Detail rejects all query fields." });
  add("GET", `${base}/:requestId/updates`, "Read authorized conversation updates", "maintenance.ts", access, cursorPage(updateRecord(isResident)), { query: cursorQuery, description: "Newest createdAt/ID first. Cursor must be an update visible on this exact request; residents see only resident-visible updates with You/Property team labels. Internal notes stay management-only." });
  add("POST", `${base}/:requestId/updates`, isResident ? "Append a resident reply" : "Append an internal or resident-visible team update", "maintenance.ts", access, updateRecord(isResident), {
    body: object({ content: text(4000), submissionKey: key, ...(!isResident ? { visibility: choice("internal", "resident") } : {}) }), conflicts: ["NO_RESIDENT_REQUESTER"],
    description: "Original actor/company submission replay does not append duplicate evidence. Resident replies and resident-visible team updates require resident-originated intake. Reply creation does not change request status/version; replies remain possible after resolution. Management-created requests allow internal notes only.",
  });
}
add("PATCH", "/api/company/maintenance/:requestId", "Edit reviewed management intake or unassigned request status", "maintenance.ts", management,
  object({ ...requestProperties, assigneeId: nullable(userId) }, Object.keys(requestProperties), "An unchanged patch returns the pre-edit selection including assigneeId; changed patches return the standard request selection."), {
    body: object({ status, expectedVersion: version, title: text(160), description: text(4000), priority, category, targetOn: nullable(day), unitId: nullable(id) }, ["status", "expectedVersion"]),
    conflicts: ["WORK_REVIEW_REQUIRED"], description: "No submissionKey accepted. An unchanged edit returns without increment; changed fields increment version atomically. Assigned requests must use work actions for status changes. unitId must be an active unit of the original property; null makes intake property-wide. On uncertain completion read source before deciding to resubmit.",
  });

const planProperties = { id, propertyId: id, unitId: nullable(id), title: str, description: str, category, priority, cadence: choice("weekly", "monthly", "quarterly", "yearly"), anchorOn: timestamp, endOn: nullable(timestamp), nextOn: nullable(timestamp), timezone: str, status: choice("active", "paused"), version, property, unit };
const plan = object({ ...planProperties, today: day });
const preventiveReceipt = object({ saved: { type: "boolean", enum: [true] }, planId: id, requestId: nullable(id), changed: bool, recovered: { type: "boolean", enum: [true] } }, ["saved", "planId", "requestId", "changed"]);
const planFields = { title: text(160), description: text(4000), category, priority };
add("GET", "/api/company/preventive", "Page preventive maintenance schedules", "preventive.ts", management,
  numberedPage(plan, { today: day, timezone: str }), { query: object({ ...pageQuery.properties, q: text(200), status: { ...choice("active", "paused", "all"), default: "active" }, due: { ...choice("all", "due", "overdue", "upcoming", "finished"), default: "all" }, propertyId: id }, []), description: "25 rows ordered nextOn ascending (null last), then ID. total covers filtered schedules; q searches title/property. Per-plan today and due comparisons use the plan's retained timezone; response today/timezone use current company. finished means nextOn=null, not an archived schedule." });
add("GET", "/api/company/preventive/:id", "Read a preventive schedule", "preventive.ts", management, plan);
add("POST", "/api/company/preventive", "Create a reviewed preventive schedule", "preventive.ts", management, preventiveReceipt, {
  body: object({ ...planFields, propertyId: id, unitId: nullable(id), cadence: planProperties.cadence, anchorOn: day, endOn: nullable(day), timezone: text(100), submissionKey: key }, [...Object.keys(planFields), "propertyId", "cadence", "anchorOn", "timezone", "submissionKey"]), conflicts: ["TIMEZONE_CHANGED"], description: "Reviewed timezone must equal current company timezone; plan retains it. End date cannot precede anchor. Initial nextOn=anchorOn. No automatic provider call or scheduled generation occurs; occurrence actions are explicit. Replay returns recovered=true and original action receipt, not another plan." });
add("PATCH", "/api/company/preventive/:id", "Edit or pause/resume a preventive schedule", "preventive.ts", management, preventiveReceipt, {
  body: object({ ...planFields, status: choice("active", "paused"), expectedVersion: version, submissionKey: key }), description: "Title/instructions/category/priority/status are replaced together. Property/unit, cadence, dates and timezone cannot be edited by this endpoint. Unchanged requests retain a hidden changed=false receipt without an audit/history row; exact retry reports recovered=true." });
add("POST", "/api/company/preventive/:id/occurrences", "Generate or explicitly skip the reviewed next occurrence", "preventive.ts", management, preventiveReceipt, {
  body: { oneOf: [
    object({ outcome: choice("generated"), dueOn: day, reason: { type: "string", nullable: true, enum: ["", null] }, expectedVersion: version, submissionKey: key }, ["outcome", "dueOn", "expectedVersion", "submissionKey"]),
    object({ outcome: choice("skipped"), dueOn: day, reason: text(1000), expectedVersion: version, submissionKey: key }),
  ] }, conflicts: ["PLAN_PAUSED", "UNIT_ARCHIVED"], description: "dueOn must exactly equal reviewed nextOn, and plan version must match. Only active plans execute. Generated creates one connected management maintenance request; skipped requires a reason. Atomically records occurrence and advances anchored recurrence/version; exact replay returns the retained request ID. An archived unit blocks generation; no money/provider operations occur." });
const snapshot: S = { oneOf: [
  object({ ...planFields, propertyId: id, unitId: nullable(id), cadence: planProperties.cadence, anchorOn: timestamp, endOn: nullable(timestamp), timezone: str }),
  object({ before: object(planFields), beforeStatus: choice("active", "paused"), after: object({ ...planFields, status: choice("active", "paused") }) }),
  object({ occurrenceId: id, dueOn: timestamp, nextOn: nullable(timestamp), reason: nullable(str) }),
], description: "Immutable action snapshot: create, changed edit, or generate/skip respectively. Unchanged edit receipts are excluded from consequential history." };
add("GET", "/api/company/preventive/:id/history", "Page consequential preventive history", "preventive.ts", management,
  numberedPage(object({ id, action: choice("create", "edit", "generate", "skip"), snapshot, requestId: nullable(id), createdAt: timestamp, actor: name })), { query: pageQuery, description: "Newest createdAt/ID first, only changed=true actions; no-op retry receipts are intentionally absent. Snapshot is immutable historical JSON, not the current schedule." });
add("GET", "/api/company/preventive/:id/occurrences", "Page recorded preventive occurrences", "preventive.ts", management,
  numberedPage(object({ id, dueOn: timestamp, outcome: choice("generated", "skipped"), reason: nullable(str), requestId: nullable(id), request: nullable(object({ status, title: str })), createdAt: timestamp })), { query: pageQuery, description: "25 rows ordered dueOn then ID descending. Skipped occurrences have no connected request; request state is current source state." });
add("GET", "/api/company/maintenance/:id/preventive", "Read a maintenance request's preventive source", "preventive.ts", management,
  nullable(object({ id, dueOn: timestamp, plan: object({ id, title: str, timezone: str, status: choice("active", "paused") }) })), { description: "Returns JSON null for ordinary intake without a preventive occurrence; the authorized maintenance request must still exist." });

const vendorProperties = { id, name: str, service: nullable(str), contactName: nullable(str), email: nullable(str), phone: nullable(str), notes: nullable(str), status: choice("active", "archived"), version, createdAt: timestamp, updatedAt: timestamp };
const vendor = object(vendorProperties);
const vendorFields = { name: text(160), service: optional(120), contactName: optional(160), email: { ...optional(254), description: "If nonblank, simple non-whitespace local@domain.tld grammar; null/omitted/blank clears." }, phone: optional(50), notes: optional(2000) };
const vendorReceipt = object({ saved: { type: "boolean", enum: [true] }, vendorId: nullable(id), requestId: nullable(id), changed: bool, recovered: { type: "boolean", enum: [true] } }, ["saved", "vendorId", "requestId", "changed"]);
add("GET", "/api/company/vendors", "Page the vendor directory", "vendors.ts", management, numberedPage(vendor), { query: object({ ...pageQuery.properties, q: text(200), status: { ...choice("active", "archived", "all"), default: "active" } }, []), description: "Name/ID ascending, 25 rows; total is all filtered matches. Search covers name/service/contact/email/phone. Internal contact directory only; this endpoint sends no vendor messages." });
add("GET", "/api/company/vendors/:vendorId", "Read a vendor contact", "vendors.ts", management, vendor);
add("POST", "/api/company/vendors", "Create a vendor contact", "vendors.ts", management, vendorReceipt, { body: object({ ...vendorFields, submissionKey: key }, ["name", "submissionKey"]), conflicts: ["VENDOR_EXISTS"], description: "Name whitespace is collapsed and normalized for company-local uniqueness including archived contacts. Response is an action receipt; follow vendorId for the source. No external vendor account/provider action." });
add("PATCH", "/api/company/vendors/:vendorId", "Replace vendor contact fields or archive/restore", "vendors.ts", management, vendorReceipt, { body: object({ ...vendorFields, status: choice("active", "archived"), expectedVersion: version, submissionKey: key }, ["name", "status", "expectedVersion", "submissionKey"]), conflicts: ["VENDOR_EXISTS"], description: "Optional contact fields omitted in this replacement are cleared. Same normalized company name must remain unique, including archived contacts. No-op saves retain changed=false receipt, without consequential history. Exact retries recover original action." });
add("GET", "/api/company/vendors/:vendorId/requests", "Page maintenance requests currently linked to a vendor", "vendors.ts", management,
  numberedPage(object({ id, title: str, status, property, unit })), { query: pageQuery, description: "Current links ordered request createdAt/ID descending, 25 per page, exact filtered total. Historical former assignments remain in vendor history instead." });
add("GET", "/api/company/maintenance/:requestId/vendor", "Read the current vendor assignment and request version", "vendors.ts", management,
  object({ id, version, vendorId: nullable(id), vendor: nullable(vendor) }));
add("POST", "/api/company/maintenance/:requestId/vendor", "Link or clear the reviewed request vendor", "vendors.ts", management, vendorReceipt, {
  body: object({ vendorId: nullable(id), vendorVersion: nullable(version), expectedVersion: version, submissionKey: key }), conflicts: ["VENDOR_CHANGED"], description: "vendorId=null requires vendorVersion=null to remove contact. Linking requires an active vendor with exactly reviewed vendorVersion, plus request expectedVersion. Unchanged assignments preserve a changed=false durable receipt; replay cannot reassign a later changed request. No payment/expense or vendor notification is created." });
const vendorAfter = object({ name: str, nameKey: str, service: nullable(str), contactName: nullable(str), email: nullable(str), phone: nullable(str), notes: nullable(str), status: choice("active", "archived") });
const vendorBefore = object(Object.fromEntries(Object.entries(vendorProperties).filter(([key]) => !["createdAt", "updatedAt"].includes(key))));
const vendorLink = nullable(object({ id, name: str }));
const vendorSnapshot: S = { anyOf: [
  object({ after: vendorAfter }), object({ before: vendorBefore, after: vendorAfter }), object({ from: vendorLink, to: vendorLink }),
  { type: "object", additionalProperties: true, properties: {
    before: { ...vendorBefore, required: [], additionalProperties: true },
    after: { ...vendorAfter, required: [], additionalProperties: true },
    from: vendorLink, to: vendorLink,
  }, description: "Retained partial JSON snapshots are returned verbatim. The existing history regression stores after.phone alone; history reads do not upgrade or validate these snapshots. Known fields retain the documented types; additional historical keys can remain." },
], description: "Current writers emit create, edit/archive/restore or assignment-change snapshots. Retained partial JSON snapshots also remain readable; this is stored audit evidence, not the current vendor DTO. No-op actions are excluded from consequential history." };
for (const path of ["/api/company/vendors/:id/history", "/api/company/maintenance/:id/vendor/history"])
  add("GET", path, "Page consequential vendor and assignment history", "vendors.ts", management,
    cursorPage(object({ id, action: choice("create", "edit", "archive", "restore", "link"), snapshot: vendorSnapshot, createdAt: timestamp, requestId: nullable(id), actorName: str })), { query: cursorQuery, description: "Newest createdAt/ID first; cursor must be a visible action on this exact source. Vendor history includes links removed from that vendor via stored from.id. Only changed=true actions appear. Internal contact snapshots are not exposed to staff or residents." });

const entry = object({ id, reference: str, occurredOn: timestamp, amountCents: { type: "integer" }, currency: str, category: str, memo: nullable(str), version, voidedAt: nullable(timestamp), voidReason: nullable(str) });
const cost = object({ id, version, createdAt: timestamp, unlinkedAt: nullable(timestamp), unlinkReason: nullable(str), entry });
const costAccess = `${management} Additionally requires finance.manage in both opening and transaction-fresh authority; staff execution and resident.self do not grant expense visibility.`;
add("GET", "/api/company/maintenance/:requestId/costs", "Page expense links and complete active paid-cost totals", "maintenance-costs.ts", costAccess,
  cursorPage(cost, { summary: object({ paidCents: { type: "string", pattern: "^-?[0-9]+$", description: "Exact integer cents aggregate serialized from PostgreSQL bigint; never float money." }, paidCount: integer }) }), { query: cursorQuery, description: "ID descending pages including retained unlinked/voided entries. Summary covers all current non-unlinked links with nonvoid expenses, independent of page. It is not a payable, vendor bill or money movement." });
add("GET", "/api/company/maintenance/:requestId/costs/candidates", "Page unlinked paid expenses in the request property", "maintenance-costs.ts", costAccess, cursorPage(entry), { query: object({ cursor: id, q: { ...str, maxLength: 200, description: "Optional trimmed reference/memo search; empty allowed, NUL rejected." } }, []), description: "ID descending; only nonvoid expense entries in the exact request property without another active maintenance cost link. Cursor is an ID seek, not a separately validated snapshot anchor." });
add("POST", "/api/company/maintenance/:requestId/costs", "Link an existing reviewed expense to maintenance", "maintenance-costs.ts", costAccess, cost, { body: object({ entryId: id, expectedEntryVersion: version, submissionKey: key }), conflicts: ["EXPENSE_UNAVAILABLE", "EXPENSE_ALREADY_LINKED"], description: "Requires exact reviewed entry version and same company/property. Atomic link/audit only: entry amount/version and cash are unchanged. Each expense can have one active maintenance link; exact current-authority replay returns retained link without duplication." });
add("POST", "/api/company/maintenance/:requestId/costs/:costId/unlink", "Correct an expense attribution while retaining its history", "maintenance-costs.ts", costAccess, cost, { body: object({ expectedVersion: version, reason: text(300) }), description: "No submissionKey. Repeating already-unlinked correction by the same actor with the same reason returns retained link; any different actor/reason conflicts. First unlink checks link expectedVersion and increments link version. Underlying paid expense and financial history are unchanged." });

const executionAccess = "Internal staff application API. Requires maintenance.execute: active staff membership with explicit owner-granted maintenanceExecution, current company/property scope and assignment to the exact request. Directory lists only the effective actor's assigned work. Company managers use maintenance.manage for detail/action paths but cannot obtain staff-only directory access merely from management authority.";
const membersAccess = "Internal owner administration API. Requires members.manage in the current active company membership (company owner), applicable features and fresh transaction authority. Target must be staff in that same company. Platform-only, manager, resident and staff identities cannot grant execution authority.";
const workProperties = { id, propertyId: id, title: str, description: str, priority, category, targetOn: nullable(timestamp), status, version, executionStatus, property, unit };
add("GET", "/api/company/members/:userId/maintenance-access", "Read a staff member's explicit maintenance execution grant", "work-orders.ts", membersAccess, object({ version, maintenanceExecution: bool }), { query: ignoredQuery });
add("PUT", "/api/company/members/:userId/maintenance-access", "Grant or revoke staff maintenance execution", "work-orders.ts", membersAccess, object({ version }), { body: object({ enabled: bool, expectedVersion: version }), description: "Version-only mutation, no submissionKey. If enabled already matches, returns current version before checking expectedVersion; changed grants require exact version and increment membership version. This grants no finance, leasing, documents or extra property access." });
add("GET", "/api/company/work-orders", "Page the current staff actor's assigned work", "work-orders.ts", executionAccess, cursorPage(object(workProperties)), { query: object({ status: choice("assigned", "accepted", "pending_review", "complete"), cursor: id, q: text(200) }, []), description: "ID ascending, at most 50; search title only. Cursor must still be visible under current assignment/property/filter. Assigned work has no finance/contact documents. Complete filtered total is not returned." });
const workAction = object({ id, action: choice("assign", "accept", "progress", "submit", "approve", "reopen"), note: str, createdAt: timestamp, author: str });
const workDetail = object({ ...workProperties, assigneeId: nullable(userId), assigneeName: nullable(str), eligible: { ...array(object({ id: userId, name: str })), maxItems: 2000 }, eligibleLimited: bool, actions: { ...array(workAction), maxItems: 100 }, historyLimited: bool }, [...Object.keys(workProperties), "actions", "historyLimited"], "Management receives assignee and eligible staff fields. Staff projection omits all four management fields; history authors become You/Property team. historyLimited and eligibleLimited signal truncation.");
add("GET", "/api/company/work-orders/:requestId", "Read assigned work, bounded activity and management assignment options", "work-orders.ts", `${executionAccess} Alternatively maintenance.manage authorizes the company management projection.`, workDetail, { query: ignoredQuery, description: "Eligible staff must be active/verified, explicitly granted execution and scoped to the request property; up to 2,000 options. Activity is newest first, at most 100. Neither eligibility nor assignment grants unrelated company authority." });
add("POST", "/api/company/work-orders/:requestId/actions", "Apply a reviewed assignment, execution or management review action", "work-orders.ts", `${executionAccess} Alternatively maintenance.manage authorizes company management actions. Assign, approve and reopen always require maintenance.manage.`, object({ version }), {
  body: object({ action: choice("assign", "accept", "progress", "submit", "approve", "reopen"), assigneeId: nullable(userId), note: text(4000), expectedVersion: version, submissionKey: key }, ["action", "note", "expectedVersion", "submissionKey"]), conflicts: ["REOPEN_REQUIRED", "ASSIGNEE_INELIGIBLE", "WORK_STATE_CHANGED"], description: "assign requires assigneeId (null clears); other actions reject the field. Transitions: assigned→accept→accepted; progress appends note while accepted; submit→pending_review; management approve→complete/resolved; reopen pending_review/resolved→assigned or unassigned/open. Assignment of resolved work requires reopen first. Fresh assignment/property authorization precedes retry receipt lookup, so revoked staff cannot replay. Every accepted new action increments request version; exact retry returns current request version without another action. Notes/audits and notifications commit with the state change.",
});

export const maintenanceApiContracts = contracts;
