import { NotificationBell, NotificationReturnLink } from "./components/NotificationNavigation";
import { EditorNavigationProvider } from "./components/PageLeaveGuard";
import { ContextHelp } from "./components/ContextHelp";
import { WorkspaceGuide } from "./components/WorkspaceGuide";
import { recordBrowserEvent } from "./browser-telemetry";
import React, { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  createBrowserRouter,
  RouterProvider,
  Routes,
  Route,
  Link,
  Navigate,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import { routes, visibleRoutes, pageContext, navigationActive } from "./navigation";
import { PropertySearch } from "./components/PropertySearch";
import { FeedbackProvider } from "./components/Feedback";
import { NavigationIcon } from "./components/NavigationIcon";
import { EmailVerification } from "./components/EmailVerification";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
import { ProspectReturnLink } from "./components/ProspectReturnLink";
import { availableFeatureRoute, CompanyFeatureBoundary } from "./company-features";
import "./App.css";

const Notifications = lazy(() => import("./pages/Notifications").then(module=>({default:module.Notifications})));
const SavedDrafts = lazy(() => import("./pages/SavedDrafts").then(module=>({default:module.SavedDrafts})));
const RentalApplications = lazy(() => import("./pages/RentalApplications").then(module=>({default:module.RentalApplications})));
const PlatformPlans = lazy(() => import("./pages/PlatformPlans").then(module=>({default:module.PlatformPlans})));
const CompanySubscription = lazy(() => import("./components/CompanySubscription").then(module=>({default:module.CompanySubscriptionPage})));
const Impersonation = lazy(() => import("./pages/Impersonation").then(module=>({default:module.Impersonation})));
const Help = lazy(() => import("./pages/Help").then(module=>({default:module.Help})));
const Companies = lazy(() => import("./pages/Workspace").then(module => ({ default: module.Companies })));
const CompanyDetail = lazy(() => import("./pages/Workspace").then(module => ({ default: module.CompanyDetail })));
const People = lazy(() => import("./pages/Workspace").then(module => ({ default: module.People })));
const Properties = lazy(() => import("./pages/Workspace").then(module => ({ default: module.Properties })));
const Team = lazy(() => import("./pages/Workspace").then(module => ({ default: module.Team })));
const CompanySettings = lazy(() => import("./pages/Workspace").then(module => ({ default: module.CompanySettings })));
const Account = lazy(() => import("./pages/Workspace").then(module => ({ default: module.Account })));
const AccessStatus = lazy(() => import("./pages/Workspace").then(module => ({ default: module.AccessStatus })));
const Resident = lazy(() => import("./pages/Workspace").then(module => ({ default: module.Resident })));
const Audit = lazy(() => import("./pages/Workspace").then(module => ({ default: module.Audit })));
const Overview = lazy(() => import("./pages/Overview").then(module => ({ default: module.Overview })));
const PropertyResidents = lazy(() => import("./pages/PropertyResidents").then(module => ({ default: module.PropertyResidents })));
const Reports = lazy(() => import("./pages/Reports").then(module => ({ default: module.Reports })));
const Availability = lazy(() => import("./pages/Availability").then(module => ({ default: module.Availability })));
const UnitImports = lazy(() => import("./pages/UnitImports").then(module => ({ default: module.UnitImports })));
const Prospects = lazy(() => import("./pages/Prospects").then(module => ({ default: module.Prospects })));
const SharedDocuments = lazy(() => import("./pages/SharedDocuments").then(module => ({ default: module.SharedDocuments })));
const ExpenseImports = lazy(() => import("./pages/ExpenseImports").then(module => ({ default: module.ExpenseImports })));
const Statement = lazy(() => import("./pages/Statement").then(module => ({ default: module.Statement })));
const ResidentProfiles = lazy(() => import("./pages/ResidentProfiles").then(module => ({ default: module.ResidentProfiles })));
const ResidentDetail = lazy(() => import("./pages/ResidentDetail").then(module => ({ default: module.ResidentDetail })));
const ContactDetail = lazy(() => import("./pages/ContactDetail").then(module => ({ default: module.ContactDetail })));
const WorkOrders = lazy(() => import("./pages/WorkOrders").then(module => ({default:module.WorkOrders})));
const AssignedWorkDetail = lazy(() => import("./pages/WorkOrders").then(module => ({default:module.AssignedWorkDetail})));
const DocumentLibrary = lazy(() => import("./pages/DocumentLibrary").then(module=>({default:module.DocumentLibrary})));
const WorkCalendar = lazy(() => import("./pages/WorkCalendar").then(module=>({default:module.WorkCalendar})));
const Preventive = lazy(() => import("./pages/Preventive").then(module=>({default:module.Preventive})));
const Vendors = lazy(() => import("./pages/Vendors").then(module=>({default:module.Vendors})));
const Maintenance = lazy(() => import("./pages/Maintenance").then(module => ({ default: module.Maintenance })));
const MaintenanceRequestDetail = lazy(() => import("./pages/Maintenance").then(module => ({ default: module.MaintenanceRequestDetail })));
const Deposits = lazy(() => import("./pages/Deposits").then(module => ({ default: module.Deposits })));
const Rent = lazy(() => import("./pages/Rent").then(module => ({ default: module.Rent })));
const Finances = lazy(() => import("./pages/Finances").then(module => ({ default: module.Finances })));
const Units = lazy(() => import("./pages/Leasing").then(module => ({ default: module.Units })));
const Leases = lazy(() => import("./pages/Leasing").then(module => ({ default: module.Leases })));
const LeaseDetail = lazy(() => import("./pages/LeaseDetail").then(module => ({ default: module.LeaseDetail })));
const InvitationEntry = lazy(() => import("./components/ContactInvitation").then(module => ({ default: module.InvitationEntry })));
const ResidentLeaseTerms = lazy(() => import("./components/LeaseTermChanges").then(module => ({ default: module.ResidentLeaseTerms })));
const ResidentSettlement = lazy(() => import("./components/LeaseSettlement").then(module => ({ default: module.ResidentSettlement })));
const PropertyDetail = lazy(() => import("./pages/PropertyDetail"));

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    recordBrowserEvent('browser.render');
    if (import.meta.env.VITE_RUM_ENABLED === 'true') {
      void import('./rum').then(({ recordRumRenderError }) => recordRumRenderError()).catch(() => {});
    }
  }
  render() {
    return this.state.failed ? (
      <section className="status-panel">
        <h1>Something went wrong</h1>
        <p>Please reload this page to continue.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </section>
    ) : (
      this.props.children
    );
  }
}
function Shell({ children }: { children: React.ReactNode }) {
  const { data, user, signIn, signOut, error } = useAuth();
  const location = useLocation();
  const companyRoleLabel=({owner:"Company owner",manager:"Manager",staff:"Staff",resident:"Resident"} as Record<string,string>)[data?.membership?.role||""];
  const platformWorkspace=location.pathname.startsWith("/platform")||!data?.membership;
  const [menuOpen, setMenuOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const route = pageContext(location.pathname, location.search);
  const navigationType = useNavigationType();
  useEffect(() => {
    document.title = `${route.title} · Property Flow`;
  }, [route.title]);
  useEffect(() => {
    setMenuOpen(false);
    if (navigationType !== "POP") window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    // Dialogs restore their opener as they close. Wait for that handoff and
    // lazy content, then move keyboard focus to the destination heading.
    // A later user interaction cancels this work so slow loads cannot steal it.
    const content = main.current;
    if (!content) return;
    let frame = 0, stopped = false, focusedMain = false;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointerdown", stop, true);
      document.removeEventListener("keydown", stop, true);
      document.removeEventListener("input", stop, true);
      document.removeEventListener("change", stop, true);
    };
    const focusHeading = () => {
      frame = 0;
      if (stopped || document.querySelector("dialog[open]")) return;
      if (!focusedMain) {
        content.focus({ preventScroll: true });
        focusedMain = true;
      }
      const heading = Array.from(content.querySelectorAll<HTMLElement>("h1"))
        .find(node => node.getClientRects().length > 0);
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      if (document.activeElement === heading) stop();
    };
    const schedule = () => {
      if (stopped || frame) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(focusHeading);
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["open", "style", "hidden"],
    });
    document.addEventListener("pointerdown", stop, true);
    document.addEventListener("keydown", stop, true);
    document.addEventListener("input", stop, true);
    document.addEventListener("change", stop, true);
    schedule();
    return stop;
  }, [location.pathname]);
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" to={user ? "/dashboard" : "/"}>
          <span className="brand-mark">P</span>Property Flow
        </Link>
        <p className="workspace-label">
          {platformWorkspace&&(user?.platformRole === "owner" || user?.platformRole === "support")
            ? "Platform workspace"
            : data?.membership?.company.name || "Your workspace"}
        </p>
        <button
          className="mobile-menu-toggle secondary"
          aria-expanded={menuOpen}
          aria-controls="workspace-navigation"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? "Close menu" : "Menu"}
        </button>
        <nav
          id="workspace-navigation"
          className={`nav-sections ${menuOpen ? "expanded" : ""}`}
          aria-label="Main navigation"
        >
          {[
            "Workspace",
            "Operations",
            "Finance",
            "Administration",
            "Account",
          ].map((group) => {
            const links = visibleRoutes(data?.permissions || []).filter(r => availableFeatureRoute(r.path, data?.companyFeatures, data?.membership?.role)).filter((r) => {
              const section =
                r.path.startsWith("/platform/") ||
                /members|settings/.test(r.path)
                  ? "Administration"
                  : r.section === "Account"
                    ? "Account"
                    : /finances|reports|rent|deposits|imports\/expenses/.test(r.path)
                      ? "Finance"
                      : /leases|maintenance|work-orders|documents|availability|prospects|applications|drafts/.test(r.path)
                        ? "Operations"
                        : "Workspace";
              return section === group;
            });
            return links.length ? (
              <div className="nav-group" key={group}>
                <p>{group}</p>
                {links.map((r) => (
                  <Link
                    key={r.path}
                    to={r.path}
                    className={navigationActive(r.path, location.pathname) ? "active" : undefined}
                    aria-current={navigationActive(r.path, location.pathname) ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <NavigationIcon path={r.path} />
                    {r.title}
                  </Link>
                ))}
              </div>
            ) : null;
          })}
        </nav>
        <div className={`sidebar-footer ${menuOpen ? "expanded" : ""}`}>
          {user ? (
            <>
              <strong>{user.name || user.email}</strong>
              <span>
                {platformWorkspace&&(user.platformRole === "owner" || user.platformRole === "support")
                  ? user.platformRole === "support" ? "Platform support" : "Platform owner"
                  : companyRoleLabel || "Access pending"}
              </span>
              <button className="secondary" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <button onClick={signIn}>Sign in</button>
          )}
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <nav className="topbar-location" aria-label="Breadcrumb">
            {data?.permissions.includes("property.read") ? (
              <Link to="/company/overview">Workspace</Link>
            ) : (
              <span>Property Flow</span>
            )}
            <span aria-hidden="true">/</span>
            {route.parent && <><Link to={route.parent.path}>{route.parent.title}</Link><span aria-hidden="true">/</span></>}
            <span aria-current="page">{route.title}</span>
          </nav>
          {data?.permissions.includes("property.read") && availableFeatureRoute("/company/properties", data.companyFeatures) && <PropertySearch />}
          {data?.permissions.includes("notification.read") && availableFeatureRoute("/account/notifications", data.companyFeatures, data.membership?.role) && <NotificationBell/>}
          <ContextHelp/>
          <span className="badge">Development</span>
        </header>
        <main ref={main} id="main" tabIndex={-1}>
          {error && user && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <NotificationReturnLink/>
          <ProspectReturnLink/>
          <EmailVerification />
          <Suspense fallback={<section className="status-panel" role="status">Loading workspace…</section>}><CompanyFeatureBoundary>{children}</CompanyFeatureBoundary></Suspense>
        </main>
        <footer className="app-footer">
          Property Flow · A clearer place to manage your properties
        </footer>
      </div>
    </div>
  );
}
function Destination() {
  const { data } = useAuth();
  return <Navigate to={data?.destination || "/access"} replace />;
}
function Home() {
  const { user, signIn, switchAccount } = useAuth();
  const failed = new URLSearchParams(window.location.search).has("authError");
  return (
    <div className="landing">
      <Link className="brand" to="/">
        <span className="brand-mark">P</span>Property Flow
      </Link>
      <section className="landing-content">
        <p className="eyebrow">Your property workspace</p>
        <h1>
          Less friction.
          <br />
          More clarity.
        </h1>
        <p>
          Bring your companies, people and properties together in one organized
          workspace.
        </p>
        {failed && (
          <p className="notice error" role="alert">
            Sign-in could not be completed. Use the sign-in method associated
            with your invitation, or try a different account.
          </p>
        )}
        {user ? (
          <Link className="button" to="/dashboard">
            Open workspace
          </Link>
        ) : (
          <button onClick={signIn}>Sign in to Property Flow</button>
        )}
        {failed && !user && <button className="secondary" onClick={switchAccount}>Use a different account</button>}
        <p><Link to="/help/invitations">Sign-in and invitation help</Link></p>
      </section>
    </div>
  );
}
function Pages() {
  const rumLocation = useLocation();
  useEffect(() => {
    if (import.meta.env.VITE_RUM_ENABLED === 'true') {
      void import('./rum').then(({ recordRumView }) => recordRumView(rumLocation.pathname)).catch(() => {});
    }
  }, [rumLocation.pathname]);
  const pages: Record<string, React.ReactNode> = {
    "/platform/companies": <Companies />,
    "/platform/plans": <PlatformPlans />,
    "/company/subscription": <CompanySubscription />,
    "/platform/users": <People />,
    "/platform/audit": <Audit />,
    "/platform/impersonation": <Impersonation />,
    "/company/overview": <Overview />,
    "/company/properties": <Properties />,
    "/company/members": <Team />,
    "/company/residents": <ResidentProfiles />,
    "/company/settings": <CompanySettings />,
    "/resident": <Resident />,
    "/resident/maintenance": <Maintenance resident />,
    "/company/maintenance": <Maintenance />,
    "/company/documents": <DocumentLibrary/>,
    "/company/work-orders": <WorkOrders />,
    "/company/leases": <Leases />,
    "/company/finances": <Finances />,
    "/company/rent": <Rent />,
    "/company/deposits": <Deposits />,
    "/resident/deposits": <Deposits resident />,
    "/resident/rent": <Rent resident />,
    "/company/reports": <Reports />,
    "/company/availability": <Availability />,
    "/company/imports/units": <UnitImports />,
    "/company/prospects": <Prospects />,
    "/company/applications": <RentalApplications />,
    "/company/drafts": <SavedDrafts />,
    "/resident/documents": <SharedDocuments />,
    "/company/imports/expenses": <ExpenseImports />,
    "/account/notifications": <Notifications/>,
    "/account": <Account />,
    "/help": <Help/>,
  };
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {["new", ":applicationId", ":applicationId/edit", ":applicationId/convert"].map(path => (
        <Route key={path} path={`/company/applications/${path}`} element={<Shell><ProtectedRoute permission="lease.manage"><RentalApplications /></ProtectedRoute></Shell>} />
      ))}
      <Route path="/company/work-calendar" element={<Shell><ProtectedRoute permission="maintenance.manage"><WorkCalendar/></ProtectedRoute></Shell>}/>
      <Route path="/company/preventive" element={<Shell><ProtectedRoute permission="maintenance.manage"><Preventive/></ProtectedRoute></Shell>}/>
      <Route path="/company/preventive/:planId" element={<Shell><ProtectedRoute permission="maintenance.manage"><Preventive/></ProtectedRoute></Shell>}/>
      <Route path="/company/vendors" element={<Shell><ProtectedRoute permission="maintenance.manage"><Vendors/></ProtectedRoute></Shell>}/>
      <Route path="/company/vendors/:vendorId" element={<Shell><ProtectedRoute permission="maintenance.manage"><Vendors/></ProtectedRoute></Shell>}/>
      <Route path="/help/:articleId" element={<Shell><Help/></Shell>}/>
      {routes.map((r) => (
        <Route
          key={r.path}
          path={r.path}
          element={
            <Shell>
              {r.path === "/help" ? pages[r.path] : <ProtectedRoute permission={r.permission}>{pages[r.path]}</ProtectedRoute>}
            </Shell>
          }
        />
      ))}
      <Route
        path="/company/maintenance/:requestId"
        element={
          <Shell>
            <ProtectedRoute permission="maintenance.manage">
              <MaintenanceRequestDetail />
            </ProtectedRoute>
          </Shell>
        }
      />
      <Route
        path="/resident/maintenance/:requestId"
        element={
          <Shell>
            <ProtectedRoute permission="resident.self">
              <MaintenanceRequestDetail resident />
            </ProtectedRoute>
          </Shell>
        }
      />
      <Route
        path="/company/leases/:leaseId"
        element={<Shell><ProtectedRoute permission="lease.manage"><LeaseDetail /></ProtectedRoute></Shell>}
      />
      <Route path="/company/work-orders/:requestId" element={<Shell><ProtectedRoute permission="maintenance.execute"><AssignedWorkDetail /></ProtectedRoute></Shell>} />
      <Route path="/company/leases/:leaseId/statement" element={<Shell><ProtectedRoute permission="finance.manage"><Statement /></ProtectedRoute></Shell>} />
      <Route path="/resident/leases/:leaseId/terms" element={<Shell><ProtectedRoute permission="resident.self"><ResidentLeaseTerms/></ProtectedRoute></Shell>}/>
      <Route path="/resident/leases/:leaseId/settlement" element={<Shell><ProtectedRoute permission="resident.self"><ResidentSettlement /></ProtectedRoute></Shell>} />
      <Route path="/resident/leases/:leaseId/statement" element={<Shell><ProtectedRoute permission="resident.self"><Statement resident /></ProtectedRoute></Shell>} />
      <Route path="/company/tenants/:contactId" element={<Shell><ProtectedRoute permission="resident.assignment.manage"><ContactDetail /></ProtectedRoute></Shell>} />
      <Route
        path="/company/residents/:userId"
        element={<Shell><ProtectedRoute permission="resident.assignment.manage"><ResidentDetail /></ProtectedRoute></Shell>}
      />
      <Route
        path="/company/properties/:propertyId/residents"
        element={
          <Shell>
            <ProtectedRoute permission="resident.assignment.manage">
              <PropertyResidents />
            </ProtectedRoute>
          </Shell>
        }
      />
      <Route
        path="/company/properties/:propertyId/leases"
        element={
          <Shell>
            <ProtectedRoute permission="lease.manage">
              <Leases />
            </ProtectedRoute>
          </Shell>
        }
      />
      {[
        ["maintenance", "maintenance.manage", <Maintenance />],
        ["rent", "finance.manage", <Rent />],
        ["finances", "finance.manage", <Finances />],
        ["reports", "finance.manage", <Reports />],
        ["deposits", "finance.manage", <Deposits />],
      ].map(([module, permission, element]) => (
        <Route
          key={String(module)}
          path={`/company/properties/:propertyId/${module}`}
          element={
            <Shell>
              <ProtectedRoute
                permission={permission as import("./navigation").Capability}
              >
                {element}
              </ProtectedRoute>
            </Shell>
          }
        />
      ))}
      <Route
        path="/company/properties/:propertyId/units"
        element={
          <Shell>
            <ProtectedRoute permission="property.read">
              <Units />
            </ProtectedRoute>
          </Shell>
        }
      />
      <Route
        path="/company/properties/:propertyId"
        element={
          <Shell>
            <ProtectedRoute permission="property.read">
              <PropertyDetail />
            </ProtectedRoute>
          </Shell>
        }
      />
      <Route
        path="/platform/companies/:companyId"
        element={
          <Shell>
            <ProtectedRoute permission="platform.manage">
              <CompanyDetail />
            </ProtectedRoute>
          </Shell>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Shell>
            <ProtectedRoute>
              <Destination />
            </ProtectedRoute>
          </Shell>
        }
      />
      <Route
        path="/access"
        element={
          <Shell>
            <ProtectedRoute>
              <AccessStatus />
            </ProtectedRoute>
          </Shell>
        }
      />
      <Route
        path="/invite"
        element={
          <Shell>
            <InvitationEntry />
          </Shell>
        }
      />
      <Route
        path="/admin"
        element={<Navigate to="/platform/companies" replace />}
      />
      <Route
        path="/properties"
        element={<Navigate to="/company/properties" replace />}
      />
      <Route
        path="*"
        element={
          <Shell>
            <section className="status-panel">
              <h1>Page not found</h1>
              <p>This address does not match an available page.</p>
              <Link to="/dashboard">Open workspace</Link>
            </section>
          </Shell>
        }
      />
    </Routes>
  );
}
function WorkspaceRoot() {
  return (
    <ErrorBoundary>
      <EditorNavigationProvider>
        <AuthProvider>
          <FeedbackProvider>
            <ImpersonationBanner/>
            <Pages />
            <WorkspaceGuide/>
          </FeedbackProvider>
        </AuthProvider>
      </EditorNavigationProvider>
    </ErrorBoundary>
  );
}
const workspaceRouter = createBrowserRouter([{ path: "*", element: <WorkspaceRoot /> }]);
export default function App() {
  return <RouterProvider router={workspaceRouter} useTransitions={false} />;
}
