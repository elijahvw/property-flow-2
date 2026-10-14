import { test, expect } from '@playwright/test';

// Public route protection can be tested without credentials. Authenticated
// browser checks use an isolated PostgreSQL fixture session, never a fake token
// or a live administrator account. See docs/access-overhaul.md.
test('anonymous visitor cannot open platform administration', async ({ page }) => {
  await page.goto('/platform/users');
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'People & access', exact: true })).not.toBeVisible();
});
test('unknown addresses show a real not-found page', async ({ page }) => {
  await page.goto('/unknown-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
