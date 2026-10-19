// Carry a bounded set of calendar filters through source records; never accept a
// caller-controlled return URL or a second property route.
export function calendarBack(params: URLSearchParams) {
  if (!params.has("calendarMonth")) return null;
  const q = new URLSearchParams();
  for (const [source, target] of [
    ["calendarMonth", "month"],
    ["calendarDay", "day"],
    ["calendarProperty", "propertyId"],
    ["calendarKind", "kind"],
    ["calendarPage", "page"],
  ])
    if (params.get(source)) q.set(target, params.get(source)!);
  return `/company/work-calendar?${q}`;
}
export function calendarSource(params: URLSearchParams, month: string) {
  const q = new URLSearchParams({ calendarMonth: month });
  for (const [source, target] of [
    ["day", "calendarDay"],
    ["propertyId", "calendarProperty"],
    ["kind", "calendarKind"],
    ["page", "calendarPage"],
  ])
    if (params.get(source)) q.set(target, params.get(source)!);
  return q;
}
