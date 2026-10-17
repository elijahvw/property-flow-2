import type { Prisma } from "@prisma/client";
// Shared by callback and regression tests: preconfigured grants belong to exact issuer/subject.
export async function synchronizeIdentity(
  tx: Prisma.TransactionClient,
  issuer: string,
  claims: {
    sub: string;
    email: string;
    email_verified?: unknown;
    name?: unknown;
    [key: string]: unknown;
  },
) {
  const identity = await tx.identity.findUnique({
    where: { issuer_subject: { issuer, subject: claims.sub } },
  });
  let user = await tx.user.findUnique({
    where: { id: identity?.userId ?? claims.sub },
  });
  if (
    !identity &&
    user &&
    (await tx.identity.count({ where: { userId: user.id } }))
  )
    throw new Error("Identity issuer mismatch");
  if (!user)
    user = await tx.user.create({
      data: {
        id: claims.sub,
        email: claims.email as string,
        name: typeof claims.name === "string" ? claims.name : null,
        role: "unassigned",
      },
    });
  // One-time upgrade needs both the old explicit admin assignment AND a
  // freshly verified identity-provider admin claim; the default tenant
  // field is never converted into membership or permissions.
  const roles = claims["https://propertyflow.com/roles"];
  const upgradeOwner =
    !user.accessInitializedAt &&
    user.role === "admin" &&
    Array.isArray(roles) &&
    roles.includes("admin");
  if (!user.accessInitializedAt && user.role === "admin" && !upgradeOwner) {
    throw new Error("OWNER_UPGRADE_CLAIM_REQUIRED");
  }
  user = await tx.user.update({
    where: { id: user.id },
    data: {
      email: claims.email as string,
      ...(typeof claims.name === "string" ? {name:claims.name.slice(0,200)} : {}),
      emailVerified: claims.email_verified === true,
      firstSignedInAt: user.firstSignedInAt ?? new Date(),
      ...(upgradeOwner ? { platformRole: "owner" } : {}),
      accessInitializedAt: user.accessInitializedAt ?? new Date(),
    },
  });
  await tx.identity.upsert({
    where: { issuer_subject: { issuer, subject: claims.sub } },
    update: {},
    create: { issuer, subject: claims.sub, userId: user.id },
  });
  return { user, upgradeOwner };
}
