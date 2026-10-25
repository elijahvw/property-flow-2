import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { availableFeatureRoute } from "../company-features";
import { formatDate } from "../dates";
import { leasePath } from "../lease-links";
import { tenantLedgerContext } from "../tenant-links";
import { useResource } from "../useResource";

export type RentalAssociation = {
  leaseId: string; propertyId: string; propertyName: string; unitLabel: string;
  role: string; status: string; startsOn: string; endsOn: string | null; blocksArchive?: boolean;
};
type RentalHistory = {
  companyId: string; today: string; timezone: string;
  person: { kind: "contact" | "resident"; id: string; contactId: string | null; userId: string | null; name: string; recordStatus: string; portalState: string };
  items: RentalAssociation[]; total: number; pageSize: number; nextCursor: string | null; previousCursor: string | null;
};
export const rentalStatusLabel = (status: string) => ({ current: "Current", upcoming: "Upcoming", draft: "Draft lease", former: "Former" } as Record<string, string>)[status] || status;

export function TenantRentalHistory({ id, contact = false }: { id: string; contact?: boolean }) {
  const { data, can } = useAuth();
  if (!can("resident.assignment.manage") || !availableFeatureRoute("/company/residents", data?.companyFeatures)) return null;
  return <RentalHistoryWorkspace key={`${id}:${contact}:${data?.user.id}:${data?.membership?.companyId}:${data?.membership?.version}`} id={id} contact={contact}/>;
}

function RentalHistoryWorkspace({ id, contact }: { id: string; contact: boolean }) {
  const { data: auth, can, refreshUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const cursor = params.get("rentalCursor") || "", before = params.get("rentalBefore") || "";
  const resource = useResource<RentalHistory>(`/api/company/${contact ? "resident-contacts" : "resident-profiles"}/${encodeURIComponent(id)}/rentals?${new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(before ? { before } : {}) })}`, true, true);
  const [refreshing, setRefreshing] = useState(false);
  const summary = useRef<HTMLParagraphElement>(null);
  const intentional = useRef<string | null>(params.get("section") === "rentals" ? `${cursor}:${before}` : null);
  const companyChanged = !!resource.data && resource.data.companyId !== auth?.membership?.companyId;
  const history = companyChanged || resource.error ? undefined : resource.data;
  useEffect(() => {
    if (resource.error || companyChanged || (intentional.current && intentional.current !== `${cursor}:${before}`)) intentional.current = null;
    if (!history || resource.loading || intentional.current !== `${cursor}:${before}`) return;
    intentional.current = null;
    summary.current?.focus({ preventScroll: true });
    summary.current?.scrollIntoView({ block: "nearest" });
  }, [history, resource.loading, resource.error, cursor, before, companyChanged]);
  const page = (direction?: "rentalCursor" | "rentalBefore", token?: string) => {
    const next = new URLSearchParams(params); next.delete("rentalCursor"); next.delete("rentalBefore"); next.set("section", "rentals");
    if (direction && token) next.set(direction, token);
    intentional.current = `${next.get("rentalCursor") || ""}:${next.get("rentalBefore") || ""}`;
    setParams(next);
  };
  const sourceParams = new URLSearchParams(params); sourceParams.set("section", "rentals");
  const context = tenantLedgerContext(history?.person.id || id, sourceParams, history ? history.person.kind === "contact" : contact);
  return <section className="panel" id="rental-history" aria-label="Rental history">
    <div className="section-heading"><h2>Rental history</h2>{history && <span className="directory-count">{history.total} {history.total === 1 ? "rental" : "rentals"}</span>}</div>
    <p className="help">Recorded lease relationships, including former occupants and earlier terms. Portal access and current financial balances are reviewed separately.</p>
    {companyChanged ? <div className="notice error" role="alert"><p>Your company workspace changed. Reload before viewing this rental history.</p><button disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refreshUser(); } finally { setRefreshing(false); } }}>{refreshing ? "Reloading workspace…" : "Reload workspace"}</button></div> : <>
      {resource.error && <div className="notice error" role="alert"><p>Rental history is unavailable. {resource.error}</p><button className="secondary" onClick={resource.reload}>Retry rental history</button>{(cursor || before) && <button className="secondary" disabled={resource.loading} onClick={() => page()}>First page of rental history</button>}</div>}
      {!history ? !resource.error && <p role="status">Loading rental history…</p> : <>
        <p className="help">{history.person.name}{history.person.recordStatus === "archived" ? " · Archived tenant record" : ""} · Relationships as of {formatDate(history.today)} ({history.timezone}).</p>
        {resource.loading && <p role="status" className="help">Refreshing rental history…</p>}
        <p ref={summary} tabIndex={-1} role="status" className="directory-results">{history.total} recorded {history.total === 1 ? "rental" : "rentals"} · {history.items.length} shown on this page</p>
        {!history.items.length ? <p>No rental relationships have been recorded for this tenant.</p> : <ul className="record-list">
          {history.items.map(rental => <li key={rental.leaseId}><div>
            <h3>{can("lease.manage") ? <Link to={leasePath(rental.leaseId, context)}>{rental.propertyName} · {rental.unitLabel}</Link> : <strong>{rental.propertyName} · {rental.unitLabel}</strong>}</h3>
            <p>{rentalStatusLabel(rental.status)} · {rental.role === "occupant" ? "Occupant" : "Leaseholder"}</p>
            <p className="help">Relationship: {formatDate(rental.startsOn)} – {formatDate(rental.endsOn, "Open ended")}</p>
          </div></li>)}
        </ul>}
        <nav className="actions" aria-label="Rental history pages">
          <button className="secondary" disabled={resource.loading || !history.previousCursor} onClick={() => page("rentalBefore", history.previousCursor!)}>Previous rentals</button>
          <span>{history.pageSize} rentals per page</span>
          <button className="secondary" disabled={resource.loading || !history.nextCursor} onClick={() => page("rentalCursor", history.nextCursor!)}>Next rentals</button>
          {(cursor || before) && <button className="secondary" disabled={resource.loading} onClick={() => page()}>First rental history page</button>}
        </nav>
      </>}
    </>}
  </section>;
}
