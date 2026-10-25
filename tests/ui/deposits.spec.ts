import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page, role = "owner") {
  const lease = {
    id: "lease-with-internal-identifier-1234567890",
    propertyId: "home",
    version: 1,
    status: "active",
    startsOn: "2026-11-01",
    endsOn: null,
    property: { name: "Maple House" },
    unit: { label: "Apartment 1" },
    ...(role === "resident"
      ? {}
      : {
          resident: { name: "Jordan Resident", email: "jordan@test.invalid" },
        }),
  };
  const summary = {
    requiredCents: "150000",
    heldCents: "75000",
    outstandingCents: "75000",
    excessHeldCents: "0",
    pastDueCents: "75000",
  };
  const receipt = {
    id: "receipt-internal-12345678901234567890",
    reference: "DR-123",
    occurredOn: "2026-10-10",
    amountCents: 75000,
    method: "bank_transfer",
    ...(role === "resident"
      ? {}
      : { paymentReference: "Bank 123", memo: "Private finance note" }),
    cashEntry: {
      id: "cash-internal-12345678901234567890",
      reference: "TX-456",
      version: 1,
      voidedAt: null,
    },
  };
  const account = {
    id: "account-internal-12345678901234567890",
    reference: "DA-12",
    leaseId: lease.id,
    propertyId: "home",
    requiredCents: 150000,
    dueOn: "2026-10-01",
    version: 1,
    lease,
    summary,
    receipts: [receipt],
    ...(role === "resident"
      ? {}
      : {
          revisions: [
            {
              id: "revision-long-id",
              version: 1,
              requiredCents: 150000,
              dueOn: "2026-10-01",
              reason: "Initial requirement",
              createdAt: "2026-10-01",
            },
          ],
        }),
  };
  const state = {
    status: 200,
    accounts: [account] as any[],
    requests: [] as string[],
  };
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url()),
      p = u.pathname,
      json = (v: unknown, status = 200) => route.fulfill({ json: v, status });
    state.requests.push(p + u.search);
    if (p === "/api/bootstrap")
      return json({
        user: {
          id: role,
          email: role + "@test.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "a",
          role,
          version: 1,
          status: "active",
          company: { name: "FAP", status: "active" },
        },
        permissions:
          role === "resident"
            ? ["resident.self"]
            : role === "staff"
              ? ["property.read"]
              : ["finance.manage", "property.read", "lease.manage"],
        csrfToken: "fixture",
      });
    if (p === "/api/company/properties/home")
      return json({ id: "home", name: "Maple House" });
    if (/^\/api\/(company|resident)\/deposits\//.test(p))
      return state.status === 200
        ? json({ businessDate: "2026-10-15", lease, account })
        : json({ error: "Deposit access unavailable" }, state.status);
    if (/^\/api\/(company|resident)\/deposits$/.test(p))
      return state.status === 200
        ? json({
            businessDate: "2026-10-15",
            summary,
            accounts: state.accounts,
          })
        : json({ error: "Deposit access unavailable" }, state.status);
    return json([]);
  });
  return { state, lease, receipt, account };
}
test("property deposit directory connects named lease, complete balances, export and focused receipt review", async ({
  page,
}) => {
  const { lease, receipt } = await fixture(page);
  await page.goto("/company/properties/home/deposits");
  await expect(
    page.getByRole("region", { name: "Security deposit balances" }),
  ).toContainText("$1,500.00");
  await page.getByRole("link", { name: /Open deposit account/ }).click();
  await expect(page).toHaveURL(
    new RegExp("/company/properties/home/deposits\\?leaseId=" + lease.id),
  );
  const account = page.getByRole("dialog", {
    name: "Security deposit account",
    exact: true,
  });
  await expect(account).toContainText("Maple House · Unit Apartment 1");
  await expect(account).toContainText("Deposit receipt #123");
  await expect(account.getByText(receipt.id, { exact: true })).toHaveCount(0);
  const download = page.waitForEvent("download");
  await account.getByRole("button", { name: "Download deposit CSV" }).click();
  let csv = "";
  for await (const c of (await (await download).createReadStream())!)
    csv += c.toString();
  expect(csv).toContain("DR-123");
  expect(csv).toContain(receipt.id);
  expect(csv).toContain("TX-456");
  expect(csv).toContain(receipt.cashEntry.id);
  await account
    .getByRole("button", { name: "Record deposit received", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Record security deposit received",
    exact: true,
  });
  await editor.getByLabel("Deposit payment method").selectOption("check");
  await editor
    .getByRole("button", { name: "Review deposit receipt", exact: true })
    .click();
  await expect(editor).toContainText("Held after receipt");
  await expect(editor).toContainText("$1,500.00");
  await editor.getByRole("button", { name: "Back to deposit details" }).click();
  await expect(
    editor.getByLabel("Deposit amount received (USD)", { exact: true }),
  ).toHaveValue("750.00");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/tmp/pf-deposit-receipt-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await editor.getByRole("button", {name:"Save draft & close",exact:true}).click();
  await expect(account).toBeVisible();
});
test("resident deposit view is read only and conceals internal notes; access revocation removes balances", async ({
  page,
}) => {
  const { state, lease } = await fixture(page, "resident");
  await page.goto("/resident/deposits?leaseId=" + lease.id);
  const account = page.getByRole("dialog", {
    name: "Security deposit account",
    exact: true,
  });
  await expect(account).toContainText("Deposit receipt #123");
  await expect(
    account.getByRole("region", { name: "Security deposit balances" }),
  ).toContainText("$750.00");
  await expect(
    account.getByRole("button", {
      name: "Record deposit received",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    account.getByRole("button", {
      name: "Correct deposit receipt",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Private finance note", { exact: true }),
  ).toHaveCount(0);
  state.status = 403;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(account.getByRole("alert")).toContainText(
    "Deposit access unavailable",
  );
  await expect(
    account.getByRole("region", { name: "Security deposit balances" }),
  ).toHaveCount(0);
});
test("deposit directory clamps shrinking pages and initial failures do not fabricate zero balances", async ({
  page,
}) => {
  const { state, account } = await fixture(page);
  for (let i = 1; i < 30; i++)
    state.accounts.push({
      ...account,
      id: "account-" + i,
      leaseId: "lease-" + i,
      lease: { ...account.lease, unit: { label: "Apartment " + (i + 1) } },
    });
  await page.goto("/company/deposits");
  await expect(
    page.getByRole("link", { name: /Open deposit account/ }),
  ).toHaveCount(25);
  await page.getByRole("button", { name: "Next deposit accounts" }).click();
  await expect(
    page.getByRole("link", { name: /Open deposit account/ }),
  ).toHaveCount(5);
  state.accounts = state.accounts.slice(0, 3);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("link", { name: /Open deposit account/ }),
  ).toHaveCount(3);
  state.status = 503;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "Deposit access unavailable",
  );
  await expect(
    page.getByRole("region", { name: "Security deposit balances" }),
  ).toHaveCount(0);
});

test("a conflicting deposit edit preserves the review and offers an explicit current-version reset", async ({
  page,
}) => {
  const { account, lease } = await fixture(page);
  let posted: any;
  await page.route("**/api/company/deposits/" + lease.id, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    posted = route.request().postDataJSON();
    return route.fulfill({
      status: 409,
      json: { error: "This record changed", code: "STALE_VERSION" },
    });
  });
  await page.goto("/company/deposits?leaseId=" + lease.id);
  const dialog = page.getByRole("dialog", {
    name: "Security deposit account",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Change deposit requirement", exact: true })
    .click();
  let editor = page.getByRole("dialog", {
    name: "Security deposit requirement",
    exact: true,
  });
  await editor
    .getByLabel("Refundable deposit required (USD)", { exact: true })
    .fill("1600.00");
  await editor
    .getByLabel("Reason for deposit change")
    .fill("Agreed updated requirement");
  await editor
    .getByRole("button", { name: "Review deposit requirement", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Save deposit requirement", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("This record changed");
  expect(posted.expectedVersion).toBe(1);
  account.version = 2;
  account.requiredCents = 170000;
  account.summary.requiredCents = "170000";
  await expect(editor).toContainText("$1,600.00");
  await editor
    .getByRole("button", {
      name: "Load current details and reset draft",
      exact: true,
    })
    .click();
  editor = page.getByRole("dialog", {
    name: "Security deposit requirement",
    exact: true,
  });
  await expect(
    editor.getByLabel("Refundable deposit required (USD)", { exact: true }),
  ).toHaveValue("1700.00");
  await expect(
    editor.getByRole("button", {
      name: "Review deposit requirement",
      exact: true,
    }),
  ).toBeVisible();
});

test("saving from the deposit directory refreshes its balances immediately", async ({
  page,
}) => {
  const { state, account, lease } = await fixture(page);
  await page.route(
    "**/api/company/deposits/" + lease.id + "/receipts",
    async (route) => {
      account.summary.heldCents = "150000";
      account.summary.outstandingCents = "0";
      return route.fulfill({ json: { id: "saved" } });
    },
  );
  await page.goto("/company/properties/home/deposits");
  await page
    .getByRole("link", { name: "Open deposit account", exact: true })
    .click();
  const outer = page.getByRole("dialog", {
    name: "Security deposit account",
    exact: true,
  });
  await outer
    .getByRole("button", { name: "Record deposit received", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Record security deposit received",
    exact: true,
  });
  await form.getByLabel("Deposit payment method").selectOption("cash");
  await form
    .getByRole("button", { name: "Review deposit receipt", exact: true })
    .click();
  await form
    .getByRole("button", { name: "Confirm deposit received", exact: true })
    .click();
  await expect(form).not.toBeVisible();
  await expect
    .poll(
      () =>
        state.requests.filter(
          (x) => x === "/api/company/deposits?propertyId=home",
        ).length,
    )
    .toBeGreaterThan(1);
  await outer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Security deposit balances" }),
  ).toContainText("$1,500.00");
  await expect(
    page.getByText("$1,500.00 held · $0.00 still to collect", { exact: true }),
  ).toBeVisible();
});

test('deposit setup chooses its lease directly and keeps property context',async({page})=>{
 const {state,lease}=await fixture(page);await page.route('**/api/company/leases?*',route=>route.fulfill({json:{items:[lease],nextCursor:null}}));await page.goto('/company/deposits?propertyId=home');await page.getByRole('button',{name:'Set up a security deposit',exact:true}).click();await expect(page.getByRole('dialog',{name:'Choose a lease for this deposit'})).toContainText('Maple House');await page.getByRole('button',{name:'Choose this lease',exact:true}).click();await expect(page).toHaveURL(new RegExp('propertyId=home&leaseId='+lease.id));await expect(page.getByRole('heading',{name:'Refundable security deposit',exact:true})).toBeVisible();expect(state.requests.some(path=>path.startsWith('/api/company/rent'))).toBe(false);
});

test('deposit receipt pairs fields, preserves method edits and replays only the reviewed receipt after response loss',async({page})=>{
 const {lease}=await fixture(page);let response:'reject'|'lose'|'ok'='reject';const posted:any[]=[];const committed=new Map<string,unknown>();
 await page.route('**/api/company/deposits/'+lease.id+'/receipts',async route=>{
  const body=route.request().postDataJSON();posted.push(body);
  if(response==='reject')return route.fulfill({status:400,json:{error:'Review this fictional deposit receipt.'}});
  if(!committed.has(body.submissionKey))committed.set(body.submissionKey,{id:'fictional-receipt'});
  if(response==='lose')return route.abort('failed');
  return route.fulfill({json:committed.get(body.submissionKey)});
 });
 await page.goto('/company/properties/home/deposits?leaseId='+lease.id);
 await page.getByRole('dialog',{name:'Security deposit account',exact:true}).getByRole('button',{name:'Record deposit received',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Record security deposit received',exact:true});
 await expect(editor.getByLabel('Deposit amount received (USD)',{exact:true})).toHaveValue('750.00');
 await expect(editor.locator('.financial-required')).toHaveCount(3);
 await expect(editor.getByLabel('Deposit payment method',{exact:true})).toHaveJSProperty('required',true);
 await expect(editor.getByLabel('Deposit payment reference (optional)',{exact:true})).toHaveJSProperty('required',false);
 await editor.getByLabel('Deposit payment method',{exact:true}).selectOption('check');
 await editor.getByLabel('Deposit payment reference (optional)',{exact:true}).fill('Fictional check 101');
 await editor.getByLabel('Internal deposit receipt note (optional)',{exact:true}).fill('Fictional original review note');
 await editor.getByLabel('Deposit payment method',{exact:true}).selectOption('bank_transfer');
 await expect(editor.getByLabel('Deposit payment reference (optional)',{exact:true})).toHaveValue('Fictional check 101');
 await editor.getByLabel('Deposit payment method',{exact:true}).selectOption('check');
 for(const [size,width,height] of [['desktop',1365,900],['mobile',390,844]] as const){
  await page.setViewportSize({width,height});
  const amount=await editor.getByLabel('Deposit amount received (USD)',{exact:true}).boundingBox(),date=await editor.getByLabel('Deposit received date',{exact:true}).boundingBox();
  expect(amount).not.toBeNull();expect(date).not.toBeNull();
  if(size==='desktop')expect(Math.abs(amount!.y-date!.y)).toBeLessThan(2);else expect(date!.y).toBeGreaterThan(amount!.y+amount!.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(editor.getByRole('button',{name:'Review deposit receipt',exact:true})).toBeInViewport({ratio:1});
  await page.screenshot({path:`/tmp/propertyflow-deposit-receipt-${size}-after.png`});
 }
 await editor.getByRole('button',{name:'Review deposit receipt',exact:true}).click();expect(posted).toHaveLength(0);
 await expect(editor).toContainText('Held after receipt');await expect(editor).toContainText('$1,500.00');
 await editor.getByRole('button',{name:'Confirm deposit received',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('Review this fictional');await expect(editor.getByRole('alert')).toBeFocused();
 for(const [size,width,height] of [['desktop',1365,900],['mobile',390,844]] as const){
  await page.setViewportSize({width,height});await expect(editor.getByRole('alert')).toBeInViewport({ratio:1});
  await page.screenshot({path:`/tmp/propertyflow-deposit-receipt-${size}-error-after.png`});
 }
 await editor.getByRole('button',{name:'Back to deposit details',exact:true}).click();
 await expect(editor.getByLabel('Deposit amount received (USD)',{exact:true})).toHaveValue('750.00');
 await expect(editor.getByLabel('Deposit payment method',{exact:true})).toHaveValue('check');
 await expect(editor.getByLabel('Deposit payment reference (optional)',{exact:true})).toHaveValue('Fictional check 101');
 await expect(editor.getByLabel('Internal deposit receipt note (optional)',{exact:true})).toHaveValue('Fictional original review note');
 await editor.getByRole('button',{name:'Review deposit receipt',exact:true}).click();response='lose';
 await editor.getByRole('button',{name:'Confirm deposit received',exact:true}).click();await expect(editor.getByRole('alert')).toBeVisible();
 await expect(editor.getByRole('button',{name:'Back to deposit details',exact:true})).toHaveCount(0);
 response='ok';await editor.getByRole('button',{name:'Retry this deposit save',exact:true}).click();await expect(editor).not.toBeVisible();
 expect(committed.size).toBe(1);expect(posted).toHaveLength(3);expect(posted[1]).toEqual(posted[2]);
 expect(posted[1]).toMatchObject({amount:'750.00',occurredOn:'2026-10-15',method:'check',paymentReference:'Fictional check 101',memo:'Fictional original review note',expectedVersion:1,expectedLeaseVersion:1});
});
