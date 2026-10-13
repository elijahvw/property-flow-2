export class AuthTimeoutError extends Error {
  constructor() { super('Sign-in or profile loading took too long.'); this.name = 'AuthTimeoutError'; }
}
export function withDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthTimeoutError()), timeoutMs);
    task.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
export async function loadProfile<T>(
  getToken: () => Promise<string>,
  getProfile: (token: string, signal: AbortSignal) => Promise<T>,
  timeoutMs = 12000,
): Promise<T> {
  const controller = new AbortController();
  try {
    return await withDeadline((async () => {
      const token = await getToken();
      if (controller.signal.aborted) throw new AuthTimeoutError();
      return getProfile(token, controller.signal);
    })(), timeoutMs);
  } finally {
    controller.abort();
  }
}

export type PortalRole = 'admin' | 'landlord' | 'tenant';
export function roleFromClaims(claims: unknown): PortalRole | null {
  if (!Array.isArray(claims)) return null;
  return (['admin', 'landlord', 'tenant'] as const).find(role => claims.includes(role)) || null;
}
export function matchingPortalRole(claimRole: PortalRole | null, profileRole: unknown): PortalRole | null {
  return claimRole && claimRole === profileRole ? claimRole : null;
}
