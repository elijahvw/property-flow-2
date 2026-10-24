import { useEffect, useId, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useResource } from "../useResource";
import { useAuth } from "../context/AuthContext";
import { dollars } from "../money";
import { formatActivityTime, formatDate, formatMonth } from "../dates";
import { billingStateLabel, featureModeLabel } from "../company-subscription-types";
import type { FeatureMode, Invoice, InvoiceDetailView, SubscriptionView, UsageView } from "../company-subscription-types";
import { Form } from "./Form";
import { EditorDialog } from "./EditorDialog";
import "./CompanySubscription.css";

type Scope = { platform: boolean; companyId?: string };
const baseFor = ({ platform, companyId }: Scope) => platform ? `/api/platform/companies/${encodeURIComponent(companyId!)}` : "/api/company";
const today = () => new Date().toISOString().slice(0, 10);
const str = (data: FormData, key: string) => String(data.get(key) || "");
function localInstant(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
}
const instant = (data: FormData, key: string) => str(data, key) ? new Date(str(data, key)).toISOString() : null;
const inclusiveEnd = (value: string) => new Date(new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
function LoadError({ message, retry }: { message?: string; retry: () => void }) {
  return message ? <p className="notice error" role="alert">{message} <button className="secondary" onClick={retry}>Try again</button></p> : <p role="status">Loading subscription records…</p>;
}
function Pager({ cursors, nextCursor, change }: { cursors: string[]; nextCursor: string | null; change: (value: string[]) => void }) {
  return <div className="actions"><button className="secondary" disabled={!cursors.length} onClick={() => change(cursors.slice(0, -1))}>Previous page</button><button className="secondary" disabled={!nextCursor} onClick={() => change([...cursors, nextCursor!])}>Next page</button></div>;
}
export function CompanySubscriptionPage() {
  const { data } = useAuth();
  return <><header className="page-heading"><p className="eyebrow">Company account</p><h1>Plan & billing</h1><p>{data?.membership?.company.name} · Review your monthly plan, feature access, usage and invoices.</p></header><SubscriptionWorkspace platform={false}/></>;
}
export function PlatformCompanySubscription({ companyId }: { companyId: string }) {
  return <section aria-labelledby="company-subscription-title"><div className="section-heading"><h2 id="company-subscription-title">Plan, features & billing</h2><Link to="/platform/plans">Manage monthly plans</Link></div><SubscriptionWorkspace platform companyId={companyId}/></section>;
}
function SubscriptionWorkspace(scope: Scope) {
  const [params, setParams] = useSearchParams();
  const tab = ["features", "usage", "billing"].includes(params.get("subscriptionTab") || "") ? params.get("subscriptionTab")! : "features";
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => { setVisited(previous => previous.has(tab) ? previous : new Set([...previous, tab])); }, [tab]);
  return <>
    <nav className="subscription-tabs" aria-label="Subscription sections">{[["features", "Plan & features"], ["usage", "Usage"], ["billing", "Invoices"]].map(([key, label]) => <button key={key} className="secondary" aria-current={tab === key ? "page" : undefined} onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set("subscriptionTab", key); return next; })}>{label}</button>)}</nav>
    {(visited.has("features") || tab === "features") && <div hidden={tab !== "features"}><PlanFeatures {...scope}/></div>}
    {(visited.has("usage") || tab === "usage") && <div hidden={tab !== "usage"}><FeatureUsage {...scope}/></div>}
    {(visited.has("billing") || tab === "billing") && <div hidden={tab !== "billing"} className={tab === "billing" ? "subscription-billing-active" : undefined}><CompanyInvoices {...scope}/></div>}
  </>;
}
function PlanFeatures(scope: Scope) {
  const controlId = useId();
  const resource = useResource<SubscriptionView>(`${baseFor(scope)}/subscription`, true);
  const [draft, setDraft] = useState<SubscriptionView | null>(null), [open, setOpen] = useState(false), [key, setKey] = useState(() => crypto.randomUUID()), [history, setHistory] = useState(false);
  const reset = () => { setOpen(false); setDraft(null); setKey(crypto.randomUUID()); };
  if (!resource.data) return <LoadError message={resource.error} retry={resource.reload}/>;
  const view = resource.data, subscription = view.subscription, original = draft?.subscription;
  return <>
    {resource.error && <LoadError message={resource.error} retry={resource.reload}/>}
    <section className="panel">
      <div className="section-heading"><h3>Monthly subscription</h3>{scope.platform && <button className="secondary" onClick={() => { if (!draft) setDraft(view); setOpen(true); }}>{draft ? "Continue subscription draft" : "Manage subscription"}</button>}</div>
      <dl className="subscription-facts"><div><dt>Plan</dt><dd>{subscription?.plan ? `${subscription.plan.name} · Revision ${subscription.plan.version}` : "No monthly plan assigned"}</dd></div><div><dt>Monthly price</dt><dd>{subscription?.plan ? `${dollars(subscription.plan.monthlyPriceCents)} USD` : "Not configured"}</dd></div><div><dt>Subscription state</dt><dd>{subscription ? billingStateLabel(subscription.status) : "Existing access · Not configured"}</dd></div><div><dt>Billing email</dt><dd>{subscription?.billingEmail || "Not supplied"}</dd></div>{subscription?.trialEndsAt && <div><dt>Trial ends</dt><dd>{formatActivityTime(subscription.trialEndsAt)}</dd></div>}{subscription?.overrideExpiresAt && <div><dt>Company exceptions expire</dt><dd>{formatActivityTime(subscription.overrideExpiresAt)}</dd></div>}</dl>
      <p className="help">Monthly charges come from the assigned plan revision. Activity counts do not change the monthly price. Invoices and recorded receipts are separate from tenant rent.</p>
      {!subscription?.plan && <p className="notice">No plan price has been assigned. Existing access remains available unless a company control restricts it; no subscription charge is created automatically.</p>}
    </section>
    <section className="panel"><h3>Effective feature access</h3><p className="help">Company controls combine with each person's role, property grants and resident access. View only retains permitted history and blocks changes.</p><div className="table-wrap"><table><thead><tr><th scope="col">Feature</th><th scope="col">Access</th><th scope="col">Scope</th></tr></thead><tbody>{view.catalog.map(feature => <tr key={feature.key}><td><strong>{feature.label}</strong></td><td>{featureModeLabel(view.effectiveFeatures[feature.key] || "disabled")}</td><td>{feature.description}</td></tr>)}</tbody></table></div></section>
    {scope.platform && <>
      <details onToggle={event => setHistory(event.currentTarget.open)}><summary>Subscription change history</summary>{history && <SubscriptionHistory base={baseFor(scope)}/>}</details>
      <EditorDialog open={open} title="Manage company subscription" onClose={() => setOpen(false)} onDiscard={reset} onSaveDraft={() => setOpen(false)}>
        {draft && <Form key={key} operation="subscription.update" label="Save subscription controls" feedbackText="Subscription controls saved." submit={async data => {
          const featureOverrides = Object.fromEntries(draft.catalog.map(feature => [feature.key, str(data, `feature_${feature.key}`)]).filter(([, mode]) => mode !== "inherit"));
          await api(`${baseFor(scope)}/subscription`, { method: "PUT", body: { expectedVersion: original?.version ?? null, planId: str(data, "planId") || null, status: str(data, "status"), trialEndsAt: instant(data, "trialEndsAt"), billingEmail: str(data, "billingEmail") || null, featureOverrides, overrideReason: str(data, "overrideReason") || null, overrideExpiresAt: instant(data, "overrideExpiresAt"), reason: str(data, "reason"), submissionKey: key } });
          reset(); resource.reload();
        }}>
          <fieldset><legend>Monthly plan and billing</legend>
            <p className="help">Choose the company’s plan and account state. Saving these settings does not issue an invoice or collect payment.</p>
            <div className="form-grid subscription-primary-fields">
              <label className="subscription-wide-field">Monthly plan<select name="planId" defaultValue={original?.planId || ""}><option value="">No plan assigned · Existing feature baseline</option>{draft.plans?.map(plan => <option key={plan.id} value={plan.id} disabled={!!plan.archivedAt && original?.planId !== plan.id}>{plan.name} · Revision {plan.version} · {dollars(plan.monthlyPriceCents)}/month{plan.archivedAt ? " · Archived" : ""}</option>)}</select></label>
              <label>Subscription state<select name="status" defaultValue={original?.status || "active"}>{["trial", "active", "expired", "suspended", "cancelled"].map(state => <option key={state} value={state}>{billingStateLabel(state)}</option>)}</select></label>
              <label>Billing email<input aria-label="Billing email" aria-describedby={`${controlId}-email-help`} name="billingEmail" type="email" maxLength={254} defaultValue={original?.billingEmail || ""}/><span id={`${controlId}-email-help`} className="help">Optional invoice contact.</span></label>
              <label className="subscription-wide-field">Trial ends at (your local time)<input aria-label="Trial ends at (your local time)" aria-describedby={`${controlId}-trial-help`} name="trialEndsAt" type="datetime-local" defaultValue={localInstant(original?.trialEndsAt)}/><span id={`${controlId}-trial-help`} className="help">Required only for a trial subscription.</span></label>
            </div>
            {!draft.plans?.length && <p className="help">Publish a monthly plan from Monthly plans before assigning a price.</p>}
            <p className="help">Expired, suspended and cancelled subscriptions retain permitted history in view-only mode. Feature changes and recurring rent posting stop; company suspension remains separate.</p>
          </fieldset>
          <details className="subscription-exceptions" open={Object.keys(original?.featureOverrides || {}).length > 0 || undefined}>
            <summary><span>Company feature exceptions</span><span className="subscription-exception-count">{Object.keys(original?.featureOverrides || {}).length ? `${Object.keys(original!.featureOverrides).length} configured` : "Optional"}</span></summary>
            <div className="subscription-exceptions-body">
              <p className="help">Inherit keeps the assigned plan’s access. Use an exception only when this company needs different access.</p>
              <div className="subscription-feature-fields">{draft.catalog.map(feature => <label key={feature.key} className="subscription-feature-field"><span className="subscription-feature-copy"><strong>{feature.label}</strong><span>{feature.description}</span></span><select aria-label={feature.label} name={`feature_${feature.key}`} defaultValue={original?.featureOverrides[feature.key] || "inherit"}><option value="inherit">Inherit plan</option><option value="enabled">Enabled</option><option value="read_only">View only</option><option value="disabled">Disabled</option></select></label>)}</div>
              <label>Feature exception reason<textarea aria-label="Feature exception reason" aria-describedby={`${controlId}-override-reason-help`} name="overrideReason" maxLength={500} defaultValue={original?.overrideReason || ""}/><span id={`${controlId}-override-reason-help`} className="help">Required when an exception is configured.</span></label>
              <label>Feature exceptions expire at (your local time)<input aria-label="Feature exceptions expire at (your local time)" aria-describedby={`${controlId}-override-expiry-help`} name="overrideExpiresAt" type="datetime-local" defaultValue={localInstant(original?.overrideExpiresAt)}/><span id={`${controlId}-override-expiry-help`} className="help">Optional. At expiry, feature access returns to the plan.</span></label>
            </div>
          </details>
          <fieldset><legend>Change record</legend><label>Reason for this subscription change<textarea aria-label="Reason for this subscription change" aria-describedby={`${controlId}-change-reason-help`} name="reason" required maxLength={500}/><span id={`${controlId}-change-reason-help`} className="help">Required. Explain this change for the company’s retained platform history.</span></label><p className="help">If settings change elsewhere, discard this review and reopen it to use the current version.</p></fieldset>
        </Form>}
      </EditorDialog>
    </>}
  </>;
}
function SubscriptionHistory({ base }: { base: string }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const resource = useResource<{ items: { id: string; version: number; reason: string; createdAt: string; snapshot: { status?: string; planId?: string | null; featureOverrides?: Record<string, FeatureMode> } }[]; nextCursor: string | null }>(`${base}/subscription/history${cursors.length ? `?cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ""}`);
  if (!resource.data) return <LoadError message={resource.error} retry={resource.reload}/>;
  return <div className="panel">{resource.data.items.length ? <ol className="record-list">{resource.data.items.map(row => <li key={row.id}><strong>Revision {row.version} · {formatActivityTime(row.createdAt)}</strong><p>{row.reason}</p><p className="help">{row.snapshot.status ? billingStateLabel(row.snapshot.status) : "Subscription change"}{row.snapshot.featureOverrides && Object.keys(row.snapshot.featureOverrides).length ? ` · ${Object.entries(row.snapshot.featureOverrides).map(([key, mode]) => `${key}: ${featureModeLabel(mode)}`).join(", ")}` : ""}</p></li>)}</ol> : <p>No subscription changes recorded.</p>}<Pager cursors={cursors} nextCursor={resource.data.nextCursor} change={setCursors}/></div>;
}
function FeatureUsage(scope: Scope) {
  const [range, setRange] = useState({ from: `${today().slice(0, 7)}-01`, to: today() });
  const resource = useResource<UsageView>(`${baseFor(scope)}/usage?${new URLSearchParams(range)}`);
  return <section className="panel"><h3>Feature usage</h3><form className="subscription-filter" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); setRange({ from: str(data, "from"), to: str(data, "to") }); }}><label>From (UTC)<input type="date" name="from" required defaultValue={range.from}/></label><label>Through (UTC)<input type="date" name="to" required defaultValue={range.to}/></label><button className="secondary" type="submit">Apply usage dates</button></form>
    {!resource.data && <LoadError message={resource.error} retry={resource.reload}/>}
    {resource.data && <><p>{formatDate(resource.data.from)} – {formatDate(resource.data.to)} · UTC</p><p className="help">{resource.data.definition}</p>{resource.data.trackingStartedAt ? <p className="help">First recorded usage day: {formatDate(resource.data.trackingStartedAt)} (UTC). Earlier activity is not backfilled.</p> : <p className="notice">No feature activity has been recorded yet. Tracking starts after this release is deployed and users use the company workspace.</p>}<div className="table-wrap"><table><thead><tr><th scope="col">Area</th><th scope="col">Successful reads</th><th scope="col">Successful action requests</th><th scope="col">Total requests</th></tr></thead><tbody>{resource.data.areas.map(area => <tr key={area.key}><th scope="row">{area.label}</th><td>{area.successfulReads.toLocaleString()}</td><td>{area.successfulWrites.toLocaleString()}</td><td>{area.total.toLocaleString()}</td></tr>)}</tbody></table></div><h4>Current company resources</h4><dl className="subscription-facts">{Object.entries({ Properties: resource.data.resources.properties, "Active units": resource.data.resources.activeUnits, "Active leases": resource.data.resources.activeLeases, "Active members": resource.data.resources.activeMembers, "Retained document versions": resource.data.resources.documentVersions, "Retained document bytes": resource.data.resources.documentBytes }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}</dl><p className="help">Resource counts describe the current records, independently of the selected activity dates. Retained document storage includes all versions. These counts do not change flat monthly pricing.</p></>}
  </section>;
}
function CompanyInvoices(scope: Scope) {
  const [params, setParams] = useSearchParams(), invoiceId = params.get("invoiceId");
  const [cursors, setCursors] = useState<string[]>([]), [issuing, setIssuing] = useState(false), [key, setKey] = useState(() => crypto.randomUUID());
  const [preparation, setPreparation] = useState<SubscriptionView | null>(null), [preparing, setPreparing] = useState(false), [prepareError, setPrepareError] = useState("");
  const base = baseFor(scope), resource = useResource<{ items: Invoice[]; nextCursor: string | null; totalOutstandingCents: number; total?: number }>(`${base}/billing${cursors.length ? `?cursor=${encodeURIComponent(cursors[cursors.length - 1])}` : ""}`, true);
  const selectInvoice = (id: string | null) => setParams(previous => { const next = new URLSearchParams(previous); if (id) next.set("invoiceId", id); else next.delete("invoiceId"); return next; });
  if (invoiceId) return <InvoiceDetail scope={scope} invoiceId={invoiceId} back={() => { selectInvoice(null); resource.reload(); }}/>;
  const reset = () => { setIssuing(false); setPreparation(null); setKey(crypto.randomUUID()); };
  async function prepareIssue() {
    if (preparation) { setIssuing(true); return; }
    setPreparing(true); setPrepareError("");
    try {
      const review = await api<SubscriptionView>(`${base}/subscription`);
      if (!review.subscription?.plan || review.subscription.status !== "active") throw new Error("Assign an active monthly plan before issuing an invoice.");
      if (!review.billingProfile || !Number.isSafeInteger(review.billingProfile.companyVersion)) throw new Error("Current billing details could not be prepared. Refresh and try again.");
      setPreparation(review); setIssuing(true);
    } catch (failure) { setPrepareError(failure instanceof Error ? failure.message : "Invoice review could not be prepared."); }
    finally { setPreparing(false); }
  }
  return <section className="panel"><div className="section-heading"><h3>Company invoices</h3>{scope.platform && <button className="secondary" disabled={preparing} onClick={() => void prepareIssue()}>{preparing ? "Preparing invoice review…" : preparation ? "Continue invoice draft" : "Issue monthly invoice"}</button>}</div><p className="help">Invoices record the company's subscription charge. Payments below are receipts for money received outside Property Flow; the application does not collect or send payments.</p>
    {prepareError && <p className="notice error" role="alert">{prepareError}</p>}
    {!resource.data && <LoadError message={resource.error} retry={resource.reload}/>}
    {resource.data && <>{resource.error && <LoadError message={resource.error} retry={resource.reload}/>}<p><strong>Outstanding across all invoices: {dollars(resource.data.totalOutstandingCents)}</strong></p>{resource.data.items.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Invoice</th><th scope="col">Month</th><th scope="col">Due</th><th scope="col">State</th><th scope="col">Charge</th><th scope="col">Outstanding</th></tr></thead><tbody>{resource.data.items.map(invoice => <tr key={invoice.id}><td><button className="link-button" disabled={!!preparation} onClick={() => selectInvoice(invoice.id)}>{invoice.reference}</button><br/><span className="help">{invoice.planName} · Revision {invoice.planVersion}</span></td><td>{formatMonth(invoice.periodStart)}</td><td>{formatDate(invoice.dueOn)}</td><td>{billingStateLabel(invoice.paymentState || invoice.status)}</td><td>{dollars(invoice.monthlyPriceCents)}</td><td>{dollars(invoice.balanceCents)}</td></tr>)}</tbody></table></div> : <p>No company invoices have been issued.</p>}<Pager cursors={cursors} nextCursor={resource.data.nextCursor} change={setCursors}/></>}
    {scope.platform && <EditorDialog open={issuing} title="Issue monthly invoice" onClose={() => setIssuing(false)} onDiscard={reset} onSaveDraft={() => setIssuing(false)}>{preparation && <Form key={key} operation="subscription.invoice.issue" label="Issue invoice" feedbackText="Monthly invoice issued." submit={async data => { const result = await api<InvoiceDetailView>(`${base}/billing/invoices`, { method: "POST", body: { period: str(data, "period"), dueOn: str(data, "dueOn"), submissionKey: key, expectedSubscriptionVersion: preparation.subscription!.version, expectedCompanyVersion: preparation.billingProfile!.companyVersion } }); reset(); resource.reload(); if (result.invoice?.id) selectInvoice(result.invoice.id); }}><h4>Reviewed charge</h4><p><strong>{preparation.subscription!.plan!.name} · Revision {preparation.subscription!.plan!.version}</strong></p><p><strong>{dollars(preparation.subscription!.plan!.monthlyPriceCents)} USD for the full billing month</strong></p><dl className="subscription-facts"><div><dt>Billed company</dt><dd>{preparation.billingProfile!.name}</dd></div><div><dt>Billing email</dt><dd>{preparation.billingProfile!.email || "Not supplied"}</dd></div><div><dt>Billing address</dt><dd>{[preparation.billingProfile!.address.addressLine1, preparation.billingProfile!.address.addressLine2].filter(Boolean).join(", ") || "Not supplied"}<br/>{[preparation.billingProfile!.address.city, preparation.billingProfile!.address.region, preparation.billingProfile!.address.postalCode].filter(Boolean).join(", ")}{preparation.billingProfile!.address.country && <><br/>{preparation.billingProfile!.address.country}</>}</dd></div></dl><p>The reviewed price, company details and full calendar month are frozen on the invoice. Only one issued invoice can exist for a company and month. No email or payment collection occurs.</p><p className="help">If the plan or company billing details change while this review is open, discard it and prepare a new review before issuing.</p><label>Billing month<input name="period" type="month" required defaultValue={today().slice(0, 7)}/></label><label>Due on<input name="dueOn" type="date" required defaultValue={today()}/></label></Form>}</EditorDialog>}
  </section>;
}
type InvoiceAction = { kind: "payment" | "void" | "reverse"; invoice: Invoice; paymentId?: string; key: string };
function InvoiceDetail({ scope, invoiceId, back }: { scope: Scope; invoiceId: string; back: () => void }) {
  const base = `${baseFor(scope)}/billing/invoices/${encodeURIComponent(invoiceId)}`;
  const resource = useResource<InvoiceDetailView>(base, true);
  const [action, setAction] = useState<InvoiceAction | null>(null), [open, setOpen] = useState(false);
  if (!resource.data) return <><button className="link-button" onClick={back}>← Company invoices</button><LoadError message={resource.error} retry={resource.reload}/></>;
  const { invoice, payments, events } = resource.data;
  const begin = (kind: InvoiceAction["kind"], paymentId?: string) => { if (!action) setAction({ kind, invoice, paymentId, key: crypto.randomUUID() }); setOpen(true); };
  const reset = () => { setAction(null); setOpen(false); };
  const address = invoice.billingAddress || {};
  return <><button className="link-button" onClick={back}>← Company invoices</button><section className="panel subscription-invoice-document"><div className="section-heading"><div><h3>{invoice.reference}</h3><p>{formatMonth(invoice.periodStart)} · {billingStateLabel(invoice.paymentState || invoice.status)}</p></div><button className="secondary" onClick={() => window.print()}>Print invoice</button></div>{resource.error && <LoadError message={resource.error} retry={resource.reload}/>}<dl className="subscription-facts"><div><dt>Billed company</dt><dd>{invoice.billingName}<br/>{invoice.billingEmail || "No billing email recorded"}{Object.values(address).some(Boolean) && <address>{[address.addressLine1, address.addressLine2].filter(Boolean).join(", ")}<br/>{[address.city, address.region, address.postalCode].filter(Boolean).join(", ")}{address.country && <><br/>{address.country}</>}</address>}</dd></div><div><dt>Plan</dt><dd>{invoice.planName} · Revision {invoice.planVersion}</dd></div><div><dt>Period</dt><dd>{formatDate(invoice.periodStart)} – {formatDate(inclusiveEnd(invoice.periodEnd))}</dd></div><div><dt>Issued</dt><dd>{formatActivityTime(invoice.issuedAt)}</dd></div><div><dt>Due</dt><dd>{formatDate(invoice.dueOn)}</dd></div><div><dt>Monthly charge</dt><dd>{dollars(invoice.monthlyPriceCents)} USD</dd></div><div><dt>Recorded receipts</dt><dd>{dollars(invoice.paidCents)}</dd></div><div><dt>Outstanding</dt><dd>{dollars(invoice.balanceCents)}</dd></div></dl>
    {scope.platform && <div className="actions">{action && !open && <button onClick={() => setOpen(true)}>Continue invoice action</button>}{invoice.status !== "void" && invoice.balanceCents > 0 && <button disabled={!!action} onClick={() => begin("payment")}>Record received payment</button>}{invoice.status !== "void" && invoice.paidCents === 0 && <button className="secondary" disabled={!!action} onClick={() => begin("void")}>Void invoice</button>}</div>}
    <h4>Payment receipts</h4>{payments.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Received</th><th scope="col">Reference</th><th scope="col">Amount</th><th scope="col">State</th>{scope.platform && <th scope="col">Correction</th>}</tr></thead><tbody>{payments.map(payment => <tr key={payment.id}><td>{formatDate(payment.receivedOn)}</td><td>{payment.paymentReference}</td><td>{dollars(payment.amountCents)}</td><td>{payment.reversal ? `Reversed · ${payment.reversal.reason}` : "Recorded receipt"}</td>{scope.platform && <td>{!payment.reversal && invoice.status !== "void" && <button className="secondary" disabled={!!action} onClick={() => begin("reverse", payment.id)}>Reverse receipt</button>}</td>}</tr>)}</tbody></table></div> : <p>No received payments have been recorded.</p>}
    <h4>Invoice history</h4>{events.length ? <ol className="record-list">{events.map(event => <li key={event.id}><strong>{event.action.replace(/^subscription\.|^invoice\./g, "").replace(/\./g, " ").replace(/_/g, " ")}</strong><p>{formatActivityTime(event.createdAt)}</p>{!!event.detail && typeof event.detail === "object" && "reason" in event.detail && <p>{String((event.detail as { reason: unknown }).reason)}</p>}</li>)}</ol> : <p>No invoice events available.</p>}
    </section>
    {scope.platform && <EditorDialog open={open} title={action?.kind === "payment" ? "Record received subscription payment" : action?.kind === "void" ? "Void subscription invoice" : "Reverse subscription receipt"} onClose={() => setOpen(false)} onDiscard={reset} onSaveDraft={() => setOpen(false)}>{action && <Form key={action.key} operation={action.kind === "payment" ? "subscription.payment.record" : action.kind === "void" ? "subscription.invoice.void" : "subscription.payment.reverse"} label={action.kind === "payment" ? "Record received payment" : action.kind === "void" ? "Confirm invoice void" : "Confirm receipt reversal"} feedbackText={action.kind === "payment" ? "Subscription payment receipt recorded." : "Subscription correction recorded."} submit={async data => {
      const path = action.kind === "payment" ? `${base}/payments` : action.kind === "void" ? `${base}/void` : `${base}/payments/${encodeURIComponent(action.paymentId!)}/reverse`;
      const body = { expectedVersion: action.invoice.version, submissionKey: action.key, ...(action.kind === "payment" ? { amount: str(data, "amount"), receivedOn: str(data, "receivedOn"), paymentReference: str(data, "paymentReference") } : { reason: str(data, "reason") }) };
      await api(path, { method: "POST", body }); reset(); resource.reload();
    }}><p>{action.invoice.reference} · {formatMonth(action.invoice.periodStart)} · Outstanding {dollars(action.invoice.balanceCents)}</p><p className="help">If the invoice changes elsewhere, discard this review and reopen it before saving.</p>{action.kind === "payment" ? <><p className="help">Record this only after money was received outside Property Flow. Recording a receipt does not collect money.</p><label>Received amount (USD)<input name="amount" type="number" required min="0.01" max={(action.invoice.balanceCents / 100).toFixed(2)} step="0.01" inputMode="decimal"/></label><label>Received on<input name="receivedOn" type="date" required defaultValue={today()}/></label><label>Payment reference<input name="paymentReference" required maxLength={200}/></label></> : <><p className="help">{action.kind === "void" ? "Voiding retains the invoice and its history. Reverse recorded receipts before voiding. A replacement invoice can be issued for the same month after this correction." : "Reversal corrects this recorded receipt and restores its amount to the invoice balance. It does not return money to the company."}</p><label>Correction reason<textarea name="reason" required maxLength={500}/></label></>}</Form>}</EditorDialog>}
  </>;
}
