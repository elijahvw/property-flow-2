export function scheduledDueDate(month: string, dueDay: number) {
  const first = new Date(month + "-01T00:00:00Z");
  const last = new Date(first);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  first.setUTCDate(Math.min(dueDay, last.getUTCDate()));
  return first.toISOString().split("T")[0];
}
export function graceDates(dueDate: string, graceDays: number) {
  const through = new Date(dueDate + "T00:00:00Z");
  if (!Number.isFinite(through.getTime()) || !Number.isInteger(graceDays) || graceDays<0 || graceDays>30)
    return { through: "Choose a due date", after: "Choose a due date" };
  through.setUTCDate(through.getUTCDate() + graceDays);
  const after = new Date(through);
  after.setUTCDate(after.getUTCDate() + 1);
  return {
    through: through.toISOString().split("T")[0],
    after: after.toISOString().split("T")[0],
  };
}
