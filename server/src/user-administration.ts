import type {
  FastifyInstance,
  FastifyRequest,
  preValidationHookHandler,
} from "fastify";
import type { PrismaClient } from "@prisma/client";
import { AccessError, requirePermission } from "./access.js";
import { opaqueUserId, serializable } from "./application.js";
import {
  boundedText,
  input,
  mutation,
  submission,
  sameSubmission,
  type Tx,
} from "./operational.js";
import type { IdentityProvider, ProviderUser } from "./identity-provider.js";
const userSelect = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  status: true,
  platformRole: true,
} as const;
export function registerUserAdministration(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
  provider?: IdentityProvider,
) {
  const auth = { preValidation: authenticate };
  const configured = () => {
    if (!provider)
      throw new AccessError(
        503,
        "IDENTITY_NOT_CONFIGURED",
        "User setup requires the Auth0 Management API connection. Existing accounts remain available.",
      );
    return provider;
  };
  const platform = (request: FastifyRequest) =>
    requirePermission(request.principal!, "platform.manage");
  async function checked<T>(
    request: FastifyRequest,
    run: (tx: Tx) => Promise<T>,
    admin = true,
  ) {
    return serializable(db, async (tx) => {
      await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${request.principal!.id} RETURNING id`;
      const actor = await tx.user.findUnique({
        where: { id: request.principal!.id },
        include: { membership: { include: { company: true } } },
      });
      if (!actor || actor.status !== "active")
        throw new AccessError(403, "ACCESS_DENIED", "Access is unavailable.");
      if (admin) {
        requirePermission(actor, "platform.manage");
        if (actor.emailVerified === false)
          throw new AccessError(
            403,
            "EMAIL_VERIFICATION_REQUIRED",
            "Verify your email first.",
          );
      }
      return run(tx);
    });
  }
  async function record(
    tx: Tx,
    request: FastifyRequest,
    action: string,
    targetId: string,
  ) {
    await tx.auditEvent.create({
      data: {
        actorId: request.principal!.id,
        action,
        targetId,
        requestId: request.id,
      },
    });
  }
  async function add(tx: Tx, request: FastifyRequest, p: ProviderUser) {
    const id = opaqueUserId(p.user_id),
      issuer = configured().issuer;
    const identity = await tx.identity.findUnique({
      where: { issuer_subject: { issuer, subject: id } },
    });
    const existing = await tx.user.findUnique({
      where: { id: identity?.userId ?? id },
      include: { identities: true },
    });
    if (existing && !identity && existing.identities.length)
      throw new AccessError(
        409,
        "IDENTITY_CONFLICT",
        "This sign-in identity requires administrative review.",
      );
    const emailOwner = await tx.user.findUnique({
      where: { email: p.email },
      select: { id: true },
    });
    if (emailOwner && emailOwner.id !== existing?.id)
      throw new AccessError(
        409,
        "IDENTITY_EMAIL_CONFLICT",
        "This email is linked to another sign-in identity. Review the existing account; identities are never merged by email.",
      );
    // Never bind by email: provider issuer + subject are the only identity key.
    if (existing) {
      await tx.identity.upsert({
        where: { issuer_subject: { issuer, subject: id } },
        update: {},
        create: { issuer, subject: id, userId: existing.id },
      });
      await tx.user.update({
        where: { id: existing.id },
        data: { email: p.email, emailVerified: p.email_verified },
      });
      return tx.user.findUniqueOrThrow({
        where: { id: existing.id },
        select: userSelect,
      });
    }
    const row = await tx.user.create({
      data: {
        id,
        email: p.email,
        name: p.name?.slice(0, 200) || null,
        emailVerified: p.email_verified,
        status: p.blocked ? "disabled" : "active",
        role: "unassigned",
        accessInitializedAt: new Date(),
        identities: { create: { issuer, subject: id } },
      },
      select: userSelect,
    });
    await record(tx, request, "user.preprovisioned", row.id);
    return row;
  }
  server.get<{ Querystring: { page?: string; email?: string } }>(
    "/api/platform/identity-users",
    auth,
    async (request) => {
      platform(request);
      if (
        Object.keys(request.query).some((k) => !["page", "email"].includes(k))
      )
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Unknown directory filter.",
        );
      const page = Number(request.query.page ?? 0);
      if (!Number.isInteger(page) || page < 0 || page > 19)
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Choose a valid directory page.",
        );
      const email =
        request.query.email === undefined
          ? undefined
          : boundedText(request.query.email, 254, "Email");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Enter a complete exact email.",
        );
      const result = await configured().list(page, email);
      await checked(request, async () => {});
      return result;
    },
  );
  server.post("/api/platform/identity-users/import", auth, async (request) => {
    platform(request);
    mutation(request, origin);
    const b = input(request, ["userIds"]);
    if (
      !Array.isArray(b.userIds) ||
      b.userIds.length < 1 ||
      b.userIds.length > 50
    )
      throw new AccessError(
        400,
        "INVALID_INPUT",
        "Choose between 1 and 50 identities.",
      );
    const ids = [...new Set(b.userIds.map(opaqueUserId))],
      remote: ProviderUser[] = [];
    for (const id of ids) remote.push(await configured().get(id));
    return checked(request, async (tx) => {
      const items = [];
      for (const p of remote) items.push(await add(tx, request, p));
      return { items };
    });
  });
  server.post("/api/platform/users/provision", auth, async (request) => {
    platform(request);
    mutation(request, origin);
    const b = input(request, ["email", "name", "submissionKey"]),
      email = boundedText(b.email, 254, "Email").toLowerCase(),
      name = boundedText(b.name, 200, "Name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AccessError(400, "INVALID_INPUT", "Enter a valid email.");
    const key = submission(b.submissionKey, [email, name]);
    configured();
    const previous = await checked(request, async (tx) => {
      const previous = await tx.userProvision.findUnique({
        where: {
          actorId_submissionKey: {
            actorId: request.principal!.id,
            submissionKey: key.submissionKey,
          },
        },
      });
      if (previous) sameSubmission(previous.submissionHash, key.submissionHash);
      else
        await tx.userProvision.create({
          data: { actorId: request.principal!.id, ...key },
        });
      return previous?.targetId
        ? tx.user.findUniqueOrThrow({
            where: { id: previous.targetId },
            select: userSelect,
          })
        : null;
    });
    if (previous) return previous;
    const remote = await configured().create(email, name);
    return checked(request, async (tx) => {
      const row = await add(tx, request, remote);
      await tx.userProvision.update({
        where: {
          actorId_submissionKey: {
            actorId: request.principal!.id,
            submissionKey: key.submissionKey,
          },
        },
        data: { targetId: row.id },
      });
      return row;
    });
  });
  async function identity(request: FastifyRequest, id: string, admin: boolean) {
    return checked(
      request,
      async (tx) => {
        const row = await tx.user.findUnique({
            where: { id },
            include: { identities: true },
          }),
          link = row?.identities.find((i) => i.issuer === configured().issuer);
        if (!row || !link)
          throw new AccessError(
            404,
            "NOT_FOUND",
            "Sign-in identity not found.",
          );
        return { row, link };
      },
      admin,
    );
  }
  function routes(path: string, admin: boolean) {
    server.post<{ Params: { userId?: string } }>(
      path + "/verification",
      auth,
      async (request) => {
        if (admin) platform(request);
        mutation(request, origin);
        input(request, []);
        const id = admin
          ? opaqueUserId(request.params.userId)
          : request.principal!.id;
        const { link } = await identity(request, id, admin);
        const remote = await configured().get(link.subject);
        if (!remote.email_verified) {
          // Persist cooldown before sending: ambiguous provider responses cannot be spammed by retry.
          await checked(
            request,
            async (tx) => {
              await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${id} RETURNING id`;
              const row = await tx.user.findUniqueOrThrow({ where: { id } });
              if (
                row.verificationSentAt &&
                Date.now() - row.verificationSentAt.getTime() < 60000
              )
                throw new AccessError(
                  429,
                  "VERIFICATION_COOLDOWN",
                  "Wait a minute before requesting another verification email.",
                );
              await tx.user.update({
                where: { id },
                data: { verificationSentAt: new Date() },
              });
            },
            admin,
          );
          await configured().verify(link.subject);
          await checked(
            request,
            (tx) => record(tx, request, "user.verification.requested", id),
            admin,
          );
        }
        return {
          verified: remote.email_verified,
          message: remote.email_verified
            ? "Email is already verified."
            : "Verification email requested. Check your inbox and spam folder.",
        };
      },
    );
    server.post<{ Params: { userId?: string } }>(
      path + "/verification-status",
      auth,
      async (request) => {
        if (admin) platform(request);
        mutation(request, origin);
        input(request, []);
        const id = admin
          ? opaqueUserId(request.params.userId)
          : request.principal!.id;
        const { link } = await identity(request, id, admin),
          remote = await configured().get(link.subject);
        return checked(
          request,
          async (tx) => {
            await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${id} RETURNING id`;
            const before = await tx.user.findUniqueOrThrow({ where: { id } });
            if (before.email !== remote.email)
              throw new AccessError(
                409,
                "EMAIL_CHANGED",
                "Your sign-in email changed. Sign out and sign in again.",
              );
            await tx.user.update({
              where: { id },
              data: { emailVerified: remote.email_verified },
            });
            if (before.emailVerified !== remote.email_verified)
              await record(tx, request, "user.verification.refreshed", id);
            return { emailVerified: remote.email_verified };
          },
          admin,
        );
      },
    );
  }
  routes("/api/account", false);
  routes("/api/platform/users/:userId", true);
  server.post<{ Params: { userId: string } }>(
    "/api/platform/users/:userId/password-setup",
    auth,
    async (request) => {
      platform(request);
      mutation(request, origin);
      input(request, []);
      const id = opaqueUserId(request.params.userId),
        { row, link } = await identity(request, id, true),
        remote = await configured().get(link.subject);
      if (
        !link.subject.startsWith("auth0|") ||
        remote.email !== row.email ||
        !remote.identities?.some(
          (identity) =>
            identity.provider === "auth0" &&
            identity.connection === configured().databaseConnection,
        )
      )
        throw new AccessError(
          409,
          "IDENTITY_CONFLICT",
          "Password setup requires the matching email/password identity.",
        );
      await checked(request, async (tx) => {
        await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${id} RETURNING id`;
        const current = await tx.user.findUniqueOrThrow({ where: { id } });
        if (
          current.passwordSetupSentAt &&
          Date.now() - current.passwordSetupSentAt.getTime() < 60000
        )
          throw new AccessError(
            429,
            "SETUP_COOLDOWN",
            "Wait a minute before requesting another setup email.",
          );
        await tx.user.update({
          where: { id },
          data: { passwordSetupSentAt: new Date() },
        });
      });
      await configured().setup(row.email);
      await checked(request, (tx) =>
        record(tx, request, "user.password_setup.requested", id),
      );
      return {
        message:
          "Password setup email requested. The user chooses their own password.",
      };
    },
  );
}
