import test from "node:test";
import assert from "node:assert/strict";
import { identityProvider } from "../dist/identity-provider.js";
const env = {
  AUTH0_DOMAIN: "tenant.auth0.com",
  AUTH0_MANAGEMENT_CLIENT_ID: "test-client",
  AUTH0_MANAGEMENT_CLIENT_SECRET: "test-secret",
  AUTH0_WEB_CLIENT_ID: "web",
};
const profile = {
  user_id: "auth0|abc+1",
  email: "a+one@test.invalid",
  email_verified: true,
  name: "A",
  app_metadata: { role: "admin" },
  identities: [
    {
      connection: "Username-Password-Authentication",
      provider: "auth0",
      access_token: "never-expose",
    },
  ],
};
test("configured management client caches tokens, encodes opaque subjects and strips provider secrets/metadata", async () => {
  const seen = [];
  const send = async (url, options) => {
    seen.push({ url, options });
    return Response.json(
      url.endsWith("/oauth/token")
        ? { access_token: "token", expires_in: 3600 }
        : url.includes("/users?")
          ? { users: [profile], total: 51 }
          : profile,
    );
  };
  const p = identityProvider(env, send);
  const listed = await p.list(0);
  assert.equal(listed.nextPage, 1);
  assert.equal(listed.users[0].identities[0].access_token, undefined);
  assert.equal(listed.users[0].app_metadata, undefined);
  const u = await p.get(profile.user_id);
  assert.equal(u.user_id, profile.user_id);
  assert.equal(seen.filter((x) => x.url.endsWith("/oauth/token")).length, 1);
  assert.ok(seen.some((x) => x.url.includes("auth0%7Cabc%2B1")));
  assert.equal(seen[0].options.redirect, "error");
  assert.ok(seen[0].options.signal);
  assert.equal(
    JSON.parse(seen[0].options.body).scope,
    "read:users create:users update:users",
    "request only user administration scopes even if the existing client grant is broader",
  );
});
test("new email/password identity never exposes initial random password; retry recovers provider success after lost response", async () => {
  let created = false;
  const seen = [];
  const p = identityProvider(env, async (url, options) => {
    seen.push({ url, options });
    if (url.endsWith("/oauth/token"))
      return Response.json({ access_token: "token", expires_in: 3600 });
    if (url.includes("users-by-email"))
      return Response.json(created ? [profile] : []);
    if (url.endsWith("/users")) {
      created = true;
      const b = JSON.parse(options.body);
      assert.ok(b.password.length > 48);
      assert.equal(b.email_verified, false);
      assert.equal(b.verify_email, false);
      throw Error("response lost");
    }
    throw Error("Unexpected endpoint");
  });
  assert.equal((await p.create(profile.email, "A")).user_id, profile.user_id);
  assert.equal((await p.create(profile.email, "A")).user_id, profile.user_id);
  assert.equal(seen.filter((x) => x.url.endsWith("/users")).length, 1);
});
test("verification and password setup call explicit provider endpoints; provider errors sanitized", async () => {
  const seen = [];
  const p = identityProvider(env, async (url, options) => {
    seen.push({ url, options });
    if (url.endsWith("/oauth/token"))
      return Response.json({ access_token: "token", expires_in: 3600 });
    if (url.endsWith("/dbconnections/change_password"))
      return new Response("Email sent");
    return Response.json({ id: "job" });
  });
  await p.verify(profile.user_id);
  await p.setup(profile.email);
  assert.ok(seen.some((x) => x.url.endsWith("/jobs/verification-email")));
  assert.ok(seen.some((x) => x.url.endsWith("/dbconnections/change_password")));
  const denied = identityProvider(
    env,
    async () => new Response("SECRET provider debug body", { status: 403 }),
  );
  await assert.rejects(
    denied.list(0),
    (e) =>
      e.code === "IDENTITY_PROVIDER_UNAVAILABLE" &&
      !e.message.includes("SECRET"),
  );
  assert.equal(identityProvider({}), undefined);
});
