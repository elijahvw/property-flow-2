import { contactAccount, requireContactAccount, userAccount } from "./resident-accounts.js";
import type { IdentityProvider } from "./identity-provider.js";
import {currentLeaseTerms,readTermChanges} from "./lease-term-policy.js";
import { leasePerson, leasePersonSelect } from "./lease-person.js";
import { linkedResidentContact, participantContact } from "./resident-contacts.js";
import { paymentPolicyKeys, paymentPolicyPatch } from "./payment-policy.js";
import type { FastifyInstance, preValidationHookHandler } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { unitDetailKeys, unitDetails, unitDetailSelect } from "./property-fields.js";
import { companyDay } from "./reports.js";
import { AccessError } from "./access.js";
import { assignmentId, opaqueUserId } from "./application.js";
import { audit, boundedText, cents, choice, conflict, date, input, mutation, page, sameSubmission, scoped, submission, version, type Tx } from "./operational.js";
const unitSelect = { ...unitDetailSelect, id: true, propertyId: true, label: true, status: true, version: true } as const;
const leaseSelect = { ...leasePersonSelect, previousLeaseId:true, previousLease:{select:{id:true,endsOn:true,status:true}}, renewals:{take:1,select:{id:true,status:true,startsOn:true}}, rentDueDay:true, graceDays:true, paymentInstructions:true, id: true, propertyId: true, unitId: true, residentId: true, startsOn: true, endsOn: true, rentCents: true, currency: true, status: true, version: true, unit: { select: { label: true } }, property: { select: { name: true } } } as const;
async function property(tx: Tx, companyId: string, propertyId: string) {
  if (!await tx.property.findFirst({ where: { id: propertyId, companyId }, select: { id: true } }))
    throw new AccessError(404, "NOT_FOUND", "Property not found.");
}
export async function lockUnit(tx: Tx, companyId: string, unitId: string) {
  // The write fence orders archive/edit against activation and concurrent lease changes.
  await tx.$queryRaw`UPDATE "Unit" SET "updatedAt"="updatedAt" WHERE id=${unitId} AND "companyId"=${companyId} RETURNING id`;
  const row = await tx.unit.findFirst({ where: { id: unitId, companyId }, select: unitSelect });
  if (!row) throw new AccessError(404, "NOT_FOUND", "Unit not found.");
  return row;
}
export async function eligible(tx: Tx, companyId: string, residentId: string, propertyId: string, assign = false) {
  await tx.$queryRaw`UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=${residentId} RETURNING id`;
  const member = await tx.companyMembership.findFirst({ where: { userId: residentId, companyId }, include: { user: true } });
  if (!member) throw new AccessError(404, "NOT_FOUND", "Resident not found.");
  const assigned = await tx.residentPropertyAssignment.findFirst({ where: { companyId, propertyId, userId: residentId } });
  if (member.role !== "resident" || member.status !== "active" || member.user.status !== "active" || (!assigned&&!assign))
    throw new AccessError(409, "RESIDENT_INELIGIBLE", "Choose an active resident assigned to this property. Manage resident assignments first.");
}
async function connectProperty(tx:Tx,companyId:string,userId:string,propertyId:string){
  await eligible(tx,companyId,userId,propertyId,true);
  await tx.residentPropertyAssignment.upsert({where:{propertyId_userId:{propertyId,userId}},create:{companyId,propertyId,userId},update:{}});
}
export async function contactEligible(tx: Tx, companyId: string, id: string, propertyId: string, assign=false) {
  const selected=await tx.residentContact.findFirst({where:{id,companyId}});
  if(!selected)throw new AccessError(404,"NOT_FOUND","Tenant not found.");
  if(selected.userId){
    const member=await tx.companyMembership.findUnique({where:{userId:selected.userId}});
    if(member&&member.companyId!==companyId)throw new AccessError(404,"NOT_FOUND","Resident not found.");
    const account=await tx.user.findUniqueOrThrow({where:{id:selected.userId}});
    if(account.status!=="active" || (member&&(member.role!=="resident"||member.status!=="active")))throw new AccessError(409,"RESIDENT_INELIGIBLE","Review this account's current company access before using it on a lease.");
    if(member){if(assign)await connectProperty(tx,companyId,selected.userId,propertyId);else await eligible(tx,companyId,selected.userId,propertyId);}
  }
  await tx.$queryRaw`UPDATE "ResidentContact" SET "updatedAt"="updatedAt" WHERE id=${id} AND "companyId"=${companyId} RETURNING id`;
  const contact=await tx.residentContact.findFirstOrThrow({where:{id,companyId}});
  if(contact.status!=="active")throw new AccessError(409,"TENANT_ARCHIVED","Restore this tenant before recording a lease.");
  return contact;
}
function terms(b: Record<string, unknown>) {
  const startsOn = date(b.startsOn, "start date"), endsOn = b.endsOn === null ? null : date(b.endsOn, "end date");
  const status = choice(b.status, ["draft", "active", "ended"], "lease status");
  if (endsOn && endsOn < startsOn) throw new AccessError(400, "INVALID_INPUT", "End date cannot precede the start date.");
  if (status === "ended" && !endsOn) throw new AccessError(400, "INVALID_INPUT", "Ended leases require an end date.");
  return { startsOn, endsOn, rentCents: cents(b.monthlyRent), currency: "USD", status };
}
export async function activeSlot(tx: Tx, companyId: string, unitId: string, except?: string) {
  if (await tx.lease.findFirst({ where: { companyId, unitId, status: "active", ...(except ? { id: { not: except } } : {}) }, select: { id: true } }))
    throw new AccessError(409, "ACTIVE_LEASE_EXISTS", "This unit already has an active lease. End it before archiving the unit or activating another lease.");
}
export function registerLeasing(server: FastifyInstance, db: PrismaClient, authenticate: preValidationHookHandler, origin: string, provider?: IdentityProvider) {
  const auth = { preValidation: authenticate };
  server.get<{ Params: { unitId: string } }>("/api/company/units/:unitId", auth, request => {
    const unitId = assignmentId(request.params.unitId);
    if (Object.keys(request.query as object).length) throw new AccessError(400, "INVALID_INPUT", "Unknown unit detail filter.");
    return scoped(db, request, "property.read", async (tx, companyId, propertyIds) => {
      const unit = await tx.unit.findFirst({ where: { id: unitId, companyId, ...(propertyIds ? { propertyId: { in: propertyIds } } : {}) }, select: unitSelect });
      if (!unit) throw new AccessError(404, "NOT_FOUND", "Unit not found.");
      return unit;
    });
  });
  server.get<{ Params: { propertyId: string }; Querystring: { cursor?: string; status?: string; q?: string } }>("/api/company/properties/:propertyId/units", auth, request => {
    const q = request.query;
    if (Object.keys(q).some(k => !["cursor", "status", "q"].includes(k))) throw new AccessError(400, "INVALID_INPUT", "Unknown unit filter.");
    if (q.q !== undefined && (typeof q.q !== "string" || q.q.length > 200 || q.q.includes("\0"))) throw new AccessError(400, "INVALID_INPUT", "Search must be at most 200 characters.");
    const propertyId = assignmentId(request.params.propertyId), cursor = q.cursor === undefined ? undefined : assignmentId(q.cursor), status = q.status === undefined ? undefined : choice(q.status, ["active", "archived"], "unit status"), search = q.q?.trim();
    return scoped(db, request, "property.read", async (tx, companyId, propertyIds) => {
      if (propertyIds && !propertyIds.includes(propertyId)) throw new AccessError(404, "NOT_FOUND", "Property not found.");
      await property(tx, companyId, propertyId);
      return page(await tx.unit.findMany({ where: { companyId, propertyId, status, ...(search ? { OR: [{ label: { contains: search, mode: "insensitive" } }, { floor: { contains: search, mode: "insensitive" } }] } : {}), ...(cursor ? { id: { lt: cursor } } : {}) }, select: unitSelect, take: 51, orderBy: { id: "desc" } }));
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
  server.get<{Querystring:{cursor?:string;propertyId?:string;unitId?:string;status?:string;attention?:string;approvals?:string;q?:string}}>("/api/company/leases",auth,request=>{
    const q=request.query;
    if(Object.keys(q).some(k=>!["cursor","propertyId","unitId","status","attention","approvals","q"].includes(k))) throw new AccessError(400,"INVALID_INPUT","Unknown lease filter.");
    if(q.q!==undefined&&(typeof q.q!=="string"||q.q.length>200||q.q.includes("\0")))throw new AccessError(400,"INVALID_INPUT","Search must be at most 200 characters.");
    const search=q.q?.trim();
    const unitId=q.unitId===undefined?undefined:assignmentId(q.unitId);
    const cursor=q.cursor===undefined?undefined:assignmentId(q.cursor),propertyId=q.propertyId===undefined?undefined:assignmentId(q.propertyId),status=q.status===undefined?undefined:choice(q.status,["draft","active","ended"],"lease status"),attention=q.attention===undefined?undefined:choice(q.attention,["ending_soon","past_end","in_effect"],"lease attention filter");
    if(attention&&status) throw new AccessError(400,"INVALID_INPUT","Choose either status or an attention view.");
    const approvals=q.approvals===undefined?undefined:choice(q.approvals,["pending"],"resident approval filter");
    if(approvals&&(attention||status))throw new AccessError(400,"INVALID_INPUT","Choose resident approvals, status or an attention view.");
    return scoped(db,request,"lease.manage",async(tx,companyId)=>{
      if(propertyId) await property(tx,companyId,propertyId);
      const selectedUnit = unitId ? await tx.unit.findFirst({where:{id:unitId,companyId,...(propertyId?{propertyId}:{})},select:{id:true,label:true,propertyId:true}}) : null;
      if(unitId&&!selectedUnit)throw new AccessError(404,"NOT_FOUND","Unit not found in this property.");
      if(approvals&&(await tx.companyMembership.findUniqueOrThrow({where:{userId:request.principal!.id}})).role!=="owner")throw new AccessError(403,"ACCESS_DENIED","Only owners can review all resident approval requests.");
      let dates={};
      if(attention||approvals){
        const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}}),today=new Date(companyDay(company.timezone)+"T00:00:00Z"),through=new Date(today);through.setUTCDate(through.getUTCDate()+30);
        dates=approvals?{status:{in:["draft","active"]},OR:[{endsOn:null},{endsOn:{gte:today}}],residentInvitations:{some:{companyId,approvedAt:null,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}}}}:attention==="in_effect"?{status:"active",unit:{status:"active"},startsOn:{lte:today},OR:[{endsOn:null},{endsOn:{gte:today}}]}:{status:"active",unit:{status:"active"},endsOn:attention==="ending_soon"?{gte:today,lte:through}:{lt:today}};
      }
      return {...page(await tx.lease.findMany({where:{companyId,...(propertyId?{propertyId}:{}),...(unitId?{unitId}:{}),...(status?{status}:{}),...dates,...(search?{AND:[{OR:[{property:{name:{contains:search,mode:"insensitive"}}},{unit:{label:{contains:search,mode:"insensitive"}}},{residentContact:{name:{contains:search,mode:"insensitive"}}},{residentContact:{email:{contains:search,mode:"insensitive"}}},{resident:{name:{contains:search,mode:"insensitive"}}},{resident:{email:{contains:search,mode:"insensitive"}}}]}]}:{}),...(cursor?{id:{lt:cursor}}:{})},select:leaseSelect,take:51,orderBy:{id:"desc"}}).then(async rows=>(await currentLeaseTerms(tx,companyId,rows)).map(row=>({...row,resident:leasePerson(row)})))),...(selectedUnit?{unit:selectedUnit}:{})};
    });
  });
  server.post("/api/company/leases", auth, async request => {
    mutation(request, origin);
    const b = input(request, ["propertyId", "unitId", "residentId", "residentContactId", "startsOn", "endsOn", "monthlyRent", "status", "submissionKey", "previousLeaseId", "expectedPreviousVersion", ...paymentPolicyKeys]);
    const propertyId = assignmentId(b.propertyId), unitId = assignmentId(b.unitId), residentId = b.residentId == null ? null : opaqueUserId(b.residentId), residentContactId = b.residentContactId == null ? null : assignmentId(b.residentContactId), data = terms(b);
    if(!residentId&&!residentContactId)throw new AccessError(400,"INVALID_INPUT","Choose a primary tenant.");
    if(residentId&&residentContactId)throw new AccessError(400,"INVALID_INPUT","Choose either a tenant contact or a legacy account, not both.");
    const previousLeaseId=b.previousLeaseId===null||b.previousLeaseId===undefined?null:assignmentId(b.previousLeaseId);
    if(!previousLeaseId&&b.expectedPreviousVersion!==undefined)throw new AccessError(400,"INVALID_INPUT","A previous lease is required for a renewal version.");
    const expectedPreviousVersion=previousLeaseId?version(b.expectedPreviousVersion):null;
    const policy = { rentDueDay:1, graceDays:0, paymentInstructions:null, ...paymentPolicyPatch(b) };
    // Keep the original fingerprint for default policies and old clients' retries.
    const fingerprint = policy.rentDueDay===1 && policy.graceDays===0 && policy.paymentInstructions===null ? data : {...data,...policy};
    const key = submission(b.submissionKey, previousLeaseId?[propertyId,unitId,residentContactId?{contactId:residentContactId}:residentId,fingerprint,previousLeaseId,expectedPreviousVersion]:[propertyId, unitId, residentContactId?{contactId:residentContactId}:residentId, fingerprint]);
    const accounts = await scoped(db, request, "lease.manage", async (tx, companyId) => {
      const prior = await tx.lease.findFirst({where:{companyId,createdById:request.principal!.id,submissionKey:key.submissionKey},select:{submissionHash:true}});
      if(prior){sameSubmission(prior.submissionHash,key.submissionHash);return {contacts:[],users:[],retained:[]};}
      await property(tx,companyId,propertyId);
      const selectedUnit=await tx.unit.findFirst({where:{id:unitId,propertyId,companyId},select:{id:true}});
      if(!selectedUnit)throw new AccessError(404,"NOT_FOUND","Unit not found.");
      const contact=residentContactId ? await tx.residentContact.findFirst({where:{id:residentContactId,companyId,status:"active"}}) : null;
      if(residentContactId&&!contact)throw new AccessError(404,"NOT_FOUND","Tenant not found.");
      const ids=contact?[contact.id]:[];
      const users=residentId?[residentId]:[];
      const retained:string[]=[];
      if(previousLeaseId){
        const previous=await tx.lease.findFirst({where:{id:previousLeaseId,companyId},select:{id:true}});
        if(!previous)throw new AccessError(404,"NOT_FOUND","Previous lease not found.");
        const members=await tx.leaseParticipant.findMany({where:{companyId,leaseId:previousLeaseId,removedAt:null,OR:[{endsOn:null},{endsOn:{gte:data.startsOn}}]},take:201});
        if(members.length>200)throw new AccessError(422,"HOUSEHOLD_SCOPE_TOO_LARGE","Too many household records.");
        for(const member of members){if(member.contactId)ids.push(member.contactId);else if(member.userId)retained.push(member.userId);else throw new AccessError(409,"ACCOUNT_REQUIRED","Open each existing household profile and prepare its account before renewing this lease.");}
      }
      return {contacts:[...new Set(ids)],users:[...new Set(users)],retained:[...new Set(retained)]};
    });
    for(const contactId of accounts.contacts)await contactAccount(db,request,"lease.manage",provider,contactId);
    for(const userId of accounts.users)await userAccount(db,request,"lease.manage",provider,userId);
    for(const userId of accounts.retained)await userAccount(db,request,"lease.manage",provider,userId,true);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const previous = await tx.lease.findFirst({ where: { companyId, createdById: request.principal!.id, submissionKey: key.submissionKey }, select: { ...leaseSelect, submissionHash: true } });
      if (previous) {
        // Managers retain scoped history even when a resident transfers or loses access.
        sameSubmission(previous.submissionHash, key.submissionHash);
        const { submissionHash: _hash, ...row } = previous;
        return {...row,resident:leasePerson(row)};
      }
      await property(tx,companyId,propertyId);
      if(residentId)await eligible(tx,companyId,residentId,propertyId);
      const primaryContact = residentContactId ? await contactEligible(tx,companyId,residentContactId,propertyId,true) : await linkedResidentContact(tx,companyId,residentId!);
      if(primaryContact.status!=="active")throw new AccessError(409,"TENANT_ARCHIVED","Restore this tenant before recording a lease.");
      await requireContactAccount(tx, primaryContact);
      const primaryUserId = primaryContact.userId;
      if(previousLeaseId){
        await tx.$queryRaw`UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=${previousLeaseId} AND "companyId"=${companyId} RETURNING id`;
        const previous=await tx.lease.findFirst({where:{id:previousLeaseId,companyId},select:{id:true,unitId:true,propertyId:true,residentId:true,residentContactId:true,endsOn:true,status:true,version:true}});
        if(!previous||previous.propertyId!==propertyId||previous.unitId!==unitId||(residentContactId?previous.residentContactId!==residentContactId:previous.residentId!==residentId))throw new AccessError(404,"NOT_FOUND","Previous lease not found for this unit and resident.");
        if(previous.version!==expectedPreviousVersion)throw conflict();
        if(previous.status==="draft"||!previous.endsOn||data.startsOn<=previous.endsOn||data.status!=="draft")throw new AccessError(409,"RENEWAL_TERMS_INVALID","Prepare a draft renewal after the previous lease's recorded end date. Choose an end date for the previous lease first.");
        if(await tx.lease.findFirst({where:{companyId,previousLeaseId},select:{id:true}}))throw new AccessError(409,"RENEWAL_EXISTS","This lease already has a linked renewal. Review that record; prepare the following term from its latest lease.");
      }
      await property(tx, companyId, propertyId);

      const unit = await lockUnit(tx, companyId, unitId);
      if (unit.propertyId !== propertyId) throw new AccessError(404, "NOT_FOUND", "Unit not found.");
      if (unit.status !== "active") throw new AccessError(409, "UNIT_ARCHIVED", "Restore this unit before creating a lease.");
      if (data.status === "active") await activeSlot(tx, companyId, unitId);
      const row = await tx.lease.create({ data: { companyId, propertyId, unitId, residentId:primaryUserId, residentContactId:primaryContact.id, createdById: request.principal!.id, ...data, ...policy, previousLeaseId, ...key }, select: leaseSelect });
      const primary=primaryContact;
      await tx.leaseParticipant.create({data:{companyId,propertyId,leaseId:row.id,userId:primaryUserId,contactId:primaryContact.id,name:primary.name,email:primary.email,role:"leaseholder",startsOn:data.startsOn,createdById:request.principal!.id,submissionKey:`primary:${row.id}`,submissionHash:key.submissionHash}});
      if(previousLeaseId){
        // Copy the reviewed household into the linked draft. Dates/roles remain
        // visible for review; no invitations, money or portal access are copied.
        const members=await tx.leaseParticipant.findMany({where:{companyId,leaseId:previousLeaseId,removedAt:null,AND:[{OR:[{contactId:null},{contactId:{not:primaryContact.id}}]},{OR:[{endsOn:null},{endsOn:{gte:data.startsOn}}]}]},take:201});
        if(members.length>200)throw new AccessError(422,"HOUSEHOLD_SCOPE_TOO_LARGE","Too many household records to prepare a complete renewal.");
        for(const member of members){
          const contactId=member.contactId??(await participantContact(tx,companyId,member)).id;
          await requireContactAccount(tx, await tx.residentContact.findFirstOrThrow({where:{id:contactId,companyId}}));
          if(!member.contactId)await tx.leaseParticipant.update({where:{id:member.id},data:{contactId}});
          await tx.leaseParticipant.create({data:{companyId,propertyId,leaseId:row.id,userId:member.userId,contactId,name:member.name,email:member.email,phone:member.phone,role:member.role,portalApproved:false,startsOn:member.startsOn>data.startsOn?member.startsOn:data.startsOn,endsOn:member.endsOn,createdById:request.principal!.id,submissionKey:`renewal:${row.id}:${member.id}`,submissionHash:key.submissionHash}});
        }
      }
      await audit(tx, request, companyId, row.id, "lease.created", { unitId, status: data.status, rentDueDay:policy.rentDueDay, graceDays:policy.graceDays, ...(previousLeaseId?{previousLeaseId}:{} ) });
      return {...row,resident:leasePerson(row)};
    });
  });
  server.get<{ Params: { leaseId: string } }>("/api/company/leases/:leaseId", auth, request => {
    const leaseId=assignmentId(request.params.leaseId);
    if(Object.keys(request.query as object).length)throw new AccessError(400,"INVALID_INPUT","Unknown lease detail filter.");
    return scoped(db,request,"lease.manage",async(tx,companyId)=>{
      const row=await tx.lease.findFirst({where:{id:leaseId,companyId},select:leaseSelect});
      if(!row)throw new AccessError(404,"NOT_FOUND","Lease not found.");
      const [current]=await currentLeaseTerms(tx,companyId,[row]);
      const company=await tx.company.findUniqueOrThrow({where:{id:companyId},select:{timezone:true}}),today=new Date(companyDay(company.timezone)+"T00:00:00Z");
      const [householdCount,pendingApprovals,schedule,deposit]=await Promise.all([
        tx.leaseParticipant.count({where:{companyId,leaseId,removedAt:null,startsOn:{lte:today},OR:[{endsOn:null},{endsOn:{gte:today}}]}}),
        tx.invitation.count({where:{companyId,leaseId,approvedAt:null,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}}}),
        tx.rentSchedule.findFirst({where:{companyId,leaseId,status:{in:["active","paused"]}},select:{status:true}}),
        tx.depositAccount.findFirst({where:{companyId,leaseId},select:{id:true}})
      ]);
      return {...current,resident:leasePerson(row),overview:{householdCount,pendingApprovals,scheduleStatus:schedule?.status??null,depositRecorded:!!deposit}};
    });
  });
  server.patch<{ Params: { leaseId: string } }>("/api/company/leases/:leaseId", auth, request => {
    mutation(request, origin);
    const leaseId = assignmentId(request.params.leaseId), b = input(request, ["startsOn", "endsOn", "monthlyRent", "status", "expectedVersion", ...paymentPolicyKeys]), data = terms(b), policy = paymentPolicyPatch(b), expectedVersion = version(b.expectedVersion);
    return scoped(db, request, "lease.manage", async (tx, companyId) => {
      const identity=await tx.lease.findFirst({where:{id:leaseId,companyId},select:{previousLeaseId:true}});
      if(identity?.previousLeaseId)await tx.$queryRaw`UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=${identity.previousLeaseId} AND "companyId"=${companyId} RETURNING id`;
      // Order term edits against rent posting/allocation before reading the lease.
      await tx.$queryRaw`UPDATE "Lease" SET "updatedAt"="updatedAt" WHERE id=${leaseId} AND "companyId"=${companyId} RETURNING id`;
      const previous = await tx.lease.findFirst({ where: { companyId, id: leaseId }, select: leaseSelect });
      if (!previous) throw new AccessError(404, "NOT_FOUND", "Lease not found.");
      if (previous.version !== expectedVersion) throw conflict();
      const retainedTerms=await readTermChanges(tx,companyId,[leaseId]);
      const [currentTerms]=await currentLeaseTerms(tx,companyId,[previous]);
      if(retainedTerms.length){
        if(data.rentCents!==currentTerms.rentCents||(policy.rentDueDay!==undefined&&policy.rentDueDay!==currentTerms.rentDueDay)||(policy.graceDays!==undefined&&policy.graceDays!==currentTerms.graceDays)||(policy.paymentInstructions!==undefined&&policy.paymentInstructions!==currentTerms.paymentInstructions))throw new AccessError(409,"LEASE_VERSIONED_TERMS","Use the future terms review to change payment terms. The recorded baseline is preserved.");
        data.rentCents=previous.rentCents;policy.rentDueDay=previous.rentDueDay;policy.graceDays=previous.graceDays;policy.paymentInstructions=previous.paymentInstructions;
        if(data.status==="draft"||retainedTerms.some(t=>!t.cancellation&&(t.effectiveOn<data.startsOn||(data.endsOn&&t.effectiveOn>data.endsOn))))throw new AccessError(409,"LEASE_TERM_CONFLICT","These dates conflict with retained term changes. Cancel an unposted future change before shortening the lease.");
      }
      if(previous.previousLeaseId){
        const parent=await tx.lease.findFirstOrThrow({where:{id:previous.previousLeaseId,companyId},select:{endsOn:true,status:true}});
        if(parent.status==="draft"||!parent.endsOn||data.startsOn<=parent.endsOn)throw new AccessError(409,"RENEWAL_TERMS_INVALID","A renewal must start after the previous lease ends.");
      }
      const renewal=await tx.lease.findFirst({where:{companyId,previousLeaseId:leaseId},select:{startsOn:true}});
      if(renewal&&(data.status==="draft"||!data.endsOn||data.endsOn>=renewal.startsOn))throw new AccessError(409,"RENEWAL_TERM_CONFLICT","These changes conflict with the linked renewal. Keep the previous lease end before the renewal starts.");
      const changesBilling = +data.startsOn!==+previous.startsOn || +(data.endsOn??0)!==+(previous.endsOn??0) || data.rentCents!==previous.rentCents || data.status!==previous.status || (policy.rentDueDay!==undefined&&policy.rentDueDay!==previous.rentDueDay) || (policy.graceDays!==undefined&&policy.graceDays!==previous.graceDays);
      if(changesBilling && await tx.rentSchedule.findFirst({where:{companyId,leaseId,status:{in:["active","paused"]}},select:{id:true}}))
        throw new AccessError(409,"LEASE_SCHEDULE_CONFLICT","Stop the recurring rent schedule before changing lease dates, rent, status or payment terms. Posted charges remain unchanged.");
      const firstTermMonth = new Date(data.startsOn); firstTermMonth.setUTCDate(1);
      const outsideTerm = await tx.rentCharge.findFirst({
        where: { companyId, leaseId, voidedAt: null, ...(data.status === "draft" ? {} : { kind:"rent", OR: [{ periodOn: { lt: firstTermMonth } }, ...(data.endsOn ? [{ periodOn: { gt: data.endsOn } }] : [])] }) },
        select: { id: true },
      });
      if(data.status === "draft" && await tx.depositReceipt.findFirst({where:{companyId,leaseId,cashEntries:{some:{voidedAt:null}}},select:{id:true}}))throw new AccessError(409,"LEASE_DEPOSIT_CONFLICT","A lease holding a recorded deposit cannot become a draft. Correct recording errors in its deposit ledger first.");
      const draftWithPayment = data.status === "draft" && await tx.ledgerEntry.findFirst({ where: { companyId, leaseId, voidedAt: null }, select: { id: true } });
      if (outsideTerm || draftWithPayment) throw new AccessError(409, "LEASE_RENT_CONFLICT", "These lease changes conflict with posted rent. Correct affected charges before changing their term; a lease with active charges or payments cannot become a draft. Posted amounts are never recalculated by a lease edit.");
      // Historical ended records remain editable after resident revocation/transfer.
      if (data.status !== "ended") {
        if(previous.residentContactId)await contactEligible(tx,companyId,previous.residentContactId,previous.propertyId);
        else if(previous.residentId)await eligible(tx, companyId, previous.residentId, previous.propertyId);
      }
      const unit = await lockUnit(tx, companyId, previous.unitId);
      if (data.status !== "ended" && unit.status !== "active") throw new AccessError(409, "UNIT_ARCHIVED", "Restore this unit before reopening a lease.");
      if (data.status === "active") await activeSlot(tx, companyId, previous.unitId, leaseId);
      const updated = await tx.lease.updateMany({ where: { id: leaseId, companyId, version: expectedVersion }, data: { ...data, ...policy, version: { increment: 1 } } });
      if (updated.count !== 1) throw conflict();
      const row = await tx.lease.findFirstOrThrow({ where: { id: leaseId, companyId }, select: leaseSelect });
      await audit(tx, request, companyId, leaseId, "lease.updated", { from: previous.status, to: data.status, paymentPolicy:{from:{rentDueDay:previous.rentDueDay,graceDays:previous.graceDays},to:{rentDueDay:row.rentDueDay,graceDays:row.graceDays},instructionsChanged:previous.paymentInstructions!==row.paymentInstructions} });
      return {...(await currentLeaseTerms(tx,companyId,[row]))[0],resident:leasePerson(row)};
    });
  });
}
