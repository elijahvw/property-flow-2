import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { tenantPath } from "../tenant-links";

export function TenantReturnLink() {
  const [params] = useSearchParams();
  const { can } = useAuth();
  const id = params.get("tenantId");
  if (!id || !can("resident.assignment.manage")) return null;
  const search = new URLSearchParams({ q: params.get("tenantQ") || "", access: params.get("tenantAccess") || "" });
  return <nav className="record-breadcrumb" aria-label="Tenant navigation"><Link to={tenantPath(id, search)}>← Back to tenant</Link></nav>;
}
