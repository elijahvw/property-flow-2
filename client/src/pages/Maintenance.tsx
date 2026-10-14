import { useAuth } from "../context/AuthContext";
import { useState } from "react";
import { api } from "../api";
import { useResource } from "../useResource";
import { EditorDialog } from "../components/EditorDialog";
import { Form } from "./Workspace";
type Row = {
  id: string;
  propertyId: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  property: { name: string };
};
const statuses = ["open", "in_progress", "resolved"];
const label = (value: string) => value.replace("_", " ");
function Loading({ error, retry }: { error?: string; retry: () => void }) {
  return error ? (
    <div role="alert" className="notice error">
      <p>{error}</p>
      <button onClick={retry}>Try again</button>
    </div>
  ) : (
    <p role="status">Loading maintenance…</p>
  );
}
export function Maintenance({ resident = false }: { resident?: boolean }) {
  const { data } = useAuth();
  return (
    <RequestWorkspace
      key={`${resident}:${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}:${data?.permissions.join(",")}`}
      resident={resident}
    />
  );
}
function RequestWorkspace({ resident }: { resident: boolean }) {
  const [adding, setAdding] = useState(false),
    [selected, setSelected] = useState<Row | null>(null);
  const [status, setStatus] = useState(""),
    [propertyId, setPropertyId] = useState("");
  const [success, setSuccess] = useState("");
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());
  const base = resident
    ? "/api/resident/maintenance"
    : "/api/company/maintenance";
  const properties = useResource<{ id: string; name: string }[]>(
    resident ? "/api/resident/properties" : "/api/company/properties",
  );
  const r = useResource<Row[]>(
    `${base}?${new URLSearchParams({ ...(status ? { status } : {}), ...(propertyId ? { propertyId } : {}) })}`,
  );
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow">{resident ? "Resident" : "Company"}</p>
        <h1>{resident ? "My maintenance requests" : "Maintenance requests"}</h1>
        <p>
          {resident
            ? "View your own requests for properties currently assigned to you. Access ends when an assignment is removed or transferred."
            : "Company request history remains available after resident assignments end."}
        </p>
        {resident && (
          <button
            onClick={() => {
              setSuccess("");
              setAdding(true);
            }}
          >
            Submit a request
          </button>
        )}
      </header>
      {resident && (
        <EditorDialog
          open={adding}
          title="Submit a request"
          onClose={() => setAdding(false)}
        >
          <p className="help">
            For emergencies, contact local emergency services. High priority
            does not guarantee an immediate response.
          </p>
          {!properties.data ? (
            <Loading error={properties.error} retry={properties.reload} />
          ) : !properties.data.length ? (
            <p>
              No properties assigned. Ask your property manager for an
              assignment before submitting a request.
            </p>
          ) : (
            <Form
              key={submissionKey}
              label="Submit request"
              operation="maintenance.create"
              submit={async (data) => {
                await api(base, {
                  method: "POST",
                  body: { ...Object.fromEntries(data), submissionKey },
                });
                r.reload();
                setAdding(false);
                setSubmissionKey(crypto.randomUUID());
                setSuccess("Request submitted.");
              }}
            >
              <label>
                Assigned property
                <select required name="propertyId">
                  {properties.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Title
                <input required name="title" maxLength={160} />
              </label>
              <label>
                Description
                <textarea
                  required
                  name="description"
                  maxLength={4000}
                  rows={4}
                />
              </label>
              <label>
                Priority
                <select name="priority" defaultValue="normal">
                  {["low", "normal", "high"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <p className="help">
                Retry keeps the same submission. Keep the original details when
                retrying; start a new request only for a separate issue.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => setSubmissionKey(crypto.randomUUID())}
              >
                Start a new request
              </button>
            </Form>
          )}
        </EditorDialog>
      )}
      {success && (
        <p role="status" className="notice">
          {success}
        </p>
      )}
      <section className="panel">
        <h2>Requests</h2>
        <div className="form-grid">
          <label>
            Filter status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {statuses.map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter property
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
            >
              <option value="">All properties</option>
              {properties.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!resident && !properties.data && (
          <Loading error={properties.error} retry={properties.reload} />
        )}
        {!r.data ? (
          <Loading error={r.error} retry={r.reload} />
        ) : (
          <>
            <p role="status">
              {r.data.length} matching requests ·{" "}
              {statuses
                .map(
                  (v) =>
                    `${r.data!.filter((x) => x.status === v).length} ${label(v)}`,
                )
                .join(" · ")}
            </p>
            {!r.data.length ? (
              <p>No requests match these filters.</p>
            ) : (
              <ul className="record-list">
                {r.data.map((row) => (
                  <li key={row.id}>
                    <div>
                      <h3>{row.title}</h3>
                      <p>
                        {row.property.name} · {row.priority} priority ·{" "}
                        {label(row.status)}
                      </p>
                      <p
                        style={{
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {row.description}
                      </p>
                      {!resident && (
                        <button
                          className="secondary"
                          onClick={() => setSelected(row)}
                        >
                          Manage request
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      {selected && (
        <EditorDialog
          open
          title={selected.title}
          onClose={() => setSelected(null)}
        >
          <p className="preserve-lines">{selected.description}</p>{" "}
          <Form
            key={selected.id + selected.status}
            operation="maintenance.status"
            label="Update status"
            submit={async (data) => {
              await api(`${base}/${encodeURIComponent(selected.id)}`, {
                method: "PATCH",
                body: { status: data.get("status") },
              });
              setSuccess("Request status updated.");
              r.reload();
              setSelected(null);
            }}
          >
            <label>
              Status for {selected.title}
              <select name="status" defaultValue={selected.status}>
                {statuses.map((v) => (
                  <option key={v} value={v}>
                    {label(v)}
                  </option>
                ))}
              </select>
            </label>
          </Form>
        </EditorDialog>
      )}
    </>
  );
}
