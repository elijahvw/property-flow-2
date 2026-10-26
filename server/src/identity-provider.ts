import { isDemoEmail } from "./sales-demo-email.js";
import { randomBytes } from "node:crypto";
import { AccessError } from "./access.js";
type ProviderOperation = "token" | "lookup" | "directory" | "create" | "update" | "verification" | "password_setup";
type ProviderFailure = "rate_limit" | "authentication" | "permission" | "rejected" | "unavailable" | "transport" | "invalid_response" | "deadline";
export class IdentityProviderError extends AccessError {
  readonly rateSource?: "cooldown" | "upstream";
  constructor(public operation: ProviderOperation, public failure: ProviderFailure, public upstreamStatus?: number, public retryAfterSeconds?: number) {
    super(failure === "rate_limit" ? 429 : 503, "IDENTITY_PROVIDER_UNAVAILABLE",
      failure === "rate_limit" ? `Identity service is busy. Wait ${retryAfterSeconds || 60} seconds before retrying the same request.` :
      failure === "authentication" || failure === "permission" || failure === "rejected" ? "The identity connection is not authorized for this action. Ask a platform administrator to review its configuration and permissions." :
      failure === "deadline" ? "The demo identity operation reached its time limit. Progress is saved. Retry the same setup or teardown to continue." :
      failure === "invalid_response" ? "Identity service returned an unreadable response. Retry the same request or contact your administrator." :
      "Identity service could not be reached or is unavailable. Retry the same request or contact your administrator.");
    if (failure === "rate_limit") this.rateSource = upstreamStatus === 429 ? "upstream" : "cooldown";
  }
}
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
  timing: { now?: () => number; wait?: (milliseconds: number) => Promise<void> } = {},
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
  const now = timing.now || Date.now, wait = timing.wait || ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  let notBefore = 0, demoNextAt = 0, queue: Promise<unknown> = Promise.resolve();
  function withinDeadline<T>(work: Promise<T>, deadline: number | undefined, stage: ProviderOperation, expire: () => void = () => {}) {
    if (deadline === undefined) return work;
    return new Promise<T>((resolve, reject) => {
      const remaining = deadline - now();
      if (remaining <= 0) { expire(); void work.catch(() => {}); reject(new IdentityProviderError(stage, "deadline")); return; }
      const timer = setTimeout(() => { expire(); reject(new IdentityProviderError(stage, "deadline")); }, remaining);
      work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }
  const operation = (path: string, options: RequestInit): ProviderOperation => path === "/oauth/token" ? "token" : path.includes("/users-by-email?") ? "lookup" : path.includes("/jobs/") ? "verification" : path.includes("/dbconnections/") ? "password_setup" : options.method === "PATCH" ? "update" : options.method === "POST" ? "create" : path.includes("/users?") ? "directory" : "lookup";
  function retryDelay(response: Response) {
    const retry = response.headers.get("retry-after"), reset = response.headers.get("x-ratelimit-reset");
    const seconds = retry === null ? NaN : /^\d+(?:\.\d+)?$/.test(retry.trim()) ? Number(retry) : (Date.parse(retry) - now()) / 1000;
    const resetSeconds = reset && /^\d+(?:\.\d+)?$/.test(reset.trim()) ? Number(reset) - now() / 1000 : NaN;
    const candidates = [seconds, resetSeconds].filter(value => Number.isFinite(value) && value >= 0);
    const advertised = candidates.length ? Math.max(...candidates) : NaN;
    return Number.isFinite(advertised) ? Math.min(86400000, Math.max(50, Math.ceil(advertised * 1000) + 25)) : response.status === 429 ? 60000 : 0;
  }
  async function request(path: string, options: RequestInit = {}, deadline?: number) {
    const stage = operation(path, options);
    let expired = false;
    const controller = new AbortController();
    const run = queue.then(async () => {
      // Serialize this client's requests and respect the provider's next slot.
      // Short quota windows are paced; long cooldowns return actionable retry
      // guidance instead of holding HTTP requests or database transactions open.
      const delay = Math.max(notBefore, deadline !== undefined ? demoNextAt : 0) - now();
      if (expired || deadline !== undefined && now() >= deadline) throw new IdentityProviderError(stage, "deadline");
      if (delay > 2000) throw new IdentityProviderError(stage, "rate_limit", undefined, Math.ceil(delay / 1000));
      if (deadline !== undefined && now() + Math.max(0, delay) >= deadline) throw new IdentityProviderError(stage, "deadline");
      if (delay > 0) await wait(delay);
      if (expired || deadline !== undefined && now() >= deadline) throw new IdentityProviderError(stage, "deadline");
      let response: Response;
      try { response = await send(base + path, { ...options, redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.min(10000, deadline === undefined ? 10000 : Math.ceil(deadline - now()))))]) }); }
      catch { throw new IdentityProviderError(stage, expired || deadline !== undefined && now() >= deadline ? "deadline" : "transport"); }
      finally { if (deadline !== undefined) demoNextAt = now() + 1000; }
      if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") notBefore = Math.max(notBefore, now() + retryDelay(response));
      if (!response.ok) throw new IdentityProviderError(stage, response.status === 429 ? "rate_limit" : response.status === 401 ? "authentication" : response.status === 403 ? "permission" : response.status < 500 ? "rejected" : "unavailable", response.status, response.status === 429 ? Math.max(1, Math.ceil((notBefore - now()) / 1000)) : undefined);
      return response;
    });
    queue = run.catch(() => {});
    return withinDeadline(run, deadline, stage, () => { expired = true; controller.abort(); });
  }
  async function json(response: Response, stage: ProviderOperation, deadline?: number) {
    try { return await withinDeadline(response.json(), deadline, stage); }
    catch (error) { if (error instanceof IdentityProviderError) throw error; throw new IdentityProviderError(stage, "invalid_response", response.status); }
  }
  async function access(deadline?: number) {
    if (token && expires > now()) return token;
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
          }, deadline);
          const b = (await json(r, "token", deadline)) as any;
          if (
            !b || typeof b.access_token !== "string" ||
            !Number.isFinite(b.expires_in) ||
            b.expires_in <= 60
          )
            throw new IdentityProviderError("token", "invalid_response", r.status);
          token = b.access_token;
          expires = now() + (b.expires_in - 60) * 1000;
          return token;
        } finally {
          pending = undefined;
        }
      })();
    return withinDeadline(pending, deadline, "token");
  }
  async function api(path: string, body?: unknown, method?: "PATCH", deadline?: number) {
    const r = await request("/api/v2/" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${await access(deadline)}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, deadline);
    return await json(r, operation("/api/v2/" + path, { method: method ?? (body === undefined ? "GET" : "POST") }), deadline);
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
  async function findDemo(account: Pick<DemoIdentity, "demoId" | "accountKey" | "email">, deadline?: number) {
    if (!/^[0-9a-f-]{36}$/.test(account.demoId) || !/^[a-z0-9]+$/.test(account.accountKey) || !isDemoEmail(account.demoId, account.accountKey, account.email))
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
        const deadline = Math.min(options?.deadline ?? Infinity, now() + 110000);
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
          // An explicit rejection did not create an identity. In particular,
          // avoid spending another lookup immediately after a quota response.
          if (error instanceof IdentityProviderError && ["rate_limit", "authentication", "permission", "rejected", "deadline"].includes(error.failure)) throw error;
          let recovered;
          try { recovered = await findDemo(account, deadline); }
          catch (recoveryError) { if (error instanceof AccessError) throw error; throw recoveryError; }
          if (recovered?.email_verified && !recovered.blocked) return recovered;
          if (error instanceof AccessError) throw error;
          throw new AccessError(503, "DEMO_IDENTITY_RETRY", "Demo account setup was interrupted. Retry the same setup.");
        }
      },
      async block(account, expectedSubject, beforeBlock, options) {
        const deadline = Math.min(options?.deadline ?? Infinity, now() + 110000);
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
