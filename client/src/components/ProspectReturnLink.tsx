import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { availableFeatureRoute } from "../company-features";
import { prospectHandoffPath, prospectReturnPath } from "../prospect-context";

export function ProspectReturnLink() {
  const { pathname } = useLocation(), [params] = useSearchParams();
  const { data, can } = useAuth();
  const href = prospectReturnPath(params);
  if (!href || !prospectHandoffPath(pathname) || !can("lease.manage") || !availableFeatureRoute("/company/prospects", data?.companyFeatures, data?.membership?.role)) return null;
  return <nav className="record-breadcrumb" aria-label="Prospect navigation"><Link to={href}>← Back to prospect</Link></nav>;
}
