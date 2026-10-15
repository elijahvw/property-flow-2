import { paymentPolicyKeys, paymentPolicyPatch } from "./payment-policy.js";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { unitDetailKeys, unitDetails, unitDetailSelect } from "./property-fields.js";
import { companyDay } from "./reports.js";
import { AccessError } from "./access.js";
import { assignmentId, opaqueUserId } from "./application.js";
import { audit, boundedText, cents, choice, conflict, date, input, mutation, page, paging, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";
const unitSelect = { ...unitDetailSelect, id: true, propertyId: true, label: true, status: true, version: true } as const;
const leaseSelect = { rentDueDay:true, graceDays:true, paymentInstructions:true, id: true, propertyId: true, unitId: true, residentId: true, startsOn: true, endsOn: true, rentCents: true, currency: true, status: true, version: true, unit: { select: { label: true } }, property: { select: { name: true } }, resident: { select: { name: true, email: true } } } as const;
async function property(tx: Tx, companyId: string, propertyId: string) {
  if (!await tx.property.findFirst({ where: { id: propertyId, companyId }, select: { id: true } }))
    throw new AccessError(404, "NOT_FOUND", "Property not found.");
}
async function lockUnit(tx: Tx, companyId: string, unitId: string) {
  // The write fence orders archive/edit against activation and concurrent lease changes.
  await tx.$queryRaw`UPDATE "Unit" SET "updatedAt"="updatedAt" WHERE id=${unitId} AND "companyId"=${companyId} RETURNING id`;
  const row = await tx.unit.findFirst({ where: { id: unitId, companyId }, select: unitSelect });
  if (!row) throw new AccessError(404, "NOT_FOUND", "Unit not found.");
  return row;
}
async function eligible(tx: Tx, companyId: string, residentId: string, propertyId: string) {
  await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${residentId} RETURNING id`;
  const member = await tx.companyMembership.findFirst({ where: { userId: residentId, companyId }, include: { user: true } });
  if (!member) throw new AccessError(404, "NOT_FOUND", "Resident not found.");
  const assigned = await tx.residentPropertyAssignment.findFirst({ where: { companyId, propertyId, userId: residentId } });
  if (member.role !== "resident" || member.status !== "active" || member.user.status !== "active" || !assigned)
    throw new AccessError(409, "RESIDENT_INELIGIBLE", "Choose an active resident assigned to this property. Manage resident assignments first.");
}
function terms(b: Record<string, unknown>) {
  const startsOn = date(b.startsOn, "start date"), endsOn = b.endsOn === null ? null : date(b.endsOn, "end date");
  const status = choice(b.status, ["draft", "active", "ended"], "lease status");
  if (endsOn && endsOn < startsOn) throw new AccessError(400, "INVALID_INPUT", "End date cannot precede the start date.");
  if (status === "ended" && !endsOn) throw new AccessError(400, "INVALID_INPUT", "Ended leases require an end date.");
  return { startsOn, endsOn, rentCents: cents(b.monthlyRent), currency: "USD", status };
}
async function activeSlot(tx: Tx, companyId: string, unitId: string, except?: string) {
  if (await tx.lease.findFirst({ where: { companyId, unitId, status: "active", ...(except ? { id: { not: except } } : {}) }, select: { id: true } }))
    throw new AccessError(409, "ACTIVE_LEASE_EXISTS", "This unit already has an active lease. End it before archiving the unit or activating another lease.");
}
export function registerLeasing(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string) {
  const auth = { preValidation: authenticate };
  server.get<{ Params: { propertyId: string }; Querystring: { cursor?: string } }>("/api/company/properties/:propertyId/units", auth, request => {
    const propertyId = assignmentId(request.params.propertyId), cursor = paging(request.query);
    return scoped(db, request, "property.read", async (tx, companyId) => {
      await property(tx, companyId, propertyId);
      return page(await tx.unit.findMany({ where: { companyId, propertyId, ...(cursor ? { id: { lt: cursor } } : {}) }, select: unitSelect, take: 51, orderBy: { id: "desc" } }));
    });
  });
  server.post<{ Params: { propertyId: string } }>("/api/company/properties/:propertyId/units", auth, request => {
    mutation(request, origin);
    const propertyId = assignmentId(request.params.propertyId), b = input(request, ["label", "submissionKey", ...unitDetailKeys]), label = boundedText(b.label, 80, "Unit name");
    const details = unitDetails(b);
    // Blank new fields keep the fingerprint used by already committed older clients.
    const key = submission(b.submissionKey, Object.values(details).every(value => value === null) ? [propertyId, label] : [propertyId, label, details]);
    return scoped(db, request, "property.write", async (tx, companyId) => {
      const previous = await tx.unit.findFirst({ where: { companyId, createdById: request.principal!.id, submissionKey: key.submissionKey }, select: { ...unitSelect, submissionHash: true } });
      if (previous) {
        sameSubmission(previous.submissionHash, key.submissionHash);
        const { submissionHash: _hash, ...row } = previous;
        return row;
      }
      // Serialize independent creators naming units under the same property.
      await tx.$queryRaw`UPDATE "Property" SET "updatedAt"="updatedAt" WHERE id=${propertyId} AND "companyId"=${companyId} RETURNING id`;
      await property(tx, companyId, propertyId);
      if (await tx.unit.findFirst({ where: { companyId, propertyId, label }, select: { id: true } }))
        throw new AccessError(409, "UNIT_NAME_EXISTS", "Another unit in this property uses that exact name.");
      const row = await tx.unit.create({ data: { companyId, propertyId, label, ...details, createdById: request.principal!.id, ...key }, select: unitSelect });
      await audit(tx, request, companyId, row.id, "unit.created", { propertyId });
      return row;
    });
  });
  server.patch<{ Params: { unitId: string } }>("/api/company/units/:unitId", auth, request => {
    mutation(request, origin);
    const unitId = assignmentId(request.params.unitId), b = input(request, ["label", "status", "expectedVersion", ...unitDetailKeys]);
    const parsedDetails = unitDetails(b), detailPatch: Partial<ReturnType<typeof unitDetails>> = {};
    for (const key of Object.keys(parsedDetails) as (keyof typeof parsedDetails)[]) {
      const submittedKey = key === "bathroomsHundredths" ? "bathrooms" : key === "marketRentCents" ? "marketRent" : key;
      if (Object.hasOwn(b, submittedKey)) Object.assign(detailPatch, { [key]: parsedDetails[key] });
    }
    const label = boundedText(b.label, 80, "Unit name"), status = choice(b.status, ["active", "archived"], "unit status"), expectedVersion = version(b.expectedVersion);
    return scoped(db, request, "property.write", async (tx, companyId) => {
      const previous = await lockUnit(tx, companyId, unitId);
      await tx.$queryRaw`UPDATE "Property" SET "updatedAt"="updatedAt" WHERE id=${previous.propertyId} AND "companyId"=${companyId} RETURNING id`;
      if (previous.version !== expectedVersion) throw conflict();
      if (status === "archived" && previous.status !== status) await activeSlot(tx, companyId, unitId);
      if (previous.label === label && previous.status === status && Object.entries(detailPatch).every(([key, value]) => previous[key as keyof typeof previous] === value)) return previous;
      const duplicate = await tx.unit.findFirst({ where: { companyId, propertyId: previous.propertyId, label, id: { not: unitId } }, select: { id: true } });
      if (duplicate) throw new AccessError(409, "UNIT_NAME_EXISTS", "Another unit in this property uses that exact name.");
      const row = await tx.unit.update({ where: { id: unitId }, data: { label, status, ...detailPatch, version: { increment: 1 } }, select: unitSelect });
      await audit(tx, request, companyId, unitId, "unit.updated", { from: previous.status, to: status });
      return row;
    });
  });
  server.get<{Querystring:{cursor?:string;propertyId?:string;status?:string;attention?:string}}>("/api/company/leases",auth,request=>{
    const q=request.query;
    if(Object.keys(q).some(k=>!["cursor","propertyId","status","attention"].includes(k))) throw new AccessError(400,"INVALID_INPUT","Unknown lease filter.");
    const cursor=q.cursor===undefined?undefined:assignmentId(q.cursor),propertyId=q.propertyId===undefined?undefined:assignmentId(q.propertyId),status=q.status===undefined?undefined:choice(q.status,["draft","active","ended"],"lease status"),attention=q.attention===undefined?undefined:choice(q.attention,["ending_soon","past_end","in_effect"],"lease attention filter");
    if(attention&&status) throw new AccessError(400,"INVALID_INPUT","Choose either status or an attention view.");
    return scoped(db,request,"lease.manage",async(tx,companyId)=>{
      if(propertyId) await property(tx,companyId,propertyId);
      let dates={};
      if(attention){
        const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}}),today=new Date(companyDay(company.timezone)+"T00:00:00Z"),through=new Date(today);through.setUTCDate(through.getUTCDate()+30);
        dates=attention==="in_effect"?{status:"active",unit:{status:"active"},startsOn:{lte:today},OR:[{endsOn:null},{endsOn:{gte:today}}]}:{status:"active",unit:{status:"active"},endsOn:attention==="ending_soon"?{gte:today,lte:through}:{lt:today}};
      }
      return page(await tx.lease.findMany({where:{companyId,...(propertyId?{propertyId}:{}),...(status?{status}:{}),...dates,...(cursor?{id:{lt:cursor}}:{})},select:leaseSelect,take:51,orderBy:{id:"desc"}}));
    });
  });
  server.post("/api/company/leases", auth, request => {
    mutation(request, origin);
    const b = input(request, ["propertyId", "unitId", "residentId", "startsOn", "endsOn", "monthlyRent", "status", "submissionKey", ...paymentPolicyKeys]);
    const propertyId = assignmentId(b.propertyId), unitId = assignmentId(b.unitId), residentId = opaqueUserId(b.residentId), data = terms(b);
    const policy = { rentDueDay:1, graceDays:0, paymentInstructions:null, ...paymentPolicyPatch(b) };
    // Keep the original fingerprint for default policies and old clients' retries.
    const fingerprint = policy.rentDueDay===1 && policy.graceDays===0 && policy.paymentInstructions===null ? data : {...data,...policy};
    const key = submission(b.submissionKey, [propertyId, unitId, residentId, fingerprint]);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const previous = await tx.lease.findFirst({ where: { companyId, createdById: request.principal!.id, submissionKey: key.submissionKey }, select: { ...leaseSelect, submissionHash: true } });
      if (previous) {
        // Managers retain scoped history even when a resident transfers or loses access.
        sameSubmission(previous.submissionHash, key.submissionHash);
        const { submissionHash: _hash, ...row } = previous;
        return row;
      }
      await property(tx, companyId, propertyId);
      await eligible(tx, companyId, residentId, propertyId);
      const unit = await lockUnit(tx, companyId, unitId);
      if (unit.propertyId !== propertyId) throw new AccessError(404, "NOT_FOUND", "Unit not found.");
      if (unit.status !== "active") throw new AccessError(409, "UNIT_ARCHIVED", "Restore this unit before creating a lease.");
      if (data.status === "active") await activeSlot(tx, companyId, unitId);
      const row = await tx.lease.create({ data: { companyId, propertyId, unitId, residentId, createdById: request.principal!.id, ...data, ...policy, ...key }, select: leaseSelect });
      await audit(tx, request, companyId, row.id, "lease.created", { unitId, status: data.status, rentDueDay:policy.rentDueDay, graceDays:policy.graceDays });
      return row;
    });
  });
  server.patch<{ Params: { leaseId: string } }>("/api/company/leases/:leaseId", auth, request => {
    mutation(request, origin);
    const leaseId = assignmentId(request.params.leaseId), b = input(request, ["startsOn", "endsOn", "monthlyRent", "status", "expectedVersion", ...paymentPolicyKeys]), data = terms(b), policy = paymentPolicyPatch(b), expectedVersion = version(b.expectedVersion);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      // Order term edits against rent posting/allocation before reading the lease.
      await tx.$queryRaw`UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=${leaseId} AND "companyId"=${companyId} RETURNING id`;
      const previous = await tx.lease.findFirst({ where: { companyId, id: leaseId }, select: leaseSelect });
      if (!previous) throw new AccessError(404, "NOT_FOUND", "Lease not found.");
      if (previous.version !== expectedVersion) throw conflict();
      const firstTermMonth = new Date(data.startsOn); firstTermMonth.setUTCDate(1);
      const outsideTerm = await tx.rentCharge.findFirst({
        where: { companyId, leaseId, voidedAt: null, ...(data.status === "draft" ? {} : { OR: [{ periodOn: { lt: firstTermMonth } }, ...(data.endsOn ? [{ periodOn: { gt: data.endsOn } }] : [])] }) },
        select: { id: true },
      });
      const draftWithPayment = data.status === "draft" && await tx.ledgerEntry.findFirst({ where: { companyId, leaseId, voidedAt: null }, select: { id: true } });
      if (outsideTerm || draftWithPayment) throw new AccessError(409, "LEASE_RENT_CONFLICT", "These lease changes conflict with posted rent. Correct affected charges before changing their term; a lease with active charges or payments cannot become a draft. Posted amounts are never recalculated by a lease edit.");
      // Historical ended records remain editable after resident revocation/transfer.
      if (data.status !== "ended") await eligible(tx, companyId, previous.residentId, previous.propertyId);
      const unit = await lockUnit(tx, companyId, previous.unitId);
      if (data.status !== "ended" && unit.status !== "active") throw new AccessError(409, "UNIT_ARCHIVED", "Restore this unit before reopening a lease.");
      if (data.status === "active") await activeSlot(tx, companyId, previous.unitId, leaseId);
      const updated = await tx.lease.updateMany({ where: { id: leaseId, companyId, version: expectedVersion }, data: { ...data, ...policy, version: { increment: 1 } } });
      if (updated.count !== 1) throw conflict();
      const row = await tx.lease.findFirstOrThrow({ where: { id: leaseId, companyId }, select: leaseSelect });
      await audit(tx, request, companyId, leaseId, "lease.updated", { from: previous.status, to: data.status, paymentPolicy:{from:{rentDueDay:previous.rentDueDay,graceDays:previous.graceDays},to:{rentDueDay:row.rentDueDay,graceDays:row.graceDays},instructionsChanged:previous.paymentInstructions!==row.paymentInstructions} });
      return row;
    });
  });
}
