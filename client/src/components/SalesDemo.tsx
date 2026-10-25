import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useResource } from "../useResource";
import { Form } from "./Form";

type Demo = { id: string; companyId: string; ownerId: string; status: string; version: number; seedVersion: number; createdAt: string; company: { name: string; status: string }; owner: { email: string; name: string | null }; setup: { id: string; status: string } | null };
type Setup = { id: string; status: string; createdAt: string; accountsPrepared: number };
type LoginSheet = { id: string; credentials: { role: string; name: string; email: string; password: string }[] };
export function SalesDemo({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
  return <section className="panel" aria-labelledby="sales-demo-title">
    <h2 id="sales-demo-title">Sales demo</h2>
    <p>Manage an isolated fictional portfolio for sales presentations.</p>
    <button onClick={() => setOpen(true)} disabled={open}>Manage sales demos</button>
    {open && <SalesDemoControls onChange={onChange} />}
  </section>;
}
function SalesDemoControls({ onChange }: { onChange: () => void }) {
  const demos = useResource<{ seedVersion: number; items: Demo[]; setups: Setup[] }>("/api/platform/sales-demos", true, true);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [retiring, setRetiring] = useState<string | null>(null);
  const [logins, setLogins] = useState<LoginSheet | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);
  const refresh = () => { demos.reload(); onChange(); };
  const present = (sheet: LoginSheet) => { setLogins(sheet); setShowPasswords(false); };
  const teardown = (id: string, expectedVersion: number, automatic: boolean) => retiring === id ? <div>
    <p>{automatic ? "Tear down this demo and disable all its generated logins?" : "Retire this older demo and release its existing presenter account?"} Its company will be suspended and sessions revoked. Source records and audit history are retained.</p>
    <Form label="Confirm teardown" operation="sales_demo.teardown" successText="Demo torn down." submit={async () => {
      setLogins(null);
      try { await api(`/api/platform/sales-demos/${id}/teardown`, { method: "POST", body: { expectedVersion }, timeoutMs: 180000 }); setRetiring(null); }
      finally { refresh(); }
    }}><button type="button" onClick={() => setRetiring(null)}>Cancel</button></Form>
  </div> : <button onClick={() => setRetiring(id)}>{automatic ? "Tear down demo" : "Retire older demo"}</button>;
  return <div>
    <p>Build the linked portfolio and its owner, manager, staff, resident and occupant accounts automatically. Email and generated passwords appear here when setup finishes. Demo logins are already verified; no verification email or manual account setup is needed.</p>
    <p>Examples include a tenant without portal access, a pending invitation, active and ended leases, move-out/refund history, partial and unpaid rent, archived records, document sharing and import validation. Those non-portal tenant records have no issued login credentials.</p>
    <Form key={key} label="Build sales demo" operation="sales_demo.create" successText="Sales demo and role logins created." submit={async () => {
      setLogins(null);
      try {
        present(await api<LoginSheet>("/api/platform/sales-demos", { method: "POST", body: { submissionKey: key }, timeoutMs: 180000 }));
        setKey(crypto.randomUUID());
      } finally { refresh(); }
    }}><p className="help">Setup can take a few minutes. Brief identity-service rate limits are retried automatically. If interrupted, retry this submission or resume below to continue from saved progress. Each new demo gets separate accounts and passwords.</p></Form>
    {logins && <section aria-label="Demo login credentials" className="panel">
      <h3>Demo login credentials</h3>
      <p>Use these accounts on the normal sign-in screen. Keep the passwords private; teardown disables them. Passwords stay hidden until you choose to show them.</p>
      <button onClick={() => setShowPasswords(v => !v)}>{showPasswords ? "Hide passwords" : "Show passwords"}</button>
      <button onClick={() => setLogins(null)}>Close credentials</button>
      <p><a href="/api/auth/login?switchAccount=1">Sign in with a demo account</a></p>
      <ul>{logins.credentials.map(c => <li key={c.email}>
        <p><strong>{c.role}</strong> · {c.name}</p>
        <label>{c.name} email<input value={c.email} readOnly autoComplete="off" /></label>
        <label>{c.name} password<input type={showPasswords ? "text" : "password"} value={c.password} readOnly autoComplete="off" /></label>
      </li>)}</ul>
    </section>}
    {demos.error && <div role="alert">{demos.error} <button onClick={demos.reload}>Retry demo list</button></div>}
    {!demos.data ? <p role="status">Loading demos…</p> : <>
      {!!demos.data.setups?.length && <section aria-label="Unfinished demo setups"><h3>Unfinished setups</h3><ul>{demos.data.setups.map(s => <li key={s.id}>
        <p>Setup {s.id.slice(0,8)} · {s.accountsPrepared} accounts prepared · {s.status === "retiring" ? "Teardown needs retry" : "Ready to resume"}</p>
        {s.status === "pending" && <Form children={null} label="Resume demo setup" operation="sales_demo.create" submit={async () => {
          setLogins(null);
          try { present(await api<LoginSheet>(`/api/platform/sales-demos/${s.id}/resume`, { method: "POST", body: {}, timeoutMs: 180000 })); }
          finally { refresh(); }
        }} />}
        {teardown(s.id, 1, true)}
      </li>)}</ul></section>}
      {!demos.data.items.length && !demos.data.setups?.length ? <p>No sales demos yet.</p> : <>
        <p className="help">Most recent 50 setups. Current fixture version: {demos.data.seedVersion}.</p>
        <ul>{demos.data.items.map(d => <li key={d.id}>
          <p><Link to={`/platform/companies/${d.companyId}`}>{d.company.name}</Link> · {d.owner.email} · {d.setup?.status === "retiring" ? "Teardown needs retry" : d.status === "ready" ? d.company.status === "active" ? "Ready" : "Company suspended" : "Torn down"} · Fixture {d.seedVersion}{d.seedVersion < demos.data!.seedVersion && d.status === "ready" ? " (rebuild to update)" : ""} · {new Date(d.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
          {d.setup?.status === "ready" && d.status === "ready" && <Form children={null} label="View role logins" operation="sales_demo.credentials" submit={async () => { setLogins(null); present(await api<LoginSheet>(`/api/platform/sales-demos/${d.id}/credentials`, { method: "POST", body: {} })); }} />}
          {(d.status === "ready" || d.setup?.status === "retiring") && teardown(d.id, d.version, !!d.setup)}
        </li>)}</ul>
      </>}
    </>}
  </div>;
}
