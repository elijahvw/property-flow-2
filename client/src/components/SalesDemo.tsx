import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useResource } from "../useResource";
import { Form } from "./Form";

type Demo = { id: string; companyId: string; ownerId: string; status: string; version: number; seedVersion: number; createdAt: string; company: { name: string; status: string }; owner: { email: string; name: string | null } };
type User = { id: string; email: string; name: string | null; status: string; emailVerified: boolean; platformRole: string | null; companyId: string | null; membership: unknown };
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
  const demos = useResource<{ seedVersion: number; items: Demo[] }>("/api/platform/sales-demos", true, true);
  const users = useResource<User[]>("/api/platform/users", true, true);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [retiring, setRetiring] = useState<string | null>(null);
  const refresh = () => { demos.reload(); users.reload(); onChange(); };
  const eligible = users.data?.filter(u => u.status === "active" && u.emailVerified && !u.platformRole && !u.membership && !u.companyId);
  return <div>
    <p>Build a fictional portfolio with linked properties, units, tenants, leases, rent receipts, deposits, maintenance, vendors, inspections, agreements, documents and notifications.</p>
    <p>Use a dedicated, verified Auth0 account. <Link to="/platform/users">Create or import it in Users</Link> first. Sign in with that account to present the demo. Sample residents cannot sign in; no emails or payments are sent during setup.</p>
    {users.error && <div role="alert">{users.error} <button onClick={users.reload}>Retry accounts</button></div>}
    {!users.data ? <p role="status">Loading accounts…</p> : eligible?.length ? <Form key={key} label="Build sales demo" operation="sales_demo.create" successText="Sales demo created." submit={async form => {
      await api("/api/platform/sales-demos", { method: "POST", body: { ownerId: form.get("ownerId"), submissionKey: key }, timeoutMs: 65000 });
      setKey(crypto.randomUUID()); refresh();
    }}>
      <label>Dedicated demo account<select name="ownerId" required defaultValue=""><option value="" disabled>Choose an unassigned account</option>{eligible.map(u => <option key={u.id} value={u.id}>{u.name || u.email} · {u.email}</option>)}</select></label>
      <p className="help">Setup can take a minute. If the response is interrupted, retry the same submission.</p>
    </Form> : <p>No eligible accounts. Create or import a verified account without company access or platform authority, or tear down its current demo to rebuild.</p>}
    {demos.error && <div role="alert">{demos.error} <button onClick={demos.reload}>Retry demo list</button></div>}
    {!demos.data ? <p role="status">Loading demos…</p> : !demos.data.items.length ? <p>No sales demos yet.</p> : <>
      <p className="help">Most recent 50 setups. Current fixture version: {demos.data.seedVersion}.</p>
      <ul>{demos.data.items.map(d => <li key={d.id}>
        <p><Link to={`/platform/companies/${d.companyId}`}>{d.company.name}</Link> · {d.owner.email} · {d.status === "ready" ? d.company.status === "active" ? "Ready" : "Company suspended" : "Torn down"} · Fixture {d.seedVersion}{d.seedVersion < demos.data!.seedVersion && d.status === "ready" ? " (rebuild to update)" : ""} · {new Date(d.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
        {d.status === "ready" && (retiring === d.id ? <div>
          <p>Tear down this demo? Its company will be suspended, sessions revoked and the sales account released for a fresh setup. Source records and audit history are retained.</p>
          <Form label="Confirm teardown" operation="sales_demo.teardown" successText="Demo torn down. The account can be used again." submit={async () => {
            await api(`/api/platform/sales-demos/${d.id}/teardown`, { method: "POST", body: { expectedVersion: d.version } });
            setRetiring(null); refresh();
          }}><button type="button" onClick={() => setRetiring(null)}>Cancel</button></Form>
        </div> : <button onClick={() => setRetiring(d.id)}>Tear down demo for {d.owner.email}</button>)}
      </li>)}</ul>
    </>}
  </div>;
}
