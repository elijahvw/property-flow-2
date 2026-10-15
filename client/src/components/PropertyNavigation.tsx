import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
export function propertyLink(
  path: string,
  id?: string,
  extra: Record<string, string> = {},
) {
  if (path === "/company/leases" && id) {
    const q = new URLSearchParams(extra);
    return (
      `/company/properties/${encodeURIComponent(id)}/leases` +
      (q.size ? "?" + q : "")
    );
  }
  const q = new URLSearchParams({
    ...extra,
    ...(id ? { propertyId: id } : {}),
  });
  return path + (q.size ? "?" + q : "");
}
export function PropertyNavigation({
  id,
  name,
  external = false,
}: {
  id: string;
  name?: string;
  external?: boolean;
}) {
  return external ? (
    <PropertyTabs id={id} name={name} />
  ) : (
    <PropertyName id={id} />
  );
}
function PropertyName({ id }: { id: string }) {
  const property = useResource<{ name: string }>(
    `/api/company/properties/${encodeURIComponent(id)}`,
  );
  return (
    <>
      <PropertyTabs id={id} name={property.data?.name} />
      {property.error && (
        <p className="help" role="alert">
          {property.error}
        </p>
      )}
    </>
  );
}
function PropertyTabs({ id, name }: { id: string; name?: string }) {
  const { can } = useAuth(),
    location = useLocation();
  const root = `/company/properties/${encodeURIComponent(id)}`;
  const tabs = [
    ["Property details", root, "property.read"],
    ["Units", root + "/units", "property.read"],
    ["Residents", root + "/residents", "resident.assignment.manage"],
    ["Leases", propertyLink("/company/leases", id), "lease.manage"],
    [
      "Maintenance",
      propertyLink("/company/maintenance", id),
      "maintenance.manage",
    ],
    ["Rent & balances", propertyLink("/company/rent", id), "finance.manage"],
    ["Finances", propertyLink("/company/finances", id), "finance.manage"],
    ["Reports", propertyLink("/company/reports", id), "finance.manage"],
  ];
  return (
    <section className="property-context" aria-label="Property workspace">
      <div className="property-context-title">
        <Link to="/company/properties">All properties</Link>
        <span aria-hidden="true">/</span>
        <strong>{name || "Property workspace"}</strong>
      </div>
      <nav className="context-tabs" aria-label="Property navigation">
        {tabs
          .filter(([, , p]) => can(p as Parameters<typeof can>[0]))
          .map(([title, to]) => (
            <Link
              key={to}
              to={to}
              aria-current={
                location.pathname === to.split("?")[0] ? "page" : undefined
              }
            >
              {title}
            </Link>
          ))}
      </nav>
    </section>
  );
}
