import {historicalDocument} from "./historical-document-fixture.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { newFixturePage } from "./browser-fixture.mjs";
export async function documentLibraryCases(t, admin, call, app) {
  const base = "/api/company/documents",
    ok = async (...args) => {
      const r = await call(...args);
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
  const request = await ok("manager", "POST", "/api/company/maintenance", {
      propertyId: "home",
      unitId: "unit-a",
      title: "Fictional library source",
      description: "Private request text",
      priority: "normal",
      submissionKey: randomUUID(),
    }),
    source = `/api/company/maintenance/${request.id}/documents`;
  const payload = (title, extra = {}) => ({
    title,
    filename: "library-original.txt",
    mediaType: "text/plain",
    contentBase64: Buffer.from("Private library fixture bytes").toString(
      "base64",
    ),
    submissionKey: randomUUID(),
    ...extra,
  });
  const docs = [];
  for (let i = 0; i < 27; i++) {
    const title = `Library file ${String(i).padStart(2, "0")}`;
    docs.push(i < 3 ? await historicalDocument(admin, {sourceId:request.id, title, status:i===1?'rejected':'clean'}) : await ok("manager","POST",source,payload(title)));
  }
  await ok(
    "manager",
    "POST",
    source,
    payload("Library file 00", {
      documentId: docs[0].documentId,
      expectedVersion: 1,
      filename: "replacement-find-me.txt",
    }),
  );
  const leaseDoc = await ok(
    "manager",
    "POST",
    "/api/company/leases/document-lease/documents",
    payload("Library lease original"),
  );
  await t.test(
    "library searches complete latest metadata before paging with exact source context and no originals",
    async () => {
      const first = await ok("manager", "GET", base + "?q=Library");
      assert.equal(first.total, 28);
      assert.equal(first.items.length, 25);
      const second = await ok("manager", "GET", base + "?q=Library&page=2");
      assert.equal(second.items.length, 3);
      assert.equal(
        new Set([...first.items, ...second.items].map((x) => x.id)).size,
        28,
      );
      for (const item of [...first.items, ...second.items]) {
        assert.equal(item.propertyName, "home");
        assert.equal(item.unitLabel, "Apartment 1");
        for (const key of [
          "content",
          "contentBase64",
          "sha256",
          "createdById",
          "submissionKey",
          "submissionHash",
          "description",
          "downloadUrl",
        ])
          assert.ok(!Object.hasOwn(item, key), key);
      }
      const match = await ok("manager", "GET", base + "?q=replacement-find-me");
      assert.equal(match.total, 1);
      assert.equal(match.items[0].id, docs[0].documentId);
      assert.equal(match.items[0].latestNumber, 2);
      assert.equal(match.items[0].scanStatus, "unscanned");
      assert.equal(match.items[0].sourceId, request.id);
      const lease = await ok(
        "manager",
        "GET",
        base + "?q=Library&source=leases",
      );
      assert.equal(lease.total, 1);
      assert.equal(lease.items[0].id, leaseDoc.documentId);
      assert.equal(lease.items[0].sourceId, "document-lease");
      assert.equal(
        (await ok("manager", "GET", base + "?q=Library&source=maintenance"))
          .total,
        27,
      );
    },
  );
  await t.test(
    "scan filters describe the latest version, never an older clean original",
    async () => {
      const clean = await ok("manager", "GET", base + "?q=Library&scan=clean");
      assert.equal(clean.total, 1);
      assert.equal(clean.items[0].id, docs[2].documentId);
      const pending = await ok(
        "manager",
        "GET",
        base + "?q=Library&scan=unscanned",
      );
      assert.equal(pending.total, 26);
      assert.ok(pending.items.some((x) => x.id === docs[0].documentId));
      assert.equal(
        (await ok("manager", "GET", base + "?q=Library&scan=rejected")).total,
        1,
      );
      assert.equal(
        (
          await call(
            "manager",
            "GET",
            `${source}/${docs[0].documentId}/versions/${docs[0].versionId}/download`,
          )
        ).statusCode,
        200,
      );
      const current = (await ok("manager", "GET", source)).items.find(
        (x) => x.id === docs[0].documentId,
      );
      assert.equal(
        (
          await call(
            "manager",
            "GET",
            `${source}/${docs[0].documentId}/versions/${current.versions[0].id}/download`,
          )
        ).statusCode,
        200,
      );
    },
  );
  await t.test(
    "archive/restore and property filters preserve source versions and complete totals",
    async () => {
      await ok("manager", "PATCH", `${source}/${docs[3].documentId}`, {
        archived: true,
        expectedVersion: 1,
      });
      assert.equal((await ok("manager", "GET", base + "?q=Library")).total, 27);
      const archived = await ok(
        "manager",
        "GET",
        base + "?q=Library&status=archived",
      );
      assert.equal(archived.total, 1);
      assert.equal(archived.items[0].id, docs[3].documentId);
      assert.equal(
        (
          await ok(
            "manager",
            "GET",
            base + "?q=Library&status=all&propertyId=home",
          )
        ).total,
        28,
      );
      await ok("manager", "PATCH", `${source}/${docs[3].documentId}`, {
        archived: false,
        expectedVersion: 2,
      });
      assert.equal((await ok("manager", "GET", base + "?q=Library")).total, 28);
      assert.equal(
        (
          await ok(
            "manager",
            "GET",
            base + "?q=Library&propertyId=calendar-home",
          )
        ).total,
        0,
      );
    },
  );
  await t.test(
    "fresh management permission, exact company and source access remain mandatory",
    async () => {
      for (const actor of ["staff", "vendor-staff", "vendor-resident"])
        assert.equal((await call(actor, "GET", base)).statusCode, 403);
      assert.equal((await ok("foreign", "GET", base)).total, 0);
      assert.equal(
        (await call("foreign", "GET", base + "?propertyId=home")).statusCode,
        404,
      );
      assert.equal(
        (await call("manager", "GET", base, null, { "x-company-id": "b" }))
          .statusCode,
        403,
      );
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`,
      );
      try {
        assert.equal((await call("manager", "GET", base)).statusCode, 403);
        assert.equal((await call("manager", "GET", source)).statusCode, 403);
      } finally {
        await admin.query(
          `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='manager'`,
        );
      }
      await admin.query(`UPDATE "Company" SET status='suspended' WHERE id='a'`);
      try {
        assert.equal((await call("manager", "GET", base)).statusCode, 403);
      } finally {
        await admin.query(`UPDATE "Company" SET status='active' WHERE id='a'`);
      }
    },
  );
  await t.test(
    "invalid filter/date-like paging input is rejected without exposing source content",
    async () => {
      for (const query of [
        "source=unknown",
        "scan=unknown",
        "status=unknown",
        "page=0",
        "page=1e2",
        "unknown=1",
      ])
        assert.equal(
          (await call("manager", "GET", base + "?" + query)).statusCode,
          400,
        );
      assert.equal((await ok("manager", "GET", base + "?q=%25")).total, 0);
    },
  );
  await t.test(
    "real browser focuses the exact retained source document, shows scan state and restores library filters",
    { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await newFixturePage(browser, {
          viewport: { width: 390, height: 844 },
        });
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
          return route.fulfill({
            status: response.statusCode,
            contentType: "application/json",
            body: response.body,
          });
        });
        const origin = process.env.TEST_MAINTENANCE_BROWSER_URL;
        await page.goto(
          origin +
            "/company/documents?q=replacement-find-me&scan=unscanned&propertyId=home",
        );
        await expect(
          page.getByRole("status").filter({ hasText: "1 matching document" }),
        ).toBeVisible();
        await page
          .getByRole("link", { name: "Library file 00", exact: true })
          .click();
        const selected = page.locator(".private-document-target");
        await expect(
          selected.getByRole("heading", {
            name: "Library file 00",
            exact: true,
          }),
        ).toBeVisible();
        await expect(selected.locator("details")).toHaveAttribute("open", "");
        await expect(
          selected.getByText("Latest version: Not scanned", { exact: false }),
        ).toBeVisible();
        await expect(
          selected.getByRole("button", {
            name: "Download version 1",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          selected.getByRole("button", {
            name: "Download version 2",
            exact: true,
          }),
        ).toBeVisible();
        assert.equal(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
          true,
        );
        await page.screenshot({
          path: "/tmp/pf-library-source-local-mobile.png",
        });
        await page
          .getByRole("link", {
            name: "Back to document library →",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("status").filter({ hasText: "1 matching document" }),
        ).toBeVisible();
        await expect(
          page.getByRole("searchbox", {
            name: "Search documents",
            exact: true,
          }),
        ).toHaveValue("replacement-find-me");
        await expect(
          page.getByRole("combobox", {
            name: "Latest file status",
            exact: true,
          }),
        ).toHaveValue("unscanned");
        await page.screenshot({ path: "/tmp/pf-library-local-mobile.png" });
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.screenshot({ path: "/tmp/pf-library-local-desktop.png" });
        await page.setViewportSize({width:390,height:844});
        await page.getByRole('searchbox',{name:'Search documents',exact:true}).fill('Library');
        await page.getByRole('combobox',{name:'Source type',exact:true}).selectOption('leases');
        await page.getByRole('link',{name:'Library lease original',exact:true}).click();
        await expect(page.locator('.private-document-target').getByRole('heading',{name:'Library lease original',exact:true})).toBeVisible();
        await page.getByRole('combobox',{name:'Lease section',exact:true}).selectOption('overview');
        await expect(page.getByRole('link',{name:'Back to document library →',exact:true})).toBeVisible();
        await page.getByRole('combobox',{name:'Lease section',exact:true}).selectOption('documents');
        await page.getByRole('link',{name:'Back to document library →',exact:true}).click();
        await expect(page.getByRole('status').filter({hasText:'1 matching document'})).toBeVisible();
        await expect(page.getByRole('combobox',{name:'Source type',exact:true})).toHaveValue('leases');
      } finally {
        await browser.close();
      }
    },
  );
}
