import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import * as oidc from "openid-client";
import { AccessError, safeReturnTo } from "./access.js";

export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const random = () => randomBytes(32).toString("base64url");
export const SESSION_MS = 12 * 60 * 60 * 1000;
export const IDLE_MS = 2 * 60 * 60 * 1000;
export function sameSecret(a: unknown, b: string): boolean {
  return (
    typeof a === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function validSession(
  session: { expiresAt: Date; idleExpiresAt: Date },
  now = Date.now(),
) {
  return (
    session.expiresAt.getTime() > now && session.idleExpiresAt.getTime() > now
  );
}
export type AuthConfig = {
  origin: string;
  domain: string;
  clientId: string;
  clientSecret: string;
  secure: boolean;
};
export function readAuthConfig(env = process.env): AuthConfig {
  const origin = new URL(env.APP_ORIGIN || "http://localhost:5010");
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error("APP_ORIGIN must be an origin");
  if (
    env.NODE_ENV === "production" &&
    (!env.APP_ORIGIN || origin.protocol !== "https:")
  )
    throw new Error("HTTPS APP_ORIGIN is required");
  const domain = env.AUTH0_DOMAIN || "";
  if (!/^[a-z0-9.-]+$/i.test(domain))
    throw new Error("AUTH0_DOMAIN is required");
  if (!env.AUTH0_WEB_CLIENT_ID || !env.AUTH0_WEB_CLIENT_SECRET)
    throw new Error("Auth0 web application credentials are required");
  return {
    origin: origin.origin,
    domain,
    clientId: env.AUTH0_WEB_CLIENT_ID,
    clientSecret: env.AUTH0_WEB_CLIENT_SECRET,
    secure: origin.protocol === "https:",
  };
}

export async function registerSessions(
  server: FastifyInstance,
  db: PrismaClient,
  config: AuthConfig,
) {
  await server.register(cookie);
  await server.register(rateLimit, {
    global: false,
    max: 30,
    timeWindow: "1 minute",
  });
  const sessionName = config.secure ? "__Host-pf-session" : "pf-session";
  const transactionName = config.secure ? "__Host-pf-login" : "pf-login";
  const options = {
    path: "/",
    secure: config.secure,
    httpOnly: true,
    sameSite: "strict" as const,
  };
  const callback = `${config.origin}/api/auth/callback`;
  let discovery: Promise<oidc.Configuration> | undefined;
  const getProvider = () =>
    (discovery ??= oidc
      .discovery(
        new URL(`https://${config.domain}/`),
        config.clientId,
        config.clientSecret,
        undefined,
        { timeout: 8 },
      )
      .catch((error) => {
        discovery = undefined;
        throw error;
      }));

  server.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/"))
      reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
    reply
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff");
  });

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies[sessionName];
    const session = token
      ? await db.session.findUnique({
          where: { tokenHash: digest(token) },
          include: {
            user: { include: { membership: { include: { company: true } } } },
          },
        })
      : null;
    if (!session || !validSession(session)) {
      reply.clearCookie(sessionName, options);
      throw new AccessError(401, "SIGN_IN_REQUIRED", "Sign in to continue.");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (
        request.headers.origin !== config.origin ||
        !sameSecret(request.headers["x-csrf-token"], session.csrfToken)
      ) {
        throw new AccessError(
          403,
          "CSRF_REJECTED",
          "Refresh the page before trying this action again.",
        );
      }
    }
    // Current membership/status is read every time. Session grants never cache roles.
    request.principal = session.user;
    request.appSession = session;
    if (session.idleExpiresAt.getTime() - Date.now() < IDLE_MS - 60000) {
      await db.session.updateMany({
        where: { tokenHash: session.tokenHash },
        data: { idleExpiresAt: new Date(Date.now() + IDLE_MS) },
      });
    }
  };

  server.get(
    "/api/auth/login",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const provider = await getProvider();
      const state = random(),
        binding = random(),
        nonce = random(),
        verifier = oidc.randomPKCECodeVerifier();
      await db.$transaction([
        db.loginTransaction.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        }),
        db.session.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: new Date() } },
              { idleExpiresAt: { lt: new Date() } },
            ],
          },
        }),
        db.loginTransaction.create({
          data: {
            stateHash: digest(state),
            bindingHash: digest(binding),
            verifier,
            nonce,
            returnTo: safeReturnTo((request.query as any).returnTo),
            expiresAt: new Date(Date.now() + 600000),
          },
        }),
      ]);
      reply.setCookie(transactionName, binding, {
        ...options,
        sameSite: "lax",
        maxAge: 600,
      });
      const url = oidc.buildAuthorizationUrl(provider, {
        redirect_uri: callback,
        response_type: "code",
        scope: "openid profile email",
        state,
        nonce,
        code_challenge_method: "S256",
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      });
      return reply.redirect(url.href);
    },
  );

  server.get("/api/auth/callback", async (request, reply) => {
    reply.clearCookie(transactionName, { ...options, sameSite: "lax" });
    const query = request.query as { state?: string };
    const binding = request.cookies[transactionName];
    const transaction =
      typeof query.state === "string"
        ? await db.loginTransaction.findUnique({
            where: { stateHash: digest(query.state) },
          })
        : null;
    if (
      !transaction ||
      !binding ||
      !sameSecret(digest(binding), transaction.bindingHash) ||
      transaction.expiresAt.getTime() <= Date.now()
    ) {
      return reply.redirect("/?authError=expired");
    }
    // Atomic consumption prevents replay even across ECS tasks.
    const used = await db.loginTransaction.deleteMany({
      where: { stateHash: transaction.stateHash },
    });
    if (used.count !== 1) return reply.redirect("/?authError=expired");
    try {
      const provider = await getProvider();
      const tokens = await oidc.authorizationCodeGrant(
        provider,
        new URL(request.url, config.origin),
        {
          pkceCodeVerifier: transaction.verifier,
          expectedState: query.state!,
          expectedNonce: transaction.nonce,
        },
      );
      const claims = tokens.claims();
      if (
        !claims?.sub ||
        typeof claims.email !== "string" ||
        !claims.email.trim()
      )
        throw new Error("Profile unavailable");
      const issuer = `https://${config.domain}/`;
      const token = random(),
        csrfToken = random();
      const previous = request.cookies[sessionName];
      await db.$transaction(async (tx) => {
        const identity = await tx.identity.findUnique({
          where: { issuer_subject: { issuer, subject: claims.sub } },
        });
        let user = await tx.user.findUnique({
          where: { id: identity?.userId ?? claims.sub },
        });
        if (
          !identity &&
          user &&
          (await tx.identity.count({ where: { userId: user.id } }))
        )
          throw new Error("Identity issuer mismatch");
        if (!user)
          user = await tx.user.create({
            data: {
              id: claims.sub,
              email: claims.email as string,
              name: typeof claims.name === "string" ? claims.name : null,
              role: "unassigned",
            },
          });
        // One-time upgrade needs both the old explicit admin assignment AND a
        // freshly verified identity-provider admin claim; the default tenant
        // field is never converted into membership or permissions.
        const roles = claims["https://propertyflow.com/roles"];
        const upgradeOwner =
          !user.accessInitializedAt &&
          user.role === "admin" &&
          Array.isArray(roles) &&
          roles.includes("admin");
        if (
          !user.accessInitializedAt &&
          user.role === "admin" &&
          !upgradeOwner
        ) {
          throw new Error("OWNER_UPGRADE_CLAIM_REQUIRED");
        }
        user = await tx.user.update({
          where: { id: user.id },
          data: {
            email: claims.email as string,
            emailVerified: claims.email_verified === true,
            ...(upgradeOwner ? { platformRole: "owner" } : {}),
            accessInitializedAt: user.accessInitializedAt ?? new Date(),
          },
        });
        await tx.identity.upsert({
          where: { issuer_subject: { issuer, subject: claims.sub } },
          update: {},
          create: { issuer, subject: claims.sub, userId: user.id },
        });
        if (previous)
          await tx.session.deleteMany({
            where: { tokenHash: digest(previous) },
          });
        await tx.session.create({
          data: {
            tokenHash: digest(token),
            csrfToken,
            userId: user.id,
            expiresAt: new Date(Date.now() + SESSION_MS),
            idleExpiresAt: new Date(Date.now() + IDLE_MS),
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId: user.id,
            action: upgradeOwner
              ? "platform.owner.upgraded"
              : "session.created",
            requestId: request.id,
          },
        });
      });
      // Tokens are needed only during this exchange; none are persisted or sent to the browser.
      reply.setCookie(sessionName, token, {
        ...options,
        maxAge: SESSION_MS / 1000,
      });
      // SameSite Strict cookies are sent on the subsequent same-origin bootstrap.
      return reply.redirect(transaction.returnTo);
    } catch {
      request.log.warn({ code: "SIGN_IN_FAILED" }, "Identity exchange failed");
      return reply.redirect("/?authError=failed");
    }
  });

  server.post(
    "/api/auth/logout",
    { preValidation: authenticate },
    async (request, reply) => {
      await db.$transaction([
        db.session.deleteMany({
          where: { tokenHash: request.appSession!.tokenHash },
        }),
        db.auditEvent.create({
          data: {
            actorId: request.principal!.id,
            action: "session.revoked",
            requestId: request.id,
          },
        }),
      ]);
      reply.clearCookie(sessionName, options);
      const url = new URL(`https://${config.domain}/v2/logout`);
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("returnTo", config.origin);
      return { logoutUrl: url.href };
    },
  );
  return authenticate;
}
