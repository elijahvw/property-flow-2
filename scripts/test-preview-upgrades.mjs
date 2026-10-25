// Disposable PostgreSQL verification for local-preview upgrade safety. No URL,
// restore-file path, persistent volume or existing preview is accepted.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";
import { localPreviewUpgrades, upgradeLocalPreview } from "./local-preview-upgrades.mjs";

assert.equal(process.argv.length, 2, "This check accepts no database or preview arguments");
const docker = (...args) => {
  try { return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { throw new Error("An owned disposable preview-upgrade container command failed"); }
};
const migrations = new URL("../server/prisma/migrations/", import.meta.url);
const baseline = (await readdir(migrations)).filter(name => /^\d/.test(name) && name <= "202610190040_in_app_notifications").sort();
let container, pool;
let checks = 0;
async function fingerprint() {
  const result = {};
  for (const table of ["Company", "User", "CompanyMembership"]) {
    const rows = await pool.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM "${table}" t`);
    result[table] = rows.rows[0].hash;
  }
  return result;
}
try {
  const image = docker("image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}");
  const password = randomUUID();
  container = docker("run", "--detach", "--pull", "never", "--name", `pf-preview-upgrades-${randomUUID()}`,
    "--tmpfs", "/var/lib/postgresql/data:rw", "--publish", "127.0.0.1::5432", "--env", `POSTGRES_PASSWORD=${password}`,
    "--env", "POSTGRES_DB=propertyflow_preview_upgrade_test", image);
  assert.match(container, /^[a-f0-9]{64}$/);
  const [info] = JSON.parse(docker("inspect", container));
  assert.equal(info.Mounts.length, 0);
  assert.equal(info.HostConfig.Tmpfs["/var/lib/postgresql/data"], "rw");
  const [binding] = info.NetworkSettings.Ports["5432/tcp"];
  assert.equal(binding.HostIp, "127.0.0.1");
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, "Owned disposable PostgreSQL did not become ready");
  pool = new pg.Pool({ connectionString: `postgresql://postgres:${password}@127.0.0.1:${binding.HostPort}/propertyflow_preview_upgrade_test`, max: 4 });
  await pool.query("CREATE ROLE propertyflow_runtime NOLOGIN");
  for (const name of baseline) await pool.query(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"));
  await pool.query(`INSERT INTO "Company"(id,name,timezone,"updatedAt") VALUES('preview-upgrade-company','Fictional preview upgrade test','America/New_York',NOW());
    INSERT INTO "User"(id,email,name,"emailVerified","updatedAt") VALUES('preview-upgrade-owner','owner@preview-upgrades.invalid','Fictional owner',true,NOW());
    INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('preview-upgrade-owner','preview-upgrade-company','owner',NOW())`);
  const original = await fingerprint();
  const applied = await upgradeLocalPreview(pool);
  assert.deepEqual(applied, localPreviewUpgrades.filter(([name]) => name > "202610190040_in_app_notifications").map(([name]) => name)); checks++;
  assert.deepEqual(await fingerprint(), original); checks++;
  assert.deepEqual(await upgradeLocalPreview(pool), []); checks++;
  assert.deepEqual(await fingerprint(), original); checks++;

  // One missing marker must not silently rerun an otherwise populated batch.
  await pool.query('DROP TRIGGER protect_task_draft_identity ON "TaskDraft"');
  await assert.rejects(upgradeLocalPreview(pool), /partial/); checks++;
  assert.deepEqual(await fingerprint(), original); checks++;
  await pool.query('CREATE TRIGGER protect_task_draft_identity BEFORE UPDATE ON "TaskDraft" FOR EACH ROW EXECUTE FUNCTION protect_task_draft_identity()');

  // A later complete migration following a missing earlier one is not guessed.
  await pool.query('DROP INDEX maintenance_directory_order');
  await assert.rejects(upgradeLocalPreview(pool), /out of order/); checks++;
  assert.equal((await pool.query("SELECT to_regclass('public.maintenance_directory_order') AS marker")).rows[0].marker, null); checks++;
  await pool.query(await readFile(new URL("202610240050_maintenance_directory/migration.sql", migrations), "utf8"));

  // This old PR #60 model is incompatible even if canonical tables also exist.
  await pool.query('CREATE TABLE "LeasingProspect"(id TEXT PRIMARY KEY)');
  await assert.rejects(upgradeLocalPreview(pool), /incompatible PR #60 schema/); checks++;
  assert.deepEqual(await fingerprint(), original); checks++;
  await pool.query('DROP TABLE "LeasingProspect"');
  assert.deepEqual(await upgradeLocalPreview(pool), []); checks++;
  console.log(`Preview upgrade safety: ${checks}/${checks} checks passed; fictional identity/company fingerprints retained, canonical replay empty, partial/out-of-order/foreign schemas refused.`);
} finally {
  await pool?.end();
  if (container) docker("rm", "--force", container);
}
