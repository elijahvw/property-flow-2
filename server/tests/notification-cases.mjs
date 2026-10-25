import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { newFixturePage } from "./browser-fixture.mjs";
export async function notificationCases(t, admin, db, call, app) {
  const digest = (value) => createHash("sha256").update(value).digest("hex"),
    company = "notice-company",
    home = "notice-home",
    away = "notice-away";
  await admin.query(
    `INSERT INTO "Company" (id,name,"updatedAt") VALUES ($1,'Fictional notification company',NOW())`,
    [company],
  );
  for (const role of ["owner", "manager", "staff", "resident", "other"]) {
    const id = `notice-${role}`;
    await admin.query(
      `INSERT INTO "User" (id,email,name,"emailVerified","updatedAt") VALUES ($1,$2,$1,true,NOW())`,
      [id, `${id}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO "CompanyMembership" ("userId","companyId",role,"maintenanceExecution","staffPropertyScope","updatedAt") VALUES ($1,$2,$3,$4,'selected',NOW())`,
      [id, company, role === "other" ? "resident" : role, role === "staff"],
    );
    await db.session.create({
      data: {
        tokenHash: digest(`token-${id}`),
        csrfToken: "csrf",
        userId: id,
        expiresAt: new Date(Date.now() + 3600000),
        idleExpiresAt: new Date(Date.now() + 3600000),
      },
    });
  }
  for (const id of [home, away])
    await admin.query(
      `INSERT INTO "Property" (id,name,address,city,state,zip,"companyId","updatedAt") VALUES ($1,$1,'street','city','state','zip',$2,NOW())`,
      [id, company],
    );
  for (const id of ["notice-resident", "notice-other"])
    await admin.query(
      `INSERT INTO "ResidentPropertyAssignment" ("companyId","propertyId","userId") VALUES ($1,$2,$3)`,
      [company, home, id],
    );
  await admin.query(
    `INSERT INTO "StaffPropertyAccess" ("companyId","propertyId","userId") VALUES ($1,$2,'notice-staff')`,
    [company, home],
  );
  const api = "/api/account/notifications",
    ok = async (...args) => {
      const r = await call(...args);
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    },
    inbox = (actor, query = "") => ok(`notice-${actor}`, "GET", api + query),
    summary = (actor) => ok(`notice-${actor}`, "GET", api + "/summary");
  const create = (patch = {}, actor = "resident") =>
    ok(
      `notice-${actor}`,
      "POST",
      `/api/${actor === "resident" || actor === "other" ? "resident" : "company"}/maintenance`,
      {
        propertyId: home,
        title: "Fictional leaking tap",
        description: "Private fictional source description",
        priority: "normal",
        submissionKey: randomUUID(),
        ...patch,
      },
    );
  const find = async (actor, title) =>
    (await inbox(actor)).items.find((n) => n.title === title);
  const action = (row, name, patch = {}) => ({
    action: name,
    expectedVersion: row.version,
    submissionKey: randomUUID(),
    status: "all",
    type: "all",
    page: "1",
    ...patch,
  });
  const act = (actor, row, name, patch = {}) =>
    ok(`notice-${actor}`, "POST", `${api}/${row.id}`, action(row, name, patch));
  let request, residentNotice, workNotice, inspection, agreement;
  await t.test(
    "real source creation fixes audiences, excludes actor, replays once and exposes only safe current context",
    async () => {
      const payload = {
        title: "Fictional inbox request",
        submissionKey: randomUUID(),
      };
      request = await create(payload);
      assert.equal((await create(payload)).id, request.id);
      for (const who of ["owner", "manager"]) {
        const n = (await inbox(who)).items;
        assert.equal(n.length, 1);
        assert.equal(n[0].sourceTitle, payload.title);
        assert.equal(n[0].readAt, null);
        assert.deepEqual(
          Object.keys(n[0]).sort(),
          [
            "id",
            "version",
            "readAt",
            "createdAt",
            "type",
            "title",
            "sourceTitle",
            "property",
            "unit",
          ].sort(),
        );
      }
      for (const who of ["resident", "staff", "other"])
        assert.equal((await inbox(who)).total, 0);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "NotificationEvent" WHERE "companyId"=$1`,
            [company],
          )
        ).rows[0].n,
        1,
      );
      const ownerBefore = (await inbox("owner")).total;
      await create({ title: "Owner intake" }, "owner");
      assert.equal((await inbox("owner")).total, ownerBefore);
      assert.equal((await inbox("manager")).total, 2);
      assert.equal((await call("foreign", "GET", api)).json().total, 0);
      assert.equal(
        (await call("notice-owner", "GET", api, null, { "x-company-id": "b" }))
          .statusCode,
        403,
      );
      assert.equal((await call(null, "GET", api)).statusCode, 401);
    },
  );
  await t.test(
    "resident deliveries require a real requester-visible update or changed status",
    async () => {
      const path = `/api/company/maintenance/${request.id}`;
      await ok("notice-manager", "PATCH", path, { status: "in_progress" });
      residentNotice = await find("resident", "Maintenance status changed");
      assert.ok(residentNotice);
      const key = randomUUID();
      const update = {
        content: "Private fictional resident update content",
        visibility: "resident",
        submissionKey: key,
      };
      await ok("notice-manager", "POST", path + "/updates", update);
      await ok("notice-manager", "POST", path + "/updates", update);
      await ok("notice-manager", "POST", path + "/updates", {
        ...update,
        visibility: "internal",
        submissionKey: randomUUID(),
        content: "INTERNAL_SECRET_NOT_IN_INBOX",
      });
      await ok("notice-manager", "PATCH", path, { status: "in_progress" });
      assert.equal((await inbox("resident")).total, 2);
      assert.equal((await inbox("other")).total, 0);
      assert.ok(
        !(await inbox("resident")).items.some((n) =>
          JSON.stringify(n).includes(
            "Private fictional resident update content",
          ),
        ),
      );
      assert.ok(
        !JSON.stringify(await inbox("manager")).includes("INTERNAL_SECRET"),
      );
      // Source titles are resolved currently, without retaining copied note content.
      await ok("notice-manager", "PATCH", path, {
        status: "in_progress",
        title: "Fictional repaired tap",
      });
      assert.equal(
        (await inbox("resident")).items[0].sourceTitle,
        "Fictional repaired tap",
      );
    },
  );
  await t.test(
    "own read state is versioned, atomic, idempotent even for no-ops and does not touch another inbox",
    async () => {
      const row = residentNotice,
        body = action(row, "read");
      const results = await Promise.all([
        ok("notice-resident", "POST", `${api}/${row.id}`, body),
        ok("notice-resident", "POST", `${api}/${row.id}`, body),
      ]);
      assert.ok(results.some((r) => r.replayed));
      let current = (await inbox("resident")).items.find(
        (n) => n.id === row.id,
      );
      assert.equal(current.version, 2);
      assert.ok(current.readAt);
      const noOp = action(current, "read");
      await ok("notice-resident", "POST", `${api}/${row.id}`, noOp);
      await act("resident", current, "unread");
      assert.equal(
        (await ok("notice-resident", "POST", `${api}/${row.id}`, noOp))
          .replayed,
        true,
      );
      current = (await inbox("resident")).items.find((n) => n.id === row.id);
      assert.equal(current.readAt, null);
      assert.equal(current.version, 3);
      assert.equal(
        (await ok("notice-resident", "POST", `${api}/${row.id}`, body))
          .replayed,
        true,
      );
      assert.equal(
        (
          await call("notice-resident", "POST", `${api}/${row.id}`, {
            ...body,
            action: "open",
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call(
            "notice-resident",
            "POST",
            `${api}/${row.id}`,
            action(row, "read"),
          )
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call(
            "notice-other",
            "POST",
            `${api}/${row.id}`,
            action(row, "read"),
          )
        ).statusCode,
        404,
      );
      for (const extra of [
        { origin: "https://evil.test" },
        { "x-csrf-token": "bad" },
      ])
        assert.equal(
          (
            await call(
              "notice-resident",
              "POST",
              `${api}/${row.id}`,
              action(current, "read"),
              extra,
            )
          ).statusCode,
          403,
        );
      for (const patch of [
        { userId: "notice-owner" },
        { action: "delete" },
        { expectedVersion: 0 },
        { type: "finance" },
        { page: "0" },
      ])
        assert.equal(
          (
            await call("notice-resident", "POST", `${api}/${row.id}`, {
              ...action(current, "read"),
              ...patch,
            })
          ).statusCode,
          400,
        );
      assert.equal((await summary("resident")).unread, 2);
      assert.equal((await inbox("owner")).items[0].readAt, null);
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "NotificationAction" WHERE "notificationId"=$1`,
            [row.id],
          )
        ).rows[0].n,
        3,
      );
    },
  );
  await t.test(
    "assignment, staff completion and management review use current execution/property boundaries",
    async () => {
      const path = `/api/company/work-orders/${request.id}/actions`;
      const work = async (who, name, extra = {}) => {
        const v = (
          await admin.query(
            'SELECT version FROM "MaintenanceRequest" WHERE id=$1',
            [request.id],
          )
        ).rows[0].version;
        return ok(`notice-${who}`, "POST", path, {
          action: name,
          note: "Private fictional work detail",
          expectedVersion: v,
          submissionKey: randomUUID(),
          ...extra,
        });
      };
      await work("manager", "assign", { assigneeId: "notice-staff" });
      workNotice = await find("staff", "Work assigned to you");
      assert.ok(workNotice);
      assert.equal(
        (await act("staff", workNotice, "open")).href.split("?")[0],
        `/company/work-orders/${request.id}`,
      );
      for (const patch of [
        'UPDATE "CompanyMembership" SET "maintenanceExecution"=false WHERE "userId"=\'notice-staff\'',
        'DELETE FROM "StaffPropertyAccess" WHERE "userId"=\'notice-staff\'',
      ]) {
        await admin.query(patch);
        assert.equal((await inbox("staff")).total, 0);
        assert.equal((await summary("staff")).unread, 0);
        assert.equal(
          (
            await call(
              "notice-staff",
              "POST",
              `${api}/${workNotice.id}`,
              action(workNotice, "open"),
            )
          ).statusCode,
          404,
        );
        await admin.query(
          `UPDATE "CompanyMembership" SET "maintenanceExecution"=true WHERE "userId"='notice-staff'`,
        );
        await admin.query(
          `INSERT INTO "StaffPropertyAccess" ("companyId","propertyId","userId") VALUES ($1,$2,'notice-staff') ON CONFLICT DO NOTHING`,
          [company, home],
        );
      }
      await work("staff", "accept");
      await work("staff", "submit");
      assert.ok(await find("manager", "Completed work needs review"));
      assert.ok(await find("owner", "Completed work needs review"));
      await work("manager", "approve");
      assert.ok(await find("staff", "Your completed work was approved"));
      await work("manager", "reopen");
      assert.ok(await find("staff", "Your assigned work was reopened"));
      await work("manager", "assign", { assigneeId: null });
      assert.equal((await inbox("staff")).total, 0);
      assert.equal(
        (
          await call(
            "notice-staff",
            "POST",
            `${api}/${workNotice.id}`,
            action(workNotice, "open"),
          )
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    "source access is checked before list totals, summaries, opens and durable replays",
    async () => {
      const row = (await inbox("resident")).items[0],
        body = action(row, "open", {
          status: "unread",
          type: "maintenance",
          page: "2",
        });
      const opened = await ok(
        "notice-resident",
        "POST",
        `${api}/${row.id}`,
        body,
      );
      assert.ok(opened.href.startsWith(`/resident/maintenance/${request.id}?`));
      assert.ok(opened.href.includes("noticePage=2"));
      await admin.query(
        `DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='notice-resident'`,
      );
      assert.equal((await inbox("resident")).total, 0);
      assert.equal((await summary("resident")).unread, 0);
      assert.equal(
        (await call("notice-resident", "POST", `${api}/${row.id}`, body))
          .statusCode,
        404,
      );
      await admin.query(
        `INSERT INTO "ResidentPropertyAssignment" ("companyId","propertyId","userId") VALUES ($1,$2,'notice-resident')`,
        [company, home],
      );
      assert.equal(
        (await ok("notice-resident", "POST", `${api}/${row.id}`, body))
          .replayed,
        true,
      );
      await admin.query(
        `UPDATE "CompanyMembership" SET role='staff' WHERE "userId"='notice-resident'`,
      );
      assert.equal((await inbox("resident")).total, 0);
      assert.equal((await summary("resident")).unread, 0);
      await admin.query(
        `UPDATE "CompanyMembership" SET role='resident' WHERE "userId"='notice-resident'`,
      );
      await admin.query(
        `UPDATE "User" SET "emailVerified"=false,"platformRole"='owner' WHERE id='notice-resident'`,
      );
      assert.equal((await call("notice-resident", "GET", api)).statusCode, 403);
      await admin.query(
        `UPDATE "User" SET "emailVerified"=true,"platformRole"=NULL WHERE id='notice-resident'`,
      );
      await admin.query(`UPDATE "Company" SET status='suspended' WHERE id=$1`, [
        company,
      ]);
      assert.equal((await call("notice-owner", "GET", api)).statusCode, 403);
      await admin.query(`UPDATE "Company" SET status='active' WHERE id=$1`, [
        company,
      ]);
    },
  );
  await t.test(
    "publication and read receipts roll back with their audit or source write",
    async () => {
      await admin.query(
        `CREATE FUNCTION reject_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture publication failure'; END $$; CREATE TRIGGER reject_notice BEFORE INSERT ON "InboxNotification" FOR EACH ROW EXECUTE FUNCTION reject_notice()`,
      );
      const key = randomUUID();
      try {
        assert.equal(
          (
            await call("notice-resident", "POST", "/api/resident/maintenance", {
              propertyId: home,
              title: "Rollback",
              description: "Fictional",
              priority: "normal",
              submissionKey: key,
            })
          ).statusCode,
          500,
        );
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "MaintenanceRequest" WHERE "submissionKey"=$1`,
              [key],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await admin.query(
          `DROP TRIGGER reject_notice ON "InboxNotification"; DROP FUNCTION reject_notice()`,
        );
      }
      const row = (await inbox("owner")).items[0],
        body = action(row, "read");
      await admin.query(
        `CREATE FUNCTION reject_notice_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='notification.read' THEN RAISE EXCEPTION 'fixture read audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_notice_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_notice_audit()`,
      );
      try {
        assert.equal(
          (await call("notice-owner", "POST", `${api}/${row.id}`, body))
            .statusCode,
          500,
        );
        assert.equal(
          (await inbox("owner")).items.find((n) => n.id === row.id).readAt,
          null,
        );
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "NotificationAction" WHERE "submissionKey"=$1`,
              [body.submissionKey],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await admin.query(
          `DROP TRIGGER reject_notice_audit ON "AuditEvent"; DROP FUNCTION reject_notice_audit()`,
        );
      }
      await ok("notice-owner", "POST", `${api}/${row.id}`, body);
    },
  );
  await t.test(
    "lease review notifications point to exact source sections without financial or file contents",
    async () => {
      await admin.query(
        `INSERT INTO "Unit" (id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES ('notice-unit',$1,$2,'Fictional suite','notice-owner','notice-unit','fixture',NOW())`,
        [company, home],
      );
      await admin.query(
        `INSERT INTO "Lease" (id,"companyId","propertyId","unitId","createdById","residentId","startsOn","rentCents",status,"submissionKey","submissionHash","updatedAt") VALUES ('notice-lease',$1,$2,'notice-unit','notice-owner','notice-resident','2026-10-01',100000,'active','notice-lease','fixture',NOW())`,
        [company, home],
      );
      const base = "/api/company/leases/notice-lease";
      inspection = await ok("notice-owner", "POST", base + "/inspections", {
        kind: "move_in",
        inspectedOn: "2026-10-01",
        items: [
          {
            key: randomUUID(),
            area: "Kitchen",
            item: "Tap",
            condition: "good",
            notes: "Private fixture observations",
            evidenceVersionIds: [],
          },
        ],
        baselineRevisionId: null,
        submissionKey: randomUUID(),
      });
      await ok(
        "notice-owner",
        "POST",
        base + `/inspections/${inspection.inspectionId}`,
        {
          action: "submit",
          expectedVersion: inspection.version,
          submissionKey: randomUUID(),
        },
      );
      const n = await find("manager", "Inspection needs review");
      assert.ok(n);
      const ihref = (await act("manager", n, "open")).href;
      assert.ok(ihref.includes("section=inspections"));
      assert.ok(ihref.includes(`inspectionId=${inspection.inspectionId}`));
      const document = await ok("notice-owner", "POST", base + "/documents", {
        title: "Fictional original",
        filename: "agreement.txt",
        mediaType: "text/plain",
        contentBase64: Buffer.from("Fictional agreement original").toString(
          "base64",
        ),
        submissionKey: randomUUID(),
      });
      await ok(
        "notice-owner",
        "POST",
        `${base}/documents/${document.documentId}/versions/${document.versionId}/scan`,
        {},
      );
      const c = await ok("notice-owner", "GET", base + "/agreements/context");
      agreement = await ok("notice-owner", "POST", base + "/agreements", {
        title: "Fictional review package",
        kind: "lease",
        notes: "PRIVATE_PREPARATION_NOT_IN_INBOX",
        documentVersionIds: [document.versionId],
        partyIds: [c.leaseholders[0].id],
        companySignerId: "notice-owner",
        submissionKey: randomUUID(),
      });
      const actAgreement = async (who, name) => {
        const r = await ok(
          `notice-${who}`,
          "GET",
          base + `/agreements/${agreement.agreementId}`,
        );
        return ok(
          `notice-${who}`,
          "POST",
          base + `/agreements/${agreement.agreementId}`,
          {
            action: name,
            expectedVersion: r.agreement.version,
            confirmed: true,
            ...(name !== "submit"
              ? { reason: "Fictional management review" }
              : {}),
            submissionKey: randomUUID(),
          },
        );
      };
      await actAgreement("owner", "submit");
      const notice = await find(
        "manager",
        "Agreement preparation needs review",
      );
      assert.ok(notice);
      assert.ok(
        (await act("manager", notice, "open")).href.includes(
          `agreementId=${agreement.agreementId}`,
        ),
      );
      await actAgreement("manager", "request_changes");
      assert.ok(await find("owner", "Agreement preparation needs changes"));
      await actAgreement("owner", "submit");
      await actAgreement("manager", "approve");
      assert.ok(await find("owner", "Agreement preparation approved"));
      for (const who of ["resident", "other", "staff"])
        assert.equal((await inbox(who, "?type=agreements")).total, 0);
      assert.ok(
        !JSON.stringify(await inbox("manager")).includes("PRIVATE_PREPARATION"),
      );
    },
  );
  await t.test(
    "complete filtered totals and paging happen after source authorization",
    async () => {
      for (let i = 0; i < 28; i++)
        await create({ title: `Fictional queued request ${i}` });
      const all = await inbox("manager", "?type=maintenance"),
        second = await inbox("manager", "?type=maintenance&page=2");
      assert.equal(all.total, 30);
      assert.equal(all.items.length, 25);
      assert.equal(second.items.length, 5);
      assert.equal(
        new Set([...all.items, ...second.items].map((n) => n.id)).size,
        30,
      );
      const before = (await summary("manager")).unread;
      await act("manager", all.items[0], "read");
      assert.equal(
        (await inbox("manager", "?type=maintenance&status=read")).total,
        1,
      );
      assert.equal(
        (await inbox("manager", "?type=maintenance&status=unread")).total,
        29,
      );
      assert.equal((await summary("manager")).unread, before - 1);
      for (const query of [
        "?type=finance",
        "?page=0",
        "?status=sent",
        "?userId=notice-owner",
      ])
        assert.equal(
          (await call("notice-manager", "GET", api + query)).statusCode,
          400,
        );
    },
  );
  await t.test(
    "inactive recipients are not backfilled and generated preventive work publishes once",
    async () => {
      const before = (await inbox("manager")).total;
      await admin.query(
        `UPDATE "User" SET "emailVerified"=false WHERE id='notice-manager'`,
      );
      await create(
        { title: "Fictional intake while recipient inactive" },
        "owner",
      );
      await admin.query(
        `UPDATE "User" SET "emailVerified"=true WHERE id='notice-manager'`,
      );
      assert.equal((await inbox("manager")).total, before);
      const plan = await ok("notice-owner", "POST", "/api/company/preventive", {
        title: "Fictional scheduled filter check",
        description: "Fictional maintenance routine",
        category: "other",
        priority: "normal",
        propertyId: home,
        unitId: null,
        cadence: "monthly",
        timezone: "America/New_York",
        anchorOn: "2026-01-01",
        endOn: null,
        submissionKey: randomUUID(),
      });
      const row = await ok(
          "notice-owner",
          "GET",
          `/api/company/preventive/${plan.planId}`,
        ),
        body = {
          outcome: "generated",
          dueOn: row.nextOn.slice(0, 10),
          expectedVersion: row.version,
          reason: null,
          submissionKey: randomUUID(),
        };
      const made = await ok(
        "notice-owner",
        "POST",
        `/api/company/preventive/${plan.planId}/occurrences`,
        body,
      );
      assert.equal(
        (
          await ok(
            "notice-owner",
            "POST",
            `/api/company/preventive/${plan.planId}/occurrences`,
            body,
          )
        ).requestId,
        made.requestId,
      );
      assert.equal((await inbox("manager")).total, before + 1);
      const n = (await inbox("manager")).items.find(
        (n) => n.sourceTitle === "Fictional scheduled filter check",
      );
      assert.ok(n);
      assert.ok(
        (await act("manager", n, "open")).href.startsWith(
          `/company/maintenance/${made.requestId}?`,
        ),
      );
      assert.equal(
        (await inbox("resident")).items.some(
          (n) => n.sourceTitle === "Fictional scheduled filter check",
        ),
        false,
      );
    },
  );
  await t.test(
    "RLS restricts own inbox and receipts; event/delivery identity and history are immutable",
    async () => {
      const own = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.company_id', ${company}, true)`;
        assert.equal(await tx.inboxNotification.count(), 0);
        await tx.$queryRaw`SELECT set_config('app.notification_user_id', 'notice-resident', true)`;
        const rows = await tx.inboxNotification.findMany();
        assert.ok(rows.length);
        assert.ok(rows.every((r) => r.userId === "notice-resident"));
        assert.equal(
          await tx.notificationAction.count({
            where: { userId: "notice-owner" },
          }),
          0,
        );
        return rows[0];
      });
      assert.equal(await db.inboxNotification.count(), 0);
      for (const sql of [
        `UPDATE "NotificationEvent" SET kind='maintenance.update' WHERE "companyId"='notice-company'`,
        `DELETE FROM "NotificationEvent" WHERE "companyId"='notice-company'`,
        `UPDATE "InboxNotification" SET "userId"='notice-other' WHERE id='${own.id}'`,
        `DELETE FROM "InboxNotification" WHERE id='${own.id}'`,
        `UPDATE "NotificationAction" SET changed=false WHERE "companyId"='notice-company'`,
      ])
        await assert.rejects(
          admin.query(sql),
          /immutable|retained|Only versioned/,
        );
      await assert.rejects(
        admin.query(
          `INSERT INTO "NotificationEvent" (id,"companyId","eventKey",kind,"actorId","propertyId","sourceType","requestId") VALUES ('cross-scope','b','cross-scope','maintenance.created','foreign','foreign-home','maintenance',$1)`,
          [request.id],
        ),
        /foreign key/,
      );
    },
  );
  await t.test(
    "queued reads recheck revoked membership after the authorization fence",
    async () => {
      const leader = await admin.connect();
      try {
        await leader.query("BEGIN");
        await leader.query(
          `UPDATE "User" SET "updatedAt"="updatedAt" WHERE id='notice-manager'`,
        );
        const read = call("notice-manager", "GET", api);
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          if (
            (
              await admin.query(
                `SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`,
              )
            ).rows.length
          ) {
            blocked = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        assert.ok(blocked);
        await leader.query(
          `UPDATE "CompanyMembership" SET role='staff' WHERE "userId"='notice-manager'`,
        );
        await leader.query("COMMIT");
        assert.equal((await read).json().total, 0);
      } finally {
        await leader.query("ROLLBACK");
        leader.release();
        await admin.query(
          `UPDATE "CompanyMembership" SET role='manager' WHERE "userId"='notice-manager'`,
        );
      }
    },
  );
  await t.test(
    "real browser inbox recovers lost committed action, keeps source return, handles conflict and phone layout",
    { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL },
    async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await newFixturePage(browser),
          bodies = [];
        let lose = true;
        await page.route("**/api/**", async (route) => {
          const req = route.request(),
            url = new URL(req.url());
          const response = await app.inject({
            method: req.method(),
            url: url.pathname + url.search,
            headers: {
              ...req.headers(),
              origin: "https://app.test",
              cookie: "__Host-pf-session=token-notice-manager",
            },
            ...(req.postData() ? { payload: req.postData() } : {}),
          });
          if (req.method() === "POST" && url.pathname.startsWith(api + "/")) {
            bodies.push(req.postDataJSON());
            if (lose) {
              lose = false;
              assert.equal(response.statusCode, 200, response.body);
              return route.abort("failed");
            }
          }
          await route.fulfill({
            status: response.statusCode,
            contentType: "application/json",
            body: response.body,
          });
        });
        const origin = process.env.TEST_MAINTENANCE_BROWSER_URL;
        await page.goto(
          origin +
            "/account/notifications?status=unread&type=maintenance&page=1",
        );
        await expect(
          page.getByRole("heading", { name: "Notifications", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("link", { name: /Notifications, \d+ unread/ }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Mark read", exact: true })
          .first()
          .click();
        await expect(
          page.getByRole("button", {
            name: "Retry original action",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByLabel("Read status", { exact: true }),
        ).toBeDisabled();
        await page
          .getByRole("button", { name: "Refresh inbox", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Retry original action", exact: true })
          .click();
        await expect(
          page.getByRole("status").filter({ hasText: "Marked read." }),
        ).toBeVisible();
        assert.deepEqual(bodies[0], bodies[1]);
        await page
          .getByRole("button", { name: "Open source", exact: true })
          .first()
          .click();
        await expect(
          page.getByRole("link", {
            name: "← Back to notifications",
            exact: true,
          }),
        ).toBeVisible();
        assert.ok(page.url().includes("noticeStatus=unread"));
        await page
          .getByRole("link", { name: "← Back to notifications", exact: true })
          .click();
        await expect(
          page.getByLabel("Notification type", { exact: true }),
        ).toHaveValue("maintenance");
        await expect(
          page.getByLabel("Read status", { exact: true }),
        ).toHaveValue("unread");
        const first = (
          await inbox("manager", "?status=unread&type=maintenance")
        ).items[0];
        await act("manager", first, "read");
        await page
          .getByRole("button", { name: "Mark read", exact: true })
          .first()
          .click();
        await expect(
          page.getByRole("alert").filter({ hasText: "This record changed" }),
        ).toBeVisible();
        await page
          .getByLabel("Read status", { exact: true })
          .selectOption("read");
        await page
          .getByRole("button", { name: "Mark unread", exact: true })
          .first()
          .click();
        await expect(
          page.getByRole("status").filter({ hasText: "Marked unread." }),
        ).toBeVisible();
        await page
          .getByLabel("Notification type", { exact: true })
          .selectOption("agreements");
        await page
          .getByLabel("Read status", { exact: true })
          .selectOption("all");
        await page
          .getByRole("button", { name: "Open source", exact: true })
          .first()
          .click();
        await expect(
          page.getByRole("heading", { name: "Agreements", exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Overview", exact: true })
          .click();
        await expect(
          page.getByRole("link", {
            name: "← Back to notifications",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("link", { name: "← Back to notifications", exact: true })
          .click();
        await page
          .getByLabel("Notification type", { exact: true })
          .selectOption("all");
        await page
          .getByRole("button", { name: "Refresh inbox", exact: true })
          .click();
        await expect(page.locator(".notification-card").first()).toBeVisible();
        await expect(
          page.getByRole("status").filter({ hasText: "Loading notifications" }),
        ).toHaveCount(0);
        await page.screenshot({
          path: "docs/acceptance-evidence/notifications-local-desktop-2026-10-19.png",
          fullPage: false,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.locator(".notification-bell .badge")).toBeVisible();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: "docs/acceptance-evidence/notifications-local-mobile-2026-10-19.png",
          fullPage: false,
        });
        for (const width of [320, 768, 1024]) {
          await page.setViewportSize({ width, height: 844 });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `Inbox fits ${width}px`,
          );
        }
      } finally {
        await browser.close();
      }
    },
  );
  await t.test("retained resident creation audits without an intake source still receive safe notices", async () => {
    for (const source of ["legacy", "management", "missing-audit"]) {
      const id = `notice-source-${source}`;
      const title = `Fictional ${source} source request`;
      await admin.query(`INSERT INTO "MaintenanceRequest"(id,"companyId","propertyId","requesterId",title,description,"updatedAt") VALUES($1,$2,$3,'notice-resident',$4,'Private fictional retained request',NOW())`, [id, company, home, title]);
      if (source !== "missing-audit") await admin.query(`INSERT INTO "AuditEvent"(id,"actorId","companyId",action,"targetId",detail,"requestId") VALUES($1,'notice-resident',$2,'maintenance.created',$3,$4::jsonb,$1)`, [`${id}-audit`, company, id, JSON.stringify(source === "legacy" ? {} : { source: "management" })]);
      const before = (await inbox("resident")).total;
      await ok("notice-owner", "PATCH", `/api/company/maintenance/${id}`, { status: "in_progress", expectedVersion: 1 });
      const current = await inbox("resident");
      assert.equal(current.total, before + (source === "legacy" ? 1 : 0));
      assert.equal(current.items.some(row => row.sourceTitle === title), source === "legacy");
      assert.equal((await inbox("other")).items.some(row => row.sourceTitle === title), false);
    }
  });

}
