import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { useDebouncedValue } from "../useDebouncedValue";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "../components/Form";
import { DraftReset } from "../components/DraftReset";
import {
  VendorContact,
  VendorHistory,
  type Vendor,
} from "../components/VendorContact";

type Directory = {
  items: Vendor[];
  total: number;
  page: number;
  pageSize: number;
};
const base = "/api/company/vendors";
function VendorFields({ vendor }: { vendor?: Vendor }) {
  return (
    <>
      <fieldset className="form-section">
        <legend>Vendor details</legend>
        <div className="form-grid">
          <label>
            Vendor name
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={vendor?.name}
            />
          </label>
          <label>
            Service (optional)
            <input
              name="service"
              maxLength={120}
              placeholder="For example, plumbing"
              defaultValue={vendor?.service || ""}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>Contact details</legend>
        <div className="form-grid">
          <label>
            Contact person (optional)
            <input
              name="contactName"
              maxLength={160}
              defaultValue={vendor?.contactName || ""}
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              name="email"
              maxLength={254}
              defaultValue={vendor?.email || ""}
            />
          </label>
          <label>
            Phone (optional)
            <input
              type="tel"
              name="phone"
              maxLength={50}
              defaultValue={vendor?.phone || ""}
            />
          </label>
        </div>
        <label>
          Private notes (optional)
          <textarea
            name="notes"
            maxLength={2000}
            rows={3}
            defaultValue={vendor?.notes || ""}
          />
        </label>
      </fieldset>
      {vendor && (
        <label>
          Status
          <select name="status" defaultValue={vendor.status}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      )}
      <p className="help">
        These contacts are visible to management. Archiving preserves linked
        requests and history, and removes the vendor from new selections.
      </p>
    </>
  );
}
function ContextBack({ params }: { params: URLSearchParams }) {
  const requestId = params.get("requestId");
  return (
    <nav className="record-breadcrumb">
      <Link to="/company/maintenance">← Maintenance</Link>
      {requestId && (
        <Link to={`/company/maintenance/${encodeURIComponent(requestId)}`}>
          Back to request →
        </Link>
      )}
    </nav>
  );
}
export function Vendors() {
  const { vendorId } = useParams(),
    { data } = useAuth(),
    scope = `${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`;
  return vendorId ? (
    <VendorDetail key={`${scope}:${vendorId}`} id={vendorId} />
  ) : (
    <VendorDirectory key={scope} />
  );
}
function VendorDirectory() {
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate();
  const query = params.get("q") || "",
    status = params.get("status") || "active",
    search = useDebouncedValue(query),
    currentPage = Number(params.get("page")) || 1;
  const r = useResource<Directory>(
    `${base}?${new URLSearchParams({ status, page: String(currentPage), ...(search ? { q: search } : {}) })}`,
    true,
    true,
  );
  const [open, setOpen] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID());
  const change = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };
  const goPage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next);
  };
  return (
    <>
      <ContextBack params={params} />
      <header className="page-heading page-heading-row">
        <div>
          <p className="record-kicker">Operations / Maintenance</p>
          <h1>Vendors</h1>
          <p>
            Keep useful contacts together and connect them to the work they
            support.
          </p>
        </div>
        <button onClick={() => setOpen(true)}>Add vendor</button>
      </header>
      <EditorDialog
        open={open}
        title="Add vendor"
        onClose={() => setOpen(false)}
        onDiscard={() => {
          setOpen(false);
          setKey(crypto.randomUUID());
        }}
      >
        <Form
          key={key}
          label="Save vendor"
          operation="vendor.save"
          feedbackText="Vendor saved."
          secondaryActions={
            <DraftReset reset={() => setKey(crypto.randomUUID())} />
          }
          submit={async (data) => {
            const result = await api<{ vendorId: string }>(base, {
              method: "POST",
              body: { ...Object.fromEntries(data), submissionKey: key },
            });
            setOpen(false);
            setKey(crypto.randomUUID());
            navigate(
              `/company/vendors/${encodeURIComponent(result.vendorId)}?${params}`,
            );
          }}
        >
          <VendorFields />
        </Form>
      </EditorDialog>
      <section className="panel">
        <div className="filters">
          <label>
            Search vendors
            <input
              type="search"
              maxLength={200}
              value={query}
              onChange={(event) => change("q", event.target.value)}
              placeholder="Name, service or contact"
            />
          </label>
          <label>
            Vendor status
            <select
              value={status}
              onChange={(event) => change("status", event.target.value)}
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All vendors</option>
            </select>
          </label>
        </div>
        {r.error && (
          <p role="alert">
            {r.error}{" "}
            <button className="secondary" onClick={r.reload}>
              Try again
            </button>
          </p>
        )}
        {!r.data ? (
          !r.error && <p>Loading vendors…</p>
        ) : (
          <>
            <p role="status">
              {r.data.total} matching{" "}
              {r.data.total === 1 ? "vendor" : "vendors"}
            </p>
            {!r.data.items.length ? (
              <div className="empty-state">
                <h2>No vendors match this view.</h2>
                <p>
                  Search before adding a contact. Include archived vendors when
                  checking an existing name.
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="core-table">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>Contact</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.data.items.map((vendor) => (
                      <tr key={vendor.id}>
                        <td>
                          <Link
                            className="table-primary"
                            to={`/company/vendors/${encodeURIComponent(vendor.id)}?${params}`}
                          >
                            {vendor.name}
                          </Link>
                          <span className="cell-detail">
                            {vendor.service || "Service not recorded"}
                          </span>
                        </td>
                        <td>
                          {vendor.contactName || "Contact not recorded"}
                          <span className="cell-detail">
                            {vendor.email ||
                              vendor.phone ||
                              "No contact details"}
                          </span>
                        </td>
                        <td>
                          {vendor.status === "active" ? "Active" : "Archived"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="actions">
              <button
                className="secondary"
                disabled={currentPage <= 1}
                onClick={() => goPage(currentPage - 1)}
              >
                Previous vendors
              </button>
              <span>
                Page {r.data.page} of{" "}
                {Math.max(1, Math.ceil(r.data.total / r.data.pageSize))}
              </span>
              <button
                className="secondary"
                disabled={currentPage * r.data.pageSize >= r.data.total}
                onClick={() => goPage(currentPage + 1)}
              >
                Next vendors
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
function VendorDetail({ id }: { id: string }) {
  const [params] = useSearchParams(),
    r = useResource<Vendor>(`${base}/${encodeURIComponent(id)}`, true, true),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState<{ vendor: Vendor; key: string } | null>(null);
  const [requestPage, setRequestPage] = useState(1),
    requests = useResource<{
      items: {
        id: string;
        title: string;
        status: string;
        property: { name: string };
        unit: { label: string } | null;
      }[];
      total: number;
      pageSize: number;
    }>(
      `${base}/${encodeURIComponent(id)}/requests?page=${requestPage}`,
      true,
      true,
    );
  return (
    <>
      <ContextBack params={params} />
      <p>
        <Link to={`/company/vendors?${params}`}>← Back to vendors</Link>
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
        !r.error && <p>Loading vendor…</p>
      ) : (
        <>
          <header className="page-heading page-heading-row">
            <div>
              <p className="record-kicker">Vendor contact</p>
              <h1>{r.data.name}</h1>
              <p>
                {r.data.status === "active"
                  ? "Active"
                  : "Archived · existing request links are retained"}
              </p>
            </div>
            <button
              onClick={() => {
                setDraft(
                  (previous) =>
                    previous || { vendor: r.data!, key: crypto.randomUUID() },
                );
                setOpen(true);
              }}
            >
              Edit vendor
            </button>
          </header>
          <section className="panel">
            <VendorContact vendor={r.data} />
            {r.data.notes && (
              <>
                <h2>Private notes</h2>
                <p className="preserve-lines">{r.data.notes}</p>
              </>
            )}
          </section>
          {draft && (
            <EditorDialog
              open={open}
              title="Edit vendor"
              onClose={() => setOpen(false)}
              onDiscard={() => {
                setOpen(false);
                setDraft(null);
              }}
            >
              <Form
                key={draft.key}
                operation="vendor.save"
                feedbackText="Vendor saved."
                label="Save vendor changes"
                submit={async (data) => {
                  await api(`${base}/${encodeURIComponent(id)}`, {
                    method: "PATCH",
                    body: {
                      ...Object.fromEntries(data),
                      expectedVersion: draft.vendor.version,
                      submissionKey: draft.key,
                    },
                  });
                  setOpen(false);
                  setDraft(null);
                  r.reload();
                }}
              >
                <VendorFields vendor={draft.vendor} />
              </Form>
            </EditorDialog>
          )}
          <section className="panel">
            <h2>Linked maintenance requests</h2>
            {requests.error && (
              <p role="alert">
                {requests.error}{" "}
                <button className="secondary" onClick={requests.reload}>
                  Try again
                </button>
              </p>
            )}
            {!requests.data ? (
              !requests.error && <p>Loading requests…</p>
            ) : (
              <>
                <p>
                  {requests.data.total} linked{" "}
                  {requests.data.total === 1 ? "request" : "requests"}
                </p>
                <ul>
                  {requests.data.items.map((request) => (
                    <li key={request.id}>
                      <Link
                        to={`/company/maintenance/${encodeURIComponent(request.id)}?vendorId=${encodeURIComponent(id)}`}
                      >
                        {request.title}
                      </Link>
                      <span className="cell-detail">
                        {request.property.name} ·{" "}
                        {request.unit?.label || "Property-wide"} ·{" "}
                        {request.status.replace(/_/g, " ")}
                      </span>
                    </li>
                  ))}
                </ul>
                {!requests.data.items.length && (
                  <p>
                    Choose this contact from a maintenance request's Vendor
                    contact section.
                  </p>
                )}
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={requestPage === 1}
                    onClick={() => setRequestPage((value) => value - 1)}
                  >
                    Previous requests
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      requestPage * requests.data.pageSize >=
                      requests.data.total
                    }
                    onClick={() => setRequestPage((value) => value + 1)}
                  >
                    Next requests
                  </button>
                </div>
              </>
            )}
          </section>
          <VendorHistory
            key={r.data.version}
            endpoint={`${base}/${encodeURIComponent(id)}/history`}
          />
        </>
      )}
    </>
  );
}
