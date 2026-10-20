import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { newFixturePage } from "./browser-fixture.mjs";

export async function agreementCases(t, admin, db, call, app) {
  for (const [id, name] of [
    ["agreement-tenant", "Fictional Primary Leaseholder"],
    ["agreement-second", "Fictional Second Leaseholder"],
    ["agreement-occupant", "Fictional Occupant"],
    ["agreement-replacement", "Fictional Replacement Leaseholder"],
  ]) {
    await admin.query(
      'INSERT INTO "User" (id,name,email,"emailVerified","updatedAt") VALUES ($1,$2,$3,false,NOW())',
      [id, name, `${id}@test.invalid`],
    );
    await admin.query(
      'INSERT INTO "CompanyMembership" ("userId","companyId",role,"updatedAt") VALUES ($1,\'a\',\'resident\',NOW())',
      [id],
    );
  }
  await admin.query(
    `INSERT INTO "Unit" (id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES ('agreement-unit','a','home','Fictional agreement suite','owner','agreement-unit','fixture',NOW())`,
  );
  await admin.query(
    `INSERT INTO "Lease" (id,"companyId","propertyId","unitId","createdById","residentId","startsOn","endsOn","rentCents",status,"submissionKey","submissionHash","updatedAt") VALUES ('agreement-lease','a','home','agreement-unit','owner','agreement-tenant','2026-10-01','2027-09-30',100000,'active','agreement-lease','fixture',NOW())`,
  );
  for (const [id, userId, role] of [
    ["agreement-party", "agreement-second", "leaseholder"],
    ["agreement-occupant-party", "agreement-occupant", "occupant"],
  ])
    await admin.query(
      `INSERT INTO "LeaseParticipant" (id,"companyId","propertyId","leaseId","userId",name,email,role,"startsOn","portalApproved","createdById","submissionKey","submissionHash","updatedAt") VALUES ($1,'a','home','agreement-lease',$2,$2,$3,$4,'2026-10-01',false,'owner',$1,'fixture',NOW())`,
      [id, userId, `${userId}@test.invalid`, role],
    );
  const base = "/api/company/leases/agreement-lease/agreements",
    docs = "/api/company/leases/agreement-lease/documents";
  const ok = async (...args) => {
    const r = await call(...args);
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const detail = (id) => ok("manager", "GET", `${base}/${id}`);
  const file = await ok("manager", "POST", docs, {
    title: "Agreement original",
    filename: "unsigned-agreement.txt",
    mediaType: "text/plain",
    contentBase64: Buffer.from(
      "Fictional unsigned agreement for isolated tests only.",
    ).toString("base64"),
    submissionKey: randomUUID(),
  });
  const primaryPartyId = (
    await ok("manager", "GET", `${base}/context`)
  ).leaseholders.find((p) => p.userId === "agreement-tenant").id;
  const make = (patch = {}) => ({
    title: "Fictional lease package",
    kind: "lease",
    notes: "Private fictional preparation note",
    documentVersionIds: [file.versionId],
    partyIds: [primaryPartyId, "agreement-party"],
    companySignerId: "owner",
    submissionKey: randomUUID(),
    ...patch,
  });
  const edit = async (id, patch = {}) => {
    const row = (await detail(id)).agreement;
    return {
      action: "edit",
      title: row.title,
      kind: row.kind,
      ...row.package,
      expectedVersion: row.version,
      submissionKey: randomUUID(),
      ...patch,
    };
  };
  const act = async (id, action, patch = {}, actor = "manager") =>
    ok(actor, "POST", `${base}/${id}`, {
      action,
      expectedVersion: (await detail(id)).agreement.version,
      confirmed: true,
      submissionKey: randomUUID(),
      ...(action !== "submit"
        ? { reason: "Fictional reviewed preparation" }
        : {}),
      ...patch,
    });
  const money = async () =>
    (
      await admin.query(
        `SELECT (SELECT count(*) FROM "RentCharge")::int charges,(SELECT count(*) FROM "LedgerEntry")::int ledger,(SELECT count(*) FROM "LeaseMovement")::int movements,(SELECT count(*) FROM "Invitation")::int invitations,(SELECT count(*) FROM "ResidentPropertyAssignment")::int assignments`,
      )
    ).rows[0];
  const beforeMoney = await money();
  let id, secondFile;

  await t.test(
    "agreement context uses exact recorded accounts, keeps occupants out and grants no access",
    async () => {
      const c = await ok("manager", "GET", `${base}/context`);
      assert.deepEqual(c.leaseholders.map((p) => p.id).sort(), [
        "agreement-party",
        primaryPartyId,
      ]);
      assert.equal(
        c.leaseholders.find((p) => p.id === primaryPartyId).emailVerified,
        false,
      );
      assert.ok(c.companySigners.some((s) => s.userId === "owner"));
      assert.ok(c.companySigners.some((s) => s.userId === "manager"));
      assert.equal(c.signature.state, "not_configured");
      assert.equal(c.signature.signed, false);
      assert.equal(
        (
          await admin.query(
            'SELECT "portalApproved" FROM "LeaseParticipant" WHERE id=\'agreement-party\'',
          )
        ).rows[0].portalApproved,
        false,
      );
      for (const role of ["staff", "resident", "other"])
        for (const suffix of ["", "/context"])
          assert.equal(
            (await call(role, "GET", base + suffix)).statusCode,
            403,
          );
      assert.equal(
        (await call("foreign", "GET", `${base}/context`)).statusCode,
        404,
      );
      assert.equal(
        (await call("manager", "GET", base, null, { "x-company-id": "b" }))
          .statusCode,
        403,
      );
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
    },
  );
  await t.test(
    "preparation validates source fields, retains quarantine and requires deliberate review",
    async () => {
      for (const patch of [
        { status: "signed" },
        { source: { lease: { version: 900 } } },
        { companyId: "b" },
        { kind: "signed" },
        { partyIds: ["agreement-occupant-party"] },
        { companySignerId: "foreign" },
        { documentVersionIds: ["missing"] },
        { documentVersionIds: [file.versionId, file.versionId] },
      ])
        assert.equal(
          (await call("manager", "POST", base, make(patch))).statusCode,
          400,
        );
      assert.equal(
        (await call("manager", "POST", base, make(), { "x-csrf-token": "bad" }))
          .statusCode,
        403,
      );
      assert.equal(
        (await call("manager", "GET", base + "?page=0")).statusCode,
        400,
      );
      assert.equal(
        (await call("manager", "GET", base + "?status=signed")).statusCode,
        400,
      );
      assert.equal(
        (await call("manager", "GET", base + "?unknown=true")).statusCode,
        400,
      );
      const pending = await ok(
        "manager",
        "POST",
        base,
        make({ title: "Quarantined draft" }),
      );
      let d = await detail(pending.agreementId);
      assert.equal(d.agreement.status, "preparing");
      assert.ok(d.blockers.some((b) => b.includes("scanning")));
      assert.equal(d.signature.signed, false);
      assert.equal(
        (
          await call("manager", "POST", `${base}/${pending.agreementId}`, {
            action: "submit",
            expectedVersion: 1,
            confirmed: true,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      const incomplete = await ok(
        "manager",
        "POST",
        base,
        make({
          title: "Incomplete preparation",
          documentVersionIds: [],
          partyIds: [],
          companySignerId: null,
        }),
      );
      assert.equal((await detail(incomplete.agreementId)).blockers.length, 3);
      await ok(
        "manager",
        "POST",
        `${docs}/${file.documentId}/versions/${file.versionId}/scan`,
        {},
      );
      d = await detail(pending.agreementId);
      assert.equal(d.sourceChanged, true);
      assert.equal(d.blockers.length, 0);
    },
  );
  await t.test(
    "concurrent agreement saves recover one package/version/audit and reject altered replay",
    async () => {
      const payload = make();
      const responses = await Promise.all(
        Array.from({ length: 3 }, () => call("manager", "POST", base, payload)),
      );
      for (const r of responses) assert.equal(r.statusCode, 200, r.body);
      assert.equal(new Set(responses.map((r) => r.json().agreementId)).size, 1);
      id = responses[0].json().agreementId;
      assert.equal(
        (
          await ok("manager", "POST", base, {
            ...payload,
            submissionKey: payload.submissionKey.toUpperCase(),
          })
        ).agreementId,
        id,
      );
      assert.equal(
        (
          await call("manager", "POST", base, {
            ...payload,
            title: "Changed payload",
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int n FROM "AuditEvent" WHERE action='agreement.create' AND "targetId"=$1`,
            [id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (await call("foreign", "GET", `${base}/${id}`)).statusCode,
        404,
      );
      assert.equal(
        (
          await call(
            "manager",
            "GET",
            `/api/company/leases/document-lease/agreements/${id}`,
          )
        ).statusCode,
        404,
      );
      const wrong = await ok(
        "manager",
        "POST",
        "/api/company/leases/document-lease/documents",
        {
          title: "Wrong agreement source",
          filename: "wrong.txt",
          mediaType: "text/plain",
          contentBase64: Buffer.from("Wrong lease").toString("base64"),
          submissionKey: randomUUID(),
        },
      );
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            base,
            make({ documentVersionIds: [wrong.versionId] }),
          )
        ).statusCode,
        400,
      );
    },
  );
  await t.test(
    "review captures an immutable unsigned package, requires confirmation and cannot fabricate signatures",
    async () => {
      assert.equal(
        (
          await call("manager", "POST", `${base}/${id}`, {
            action: "submit",
            expectedVersion: 1,
            confirmed: false,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        400,
      );
      await act(id, "submit");
      assert.equal(
        (
          await call("manager", "POST", `${base}/${id}`, {
            action: "approve",
            expectedVersion: 2,
            confirmed: true,
            reason: "",
            submissionKey: randomUUID(),
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (await call("manager", "POST", `${base}/${id}`, await edit(id)))
          .statusCode,
        409,
      );
      const payload = {
        action: "approve",
        expectedVersion: 2,
        reason: "Fictional package reviewed",
        confirmed: true,
        submissionKey: randomUUID(),
      };
      await ok("manager", "POST", `${base}/${id}`, payload);
      await ok("manager", "POST", `${base}/${id}`, payload);
      const d = await detail(id);
      assert.equal(d.agreement.status, "reviewed");
      assert.equal(d.agreement.version, 3);
      assert.equal(d.revisions.length, 3);
      assert.equal(d.signature.signed, false);
      assert.equal(d.agreement.source.files[0].id, file.versionId);
      assert.equal(d.agreement.source.parties[0].userId, "agreement-second");
      for (const row of [d.agreement, ...d.revisions])
        for (const key of [
          "submissionKey",
          "submissionHash",
          "sourceHash",
          "content",
          "contentBase64",
        ])
          assert.ok(!Object.hasOwn(row, key), key);
      for (const action of ["send", "sign", "decline", "expire"])
        assert.equal(
          (
            await call("manager", "POST", `${base}/${id}`, {
              action,
              expectedVersion: 3,
              confirmed: true,
              submissionKey: randomUUID(),
            })
          ).statusCode,
          400,
        );
      assert.equal(
        (
          await call("manager", "POST", `${base}/${id}/send`, {
            submissionKey: randomUUID(),
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await call("manager", "POST", `${base}/${id}`, {
            action: "approve",
            expectedVersion: 3,
            title: "Injected replacement",
            confirmed: true,
            reason: "bad",
            submissionKey: randomUUID(),
          })
        ).statusCode,
        400,
      );
      assert.deepEqual(await money(), beforeMoney);
    },
  );
  await t.test(
    "recorded primary and additional leaseholders keep signer identity across same-company role changes",
    async () => {
      const original = await detail(id);
      assert.equal(original.sourceChanged, false);
      for (const userId of ["agreement-tenant", "agreement-second"]) {
        try {
          for (const role of ["staff", "manager", "owner"]) {
            await admin.query(
              'UPDATE "CompanyMembership" SET role=$1 WHERE "userId"=$2',
              [role, userId],
            );
            const c = await ok("manager", "GET", `${base}/context`),
              d = await detail(id);
            assert.ok(
              c.leaseholders.some((p) => p.userId === userId),
              `${userId} remains a signer as ${role}`,
            );
            assert.equal(d.sourceChanged, false);
            assert.equal(d.blockers.length, 0);
            assert.deepEqual(
              d.agreement.source.parties,
              original.agreement.source.parties,
            );
          }
          await admin.query(
            'UPDATE "CompanyMembership" SET role=\'resident\' WHERE "userId"=$1',
            [userId],
          );
          for (const update of [
            'UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=$1',
            'UPDATE "CompanyMembership" SET "companyId"=\'b\' WHERE "userId"=$1',
            "UPDATE \"User\" SET status='disabled' WHERE id=$1",
          ]) {
            await admin.query(update, [userId]);
            const c = await ok("manager", "GET", `${base}/context`),
              d = await detail(id);
            assert.ok(!c.leaseholders.some((p) => p.userId === userId));
            assert.ok(d.blockers.some((b) => b.includes("leaseholder")));
            assert.equal(
              (await call("manager", "POST", base, make())).statusCode,
              400,
            );
            await admin.query(
              'UPDATE "CompanyMembership" SET status=\'active\',"companyId"=\'a\' WHERE "userId"=$1',
              [userId],
            );
            await admin.query(
              "UPDATE \"User\" SET status='active' WHERE id=$1",
              [userId],
            );
          }
        } finally {
          await admin.query(
            "UPDATE \"CompanyMembership\" SET role='resident',status='active',\"companyId\"='a' WHERE \"userId\"=$1",
            [userId],
          );
          await admin.query("UPDATE \"User\" SET status='active' WHERE id=$1", [
            userId,
          ]);
        }
      }
    },
  );
  await t.test(
    "lease and replacement-document changes invalidate reviews without replacing old originals",
    async () => {
      await admin.query(
        'UPDATE "Lease" SET "rentCents"="rentCents"+100,version=version+1 WHERE id=\'agreement-lease\'',
      );
      let d = await detail(id);
      assert.equal(d.sourceChanged, true);
      assert.equal(d.agreement.source.lease.rentCents, 100000);
      assert.equal(d.currentSource.lease.rentCents, 100100);
      await act(id, "reopen");
      await ok("manager", "POST", `${base}/${id}`, await edit(id));
      await act(id, "submit");
      secondFile = await ok("manager", "POST", docs, {
        title: "Agreement original",
        filename: "replacement-agreement.txt",
        mediaType: "text/plain",
        contentBase64: Buffer.from("Fictional pending replacement").toString(
          "base64",
        ),
        documentId: file.documentId,
        expectedVersion: 1,
        submissionKey: randomUUID(),
      });
      d = await detail(id);
      assert.equal(d.sourceChanged, true);
      assert.equal(d.agreement.source.files[0].id, file.versionId);
      assert.equal(d.currentSource.files[0].latest.id, secondFile.versionId);
      assert.equal(
        (
          await call("manager", "POST", `${base}/${id}`, {
            action: "approve",
            expectedVersion: d.agreement.version,
            reason: "Stale approval",
            confirmed: true,
            submissionKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
      await act(id, "request_changes");
      await ok("manager", "POST", `${base}/${id}`, await edit(id));
      d = await detail(id);
      assert.equal(d.sourceChanged, false);
      assert.equal(d.blockers.length, 0);
      assert.equal(d.agreement.source.files[0].id, file.versionId);
      assert.equal(d.agreement.source.files[0].latest.scanStatus, "pending");
      await act(id, "submit");
      await act(id, "approve");
      await ok(
        "manager",
        "POST",
        `${docs}/${file.documentId}/versions/${secondFile.versionId}/scan`,
        {},
      );
      assert.equal((await detail(id)).sourceChanged, true);
      assert.equal(
        (
          await call(
            "manager",
            "POST",
            base,
            make({
              documentVersionIds: [file.versionId, secondFile.versionId],
            }),
          )
        ).statusCode,
        400,
      );
    },
  );
  await t.test(
    "changing the primary account cannot retarget a retained intended signer",
    async () => {
      await admin.query(
        `UPDATE "Lease" SET "residentId"='agreement-replacement',version=version+1 WHERE id='agreement-lease'`,
      );
      try {
        const d = await detail(id),
          c = await ok("manager", "GET", `${base}/context`);
        assert.equal(d.sourceChanged, true);
        assert.equal(
          d.agreement.source.parties.find((p) => p.id === primaryPartyId)
            .userId,
          "agreement-tenant",
        );
        assert.ok(
          c.leaseholders.some(
            (p) =>
              p.userId === "agreement-replacement" && p.id !== primaryPartyId,
          ),
        );
        assert.ok(!c.leaseholders.some((p) => p.id === primaryPartyId));
        assert.ok(d.blockers.some((b) => b.includes("leaseholder")));
        assert.equal(
          (await call("manager", "POST", base, make())).statusCode,
          400,
        );
      } finally {
        await admin.query(
          `UPDATE "Lease" SET "residentId"='agreement-tenant',version=version+1 WHERE id='agreement-lease'`,
        );
      }
    },
  );
  await t.test(
    "signer records, membership and archiving invalidate preparation while preserving review history",
    async () => {
      await act(id, "reopen");
      await ok("manager", "POST", `${base}/${id}`, await edit(id));
      await act(id, "submit");
      await admin.query(
        "UPDATE \"User\" SET email='changed-signer@test.invalid' WHERE id='agreement-second'",
      );
      let d = await detail(id);
      assert.equal(d.sourceChanged, true);
      assert.equal(
        d.agreement.source.parties[0].email,
        "agreement-second@test.invalid",
      );
      assert.equal(
        d.currentSource.parties[0].email,
        "changed-signer@test.invalid",
      );
      await admin.query(
        'UPDATE "LeaseParticipant" SET "removedAt"=NOW(),version=version+1 WHERE id=\'agreement-party\'',
      );
      d = await detail(id);
      assert.ok(d.blockers.some((b) => b.includes("leaseholder")));
      await act(id, "request_changes");
      assert.equal(
        (await call("manager", "POST", `${base}/${id}`, await edit(id)))
          .statusCode,
        400,
      );
      await admin.query(
        'UPDATE "LeaseParticipant" SET "removedAt"=NULL WHERE id=\'agreement-party\'',
      );
      await ok("manager", "POST", `${base}/${id}`, await edit(id));
      await admin.query(
        "UPDATE \"CompanyMembership\" SET role='staff' WHERE \"userId\"='owner'",
      );
      try {
        d = await detail(id);
        assert.equal(d.sourceChanged, true);
        assert.ok(d.blockers.some((b) => b.includes("company signer")));
      } finally {
        await admin.query(
          "UPDATE \"CompanyMembership\" SET role='owner' WHERE \"userId\"='owner'",
        );
      }
      await ok("manager", "PATCH", `${docs}/${file.documentId}`, {
        archived: true,
        expectedVersion: 2,
      });
      d = await detail(id);
      assert.ok(d.blockers.some((b) => b.includes("Restore")));
      assert.equal(d.agreement.source.files[0].archivedAt, null);
      await ok("manager", "PATCH", `${docs}/${file.documentId}`, {
        archived: false,
        expectedVersion: 3,
      });
      await ok("manager", "POST", `${base}/${id}`, await edit(id));
      await act(id, "submit");
      const version = (await detail(id)).agreement.version;
      const results = await Promise.all(
        ["manager", "owner"].map((actor) =>
          call(actor, "POST", `${base}/${id}`, {
            action: "approve",
            expectedVersion: version,
            confirmed: true,
            reason: "Concurrent management review",
            submissionKey: randomUUID(),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
      assert.equal((await detail(id)).agreement.status, "reviewed");
    },
  );
  await t.test(
    "cancellation and reopening retain every review and cannot overwrite newer versions",
    async () => {
      const prior = (await detail(id)).agreement;
      const payload = {
        action: "cancel",
        expectedVersion: prior.version,
        confirmed: true,
        reason: "Fictional preparation cancelled",
        submissionKey: randomUUID(),
      };
      await ok("manager", "POST", `${base}/${id}`, payload);
      await ok("manager", "POST", `${base}/${id}`, payload);
      assert.equal((await detail(id)).agreement.status, "cancelled");
      assert.equal(
        (await ok("manager", "GET", base + "?status=cancelled")).total,
        1,
      );
      await act(id, "reopen");
      assert.equal(
        (await ok("manager", "POST", `${base}/${id}`, payload)).recovered,
        true,
      );
      assert.equal((await detail(id)).agreement.status, "preparing");
      const stale = await edit(id);
      await ok("manager", "POST", `${base}/${id}`, {
        ...stale,
        notes: "Newer retained note",
      });
      assert.equal(
        (
          await call("manager", "POST", `${base}/${id}`, {
            ...stale,
            submissionKey: randomUUID(),
            notes: "Stale overwrite",
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (await detail(id)).agreement.package.notes,
        "Newer retained note",
      );
    },
  );
  await t.test(
    "agreement history/original links are immutable and company-scoped in PostgreSQL",
    async () => {
      const d = await detail(id),
        revision = d.revisions[0];
      await assert.rejects(
        admin.query(
          "UPDATE \"AgreementRevision\" SET reason='changed' WHERE id=$1",
          [revision.id],
        ),
        /immutable/,
      );
      await assert.rejects(
        admin.query('DELETE FROM "AgreementFile" WHERE "revisionId"=$1', [
          revision.id,
        ]),
        /immutable/,
      );
      await assert.rejects(
        admin.query(
          'INSERT INTO "AgreementFile" ("revisionId","companyId","versionId") VALUES ($1,\'b\',$2)',
          [revision.id, secondFile.versionId],
        ),
        /foreign key/,
      );
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.company_id','b',true)`;
        assert.equal(await tx.leaseAgreement.count({ where: { id } }), 0);
        assert.equal(
          await tx.agreementRevision.count({ where: { agreementId: id } }),
          0,
        );
        assert.equal(
          await tx.agreementFile.count({
            where: { versionId: file.versionId },
          }),
          0,
        );
      });
      assert.deepEqual(await money(), beforeMoney);
    },
  );
  await t.test(
    "audit failures roll back package, history, originals and retry identity together",
    async () => {
      const prior = (await detail(id)).agreement,
        payload = await edit(id, { notes: "Atomic failure fixture" });
      await admin.query(
        `CREATE FUNCTION reject_agreement_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'agreement.%' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_agreement_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_agreement_audit()`,
      );
      try {
        assert.equal(
          (await call("manager", "POST", `${base}/${id}`, payload)).statusCode,
          500,
        );
        assert.equal((await detail(id)).agreement.version, prior.version);
        assert.equal(
          (
            await admin.query(
              'SELECT count(*)::int n FROM "AgreementRevision" WHERE "submissionKey"=$1',
              [payload.submissionKey],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await admin.query(
          'DROP TRIGGER reject_agreement_audit ON "AuditEvent"; DROP FUNCTION reject_agreement_audit()',
        );
      }
      await ok("manager", "POST", `${base}/${id}`, payload);
      assert.equal(
        (await detail(id)).agreement.package.notes,
        "Atomic failure fixture",
      );
    },
  );
  await t.test(
    "directory search/status counts precede paging, history is complete, and access is fresh on replay",
    async () => {
      for (
        let current = (await detail(id)).agreement.version;
        current < 28;
        current++
      )
        await ok(
          "manager",
          "POST",
          `${base}/${id}`,
          await edit(id, { notes: `Retained history fixture ${current}` }),
        );
      for (let i = 0; i < 27; i++)
        await ok(
          "manager",
          "POST",
          base,
          make({
            title: `Paging agreement ${String(i).padStart(2, "0")}`,
            documentVersionIds: [],
            partyIds: [],
            companySignerId: null,
          }),
        );
      const first = await ok("manager", "GET", base + "?q=Paging"),
        second = await ok("manager", "GET", base + "?q=Paging&page=2");
      assert.equal(first.total, 27);
      assert.equal(first.items.length, 25);
      assert.equal(second.items.length, 2);
      assert.equal(
        new Set([...first.items, ...second.items].map((r) => r.id)).size,
        27,
      );
      const d = await detail(id),
        older = await ok(
          "manager",
          "GET",
          `${base}/${id}?beforeVersion=${d.nextBeforeVersion}`,
        );
      assert.equal(d.revisions.length, 25);
      assert.ok(older.revisions.length > 0);
      assert.equal(
        new Set([...d.revisions, ...older.revisions].map((r) => r.version))
          .size,
        d.agreement.version,
      );
      assert.equal(older.nextBeforeVersion, null);
      const payload = make({ title: "Fresh access receipt" });
      await ok("manager", "POST", base, payload);
      await admin.query(
        `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`,
      );
      try {
        assert.equal(
          (await call("manager", "POST", base, payload)).statusCode,
          403,
        );
        assert.equal(
          (await call("manager", "GET", `${base}/${id}`)).statusCode,
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
    "real browser prepares, recovers, reviews and follows exact originals without signatures",
    { skip: !process.env.TEST_MAINTENANCE_BROWSER_URL },
    async () => {
      const newFile = await ok("manager", "POST", docs, {
        title: "Agreement original",
        filename: "newer-quarantined.txt",
        mediaType: "text/plain",
        contentBase64: Buffer.from(
          "Newer fictional quarantined original",
        ).toString("base64"),
        documentId: file.documentId,
        expectedVersion: 4,
        submissionKey: randomUUID(),
      });
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await newFixturePage(browser);
        let lose = true;
        const keys = [];
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
          if (req.method() === "POST" && u.pathname === base) {
            keys.push(req.postDataJSON().submissionKey);
            assert.equal(response.statusCode, 200, response.body);
            if (lose) {
              lose = false;
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
          process.env.TEST_MAINTENANCE_BROWSER_URL +
            "/company/leases/agreement-lease?section=agreements",
        );
        await page
          .getByRole("button", { name: "Prepare agreement", exact: true })
          .click();
        await page
          .getByLabel("Agreement document", { exact: true })
          .selectOption(file.documentId);
        await page
          .getByLabel("Agreement original version", { exact: true })
          .selectOption(file.versionId);
        await page
          .getByRole("button", { name: "Use document version", exact: true })
          .click();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page
          .getByRole("button", { name: "Save draft & close", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Resume agreement form", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Remove Agreement original version 1",
            exact: true,
          })
          .click();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page
          .getByRole("button", { name: "Close without saving", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Prepare agreement", exact: true })
          .click();
        await page
          .getByLabel("Agreement title", { exact: true })
          .fill("Fictional Browser Agreement");
        await page
          .getByLabel("Agreement type", { exact: true })
          .selectOption("addendum");
        await page
          .getByLabel("Agreement document", { exact: true })
          .selectOption(file.documentId);
        await page
          .getByLabel("Agreement original version", { exact: true })
          .selectOption(file.versionId);
        await page
          .getByRole("button", { name: "Use document version", exact: true })
          .click();
        await page
          .getByRole("checkbox", { name: /Fictional Primary Leaseholder/ })
          .check();
        await page
          .getByLabel("Intended company signer", { exact: true })
          .selectOption("owner");
        await page
          .getByLabel("Agreement preparation notes", { exact: true })
          .fill("Private fictional browser preparation");
        await page
          .getByRole("button", { name: "Save agreement version", exact: true })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(
          page.getByLabel("Agreement title", { exact: true }),
        ).toBeDisabled();
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page
          .getByRole("button", { name: "Close & keep recovery", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Resume agreement form", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Save agreement version", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Fictional Browser Agreement",
            exact: true,
          }),
        ).toBeVisible();
        assert.equal(keys.length, 2);
        assert.equal(keys[0], keys[1]);
        await page
          .getByRole("button", {
            name: "Submit package for review",
            exact: true,
          })
          .click();
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "Request package review", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Approve preparation", exact: true })
          .click();
        await page
          .getByLabel("Agreement review reason", { exact: true })
          .fill("Fictional preparation reviewed; still unsigned");
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", {
            name: "Confirm preparation approval",
            exact: true,
          })
          .click();
        await expect(
          page
            .getByRole("article")
            .getByText("Reviewed · unsigned", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("searchbox", { name: "Search agreements", exact: true })
          .fill("Browser");
        await expect(
          page.getByText("1 matching agreement", { exact: true }),
        ).toBeVisible();
        const popupPromise = page.waitForEvent("popup");
        await page
          .getByRole("link", {
            name: /Agreement original · version 1 · unsigned-agreement.txt/,
          })
          .first()
          .click();
        const original = await popupPromise;
        await expect(
          original.getByRole("heading", {
            name: "Agreement original",
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
            name: "Download version 3",
            exact: true,
          }),
        ).toHaveCount(0);
        await original
          .getByRole("button", { name: "Agreements", exact: true })
          .click();
        await expect(
          original.getByRole("heading", {
            name: "Fictional Browser Agreement",
            exact: true,
          }),
        ).toBeVisible();
        assert.equal(
          new URL(original.url()).searchParams.get("agreementQ"),
          "Browser",
        );
        await original.close();
        await page.screenshot({
          path: "/tmp/pf-agreements-desktop.png",
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({
          path: "/tmp/pf-agreements-mobile.png",
          fullPage: true,
        });
        const browserId = new URL(page.url()).searchParams.get("agreementId");
        assert.ok(browserId);
        await admin.query(
          'UPDATE "Lease" SET version=version+1,"rentCents"="rentCents"+100 WHERE id=\'agreement-lease\'',
        );
        await page.reload();
        await expect(
          page.getByRole("heading", {
            name: "Preparation review is out of date",
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Reopen preparation", exact: true })
          .click();
        await page
          .getByLabel("Agreement review reason", { exact: true })
          .fill("Review changed lease source");
        await page.getByRole("checkbox").check();
        await page
          .getByRole("button", { name: "Reopen with reason", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Edit package & refresh sources",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", { name: "Save agreement version", exact: true })
          .click();
        await expect(
          page.getByRole("button", {
            name: "Submit package for review",
            exact: true,
          }),
        ).toBeEnabled();
        await page
          .getByRole("button", {
            name: "Edit package & refresh sources",
            exact: true,
          })
          .click();
        await page
          .getByLabel("Agreement preparation notes", { exact: true })
          .fill("Unsubmitted fictional edit");
        await ok(
          "owner",
          "POST",
          `${base}/${browserId}`,
          await edit(browserId, {
            notes: "Another manager saved a new version",
          }),
        );
        await page
          .getByRole("button", { name: "Save agreement version", exact: true })
          .click();
        await expect(page.getByRole("alert")).toContainText("record changed");
        await expect(
          page.getByLabel("Agreement preparation notes", { exact: true }),
        ).toHaveValue("Unsubmitted fictional edit");
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page
          .getByRole("button", { name: "Close without saving", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Edit package & refresh sources",
            exact: true,
          })
          .click();
        await page
          .getByLabel("Agreement preparation notes", { exact: true })
          .fill("Revoked draft fixture");
        await admin.query(
          `UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='manager'`,
        );
        try {
          await page
            .getByRole("button", {
              name: "Save agreement version",
              exact: true,
            })
            .click();
          await expect(page.getByRole("alert")).toContainText(
            "Agreement access is unavailable",
          );
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(
            page.getByRole("heading", {
              name: "Fictional Browser Agreement",
              exact: true,
            }),
          ).toHaveCount(0);
        } finally {
          await admin.query(
            `UPDATE "CompanyMembership" SET status='active' WHERE "userId"='manager'`,
          );
        }
        assert.deepEqual(await money(), beforeMoney);
        assert.equal((await detail(browserId)).signature.signed, false);
        assert.ok(newFile.versionId);
      } finally {
        await browser.close();
      }
    },
  );
}
