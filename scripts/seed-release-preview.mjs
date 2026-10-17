// Fictional data for the dedicated loopback preview only. No arbitrary URLs,
// cloud configuration, external identity operations or messages are accepted.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
assert.equal(
  process.argv.length,
  2,
  "This fixture accepts no target or credential arguments.",
);
const origin = "http://127.0.0.1:5090",
  fixtureFile = "/tmp/propertyflow-batch-preview.json";
const html = await (await fetch(origin + "/api/local-preview")).text(),
  nonce = /nonce:'([a-f0-9]{64})'/.exec(html)?.[1];
assert.ok(nonce, "Expected the dedicated local-only preview.");
const session = await fetch(origin + "/api/local-preview/session", {
  method: "POST",
  headers: { "content-type": "application/json", origin },
  body: JSON.stringify({ role: "owner", nonce }),
});
assert.equal(session.status, 200);
const cookie = session.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; "),
  boot = await (
    await fetch(origin + "/api/bootstrap", { headers: { cookie } })
  ).json();
assert.equal(boot.membership.companyId, "local-company");
assert.equal(boot.user.id, "local-owner");
async function call(method, path, body) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      cookie,
      origin,
      "content-type": "application/json",
      "x-csrf-token": boot.csrfToken,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
let existing;
try {
  existing = JSON.parse(readFileSync(fixtureFile, "utf8"));
} catch {}
if (existing?.oldLeaseId) {
  const r = await fetch(
    origin + `/api/company/leases/${encodeURIComponent(existing.oldLeaseId)}`,
    { headers: { cookie } },
  );
  if (r.ok) {
    console.log(JSON.stringify(existing));
    process.exit(0);
  }
  assert.equal(
    r.status,
    404,
    "Do not recreate a fixture when its access is unavailable.",
  );
}
const properties = await call("GET", "/api/company/properties"),
  property = properties.find((p) => p.name === "Maple House") ?? properties[0];
assert.ok(property, "Create a local sample property first.");
const contact = await call("POST", "/api/company/resident-contacts", {
    name: "Release Preview Resident",
    email: "release-preview@preview.invalid",
    submissionKey: randomUUID(),
  }),
  unit = await call("POST", `/api/company/properties/${property.id}/units`, {
    label: "Release preview · Unit B",
    submissionKey: randomUUID(),
  });
const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()),
  on = new Date(today),
  yesterday = new Date(+on - 86400000).toISOString().slice(0, 10),
  month = today.slice(0, 7) + "-01",
  previous = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 10),
  last = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth() + 2, 10))
    .toISOString()
    .slice(0, 10);
const old = await call("POST", "/api/company/leases", {
  propertyId: property.id,
  unitId: unit.id,
  residentContactId: contact.id,
  startsOn: previous,
  endsOn: yesterday,
  monthlyRent: "1500.00",
  rentDueDay: 1,
  graceDays: 5,
  paymentInstructions:
    "Fictional local release review. No payment is processed.",
  status: "active",
  submissionKey: randomUUID(),
});
await call("POST", `/api/company/rent/${old.id}/schedules`, {
  firstPeriodOn: month,
  firstDueOn: month,
  leadDays: 0,
  expectedVersion: old.version,
  submissionKey: randomUUID(),
});
const next = await call("POST", "/api/company/leases", {
  propertyId: property.id,
  unitId: unit.id,
  residentContactId: contact.id,
  previousLeaseId: old.id,
  expectedPreviousVersion: old.version,
  startsOn: today,
  endsOn: last,
  monthlyRent: "1800.00",
  rentDueDay: 1,
  graceDays: 3,
  paymentInstructions: "Fictional local renewal review.",
  status: "draft",
  submissionKey: randomUUID(),
});
const result = {
  oldLeaseId: old.id,
  newLeaseId: next.id,
  unitId: unit.id,
  renewalUrl: `${origin}/company/leases/${old.id}?section=renewal`,
  prorationUrl: `${origin}/company/leases/${old.id}?section=proration`,
};
writeFileSync(fixtureFile, JSON.stringify(result), { mode: 0o600 });
console.log(JSON.stringify(result));
