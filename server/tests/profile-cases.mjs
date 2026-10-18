import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { digest } from "../dist/sessions.js";
import { companyDay } from "../dist/reports.js";
export async function profileCases(t, admin, call, app, db) {
  const ok = (r) => {
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    },
    user = "profile-resident";
  await admin.query(
    `INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,'personal@test.invalid','Original display name',true,NOW());`,
    [user],
  );
  await admin.query(
    `INSERT INTO "Session"("tokenHash","csrfToken","userId","expiresAt","idleExpiresAt") VALUES($1,'csrf',$2,NOW()+interval '1 hour',NOW()+interval '1 hour')`,
    [digest("token-" + user), user],
  );
  await admin.query(
    `INSERT INTO "CompanyMembership"("userId","companyId",role,"contactName","managementNotes","updatedAt") VALUES($1,'a','resident','Recorded legal tenant name','PRIVATE MANAGEMENT NOTE',NOW())`,
    [user],
  );
  await admin.query(
    `INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home',$1)`,
    [user],
  );
  const contact = ok(
    await call("owner", "POST", "/api/company/resident-contacts", {
      name: "Recorded legal tenant name",
      email: "personal@test.invalid",
      phone: "555-0100",
      managementNotes: "PRIVATE MANAGEMENT NOTE",
      submissionKey: randomUUID(),
    }),
  );
  await admin.query(`UPDATE "ResidentContact" SET "userId"=$1 WHERE id=$2`, [
    user,
    contact.id,
  ]);
  await admin.query(`UPDATE "ResidentContact" SET email='contact@test.invalid' WHERE id=$1`,[contact.id]);
  const unit = ok(
      await call("owner", "POST", "/api/company/properties/home/units", {
        label: "Profile home",
        submissionKey: randomUUID(),
      }),
    ),
    month = companyDay("America/New_York").slice(0, 7) + "-01";
  const lease = ok(
    await call("owner", "POST", "/api/company/leases", {
      propertyId: "home",
      unitId: unit.id,
      residentId: user,
      startsOn: month,
      endsOn: null,
      monthlyRent: "1000.00",
      status: "active",
      submissionKey: randomUUID(),
    }),
  );
  const read = async () => ok(await call(user, "GET", "/api/account"));
  const body = async (patch = {}) => {
    const d = await read();
    return {
      name: d.name,
      ...d.details,
      expectedVersion: d.version,
      expectedNameVersion: d.nameVersion,
      expectedContactVersion: d.contactVersion,
      expectedCompanyId: d.companyId,
      submissionKey: randomUUID(),
      ...patch,
    };
  };
  let savedBody;
  await t.test(
    "personal view includes safe contact details and read-only current home without private management data",
    async () => {
      const d = await read();
      assert.equal(d.version, 0);
      assert.equal(d.details.phone, "555-0100");
      assert.equal(d.sharedWithManagement, true);
      assert.equal(d.assignments[0].unit.label, "Profile home");
      assert.equal(d.contactEmail, "contact@test.invalid");
      assert.ok(!JSON.stringify(d).includes("PRIVATE MANAGEMENT NOTE"));
      assert.equal(d.details.unitId, undefined);
    },
  );
  await t.test(
    "resident cannot change unit, lease, company, access, tenant legal name, contact email or internal notes",
    async () => {
      const b = await body();
      for (const patch of [
        { unitId: unit.id },
        { propertyId: "other-home" },
        { leaseId: lease.id },
        { role: "owner" },
        { companyId: "b" },
        { status: "active" },
        { userId: "owner" },
        { residentId: "owner" },
        { managementNotes: "Hacked" },
        { contactName: "Hacked" },
        { email: "hacked@test.invalid" },
        { contactEmail: "hacked@test.invalid" },
        { portalApproved: true },
      ])
        assert.equal(
          (await call(user, "PATCH", "/api/account", { ...b, ...patch }))
            .statusCode,
          400,
          JSON.stringify(patch),
        );
      assert.equal(
        (
          await admin.query(`SELECT "unitId" FROM "Lease" WHERE id=$1`, [
            lease.id,
          ])
        ).rows[0].unitId,
        unit.id,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT role FROM "CompanyMembership" WHERE "userId"=$1`,
            [user],
          )
        ).rows[0].role,
        "resident",
      );
      assert.equal((await read()).version, 0);
    },
  );
  await t.test(
    "personal save syncs only safe linked contact fields, retains immutable versions and replays once",
    async () => {
      savedBody = await body({
        name: "Personal display name",
        preferredName: "Alex",
        phone: "555-0200",
        alternatePhone: "555-0300",
        addressLine1: "12 Mailing Lane",
        addressLine2: "Suite 4",
        city: "Philadelphia",
        region: "PA",
        postalCode: "19103",
        country: "US",
        preferredContact: "phone",
        emergencyContactName: "Sam",
        emergencyContactPhone: "555-0400",
        emergencyRelationship: "Sibling",
      });
      const replies = await Promise.all([
        call(user, "PATCH", "/api/account", savedBody),
        call(user, "PATCH", "/api/account", savedBody),
      ]);
      for (const r of replies) assert.equal(ok(r).version, 1);
      const d = await read();
      assert.equal(d.details.phone, "555-0200");
      assert.equal(d.name, "Personal display name");
      assert.equal(d.assignments[0].unit.label, "Profile home");
      const c = (
        await admin.query(
          `SELECT name,email,phone,"addressLine1","managementNotes" FROM "ResidentContact" WHERE id=$1`,
          [contact.id],
        )
      ).rows[0];
      assert.equal(c.name, "Recorded legal tenant name");
      assert.equal(c.email, "contact@test.invalid");
      assert.equal(c.managementNotes, "PRIVATE MANAGEMENT NOTE");
      assert.equal(c.phone, "555-0200");
      assert.equal(c.addressLine1, "12 Mailing Lane");
      const h = (
        await admin.query(
          `SELECT version,details FROM "AccountProfileRevision" WHERE "userId"=$1`,
          [user],
        )
      ).rows;
      assert.equal(h.length, 1);
      assert.equal(h[0].details.name, "Personal display name");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "AuditEvent" WHERE "actorId"=$1 AND action='profile.updated'`,
            [user],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await call(user, "PATCH", "/api/account", {
            ...savedBody,
            phone: "other",
          })
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "stale contact, company and profile versions cannot overwrite newer edits; preference validation is enforced",
    async () => {
      const stale = await body({ phone: "Do not overwrite" });
      await admin.query(
        `UPDATE "ResidentContact" SET phone='Manager updated phone',version=version+1 WHERE id=$1`,
        [contact.id],
      );
      assert.equal(
        (await call(user, "PATCH", "/api/account", stale)).statusCode,
        409,
      );
      assert.equal((await read()).details.phone, "Manager updated phone");
      for (const patch of [
        { expectedVersion: 0 },
        { expectedCompanyId: "b" },
        { expectedNameVersion: "old" },
        { preferredContact: "phone", phone: null },
        { emergencyContactName: null, emergencyContactPhone: "555-5555" },
      ])
        assert.ok(
          [400, 409].includes(
            (await call(user, "PATCH", "/api/account", await body(patch)))
              .statusCode,
          ),
        );
      assert.equal(
        (await call(user, "PATCH", "/api/account", savedBody)).statusCode,
        200,
        "saved replay does not overwrite subsequent owner changes",
      );
      assert.equal((await read()).details.phone, "Manager updated phone");
    },
  );
  await t.test(
    "profile self RLS and immutable revisions are enforced; removed residents lose home context",
    async () => {
      assert.deepEqual(await db.accountProfile.findMany(), []);
      assert.deepEqual(await db.accountProfileRevision.findMany(), []);
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id','owner',true)`;
        assert.deepEqual(await tx.accountProfile.findMany(), []);
      });
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.user_id',${user},true)`;
          return tx.accountProfileRevision.updateMany({
            where: { userId: user },
            data: { details: { phone: "tamper" } },
          });
        }),
        /permission denied/i,
      );
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.user_id',${user},true)`;
          return tx.accountProfile.update({
            where: { userId: user },
            data: { version: 2, details: {} },
          });
        }),
        /requires immutable revision/i,
      );
      await admin.query(
        `UPDATE "LeaseParticipant" SET "removedAt"=NOW() WHERE "leaseId"=$1 AND "userId"=$2`,
        [lease.id, user],
      );
      assert.equal((await read()).assignments.length, 0);
      await admin.query(
        `UPDATE "LeaseParticipant" SET "removedAt"=NULL WHERE "leaseId"=$1 AND "userId"=$2`,
        [lease.id, user],
      );
      await admin.query(`UPDATE "User" SET "emailVerified"=false WHERE id=$1`, [
        user,
      ]);
      const d = await read();
      assert.equal(d.sharedWithManagement, false);
      assert.equal(d.assignments.length, 0);
      assert.ok(!JSON.stringify(d).includes("PRIVATE MANAGEMENT NOTE"));
      await admin.query(`UPDATE "User" SET "emailVerified"=true WHERE id=$1`, [
        user,
      ]);
    },
  );
  await t.test(
    "personal audit failure rolls back display name, profile revision and management contact together",
    async () => {
      const b = await body({ phone: "rollback-phone" }),
        before = await read();
      await admin.query(
        `CREATE FUNCTION reject_profile_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='profile.updated' THEN RAISE EXCEPTION 'Audit offline'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_profile_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_profile_audit()`,
      );
      try {
        assert.ok(
          (await call(user, "PATCH", "/api/account", b)).statusCode >= 500,
        );
        assert.deepEqual(await read(), before);
      } finally {
        await admin.query(
          `DROP TRIGGER reject_profile_audit ON "AuditEvent";DROP FUNCTION reject_profile_audit()`,
        );
      }
    },
  );
  await t.test(
    "company owners maintain robust details with versions, durable replay and attributed history; administrative fields remain protected",
    async () => {
      const guide = ok(await call("owner", "GET", "/api/company/roles"));
      assert.equal(guide.roles[0].label, "Company owner");
      assert.equal(
        (await call("manager", "GET", "/api/company/roles")).statusCode,
        403,
      );
      assert.equal(
        (
          await call("owner", "GET", "/api/company/roles", null, {
            "x-company-id": "b",
          })
        ).statusCode,
        403,
      );
      const current = ok(await call("owner", "GET", "/api/company"));
      await admin.query(
        `UPDATE "Company" SET "adminNotes"='PRIVATE PLATFORM NOTE' WHERE id='a'`,
      );
      const b = {
        name: current.name,
        legalName: "Oak and Elm LLC",
        contactName: "Office Manager",
        contactEmail: "OFFICE@test.invalid",
        contactPhone: "555-1000",
        website: "https://example.invalid",
        addressLine1: "100 Business Road",
        addressLine2: "Suite 2",
        city: "Philadelphia",
        region: "PA",
        postalCode: "19103",
        country: "us",
        timezone: "America/New_York",
        expectedVersion: current.version,
        submissionKey: randomUUID(),
      };
      for (const role of ["manager", "staff", "resident", "platform"]) {
        assert.equal((await call(role, "GET", "/api/company")).statusCode, 403);
        assert.equal(
          (await call(role, "PATCH", "/api/company", b)).statusCode,
          403,
        );
        assert.equal(
          (await call(role, "GET", "/api/company/profile-history")).statusCode,
          403,
        );
      }
      for (const patch of [
        { adminNotes: "Overwrite" },
        { domain: "hijack.invalid" },
        { status: "suspended" },
        { companyId: "b" },
        { contactEmail: "invalid" },
        { website: "javascript:alert(1)" },
        { country: "United States" },
        { timezone: "Bad/Timezone" },
      ])
        assert.equal(
          (await call("owner", "PATCH", "/api/company", { ...b, ...patch }))
            .statusCode,
          400,
        );
      const replies = await Promise.all([
        call("owner", "PATCH", "/api/company", b),
        call("owner", "PATCH", "/api/company", b),
      ]);
      for (const r of replies) assert.equal(ok(r).version, current.version + 1);
      const c = ok(await call("owner", "GET", "/api/company"));
      assert.equal(c.country, "US");
      assert.equal(c.contactEmail, "office@test.invalid");
      assert.equal(c.adminNotes, undefined);
      const h = ok(await call("owner", "GET", "/api/company/profile-history"));
      assert.equal(h.items.length, 1);
      assert.equal(h.items[0].before.version, current.version);
      assert.equal(h.items[0].after.addressLine1, "100 Business Road");
      assert.ok(!JSON.stringify(h).includes("PRIVATE PLATFORM NOTE"));
      assert.equal(
        ok(await call("foreign", "GET", "/api/company/profile-history")).items
          .length,
        0,
      );
      assert.equal(
        (
          await call("owner", "PATCH", "/api/company", {
            ...b,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call("owner", "PATCH", "/api/company", {
            ...b,
            legalName: "Different",
          })
        ).statusCode,
        409,
      );
      assert.deepEqual(await db.companyProfileRevision.findMany(), []);
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return tx.companyProfileRevision.deleteMany();
        }),
        /permission denied/i,
      );
    },
  );
  await t.test(
    "real browser saves focused personal and company forms, retains retries and hides resident assignment controls",
    { skip: !process.env.TEST_FINANCES_BROWSER_URL },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        let actor = user,
          lose = true;
        const keys = [];
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            u = new URL(req.url()),
            res = await app.inject({
              method: req.method(),
              url: u.pathname + u.search,
              headers: {
                ...req.headers(),
                origin: "https://app.test",
                cookie: `__Host-pf-session=token-${actor}`,
              },
              ...(req.postData() ? { payload: req.postData() } : {}),
            });
          if (req.method() === "PATCH" && u.pathname === "/api/account") {
            keys.push(req.postDataJSON().submissionKey);
            assert.equal(res.statusCode, 200, res.body);
            if (lose) {
              lose = false;
              return route.abort("failed");
            }
          }
          return route.fulfill({
            status: res.statusCode,
            contentType: "application/json",
            body: res.body,
          });
        });
        await page.goto(process.env.TEST_FINANCES_BROWSER_URL + "/account");
        await page
          .getByRole("button", { name: "Home & access", exact: true })
          .click();
        await expect(
          page.getByText("home · Profile home", { exact: true }),
        ).toBeVisible();
        assert.equal(
          await page
            .locator('input[name="unitId"],select[name="unitId"]')
            .count(),
          0,
        );
        await expect(
          page.getByRole("button", { name: /Edit .*details/ }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Contact", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Edit contact details", exact: true })
          .click();
        await expect(
          page.getByLabel("Display name", { exact: true }),
        ).not.toBeVisible();
        await page
          .getByLabel("Primary phone", { exact: true })
          .fill("555-7777");
        await page
          .getByRole("button", { name: "Review profile changes", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Save my profile", exact: true })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await page.reload();
        await page
          .getByRole("button", { name: "Resume profile review", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Save my profile", exact: true })
          .click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        assert.equal(keys[0], keys[1]);
        assert.equal((await read()).details.phone, "555-7777");
        actor = "owner";
        await page.goto(
          process.env.TEST_FINANCES_BROWSER_URL + "/company/settings",
        );
        await page
          .getByRole("button", { name: "Contacts", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Edit contacts", exact: true })
          .click();
        await page
          .getByLabel("Business phone", { exact: true })
          .fill("555-8888");
        await expect(
          page.getByLabel("Company name", { exact: true }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Review company details", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Save company details", exact: true })
          .click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        assert.equal(
          ok(await call("owner", "GET", "/api/company")).contactPhone,
          "555-8888",
        );
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page
          .getByRole("button", { name: "Address", exact: true })
          .click();
        await page.screenshot({
          path: "/tmp/propertyflow-company-profile-mobile.png",
          fullPage: false,
        });
      } finally {
        await browser.close();
      }
    },
  );
}
