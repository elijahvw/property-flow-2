import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { PrismaClient, SalesDemoSetup } from "@prisma/client";
import { AccessError, requirePermission } from "./access.js";
import { assignmentId, serializable } from "./application.js";
import { input, mutation, submission, sameSubmission, version, type Tx } from "./operational.js";
import type { IdentityProvider, ProviderUser } from "./identity-provider.js";
import { seedSalesDemo, SALES_DEMO_SEED_VERSION } from "./sales-demo-seed.js";
import { DEMO_PEOPLE, newDemoCredentials, openDemoCredentials, sealDemoCredentials } from "./sales-demo-credentials.js";
import { companyDay } from "./reports.js";
import { DEMO_FEATURE_COVERAGE, DEMO_PRESENTATION_STOPS } from "./sales-demo-scenarios.js";
import { assertDemoBuildPlan, demoBlueprintPlan, demoEnvironment, demoPlanHash, readDemoBlueprint, type DemoBlueprint } from "./sales-demo-plan.js";

const busy = () => new AccessError(409, "DEMO_SETUP_BUSY", "This demo operation is running. Wait briefly, then refresh or retry the same setup.");
const retired = () => new AccessError(409, "DEMO_RETIRED", "This demo was torn down. Build a new demo for fresh accounts and data.");
const leaseUntil = () => new Date(Date.now() + 5 * 60000);
const secretFailure = () => new AccessError(503, "DEMO_PROVIDER_RETRY", "Demo identity setup was interrupted. Retry this setup to continue safely.");
type LifecycleReview = { intent: "retire" | "rebuild"; planHash: string; replacementSetupId?: string };
type OwnedDemoAccount = ProviderUser & { cleanupConfirmedSubject?: string };

export function registerSalesDemo(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string, provider?: IdentityProvider, credentialSecret = process.env.AUTH0_WEB_CLIENT_SECRET ?? "") {
  const auth = { preValidation: authenticate };
  async function checked<T>(request: FastifyRequest, run: (tx: Tx) => Promise<T>) {
    requirePermission(request.principal!, "platform.manage");
    return serializable(db, async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${request.principal!.id} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: request.principal!.id }, include: { membership: { include: { company: true } } } });
      if (!actor) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      requirePermission(actor, "platform.manage");
      return run(tx);
    }, { timeout: 60000, maxWait: 5000 });
  }
  function configured() {
    if (!provider?.salesDemo) throw new AccessError(503, "IDENTITY_NOT_CONFIGURED", "Automatic demo accounts require the Auth0 Management API connection.");
    return provider.salesDemo;
  }
  const blueprint = (): DemoBlueprint => ({ format: 1, seedVersion: SALES_DEMO_SEED_VERSION, anchorOn: companyDay("America/New_York"), environment: demoEnvironment(origin, provider?.issuer, !!provider?.salesDemo) });
  function cleanupContext(setup: SalesDemoSetup) {
    const saved = readDemoBlueprint(setup.blueprint), current = blueprint();
    if (saved && (saved.environment.name !== current.environment.name || saved.environment.origin !== current.environment.origin || saved.environment.identityIssuer !== current.environment.identityIssuer))
      throw new AccessError(409, "DEMO_ENVIRONMENT_CHANGED", "This setup belongs to another application or identity environment. Restore its original configuration before cleanup; no account was disabled.");
  }
  function ownedAccounts(setup: SalesDemoSetup) {
    const accounts = setup.accounts as Record<string, OwnedDemoAccount>;
    if (!accounts || Array.isArray(accounts) || Object.entries(accounts).some(([key, account]) => !DEMO_PEOPLE.some(([known]) => known === key) || !account || typeof account.user_id !== "string" || account.email !== `${key}.${setup.id}@sales-demo.invalid` || account.cleanupConfirmedSubject !== undefined && account.cleanupConfirmedSubject !== account.user_id) || new Set(Object.values(accounts).map(a => a.user_id)).size !== Object.keys(accounts).length)
      throw new AccessError(409, "DEMO_OWNERSHIP_CHANGED", "This demo's generated account ownership changed. No existing account or company was modified.");
    return accounts;
  }
  const manifestValue = (manifest: unknown, path: string): unknown => path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, manifest);
  async function lifecyclePlan(tx: Tx, id: string, intent: string, excludeReplacementId?: string) {
    const setup = await tx.salesDemoSetup.findUnique({ where: { id } });
    const demo = await tx.salesDemo.findUnique({ where: { id }, include: { company: true, replacementSetups: { where: { status: { not: "retired" }, ...(excludeReplacementId ? { id: { not: excludeReplacementId } } : {}) }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } } } });
    if (!setup && !demo) throw new AccessError(404, "NOT_FOUND", "Sales demo not found.");
    if (setup?.salesDemoId && setup.salesDemoId !== id || setup && demo && setup.salesDemoId !== demo.id) throw new AccessError(409, "DEMO_OWNERSHIP_CHANGED", "This setup no longer matches its marked demo company. No existing account or company was changed.");
    const accounts = setup ? ownedAccounts(setup) : null;
    const allowed = accounts ? Object.values(accounts).map(a => a.user_id) : [demo!.ownerId, ...["residents", "managerId", "staffId", "occupantId"].flatMap(key => { const value = manifestValue(demo!.manifest, key); return Array.isArray(value) ? value.filter(v => typeof v === "string") : typeof value === "string" ? [value] : []; })];
    const members = demo ? await tx.companyMembership.findMany({ where: { companyId: demo.companyId }, select: { userId: true, status: true, version: true } , orderBy: { userId: "asc" } }) : [];
    const foreignMembers = members.filter(m => !allowed.includes(m.userId)).length;
    const users = accounts ? await tx.user.findMany({ where: { id: { in: allowed } }, include: { membership: true, identities: true }, orderBy: { id: "asc" } }) : [];
    const ownershipIssuer = setup && readDemoBlueprint(setup.blueprint)?.environment.identityIssuer || provider?.issuer;
    const changedAccounts = users.filter(u => u.platformRole || u.companyId || !Object.values(accounts!).some(a => a.user_id === u.id && a.email === u.email) || u.membership && u.membership.companyId !== demo?.companyId || ownershipIssuer && !u.identities.some(identity => identity.issuer === ownershipIssuer && identity.subject === u.id)).length;
    const blockers = [foreignMembers ? "This company contains an account not owned by this demo. Review it before retiring or rebuilding." : "", changedAccounts ? "A generated account's identity or assignment changed. Review it before proceeding." : ""].filter(Boolean);
    const replacement = demo?.replacementSetups[0] || null, currentBlueprint = blueprint();
    const anchorOn = demo ? manifestValue(demo.manifest, "today") : null;
    const snapshot = { intent, id, fixture: demo?.seedVersion ?? null, version: demo?.version ?? 1, companyId: demo?.companyId ?? null, companyVersion: demo?.company.version ?? null, companyStatus: demo?.company.status ?? null, status: demo?.status ?? setup?.status, setupStatus: setup?.status ?? null, members, accounts: Object.entries(accounts || {}).sort(([a],[b])=>a.localeCompare(b)).map(([key,a])=>[key,a.user_id,a.email]), changedAccounts, replacement, blueprint: currentBlueprint };
    return { id, intent, planHash: demoPlanHash(snapshot), expectedVersion: demo?.version ?? 1, seedVersion: demo?.seedVersion ?? null, latestSeedVersion: SALES_DEMO_SEED_VERSION, anchorOn: typeof anchorOn === "string" ? anchorOn : null, status: demo?.status ?? setup!.status, company: demo ? { id: demo.companyId, name: demo.company.name, status: demo.company.status } : null,
      automatic: !!setup, environment: currentBlueprint.environment, generatedAccounts: allowed.length, companyMembers: members.length, blockers, replacement,
      canRebuild: !!demo && !replacement && !blockers.length && currentBlueprint.environment.provisioningAllowed,
      effects: { retiresCurrentCompany: !!demo, disablesGeneratedAccounts: !!setup, preservesExistingPresenter: !setup, preservesPostedAndAuditHistory: true, deletesSourceRecords: false, createsFreshCompanyOnRebuild: true, rewritesPostedHistory: false },
      coverage: demo ? Object.entries(DEMO_FEATURE_COVERAGE).map(([key, paths]) => ({ key, complete: paths.every(path => { const value = manifestValue(demo.manifest, path); return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.length > 0; }) })) : [],
      stops: demo ? DEMO_PRESENTATION_STOPS.flatMap(stop => { const value = manifestValue(demo.manifest, stop.source); return typeof value === "string" ? [{ ...stop, path: stop.route + ("appendSource" in stop && stop.appendSource === false ? "" : encodeURIComponent(value)) + ("suffix" in stop ? stop.suffix : "") }] : []; }) : [],
    };
  }
  async function currentRun(tx: Tx, id: string, token: string, status: string) {
    const row = await tx.salesDemoSetup.findUnique({ where: { id } });
    if (!row || row.status !== status || row.leaseToken !== token || !row.leaseUntil || row.leaseUntil <= new Date()) throw busy();
    return row;
  }
  async function reveal(request: FastifyRequest, id: string) {
    return checked(request, async tx => {
      const setup = await tx.salesDemoSetup.findUnique({ where: { id }, include: { demo: { include: { company: true } } } });
      if (!setup || setup.status !== "ready" || setup.demo?.status !== "ready" || setup.demo.company.status !== "active") throw retired();
      cleanupContext(setup);
      const credentials = openDemoCredentials(id, setup.credentialsCipher, credentialSecret);
      const accounts = setup.accounts as Record<string, ProviderUser>;
      const users = await tx.user.findMany({ where: { id: { in: Object.values(accounts).map(a => a.user_id) } }, include: { membership: true, identities: true } });
      if (credentials.some(c => {
        const user = users.find(u => u.id === accounts[c.accountKey]?.user_id);
        return !user || user.status !== "active" || !user.emailVerified || user.email !== c.email || user.platformRole || user.companyId || c.login && !user.membership || user.membership && (user.membership.companyId !== setup.demo!.companyId || user.membership.status !== "active") || !user.identities.some(i => i.issuer === provider?.issuer && i.subject === user.id);
      })) throw new AccessError(409, "DEMO_ACCOUNT_ASSIGNED", "A generated account's access changed. Review its demo assignment before viewing these logins.");
      await tx.auditEvent.create({ data: { actorId: request.principal!.id, companyId: setup.demo.companyId, action: "sales_demo.credentials.revealed", targetId: id, requestId: request.id } });
      return { id, companyId: setup.demo.companyId, credentials: credentials.filter(c => c.login).map(({ role, name, email, password }) => ({ role, name, email, password })) };
    });
  }
  async function release(request: FastifyRequest, id: string, token: string) {
    await checked(request, tx => tx.salesDemoSetup.updateMany({ where: { id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } })).catch(() => {});
  }
  async function build(request: FastifyRequest, id: string) {
    const identities = configured(), token = randomUUID();
    const setup = await checked(request, async tx => {
      const row = await tx.salesDemoSetup.findUnique({ where: { id } });
      if (!row) throw new AccessError(404, "NOT_FOUND", "Demo setup not found.");
      if (row.status === "ready") return row;
      if (row.status !== "pending") throw retired();
      assertDemoBuildPlan(readDemoBlueprint(row.blueprint), blueprint());
      if (row.leaseUntil && row.leaseUntil > new Date()) throw busy();
      return tx.salesDemoSetup.update({ where: { id }, data: { leaseToken: token, leaseUntil: leaseUntil() } });
    });
    if (setup.status === "ready") return reveal(request, id);
    try {
      if (setup.sourceDemoId) {
        const review = readDemoBlueprint(setup.blueprint)?.sourceReview;
        if (!review || review.replacementSetupId !== setup.id) throw new AccessError(409, "DEMO_PLAN_INVALID", "This rebuild's saved review is unavailable. No existing generation was changed.");
        try { await retireDemo(request, setup.sourceDemoId, setup.sourceVersion!, { intent: "rebuild", ...review }); }
        catch (error) {
          if (error instanceof AccessError && error.code === "DEMO_PLAN_CHANGED") throw new AccessError(409, "DEMO_REBUILD_REVIEW_CHANGED", "The original demo changed after this replacement was reserved. Retire the unfinished replacement, then review a fresh rebuild. The original generation was not changed by this attempt.");
          throw error;
        }
      }
      const credentials = openDemoCredentials(id, setup.credentialsCipher, credentialSecret);
      for (const account of credentials) {
        await checked(request, async tx => { await currentRun(tx, id, token, "pending"); await tx.salesDemoSetup.update({ where: { id }, data: { leaseUntil: leaseUntil() } }); });
        // Provider calls stay outside DB locks. Exact generation metadata recovers
        // ambiguous creates without adopting unrelated accounts by email.
        const remote = await identities.ensure(account);
        if (remote.email !== account.email || !remote.email_verified || remote.blocked) throw secretFailure();
        await checked(request, async tx => {
          const current = await currentRun(tx, id, token, "pending");
          const accounts = current.accounts as Record<string, ProviderUser>;
          if (accounts[account.accountKey] && accounts[account.accountKey].user_id !== remote.user_id) throw new AccessError(409, "DEMO_IDENTITY_CONFLICT", "The generated demo identity changed. Tear down this setup before creating another.");
          await tx.salesDemoSetup.update({ where: { id }, data: { accounts: { ...accounts, [account.accountKey]: { user_id: remote.user_id, email: remote.email, name: account.name, email_verified: true } } } });
        });
      }
      await checked(request, async tx => {
        const current = await currentRun(tx, id, token, "pending"), users = current.accounts as Record<string, ProviderUser>;
        assertDemoBuildPlan(readDemoBlueprint(current.blueprint), blueprint());
        const company = await tx.company.create({ data: { name: "Oak & Elm · SALES DEMO", legalName: "Oak & Elm Demo Property Management", timezone: "America/New_York", contactName: users.owner.name, contactEmail: users.owner.email, contactPhone: "215-555-0100", addressLine1: "14 Maple Lane", city: "Philadelphia", region: "PA", postalCode: "19106", country: "US", adminNotes: "Fictional sales demo with automatically provisioned role accounts. Retire through Sales demo controls." } });
        for (const account of credentials) {
          const remote = users[account.accountKey];
          const existing = await tx.user.findUnique({ where: { id: remote.user_id }, include: { membership: true, identities: true } });
          if (existing && (existing.membership || existing.companyId || existing.platformRole || existing.status !== "active" || existing.email !== remote.email || !existing.identities.some(i => i.issuer === provider!.issuer && i.subject === remote.user_id)))
            throw new AccessError(409, "DEMO_ACCOUNT_ASSIGNED", "A generated demo account was assigned elsewhere. No existing assignment was changed.");
          if (existing) await tx.user.update({ where: { id: existing.id }, data: { emailVerified: true } });
          else await tx.user.create({ data: { id: remote.user_id, email: remote.email, name: account.name, emailVerified: true, accessInitializedAt: new Date(), identities: { create: { issuer: provider!.issuer, subject: remote.user_id } } } });
        }
        const ownerId = users.owner.user_id;
        await tx.companyMembership.create({ data: { userId: ownerId, companyId: company.id, role: "owner" } });
        const manifest = await seedSalesDemo(tx, company.id, { issuer: provider!.issuer, databaseConnection: provider!.databaseConnection, users, anchorOn: readDemoBlueprint(current.blueprint)?.anchorOn });
        await tx.salesDemo.create({ data: { id, ownerId, companyId: company.id, createdById: current.createdById, submissionKey: current.submissionKey, submissionHash: current.submissionHash, seedVersion: SALES_DEMO_SEED_VERSION, manifest } });
        await tx.salesDemoSetup.update({ where: { id }, data: { status: "ready", salesDemoId: id, leaseToken: null, leaseUntil: null } });
        await tx.auditEvent.create({ data: { actorId: request.principal!.id, companyId: company.id, action: "sales_demo.created", targetId: id, requestId: request.id, detail: { seedVersion: SALES_DEMO_SEED_VERSION } } });
      });
      return reveal(request, id);
    } catch (error) { if (error instanceof AccessError || (error as { code?: string }).code?.startsWith("P")) throw error; throw secretFailure(); }
    finally { await release(request, id, token); }
  }
  async function teardownSetup(request: FastifyRequest, setup: SalesDemoSetup, expectedVersion: number, review?: LifecycleReview) {
    const identities = configured(), token = randomUUID(), id = setup.id;
    const claimed = await checked(request, async tx => {
      const row = await tx.salesDemoSetup.findUniqueOrThrow({ where: { id } });
      if (row.status === "retired") return row;
      cleanupContext(row);
      if (review && row.status !== "retiring") {
        const plan = await lifecyclePlan(tx, id, review.intent, review.replacementSetupId);
        if (plan.planHash !== review.planHash) throw new AccessError(409, "DEMO_PLAN_CHANGED", "This demo changed after review. Refresh its action plan before continuing; no account was disabled.");
      }
      if (row.leaseUntil && row.leaseUntil > new Date()) throw busy();
      const demo = row.salesDemoId ? await tx.salesDemo.findUniqueOrThrow({ where: { id: row.salesDemoId } }) : null;
      if (demo && demo.id !== row.id) throw new AccessError(409, "DEMO_OWNERSHIP_CHANGED", "This setup no longer matches its marked demo company. No account was disabled.");
      if (demo && demo.status !== "retired" && demo.version !== expectedVersion) throw new AccessError(409, "RECORD_CHANGED", "Reload the demo before tearing it down.");
      const accounts = ownedAccounts(row), ids = Object.values(accounts).map(a => a.user_id).sort();
      for (const userId of ids) await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${userId} RETURNING id`;
      const users = await tx.user.findMany({ where: { id: { in: ids } }, include: { membership: true, identities: true } });
      if (users.some(u => u.platformRole || u.companyId || u.membership && u.membership.companyId !== demo?.companyId || !Object.values(accounts).some(a => a.user_id === u.id && a.email === u.email) || !u.identities.some(i => i.issuer === provider?.issuer && i.subject === u.id))) throw new AccessError(409, "DEMO_ACCOUNT_ASSIGNED", "A generated account's identity or access changed. Review that assignment before teardown; no account was disabled.");
      const sessionIds = [...ids];
      if (demo) {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${demo.companyId} FOR UPDATE`;
        await tx.$queryRaw`SELECT set_config('app.company_id', ${demo.companyId}, true)`;
        const members = await tx.companyMembership.findMany({ where: { companyId: demo.companyId }, select: { userId: true } });
        if (members.some(member => !ids.includes(member.userId))) throw new AccessError(409, "DEMO_FOREIGN_MEMBER", "This company contains an account not owned by this demo. Review it before teardown; no membership, account or session was changed.");
        sessionIds.push(...members.map(m => m.userId));
        await tx.company.update({ where: { id: demo.companyId }, data: { status: "suspended", version: { increment: 1 } } });
        await tx.companyMembership.updateMany({ where: { companyId: demo.companyId }, data: { status: "disabled", version: { increment: 1 } } });
        if (demo.status !== "retired") await tx.salesDemo.update({ where: { id: demo.id }, data: { status: "retired", retiredAt: new Date(), version: { increment: 1 } } });
      }
      await tx.user.updateMany({ where: { id: { in: ids } }, data: { status: "disabled" } });
      await tx.session.deleteMany({ where: { OR: [{ userId: { in: sessionIds } }, { impersonatedUserId: { in: sessionIds } }] } });
      await tx.auditEvent.create({ data: { actorId: request.principal!.id, companyId: demo?.companyId, action: "sales_demo.retired", targetId: id, requestId: request.id } });
      return tx.salesDemoSetup.update({ where: { id }, data: { status: "retiring", leaseToken: token, leaseUntil: leaseUntil() } });
    });
    if (claimed.status === "retired") return { id, status: "retired" };
    try {
      for (const [accountKey] of DEMO_PEOPLE) {
        const account = await checked(request, async tx => { const current = await currentRun(tx, id, token, "retiring"); await tx.salesDemoSetup.update({ where: { id }, data: { leaseUntil: leaseUntil() } }); return ownedAccounts(current)[accountKey]; });
        if (account?.cleanupConfirmedSubject === account?.user_id && account) continue;
        await identities.block({ demoId: id, accountKey, email: `${accountKey}.${id}@sales-demo.invalid` }, account?.user_id, async remote => {
          await checked(request, async tx => {
            const current = await currentRun(tx, id, token, "retiring");
            const demo = current.salesDemoId ? await tx.salesDemo.findUniqueOrThrow({ where: { id: current.salesDemoId } }) : null;
            await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${remote.user_id} RETURNING id`;
            const user = await tx.user.findUnique({ where: { id: remote.user_id }, include: { membership: true } });
            if (user && (user.platformRole || user.companyId || user.membership && user.membership.companyId !== demo?.companyId)) throw new AccessError(409, "DEMO_ACCOUNT_ASSIGNED", "A generated account was assigned elsewhere. Review that assignment before finishing teardown; its Auth0 login was not disabled.");
            if (user) await tx.user.update({ where: { id: user.id }, data: { status: "disabled" } });
            await tx.session.deleteMany({ where: { OR: [{ userId: remote.user_id }, { impersonatedUserId: remote.user_id }] } });
            await tx.salesDemoSetup.update({ where: { id }, data: { accounts: { ...(current.accounts as Record<string, ProviderUser>), [accountKey]: { user_id: remote.user_id, email: remote.email, email_verified: remote.email_verified } } } });
          });
        });
        // Store only confirmed progress, bound to the exact recorded subject.
        // Lost PATCH/receipt responses remain unacknowledged and are safely
        // rechecked. Missing, unrecorded slots still require exact lookup.
        await checked(request, async tx => {
          const current = await currentRun(tx, id, token, "retiring"), accounts = ownedAccounts(current), confirmed = accounts[accountKey];
          if (confirmed) await tx.salesDemoSetup.update({ where: { id }, data: { accounts: { ...accounts, [accountKey]: { ...confirmed, cleanupConfirmedSubject: confirmed.user_id } } } });
        });
      }
      await checked(request, async tx => {
        await currentRun(tx, id, token, "retiring");
        await tx.salesDemoSetup.update({ where: { id }, data: { status: "retired", credentialsCipher: "", leaseToken: null, leaseUntil: null } });
      });
      return { id, status: "retired" };
    } catch (error) { if (error instanceof AccessError) throw error; throw new AccessError(503, "DEMO_BLOCK_RETRY", "Local demo access is disabled. Retry teardown to finish disabling its Auth0 logins."); }
    finally { await release(request, id, token); }
  }
  server.get("/api/platform/sales-demos/blueprint", auth, (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return checked(request, async () => demoBlueprintPlan(blueprint()));
  });
  server.get<{ Params: { demoId: string }; Querystring: { intent?: string } }>("/api/platform/sales-demos/:demoId/plan", auth, (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const intent = request.query.intent || "inspect";
    if (!["inspect", "retire", "rebuild"].includes(intent)) throw new AccessError(400, "INVALID_INPUT", "Choose a supported demo action.");
    return checked(request, tx => lifecyclePlan(tx, assignmentId(request.params.demoId), intent));
  });
  server.get("/api/platform/sales-demos", auth, request => checked(request, async tx => ({
    seedVersion: SALES_DEMO_SEED_VERSION,
    items: await tx.salesDemo.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { company: { select: { name: true, status: true } }, owner: { select: { email: true, name: true } }, setup: { select: { id: true, status: true, sourceDemoId: true } }, replacementSetups: { where: { status: { not: "retired" } }, select: { id: true, status: true }, take: 1 } } }),
    setups: (await tx.salesDemoSetup.findMany({ where: { salesDemoId: null, status: { not: "retired" } }, select: { id: true, status: true, accounts: true, createdAt: true, sourceDemoId: true }, orderBy: { createdAt: "desc" }, take: 50 })).map(s => ({ id: s.id, status: s.status, createdAt: s.createdAt, sourceDemoId: s.sourceDemoId, accountsPrepared: Object.keys(s.accounts as object).length })),
  })));
  server.post("/api/platform/sales-demos", auth, async (request, reply) => {
    mutation(request, origin); configured();
    const body = input(request, ["submissionKey", "planHash"]), key = submission(body.submissionKey, ["automatic-role-logins-v2"]);
    const setup = await checked(request, async tx => {
      const previous = await tx.salesDemoSetup.findUnique({ where: { createdById_submissionKey: { createdById: request.principal!.id, submissionKey: key.submissionKey } } });
      if (previous) { sameSubmission(previous.submissionHash, key.submissionHash); return previous; }
      const plan = blueprint(); assertDemoBuildPlan(plan, plan);
      if (body.planHash !== undefined && body.planHash !== demoPlanHash(plan)) throw new AccessError(409, "DEMO_PLAN_CHANGED", "Refresh the blueprint and review the current fixture before building.");
      if (await tx.salesDemo.findUnique({ where: { createdById_submissionKey: { createdById: request.principal!.id, submissionKey: key.submissionKey } } })) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission belongs to an older demo. Start a new setup.");
      const id = randomUUID(), credentialsCipher = sealDemoCredentials(id, newDemoCredentials(id), credentialSecret);
      const row = await tx.salesDemoSetup.create({ data: { id, createdById: request.principal!.id, ...key, credentialsCipher, blueprint: plan } });
      await tx.auditEvent.create({ data: { actorId: request.principal!.id, action: "sales_demo.setup.started", targetId: id, requestId: request.id } });
      return row;
    });
    reply.header("Cache-Control", "no-store");
    return build(request, setup.id);
  });
  server.post<{ Params: { demoId: string } }>("/api/platform/sales-demos/:demoId/resume", auth, async (request, reply) => {
    mutation(request, origin); input(request, []); reply.header("Cache-Control", "no-store");
    return build(request, assignmentId(request.params.demoId));
  });
  server.post<{ Params: { demoId: string } }>("/api/platform/sales-demos/:demoId/credentials", auth, (request, reply) => {
    mutation(request, origin); input(request, []); reply.header("Cache-Control", "no-store");
    return reveal(request, assignmentId(request.params.demoId));
  });
  server.post<{ Params: { demoId: string } }>("/api/platform/sales-demos/:demoId/rebuild", auth, async (request, reply) => {
    mutation(request, origin); configured(); reply.header("Cache-Control", "no-store");
    const id = assignmentId(request.params.demoId), body = input(request, ["submissionKey", "expectedVersion", "planHash", "confirmed"]), expectedVersion = version(body.expectedVersion);
    if (body.confirmed !== true || typeof body.planHash !== "string" || !/^[a-f0-9]{64}$/.test(body.planHash)) throw new AccessError(400, "INVALID_INPUT", "Review and confirm the rebuild plan before continuing.");
    const key = submission(body.submissionKey, ["sales-demo-rebuild-v1", id, expectedVersion, body.planHash]);
    const setup = await checked(request, async tx => {
      const previous = await tx.salesDemoSetup.findUnique({ where: { createdById_submissionKey: { createdById: request.principal!.id, submissionKey: key.submissionKey } } });
      if (previous) { sameSubmission(previous.submissionHash, key.submissionHash); return previous; }
      await tx.$queryRaw`SELECT id FROM "SalesDemo" WHERE id=${id} FOR UPDATE`;
      const plan = await lifecyclePlan(tx, id, "rebuild");
      if (!plan.company) throw new AccessError(409, "DEMO_NOT_READY", "Finish or retire this setup before rebuilding its portfolio.");
      if (plan.expectedVersion !== expectedVersion || plan.planHash !== body.planHash) throw new AccessError(409, "DEMO_PLAN_CHANGED", "This demo changed after your review. Refresh and confirm its current rebuild plan.");
      if (plan.blockers.length) throw new AccessError(409, "DEMO_OWNERSHIP_CHANGED", plan.blockers[0]);
      if (plan.replacement) throw new AccessError(409, "DEMO_REBUILD_EXISTS", "A replacement is already reserved. Refresh the demo list and resume that setup instead.");
      const current = blueprint(); assertDemoBuildPlan(current, current);
      const sourceSetup = await tx.salesDemoSetup.findUnique({ where: { id } });
      if (sourceSetup) cleanupContext(sourceSetup);
      const setupId = randomUUID(), credentialsCipher = sealDemoCredentials(setupId, newDemoCredentials(setupId), credentialSecret);
      const row = await tx.salesDemoSetup.create({ data: { id: setupId, createdById: request.principal!.id, ...key, credentialsCipher, blueprint: { ...current, sourceReview: { planHash: body.planHash as string, replacementSetupId: setupId } }, sourceDemoId: id, sourceVersion: expectedVersion } });
      await tx.auditEvent.create({ data: { actorId: request.principal!.id, companyId: plan.company.id, action: "sales_demo.rebuild.planned", targetId: setupId, requestId: request.id, detail: { sourceDemoId: id, sourceVersion: expectedVersion, seedVersion: current.seedVersion } } });
      return row;
    });
    return build(request, setup.id);
  });
  async function retireDemo(request: FastifyRequest, id: string, expectedVersion: number, review?: LifecycleReview) {
    const setup = await checked(request, tx => tx.salesDemoSetup.findUnique({ where: { id } }));
    if (setup) return teardownSetup(request, setup, expectedVersion, review);
    // Version-one presenters are pre-existing accounts, never block them.
    return checked(request, async tx => {
      const demo = await tx.salesDemo.findUnique({ where: { id } });
      if (!demo) throw new AccessError(404, "NOT_FOUND", "Sales demo not found.");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${demo.ownerId} FOR UPDATE`;
      if (demo.status === "retired") return demo;
      if (demo.version !== expectedVersion) throw new AccessError(409, "RECORD_CHANGED", "Reload the demo before tearing it down.");
      const plan = await lifecyclePlan(tx, id, review?.intent || "retire", review?.replacementSetupId);
      if (review && plan.planHash !== review.planHash) throw new AccessError(409, "DEMO_PLAN_CHANGED", "This demo changed after review. Refresh its action plan before continuing.");
      if (plan.blockers.length) throw new AccessError(409, "DEMO_OWNERSHIP_CHANGED", plan.blockers[0]);
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${demo.companyId} FOR UPDATE`;
      await tx.$queryRaw`SELECT set_config('app.company_id', ${demo.companyId}, true)`;
      const members = await tx.companyMembership.findMany({ where: { companyId: demo.companyId }, select: { userId: true } });
      await tx.session.deleteMany({ where: { userId: { in: members.map(m => m.userId) } } });
      await tx.company.update({ where: { id: demo.companyId }, data: { status: "suspended", version: { increment: 1 } } });
      await tx.companyMembership.updateMany({ where: { companyId: demo.companyId, userId: { not: demo.ownerId } }, data: { status: "disabled", version: { increment: 1 } } });
      await tx.residentPropertyAssignment.deleteMany({ where: { companyId: demo.companyId, userId: demo.ownerId } });
      await tx.staffPropertyAccess.deleteMany({ where: { companyId: demo.companyId, userId: demo.ownerId } });
      await tx.companyMembership.deleteMany({ where: { companyId: demo.companyId, userId: demo.ownerId } });
      const result = await tx.salesDemo.update({ where: { id }, data: { status: "retired", retiredAt: new Date(), version: { increment: 1 } } });
      await tx.auditEvent.create({ data: { actorId: request.principal!.id, companyId: demo.companyId, action: "sales_demo.retired", targetId: id, requestId: request.id } });
      return result;
    });
  }
  server.post<{ Params: { demoId: string } }>("/api/platform/sales-demos/:demoId/teardown", auth, async (request) => {
    mutation(request, origin);
    const id = assignmentId(request.params.demoId), body = input(request, ["expectedVersion", "planHash"]), expectedVersion = version(body.expectedVersion);
    if (body.planHash !== undefined && (typeof body.planHash !== "string" || !/^[a-f0-9]{64}$/.test(body.planHash))) throw new AccessError(400, "INVALID_INPUT", "Review the current teardown plan before confirming.");
    return retireDemo(request, id, expectedVersion, typeof body.planHash === "string" ? { intent: "retire", planHash: body.planHash } : undefined);
  });
}
