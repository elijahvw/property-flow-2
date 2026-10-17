// Local-only full application preview. This entry point is never imported by
// the production server or Docker image. It cannot accept a database URL.
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createServer as createVite } from "vite";
import { registerApplication } from "../server/dist/application.js";
import { registerSessions, digest } from "../server/dist/sessions.js";
import { AccessError } from "../server/dist/access.js";
import { companyDay } from "../server/dist/reports.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:5090";
const restoreFile =
  process.argv[2] === "--restore-local-preview" ? process.argv[3] : null;
assert.ok(
  process.argv.length === 2 ||
    ([4, 5].includes(process.argv.length) &&
      (process.argv.length === 4 ||
        [
          "--upgrade-from-pf05-preview",
          "--upgrade-from-pf06-preview",
          "--upgrade-from-pf07-preview",
          "--upgrade-from-pf08-preview",
        ].includes(process.argv[4])) &&
      restoreFile &&
      /^\/(?:private\/)?tmp\/propertyflow-local-preview-backup-[a-z0-9-]+\.sql$/.test(
        restoreFile,
      )),
  "Only a local preview backup can be restored.",
);
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
let container, admin, db, pool, app, vite;
let closing = false;
let checkpointTimer,
  checkpointInFlight,
  checkpointReady = false;
const runFile = promisify(execFile);
const checkpointPath = "/tmp/propertyflow-local-preview-backup-auto.sql";
async function checkpoint() {
  if (!checkpointReady || !container) return;
  if (checkpointInFlight) return checkpointInFlight;
  checkpointInFlight = (async () => {
    const options = {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 50 * 1024 * 1024,
    };
    const marker = await runFile(
      "docker",
      [
        "exec",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "propertyflow_local_preview",
        "-Atqc",
        `SELECT count(*)=1 FROM "Company" WHERE id='local-company'`,
      ],
      options,
    );
    assert.equal(
      marker.stdout.trim(),
      "t",
      "Refuse to replace a checkpoint with an empty preview",
    );
    const dump = await runFile(
      "docker",
      [
        "exec",
        container,
        "pg_dump",
        "-U",
        "postgres",
        "--no-owner",
        "propertyflow_local_preview",
      ],
      options,
    );
    assert.ok(
      dump.stdout.includes('CREATE TABLE public."Lease"'),
      "Expected a complete preview dump",
    );
    const dir = await mkdtemp("/tmp/propertyflow-preview-checkpoint-");
    try {
      const path = dir + "/checkpoint.sql";
      await writeFile(path, dump.stdout, { flag: "wx", mode: 0o600 });
      await rename(path, checkpointPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  })();
  try {
    return await checkpointInFlight;
  } finally {
    checkpointInFlight = undefined;
  }
}

async function cleanup() {
  if (closing) return;
  closing = true;
  clearInterval(checkpointTimer);
  await vite?.close();
  await app?.close();
  if (checkpointReady) {
    try {
      await checkpointInFlight;
      await checkpoint();
    } catch {
      console.error(
        "Local checkpoint unavailable; the previous private backup was retained.",
      );
    }
  }
  await db?.$disconnect();
  await pool?.end();
  await admin?.end();
  if (container) docker("rm", "--force", container);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void cleanup().then(() => process.exit(0));
  });
try {
  const image = docker(
    "image",
    "inspect",
    "postgres:17-alpine",
    "--format",
    "{{.Id}}",
  );
  const password = randomUUID();
  container = docker(
    "run",
    "--detach",
    "--pull",
    "never",
    "--name",
    `pf-local-preview-${randomUUID()}`,
    "--tmpfs",
    "/var/lib/postgresql/data:rw",
    "--publish",
    "127.0.0.1::5432",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "--env",
    "POSTGRES_DB=propertyflow_local_preview",
    image,
  );
  assert.match(container, /^[a-f0-9]{64}$/);
  const [info] = JSON.parse(docker("inspect", container));
  assert.equal(info.Mounts.length, 0);
  assert.equal(info.HostConfig.Tmpfs["/var/lib/postgresql/data"], "rw");
  const [binding] = info.NetworkSettings.Ports["5432/tcp"];
  assert.equal(binding.HostIp, "127.0.0.1");
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      docker(
        "exec",
        container,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
      );
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(ready, "Local disposable database did not become ready");
  const url = `postgresql://postgres:${password}@127.0.0.1:${binding.HostPort}/propertyflow_local_preview`;
  admin = new pg.Pool({ connectionString: url });
  if (restoreFile) {
    // Local runtime roles are cluster objects and are not included by pg_dump.
    await admin.query("CREATE ROLE propertyflow_runtime NOLOGIN");
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "propertyflow_local_preview",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: readFileSync(restoreFile), stdio: ["pipe", "pipe", "pipe"] },
    );
  } else {
    for (const name of readdirSync(root + "server/prisma/migrations")
      .filter((n) => /^\d/.test(n))
      .sort())
      await admin.query(
        readFileSync(
          root + `server/prisma/migrations/${name}/migration.sql`,
          "utf8",
        ),
      );
  }
  if (restoreFile && process.argv[4] === "--upgrade-from-pf05-preview") {
    const marker = (
      await admin.query(
        `SELECT to_regclass('public."LeaseCredit"') old_schema,to_regclass('public."LeaseMovement"') new_schema`,
      )
    ).rows[0];
    assert.ok(
      marker.old_schema && !marker.new_schema,
      "Expected a PF-05-only local preview backup",
    );
    await admin.query(
      readFileSync(
        root +
          "server/prisma/migrations/202610160020_lease_money_movements/migration.sql",
        "utf8",
      ),
    );
  }
  if (restoreFile && process.argv[4] === "--upgrade-from-pf06-preview") {
    const marker = (
      await admin.query(
        `SELECT to_regclass('public."LeaseMovement"') old_schema,to_regclass('public."LeaseSettlement"') settlement,to_regclass('public."AccountProfile"') profile,to_regclass('public."CompanyProfileRevision"') company_profile`,
      )
    ).rows[0];
    assert.ok(
      marker.old_schema &&
        !marker.settlement &&
        !marker.profile &&
        !marker.company_profile,
      "Expected a PF-06-only local preview backup",
    );
    for (const name of [
      "202610160021_move_out_settlements",
      "202610160022_account_profiles",
      "202610160023_company_profile_history",
    ])
      await admin.query(
        readFileSync(
          root + `server/prisma/migrations/${name}/migration.sql`,
          "utf8",
        ),
      );
  }
  if (restoreFile && process.argv[4] === "--upgrade-from-pf07-preview") {
    const marker = (
      await admin.query(
        `SELECT to_regclass('public."LeaseSettlement"') settlement,to_regclass('public."AccountProfile"') profile,to_regclass('public."CompanyProfileRevision"') company_profile,to_regclass('public."LeaseTermChange"') new_schema`,
      )
    ).rows[0];
    assert.ok(
      marker.settlement &&
        marker.profile &&
        marker.company_profile &&
        !marker.new_schema,
      "Expected a PF-07 local preview backup",
    );
    await admin.query(
      readFileSync(
        root +
          "server/prisma/migrations/202610160024_future_lease_terms/migration.sql",
        "utf8",
      ),
    );
  }
  if (restoreFile && process.argv[4] === "--upgrade-from-pf08-preview") {
    const marker = (
      await admin.query(
        `SELECT to_regclass('public."LeaseTermChange"') old_schema,to_regclass('public."LeaseProration"') proration,to_regclass('public."LeaseTransition"') transition`,
      )
    ).rows[0];
    assert.ok(
      marker.old_schema && !marker.proration && !marker.transition,
      "Expected a PF-08 local preview backup",
    );
    await admin.query(
      readFileSync(
        root +
          "server/prisma/migrations/202610160025_proration_transitions/migration.sql",
        "utf8",
      ),
    );
  }
  const runtimePassword = randomUUID();
  const statement = (
    await admin.query(
      "SELECT format('ALTER ROLE propertyflow_runtime LOGIN PASSWORD %L', $1::text) AS sql",
      [runtimePassword],
    )
  ).rows[0].sql;
  await admin.query(statement);
  const runtime = new URL(url);
  runtime.username = "propertyflow_runtime";
  runtime.password = runtimePassword;
  pool = new pg.Pool({ connectionString: runtime.href, max: 8 });
  db = new PrismaClient({ adapter: new PrismaPg(pool) });
  if (!restoreFile)
    await admin.query(
      `INSERT INTO "Company"(id,name,timezone,"updatedAt") VALUES('local-company','Local preview · Oak & Elm','America/New_York',NOW())`,
    );
  const people = {
    owner: "Local Owner",
    manager: "Local Manager",
    resident: "Jordan Rivera",
    staff: "Local Staff",
  };
  if (!restoreFile)
    for (const [role, name] of Object.entries(people)) {
      await admin.query(
        `INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES($1,$2,$3,true,NOW())`,
        [`local-${role}`, `${role}@preview.invalid`, name],
      );
      await admin.query(
        `INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,'local-company',$2,NOW())`,
        [`local-${role}`, role],
      );
    }
  app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof AccessError
        ? error.statusCode
        : ["P2002", "P2034"].includes(error.code)
          ? 409
          : (error.statusCode ?? 503);
    reply
      .code(status)
      .send({
        error:
          error instanceof AccessError
            ? error.message
            : status === 409
              ? "The record changed. Refresh and review again."
              : "Local preview request failed.",
        code:
          error instanceof AccessError ? error.code : "PREVIEW_REQUEST_FAILED",
      });
  });
  const authenticate = await registerSessions(app, db, {
    origin,
    domain: "local-preview.invalid",
    clientId: "local-only",
    clientSecret: "unused-local-only",
    secure: false,
  });
  const unavailable = async () => {
    throw new AccessError(
      503,
      "LOCAL_PREVIEW_ONLY",
      "Email and external identity changes are disabled in the local preview.",
    );
  };
  registerApplication(app, db, authenticate, origin, {
    issuer: "https://local-preview.invalid/",
    databaseConnection: "local-only",
    list: async () => ({ users: [], nextPage: null }),
    get: unavailable,
    create: unavailable,
    setup: unavailable,
    verify: unavailable,
  });
  const nonce = randomBytes(32).toString("hex");
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/auth/login"))
      return reply.redirect("/api/local-preview");
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url === "/api/auth/logout" && reply.statusCode === 200)
      return JSON.stringify({ logoutUrl: origin + "/api/local-preview" });
    return payload;
  });
  app.get("/api/local-preview", async (request, reply) => {
    reply.header("Cache-Control", "no-store").type("text/html");
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Property Flow local preview</title><style>body{font:16px system-ui;color:#18352c;background:#f3f7f5;max-width:580px;margin:10vh auto;padding:24px}section{background:white;padding:32px;border:1px solid #d4e1da;border-radius:16px}label{display:grid;gap:8px;margin:24px 0}select,button{font:inherit;padding:12px;border-radius:8px;border:1px solid #abc4b8}button{background:#146c5b;color:white;width:100%}p{line-height:1.6;color:#4d655b}</style><section><h1>Local preview</h1><p>Sample records in a disposable local database. Changes here do not affect your cloud application. Email and external identity changes are disabled.</p><form><label>Preview as<select id="role">${Object.entries(
      people,
    )
      .map(([role, name]) => `<option value="${role}">${name}</option>`)
      .join(
        "",
      )}</select></label><button>Open Property Flow</button></form><p id="error" role="alert"></p></section><script>document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/local-preview/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:document.querySelector('#role').value,nonce:'${nonce}'})});if(r.ok)location.href='/dashboard';else document.querySelector('#error').textContent='Unable to open the local preview.';});</script></html>`;
  });
  async function session(role) {
    const token = randomBytes(32).toString("base64url"),
      csrfToken = randomBytes(32).toString("base64url");
    await db.session.create({
      data: {
        tokenHash: digest(token),
        csrfToken,
        userId: `local-${role}`,
        expiresAt: new Date(Date.now() + 12 * 3600000),
        idleExpiresAt: new Date(Date.now() + 2 * 3600000),
      },
    });
    return { token, csrfToken };
  }
  app.post("/api/local-preview/session", async (request, reply) => {
    const body = request.body;
    if (
      request.headers.origin !== origin ||
      !body ||
      body.nonce !== nonce ||
      !Object.hasOwn(people, body.role)
    )
      return reply
        .code(403)
        .send({ error: "Local preview selection unavailable." });
    const { token } = await session(body.role);
    return reply
      .setCookie("pf-session", token, {
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "strict",
        maxAge: 12 * 3600,
      })
      .send({ ready: true });
  });
  const seedSession = await session("owner");
  const call = async (method, path, payload) => {
    const result = await app.inject({
      method,
      url: path,
      headers: {
        cookie: `pf-session=${seedSession.token}`,
        origin,
        "x-csrf-token": seedSession.csrfToken,
      },
      ...(payload ? { payload } : {}),
    });
    assert.equal(result.statusCode, 200, `${path}: ${result.body}`);
    return result.json();
  };
  if (!restoreFile) {
    const property = await call("POST", "/api/company/properties", {
      name: "Maple House",
      address: "14 Maple Lane",
      city: "Philadelphia",
      state: "PA",
      zip: "19106",
      submissionKey: randomUUID(),
    });
    await admin.query(
      `INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('local-company',$1,'local-resident')`,
      [property.id],
    );
    const unit = await call(
      "POST",
      `/api/company/properties/${property.id}/units`,
      { label: "Apartment 1", submissionKey: randomUUID() },
    );
    const today = companyDay("America/New_York"),
      periodOn = today.slice(0, 7) + "-01";
    const lease = await call("POST", "/api/company/leases", {
      propertyId: property.id,
      unitId: unit.id,
      residentId: "local-resident",
      startsOn: periodOn,
      endsOn: null,
      monthlyRent: "1500.00",
      status: "active",
      graceDays: 5,
      rentDueDay: 1,
      paymentInstructions: "Local sample only. No real payments are processed.",
      submissionKey: randomUUID(),
    });
    await call("POST", `/api/company/rent/${lease.id}/charges`, {
      periodOn,
      dueOn: periodOn,
      amount: "1500.00",
      memo: "Monthly rent",
      expectedVersion: 1,
      submissionKey: randomUUID(),
    });
    await call("POST", `/api/company/rent/${lease.id}/payments`, {
      occurredOn: today,
      amount: "600.00",
      memo: "Local sample receipt",
      submissionKey: randomUUID(),
    });
    await call("POST", `/api/company/rent/${lease.id}/one-time-charges`, {
      category: "parking",
      effectiveOn: today,
      dueOn: today,
      amount: "75.00",
      description: "October parking · reserved space",
      expectedLeaseVersion: 1,
      submissionKey: randomUUID(),
    });
    const deposit = await call("POST", `/api/company/deposits/${lease.id}`, {
      amount: "1500.00",
      dueOn: periodOn,
      expectedLeaseVersion: 1,
      submissionKey: randomUUID(),
    });
    await call("POST", `/api/company/deposits/${lease.id}/receipts`, {
      amount: "1500.00",
      occurredOn: today,
      method: "bank_transfer",
      memo: "Local sample deposit",
      paymentReference: "SAMPLE ONLY",
      expectedVersion: deposit.version,
      expectedLeaseVersion: 1,
      submissionKey: randomUUID(),
    });
    const offline = await call("POST", "/api/company/resident-contacts", {
      name: "Taylor Morgan",
      email: "taylor@preview.invalid",
      phone: "555-0142",
      submissionKey: randomUUID(),
    });
    assert.ok(offline.id);
  }
  await app.listen({ host: "127.0.0.1", port: 5091 });
  vite = await createVite({
    configFile: root + "client/vite.config.ts",
    root: root + "client",
    server: {
      host: "127.0.0.1",
      port: 5090,
      strictPort: true,
      proxy: {
        "/api": { target: "http://127.0.0.1:5091", changeOrigin: true },
      },
    },
  });
  await vite.listen();
  checkpointReady = true;
  try {
    await checkpoint();
  } catch {
    console.error(
      "Local checkpoint unavailable; the previous private backup was retained.",
    );
  }
  checkpointTimer = setInterval(() => {
    void checkpoint().catch(() =>
      console.error(
        "Local checkpoint unavailable; the previous private backup was retained.",
      ),
    );
  }, 30000);
  checkpointTimer.unref();
  console.log(`Local preview ready: ${origin}/api/local-preview`);
  console.log(
    "Sample data only; restricted runtime DB role, real API/cookies/CSRF/RLS, no cloud providers. Private local checkpoints are saved every 30 seconds and on clean shutdown; no cloud data is used.",
  );
} catch (error) {
  console.error(error.message);
  await cleanup();
  process.exitCode = 1;
}
