import { useState } from "react";
import { api } from "../api";
import { useResource } from "../useResource";
import { Form } from "../components/Form";
import { EditorDialog } from "../components/EditorDialog";
import { dollars } from "../money";
import { formatActivityDate } from "../dates";
import type { Feature, MonthlyPlan } from "../company-subscription-types";

export function PlatformPlans() {
  const resource = useResource<{ items: MonthlyPlan[]; catalog: Feature[] }>("/api/platform/plans", true);
  const [open, setOpen] = useState(false), [key, setKey] = useState(() => crypto.randomUUID()), [draft, setDraft] = useState(false);
  const [availability, setAvailability] = useState<MonthlyPlan | null>(null), [availabilityOpen, setAvailabilityOpen] = useState(false);
  const reset = () => { setOpen(false); setDraft(false); setKey(crypto.randomUUID()); };
  return <>
    <header className="page-heading"><p className="eyebrow">Platform administration</p><h1>Monthly plans</h1><p>Define monthly pricing and included features, then assign a published plan from a company's administration page.</p></header>
    <p className="notice">Each publication is a new plan revision. Existing company subscriptions and issued invoices retain their assigned price and features. Publishing a plan does not charge a company.</p>
    <button onClick={() => { setOpen(true); setDraft(true); }}>{draft ? "Continue plan draft" : "Publish monthly plan"}</button>
    {availability && !availabilityOpen && <button className="secondary" onClick={() => setAvailabilityOpen(true)}>Continue plan availability review</button>}
    {resource.error && <p className="notice error" role="alert">{resource.error} <button className="secondary" onClick={resource.reload}>Retry plans</button></p>}
    {!resource.data && !resource.error && <p role="status">Loading monthly plans…</p>}
    {resource.data && <section className="panel"><h2>Published plan revisions</h2>{resource.data.items.length ? <div className="table-wrap"><table><thead><tr><th scope="col">Plan</th><th scope="col">Monthly price</th><th scope="col">Included features</th><th scope="col">Published</th><th scope="col">Availability</th></tr></thead><tbody>{resource.data.items.map(plan => <tr key={plan.id}><td><strong>{plan.name}</strong><br/>Revision {plan.version}{plan.archivedAt && " · Archived"}</td><td>{dollars(plan.monthlyPriceCents)} USD</td><td>{plan.features.map(key => resource.data!.catalog.find(feature => feature.key === key)?.label || key).join(", ") || "No features included"}</td><td>{formatActivityDate(plan.createdAt)}</td><td><button className="secondary" disabled={!!availability} onClick={() => { setAvailability(plan); setAvailabilityOpen(true); }}>{plan.archivedAt ? "Restore" : "Archive"} {plan.name} revision {plan.version}</button></td></tr>)}</tbody></table></div> : <p>No monthly plans have been published. Set the intended price and included features to create the first plan.</p>}</section>}
    <EditorDialog open={availabilityOpen} title={availability?.archivedAt ? "Restore plan availability" : "Archive plan availability"} onClose={() => setAvailabilityOpen(false)} onDiscard={() => { setAvailability(null); setAvailabilityOpen(false); }} onSaveDraft={() => setAvailabilityOpen(false)} draftable={false}>
      {availability && <Form operation="plan.availability" label={availability.archivedAt ? "Restore plan" : "Archive plan"} feedbackText="Plan availability saved." submit={async () => {
        await api(`/api/platform/plans/${encodeURIComponent(availability.id)}/archive`, { method: "PATCH", body: { archived: !availability.archivedAt, expectedArchivedAt: availability.archivedAt } });
        setAvailabilityOpen(false); setAvailability(null); resource.reload();
      }}><p><strong>{availability.name} · Revision {availability.version}</strong> · {dollars(availability.monthlyPriceCents)} per month.</p><p>{availability.archivedAt ? "Restoring makes this revision available for new company assignments." : "Archiving prevents new company assignments to this revision. Existing assignments, prices and invoice history remain in place."}</p></Form>}
    </EditorDialog>
    <EditorDialog open={open} title="Publish monthly plan" onClose={() => setOpen(false)} onDiscard={reset} onSaveDraft={() => setOpen(false)}>
      {resource.data && <Form key={key} label="Publish plan revision" operation="plan.publish" successText="Plan revision published." feedbackText="Monthly plan published." submit={async data => {
        await api("/api/platform/plans", { method: "POST", body: { name: String(data.get("name") || ""), monthlyPrice: String(data.get("monthlyPrice") || ""), features: data.getAll("features").map(String), submissionKey: key } });
        reset(); resource.reload();
      }}>
        <fieldset><legend>Monthly pricing</legend><div className="form-grid"><label>Plan name<input name="name" required maxLength={100}/></label><label>Monthly price (USD)<input name="monthlyPrice" required type="number" min="0" max="1000000" step="0.01" inputMode="decimal"/></label></div><p className="help">Use an existing plan name to publish its next revision. Enter zero only for an intentionally free plan.</p></fieldset>
        <fieldset><legend>Included features</legend><p className="help">Choose the product areas included in this revision. Company roles and property access continue to apply.</p><div className="plan-feature-choices">{resource.data.catalog.map(feature => <label key={feature.key} className="plan-feature-option"><input name="features" type="checkbox" value={feature.key} aria-label={feature.label}/><span><strong>{feature.label}</strong><span className="help">{feature.description}</span></span></label>)}</div></fieldset>
      </Form>}
    </EditorDialog>
  </>;
}
