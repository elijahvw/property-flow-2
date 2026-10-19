import { Link } from "react-router-dom";
import { useResource } from "../useResource";
import { formatDate } from "../dates";
export function PreventiveSource({ requestId }: { requestId: string }) {
  const r = useResource<{
    dueOn: string;
    plan: { id: string; title: string; timezone: string; status: string };
  } | null>(
    `/api/company/maintenance/${encodeURIComponent(requestId)}/preventive`,
    true,
    true,
  );
  if (r.error)
    return (
      <p role="alert">
        Schedule source: {r.error}{" "}
        <button className="secondary" onClick={r.reload}>
          Try again
        </button>
      </p>
    );
  if (!r.data) return null;
  return (
    <section className="panel">
      <h2>Scheduled source</h2>
      <p>
        <Link to={`/company/preventive/${encodeURIComponent(r.data.plan.id)}`}>
          {r.data.plan.title}
        </Link>{" "}
        · Due {formatDate(r.data.dueOn)} · {r.data.plan.timezone}
      </p>
      <p className="help">
        This occurrence is already recorded. Future schedule edits do not change
        this request.
      </p>
    </section>
  );
}
