import { useState } from "react";
import { Link } from "react-router-dom";
import { formatActivityTime } from "../dates";
import { useResource } from "../useResource";

export type Vendor = {
  id: string;
  name: string;
  service: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: string;
  version: number;
};
export function VendorContact({ vendor }: { vendor: Vendor }) {
  return (
    <dl className="details">
      <div>
        <dt>Service</dt>
        <dd>{vendor.service || "Not recorded"}</dd>
      </div>
      <div>
        <dt>Contact person</dt>
        <dd>{vendor.contactName || "Not recorded"}</dd>
      </div>
      <div>
        <dt>Email</dt>
        <dd>
          {vendor.email ? (
            <a href={`mailto:${encodeURIComponent(vendor.email)}`}>
              {vendor.email}
            </a>
          ) : (
            "Not recorded"
          )}
        </dd>
      </div>
      <div>
        <dt>Phone</dt>
        <dd>
          {vendor.phone ? (
            <a href={`tel:${vendor.phone.replace(/[^+0-9]/g, "")}`}>
              {vendor.phone}
            </a>
          ) : (
            "Not recorded"
          )}
        </dd>
      </div>
    </dl>
  );
}
type HistoryItem = {
  id: string;
  action: string;
  actorName: string;
  createdAt: string;
  requestId: string | null;
  snapshot: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    from?: { name: string } | null;
    to?: { name: string } | null;
  };
};
const labels: Record<string, string> = {
  name: "Vendor",
  service: "Service",
  contactName: "Contact person",
  email: "Email",
  phone: "Phone",
  notes: "Notes",
  status: "Status",
};
export function VendorHistory({ endpoint }: { endpoint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Vendor history</summary>
      {open && <VendorHistoryContent endpoint={endpoint} />}
    </details>
  );
}
function VendorHistoryContent({ endpoint }: { endpoint: string }) {
  const [cursors, setCursors] = useState<string[]>([]),
    cursor = cursors.at(-1);
  const r = useResource<{ items: HistoryItem[]; nextCursor: string | null }>(
    `${endpoint}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    true,
    true,
  );
  return (
    <div>
      {r.error && (
        <p role="alert">
          {r.error}{" "}
          <button className="secondary" onClick={r.reload}>
            Try again
          </button>
        </p>
      )}
      {!r.data ? (
        !r.error && <p>Loading history…</p>
      ) : (
        <>
          <ol>
            {r.data.items.map((item) => (
              <li key={item.id}>
                <strong>
                  {
                    (
                      {
                        create: "Vendor added",
                        edit: "Contact details updated",
                        archive: "Vendor archived",
                        restore: "Vendor restored",
                        link: "Request vendor changed",
                      } as Record<string, string>
                    )[item.action]
                  }
                </strong>
                <p className="help">
                  {formatActivityTime(item.createdAt)} · {item.actorName}
                </p>
                {item.action === "link" ? (
                  <p>
                    {item.snapshot.from?.name || "No vendor"} →{" "}
                    {item.snapshot.to?.name || "No vendor"}
                  </p>
                ) : (
                  <details>
                    <summary>Recorded changes</summary>
                    <dl className="details">
                      {Object.entries(labels)
                        .filter(
                          ([field]) =>
                            item.snapshot.after &&
                            field in item.snapshot.after &&
                            item.snapshot.after[field] !==
                              item.snapshot.before?.[field],
                        )
                        .map(([field, label]) => (
                          <div key={field}>
                            <dt>{label}</dt>
                            <dd className="preserve-lines">
                              {item.snapshot.before
                                ? `${String(item.snapshot.before[field] || "Not set")} → `
                                : ""}
                              {String(
                                item.snapshot.after?.[field] || "Not set",
                              )}
                            </dd>
                          </div>
                        ))}
                    </dl>
                  </details>
                )}
                {item.requestId && (
                  <Link
                    to={`/company/maintenance/${encodeURIComponent(item.requestId)}`}
                  >
                    Open request →
                  </Link>
                )}
              </li>
            ))}
          </ol>
          {!r.data.items.length && <p>No recorded changes.</p>}
          <div className="actions">
            <button
              className="secondary"
              disabled={!cursors.length}
              onClick={() => setCursors((value) => value.slice(0, -1))}
            >
              Newer changes
            </button>
            <button
              className="secondary"
              disabled={!r.data.nextCursor}
              onClick={() =>
                setCursors((value) => [...value, r.data!.nextCursor!])
              }
            >
              Earlier changes
            </button>
          </div>
        </>
      )}
    </div>
  );
}
