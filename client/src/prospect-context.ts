const fields = ["prospectId", "prospectQ", "prospectProperty", "prospectStage", "prospectDue", "prospectCursor"] as const;
const stages = ["inquiry", "tour", "application", "review", "approved", "declined", "withdrawn", "converted"];
const dues = ["overdue", "today", "upcoming"];
function bounded(value: string | null) {
  return value && value.length <= 200 && !/[\\\u0000-\u001f\u007f]/.test(value) ? value : null;
}

// Navigation context only. A marker never selects a person, links a source or
// confirms that the destination belongs to a prospect.
export function prospectContext(params: URLSearchParams): Record<string, string> {
  const id = bounded(params.get("prospectId"));
  if (!id) return {};
  const result: Record<string, string> = { prospectId: id };
  for (const key of ["prospectQ", "prospectProperty", "prospectCursor"] as const) {
    const value = bounded(params.get(key));
    if (value) result[key] = value;
  }
  const stage = params.get("prospectStage"), due = params.get("prospectDue");
  if (stage && stages.includes(stage)) result.prospectStage = stage;
  if (due && dues.includes(due)) result.prospectDue = due;
  return result;
}

export function prospectSourceContext(params: URLSearchParams, id: string): Record<string, string> {
  const source = new URLSearchParams({ prospectId: id });
  for (const [field, origin] of [["prospectQ", "q"], ["prospectProperty", "propertyId"], ["prospectStage", "stage"], ["prospectDue", "due"], ["prospectCursor", "cursor"]]) {
    if (params.get(origin)) source.set(field, params.get(origin)!);
  }
  return prospectContext(source);
}

export function prospectReturnPath(params: URLSearchParams): string | null {
  const context = prospectContext(params);
  if (!context.prospectId) return null;
  const query = new URLSearchParams();
  for (const [field, target] of [["prospectQ", "q"], ["prospectProperty", "propertyId"], ["prospectStage", "stage"], ["prospectDue", "due"], ["prospectCursor", "cursor"]]) {
    if (context[field]) query.set(target, context[field]);
  }
  query.set("prospectId", context.prospectId);
  return `/company/prospects?${query}`;
}

export function prospectHandoffPath(pathname: string): boolean {
  return /^\/company\/(?:residents(?:\/[^/]+)?|tenants\/[^/]+|leases(?:\/[^/]+(?:\/statement)?)?|rent|deposits)$/.test(pathname)
    || /^\/company\/applications(?:\/(?:new|[^/]+(?:\/(?:edit|convert))?))?$/.test(pathname)
    || /^\/company\/properties\/[^/]+\/(?:residents|leases|rent|deposits)$/.test(pathname);
}

// Callers supply a known local source path. The fallback is fixed, never a URL
// taken from a query parameter or another navigation marker.
export function withProspectContext(path: string, params: URLSearchParams): string {
  let parsed: URL;
  try { parsed = new URL(path, "https://propertyflow.invalid"); }
  catch { return "/company/prospects"; }
  if (!path.startsWith("/") || path.startsWith("//") || parsed.origin !== "https://propertyflow.invalid" || !prospectHandoffPath(parsed.pathname)) return "/company/prospects";
  for (const field of fields) parsed.searchParams.delete(field);
  for (const [field, value] of Object.entries(prospectContext(params))) parsed.searchParams.set(field, value);
  return parsed.pathname + (parsed.search ? parsed.search : "") + parsed.hash;
}
