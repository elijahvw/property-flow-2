import { test, expect, Page } from "@playwright/test";
async function fixture(page: Page, allowed = true) {
  const docs = Array.from({ length: 27 }, (_, i) => ({
    id: "doc-" + i,
    title: `Fictional file ${String(i).padStart(2, "0")}`,
    source: i === 26 ? "leases" : "maintenance",
    sourceId: i === 26 ? "lease-1" : "request-1",
    propertyName: "Fictional home",
    unitLabel: "Unit A",
    requestTitle: i === 26 ? null : "Fictional repair",
    latestNumber: i === 0 ? 2 : 1,
    filename: i === 26 ? "find-me.txt" : "report.txt",
    scanStatus: i === 0 ? "pending" : i === 1 ? "rejected" : "clean",
    byteLength: 42,
    uploadedAt: "2026-10-18T12:00:00Z",
    archivedAt: null,
  }));
  const state = { reads: [] as string[], fail: false };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      json = (body: unknown, status = 200) =>
        route.fulfill({ json: body, status });
    state.reads.push(path + url.search);
    if (path === "/api/bootstrap")
      return json({
        user: {
          id: "manager",
          name: "Fictional manager",
          email: "manager@test.invalid",
          status: "active",
          emailVerified: true,
        },
        membership: {
          companyId: "company",
          role: allowed ? "manager" : "staff",
          version: 1,
          status: "active",
          company: { name: "Fictional company", status: "active" },
        },
        permissions: allowed
          ? ["property.read", "maintenance.manage", "lease.manage"]
          : ["property.read"],
        destination: "/company/maintenance",
        csrfToken: "fixture",
      });
    if (path === "/api/telemetry") return json({ accepted: true });
    if (path === "/api/account/guide") return json({ eligible: false });
    if (path === "/api/company/properties")
      return json([{ id: "home", name: "Fictional home" }]);
    if (path === "/api/company/documents") {
      if (state.fail)
        return json({ error: "Library temporarily unavailable" }, 503);
      const q = (url.searchParams.get("q") || "").toLowerCase(),
        source = url.searchParams.get("source") || "all",
        scan = url.searchParams.get("scan") || "all",
        status = url.searchParams.get("status") || "active",
        page = Number(url.searchParams.get("page") || 1),
        rows = docs.filter(
          (doc) =>
            (source === "all" || source === doc.source) &&
            (scan === "all" || scan === doc.scanStatus) &&
            (status === "all" ||
              (status === "active" && !doc.archivedAt) ||
              (status === "archived" && !!doc.archivedAt)) &&
            `${doc.title} ${doc.filename} ${doc.propertyName}`
              .toLowerCase()
              .includes(q),
        );
      return json({
        items: rows.slice((page - 1) * 25, page * 25),
        total: rows.length,
        page,
        pageSize: 25,
      });
    }
    if (path === "/api/company/maintenance/request-1")
      return json({
        id: "request-1",
        propertyId: "home",
        unitId: "unit-a",
        unit: { label: "Unit A" },
        title: "Fictional repair",
        description: "Private source content",
        category: "other",
        priority: "normal",
        status: "open",
        version: 1,
        targetOn: null,
        property: { name: "Fictional home" },
        activity: [],
        createdAt: "2026-10-18T12:00:00Z",
        updatedAt: "2026-10-18T12:00:00Z",
        historyLimited: false,
        residentUpdatesAvailable: false,
      });
    if (path.endsWith("/documents"))
      return json({
        items: [
          {
            id: "doc-0",
            title: docs[0].title,
            version: 2,
            archivedAt: null,
            versions: [
              {
                id: "v2",
                number: 2,
                filename: "report.txt",
                byteLength: 42,
                scanStatus: "pending",
                createdAt: "2026-10-18T12:00:00Z",
              },
              {
                id: "v1",
                number: 1,
                filename: "old.txt",
                byteLength: 30,
                scanStatus: "clean",
                createdAt: "2026-10-17T12:00:00Z",
              },
            ],
          },
        ],
        scanningConfigured: true,
      });
    if (path.endsWith("/preventive")) return json(null);
    if (path.endsWith("/updates")) return json({ items: [], nextCursor: null });
    return json([]);
  });
  return state;
}
test("library paging and search use complete filtered metadata and exact source links", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/documents");
  await expect(
    page.getByRole("status").filter({ hasText: "27 matching documents" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Next documents", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Fictional file 26", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search documents", exact: true })
    .fill("find-me");
  await expect(
    page.getByRole("status").filter({ hasText: "1 matching document" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Fictional file 26", exact: true }),
  ).toHaveAttribute(
    "href",
    /\/company\/leases\/lease-1\?.*documentId=doc-26.*section=documents/,
  );
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
});
test("latest scan filter and source review preserve older clean versions without enabling quarantined download", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/company/documents?scan=pending&propertyId=home");
  await expect(
    page.getByText("Quarantined · download blocked", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Fictional file 00", exact: true })
    .click();
  const selected = page.locator(".private-document-target");
  await expect(
    selected.getByRole("heading", { name: "Fictional file 00", exact: true }),
  ).toBeVisible();
  await expect(selected.locator("details")).toHaveAttribute("open", "");
  await expect(
    selected.getByRole("button", { name: "Download version 1", exact: true }),
  ).toBeVisible();
  await expect(
    selected.getByRole("button", { name: "Download version 2", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Back to document library →", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Latest scan result", exact: true }),
  ).toHaveValue("pending");
  await expect(
    page.getByRole("combobox", { name: "Filter property", exact: true }),
  ).toHaveValue("home");
  await expect(
    page.getByRole("status").filter({ hasText: "1 matching document" }),
  ).toBeVisible();
});
test("failure has an explicit retry and no fabricated empty library", async ({
  page,
}) => {
  const s = await fixture(page);
  s.fail = true;
  await page.goto("/company/documents");
  await expect(page.getByRole("alert")).toContainText(
    "Library temporarily unavailable",
  );
  await expect(
    page.getByText("No documents match.", { exact: false }),
  ).toHaveCount(0);
  s.fail = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "27 matching documents" }),
  ).toBeVisible();
});
test("phone document cards and expanded source versions fit without overflow", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/company/documents?scan=pending");
  await expect(
    page.getByRole("link", { name: "Fictional file 00", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Fictional file 00", exact: true })
    .click();
  await expect(page.locator(".private-document-target")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
test("staff see no document navigation and cannot load library data directly", async ({
  page,
}) => {
  const s = await fixture(page, false);
  await page.goto("/company/documents");
  await expect(
    page.getByRole("heading", { name: "Access unavailable", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Documents", exact: true }),
  ).toHaveCount(0);
  expect(
    s.reads.filter((x) => x.startsWith("/api/company/documents")),
  ).toHaveLength(0);
});
