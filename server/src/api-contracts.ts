import type { FastifySchema } from "fastify";
import inventory from "./api/route-inventory.json" with { type: "json" };
import { coreApiContracts } from "./api/core-contracts.js";
import { workspaceApiContracts } from "./api/workspace-contracts.js";
import { identityApiContracts } from "./api/identity-contracts.js";
import { platformApiContracts } from "./api/platform-contracts.js";
import { leasingApiContracts } from "./api/leasing-contracts.js";
import { peopleDocumentsApiContracts } from "./api/people-documents-contracts.js";
import { moneyApiContracts } from "./api/money-contracts.js";
import { maintenanceApiContracts } from "./api/maintenance-contracts.js";

type IndexedOperation = {
  operation: string;
  method: string;
  path: string;
  protocol: string;
  source: { file: string; line: number };
  authentication: string;
  supportMode: string;
  bodyKeys?: string[];
  queryKeys?: string[];
  headerKeys?: string[];
  observedPermissionCalls?: string[];
  statuses?: number[];
  errorCodes?: string[];
  handlerHash: string;
};

const operations = inventory.routes as IndexedOperation[];
const indexed = new Map(operations.map(operation => [operation.operation, operation]));
const reviewedModules = [coreApiContracts, workspaceApiContracts, identityApiContracts, platformApiContracts,
  leasingApiContracts, peopleDocumentsApiContracts, moneyApiContracts, maintenanceApiContracts];
const reviewed: Record<string, FastifySchema> = Object.assign({}, ...reviewedModules);
const reviewedKeys = reviewedModules.flatMap(module => Object.keys(module));

function group(operation: IndexedOperation) {
  if (operation.protocol === "health") return "Operations";
  if (operation.protocol === "authentication-session" || /^\/api\/invitations/.test(operation.path)) return "Accounts and invitations";
  if (operation.path.startsWith("/api/platform/") || operation.path === "/api/impersonation") return "Platform administration";
  if (operation.path.startsWith("/api/resident/")) return "Resident self-service";
  if (/(?:^|\/)(?:rent|rent-schedules|rent-recovery|finances|deposits|statements|reports|historical-cash-reports|expense-imports|company-billing|lease-charges|lease-movements|lease-settlements|lease-proration|lease-transitions|lease-term-changes)\.ts$/.test(operation.source.file)) return "Money and reports";
  if (/maintenance|work-orders|vendor|preventive|work-calendar/.test(operation.source.file)) return "Maintenance";
  if (/document|inspection|agreement/.test(operation.source.file)) return "Documents and inspections";
  if (/leasing|lease-|prospect|rental-application|unit-availability|unit-import|task-draft/.test(operation.source.file)) return "Leasing";
  if (/contact|resident-profile|staff-property/.test(operation.source.file)) return "People and access";
  if (/notification|workspace-guide|account-profile|browser-telemetry/.test(operation.source.file)) return "Personal workspace";
  return "Company and property records";
}

function indexedContract(operation: IndexedOperation): FastifySchema {
  const authenticated = operation.authentication === "preValidation-hook";
  const parameters = [...operation.path.matchAll(/:([A-Za-z0-9_]+)/g)].map(match => match[1]);
  const properties = Object.fromEntries(parameters.map(name => [name, {
    type: "string", description: "Exact source identifier. Identifier grammars differ by operation; consult the linked handler.",
  }]));
  return {
    operationId: `${operation.method.toLowerCase()}_${operation.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "root"}`,
    summary: `${operation.method} ${operation.path}`,
    tags: [group(operation)],
    description: "SOURCE INDEX ONLY — field-level request/response schemas and complete operation-specific authorization require review. " +
      "This entry is not a verified integration contract. Existing handlers remain authoritative. " +
      `Source: ${operation.source.file}:${operation.source.line}. ` +
      "Observed fields and permission calls below are bounded source evidence, not an exhaustive schema or an authorization grant.",
    security: authenticated ? [{ sessionCookie: [] }] : [],
    ...(parameters.length ? { params: { type: "object", required: parameters, properties } } : {}),
    response: { default: { description: "Response bodies and status outcomes await operation-specific review; no success schema is inferred from route registration." } },
    "x-pf-contract-status": "source-indexed",
    "x-pf-source": operation.source,
    "x-pf-handler-hash": operation.handlerHash,
    "x-pf-authentication": authenticated
      ? "Server-managed session cookie; current account, verification, membership, feature and support context are revalidated by existing authentication/handlers."
      : "No route preValidation hook. Health and authentication/token-bound entry flows have distinct requirements; review the source before use.",
    "x-pf-support": operation.supportMode,
    "x-pf-observed-permission-calls": operation.observedPermissionCalls ?? [],
    "x-pf-observed-input-fields": {
      body: operation.bodyKeys ?? [], query: operation.queryKeys ?? [], headers: operation.headerKeys ?? [],
    },
    "x-pf-observed-statuses": operation.statuses ?? [],
    "x-pf-observed-error-codes": operation.errorCodes ?? [],
  } as FastifySchema;
}

/** Schemas are documentation projections only; do not attach these to handlers. */
export function apiContractForRoute(method: string, path: string): FastifySchema | undefined {
  const key = `${method.toUpperCase()} ${path}`;
  const operation = indexed.get(key);
  if (!operation) return undefined;
  const base = indexedContract(operation);
  return reviewed[key] ? { ...base, ...reviewed[key] } : base;
}

export function isSourceReviewedContract(schema: FastifySchema | undefined): boolean {
  const contract = schema as (FastifySchema & Record<string, unknown>) | undefined;
  return contract?.["x-pf-contract-status"] === "source-reviewed" &&
    typeof contract.summary === "string" && contract.summary.trim().length > 0 &&
    typeof contract.description === "string" && contract.description.trim().length > 0 &&
    !!contract.response && Object.keys(contract.response).some(status => /^[1-5][0-9]{2}$/.test(status));
}

export function apiContractCoverage() {
  const sourceReviewed = operations.filter(operation => isSourceReviewedContract(reviewed[operation.operation])).map(operation => operation.operation);
  return {
    indexedOperations: operations.length,
    sourceReviewedOperations: sourceReviewed.length,
    handlerVerifiedOperations: 0,
    sourceIndexedOnly: operations.filter(operation => !isSourceReviewedContract(reviewed[operation.operation])).map(operation => operation.operation),
    sourceReviewed,
    orphanReviewedContracts: Object.keys(reviewed).filter(key => !indexed.has(key)),
    duplicateReviewedContracts: [...new Set(reviewedKeys.filter((key, index) => reviewedKeys.indexOf(key) !== index))],
    limitations: [
      "Source review is distinct from schema assertions against real handler outcomes.",
      "Source-indexed entries intentionally omit unverified payload/response schemas rather than inventing contracts.",
      "Generated HEAD operations and documentation infrastructure are separately accounted for by the complete route inventory.",
    ],
  };
}

/** Actual cookie configuration is supplied by the production composition root. */
export function apiDocumentTransform(document: any, secureCookies: boolean) {
  return {
    ...document,
    components: {
      ...document.components,
      securitySchemes: {
        ...document.components?.securitySchemes,
        sessionCookie: {
          type: "apiKey", in: "cookie", name: secureCookies ? "__Host-pf-session" : "pf-session",
          description: "Existing HttpOnly application session. Sign in through the application; OAuth/provider tokens are not browser API credentials. Writes additionally require the exact Origin and X-CSRF-Token. Support context has its own acknowledgment and read-only rules. The reference does not store credentials or execute business operations.",
        },
      },
    },
    "x-pf-coverage": apiContractCoverage(),
  };
}
