import { createHash } from "node:crypto";
import { AccessError } from "./access.js";
import { FEATURE_CATALOG } from "./company-features.js";
import { DEMO_PEOPLE } from "./sales-demo-credentials.js";
import { DEMO_FEATURE_COVERAGE } from "./sales-demo-scenarios.js";

export type DemoEnvironment = {
  name: string;
  origin: string;
  identityIssuer: string | null;
  provisioningAllowed: boolean;
};
export type DemoBlueprint = {
  format: 1;
  seedVersion: number;
  anchorOn: string;
  environment: DemoEnvironment;
  sourceReview?: { planHash: string; replacementSetupId: string };
};
export function demoEnvironment(origin: string, identityIssuer?: string, identityReady = !!identityIssuer): DemoEnvironment {
  const name = process.env.SALES_DEMO_DISPOSABLE === "tmpfs-verified" ? "disposable_test" : process.env.APP_ENV || "unconfigured";
  return { name, origin: new URL(origin).origin, identityIssuer: identityIssuer || null,
    provisioningAllowed: ["dev", "development", "test", "disposable_test"].includes(name) && !!identityIssuer && identityReady };
}
export function demoPlanHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function readDemoBlueprint(value: unknown): DemoBlueprint | null {
  if (value === null || value === undefined) return null;
  const b = value as DemoBlueprint;
  if (b.format !== 1 || !Number.isInteger(b.seedVersion) || b.seedVersion < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(b.anchorOn) ||
    !b.environment || typeof b.environment.name !== "string" || typeof b.environment.origin !== "string" ||
    b.environment.identityIssuer !== null && typeof b.environment.identityIssuer !== "string" || typeof b.environment.provisioningAllowed !== "boolean")
    throw new AccessError(409, "DEMO_PLAN_INVALID", "This demo's saved plan is unavailable. Retire the owned setup before starting a new one.");
  if (b.sourceReview && (!/^[a-f0-9]{64}$/.test(b.sourceReview.planHash) || typeof b.sourceReview.replacementSetupId !== "string" || !b.sourceReview.replacementSetupId))
    throw new AccessError(409, "DEMO_PLAN_INVALID", "The reserved rebuild review is unavailable. No existing generation was modified.");
  return b;
}
export function assertDemoBuildPlan(blueprint: DemoBlueprint | null, current: DemoBlueprint) {
  if (!current.environment.provisioningAllowed)
    throw new AccessError(503, "DEMO_ENVIRONMENT_UNAVAILABLE", "Demo building is enabled only in the configured development or disposable test environment.");
  if (!blueprint) return; // Older resumable setups retain their existing recovery path.
  if (blueprint.environment.name !== current.environment.name || blueprint.environment.origin !== current.environment.origin || blueprint.environment.identityIssuer !== current.environment.identityIssuer)
    throw new AccessError(409, "DEMO_ENVIRONMENT_CHANGED", "This setup belongs to another application or identity environment. Restore its original configuration before resuming or cleaning it up.");
  if (blueprint.seedVersion !== current.seedVersion || blueprint.anchorOn !== current.anchorOn)
    throw new AccessError(409, "DEMO_PLAN_EXPIRED", "This unfinished setup uses an older fixture or business day. Retire it, then review and build a fresh demo. Existing history is unchanged.");
}
export function demoBlueprintPlan(blueprint: DemoBlueprint) {
  return { ...blueprint, planHash: demoPlanHash(blueprint),
    roles: DEMO_PEOPLE.map(([key, role, name]) => ({ key, role, name, login: !["offline", "pending", "former"].includes(key) })),
    coverage: FEATURE_CATALOG.map(feature => ({ key: feature.key, label: feature.label, sources: DEMO_FEATURE_COVERAGE[feature.key] })),
    effects: { dedicatedCompanies: 1, preparedAccounts: DEMO_PEOPLE.length, issuedLogins: DEMO_PEOPLE.filter(([key]) => !["offline", "pending", "former"].includes(key)).length,
      sendsExternalMessages: false, movesMoney: false, signsAgreements: false, editsCustomerRecords: false, preservesRetiredHistory: true },
    walkthrough: [
      { role: "Owner", task: "Review portfolio, vacant/readiness/listing states, tenants and their lease sources." },
      { role: "Manager", task: "Follow arrears, an offline tenant's partial-month rent and a former tenant's settlement/refund history." },
      { role: "Staff technician", task: "Open assigned work and completion history; confirm other-property and finance access stays denied." },
      { role: "Resident / leaseholder", task: "Open only this household's rental, balances, shared originals and maintenance conversation." },
      { role: "Occupant (no finances)", task: "Compare the same household's permitted service view without lease financial access." },
    ],
  };
}
