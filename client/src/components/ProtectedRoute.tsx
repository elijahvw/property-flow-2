import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Capability } from "../navigation";
export default function ProtectedRoute({
  children,
  permission,
}: {
  children: React.ReactNode;
  permission?: Capability;
}) {
  const { user, loading, error, signIn, refreshUser, can } = useAuth();
  if (loading)
    return (
      <section className="status-panel" role="status">
        Restoring your sign-in…
      </section>
    );
  if (!user || error)
    return (
      <section className="status-panel">
        <h1>{error ? "Unable to load your account" : "Sign in to continue"}</h1>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button onClick={signIn}>Sign in</button>
          <button className="secondary" onClick={() => void refreshUser()}>
            Try again
          </button>
          <Link to="/">Go home</Link>
        </div>
      </section>
    );
  if (permission && user.emailVerified === false) return <section className="status-panel"><h1>Email verification required</h1><p>Your access is set up. Verify your email to open this workspace.</p><Link to="/account">View my profile</Link></section>;
  if (permission && !can(permission))
    return (
      <section className="status-panel">
        <h1>Access unavailable</h1>
        <p>Your account does not currently have access to this page.</p>
        <Link to="/access">View account access</Link>
      </section>
    );
  return <>{children}</>;
}
