import { randomBytes } from "node:crypto";
import { AccessError } from "./access.js";
export type ProviderUser = {
  user_id: string;
  email: string;
  email_verified: boolean;
  name?: string;
  blocked?: boolean;
  identities?: { connection: string; provider?: string }[];
};
export interface IdentityProvider {
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
  async function request(path: string, options: RequestInit = {}) {
    const response = await send(base + path, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
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
  async function access() {
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
          });
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
  async function api(path: string, body?: unknown, method?: "PATCH") {
    const r = await request("/api/v2/" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${await access()}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
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
  return {
    issuer: base + "/",
    databaseConnection: connection,
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
