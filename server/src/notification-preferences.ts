import type { Tx } from "./operational.js";

export const preferenceFields = [
  "maintenanceEnabled", "workEnabled", "inspectionsEnabled", "agreementsEnabled",
] as const;
export type NotificationSettings = Record<typeof preferenceFields[number], boolean>;
export const defaultNotificationSettings: NotificationSettings = {
  maintenanceEnabled: true, workEnabled: true, inspectionsEnabled: true, agreementsEnabled: true,
};
export function notificationSettings(row: NotificationSettings): NotificationSettings {
  return {
    maintenanceEnabled: row.maintenanceEnabled, workEnabled: row.workEnabled,
    inspectionsEnabled: row.inspectionsEnabled, agreementsEnabled: row.agreementsEnabled,
  };
}

async function ensureFence(tx: Tx, companyId: string) {
  // A company created after migration needs no background provisioning. At
  // Serializable isolation a concurrent, newly visible insert retries rather
  // than treating an absent row as an unlocked default.
  await tx.notificationPreferenceFence.createMany({ data: [{ companyId }], skipDuplicates: true });
}
export async function lockPreferenceSave(tx: Tx, companyId: string) {
  await ensureFence(tx, companyId);
  // Change the tuple, even for an all-default/no-op save. A publisher waiting
  // with an older Serializable snapshot must retry before reading choices.
  await tx.$executeRaw`UPDATE "NotificationPreferenceFence" SET generation=generation+1 WHERE "companyId"=${companyId}`;
}

export async function optedInRecipients(
  tx: Tx, companyId: string, userIds: string[],
  sourceType: "maintenance" | "work" | "inspections" | "agreements",
) {
  if (!userIds.length) return [];
  await ensureFence(tx, companyId);
  // Publications share this dedicated fence. They never acquire another
  // actor's User fence or upgrade the company's authorization lock.
  await tx.$queryRaw`SELECT "companyId" FROM "NotificationPreferenceFence" WHERE "companyId"=${companyId} FOR SHARE`;
  // This bounded list comes only from the publisher's eligible audience, never
  // an API parameter. It grants SELECT of flags only, not preference writes or
  // access to another recipient's inbox/actions. Clear it before returning.
  await tx.$queryRaw`SELECT set_config('app.notification_preference_recipients', ${JSON.stringify(userIds)}, true)`;
  const rows = await tx.notificationPreference.findMany({
    where: { companyId, userId: { in: userIds } },
    select: { userId: true, maintenanceEnabled: true, workEnabled: true, inspectionsEnabled: true, agreementsEnabled: true },
  });
  await tx.$queryRaw`SELECT set_config('app.notification_preference_recipients', '[]', true)`;
  const field = {
    maintenance: "maintenanceEnabled", work: "workEnabled",
    inspections: "inspectionsEnabled", agreements: "agreementsEnabled",
  } as const;
  const choices = new Map(rows.map(row => [row.userId, row[field[sourceType]]]));
  return userIds.filter(userId => choices.get(userId) !== false);
}
