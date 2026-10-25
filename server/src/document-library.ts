import type { FastifyInstance, preValidationHookHandler } from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { boundedText, choice, scoped } from "./operational.js";
export function registerDocumentLibrary(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
) {
  server.get<{ Querystring: Record<string, string> }>(
    "/api/company/documents",
    { preValidation: authenticate },
    (r) => {
      const q = r.query;
      if (
        Object.keys(q).some(
          (k) =>
            !["q", "source", "status", "scan", "propertyId", "page"].includes(
              k,
            ),
        ) ||
        (q.page !== undefined && !/^[1-9][0-9]{0,5}$/.test(q.page))
      )
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Choose valid document filters and page.",
        );
      const search = q.q === undefined ? null : boundedText(q.q, 200, "Search"),
        source = choice(
          q.source || "all",
          ["all", "leases", "maintenance"],
          "source",
        ),
        status = choice(
          q.status || "active",
          ["active", "archived", "all"],
          "document status",
        ),
        scan = choice(
          q.scan || "all",
          ["all", "unscanned", "pending", "clean", "rejected"],
          "latest scan result",
        ),
        propertyId =
          q.propertyId === undefined ? null : assignmentId(q.propertyId),
        page = Number(q.page || 1);
      return scoped(db, r, "maintenance.manage", async (tx, companyId) => {
        if (
          propertyId &&
          !(await tx.property.findFirst({
            where: { id: propertyId, companyId },
            select: { id: true },
          }))
        )
          throw new AccessError(404, "NOT_FOUND", "Property not found.");
        // Latest-version metadata only: never read originals, private source content,
        // author identities, download capabilities or retry secrets into the library.
        const docs = Prisma.sql`WITH documents AS (
    SELECT d.id,d.title,d."archivedAt",CASE WHEN d."leaseId" IS NOT NULL THEN 'leases' ELSE 'maintenance' END AS source,
     COALESCE(d."leaseId",d."requestId") AS "sourceId",COALESCE(l."propertyId",m."propertyId") AS "propertyId",home.name AS "propertyName",u.label AS "unitLabel",m.title AS "requestTitle",
     latest.number AS "latestNumber",latest.filename,latest."scanStatus",latest."byteLength",latest."createdAt" AS "uploadedAt"
    FROM "PrivateDocument" d
    LEFT JOIN "Lease" l ON l.id=d."leaseId" AND l."companyId"=d."companyId"
    LEFT JOIN "MaintenanceRequest" m ON m.id=d."requestId" AND m."companyId"=d."companyId"
    JOIN "Property" home ON home.id=COALESCE(l."propertyId",m."propertyId") AND home."companyId"=d."companyId"
    LEFT JOIN "Unit" u ON u.id=COALESCE(l."unitId",m."unitId") AND u."propertyId"=home.id AND u."companyId"=d."companyId"
    JOIN LATERAL (SELECT v.number,v.filename,v."scanStatus",v."byteLength",v."createdAt" FROM "DocumentVersion" v WHERE v."companyId"=d."companyId" AND v."documentId"=d.id ORDER BY v.number DESC LIMIT 1) latest ON true
    WHERE d."companyId"=${companyId}
   ), filtered AS (SELECT * FROM documents WHERE true
    ${source === "all" ? Prisma.empty : Prisma.sql`AND source=${source}`}
    ${status === "all" ? Prisma.empty : status === "active" ? Prisma.sql`AND "archivedAt" IS NULL` : Prisma.sql`AND "archivedAt" IS NOT NULL`}
    ${scan === "all" ? Prisma.empty : scan === "unscanned" ? Prisma.sql`AND "scanStatus" IN ('unscanned','pending')` : Prisma.sql`AND "scanStatus"=${scan}`}
    ${propertyId ? Prisma.sql`AND "propertyId"=${propertyId}` : Prisma.empty}
    ${search ? Prisma.sql`AND (position(lower(${search}) in lower(title))>0 OR position(lower(${search}) in lower(filename))>0 OR position(lower(${search}) in lower("propertyName"))>0 OR position(lower(${search}) in lower(COALESCE("requestTitle",'')))>0)` : Prisma.empty}
   )`;
        const total = (
          await tx.$queryRaw<{ total: number }[]>(
            Prisma.sql`${docs} SELECT count(*)::int AS total FROM filtered`,
          )
        )[0].total;
        const items = await tx.$queryRaw(
          Prisma.sql`${docs} SELECT * FROM filtered ORDER BY "uploadedAt" DESC,id DESC LIMIT 25 OFFSET ${(page - 1) * 25}`,
        );
        return { items, total, page, pageSize: 25 };
      });
    },
  );
}
