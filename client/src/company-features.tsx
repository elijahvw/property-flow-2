import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

export type FeatureKey = "properties" | "leasing" | "maintenance" | "documents" | "finances" | "reports" | "inspections" | "agreements" | "notifications" | "resident_portal";
export type FeatureMode = "enabled" | "read_only" | "disabled";
export type CompanyFeatures = Record<FeatureKey, FeatureMode>;

export function featureKeysForPage(path: string, role?: string): FeatureKey[] {
  if (path === "/account/notifications") return role === "resident" ? ["notifications", "resident_portal"] : ["notifications"];
  if (!/^\/(?:company|resident)(?:\/|$)/.test(path)) return [];
  const resident = /^\/resident(?:\/|$)/.test(path);
  const area = path.replace(/^\/(?:company|resident)/, "");
  if (!resident && /^\/(?:subscription|settings|members)(?:\/|$)/.test(area)) return [];
  const dependencies: FeatureKey[] = resident ? ["resident_portal"] : [];
  const result = (...features: FeatureKey[]) => [...features, ...dependencies];
  if (/^\/availability(?:\/|$)/.test(area)) return result("leasing", "properties");
  if (/^\/imports\/units(?:\/|$)/.test(area)) return result("properties");
  if (/^\/imports\/expenses(?:\/|$)/.test(area)) return result("finances", "leasing", "properties");
  if (/^\/prospects(?:\/|$)/.test(area)) return result("leasing", "properties");
  if (/^\/applications(?:\/|$)/.test(area)) return result("leasing", "properties");
  if (/^\/drafts(?:\/|$)/.test(area)) return result("leasing");
  if (/\/statement(?:\/|$)/.test(area) || /\/(?:rent|finances|deposits|settlement|terms)(?:\/|$)/.test(area)) return result("finances", "leasing");
  if (/\/reports(?:\/|$)/.test(area)) return result("reports", "finances");
  if (/\/documents(?:\/|$)/.test(area)) return resident ? result("documents", "leasing") : result("documents");
  if (/\/(?:maintenance|work-orders|vendors|preventive|work-calendar)(?:\/|$)/.test(area)) return result("maintenance");
  if (/\/(?:leases|tenants|residents)(?:\/|$)/.test(area)) return result("leasing");
  return resident ? ["resident_portal"] : ["properties"];
}

export function availableFeatureRoute(path: string, policy?: CompanyFeatures | null, role?: string) {
  return !policy || featureKeysForPage(path, role).every(key => policy[key] !== "disabled");
}

export function CompanyFeatureBoundary({ children }: { children: ReactNode }) {
  const { data, can } = useAuth();
  const { pathname } = useLocation();
  if (!availableFeatureRoute(pathname, data?.companyFeatures, data?.membership?.role)) return <section className="status-panel">
    <h1>Feature unavailable</h1>
    <p>This area is disabled for your company. Your existing records are retained. Contact the platform owner to review feature access.</p>
    {can("subscription.read") && <Link to="/company/subscription">View company plan and billing</Link>}
  </section>;
  const readOnly = data?.companyFeatures && featureKeysForPage(pathname, data.membership?.role).some(key => data.companyFeatures![key] === "read_only");
  return <>{readOnly && <p className="notice" role="status">This area is read-only under your company’s current access settings. {can("subscription.read") && <Link to="/company/subscription">Review company plan and billing</Link>}</p>}{children}</>;
}
