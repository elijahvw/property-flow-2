import pg from "pg";
import { readFileSync } from "node:fs";
// Executed with migration credentials before the HTTP process starts.
const runtimeUrl = process.env.RUNTIME_DATABASE_URL;
if (!runtimeUrl) throw new Error("RUNTIME_DATABASE_URL is required");
const runtime = new URL(runtimeUrl);
if (runtime.username !== "propertyflow_runtime" || !runtime.password)
  throw new Error("Invalid runtime database identity");
const admin = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT || readFileSync(new URL('../certs/rds-global-bundle.pem', import.meta.url), 'utf8') }
      : undefined,
});
await admin.connect();
try {
  const role = (
    await admin.query(
      "SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit FROM pg_roles WHERE rolname = 'propertyflow_runtime'",
    )
  ).rows[0];
  if (
    !role ||
    role.rolsuper ||
    role.rolbypassrls ||
    role.rolcreaterole ||
    role.rolcreatedb ||
    role.rolinherit
  )
    throw new Error("Runtime role privileges are invalid");
  const memberships = (
    await admin.query(
      "SELECT count(*)::int AS count FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'propertyflow_runtime')",
    )
  ).rows[0].count;
  const owned = (
    await admin.query(
      "SELECT count(*)::int AS count FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = 'propertyflow_runtime')",
    )
  ).rows[0].count;
  if (memberships || owned)
    throw new Error("Runtime role must not inherit other roles or own tables");
  // PostgreSQL quotes the password as a literal; never interpolate it manually or log it.
  const statement = (
    await admin.query(
      "SELECT format('ALTER ROLE propertyflow_runtime LOGIN PASSWORD %L', $1::text) AS sql",
      [decodeURIComponent(runtime.password)],
    )
  ).rows[0].sql;
  await admin.query(statement);
} finally {
  await admin.end();
}
