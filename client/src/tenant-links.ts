export function tenantDirectorySearch(params: URLSearchParams) {
  const next = new URLSearchParams();
  const query = params.get("q")?.slice(0, 200);
  if (query) next.set("q", query);
  if (["active", "verification", "disabled", "offline", "pending"].includes(params.get("access") || "")) next.set("access", params.get("access")!);
  if(params.get("records")==="archived")next.set("records","archived");
  return next.toString();
}
export function tenantPath(id: string, params = new URLSearchParams()) {
  const search = tenantDirectorySearch(params);
  return `/company/residents/${encodeURIComponent(id)}` + (search ? `?${search}` : "");
}
export function tenantLedgerContext(id: string, params: URLSearchParams, contact=false) {
  return { ...(contact?{tenantContact:"true"}:{}), tenantId: id, ...(params.get("q") ? { tenantQ: params.get("q")! } : {}),
    ...(params.get("access") ? { tenantAccess: params.get("access")! } : {}) };
}

export function contactPath(id:string,params=new URLSearchParams()){const search=tenantDirectorySearch(params);return `/company/tenants/${encodeURIComponent(id)}`+(search?`?${search}`:"");}
