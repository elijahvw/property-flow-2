import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page, { verified = true, platform = true } = {}) {
  const state = {
    verified,
    people: [] as any[],
    imports: 0,
    membershipRequests: [] as any[],
    syncs: [] as number[],
    remote: [
      {
        user_id: "auth0|before",
        email: "before@test.invalid",
        email_verified: false,
        name: "Before Login",
      },
    ] as any[],
    loseProvision: false,
    provisions: [] as any[],
    fail: false,
    companies: [
      { id: "a", name: "Company A", status: "active" },
      { id: "b", name: "Company B", status: "active" },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      json = (value: unknown, status = 200) =>
        route.fulfill({ json: value, status });
    if (path === "/api/bootstrap")
      return json({
        user: {
          id: platform ? "admin" : "u",
          email: "user@test.invalid",
          status: "active",
          emailVerified: state.verified,
          platformRole: platform ? "owner" : null,
        },
        membership: null,
        permissions: state.verified && platform ? ["platform.manage"] : [],
        destination: platform ? "/platform/users" : "/access",
        csrfToken: "fixture",
      });
    if (path === "/api/account") return json({name:"Test User",email:"user@test.invalid",emailVerified:state.verified,version:0,nameVersion:"2026-10-16T00:00:00Z",companyId:null,contactVersion:null,contactEmail:"user@test.invalid",sharedWithManagement:false,details:{},assignments:[],updatedAt:null});
    if (path === "/api/platform/users" && req.method() === "GET")
      return json(state.people);
    if (path === "/api/platform/companies") return json(state.companies);
    if (path === "/api/platform/invitations") return json([]);
    if (path === "/api/platform/users/sync") {
      expect(req.method()).toBe("POST");
      expect(req.headers()["x-csrf-token"]).toBe("fixture");
      const b = req.postDataJSON();
      state.syncs.push(b.page);
      if (state.fail)
        return json({ error: "Identity service unavailable" }, 503);
      const source = state.remote.filter(
        (u) => !b.email || u.email === b.email,
      );
      for (const u of source.slice(b.page * 50, b.page * 50 + 50)) {
        if (!state.people.some((p) => p.id === u.user_id))
          state.people.push({
            id: u.user_id,
            email: u.email,
            name: u.name,
            emailVerified: u.email_verified,
            firstSignedInAt: null,
            status: "active",
            platformRole: null,
            membership: null,
          });
      }
      return json({
        nextPage: (b.page + 1) * 50 < source.length ? b.page + 1 : null,
        limited: false,
        conflicts: [],
      });
    }
    if (req.method() !== "GET") {
      expect(req.headers()["x-csrf-token"]).toBe("fixture");
      if (path.endsWith("/import")) {
        state.imports++;
        state.people = [
          {
            id: "auth0|before",
            email: "before@test.invalid",
            name: "Before Login",
            emailVerified: false,
            firstSignedInAt: null,
            status: "active",
            platformRole: null,
            membership: null,
          },
        ];
        return json({ items: state.people });
      }
      if (path.endsWith("/provision")) {
        state.provisions.push(req.postDataJSON());
        if (state.loseProvision) {
          state.loseProvision = false;
          return route.abort("failed");
        }
        return json({ id: "auth0|created" });
      }
      if (path.endsWith("/profile")) { state.people[0].name = req.postDataJSON().name; return json({id:state.people[0].id,name:state.people[0].name}); }
      if (path.endsWith("/verification-status"))
        return json({ emailVerified: state.verified });
      if (path.endsWith("/verification"))
        return json({ message: "Verification email requested." });
      if ((path.endsWith("/password-setup") || path.endsWith("/password-reset")))
        return json({ message: "Password setup email requested." });
      if (path.endsWith("/membership")) {
        state.membershipRequests.push(req.postDataJSON());
        if (
          req.postDataJSON().expectedVersion !==
          (state.people[0].membership?.version ?? null)
        )
          return json(
            {
              error:
                "This assignment changed. Close and reopen access before editing again.",
              code: "RECORD_CHANGED",
            },
            409,
          );
        if(req.method()==="DELETE"){state.people[0].membership=null;return json({success:true});}
        state.people[0].membership = {
          companyId: req.postDataJSON().companyId,
          version: (state.people[0].membership?.version ?? 0) + 1,
          role: req.postDataJSON().role,
          status: "active",
          company: {
            name: state.companies.find(
              (c) => c.id === req.postDataJSON().companyId,
            )!.name,
          },
        };
        return json(state.people[0].membership);
      }
    }
    return json([]);
  });
  return state;
}
test("opening Users automatically discovers identities and allows company/owner assignment without first sign-in", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/platform/users");
  await expect(
    page.getByRole("row").filter({ hasText: "before@test.invalid" }),
  ).toContainText("Not verified");
  await expect(
    page.getByRole("row").filter({ hasText: "before@test.invalid" }),
  ).toContainText("Awaiting first sign-in");
  expect(state.imports).toBe(0);
  expect(state.syncs).toContain(0);
  await expect(
    page.getByRole("button", {
      name: /Add all accounts|Add or refresh|Reload people|Refresh users/,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Auth0 sign-in directory" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "/tmp/propertyflow-auto-users-preview.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption("a");
  await page.getByLabel("Company role").selectOption("owner");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "before@test.invalid" }),
  ).toContainText("owner");
  await page
    .getByRole("button", { name: "Send verification email", exact: true })
    .click();
  await expect(
    page.getByText("Verification email requested.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send password reset email" }).click();
  await expect(
    page.getByText("Password setup email requested.", { exact: true }),
  ).toBeVisible();
});
test("directory failure is recoverable and unverified user sees reminder/profile without protected content", async ({
  page,
}) => {
  const state = await fixture(page);
  state.fail = true;
  await page.goto("/platform/users");
  await expect(page.getByRole("alert")).toContainText(
    "Identity service unavailable",
  );
  state.fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "before@test.invalid" }),
  ).toBeVisible();
  await page.unroute("**/api/**");
  await fixture(page, { verified: false, platform: false });
  await page.goto("/company/finances");
  await expect(page.getByRole("alertdialog")).toContainText(
    "Verify your email",
  );
  await expect(
    page.getByRole("heading", { name: "Email verification required" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Manual finances" }),
  ).toHaveCount(0);
});
test("verification status refresh updates profile and dismisses persistent reminder", async ({
  page,
}) => {
  const state = await fixture(page, { verified: false, platform: false });
  await page.goto("/account");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(
    page.locator(".account-identity-card").getByText("Verify email",{exact:true}),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "I verified my email — check status" })
    .click();
  await expect(page.getByText(/Your email is still unverified/)).toBeVisible();
  state.verified = true;
  await page
    .getByRole("button", { name: "I verified my email — check status" })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator(".account-identity-card").getByText("Verified",{exact:true})).toBeVisible();
});
test("new-account retry keeps submission key and a new account gets a fresh key", async ({
  page,
}) => {
  const state = await fixture(page);
  state.loseProvision = true;
  await page.goto("/platform/users");
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await page.getByLabel("New user name").fill("New Person");
  await page.getByLabel("New user email").fill("new@test.invalid");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByLabel("New user email")).not.toBeVisible();
  expect(state.provisions).toHaveLength(2);
  expect(state.provisions[0].submissionKey).toBe(
    state.provisions[1].submissionKey,
  );
  await page.getByRole("button", { name: "Add user", exact: true }).click();
  await page.getByLabel("New user name").fill("Next Person");
  await page.getByLabel("New user email").fill("next@test.invalid");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect.poll(() => state.provisions.length).toBe(3);
  expect(state.provisions[2].submissionKey).not.toBe(
    state.provisions[0].submissionKey,
  );
});
test("user management opens profile, access and server-filtered activity together and blocks conflicting actions during saves",async({page})=>{
  await fixture(page);await page.goto("/platform/users");const activity=page.waitForRequest(r=>new URL(r.url()).pathname==="/api/platform/audit");await page.getByRole("button",{name:"Manage",exact:true}).click();const dialog=page.getByRole("dialog");
  await expect(dialog.getByLabel("Display name",{exact:true})).toHaveValue("Before Login");
  // Activity is loaded for exactly the selected account, rather than filtering
  // the most recent global page in the browser.
  const requested=await activity;expect(new URL(requested.url()).searchParams.get("targetId")).toBe("auth0|before");
  await dialog.getByLabel("Display name",{exact:true}).fill("Updated Person");await dialog.getByRole("button",{name:"Save display name"}).click();await expect(dialog.getByRole("heading",{name:"Manage Updated Person",exact:true})).toBeVisible();
  await dialog.getByText("Account activity",{exact:true}).click();await expect(dialog.getByText("No recorded activity for this account.")).toBeVisible();
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  await page.route("**/verification-status",async route=>{await gate;await route.fallback();});
  try {await dialog.getByRole("button",{name:"Refresh verification status"}).click();await expect(dialog.getByLabel("Display name",{exact:true})).toBeDisabled();await expect(dialog.getByRole("button",{name:"Close",exact:true})).toBeDisabled();await page.keyboard.press("Escape");await expect(dialog).toBeVisible();release();await expect(dialog.getByLabel("Display name",{exact:true})).toBeEnabled();}
  finally {release();}
});
test("automatic sync follows all pages and discovers accounts on tab return without losing an access draft", async ({
  page,
}) => {
  const state = await fixture(page);
  state.remote.push(
    ...Array.from({ length: 51 }, (_, n) => ({
      user_id: `auth0|page-${n}`,
      email: `page-${n}@test.invalid`,
      email_verified: true,
      name: `Person ${n}`,
    })),
  );
  await page.goto("/platform/users");
  await expect(
    page.getByRole("button", { name: "Manage", exact: true }),
  ).toHaveCount(52);
  expect(state.syncs).toContain(1);
  expect(state.people).toHaveLength(52);
  await page
    .getByRole("row")
    .filter({ hasText: "before@test.invalid" })
    .getByRole("button", { name: "Manage" })
    .click();
  await page
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption("a");
  await page.getByLabel("Company role").selectOption("manager");
  state.people[0].membership = {
    companyId: "a",
    role: "staff",
    status: "active",
    version: 2,
    company: { name: "Company A" },
  };
  state.remote.push({
    user_id: "auth0|new-tab",
    email: "new-tab@test.invalid",
    email_verified: false,
    name: "Created in another tab",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("row").filter({ hasText: "new-tab@test.invalid" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Company", exact: true }),
  ).toHaveValue("a");
  await expect(page.getByLabel("Company role")).toHaveValue("manager");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This assignment changed",
  );
  await expect(page.getByLabel("Company role")).toHaveValue("manager");
  expect(state.membershipRequests.at(-1).expectedVersion).toBeNull();
  expect(state.people[0].membership.role).toBe("staff");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", {name:"Close without saving",exact:true}).click();
  await page
    .getByRole("row")
    .filter({ hasText: "before@test.invalid" })
    .getByRole("button", { name: "Manage" })
    .click();
  await expect(page.getByLabel("Company role")).toHaveValue("staff");
});
test("visible Users page refreshes automatically after a minute", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.clock.install();
  await page.goto("/platform/users");
  await expect(
    page.getByRole("row").filter({ hasText: "before@test.invalid" }),
  ).toBeVisible();
  state.remote.push({
    user_id: "auth0|timer",
    email: "timer@test.invalid",
    email_verified: false,
    name: "Timer Person",
  });
  await page.clock.fastForward(60000);
  await expect(
    page.getByRole("row").filter({ hasText: "timer@test.invalid" }),
  ).toBeVisible();
});

test("background company suspension preserves the selected company until an explicit new selection", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/platform/users");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption("a");
  state.companies[0].status = "suspended";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("option", { name: "Company A (suspended)", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("combobox", { name: "Company", exact: true }),
  ).toHaveValue("a");
  await expect(page.getByRole("alert")).toContainText(
    "selected company is unavailable",
  );
  expect(state.membershipRequests).toHaveLength(0);
  await page
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption("b");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => state.membershipRequests.length).toBe(1);
  expect(state.membershipRequests[0].companyId).toBe("b");
});
test("assignment conflict loads the current row while preserving the draft until close and reopen", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/platform/users");
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Company", exact: true })
    .selectOption("a");
  await page.getByLabel("Company role").selectOption("manager");
  state.people[0].membership = {
    companyId: "a",
    role: "staff",
    status: "active",
    version: 7,
    company: { name: "Company A" },
  };
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "This assignment changed",
  );
  await expect(
    page.getByRole("row").filter({ hasText: "before@test.invalid" }),
  ).toContainText("staff");
  await expect(page.getByLabel("Company role")).toHaveValue("manager");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", {name:"Close without saving",exact:true}).click();
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await expect(page.getByLabel("Company role")).toHaveValue("staff");
  await page.getByLabel("Company role").selectOption("manager");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => state.membershipRequests.length).toBe(2);
  expect(state.membershipRequests[1].expectedVersion).toBe(7);
});

test("platform user can explicitly remove company access without deleting the profile",async({page})=>{
 const state=await fixture(page);await page.goto('/platform/users');await page.getByRole('button',{name:'Manage',exact:true}).click();
 await page.getByRole('combobox',{name:'Company',exact:true}).selectOption('a');await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('combobox',{name:'Company',exact:true}).selectOption('');await expect(page.getByRole('combobox',{name:'Company role',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Company',exact:true})).toHaveValue('');expect(state.people).toHaveLength(1);expect(state.people[0].membership).toBeNull();expect(state.membershipRequests.at(-1)).toEqual({expectedVersion:1,expectedCompanyId:'a',expectedCreatedAt:null});
});

test('saving one user-management form preserves close protection for another unfinished form',async({page})=>{
 await fixture(page);await page.goto('/platform/users');await page.getByRole('button',{name:'Manage',exact:true}).click();
 await page.getByRole('combobox',{name:'Company',exact:true}).selectOption('a');
 await page.getByLabel('Company role',{exact:true}).selectOption('manager');
 await page.getByLabel('Display name',{exact:true}).fill('Updated Person');await page.getByRole('button',{name:'Save as draft',exact:true}).click();
 await page.getByRole('button',{name:'Manage',exact:true}).click();await expect(page.getByLabel('Company role',{exact:true})).toHaveValue('manager');
 await page.getByRole('button',{name:'Save display name',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Manage Updated Person',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('alertdialog',{name:'Close without saving changes?'})).toBeVisible();
 await page.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(page.getByLabel('Company role',{exact:true})).toHaveValue('manager');
});
