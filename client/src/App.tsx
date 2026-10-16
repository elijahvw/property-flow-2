import { InvitationEntry } from "./components/ContactInvitation";
import { ContactDetail } from "./pages/ContactDetail";
import { recordBrowserEvent } from "./browser-telemetry";
import React, { Component, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  NavLink,
  Navigate,
  useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import { routes, visibleRoutes } from "./navigation";
import {
  Companies,
  CompanyDetail,
  People,
  Properties,
  Team,
  CompanySettings,
  Account,
  AccessStatus,
  Resident,
  Audit,
} from "./pages/Workspace";
import { Overview } from "./pages/Overview";
import { PropertyResidents } from "./pages/PropertyResidents";
import { PropertySearch } from "./components/PropertySearch";
import { FeedbackProvider } from "./components/Feedback";
import { Reports } from "./pages/Reports";
import { NavigationIcon } from "./components/NavigationIcon";
import { ResidentProfiles } from "./pages/ResidentProfiles";
import { ResidentDetail } from "./pages/ResidentDetail";
import { Maintenance } from "./pages/Maintenance";
import { Deposits } from "./pages/Deposits";
import { Rent } from "./pages/Rent";
import { Finances } from "./pages/Finances";
import { EmailVerification } from "./components/EmailVerification";
import { Units, Leases } from "./pages/Leasing";
import { LeaseDetail } from "./pages/LeaseDetail";
import PropertyDetail from "./pages/PropertyDetail";
import "./App.css";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const main = useRef<HTMLElement>(null);
  const route =
    routes.find((r) => r.path === location.pathname) ||
    (location.pathname.startsWith("/company/properties/")
      ? routes.find((r) => r.path === "/company/properties")
      : (location.pathname.startsWith("/company/residents/")||location.pathname.startsWith("/company/tenants/"))
        ? routes.find((r) => r.path === "/company/residents")
        : location.pathname.startsWith("/company/leases/")
          ? routes.find((r) => r.path === "/company/leases")
      : undefined);
  useEffect(() => {
    document.title = `${route?.title || "Property Flow"} · Property Flow`;
    main.current?.focus();
  }, [location.pathname, route?.title]);
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
          {user?.platformRole === "owner"
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
            "Money",
            "Administration",
            "Account",
          ].map((group) => {
            const links = visibleRoutes(data?.permissions || []).filter((r) => {
              const section =
                r.path.startsWith("/platform/") ||
                /members|settings/.test(r.path)
                  ? "Administration"
                  : r.path === "/account"
                    ? "Account"
                    : /finances|reports|rent|deposits/.test(r.path)
                      ? "Money"
                      : /leases|maintenance/.test(r.path)
                        ? "Operations"
                        : "Workspace";
              return section === group;
            });
            return links.length ? (
              <div className="nav-group" key={group}>
                <p>{group}</p>
                {links.map((r) => (
                  <NavLink
                    key={r.path}
                    to={r.path}
                    className={({isActive})=>isActive||(r.path==="/company/residents"&&location.pathname.startsWith("/company/tenants/"))?"active":undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    <NavigationIcon path={r.path} />
                    {r.title}
                  </NavLink>
                ))}
              </div>
            ) : null;
          })}
        </nav>
        <div className="sidebar-footer">
          {user ? (
            <>
              <strong>{user.name || user.email}</strong>
              <span>
                {user.platformRole === "owner"
                  ? "Platform owner"
                  : data?.membership?.role || "Access pending"}
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
          <div className="topbar-location">
            {data?.permissions.includes("property.read") ? (
              <Link to="/company/overview">Workspace</Link>
            ) : (
              <span>Property Flow</span>
            )}
            <span aria-hidden="true">/</span>
            <span>{route?.title || route?.section || "Workspace"}</span>
          </div>
          {data?.permissions.includes("property.read") && <PropertySearch />}
          <span className="badge">Development</span>
        </header>
        <main ref={main} id="main" tabIndex={-1}>
          {error && user && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <EmailVerification />
          {children}
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
  const { user, signIn } = useAuth();
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
            Sign-in could not be completed. Try again, or contact your
            administrator.
          </p>
        )}
        {user ? (
          <Link className="button" to="/dashboard">
            Open workspace
          </Link>
        ) : (
          <button onClick={signIn}>Sign in to Property Flow</button>
        )}
      </section>
    </div>
  );
}
function Pages() {
  const pages: Record<string, React.ReactNode> = {
    "/platform/companies": <Companies />,
    "/platform/users": <People />,
    "/platform/audit": <Audit />,
    "/company/overview": <Overview />,
    "/company/properties": <Properties />,
    "/company/members": <Team />,
    "/company/residents": <ResidentProfiles />,
    "/company/settings": <CompanySettings />,
    "/resident": <Resident />,
    "/resident/maintenance": <Maintenance resident />,
    "/company/maintenance": <Maintenance />,
    "/company/leases": <Leases />,
    "/company/finances": <Finances />,
    "/company/rent": <Rent />,
    "/company/deposits": <Deposits />,
    "/resident/deposits": <Deposits resident />,
    "/resident/rent": <Rent resident />,
    "/company/reports": <Reports />,
    "/account": <Account />,
  };
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {routes.map((r) => (
        <Route
          key={r.path}
          path={r.path}
          element={
            <Shell>
              <ProtectedRoute permission={r.permission}>
                {pages[r.path]}
              </ProtectedRoute>
            </Shell>
          }
        />
      ))}
      <Route
        path="/company/leases/:leaseId"
        element={<Shell><ProtectedRoute permission="lease.manage"><LeaseDetail /></ProtectedRoute></Shell>}
      />
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
export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <FeedbackProvider>
            <Pages />
          </FeedbackProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
