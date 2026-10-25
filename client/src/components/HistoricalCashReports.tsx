import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../api";
import { formatActivityTime, formatDate, formatMonth } from "../dates";
import { dollars } from "../money";
import { downloadReport, moneyCell } from "../report-export";
import { usePropertySearchParams } from "../usePropertySearchParams";
import { DateField } from "./DateField";
import { Form } from "./Form";
import { propertyLink } from "./PropertyNavigation";
import "./HistoricalCashReports.css";

const amountLabels = {
  incomeCents: "Income received", expenseCents: "Expenses paid", rentRefundCents: "Rent refunds",
  depositReceivedCents: "Deposits received", depositRefundCents: "Deposit returns",
  netCents: "Operating cash net", cashMovementCents: "Total cash movement",
} as const;
type AmountKey = keyof typeof amountLabels;
type Source = {
  id: string; reference: string; propertyId: string; property: { name: string };
  occurredOn: string; recordedAt: string; kind: string; category: string; currency: string;
  amountCents: string; memo: string | null; included: boolean; voidedAt: string | null; voidReason: string | null;
  movement: { id: string; reference: string; leaseId: string } | null;
  depositReceipt: { id: string; reference: string; leaseId: string } | null;
};
type Period = {
  dateFrom: string; dateTo: string;
  summary: Record<AmountKey, string> & { includedCount: number; voidedCount: number };
  groups: { month: string; propertyId: string; property: string; kind: string; category: string; count: number; amountCents: string }[];
  items: Source[];
};
export type HistoricalCashReport = {
  kind: "historical_cash"; generatedAt: string; knowledgeCutoffExclusive: string;
  company: { name: string; timezone: string }; currency: "USD"; basis: string;
  filters: { propertyId: string | null; propertyName: string | null; dateFrom: string; dateTo: string; asOf: string; compareFrom: string | null; compareTo: string | null };
  primary: Period; comparison: Period | null; delta: Record<AmountKey, string> | null;
};

function exportReport(report: HistoricalCashReport) {
  const metadata: string[][] = [
    ["Report", "Cash as recorded by company date"], ["Company", report.company.name], ["Company timezone", report.company.timezone],
    ["Recording date", report.filters.asOf], ["Knowledge cutoff exclusive (UTC)", report.knowledgeCutoffExclusive],
    ["Generated at (UTC)", report.generatedAt], ["Property filter (current label)", report.filters.propertyName || "All properties"],
    ["Property ID", report.filters.propertyId || ""], ["Basis", report.basis],
  ];
  const rows: Parameters<typeof downloadReport>[1] = [...metadata, [], ["Measure", "Primary period (USD)", "Comparison period (USD)", "Primary minus comparison (USD)"]];
  for (const key of Object.keys(amountLabels) as AmountKey[]) rows.push([amountLabels[key], moneyCell(report.primary.summary[key]), report.comparison ? moneyCell(report.comparison.summary[key]) : "", report.delta ? moneyCell(report.delta[key]) : ""]);
  for (const [label, period] of [["Primary", report.primary], ["Comparison", report.comparison]] as const) {
    if (!period) continue;
    rows.push([], ["Period", label], ["Business start", period.dateFrom], ["Business through", period.dateTo],
      ["Reference", "Internal source ID", "Property ID", "Current property label", "Business date", "Recorded at (UTC)", "Type", "Category", "Amount (USD)", "Included at cutoff", "Voided at cutoff (UTC)", "Void reason known at cutoff", "Memo", "Movement reference", "Movement ID", "Deposit receipt reference", "Deposit receipt ID", "Lease ID"]);
    for (const item of period.items) rows.push([item.reference, item.id, item.propertyId, item.property.name, item.occurredOn, item.recordedAt, item.kind, item.category, moneyCell(item.amountCents), item.included ? "Yes" : "No", item.voidedAt || "", item.voidReason || "", item.memo || "", item.movement?.reference || "", item.movement?.id || "", item.depositReceipt?.reference || "", item.depositReceipt?.id || "", item.movement?.leaseId || item.depositReceipt?.leaseId || ""]);
  }
  downloadReport(`cash-recorded-${report.filters.asOf}-${report.primary.dateFrom}-${report.primary.dateTo}.csv`, rows);
}

export function HistoricalCashReports({ today, properties, propertyId }: { today: string; properties: { id: string; name: string }[]; propertyId?: string }) {
  const [params, setParams] = usePropertySearchParams();
  const [open, setOpen] = useState(() => params.get("history") === "cash");
  const [dateFrom, setDateFrom] = useState(params.get("historyFrom") || `${today.slice(0, 4)}-01-01`);
  const [dateTo, setDateTo] = useState(params.get("historyTo") || today);
  const [asOf, setAsOf] = useState(params.get("historyAsOf") || today);
  const [selectedProperty, setSelectedProperty] = useState(propertyId || params.get("historyProperty") || "");
  const [compare, setCompare] = useState(!!params.get("historyCompareFrom"));
  const [compareFrom, setCompareFrom] = useState(params.get("historyCompareFrom") || `${Number(today.slice(0, 4)) - 1}-01-01`);
  const [compareTo, setCompareTo] = useState(params.get("historyCompareTo") || `${Number(today.slice(0, 4)) - 1}-12-31`);
  const [report, setReport] = useState<HistoricalCashReport | null>(null), [running, setRunning] = useState(false), [printing, setPrinting] = useState(false);
  useEffect(() => { if (!printing) return; const done = () => setPrinting(false); window.addEventListener("afterprint", done); const frame = requestAnimationFrame(() => window.print()); return () => { cancelAnimationFrame(frame); window.removeEventListener("afterprint", done); }; }, [printing]);
  return <details className="panel historical-cash-builder" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Historical cash and period comparisons</summary>
    {open && <>
      <h2>Cash as recorded by a company date</h2>
      <p>Choose the cash transaction dates, then the date by which those records were known. Later backdated entries and corrections do not change this historical recorded state.</p>
      <Form operation="page.data.load" label="Generate historical cash report" successText="Historical report generated." submit={async () => {
        const selected = propertyId || selectedProperty;
        const query = new URLSearchParams({ dateFrom, dateTo, asOf, ...(selected ? { propertyId: selected } : {}), ...(compare ? { compareFrom, compareTo } : {}) });
        setParams(previous => { const next = new URLSearchParams(previous); for (const key of ["history", "historyFrom", "historyTo", "historyAsOf", "historyProperty", "historyCompareFrom", "historyCompareTo"]) next.delete(key); next.set("history", "cash"); next.set("historyFrom", dateFrom); next.set("historyTo", dateTo); next.set("historyAsOf", asOf); if (selected) next.set("historyProperty", selected); if (compare) { next.set("historyCompareFrom", compareFrom); next.set("historyCompareTo", compareTo); } return next; });
        setRunning(true);
        try { setReport(await api<HistoricalCashReport>(`/api/company/reports/historical-cash?${query}`)); } finally { setRunning(false); }
      }}>
        <div className="form-grid">
          <label>Historical report property<select aria-label="Historical report property" value={propertyId || selectedProperty} onChange={event => setSelectedProperty(event.target.value)} disabled={!!propertyId}>{!propertyId && <option value="">All properties</option>}{properties.filter(property => !propertyId || property.id === propertyId).map(property => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
          <label>Cash business start<DateField aria-label="Cash business start" required value={dateFrom} max={dateTo} onChange={event => setDateFrom(event.target.value)}/></label>
          <label>Cash business through<DateField aria-label="Cash business through" required value={dateTo} min={dateFrom} onChange={event => setDateTo(event.target.value)}/></label>
          <label>Recorded by company date<DateField aria-label="Recorded by company date" required value={asOf} max={today} onChange={event => setAsOf(event.target.value)}/></label>
        </div>
        <label><input type="checkbox" checked={compare} onChange={event => setCompare(event.target.checked)}/> Compare another business period using the same recording cutoff</label>
        {compare && <div className="form-grid"><label>Comparison start<DateField aria-label="Comparison start" required value={compareFrom} max={compareTo} onChange={event => setCompareFrom(event.target.value)}/></label><label>Comparison through<DateField aria-label="Comparison through" required value={compareTo} min={compareFrom} onChange={event => setCompareTo(event.target.value)}/></label></div>}
        <p className="help">The current company timezone determines the recording cutoff, including daylight saving changes. Today includes only records known at generation. The comparison is an exact amount difference; unequal period lengths are not normalized.</p>
      </Form>
      {running && <p role="status">Generating complete historical cash sources…</p>}
      {report && <section className="historical-cash-report" aria-label="Generated historical cash report"><div className="actions"><button className="secondary" onClick={() => exportReport(report)}>Download historical CSV</button><button className="secondary" onClick={() => setPrinting(true)}>Print historical report</button></div><ReportResult report={report}/></section>}
      {printing && report && createPortal(<div className="historical-cash-print-root"><ReportResult report={report} print/></div>, document.body)}
    </>}
  </details>;
}

function ReportResult({ report, print = false }: { report: HistoricalCashReport; print?: boolean }) {
  return <>
    <header><p className="eyebrow">{report.company.name}</p><h2>Historical recorded cash</h2><p>Recorded by {formatDate(report.filters.asOf)} · {report.company.timezone}</p><p>Generated {formatActivityTime(report.generatedAt)}. Exact exclusive recording cutoff: {report.knowledgeCutoffExclusive}.</p></header>
    <p className="help">{report.basis}</p><p>Current property label: {report.filters.propertyName || "All properties"}. A source link opens today's operational record, which can include later corrections.</p>
    <div className="table-wrap"><table><caption>Complete recorded cash totals in USD</caption><thead><tr><th scope="col">Measure</th><th scope="col">Primary period</th>{report.comparison && <><th scope="col">Comparison period</th><th scope="col">Primary minus comparison</th></>}</tr></thead><tbody>{(Object.keys(amountLabels) as AmountKey[]).map(key => <tr key={key}><th scope="row">{amountLabels[key]}</th><td>{dollars(report.primary.summary[key])}</td>{report.comparison && <><td>{dollars(report.comparison.summary[key])}</td><td>{dollars(report.delta![key])}</td></>}</tr>)}</tbody></table></div>
    <PeriodSources label="Primary" period={report.primary} print={print}/>{report.comparison && <PeriodSources label="Comparison" period={report.comparison} print={print}/>}
  </>;
}

function PeriodSources({ label, period, print }: { label: string; period: Period; print: boolean }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [period]);
  const visible = print ? period.items : period.items.slice(page * 50, page * 50 + 50);
  return <section><h3>{label}: {formatDate(period.dateFrom)} through {formatDate(period.dateTo)}</h3><p>{period.summary.includedCount} included source records; {period.summary.voidedCount} records already voided at the cutoff. CSV and print include every source across all display pages.</p>
    {!period.items.length ? <p>No known source records match this period.</p> : <div className="table-wrap"><table><caption>{label} source transactions at the recording cutoff</caption><thead><tr><th scope="col">Source / current property</th><th scope="col">Business date</th><th scope="col">Type / category</th><th scope="col">Amount</th><th scope="col">Recorded state</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td>{print ? item.reference : <Link to={propertyLink("/company/finances", item.propertyId, { entryId: item.id })}>{item.reference}</Link>}<br/>{item.property.name}</td><td>{formatDate(item.occurredOn)}</td><td>{item.kind} · {item.category.replace(/_/g, " ")}</td><td>{dollars(item.amountCents)}</td><td>{item.included ? "Included" : `Voided: ${item.voidReason || "Recorded correction"}`}</td></tr>)}</tbody></table></div>}
    {!print && period.items.length > 50 && <div className="actions"><button className="secondary" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous {label.toLowerCase()} sources</button><span>Page {page + 1} of {Math.ceil(period.items.length / 50)}</span><button className="secondary" disabled={(page + 1) * 50 >= period.items.length} onClick={() => setPage(value => value + 1)}>Next {label.toLowerCase()} sources</button></div>}
    {period.groups.length > 0 && <details open={print}><summary>{label} monthly property and category totals</summary><div className="table-wrap"><table><thead><tr><th scope="col">Month</th><th scope="col">Current property</th><th scope="col">Category</th><th scope="col">Records</th><th scope="col">USD</th></tr></thead><tbody>{period.groups.map(group => <tr key={JSON.stringify([group.month, group.propertyId, group.kind, group.category])}><td>{formatMonth(group.month)}</td><td>{group.property}</td><td>{group.kind} · {group.category.replace(/_/g, " ")}</td><td>{group.count}</td><td>{dollars(group.amountCents)}</td></tr>)}</tbody></table></div></details>}
  </section>;
}
