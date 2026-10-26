type Member = { userId: string; role: string; status: string; version: number; user: { name: string | null; email: string; platformRole: string | null } };
type User = { id: string; name: string | null; email: string; platformRole: string | null; companyId: string | null; membership: { companyId: string; role: string; status: string; version: number } | null; identities: { issuer: string; subject: string }[] };
type Accounts = Record<string, { user_id: string; email: string }>;
const reviewPath = (id: string) => `/platform/users?userId=${encodeURIComponent(id)}`;
const supportPath = (id: string) => `/platform/impersonation?supportUserId=${encodeURIComponent(id)}`;

// The generation's saved subjects establish ownership. Names/emails only help
// the platform owner review the exact account; they never adopt an identity.
export function demoOwnershipReview(accounts: Accounts | null, allowed: string[], members: Member[], users: User[], companyId: string | null, issuer?: string | null) {
  const foreignMembers = members.filter(m => !allowed.includes(m.userId)).map(m => ({
    userId: m.userId, name: m.user.name, email: m.user.email, role: m.role, status: m.status,
    platformRole: m.user.platformRole, reviewPath: reviewPath(m.userId),
    supportPath: m.user.platformRole === "support" ? supportPath(m.userId) : null,
  }));
  const changedAccounts = users.flatMap(user => {
    const entry = Object.entries(accounts || {}).find(([, account]) => account.user_id === user.id);
    const reasons = [
      user.platformRole ? "platform_authority" : "",
      user.companyId ? "legacy_company_assignment" : "",
      !entry || entry[1].email !== user.email ? "email_changed" : "",
      user.membership && user.membership.companyId !== companyId ? "other_company_membership" : "",
      issuer && !user.identities.some(identity => identity.issuer === issuer && identity.subject === user.id) ? "identity_mapping_changed" : "",
    ].filter(Boolean);
    return reasons.length ? [{ userId: user.id, name: user.name, email: user.email, accountKey: entry?.[0] ?? null,
      expectedEmail: entry?.[1].email ?? null, platformRole: user.platformRole, reasons,
      reviewPath: reviewPath(user.id), supportPath: user.platformRole === "support" ? supportPath(user.id) : null }] : [];
  });
  // Bind the reviewed action to each reason and exact current identity, rather
  // than only the number of mismatches (which could stay the same after edits).
  const snapshot = users.map(user => ({ id: user.id, email: user.email, platformRole: user.platformRole, companyId: user.companyId,
    membership: user.membership && { companyId: user.membership.companyId, role: user.membership.role, status: user.membership.status, version: user.membership.version },
    identities: user.identities.map(i => [i.issuer, i.subject]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) }));
  return { foreignMembers, changedAccounts, snapshot };
}
