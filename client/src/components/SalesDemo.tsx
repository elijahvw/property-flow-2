import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useResource } from "../useResource";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../dates";
import { Form } from "./Form";
import "./SalesDemo.css";

type Demo = { id: string; companyId: string; ownerId: string; status: string; version: number; seedVersion: number; createdAt: string; company: { name: string; status: string }; owner: { email: string; name: string | null }; setup: { id: string; status: string; sourceDemoId?: string | null } | null; replacementSetups?: { id: string; status: string }[] };
type Setup = { id: string; status: string; createdAt: string; accountsPrepared: number; sourceDemoId?: string | null };
type LoginSheet = { id: string; credentials: { role: string; name: string; email: string; password: string }[] };
type Blueprint = { seedVersion: number; anchorOn: string; planHash: string; environment: { name: string; provisioningAllowed: boolean }; effects: { dedicatedCompanies: number; preparedAccounts: number; issuedLogins: number }; roles: { key: string; role: string; login: boolean }[]; coverage: { key: string; label: string }[] };
type OwnershipAccount = { userId: string; name: string | null; email: string; role?: string; status?: string; platformRole: string | null; accountKey?: string | null; expectedEmail?: string | null; reasons?: string[]; reviewPath: string; supportPath: string | null };
type LifecyclePlan = { ownershipReview?: { foreignMembers: OwnershipAccount[]; changedAccounts: OwnershipAccount[] }; id: string; planHash: string; expectedVersion: number; seedVersion: number | null; latestSeedVersion: number; anchorOn?: string | null; automatic: boolean; canRebuild: boolean; companyMembers: number; blockers: string[]; replacement: { id: string; status: string } | null; coverage: { key: string; complete: boolean }[]; stops: { title: string; role: string; state: string; path: string }[] };
export function SalesDemo({ onChange }: { onChange: () => void }) {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(!!params.get("demoId"));
  return <section className="panel sales-demo" aria-labelledby="sales-demo-title">
    <h2 id="sales-demo-title">Sales demo</h2>
    <p>Review, present and safely rebuild an isolated fictional portfolio.</p>
    <button onClick={() => setOpen(true)} disabled={open}>Manage sales demos</button>
    {open && <SalesDemoControls onChange={onChange} />}
  </section>;
}
function SalesDemoControls({ onChange }: { onChange: () => void }) {
  const demos = useResource<{ seedVersion: number; items: Demo[]; setups: Setup[] }>("/api/platform/sales-demos", true, true);
  const blueprint = useResource<Blueprint>("/api/platform/sales-demos/blueprint");
  const { data: auth } = useAuth();
  const scope = JSON.stringify([auth?.user.id, auth?.user.status, auth?.user.emailVerified, auth?.membership?.companyId, auth?.membership?.version, auth?.permissions, auth?.impersonation?.contextId]);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [params] = useSearchParams();
  const [retiring, setRetiring] = useState<string | null>(params.get("demoId"));
  const [rebuilding, setRebuilding] = useState<string | null>(null), [guide, setGuide] = useState<string | null>(null);
  const [logins, setLogins] = useState<(LoginSheet & { scope: string }) | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);
  const denied = [401, 403, 404].includes(demos.errorStatus || 0);
  useEffect(() => { if (denied || logins && logins.scope !== scope) { setLogins(null); setShowPasswords(false); } }, [denied, scope, logins]);
  const refresh = () => { demos.reload(); onChange(); };
  const present = (sheet: LoginSheet) => { setLogins({ ...sheet, scope }); setShowPasswords(false); };
  const teardown = (id: string, automatic: boolean) => retiring === id ? <DemoLifecycleReview key={id} id={id} intent="retire" cancel={() => setRetiring(null)} saved={() => { setLogins(null); setRetiring(null); refresh(); }} changed={refresh} /> : <button className="text-button" onClick={() => setRetiring(id)}>{automatic ? "Tear down demo" : "Retire older demo"}</button>;
  return <div className="sales-demo-manager">
    <section className="demo-blueprint" aria-label="Sales demo blueprint"><h3>Review the next presentation</h3><p>Preview only: this plan creates no accounts, records, messages or payments.</p>
    {blueprint.error && <ReadFailure error={blueprint.error} retry={blueprint.reload} />}
    {!blueprint.data ? !blueprint.error && <p role="status">Loading the demo blueprint…</p> : <>
      <dl className="demo-plan-facts"><div><dt>Dedicated company</dt><dd>{blueprint.data.effects.dedicatedCompanies}</dd></div><div><dt>Role logins</dt><dd>{blueprint.data.effects.issuedLogins}</dd></div><div><dt>Prepared identities</dt><dd>{blueprint.data.effects.preparedAccounts}</dd></div><div><dt>Business day</dt><dd>{formatDate(blueprint.data.anchorOn)}</dd></div></dl>
      <p className="help">Two properties with three units each: four occupied, one ready to rent and one in turnover. Fixture {blueprint.data.seedVersion} includes active, offline, pending and former tenants; partial/unpaid rent; move-out/refund history; shared documents and import validation. Examples use connected fictional sources. No external message, payment or signature is fabricated.</p>
      <details><summary>Roles and feature coverage</summary><ul className="demo-role-list">{blueprint.data.roles.map(role => <li key={role.key}><strong>{role.role}</strong><span>{role.login ? "Role login is issued" : "No portal login or password is issued"}</span></li>)}</ul><p>{blueprint.data.coverage.map(feature => feature.label).join(" · ")}</p></details>
      {!blueprint.data.environment.provisioningAllowed && <p role="status" className="notice">Building is unavailable in this environment. The blueprint remains safe to review without an identity-provider connection.</p>}
    <Form key={key} locked={!blueprint.data.environment.provisioningAllowed || !!blueprint.error} label="Build sales demo" operation="sales_demo.create" successText="Sales demo and role logins created." submit={async () => {
      setLogins(null);
      try {
        present(await api<LoginSheet>("/api/platform/sales-demos", { method: "POST", body: { submissionKey: key, planHash: blueprint.data!.planHash }, timeoutMs: 180000 }));
        setKey(crypto.randomUUID());
      } finally { refresh(); }
    }}><label className="demo-confirm"><input type="checkbox" required />I reviewed the fictional company, role accounts and example states above.</label><p className="help">Setup can take a few minutes. Retry an interrupted submission or resume it below. Each new demo gets separate accounts and passwords.</p></Form>
    </>}</section>
    {logins && logins.scope === scope && !denied && <section aria-label="Demo login credentials" className="panel demo-login-sheet">
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
        {s.sourceDemoId && <p className="help">Rebuild of generation {s.sourceDemoId.slice(0, 8)}. Its old history is retained.</p>}
        {s.status === "pending" && <Form children={null} label="Resume demo setup" operation="sales_demo.create" timeoutMs={s.sourceDemoId ? 360000 : undefined} submit={async () => {
          setLogins(null);
          try { present(await api<LoginSheet>(`/api/platform/sales-demos/${s.id}/resume`, { method: "POST", body: {}, timeoutMs: s.sourceDemoId ? 360000 : 180000 })); }
          finally { refresh(); }
        }} />}
        {teardown(s.id, true)}
      </li>)}</ul></section>}
      {!demos.data.items.length && !demos.data.setups?.length ? <p>No sales demos yet.</p> : <>
        <p className="help">Most recent 50 setups. Current fixture version: {demos.data.seedVersion}.</p>
        <ul className="demo-generations">{demos.data.items.map(d => <li className="demo-generation" key={d.id}>
          <p><Link to={`/platform/companies/${d.companyId}`}>{d.company.name}</Link> · {d.owner.email} · {d.setup?.status === "retiring" ? "Teardown needs retry" : d.status === "ready" ? d.company.status === "active" ? "Ready" : "Company suspended" : "Torn down"} · Fixture {d.seedVersion}{d.seedVersion < demos.data!.seedVersion && d.status === "ready" ? " (rebuild to update)" : ""} · {new Date(d.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
          {d.setup?.status === "ready" && d.status === "ready" && <Form children={null} label="View role logins" operation="sales_demo.credentials" submit={async () => { setLogins(null); present(await api<LoginSheet>(`/api/platform/sales-demos/${d.id}/credentials`, { method: "POST", body: {} })); }} />}
          {d.setup?.sourceDemoId && <p className="help">Fresh replacement for generation {d.setup.sourceDemoId.slice(0, 8)}.</p>}
          {!!d.replacementSetups?.length && <p className="notice">A replacement is already {d.replacementSetups[0].status === "pending" ? "reserved; resume its unfinished setup" : "available"}. This generation's history is retained.</p>}
          <div className="demo-actions"><button className="secondary" onClick={() => setGuide(guide === d.id ? null : d.id)}>{guide === d.id ? "Close walkthrough" : "Presentation walkthrough"}</button>
          {!d.replacementSetups?.length && <button className="secondary" onClick={() => { setLogins(null); setRebuilding(d.id); }}>{d.seedVersion < demos.data!.seedVersion ? "Review fixture update" : "Review fresh rebuild"}</button>}
          {(d.status === "ready" || d.setup?.status === "retiring") && teardown(d.id, !!d.setup)}</div>
          {guide === d.id && <DemoWalkthrough id={d.id} />}
          {rebuilding === d.id && <DemoLifecycleReview key={`${d.id}:rebuild`} id={d.id} intent="rebuild" cancel={() => setRebuilding(null)} saved={sheet => { if (sheet) present(sheet); setRebuilding(null); refresh(); }} changed={refresh} />}
        </li>)}</ul>
      </>}
    </>}
  </div>;
}

function ReadFailure({ error, retry }: { error: string; retry: () => void }) {
  return <div className="notice error" role="alert"><p>{error}</p><button className="secondary" type="button" onClick={retry}>Try again</button></div>;
}
function DemoWalkthrough({ id }: { id: string }) {
  const plan = useResource<LifecyclePlan>(`/api/platform/sales-demos/${encodeURIComponent(id)}/plan?intent=inspect`);
  return <section className="demo-review" aria-label="Demo presentation walkthrough"><h4>Present the connected workflows</h4>
    {plan.error && <ReadFailure error={plan.error} retry={plan.reload} />}
    {!plan.data ? !plan.error && <p role="status">Loading source links…</p> : <>
      <p>Sign in with the listed role first. These sources use that account's normal permissions; viewing this guide grants no company access.</p>
      <ol className="demo-stops">{plan.data.stops.map(stop => <li key={stop.path}><strong>{stop.title}</strong><p>{stop.role} · {stop.state}</p><Link to={stop.path} target="_blank" rel="noreferrer">Open source after role sign-in</Link></li>)}</ol>
      <p className="help">Fixture coverage: {plan.data.coverage.filter(c => c.complete).length} of {plan.data.coverage.length} company areas have retained source references.{plan.data.anchorOn ? ` Dates remain anchored to ${formatDate(plan.data.anchorOn)}; review a fresh rebuild when you need current presentation dates.` : ""}{plan.data.seedVersion !== plan.data.latestSeedVersion ? " An updated fixture is available." : ""}</p>
    </>}
  </section>;
}
function DemoLifecycleReview({ id, intent, cancel, saved, changed }: { id: string; intent: "retire" | "rebuild"; cancel: () => void; saved: (sheet?: LoginSheet) => void; changed: () => void }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false), [uncertain, setUncertain] = useState(false);
  const resource = useResource<LifecyclePlan>(`/api/platform/sales-demos/${encodeURIComponent(id)}/plan?intent=${intent}`, false, !submitting && !uncertain);
  const plan = resource.data, rebuilding = intent === "rebuild";
  return <section className="demo-review" aria-label={rebuilding ? "Demo rebuild review" : "Demo teardown review"}>
    <h4>{rebuilding ? "Review a fresh replacement" : "Review demo teardown"}</h4>
    {resource.error && <ReadFailure error={resource.error} retry={resource.reload} />}
    {!plan ? !resource.error && <p role="status">Loading the current action plan…</p> : <>
      <p>{rebuilding ? "Retire this generation, then build one fresh fictional company with new role logins and the current fixture. Existing posted records are not rewritten." : plan.automatic ? "Suspend this demo company, disable its generated accounts and revoke sessions. No source records or audit history are deleted." : "Retire this older demo and release its pre-existing presenter. The presenter's account is preserved."}</p>
      <dl className="demo-plan-facts"><div><dt>Reviewed generation</dt><dd>{plan.id.slice(0, 8)}</dd></div><div><dt>Company members</dt><dd>{plan.companyMembers}</dd></div><div><dt>Current fixture</dt><dd>{plan.seedVersion ?? "Not built"}</dd></div>{rebuilding && <div><dt>Replacement fixture</dt><dd>{plan.latestSeedVersion}</dd></div>}</dl>
      {plan.blockers.map(blocker => <p className="notice error" role="alert" key={blocker}>{blocker}</p>)}
      <DemoOwnershipReview review={plan.ownershipReview} />
      {plan.replacement && <p className="notice">This generation already has a replacement reserved. Refresh the list and resume it rather than starting another.</p>}
      <Form key={`${key}:${plan.planHash}`} label={rebuilding ? "Build replacement demo" : "Confirm teardown"} operation={rebuilding ? "sales_demo.create" : "sales_demo.teardown"} timeoutMs={rebuilding ? 360000 : undefined} locked={!!resource.error || !!plan.blockers.length || rebuilding && !plan.canRebuild} successText={rebuilding ? "Replacement built." : "Demo torn down."} submit={async () => {
        setSubmitting(true);
        try {
          if (rebuilding) saved(await api<LoginSheet>(`/api/platform/sales-demos/${encodeURIComponent(id)}/rebuild`, { method: "POST", body: { submissionKey: key, expectedVersion: plan.expectedVersion, planHash: plan.planHash, confirmed: true }, timeoutMs: 360000 }));
          else { await api(`/api/platform/sales-demos/${encodeURIComponent(id)}/teardown`, { method: "POST", body: { expectedVersion: plan.expectedVersion, planHash: plan.planHash }, timeoutMs: 180000 }); saved(); }
        } catch (error) { setUncertain(error instanceof ApiError && error.submissionUncertain); throw error; }
        finally { setSubmitting(false); changed(); }
      }}><label className="demo-confirm"><input type="checkbox" required />{rebuilding ? "I reviewed the replacement and understand that the old history is retained." : "I reviewed this demo and the accounts affected by teardown."}</label></Form>
      <div className="demo-actions"><button type="button" className="secondary" disabled={submitting || uncertain} onClick={() => { setKey(crypto.randomUUID()); resource.reload(); }}>Refresh action plan</button><button type="button" className="text-button" disabled={submitting || uncertain} onClick={cancel}>Cancel</button></div>
      {uncertain && <p className="help">Keep this original request and retry it, or resume the reserved setup from the list. Refreshing the review is unavailable while its result is unknown.</p>}
    </>}
  </section>;
}


function DemoOwnershipReview({ review }: { review: LifecyclePlan["ownershipReview"] }) {
  if (!review || !review.foreignMembers.length && !review.changedAccounts.length) return null;
  const reasons: Record<string, string> = {
    password_change_pending: "An administrative password attempt is unfinished or unconfirmed. Open this account’s password controls, check its status and explicitly release an expired uncertain attempt before cleanup.",
    platform_authority: "Separate platform authority was granted to this generated account. Company ownership or residency alone does not grant platform access.",
    legacy_company_assignment: "An older company assignment remains on this account. Review its company access before cleanup.",
    email_changed: "The account email no longer matches its saved demo identity. Review the exact sign-in identity; matching an email does not establish ownership.",
    other_company_membership: "This generated account is now assigned to another company. Review that assignment before retiring it.",
    identity_mapping_changed: "The saved issuer and subject no longer match the local sign-in identity. Reconcile the exact account before cleanup.",
  };
  return <section aria-label="Accounts blocking demo cleanup">
    <h5>Review the affected accounts</h5>
    <p>These checks protect accounts whose access changed. Review each existing account, then return and refresh this action plan. This review changes no access.</p>
    {!!review.foreignMembers.length && <><h6>Additional company members</h6><ul>{review.foreignMembers.map(account => <li key={account.userId}>
      <strong>{account.name || account.email}</strong><p>{account.email} · {account.role} · {account.status}</p>
      <p>This sign-in account was added separately. If its company access is no longer needed, remove only its membership through Company access → No company access. Its sign-in account and business history are retained.</p>
      {account.platformRole && <p>Separate platform authority: {account.platformRole === "owner" ? "Platform owner" : "Platform Support"}. Removing a company membership does not revoke this separate grant.</p>}
      {account.supportPath && <p><Link to={account.supportPath} target="_blank" rel="noreferrer">Review platform Support grant for {account.name || account.email}</Link></p>}
      <Link to={account.reviewPath} target="_blank" rel="noreferrer">Review company access for {account.name || account.email}</Link>
    </li>)}</ul></>}
    {!!review.changedAccounts.length && <><h6>Changed generated accounts</h6><ul>{review.changedAccounts.map(account => <li key={account.userId}>
      <strong>{account.name || account.email}</strong><p>{account.email}{account.accountKey ? ` · ${account.accountKey}` : ""}</p>
      <ul>{account.reasons?.map(reason => <li key={reason}>{reasons[reason] || "Review this account's current access."}</li>)}</ul>
      {account.reasons?.includes("email_changed") && <p>Saved demo email: {account.expectedEmail || "Unavailable"}</p>}
      {account.supportPath && <p><Link to={account.supportPath} target="_blank" rel="noreferrer">Review platform Support grant for {account.name || account.email}</Link></p>}
      <Link to={account.reviewPath} target="_blank" rel="noreferrer">Review account for {account.name || account.email}</Link>
    </li>)}</ul></>}
  </section>;
}
