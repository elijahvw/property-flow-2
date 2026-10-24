import { Buffer } from "node:buffer";

type Options = { companyId: string; today?: string; timezone?: string };
const pageToken = (offset: number) => Buffer.from(JSON.stringify({ offset })).toString("base64url");
function pageOffset(token: string | null) {
  if (!token) return 0;
  const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8")).offset;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid tenant directory fixture page.");
  return value as number;
}

function fixturePerson(row: any) {
    const contactId = row.contactId || (row.kind !== "resident" ? row.id : null);
    const kind = row.kind || (contactId ? "contact" : "resident");
    const userId = row.userId ?? row.user?.id ?? null;
    const id = kind === "contact" ? contactId : userId;
    if (!id) throw new Error("Tenant directory fixtures require an existing contact or account ID.");
    const rentals = row.rentals || [];
    const portalState = row.portalState || (!row.user ? "offline" : row.status !== "active" || row.user.status !== "active" ? "disabled" : row.user.emailVerified ? "active" : "verification");
    return {
      kind, id, contactId: contactId || null, userId, version: row.version,
      name: row.name || row.contactName || row.user?.name || row.email || row.user?.email || "Tenant",
      email: row.email ?? row.user?.email ?? null, phone: row.phone ?? row.contactPhone ?? null,
      contactName: row.contactName ?? row.name ?? null, contactPhone: row.contactPhone ?? row.phone ?? null,
      status: row.status || "active", recordStatus: row.recordStatus || (kind === "contact" ? row.status || "active" : "active"),
      portalState, user: row.user || null, rentals, rentalCount: rentals.length, canArchive: row.canArchive === true,
    };
}

// Existing fixtures provide the complete associations. Filter before truncating
// the directory preview, and never manufacture an account or contact source ID.
export function tenantDirectoryFixture(rows: readonly any[], requestUrl: string | URL, options: Options) {
  const params = new URL(requestUrl).searchParams;
  const full = rows.map(fixturePerson);
  const properties = [...new Map<string, string>(full.flatMap(row => row.rentals)
    .filter(rental => rental.propertyId && rental.propertyName)
    .map(rental => [rental.propertyId, rental.propertyName] as [string, string])).entries()]
    .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const query = (params.get("q") || "").trim().toLowerCase();
  const access = params.get("access") || "all", property = params.get("propertyId") || "", rental = params.get("rental") || "all";
  const filtered = full.filter(row =>
    `${row.contactName || row.name || ""} ${row.user?.name || ""} ${row.email || row.user?.email || ""} ${row.phone || row.contactPhone || ""} ${row.rentals.map((rental: any) => `${rental.propertyName} ${rental.unitLabel}`).join(" ")}`.toLowerCase().includes(query)
    && (access === "all" || row.portalState === access)
    && (rental === "unassigned" ? !property && !row.rentals.length : (!property && rental === "all") || row.rentals.some((association: any) => (!property || association.propertyId === property) && (rental === "all" || association.status === rental)))
    && row.recordStatus === (params.get("records") === "archived" ? "archived" : "active"));
  const start = params.get("before") ? Math.max(0, pageOffset(params.get("before")) - 50) : pageOffset(params.get("cursor"));
  return {
    companyId: options.companyId, today: options.today || "2026-10-24", timezone: options.timezone || "UTC",
    items: filtered.slice(start, start + 50).map(row => ({ ...row, rentals: row.rentals.slice(0, 3) })), total: filtered.length, pageSize: 50,
    nextCursor: start + 50 < filtered.length ? pageToken(start + 50) : null, previousCursor: start > 0 ? pageToken(start) : null, properties,
  };
}

export function tenantRentalHistoryFixture(person: any, associations: readonly any[], requestUrl: string | URL, options: Options) {
  const today = options.today || "2026-10-24";
  const profile = fixturePerson(person);
  const rows = associations.map(association => {
    const lease = association.lease || association;
    const startsOn = association.startsOn || lease.startsOn;
    const endsOn = association.endsOn === undefined ? lease.endsOn || null : association.endsOn;
    const status = ["current", "upcoming", "draft", "former"].includes(association.status)
      ? association.status
      : lease.status === "draft" ? "draft" : lease.status === "ended" || (endsOn && endsOn.slice(0, 10) < today) ? "former" : startsOn?.slice(0, 10) > today ? "upcoming" : "current";
    return {
      leaseId: association.leaseId || lease.id, propertyId: association.propertyId || lease.propertyId,
      propertyName: association.propertyName || lease.property?.name, unitLabel: association.unitLabel || lease.unit?.label,
      role: association.role || "leaseholder", status, startsOn, endsOn,
      ...(association.blocksArchive === undefined ? {} : { blocksArchive: association.blocksArchive }),
    };
  });
  if (rows.some(row => !row.leaseId)) throw new Error("Rental history fixtures require an existing lease ID.");
  const params = new URL(requestUrl).searchParams;
  const start = params.get("before") ? Math.max(0, pageOffset(params.get("before")) - 50) : pageOffset(params.get("cursor"));
  return {
    companyId: options.companyId, today, timezone: options.timezone || "UTC",
    person: { kind: profile.kind, id: profile.id, contactId: profile.contactId, userId: profile.userId, name: profile.name, recordStatus: profile.recordStatus, portalState: profile.portalState },
    items: rows.slice(start, start + 50), total: rows.length, pageSize: 50,
    nextCursor: start + 50 < rows.length ? pageToken(start + 50) : null, previousCursor: start > 0 ? pageToken(start) : null,
  };
}
