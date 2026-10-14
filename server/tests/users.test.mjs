import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { chromium, expect } from "@playwright/test";
import { registerApplication } from "../dist/application.js";
import { registerSessions, digest } from "../dist/sessions.js";
import { cents, date } from "../dist/operational.js";
import { synchronizeIdentity } from "../dist/identity-sync.js";
const url = process.env.TEST_USERS_DATABASE_URL;
test(
  "pre-login identity setup, boundaries and verification",
  { skip: !url },
  async (t) => {
    const target = new URL(url);
    assert.equal(target.hostname, "127.0.0.1");
    assert.equal(target.pathname, "/propertyflow_users_test");
    assert.equal(process.env.USERS_DISPOSABLE, "tmpfs-verified");
    const admin = new pg.Pool({ connectionString: url });
    t.after(() => admin.end());
    assert.equal(
      (
        await admin.query(
          `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'`,
        )
      ).rows[0].n,
      0,
    );
    for (const name of readdirSync(
      new URL("../prisma/migrations/", import.meta.url),
    )
      .filter((n) => /^\d/.test(n))
      .sort())
      await admin.query(
        readFileSync(
          new URL(
            `../prisma/migrations/${name}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    await admin.query(
      `ALTER ROLE propertyflow_runtime LOGIN PASSWORD 'users-test-only'`,
    );
    const runtime = new URL(url);
    runtime.username = "propertyflow_runtime";
    runtime.password = "users-test-only";
    const pool = new pg.Pool({ connectionString: runtime.href, max: 8 }),
      db = new PrismaClient({ adapter: new PrismaPg(pool) });
    t.after(async () => {
      await db.$disconnect();
      await pool.end();
    });
    for (const id of ["a", "b"])
      await admin.query(
        `INSERT INTO "Company"(id,name,"updatedAt") VALUES($1,$1,NOW())`,
        [id],
      );
    for (const [id, company, role, platform] of [
      ["owner", "a", "owner", null],
      ["manager", "a", "manager", null],
      ["staff", "a", "staff", null],
      ["resident", "a", "resident", null],
      ["resident2", "a", "resident", null],
      ["foreign", "b", "owner", null],
      ["foreign-resident", "b", "resident", null],
      ["platform", null, null, "owner"],
    ]) {
      await admin.query(
        `INSERT INTO "User"(id,email,"emailVerified","platformRole","updatedAt") VALUES($1,$2,true,$3,NOW())`,
        [id, `${id}@test.invalid`, platform],
      );
      if (company)
        await admin.query(
          `INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,$2,$3,NOW())`,
          [id, company, role],
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
    for (const [id, company] of [
      ["home", "a"],
      ["other-home", "a"],
      ["foreign-home", "b"],
    ])
      await admin.query(
        `INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$1,'street','city','state','zip',$2,NOW())`,
        [id, company],
      );
    await admin.query(
      `INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('a','home','resident'),('a','home','resident2'),('b','foreign-home','foreign-resident')`,
    );
    const remote = new Map();
    let createCalls = 0,
      verificationCalls = 0,
      setupCalls = 0;
    let providerError = false,
      listHook;
    const provider = {
      issuer: "https://unused.auth0.com/",
      databaseConnection: "Username-Password-Authentication",
      async list(page, email) {
        if (providerError) throw Error("provider unavailable");
        const source = [...remote.values()].filter(
          (u) => !email || u.email === email,
        );
        if (listHook) await listHook();
        return {
          users: source.slice(page * 50, page * 50 + 50),
          nextPage:
            (page + 1) * 50 < Math.min(source.length, 1000) ? page + 1 : null,
        };
      },
      async get(id) {
        if (providerError) throw Error("provider unavailable");
        const row = remote.get(id);
        if (!row) throw Error("provider missing");
        return { ...row };
      },
      async create(email, name) {
        createCalls++;
        let row = [...remote.values()].find((u) => u.email === email);
        if (!row) {
          row = {
            user_id: "auth0|" + randomUUID(),
            email,
            email_verified: false,
            name,
            identities: [
              {
                connection: "Username-Password-Authentication",
                provider: "auth0",
              },
            ],
          };
          remote.set(row.user_id, row);
        }
        return { ...row };
      },
      async verify() {
        verificationCalls++;
      },
      async setup() {
        setupCalls++;
      },
    };
    const app = Fastify();
    t.after(() => app.close());
    const auth = await registerSessions(app, db, {
      origin: "https://app.test",
      domain: "unused.auth0.com",
      clientId: "test",
      clientSecret: "test-only",
      secure: true,
    });
    registerApplication(app, db, auth, "https://app.test", provider);
    const call = async (user, method, path, payload, extra = {}) => {
      if (
        payload &&
        method === "PUT" &&
        path.endsWith("/membership") &&
        !Object.hasOwn(payload, "expectedVersion")
      )
        payload = {
          ...payload,
          expectedVersion:
            (
              await db.companyMembership.findUnique({
                where: { userId: decodeURIComponent(path.split("/").at(-2)) },
              })
            )?.version ?? null,
        };
      return app.inject({
        method,
        url: path,
        headers: {
          ...(user ? { cookie: `__Host-pf-session=token-${user}` } : {}),
          origin: "https://app.test",
          "x-csrf-token": "csrf",
          ...extra,
        },
        ...(payload ? { payload } : {}),
      });
    };
    const directory = "/api/platform/identity-users",
      identity = {
        user_id: "auth0|prelogin",
        email: "prelogin@test.invalid",
        email_verified: false,
        name: "Prelogin",
        identities: [
          { connection: "Username-Password-Authentication", provider: "auth0" },
        ],
      };
    remote.set(identity.user_id, identity);
    await t.test(
      "platform-only identity directory and batch setup before first login",
      async () => {
        for (const actor of ["owner", "manager", "staff", "resident"]) {
          assert.equal((await call(actor, "GET", directory)).statusCode, 403);
          assert.equal(
            (
              await call(actor, "POST", directory + "/import", {
                userIds: [identity.user_id],
              })
            ).statusCode,
            403,
          );
        }
        assert.equal(
          (await call("platform", "GET", directory)).json().users.length,
          1,
        );
        for (const extra of [
          { origin: "https://evil.test" },
          { "x-csrf-token": "bad" },
        ])
          assert.equal(
            (
              await call(
                "platform",
                "POST",
                directory + "/import",
                { userIds: [identity.user_id] },
                extra,
              )
            ).statusCode,
            403,
          );
        const result = await call("platform", "POST", directory + "/import", {
          userIds: [identity.user_id],
        });
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(result.json().items[0].emailVerified, false);
        const local = await db.user.findUnique({
          where: { id: identity.user_id },
          include: { identities: true },
        });
        assert.equal(local.firstSignedInAt, null);
        assert.equal(local.platformRole, null);
        assert.equal(local.identities[0].issuer, provider.issuer);
        assert.equal(local.identities[0].subject, identity.user_id);
        assert.ok(local.accessInitializedAt);
        assert.equal(
          (
            await call(
              "platform",
              "PUT",
              `/api/platform/users/${encodeURIComponent(identity.user_id)}/membership`,
              { companyId: "a", role: "manager", status: "active" },
            )
          ).statusCode,
          200,
        );
        assert.equal(
          (
            await db.companyMembership.findUnique({
              where: { userId: identity.user_id },
            })
          ).role,
          "manager",
        );
        await call("platform", "POST", directory + "/import", {
          userIds: [identity.user_id],
        });
        assert.equal(
          (
            await db.companyMembership.findUnique({
              where: { userId: identity.user_id },
            })
          ).role,
          "manager",
        );
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "AuditEvent" WHERE action='user.preprovisioned' AND "targetId"=$1`,
              [identity.user_id],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      "preconfigured unverified account has profile and verification flow, but no protected API access",
      async () => {
        await db.session.create({
          data: {
            tokenHash: digest("token-prelogin"),
            csrfToken: "csrf",
            userId: identity.user_id,
            expiresAt: new Date(Date.now() + 3600000),
            idleExpiresAt: new Date(Date.now() + 3600000),
          },
        });
        const bootstrap = await call("prelogin", "GET", "/api/bootstrap");
        assert.equal(bootstrap.statusCode, 200);
        assert.equal(bootstrap.json().user.emailVerified, false);
        assert.equal(bootstrap.json().membership.role, "manager");
        for (const path of [
          "/api/company/properties",
          "/api/company/leases",
          "/api/company/finances",
        ])
          assert.equal((await call("prelogin", "GET", path)).statusCode, 403);
        assert.equal(
          (await call("prelogin", "POST", "/api/account/verification", {}))
            .statusCode,
          200,
        );
        assert.equal(verificationCalls, 1);
        assert.equal(
          (await call("prelogin", "POST", "/api/account/verification", {}))
            .statusCode,
          429,
        );
        assert.equal(
          (
            await call(
              "prelogin",
              "POST",
              "/api/account/verification-status",
              {},
            )
          ).json().emailVerified,
          false,
        );
        identity.email_verified = true;
        const updated = await call(
          "prelogin",
          "POST",
          "/api/account/verification-status",
          {},
        );
        assert.equal(updated.statusCode, 200, updated.body);
        assert.equal(updated.json().emailVerified, true);
        assert.equal(
          (await call("prelogin", "GET", "/api/company/properties")).statusCode,
          200,
        );
        assert.equal(
          (await call("platform", "GET", "/api/platform/users"))
            .json()
            .find((u) => u.id === identity.user_id).emailVerified,
          true,
        );
      },
    );
    await t.test(
      "creation durable key replay and mismatch, exact identity reuse and blocked status preservation",
      async () => {
        const body = {
            email: "new@test.invalid",
            name: "New User",
            submissionKey: randomUUID(),
          },
          path = "/api/platform/users/provision";
        const first = await call("platform", "POST", path, body);
        assert.equal(first.statusCode, 200, first.body);
        const row = first.json();
        assert.equal(row.platformRole, null);
        assert.equal(row.emailVerified, false);
        assert.equal(verificationCalls, 1);
        assert.equal(setupCalls, 0);
        const replay = await call("platform", "POST", path, body);
        assert.equal(replay.json().id, row.id);
        assert.equal(createCalls, 1);
        assert.equal(
          (await call("platform", "POST", path, { ...body, name: "Changed" }))
            .statusCode,
          409,
        );
        assert.equal(createCalls, 1);
        await db.user.update({
          where: { id: row.id },
          data: { status: "disabled" },
        });
        assert.equal(
          (
            await call("platform", "POST", path, {
              ...body,
              submissionKey: randomUUID(),
            })
          ).json().status,
          "disabled",
        );
        assert.equal(
          (
            await call(
              "platform",
              "POST",
              `/api/platform/users/${encodeURIComponent(row.id)}/password-setup`,
              {},
            )
          ).statusCode,
          200,
        );
        assert.equal(setupCalls, 1);
        assert.equal(
          (
            await call(
              "platform",
              "POST",
              `/api/platform/users/${encodeURIComponent(row.id)}/password-setup`,
              {},
            )
          ).statusCode,
          429,
        );
      },
    );
    await t.test(
      "password setup rejects identities from another database connection",
      async () => {
        const candidate = {
          ...identity,
          user_id: "auth0|other-connection",
          email: "other-db@test.invalid",
          identities: [{ provider: "auth0", connection: "Other-Database" }],
        };
        remote.set(candidate.user_id, candidate);
        assert.equal(
          (
            await call("platform", "POST", directory + "/import", {
              userIds: [candidate.user_id],
            })
          ).statusCode,
          200,
        );
        const before = setupCalls;
        assert.equal(
          (
            await call(
              "platform",
              "POST",
              `/api/platform/users/${encodeURIComponent(candidate.user_id)}/password-setup`,
              {},
            )
          ).statusCode,
          409,
        );
        assert.equal(setupCalls, before);
      },
    );
    await t.test(
      "audit failure rolls back imported account; email collision never links a different subject",
      async () => {
        const candidate = {
          ...identity,
          user_id: "auth0|rollback",
          email: "rollback@test.invalid",
        };
        remote.set(candidate.user_id, candidate);
        await admin.query(
          `CREATE FUNCTION reject_setup_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='user.preprovisioned' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_setup_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_setup_audit()`,
        );
        assert.equal(
          (
            await call("platform", "POST", directory + "/import", {
              userIds: [candidate.user_id],
            })
          ).statusCode,
          500,
        );
        assert.equal(
          await db.user.findUnique({ where: { id: candidate.user_id } }),
          null,
        );
        await admin.query(
          `DROP TRIGGER reject_setup_audit ON "AuditEvent";DROP FUNCTION reject_setup_audit()`,
        );
        assert.equal(
          (
            await call("platform", "POST", directory + "/import", {
              userIds: [candidate.user_id],
            })
          ).statusCode,
          200,
        );
        const duplicate = { ...identity, user_id: "google-oauth2|different" };
        remote.set(duplicate.user_id, duplicate);
        assert.notEqual(
          (
            await call("platform", "POST", directory + "/import", {
              userIds: [duplicate.user_id],
            })
          ).statusCode,
          200,
        );
        assert.equal(
          await db.identity.findUnique({
            where: {
              issuer_subject: {
                issuer: provider.issuer,
                subject: duplicate.user_id,
              },
            },
          }),
          null,
        );
      },
    );
    await t.test(
      "first callback retains preconfigured membership, exact identity and local disabled status",
      async () => {
        const before = await db.user.findUnique({
          where: { id: identity.user_id },
        });
        assert.equal(before.firstSignedInAt, null);
        const result = await db.$transaction((tx) =>
          synchronizeIdentity(tx, provider.issuer, {
            sub: identity.user_id,
            email: identity.email,
            email_verified: true,
            name: "Provider name",
            "https://propertyflow.com/roles": ["admin"],
          }),
        );
        assert.equal(result.user.id, identity.user_id);
        assert.equal(result.user.platformRole, null);
        assert.ok(result.user.firstSignedInAt);
        assert.equal(
          (
            await db.companyMembership.findUnique({
              where: { userId: identity.user_id },
            })
          ).role,
          "manager",
        );
        await assert.rejects(
          db.$transaction((tx) =>
            synchronizeIdentity(tx, "https://different.auth0.com/", {
              sub: identity.user_id,
              email: identity.email,
              email_verified: true,
            }),
          ),
          /issuer mismatch/,
        );
        await db.user.update({
          where: { id: identity.user_id },
          data: { status: "disabled" },
        });
        const disabled = await db.$transaction((tx) =>
          synchronizeIdentity(tx, provider.issuer, {
            sub: identity.user_id,
            email: identity.email,
            email_verified: true,
          }),
        );
        assert.equal(disabled.user.status, "disabled");
        await db.user.update({
          where: { id: identity.user_id },
          data: { status: "active" },
        });
      },
    );
    await t.test(
      "unverified session can log out and switch accounts",
      async () => {
        await db.user.update({
          where: { id: identity.user_id },
          data: { emailVerified: false },
        });
        const result = await call("prelogin", "POST", "/api/auth/logout", {});
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(
          await db.session.findUnique({
            where: { tokenHash: digest("token-prelogin") },
          }),
          null,
        );
        assert.match(result.headers["set-cookie"], /Expires=Thu, 01 Jan 1970/);
        await db.user.update({
          where: { id: identity.user_id },
          data: { emailVerified: true },
        });
      },
    );
    await t.test(
      "directory/config failures and revoked actor do not mutate local accounts",
      async () => {
        const noProvider = Fastify();
        const authMissing = await registerSessions(noProvider, db, {
          origin: "https://app.test",
          domain: "unused.auth0.com",
          clientId: "test",
          clientSecret: "test-only",
          secure: true,
        });
        registerApplication(noProvider, db, authMissing, "https://app.test");
        try {
          const result = await noProvider.inject({
            url: directory,
            headers: { cookie: "__Host-pf-session=token-platform" },
          });
          assert.equal(result.statusCode, 503);
          assert.equal(result.json().code, "IDENTITY_NOT_CONFIGURED");
        } finally {
          await noProvider.close();
        }
        const target = {
          ...identity,
          user_id: "auth0|revoked",
          email: "revoked@test.invalid",
        };
        remote.set(target.user_id, target);
        const original = provider.get;
        provider.get = async (id) => {
          await db.user.update({
            where: { id: "platform" },
            data: { platformRole: null },
          });
          return original(id);
        };
        assert.equal(
          (
            await call("platform", "POST", directory + "/import", {
              userIds: [target.user_id],
            })
          ).statusCode,
          403,
        );
        assert.equal(
          await db.user.findUnique({ where: { id: target.user_id } }),
          null,
        );
        provider.get = original;
        await db.user.update({
          where: { id: "platform" },
          data: { platformRole: "owner" },
        });
      },
    );
    await t.test(
      "verification downgrade wins over queued operational and maintenance authorization",
      async () => {
        const operations = [
          [
            "manager",
            "/api/company/finances",
            {
              propertyId: "home",
              occurredOn: "2026-10-14",
              amount: "1.00",
              kind: "income",
              category: "rent",
              memo: null,
              submissionKey: randomUUID(),
            },
          ],
          [
            "resident",
            "/api/resident/maintenance",
            {
              propertyId: "home",
              title: "Verification race",
              description: "Must not be saved",
              priority: "normal",
              submissionKey: randomUUID(),
            },
          ],
        ];
        for (const [actor, path, body] of operations) {
          const leader = await admin.connect();
          let pending;
          const count = (
            await admin.query(`SELECT count(*)::int n FROM "AuditEvent"`)
          ).rows[0].n;
          try {
            await leader.query("BEGIN");
            await leader.query(
              `UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=$1`,
              [actor],
            );
            pending = call(actor, "POST", path, body);
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
            assert.ok(blocked, path);
            await leader.query(
              `UPDATE "User" SET "emailVerified"=false WHERE id=$1`,
              [actor],
            );
            await leader.query("COMMIT");
            assert.equal((await pending).statusCode, 403, path);
            assert.equal(
              (await admin.query(`SELECT count(*)::int n FROM "AuditEvent"`))
                .rows[0].n,
              count,
            );
          } finally {
            await leader.query("ROLLBACK");
            leader.release();
            if (pending) await pending;
            await admin.query(
              `UPDATE "User" SET "emailVerified"=true WHERE id=$1`,
              [actor],
            );
          }
        }
      },
    );

    await t.test(
      "company profile creation is complete, idempotent, validated and platform-only",
      async () => {
        const body = {
          name: "FAP Test",
          legalName: "FAP LLC",
          contactName: "Operator",
          contactEmail: "OWNER@TEST.INVALID",
          contactPhone: "+1 555 0100",
          website: "https://example.test",
          addressLine1: "1 Main St",
          city: "Philadelphia",
          region: "PA",
          postalCode: "19100",
          country: "us",
          timezone: "America/New_York",
          adminNotes: "Private platform notes",
          submissionKey: randomUUID(),
        };
        const path = "/api/platform/companies";
        for (const actor of ["owner", "manager", "staff", "resident"])
          assert.equal((await call(actor, "POST", path, body)).statusCode, 403);
        for (const patch of [
          { country: "USA" },
          { timezone: "Not/AZone" },
          { contactEmail: "bad" },
          { website: "javascript:alert(1)" },
          { website: "https://user:pass@example.test" },
          { name: " " },
          { adminNotes: "x".repeat(2001) },
          { platformRole: "owner" },
        ])
          assert.equal(
            (await call("platform", "POST", path, { ...body, ...patch }))
              .statusCode,
            400,
          );
        for (const extra of [
          { origin: "https://evil.test" },
          { "x-csrf-token": "bad" },
        ])
          assert.equal(
            (await call("platform", "POST", path, body, extra)).statusCode,
            403,
          );
        const responses = await Promise.all([
          call("platform", "POST", path, body),
          call("platform", "POST", path, body),
        ]);
        for (const r of responses) assert.equal(r.statusCode, 200, r.body);
        const row = responses[0].json();
        assert.equal(responses[1].json().id, row.id);
        assert.equal(row.contactEmail, "owner@test.invalid");
        assert.equal(row.country, "US");
        assert.equal(row.submissionHash, undefined);
        assert.equal(row.version, 1);
        assert.equal(
          (await call("platform", "POST", path, { ...body, name: "Changed" }))
            .statusCode,
          409,
        );
        const changes = { ...body, status: "active", expectedVersion: 1 };
        delete changes.submissionKey;
        const edits = await Promise.all([
          call("platform", "PATCH", path + "/" + row.id, {
            ...changes,
            name: "FAP Updated",
          }),
          call("platform", "PATCH", path + "/" + row.id, {
            ...changes,
            name: "Other edit",
          }),
        ]);
        assert.deepEqual(edits.map((r) => r.statusCode).sort(), [200, 409]);
        const current = (
          await call("platform", "GET", path + "/" + row.id)
        ).json();
        assert.equal(current.version, 2);
        assert.equal(current.contactPhone, body.contactPhone);
        assert.equal(current.adminNotes, body.adminNotes);
        assert.equal(
          (
            await admin.query(
              `SELECT count(*)::int n FROM "AuditEvent" WHERE action='company.created' AND "companyId"=$1`,
              [row.id],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (await call("platform", "POST", path, body)).json().id,
          row.id,
        );
      },
    );
    await t.test(
      "platform-only notes and creation identity never leak through company or bootstrap responses",
      async () => {
        await db.company.update({
          where: { id: "a" },
          data: {
            adminNotes: "Do not expose",
            createdById: "platform",
            submissionKey: randomUUID(),
            submissionHash: "hidden",
          },
        });
        for (const actor of ["owner", "manager", "resident"]) {
          const bootstrap = (await call(actor, "GET", "/api/bootstrap")).json();
          assert.equal(bootstrap.membership.company.adminNotes, undefined);
          assert.equal(bootstrap.membership.company.submissionHash, undefined);
        }
        const company = (await call("owner", "GET", "/api/company")).json();
        assert.equal(company.adminNotes, undefined);
        assert.equal(company.submissionHash, undefined);
      },
    );
    await t.test(
      "stale company assignment cannot silently transfer or overwrite a newer role",
      async () => {
        const id = identity.user_id,
          path = `/api/platform/users/${encodeURIComponent(id)}/membership`,
          old = await db.companyMembership.findUnique({
            where: { userId: id },
          });
        const first = await call("platform", "PUT", path, {
          companyId: "a",
          role: "resident",
          status: "active",
          expectedVersion: old.version,
        });
        assert.equal(first.statusCode, 200, first.body);
        assert.equal(
          (
            await call("platform", "PUT", path, {
              companyId: "b",
              role: "manager",
              status: "active",
              expectedVersion: old.version,
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (await db.companyMembership.findUnique({ where: { userId: id } }))
            .companyId,
          "a",
        );
      },
    );
    await t.test(
      "automatic reconciliation is platform-only, CSRF protected, repeatable and preserves existing access",
      async () => {
        const saved = new Map(remote);
        remote.clear();
        const candidate = {
          ...identity,
          user_id: "auth0|automatic",
          email: "automatic@test.invalid",
          app_metadata: { role: "admin" },
        };
        remote.set(candidate.user_id, candidate);
        const path = "/api/platform/users/sync";
        try {
          await call("platform", "GET", "/api/platform/users");
          assert.equal(
            await db.user.findUnique({ where: { id: candidate.user_id } }),
            null,
            "GET never provisions accounts",
          );
          for (const actor of ["owner", "manager", "staff", "resident"])
            assert.equal(
              (await call(actor, "POST", path, { page: 0 })).statusCode,
              403,
            );
          for (const headers of [
            { origin: "https://evil.test" },
            { "x-csrf-token": "bad" },
          ])
            assert.equal(
              (await call("platform", "POST", path, { page: 0 }, headers))
                .statusCode,
              403,
            );
          for (const body of [
            { page: -1 },
            { page: 20 },
            { page: "0" },
            { page: 0, role: "owner" },
            { email: "bad" },
          ])
            assert.equal(
              (await call("platform", "POST", path, body)).statusCode,
              400,
            );
          await db.user.create({
            data: {
              id: "platform2",
              email: "platform2@test.invalid",
              emailVerified: true,
              platformRole: "owner",
            },
          });
          await db.session.create({
            data: {
              tokenHash: digest("token-platform2"),
              csrfToken: "csrf",
              userId: "platform2",
              expiresAt: new Date(Date.now() + 3600000),
              idleExpiresAt: new Date(Date.now() + 3600000),
            },
          });
          const responses = await Promise.all([
            call("platform", "POST", path, { page: 0 }),
            call("platform", "POST", path, { page: 0 }),
            call("platform2", "POST", path, { page: 0 }),
          ]);
          for (const r of responses) assert.equal(r.statusCode, 200, r.body);
          let row = await db.user.findUnique({
            where: { id: candidate.user_id },
            include: { membership: true },
          });
          assert.equal(row.firstSignedInAt, null);
          assert.equal(row.membership, null);
          assert.equal(row.platformRole, null);
          assert.equal(row.role, "unassigned");
          assert.equal(
            await db.auditEvent.count({
              where: {
                action: "user.preprovisioned",
                targetId: candidate.user_id,
              },
            }),
            1,
          );
          await db.user.update({
            where: { id: candidate.user_id },
            data: {
              status: "disabled",
              name: "Local display name",
              emailVerified: true,
            },
          });
          await db.companyMembership.create({
            data: {
              userId: candidate.user_id,
              companyId: "a",
              role: "staff",
              status: "disabled",
            },
          });
          assert.equal(
            (await call("platform", "POST", path, { page: 0 })).statusCode,
            200,
          );
          row = await db.user.findUnique({
            where: { id: candidate.user_id },
            include: { membership: true },
          });
          assert.equal(row.status, "disabled");
          assert.equal(row.name, "Local display name");
          assert.equal(row.emailVerified, true);
          assert.equal(row.membership.role, "staff");
          assert.equal(row.membership.status, "disabled");
          assert.equal(row.membership.version, 1);
          assert.equal(
            await db.auditEvent.count({
              where: {
                action: "user.preprovisioned",
                targetId: candidate.user_id,
              },
            }),
            1,
          );
        } finally {
          remote.clear();
          for (const [id, u] of saved) remote.set(id, u);
        }
      },
    );
    await t.test(
      "automatic reconciliation paginates, isolates identity conflicts and supports exact email beyond the listing limit",
      async () => {
        const saved = new Map(remote);
        remote.clear();
        const path = "/api/platform/users/sync";
        try {
          remote.set("auth0|email-conflict", {
            ...identity,
            user_id: "auth0|email-conflict",
            email: "owner@test.invalid",
          });
          for (let i = 0; i < 51; i++)
            remote.set(`auth0|automatic-page-${i}`, {
              ...identity,
              user_id: `auth0|automatic-page-${i}`,
              email: `automatic-page-${i}@test.invalid`,
            });
          let r = await call("platform", "POST", path, { page: 0 });
          assert.equal(r.statusCode, 200, r.body);
          assert.equal(r.json().nextPage, 1);
          assert.equal(r.json().conflicts[0].id, "auth0|email-conflict");
          r = await call("platform", "POST", path, { page: 1 });
          assert.equal(r.statusCode, 200, r.body);
          assert.equal(r.json().nextPage, null);
          assert.equal(
            await db.user.count({
              where: { id: { startsWith: "auth0|automatic-page-" } },
            }),
            51,
          );
          assert.equal(
            await db.user.findUnique({ where: { id: "auth0|email-conflict" } }),
            null,
          );
          assert.equal(
            (
              await db.companyMembership.findUnique({
                where: { userId: "owner" },
              })
            ).role,
            "owner",
          );
          // Only the last listing page is reconciled here; exact search can reach
          // a fresh account outside that page without scanning or importing it.
          remote.clear();
          for (let i = 0; i < 1001; i++)
            remote.set(`auth0|limit-${i}`, {
              ...identity,
              user_id: `auth0|limit-${i}`,
              email:
                i === 1000
                  ? "Jane.Doe@test.invalid"
                  : `limit-${i}@test.invalid`,
            });
          r = await call("platform", "POST", path, { page: 19 });
          assert.equal(r.statusCode, 200, r.body);
          assert.equal(r.json().limited, true);
          assert.equal(
            await db.user.findUnique({ where: { id: "auth0|limit-1000" } }),
            null,
          );
          r = await call("platform", "POST", path, {
            page: 0,
            email: "Jane.Doe@test.invalid",
          });
          assert.equal(r.statusCode, 200, r.body);
          assert.equal(r.json().limited, false);
          assert.equal(
            (await db.user.findUnique({ where: { id: "auth0|limit-1000" } }))
              .firstSignedInAt,
            null,
          );
        } finally {
          remote.clear();
          for (const [id, u] of saved) remote.set(id, u);
        }
      },
    );
    await t.test(
      "a failed automatic reconciliation page rolls back its accounts and audit entries together",
      async () => {
        const saved = new Map(remote);
        remote.clear();
        const ids = ["auth0|auto-rollback-a", "auth0|auto-rollback-b"];
        for (const id of ids)
          remote.set(id, {
            ...identity,
            user_id: id,
            email: id.replace("|", "-") + "@test.invalid",
          });
        await admin.query(
          `CREATE FUNCTION reject_sync_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.\"targetId\"='auth0|auto-rollback-b' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END$$; CREATE TRIGGER reject_sync_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_sync_audit()`,
        );
        try {
          assert.equal(
            (
              await call("platform", "POST", "/api/platform/users/sync", {
                page: 0,
              })
            ).statusCode,
            500,
          );
          assert.equal(await db.user.count({ where: { id: { in: ids } } }), 0);
          assert.equal(
            await db.auditEvent.count({ where: { targetId: { in: ids } } }),
            0,
          );
        } finally {
          await admin.query(
            `DROP TRIGGER reject_sync_audit ON "AuditEvent";DROP FUNCTION reject_sync_audit()`,
          );
          remote.clear();
          for (const [id, u] of saved) remote.set(id, u);
        }
      },
    );
    await t.test(
      "provider failure keeps local users available and revoked administrator cannot reconcile after a provider read",
      async () => {
        const path = "/api/platform/users/sync";
        try {
          providerError = true;
          assert.ok(
            (await call("platform", "POST", path, { page: 0 })).statusCode >=
              500,
          );
          assert.equal(
            (await call("platform", "GET", "/api/platform/users")).statusCode,
            200,
          );
          providerError = false;
          listHook = async () => {
            await db.user.update({
              where: { id: "platform" },
              data: { platformRole: null },
            });
          };
          assert.equal(
            (await call("platform", "POST", path, { page: 0 })).statusCode,
            403,
          );
        } finally {
          providerError = false;
          listHook = undefined;
          await db.user.update({
            where: { id: "platform" },
            data: { platformRole: "owner" },
          });
        }
      },
    );
    await t.test("resident profiles are scoped, versioned, private, audited and cleared on transfer", async () => {
      for (const id of ["profile-a","profile-b"]) await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES($1,$1,NOW())`,[id]);
      for (const [id,company,role] of [["profile-owner","profile-a","owner"],["profile-manager","profile-a","manager"],["profile-resident","profile-a","resident"],["profile-foreign","profile-b","owner"]]) {
        await db.user.create({data:{id,email:id+"@test.invalid",emailVerified:true,membership:{create:{companyId:company,role}}}});
        await db.session.create({data:{tokenHash:digest("token-"+id),csrfToken:"csrf",userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
      }
      const path="/api/company/resident-profiles/profile-resident";
      const valid={expectedVersion:1,contactName:"Resident Contact",contactPhone:"555-0100",emergencyContactName:"Emergency Contact",emergencyContactPhone:"555-0101",managementNotes:"Company A private note"};
      for (const actor of ["staff","resident","platform"]) assert.equal((await call(actor,"GET",path)).statusCode,403);
      assert.equal((await call("profile-foreign","GET",path)).statusCode,404);
      assert.equal((await call("profile-manager","GET",path,null,{"x-company-id":"profile-b"})).statusCode,403);
      assert.equal((await call("profile-manager","GET","/api/company/resident-profiles")).json().length,1);
      for(const body of [{...valid,role:"owner"},{...valid,companyId:"profile-b"},{...valid,contactPhone:"x".repeat(41)},{...valid,managementNotes:"x".repeat(2001)}]) assert.equal((await call("profile-manager","PATCH",path,body)).statusCode,400);
      for(const extra of [{origin:"https://evil.test"},{"x-csrf-token":"wrong"}]) assert.equal((await call("profile-manager","PATCH",path,valid,extra)).statusCode,403);
      const saved=await call("profile-manager","PATCH",path,valid);assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().version,2);
      assert.equal((await call("profile-owner","GET",path)).json().contactPhone,"555-0100");
      assert.equal((await call("profile-manager","PATCH",path,{...valid,contactName:"Stale overwrite"})).statusCode,409);
      const bootstrap=(await call("profile-resident","GET","/api/bootstrap")).json();
      for(const key of ["contactName","contactPhone","managementNotes","emergencyContactName","emergencyContactPhone"]) assert.equal(Object.hasOwn(bootstrap.membership,key),false);
      await admin.query(`CREATE FUNCTION reject_profile_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='resident.profile.updated' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_profile_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_profile_audit()`);
      try { assert.equal((await call("profile-manager","PATCH",path,{...valid,expectedVersion:2,contactName:"Must roll back"})).statusCode,500); }
      finally { await admin.query(`DROP TRIGGER reject_profile_audit ON "AuditEvent"; DROP FUNCTION reject_profile_audit()`); }
      assert.equal((await call("profile-owner","GET",path)).json().contactName,"Resident Contact");
      assert.equal((await call("profile-owner","GET",path)).json().version,2);
      const audit=(await call("profile-owner","GET",path)).json().activity;assert.equal(audit.filter(x=>x.action==="resident.profile.updated").length,1);assert.equal(JSON.stringify(audit).includes("private note"),false);
      await db.companyMembership.update({where:{userId:"profile-manager"},data:{status:"disabled"}});
      assert.equal((await call("profile-manager","PATCH",path,{...valid,expectedVersion:2})).statusCode,403);
      const transfer=await call("platform","PUT","/api/platform/users/profile-resident/membership",{companyId:"profile-b",role:"resident",status:"active",expectedVersion:2});assert.equal(transfer.statusCode,200,transfer.body);
      assert.equal((await call("profile-owner","GET",path)).statusCode,404);
      const moved=(await call("profile-foreign","GET",path)).json();assert.equal(moved.contactName,null);assert.equal(moved.managementNotes,null);assert.equal(moved.activity.some(e=>e.action==="resident.profile.updated"),false);
    });
    await t.test("platform profile writes cannot pass a queued administrator revocation", async () => {
      const lock = await admin.connect();let pending;
      try {
        await lock.query("BEGIN");await lock.query(`UPDATE "User" SET "platformRole"=NULL WHERE id='platform'`);
        pending=call("platform","PATCH","/api/platform/users/profile-resident/profile",{name:"Revoked overwrite"});
        let blocked=false;
        for(let attempt=0;attempt<200;attempt++) { if((await admin.query(`SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE '%User%'`)).rows.length){blocked=true;break;} await new Promise(resolve=>setTimeout(resolve,10)); }
        assert.ok(blocked,"profile mutation must wait at the administrator lock");await lock.query("COMMIT");assert.equal((await pending).statusCode,403);
        assert.notEqual((await db.user.findUnique({where:{id:"profile-resident"}})).name,"Revoked overwrite");
      } finally {await lock.query("ROLLBACK");lock.release();if(pending) await pending;await db.user.update({where:{id:"platform"},data:{platformRole:"owner"}});}
    });
    await t.test("platform profile and target activity require platform authority and filter before the limit", async () => {
      const path="/api/platform/users/profile-resident/profile";
      assert.equal((await call("profile-owner","PATCH",path,{name:"Changed"})).statusCode,403);
      assert.equal((await call("platform","PATCH",path,{name:"Changed",platformRole:"owner"})).statusCode,400);
      assert.equal((await call("platform","PATCH",path,{name:"Changed"},{"x-csrf-token":"wrong"})).statusCode,403);
      assert.equal((await call("platform","PATCH",path,{name:"Changed"})).statusCode,200);
      await db.auditEvent.createMany({data:Array.from({length:105},(_,n)=>({id:"unrelated-profile-"+n,actorId:"platform",action:"unrelated",targetId:"someone-else",requestId:"fixture",createdAt:new Date(Date.now()+10000)}))});
      const activity=await call("platform","GET","/api/platform/audit?targetId=profile-resident");assert.equal(activity.statusCode,200);
      assert.ok(activity.json().some(e=>e.action==="user.profile.updated"));assert.equal(activity.json().some(e=>e.action==="unrelated"),false);
      assert.equal((await call("profile-manager","GET","/api/platform/audit?targetId=profile-resident")).statusCode,403);
    });
    await t.test(
      "real browser automatically discovers an Auth0 account with no import action or target sign-in",
      { skip: !process.env.TEST_USERS_BROWSER_URL },
      async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          await page.route("**/api/**", async (route) => {
            const req = route.request(),
              u = new URL(req.url());
            const response = await app.inject({
              method: req.method(),
              url: u.pathname + u.search,
              headers: {
                ...req.headers(),
                origin: "https://app.test",
                cookie: "__Host-pf-session=token-platform",
              },
              ...(req.postData() ? { payload: req.postData() } : {}),
            });
            await route.fulfill({
              status: response.statusCode,
              contentType: "application/json",
              body: response.body,
            });
          });
          const candidate = {
            ...identity,
            user_id: "auth0|browser",
            email: "browser@test.invalid",
            name: "Browser Before Login",
            email_verified: false,
          };
          remote.set(candidate.user_id, candidate);
          await page.goto(
            process.env.TEST_USERS_BROWSER_URL + "/platform/users",
          );
          await expect(
            page.getByRole("row").filter({ hasText: candidate.email }),
          ).toContainText("Awaiting first sign-in");
          const local = await db.user.findUnique({
            where: { id: candidate.user_id },
          });
          assert.equal(local.firstSignedInAt, null);
        } finally {
          await browser.close();
        }
      },
    );
  },
);
