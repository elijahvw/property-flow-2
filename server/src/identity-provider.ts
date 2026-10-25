import { randomBytes } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { AccessError } from "./access.js";
export type ProviderUser = {
  user_id: string;
  email: string;
  email_verified: boolean;
  name?: string;
  blocked?: boolean;
  identities?: { connection: string; provider?: string }[];
};
export type DemoIdentity = { demoId: string; accountKey: string; email: string; name: string; password: string };
export type DemoCallOptions = { deadline?: number };
export type DemoIdentityProvider = {
  ensure(account: DemoIdentity, options?: DemoCallOptions): Promise<ProviderUser>;
  block(account: Pick<DemoIdentity, "demoId" | "accountKey" | "email">, expectedSubject?: string, beforeBlock?: (user: ProviderUser) => Promise<void>, options?: DemoCallOptions): Promise<void>;
};
export interface IdentityProvider {
  salesDemo?: DemoIdentityProvider;
  issuer: string;
  databaseConnection: string;
  list(
    page: number,
    email?: string,
  ): Promise<{ users: ProviderUser[]; nextPage: number | null }>;
  get(id: string): Promise<ProviderUser>;
  create(email: string, name: string): Promise<ProviderUser>;
  verify(id: string): Promise<void>;
  setup(email: string): Promise<void>;
  rename(id: string, name: string): Promise<ProviderUser>;
}
export function identityProvider(
  env = process.env,
  send: typeof fetch = fetch,
  timing = { now: Date.now, sleep: async (ms: number) => { await pause(ms); } },
): IdentityProvider | undefined {
  const domain = env.AUTH0_DOMAIN,
    clientId = env.AUTH0_MANAGEMENT_CLIENT_ID,
    secret = env.AUTH0_MANAGEMENT_CLIENT_SECRET;
  if (!domain || !clientId || !secret) return undefined;
  if (!/^[a-z0-9.-]+$/i.test(domain)) throw Error("Invalid identity domain");
  const base = `https://${domain}`,
    connection =
      env.AUTH0_DATABASE_CONNECTION || "Username-Password-Authentication";
  let token = "",
    expires = 0,
    pending: Promise<string> | undefined;
  let demoQueue: Promise<void> = Promise.resolve(), demoNextAt = 0;
  const demoBusy = () => new AccessError(429, "DEMO_IDENTITY_BUSY", "Auth0 is still rate limiting demo accounts. Progress and passwords are saved. Wait a minute, then retry this operation. Setup continues with remaining accounts; teardown keeps local access disabled.");
  // Serialize only demo calls in this provider instance. Other replicas still
  // need to honor the tenant-wide rate-limit response from Auth0.
  async function demoSend(path: string, options: RequestInit, deadline: number) {
    const previous = demoQueue;
    let release!: () => void;
    demoQueue = new Promise<void>(resolve => { release = resolve; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // A different demo may already own the lane. Expire this caller without
      // allowing its queue slot to overtake that operation.
      await Promise.race([previous, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(demoBusy()), Math.max(0, deadline - timing.now() - 10000));
      })]);
      clearTimeout(timer);
      for (let attempt = 0; ; attempt++) {
        const start = Math.max(timing.now(), demoNextAt);
        if (start + 10000 > deadline) throw demoBusy();
        if (start > timing.now()) await timing.sleep(start - timing.now());
        if (timing.now() + 10000 > deadline) throw demoBusy();
        const response = await send(base + path, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) })
          .finally(() => { demoNextAt = timing.now() + 1000; });
        if (response.status !== 429) return response;
        const retry = response.headers.get("retry-after"), reset = response.headers.get("x-ratelimit-reset");
        const retryAt = retry === null ? NaN : /^\d+(\.\d+)?$/.test(retry) ? timing.now() + Number(retry) * 1000 : Date.parse(retry);
        const resetAt = reset !== null && /^\d+(\.\d+)?$/.test(reset) ? Number(reset) * 1000 : NaN;
        demoNextAt = Math.max(demoNextAt, timing.now() + 1000 * 2 ** attempt, Number.isFinite(retryAt) ? retryAt : 0, Number.isFinite(resetAt) ? resetAt : 0);
        await response.body?.cancel();
        if (attempt >= 3) throw demoBusy();
      }
    } finally { clearTimeout(timer); void previous.then(release); }
  }
  async function request(path: string, options: RequestInit = {}, demoDeadline?: number) {
    const response = demoDeadline === undefined
      ? await send(base + path, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) })
      : await demoSend(path, options, demoDeadline);
    if (!response.ok)
      throw new AccessError(
        response.status === 429 ? 429 : 503,
        "IDENTITY_PROVIDER_UNAVAILABLE",
        response.status === 429
          ? "Identity service is busy. Wait a minute before retrying."
          : "Identity service is unavailable or lacks permission. Please retry or contact your administrator.",
      );
    return response;
  }
  async function access(demoDeadline?: number) {
    if (token && expires > Date.now()) return token;
    if (!pending)
      pending = (async () => {
        try {
          const r = await request("/oauth/token", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              grant_type: "client_credentials",
              client_id: clientId,
              client_secret: secret,
              audience: base + "/api/v2/",
              scope: "read:users create:users update:users",
            }),
          }, demoDeadline);
          const b = (await r.json()) as any;
          if (
            typeof b.access_token !== "string" ||
            !Number.isFinite(b.expires_in) ||
            b.expires_in <= 60
          )
            throw Error("Invalid provider token");
          token = b.access_token;
          expires = Date.now() + (b.expires_in - 60) * 1000;
          return token;
        } finally {
          pending = undefined;
        }
      })();
    return pending;
  }
  async function api(path: string, body?: unknown, method?: "PATCH", demoDeadline?: number) {
    const r = await request("/api/v2/" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${await access(demoDeadline)}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, demoDeadline);
    return await r.json();
  }
  function user(value: any): ProviderUser {
    if (
      !value ||
      typeof value.user_id !== "string" ||
      typeof value.email !== "string" ||
      !value.email.includes("@")
    )
      throw new AccessError(
        503,
        "IDENTITY_PROFILE_INVALID",
        "Identity profile is incomplete.",
      );
    return {
      user_id: value.user_id,
      email: value.email,
      email_verified: value.email_verified === true,
      name: typeof value.name === "string" ? value.name : undefined,
      blocked: value.blocked === true,
      identities: Array.isArray(value.identities)
        ? value.identities
            .filter((i: any) => typeof i.connection === "string")
            .map((i: any) => ({
              connection: i.connection,
              provider: typeof i.provider === "string" ? i.provider : undefined,
            }))
        : [],
    };
  }
  async function byEmail(email: string) {
    const rows = await api("users-by-email?" + new URLSearchParams({ email }));
    if (!Array.isArray(rows)) throw Error("Invalid provider response");
    return rows.map(user);
  }
  async function matchingEmail(email: string) {
    // Exact lookup is immediately consistent; indexed search also catches
    // case-preserved emails from upstream social/enterprise providers.
    const exact = await byEmail(email);
    const indexed = await api("users?" + new URLSearchParams({
      q: "email:" + JSON.stringify(email), search_engine: "v3",
      page: "0", per_page: "2", include_totals: "true",
      fields: "user_id,email,email_verified,name,blocked,identities", include_fields: "true",
    }));
    if (!Array.isArray(indexed.users) || !Number.isFinite(indexed.total))
      throw new AccessError(503,"IDENTITY_PROFILE_INVALID","Identity search response is incomplete.");
    const found = new Map(exact.map(u => [u.user_id,u]));
    for (const value of indexed.users) {
      const row = user(value);
      if (row.email.toLowerCase() === email.toLowerCase()) found.set(row.user_id,row);
    }
    if (indexed.total > 1 || found.size > 1)
      throw new AccessError(409,"IDENTITY_AMBIGUOUS","Multiple sign-in identities use this email. Choose the intended existing account in Property Flow Users; no account was created or linked.");
    return [...found.values()];
  }
  function demoProfile(raw: any, account: Pick<DemoIdentity, "demoId" | "accountKey" | "email">) {
    const result = user(raw), marker = raw.app_metadata?.property_flow_sales_demo;
    if (marker?.id !== account.demoId || marker?.account !== account.accountKey || result.email !== account.email ||
        !result.user_id.startsWith("auth0|") || !result.identities?.some(i => i.connection === connection && i.provider === "auth0"))
      throw new AccessError(409, "DEMO_IDENTITY_CONFLICT", "This identity is not owned by this demo. No existing account was changed.");
    return result;
  }
  async function findDemo(account: Pick<DemoIdentity, "demoId" | "accountKey" | "email">, deadline: number) {
    if (!/^[0-9a-f-]{36}$/.test(account.demoId) || !/^[a-z0-9]+$/.test(account.accountKey) || account.email !== `${account.accountKey}.${account.demoId}@sales-demo.invalid`)
      throw new AccessError(400, "INVALID_DEMO_IDENTITY", "Invalid generated demo identity.");
    const rows = await api("users-by-email?" + new URLSearchParams({ email: account.email }), undefined, undefined, deadline);
    if (!Array.isArray(rows) || rows.length > 1) throw new AccessError(409, "DEMO_IDENTITY_CONFLICT", "Demo identity requires review. No existing account was changed.");
    return rows.length ? demoProfile(rows[0], account) : null;
  }
  return {
    issuer: base + "/",
    databaseConnection: connection,
    salesDemo: {
      async ensure(account, options) {
        const deadline = Math.min(options?.deadline ?? Infinity, timing.now() + 110000);
        const existing = await findDemo(account, deadline);
        if (existing) {
          if (!existing.email_verified || existing.blocked) throw new AccessError(409, "DEMO_IDENTITY_UNAVAILABLE", "The demo identity was changed or disabled. Tear down this setup and create a new demo.");
          return existing;
        }
        try {
          const result = demoProfile(await api("users", { connection, email: account.email, name: account.name, password: account.password,
            email_verified: true, verify_email: false, app_metadata: { property_flow_sales_demo: { id: account.demoId, account: account.accountKey } } }, undefined, deadline), account);
          if (!result.email_verified || result.blocked) throw new AccessError(409, "DEMO_IDENTITY_UNAVAILABLE", "The provider did not activate this demo account.");
          return result;
        } catch (error) {
          // A rejected 429 needs no ambiguity lookup. Lost write responses still
          // recover through exact generation markers before another create.
          if (error instanceof AccessError && error.code === "DEMO_IDENTITY_BUSY") throw error;
          const recovered = await findDemo(account, deadline);
          if (recovered?.email_verified && !recovered.blocked) return recovered;
          if (error instanceof AccessError) throw error;
          throw new AccessError(503, "DEMO_IDENTITY_RETRY", "Demo account setup was interrupted. Retry the same setup.");
        }
      },
      async block(account, expectedSubject, beforeBlock, options) {
        const deadline = Math.min(options?.deadline ?? Infinity, timing.now() + 110000);
        const found = await findDemo(account, deadline);
        if (!found) return;
        if (expectedSubject && expectedSubject !== found.user_id) throw new AccessError(409, "DEMO_IDENTITY_CONFLICT", "The demo identity changed. No account was disabled.");
        // A create response may have been lost before its subject was recorded.
        // Fence the discovered local account before disabling it upstream.
        await beforeBlock?.(found);
        if (!found.blocked) {
          const result = user(await api("users/" + encodeURIComponent(found.user_id), { blocked: true }, "PATCH", deadline));
          if (result.user_id !== found.user_id || !result.blocked) throw new AccessError(503, "DEMO_BLOCK_RETRY", "Retry teardown to finish disabling the demo logins.");
        }
      },
    },
    async list(page, email) {
      if (email) return { users: await byEmail(email), nextPage: null };
      const b = await api(
        "users?" +
          new URLSearchParams({
            page: String(page),
            per_page: "50",
            include_totals: "true",
            fields: "user_id,email,email_verified,name,blocked,identities",
            include_fields: "true",
            sort: "user_id:1",
            search_engine: "v3",
          }),
      );
      if (!Array.isArray(b.users) || !Number.isFinite(b.total))
        throw new AccessError(
          503,
          "IDENTITY_PROFILE_INVALID",
          "Identity directory response is incomplete.",
        );
      return {
        users: b.users.map(user),
        nextPage: (page + 1) * 50 < Math.min(b.total, 1000) ? page + 1 : null,
      };
    },
    async get(id) {
      const value = user(await api("users/" + encodeURIComponent(id)));
      if (value.user_id !== id) throw Error("Identity mismatch");
      return value;
    },
    async create(email, name) {
      const existing = await matchingEmail(email);
      if(existing.length===1)return existing[0];
      if(existing.length>1)throw new AccessError(409,"IDENTITY_AMBIGUOUS","Multiple sign-in identities use this email. Choose the intended existing account in Property Flow Users; no account was created or linked.");
      try {
        return user(
          await api("users", {
            connection,
            email,
            name,
            password: randomBytes(48).toString("base64url") + "aA1!",
            email_verified: false,
            verify_email: false,
          }),
        );
      } catch (error) {
        const recovered = await byEmail(email);
        const found = recovered.find((u) =>
          u.identities?.some(
            (i) => i.connection === connection && i.provider === "auth0",
          ),
        );
        if (found && recovered.length === 1) return found;
        throw error;
      }
    },
    async rename(id, name) {
      const result=user(await api("users/"+encodeURIComponent(id), {name}, "PATCH"));
      if(result.user_id !== id || result.name !== name) throw new AccessError(409,"IDENTITY_PROFILE_CONFLICT","The identity provider did not accept the account name. Refresh the account and retry.");
      return result;
    },
    async verify(id) {
      await api("jobs/verification-email", {
        user_id: id,
        client_id: env.AUTH0_WEB_CLIENT_ID,
      });
    },
    async setup(email) {
      if (!env.AUTH0_WEB_CLIENT_ID)
        throw new AccessError(
          503,
          "IDENTITY_NOT_CONFIGURED",
          "Password setup is not configured.",
        );
      await request("/dbconnections/change_password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: env.AUTH0_WEB_CLIENT_ID,
          connection,
          email,
        }),
      });
    },
  };
}
