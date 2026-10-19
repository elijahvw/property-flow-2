import { Link, useSearchParams } from "react-router-dom";
import { useResource } from "../useResource";
import { formatDate } from "../dates";
import { calendarSource } from "../calendar-context";
type Day = {
  dueOn: string;
  total: number;
  schedules: number;
  requests: number;
  overdue: number;
};
type Item = {
  id: string;
  kind: "schedule" | "request";
  title: string;
  dueOn: string;
  timezone: string;
  overdue: boolean;
  priority: string;
  status: string;
  propertyName: string;
  unitLabel: string | null;
};
type Calendar = {
  month: string;
  day: string | null;
  today: string;
  timezone: string;
  days: Day[];
  items: Item[];
  total: number;
  monthTotal: number;
  page: number;
  pageSize: number;
};
const monthName = (month: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(month + "-01T00:00:00Z"));
function shifted(month: string, offset: number) {
  const date = new Date(month + "-01T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
export function WorkCalendar() {
  const [params, setParams] = useSearchParams(),
    query = new URLSearchParams();
  for (const key of ["month", "day", "propertyId", "kind", "page"])
    if (params.get(key)) query.set(key, params.get(key)!);
  const r = useResource<Calendar>(
      `/api/company/work-calendar?${query}`,
      true,
      true,
    ),
    properties = useResource<{ id: string; name: string }[]>(
      "/api/company/properties",
      true,
      true,
    );
  const change = (key: string, value: string) => {
    const q = new URLSearchParams(params);
    q.delete("page");
    if (key === "month") q.delete("day");
    if (value) q.set(key, value);
    else q.delete(key);
    setParams(q);
  };
  const data = r.data,
    first = data ? new Date(data.month + "-01T00:00:00Z") : null,
    count = first
      ? new Date(
          Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
        ).getUTCDate()
      : 0;
  const days = new Map(data?.days.map((d) => [d.dueOn.slice(0, 10), d]) || []),
    cells = first
      ? Array.from(
          { length: Math.ceil((first.getUTCDay() + count) / 7) * 7 },
          (_, i) => {
            const day = i - first.getUTCDay() + 1;
            return day < 1 || day > count
              ? null
              : `${data!.month}-${String(day).padStart(2, "0")}`;
          },
        )
      : [];
  return (
    <>
      <nav className="record-breadcrumb">
        <Link to="/company/maintenance">← Maintenance</Link>
        <Link to="/company/preventive">Preventive schedules →</Link>
      </nav>
      <header className="page-heading">
        <h1>Work calendar</h1>
        <p>
          Review upcoming and missed work, then open the source to take action.
        </p>
      </header>
      <p className="help">
        Shows each active schedule’s next occurrence and unresolved requests
        with target dates. Future repeats appear after the current occurrence is
        created or skipped. Requests without a target date remain in{" "}
        <Link to="/company/maintenance?due=unscheduled">
          unscheduled maintenance
        </Link>
        .
      </p>
      <div className="directory-toolbar">
        <label>
          Calendar month
          <input
            type="month"
            aria-label="Calendar month"
            value={params.get("month") || data?.month || ""}
            onChange={(e) => {
              if (e.target.value) change("month", e.target.value);
            }}
          />
        </label>
        <label>
          Filter property
          <select
            aria-label="Filter property"
            value={params.get("propertyId") || ""}
            onChange={(e) => change("propertyId", e.target.value)}
          >
            <option value="">All properties</option>
            {properties.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Work type
          <select
            aria-label="Work type"
            value={params.get("kind") || "all"}
            onChange={(e) => change("kind", e.target.value)}
          >
            <option value="all">Schedules &amp; requests</option>
            <option value="schedule">Schedule occurrences</option>
            <option value="request">Maintenance requests</option>
          </select>
        </label>
      </div>
      {properties.error && (
        <p role="alert">
          {properties.error}{" "}
          <button className="secondary" onClick={properties.reload}>
            Retry properties
          </button>
        </p>
      )}
      {r.error && (
        <p role="alert">
          {r.error}{" "}
          <button className="secondary" onClick={r.reload}>
            Try again
          </button>
        </p>
      )}
      {!data ? (
        !r.error && <p role="status">Loading work calendar…</p>
      ) : (
        <>
          <section className="panel work-calendar">
            <div className="page-heading-row">
              <h2>{monthName(data.month)}</h2>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={data.month === "1000-01"}
                  onClick={() => change("month", shifted(data.month, -1))}
                  aria-label="Previous month"
                >
                  ←
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    const q = new URLSearchParams(params);
                    q.set("month", data.today.slice(0, 7));
                    q.set("day", data.today);
                    q.delete("page");
                    setParams(q);
                  }}
                >
                  Today
                </button>
                <button
                  className="secondary"
                  disabled={data.month === "9999-12"}
                  onClick={() => change("month", shifted(data.month, 1))}
                  aria-label="Next month"
                >
                  →
                </button>
              </div>
            </div>
            <p>
              {data.monthTotal} {data.monthTotal === 1 ? "item" : "items"} this
              month · Today {formatDate(data.today)} · {data.timezone}
            </p>
            <table
              className="calendar-grid"
              aria-label={`${monthName(data.month)} work dates`}
            >
              <thead>
                <tr>
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                  ].map((day) => (
                    <th key={day} scope="col">
                      <abbr title={day}>{day.slice(0, 2)}</abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: cells.length / 7 }, (_, week) => (
                  <tr key={week}>
                    {cells.slice(week * 7, week * 7 + 7).map((day, index) => (
                      <td key={day || index}>
                        {day && (
                          <button
                            className={`calendar-day ${days.get(day)?.total ? "has-work" : ""}`}
                            aria-label={`${formatDate(day)}, ${days.get(day)?.total || 0} items${days.get(day)?.overdue ? `, ${days.get(day)!.overdue} overdue` : ""}`}
                            aria-pressed={data.day === day}
                            aria-current={
                              data.today === day ? "date" : undefined
                            }
                            onClick={() => change("day", day)}
                          >
                            <span>{Number(day.slice(-2))}</span>
                            {!!days.get(day)?.total && (
                              <small>
                                {days.get(day)!.total}
                                <span className="sr-only"> work items</span>
                              </small>
                            )}
                          </button>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="help">
              Select a date to see its work below. Counts include every matching
              item, across all pages.
            </p>
          </section>
          <section className="panel">
            <div className="page-heading-row">
              <h2>
                {data.day ? formatDate(data.day) : "All dates this month"}
              </h2>
              {data.day && (
                <button className="secondary" onClick={() => change("day", "")}>
                  Show whole month
                </button>
              )}
            </div>
            <p role="status">
              {data.total} matching {data.total === 1 ? "item" : "items"}
            </p>
            {!data.items.length && <p>No work matches this view.</p>}
            <ul className="calendar-agenda">
              {data.items.map((item) => (
                <li key={item.kind + item.id}>
                  <div>
                    <span className="record-kicker">
                      {item.kind === "schedule"
                        ? "Next schedule occurrence"
                        : "Maintenance request"}
                    </span>
                    <h3>
                      <Link
                        to={`${item.kind === "schedule" ? "/company/preventive/" : "/company/maintenance/"}${encodeURIComponent(item.id)}?${calendarSource(params, data.month)}`}
                      >
                        {item.title}
                      </Link>
                    </h3>
                    <p>
                      {item.propertyName} · {item.unitLabel || "Whole property"}
                    </p>
                    <p>
                      {formatDate(item.dueOn)} · {item.timezone}
                      {item.overdue ? " · Overdue" : ""}
                    </p>
                    <p className="help">
                      {item.kind === "schedule"
                        ? "Review to create or skip work"
                        : item.status === "in_progress"
                          ? "In progress"
                          : "Open"}{" "}
                      · {item.priority} priority
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="actions">
              <button
                className="secondary"
                disabled={data.page === 1}
                onClick={() => change("page", String(data.page - 1))}
              >
                Previous work items
              </button>
              <span>Page {data.page}</span>
              <button
                className="secondary"
                disabled={data.page * data.pageSize >= data.total}
                onClick={() => change("page", String(data.page + 1))}
              >
                Next work items
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );
}
