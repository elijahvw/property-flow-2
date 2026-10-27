import { chromium } from '@playwright/test';

// Use an explicitly configured system browser on hosts without Playwright's
// bundled browser. Explicit launch options still take precedence.
export function launchFixtureBrowser(options = {}) {
  return chromium.launch({
    ...(process.env.PF_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PF_CHROMIUM_EXECUTABLE_PATH } : {}),
    ...options,
  });
}

// Existing workflow regressions use the real API. Dismiss the optional first-login
// walkthrough through its real control so it cannot obscure an unrelated form.
// Dedicated guidance tests verify its content, progress and first-login behavior.
export async function newFixturePage(browser, options) {
  const page = await browser.newPage(options);
  const guide = page.getByRole('dialog', {name:'Welcome to Property Flow',exact:true});
  await page.addLocatorHandler(guide, async () => { await guide.getByRole('button',{name:'Skip for now',exact:true}).click(); });
  return page;
}
