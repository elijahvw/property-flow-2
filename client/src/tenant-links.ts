import { prospectContext } from "./prospect-context";

function cursor(value: string | null) {
  return value && /^[A-Za-z0-9_-]{1,512}$/.test(value) ? value : null;
}

export function tenantDirectorySearch(params: URLSearchParams) {
  const next = new URLSearchParams();
  const query = params.get("q")?.slice(0, 200);
  if (query) next.set("q", query);
  if (
    ["active", "verification", "disabled", "offline", "pending"].includes(
      params.get("access") || "",
    )
  )
    next.set("access", params.get("access")!);
  if (params.get("records") === "archived") next.set("records", "archived");
  if (params.get("propertyId"))
    next.set("propertyId", params.get("propertyId")!.slice(0, 200));
  if (
    ["current", "upcoming", "draft", "former", "unassigned"].includes(
      params.get("rental") || "",
    )
  )
    next.set("rental", params.get("rental")!);
  for (const key of ["cursor", "before"]) {
    const value = cursor(params.get(key));
    if (value) next.set(key, value);
  }
  for (const [key, value] of Object.entries(prospectContext(params))) next.set(key, value);
  return next.toString();
}
function tenantDetailSearch(params: URLSearchParams) {
  const next = new URLSearchParams(tenantDirectorySearch(params));
  if (params.get("section") === "rentals") next.set("section", "rentals");
  for (const key of ["rentalCursor", "rentalBefore"]) {
    const value = cursor(params.get(key));
    if (value) next.set(key, value);
  }
  return next.toString();
}
export function tenantPath(id: string, params = new URLSearchParams()) {
  const search = tenantDetailSearch(params);
  return (
    `/company/residents/${encodeURIComponent(id)}` +
    (search ? `?${search}` : "")
  );
}
export function tenantLedgerContext(
  id: string,
  params: URLSearchParams,
  contact = false,
) {
  const directory = new URLSearchParams(tenantDirectorySearch(params));
  return {
    ...prospectContext(params),
    ...(contact ? { tenantContact: "true" } : {}),
    tenantId: id,
    ...(params.get("q") ? { tenantQ: params.get("q")! } : {}),
    ...(params.get("access") ? { tenantAccess: params.get("access")! } : {}),
    ...(params.get("propertyId")
      ? { tenantProperty: params.get("propertyId")! }
      : {}),
    ...(params.get("rental") ? { tenantRental: params.get("rental")! } : {}),
    ...(params.get("records") === "archived"
      ? { tenantRecords: "archived" }
      : {}),
    ...(directory.get("cursor") ? { tenantCursor: directory.get("cursor")! } : {}),
    ...(directory.get("before") ? { tenantBefore: directory.get("before")! } : {}),
    ...(params.get("section") === "rentals" ? { tenantSection: "rentals" } : {}),
    ...(cursor(params.get("rentalCursor")) ? { tenantHistoryCursor: params.get("rentalCursor")! } : {}),
    ...(cursor(params.get("rentalBefore")) ? { tenantHistoryBefore: params.get("rentalBefore")! } : {}),
  };
}

export function contactPath(id: string, params = new URLSearchParams()) {
  const search = tenantDetailSearch(params);
  return (
    `/company/tenants/${encodeURIComponent(id)}` + (search ? `?${search}` : "")
  );
}
