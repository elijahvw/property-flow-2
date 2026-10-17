const fullDate = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
// Business dates are calendar days, not instants in the viewer's timezone.
export function formatDate(value: string | null | undefined, empty = "—") {
  if (!value) return empty;
  const day = value.slice(0, 10);
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(day)) return empty;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === day
    ? fullDate.format(date)
    : empty;
}
export function formatMonth(value: string | null | undefined, empty = "—") {
  if (!value) return empty;
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date)
    : empty;
}

// Activity timestamps are instants, unlike lease/target calendar dates.
export function formatActivityDate(
  value: string | null | undefined,
  empty = "—",
) {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(date)
    : empty;
}

export function formatActivityTime(
  value: string | null | undefined,
  empty = "—",
) {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(date)
    : empty;
}
