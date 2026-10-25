import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { useResource } from "../useResource";
import { monitorOperation } from "../operations";
import { formatActivityTime } from "../dates";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { DraftReset } from "../components/DraftReset";
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
      <NotificationPreferences key={`${scope}:${auth?.impersonation?.contextId || ""}:${auth?.companyFeatures?.notifications || ""}:${auth?.companyFeatures?.resident_portal || ""}`} />
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

const preferenceAreas = [
  { key: "maintenanceEnabled", label: "Maintenance", detail: "Eligible updates and replies on maintenance requests." },
  { key: "workEnabled", label: "Assigned work", detail: "Eligible assignment, completion and review notices." },
  { key: "inspectionsEnabled", label: "Inspections", detail: "Notices when an inspection needs review." },
  { key: "agreementsEnabled", label: "Agreements", detail: "Preparation review, approval and requested-change notices." },
] as const;
type PreferenceSettings = Record<(typeof preferenceAreas)[number]["key"], boolean>;
type Preferences = { companyId: string; settings: PreferenceSettings; version: number };
type PreferenceResult = Preferences & {
  receipt: { appliedVersion: number; appliedSettings: PreferenceSettings; changed: boolean; replayed: boolean };
};
type PreferenceDraft = { baseline: Preferences; settings: PreferenceSettings; key: string };
const preferenceEndpoint = "/api/account/notifications/preferences";

function NotificationPreferences() {
  const { data: auth, refreshUser } = useAuth();
  const readOnly = !!auth?.impersonation || auth?.companyFeatures?.notifications === "read_only" || (auth?.membership?.role === "resident" && auth?.companyFeatures?.resident_portal === "read_only");
  const resource = useResource<Preferences>(preferenceEndpoint, true, true);
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<PreferenceDraft | null>(null),
    [confirmed, setConfirmed] = useState<Preferences | null>(null),
    [kept, setKept] = useState<"draft" | "recovery" | null>(null),
    [saved, setSaved] = useState(""),
    [conflict, setConflict] = useState(false),
    [latest, setLatest] = useState<Preferences | null>(null),
    [loadingLatest, setLoadingLatest] = useState(false),
    [latestError, setLatestError] = useState(""),
    [historyOpen, setHistoryOpen] = useState(false),
    [historyRevision, setHistoryRevision] = useState(0),
    [formRevision, setFormRevision] = useState(0),
    [companyChanged, setCompanyChanged] = useState(false),
    [refreshingWorkspace, setRefreshingWorkspace] = useState(false);
  const companyId = auth?.membership?.companyId;
  const received = resource.data?.companyId === companyId ? resource.data : undefined;
  const current = confirmed && confirmed.companyId === companyId && (!received || confirmed.version > received.version) ? confirmed : received;
  const scroll = useRef(0);
  const conflictSummary = useRef<HTMLElement>(null);
  useEffect(() => { if (conflict) conflictSummary.current?.focus(); }, [conflict, formRevision]);
  useEffect(() => {
    if (resource.data && resource.data.companyId !== companyId) setCompanyChanged(true);
  }, [resource.data, companyId]);
  useEffect(() => {
    if (!resource.error || resource.data) return;
    setConfirmed(null); setDraft(null); setKept(null); setOpen(false); setConflict(false); setLatest(null); setLatestError("");
  }, [resource.error, resource.data]);
  const close = () => {
    setOpen(false);
    window.requestAnimationFrame(() => window.scrollTo({ top: scroll.current, behavior: "auto" }));
  };
  const discard = () => {
    setDraft(null); setKept(null); setConflict(false); setLatest(null); setLatestError(""); close();
  };
  const edit = () => {
    if (!current && !draft) return;
    scroll.current = window.scrollY;
    setSaved("");
    if (!draft) setDraft({ baseline: current!, settings: { ...current!.settings }, key: crypto.randomUUID() });
    setOpen(true);
  };
  const reviewLatest = async () => {
    if (companyChanged || !draft || draft.baseline.companyId !== companyId) { setCompanyChanged(true); return; }
    setLoadingLatest(true); setLatestError("");
    try {
      const value = await api<Preferences>(preferenceEndpoint);
      if (value.companyId !== companyId || value.companyId !== draft.baseline.companyId) { setCompanyChanged(true); setLatest(null); return; }
      setLatest(value); setConfirmed(value);
    }
    catch (error) { setLatestError(error instanceof Error ? error.message : "Unable to load the latest preferences."); }
    finally { setLoadingLatest(false); }
  };
  const useReviewed = (keepChoices: boolean) => {
    if (!draft || !latest || companyChanged || latest.companyId !== companyId || latest.companyId !== draft.baseline.companyId) return;
    setDraft({ baseline: latest, settings: { ...(keepChoices ? draft.settings : latest.settings) }, key: crypto.randomUUID() });
    setConflict(false); setLatest(null); setLatestError(""); setKept(null);
  };
  const choices = (disabled = false) => draft && <fieldset className="form-section" disabled={disabled}>
    <legend>Future in-app notices</legend>
    <p className="help">Choose the notices you want for your account in this company. All four areas start enabled. These choices apply only when you are an eligible recipient.</p>
    <div className="notification-preference-choices">
      {preferenceAreas.map(area => <label className="notification-preference-option" key={area.key}>
        <input type="checkbox" name={area.key} checked={draft.settings[area.key]} onChange={event => setDraft({ ...draft, settings: { ...draft.settings, [area.key]: event.target.checked } })} />
        <span><strong>{area.label}</strong><span className="help">{area.detail}</span></span>
      </label>)}
    </div>
  </fieldset>;
  const contextWarning = companyChanged && <section className="notice error" role="alert">
    <p>Your company context changed. These choices have not been applied to another company. Reload your workspace to confirm your current company before editing or reviewing preferences. Any choices shown here stay with the earlier company until the workspace refresh clears this editor.</p>
    <button className="secondary" disabled={refreshingWorkspace} onClick={async () => { setRefreshingWorkspace(true); try { await refreshUser(); } finally { setRefreshingWorkspace(false); } }}>{refreshingWorkspace ? "Reloading workspace…" : "Reload workspace"}</button>
  </section>;
  return <div className="notification-preferences">
    <div className="notification-preferences-heading">
      <button className="secondary" onClick={edit} disabled={(!current && !draft) || (companyChanged && !draft)}>Notification preferences</button>
      {kept && <span className="help">{kept === "recovery" ? "Interrupted save kept for recovery on this page." : "Draft kept on this page."}</span>}
      {saved && <span role="status">{saved}</span>}
    </div>
    {!current && !resource.error && !companyChanged && <p role="status" className="help">Loading notification preferences…</p>}
    {resource.error && <p role="alert" className="notice error">{resource.error} <button className="secondary" onClick={resource.reload}>Retry preferences</button></p>}
    {!open && contextWarning}
    <EditorDialog open={open} title="Notification preferences" busy={loadingLatest} onClose={close} onDiscard={discard} onSaveDraft={recovery => { setKept(recovery ? "recovery" : "draft"); close(); }}>
      <p className="help">Preferences affect future eligible in-app notices only. Existing notifications and read states stay in your inbox; turning an area back on does not add earlier activity. No email or text message is sent.</p>
      <p className="help">Turning off notices does not remove assigned work or review responsibilities.</p>
      {contextWarning}
      {readOnly ? <>
        <p className="notice">Notification preferences are read-only under your current access settings.</p>
        {choices(true)}
      </> : draft && <fieldset disabled={companyChanged} className="notification-preference-editor"><Form key={`${draft.key}:${formRevision}`} operation="notification.preferences" label="Save preferences" feedbackText="Notification preferences saved."
        secondaryActions={<DraftReset reset={discard} />}
        submit={async form => {
          if (readOnly) throw new Error("Notification preferences are read-only under your current access settings.");
          if (companyChanged || draft.baseline.companyId !== companyId) throw new Error("Reload your workspace to confirm your current company before saving preferences.");
          if (conflict) throw new Error("Review the latest saved preferences before trying again.");
          const settings = Object.fromEntries(preferenceAreas.map(area => [area.key, form.has(area.key)])) as PreferenceSettings;
          try {
            const result = await api<PreferenceResult>(preferenceEndpoint, { method: "POST", body: { ...settings, expectedCompanyId: draft.baseline.companyId, expectedVersion: draft.baseline.version, submissionKey: draft.key } });
            if (result.companyId !== companyId || result.companyId !== draft.baseline.companyId) throw new ApiError("Your company context changed. Reload your workspace before reviewing preferences.", 409, "COMPANY_CONTEXT_CHANGED");
            setConfirmed({ companyId: result.companyId, settings: result.settings, version: result.version });
            setSaved(result.receipt.replayed && result.version > result.receipt.appliedVersion
              ? "Earlier save recovered. Newer saved preferences remain in effect."
              : "Notification preferences saved.");
            setDraft(null); setKept(null); setConflict(false); setLatest(null); setLatestError("");
            setHistoryRevision(value => value + 1); resource.reload(); close();
          } catch (error) {
            if (error instanceof ApiError && error.code === "RECORD_CHANGED") {
              setConflict(true); setLatest(null); setLatestError(""); setFormRevision(value => value + 1);
            }
            if (error instanceof ApiError && error.code === "COMPANY_CONTEXT_CHANGED") { setCompanyChanged(true); setLatest(null); }
            throw error;
          }
        }}>
        {conflict && <section ref={conflictSummary} role="alert" tabIndex={-1} className="workflow-error-summary notice error" aria-label="Review changed preferences">
          <p>This record changed. Your choices are still here. Review the latest saved settings before making a new save.</p>
          {!latest && <button type="button" className="secondary" onClick={() => void reviewLatest()}>Review latest saved preferences</button>}
          {latestError && <p role="alert">{latestError}</p>}
          {latest && <>
            <div className="notification-preference-comparison" role="region" aria-label="Saved preferences and your choices">
              <table><thead><tr><th scope="col">Area</th><th scope="col">Saved now</th><th scope="col">Your choices</th></tr></thead>
                <tbody>{preferenceAreas.map(area => <tr key={area.key}><th scope="row">{area.label}</th><td>{latest.settings[area.key] ? "On" : "Off"}</td><td>{draft.settings[area.key] ? "On" : "Off"}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="help">Choose which settings to edit against the latest saved version. Nothing changes until you save.</p>
            <div className="actions"><button type="button" className="secondary" onClick={() => useReviewed(false)}>Use latest saved settings</button><button type="button" onClick={() => useReviewed(true)}>Keep my choices for a new save</button></div>
          </>}
        </section>}
        {choices()}
        <p className="help">Your opening version is kept while you edit. An interrupted save must be recovered with its original choices before starting another.</p>
      </Form></fieldset>}
      {!companyChanged && <details className="notification-preference-history" onToggle={event => setHistoryOpen(event.currentTarget.open)}>
        <summary>Preference history</summary>
        {historyOpen && companyId && <PreferenceHistory key={historyRevision} companyId={companyId} contextChanged={() => setCompanyChanged(true)} />}
      </details>}
    </EditorDialog>
  </div>;
}

function PreferenceHistory({ companyId, contextChanged }: { companyId: string; contextChanged: () => void }) {
  const [cursor, setCursor] = useState("");
  const resource = useResource<{
    companyId: string;
    items: { id: string; createdAt: string; appliedVersion: number; settings: PreferenceSettings; changed: boolean }[];
    nextCursor: string | null;
  }>(`${preferenceEndpoint}/history${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`, true, true);
  useEffect(() => { if (resource.data && resource.data.companyId !== companyId) contextChanged(); }, [resource.data, companyId, contextChanged]);
  return <div>
    {resource.error && <p role="alert" className="notice error">{resource.error} <button className="secondary" onClick={resource.reload}>Retry preference history</button></p>}
    {!resource.data && !resource.error && <p role="status">Loading preference history…</p>}
    {resource.data?.companyId === companyId && <>
      {!resource.data.items.length ? <p>No preference changes recorded yet. All areas are enabled by default.</p> : <ol className="notification-preference-history-list">
        {resource.data.items.map(item => <li key={item.id}>
          <time dateTime={item.createdAt}>{formatActivityTime(item.createdAt)}</time>
          <p>Version {item.appliedVersion} · {item.changed ? "Preferences changed" : "Settings confirmed without changes"}</p>
          <p className="help">{preferenceAreas.map(area => `${area.label}: ${item.settings[area.key] ? "On" : "Off"}`).join(" · ")}</p>
        </li>)}
      </ol>}
      <div className="actions">{cursor && <button type="button" className="secondary" onClick={() => setCursor("")}>Latest preference changes</button>}{resource.data.nextCursor && <button type="button" className="secondary" onClick={() => setCursor(resource.data!.nextCursor!)}>Older preference changes</button>}</div>
    </>}
  </div>;
}
