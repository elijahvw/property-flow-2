import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useDebouncedValue } from "../useDebouncedValue";
import { useResource } from "../useResource";
import { EditorDialog } from "./EditorDialog";
import { Form } from "./Form";
import { VendorContact, VendorHistory, type Vendor } from "./VendorContact";

type Linked = { id: string; version: number; vendor: Vendor | null };
function VendorPicker({ initial }: { initial: Vendor | null }) {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(initial),
    search = useDebouncedValue(query);
  const r = useResource<{ items: Vendor[]; total: number; pageSize: number }>(
    `/api/company/vendors?${new URLSearchParams({ status: "active", page: String(page), ...(search ? { q: search } : {}) })}`,
    true,
    true,
  );
  return (
    <>
      <input type="hidden" name="vendorId" value={selected?.id || ""} />
      <input
        type="hidden"
        name="vendorVersion"
        value={selected?.version || ""}
      />
      <p role="status">Selected: {selected?.name || "No vendor contact"}</p>
      {selected && (
        <>
          <VendorContact vendor={selected} />
          <button
            type="button"
            className="secondary"
            onClick={() => setSelected(null)}
          >
            Remove vendor link
          </button>
        </>
      )}
      {selected?.status === "archived" && (
        <p className="notice">
          This contact is archived. Choose an active vendor or remove the link.
        </p>
      )}
      <label>
        Find an active vendor
        <input
          type="search"
          maxLength={200}
          placeholder="Name, service or contact"
          onKeyDown={event=>{if(event.key==="Enter")event.preventDefault();}}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      </label>
      {r.error && (
        <p role="alert">
          {r.error}{" "}
          <button type="button" className="secondary" onClick={r.reload}>
            Try again
          </button>
        </p>
      )}
      {!r.data ? (
        !r.error && <p>Loading vendors…</p>
      ) : (
        <>
          <p>
            {r.data.total} matching active{" "}
            {r.data.total === 1 ? "vendor" : "vendors"}
          </p>
          <ul>
            {r.data.items.map((vendor) => (
              <li key={vendor.id}>
                <button
                  type="button"
                  className="secondary"
                  aria-pressed={selected?.id === vendor.id}
                  onClick={() => setSelected(vendor)}
                >
                  Use {vendor.name}
                </button>
                <span className="cell-detail">
                  {vendor.service || "Service not recorded"} ·{" "}
                  {vendor.contactName ||
                    vendor.email ||
                    vendor.phone ||
                    "No contact details"}
                </span>
              </li>
            ))}
          </ul>
          {!r.data.items.length && (
            <p>
              No active vendors match. Add or restore a contact in the vendor
              directory.
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous vendor choices
            </button>
            <button
              type="button"
              className="secondary"
              disabled={page * r.data.pageSize >= r.data.total}
              onClick={() => setPage((value) => value + 1)}
            >
              Next vendor choices
            </button>
          </div>
        </>
      )}
    </>
  );
}
export function MaintenanceVendor({
  requestId,
  changed,
}: {
  requestId: string;
  changed: () => void;
}) {
  const endpoint = `/api/company/maintenance/${encodeURIComponent(requestId)}/vendor`,
    r = useResource<Linked>(endpoint, true, true);
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<{ source: Linked; key: string } | null>(null);
  const directory = `/company/vendors?requestId=${encodeURIComponent(requestId)}`;
  return (
    <section className="panel">
      <div className="page-heading-row">
        <h2>Vendor contact</h2>
        <Link to={directory}>Vendor directory →</Link>
      </div>
      <p className="help">
        Keep the right contact with this request. Contact the vendor directly to
        arrange work.
      </p>
      {r.error && (
        <p role="alert">
          {r.error}{" "}
          <button className="secondary" onClick={r.reload}>
            Try again
          </button>
        </p>
      )}
      {!r.data ? (
        !r.error && <p>Loading vendor contact…</p>
      ) : (
        <>
          {r.data.vendor ? (
            <>
              <h3>
                <Link
                  to={`/company/vendors/${encodeURIComponent(r.data.vendor.id)}?requestId=${encodeURIComponent(requestId)}`}
                >
                  {r.data.vendor.name}
                </Link>
              </h3>
              {r.data.vendor.status === "archived" && (
                <p className="notice">
                  Archived contact · retained for this request.
                </p>
              )}
              <VendorContact vendor={r.data.vendor} />
            </>
          ) : (
            <p>No vendor contact linked.</p>
          )}
          <button
            className="secondary"
            onClick={() => {
              setDraft(
                (previous) =>
                  previous || { source: r.data!, key: crypto.randomUUID() },
              );
              setOpen(true);
            }}
          >
            {r.data.vendor ? "Change vendor contact" : "Link vendor contact"}
          </button>
          <VendorHistory
            key={r.data.version}
            endpoint={`${endpoint}/history`}
          />
        </>
      )}
      {r.data && draft && (
        <EditorDialog
          open={open}
          title="Choose vendor contact"
          onClose={() => setOpen(false)}
          onDiscard={() => {
            setOpen(false);
            setDraft(null);
          }}
        >
          <Form
            key={draft.key}
            label="Save vendor link"
            operation="maintenance.vendor"
            feedbackText="Vendor contact updated."
            submit={async (data) => {
              await api(endpoint, {
                method: "POST",
                body: {
                  vendorId: data.get("vendorId") || null,
                  vendorVersion: data.get("vendorId")
                    ? Number(data.get("vendorVersion"))
                    : null,
                  expectedVersion: draft.source.version,
                  submissionKey: draft.key,
                },
              });
              setOpen(false);
              setDraft(null);
              r.reload();
              changed();
            }}
          >
            <VendorPicker initial={draft.source.vendor} />
          </Form>
        </EditorDialog>
      )}
    </section>
  );
}
