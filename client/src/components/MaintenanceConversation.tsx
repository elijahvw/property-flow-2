import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../context/AuthContext";
import { formatActivityTime } from "../dates";
import { useResource } from "../useResource";
import { Form } from "./Form";
import { EditorDialog } from "./EditorDialog";
import { DraftReset } from "./DraftReset";
import { useEditorNavigationGuard } from "./PageLeaveGuard";
import "./MaintenanceConversation.css";

type Update = { id: string; content: string; visibility: string; author: string; createdAt: string };
type Attempt = { content: string; submissionKey: string };
function pending(key: string): Attempt | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    return value && typeof value.content === "string" && value.content.length <= 4000 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.submissionKey) ? value : null;
  } catch { return null; }
}
export function MaintenanceConversation({ endpoint, resident, canShare }: { endpoint: string; resident: boolean; canShare: boolean }) {
  const { data: auth } = useAuth();
  const storageKey = `pf-maintenance-reply:${auth?.user.id}:${auth?.membership?.companyId}:${endpoint}`;
  const [attempt, setAttempt] = useState<Attempt | null>(() => resident ? pending(storageKey) : null);
  const [replyText, setReplyText] = useState(() => attempt?.content || "");
  const [cursor, setCursor] = useState(""), [adding, setAdding] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() => attempt?.submissionKey || crypto.randomUUID());
  const [success, setSuccess] = useState("");
  const [sending, setSending] = useState(false);
  const unsentText = !!replyText.trim() && !attempt;
  const releaseReplyNavigation = useEditorNavigationGuard({
    active: resident && (unsentText || !!attempt || sending),
    busy: resident && sending,
    uncertain: resident && !!attempt,
  });
  useEffect(() => {
    // Attempted replies already have a recovery journal. Unsubmitted text and
    // an in-flight request still need a native reload/close warning.
    if (!resident || (!unsentText && !sending)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [resident, unsentText, sending]);
  const updates = useResource<{ items: Update[]; nextCursor: string | null }>(
    `${endpoint}/updates${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`, true, true,
  );
  const changed = (message: string) => {
    setSuccess(message); setSubmissionKey(crypto.randomUUID()); setCursor(""); updates.reload();
    window.dispatchEvent(new Event("notifications-changed"));
  };
  return <section className="panel maintenance-conversation" aria-label="Request updates">
    <div className="section-heading"><h2>{resident ? "Conversation with your property team" : "Progress updates & conversation"}</h2>
      {!resident && <button disabled={!updates.data || !!updates.error} onClick={() => { setSuccess(""); setAdding(true); }}>Add update</button>}
    </div>
    <p className="help">{resident ? "Reply about this request and read updates from your property team. Replies do not change the request’s status." : "Reply to the resident requester or add a private management note. Shared messages create in-app notifications; email and text messages are not sent."}</p>
    {success && <p role="status" className="notice">{success}</p>}
    {updates.error && <p className="notice error" role="alert">{updates.error} <button className="text-button" onClick={updates.reload}>Refresh conversation</button></p>}
    {!updates.data ? !updates.error && <p role="status">Loading conversation…</p> : <>
      {!updates.data.items.length ? <p>{resident ? "No shared updates yet. You can send a reply below." : "No progress updates recorded yet."}</p> :
        <ol className="maintenance-conversation-list">
          {updates.data.items.map(update => <li key={update.id}>
            <div className="section-heading"><strong>{update.author}</strong>{!resident && <span className={`status-pill ${update.visibility === "internal" ? "" : "active"}`}>{update.visibility === "internal" ? "Internal note" : "Resident-visible update"}</span>}</div>
            <time dateTime={update.createdAt}>{formatActivityTime(update.createdAt)}</time>
            <p className="preserve-lines">{update.content}</p>
          </li>)}
        </ol>}
      <div className="actions">
        {cursor && <button className="secondary" onClick={() => setCursor("")}>Latest updates</button>}
        {updates.data.nextCursor && <button className="secondary" onClick={() => setCursor(updates.data!.nextCursor!)}>Older updates</button>}
      </div>
    </>}
    {resident && updates.data && !updates.error && <div className="maintenance-reply-form">
      <Form key={submissionKey} operation="maintenance.reply" label={attempt ? "Retry original reply" : "Send reply"} recovering={!!attempt} successText="Reply sent." feedbackText="Reply sent to your property team."
        submit={async () => {
          const payload = attempt || { content: replyText, submissionKey };
          setSending(true);
          try {
            sessionStorage.setItem(storageKey, JSON.stringify(payload)); setAttempt(payload);
            await api(`${endpoint}/updates`, { method: "POST", body: payload });
            // Release synchronously only after a confirmed commit, so queued
            // navigation can proceed without discarding an uncertain reply.
            releaseReplyNavigation();
            sessionStorage.removeItem(storageKey); setAttempt(null); setReplyText(""); changed("Reply sent to your property team.");
          }
          catch (error) {
            if (!attempt && error instanceof ApiError && !error.submissionUncertain) { sessionStorage.removeItem(storageKey); setAttempt(null); }
            throw error;
          }
          finally { setSending(false); }
        }}>
        <label>Reply to your property team<textarea aria-label="Reply to your property team" required maxLength={4000} rows={4} value={replyText} readOnly={!!attempt} onChange={event => { setReplyText(event.target.value); setSuccess(""); }} /></label>
        {attempt && <p className="notice">This reply may already be recorded. Retry the original reply to confirm it; another message will not be created.</p>}
        <p className="help">Only you and your property’s management team can see this conversation. Messages are retained. For an emergency, contact local emergency services.</p>
      </Form>
    </div>}
    {!resident && <EditorDialog open={adding} title="Add maintenance update" onClose={() => setAdding(false)} onDiscard={() => { setAdding(false); setSubmissionKey(crypto.randomUUID()); }}>
      <Form key={submissionKey} operation="maintenance.update" label="Record update" feedbackText="Maintenance update recorded."
        secondaryActions={<DraftReset reset={() => setSubmissionKey(crypto.randomUUID())} />}
        submit={async form => {
          await api(`${endpoint}/updates`, { method: "POST", body: { content: form.get("content"), visibility: form.get("visibility"), submissionKey } });
          setAdding(false); changed("Update recorded.");
        }}>
        <fieldset className="form-section"><legend>Update and audience</legend>
          <label>Who can see this update?<select name="visibility" aria-label="Update audience" defaultValue="internal"><option value="internal">Management team only</option>{canShare && <option value="resident">Resident requester and management team</option>}</select></label>
          <p className="help">{canShare ? "Shared replies appear in the requester’s conversation and in-app inbox while they retain access. Internal notes remain private to management." : "This management-created request has no resident requester. Its updates stay internal."}</p>
          <label>Update (required)<textarea name="content" aria-label="Update text" required maxLength={4000} rows={6} /></label>
        </fieldset>
        <p className="help">Review the audience before saving. Recorded updates and their audience are retained; add a follow-up to correct an earlier update.</p>
      </Form>
    </EditorDialog>}
  </section>;
}
