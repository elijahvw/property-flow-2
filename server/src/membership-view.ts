// Access administration must not serialize company-private resident contact
// fields just because they share the membership table. Keep its response shape
// explicit; profile values are returned by the company-scoped profile routes.
export const membershipAccessSelect = {
  userId: true,
  companyId: true,
  role: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;
