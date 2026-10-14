import React, { Component, useEffect, useRef } from "react";
import { addReactError } from "@datadog/browser-rum-react";
import { Routes } from "@datadog/browser-rum-react/react-router-v6";
import {
  BrowserRouter,
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
  AcceptInvitation,
  Audit,
} from "./pages/Workspace";
import { Maintenance } from "./pages/Maintenance";
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
    addReactError(error, info);
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
  const main = useRef<HTMLElement>(null);
  const route = routes.find((r) => r.path === location.pathname);
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
        <nav aria-label="Main navigation">
          {visibleRoutes(data?.permissions || [])
            .filter((r) => user || r.path === "/")
            .map((r) => (
              <NavLink key={r.path} to={r.path}>
                {r.title}
              </NavLink>
            ))}
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
          <span>Property Flow / {route?.section || "Workspace"}</span>
          <span className="badge">Development</span>
        </header>
        <main ref={main} id="main" tabIndex={-1}>
          {error && user && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
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
    "/company/properties": <Properties />,
    "/company/members": <Team />,
    "/company/settings": <CompanySettings />,
    "/resident": <Resident />,
    "/resident/maintenance": <Maintenance resident />,
    "/company/maintenance": <Maintenance />,
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
            <ProtectedRoute>
              <AcceptInvitation />
            </ProtectedRoute>
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
          <Pages />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
