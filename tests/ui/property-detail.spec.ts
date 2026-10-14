import { test, expect, Page } from '@playwright/test';
async function fixture(page: Page, role = 'manager') {
  const state = { property: {id:'property-a',name:'Garden House',address:'1 Main St',city:'Springfield',state:'CA',zip:'12345'}, loadStatus:200, saveStatus:200, writes:0 };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({status,json:value});
    if (path === '/api/bootstrap') return json({user:{id:'fixture-user',status:'active',name:'Tester',email:'test@example.test'},membership:{companyId:'company-a',version:1,role,status:'active',company:{id:'company-a',name:'Test company',status:'active'}},permissions:role === 'manager' || role === 'owner' ? ['property.read','property.write'] : role === 'staff' ? ['property.read'] : role === 'platform' ? ['platform.manage'] : [],csrfToken:'fixture-csrf'});
    if (path === '/api/company/properties') return json([state.property]);
    if (path === '/api/company/properties/property-a') {
      if (route.request().method() === 'PATCH') {
        state.writes++;
        expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
        if (state.saveStatus !== 200) return json({error:'Save unavailable'},state.saveStatus);
        state.property = {...state.property,...route.request().postDataJSON()};
        return json(state.property);
      }
      return state.loadStatus === 200 ? json(state.property) : json({error:'Load unavailable'},state.loadStatus);
    }
    return json([]);
  });
  return state;
}
test('list, detail, edit, failed save, retry, saved values and back navigation', async ({page}) => {
  const state = await fixture(page);
  await page.goto('/company/properties');
  await page.getByRole('link',{name:'Garden House',exact:true}).click();
  await expect(page).toHaveURL(/\/company\/properties\/property-a$/);
  await expect(page.getByRole('heading',{name:'Garden House',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit property'}).click();
  await page.getByLabel('Property name',{exact:true}).fill('Updated house');
  state.saveStatus = 503;
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Save unavailable');
  await expect(page.getByLabel('Property name',{exact:true})).toHaveValue('Updated house');
  state.saveStatus = 200;
  await page.getByRole('button',{name:'Try saving again'}).click();
  await expect(page.getByRole('status')).toHaveText('Property saved.');
  await expect(page.getByRole('heading',{name:'Updated house',exact:true})).toBeVisible();
  expect(state.writes).toBe(2);
  await page.getByRole('link',{name:'← Back to properties'}).click();
  await expect(page.getByRole('link',{name:'Updated house',exact:true})).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading',{name:'Updated house',exact:true})).toBeVisible();
});
test('load failure retries, cancel discards draft, address updates and required field bounds',async ({page}) => {
  const state = await fixture(page,'owner'); state.loadStatus=503;
  await page.goto('/company/properties/property-a');
  await expect(page.getByRole('heading',{name:'Unable to load property'})).toBeVisible();
  state.loadStatus=200; await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.getByRole('button',{name:'Edit property'}).click();
  await expect(page.getByLabel('Postal code',{exact:true})).toHaveAttribute('maxlength','30');
  await page.getByLabel('Street address',{exact:true}).fill('Draft');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Edit property'}).click();
  await expect(page.getByLabel('Street address',{exact:true})).toHaveValue('1 Main St');
  await page.getByLabel('Property name',{exact:true}).fill('');
  await page.getByRole('button',{name:'Save changes',exact:true}).click(); expect(state.writes).toBe(0);
  await page.getByLabel('Property name',{exact:true}).fill('Garden House');
  await page.getByLabel('Street address',{exact:true}).fill('2 Main St');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Property saved.');
  await expect(page.getByText('2 Main St',{exact:true})).toBeVisible();
});
test('staff read only; platform authority alone cannot open detail',async ({page}) => {
  await fixture(page,'staff'); await page.goto('/company/properties/property-a');
  await expect(page.getByText('You have read-only access to this property.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit property'})).toHaveCount(0);
  await page.unroute('**/api/**'); await fixture(page,'platform'); await page.reload();
  await expect(page.getByRole('heading',{name:'Access unavailable'})).toBeVisible();
});
for (const status of [403,404]) test(`detail ${status} has a safe return path`,async ({page}) => {
  const state=await fixture(page); state.loadStatus=status;
  await page.goto('/company/properties/property-a');
  await expect(page.getByRole('heading',{name:status===404?'Property not found':'Access unavailable'})).toBeVisible();
  await expect(page.getByRole('link',{name:'← Back to properties'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit property'})).toHaveCount(0);
});
test('loading and save busy states; revoked edit cannot retry',async ({page}) => {
  await fixture(page);
  let release!:()=>void; const wait=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/company/properties/property-a',async route=>{await wait; await route.fallback();});
  await page.goto('/company/properties/property-a');
  await expect(page.getByRole('status')).toHaveText('Loading property…'); release();
  await page.getByRole('button',{name:'Edit property'}).click();
  let save!:()=>void; const saveWait=new Promise<void>(resolve=>save=resolve);
  await page.route('**/api/company/properties/property-a',async route=>{
    if(route.request().method()!=='PATCH') return route.fallback();
    await saveWait; await route.fulfill({status:403,json:{error:'Access denied'}});
  });
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(page.getByRole('button',{name:'Saving…'})).toBeDisabled(); save();
  await expect(page.getByRole('alert')).toContainText('no longer available for editing');
  await expect(page.getByRole('button',{name:'Try saving again'})).toBeDisabled();
});
