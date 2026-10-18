import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
export function propertyLink(
  path: string,
  id?: string,
  extra: Record<string, string> = {},
) {
  if (
    /^\/company\/(leases|maintenance|rent|finances|reports|deposits)$/.test(
      path,
    ) &&
    id
  ) {
    const q = new URLSearchParams(extra);
    return (
      `/company/properties/${encodeURIComponent(id)}/${path.split("/")[2]}` +
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
    location = useLocation(), navigate=useNavigate();
  const root = `/company/properties/${encodeURIComponent(id)}`;
  const tabs = [
    ["Property details", root, "property.read"],
    ["Units", root + "/units", "property.read"],
    ["Tenant access", root + "/residents", "resident.assignment.manage"],
    ["Leases", propertyLink("/company/leases", id), "lease.manage"],
    [
      "Maintenance",
      propertyLink("/company/maintenance", id),
      "maintenance.manage",
    ],
    ["Rent & balances", propertyLink("/company/rent", id), "finance.manage"],
    ["Deposits", propertyLink("/company/deposits", id), "finance.manage"],
    ["Cash activity", propertyLink("/company/finances", id), "finance.manage"],
    ["Reports", propertyLink("/company/reports", id), "finance.manage"],
  ];
  return (
    <section className="property-context" aria-label="Property workspace">
      <div className="property-context-title">
        <Link to="/company/properties">All properties</Link>
        <span aria-hidden="true">/</span>
        <strong>{name || "Property workspace"}</strong>
        {(() => {
          const module = location.pathname.split("/").pop();
          const title = tabs.find(([, to]) =>
            to.split("?")[0].endsWith("/" + module),
          )?.[0];
          return title &&
            module &&
            [
              "leases",
              "maintenance",
              "rent",
              "finances",
              "reports",
              "deposits",
            ].includes(module) ? (
            <Link to={`/company/${module}`}>
              All company {title.toLowerCase()}
            </Link>
          ) : null;
        })()}
      </div>
      <label className="context-select">Property section<select aria-label="Property section" value={tabs.some(([,path])=>path.split("?")[0]===location.pathname)?location.pathname:root} onChange={event=>navigate(event.target.value)}>{tabs.filter(([, ,p])=>can(p as Parameters<typeof can>[0])).map(([title,path])=><option key={path} value={path.split("?")[0]}>{title}</option>)}</select></label>
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
