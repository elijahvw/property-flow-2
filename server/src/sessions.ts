import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { isIP } from "node:net";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import * as oidc from "openid-client";
import { canViewTarget, sameImpersonationMembership } from "./impersonation-access.js";
import { synchronizeIdentity } from "./identity-sync.js";
import { AccessError, permissions, safeReturnTo } from "./access.js";
import { companyFeatures, memberRouteFeatures, requireFeatures } from "./company-features.js";

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
  originSecret?: string;
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
  if (env.NODE_ENV === "production" && !env.CLOUDFRONT_ORIGIN_SECRET)
    throw new Error("CloudFront origin validation is required");
  return {
    origin: origin.origin,
    originSecret: env.CLOUDFRONT_ORIGIN_SECRET,
    domain,
    clientId: env.AUTH0_WEB_CLIENT_ID,
    clientSecret: env.AUTH0_WEB_CLIENT_SECRET,
    secure: origin.protocol === "https:",
  };
}

export function requireCloudFront(
  headers: Record<string, unknown>,
  secret: string,
) {
  if (!sameSecret(headers["x-propertyflow-origin"], secret))
    throw new AccessError(
      403,
      "ORIGIN_REJECTED",
      "Use the public Property Flow address.",
    );
}
export function loginRateKey(
  headers: Record<string, unknown>,
  secret: string | undefined,
  fallback: string,
): string {
  if (!secret) return fallback;
  requireCloudFront(headers, secret);
  const viewer = headers["cloudfront-viewer-address"];
  if (typeof viewer !== "string" || viewer.length > 100)
    throw new AccessError(
      403,
      "VIEWER_ADDRESS_MISSING",
      "Unable to validate the visitor address.",
    );
  const bracket = viewer.match(/^\[([^\]]+)\](?::\d+)?$/);
  const address = bracket ? bracket[1] : viewer.replace(/:\d+$/, "");
  if (!isIP(address))
    throw new AccessError(
      403,
      "VIEWER_ADDRESS_INVALID",
      "Unable to validate the visitor address.",
    );
  return address;
}

export async function registerSessions(
  server: FastifyInstance,
  db: PrismaClient,
  config: AuthConfig,
) {
  await server.register(cookie);
  await server.register(rateLimit, {
    keyGenerator: (request) =>
      loginRateKey(request.headers, config.originSecret, request.ip),
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
    const pathname = request.url.split("?")[0];
    if (
      config.originSecret &&
      pathname.startsWith("/api/") &&
      !["/api/ready", "/api/health"].includes(pathname)
    )
      requireCloudFront(request.headers, config.originSecret);
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
            impersonatedUser: { include: { membership: { include: { company: true } } } },
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
    request.sessionActor = session.user;
    request.appSession = session;
    const pathname = request.url.split("?")[0];
    const exiting = pathname === "/api/auth/logout" || (pathname === "/api/impersonation" && request.method === "DELETE");
    const contextId = session.impersonatedUserId && session.impersonationExpiresAt
      ? `${encodeURIComponent(session.impersonatedUserId)}:${session.impersonationExpiresAt.toISOString()}` : "";
    // Every tab must acknowledge its effective identity. A stale tab may never
    // silently submit a draft or display a response under another identity.
    if (pathname !== "/api/bootstrap" && !exiting && (request.headers["x-impersonation-id"] ?? "") !== contextId)
      throw new AccessError(409, "IMPERSONATION_CONTEXT_CHANGED", "Your viewing account changed. Reload to continue.");
    if (session.impersonatedUserId) {
      const target = session.impersonatedUser;
      const unavailable = !canViewTarget(session.user, target) ||
        !session.impersonationExpiresAt || session.impersonationExpiresAt.getTime() <= Date.now() ||
        !target || !sameImpersonationMembership(target, session.impersonationCompanyId, session.impersonationMembershipVersion);
      request.impersonation = {
        actor: { id: session.user.id, name: session.user.name, email: session.user.email },
        expiresAt: session.impersonationExpiresAt!, contextId, readOnly: true, unavailable,
      };
      // Exit always uses the signed-in actor, even after target/actor revocation.
      // Bootstrap retains a disabled target projection so its exit banner works.
      if (!exiting && target) request.principal = session.user.platformRole === "owner" ? target : { ...target, platformRole: null };
      if (!exiting && pathname !== "/api/bootstrap") {
        if (unavailable)
          throw new AccessError(403, "IMPERSONATION_UNAVAILABLE", "This impersonation expired or access changed. Return to your account to continue.");
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && pathname !== "/api/telemetry")
          throw new AccessError(403, "IMPERSONATION_READ_ONLY", "Impersonation is read-only. Return to your account before making changes.");
      }
    }
    const verificationAllowed = exiting || ["/api/bootstrap", "/api/account", "/api/account/verification", "/api/account/verification-status"].includes(pathname);
    if (session.user.emailVerified === false && !verificationAllowed)
      throw new AccessError(403, "EMAIL_VERIFICATION_REQUIRED", "Verify your email before using your assigned workspace.");
    const membership = request.principal!.membership;
    if (!exiting && membership?.status === "active") {
      request.companyFeatures = await companyFeatures(db, membership.companyId);
      if (!request.impersonation?.unavailable)
        requireFeatures(request.companyFeatures, memberRouteFeatures(request.routeOptions.url ?? pathname, membership.role), request.method);
    }
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
        ...((request.query as Record<string,unknown>).switchAccount === "1" ? {prompt:"login"} : {}),
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
        const {user,upgradeOwner} = await synchronizeIdentity(tx,issuer,{...claims,sub:claims.sub,email:claims.email as string});
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
            actorId: request.sessionActor!.id,
            action: "session.revoked",
            requestId: request.id,
            ...(request.appSession!.impersonatedUserId ? {
              targetId: request.appSession!.impersonatedUserId,
              detail: { impersonation: true },
            } : {}),
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
