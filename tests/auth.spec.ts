import { test, expect } from '@playwright/test';

test.describe('Authentication and Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the health check
    await page.route('/api/health', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
    });
  });

  test('Successful login with ID token displays Landlord Portal', async ({ page }) => {
    // Mock the /api/me response with a user that has a company
    await page.route('/api/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-1',
          email: 'landlord@example.com',
          name: 'Landlord User',
          companies: [
            {
              id: 'membership-1',
              companyId: 'company-1',
              role: 'COMPANY_OWNER',
              company: {
                id: 'company-1',
                name: 'PropertyFlow Real Estate'
              }
            }
          ]
        })
      });
    });

    // Mock property list
    await page.route('/api/properties', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    // Navigate to the app with a simulated ID token in the fragment
    await page.goto('./#id_token=mock-valid-id-token');

    // Verify Landlord Portal is displayed
    await expect(page.locator('h1')).toContainText('Landlord Portal');
    await expect(page.locator('.text-muted')).toContainText('PropertyFlow Real Estate — Welcome, Landlord User');
    await expect(page.locator('button:has-text("+ New Property")')).toBeVisible();
  });

  test('New user with no company sees onboarding form', async ({ page }) => {
    // Mock the /api/me response with a user that has NO companies
    await page.route('/api/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-new',
          email: 'new@example.com',
          name: 'New User',
          companies: []
        })
      });
    });

    await page.goto('./#id_token=mock-new-id-token');

    // Verify onboarding form is displayed
    await expect(page.locator('h2')).toContainText('Welcome! Create a company to get started.');
    await expect(page.locator('input[placeholder="Company Name"]')).toBeVisible();
    await expect(page.locator('button:has-text("Create Company")')).toBeVisible();
  });

  test('Tenant user sees Tenant Portal', async ({ page }) => {
    await page.route('/api/me', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user-tenant',
          email: 'tenant@example.com',
          name: 'Tenant User',
          companies: [
            {
              id: 'membership-2',
              companyId: 'company-1',
              role: 'TENANT',
              company: {
                id: 'company-1',
                name: 'PropertyFlow Real Estate'
              }
            }
          ]
        })
      });
    });

    await page.goto('./#id_token=mock-tenant-id-token');

    // Verify Tenant Portal is displayed
    await expect(page.locator('h1')).toContainText('Tenant Portal');
    await expect(page.locator('button:has-text("Pay Rent")')).toBeVisible();
  });
});
