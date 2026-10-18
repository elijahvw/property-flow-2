import type { PrismaClient, AuditEvent } from "@prisma/client";
// Platform-only enrichment. Resolve directory/company names without crossing RLS
// to read property, lease or financial records on behalf of platform authority.
export async function auditLabels(db: Pick<PrismaClient, "user" | "company">, events: AuditEvent[]) {
  const ids = [
      ...new Set(
        events.flatMap((e) => [e.actorId, ...(e.targetId ? [e.targetId] : [])]),
      ),
    ],
    companyIds = [
      ...new Set(events.flatMap((e) => (e.companyId ? [e.companyId] : []))),
    ];
  const [people, companies] = await Promise.all([
    db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    }),
    db.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, name: true },
    }),
  ]);
  const users = new Map(people.map((p) => [p.id, p])),
    names = new Map(companies.map((c) => [c.id, c.name]));
  return events.map((e) => ({
    ...e,
    actor: users.get(e.actorId) ?? null,
    actorLabel:
      e.actorId === "system:rent-billing"
        ? "Automatic rent billing"
        : users.get(e.actorId)?.name ||
          users.get(e.actorId)?.email ||
          "Former or unavailable account",
    targetUser: e.targetId ? (users.get(e.targetId) ?? null) : null,
    companyName: e.companyId
      ? (names.get(e.companyId) ?? "Former or unavailable company")
      : null,
  }));
}
