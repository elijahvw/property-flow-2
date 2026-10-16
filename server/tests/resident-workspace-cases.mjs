import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '../dist/sessions.js';
import { chromium, expect } from '@playwright/test';
import { companyDay } from '../dist/reports.js';

export async function residentWorkspaceCases(t, admin, call, app) {
  const ok = r => { assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const today = companyDay('America/New_York');
  const path = '/api/company/resident-profiles/ws-resident/workspace';
  let leases = [];
  await t.test('connected tenant balances reconcile to source ledgers including ended and future leases', async () => {
    await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES('workspace-company','Workspace Company',NOW())`);
    for (const [id, role] of [['ws-owner','owner'],['ws-manager','manager'],['ws-staff','staff'],['ws-resident','resident'],['ws-other','resident'],['ws-empty','resident']]) {
      await admin.query(`INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES($1,$2,true,NOW());`, [id, id+'@test.invalid']);
      await admin.query(`INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES($1,'workspace-company',$2,NOW())`, [id,role]);
      await admin.query(`INSERT INTO "Session"("tokenHash","csrfToken","userId","expiresAt","idleExpiresAt") VALUES($1,'csrf',$2,NOW()+interval '1 hour',NOW()+interval '1 hour')`, [digest('token-'+id),id]);
    }
    await admin.query(`INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES('ws-home','Maple House','14 Maple Lane','Charlotte','NC','28202','workspace-company',NOW()); INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES('workspace-company','ws-home','ws-resident'),('workspace-company','ws-home','ws-other')`);
    await admin.query(`UPDATE "CompanyMembership" SET "contactName"='Jordan Rivera',"contactPhone"='555-0142',"managementNotes"='Prefers afternoon appointments.' WHERE "userId"='ws-resident'`);
    for (const [label, status, startsOn, endsOn, residentId] of [
      ['Current apartment','active','2020-01-01',null,'ws-resident'],
      ['Former apartment','ended','2019-01-01','2019-12-31','ws-resident'],
      ['Future apartment','active','2028-01-01',null,'ws-resident'],
      ['Draft apartment','draft','2029-01-01',null,'ws-resident'],
      ['Other tenant','active','2020-01-01',null,'ws-other'],
    ]) {
      const unit = ok(await call('ws-owner','POST','/api/company/properties/ws-home/units',{label,submissionKey:randomUUID()}));
      leases.push(ok(await call('ws-owner','POST','/api/company/leases',{propertyId:'ws-home',unitId:unit.id,residentId,startsOn,endsOn,monthlyRent:'1000.01',status,submissionKey:randomUUID()})));
    }
    ok(await call('ws-owner','POST',`/api/company/rent/${leases[0].id}/charges`,{periodOn:'2020-01-01',dueOn:'2020-01-01',amount:'1000.01',memo:null,expectedVersion:1,submissionKey:randomUUID()}));
    ok(await call('ws-owner','POST',`/api/company/rent/${leases[0].id}/payments`,{occurredOn:today,amount:'250.00',memo:'Private receipt reference',submissionKey:randomUUID()}));
    ok(await call('ws-owner','POST',`/api/company/rent/${leases[1].id}/payments`,{occurredOn:today,amount:'30.02',memo:null,submissionKey:randomUUID()}));
    ok(await call('ws-owner','POST',`/api/company/rent/${leases[4].id}/charges`,{periodOn:'2020-01-01',dueOn:'2020-01-01',amount:'9999.99',memo:null,expectedVersion:1,submissionKey:randomUUID()}));
    const deposit = ok(await call('ws-owner','POST',`/api/company/deposits/${leases[0].id}`,{amount:'1500.00',dueOn:today,expectedLeaseVersion:1,submissionKey:randomUUID()}));
    ok(await call('ws-owner','POST',`/api/company/deposits/${leases[0].id}/receipts`,{amount:'750.50',occurredOn:today,method:'cash',paymentReference:null,memo:'Private deposit reference',expectedVersion:deposit.version,expectedLeaseVersion:1,submissionKey:randomUUID()}));
    const extra = ok(await call('ws-owner','POST',`/api/company/deposits/${leases[0].id}/receipts`,{amount:'100.00',occurredOn:today,method:'cash',paymentReference:null,memo:null,expectedVersion:deposit.version,expectedLeaseVersion:1,submissionKey:randomUUID()}));
    ok(await call('ws-owner','POST',`/api/company/deposit-receipts/${extra.id}/void`,{expectedVersion:extra.cashEntry.version,reason:'Recording error'}));
    const result = ok(await call('ws-manager','GET',path));
    assert.equal(result.leases.length,4); assert.deepEqual(new Set(result.leases.map(l=>l.status)),new Set(['active','ended','draft']));
    assert.equal(result.rent.outstandingCents,'75001');assert.equal(result.rent.creditCents,'3002');assert.equal(result.deposits.heldCents,'75050');assert.equal(result.deposits.outstandingCents,'74950');
    for (const lease of result.leases) {
      const ledger = ok(await call('ws-owner','GET',`/api/company/rent?leaseId=${lease.id}`)).accounts[0];
      assert.deepEqual(lease.rent,ledger.summary);
      const detail = ok(await call('ws-owner','GET',`/api/company/deposits/${lease.id}`));
      if (detail.account) for (const key of Object.keys(detail.account.summary)) assert.equal(lease.deposit[key],detail.account.summary[key]);
      else assert.equal(lease.deposit,null);
    }
    assert.equal(JSON.stringify(result).includes('Private receipt reference'),false);
    assert.equal(JSON.stringify(result).includes('Private deposit reference'),false);
  });
  await t.test('real browser opens connected tenant details, ledger and preserved return path', {skip: !process.env.TEST_FINANCES_BROWSER_URL}, async()=>{
    const browser=await chromium.launch({headless:true});
    try {
      const page=await browser.newPage({viewport:{width:1440,height:1000}});
      await page.route('**/api/**',async route=>{
        const req=route.request(),url=new URL(req.url());
        const response=await app.inject({method:req.method(),url:url.pathname+url.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-ws-owner'},...(req.postData()?{payload:req.postData()}:{})});
        await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});
      });
      await page.goto(process.env.TEST_FINANCES_BROWSER_URL+'/company/residents?q=Jordan');
      await page.getByRole('link',{name:'View tenant Jordan Rivera',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Jordan Rivera',exact:true})).toBeVisible();
      await expect(page.getByRole('region',{name:'Tenant balance overview'})).toContainText('$750.01');
      await expect(page.getByRole('region',{name:'Tenant balance overview'})).toContainText('$750.50');
      await page.screenshot({path:'/tmp/propertyflow-tenant-workspace-desktop.png',fullPage:true});
      await page.getByRole('link',{name:'Open rent ledger for Current apartment'}).click();
      await expect(page.getByRole('heading',{name:'Rent ledger',exact:true})).toBeVisible();
      await page.getByRole('link',{name:'Back to tenant'}).click();
      await expect(page).toHaveURL(/tenants\/[^?]+\?q=Jordan/);
      await page.setViewportSize({width:390,height:844});
      await expect(page.getByRole('heading',{name:'Jordan Rivera',exact:true})).toBeVisible();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:'/tmp/propertyflow-tenant-workspace-mobile.png',fullPage:true});
    } finally {await browser.close();}
  });
  await t.test('tenant workspace denies other roles, companies, selectors and revoked actors',async()=>{
    for(const actor of ['ws-staff','ws-resident','platform']) assert.equal((await call(actor,'GET',path)).statusCode,403);
    for(const target of ['ws-resident','missing']) assert.equal((await call('foreign','GET',path.replace('ws-resident',target))).statusCode,404);
    assert.equal((await call('ws-owner','GET',path,null,{'x-company-id':'b'})).statusCode,403);
    assert.equal((await call('ws-owner','GET',path+'?companyId=b')).statusCode,400);
    const other=ok(await call('ws-owner','GET',path.replace('ws-resident','ws-other')));assert.equal(other.leases.length,1);assert.equal(other.rent.outstandingCents,'999999');
    const empty=ok(await call('ws-owner','GET',path.replace('ws-resident','ws-empty')));assert.deepEqual(empty.leases,[]);assert.equal(empty.rent.outstandingCents,'0');assert.equal(empty.deposits.heldCents,'0');
    await admin.query(`DELETE FROM "ResidentPropertyAssignment" WHERE "userId"='ws-resident'; UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='ws-resident'`);
    assert.equal(ok(await call('ws-manager','GET',path)).leases.length,4,'management history survives tenant portal revocation');
    assert.equal((await call('ws-resident','GET',`/api/resident/rent?leaseId=${leases[0].id}`)).statusCode,403);
    await admin.query(`UPDATE "CompanyMembership" SET status='disabled' WHERE "userId"='ws-manager'`);
    assert.equal((await call('ws-manager','GET',path)).statusCode,403);
    await admin.query(`UPDATE "CompanyMembership" SET status='active' WHERE "userId"='ws-manager'`);
    const lock=await admin.connect();let pending;
    try {
      await lock.query('BEGIN');await lock.query(`UPDATE "User" SET "emailVerified"=false WHERE id='ws-manager'`);
      pending=call('ws-manager','GET',path);await lock.query('COMMIT');
      assert.equal((await pending).statusCode,403);
    } finally {await lock.query('ROLLBACK');lock.release();}
  });
  await t.test('overview refuses a capped history instead of returning partial balances',async()=>{
    await admin.query(`INSERT INTO "Lease"(id,"companyId","propertyId","unitId","residentId","createdById","submissionKey","submissionHash","startsOn","rentCents","updatedAt") SELECT 'ws-cap-'||g,'workspace-company','ws-home',$1,'ws-resident','ws-owner',gen_random_uuid()::text,'fixture','2030-01-01',100,NOW() FROM generate_series(1,1001) g`,[leases[3].unitId]);
    const r=await call('ws-owner','GET',path);assert.equal(r.statusCode,422,r.body);assert.equal(r.json().code,'RESIDENT_WORKSPACE_TOO_LARGE');assert.equal('rent' in r.json(),false);
  });
}
