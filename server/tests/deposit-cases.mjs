import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { companyDay } from "../dist/reports.js";
export async function depositCases(t, admin, call, db) {
  const ok = (r) => {
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    },
    today = companyDay("America/New_York");
  const next = new Date(today + "T00:00:00Z");
  next.setUTCMonth(next.getUTCMonth() + 1, 1);
  const startsOn = next.toISOString().slice(0, 10);
  let lease, account, receipt, revision;
  const createLease = async (label) => {
    const unit = ok(
      await call(
        "owner",
        "POST",
        "/api/company/properties/deposit-home/units",
        { label, submissionKey: randomUUID() },
      ),
    );
    return ok(
      await call("owner", "POST", "/api/company/leases", {
        propertyId: "deposit-home",
        unitId: unit.id,
        residentId: "resident2",
        startsOn,
        endsOn: null,
        monthlyRent: "1000.00",
        status: "active",
        submissionKey: randomUUID(),
      }),
    );
  };
  const setup = () => ({
    amount: "1500.00",
    dueOn: today,
    expectedLeaseVersion: lease.version,
    submissionKey: randomUUID(),
  });
  const receive = () => ({
    amount: "750.00",
    occurredOn: today,
    method: "bank_transfer",
    paymentReference: "Bank receipt 123",
    memo: "Private deposit note",
    expectedVersion: account.version,
    expectedLeaseVersion: lease.version,
    submissionKey: randomUUID(),
  });
  const endpoint = () => `/api/company/deposits/${lease.id}`;
  const get = async () => ok(await call("owner", "GET", endpoint()));
  await t.test(
    "deposit requirements are pre-move-in, scoped, strict and durably created once with a matching immutable revision",
    async () => {
      await admin.query(
        `INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES('deposit-home','Deposit House','street','city','state','zip','a',NOW());INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','deposit-home','resident2')`,
      );
      lease = await createLease("Deposit unit");
      for (const user of ["staff", "resident", "platform", "foreign"])
        assert.ok(
          [403, 404].includes(
            (await call(user, "POST", endpoint(), setup())).statusCode,
          ),
        );
      for (const patch of [
        { amount: "0" },
        { amount: "1.001" },
        { amount: "1000000.01" },
        { dueOn: "2026-02-30" },
        { companyId: "b" },
        { expectedLeaseVersion: 99 },
      ])
        assert.ok(
          [400, 409].includes(
            (await call("owner", "POST", endpoint(), { ...setup(), ...patch }))
              .statusCode,
          ),
        );
      const payload = setup();
      const responses = await Promise.all([
        call("owner", "POST", endpoint(), payload),
        call("owner", "POST", endpoint(), payload),
      ]);
      account = ok(responses[0]);
      assert.equal(ok(responses[1]).id, account.id);
      assert.match(account.reference, /^DA-\d+$/);
      assert.equal(account.requiredCents, 150000);
      assert.ok(account.dueOn < lease.startsOn);
      assert.equal(
        (
          await call("owner", "POST", endpoint(), {
            ...payload,
            amount: "1.00",
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (await call("manager", "POST", endpoint(), setup())).statusCode,
        409,
      );
      assert.equal((await get()).account.revisions.length, 1);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1 AND action='deposit.created'`,
            [account.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "deposit requirement edits keep immutable snapshots, reject stale edits and roll back on audit failure",
    async () => {
      const payload = {
        amount: "1600.00",
        dueOn: today,
        expectedVersion: 1,
        expectedLeaseVersion: lease.version,
        reason: "Updated signed deposit amount",
        submissionKey: randomUUID(),
      };
      await admin.query(
        'REVOKE INSERT ON "AuditEvent" FROM propertyflow_runtime',
      );
      try {
        assert.equal(
          (await call("owner", "PATCH", endpoint(), payload)).statusCode,
          500,
        );
      } finally {
        await admin.query(
          'GRANT INSERT ON "AuditEvent" TO propertyflow_runtime',
        );
      }
      assert.equal((await get()).account.version, 1);
      assert.equal((await get()).account.revisions.length, 1);
      revision = ok(await call("owner", "PATCH", endpoint(), payload));
      assert.equal(revision.version, 2);
      assert.equal(
        ok(await call("owner", "PATCH", endpoint(), payload)).id,
        revision.id,
      );
      assert.equal(
        (
          await call("manager", "PATCH", endpoint(), {
            ...payload,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      account = (await get()).account;
      assert.equal(account.requiredCents, 160000);
      assert.equal(account.revisions.length, 2);
    },
  );
  await t.test(
    "concurrent receipt retries create one cash source without rent credit or operating income",
    async () => {
      const payload = receive();
      const responses = await Promise.all([
        call("owner", "POST", endpoint() + "/receipts", payload),
        call("owner", "POST", endpoint() + "/receipts", payload),
      ]);
      receipt = ok(responses[0]);
      assert.equal(ok(responses[1]).id, receipt.id);
      assert.match(receipt.reference, /^DR-\d+$/);
      assert.match(receipt.cashEntry.reference, /^TX-\d+$/);
      assert.equal((await get()).account.summary.heldCents, "75000");
      assert.equal((await get()).account.summary.outstandingCents, "85000");
      const finance = ok(
        await call(
          "owner",
          "GET",
          "/api/company/finances?propertyId=deposit-home",
        ),
      );
      assert.equal(finance.items.length, 1);
      assert.deepEqual(finance.summary, {
        incomeCents: "0",
        expenseCents: "0",
        netCents: "0",
        depositReceivedCents: "75000",rentRefundCents:'0',depositRefundCents:'0',
        cashMovementCents: "75000",
      });
      assert.equal(
        finance.items[0].depositReceipt.reference,
        receipt.reference,
      );
      assert.equal(finance.items[0].leaseId, null);
      const report = ok(
        await call(
          "owner",
          "GET",
          `/api/company/reports/cash?propertyId=deposit-home&dateFrom=${today}&dateTo=${today}`,
        ),
      );
      assert.equal(report.summary.depositReceivedCents, "75000");
      assert.equal(report.summary.incomeCents, "0");
      assert.equal(report.summary.expenseCents, "0");
      assert.equal(report.summary.cashMovementCents, "75000");
      assert.equal(report.items[0].reference, receipt.cashEntry.reference);
      assert.equal(report.items[0].depositReceipt.id, receipt.id);
      const rent = ok(
        await call("owner", "GET", "/api/company/rent?leaseId=" + lease.id),
      ).accounts[0];
      assert.equal(rent.summary.paidCents, "0");
      assert.equal(rent.summary.creditCents, "0");
      assert.deepEqual(rent.allocations, []);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "LedgerEntry" WHERE "depositReceiptId"=$1`,
            [receipt.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "resident reads require current ownership and property access, omit private notes and expose only their company",
    async () => {
      const path = "/api/resident/deposits/" + lease.id;
      const own = ok(await call("resident2", "GET", path));
      assert.equal(own.account.summary.heldCents, "75000");
      assert.equal(own.account.receipts[0].memo, undefined);
      assert.equal(own.account.receipts[0].paymentReference, undefined);
      assert.equal(own.account.revisions, undefined);
      assert.equal(own.lease.resident, undefined);
      for (const user of ["resident", "foreign-resident"])
        assert.equal((await call(user, "GET", path)).statusCode, 404);
      assert.deepEqual(
        ok(await call("foreign", "GET", "/api/company/deposits")).accounts,
        [],
      );
      assert.deepEqual(
        ok(await call("resident", "GET", "/api/resident/deposits")).accounts,
        [],
      );
      for (const user of ["staff", "platform", "resident2"])
        assert.equal(
          (await call(user, "GET", "/api/company/deposits")).statusCode,
          403,
        );
      await admin.query(
        `DELETE FROM "ResidentPropertyAssignment" WHERE "propertyId"='deposit-home' AND "userId"='resident2'`,
      );
      assert.equal((await call("resident2", "GET", path)).statusCode, 404);
      await admin.query(
        `INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','deposit-home','resident2')`,
      );
    },
  );
  await t.test(
    "receipt validation, current versions, CSRF and protected source corrections are enforced",
    async () => {
      const future = new Date(today + "T00:00:00Z");
      future.setUTCDate(future.getUTCDate() + 1);
      for (const patch of [
        { amount: "0" },
        { amount: "1e3" },
        { amount: "-1" },
        { amount: "1000000.01" },
        { method: "stripe" },
        { occurredOn: future.toISOString().slice(0, 10) },
        { companyId: "b" },
        { memo: "x".repeat(501) },
        { paymentReference: "x".repeat(101) },
        { expectedVersion: 99 },
        { expectedLeaseVersion: 99 },
      ])
        assert.ok(
          [400, 409].includes(
            (
              await call("owner", "POST", endpoint() + "/receipts", {
                ...receive(),
                ...patch,
              })
            ).statusCode,
          ),
        );
      for (const extra of [
        { origin: "https://evil.test" },
        { "x-csrf-token": "wrong" },
        { "x-company-id": "b" },
      ])
        assert.equal(
          (
            await call(
              "owner",
              "POST",
              endpoint() + "/receipts",
              receive(),
              extra,
            )
          ).statusCode,
          403,
        );
      assert.equal(
        (
          await call(
            "owner",
            "POST",
            `/api/company/finances/${receipt.cashEntry.id}/void`,
            { expectedVersion: 1, reason: "Bypass deposit workflow" },
          )
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call("owner", "POST", "/api/company/finances", {
            propertyId: "deposit-home",
            occurredOn: today,
            amount: "750.00",
            kind: "deposit",
            category: "security_deposit",
            memo: null,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await call("owner", "PATCH", "/api/company/leases/" + lease.id, {
            startsOn: lease.startsOn.slice(0, 10),
            endsOn: null,
            status: "draft",
            monthlyRent: "1000.00",
            expectedVersion: lease.version,
          })
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "receipt/audit failure rolls back both money sources and retry commits once",
    async () => {
      const payload = {
        ...receive(),
        paymentReference: "Rollback deposit receipt",
      };
      await admin.query(
        'REVOKE INSERT ON "AuditEvent" FROM propertyflow_runtime',
      );
      try {
        assert.equal(
          (await call("owner", "POST", endpoint() + "/receipts", payload))
            .statusCode,
          500,
        );
      } finally {
        await admin.query(
          'GRANT INSERT ON "AuditEvent" TO propertyflow_runtime',
        );
      }
      assert.equal((await get()).account.summary.heldCents, "75000");
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "DepositReceipt" WHERE "submissionKey"=$1`,
            [payload.submissionKey],
          )
        ).rows[0].n,
        0,
      );
      const row = ok(
        await call("owner", "POST", endpoint() + "/receipts", payload),
      );
      assert.equal((await get()).account.summary.heldCents, "150000");
      assert.equal(
        ok(await call("owner", "POST", endpoint() + "/receipts", payload)).id,
        row.id,
      );
    },
  );
  await t.test(
    "voids are audited corrections, replay after response loss, and preserve the original source",
    async () => {
      const path = `/api/company/deposit-receipts/${receipt.id}/void`,
        payload = { expectedVersion: 1, reason: "Wrong receipt recorded" };
      await admin.query(
        'REVOKE INSERT ON "AuditEvent" FROM propertyflow_runtime',
      );
      try {
        assert.equal(
          (await call("owner", "POST", path, payload)).statusCode,
          500,
        );
      } finally {
        await admin.query(
          'GRANT INSERT ON "AuditEvent" TO propertyflow_runtime',
        );
      }
      assert.equal((await get()).account.summary.heldCents, "150000");
      const results = await Promise.all([
        call("owner", "POST", path, payload),
        call("manager", "POST", path, payload),
      ]);
      for (const r of results) assert.equal(ok(r).cashEntry.version, 2);
      assert.equal(
        ok(await call("owner", "POST", path, payload)).cashEntry.version,
        2,
      );
      assert.equal(
        (await call("owner", "POST", path, { ...payload, reason: "Changed" }))
          .statusCode,
        409,
      );
      assert.equal(
        (await call("foreign", "POST", path, payload)).statusCode,
        404,
      );
      assert.equal(
        (await call("resident2", "POST", path, payload)).statusCode,
        403,
      );
      assert.equal((await get()).account.summary.heldCents, "75000");
      assert.equal((await get()).account.receipts.length, 2);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "AuditEvent" WHERE "targetId"=$1 AND action='deposit.receipt.voided'`,
            [receipt.id],
          )
        ).rows[0].n,
        1,
      );
      const finance = ok(
        await call(
          "owner",
          "GET",
          "/api/company/finances?propertyId=deposit-home",
        ),
      );
      assert.equal(finance.summary.depositReceivedCents, "75000");
    },
  );
  await t.test(
    "requirement changes preserve held funds and explicitly identify excess without refunding or allocating rent",
    async () => {
      const row = ok(
        await call("owner", "PATCH", endpoint(), {
          amount: "500.00",
          dueOn: today,
          expectedVersion: account.version,
          expectedLeaseVersion: lease.version,
          reason: "Reduced agreed deposit",
          submissionKey: randomUUID(),
        }),
      );
      assert.equal(row.version, 3);
      account = (await get()).account;
      assert.equal(account.summary.heldCents, "75000");
      assert.equal(account.summary.excessHeldCents, "25000");
      assert.equal(account.summary.outstandingCents, "0");
      assert.equal(account.revisions.length, 3);
    },
  );
  await t.test(
    "runtime RLS, immutable sources, same-company FKs and deferred source/snapshot guards protect direct SQL",
    async () => {
      const ctx = (fn) =>
        db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','a',true)`;
          return fn(tx);
        });
      await assert.rejects(
        ctx((tx) =>
          tx.depositReceipt.update({
            where: { id: receipt.id },
            data: { amountCents: 1 },
          }),
        ),
        /permission denied/i,
      );
      await assert.rejects(
        ctx((tx) =>
          tx.depositRevision.deleteMany({ where: { accountId: account.id } }),
        ),
        /permission denied/i,
      );
      await assert.rejects(
        ctx((tx) =>
          tx.depositAccount.update({
            where: { id: account.id },
            data: { requiredCents: 1, version: { increment: 1 } },
          }),
        ),
        /immutable revision|23514/,
      );
      await assert.rejects(
        ctx((tx) =>
          tx.depositRevision.create({
            data: {
              companyId: "a",
              accountId: account.id,
              createdById: "owner",
              version: 999,
              requiredCents: 1,
              dueOn: new Date(today),
              reason: "Fake future snapshot",
              submissionKey: randomUUID(),
              submissionHash: "x",
            },
          }),
        ),
        /snapshot current|23514/,
      );
      await assert.rejects(
        ctx((tx) =>
          tx.depositReceipt.create({
            data: {
              companyId: "a",
              propertyId: "deposit-home",
              leaseId: lease.id,
              accountId: account.id,
              createdById: "owner",
              occurredOn: new Date(today),
              amountCents: 1,
              method: "cash",
              submissionKey: randomUUID(),
              submissionHash: "x",
            },
          }),
        ),
        /linked cash source|23514/,
      );
      await assert.rejects(
        ctx((tx) =>
          tx.depositReceipt.create({
            data: {
              companyId: "b",
              propertyId: "foreign-home",
              leaseId: lease.id,
              accountId: account.id,
              createdById: "owner",
              occurredOn: new Date(today),
              amountCents: 1,
              method: "cash",
              submissionKey: randomUUID(),
              submissionHash: "x",
            },
          }),
        ),
        /row-level security|42501/,
      );
      assert.deepEqual(
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.company_id','b',true)`;
          return tx.depositAccount.findMany();
        }),
        [],
      );
    },
  );
  await t.test(
    "replays recheck current membership even after money committed",
    async () => {
      const payload = receive();
      const row = ok(
        await call("owner", "POST", endpoint() + "/receipts", payload),
      );
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='owner'`,
      );
      try {
        assert.equal(
          (await call("owner", "POST", endpoint() + "/receipts", payload))
            .statusCode,
          403,
        );
        assert.equal((await call("owner", "GET", endpoint())).statusCode, 403);
      } finally {
        await admin.query(
          `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='owner'`,
        );
      }
      assert.equal(
        ok(await call("owner", "POST", endpoint() + "/receipts", payload)).id,
        row.id,
      );
    },
  );
  await t.test(
    "parallel property panels retain current authority without artificial write conflicts",
    async () => {
      const paths = [
        endpoint(),
        "/api/company/rent?leaseId=" + lease.id,
        "/api/company/finances?propertyId=deposit-home",
        "/api/company/deposits?propertyId=deposit-home",
      ];
      for (const r of await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          call("owner", "GET", paths[i % paths.length]),
        ),
      ))
        ok(r);
    },
  );
  await t.test(
    "deposit details reject mismatched property context instead of mixing property workspaces",
    async () => {
      assert.equal(
        (await call("owner", "GET", endpoint() + "?propertyId=home"))
          .statusCode,
        404,
      );
      assert.equal(
        (await call("owner", "GET", endpoint() + "?propertyId=deposit-home"))
          .statusCode,
        200,
      );
      assert.equal(
        (await call("owner", "GET", endpoint() + "?companyId=b")).statusCode,
        400,
      );
    },
  );
  await t.test(
    "real browser reviews setup and receipt, recovers both committed responses after reload, and corrects without deleting history",
    { skip: !process.env.TEST_FINANCES_BROWSER_URL },
    async () => {
      const fresh = await createLease("Browser deposit unit"),
        browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        const posts = [],
          lost = new Set();
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            u = new URL(req.url()),
            payload = req.postData() ? req.postDataJSON() : undefined,
            response = await call(
              "owner",
              req.method(),
              u.pathname + u.search,
              payload,
            );
          if (
            req.method() === "POST" &&
            u.pathname.startsWith("/api/company/deposits/" + fresh.id)
          ) {
            assert.equal(response.statusCode, 200, response.body);
            posts.push({ path: u.pathname, payload });
            if (!lost.has(u.pathname)) {
              lost.add(u.pathname);
              return route.abort("failed");
            }
          }
          await route.fulfill({
            status: response.statusCode,
            contentType: "application/json",
            body: response.body,
          });
        });
        await page.goto(
          process.env.TEST_FINANCES_BROWSER_URL +
            `/company/properties/deposit-home/rent?leaseId=${fresh.id}`,
        );
        await page
          .getByRole("button", { name: "Set up deposit", exact: true })
          .click();
        await page
          .getByLabel("Refundable deposit required (USD)", { exact: true })
          .fill("1500.00");
        await page.getByLabel("Deposit due date", { exact: true }).fill(today);
        await page
          .getByRole("button", {
            name: "Review deposit requirement",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: "Save deposit requirement",
            exact: true,
          })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await page.reload();
        await page
          .getByRole("button", {
            name: "Recover pending deposit save",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Retry this deposit save", exact: true })
          .click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        assert.deepEqual(posts[0], posts[1]);
        await page
          .getByRole("button", { name: "Record deposit received", exact: true })
          .click();
        await page
          .getByLabel("Deposit amount received (USD)", { exact: true })
          .fill("750.00");
        await page
          .getByLabel("Deposit payment method")
          .selectOption("bank_transfer");
        await page
          .getByRole("button", { name: "Review deposit receipt", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toContainText(
          "Held after receipt",
        );
        await page
          .getByRole("button", {
            name: "Confirm deposit received",
            exact: true,
          })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await page.reload();
        await page
          .getByRole("button", {
            name: "Recover pending deposit save",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Retry this deposit save", exact: true })
          .click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        assert.deepEqual(posts[2], posts[3]);
        const data = ok(
          await call("owner", "GET", "/api/company/deposits/" + fresh.id),
        );
        assert.equal(data.account.receipts.length, 1);
        assert.equal(data.account.summary.heldCents, "75000");
        assert.equal(data.account.revisions.length, 1);
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "AuditEvent" WHERE action='deposit.receipt.recorded' AND detail->>'leaseId'=$1`,
              [fresh.id],
            )
          ).rows[0].n,
          1,
        );
        const download = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Download deposit CSV" })
          .click();
        const stream = await (await download).createReadStream();
        let csv = "";
        for await (const p of stream) csv += p.toString();
        const r = data.account.receipts[0];
        assert.ok(
          csv.includes(r.id) &&
            csv.includes(r.reference) &&
            csv.includes(r.cashEntry.id) &&
            csv.includes(r.cashEntry.reference),
        );
        await expect(page.getByText(r.id, { exact: true })).toHaveCount(0);
        await page.setViewportSize({ width: 390, height: 844 });
        await page
          .getByRole("button", { name: "Correct deposit receipt", exact: true })
          .click();
        await page
          .getByLabel("Deposit correction reason")
          .fill("Receipt entered twice outside the system");
        await page
          .getByRole("button", {
            name: "Review receipt correction",
            exact: true,
          })
          .click();
        await page.screenshot({
          path: "/tmp/pf-deposit-correction-mobile.png",
          fullPage: true,
        });
        await page
          .getByRole("button", {
            name: "Void this deposit receipt",
            exact: true,
          })
          .click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await expect(
          page.getByText("Voided: Receipt entered twice outside the system"),
        ).toBeVisible();
        assert.equal(
          ok(await call("owner", "GET", "/api/company/deposits/" + fresh.id))
            .account.summary.heldCents,
          "0",
        );
      } catch (error) {
        t.diagnostic((await page.locator("body").innerText()).slice(-7000));
        throw error;
      } finally {
        await browser.close();
      }
    },
  );
}
