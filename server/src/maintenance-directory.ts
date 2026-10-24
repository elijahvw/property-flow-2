import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AccessError } from "./access.js";
import { assignmentId } from "./application.js";
import { boundedText, choice } from "./operational.js";

export const maintenancePageSize = 50;
export const legacyMaintenanceLimit = 1000;
export const maintenanceDirectorySelect = {
  id: true, propertyId: true, unitId: true, title: true, category: true,
  priority: true, status: true, createdAt: true, targetOn: true,
  property: { select: { name: true } }, unit: { select: { label: true } },
} as const;
type Filters = {
  status?: string; propertyId?: string; priority?: string; q?: string;
  workStatus?: string; due?: string; assignee?: string;
};
type Cursor = { v: 1; id: string; contextDigest: string };
function invalidCursor() {
  return new AccessError(400, "INVALID_DIRECTORY_CURSOR", "This request page link is invalid. Return to the first page.");
}
export function unavailableMaintenanceCursor() {
  return new AccessError(404, "DIRECTORY_CURSOR_UNAVAILABLE", "This request page is no longer available. Return to the first page to review current matches.");
}
function decodeCursor(value: unknown): Cursor {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(value)) throw invalidCursor();
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw invalidCursor();
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalidCursor();
    const row = parsed as Record<string, unknown>;
    if (Object.keys(row).length !== 3 || Object.keys(row).some(key => !["v", "id", "contextDigest"].includes(key)) || row.v !== 1 ||
        typeof row.contextDigest !== "string" || !/^[0-9a-f]{64}$/.test(row.contextDigest)) throw invalidCursor();
    return { v: 1, id: assignmentId(row.id), contextDigest: row.contextDigest };
  } catch { throw invalidCursor(); }
}
export function maintenanceListQuery(query: Record<string, unknown>, resident: boolean, directory: boolean) {
  const fields = ["status", "propertyId", "priority", "q", ...(!resident ? ["workStatus", "due", "assignee"] : []), ...(directory ? ["cursor", "before"] : [])];
  if (Object.keys(query).some(key => !fields.includes(key))) throw new AccessError(400, "INVALID_INPUT", "Unknown filter.");
  if (query.cursor !== undefined && query.before !== undefined) throw invalidCursor();
  const optionalChoice = (key: string, values: string[], label: string) => query[key] === undefined ? undefined : choice(query[key], values, label);
  const filters: Filters = {
    status: optionalChoice("status", ["unresolved", "open", "in_progress", "resolved"], "status"),
    propertyId: query.propertyId === undefined ? undefined : assignmentId(query.propertyId),
    priority: optionalChoice("priority", ["low", "normal", "high"], "priority"),
    q: query.q === undefined ? undefined : boundedText(query.q, 200, "Search"),
    workStatus: optionalChoice("workStatus", ["unassigned", "assigned", "accepted", "pending_review", "complete"], "work status"),
    due: optionalChoice("due", ["overdue", "today", "upcoming", "unscheduled"], "target date view"),
    assignee: query.assignee === undefined ? undefined : boundedText(query.assignee, 200, "Assignee"),
  };
  const token = query.cursor !== undefined ? query.cursor : query.before;
  return { filters, cursor: token === undefined ? undefined : decodeCursor(token), newer: query.before !== undefined };
}
export function maintenanceWhere(companyId: string, userId: string, resident: boolean, filters: Filters, today: Date): Prisma.MaintenanceRequestWhereInput {
  const { status, propertyId, priority, q, workStatus, due, assignee } = filters;
  return {
    companyId, status: status === "unresolved" ? { in: ["open", "in_progress"] } : status,
    propertyId, priority, executionStatus: workStatus,
    ...(due ? { AND: [due === "unscheduled" ? { targetOn: null } : { targetOn: due === "overdue" ? { lt: today } : due === "today" ? today : { gt: today } }, { status: { not: "resolved" } }] } : {}),
    ...(assignee ? assignee === "unassigned" ? { assigneeId: null } : { assignee: { is: { OR: [{ name: { contains: assignee, mode: "insensitive" } }, { email: { contains: assignee, mode: "insensitive" } }] } } } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { property: { name: { contains: q, mode: "insensitive" } } }, { unit: { label: { contains: q, mode: "insensitive" } } }] } : {}),
    ...(resident ? { requesterId: userId, property: { assignments: { some: { companyId, userId } } } } : {}),
  };
}
export function maintenanceCursorContext(companyId: string, userId: string, resident: boolean, filters: Filters, day: string) {
  // This digest only detects a copied/mismatched page context. It is not an
  // authority token: each anchor, count and page still uses current scope.
  return createHash("sha256").update(JSON.stringify([
    companyId, userId, resident, filters.status ?? null, filters.propertyId ?? null,
    filters.priority ?? null, filters.q ?? null, filters.workStatus ?? null,
    filters.due ?? null, filters.assignee ?? null, filters.due ? day : null,
  ])).digest("hex");
}
export function maintenanceCursor(id: string, contextDigest: string) {
  return Buffer.from(JSON.stringify({ v: 1, id, contextDigest })).toString("base64url");
}
