import type { FastifySchema } from "fastify";
import { browserOperations } from "../browser-telemetry.js";

// Source-reviewed documentation, consumed only by the Swagger transform.
// These definitions must never be attached to the existing runtime handlers.
const reviewedRef = "37319bf1d2edd322f9f4f625dfc7c80735b7c86d";
const source = (file: string, line: number) =>
  `[${file}:${line}](https://github.com/elijahvw/property-flow-2/blob/${reviewedRef}/${file}#L${line})`;
const error = (description: string) => ({
  description: `${description} Safe error envelope; see ${source("server/src/request-errors.ts", 11)}.`,
  type: "object",
  required: ["error", "code", "requestId"],
  additionalProperties: false,
  properties: {
    error: { type: "string", description: "Actionable message without provider or database internals." },
    code: { type: "string", description: "Machine-readable AccessError code or REQUEST_<HTTP status>." },
    requestId: { type: "string", description: "Request correlation identifier." },
  },
});
const statusOk = {
  type: "object", required: ["status"], additionalProperties: false,
  properties: { status: { type: "string", enum: ["ok"] } },
};
const mutationHeaders = {
  type: "object",
  required: ["origin", "x-csrf-token"],
  additionalProperties: true,
  properties: {
    origin: { type: "string", description: "Must equal the configured application origin exactly." },
    "x-csrf-token": { type: "string", description: "Current browser session's CSRF value obtained through bootstrap; never record it in examples or browser documentation storage." },
  },
};
const publicAccess = {
  "x-pf-contract-status": "source-reviewed",
  "x-pf-authentication": ["No authenticated browser session is required."],
  "x-pf-authorization": ["No company, property or platform permission is checked; no business records are returned."],
  "x-pf-support": ["No impersonation projection is loaded by this handler."],
};
type ReviewedContract = FastifySchema & Record<`x-pf-${string}`, unknown>;

const definitions = {
  "GET /": {
    ...publicAccess,
    operationId: "rootLiveness", tags: ["Health"], summary: "Check process liveness",
    description: `Returns a fixed process status without querying the database. Source: ${source("server/src/index.ts", 38)}.`,
    security: [],
    response: { 200: { ...statusOk, description: "Process is accepting requests; not a database-readiness claim." } },
  },
  "GET /api/health": {
    ...publicAccess,
    operationId: "apiLiveness", tags: ["Health"], summary: "Check API process liveness",
    description: `Returns a fixed status without querying the database. Exempt from the configured edge-origin secret check. Sources: ${source("server/src/index.ts", 39)}; ${source("server/src/sessions.ts", 146)}.`,
    security: [],
    response: { 200: { ...statusOk, description: "API process is accepting requests; not a database-readiness claim." } },
  },
  "GET /api/ready": {
    ...publicAccess,
    operationId: "apiReadiness", tags: ["Health"], summary: "Check database readiness",
    description: `Executes SELECT 1 before returning readiness. Exempt from the configured edge-origin secret check. Sources: ${source("server/src/index.ts", 40)}; ${source("server/src/request-errors.ts", 11)}.`,
    security: [],
    response: {
      200: {
        description: "Database probe completed for this request.", type: "object",
        required: ["status", "db"], additionalProperties: false,
        properties: { status: { type: "string", enum: ["ok"] }, db: { type: "string", enum: ["connected"] } },
      },
      503: error("Readiness probe failed; no database details are exposed."),
    },
  },
  "GET /api/auth/login": {
    "x-pf-contract-status": "source-reviewed",
    "x-pf-authentication": ["No authenticated browser session is required.", "Starts Auth0 authorization-code sign-in with PKCE, state, nonce and a browser-bound login transaction."],
    "x-pf-authorization": ["Configured edge-origin validation applies in hosted environments; its private transport header is supplied by the edge, not entered by users."],
    "x-pf-support": ["Begins a new sign-in rather than performing a business action as the viewed account."],
    operationId: "startBrowserSignIn", tags: ["Authentication"], summary: "Start browser sign-in",
    description: `Browser navigation endpoint, not a JSON sign-in API. Stores a ten-minute one-use login transaction, issues an HttpOnly SameSite=Lax binding cookie and redirects to the configured identity provider. Cookie name is __Host-pf-login for HTTPS or pf-login locally. Source: ${source("server/src/sessions.ts", 236)}.`,
    security: [],
    querystring: {
      type: "object", additionalProperties: true,
      properties: {
        returnTo: { type: "string", description: "Untrusted application return path. safeReturnTo retains permitted routes/context only; invalid or non-string input falls back to the dashboard instead of producing a validation error." },
        switchAccount: { type: "string", description: "Only the exact string 1 adds the provider's prompt=login parameter; other values do not enable it." },
      },
    },
    response: {
      302: {
        type: "null", description: "Redirect to the configured Auth0 authorization endpoint; no JSON response body.",
        headers: {
          location: { type: "string", description: "Provider authorization URL generated for this browser transaction; contains transient state and must not be copied into examples." },
          "set-cookie": { type: "string", description: "Private login-binding cookie, ten-minute lifetime, HttpOnly, SameSite=Lax and Secure on HTTPS. No cookie value is documented." },
        },
      },
      403: error("Hosted edge-origin or trusted visitor-address validation failed."),
      429: { ...error("Sign-in initiation exceeded 30 requests per minute for the trusted visitor key."), headers: { "retry-after": { type: "string", description: "Seconds to wait before starting a fresh sign-in attempt." } } },
      503: error("Identity-provider discovery or login-transaction persistence is unavailable."),
    },
  },
  "GET /api/auth/callback": {
    "x-pf-contract-status": "source-reviewed",
    "x-pf-authentication": ["An authenticated session is not required.", "Successful exchange requires a current unconsumed login transaction and its matching browser-binding cookie, then valid provider state, PKCE, nonce and claims."],
    "x-pf-authorization": ["Configured hosted edge-origin validation applies.", "Identity synchronization uses exact issuer and subject mappings; this callback does not itself grant arbitrary company or property access."],
    "x-pf-support": ["Successful sign-in replaces this browser's previous session; it does not sign in as the current support-view target."],
    operationId: "completeBrowserSignIn", tags: ["Authentication"], summary: "Complete provider sign-in callback",
    description: `Identity-provider protocol endpoint, not a JSON credential exchange. Always clears the login-binding cookie. Missing, expired, mismatched or consumed binding redirects with authError=expired and creates no session. A consumed valid transaction exchanges the authorization code: success issues the private HttpOnly SameSite=Strict session cookie (12-hour absolute, two-hour idle lifetime) and redirects to its sanitized return path; exchange/synchronization failure redirects with authError=failed. Provider OAuth/OIDC tokens are not returned to the browser. Source: ${source("server/src/sessions.ts", 287)}.`,
    security: [],
    querystring: {
      type: "object", additionalProperties: true,
      properties: {
        state: { type: "string", description: "Transient provider state corresponding to the one-use login transaction. Missing or invalid values follow the expired redirect path." },
        code: { type: "string", description: "Transient provider authorization code, consumed server-side; never supply a captured value in documentation." },
        error: { type: "string", description: "Provider error indicator, when authorization failed instead of issuing a code." },
        error_description: { type: "string", description: "Optional provider error detail; not echoed to the application's failure redirect." },
        error_uri: { type: "string", description: "Optional provider error reference handled by the OIDC exchange." },
        iss: { type: "string", description: "Optional authorization-response issuer handled by the OIDC exchange." },
      },
    },
    headers: {
      type: "object", additionalProperties: true,
      properties: { cookie: { type: "string", description: "Browser-supplied private login-binding cookie. Missing binding redirects to the expired sign-in result; no cookie value is documented." } },
    },
    response: {
      302: {
        type: "null", description: "Success return path or safe expired/failed sign-in redirect; no JSON response body.",
        headers: {
          location: { type: "string", description: "Sanitized stored application return path on success; application root with an expired or failed authError otherwise." },
          "set-cookie": { type: "string", description: "May be repeated: clears the login-binding cookie; success also issues __Host-pf-session on HTTPS or pf-session locally. These are private HttpOnly browser cookies with no documented values." },
        },
      },
      403: error("Configured hosted edge-origin validation failed before callback handling."),
      503: error("Login-transaction lookup or atomic consumption failed before the exchange failure-redirect boundary."),
    },
  },
  "POST /api/auth/logout": {
    "x-pf-contract-status": "source-reviewed",
    "x-pf-authentication": ["Requires an unexpired browser session plus exact application Origin and current session CSRF value.", "Sign-out remains available to unverified actors; session expiration still requires a fresh sign-in."],
    "x-pf-authorization": ["No operation-specific company, property or platform role is required.", "Revokes the signed-in actor's exact session and records session.revoked atomically."],
    "x-pf-support": ["Allowed during active or unavailable impersonation.", "Uses the signed-in actor and is explicitly exempt from the X-Impersonation-ID context acknowledgment requirement."],
    operationId: "revokeBrowserSession", tags: ["Authentication"], summary: "Revoke this browser session",
    description: `Revokes the application session, clears its cookie and returns a provider logout URL as JSON. The endpoint itself does not redirect or prove provider sign-out; the client may navigate to logoutUrl afterward. No request body is consumed and no durable submission key is supported. Sources: ${source("server/src/sessions.ts", 370)}; authentication exceptions ${source("server/src/sessions.ts", 193)}.`,
    security: [{ sessionCookie: [] }], headers: mutationHeaders,
    response: {
      200: {
        description: "Local application session revoked; caller can navigate to the configured provider logout URL.",
        type: "object", required: ["logoutUrl"], additionalProperties: false,
        properties: { logoutUrl: { type: "string", format: "uri", description: "Configured Auth0 logout endpoint with application return origin. It is not evidence that the browser completed provider logout." } },
        headers: { "set-cookie": { type: "string", description: "Expires the browser's HttpOnly application session cookie; no cookie value is documented." } },
      },
      400: error("Malformed request content was rejected before sign-out handling."),
      401: error("Browser session is missing or expired."),
      403: error("Application Origin, current CSRF value or configured hosted edge validation was rejected."),
      413: error("Request body exceeds the application limit, even though this handler consumes no body."),
      415: error("Unsupported request content type was rejected before sign-out handling."),
      503: error("Session lookup, revocation or audit persistence is unavailable."),
    },
  },
  "POST /api/telemetry": {
    "x-pf-contract-status": "source-reviewed",
    "x-pf-authentication": ["Requires an unexpired browser session, exact application Origin and current session CSRF value.", "The signed-in actor must have verified email under the shared session guard."],
    "x-pf-authorization": ["No operation-specific company, property or platform role is required.", "Accepts only the fixed operation-name/outcome vocabulary and bounded duration; it never executes the named operation or returns business records."],
    "x-pf-support": ["Explicitly permitted POST exception to impersonation read-only mode.", "Requires exact current X-Impersonation-ID acknowledgment when viewing another account; stale, expired or unavailable context is rejected."],
    operationId: "recordBrowserOperations", tags: ["Observability"], summary: "Record bounded browser operation signals",
    description: `Accepts 1–16 closed-vocabulary events in an at-most-8192-byte JSON body, then returns 204 with no body. Rate limit is eight requests per minute per effective principal ID (IP fallback). No private form values, URLs, messages or contact/financial data are accepted by the documented event schema. This is operational telemetry, not an audit/event creation API for business records; it has no durable submission key. Sources: ${source("server/src/browser-telemetry.ts", 66)}; session and support-context checks ${source("server/src/sessions.ts", 161)}.`,
    security: [{ sessionCookie: [] }], consumes: ["application/json"],
    headers: {
      ...mutationHeaders,
      properties: {
        ...mutationHeaders.properties,
        "x-impersonation-id": { type: "string", description: "Exact current opaque support-view context returned by bootstrap when impersonating. Omit or send empty in the actor's own account. Never reuse another account's context." },
      },
    },
    body: {
      type: "object", additionalProperties: false, required: ["events"],
      properties: {
        events: {
          type: "array", minItems: 1, maxItems: 16,
          items: {
            type: "object", additionalProperties: false, required: ["name", "outcome", "duration"],
            properties: {
              name: { type: "string", enum: browserOperations },
              outcome: { type: "string", enum: ["success", "error", "abandoned", "other"] },
              duration: { type: "number", minimum: 0, maximum: 120000 },
            },
          },
        },
      },
    },
    response: {
      204: { type: "null", description: "Accepted operation signals; no response body." },
      400: error("JSON parsing or bounded event-schema validation failed."),
      401: error("Browser session is missing or expired."),
      403: error("Origin, CSRF, verification, configured hosted edge validation or current support authority was rejected."),
      409: error("The request's support-view context no longer matches the session; reload before recording another event."),
      413: error("Request exceeds the endpoint's 8192-byte body limit."),
      415: error("Unsupported request content type."),
      429: { ...error("More than eight telemetry requests per minute for the effective principal key."), headers: { "retry-after": { type: "string", description: "Seconds until the request rate window permits another batch." } } },
      503: error("Session lookup, context-dependent account access or telemetry processing is unavailable."),
    },
  },
} satisfies Record<string, ReviewedContract>;

export const coreApiContracts: Record<string, FastifySchema> = definitions;
