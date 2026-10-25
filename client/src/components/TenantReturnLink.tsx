import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { tenantPath, contactPath } from "../tenant-links";
import { prospectContext } from "../prospect-context";

export function TenantReturnLink() {
  const [params] = useSearchParams();
  const { can } = useAuth();
  const id = params.get("tenantId");
  if (!id || !can("resident.assignment.manage")) return null;
  const search = new URLSearchParams({
    ...prospectContext(params),
    q: params.get("tenantQ") || "",
    access: params.get("tenantAccess") || "",
    propertyId: params.get("tenantProperty") || "",
    rental: params.get("tenantRental") || "",
    records: params.get("tenantRecords") || "",
    cursor: params.get("tenantCursor") || "",
    before: params.get("tenantBefore") || "",
    rentalCursor: params.get("tenantHistoryCursor") || "",
    rentalBefore: params.get("tenantHistoryBefore") || "",
    section: params.get("tenantSection") === "rentals" ? "rentals" : "",
  });
  return (
    <nav className="record-breadcrumb" aria-label="Tenant navigation">
      <Link
        to={
          params.get("tenantContact") === "true"
            ? contactPath(id, search)
            : tenantPath(id, search)
        }
      >
        ← Back to tenant
      </Link>
    </nav>
  );
}
