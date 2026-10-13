type Identity = { sub?: unknown; email?: unknown; name?: unknown; [key: string]: unknown };
type StoredUser = { id: string; email: string; name: string | null; role: string; companyId: string | null };
type ProfileData = { email: string; name?: string; role: string };
type UserStore = {
  findUnique(args: { where: { id: string } }): Promise<StoredUser | null>;
  upsert(args: { where: { id: string }; update: ProfileData; create: ProfileData & { id: string } }): Promise<StoredUser>;
};

export class UserProfileError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'UserProfileError';
  }
}

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

// Called only after the API has verified the access token. OIDC profile
// scopes do not guarantee that email/name are embedded in that token.
export async function synchronizeUser(
  store: UserStore,
  claims: Identity,
  fetchProfile: () => Promise<Identity>,
): Promise<StoredUser> {
  const id = nonEmpty(claims.sub);
  if (!id) throw new UserProfileError(401, 'IDENTITY_SUBJECT_MISSING', 'Authenticated user identity is missing');

  const claimRoles = claims['https://propertyflow.com/roles'];
  const roles = Array.isArray(claimRoles) ? claimRoles : [];
  const role = roles.includes('admin') ? 'admin' : roles.includes('landlord') ? 'landlord' : 'tenant';
  let email = nonEmpty(claims.email);
  let name = nonEmpty(claims.name);

  if (!email) {
    // Keep the real profile already stored for this exact Auth0 identity.
    // Never match accounts by email or overwrite profile fields with undefined.
    const existing = await store.findUnique({ where: { id } });
    email = nonEmpty(existing?.email);
    name ??= nonEmpty(existing?.name);

    if (!email) {
      let profile: Identity;
      try {
        profile = await fetchProfile();
      } catch {
        // Axios errors can contain Authorization headers; do not propagate them.
        throw new UserProfileError(502, 'IDENTITY_PROFILE_UNAVAILABLE', 'Unable to retrieve the authenticated user profile');
      }
      if (profile.sub !== id) {
        throw new UserProfileError(401, 'IDENTITY_SUBJECT_MISMATCH', 'User profile does not match the authenticated identity');
      }
      email = nonEmpty(profile.email);
      name ??= nonEmpty(profile.name);
    }
  }

  if (!email) {
    throw new UserProfileError(422, 'IDENTITY_EMAIL_MISSING', 'An email address is required in your Auth0 profile');
  }

  return store.upsert({
    where: { id },
    update: { email, name, role },
    create: { id, email, name, role },
  });
}
