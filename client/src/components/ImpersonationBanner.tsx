import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { formatActivityTime } from "../dates";
import { openSupportSession, impersonationRole } from "../impersonation";
import { monitorOperation } from "../operations";

export function ImpersonationBanner() {
  const { data } = useAuth();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!data?.impersonation) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data?.impersonation?.contextId]);
  if (!data?.impersonation) return null;
  const expired = new Date(data.impersonation.expiresAt).getTime() <= now;
  const unavailable = expired || data.impersonation.unavailable;
  async function stop() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await monitorOperation("impersonation.stop", () => api<{ destination: string }>("/api/impersonation", { method: "DELETE" }));
      openSupportSession(result.destination);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Impersonation could not end. Try again.");
      setBusy(false);
    }
  }
  return <section className="impersonation-banner" aria-label="Impersonation session">
    <div><strong>{expired ? "Impersonation session expired" : unavailable ? "Impersonation is no longer available" : "Read-only impersonation"}</strong>
      <p>Viewing <strong>{data.user.name || data.user.email}</strong> · {impersonationRole({ ...data.user, membership: data.membership })} · {data.membership?.company.name || "No company assigned"}</p>
      <p className="help">Signed in as {data.impersonation.actor.name || data.impersonation.actor.email}. Changes are disabled. {unavailable ? "Return to your account to continue." : `Expires ${formatActivityTime(data.impersonation.expiresAt)}.`}</p>
      {error && <p role="alert">{error}</p>}
    </div>
    <button disabled={busy} onClick={() => void stop()}>{busy ? "Ending session…" : "Return to my account"}</button>
  </section>;
}
