import type {
  FastifyInstance,
  FastifyRequest,
  preValidationHookHandler,
} from "fastify";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import {
  audit,
  boundedText,
  choice,
  conflict,
  input,
  mutation,
  page,
  paging,
  sameSubmission,
  scoped,
  submission,
  version,
  type Tx,
} from "./operational.js";

const select = {
  id: true,
  name: true,
  service: true,
  contactName: true,
  email: true,
  phone: true,
  notes: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;
function optional(value: unknown, max: number, label: string) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim())
  )
    return null;
  return boundedText(value, max, label);
}
function fields(b: Record<string, unknown>) {
  const name = boundedText(b.name, 160, "Vendor name").replace(/\s+/g, " ");
  const email = optional(b.email, 254, "Email");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AccessError(400, "INVALID_INPUT", "Enter a valid email address.");
  return {
    name,
    nameKey: name.toLowerCase(),
    service: optional(b.service, 120, "Service"),
    contactName: optional(b.contactName, 160, "Contact name"),
    email,
    phone: optional(b.phone, 50, "Phone"),
    notes: optional(b.notes, 2000, "Notes"),
  };
}
function pageNumber(value: unknown) {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,5}$/.test(value))
    throw new AccessError(400, "INVALID_INPUT", "Choose a valid page.");
  return Number(value);
}
function filters(query: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(query).some((key) => !allowed.includes(key)))
    throw new AccessError(400, "INVALID_INPUT", "Unknown filter.");
}
const missing = () => new AccessError(404, "NOT_FOUND", "Vendor not found.");

export function registerVendors(
  server: FastifyInstance,
  db: PrismaClient,
  authenticate: preValidationHookHandler,
  origin: string,
) {
  const auth = { preValidation: authenticate };
  const run = <T>(
    request: FastifyRequest,
    work: (tx: Tx, companyId: string) => Promise<T>,
  ) => scoped(db, request, "maintenance.manage", work);
  const vendor = async (tx: Tx, companyId: string, id: string) => {
    const row = await tx.vendor.findFirst({ where: { id, companyId }, select });
    if (!row) throw missing();
    return row;
  };
  const requestRecord = async (tx: Tx, companyId: string, id: string) => {
    const row = await tx.maintenanceRequest.findFirst({
      where: { id, companyId },
      select: { id: true, version: true, vendorId: true, vendor: { select } },
    });
    if (!row)
      throw new AccessError(404, "NOT_FOUND", "Maintenance request not found.");
    return row;
  };
  const replay = async (
    tx: Tx,
    companyId: string,
    request: FastifyRequest,
    key: ReturnType<typeof submission>,
  ) => {
    const row = await tx.vendorAction.findFirst({
      where: {
        companyId,
        actorId: request.principal!.id,
        submissionKey: key.submissionKey,
      },
    });
    if (row) sameSubmission(row.submissionHash, key.submissionHash);
    return row
      ? {
          saved: true,
          vendorId: row.vendorId,
          requestId: row.requestId,
          recovered: true,
          changed: row.changed,
        }
      : null;
  };
  const record = async (
    tx: Tx,
    companyId: string,
    request: FastifyRequest,
    key: ReturnType<typeof submission>,
    action: string,
    vendorId: string | null,
    requestId: string | null,
    snapshot: Prisma.InputJsonValue,
    changed = true,
  ) => {
    await tx.vendorAction.create({
      data: {
        companyId,
        actorId: request.principal!.id,
        ...key,
        action,
        vendorId,
        requestId,
        snapshot,
        changed,
      },
    });
    if (changed)
      await audit(
        tx,
        request,
        companyId,
        requestId || vendorId!,
        action === "link" ? "maintenance.vendor.changed" : `vendor.${action}`,
        { vendorId, requestId },
      );
    return { saved: true, vendorId, requestId, changed };
  };
  const uniqueName = async (
    tx: Tx,
    companyId: string,
    nameKey: string,
    id?: string,
  ) => {
    if (
      await tx.vendor.findFirst({
        where: { companyId, nameKey, ...(id ? { id: { not: id } } : {}) },
        select: { id: true },
      })
    )
      throw new AccessError(
        409,
        "VENDOR_EXISTS",
        "A vendor with this name already exists. Search the directory, including archived vendors.",
      );
  };
  const write = async <T>(
    request: FastifyRequest,
    work: (tx: Tx, companyId: string) => Promise<T>,
  ) => {
    mutation(request, origin);
    try {
      return await run(request, work);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new AccessError(
          409,
          "VENDOR_EXISTS",
          "A vendor with this name already exists. Search the directory, including archived vendors.",
        );
      throw error;
    }
  };
  server.get<{ Querystring: Record<string, string> }>(
    "/api/company/vendors",
    auth,
    (request) => {
      filters(request.query, ["q", "status", "page"]);
      const q =
        request.query.q === undefined
          ? undefined
          : boundedText(request.query.q, 200, "Search");
      const status =
          request.query.status === undefined
            ? "active"
            : choice(
                request.query.status,
                ["active", "archived", "all"],
                "vendor status",
              ),
        currentPage = pageNumber(request.query.page);
      return run(request, async (tx, companyId) => {
        const where: Prisma.VendorWhereInput = {
          companyId,
          ...(status !== "all" ? { status } : {}),
          ...(q
            ? {
                OR: ["name", "service", "contactName", "email", "phone"].map(
                  (field) => ({
                    [field]: { contains: q, mode: "insensitive" },
                  }),
                ),
              }
            : {}),
        };
        const total = await tx.vendor.count({ where });
        const items = await tx.vendor.findMany({
          where,
          select,
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (currentPage - 1) * 25,
          take: 25,
        });
        return { items, total, page: currentPage, pageSize: 25 };
      });
    },
  );
  server.get<{ Params: { vendorId: string } }>(
    "/api/company/vendors/:vendorId",
    auth,
    (request) => {
      filters(request.query as Record<string, unknown>, []);
      const id = assignmentId(request.params.vendorId);
      return run(request, (tx, companyId) => vendor(tx, companyId, id));
    },
  );
  server.post("/api/company/vendors", auth, (request) => {
    const b = input(request, [
        "name",
        "service",
        "contactName",
        "email",
        "phone",
        "notes",
        "submissionKey",
      ]),
      data = fields(b),
      key = submission(b.submissionKey, ["create", data]);
    return write(request, async (tx, companyId) => {
      const previous = await replay(tx, companyId, request, key);
      if (previous) return previous;
      await uniqueName(tx, companyId, data.nameKey);
      const row = await tx.vendor.create({
        data: { companyId, ...data },
        select,
      });
      return record(tx, companyId, request, key, "create", row.id, null, {
        after: { ...data, status: "active" },
      });
    });
  });
  server.patch<{ Params: { vendorId: string } }>(
    "/api/company/vendors/:vendorId",
    auth,
    (request) => {
      const id = assignmentId(request.params.vendorId),
        b = input(request, [
          "name",
          "service",
          "contactName",
          "email",
          "phone",
          "notes",
          "status",
          "expectedVersion",
          "submissionKey",
        ]);
      const expectedVersion = version(b.expectedVersion),
        data = {
          ...fields(b),
          status: choice(b.status, ["active", "archived"], "vendor status"),
        };
      const key = submission(b.submissionKey, [
        "update",
        id,
        expectedVersion,
        data,
      ]);
      return write(request, async (tx, companyId) => {
        const before = await vendor(tx, companyId, id),
          previous = await replay(tx, companyId, request, key);
        if (previous) return previous;
        if (before.version !== expectedVersion) throw conflict();
        await uniqueName(tx, companyId, data.nameKey, id);
        if (
          Object.entries(data).every(
            ([field, value]) =>
              field === "nameKey" ||
              before[field as keyof typeof before] === value,
          )
        ) {
          return record(
            tx,
            companyId,
            request,
            key,
            "edit",
            id,
            null,
            {},
            false,
          );
        }
        const changed = await tx.vendor.updateMany({
          where: { id, companyId, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (!changed.count) throw conflict();
        const action =
          before.status === data.status
            ? "edit"
            : data.status === "active"
              ? "restore"
              : "archive";
        const { createdAt, updatedAt, ...beforeSnapshot } = before;
        return record(tx, companyId, request, key, action, id, null, {
          before: beforeSnapshot,
          after: data,
        });
      });
    },
  );
  server.get<{
    Params: { vendorId: string };
    Querystring: Record<string, string>;
  }>("/api/company/vendors/:vendorId/requests", auth, (request) => {
    filters(request.query, ["page"]);
    const id = assignmentId(request.params.vendorId),
      currentPage = pageNumber(request.query.page);
    return run(request, async (tx, companyId) => {
      await vendor(tx, companyId, id);
      const where = { companyId, vendorId: id };
      return {
        items: await tx.maintenanceRequest.findMany({
          where,
          select: {
            id: true,
            title: true,
            status: true,
            property: { select: { name: true } },
            unit: { select: { label: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (currentPage - 1) * 25,
          take: 25,
        }),
        total: await tx.maintenanceRequest.count({ where }),
        page: currentPage,
        pageSize: 25,
      };
    });
  });
  server.get<{ Params: { requestId: string } }>(
    "/api/company/maintenance/:requestId/vendor",
    auth,
    (request) => {
      filters(request.query as Record<string, unknown>, []);
      const id = assignmentId(request.params.requestId);
      return run(request, (tx, companyId) => requestRecord(tx, companyId, id));
    },
  );
  server.post<{ Params: { requestId: string } }>(
    "/api/company/maintenance/:requestId/vendor",
    auth,
    (request) => {
      const id = assignmentId(request.params.requestId),
        b = input(request, [
          "vendorId",
          "vendorVersion",
          "expectedVersion",
          "submissionKey",
        ]),
        expectedVersion = version(b.expectedVersion);
      const vendorId = b.vendorId === null ? null : assignmentId(b.vendorId),
        vendorVersion = vendorId ? version(b.vendorVersion) : null;
      if (!vendorId && b.vendorVersion !== null)
        throw new AccessError(
          400,
          "INVALID_INPUT",
          "Clear the vendor version when removing a contact.",
        );
      const key = submission(b.submissionKey, [
        "link",
        id,
        expectedVersion,
        vendorId,
        vendorVersion,
      ]);
      return write(request, async (tx, companyId) => {
        const before = await requestRecord(tx, companyId, id),
          previous = await replay(tx, companyId, request, key);
        if (previous) return previous;
        if (before.version !== expectedVersion) throw conflict();
        const selected = vendorId
          ? await vendor(tx, companyId, vendorId)
          : null;
        if (
          selected &&
          (selected.status !== "active" || selected.version !== vendorVersion)
        )
          throw new AccessError(
            409,
            "VENDOR_CHANGED",
            "This vendor changed or was archived. Reload and review its current details.",
          );
        if (before.vendorId === vendorId) {
          // Retain only a hidden retry receipt so later recovery cannot turn
          // an unchanged save into an unintended reassignment.
          return record(
            tx,
            companyId,
            request,
            key,
            "link",
            vendorId,
            id,
            {},
            false,
          );
        }
        const changed = await tx.maintenanceRequest.updateMany({
          where: { id, companyId, version: expectedVersion },
          data: { vendorId, version: { increment: 1 } },
        });
        if (!changed.count) throw conflict();
        return record(tx, companyId, request, key, "link", vendorId, id, {
          from: before.vendor
            ? { id: before.vendor.id, name: before.vendor.name }
            : null,
          to: selected ? { id: selected.id, name: selected.name } : null,
        });
      });
    },
  );
  for (const requestHistory of [false, true])
    server.get<{ Params: { id: string }; Querystring: { cursor?: string } }>(
      requestHistory
        ? "/api/company/maintenance/:id/vendor/history"
        : "/api/company/vendors/:id/history",
      auth,
      (request) => {
        const id = assignmentId(request.params.id),
          cursor = paging(request.query);
        return run(request, async (tx, companyId) => {
          if (requestHistory) await requestRecord(tx, companyId, id);
          else await vendor(tx, companyId, id);
          const where: Prisma.VendorActionWhereInput = {
            companyId,
            changed: true,
            ...(requestHistory
              ? { requestId: id }
              : {
                  OR: [
                    { vendorId: id },
                    { snapshot: { path: ["from", "id"], equals: id } },
                  ],
                }),
          };
          const boundary = cursor
            ? await tx.vendorAction.findFirst({
                where: { ...where, id: cursor },
                select: { id: true, createdAt: true },
              })
            : null;
          if (cursor && !boundary)
            throw new AccessError(404, "NOT_FOUND", "History page not found.");
          const rows = await tx.vendorAction.findMany({
            where: {
              ...where,
              ...(boundary
                ? {
                    AND: [
                      {
                        OR: [
                          { createdAt: { lt: boundary.createdAt } },
                          {
                            createdAt: boundary.createdAt,
                            id: { lt: boundary.id },
                          },
                        ],
                      },
                    ],
                  }
                : {}),
            },
            select: {
              id: true,
              action: true,
              snapshot: true,
              createdAt: true,
              requestId: true,
              actor: { select: { name: true } },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 51,
          });
          return page(
            rows.map(({ actor, ...row }) => ({
              ...row,
              actorName: actor.name || "Recorded teammate",
            })),
          );
        });
      },
    );
}
