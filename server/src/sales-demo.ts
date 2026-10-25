import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { PrismaClient, SalesDemoSetup } from "@prisma/client";
import { AccessError, requirePermission } from "./access.js";
import { assignmentId, serializable } from "./application.js";
import { input, mutation, submission, sameSubmission, version, type Tx } from "./operational.js";
import type { IdentityProvider, ProviderUser } from "./identity-provider.js";
import { seedSalesDemo, SALES_DEMO_SEED_VERSION } from "./sales-demo-seed.js";
import { DEMO_PEOPLE, newDemoCredentials, openDemoCredentials, sealDemoCredentials } from "./sales-demo-credentials.js";
type PreparedAccount = ProviderUser & { issuer?: string };

const busy = () => new AccessError(409, "DEMO_SETUP_BUSY", "This demo operation is running. Wait briefly, then refresh or retry the same setup.");
const retired = () => new AccessError(409, "DEMO_RETIRED", "This demo was torn down. Build a new demo for fresh accounts and data.");
const leaseUntil = () => new Date(Date.now() + 5 * 60000);
const secretFailure = () => new AccessError(503, "DEMO_PROVIDER_RETRY", "Demo identity setup was interrupted. Retry this setup to continue safely.");

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
  async function currentRun(tx: Tx, id: string, token: string, status: string) {
    const row = await tx.salesDemoSetup.findUnique({ where: { id } });
    if (!row || row.status !== status || row.leaseToken !== token || !row.leaseUntil || row.leaseUntil <= new Date()) throw busy();
    return row;
  }
  async function reveal(request: FastifyRequest, id: string) {
    return checked(request, async tx => {
      const setup = await tx.salesDemoSetup.findUnique({ where: { id }, include: { demo: { include: { company: true } } } });
      if (!setup || setup.status !== "ready" || setup.demo?.status !== "ready" || setup.demo.company.status !== "active") throw retired();
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
      if (row.leaseUntil && row.leaseUntil > new Date()) throw busy();
      return tx.salesDemoSetup.update({ where: { id }, data: { leaseToken: token, leaseUntil: leaseUntil() } });
    });
    if (setup.status === "ready") return reveal(request, id);
    try {
      // Leave room for the bounded source transaction and response within the
      // browser's three-minute budget, including any provider backoff.
      const deadline = Date.now() + 110000;
      if (Object.values(setup.accounts as Record<string, PreparedAccount>).some(a => a.issuer && a.issuer !== provider!.issuer))
        throw new AccessError(409, "DEMO_PROVIDER_CHANGED", "The demo identity connection changed. Restore its original Auth0 connection before resuming this setup.");
      const credentials = openDemoCredentials(id, setup.credentialsCipher, credentialSecret);
      for (const account of credentials) {
        const prepared = await checked(request, async tx => {
          const current = await currentRun(tx, id, token, "pending");
          await tx.salesDemoSetup.update({ where: { id }, data: { leaseUntil: leaseUntil() } });
          return (current.accounts as Record<string, PreparedAccount>)[account.accountKey];
        });
        // Exact, provider-confirmed subjects were durably recorded after each
        // success. Replaying those lookups can exhaust quota before reaching
        // the missing account. Local assignment checks still run atomically.
        if (prepared?.issuer === provider!.issuer) {
          if (!prepared.user_id?.startsWith("auth0|") || prepared.email !== account.email || !prepared.email_verified || prepared.blocked) throw secretFailure();
          continue;
        }
        // Provider calls stay outside DB locks. Exact generation metadata recovers
        // ambiguous creates without adopting unrelated accounts by email.
        const remote = await identities.ensure(account, { deadline });
        if (remote.email !== account.email || !remote.email_verified || remote.blocked) throw secretFailure();
        await checked(request, async tx => {
          const current = await currentRun(tx, id, token, "pending");
          const accounts = current.accounts as Record<string, ProviderUser>;
          if (accounts[account.accountKey] && accounts[account.accountKey].user_id !== remote.user_id) throw new AccessError(409, "DEMO_IDENTITY_CONFLICT", "The generated demo identity changed. Tear down this setup before creating another.");
          await tx.salesDemoSetup.update({ where: { id }, data: { accounts: { ...accounts, [account.accountKey]: { user_id: remote.user_id, email: remote.email, name: account.name, email_verified: true, issuer: provider!.issuer } } } });
        });
      }
      await checked(request, async tx => {
        const current = await currentRun(tx, id, token, "pending"), users = current.accounts as Record<string, ProviderUser>;
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
        const manifest = await seedSalesDemo(tx, company.id, { issuer: provider!.issuer, databaseConnection: provider!.databaseConnection, users });
        await tx.salesDemo.create({ data: { id, ownerId, companyId: company.id, createdById: current.createdById, submissionKey: current.submissionKey, submissionHash: current.submissionHash, seedVersion: SALES_DEMO_SEED_VERSION, manifest } });
        await tx.salesDemoSetup.update({ where: { id }, data: { status: "ready", salesDemoId: id, leaseToken: null, leaseUntil: null } });
        await tx.auditEvent.create({ data: { actorId: request.principal!.id, companyId: company.id, action: "sales_demo.created", targetId: id, requestId: request.id, detail: { seedVersion: SALES_DEMO_SEED_VERSION } } });
      });
      return reveal(request, id);
    } catch (error) { if (error instanceof AccessError || (error as { code?: string }).code?.startsWith("P")) throw error; throw secretFailure(); }
    finally { await release(request, id, token); }
  }
  async function teardownSetup(request: FastifyRequest, setup: SalesDemoSetup, expectedVersion: number) {
    const identities = configured(), token = randomUUID(), id = setup.id;
    const claimed = await checked(request, async tx => {
      const row = await tx.salesDemoSetup.findUniqueOrThrow({ where: { id } });
      if (row.status === "retired") return row;
      if (row.leaseUntil && row.leaseUntil > new Date()) throw busy();
      const demo = row.salesDemoId ? await tx.salesDemo.findUniqueOrThrow({ where: { id: row.salesDemoId } }) : null;
      if (demo && demo.status !== "retired" && demo.version !== expectedVersion) throw new AccessError(409, "RECORD_CHANGED", "Reload the demo before tearing it down.");
      const ids = Object.values(row.accounts as Record<string, ProviderUser>).map(a => a.user_id).sort();
      for (const userId of ids) await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
      const users = await tx.user.findMany({ where: { id: { in: ids } }, include: { membership: true } });
      if (users.some(u => u.platformRole || u.companyId || u.membership && u.membership.companyId !== demo?.companyId)) throw new AccessError(409, "DEMO_ACCOUNT_ASSIGNED", "A generated account has access outside this demo. Review that assignment before teardown; no account was disabled.");
      const sessionIds = [...ids];
      if (demo) {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${demo.companyId} FOR UPDATE`;
        await tx.$queryRaw`SELECT set_config('app.company_id', ${demo.companyId}, true)`;
        sessionIds.push(...(await tx.companyMembership.findMany({ where: { companyId: demo.companyId }, select: { userId: true } })).map(m => m.userId));
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
      const deadline = Date.now() + 110000;
      const accounts = claimed.accounts as Record<string, ProviderUser>;
      for (const [accountKey] of DEMO_PEOPLE) {
        await checked(request, async tx => { await currentRun(tx, id, token, "retiring"); await tx.salesDemoSetup.update({ where: { id }, data: { leaseUntil: leaseUntil() } }); });
        await identities.block({ demoId: id, accountKey, email: `${accountKey}.${id}@sales-demo.invalid` }, accounts[accountKey]?.user_id, async remote => {
          await checked(request, async tx => {
            const current = await currentRun(tx, id, token, "retiring");
            const demo = current.salesDemoId ? await tx.salesDemo.findUniqueOrThrow({ where: { id: current.salesDemoId } }) : null;
            await tx.$queryRaw`SELECT id FROM "User" WHERE id=${remote.user_id} FOR UPDATE`;
            const user = await tx.user.findUnique({ where: { id: remote.user_id }, include: { membership: true } });
            if (user && (user.platformRole || user.companyId || user.membership && user.membership.companyId !== demo?.companyId)) throw new AccessError(409, "DEMO_ACCOUNT_ASSIGNED", "A generated account was assigned elsewhere. Review that assignment before finishing teardown; its Auth0 login was not disabled.");
            if (user) await tx.user.update({ where: { id: user.id }, data: { status: "disabled" } });
            await tx.session.deleteMany({ where: { OR: [{ userId: remote.user_id }, { impersonatedUserId: remote.user_id }] } });
            await tx.salesDemoSetup.update({ where: { id }, data: { accounts: { ...(current.accounts as Record<string, ProviderUser>), [accountKey]: { user_id: remote.user_id, email: remote.email, email_verified: remote.email_verified } } } });
          });
        }, { deadline });
      }
      await checked(request, async tx => {
        await currentRun(tx, id, token, "retiring");
        await tx.salesDemoSetup.update({ where: { id }, data: { status: "retired", credentialsCipher: "", leaseToken: null, leaseUntil: null } });
      });
      return { id, status: "retired" };
    } catch (error) { if (error instanceof AccessError) throw error; throw new AccessError(503, "DEMO_BLOCK_RETRY", "Local demo access is disabled. Retry teardown to finish disabling its Auth0 logins."); }
    finally { await release(request, id, token); }
  }
  server.get("/api/platform/sales-demos", auth, request => checked(request, async tx => ({
    seedVersion: SALES_DEMO_SEED_VERSION,
    items: await tx.salesDemo.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { company: { select: { name: true, status: true } }, owner: { select: { email: true, name: true } }, setup: { select: { id: true, status: true } } } }),
    setups: (await tx.salesDemoSetup.findMany({ where: { salesDemoId: null, status: { not: "retired" } }, select: { id: true, status: true, accounts: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 })).map(s => ({ id: s.id, status: s.status, createdAt: s.createdAt, accountsPrepared: Object.keys(s.accounts as object).length })),
  })));
  server.post("/api/platform/sales-demos", auth, async (request, reply) => {
    mutation(request, origin); configured();
    const body = input(request, ["submissionKey"]), key = submission(body.submissionKey, ["automatic-role-logins-v2"]);
    const setup = await checked(request, async tx => {
      const previous = await tx.salesDemoSetup.findUnique({ where: { createdById_submissionKey: { createdById: request.principal!.id, submissionKey: key.submissionKey } } });
      if (previous) { sameSubmission(previous.submissionHash, key.submissionHash); return previous; }
      if (await tx.salesDemo.findUnique({ where: { createdById_submissionKey: { createdById: request.principal!.id, submissionKey: key.submissionKey } } })) throw new AccessError(409, "SUBMISSION_MISMATCH", "This submission belongs to an older demo. Start a new setup.");
      const id = randomUUID(), credentialsCipher = sealDemoCredentials(id, newDemoCredentials(id), credentialSecret);
      const row = await tx.salesDemoSetup.create({ data: { id, createdById: request.principal!.id, ...key, credentialsCipher } });
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
  server.post<{ Params: { demoId: string } }>("/api/platform/sales-demos/:demoId/teardown", auth, async (request) => {
    mutation(request, origin);
    const id = assignmentId(request.params.demoId), body = input(request, ["expectedVersion"]), expectedVersion = version(body.expectedVersion);
    const setup = await checked(request, tx => tx.salesDemoSetup.findUnique({ where: { id } }));
    if (setup) return teardownSetup(request, setup, expectedVersion);
    // Version-one presenters are pre-existing accounts, never block them.
    return checked(request, async tx => {
      const demo = await tx.salesDemo.findUnique({ where: { id } });
      if (!demo) throw new AccessError(404, "NOT_FOUND", "Sales demo not found.");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${demo.ownerId} FOR UPDATE`;
      if (demo.status === "retired") return demo;
      if (demo.version !== expectedVersion) throw new AccessError(409, "RECORD_CHANGED", "Reload the demo before tearing it down.");
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
  });
}
