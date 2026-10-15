export function tenantDirectorySearch(params: URLSearchParams) {
  const next = new URLSearchParams();
  const query = params.get("q")?.slice(0, 200);
  if (query) next.set("q", query);
  if (["active", "disabled"].includes(params.get("access") || "")) next.set("access", params.get("access")!);
  return next.toString();
}
export function tenantPath(id: string, params = new URLSearchParams()) {
  const search = tenantDirectorySearch(params);
  return `/company/residents/${encodeURIComponent(id)}` + (search ? `?${search}` : "");
}
export function tenantLedgerContext(id: string, params: URLSearchParams) {
  return { tenantId: id, ...(params.get("q") ? { tenantQ: params.get("q")! } : {}),
    ...(params.get("access") ? { tenantAccess: params.get("access")! } : {}) };
}
