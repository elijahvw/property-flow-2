import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { monitorOperation } from "../operations";
import { formatActivityTime } from "../dates";
import "./Notifications.css";
type Item = {
  id: string;
  version: number;
  title: string;
  sourceTitle: string;
  property: string;
  unit: string | null;
  type: string;
  readAt: string | null;
  createdAt: string;
};
type Inbox = {
  items: Item[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
};
type Pending = {
  id: string;
  body: {
    action: string;
    expectedVersion: number;
    submissionKey: string;
    status: string;
    type: string;
    page: string;
  };
};
const types = [
  { value: "all", label: "All types" },
  { value: "maintenance", label: "Maintenance" },
  { value: "work", label: "Assigned work" },
  { value: "inspections", label: "Inspections" },
  { value: "agreements", label: "Agreements" },
];
export function Notifications() {
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    { data: auth } = useAuth();
  const status = ["read", "unread"].includes(params.get("status") ?? "")
      ? params.get("status")!
      : "all",
    type = types.some((t) => t.value === params.get("type"))
      ? params.get("type")!
      : "all",
    page = /^[1-9][0-9]{0,4}$/.test(params.get("page") ?? "")
      ? params.get("page")!
      : "1";
  const { data, error, reload } = useResource<Inbox>(
    `/api/account/notifications?${new URLSearchParams({ status, type, page })}`,
    true,
    true,
  );
  const pending = useRef<Pending | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [failure, setFailure] = useState(""),
    [message, setMessage] = useState("");
  const scope = `${auth?.user.id}:${auth?.membership?.companyId}:${auth?.membership?.version}:${auth?.permissions.join(",")}`;
  useEffect(() => {
    pending.current = null;
    setUncertain(false);
    setFailure("");
    setMessage("");
  }, [scope]);
  const update = (key: string, value: string) => {
    setParams({ status, type, page: "1", [key]: value });
    setMessage("");
  };
  const act = async (item?: Item, action?: string) => {
    if (busy) return;
    if (!pending.current && item && action)
      pending.current = {
        id: item.id,
        body: {
          action,
          expectedVersion: item.version,
          submissionKey: crypto.randomUUID(),
          status,
          type,
          page,
        },
      };
    const original = pending.current;
    if (!original) return;
    setBusy(true);
    setFailure("");
    setMessage("");
    try {
      const result = await monitorOperation("notification.state", () =>
        api<{ saved: boolean; version: number; href?: string }>(
          `/api/account/notifications/${encodeURIComponent(original.id)}`,
          { method: "POST", body: original.body },
        ),
      );
      pending.current = null;
      setUncertain(false);
      setMessage(
        original.body.action === "unread"
          ? "Marked unread."
          : original.body.action === "open"
            ? "Source access confirmed."
            : "Marked read.",
      );
      window.dispatchEvent(new Event("notifications-changed"));
      reload();
      if (result.href) navigate(result.href);
    } catch (e) {
      const lost = e instanceof ApiError && e.submissionUncertain;
      setUncertain(lost);
      setFailure(
        lost
          ? "The result could not be confirmed. Retry the original action to recover its saved result."
          : e instanceof Error
            ? e.message
            : "Unable to update this notification.",
      );
      if (!lost) {
        pending.current = null;
        reload();
        window.dispatchEvent(new Event("notifications-changed"));
      }
    } finally {
      setBusy(false);
    }
  };
  const blocked = busy || uncertain;
  return (
    <section className="notifications-page">
      <div className="page-heading">
        <div>
          <h1>Notifications</h1>
          <p>Read workflow updates and open the source for details.</p>
        </div>
        <button className="secondary" onClick={reload} disabled={busy}>
          Refresh inbox
        </button>
      </div>
      <p className="muted">
        In-app only. Refreshes on return and about every minute while visible.
      </p>
      {failure && (
        <div role="alert" className="notice error">
          <p>{failure}</p>
          {uncertain && (
            <button disabled={busy} onClick={() => void act()}>
              {busy ? "Recovering…" : "Retry original action"}
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error} Use Refresh inbox to retry.
        </p>
      )}
      <div className="notification-filters">
        <label>
          Read status
          <select
            aria-label="Read status"
            value={status}
            disabled={blocked}
            onChange={(e) => update("status", e.target.value)}
          >
            <option value="all">All notifications</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
        </label>
        <label>
          Notification type
          <select
            aria-label="Notification type"
            value={type}
            disabled={blocked}
            onChange={(e) => update("type", e.target.value)}
          >
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!data && !error && <p role="status">Loading notifications…</p>}
      {data && (
        <>
          <p aria-live="polite">
            {data.unread} unread · {data.total} matching notification
            {data.total === 1 ? "" : "s"}
          </p>
          {data.items.length === 0 ? (
            <div className="status-panel">
              <h2>No notifications here</h2>
              <p>
                {status !== "all" || type !== "all" || Number(page) > 1
                  ? "Try another filter or return to the first page."
                  : "New workflow updates for you will appear here. Earlier activity is not added retroactively."}
              </p>
              {Number(page) > 1 && (
                <button
                  className="secondary"
                  disabled={blocked}
                  onClick={() => setParams({ status, type, page: "1" })}
                >
                  First page
                </button>
              )}
            </div>
          ) : (
            <div className="notification-list">
              {data.items.map((item) => (
                <article
                  className={`notification-card${item.readAt ? "" : " notification-unread"}`}
                  key={item.id}
                  aria-label={`${item.title}: ${item.sourceTitle}`}
                >
                  <div className="notification-card-heading">
                    <h2>{item.title}</h2>
                    <span className="badge">
                      {item.readAt ? "Read" : "Unread"}
                    </span>
                  </div>
                  <p className="notification-source">{item.sourceTitle}</p>
                  <p>
                    {item.property}
                    {item.unit ? ` · ${item.unit}` : ""}
                  </p>
                  <time dateTime={item.createdAt}>
                    {formatActivityTime(item.createdAt)}
                  </time>
                  <div className="notification-actions">
                    <button
                      disabled={blocked}
                      onClick={() => void act(item, "open")}
                    >
                      Open source
                    </button>
                    <button
                      className="secondary"
                      disabled={blocked}
                      onClick={() =>
                        void act(item, item.readAt ? "unread" : "read")
                      }
                    >
                      {item.readAt ? "Mark unread" : "Mark read"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <nav
            className="notification-pagination"
            aria-label="Notification pages"
          >
            <button
              className="secondary"
              disabled={blocked || Number(page) <= 1}
              onClick={() => update("page", String(Number(page) - 1))}
            >
              Previous
            </button>
            <span>
              Page {page} of{" "}
              {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <button
              className="secondary"
              disabled={blocked || Number(page) * data.pageSize >= data.total}
              onClick={() => update("page", String(Number(page) + 1))}
            >
              Next
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
