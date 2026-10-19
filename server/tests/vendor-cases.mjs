import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { digest } from "../dist/sessions.js";
import { newFixturePage } from "./browser-fixture.mjs";
export async function vendorCases(t, admin, db, call, app) {
  const base = "/api/company/vendors",
    make = (name, extra = {}) => ({
      name,
      service: "Plumbing",
      contactName: "Fictional contact",
      email: "vendor@test.invalid",
      phone: "555-0100",
      notes: "Private fixture note",
      submissionKey: randomUUID(),
      ...extra,
    });
  const ok = async (...args) => {
    const r = await call(...args);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const created = await ok("manager", "POST", base, make("Fictional Plumbing")),
    id = created.vendorId,
    path = `${base}/${id}`;
  const request = await ok("manager", "POST", "/api/company/maintenance", {
    propertyId: "home",
    title: "Vendor-linked fixture",
    description: "Fictional work only",
    priority: "normal",
    submissionKey: randomUUID(),
  });
  const linkPath = `/api/company/maintenance/${request.id}/vendor`;
  const current = () => ok("manager", "GET", path),
    requestCurrent = () => ok("manager", "GET", linkPath);
  const edit = async (patch = {}) => {
    const row = await current();
    return {
      ...make(row.name),
      ...Object.fromEntries(
        ["service", "contactName", "email", "phone", "notes", "status"].map(
          (k) => [k, row[k]],
        ),
      ),
      expectedVersion: row.version,
      ...patch,
    };
  };
  const link = async (vendorId = id) => {
    const source = await requestCurrent(),
      target = vendorId
        ? await ok("manager", "GET", `${base}/${vendorId}`)
        : null;
    return {
      vendorId,
      vendorVersion: target?.version || null,
      expectedVersion: source.version,
      submissionKey: randomUUID(),
    };
  };

  await t.test(
    "vendor directory validates input, normalizes duplicate names and separates companies",
    async () => {
      assert.equal((await ok("manager", "GET", base + "?q=PLUMBING")).total, 1);
      for (const name of ["fictional plumbing", "  Fictional   Plumbing  "])
        assert.equal(
          (await call("owner", "POST", base, make(name))).statusCode,
          409,
        );
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            base,
            make("Bad email", { email: "bad\nemail@test.invalid" }),
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            base,
            make("Unknown field", { companyId: "b" }),
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (await call("manager", "GET", base + "?page=0")).statusCode,
        400,
      );
      assert.equal(
        (await call("manager", "GET", base + "?q=x&unknown=true")).statusCode,
        400,
      );
      const foreign = await ok(
        "foreign",
        "POST",
        base,
        make("Fictional Plumbing"),
      );
      assert.notEqual(foreign.vendorId, id);
      assert.equal(
        (await call("manager", "GET", `${base}/${foreign.vendorId}`))
          .statusCode,
        404,
      );
      await assert.rejects(
        admin.query(
          'UPDATE "MaintenanceRequest" SET "vendorId"=$1 WHERE id=$2',
          [foreign.vendorId, request.id],
        ),
        /foreign key/,
      );
      assert.equal(
        (
          await call("manager", "POST", linkPath, {
            ...(await link()),
            vendorId: foreign.vendorId,
          })
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "concurrent creates deduplicate retries and normalized business names",
    async () => {
      const payload = make("Concurrent retry fixture");
      const results = await Promise.all(
        Array.from({ length: 3 }, () => call("manager", "POST", base, payload)),
      );
      for (const result of results)
        assert.equal(result.statusCode, 200, result.body);
      assert.equal(
        new Set(results.map((result) => result.json().vendorId)).size,
        1,
      );
      const shared = results[0].json().vendorId;
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM "VendorAction" WHERE "vendorId"=$1',
            [shared],
          )
        ).rows[0].n,
        1,
      );
      const competing = await Promise.all([
        call("manager", "POST", base, make("Concurrent name fixture")),
        call("owner", "POST", base, make("  CONCURRENT NAME FIXTURE  ")),
      ]);
      assert.deepEqual(
        competing.map((result) => result.statusCode).sort(),
        [200, 409],
      );
    },
  );
  await t.test(
    "management-only vendor data rejects staff, residents, platform-only authority and forged scope",
    async () => {
      for (const role of ["staff", "resident", "other"])
        for (const suffix of [
          "",
          `/${id}`,
          `/${id}/history`,
          `/${id}/requests`,
        ])
          assert.equal(
            (await call(role, "GET", base + suffix)).statusCode,
            403,
          );
      for (const role of ["staff", "resident"]) {
        assert.equal(
          (await call(role, "POST", base, make("Denied"))).statusCode,
          403,
        );
        assert.equal(
          (await call(role, "POST", linkPath, await link())).statusCode,
          403,
        );
        assert.equal((await call(role, "GET", linkPath)).statusCode, 403);
      }
      assert.equal((await call("foreign", "GET", path)).statusCode, 404);
      assert.equal(
        (await call("manager", "GET", base, null, { "x-company-id": "b" }))
          .statusCode,
        403,
      );
      await admin.query(
        `UPDATE "User" SET "platformRole"='owner' WHERE id='other'`,
      );
      assert.equal((await call("other", "GET", base)).statusCode, 403);
      await admin.query(
        `UPDATE "User" SET "platformRole"=NULL WHERE id='other'`,
      );
      assert.equal(
        (
          await call("manager", "POST", base, make("No CSRF"), {
            "x-csrf-token": "wrong",
          })
        ).statusCode,
        403,
      );
    },
  );
  await t.test(
    "vendor updates use opening versions and durable exact-payload replay",
    async () => {
      const payload = await edit({ phone: "555-0101" }),
        before = (await current()).version;
      await ok("manager", "PATCH", path, payload);
      await ok("manager", "PATCH", path, payload);
      assert.equal((await current()).version, before + 1);
      assert.equal(
        (
          await call("manager", "PATCH", path, {
            ...payload,
            phone: "555-0102",
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call("owner", "PATCH", path, {
            ...payload,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      const row = await current(),
        payloadA = await edit({ notes: "First competing edit" }),
        payloadB = {
          ...payloadA,
          notes: "Second competing edit",
          submissionKey: randomUUID(),
        };
      const results = await Promise.all([
        call("manager", "PATCH", path, payloadA),
        call("owner", "PATCH", path, payloadB),
      ]);
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
      assert.equal((await current()).version, row.version + 1);
    },
  );
  await t.test(
    "link replay creates one change, cannot overwrite a newer request, and preserves previous vendor names",
    async () => {
      const payload = await link(),
        before = (await requestCurrent()).version;
      await ok("manager", "POST", linkPath, payload);
      await ok("manager", "POST", linkPath, payload);
      assert.equal((await requestCurrent()).version, before + 1);
      assert.equal(
        (
          await call("manager", "POST", linkPath, {
            ...payload,
            vendorId: null,
            vendorVersion: null,
          })
        ).statusCode,
        409,
      );
      assert.equal((await ok("manager", "GET", path + "/requests")).total, 1);
      await ok(
        "manager",
        "PATCH",
        path,
        await edit({ name: "Renamed Plumbing" }),
      );
      const history = await ok("manager", "GET", linkPath + "/history");
      assert.equal(history.items[0].snapshot.to.name, "Fictional Plumbing");
      const stale = await link();
      await admin.query(
        'UPDATE "MaintenanceRequest" SET version=version+1 WHERE id=$1',
        [request.id],
      );
      assert.equal(
        (await call("manager", "POST", linkPath, stale)).statusCode,
        409,
      );
      const staleVendor = await link();
      await ok("manager", "PATCH", path, await edit({ phone: "555-0103" }));
      assert.equal(
        (await call("manager", "POST", linkPath, staleVendor)).statusCode,
        409,
      );
    },
  );
  await t.test(
    "unchanged contact and link saves preserve versions/history and recover after later changes",
    async () => {
      const contactBefore = await current(),
        contactPayload = await edit();
      const contactAudit = (
        await admin.query(
          'SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1',
          [id],
        )
      ).rows[0].n;
      const unchangedContact = await ok(
        "manager",
        "PATCH",
        path,
        contactPayload,
      );
      assert.equal(unchangedContact.changed, false);
      assert.equal((await current()).version, contactBefore.version);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1',
            [id],
          )
        ).rows[0].n,
        contactAudit,
      );
      await ok("manager", "PATCH", path, await edit({ phone: "555-0104" }));
      const laterContact = await current();
      assert.equal(
        (await ok("manager", "PATCH", path, contactPayload)).changed,
        false,
      );
      assert.equal((await current()).version, laterContact.version);
      assert.equal((await current()).phone, "555-0104");

      const before = await requestCurrent(),
        payload = await link(),
        historyBefore = await ok("manager", "GET", linkPath + "/history");
      const audits = (
        await admin.query(
          'SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1',
          [request.id],
        )
      ).rows[0].n;
      assert.equal(
        (await ok("manager", "POST", linkPath, payload)).changed,
        false,
      );
      assert.equal((await requestCurrent()).version, before.version);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1',
            [request.id],
          )
        ).rows[0].n,
        audits,
      );
      const receipt = (
        await admin.query(
          'SELECT id FROM "VendorAction" WHERE "submissionKey"=$1',
          [payload.submissionKey],
        )
      ).rows[0].id;
      assert.equal(
        (await ok("manager", "GET", linkPath + "/history")).items.length,
        historyBefore.items.length,
      );
      assert.ok(
        !(await ok("manager", "GET", path + "/history")).items.some(
          (item) => item.id === receipt,
        ),
      );
      await ok("manager", "POST", linkPath, await link(null));
      const removed = await requestCurrent();
      assert.equal(
        (await ok("manager", "POST", linkPath, await link(null))).changed,
        false,
      );
      assert.equal((await requestCurrent()).version, removed.version);
      const recovered = await ok("manager", "POST", linkPath, payload);
      assert.equal(recovered.recovered, true);
      assert.equal(recovered.changed, false);
      assert.equal((await requestCurrent()).vendor, null);
      assert.equal((await requestCurrent()).version, removed.version);
      await ok("manager", "POST", linkPath, await link());
    },
  );
  await t.test(
    "archive retains links, excludes new choices, blocks stale choices and supports restore",
    async () => {
      const stale = await link();
      await ok("manager", "PATCH", path, await edit({ status: "archived" }));
      assert.equal((await ok("manager", "GET", base + "?q=Renamed")).total, 0);
      assert.equal(
        (await ok("manager", "GET", base + "?status=archived")).items[0].id,
        id,
      );
      assert.equal((await requestCurrent()).vendor.status, "archived");
      assert.equal(
        (await call("manager", "POST", base, make("Renamed Plumbing")))
          .statusCode,
        409,
      );
      assert.equal(
        (await call("manager", "POST", linkPath, stale)).statusCode,
        409,
      );
      await ok("manager", "POST", linkPath, await link(null));
      assert.equal((await requestCurrent()).vendor, null);
      const history = await ok("manager", "GET", path + "/history");
      assert.ok(
        history.items.some(
          (row) => row.action === "link" && row.snapshot.to === null,
        ),
      );
      await ok("manager", "PATCH", path, await edit({ status: "active" }));
      assert.equal((await current()).status, "active");
    },
  );
  await t.test(
    "vendor contacts never appear in resident or assigned-staff request projections",
    async () => {
      await ok("manager", "POST", linkPath, await link());
      for (const [userId, role] of [
        ["vendor-resident", "resident"],
        ["vendor-staff", "staff"],
      ]) {
        await admin.query(
          'INSERT INTO "User" (id,email,name,"emailVerified","updatedAt") VALUES ($1,$2,$1,true,NOW())',
          [userId, userId + "@test.invalid"],
        );
        await admin.query(
          'INSERT INTO "CompanyMembership" ("userId","companyId",role,"maintenanceExecution","staffPropertyScope","updatedAt") VALUES ($1,\'a\',$2,true,\'all\',NOW())',
          [userId, role],
        );
        await db.session.create({
          data: {
            userId,
            tokenHash: digest("token-" + userId),
            csrfToken: "csrf",
            expiresAt: new Date(Date.now() + 3600000),
            idleExpiresAt: new Date(Date.now() + 3600000),
          },
        });
      }
      await admin.query(
        `INSERT INTO "ResidentPropertyAssignment" ("companyId","propertyId","userId") VALUES ('a','home','vendor-resident')`,
      );
      const residentRequest = await ok(
        "vendor-resident",
        "POST",
        "/api/resident/maintenance",
        {
          propertyId: "home",
          title: "Resident privacy fixture",
          description: "Reported issue",
          priority: "normal",
          submissionKey: randomUUID(),
        },
      );
      const vendorRow = await current();
      await ok(
        "manager",
        "POST",
        `/api/company/maintenance/${residentRequest.id}/vendor`,
        {
          vendorId: id,
          vendorVersion: vendorRow.version,
          expectedVersion: residentRequest.version,
          submissionKey: randomUUID(),
        },
      );
      const body = JSON.stringify(
        await ok(
          "vendor-resident",
          "GET",
          `/api/resident/maintenance/${residentRequest.id}`,
        ),
      );
      for (const value of [
        "vendorId",
        "vendor@test.invalid",
        "Private fixture note",
        "Renamed Plumbing",
      ])
        assert.ok(!body.includes(value));
      await admin.query(
        `UPDATE "MaintenanceRequest" SET "assigneeId"='vendor-staff',"executionStatus"='assigned' WHERE id=$1`,
        [request.id],
      );
      const staff = JSON.stringify(
        await ok(
          "vendor-staff",
          "GET",
          `/api/company/work-orders/${request.id}`,
        ),
      );
      for (const value of [
        "vendorId",
        "vendor@test.invalid",
        "Renamed Plumbing",
      ])
        assert.ok(!staff.includes(value));
    },
  );
  await t.test(
    "history is paginated, scoped and immutable; runtime RLS protects vendor tables",
    async () => {
      const row = await current();
      for (let index = 0; index < 52; index++)
        await admin.query(
          'INSERT INTO "VendorAction" (id,"companyId","vendorId","actorId",action,snapshot,"submissionKey","submissionHash") VALUES ($1,\'a\',$2,\'manager\',\'edit\',\'{"after":{"phone":"fictional"}}\',$3,\'fixture\')',
          [`vendor-history-${index}`, id, randomUUID()],
        );
      const first = await ok("manager", "GET", path + "/history");
      assert.equal(first.items.length, 50);
      assert.ok(first.nextCursor);
      const second = await ok(
        "manager",
        "GET",
        path + `/history?cursor=${first.nextCursor}`,
      );
      assert.ok(second.items.length > 0);
      assert.ok(
        !second.items.some((row) =>
          first.items.some((item) => item.id === row.id),
        ),
      );
      const other = await ok("manager", "POST", base, make("Other contact"));
      assert.equal(
        (
          await call(
            "manager",
            "GET",
            `${base}/${other.vendorId}/history?cursor=${first.nextCursor}`,
          )
        ).statusCode,
        404,
      );
      await assert.rejects(
        admin.query("UPDATE \"VendorAction\" SET action='edit' WHERE id=$1", [
          first.items[0].id,
        ]),
        /immutable/,
      );
      const client = await admin.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE propertyflow_runtime");
        await client.query("SELECT set_config('app.company_id','b',true)");
        assert.equal(
          (await client.query('SELECT id FROM "Vendor" WHERE id=$1', [id])).rows
            .length,
          0,
        );
        assert.equal(
          (
            await client.query(
              'SELECT id FROM "VendorAction" WHERE "vendorId"=$1',
              [id],
            )
          ).rows.length,
          0,
        );
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      assert.equal(row.status, "active");
    },
  );
  await t.test(
    "vendor search and complete totals precede database pagination",
    async () => {
      for (let index = 0; index < 26; index++) {
        const name = `Page Vendor ${String(index).padStart(2, "0")}`;
        await admin.query(
          'INSERT INTO "Vendor" (id,"companyId",name,"nameKey",service,"updatedAt") VALUES ($1,\'a\',$2,$3,$4,NOW())',
          [
            `page-vendor-${index}`,
            name,
            name.toLowerCase(),
            index === 25 ? "Beyond first page" : "Fixture",
          ],
        );
      }
      const first = await ok("manager", "GET", base + "?q=Page%20Vendor");
      assert.equal(first.total, 26);
      assert.equal(first.items.length, 25);
      const second = await ok(
        "manager",
        "GET",
        base + "?q=Page%20Vendor&page=2",
      );
      assert.equal(second.items.length, 1);
      assert.equal(second.items[0].name, "Page Vendor 25");
      assert.equal(second.total, 26);
      const searched = await ok("manager", "GET", base + "?q=Beyond");
      assert.equal(searched.total, 1);
      assert.equal(searched.items[0].id, "page-vendor-25");
    },
  );
  await t.test(
    "audit failure rolls back contact and request link changes together",
    async () => {
      await admin.query(
        `CREATE FUNCTION reject_vendor_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'vendor.%' OR NEW.action='maintenance.vendor.changed' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_vendor_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_vendor_audit()`,
      );
      try {
        assert.equal(
          (await call("manager", "POST", base, make("Rollback vendor")))
            .statusCode,
          500,
        );
        assert.equal(
          (
            await admin.query(
              "SELECT id FROM \"Vendor\" WHERE name='Rollback vendor'",
            )
          ).rows.length,
          0,
        );
        const before = await requestCurrent();
        assert.equal(
          (await call("manager", "POST", linkPath, await link(null)))
            .statusCode,
          500,
        );
        assert.equal((await requestCurrent()).version, before.version);
        assert.equal((await requestCurrent()).vendor.id, id);
      } finally {
        await admin.query(
          'DROP TRIGGER reject_vendor_audit ON "AuditEvent"; DROP FUNCTION reject_vendor_audit()',
        );
      }
    },
  );
  await t.test(
    "revocation and suspended companies block even committed retries",
    async () => {
      const payload = make("Revocation fixture");
      await ok("manager", "POST", base, payload);
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`,
      );
      try {
        assert.equal(
          (await call("manager", "POST", base, payload)).statusCode,
          403,
        );
      } finally {
        await admin.query(
          `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='manager'`,
        );
      }
      await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);
      try {
        assert.equal((await call("owner", "GET", base)).statusCode, 403);
      } finally {
        await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);
      }
    },
  );
  await t.test(
    "browser creates one vendor after a committed lost response and links it through the real API",
    { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await newFixturePage(browser);
        let lose = true;
        const attempts = [];
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            url = new URL(req.url());
          if (url.pathname === "/api/telemetry")
            return route.fulfill({ json: { accepted: true } });
          const response = await app.inject({
            method: req.method(),
            url: url.pathname + url.search,
            headers: {
              ...req.headers(),
              origin: "https://app.test",
              cookie: "__Host-pf-session=token-manager",
            },
            ...(req.postData() ? { payload: req.postData() } : {}),
          });
          if (req.method() === "POST" && url.pathname === base) {
            attempts.push(req.postDataJSON());
            if (lose) {
              lose = false;
              assert.equal(response.statusCode, 200, response.body);
              return route.abort("failed");
            }
          }
          return route.fulfill({
            status: response.statusCode,
            contentType: "application/json",
            body: response.body,
          });
        });
        const origin = process.env.TEST_MAINTENANCE_BROWSER_URL;
        await page.goto(origin + "/company/vendors");
        await page
          .getByRole("button", { name: "Add vendor", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog
          .getByLabel("Vendor name", { exact: true })
          .fill("Browser fictional vendor");
        await dialog
          .getByLabel("Email (optional)", { exact: true })
          .fill("browser-vendor@test.invalid");
        await dialog
          .getByRole("button", { name: "Save vendor", exact: true })
          .click();
        await expect(dialog.getByRole("alert")).toBeVisible();
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "Close & keep recovery", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Add vendor", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "Save vendor", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Browser fictional vendor",
            exact: true,
          }),
        ).toBeVisible();
        assert.deepEqual(attempts[0], attempts[1]);
        await page.goto(origin + `/company/maintenance/${request.id}`);
        await page
          .getByRole("button", { name: "Change vendor contact", exact: true })
          .click();
        await page
          .getByRole("searchbox", {
            name: "Find an active vendor",
            exact: true,
          })
          .fill("Browser fictional");
        const beforeSearch = await requestCurrent();
        await page
          .getByRole("searchbox", {
            name: "Find an active vendor",
            exact: true,
          })
          .press("Enter");
        await expect(
          page.getByRole("dialog", {
            name: "Choose vendor contact",
            exact: true,
          }),
        ).toBeVisible();
        assert.equal((await requestCurrent()).version, beforeSearch.version);
        await page
          .getByRole("button", {
            name: "Use Browser fictional vendor",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Save vendor link", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Vendor contact", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", {
            name: "Browser fictional vendor",
            exact: true,
          }),
        ).toBeVisible();
        await page.setViewportSize({ width: 390, height: 844 });
        const dismiss = page.getByRole("button", {
          name: "Dismiss confirmation",
          exact: true,
        });
        if (await dismiss.isVisible()) await dismiss.click();
        await page
          .locator("section")
          .filter({
            has: page.getByRole("heading", {
              name: "Vendor contact",
              exact: true,
            }),
          })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: "/tmp/pf-vendor-contact-mobile.png" });
        assert.ok(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
        );
        assert.equal(
          (
            await admin.query(
              "SELECT count(*)::int n FROM \"Vendor\" WHERE name='Browser fictional vendor'",
            )
          ).rows[0].n,
          1,
        );
      } finally {
        await browser.close();
      }
    },
  );
}
