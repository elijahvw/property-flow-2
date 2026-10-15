import { RecordIdentity } from "./RecordIdentity";
import { useEffect, useRef } from "react";
import { useResource } from "../useResource";

export function UserActivity({
  id,
  revision,
}: {
  id: string;
  revision?: string;
}) {
  const r = useResource<
    {
      id: string;
      action: string;
      actorId: string;
      actorLabel?: string;
      actor?: { name: string | null; email: string } | null;
      createdAt: string;
    }[]
  >(`/api/platform/audit?targetId=${encodeURIComponent(id)}`);
  const previous = useRef(revision);
  useEffect(() => {
    if (previous.current !== revision) {
      previous.current = revision;
      r.reload();
    }
  }, [revision]);
  return (
    <details className="editor-section">
      <summary>Account activity</summary>
      <p className="help">
        The latest 100 events involving this account. Times use your browser
        timezone.
      </p>
      {r.error ? (
        <p role="alert">
          {r.error} <button onClick={r.reload}>Try again</button>
        </p>
      ) : !r.data ? (
        <p role="status">Loading activity…</p>
      ) : !r.data.length ? (
        <p>No recorded activity for this account.</p>
      ) : (
        <ol className="activity-list">
          {r.data.map((event) => (
            <li key={event.id}>
              <strong>{event.action.replace(/\./g, " ")}</strong>
              <time dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
              <span className="cell-detail">
                Actor:{" "}
                {event.actorLabel ||
                  event.actor?.name ||
                  event.actor?.email ||
                  "Account"}
              </span>
              <RecordIdentity id={event.actorId} label="Actor" />
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
