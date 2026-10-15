import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { Form } from "./Workspace";
import { dollars } from "./Finances";
import { downloadReport, moneyCell } from "../report-export";
type Base = {
  generatedAt: string;
  company: { name: string; timezone: string };
  basis: string;
  currency: string;
  filters: {
    propertyId: string | null;
    propertyName?: string | null;
    dateFrom?: string;
    dateTo?: string;
    status?: string | null;
  };
};
type Cash = Base & {
  kind: "cash";
  summary: {
    incomeCents: string;
    expenseCents: string;
    netCents: string;
    includedCount: number;
    voidedCount: number;
  };
  groups: {
    month: string;
    propertyId: string;
    property: string;
    kind: string;
    category: string;
    amountCents: string;
    count: number;
  }[];
  items: {
    id: string;
    property: { name: string };
    occurredOn: string;
    kind: string;
    category: string;
    amountCents: string;
    memo: string | null;
    voidedAt: string | null;
    voidReason: string | null;
  }[];
};
type Leases = Base & {
  kind: "leases";
  today: string;
  summary: {
    recordCount: number;
    currentCount: number;
    monthlyRentCents: string;
    futureActiveCount: number;
    expiredActiveCount: number;
  };
  items: {
    id: string;
    property: { name: string };
    unit: { label: string };
    resident: { name: string | null; email: string };
    status: string;
    startsOn: string;
    endsOn: string | null;
    rentCents: string;
    inEffect: boolean;
  }[];
};
type Report = Cash | Leases;
export function Reports() {
  const { data } = useAuth();
  return (
    <ReportWorkspace
      key={`${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`}
    />
  );
}
function ReportWorkspace() {
  const context = useResource<{
    name: string;
    timezone: string;
    today: string;
  }>("/api/company/reports/context");
  if (!context.data)
    return (
      <section className="panel">
        {context.error ? (
          <>
            <p role="alert">{context.error}</p>
            <button onClick={context.reload}>Try again</button>
          </>
        ) : (
          <p role="status">Loading report settings…</p>
        )}
      </section>
    );
  return <Builder today={context.data.today} />;
}
function Builder({ today }: { today: string }) {
  const properties = useResource<{ id: string; name: string }[]>(
    "/api/company/properties",
  );
  const [kind, setKind] = useState("cash"),
    [report, setReport] = useState<Report>(),
    [page, setPage] = useState(0),
    [running, setRunning] = useState(false);
  const exportData = () => {
    if (!report) return;
    const meta = [
      ["Company", report.company.name],
      [
        "Report",
        report.kind === "cash"
          ? "Recorded income and expenses"
          : "Lease register",
      ],
      ["Generated at (UTC)", report.generatedAt],
      ["Company timezone", report.company.timezone],
      ["Basis", report.basis],
      ["Property filter", report.filters.propertyName || "All properties"],
      ["Property ID", report.filters.propertyId || ""],
    ];
    if (report.kind === "cash")
      downloadReport(
        `income-expenses-${report.filters.dateFrom}-${report.filters.dateTo}.csv`,
        [
          ...meta,
          ["From date", report.filters.dateFrom!],
          ["Through date", report.filters.dateTo!],
          ["Income (USD)", moneyCell(report.summary.incomeCents)],
          ["Expenses (USD)", moneyCell(report.summary.expenseCents)],
          ["Net (USD)", moneyCell(report.summary.netCents)],
          [],
          [
            "ID",
            "Date",
            "Property",
            "Type",
            "Category",
            "Amount (USD)",
            "Included in totals",
            "Memo",
            "Void reason",
          ],
          ...report.items.map((r) => [
            r.id,
            r.occurredOn,
            r.property.name,
            r.kind,
            r.category,
            moneyCell(r.amountCents),
            r.voidedAt ? "No — voided" : "Yes",
            r.memo || "",
            r.voidReason || "",
          ]),
        ],
      );
    else
      downloadReport(`lease-register-${report.today}.csv`, [
        ...meta,
        ["Business date", report.today],
        ["Status filter", report.filters.status || "All statuses"],
        [
          "Monthly rent in effect (USD)",
          moneyCell(report.summary.monthlyRentCents),
        ],
        [],
        [
          "ID",
          "Property",
          "Unit",
          "Resident",
          "Email",
          "Status",
          "Start",
          "End",
          "Monthly lease rent (USD)",
          "In effect today",
        ],
        ...report.items.map((r) => [
          r.id,
          r.property.name,
          r.unit.label,
          r.resident.name || "",
          r.resident.email,
          r.status,
          r.startsOn,
          r.endsOn || "",
          moneyCell(r.rentCents),
          r.inEffect ? "Yes" : "No",
        ]),
      ]);
  };
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">Company insights</p>
        <h1>Reports</h1>
        <p>
          Review the records behind your numbers. Generate a complete report,
          then download the same snapshot.
        </p>
      </header>
      <section className="panel">
        <h2>Build a report</h2>
        <Form
          operation="page.data.load"
          label="Generate report"
          successText="Report generated."
          submit={async (form) => {
            setRunning(true);
            setReport(undefined);
            setPage(0);
            try {
              const q = new URLSearchParams();
              for (const key of kind === "cash"
                ? ["propertyId", "dateFrom", "dateTo"]
                : ["propertyId", "status"]) {
                const value = String(form.get(key) || "");
                if (value) q.set(key, value);
              }
              setReport(await api<Report>(`/api/company/reports/${kind}?${q}`));
            } finally {
              setRunning(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              Report type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="cash">Income and expenses</option>
                <option value="leases">Lease register</option>
              </select>
            </label>
            <label>
              Report property
              <select name="propertyId">
                <option value="">All properties</option>
                {properties.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {kind === "cash" ? (
              <>
                <label>
                  From date
                  <input
                    name="dateFrom"
                    type="date"
                    required
                    defaultValue={`${today.slice(0, 4)}-01-01`}
                  />
                </label>
                <label>
                  Through date
                  <input
                    name="dateTo"
                    type="date"
                    required
                    defaultValue={today}
                  />
                </label>
              </>
            ) : (
              <label>
                Lease status
                <select name="status">
                  <option value="">All statuses</option>
                  {["draft", "active", "ended"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </Form>
        {properties.error && (
          <p role="alert">
            Property choices could not load. All properties remains available.{" "}
            <button onClick={properties.reload}>Try again</button>
          </p>
        )}
      </section>
      {running && <p role="status">Generating complete report…</p>}
      {!report && !running && (
        <section className="panel empty-state">
          <h2>Start with a report</h2>
          <p>
            Choose a report and filters above. Reports use saved company
            records; no sample totals are shown.
          </p>
        </section>
      )}
      {report && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{report.company.name}</p>
              <h2>
                {report.kind === "cash"
                  ? "Recorded income and expenses"
                  : "Lease register"}
              </h2>
            </div>
            <button className="secondary" onClick={exportData}>
              Download CSV
            </button>
          </div>
          <p className="help">
            Generated {new Date(report.generatedAt).toLocaleString()} · Company
            timezone: {report.company.timezone}
          </p>
          <p className="help">{report.basis}</p>
          <p>
            Property:{" "}
            {report.filters.propertyId
              ? report.filters.propertyName || "Selected property"
              : "All properties"}
            {report.kind === "leases"
              ? ` · Status: ${report.filters.status || "All statuses"}`
              : ""}
          </p>
          <p className="notice" role="status">
            Report ready · {report.items.length} source records. Downloads
            include every matching row, across all display pages.
          </p>
          {report.kind === "cash" ? (
            <>
              <p>
                {report.filters.dateFrom} through {report.filters.dateTo} ·{" "}
                {report.summary.voidedCount} voided records excluded from totals
              </p>
              <div className="metric-grid">
                <div>
                  <span>Income received</span>
                  <strong>{dollars(report.summary.incomeCents)}</strong>
                </div>
                <div>
                  <span>Expenses paid</span>
                  <strong>{dollars(report.summary.expenseCents)}</strong>
                </div>
                <div>
                  <span>Net recorded</span>
                  <strong>{dollars(report.summary.netCents)}</strong>
                </div>
              </div>
              <details>
                <summary>Monthly property and category breakdown</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Property</th>
                        <th>Type</th>
                        <th>Category</th>
                        <th>Records</th>
                        <th>USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.groups.map((g) => (
                        <tr
                          key={JSON.stringify([
                            g.month,
                            g.propertyId,
                            g.kind,
                            g.category,
                          ])}
                        >
                          <td>{g.month}</td>
                          <td>{g.property}</td>
                          <td>{g.kind}</td>
                          <td>{g.category.replace("_", " ")}</td>
                          <td>{g.count}</td>
                          <td>{dollars(g.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <div className="table-wrap">
                <table>
                  <caption>Source transactions · current saved state</caption>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Property</th>
                      <th>Type / category</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.items.slice(page * 50, page * 50 + 50).map((r) => (
                      <tr key={r.id}>
                        <td>{r.occurredOn}</td>
                        <td>{r.property.name}</td>
                        <td>
                          {r.kind} · {r.category.replace("_", " ")}
                        </td>
                        <td>{dollars(r.amountCents)}</td>
                        <td>{r.voidedAt ? "Voided" : "Included"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="metric-grid">
                <div>
                  <span>Lease records</span>
                  <strong>{report.summary.recordCount}</strong>
                </div>
                <div>
                  <span>In effect on {report.today}</span>
                  <strong>{report.summary.currentCount}</strong>
                </div>
                <div>
                  <span>Monthly lease rent in effect</span>
                  <strong>{dollars(report.summary.monthlyRentCents)}</strong>
                </div>
              </div>
              {(report.summary.expiredActiveCount > 0 ||
                report.summary.futureActiveCount > 0) && (
                <p className="notice">
                  {report.summary.expiredActiveCount} active records have past
                  end dates; {report.summary.futureActiveCount} start in the
                  future. Review them in Leases. Neither is included in rent in
                  effect today.
                </p>
              )}
              <div className="table-wrap">
                <table>
                  <caption>Lease records · current terms</caption>
                  <thead>
                    <tr>
                      <th>Property / unit</th>
                      <th>Resident</th>
                      <th>Dates</th>
                      <th>Monthly rent</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.items.slice(page * 50, page * 50 + 50).map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.property.name} · {r.unit.label}
                        </td>
                        <td>{r.resident.name || r.resident.email}</td>
                        <td>
                          {r.startsOn} — {r.endsOn || "Open ended"}
                        </td>
                        <td>{dollars(r.rentCents)}</td>
                        <td>
                          {r.status}
                          {r.inEffect ? " · In effect" : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!report.items.length && (
            <p className="empty-state">
              No records match the generated report's filters.
            </p>
          )}
          <div className="actions">
            <span>
              Page {page + 1} of{" "}
              {Math.max(1, Math.ceil(report.items.length / 50))}
            </span>
            <button
              className="secondary"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous page
            </button>
            <button
              className="secondary"
              disabled={(page + 1) * 50 >= report.items.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next page
            </button>
          </div>
          <p className="help">
            This snapshot stays unchanged while you review/export it. Generate
            again to include later edits or corrections. These reports do not
            calculate balances owed, deposits, tax liability, or formal
            financial statements.
          </p>
        </section>
      )}
    </>
  );
}
