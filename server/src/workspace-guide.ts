import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError, permissions } from "./access.js";
import { serializable } from "./application.js";
import { choice, input, mutation, version } from "./operational.js";

type Step = { id: string; title: string; description: string; path: string; action: string; help: string };
const step = (id: string, title: string, description: string, path: string, action: string, help: string): Step => ({ id, title, description, path, action, help });
const management = [
  step("overview", "Your daily workspace", "Overview brings together your properties and work that needs attention. Open a task to continue with the right records and filters.", "/company/overview", "Open overview", "getting-started"),
  step("properties", "Start with a property and its units", "Add the place you manage, then the units you rent. Each property keeps its people, leases, money and maintenance connected.", "/company/properties", "View properties", "properties"),
  step("tenants", "Save each tenant once", "Add a tenant before they sign in. Reuse that person when recording a lease. Portal invitations are optional and owners approve access.", "/company/residents", "View tenants", "people"),
  step("leases", "Connect the lease and household", "Review the unit, dates, household and rent. An active lease, portal access and recurring billing are separate decisions; the lease workspace guides the next step.", "/company/leases", "View leases", "leases"),
  step("money", "Record money in the right place", "Use Rent & balances for lease payments and Deposits for refundable security deposits. Their linked receipts appear in cash activity, so record each payment only once.", "/company/rent", "View rent & balances", "rent"),
  step("maintenance", "Keep work moving", "Record requests, assign authorized staff and review completion. Shared updates stay distinct from internal notes. Help is always available for the next task.", "/company/maintenance", "View maintenance", "maintenance"),
];
const resident = [
  step("rental", "Your rental at a glance", "My rental connects the properties and lease records your management team has approved for you. Ask your manager if your home is missing.", "/resident", "Open my rental", "resident-portal"),
  step("money", "Understand your rental records", "Approved leaseholders can view shared rent and deposit records. Occupants do not receive financial access. Recorded receipts show money already received; this app does not collect online payments.", "/resident/rent", "View my rent", "resident-portal"),
  step("requests", "Ask for maintenance", "Submit a request with a useful description and follow shared updates in My requests. For emergencies, use your local emergency services.", "/resident/maintenance", "View my requests", "maintenance"),
  step("profile", "Keep your contact details current", "Update your contact and emergency details in My profile. Your manager handles household, lease and access changes. Find task guides and replay this tour in Help.", "/account", "Open my profile", "account"),
];
const platform = [
  step("companies", "Set up a company and its owner", "Companies keeps customer administration separate from property operations. Assign an active owner so the company can manage its own workspace.", "/platform/companies", "View companies", "administration"),
  step("users", "Manage sign-in accounts and access", "Create or reuse a sign-in account, then review its company assignment. Account existence and platform authority do not grant access to a customer's property records.", "/platform/users", "View users", "administration"),
  step("activity", "Follow recorded changes", "Use Activity and each person's history to understand access changes. Private invitation links and credentials never belong in activity notes.", "/platform/audit", "View activity", "administration"),
];

function definition(user: NonNullable<FastifyRequest["principal"]>, requested?: string) {
  const grants = permissions(user), role = user.membership?.role;
  const eligible = user.status === "active" && user.emailVerified && grants.length > 0;
  const scope = requested === "platform" && grants.includes("platform.manage") ? "platform" : grants.includes("property.read") ? "company" : grants.includes("resident.self") ? "resident" : grants.includes("platform.manage") ? "platform" : "account";
  const steps = scope === "platform" ? platform : scope === "resident" ? resident : role === "staff" ? [
    step("properties", "Your property workspace", "View the properties and units your owner has granted. Staff property access is read-only unless a separate maintenance grant applies.", "/company/properties", "View properties", "people"),
    ...(grants.includes("maintenance.execute") ? [step("work", "Follow your assigned work", "Accept a job, record progress and submit completion for management review. Only work currently assigned within your property scope is available.", "/company/work-orders", "View assigned work", "maintenance")] : []),
    step("help", "Keep your details current", "Use My profile for your contact details and Help for task guides. Contact the company owner to request changes to your property or work access.", "/account", "Open my profile", "account"),
  ] : management;
  const guideKey = `1:${scope}:${user.membership?.companyId || "platform"}:${role || "platform"}:${grants.includes("maintenance.execute") ? "work" : "view"}`;
  return { eligible, steps, guideKey };
}

export function registerWorkspaceGuide(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  async function own(request: FastifyRequest, update?: { guideKey: string; status: string; step: string; expectedVersion: number }) {
    return serializable(db, async tx => {
      if (update) await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${request.principal!.id} RETURNING id`;
      else await tx.$queryRaw`SELECT id FROM "User" WHERE id=${request.principal!.id} FOR SHARE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: request.principal!.id }, include: { membership: { include: { company: true } } } });
      if (user.status !== request.principal!.status || user.membership?.companyId !== request.principal!.membership?.companyId || JSON.stringify(permissions(user)) !== JSON.stringify(permissions(request.principal!))) throw new AccessError(403, "ACCESS_CHANGED", "Your workspace access changed. Refresh to continue.");
      const query = request.query as Record<string,unknown>;
      if(Object.keys(query).some(key=>key!=="workspace") || query.workspace!==undefined && !["company","resident","platform"].includes(String(query.workspace))) throw new AccessError(400,"INVALID_INPUT","Choose a valid walkthrough workspace.");
      const guide = definition(user,String(query.workspace||""));
      const allStates = (user.guideState || {}) as Record<string,{guideKey?: string;status?:string;step?:string}>;
      const stored = allStates[guide.guideKey];
      let state = stored?.guideKey === guide.guideKey ? stored : { guideKey: guide.guideKey, status: "new", step: guide.steps[0].id };
      let currentVersion = user.guideVersion;
      if (update) {
        if (!guide.eligible || update.guideKey !== guide.guideKey || !guide.steps.some(item => item.id === update.step)) throw new AccessError(409, "GUIDE_CHANGED", "The walkthrough changed with your access. Reload it before continuing.");
        const next = { guideKey: guide.guideKey, status: update.status, step: update.step };
        if (state.guideKey !== next.guideKey || state.status !== next.status || state.step !== next.step) {
          if (user.guideVersion !== update.expectedVersion) throw new AccessError(409, "GUIDE_CHANGED", "Your walkthrough progress changed in another tab. Reload to continue.");
          const saved = await tx.user.update({ where: { id: user.id }, data: { guideState: {...allStates,[guide.guideKey]:next}, guideVersion: { increment: 1 } }, select: { guideVersion: true } });
          currentVersion = saved.guideVersion; state = next;
        }
      }
      return { ...guide, ...state, version: currentVersion };
    });
  }
  server.get("/api/account/guide", { preValidation: authenticate }, request => own(request));
  server.put("/api/account/guide", { preValidation: authenticate }, request => {
    mutation(request, origin);
    const b = input(request, ["expectedVersion", "guideKey", "status", "step"]);
    if (typeof b.guideKey !== "string" || b.guideKey.length > 300 || typeof b.step !== "string") throw new AccessError(400, "INVALID_INPUT", "Choose the current walkthrough step.");
    return own(request, { guideKey: b.guideKey, step: b.step, expectedVersion: version(b.expectedVersion), status: choice(b.status, ["in_progress", "dismissed", "complete"], "walkthrough status") });
  });
}
