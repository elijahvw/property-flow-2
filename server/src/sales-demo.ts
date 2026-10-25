import type { FastifyInstance, FastifyRequest, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError, requirePermission } from "./access.js";
import { opaqueUserId, assignmentId, serializable } from "./application.js";
import { input, mutation, submission, sameSubmission, version, type Tx } from "./operational.js";
import { seedSalesDemo, SALES_DEMO_SEED_VERSION } from "./sales-demo-seed.js";

export function registerSalesDemo(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string, identityIssuer?: string) {
  const auth = { preValidation: authenticate };
  async function checked<T>(request: FastifyRequest, run: (tx: Tx) => Promise<T>) {
    requirePermission(request.principal!, "platform.manage");
    // A seed is one atomic transaction, including every source and audit event.
    // The existing serialization retry re-reads authority after each conflict.
    return serializable(db, async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${request.principal!.id} FOR UPDATE`;
      const actor = await tx.user.findUnique({ where: { id: request.principal!.id }, include: { membership: { include: { company: true } } } });
      if (!actor) throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      requirePermission(actor, "platform.manage");
      return run(tx);
    }, { timeout: 60000, maxWait: 5000 });
  }
  server.get("/api/platform/sales-demos", auth, request => checked(request, async tx => ({
    seedVersion: SALES_DEMO_SEED_VERSION,
    items: await tx.salesDemo.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { company: { select: { name: true, status: true } }, owner: { select: { email: true, name: true } } } }),
  })));
  server.post("/api/platform/sales-demos", auth, async request => {
    mutation(request, origin);
    const body = input(request, ["ownerId", "submissionKey"]), ownerId = opaqueUserId(body.ownerId), key = submission(body.submissionKey, [ownerId]);
    return checked(request, async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ownerId} FOR UPDATE`;
      const previous = await tx.salesDemo.findUnique({ where: { createdById_submissionKey: { createdById: request.principal!.id, submissionKey: key.submissionKey } } });
      if (previous) {
        sameSubmission(previous.submissionHash, key.submissionHash);
        if (previous.status !== "ready") throw new AccessError(409, "DEMO_RETIRED", "This demo was torn down. Start a new setup to create fresh demo data.");
        return previous;
      }
      const owner = await tx.user.findUnique({ where: { id: ownerId }, include: { membership: true, identities: true } });
      if (!identityIssuer) throw new AccessError(503, "IDENTITY_NOT_CONFIGURED", "Configure the Auth0 Management API and import a dedicated sales account first.");
      if (!owner || owner.status !== "active" || !owner.emailVerified || owner.platformRole || !owner.identities.some(i => i.issuer === identityIssuer))
        throw new AccessError(409, "DEMO_OWNER_REQUIRED", "Choose an active, verified Auth0 account without platform authority.");
      if (owner.membership || owner.companyId || await tx.salesDemo.findFirst({ where: { ownerId, status: "ready" } }))
        throw new AccessError(409, "DEMO_ACCOUNT_ASSIGNED", "Use a dedicated account without an existing company assignment. Tear down its current demo before rebuilding.");
      const company = await tx.company.create({ data: { name: "Oak & Elm · SALES DEMO", timezone: "America/New_York", adminNotes: "Fictional sales demo. Retire only through Sales demo controls; source and audit history is retained." } });
      await tx.companyMembership.create({ data: { userId: ownerId, companyId: company.id, role: "owner" } });
      const manifest = await seedSalesDemo(tx, company.id, ownerId);
      const result = await tx.salesDemo.create({ data: { ownerId, companyId: company.id, createdById: request.principal!.id, ...key, seedVersion: SALES_DEMO_SEED_VERSION, manifest } });
      await tx.auditEvent.create({ data: { actorId: request.principal!.id, companyId: company.id, action: "sales_demo.created", targetId: result.id, requestId: request.id, detail: { seedVersion: SALES_DEMO_SEED_VERSION } } });
      return result;
    });
  });
  server.post<{ Params: { demoId: string } }>("/api/platform/sales-demos/:demoId/teardown", auth, async request => {
    mutation(request, origin);
    const id = assignmentId(request.params.demoId), body = input(request, ["expectedVersion"]), expectedVersion = version(body.expectedVersion);
    return checked(request, async tx => {
      const demo = await tx.salesDemo.findUnique({ where: { id } });
      if (!demo) throw new AccessError(404, "NOT_FOUND", "Sales demo not found.");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${demo.ownerId} FOR UPDATE`;
      // A lost successful response can be retried; an old generation can never
      // suspend a newly rebuilt company or remove the owner's new membership.
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
