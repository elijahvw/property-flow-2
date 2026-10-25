import { test, expect, BrowserContext } from "@playwright/test";

const company = { id: "fictional-company", name: "Fictional company", status: "active", version: 1, timezone: "America/New_York", adminNotes: "Fictional private platform note", memberships: [] };
const catalog = [{ key: "properties", label: "Properties", description: "Property and unit records" }, { key: "maintenance", label: "Maintenance", description: "Maintenance operations" }];
const originalPlan = { id: "fixture-plan", name: "Fictional monthly plan", version: 1, monthlyPriceCents: 10000, currency: "USD", features: ["properties", "maintenance"], archivedAt: null, createdAt: "2026-10-24T12:00:00Z" };
const originalInvoice = { id: "fixture-invoice", companyId: company.id, number: 1, reference: "INV-000001", periodStart: "2026-10-01", periodEnd: "2026-11-01", dueOn: "2026-10-31", status: "issued", version: 1, currency: "USD", monthlyPriceCents: 10000, planName: originalPlan.name, planVersion: 1, paidCents: 0, balanceCents: 10000, paymentState: "unpaid", billingName: company.name, billingEmail: "billing@test.invalid", billingAddress: {}, issuedAt: "2026-10-24T12:00:00Z" };
async function fixture(context: BrowserContext, owner = false) {
  const state = { plans: [originalPlan] as any[], subscription: null as any, settings: [] as any[], invoice: { ...originalInvoice }, payments: [] as any[], events: [{ id: "event-1", action: "invoice.issued", detail: {}, createdAt: "2026-10-24T12:00:00Z" }], receiptRequests: [] as any[], invoiceRequests: [] as any[], loseReceiptResponse: true };
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    const detail = () => ({ invoice: state.invoice, payments: state.payments, events: state.events });
    const subscription = () => ({ subscription: state.subscription, plans: owner ? undefined : state.plans, catalog, effectiveFeatures: { properties: "enabled", maintenance: state.subscription?.featureOverrides?.maintenance || "enabled" }, billingProfile: { name: company.name, email: "billing@test.invalid", address: {}, companyVersion: 1 } });
    if (path === "/api/bootstrap") return json({ user: { id: owner ? "owner" : "platform", name: "Fictional user", email: "fictional@test.invalid", emailVerified: true, status: "active", platformRole: owner ? null : "owner" }, membership: owner ? { companyId: company.id, version: 1, role: "owner", status: "active", company } : null, permissions: owner ? ["subscription.read"] : ["platform.manage"], destination: owner ? "/company/subscription" : "/platform/companies", csrfToken: "fixture", impersonation: null });
    if (path === "/api/account/guide") return json({ eligible: false, steps: [] });
    if (path === "/api/platform/plans" && request.method() === "GET") return json({ items: state.plans, catalog });
    if (path === "/api/platform/plans" && request.method() === "POST") { const b = request.postDataJSON(); state.plans.push({ ...originalPlan, ...b, id: "new-plan", version: 2, monthlyPriceCents: Math.round(Number(b.monthlyPrice) * 100) }); return json(state.plans.at(-1)); }
    if (/\/api\/platform\/plans\/[^/]+\/archive$/.test(path) && request.method() === "PATCH") { const index = state.plans.findIndex(plan => plan.id === path.split("/").at(-2)); state.plans[index] = { ...state.plans[index], archivedAt: request.postDataJSON().archived ? "2026-10-24T12:00:00Z" : null }; return json(state.plans[index]); }
    if (path === `/api/platform/companies/${company.id}`) return json(company);
    if (path.endsWith("/subscription") && request.method() === "GET") return json(subscription());
    if (path.endsWith("/subscription") && request.method() === "PUT") { const b = request.postDataJSON(); state.settings.push(b); state.subscription = { ...b, companyId: company.id, version: 1, plan: state.plans.find(plan => plan.id === b.planId), updatedAt: "2026-10-24T12:00:00Z" }; return json(subscription()); }
    if (path.endsWith("/usage")) return json({ companyId: company.id, from: url.searchParams.get("from"), to: url.searchParams.get("to"), areas: [{ key: "maintenance", label: "Maintenance", successfulReads: 7, successfulWrites: 2, total: 9 }], resources: { properties: 1, activeUnits: 3, activeLeases: 2, activeMembers: 4, documentVersions: 2, documentBytes: 50 }, trackingStartedAt: "2026-10-24T12:00:00Z", definition: "Successful feature API requests, including repeats; excludes impersonation. These analytics are not billable usage." });
    if (path.endsWith("/billing")) return json({ items: [state.invoice], nextCursor: null, total: 1, totalOutstandingCents: state.invoice.balanceCents });
    if (path.endsWith("/billing/invoices") && request.method() === "POST") { const b = request.postDataJSON(); state.invoiceRequests.push(b); if (b.expectedSubscriptionVersion !== state.subscription?.version || b.expectedCompanyVersion !== 1) return json({ error: "The plan or billing details changed. Prepare a new invoice review.", code: "BILLING_REVIEW_CHANGED" }, 409); state.invoice = { ...state.invoice, monthlyPriceCents: state.subscription.plan.monthlyPriceCents, balanceCents: state.subscription.plan.monthlyPriceCents }; return json(detail()); }
    if (path.endsWith(`/billing/invoices/${state.invoice.id}`)) return json(detail());
    if (path.endsWith("/payments") && request.method() === "POST") {
      const b = request.postDataJSON(); state.receiptRequests.push(b);
      if (!state.payments.length) { state.payments.push({ id: "payment-1", amountCents: 5000, receivedOn: b.receivedOn, paymentReference: b.paymentReference, createdAt: "2026-10-24T12:00:00Z", reversal: null }); state.invoice = { ...state.invoice, version: 2, paidCents: 5000, balanceCents: 5000, paymentState: "partially_paid" }; }
      if (state.loseReceiptResponse) { state.loseReceiptResponse = false; return json({ error: "The saved receipt response was interrupted." }, 503); }
      return json(detail());
    }
    if (path.endsWith("/reverse")) { state.payments[0].reversal = { id: "reversal-1", reason: request.postDataJSON().reason, createdAt: "2026-10-24T12:00:00Z" }; state.invoice = { ...state.invoice, version: 3, paidCents: 0, balanceCents: 10000, paymentState: "unpaid" }; return json(detail()); }
    if (path.endsWith("/void")) { state.invoice = { ...state.invoice, version: 4, status: "void", paymentState: "void", balanceCents: 0 }; return json(detail()); }
    return json([]);
  });
  return state;
}

test("platform publishes a monthly plan and assigns versioned company feature controls", async ({ page, context }) => {
  const state = await fixture(context);
  await page.goto("/platform/plans");
  await page.getByRole("button", { name: "Publish monthly plan", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Publish monthly plan", exact: true });
  await dialog.getByLabel("Plan name", { exact: true }).fill("Fictional monthly plan");
  await dialog.getByLabel("Monthly price (USD)", { exact: true }).fill("125.00");
  await dialog.getByRole("checkbox", { name: /Properties/ }).check();
  await dialog.getByRole("button", { name: "Publish plan revision", exact: true }).click();
  await expect(page.getByRole("cell", { name: "$125.00 USD", exact: true })).toBeVisible();
  expect(state.plans[1].features).toEqual(["properties"]);
  await page.getByRole("button", { name: "Archive Fictional monthly plan revision 2", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Archive plan availability", exact: true });
  await expect(dialog).toContainText("Existing assignments, prices and invoice history remain in place");
  await dialog.getByRole("button", { name: "Archive plan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Restore Fictional monthly plan revision 2", exact: true })).toBeVisible();
  expect(state.plans[1].monthlyPriceCents).toBe(12500);
  await page.goto(`/platform/companies/${company.id}`);
  await page.getByRole("button", { name: "Manage subscription", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Manage company subscription", exact: true });
  await dialog.getByRole("combobox", { name: "Monthly plan", exact: true }).selectOption(originalPlan.id);
  await dialog.getByText("Company feature exceptions", { exact: true }).click();
  await dialog.getByRole("combobox", { name: "Maintenance", exact: true }).selectOption("read_only");
  await dialog.getByLabel("Feature exception reason", { exact: true }).fill("Read-only maintenance during onboarding");
  await dialog.getByLabel("Reason for this subscription change", { exact: true }).fill("Assign the agreed monthly plan");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.getByRole("button", { name: "Save draft & close", exact: true }).click();
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await page.getByRole("button", { name: "Plan & features", exact: true }).click();
  await page.getByRole("button", { name: "Continue subscription draft", exact: true }).click();
  await expect(dialog.getByLabel("Reason for this subscription change", { exact: true })).toHaveValue("Assign the agreed monthly plan");
  await dialog.getByRole("button", { name: "Save subscription controls", exact: true }).click();
  await expect(page.getByRole("row", { name: /Maintenance View only Maintenance operations/ })).toBeVisible();
  expect(state.settings[0]).toMatchObject({ expectedVersion: null, planId: originalPlan.id, status: "active", featureOverrides: { maintenance: "read_only" }, reason: "Assign the agreed monthly plan" });
  expect(state.settings[0].submissionKey).toMatch(/^[a-f0-9-]{36}$/);
});

test("invoice receipt response loss retries exact details; corrections retain the invoice", async ({ page, context }) => {
  const state = await fixture(context);
  await page.goto(`/platform/companies/${company.id}?subscriptionTab=billing&invoiceId=fixture-invoice`);
  await expect(page.getByRole("heading", { name: "INV-000001", exact: true })).toBeVisible();
  await expect(page.getByText("October 1, 2026 – October 31, 2026", { exact: true })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("Fictional private platform note", { exact: true })).toBeHidden();
  await expect(page.getByRole("heading", { name: "INV-000001", exact: true })).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "Record received payment", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Record received subscription payment", exact: true });
  await dialog.getByLabel("Received amount (USD)", { exact: true }).fill("50.00");
  await dialog.getByLabel("Payment reference", { exact: true }).fill("Fictional bank receipt 123");
  await dialog.getByRole("button", { name: "Record received payment", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("interrupted");
  await expect(dialog.getByLabel("Received amount (USD)", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Record received payment", exact: true }).click();
  await expect(page.getByRole("row", { name: /Fictional bank receipt 123/ })).toBeVisible();
  expect(state.receiptRequests).toHaveLength(2);
  expect(state.receiptRequests[1]).toEqual(state.receiptRequests[0]);
  expect(state.payments).toHaveLength(1);
  await page.getByRole("button", { name: "Reverse receipt", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Reverse subscription receipt", exact: true });
  await dialog.getByLabel("Correction reason", { exact: true }).fill("Receipt recorded against the wrong company");
  await dialog.getByRole("button", { name: "Confirm receipt reversal", exact: true }).click();
  await expect(page.getByRole("row", { name: /Reversed/ })).toBeVisible();
  await page.getByRole("button", { name: "Void invoice", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Void subscription invoice", exact: true });
  await dialog.getByLabel("Correction reason", { exact: true }).fill("Replace the reviewed invoice");
  await dialog.getByRole("button", { name: "Confirm invoice void", exact: true }).click();
  await expect(page.getByText("October 2026 · Void", { exact: true })).toBeVisible();
  expect(state.invoice.status).toBe("void");
  expect(state.payments[0].reversal.reason).toBe("Receipt recorded against the wrong company");
});

test("company owner reviews usage and invoices without platform mutation controls on mobile", async ({ page, context }) => {
  await fixture(context, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/subscription");
  await expect(page.getByRole("heading", { name: "Plan & billing", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage subscription", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(page.getByText(/These analytics are not billable usage/)).toBeVisible();
  await expect(page.getByRole("row", { name: "Maintenance 7 2 9", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Invoices", exact: true }).click();
  await page.getByRole("button", { name: "INV-000001", exact: true }).click();
  await expect(page.getByRole("heading", { name: "INV-000001", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Record received payment", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Void invoice", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("invoice issue retains the reviewed monthly price and rejects changed source versions", async ({ page, context }) => {
  const state = await fixture(context);
  state.subscription = { companyId: company.id, version: 5, planId: originalPlan.id, status: "active", plan: originalPlan, featureOverrides: {}, billingEmail: "billing@test.invalid" };
  await page.goto(`/platform/companies/${company.id}?subscriptionTab=billing`);
  await page.getByRole("button", { name: "Issue monthly invoice", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Issue monthly invoice", exact: true });
  await expect(dialog.getByText("$100.00 USD for the full billing month", { exact: true })).toBeVisible();
  await dialog.getByLabel("Billing month", { exact: true }).fill("2026-10");
  await dialog.getByLabel("Due on", { exact: true }).fill("2026-10-31");
  state.subscription = { ...state.subscription, version: 6, plan: { ...originalPlan, id: "updated-plan", version: 2, monthlyPriceCents: 20000 } };
  await dialog.getByRole("button", { name: "Issue invoice", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Prepare a new invoice review");
  await expect(dialog.getByText("$100.00 USD for the full billing month", { exact: true })).toBeVisible();
  expect(state.invoiceRequests[0]).toMatchObject({ expectedSubscriptionVersion: 5, expectedCompanyVersion: 1, period: "2026-10", dueOn: "2026-10-31" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.getByRole("button", { name: "Close without saving", exact: true }).click();
  await page.getByRole("button", { name: "Issue monthly invoice", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Issue monthly invoice", exact: true });
  await expect(dialog.getByText("$200.00 USD for the full billing month", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Issue invoice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "INV-000001", exact: true })).toBeVisible();
  expect(state.invoiceRequests[1].expectedSubscriptionVersion).toBe(6);
  expect(state.invoice.monthlyPriceCents).toBe(20000);
});
