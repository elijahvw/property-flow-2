import type { PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";

// These are implemented product areas, never prospective plan promises.
export const FEATURE_CATALOG = [
  { key: "properties", label: "Properties and units", description: "Property records, units and the company overview." },
  { key: "leasing", label: "Leasing and tenants", description: "Tenant records, leases, households and rental lifecycle." },
  { key: "maintenance", label: "Maintenance", description: "Requests, assigned work, vendors, preventive work and calendar." },
  { key: "documents", label: "Private documents", description: "Document library, retained versions and permitted downloads." },
  { key: "finances", label: "Rent and finances", description: "Rent, deposits, cash activity, financial adjustments and statements." },
  { key: "reports", label: "Reports", description: "Company financial reports and exports." },
  { key: "inspections", label: "Inspections", description: "Lease inspections and management review." },
  { key: "agreements", label: "Agreement preparation", description: "Unsigned agreement packages, versions and reviews." },
  { key: "notifications", label: "In-app notifications", description: "Source-linked company and resident inbox notifications." },
  { key: "resident_portal", label: "Resident portal", description: "Existing residents' assigned rental workspace and permitted records." },
] as const;
export type FeatureKey = typeof FEATURE_CATALOG[number]["key"];
export type FeatureMode = "enabled" | "read_only" | "disabled";
export type CompanyFeatures = Record<FeatureKey, FeatureMode>;
type SubscriptionPolicy = {
  planId?: string | null;
  plan?: { features: unknown } | null;
  status: string;
  trialEndsAt?: Date | string | null;
  featureOverrides: unknown;
  overrideExpiresAt?: Date | string | null;
};
const keys = FEATURE_CATALOG.map(feature => feature.key);
const modes: readonly string[] = ["enabled", "read_only", "disabled"];
const dateTime = (value: Date | string) => value instanceof Date ? value.getTime() : Date.parse(value);

export function effectiveFeatures(subscription: SubscriptionPolicy | null | undefined, now = new Date()): CompanyFeatures {
  const result = Object.fromEntries(keys.map(key => [key, "enabled"])) as CompanyFeatures;
  if (!subscription) return result;
  if (subscription.plan || subscription.planId) {
    const configured = subscription.plan?.features;
    const valid = Array.isArray(configured) && configured.every(key => typeof key === "string" && keys.includes(key as FeatureKey));
    for (const key of keys) result[key] = valid && configured.includes(key) ? "enabled" : "disabled";
  }
  const overrideDeadline = subscription.overrideExpiresAt == null ? Infinity : dateTime(subscription.overrideExpiresAt);
  const overrides = subscription.featureOverrides;
  if (overrideDeadline > now.getTime() && overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    for (const key of keys) {
      const mode = (overrides as Record<string, unknown>)[key];
      // Invalid persisted configuration cannot silently become an enable grant.
      if (mode !== undefined) result[key] = typeof mode === "string" && modes.includes(mode) ? mode as FeatureMode : "disabled";
    }
  }
  const trialValid = subscription.status !== "trial" ||
    subscription.trialEndsAt != null && dateTime(subscription.trialEndsAt) > now.getTime();
  if (!["active", "trial"].includes(subscription.status) || !trialValid) {
    for (const key of keys) if (result[key] === "enabled") result[key] = "read_only";
  }
  return result;
}

// The first feature identifies analytics ownership; remaining entries are
// authorization dependencies. Match specific nested areas before their parent.
export function routeFeatures(path: string): FeatureKey[] {
  path = path.split("?")[0];
  if (/^\/api\/account\/notifications(?:\/|$)/.test(path)) return ["notifications"];
  if (!/^\/api\/(?:company|resident)(?:\/|$)/.test(path)) return [];
  const resident = /^\/api\/resident(?:\/|$)/.test(path);
  const companyRoot = path.replace(/^\/api\/(?:company|resident)/, "");
  if (resident && !companyRoot) return ["resident_portal"];
  if (!resident && (/^\/(?:subscription|billing|usage|members|roles|profile-history|transfer-ownership)(?:\/|$)/.test(companyRoot) || companyRoot === "")) return [];
  const suffix: FeatureKey[] = resident ? ["resident_portal"] : [];
  const result = (first: FeatureKey, ...dependencies: FeatureKey[]) => [...new Set([first, ...dependencies, ...suffix])];
  if (/^\/availability(?:\/|$)/.test(companyRoot) || /^\/units\/[^/]+\/availability(?:\/|$)/.test(companyRoot)) return result("leasing", "properties");
  if (/^\/imports\/units(?:\/|$)/.test(companyRoot)) return result("properties");
  if (/^\/imports\/expenses(?:\/|$)/.test(companyRoot)) return result("finances", "leasing", "properties");
  if (/^\/prospects(?:\/|$)/.test(companyRoot)) return result("leasing", "properties");
  if (resident && /^\/documents(?:\/|$)/.test(companyRoot)) return result("documents", "leasing");
  if (/^\/leases\/[^/]+\/documents\/[^/]+\/shares(?:\/|$)/.test(companyRoot)) return result("documents", "leasing", "resident_portal");
  if (/\/documents(?:\/|$)/.test(companyRoot)) return result("documents", ...(companyRoot.startsWith("/leases/") ? ["leasing" as const] : companyRoot.startsWith("/maintenance/") ? ["maintenance" as const] : []));
  if (/\/inspections(?:\/|$)/.test(companyRoot)) return result("inspections", "leasing");
  if (/\/agreements(?:\/|$)/.test(companyRoot)) return result("agreements", "leasing", "documents");
  if (/^\/reports(?:\/|$)/.test(companyRoot)) return result("reports", "finances");
  if (/^\/(?:rent|rent-schedules|finances|deposits|deposit-receipts|statements|lease-movements)(?:\/|$)/.test(companyRoot)) return result("finances", "leasing");
  if (/^\/leases\/[^/]+\/(?:proration|terms|settlement|transition)(?:\/|$)/.test(companyRoot)) return result("finances", "leasing");
  if (/^\/maintenance\/[^/]+\/costs(?:\/|$)/.test(companyRoot)) return result("finances", "maintenance");
  if (/^\/properties\/[^/]+\/residents(?:\/|$)/.test(companyRoot)) return result("leasing", "properties");
  if (/^\/(?:maintenance|work-orders|vendors|preventive|work-calendar)(?:\/|$)/.test(companyRoot)) return result("maintenance");
  if (/^\/(?:leases|resident-contacts|resident-profiles|residents)(?:\/|$)/.test(companyRoot)) return result("leasing");
  // Property/overview/directory routes and future company operating routes are
  // controlled by the portfolio area until explicitly classified above.
  return result("properties");
}

export function memberRouteFeatures(path: string, role?: string): FeatureKey[] {
  const required = routeFeatures(path);
  // Resident inboxes are part of portal access, while personal profile and
  // verification recovery remain independent of the company's portal plan.
  return role === "resident" && required.includes("notifications") && !required.includes("resident_portal")
    ? [...required, "resident_portal"] : required;
}

export function requireFeatures(policy: CompanyFeatures, required: readonly FeatureKey[], method: string) {
  for (const key of required) {
    const label = FEATURE_CATALOG.find(feature => feature.key === key)!.label;
    if (policy[key] === "disabled")
      throw new AccessError(403, "FEATURE_DISABLED", `${label} is disabled for this company. Contact the platform owner to review access.`);
    if (policy[key] !== "enabled" && !["GET", "HEAD", "OPTIONS"].includes(method))
      throw new AccessError(403, "SUBSCRIPTION_READ_ONLY", `${label} is read-only under this company's current access settings. Contact the platform owner before making changes.`);
  }
}
export async function companyFeatures(db: Pick<PrismaClient, "companySubscription">, companyId: string, now = new Date()) {
  return effectiveFeatures(await db.companySubscription.findUnique({ where: { companyId }, include: { plan: true } }), now);
}
