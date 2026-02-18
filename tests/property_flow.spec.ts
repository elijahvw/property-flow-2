import { test, expect } from '@playwright/test';

test.describe('PropertyFlow Core Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Basic health check mock
    await page.route('/api/health', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) });
    });
  });

  test('End-to-end: Create Company -> Create Property -> Create Unit', async ({ page }) => {
    let userHasCompany = false;
    let properties: any[] = [];

    // Mock /api/me to return different state based on userHasCompany flag
    await page.route('/api/me', async route => {
      if (userHasCompany) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'user-1',
            email: 'user@example.com',
            name: 'Test User',
            companies: [
              {
                id: 'membership-1',
                companyId: 'company-1',
                role: 'COMPANY_OWNER',
                company: { id: 'company-1', name: 'My Real Estate' }
              }
            ]
          })
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'user-1',
            email: 'user@example.com',
            name: 'Test User',
            companies: []
          })
        });
      }
    });

    // Mock company creation
    await page.route('/api/companies', async route => {
      if (route.request().method() === 'POST') {
        userHasCompany = true;
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'membership-1',
            companyId: 'company-1',
            role: 'COMPANY_OWNER',
            company: { id: 'company-1', name: 'My Real Estate' }
          })
        });
      } else {
        await route.continue();
      }
    });

    // Mock properties list
    await page.route('/api/properties', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(properties)
        });
      } else if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        const newProperty = {
          id: `prop-${Date.now()}`,
          companyId: 'company-1',
          name: body.name,
          address: body.address,
          units: []
        };
        properties.push(newProperty);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newProperty)
        });
      }
    });

    // Mock unit creation
    await page.route(/\/api\/properties\/.*\/units/, async route => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        const newUnit = {
          id: `unit-${Date.now()}`,
          number: body.number
        };
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newUnit)
        });
      }
    });

    // 1. Start on landing page and login
    await page.goto('./#id_token=test-token');
    
    // 2. Expect onboarding since userHasCompany is false
    await expect(page.locator('h2')).toContainText('Welcome! Create a company to get started.');
    
    // 3. Create a company
    await page.fill('input[placeholder="Company Name"]', 'My Real Estate');
    await page.click('button:has-text("Create Company")');
    
    // 4. Expect Landlord Portal
    await expect(page.locator('h1')).toContainText('Landlord Portal');
    await expect(page.locator('.text-muted')).toContainText('My Real Estate');
    
    // 5. Create a property
    await page.click('button:has-text("+ New Property")');
    await page.fill('input[placeholder="Property Name"]', 'Main St Apartments');
    await page.fill('input[placeholder="Address"]', '123 Main St');
    await page.click('button:has-text("Create")');
    
    // 6. Verify property is listed
    await expect(page.locator('.property-item')).toContainText('Main St Apartments');
    
    // 7. Add a unit
    await page.click('button:has-text("+ Unit")');
    await page.fill('input[placeholder="Unit Number (e.g. 101)"]', '101');
    await page.click('button:has-text("Add Unit")');
    
    // 8. Verify modal closed (success)
    await expect(page.locator('.modal')).not.toBeVisible();
  });
});
