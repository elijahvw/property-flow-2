import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { companyDay } from "../dist/reports.js";
import { digest } from "../dist/sessions.js";
export async function offlineTenantCases(t, admin, call, providerCalls) {
  const ok = (r) => {
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const contactPath = (id) => `/api/company/resident-contacts/${id}`;
  let tenant, lease, unit, acceptedToken;
  const contactBody = {
    name: "Jordan Offline",
    email: "offline-portal@test.invalid",
    phone: "555-0100",
    addressLine1: "12 Oak Street",
    addressLine2: "Apt 4",
    city: "Philadelphia",
    region: "PA",
    postalCode: "19103",
    country: "US",
    emergencyContactName: "Sam Emergency",
    emergencyContactPhone: "555-0200",
    emergencyRelationship: "Sibling",
    managementNotes: "Call before scheduling",
  };
  const review = (person) => ({
    expectedVersion: person.version,
    approvals: person.leases.map((p) => ({
      id: p.id,
      leaseId: p.leaseId,
      role: p.role,
      version: p.version,
      leaseVersion: p.lease.version,
    })),
  });
  const invite = async (id) =>
    ok(
      await call(
        "offline-owner",
        "POST",
        contactPath(id) + "/invitations",
        review(ok(await call("offline-owner", "GET", contactPath(id)))),
      ),
    );
  const token = (row) => new URL(row.acceptanceUrl).hash.slice(1);
  const addUser = async (id, email, verified = true) => {
    await admin.query(
      `INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,$2,$1,$3,NOW())`,
      [id, email, verified],
    );
    await admin.query(
      `INSERT INTO "Session"("tokenHash","csrfToken","userId","expiresAt","idleExpiresAt") VALUES($1,'csrf',$2,NOW()+interval '1 hour',NOW()+interval '1 hour')`,
      [digest("token-" + id), id],
    );
  };
  await t.test(
    "offline contact creation is complete, scoped, replayable and independent of login",
    async () => {
      await admin.query(
        `INSERT INTO "Company"(id,name,"updatedAt") VALUES('offline-company','Offline Company',NOW())`,
      );
      await addUser("offline-owner", "offline-owner@test.invalid");
      await admin.query(
        `INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('offline-owner','offline-company','owner',NOW())`,
      );
      await admin.query(
        `INSERT INTO "Property"(id,"companyId",name,address,city,state,zip,"updatedAt") VALUES('offline-home','offline-company','Oak Place','12 Oak Street','Philadelphia','PA','19103',NOW())`,
      );
      const body = { ...contactBody, submissionKey: randomUUID() };
      const responses = await Promise.all([
        call("offline-owner", "POST", "/api/company/resident-contacts", body),
        call("offline-owner", "POST", "/api/company/resident-contacts", body),
      ]);
      tenant = ok(responses[0]);
      assert.equal(ok(responses[1]).id, tenant.id);
      assert.equal(tenant.userId, null);
      assert.equal(tenant.addressLine1, contactBody.addressLine1);
      assert.equal(tenant.emergencyRelationship, "Sibling");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "User" WHERE email=$1`,
            [contactBody.email],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "Invitation" WHERE "contactId"=$1`,
            [tenant.id],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await call("foreign", "GET", contactPath(tenant.id))).statusCode,
        404,
      );
      assert.equal(
        (
          await call("resident", "POST", "/api/company/resident-contacts", {
            ...body,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await call(
            "offline-owner",
            "POST",
            "/api/company/resident-contacts",
            { ...body, submissionKey: randomUUID() },
          )
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call(
            "offline-owner",
            "POST",
            "/api/company/resident-contacts",
            { ...body, submissionKey: randomUUID(), email: "invalid" },
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await call(
            "offline-owner",
            "POST",
            "/api/company/resident-contacts",
            { ...body, name: "Different person" },
          )
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "an offline lease uses the same profile throughout rent, deposits and workspace",
    async () => {
      unit = ok(
        await call(
          "offline-owner",
          "POST",
          "/api/company/properties/offline-home/units",
          { label: "Apt 4", submissionKey: randomUUID() },
        ),
      );
      const body = {
        propertyId: "offline-home",
        unitId: unit.id,
        residentContactId: tenant.id,
        startsOn: "2026-01-01",
        endsOn: null,
        monthlyRent: "1200.00",
        status: "active",
        submissionKey: randomUUID(),
      };
      lease = ok(
        await call("offline-owner", "POST", "/api/company/leases", body),
      );
      assert.equal(lease.residentId, null);
      assert.equal(lease.residentContactId, tenant.id);
      assert.equal(lease.resident.name, contactBody.name);
      assert.equal(
        ok(await call("offline-owner", "POST", "/api/company/leases", body)).id,
        lease.id,
      );
      ok(
        await call(
          "offline-owner",
          "POST",
          `/api/company/rent/${lease.id}/charges`,
          {
            periodOn: "2026-01-01",
            dueOn: "2026-01-01",
            amount: "1200.00",
            memo: null,
            expectedVersion: 1,
            submissionKey: randomUUID(),
          },
        ),
      );
      ok(
        await call(
          "offline-owner",
          "POST",
          `/api/company/deposits/${lease.id}`,
          {
            amount: "1500.00",
            dueOn: "2026-01-01",
            expectedLeaseVersion: 1,
            submissionKey: randomUUID(),
          },
        ),
      );
      const workspace = ok(
        await call(
          "offline-owner",
          "GET",
          contactPath(tenant.id) + "/workspace",
        ),
      );
      assert.equal(workspace.leases[0].id, lease.id);
      const directory = ok(await call("offline-owner", "GET", "/api/company/resident-profiles"));
      const person = directory.find(c => c.contactId === tenant.id);
      assert.equal(person.canArchive, false);
      assert.equal(person.rentals.find(r => r.leaseId === lease.id).status, "current");
      assert.equal(person.rentals.find(r => r.leaseId === lease.id).unitLabel, "Apt 4");
      assert.ok(person.rentals.every(r => r.propertyId === "offline-home"));
      assert.equal(
        (
          await call("offline-owner", "PATCH", contactPath(tenant.id), {
            ...contactBody,
            status: "archived",
            expectedVersion: tenant.version,
          })
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "owner invitation binds reviewed household, verified email and the existing profile without changing money",
    async () => {
      const person = ok(
          await call("offline-owner", "GET", contactPath(tenant.id)),
        ),
        scope = review(person);
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            contactPath(tenant.id) + "/invitations",
            scope,
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await call(
            "offline-owner",
            "POST",
            contactPath(tenant.id) + "/invitations",
            { ...scope, expectedVersion: 0 },
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await call(
            "offline-owner",
            "POST",
            contactPath(tenant.id) + "/invitations",
            { ...scope, approvals: [] },
          )
        ).statusCode,
        409,
      );
      const old = await invite(tenant.id),
        current = await invite(tenant.id),
        secret = token(current);
      acceptedToken = secret;
      assert.equal(
        (
          await call(null, "POST", "/api/invitations/setup-account", {
            token: token(old),
          })
        ).statusCode,
        403,
      );
      ok(
        await call(null, "POST", "/api/invitations/setup-account", {
          token: secret,
        }),
      );
      assert.deepEqual(providerCalls.slice(-3), [
        ["create", contactBody.email, contactBody.name],
        ["setup", contactBody.email],
        ["verify", "auth0|offline-mock"],
      ]);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "CompanyMembership" WHERE "companyId"='offline-company'`,
          )
        ).rows[0].n,
        1,
      );
      await addUser("offline-login", contactBody.email, false);
      assert.equal(
        (
          await call("offline-login", "POST", "/api/invitations/accept", {
            token: secret,
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await call("resident", "POST", "/api/invitations/accept", {
            token: secret,
          })
        ).statusCode,
        403,
      );
      await admin.query(
        `UPDATE "User" SET "emailVerified"=true WHERE id='offline-login'`,
      );
      ok(
        await call("offline-login", "POST", "/api/invitations/preview", {
          token: secret,
        }),
      );
      const before = (
        await admin.query(
          `SELECT id,"amountCents" FROM "RentCharge" WHERE "leaseId"=$1`,
          [lease.id],
        )
      ).rows;
      ok(
        await call("offline-login", "POST", "/api/invitations/accept", {
          token: secret,
        }),
      );
      ok(
        await call("offline-login", "POST", "/api/invitations/accept", {
          token: secret,
        }),
      );
      const after = ok(
        await call("offline-owner", "GET", contactPath(tenant.id)),
      );
      assert.equal(after.userId, "offline-login");
      assert.equal(after.portal.state, "active");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "ResidentContact" WHERE "companyId"='offline-company'`,
          )
        ).rows[0].n,
        1,
      );
      assert.deepEqual(
        (
          await admin.query(
            `SELECT id,"amountCents" FROM "RentCharge" WHERE "leaseId"=$1`,
            [lease.id],
          )
        ).rows,
        before,
      );
      const rent = ok(
        await call(
          "offline-login",
          "GET",
          `/api/resident/rent?leaseId=${lease.id}`,
        ),
      );
      assert.equal(rent.accounts[0].summary.outstandingCents, "120000");
      assert.equal(
        JSON.stringify(rent).includes(contactBody.managementNotes),
        false,
      );
      await admin.query(
        `DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='offline-login'`,
      );
      ok(
        await call("offline-login", "POST", "/api/invitations/accept", {
          token: secret,
        }),
      );
      assert.equal(
        (
          await call(
            "offline-login",
            "GET",
            `/api/resident/rent?leaseId=${lease.id}`,
          )
        ).statusCode,
        404,
        "replay cannot restore revoked property access",
      );
    },
  );
  await t.test(
    "saved occupants use existing profiles, owner-approved invitation and no financial access",
    async () => {
      const occupant = ok(
        await call("offline-owner", "POST", "/api/company/resident-contacts", {
          name: "Offline occupant",
          email: "offline-occupant@test.invalid",
          submissionKey: randomUUID(),
        }),
      );
      const participant = ok(
        await call(
          "offline-owner",
          "POST",
          `/api/company/leases/${lease.id}/participants`,
          {
            contactId: occupant.id,
            name: occupant.name,
            email: occupant.email,
            phone: null,
            role: "occupant",
            startsOn: "2026-01-01",
            endsOn: null,
            submissionKey: randomUUID(),
          },
        ),
      );
      assert.equal(participant.contactId, occupant.id);
      assert.equal(
        (
          await call(
            "offline-owner",
            "POST",
            `/api/company/leases/${lease.id}/participants`,
            {
              contactId: occupant.id,
              name: occupant.name,
              email: occupant.email,
              phone: null,
              role: "occupant",
              startsOn: "2026-01-01",
              endsOn: null,
              submissionKey: randomUUID(),
            },
          )
        ).statusCode,
        409,
      );
      const pending = await invite(occupant.id);
      await addUser("offline-occupant", occupant.email);
      ok(
        await call("offline-occupant", "POST", "/api/invitations/accept", {
          token: token(pending),
        }),
      );
      assert.equal(
        (
          await call(
            "offline-occupant",
            "GET",
            `/api/resident/rent?leaseId=${lease.id}`,
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await call(
            "offline-occupant",
            "GET",
            `/api/resident/deposits/${lease.id}`,
          )
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "changed household or contact email invalidates pending invitations without merging accounts",
    async () => {
      const person = ok(
        await call("offline-owner", "POST", "/api/company/resident-contacts", {
          name: "Pending person",
          email: "offline-pending@test.invalid",
          submissionKey: randomUUID(),
        }),
      );
      const p = ok(
        await call(
          "offline-owner",
          "POST",
          `/api/company/leases/${lease.id}/participants`,
          {
            contactId: person.id,
            name: person.name,
            email: person.email,
            phone: null,
            role: "leaseholder",
            startsOn: "2026-01-01",
            endsOn: null,
            submissionKey: randomUUID(),
          },
        ),
      );
      let pending = await invite(person.id);
      await addUser("offline-pending", person.email);
      ok(
        await call(
          "offline-owner",
          "PATCH",
          `/api/company/leases/${lease.id}/participants/${p.id}`,
          {
            name: p.name,
            email: p.email,
            phone: null,
            role: "occupant",
            startsOn: "2026-01-01",
            endsOn: null,
            expectedVersion: p.version,
          },
        ),
      );
      assert.equal(
        (
          await call("offline-pending", "POST", "/api/invitations/accept", {
            token: token(pending),
          })
        ).statusCode,
        409,
      );
      assert.equal(
        ok(await call("offline-owner", "GET", contactPath(person.id))).userId,
        null,
      );
      pending = await invite(person.id);
      ok(
        await call("offline-owner", "PATCH", contactPath(person.id), {
          name: person.name,
          email: "corrected@test.invalid",
          expectedVersion: person.version,
        }),
      );
      assert.equal(
        (
          await call("offline-pending", "POST", "/api/invitations/accept", {
            token: token(pending),
          })
        ).statusCode,
        403,
      );
    },
  );
  await t.test(
    "linking an existing resident records its legacy baseline without overwriting curated contact data on transfer",
    async () => {
      await addUser("offline-existing", "offline-existing@test.invalid");
      await admin.query(
        `INSERT INTO "CompanyMembership"("userId","companyId",role,"contactName","managementNotes","updatedAt") VALUES('offline-existing','offline-company','resident','Legacy name','Legacy note',NOW())`,
      );
      const contact = ok(
        await call("offline-owner", "POST", "/api/company/resident-contacts", {
          name: "Curated business name",
          email: "offline-existing@test.invalid",
          managementNotes: "Curated private note",
          submissionKey: randomUUID(),
        }),
      );
      const pending = await invite(contact.id);
      ok(
        await call("offline-existing", "POST", "/api/invitations/accept", {
          token: token(pending),
        }),
      );
      ok(
        await call(
          "platform",
          "PUT",
          "/api/platform/users/offline-existing/membership",
          {
            companyId: "b",
            role: "resident",
            status: "active",
            expectedVersion: 1,
          },
        ),
      );
      const preserved = ok(
        await call("offline-owner", "GET", contactPath(contact.id)),
      );
      assert.equal(preserved.name, "Curated business name");
      assert.equal(preserved.managementNotes, "Curated private note");
      assert.equal(preserved.portal.state, "disabled");
    },
  );
  await t.test(
    "departed occupants can be archived while their active parent lease and history remain",
    async () => {
      const c = ok(
        await call("offline-owner", "POST", "/api/company/resident-contacts", {
          name: "Departed occupant",
          submissionKey: randomUUID(),
        }),
      );
      const p = ok(
        await call(
          "offline-owner",
          "POST",
          `/api/company/leases/${lease.id}/participants`,
          {
            contactId: c.id,
            name: c.name,
            email: null,
            phone: null,
            role: "occupant",
            startsOn: "2026-01-01",
            endsOn: "2026-01-02",
            submissionKey: randomUUID(),
          },
        ),
      );
      assert.equal(
        ok(await call("offline-owner", "GET", contactPath(c.id))).leases.length,
        0,
      );
      const archived = ok(
        await call("offline-owner", "PATCH", contactPath(c.id), {
          name: c.name,
          expectedVersion: c.version,
          status: "archived",
        }),
      );
      assert.equal(archived.status, "archived");
      const directory = ok(await call("offline-owner", "GET", "/api/company/resident-profiles"));
      const former = directory.find(row => row.contactId === c.id);
      assert.equal(former.recordStatus, "archived");
      assert.equal(former.canArchive, true);
      assert.equal(former.rentals.find(r => r.leaseId === lease.id).status, "former");
      assert.equal(former.rentals.find(r => r.leaseId === lease.id).role, "occupant");
      const event = (await admin.query(`SELECT "actorId",detail FROM "AuditEvent" WHERE "targetId"=$1 AND action='resident.contact.archived'`,[c.id])).rows[0];
      assert.equal(event.actorId, "offline-owner");
      assert.equal(event.detail.previousStatus, "active");
      assert.equal(event.detail.status, "archived");
      assert.equal(
        (
          await admin.query(
            `SELECT "contactId" FROM "LeaseParticipant" WHERE id=$1`,
            [p.id],
          )
        ).rows[0].contactId,
        c.id,
      );
      assert.equal(
        (
          await admin.query(`SELECT status FROM "Lease" WHERE id=$1`, [
            lease.id,
          ])
        ).rows[0].status,
        "active",
      );
    },
  );
  await t.test(
    "date-only expiry blocks preview and account setup before any provider side effect",
    async () => {
      const today = companyDay("America/New_York"),
        yesterday = new Date(today + "T00:00:00Z");
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const c = ok(
        await call("offline-owner", "POST", "/api/company/resident-contacts", {
          name: "Expiring resident",
          email: "offline-expiring@test.invalid",
          submissionKey: randomUUID(),
        }),
      );
      const p = ok(
        await call(
          "offline-owner",
          "POST",
          `/api/company/leases/${lease.id}/participants`,
          {
            contactId: c.id,
            name: c.name,
            email: c.email,
            phone: null,
            role: "occupant",
            startsOn: "2026-01-01",
            endsOn: today,
            submissionKey: randomUUID(),
          },
        ),
      );
      let pending = await invite(c.id);
      await addUser("offline-expiring", c.email);
      const before = providerCalls.length;
      // Keep versions unchanged to model the passage of a business date.
      await admin.query(
        `UPDATE "LeaseParticipant" SET "endsOn"=$1 WHERE id=$2`,
        [yesterday, p.id],
      );
      assert.equal(
        (
          await call("offline-expiring", "POST", "/api/invitations/preview", {
            token: token(pending),
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call(null, "POST", "/api/invitations/setup-account", {
            token: token(pending),
          })
        ).statusCode,
        409,
      );
      assert.equal(providerCalls.length, before);
      await admin.query(
        `UPDATE "LeaseParticipant" SET "endsOn"=NULL WHERE id=$1`,
        [p.id],
      );
      pending = await invite(c.id);
      await admin.query(`UPDATE "Lease" SET "endsOn"=$1 WHERE id=$2`, [
        yesterday,
        lease.id,
      ]);
      try {
        assert.equal(
          (
            await call("offline-expiring", "POST", "/api/invitations/preview", {
              token: token(pending),
            })
          ).statusCode,
          409,
        );
      } finally {
        await admin.query(`UPDATE "Lease" SET "endsOn"=NULL WHERE id=$1`, [
          lease.id,
        ]);
      }
    },
  );
  await t.test(
    "accepted contact replay acknowledges linkage after contact edits or approving-owner revocation without restoring access",
    async () => {
      const c = ok(await call("offline-owner", "GET", contactPath(tenant.id)));
      ok(
        await call("offline-owner", "PATCH", contactPath(tenant.id), {
          ...contactBody,
          email: "updated-correspondence@test.invalid",
          expectedVersion: c.version,
        }),
      );
      await admin.query(
        `UPDATE "User" SET status='disabled' WHERE id='offline-owner'`,
      );
      try {
        assert.equal(
          ok(
            await call("offline-login", "POST", "/api/invitations/preview", {
              token: acceptedToken,
            }),
          ).accepted,
          true,
        );
        ok(
          await call("offline-login", "POST", "/api/invitations/accept", {
            token: acceptedToken,
          }),
        );
      } finally {
        await admin.query(
          `UPDATE "User" SET status='active' WHERE id='offline-owner'`,
        );
      }
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "ResidentPropertyAssignment" WHERE "userId"='offline-login'`,
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await call(
            "offline-login",
            "GET",
            `/api/resident/rent?leaseId=${lease.id}`,
          )
        ).statusCode,
        404,
      );
      await admin.query(
        `UPDATE "User" SET email='new-verified-signin@test.invalid' WHERE id='offline-login'`,
      );
      assert.equal(
        ok(
          await call("offline-login", "POST", "/api/invitations/preview", {
            token: acceptedToken,
          }),
        ).accepted,
        true,
      );
      ok(
        await call("offline-login", "POST", "/api/invitations/accept", {
          token: acceptedToken,
        }),
      );
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='offline-login'`,
      );
      try {
        assert.equal(
          (
            await call("offline-login", "POST", "/api/invitations/accept", {
              token: acceptedToken,
            })
          ).statusCode,
          403,
        );
      } finally {
        await admin.query(
          `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='offline-login'`,
        );
      }
    },
  );
}
