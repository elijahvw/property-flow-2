// Calendar arithmetic preserves the original day after short months and leap years.
// Dates are UTC-backed date-only values; timezone is used only to determine today.
export function nextOccurrence(
  anchor: Date,
  current: Date,
  cadence: string,
  end: Date | null,
) {
  let next: Date;
  if (cadence === "weekly") {
    next = new Date(current);
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    const months = { monthly: 1, quarterly: 3, yearly: 12 }[cadence];
    if (!months) throw new Error("Invalid recurrence cadence");
    const offset =
      (current.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      current.getUTCMonth() -
      anchor.getUTCMonth() +
      months;
    const first = new Date(
      Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset, 1),
    );
    const lastDay = new Date(
      Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
    ).getUTCDate();
    next = new Date(
      Date.UTC(
        first.getUTCFullYear(),
        first.getUTCMonth(),
        Math.min(anchor.getUTCDate(), lastDay),
      ),
    );
  }
  if (next.getUTCFullYear() > 9999) return null;
  return end && next > end ? null : next;
}
