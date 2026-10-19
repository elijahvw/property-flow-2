import { Link, useSearchParams } from "react-router-dom";
import { useResource } from "../useResource";
import { useDebouncedValue } from "../useDebouncedValue";
import { formatActivityDate } from "../dates";
import { documentSource } from "../document-context";
type Document = {
  id: string;
  title: string;
  source: "leases" | "maintenance";
  sourceId: string;
  propertyName: string;
  unitLabel: string | null;
  requestTitle: string | null;
  latestNumber: number;
  filename: string;
  scanStatus: string;
  byteLength: number;
  uploadedAt: string;
  archivedAt: string | null;
};
export function DocumentLibrary() {
  const [params, setParams] = useSearchParams(),
    search = useDebouncedValue(params.get("q") || ""),
    query = new URLSearchParams();
  for (const key of ["source", "status", "scan", "propertyId", "page"])
    if (params.get(key)) query.set(key, params.get(key)!);
  if (search.trim()) query.set("q", search.trim());
  const r = useResource<{
      items: Document[];
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/company/documents?${query}`, true, true),
    properties = useResource<{ id: string; name: string }[]>(
      "/api/company/properties",
      true,
      true,
    );
  const change = (key: string, value: string) => {
    const q = new URLSearchParams(params);
    q.delete("page");
    if (value) q.set(key, value);
    else q.delete(key);
    setParams(q, { replace: true });
  };
  return (
    <>
      <header className="page-heading">
        <h1>Private document library</h1>
        <p>
          Find retained files across leases and maintenance, then open their
          source to review versions, scan, or download.
        </p>
      </header>
      <p className="help">
        Management only. Scan filters describe the latest uploaded version.
        Earlier originals and scan results remain on the source record.
      </p>
      <div className="directory-toolbar">
        <label className="directory-search">
          Search documents
          <input
            type="search"
            aria-label="Search documents"
            maxLength={200}
            placeholder="Title, latest filename, property or request"
            value={params.get("q") || ""}
            onChange={(e) => change("q", e.target.value)}
          />
        </label>
        <label>
          Source type
          <select
            aria-label="Source type"
            value={params.get("source") || "all"}
            onChange={(e) => change("source", e.target.value)}
          >
            <option value="all">Leases &amp; maintenance</option>
            <option value="leases">Leases</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </label>
        <label>
          Document status
          <select
            aria-label="Document status"
            value={params.get("status") || "active"}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All statuses</option>
          </select>
        </label>
        <label>
          Latest scan result
          <select
            aria-label="Latest scan result"
            value={params.get("scan") || "all"}
            onChange={(e) => change("scan", e.target.value)}
          >
            <option value="all">All scan results</option>
            <option value="pending">Quarantined</option>
            <option value="rejected">Rejected</option>
            <option value="clean">Cleared</option>
          </select>
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
      {!r.data ? (
        !r.error && <p role="status">Loading private documents…</p>
      ) : (
        <section className="panel">
          <p role="status">
            {r.data.total} matching{" "}
            {r.data.total === 1 ? "document" : "documents"}
          </p>
          {!r.data.items.length && (
            <p>
              No documents match. Upload from the exact{" "}
              <Link to="/company/leases">lease</Link> or{" "}
              <Link to="/company/maintenance">maintenance request</Link> to keep
              its source and history connected.
            </p>
          )}
          <div className="table-wrap">
            <table className="core-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Source</th>
                  <th>Latest version</th>
                  <th>Scan result</th>
                </tr>
              </thead>
              <tbody>
                {r.data.items.map((doc) => (
                  <tr key={doc.id}>
                    <td data-label="Document">
                      <Link to={documentSource(params, doc)}>{doc.title}</Link>
                      {doc.archivedAt && (
                        <span className="cell-detail">
                          Archived · originals retained
                        </span>
                      )}
                    </td>
                    <td data-label="Source">
                      {doc.source === "leases" ? "Lease" : "Maintenance"}
                      <span className="cell-detail">
                        {doc.propertyName} · {doc.unitLabel || "Whole property"}
                      </span>
                      {doc.requestTitle && (
                        <span className="cell-detail">{doc.requestTitle}</span>
                      )}
                    </td>
                    <td data-label="Latest version">
                      Version {doc.latestNumber}
                      <span className="cell-detail">
                        {doc.filename} · {Math.ceil(doc.byteLength / 1024)} KB
                      </span>
                      <span className="cell-detail">
                        {formatActivityDate(doc.uploadedAt)}
                      </span>
                    </td>
                    <td data-label="Scan result">
                      {doc.scanStatus === "clean"
                        ? "Cleared by scanning"
                        : doc.scanStatus === "rejected"
                          ? "Rejected · download blocked"
                          : "Quarantined · download blocked"}
                      <span className="cell-detail">
                        Open the source to review retained versions.
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button
              className="secondary"
              disabled={r.data.page === 1}
              onClick={() => change("page", String(r.data!.page - 1))}
            >
              Previous documents
            </button>
            <span>Page {r.data.page}</span>
            <button
              className="secondary"
              disabled={r.data.page * r.data.pageSize >= r.data.total}
              onClick={() => change("page", String(r.data!.page + 1))}
            >
              Next documents
            </button>
          </div>
        </section>
      )}
    </>
  );
}
