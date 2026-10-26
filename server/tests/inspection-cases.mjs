import {historicalDocument} from './historical-document-fixture.mjs';
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { newFixturePage } from "./browser-fixture.mjs";

export async function inspectionCases(t, admin, db, call, app) {
  await admin.query(
    `INSERT INTO "Lease" (id,"companyId","propertyId","unitId","createdById","residentId","startsOn","rentCents",status,"submissionKey","submissionHash","updatedAt") VALUES ('inspection-lease','a','home','unit-a','owner','other','2026-10-01',100000,'active','inspection-lease','fixture',NOW())`,
  );
  const base = "/api/company/leases/inspection-lease/inspections",
    docs = "/api/company/leases/inspection-lease/documents";
  const ok = async (...args) => {
    const r = await call(...args);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const item = (patch = {}) => ({
    key: randomUUID(),
    area: "Kitchen",
    item: "Countertop",
    condition: "good",
    notes: "Fictional observed condition",
    evidenceVersionIds: [],
    ...patch,
  });
  const make = (patch = {}) => ({
    kind: "move_in",
    inspectedOn: "2026-10-01",
    items: [item()],
    baselineRevisionId: null,
    submissionKey: randomUUID(),
    ...patch,
  });
  const detail = (id) => ok("manager", "GET", `${base}/${id}`);
  const action = async (id, name, extra = {}) =>
    ok("manager", "POST", `${base}/${id}`, {
      action: name,
      expectedVersion: (await detail(id)).inspection.version,
      submissionKey: randomUUID(),
      ...(name === "complete" || name === "reopen"
        ? { reason: "Fictional reviewed condition" }
        : {}),
      ...extra,
    });
  const financial = async () =>
    (
      await admin.query(
        `SELECT (SELECT count(*) FROM "RentCharge")::int charges,(SELECT count(*) FROM "LedgerEntry")::int ledger,(SELECT count(*) FROM "LeaseMovement")::int movements`,
      )
    ).rows[0];
  const beforeMoney = await financial();
  const upload = await ok("manager", "POST", docs, {
    title: "Inspection original",
    filename: "condition.txt",
    mediaType: "text/plain",
    contentBase64: Buffer.from("Fictional condition evidence").toString(
      "base64",
    ),
    submissionKey: randomUUID(),
  });
  const rejected = await historicalDocument(admin,{sourceId:'inspection-lease',lease:true,status:'rejected'});
  let moveIn, moveOut, baselineId;
  await t.test(
    "inspection sources, roles, CSRF, fields and rejected evidence are enforced",
    async () => {
      for (const role of ["staff", "resident", "other"]) {
        assert.equal((await call(role, "GET", base)).statusCode, 403);
        assert.equal((await call(role, "POST", base, make())).statusCode, 403);
      }
      assert.equal((await call("foreign", "GET", base)).statusCode, 404);
      await admin.query(
        `UPDATE "User" SET "platformRole"='owner' WHERE id='other'`,
      );
      try {
        assert.equal((await call("other", "GET", base)).statusCode, 403);
      } finally {
        await admin.query(
          `UPDATE "User" SET "platformRole"=NULL WHERE id='other'`,
        );
      }
      assert.equal(
        (await call("manager", "GET", base, undefined, { "x-company-id": "b" }))
          .statusCode,
        403,
      );
      assert.equal(
        (await call("manager", "POST", base, make(), { "x-csrf-token": "bad" }))
          .statusCode,
        403,
      );
      assert.equal(
        (await call("manager", "POST", base, { ...make(), amountCents: 100 }))
          .statusCode,
        400,
      );
      for (const items of [
        [],
        [item(), item()],
        [item({ condition: "excellent" })],
        [item({ evidenceVersionIds: [rejected.versionId] })],
      ])
        assert.equal(
          (await call("manager", "POST", base, make({ items }))).statusCode,
          400,
        );
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            base,
            make({ inspectedOn: "2026-02-30" }),
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (await call("manager", "GET", base + "?unknown=true")).statusCode,
        400,
      );
      const wrongSource = await ok(
        "manager",
        "POST",
        "/api/company/leases/document-lease/documents",
        {
          title: "Other source",
          filename: "other.txt",
          mediaType: "text/plain",
          contentBase64: Buffer.from("Other source").toString("base64"),
          submissionKey: randomUUID(),
        },
      );
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            base,
            make({
              items: [item({ evidenceVersionIds: [wrongSource.versionId] })],
            }),
          )
        ).statusCode,
        400,
      );
    },
  );
  await t.test(
    "inspection creation recovers concurrent/lost responses once and rejects changed replay",
    async () => {
      const payload = make({
        items: [item({ evidenceVersionIds: [upload.versionId] })],
      });
      const responses = await Promise.all(
        Array.from({ length: 3 }, () => call("manager", "POST", base, payload)),
      );
      for (const r of responses) assert.equal(r.statusCode, 200, r.body);
      assert.equal(
        new Set(responses.map((r) => r.json().inspectionId)).size,
        1,
      );
      moveIn = responses[0].json().inspectionId;
      assert.equal(
        (
          await ok("manager", "POST", base, {
            ...payload,
            submissionKey: payload.submissionKey.toUpperCase(),
          })
        ).inspectionId,
        moveIn,
      );
      assert.equal(
        (
          await call("manager", "POST", base, {
            ...payload,
            inspectedOn: "2026-10-02",
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "AuditEvent" WHERE action='inspection.create' AND "targetId"=$1`,
            [moveIn],
          )
        ).rows[0].n,
        1,
      );
      for (const suffix of ["", `/${moveIn}`])
        assert.equal(
          (await call("foreign", "GET", base + suffix)).statusCode,
          404,
        );
      assert.equal(
        (
          await call(
            "manager",
            "GET",
            `/api/company/leases/document-lease/inspections/${moveIn}`,
          )
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "save, submit, completion review, stale edits and exact evidence retention",
    async () => {
      const initial = (await detail(moveIn)).inspection;
      await action(moveIn, "submit");
      assert.equal(
        (
          await call("manager", "POST", `${base}/${moveIn}`, {
            action: "complete",
            expectedVersion: 2,
            reason: "",
            submissionKey: randomUUID(),
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await call("manager", "POST", `${base}/${moveIn}`, {
            action: "edit",
            expectedVersion: 1,
            inspectedOn: "2026-10-01",
            items: initial.items,
            baselineRevisionId: null,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      const payload = {
        action: "complete",
        reason: "Reviewed original evidence",
        expectedVersion: 2,
        submissionKey: randomUUID(),
      };
      await ok("manager", "POST", `${base}/${moveIn}`, payload);
      await ok("manager", "POST", `${base}/${moveIn}`, payload);
      let d = await detail(moveIn);
      assert.equal(d.inspection.status, "completed");
      assert.equal(d.revisions.length, 3);
      baselineId = d.revisions[0].id;
      assert.equal(d.originals[0].id, upload.versionId);
      assert.ok(!Object.hasOwn(d.originals[0], "content"));
      assert.ok(!Object.hasOwn(d.revisions[0], "submissionKey"));
      assert.equal(
        (
          await call("manager", "POST", `${base}/${moveIn}`, {
            action: "submit",
            expectedVersion: 3,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      const newOriginal = await ok("manager", "POST", docs, {
        title: "Inspection original",
        filename: "later.txt",
        mediaType: "text/plain",
        contentBase64: Buffer.from("Later pending evidence").toString("base64"),
        documentId: upload.documentId,
        expectedVersion: 1,
        submissionKey: randomUUID(),
      });
      await ok("manager", "PATCH", `${docs}/${upload.documentId}`, {
        archived: true,
        expectedVersion: 2,
      });
      d = await detail(moveIn);
      assert.equal(d.originals[0].id, upload.versionId);
      assert.equal(d.originals[0].number, 1);
      assert.notEqual(d.originals[0].id, newOriginal.versionId);
      assert.ok(d.originals[0].document.archivedAt);
    },
  );
  await t.test(
    "review blocks unchecked items and undescribed damage, and validates baseline sources",
    async () => {
      const row = await ok(
        "manager",
        "POST",
        base,
        make({ items: [item({ condition: "not_checked" })] }),
      );
      assert.equal(
        (
          await call("manager", "POST", `${base}/${row.inspectionId}`, {
            action: "submit",
            expectedVersion: 1,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        400,
      );
      await action(row.inspectionId, "edit", {
        inspectedOn: "2026-10-03",
        items: [item({ condition: "damaged", notes: "" })],
        baselineRevisionId: null,
      });
      assert.equal(
        (
          await call("manager", "POST", `${base}/${row.inspectionId}`, {
            action: "submit",
            expectedVersion: 2,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        400,
      );
      for (const change of [
        { baselineRevisionId: baselineId },
        {
          kind: "move_out",
          baselineRevisionId: baselineId,
          inspectedOn: "2026-09-01",
        },
        { kind: "move_out", baselineRevisionId: "missing" },
      ])
        assert.equal(
          (await call("manager", "POST", base, make(change))).statusCode,
          400,
        );
      assert.equal(
        (
          await call("manager", "POST", `${base}/${row.inspectionId}`, {
            action: "submit",
            expectedVersion: 2,
            items: [item()],
            submissionKey: randomUUID(),
          })
        ).statusCode,
        400,
      );
    },
  );
  await t.test(
    "move-out comparison retains its reviewed move-in version after corrections",
    async () => {
      moveOut = (
        await ok(
          "manager",
          "POST",
          base,
          make({
            kind: "move_out",
            inspectedOn: "2026-10-19",
            baselineRevisionId: baselineId,
            items: [
              item({
                condition: "damaged",
                notes: "Fictional chip observed",
                evidenceVersionIds: [upload.versionId],
              }),
              item({ area: "Bedroom", item: "Window", condition: "fair" }),
            ],
          }),
        )
      ).inspectionId;
      await action(moveOut, "submit");
      await action(moveOut, "complete");
      await action(moveIn, "reopen", {
        reason: "Correct move-in observation, original retained",
      });
      const current = (await detail(moveIn)).inspection;
      await action(moveIn, "edit", {
        inspectedOn: current.inspectedOn.slice(0, 10),
        items: current.items.map((i) => ({ ...i, condition: "fair" })),
        baselineRevisionId: null,
      });
      await action(moveIn, "submit");
      await action(moveIn, "complete");
      const d = await detail(moveOut);
      assert.equal(d.baseline.id, baselineId);
      assert.equal(d.baseline.version, 3);
      assert.equal(d.comparison[0].before.condition, "good");
      assert.equal(d.comparison[0].after.condition, "damaged");
      assert.equal(d.comparison[1].before, null);
      assert.deepEqual(await financial(), beforeMoney);
      assert.ok(
        (await ok("manager", "GET", base)).baselines.some(
          (b) => b.inspectionId === moveIn && b.version === 7,
        ),
      );
    },
  );
  await t.test(
    "inspection history, evidence foreign keys and runtime company RLS preserve originals",
    async () => {
      const row = (await detail(moveIn)).revisions[0];
      await assert.rejects(
        admin.query(
          "UPDATE \"InspectionRevision\" SET reason='changed' WHERE id=$1",
          [row.id],
        ),
        /immutable/,
      );
      await assert.rejects(
        admin.query('DELETE FROM "InspectionEvidence" WHERE "revisionId"=$1', [
          row.id,
        ]),
        /immutable/,
      );
      await assert.rejects(
        admin.query(
          'INSERT INTO "InspectionEvidence" ("revisionId","companyId","itemKey","versionId") VALUES ($1,\'b\',\'cross-company\',$2)',
          [row.id, upload.versionId],
        ),
        /foreign key/,
      );
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.company_id','b',true)`;
        assert.equal(
          await tx.leaseInspection.count({ where: { id: moveIn } }),
          0,
        );
        assert.equal(
          await tx.inspectionRevision.count({
            where: { inspectionId: moveIn },
          }),
          0,
        );
        assert.equal(
          await tx.inspectionEvidence.count({
            where: { versionId: upload.versionId },
          }),
          0,
        );
      });
    },
  );
  await t.test(
    "audit failure rolls back inspection changes and preserves its retry receipt",
    async () => {
      const prior = (await detail(moveOut)).inspection;
      await admin.query(
        `CREATE FUNCTION reject_inspection_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'inspection.%' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_inspection_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_inspection_audit()`,
      );
      const payload = {
        action: "reopen",
        expectedVersion: prior.version,
        reason: "Fictional correction",
        submissionKey: randomUUID(),
      };
      try {
        assert.equal(
          (await call("manager", "POST", `${base}/${moveOut}`, payload))
            .statusCode,
          500,
        );
        assert.equal((await detail(moveOut)).inspection.version, prior.version);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM "InspectionRevision" WHERE "submissionKey"=$1',
              [payload.submissionKey],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await admin.query(
          'DROP TRIGGER reject_inspection_audit ON "AuditEvent"; DROP FUNCTION reject_inspection_audit()',
        );
      }
      await ok("manager", "POST", `${base}/${moveOut}`, payload);
      assert.equal((await detail(moveOut)).inspection.status, "in_progress");
    },
  );
  await t.test(
    "complete history pages, fresh revocation and suspended company checks",
    async () => {
      for (let i = 0; i < 26; i++)
        await action(moveOut, "edit", {
          inspectedOn: "2026-10-19",
          items: [item({ notes: `Fictional revision ${i}` })],
          baselineRevisionId: baselineId,
        });
      const d = await detail(moveOut),
        older = await ok(
          "manager",
          "GET",
          `${base}/${moveOut}?beforeVersion=${d.nextBeforeVersion}`,
        );
      assert.equal(d.revisions.length, 25);
      assert.ok(older.revisions.length > 0);
      assert.equal(
        new Set([...d.revisions, ...older.revisions].map((r) => r.version))
          .size,
        30,
      );
      assert.equal(older.nextBeforeVersion, null);
      const replay = make();
      await ok("manager", "POST", base, replay);
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`,
      );
      try {
        assert.equal(
          (await call("manager", "POST", base, replay)).statusCode,
          403,
        );
        assert.equal(
          (await call("manager", "GET", `${base}/${moveIn}`)).statusCode,
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
    "real browser inspection saves recover a committed response loss and complete reviewed comparison",
    { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL },
    async () => {
      const lease = await ok("manager", "GET", "/api/company/leases/inspection-lease");
      assert.equal(lease.id, "inspection-lease");
      const bootstrap = await ok("manager", "GET", "/api/bootstrap");
      assert.equal(bootstrap.membership.companyId, "a");
      assert.ok(bootstrap.permissions.includes("lease.manage"));
      assert.equal(bootstrap.companyFeatures.leasing, "enabled");
      assert.equal(bootstrap.companyFeatures.inspections, "enabled");
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await newFixturePage(browser);
        let lose = true;
        let revokedBootstrapGate;
        const keys = [], openingReads = [], pageErrors = [];
        page.on("pageerror", error => pageErrors.push(error.message));
        await page.context().route("**/api/**", async (route) => {
          const req = route.request(),
            u = new URL(req.url());
          const response = await app.inject({
            method: req.method(),
            url: u.pathname + u.search,
            headers: {
              ...req.headers(),
              origin: "https://app.test",
              cookie: "__Host-pf-session=token-manager",
            },
            ...(req.postData() ? { payload: req.postData() } : {}),
          });
          if (req.method() === "GET" && ["/api/bootstrap", "/api/company/leases/inspection-lease", base].includes(u.pathname)) {
            const body = response.json();
            openingReads.push({ path: u.pathname, status: response.statusCode, code: body.code, error: body.error });
          }
          if (req.method() === "POST" && u.pathname === base) {
            keys.push(req.postDataJSON().submissionKey);
            assert.equal(response.statusCode, 200, response.body);
            if (lose) {
              lose = false;
              return route.abort("failed");
            }
          }
          if (req.method() === "GET" && u.pathname === "/api/bootstrap" && revokedBootstrapGate)
            await revokedBootstrapGate;
          await route.fulfill({
            status: response.statusCode,
            contentType: "application/json",
            body: response.body,
          });
        });
        await page.goto(
          process.env.TEST_MAINTENANCE_BROWSER_URL +
            "/company/leases/inspection-lease?section=inspections",
        );
        try {
          await page
            .getByRole("button", { name: "Record inspection", exact: true })
            .click();
        } catch (error) {
          console.error("Inspection first-view diagnostics:", JSON.stringify({
            url: page.url(), openingReads, pageErrors,
            main: await page.locator("main").innerText().catch(() => "Main content unavailable"),
          }));
          throw error;
        }
        await page
          .getByRole("button", { name: "Add condition item", exact: true })
          .click();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await expect(
          page.getByRole("alertdialog", {
            name: "Close without saving changes?",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Save draft & close", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Resume inspection draft", exact: true })
          .click();
        await expect(page.getByLabel("Area 2", { exact: true })).toBeVisible();
        await page
          .getByRole("button", { name: "Remove condition item 2", exact: true })
          .click();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page
          .getByRole("button", { name: "Close without saving", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Record inspection", exact: true })
          .click();
        await page
          .getByLabel("Inspection type", { exact: true })
          .selectOption("move_out");
        await page
          .getByLabel("Inspection date", { exact: true })
          .fill("2026-10-19");
        await page
          .getByLabel("Reviewed move-in baseline")
          .selectOption(
            (await ok("manager", "GET", base)).baselines.find(
              (b) => b.inspectionId === moveIn,
            ).id,
          );
        await page.getByLabel("Area 1", { exact: true }).fill("Kitchen");
        await page.getByLabel("Item 1", { exact: true }).fill("Countertop");
        await page
          .getByLabel("Condition 1", { exact: true })
          .selectOption("damaged");
        await page
          .getByLabel("Observation notes 1", { exact: true })
          .fill("Fictional browser chip");
        await page
          .getByText("Link exact evidence versions", { exact: true })
          .click();
        await page
          .getByRole("checkbox", { name: /Inspection original · version 1/ })
          .check();
        await page
          .getByRole("button", { name: "Save observations", exact: true })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(page.getByLabel("Area 1", { exact: true })).toBeDisabled();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page
          .getByRole("button", { name: "Close & keep recovery", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Resume inspection draft", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Save observations", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Move-in comparison",
            exact: true,
          }),
        ).toBeVisible();
        assert.equal(keys.length, 2);
        assert.equal(keys[0], keys[1]);
        await page
          .getByRole("button", { name: "Submit for review", exact: true })
          .click();
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "Submit saved inspection", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Review completion", exact: true })
          .click();
        await page
          .getByLabel("Completion review note")
          .fill("Fictional management review");
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", {
            name: "Complete reviewed inspection",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("link", {
            name: "Review move-out settlement →",
            exact: true,
          }),
        ).toBeVisible();
        const popupPromise = page.waitForEvent("popup");
        await page
          .getByRole("link", { name: /Inspection original · version 1/ })
          .first()
          .click();
        const original = await popupPromise;
        await expect(
          original.getByRole("heading", {
            name: "Inspection original · Archived",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          original.getByRole("button", {
            name: "Download version 1",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          original.getByRole("button", {
            name: "Download version 2",
            exact: true,
          }),
        ).toBeVisible();
        await original.close();
        await page.screenshot({
          path: "/tmp/pf-inspections-desktop.png",
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: "/tmp/pf-inspections-mobile.png",
          fullPage: true,
        });
        await page
          .getByRole("link", {
            name: "Review move-out settlement →",
            exact: true,
          })
          .click();
        await expect(page).toHaveURL(/section=settlement/);
        await expect(
          page.getByRole("link", {
            name: "Return to the source inspection →",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByLabel("Lease section", { exact: true })
          .selectOption("inspections");
        await expect(
          page.getByRole("heading", {
            name: "Move-in comparison",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Reopen inspection", exact: true })
          .click();
        await page
          .getByLabel("Reason for reopening")
          .fill("Recheck fictional condition");
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "Reopen with reason", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Edit observations", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Edit observations", exact: true })
          .click();
        await page
          .getByLabel("Observation notes 1", { exact: true })
          .fill("Unsaved fictional correction");
        const deniedInspectionId = new URL(page.url()).searchParams.get("inspectionId");
        const inspectionState = async () => (await admin.query(
          `SELECT version, (SELECT count(*)::int FROM "InspectionRevision" WHERE "inspectionId"=$1) revisions FROM "LeaseInspection" WHERE id=$1`,
          [deniedInspectionId],
        )).rows[0];
        const beforeDenied = await inspectionState();
        let releaseRevokedBootstrap;
        revokedBootstrapGate = new Promise(resolve => { releaseRevokedBootstrap = resolve; });
        await admin.query(
          `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`,
        );
        try {
          await page
            .getByRole("button", { name: "Save observations", exact: true })
            .click();
          // The task adapter hides private fields before account refresh
          // completes; the refreshed permission boundary then removes its dialog.
          await expect(page.getByRole("alert").getByText(
            "Task access is unavailable. Its private details are hidden; an interrupted request is kept on this page for recovery.",
            { exact: true },
          )).toBeVisible();
          await expect(page.getByLabel("Observation notes 1", { exact: true })).toHaveCount(0);
          await expect(page.getByLabel("Area 1", { exact: true })).toHaveCount(0);
          releaseRevokedBootstrap();
          await expect(page.getByRole("heading", { name: "Access unavailable", exact: true })).toBeVisible();
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(
            page.getByText("Fictional browser chip", { exact: true }),
          ).toHaveCount(0);
          assert.deepEqual(await inspectionState(), beforeDenied, "revoked save cannot change the inspection or its revisions");
        } finally {
          releaseRevokedBootstrap();
          await admin.query(
            `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='manager'`,
          );
        }
      } finally {
        await browser.close();
      }
    },
  );
}
