import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { companyDay } from "./reports.js";
import type { Tx } from "./operational.js";

const pageSize = 50, previewSize = 3;
const accessValues = ["all", "active", "verification", "disabled", "offline", "pending"];
const rentalValues = ["all", "current", "upcoming", "draft", "former", "unassigned"];
type Kind = "contact" | "resident" | "rental";
type Cursor = { v: 1; k: Kind; h: string; o: string; c: string };
type Filters = { q: string; access: string; propertyId: string | null; rental: string; records: string };
type Paging = { cursor?: Cursor; before: boolean };
type Person = {
  kind: "contact" | "resident"; id: string; contactId: string | null; userId: string | null;
  name: string; email: string | null; phone: string | null; contactName: string | null; contactPhone: string | null;
  recordStatus: string; status: string; portalState: string; version: number; user: unknown;
  sourceHash: string; orderHash: string; kind_rank: number; sort_name: string;
};
function invalidCursor() { return new AccessError(400, "INVALID_TENANT_CURSOR", "This tenant page link is invalid. Return to the first page."); }
function unavailable() { return new AccessError(404, "TENANT_CURSOR_UNAVAILABLE", "This tenant page is no longer available. Return to the first page to review current records."); }
function decode(value: unknown): Cursor {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw invalidCursor();
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw invalidCursor();
    const row = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).length !== 5 ||
      Object.keys(row).some(key => !["v", "k", "h", "o", "c"].includes(key)) || row.v !== 1 ||
      !["contact", "resident", "rental"].includes(String(row.k)) ||
      [row.h, row.o, row.c].some(value => typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))) throw invalidCursor();
    return row as Cursor;
  } catch { throw invalidCursor(); }
}
function paging(query: Record<string, unknown>): Paging {
  if (query.cursor !== undefined && query.before !== undefined) throw invalidCursor();
  const value = query.cursor !== undefined ? query.cursor : query.before;
  return { cursor: value === undefined ? undefined : decode(value), before: query.before !== undefined };
}
function option(value: unknown, allowed: string[], fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) throw new AccessError(400, "INVALID_INPUT", "Choose valid tenant filters.");
  return value;
}
export function tenantDirectoryQuery(query: Record<string, unknown>) {
  if (Object.keys(query).some(key => !["q", "access", "propertyId", "rental", "records", "cursor", "before"].includes(key)))
    throw new AccessError(400, "INVALID_INPUT", "Unknown tenant filter.");
  if (query.q !== undefined && (typeof query.q !== "string" || query.q.length > 200 || query.q.includes("\0")))
    throw new AccessError(400, "INVALID_INPUT", "Search must be at most 200 characters.");
  const filters: Filters = {
    q: typeof query.q === "string" ? query.q.trim() : "", access: option(query.access, accessValues, "all"),
    propertyId: query.propertyId === undefined ? null : assignmentId(query.propertyId),
    rental: option(query.rental, rentalValues, "all"), records: option(query.records, ["active", "archived"], "active"),
  };
  return { ...paging(query), filters };
}
export function tenantRentalQuery(query: Record<string, unknown>) {
  if (Object.keys(query).some(key => !["cursor", "before"].includes(key))) throw new AccessError(400, "INVALID_INPUT", "Unknown rental history filter.");
  return paging(query);
}
function context(companyId: string, actorId: string, day: string, timezone: string, value: unknown) {
  return createHash("sha256").update(JSON.stringify([companyId, actorId, day, timezone, value])).digest("hex");
}
function token(kind: Kind, hash: string, orderHash: string, digest: string) {
  return Buffer.from(JSON.stringify({ v: 1, k: kind, h: hash, o: orderHash, c: digest })).toString("base64url");
}
async function clock(tx: Tx, companyId: string) {
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } });
  // Capture after scoped authorization fences, rather than using PostgreSQL's
  // transaction-start timestamp when a read waited behind an access change.
  const asOf = new Date();
  return { timezone: company.timezone, today: companyDay(company.timezone, asOf), asOf };
}

// Contacts remain canonical regardless of archive, membership, account transfer
// or directory filters. Resolve an explicit contact before considering a user
// alias; filtering contacts first would attach denormalized sources incorrectly.
function canonical(companyId: string, today: string, asOf: Date) {
  return Prisma.sql`WITH contacts AS MATERIALIZED (
    SELECT c.id,c."userId",c.name,c.email,c.phone,c.status,c.version
    FROM "ResidentContact" c WHERE c."companyId"=${companyId}
  ), members AS MATERIALIZED (
    SELECT m."userId",m.status,m.version,m."contactName",m."contactPhone",
      u.name AS user_name,u.email AS user_email,u.status AS user_status,u."emailVerified" AS verified
    FROM "CompanyMembership" m JOIN "User" u ON u.id=m."userId"
    WHERE m."companyId"=${companyId} AND m.role='resident'
  ), people_base AS (
    SELECT 'contact'::text AS kind,0 AS kind_rank,c.id,c.id AS "contactId",c."userId",c.name,c.email,c.phone,
      c.name AS "contactName",c.phone AS "contactPhone",c.status AS "recordStatus",COALESCE(m.status,'offline') AS status,c.version,
      CASE WHEN m."userId" IS NULL THEN CASE WHEN EXISTS(SELECT 1 FROM "Invitation" i WHERE i."companyId"=${companyId} AND i."contactId"=c.id AND i."acceptedAt" IS NULL AND i."revokedAt" IS NULL AND i."expiresAt">${asOf}) THEN 'pending' ELSE 'offline' END
        WHEN m.status<>'active' OR m.user_status<>'active' THEN 'disabled' WHEN NOT m.verified THEN 'verification' ELSE 'active' END AS "portalState",
      CASE WHEN m."userId" IS NULL THEN NULL ELSE jsonb_build_object('name',m.user_name,'email',m.user_email,'status',m.user_status,'emailVerified',m.verified) END AS "user",
      c.name AS sort_name,concat(c.name,' ',COALESCE(m.user_name,''),' ',COALESCE(NULLIF(c.email,''),m.user_email,''),' ',COALESCE(c.phone,''),' ') AS search_prefix
    FROM contacts c LEFT JOIN members m ON m."userId"=c."userId"
    UNION ALL
    SELECT 'resident',1,m."userId",NULL,m."userId",COALESCE(NULLIF(m."contactName",''),NULLIF(m.user_name,''),m.user_email),m.user_email,m."contactPhone",
      m."contactName",m."contactPhone",'active',m.status,m.version,
      CASE WHEN m.status<>'active' OR m.user_status<>'active' THEN 'disabled' WHEN NOT m.verified THEN 'verification' ELSE 'active' END,
      jsonb_build_object('name',m.user_name,'email',m.user_email,'status',m.user_status,'emailVerified',m.verified),
      ''::text,concat(COALESCE(m."contactName",''),' ',COALESCE(m.user_name,''),' ',m.user_email,' ',COALESCE(m."contactPhone",''),' ')
    FROM members m WHERE NOT EXISTS(SELECT 1 FROM contacts c WHERE c."userId"=m."userId")
  ), people AS MATERIALIZED (
    SELECT p.*,encode(sha256(convert_to(p.id,'UTF8')),'hex') AS "sourceHash",
      encode(sha256(convert_to(jsonb_build_array(p.kind_rank,p.sort_name,p.id)::text,'UTF8')),'hex') AS "orderHash"
    FROM people_base p
  ), raw_links AS (
    SELECT l.id AS lease_id,l."propertyId",l."unitId",l.status AS lease_status,l."startsOn" AS lease_start,l."endsOn" AS lease_end,
      l."residentContactId" AS contact_id,l."residentId" AS user_id,'leaseholder'::text AS role,l."startsOn" AS party_start,l."endsOn" AS party_end,
      false AS removed,0 AS precedence,l."createdAt" AS link_created,l.id AS link_id
    FROM "Lease" l WHERE l."companyId"=${companyId}
    UNION ALL
    SELECT l.id,l."propertyId",l."unitId",l.status,l."startsOn",l."endsOn",p."contactId",p."userId",p.role,p."startsOn",p."endsOn",p."removedAt" IS NOT NULL,1,p."createdAt",p.id
    FROM "LeaseParticipant" p JOIN "Lease" l ON l.id=p."leaseId" AND l."companyId"=p."companyId"
    WHERE p."companyId"=${companyId} AND l."companyId"=${companyId}
  ), resolved AS (
    SELECT r.*,CASE WHEN explicit.id IS NOT NULL OR alias.id IS NOT NULL THEN 'contact' ELSE 'resident' END AS person_kind,
      COALESCE(explicit.id,alias.id,m."userId") AS person_id
    FROM raw_links r
    LEFT JOIN contacts explicit ON explicit.id=r.contact_id
    LEFT JOIN contacts alias ON explicit.id IS NULL AND alias."userId"=r.user_id
    LEFT JOIN members m ON explicit.id IS NULL AND alias.id IS NULL AND m."userId"=r.user_id
  ), ranked AS (
    SELECT DISTINCT ON(person_kind,person_id,lease_id) r.*
    FROM resolved r WHERE person_id IS NOT NULL
    ORDER BY person_kind,person_id,lease_id,precedence,link_created,link_id COLLATE "C"
  ), effective AS (
    SELECT r.*,GREATEST(lease_start,party_start) AS effective_start,LEAST(lease_end,party_end) AS effective_end
    FROM ranked r
  ), classified AS (
    SELECT r.*,CASE WHEN removed OR lease_status='ended' OR effective_end<${today}::date THEN 'former'
      WHEN lease_status='draft' THEN 'draft' WHEN effective_start>${today}::date THEN 'upcoming' ELSE 'current' END AS rental_status
    FROM effective r
  ), relationships AS MATERIALIZED (
    SELECT r.*,p.name AS property_name,u.label AS unit_label,
      CASE rental_status WHEN 'current' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END AS rental_rank,
      encode(sha256(convert_to(lease_id,'UTF8')),'hex') AS "sourceHash",
      encode(sha256(convert_to(jsonb_build_array(rental_status,effective_start,lease_id)::text,'UTF8')),'hex') AS "orderHash"
    FROM classified r JOIN "Property" p ON p.id=r."propertyId" AND p."companyId"=${companyId}
    JOIN "Unit" u ON u.id=r."unitId" AND u."propertyId"=r."propertyId" AND u."companyId"=${companyId}
  )`;
}
function association(alias: "r") {
  // The sole alias is fixed in this module; no caller-controlled SQL names.
  const r = Prisma.raw(alias);
  return Prisma.sql`jsonb_build_object('leaseId',${r}.lease_id,'propertyId',${r}."propertyId",'propertyName',${r}.property_name,
    'unitLabel',${r}.unit_label,'role',${r}.role,'status',${r}.rental_status,'startsOn',${r}.effective_start::text,
    'endsOn',${r}.effective_end::text,'blocksArchive',${r}.rental_status<>'former')`;
}
function rentalMatch(filters: Filters) {
  return Prisma.sql`${filters.propertyId ? Prisma.sql`r."propertyId"=${filters.propertyId}` : Prisma.sql`true`}
    AND ${filters.rental !== "all" && filters.rental !== "unassigned" ? Prisma.sql`r.rental_status=${filters.rental}` : Prisma.sql`true`}`;
}
function selected(base: Prisma.Sql, filters: Filters) {
  return Prisma.sql`${base}, stats AS (
    SELECT person_kind,person_id,count(*)::int AS rental_count,bool_or(rental_status<>'former') AS blocks_archive,
      bool_or(${rentalMatch(filters)}) AS has_match,
      ${filters.q ? Prisma.sql`string_agg(property_name||' '||unit_label,' ' ORDER BY rental_rank,effective_start DESC,lease_id COLLATE "C")` : Prisma.sql`''::text`} AS rental_search
    FROM relationships r GROUP BY person_kind,person_id
  ), selected AS MATERIALIZED (
    SELECT p.*,COALESCE(s.rental_count,0) AS "rentalCount",NOT COALESCE(s.blocks_archive,false) AS "canArchive"
    FROM people p LEFT JOIN stats s ON s.person_kind=p.kind AND s.person_id=p.id
    WHERE p."recordStatus"=${filters.records}
      ${filters.access !== "all" ? Prisma.sql`AND p."portalState"=${filters.access}` : Prisma.empty}
      ${filters.q ? Prisma.sql`AND strpos(lower(p.search_prefix||COALESCE(s.rental_search,'')),lower(${filters.q}))>0` : Prisma.empty}
      ${filters.rental === "unassigned" ? Prisma.sql`AND ${filters.propertyId ? Prisma.sql`false` : Prisma.sql`COALESCE(s.rental_count,0)=0`}`
        : filters.propertyId || filters.rental !== "all" ? Prisma.sql`AND COALESCE(s.has_match,false)` : Prisma.empty}
  )`;
}
function personDto(row: Person) {
  return { kind: row.kind, id: row.id, contactId: row.contactId, userId: row.userId, name: row.name,
    recordStatus: row.recordStatus, portalState: row.portalState };
}

export async function readTenantDirectory(tx: Tx, companyId: string, actorId: string, query: ReturnType<typeof tenantDirectoryQuery>) {
  const { today, timezone, asOf } = await clock(tx, companyId), { filters, cursor, before } = query;
  const digest = context(companyId, actorId, today, timezone, ["directory", filters]);
  if (cursor && (cursor.c !== digest || cursor.k === "rental")) throw unavailable();
  const base = canonical(companyId, today, asOf), filtered = selected(base, filters);
  let anchor: Person | undefined;
  if (cursor) {
    const found = await tx.$queryRaw<Person[]>(Prisma.sql`${filtered} SELECT * FROM selected WHERE kind=${cursor.k} AND "sourceHash"=${cursor.h} LIMIT 2`);
    if (found.length !== 1 || found[0].orderHash !== cursor.o) throw unavailable();
    anchor = found[0];
  }
  const total = (await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${filtered} SELECT count(*)::int AS total FROM selected`))[0].total;
  const properties = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`${base}
    SELECT p.id,p.name FROM (SELECT DISTINCT "propertyId" AS id,property_name AS name FROM relationships) p
    ORDER BY p.name,p.id`);
  const direction = before ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const seek = anchor ? before
    ? Prisma.sql`AND (p.kind_rank,p.sort_name,p.id)<(${anchor.kind_rank},${anchor.sort_name},${anchor.id})`
    : Prisma.sql`AND (p.kind_rank,p.sort_name,p.id)>(${anchor.kind_rank},${anchor.sort_name},${anchor.id})` : Prisma.empty;
  const rows = await tx.$queryRaw<(Person & { rentalCount: number; canArchive: boolean; rentals: unknown[] })[]>(Prisma.sql`${filtered}
    SELECT p.*,COALESCE((SELECT jsonb_agg(${association("r")}) FROM (
      SELECT r.* FROM relationships r WHERE r.person_kind=p.kind AND r.person_id=p.id
      ORDER BY CASE WHEN (${rentalMatch(filters)}) THEN 0 ELSE 1 END,
        ${filters.q ? Prisma.sql`CASE WHEN strpos(lower(r.property_name||' '||r.unit_label),lower(${filters.q}))>0 THEN 0 ELSE 1 END,` : Prisma.empty}
        rental_rank,effective_start DESC,lease_id COLLATE "C" LIMIT ${previewSize}
    ) r),'[]'::jsonb) AS rentals
    FROM selected p WHERE true ${seek}
    ORDER BY p.kind_rank ${direction},p.sort_name ${direction},p.id ${direction} LIMIT ${pageSize + 1}`);
  if (cursor && !rows.length) throw unavailable();
  const more = rows.length > pageSize, visible = rows.slice(0, pageSize); if (before) visible.reverse();
  const items = visible.map(row => ({ ...personDto(row), email: row.email, phone: row.phone, contactName: row.contactName,
    contactPhone: row.contactPhone, status: row.status, version: row.version, user: row.user,
    rentalCount: row.rentalCount, canArchive: row.canArchive, rentals: row.rentals }));
  const first = visible[0], last = visible[visible.length - 1];
  return { companyId, today, timezone, items, total, properties, pageSize,
    nextCursor: last && (before ? !!anchor : more) ? token(last.kind, last.sourceHash, last.orderHash, digest) : null,
    previousCursor: first && (before ? more : !!anchor) ? token(first.kind, first.sourceHash, first.orderHash, digest) : null };
}

type Relationship = { lease_id: string; rental_rank: number; effective_start: Date; sourceHash: string; orderHash: string; item: unknown };
export async function readTenantRentals(tx: Tx, companyId: string, actorId: string, target: { kind: "contact" | "resident"; id: string }, query: Paging) {
  const { today, timezone, asOf } = await clock(tx, companyId), base = canonical(companyId, today, asOf);
  const found = await tx.$queryRaw<Person[]>(Prisma.sql`${base} SELECT * FROM people
    WHERE ${target.kind === "contact" ? Prisma.sql`kind='contact' AND id=${target.id}` : Prisma.sql`"userId"=${target.id}`}
    ORDER BY kind_rank LIMIT 2`);
  if (found.length !== 1) throw new AccessError(404, "NOT_FOUND", "Tenant rental history is unavailable in this company.");
  const person = found[0], { cursor, before } = query;
  const digest = context(companyId, actorId, today, timezone, ["rentals", person.kind, person.sourceHash]);
  if (cursor && (cursor.c !== digest || cursor.k !== "rental")) throw unavailable();
  const where = Prisma.sql`person_kind=${person.kind} AND person_id=${person.id}`;
  let anchor: Relationship | undefined;
  if (cursor) {
    const rows = await tx.$queryRaw<Relationship[]>(Prisma.sql`${base} SELECT * FROM relationships WHERE ${where} AND "sourceHash"=${cursor.h} LIMIT 2`);
    if (rows.length !== 1 || rows[0].orderHash !== cursor.o) throw unavailable(); anchor = rows[0];
  }
  const total = (await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${base} SELECT count(*)::int AS total FROM relationships WHERE ${where}`))[0].total;
  // Negated date supports a single lexicographic ASC tuple with newest starts
  // first, while retaining the same role/status/effective-date source order.
  const seek = anchor ? before
    ? Prisma.sql`AND (r.rental_rank,-(r.effective_start-DATE '1970-01-01'),r.lease_id COLLATE "C")<(${anchor.rental_rank},-(${anchor.effective_start}::date-DATE '1970-01-01'),${anchor.lease_id} COLLATE "C")`
    : Prisma.sql`AND (r.rental_rank,-(r.effective_start-DATE '1970-01-01'),r.lease_id COLLATE "C")>(${anchor.rental_rank},-(${anchor.effective_start}::date-DATE '1970-01-01'),${anchor.lease_id} COLLATE "C")` : Prisma.empty;
  const asc = before ? Prisma.sql`DESC` : Prisma.sql`ASC`, dateOrder = before ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const rows = await tx.$queryRaw<Relationship[]>(Prisma.sql`${base} SELECT r.*,${association("r")} AS item FROM relationships r WHERE ${where} ${seek}
    ORDER BY rental_rank ${asc},effective_start ${dateOrder},lease_id COLLATE "C" ${asc} LIMIT ${pageSize + 1}`);
  if (cursor && !rows.length) throw unavailable();
  const more = rows.length > pageSize, visible = rows.slice(0, pageSize); if (before) visible.reverse();
  const first = visible[0], last = visible[visible.length - 1];
  return { companyId, today, timezone, person: personDto(person), items: visible.map(row => row.item), total, pageSize,
    nextCursor: last && (before ? !!anchor : more) ? token("rental", last.sourceHash, last.orderHash, digest) : null,
    previousCursor: first && (before ? more : !!anchor) ? token("rental", first.sourceHash, first.orderHash, digest) : null };
}
