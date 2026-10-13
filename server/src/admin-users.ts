export type Auth0Stage = 'token' | 'users' | 'roles';
export class Auth0ReadError extends Error {
  constructor(
    public stage: Auth0Stage,
    public upstreamStatus: number | undefined,
    public code: string,
    public retryAfter?: number,
  ) {
    super(code === 'AUTH0_RATE_LIMITED' ? 'Auth0 is limiting user lookups. Please wait and retry.'
      : code === 'AUTH0_ACCESS_DENIED' ? 'Auth0 user-management access is unavailable. Check the management application permissions.'
      : 'Auth0 user lookup is unavailable. Please try again.');
    this.name = 'Auth0ReadError';
  }
}
export function readError(stage: Auth0Stage, error: unknown): Auth0ReadError {
  if (error instanceof Auth0ReadError) return error;
  const response = (error as { response?: { status?: number; headers?: Record<string, unknown> } } | null)?.response;
  const status = response?.status;
  const retry = Number(response?.headers?.['retry-after']);
  return new Auth0ReadError(stage, status,
    status === 429 ? 'AUTH0_RATE_LIMITED' : status === 401 || status === 403 ? 'AUTH0_ACCESS_DENIED' : 'AUTH0_UNAVAILABLE',
    status === 429 ? Math.max(1, Math.min(60, Number.isFinite(retry) ? Math.ceil(retry) : 1)) : undefined,
  );
}
// Workers stop scheduling more lookups after a failure. All started workers
// settle before the error returns, avoiding work leaking into the next refresh.
export async function mapUsers<T, R>(items: T[], fetch: (item: T) => Promise<R>, concurrency = 2): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failure: unknown;
  let failed = false;
  const worker = async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try { results[index] = await fetch(items[index]); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failed) throw failure;
  return results;
}
type RemoteUser = { user_id: string; email?: string; name?: string; blocked?: boolean };
type LocalUser = { id: string; companyId: string | null; company?: unknown };
export async function listAdminUsers(
  remoteUsers: RemoteUser[],
  localUsers: LocalUser[],
  getRoles: (id: string) => Promise<{ name: string }[]>,
  companyId?: string,
) {
  const localById = new Map(localUsers.map(user => [user.id, user]));
  const visible = remoteUsers.filter(user => !companyId || localById.get(user.user_id)?.companyId === companyId);
  return mapUsers(visible, async user => {
    const roles = await getRoles(user.user_id);
    const assigned = roles.map(role => role.name);
    const role = ['admin', 'landlord', 'tenant'].find(name => assigned.includes(name)) || 'unassigned';
    return {
      id: user.user_id, email: user.email, name: user.name || user.email,
      role, blocked: user.blocked || false, company: localById.get(user.user_id)?.company || null,
    };
  });
}
export function createManagementTokenCache(
  fetchToken: () => Promise<{ access_token: string; expires_in: number }>,
  now = Date.now,
) {
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  return {
    invalidate(rejectedToken: string) {
      if (cached?.token === rejectedToken) cached = undefined;
    },
    get(): Promise<string> {
      if (cached && cached.expiresAt > now()) return Promise.resolve(cached.token);
      if (pending) return pending;
      pending = (async () => {
        try {
          const response = await fetchToken();
          if (typeof response.access_token !== 'string' || !response.access_token.trim() || !Number.isFinite(response.expires_in) || response.expires_in <= 0) {
            throw new Auth0ReadError('token', undefined, 'AUTH0_UNAVAILABLE');
          }
          const marginSeconds = Math.min(60, response.expires_in / 10);
          cached = { token: response.access_token, expiresAt: now() + (response.expires_in - marginSeconds) * 1000 };
          return cached.token;
        } finally { pending = undefined; }
      })();
      return pending;
    },
  };
}

export function createManagementReader(
  tokens: { get(): Promise<string>; invalidate(token: string): void },
  fetch: (path: string, token: string) => Promise<unknown>,
) {
  return async function read<T>(path: string, stage: Auth0Stage): Promise<T> {
    let token: string;
    try { token = await tokens.get(); } catch (error) { throw readError('token', error); }
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await fetch(path, token) as T; }
      catch (error: any) {
        if (error.response?.status === 401 && attempt === 0) {
          tokens.invalidate(token);
          try { token = await tokens.get(); } catch (tokenError) { throw readError('token', tokenError); }
          continue;
        }
        throw readError(stage, error);
      }
    }
    throw new Auth0ReadError(stage, undefined, 'AUTH0_UNAVAILABLE');
  };
}
