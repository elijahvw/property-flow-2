import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, role: "platform" | "company-owner" | "resident" | "support-view") {
  const platform = role === "platform" || role === "support-view";
  const documents: string[] = [];
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/bootstrap") return route.fulfill({ json: {
      user: { id: "fixture-account", name: "Fictional Operator", email: "operator@test.invalid", status: "active", emailVerified: true, platformRole: platform ? "owner" : null },
      membership: platform ? null : { companyId: "fixture", role: role === "resident" ? "resident" : "owner", status: "active", version: 1, company: { id: "fixture", name: "Fictional Company", status: "active" } },
      permissions: platform ? ["platform.manage"] : role === "resident" ? ["resident.self"] : ["property.read", "company.manage"],
      destination: "/help", csrfToken: "fixture",
      ...(role === "support-view" ? { impersonation: { contextId: "fixture-context", actor: { id: "fixture-actor", email: "actor@test.invalid", name: "Fictional Actor" }, readOnly: true, expiresAt: "2099-01-01T00:00:00Z" } } : {}),
    } });
    if (path === "/api/docs/") {
      documents.push(request.resourceType());
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fictional API reference fixture</title><h1>Fictional API reference fixture</h1>" });
    }
    return route.fulfill({ json: { eligible: false } });
  });
  return documents;
}

test("platform owner can discover the API reference through Help and navigate to the backend document", async ({ page }) => {
  const documents = await fixture(page, "platform");
  await page.goto("/help");
  const reference = page.getByRole("region", { name: "API reference", exact: true });
  await expect(reference).toContainText("read-only");
  const link = reference.getByRole("link", { name: "Open API reference", exact: true });
  await expect(link).toHaveAttribute("href", "/api/docs/");
  await page.setViewportSize({ width: 320, height: 740 });
  await link.focus(); await expect(link).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await link.click();
  await expect(page).toHaveURL(/\/api\/docs\/$/);
  await expect(page.getByRole("heading", { name: "Fictional API reference fixture", exact: true })).toBeVisible();
  expect(documents).toEqual(["document"]);
});

for (const role of ["company-owner", "resident", "support-view"] as const) {
  test(`${role} does not receive a platform API reference entry`, async ({ page }) => {
    const documents = await fixture(page, role);
    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "Help Center", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open API reference", exact: true })).toHaveCount(0);
    expect(documents).toEqual([]);
  });
}
