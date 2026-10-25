import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { formatActivityTime, formatDate } from "../dates";
import { useResource } from "../useResource";
import { DateField } from "../components/DateField";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { prospectSourceContext, withProspectContext } from "../prospect-context";
import { ProspectAcquisition, useAcquisitionResource } from "./RentalApplications";
import { AcquisitionRecovery } from "../components/AcquisitionRecovery";
import { hasAcquisitionRecovery, useAcquisitionMutation } from "../acquisition-mutations";
import { tenantEditorScope } from "../tenant-write-access";
import "./Prospects.css";

type Stage = "inquiry" | "tour" | "application" | "review" | "approved" | "declined" | "withdrawn" | "converted";
type Prospect = {
  id: string; companyId: string; propertyId: string; unitId: string | null;
  name: string; email: string | null; phone: string | null; source: string;
  desiredMoveIn: string | null; followUpOn: string | null; notes: string | null;
  stage: Stage; version: number; contactId: string | null; leaseId: string | null;
  createdAt: string; updatedAt: string; property: { id: string; name: string }; unit: { id: string; label: string } | null;
};
type Action = { id: string; version: number; action: string; reason: string; snapshot: Partial<Prospect> & { previousContactId?: string; previousLeaseId?: string; applicationId?: string }; createdAt: string };
type Page<T> = { items: T[]; nextCursor: string | null };
type Directory = Page<Prospect> & { total: number; counts: Record<Stage, number>; today: string; timezone: string };
type Contact = { id: string; name: string; email: string | null; version: number };
type CandidateLease = { id: string; version: number; propertyId: string; unitId: string; startsOn: string; endsOn: string | null; status: string; unit: { id: string; label: string } };
type ConversionOptions = { contacts: Contact[]; nextCursor: string | null; leases: CandidateLease[]; nextLeaseCursor?: string | null };
const stages: [Stage, string][] = [["inquiry", "Inquiry"], ["tour", "Tour / follow-up"], ["application", "Application recorded"], ["review", "Under review"], ["approved", "Approved"], ["declined", "Declined"], ["withdrawn", "Withdrawn"], ["converted", "Linked to tenant & lease"]];
const stageLabel = (stage: string) => stages.find(([key]) => key === stage)?.[1] || stage;
const sources = [["phone", "Phone"], ["email", "Email"], ["walk_in", "Walk-in"], ["referral", "Referral"], ["other", "Other"]];
const sourceLabel = (source: string) => sources.find(([key]) => key === source)?.[1] || source;
const base = "/api/company/prospects";
const text = (form: FormData, key: string) => String(form.get(key) || "");
const optional = (form: FormData, key: string) => text(form, key) || null;
const propertyPath = (id: string) => `/company/properties/${encodeURIComponent(id)}`;
function terminal(stage: Stage) { return ["declined", "withdrawn", "converted"].includes(stage); }
function readableAction(action: string) { return ({ created: "Inquiry recorded", updated: "Contact or follow-up updated", stage: "Stage reviewed", "stage.changed": "Stage reviewed", converted: "Tenant and lease linked", "conversion.reopened": "Conversion link corrected" } as Record<string, string>)[action] || "Prospect review recorded"; }
function Load({ error, retry, label = "prospects" }: { error?: string; retry: () => void; label?: string }) {
  return error ? <p className="notice error" role="alert">{error} <button className="secondary" onClick={retry}>Retry {label}</button></p> : <p role="status">Loading {label}…</p>;
}
type ProspectMutation = ReturnType<typeof useAcquisitionMutation>;
function ProspectAccessUnavailable() { return <section className="notice error" role="alert"><h2>Prospect access unavailable</h2><p>The private review is hidden. Any original interrupted request is kept for authorized recovery.</p><button type="button" onClick={() => window.location.reload()}>Reload workspace</button></section>; }
function ProspectRequestForm({ mutation, ...props }: ComponentProps<typeof Form> & { mutation: ProspectMutation }) {
  const { data } = useAuth(), readOnly = !!data?.impersonation || [data?.companyFeatures?.leasing, data?.companyFeatures?.properties].some(value => value === "read_only" || value === "disabled");
  return <>{readOnly && <p className="notice" role="status">Prospect changes are read-only. Your review and original interrupted request are kept.</p>}<fieldset disabled={readOnly} className="editor-contents"><Form {...props} recovering={mutation.pending}><fieldset disabled={mutation.pending} className="editor-contents">{props.children}</fieldset></Form></fieldset></>;
}
function ProspectPendingSummary({ mutation }: { mutation: ProspectMutation }) {
  const payload = mutation.request?.body || mutation.initial?.body || {};
  const labels: Record<string, string> = { name: "Original prospect name", email: "Contact email", phone: "Phone", source: "Inquiry source", desiredMoveIn: "Desired move-in", followUpOn: "Follow-up date", notes: "Original management notes", propertyId: "Original property reference", unitId: "Original unit reference", stage: "Reviewed stage", expectedVersion: "Opening prospect version", contactId: "Reviewed tenant reference", expectedContactVersion: "Reviewed tenant version", leaseId: "Reviewed lease reference", expectedLeaseVersion: "Reviewed lease version", reason: "Review reason" };
  return <section className="editor-section"><h3>Original interrupted prospect request</h3><p className="help">The person, source versions, original company and submission reference are locked. Retry this exact request; current record changes do not silently replace it.</p><dl className="lease-review-summary">{Object.entries(labels).filter(([name]) => payload[name] !== undefined && payload[name] !== null && payload[name] !== "").map(([name, label]) => <div key={name}><dt>{label}</dt><dd className="preserve-lines">{["desiredMoveIn", "followUpOn"].includes(name) ? formatDate(String(payload[name])) : String(payload[name]).slice(0, 5000)}</dd></div>)}</dl></section>;
}
function ProspectCurrentRecovery({ mutation, id, resolved }: { mutation: ProspectMutation; id?: string; resolved: () => void }) {
  const key = String(mutation.request?.body.submissionKey || mutation.initial?.body.submissionKey || "");
  return <AcquisitionRecovery mutation={mutation} sourcePath={id ? `${base}/${encodeURIComponent(id)}` : `${base}/recovery/${encodeURIComponent(key)}`} sourceId={id || key} resolved={resolved}/>;
}
function Pager({ previous, next, back, forward, label }: { previous: boolean; next: boolean; back: () => void; forward: () => void; label: string }) {
  return <div className="actions"><button type="button" className="secondary" disabled={!previous} onClick={back}>Previous {label}</button><button type="button" className="secondary" disabled={!next} onClick={forward}>Next {label}</button></div>;
}

export function Prospects() { const { data } = useAuth(); return <ProspectsWorkspace key={tenantEditorScope(data)}/>; }
function ProspectsWorkspace() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("prospectId") || "";
  const select = (id: string) => setParams(previous => { const next = new URLSearchParams(previous); id ? next.set("prospectId", id) : next.delete("prospectId"); return next; });
  return <>
    <div hidden={!!selected}><ProspectDirectory selected={select}/></div>
    {selected && <ProspectRecord key={selected} id={selected} back={() => select("")}/>}
  </>;
}

function ProspectDirectory({ selected }: { selected: (id: string) => void }) {
  const { data } = useAuth();
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["q", "propertyId", "stage", "due", "cursor"]) if (params.get(key)) query.set(key, params.get(key)!);
  const resource = useAcquisitionResource<Directory>(`${base}?${query}`, true, true);
  const properties = useResource<{ id: string; name: string }[]>("/api/company/properties");
  const mutation = useAcquisitionMutation("prospect:new");
  const [adding, setAdding] = useState(!!mutation.initial), [draft, setDraft] = useState(!!mutation.initial), [key, setKey] = useState(() => crypto.randomUUID());
  const authorized = useRef(false);
  if ([401, 403, 404].includes(resource.errorStatus || 0)) authorized.current = false;
  else if (resource.data) authorized.current = true;
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = params.get("cursor") || "";
  useEffect(() => { setCursors(previous => !cursor ? [] : previous.includes(cursor) ? previous.slice(0, previous.indexOf(cursor) + 1) : []); }, [cursor]);
  const readOnly = !!data?.impersonation || data?.companyFeatures?.leasing === "read_only" || data?.companyFeatures?.properties === "read_only";
  const reset = () => { setAdding(false); setDraft(false); setKey(crypto.randomUUID()); };
  function filter(values: Record<string, string>) {
    const next = new URLSearchParams(params); next.delete("cursor");
    for (const [field, value] of Object.entries(values)) value ? next.set(field, value) : next.delete(field);
    setParams(next); setCursors([]);
  }
  function forward() { if (!resource.data?.nextCursor) return; const next = new URLSearchParams(params); next.set("cursor", resource.data.nextCursor); setCursors(previous => [...previous, resource.data!.nextCursor!]); setParams(next); }
  function back() { const previous = cursors.slice(0, -1), next = new URLSearchParams(params); previous.length ? next.set("cursor", previous[previous.length - 1]) : next.delete("cursor"); setCursors(previous); setParams(next); }
  if (mutation.denied) return <ProspectAccessUnavailable/>;
  return <>
    <header className="page-heading"><p className="eyebrow">Leasing operations</p><h1>Prospects</h1><p>Follow inquiries, tours, manual applications and reviewed decisions through the tenant and lease handoff.</p></header>
    <p className="notice">These are management records. An approval does not sign a lease, verify screening, create an account or grant portal access. Follow-up dates are a work queue; no message or calendar invitation is sent.</p>
    <button disabled={readOnly} onClick={() => { setDraft(true); setAdding(true); }}>{draft ? "Continue inquiry draft" : "Record inquiry"}</button>
    <form className="panel prospect-filters" key={`${params.get("q")}:${params.get("propertyId")}:${params.get("stage")}:${params.get("due")}`} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); filter(Object.fromEntries(["q", "propertyId", "stage", "due"].map(field => [field, text(form, field)]))); }}>
      <label>Find a prospect<input name="q" type="search" maxLength={200} defaultValue={params.get("q") || ""}/></label>
      <label>Property<select name="propertyId" defaultValue={params.get("propertyId") || ""}><option value="">All properties</option>{properties.data?.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
      <label>Stage<select name="stage" defaultValue={params.get("stage") || ""}><option value="">All stages</option>{stages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Follow-up<select name="due" defaultValue={params.get("due") || ""}><option value="">All follow-ups</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Today and the next 7 days</option></select></label>
      <div className="actions"><button className="secondary" type="submit">Apply prospect filters</button><button className="text-button" type="button" onClick={() => filter({ q: "", propertyId: "", stage: "", due: "" })}>Clear prospect filters</button></div>
    </form>
    {properties.error && <p className="notice error" role="alert">Properties could not load. <button className="secondary" onClick={properties.reload}>Retry properties</button></p>}
    {!resource.data && <Load error={resource.error} retry={resource.reload}/>}
    {resource.data && <section className="panel"><div className="section-heading"><h2>Leasing pipeline</h2><strong>{resource.data.total.toLocaleString()} matching {resource.data.total === 1 ? "prospect" : "prospects"}</strong></div><p className="help">Follow-ups use {resource.data.timezone}; today is {formatDate(resource.data.today)}. Closed and converted records are excluded from follow-up queues.</p>{resource.error && <Load error={resource.error} retry={resource.reload}/>}
      <p className="help">Stage totals cover the selected property, search and follow-up queue before applying a stage filter.</p><dl className="prospect-counts" aria-label="Matching prospect stages">{stages.map(([stage, label]) => <div key={stage}><dt>{label}</dt><dd>{resource.data!.counts[stage] ?? 0}</dd></div>)}</dl>
      {!resource.data.items.length ? <p>No prospects match these filters. Record an inquiry or review the selected filters.</p> : <div className="table-wrap"><table className="prospect-table"><thead><tr><th scope="col">Prospect</th><th scope="col">Property & preference</th><th scope="col">Stage</th><th scope="col">Dates</th><th scope="col">Action</th></tr></thead><tbody>{resource.data.items.map(prospect => <tr key={prospect.id}><td><strong>{prospect.name}</strong>{prospect.email && <p>{prospect.email}</p>}{prospect.phone && <p>{prospect.phone}</p>}<span className="help">{sourceLabel(prospect.source)}</span></td><td><Link to={propertyPath(prospect.propertyId)}>{prospect.property.name}</Link><p>{prospect.unit?.label || "No preferred unit"}</p></td><td>{stageLabel(prospect.stage)}</td><td><p>Move-in: {formatDate(prospect.desiredMoveIn, "Not recorded")}</p><p>{terminal(prospect.stage) ? "Recorded follow-up" : "Follow-up"}: {formatDate(prospect.followUpOn, "Not scheduled")}</p></td><td><button className="secondary" onClick={() => selected(prospect.id)}>Open {prospect.name}</button></td></tr>)}</tbody></table></div>}
      <Pager label="prospects" previous={!!cursor} next={!!resource.data.nextCursor} back={back} forward={forward}/>
    </section>}
    {authorized.current && <EditorDialog open={adding} title="Record prospect inquiry" onClose={() => setAdding(false)} onDiscard={reset} onSaveDraft={() => setAdding(false)}>
      <ProspectCurrentRecovery mutation={mutation} resolved={reset}/>
      <ProspectRequestForm mutation={mutation} key={key} operation="prospect.create" label="Record inquiry" feedbackText="Prospect inquiry recorded." submit={async form => {
        const created = await mutation.run<Prospect | { prospect: Prospect }>(base, "POST", { ...prospectFields(form), propertyId: text(form, "propertyId"), reason: text(form, "reason") });
        const prospect = "prospect" in created ? created.prospect : created;
        if (mutation.current()) { reset(); resource.reload(); selected(prospect.id); }
      }}>{mutation.initial && mutation.pending ? <ProspectPendingSummary mutation={mutation}/> : <><ProspectFields properties={properties.data || []} defaultProperty={params.get("propertyId") || ""}/><label>Reason for recording this inquiry<textarea name="reason" required maxLength={500}/></label></>}</ProspectRequestForm>
    </EditorDialog>}
  </>;
}

function prospectFields(form: FormData) {
  return { name: text(form, "name"), email: optional(form, "email"), phone: optional(form, "phone"), source: text(form, "source"), unitId: optional(form, "unitId"), desiredMoveIn: optional(form, "desiredMoveIn"), followUpOn: optional(form, "followUpOn"), notes: optional(form, "notes") };
}
function ProspectFields({ prospect, properties = [], defaultProperty = "" }: { prospect?: Prospect; properties?: { id: string; name: string }[]; defaultProperty?: string }) {
  const [propertyId, setProperty] = useState(prospect?.propertyId || defaultProperty);
  return <><fieldset><legend>Prospect contact</legend><label>Name<input name="name" required maxLength={200} defaultValue={prospect?.name}/></label><div className="form-grid"><label>Email (email or phone required)<input type="email" name="email" maxLength={254} defaultValue={prospect?.email || ""}/></label><label>Phone (email or phone required)<input type="tel" name="phone" maxLength={40} defaultValue={prospect?.phone || ""}/></label></div><label>Inquiry source<select name="source" defaultValue={prospect?.source || "phone"}>{sources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></fieldset>
    <fieldset><legend>Rental preference & follow-up</legend>{prospect ? <p>Property: <strong>{prospect.property.name}</strong></p> : <label>Property<select name="propertyId" required value={propertyId} onChange={event => setProperty(event.target.value)}><option value="">Choose a property</option>{properties.map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>}{propertyId && <UnitPreference key={propertyId} propertyId={propertyId} initial={prospect?.unit || null}/>}<div className="form-grid"><label>Desired move-in (optional)<DateField aria-label="Desired move-in (optional)" name="desiredMoveIn" defaultValue={prospect?.desiredMoveIn?.slice(0, 10) || ""}/></label><label>Next follow-up (optional)<DateField aria-label="Next follow-up (optional)" name="followUpOn" defaultValue={prospect?.followUpOn?.slice(0, 10) || ""}/></label></div></fieldset>
    <label>Management notes (optional)<textarea name="notes" rows={4} maxLength={2000} defaultValue={prospect?.notes || ""}/></label><p className="help">Keep operational notes here. Screening files, credentials and sensitive applicant dossiers are outside this workflow. No contact record, sign-in account or portal permission is created by recording an inquiry.</p>
  </>;
}
function UnitPreference({ propertyId, initial }: { propertyId: string; initial: { id: string; label: string } | null }) {
  const [cursor, setCursor] = useState("");
  const [options, setOptions] = useState<{ id: string; label: string; status: string }[]>([]), [selected, setSelected] = useState(initial?.id || "");
  const resource = useResource<Page<{ id: string; label: string; status: string }>>(`/api/company/properties/${encodeURIComponent(propertyId)}/units?${new URLSearchParams(cursor ? { cursor } : {})}`);
  useEffect(() => { if (resource.data) setOptions(previous => [...new Map([...previous, ...resource.data!.items.filter(unit => unit.status === "active")].map(unit => [unit.id, unit])).values()]); }, [resource.data]);
  return <div><label>Preferred unit (optional)<select name="unitId" value={selected} onChange={event => setSelected(event.target.value)}><option value="">No preferred unit</option>{initial && !options.some(unit => unit.id === initial.id) && <option value={initial.id}>{initial.label} · recorded preference</option>}{options.map(unit => <option key={unit.id} value={unit.id}>{unit.label}</option>)}</select></label>{!resource.data && <Load error={resource.error} retry={resource.reload} label="units"/>}{resource.data?.nextCursor && <button className="text-button" type="button" onClick={() => setCursor(resource.data!.nextCursor!)}>Load more preferred units</button>}<p className="help">A unit preference does not reserve a unit or alter availability.</p></div>;
}

type EditReview = { kind: "edit" | "stage" | "convert" | "unlink"; prospect: Prospect; key: string };
function ProspectRecord({ id, back }: { id: string; back: () => void }) {
  const { data } = useAuth();
  const [params] = useSearchParams();
  const sourceContext = new URLSearchParams(prospectSourceContext(params, id));
  const resource = useAcquisitionResource<{ prospect: Prospect; history: Page<Action> }>(`${base}/${encodeURIComponent(id)}`, true, true);
  const editMutation = useAcquisitionMutation(`prospect:${id}:edit`), stageMutation = useAcquisitionMutation(`prospect:${id}:stage`), conversionMutation = useAcquisitionMutation(`prospect:${id}:convert`), unlinkMutation = useAcquisitionMutation(`prospect:${id}:unlink`);
  const mutations = { edit: editMutation, stage: stageMutation, convert: conversionMutation, unlink: unlinkMutation };
  const pendingKind = (Object.keys(mutations) as EditReview["kind"][]).find(kind => mutations[kind].pending);
  const [review, setReview] = useState<EditReview | null>(null), [open, setOpen] = useState(false);
  useEffect(() => { if (!review && pendingKind && resource.data) { setReview({ kind: pendingKind, prospect: resource.data.prospect, key: crypto.randomUUID() }); setOpen(true); } }, [review, pendingKind, resource.data]);
  const readOnly = !!data?.impersonation || data?.companyFeatures?.leasing === "read_only" || data?.companyFeatures?.properties === "read_only";
  const reset = () => { setReview(null); setOpen(false); };
  const discard = () => { reset(); resource.reload(); };
  function begin(kind: EditReview["kind"]) { if (!resource.data || review || pendingKind) return; setReview({ kind, prospect: resource.data.prospect, key: crypto.randomUUID() }); setOpen(true); }
  if (Object.values(mutations).some(mutation => mutation.denied)) return <ProspectAccessUnavailable/>;
  if (!resource.data) return <><button className="text-button" onClick={back}>← Prospect list</button><Load error={resource.error} retry={resource.reload}/></>;
  const prospect = resource.data.prospect;
  const title = review?.kind === "convert" ? "Review tenant and lease handoff" : review?.kind === "unlink" ? "Correct prospect conversion link" : review?.kind === "stage" ? "Review prospect stage" : "Edit prospect details";
  return <>
    <button className="text-button" onClick={back}>← Prospect list</button>
    <header className="page-heading"><p className="eyebrow">Leasing prospect</p><h1>{prospect.name}</h1><p>{stageLabel(prospect.stage)} · <Link to={propertyPath(prospect.propertyId)}>{prospect.property.name}</Link>{prospect.unit && ` · ${prospect.unit.label}`}</p></header>
    {resource.error && <Load error={resource.error} retry={resource.reload}/>}
    <section className="panel"><div className="section-heading"><h2>Inquiry & follow-up</h2>{!readOnly && prospect.stage !== "converted" && <div className="actions"><button className="secondary" disabled={!!review} onClick={() => begin("edit")}>Edit prospect details</button><button className="secondary" disabled={!!review} onClick={() => begin("stage")}>{["declined", "withdrawn"].includes(prospect.stage) ? "Reopen prospect" : "Review stage"}</button></div>}</div>
      <dl className="prospect-facts"><div><dt>Email</dt><dd>{prospect.email || "Not recorded"}</dd></div><div><dt>Phone</dt><dd>{prospect.phone || "Not recorded"}</dd></div><div><dt>Source</dt><dd>{sourceLabel(prospect.source)}</dd></div><div><dt>Desired move-in</dt><dd>{formatDate(prospect.desiredMoveIn, "Not recorded")}</dd></div><div><dt>{terminal(prospect.stage) ? "Recorded follow-up" : "Next follow-up"}</dt><dd>{formatDate(prospect.followUpOn, "Not scheduled")}</dd></div><div><dt>Updated</dt><dd>{formatActivityTime(prospect.updatedAt)}</dd></div></dl><h3>Management notes</h3><p className="prospect-notes">{prospect.notes || "No management notes recorded."}</p>
      {prospect.stage === "approved" && <div className="notice"><p>Approval records a manual management decision. Confirm the exact person, then link an existing account-backed tenant and its matching draft or active lease.</p>{!readOnly && <button disabled={!!review} onClick={() => begin("convert")}>Review tenant & lease link</button>}</div>}
      {prospect.stage === "converted" && <div className="notice"><strong>Tenant and lease handoff recorded</strong><p>The original prospect and its decision history remain unchanged. Manage later account or rental changes from the source records.</p><div className="actions">{prospect.contactId && <Link to={withProspectContext(`/company/tenants/${encodeURIComponent(prospect.contactId)}`,sourceContext)}>Open linked tenant</Link>}{prospect.leaseId && <Link to={withProspectContext(`/company/leases/${encodeURIComponent(prospect.leaseId)}`,sourceContext)}>Open linked lease</Link>}{!readOnly && <button className="secondary" disabled={!!review} onClick={() => begin("unlink")}>Correct conversion link</button>}</div></div>}
      {review && !open && <p className="notice">A review is kept on this page. <button className="secondary" onClick={() => setOpen(true)}>Continue prospect review</button></p>}
    </section>
    <ProspectAcquisition id={id}/>
    <section className="panel"><h2>Recorded history</h2><ProspectHistory key={`${id}:${prospect.version}`} id={id} initial={resource.data.history}/></section>
    <EditorDialog open={open} title={title} onClose={() => setOpen(false)} onDiscard={discard} onSaveDraft={() => setOpen(false)}>
      {review && <ProspectCurrentRecovery mutation={mutations[review.kind]} id={id} resolved={() => { reset(); resource.reload(); }}/>}
      {review?.kind === "edit" && <EditProspectReview key={review.key} review={review} readOnly={readOnly} mutation={editMutation} saved={() => { reset(); resource.reload(); }}/>}
      {review?.kind === "stage" && <StageReview key={review.key} review={review} readOnly={readOnly} mutation={stageMutation} saved={() => { reset(); resource.reload(); }}/>}
      {review?.kind === "convert" && <ConversionReview key={review.key} review={review} readOnly={readOnly} mutation={conversionMutation} saved={() => { reset(); resource.reload(); }}/>}
      {review?.kind === "unlink" && <UnlinkProspectReview key={review.key} review={review} readOnly={readOnly} mutation={unlinkMutation} saved={() => { reset(); resource.reload(); }}/>}
    </EditorDialog>
  </>;
}

function ProspectHistory({ id, initial }: { id: string; initial: Page<Action> }) {
  const [cursors, setCursors] = useState<string[]>([]);
  if (!cursors.length) return <HistoryRows id={id} page={initial} previous={false} back={() => {}} forward={() => setCursors([initial.nextCursor!])}/>;
  return <FetchedHistory id={id} cursor={cursors[cursors.length - 1]} back={() => setCursors(previous => previous.slice(0, -1))} forward={cursor => setCursors(previous => [...previous, cursor])}/>;
}
function FetchedHistory({ id, cursor, back, forward }: { id: string; cursor: string; back: () => void; forward: (cursor: string) => void }) {
  const resource = useResource<Page<Action>>(`${base}/${encodeURIComponent(id)}/history?${new URLSearchParams({ cursor })}`);
  return resource.data ? <HistoryRows id={id} page={resource.data} previous back={back} forward={() => forward(resource.data!.nextCursor!)}/> : <Load error={resource.error} retry={resource.reload} label="prospect history"/>;
}
function HistoryRows({ id, page, previous, back, forward }: { id: string; page: Page<Action>; previous: boolean; back: () => void; forward: () => void }) {
  const [params] = useSearchParams();
  const context = new URLSearchParams(prospectSourceContext(params,id));
  return <>{page.items.length ? <ol className="record-list">{page.items.map(action => <li key={action.id}><strong>Revision {action.version} · {readableAction(action.action)}</strong><p>{action.reason}</p><p className="help">{action.snapshot.stage ? stageLabel(action.snapshot.stage) + " · " : ""}{formatActivityTime(action.createdAt)}{action.snapshot.followUpOn ? ` · Follow-up ${formatDate(action.snapshot.followUpOn)}` : ""}</p><div className="actions">{action.snapshot.applicationId && <Link to={withProspectContext(`/company/applications/${encodeURIComponent(action.snapshot.applicationId)}`,context)}>Application source from this review</Link>}{(action.snapshot.contactId || action.snapshot.previousContactId) && <Link to={withProspectContext(`/company/tenants/${encodeURIComponent(action.snapshot.contactId || action.snapshot.previousContactId!)}`,context)}>{action.snapshot.previousContactId ? "Previous tenant source" : "Tenant source from this review"}</Link>}{(action.snapshot.leaseId || action.snapshot.previousLeaseId) && <Link to={withProspectContext(`/company/leases/${encodeURIComponent(action.snapshot.leaseId || action.snapshot.previousLeaseId!)}`,context)}>{action.snapshot.previousLeaseId ? "Previous lease source" : "Lease source from this review"}</Link>}</div></li>)}</ol> : <p>No history has been recorded.</p>}<Pager label="history" previous={previous} next={!!page.nextCursor} back={back} forward={forward}/></>;
}

type ProspectReviewProps = { review: EditReview; readOnly: boolean; mutation: ProspectMutation; saved: () => void };
function InterruptedProspectAction({ review, mutation, saved }: ProspectReviewProps) {
  const labels = { edit: "Save prospect details", stage: "Save reviewed stage", convert: "Confirm tenant & lease link", unlink: "Confirm conversion link correction" };
  const suffix = { edit: "", stage: "/stage", convert: "/convert", unlink: "/reopen-conversion" };
  return <ProspectRequestForm mutation={mutation} operation={review.kind === "convert" ? "prospect.convert" : review.kind === "edit" ? "prospect.update" : "prospect.stage"} label={labels[review.kind]} submit={async () => { await mutation.run(`${base}/${encodeURIComponent(review.prospect.id)}${suffix[review.kind]}`, review.kind === "edit" ? "PATCH" : "POST", {}); if (mutation.current()) saved(); }}><ProspectPendingSummary mutation={mutation}/></ProspectRequestForm>;
}
function EditProspectReview(props: ProspectReviewProps) {
  if (props.mutation.initial && props.mutation.pending) return <InterruptedProspectAction {...props}/>;
  const { review, mutation, saved } = props;
  return <ProspectRequestForm mutation={mutation} operation="prospect.update" label="Save prospect details" feedbackText="Prospect details saved." submit={async form => { await mutation.run(`${base}/${encodeURIComponent(review.prospect.id)}`, "PATCH", { ...prospectFields(form), expectedVersion: review.prospect.version, reason: text(form, "reason") }); if (mutation.current()) saved(); }}><ProspectFields prospect={review.prospect}/><label>Reason for this update<textarea name="reason" required maxLength={500}/></label><p className="help">The original property, version and person stay attached. Changed sources require a new explicit review.</p></ProspectRequestForm>;
}
function UnlinkProspectReview(props: ProspectReviewProps) {
  if (props.mutation.initial && props.mutation.pending) return <InterruptedProspectAction {...props}/>;
  const { review, mutation, saved } = props;
  return <ProspectRequestForm mutation={mutation} operation="prospect.stage" label="Confirm conversion link correction" feedbackText="Conversion link corrected; prospect returned to review." submit={async form => { if (form.get("confirmedUnlink") !== "on") throw new Error("Confirm that only the prospect conversion link will change."); await mutation.run(`${base}/${encodeURIComponent(review.prospect.id)}/reopen-conversion`, "POST", { expectedVersion: review.prospect.version, confirmedUnlink: true, reason: text(form, "reason") }); if (mutation.current()) saved(); }}><p>This corrects only this prospect's source link. Tenant accounts, leases, access and money remain unchanged.</p><label className="prospect-match"><input type="checkbox" name="confirmedUnlink" required/>I confirm that only the prospect link is being corrected; tenant and lease records remain unchanged.</label><label>Reason for correcting the conversion link<textarea name="reason" required maxLength={500}/></label></ProspectRequestForm>;
}
function StageReview(props: ProspectReviewProps) { return props.mutation.initial && props.mutation.pending ? <InterruptedProspectAction {...props}/> : <StageDraftReview {...props}/>; }
function ConversionReview(props: ProspectReviewProps) { return props.mutation.initial && props.mutation.pending ? <InterruptedProspectAction {...props}/> : <ConversionDraftReview {...props}/>; }
function StageDraftReview({ review, readOnly, mutation, saved }: ProspectReviewProps) {
  const prospect = review.prospect;
  const choices = ["declined", "withdrawn"].includes(prospect.stage) ? stages.filter(([stage]) => ["inquiry", "review"].includes(stage)) : stages.filter(([stage]) => stage !== "converted" && stage !== prospect.stage);
  return <ProspectRequestForm mutation={mutation} operation="prospect.stage" label="Save reviewed stage" feedbackText="Prospect stage recorded." submit={async form => { if (readOnly) throw new Error("Prospect changes are read-only under the current company settings."); await mutation.run(`${base}/${encodeURIComponent(prospect.id)}/stage`, "POST", { expectedVersion: prospect.version, stage: text(form, "stage"), reason: text(form, "reason") }); if (mutation.current()) saved(); }}><p><strong>{prospect.name}</strong> · Current stage: {stageLabel(prospect.stage)}</p><label>New stage<select name="stage" required defaultValue={choices[0]?.[0]}>{choices.map(([stage, label]) => <option key={stage} value={stage}>{label}</option>)}</select></label><label>Decision or stage-change reason<textarea name="reason" required maxLength={500}/></label><p className="help">Record your actual management review. Approval does not verify screening, sign a contract, create a tenant account or grant resident access. Declined and withdrawn inquiries can be reopened through a new reviewed stage change.</p></ProspectRequestForm>;
}

function ConversionDraftReview({ review, readOnly, mutation, saved }: ProspectReviewProps) {
  const prospect = review.prospect;
  const [origin] = useSearchParams();
  const context = new URLSearchParams(prospectSourceContext(origin,prospect.id));
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [contactCursors, setContactCursors] = useState<string[]>([]), [leaseCursors, setLeaseCursors] = useState<string[]>([]);
  const [contact, setContact] = useState<Contact | null>(null), [lease, setLease] = useState<CandidateLease | null>(null), [confirmed, setConfirmed] = useState(false);
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (contactCursors.length) params.set("cursor", contactCursors[contactCursors.length - 1]);
  if (contact) params.set("contactId", contact.id);
  if (leaseCursors.length) params.set("leaseCursor", leaseCursors[leaseCursors.length - 1]);
  const options = useResource<ConversionOptions>(`${base}/${encodeURIComponent(prospect.id)}/conversion-options?${params}`);
  const tenantSetup = withProspectContext(`/company/residents?${new URLSearchParams({ propertyId: prospect.propertyId })}`,context);
  const leaseSetup = withProspectContext(`/company/leases?${new URLSearchParams({ new: "lease", propertyId: prospect.propertyId, ...(contact ? { contactId: contact.id } : {}), ...(prospect.unitId ? { unitId: prospect.unitId } : {}) })}`,context);
  return <ProspectRequestForm mutation={mutation} operation="prospect.convert" label="Confirm tenant & lease link" feedbackText="Prospect linked to the existing tenant and lease." submit={async form => {
    if (readOnly) throw new Error("Prospect changes are read-only under the current company settings.");
    if (!contact || !lease || !confirmed) throw new Error("Select the exact existing tenant and matching lease, then confirm the person match.");
    await mutation.run(`${base}/${encodeURIComponent(prospect.id)}/convert`, "POST", { expectedVersion: prospect.version, contactId: contact.id, expectedContactVersion: contact.version, leaseId: lease.id, expectedLeaseVersion: lease.version, confirmedMatch: true, reason: text(form, "reason") }); if (mutation.current()) saved();
  }}>
    <p><strong>Approved prospect: {prospect.name}</strong><br/>{[prospect.email, prospect.phone].filter(Boolean).join(" · ")}<br/>{prospect.property.name}{prospect.unit ? ` · ${prospect.unit.label}` : ""}</p>
    <p className="help">Review the actual account-backed tenant and its primary lease. Matching email alone never proves identity. This action links existing sources; it creates no account, lease, membership or portal grant.</p>
    <fieldset><legend>Existing tenant</legend><label>Find an existing tenant<input type="search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)}/></label><button className="secondary" type="button" onClick={() => { setQuery(search.trim()); setContactCursors([]); }}>Search tenant accounts</button>
      {!options.data && <Load error={options.error} retry={options.reload} label="conversion sources"/>}
      {options.data && <><label>Tenant account<select required value={contact?.id || ""} onChange={event => { setContact(options.data!.contacts.find(candidate => candidate.id === event.target.value) || null); setLease(null); setLeaseCursors([]); setConfirmed(false); }}><option value="">Choose the exact tenant</option>{contact && !options.data.contacts.some(candidate => candidate.id === contact.id) && <option value={contact.id}>{contact.name} · {contact.email || "No contact email"} · selected</option>}{options.data.contacts.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.email || "No contact email"}</option>)}</select></label>{!options.data.contacts.length && <p>No matching account-backed tenants appear on this page. Prepare or review the tenant account through <Link to={tenantSetup}>Tenants</Link>, then return to this prospect.</p>}<Pager label="tenant accounts" previous={!!contactCursors.length} next={!!options.data.nextCursor} back={() => setContactCursors(previous => previous.slice(0, -1))} forward={() => setContactCursors(previous => [...previous, options.data!.nextCursor!])}/></>}
    </fieldset>
    {contact && <fieldset><legend>Matching primary lease</legend><p><Link to={withProspectContext(`/company/tenants/${encodeURIComponent(contact.id)}`,context)}>Review {contact.name}'s tenant record</Link></p>{options.data && <><label>Existing lease<select required value={lease?.id || ""} onChange={event => { setLease(options.data!.leases.find(candidate => candidate.id === event.target.value) || null); setConfirmed(false); }}><option value="">Choose a matching draft or active lease</option>{lease && !options.data.leases.some(candidate => candidate.id === lease.id) && <option value={lease.id}>{lease.unit.label} · {formatDate(lease.startsOn)} · selected</option>}{options.data.leases.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.unit.label} · {formatDate(candidate.startsOn)} – {formatDate(candidate.endsOn, "Open ended")} · {candidate.status === "draft" ? "Draft" : "Active"}</option>)}</select></label>{!options.data.leases.length && <p>No matching draft or active primary lease appears on this page. <Link to={leaseSetup}>Prepare a lease through the normal lease workflow</Link>, then return and reopen this review.</p>}<Pager label="matching leases" previous={!!leaseCursors.length} next={!!options.data.nextLeaseCursor} back={() => setLeaseCursors(previous => previous.slice(0, -1))} forward={() => setLeaseCursors(previous => [...previous, options.data!.nextLeaseCursor!])}/></>}</fieldset>}
    {contact && lease && <section className="notice"><strong>Reviewed sources</strong><p>Prospect: {prospect.name}<br/>Existing tenant: {contact.name} · {contact.email || "No contact email"}<br/>Lease: {lease.unit.label} · {formatDate(lease.startsOn)} – {formatDate(lease.endsOn, "Open ended")} · {lease.status === "draft" ? "Draft" : "Active"}</p><p className="help">The opening prospect, tenant and lease versions are retained. Changed sources require a fresh review.</p></section>}
    <label className="prospect-match"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>I reviewed the sources and confirm this prospect is the exact person represented by the selected tenant and primary lease.</label>
    <label>Reason for linking these existing records<textarea name="reason" required maxLength={500}/></label>
  </ProspectRequestForm>;
}
