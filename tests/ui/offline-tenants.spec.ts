import { test, expect, type Page } from "@playwright/test";
import { tenantDirectoryFixture, tenantRentalHistoryFixture } from "./tenant-directory-fixture";
async function fixture(
  page: Page,
  options: { signedIn?: boolean; loseSave?: boolean } = {},
) {
  const state = {
    contact: null as any,
    creates: [] as any[],
    invites: [] as any[],
    setup: 0,
    workspace: null as any,
    updates: [] as any[],
    loseSave: !!options.loseSave,
  };
  const workspace = {
    businessDate: "2026-10-16",
    timezone: "America/New_York",
    leases: [],
    rent: {
      outstandingCents: "0",
      creditCents: "0",
      afterGraceCents: "0",
      upcomingCents: "0",
    },
    deposits: { heldCents: "0", outstandingCents: "0" },
  };
  state.workspace = workspace;
  const profiles = () => state.contact ? [{ ...state.contact, contactId: state.contact.id, recordStatus: state.contact.status, portalState: "offline", user: null }] : [];
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      p = new URL(req.url()).pathname,
      json = (value: unknown, status = 200) =>
        route.fulfill({ json: value, status });
    if (p === "/api/bootstrap")
      return options.signedIn === false
        ? json({ error: "Sign in" }, 401)
        : json({
            user: {
              id: "owner",
              name: "Olivia Owner",
              email: "owner@test.invalid",
              status: "active",
              emailVerified: true,
            },
            membership: {
              companyId: "a",
              version: 1,
              role: "owner",
              status: "active",
              company: { name: "FAP", status: "active" },
            },
            permissions: [
              "property.read",
              "property.write",
              "resident.assignment.manage",
              "members.manage",
              "lease.manage",
              "finance.manage",
            ],
            csrfToken: "fixture",
          });
    if (p === "/api/company/resident-profiles/directory") return json(tenantDirectoryFixture(profiles(),req.url(),{companyId:"a",today:workspace.businessDate,timezone:workspace.timezone}));
    if (p === "/api/company/resident-profiles") return json(profiles());
    if (p === "/api/company/resident-contacts/jordan-profile/rentals") return state.contact ? json(tenantRentalHistoryFixture(state.contact,state.contact.rentals||state.workspace.leases,req.url(),{companyId:"a",today:workspace.businessDate,timezone:workspace.timezone})) : json({error:"Tenant unavailable"},404);
    if (p === "/api/invitations") return json([]);
    if (p === "/api/company/resident-contacts" && req.method() === "POST") {
      const body = req.postDataJSON();
      state.creates.push(body);
      state.contact ??= {
        id: "jordan-profile",
        ...body,
        status: "active",
        version: 1,
        userId: null,
        portal: null,
        activity: [],
        invitations: [],
        leases: [],
      };
      if (state.loseSave) {
        state.loseSave = false;
        return route.abort("failed");
      }
      return json(state.contact);
    }
    if (p === "/api/company/resident-contacts/jordan-profile") {
      if (req.method() === "PATCH") {
        const body = req.postDataJSON();
        state.updates.push(body);
        state.contact = {...state.contact, ...body, version: state.contact.version + 1};
      }
      return json(state.contact);
    }
    if (p === "/api/company/resident-contacts/jordan-profile/workspace")
      return json(workspace);
    if (p === "/api/company/resident-contacts/jordan-profile/invitations") {
      state.invites.push(req.postDataJSON());
      return json({
        acceptanceUrl: "https://app.test/invite?contact=1#private-token",
        expiresAt: "2026-10-19",
      });
    }
    if (p === "/api/invitations/setup-account") {
      state.setup++;
      return json({ message: "Account setup emails requested." });
    }
    if (p === "/api/company/properties/home")
      return json({
        id: "home",
        version: 1,
        name: "Oak Place",
        address: "12 Oak Street",
        city: "Philadelphia",
        state: "PA",
        zip: "19103",
        countryCode: "US",
        propertyType: "multi_family",
        yearBuilt: 1985,
        parcelId: "LOT-16",
        notes: "Use the north entrance.",
      });
    return json([]);
  });
  return state;
}
test("create one account, retain a readable address and connect the next lease", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/company/residents");
  await page.getByRole("button", { name: "Add tenant", exact: true }).click();
  await page.getByLabel("Full name *", { exact: true }).fill("Jordan Rivera");
  await page
    .getByLabel("Contact email", { exact: true })
    .fill("jordan@test.invalid");
  await page.getByText("Mailing address · optional", { exact: true }).click();
  for (const [label, value] of [
    ["Address line 1", "12 Oak Street"],
    ["Address line 2", "Apt 4"],
    ["City", "Philadelphia"],
    ["State / region", "PA"],
    ["Postal code", "19103"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  const street = await page
      .getByLabel("Address line 1", { exact: true })
      .boundingBox(),
    city = await page.getByLabel("City", { exact: true }).boundingBox(),
    region = await page
      .getByLabel("State / region", { exact: true })
      .boundingBox();
  expect(street!.y).toBeLessThan(city!.y);
  expect(city!.y).toBe(region!.y);
  expect(street!.width).toBeGreaterThan(city!.width);
  await page.screenshot({
    path: "/tmp/propertyflow-tenant-form-desktop.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Review tenant", exact: true })
    .click();
  await page.getByRole("button", { name: "Save tenant", exact: true }).click();
  await expect(page).toHaveURL(/company\/tenants\/jordan-profile$/);
  await expect(
    page.getByRole("heading", { name: "Jordan Rivera", exact: true }),
  ).toBeVisible();
  expect(state.creates).toHaveLength(1);
  expect(state.invites).toHaveLength(0);
  await expect(page.locator(".tenant-status")).toHaveText("Not invited");
  await expect(
    page.getByRole("link", { name: "Record a lease for Jordan Rivera" }),
  ).toHaveAttribute(
    "href",
    "/company/leases?new=lease&contactId=jordan-profile",
  );
  await expect(page.locator(".postal-address > span")).toHaveText([
    "12 Oak Street",
    "Apt 4",
    "Philadelphia, PA 19103",
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/propertyflow-offline-profile-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit tenant details" }).click();
  await page.screenshot({
    path: "/tmp/propertyflow-tenant-form-mobile.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () =>
        document.querySelector("dialog")!.scrollWidth <=
        document.querySelector("dialog")!.clientWidth,
    ),
  ).toBe(true);
});
test("invitation follows durable profile creation and requires an explicit owner review", async ({
  page,
}) => {
  const state = await fixture(page, { loseSave: true });
  await page.goto("/company/residents");
  await page
    .getByRole("button", { name: "Invite tenant", exact: true })
    .click();
  await page.getByLabel("Full name *", { exact: true }).fill("Jordan Rivera");
  await page
    .getByLabel("Contact email", { exact: true })
    .fill("jordan@test.invalid");
  await expect(page.getByLabel("Portal invitation")).toHaveValue("yes");
  await page
    .getByRole("button", { name: "Review tenant", exact: true })
    .click();
  await page.getByRole("button", { name: "Save tenant", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Save tenant", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Invite Jordan Rivera", exact: true }),
  ).toBeVisible();
  expect(state.creates[0]).toEqual(state.creates[1]);
  expect(state.creates[0]).not.toHaveProperty("invitePortal");
  expect(state.invites).toHaveLength(0);
  await page
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  expect(state.invites).toHaveLength(0);
  await page.getByRole("checkbox", { name: /I approve this person/ }).check();
  await page
    .getByRole("button", { name: "Create invitation link", exact: true })
    .click();
  await expect(page.getByLabel("Private invitation link")).toHaveValue(
    "https://app.test/invite?contact=1#private-token",
  );
  expect(state.invites).toEqual([{ expectedVersion: 1, approvals: [], submissionKey: expect.any(String) }]);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "View tenant Jordan Rivera", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Invite tenant", exact: true })
    .click();
  await expect(page.getByLabel("Full name *", { exact: true })).toHaveValue("");
});
test("property address is one familiar block and edit fields follow postal reading order on desktop and mobile", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/properties/home");
  await expect(
    page.getByRole("heading", { name: "Oak Place", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Property location" })
      .locator(".postal-address > span"),
  ).toHaveText(["12 Oak Street", "Philadelphia, PA 19103", "US"]);
  await page.screenshot({
    path: "/tmp/propertyflow-property-details-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit property" }).click();
  await page.screenshot({
    path: "/tmp/propertyflow-property-form-desktop.png",
    fullPage: true,
  });
  const street = await page
      .getByLabel("Street address", { exact: true })
      .boundingBox(),
    city = await page.getByLabel("City", { exact: true }).boundingBox(),
    region = await page
      .getByLabel("State / region", { exact: true })
      .boundingBox(),
    zip = await page.getByLabel("Postal code", { exact: true }).boundingBox();
  expect(street!.y).toBeLessThan(city!.y);
  expect(city!.y).toBe(region!.y);
  expect(region!.y).toBe(zip!.y);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCity = await page
      .getByLabel("City", { exact: true })
      .boundingBox(),
    mobileState = await page
      .getByLabel("State / region", { exact: true })
      .boundingBox();
  expect(mobileCity!.y).toBeLessThan(mobileState!.y);
  await page.screenshot({
    path: "/tmp/propertyflow-property-form-mobile.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/propertyflow-property-details-mobile.png",
    fullPage: true,
  });
});
test("an invited tenant can start account setup before sign-in and the private token is removed from the URL", async ({
  page,
}) => {
  const state = await fixture(page, { signedIn: false });
  await page.goto("/invite?contact=1#setup-test-token");
  await expect(
    page.getByRole("heading", { name: "Welcome to Property Flow" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/invite$/);
  await page.getByText("First time signing in or need a password?",{exact:true}).click();
  await page
    .getByRole("button", { name: "Email me a setup link" })
    .click();
  await expect(page.getByText(/Account setup request completed/)).toBeVisible();
  expect(state.setup).toBe(1);
  await page.screenshot({
    path: "/tmp/propertyflow-invitation-setup-desktop.png",
    fullPage: true,
  });
});

test("a lost accepted invitation recovers after reload without asking the owner for a new grant", async ({
  page,
}) => {
  await fixture(page);
  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "resident",
          name: "Jordan Rivera",
          email: "new-verified-signin@test.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "a",
          role: "resident",
          status: "active",
          version: 1,
          company: { name: "FAP", status: "active" },
        },
        permissions: ["resident.self"],
        csrfToken: "fixture",
        destination: "/resident",
      },
    }),
  );
  await page.route("**/api/invitations/preview", (route) =>
    route.fulfill({
      json: {
        company: "FAP",
        name: "Jordan Rivera",
        contact: true,
        accepted: true,
        leaseApprovals: [],
        leases: [],
      },
    }),
  );
  let acknowledgements = 0;
  await page.route("**/api/invitations/accept", (route) => {
    acknowledgements++;
    return route.fulfill({ json: { success: true } });
  });
  await page.goto("/invite?contact=1#accepted-token");
  await expect(
    page.getByRole("heading", { name: "Your profile is connected" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Accept tenant invitation" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue to resident portal" })
    .click();
  await expect(page).toHaveURL(/\/resident$/);
  expect(acknowledgements).toBe(1);
  expect(
    await page.evaluate(() => sessionStorage.getItem("pf-invitation")),
  ).toBeNull();
});

function recordedTenant() {
  return {id:"jordan-profile",userId:null,name:"Jordan Rivera",email:"jordan@test.invalid",phone:"555-0101",status:"active",version:3,portal:null,activity:[],invitations:[],managementNotes:"Preserve these internal details",canArchive:false};
}
function activeLease() {
  return {id:"lease-1",propertyId:"home",startsOn:"2026-10-01",endsOn:null,status:"active",rentCents:150000,rentDueDay:1,graceDays:5,property:{name:"Oak Place"},unit:{label:"Apartment 4"},rent:{outstandingCents:"0",creditCents:"0",afterGraceCents:"0",upcomingCents:"0"},deposit:null};
}
test("existing current and upcoming leases never prompt recording another lease, including on a failed refresh", async ({page}) => {
  const state = await fixture(page);
  state.contact = recordedTenant();
  state.workspace.leases = [activeLease()];
  await page.goto("/company/tenants/jordan-profile");
  await expect(page.getByRole("link",{name:"Apartment 4",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:/Record a lease/})).toHaveCount(0);
  await expect(page.getByText("Keep this tenant's rental work connected")).toHaveCount(0);
  await page.getByText("More tenant actions",{exact:true}).click();
  await expect(page.getByRole("button",{name:"Archive tenant",exact:true})).toBeDisabled();
  state.workspace.leases[0].startsOn="2026-12-01";
  await page.reload();
  await expect(page.getByText("Upcoming",{exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:/Record a lease/})).toHaveCount(0);
  await page.route("**/api/company/resident-contacts/jordan-profile/workspace",route=>route.fulfill({status:503,json:{error:"Lease check unavailable"}}));
  await page.reload();
  await expect(page.getByRole("heading",{name:"Balances and leases unavailable"})).toBeVisible();
  await expect(page.getByRole("link",{name:/Record a lease/})).toHaveCount(0);
});
test("tenant directory shows each property, unit and relationship, searches rental context and blocks archiving current residents", async ({page})=>{
  const state=await fixture(page);
  state.contact={...recordedTenant(),rentals:[
    {leaseId:"lease-1",propertyId:"home",propertyName:"Oak Place",unitLabel:"Apartment 4",status:"current",role:"leaseholder",startsOn:"2026-10-01",endsOn:null},
    {leaseId:"lease-2",propertyId:"maple",propertyName:"Maple House",unitLabel:"Suite 9",status:"former",role:"occupant",startsOn:"2025-01-01",endsOn:"2025-12-31"},
  ]};
  await page.goto("/company/residents");
  const row=page.getByRole("row").filter({hasText:"Jordan Rivera"});
  await expect(row.getByRole("link",{name:/Oak Place/})).toHaveAttribute("href",/lease-1/);
  await expect(row.getByText("Apartment 4",{exact:true})).toBeVisible();
  await expect(row.getByText("Former · Occupant",{exact:true})).toBeVisible();
  await expect(row.getByRole("button",{name:"Archive tenant",exact:true})).toHaveCount(0);
  await page.getByRole("searchbox").fill("Suite 9");
  await expect(row).toBeVisible();
  await page.screenshot({path:"/tmp/propertyflow-tenant-directory-desktop.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:"/tmp/propertyflow-tenant-directory-mobile.png",fullPage:true});
});
test("archive and restore live in tenant details and retain profile/history discovery",async({page})=>{
  const state=await fixture(page);
  state.contact={...recordedTenant(),canArchive:true,rentals:[]};
  await page.goto("/company/residents");
  await expect(page.getByRole("button",{name:"Archive tenant",exact:true})).toHaveCount(0);
  await page.getByRole("link",{name:"View tenant Jordan Rivera"}).click();
  await page.getByText("More tenant actions",{exact:true}).click();
  await page.getByRole("button",{name:"Archive tenant",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("rental, financial and audit history will remain");
  await page.getByRole("button",{name:"Confirm archive",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Archive tenant",exact:true})).toBeHidden();
  expect(state.updates[0]).toMatchObject({expectedVersion:3,status:"archived",name:"Jordan Rivera",managementNotes:"Preserve these internal details"});
  await page.getByRole("link",{name:"← All tenants",exact:true}).click();
  await expect(page.getByRole("link",{name:"View tenant Jordan Rivera"})).toHaveCount(0);
  await page.getByLabel("Tenant records",{exact:true}).selectOption("archived");
  await page.getByRole("link",{name:"View tenant Jordan Rivera"}).click();
  await page.getByText("More tenant actions",{exact:true}).click();
  await page.getByRole("button",{name:"Restore tenant",exact:true}).click();
  await page.getByRole("button",{name:"Confirm restore",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Restore tenant",exact:true})).toBeHidden();
  await page.getByRole("link",{name:"← All tenants",exact:true}).click();
  await expect(page.getByRole("heading",{name:"No archived tenants"})).toBeVisible();
  await page.getByLabel("Tenant records",{exact:true}).selectOption("active");
  await expect(page.getByRole("link",{name:"View tenant Jordan Rivera"})).toBeVisible();
  expect(state.updates[1]).toMatchObject({expectedVersion:4,status:"active",managementNotes:"Preserve these internal details"});
});

test('tenant invitation replacement keeps its new private link visible after the source record refreshes',async({page})=>{
 const state=await fixture(page);
 const original={id:'pending-invite',version:1,expiresAt:'2099-01-01',acceptedAt:null,revokedAt:null};
 state.contact={id:'jordan-profile',name:'Fictional tenant',email:'tenant@test.invalid',phone:null,status:'active',version:1,userId:'fictional-account',user:{id:'fictional-account',email:'tenant@test.invalid',emailVerified:false,firstSignedInAt:null},portal:null,leases:[],invitations:[original],activity:[]};
 await page.route('**/api/invitations/delivery',route=>route.fulfill({json:{emailAvailable:false}}));
 await page.route('**/api/invitations/pending-invite/replace',async route=>{
  expect(route.request().postDataJSON()).toMatchObject({expectedVersion:1,delivery:'link',submissionKey:expect.any(String)});
  const replacement={...original,id:'replacement-invite'};state.contact.invitations=[{...original,revokedAt:'2026-10-18'},replacement];
  return route.fulfill({json:{...replacement,acceptanceUrl:'https://example.test/invite?contact=1#fictional-replacement'}});
 });
 await page.goto('/company/tenants/jordan-profile');await page.getByRole('button',{name:'Send or replace invitation',exact:true}).click();await page.getByRole('button',{name:'Create replacement link',exact:true}).click();
 await expect(page.getByLabel('Private invitation link',{exact:true})).toHaveValue('https://example.test/invite?contact=1#fictional-replacement');
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByLabel('Private invitation link',{exact:true})).toHaveValue('https://example.test/invite?contact=1#fictional-replacement');
});

for(const entry of ['tenant profile','invitation history'])test(`changed household approval from ${entry} opens a fresh explicit review without a separate revoke step`,async({page})=>{
 const state=await fixture(page);
 state.contact={id:'jordan-profile',name:'Fictional tenant',email:'tenant@test.invalid',status:'active',version:2,userId:'fictional-account',portal:null,leases:[{id:'participant',leaseId:'lease',role:'occupant',version:3,lease:{version:8,startsOn:'2026-10-01',endsOn:'2027-09-30',property:{name:'Fictional home'},unit:{label:'Unit A'}}}],invitations:[{id:'stale-invite',version:1,expiresAt:'2099-01-01',acceptedAt:null,revokedAt:null}],activity:[]};
 await page.route('**/api/invitations/delivery',route=>route.fulfill({json:{emailAvailable:false}}));
 await page.route('**/api/invitations/stale-invite/replace',route=>route.fulfill({status:409,json:{error:'The household changed. Ask the owner for a newly reviewed invitation.',code:'INVITATION_CHANGED'}}));
 if(entry==='invitation history'){
  await page.route(/\/api\/invitations(?:\?|$)/,route=>route.fulfill({json:{items:[{...state.contact.invitations[0],email:state.contact.email,role:'resident',contactId:state.contact.id,leaseId:null}],total:1,pageSize:25}}));
  await page.goto('/company/residents');await page.locator('summary').filter({hasText:'Tenant invitations'}).click();await page.getByRole('button',{name:'Send or replace',exact:true}).click();
 }else{await page.goto('/company/tenants/jordan-profile');await page.getByRole('button',{name:'Send or replace invitation',exact:true}).click();}
 await page.getByRole('button',{name:'Create replacement link',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Review the current access');await expect(page.getByRole('button',{name:'Retry replacement link',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Review current access',exact:true}).click();
 const review=page.getByRole('dialog',{name:'Review tenant invitation',exact:true});await expect(review.getByText('Occupant · no lease financial access',{exact:true})).toBeVisible();const approve=review.getByRole('checkbox',{name:'I approve this person and the access shown above.',exact:true});await expect(approve).not.toBeChecked();
 await review.getByRole('button',{name:'Create invitation link',exact:true}).click();expect(state.invites).toHaveLength(0);await approve.check();await review.getByRole('button',{name:'Create invitation link',exact:true}).click();await expect(review.getByLabel('Private invitation link',{exact:true})).toBeVisible();expect(state.invites).toHaveLength(1);expect(state.invites[0].approvals).toEqual([{id:'participant',leaseId:'lease',role:'occupant',version:3,leaseVersion:8}]);
});
