import { prospectContext } from "./prospect-context";

const keys = [
  "tenantContact",
  "tenantId",
  "tenantQ",
  "tenantAccess",
  "tenantProperty",
  "tenantRental",
  "tenantRecords",
  "tenantCursor",
  "tenantBefore",
  "tenantHistoryCursor",
  "tenantHistoryBefore",
  "tenantSection",
  "leaseListProperty",
  "leaseListStatus",
  "leaseListAttention",
  "leaseListNested",
  "leaseListApprovals",
  "leaseListQ",
  "leaseListUnit",
  "unitListQ",
  "unitListStatus",
  "unitListCursor",
];
export function leaseContext(params: URLSearchParams) {
  const context = { ...Object.fromEntries(
    keys.filter((key) => params.get(key)).map((key) => [key, params.get(key)!]),
  ), ...prospectContext(params) };
  for (const key of ["tenantCursor", "tenantBefore", "tenantHistoryCursor", "tenantHistoryBefore"])
    if (!context.tenantId || !/^[A-Za-z0-9_-]{1,512}$/.test(context[key] || "")) delete context[key];
  if (!context.tenantId || context.tenantSection !== "rentals") delete context.tenantSection;
  return context;
}
export function leasePath(id: string, context: Record<string, string> = {}) {
  const search = new URLSearchParams(context).toString();
  return (
    `/company/leases/${encodeURIComponent(id)}` + (search ? `?${search}` : "")
  );
}
export function unitListContext(params: URLSearchParams) {
  return Object.fromEntries(
    ["unitListQ", "unitListStatus", "unitListCursor"]
      .filter(key => params.get(key))
      .map(key => [key, params.get(key)!]),
  );
}
export function unitDirectoryPath(propertyId: string, params: URLSearchParams) {
  const query = new URLSearchParams();
  for (const [context, field] of [["unitListQ", "q"], ["unitListStatus", "status"], ["unitListCursor", "cursor"]])
    if (params.get(context)) query.set(field, params.get(context)!);
  return `/company/properties/${encodeURIComponent(propertyId)}/units` + (query.size ? `?${query}` : "");
}
export function leaseDirectoryPath(params: URLSearchParams) {
  const property = params.get("leaseListProperty"),
    nested = params.get("leaseListNested") === "true" && property;
  const query = new URLSearchParams();
  if (property && !nested) query.set("propertyId", property);
  if (params.get("leaseListUnit")) {
    query.set("unitId", params.get("leaseListUnit")!);
    for (const [key, value] of Object.entries(unitListContext(params)))
      query.set(key, value);
  }
  const attention = params.get("leaseListAttention"),
    status = params.get("leaseListStatus");
  if (params.get("leaseListApprovals") === "pending")
    query.set("approvals", "pending");
  else if (
    attention &&
    ["in_effect", "ending_soon", "past_end"].includes(attention)
  )
    query.set("attention", attention);
  else if (status && ["draft", "active", "ended"].includes(status))
    query.set("status", status);
  if (params.get("leaseListQ"))
    query.set("q", params.get("leaseListQ")!.slice(0, 200));
  return (
    (nested
      ? `/company/properties/${encodeURIComponent(property!)}/leases`
      : "/company/leases") + (query.size ? `?${query}` : "")
  );
}
