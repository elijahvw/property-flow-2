import assert from 'node:assert/strict';
import { digest } from '../dist/sessions.js';
import { expect } from '@playwright/test';
import { launchFixtureBrowser, newFixturePage } from './browser-fixture.mjs';

export async function maintenanceDirectoryCases(t, admin, db, call, app) {
  const company='directory-company',home='directory-home',hidden='directory-hidden',foreignCompany='directory-foreign-company';
  const manager='/api/company/maintenance/directory',resident='/api/resident/maintenance/directory';
  const ok=r=>{assert.equal(r.statusCode,200,r.body);return r.json();};
  for(const id of [company,foreignCompany])await admin.query('INSERT INTO "Company"(id,name,timezone,"updatedAt") VALUES($1,$1,\'America/New_York\',NOW())',[id]);
  for(const [suffix,role,scope,platform] of [['owner','owner',company,null],['manager','manager',company,null],['staff','staff',company,null],['resident','resident',company,null],['other','resident',company,null],['foreign','owner',foreignCompany,null],['support',null,null,'support']]) {
    const id='directory-'+suffix;
    await admin.query('INSERT INTO "User"(id,email,name,"emailVerified","platformRole","updatedAt") VALUES($1,$2,$3,true,$4,NOW())',[id,id+'@test.invalid',suffix==='staff'?'Directory Teammate':id,platform]);
    await db.identity.create({data:{issuer:'https://unused.auth0.com/',subject:id,userId:id}});
    if(role)await admin.query('INSERT INTO "CompanyMembership"("userId","companyId",role,"maintenanceExecution","staffPropertyScope","updatedAt") VALUES($1,$2,$3,$4,\'all\',NOW())',[id,scope,role,role==='staff']);
    await db.session.create({data:{userId:id,tokenHash:digest('token-'+id),csrfToken:'csrf',expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
  }
  for(const [id,scope,name] of [[home,company,'Directory Home sentinel'],[hidden,company,'Hidden home'],['directory-foreign-home',foreignCompany,'Foreign home']])
    await admin.query('INSERT INTO "Property"(id,name,address,city,state,zip,"companyId","updatedAt") VALUES($1,$2,\'Fictional street\',\'Town\',\'NY\',\'12345\',$3,NOW())',[id,name,scope]);
  for(const user of ['directory-resident','directory-other'])await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES($1,$2,$3)',[company,home,user]);
  await admin.query('INSERT INTO "Unit"(id,"companyId","propertyId",label,"createdById","submissionKey","submissionHash","updatedAt") VALUES(\'directory-unit\',$1,$2,\'Directory unit sentinel\',\'directory-owner\',\'directory-unit\',\'fixture\',NOW())',[company,home]);
  const today=ok(await call('directory-owner','GET','/api/company/reports/context')).today;
  const shift=days=>{const date=new Date(today+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};
  const seed=async(group,count,{property=home,requester='directory-resident',scope=company,mixed=false,unit=false}={})=>{
    await admin.query(`INSERT INTO "MaintenanceRequest"(id,"companyId","propertyId","requesterId","unitId",title,description,status,priority,"targetOn","assigneeId","executionStatus","createdAt","updatedAt")
      SELECT 'directory-'||$1||'-'||lpad(n::text,4,'0'),$2,$3,$4,CASE WHEN $6 THEN 'directory-unit' ELSE NULL END,
      'Directory '||$1||' '||n,'Fictional private source text'||CASE WHEN n%10=0 THEN ' description-only-directory-sentinel' ELSE '' END,
      CASE WHEN $5 AND n%3=0 THEN 'resolved' WHEN $5 AND n%3=2 THEN 'in_progress' ELSE 'open' END,
      CASE WHEN $5 AND n%5=0 THEN 'high' ELSE 'normal' END,
      CASE WHEN NOT $5 OR n%4=0 THEN NULL WHEN n%4=1 THEN $7::date-1 WHEN n%4=2 THEN $7::date ELSE $7::date+1 END,
      CASE WHEN $5 AND n%4=0 THEN 'directory-staff' ELSE NULL END,
      CASE WHEN NOT $5 OR n%4<>0 THEN 'unassigned' WHEN n%3=0 THEN 'complete' WHEN n%3=1 THEN 'assigned' ELSE 'pending_review' END,
      '2026-01-01'::timestamp+((n-1)/7)*interval '1 minute','2026-01-01'::timestamp+((n-1)/7)*interval '1 minute'
      FROM generate_series(1,$8::int) n`,[group,scope,property,requester,mixed,unit,today,count]);
  };
  await seed('main',101,{mixed:true,unit:true});
  for(const count of [49,50,51,100])await seed('edge'+count,count);
  // A tie wider than one page must retain the strict ID comparison in both
  // directions, even when the additional date bound matches every source row.
  await admin.query('UPDATE "MaintenanceRequest" SET "createdAt"=\'2026-01-01\' WHERE id LIKE \'directory-edge100-%\'');
  await seed('household',61,{requester:'directory-other'});await seed('hidden',11,{property:hidden});
  await seed('foreign',7,{property:'directory-foreign-home',requester:'directory-foreign',scope:foreignCompany});
  const get=(actor,path,params={})=>call(actor,'GET',path+'?'+new URLSearchParams(params));
  const page=(params={},actor='directory-manager',path=manager)=>get(actor,path,params).then(ok);
  const countCheck=(body,total,counts)=>{assert.equal(body.companyId,company);assert.equal(body.pageSize,50);assert.equal(body.total,total);assert.deepEqual(body.statusCounts,counts);assert.equal(Object.values(body.statusCounts).reduce((a,b)=>a+b,0),total);};
  const main={q:'Directory main'};

  await t.test('49/50/51/100/101 boundaries traverse tied timestamps in both directions with complete counts and slim rows',async()=>{
    const empty=await page({q:'No such directory source'});countCheck(empty,0,{open:0,in_progress:0,resolved:0});assert.deepEqual(empty.items,[]);assert.equal(empty.nextCursor,null);assert.equal(empty.previousCursor,null);
    for(const [group,total,counts] of [['edge49',49,{open:49,in_progress:0,resolved:0}],['edge50',50,{open:50,in_progress:0,resolved:0}],['edge51',51,{open:51,in_progress:0,resolved:0}],['edge100',100,{open:100,in_progress:0,resolved:0}],['main',101,{open:34,in_progress:34,resolved:33}]]) {
      const params={q:'Directory '+group},pages=[await page(params)],seen=[];
      assert.equal(pages[0].previousCursor,null);
      while(true){const current=pages.at(-1);countCheck(current,total,counts);assert.ok(current.items.length<=50);seen.push(...current.items.map(row=>row.id));if(!current.nextCursor)break;pages.push(await page({...params,cursor:current.nextCursor}));}
      assert.equal(seen.length,total);assert.equal(new Set(seen).size,total);assert.deepEqual(seen,[...seen].sort().reverse(),'createdAt ties retain deterministic descending ID order in these fixed fixtures');
      for(let index=pages.length-1;index>0;index--){assert.ok(pages[index].previousCursor);const newer=await page({...params,before:pages[index].previousCursor});assert.deepEqual(newer.items.map(row=>row.id),pages[index-1].items.map(row=>row.id));}
      for(const row of pages[0].items)for(const key of ['description','updatedAt','version','assigneeId','requesterId','createdById','submissionKey','submissionHash'])assert.ok(!Object.hasOwn(row,key),key);
    }
    const own=await page(main,'directory-resident',resident);for(const row of own.items)for(const key of ['executionStatus','assigneeName','assigneeId'])assert.ok(!Object.hasOwn(row,key));
  });

  await t.test('counts cover all selected filters independently of cursors, including description/property/unit search and company-day due dates',async()=>{
    countCheck(await page({...main,status:'resolved'}),33,{open:0,in_progress:0,resolved:33});
    countCheck(await page({...main,status:'unresolved'}),68,{open:34,in_progress:34,resolved:0});
    countCheck(await page({...main,propertyId:home,status:'unresolved',priority:'high',due:'overdue'}),4,{open:2,in_progress:2,resolved:0});
    countCheck(await page({q:'description-only-directory-sentinel',propertyId:home,status:'resolved'}),3,{open:0,in_progress:0,resolved:3});
    countCheck(await page({q:'Directory unit sentinel'}),101,{open:34,in_progress:34,resolved:33});
    const property=await page({q:'Directory Home sentinel'});assert.equal(property.total,412);
    const assignee=await page({...main,assignee:'Directory Teammate'});assert.equal(assignee.total,25);assert.ok(assignee.items.every(row=>row.assigneeName==='Directory Teammate'));
    const review=await page({...main,workStatus:'pending_review'});assert.ok(review.total>0);assert.ok(review.items.every(row=>row.executionStatus==='pending_review'));
  });

  await t.test('rows, totals and cursors preserve exact company/requester/current-assignment access and current feature policy',async()=>{
    for(const actor of ['directory-resident','directory-staff','directory-support'])assert.equal((await get(actor,manager,main)).statusCode,403);
    assert.equal((await get(null,manager,main)).statusCode,401);
    assert.equal((await call('directory-manager','GET',manager,null,{'x-company-id':foreignCompany})).statusCode,403);
    countCheck(await page({q:'Directory household'},'directory-resident',resident),0,{open:0,in_progress:0,resolved:0});
    countCheck(await page({q:'Directory hidden'},'directory-resident',resident),0,{open:0,in_progress:0,resolved:0});
    for(const path of [manager,resident])assert.equal((await get(path===manager?'directory-manager':'directory-resident',path,{propertyId:'directory-foreign-home'})).statusCode,404);
    const own=await page(main,'directory-resident',resident),managed=await page(main);
    assert.equal((await get('directory-resident',resident,{...main,cursor:managed.nextCursor})).statusCode,404);
    try {
      await admin.query('DELETE FROM "ResidentPropertyAssignment" WHERE "userId"=\'directory-resident\' AND "propertyId"=$1',[home]);
      countCheck(await page(main,'directory-resident',resident),0,{open:0,in_progress:0,resolved:0});
      assert.equal((await get('directory-resident',resident,{...main,cursor:own.nextCursor})).statusCode,404);
    }finally{await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES($1,$2,\'directory-resident\')',[company,home]);}
    for(const [feature,actor,path] of [['maintenance','directory-manager',manager],['resident_portal','directory-resident',resident]])for(const mode of ['read_only','disabled']){
      try{await admin.query('INSERT INTO "CompanySubscription"("companyId","featureOverrides","updatedById","updatedAt") VALUES($1,$2::jsonb,\'directory-owner\',NOW())',[company,JSON.stringify({[feature]:mode})]);assert.equal((await get(actor,path,main)).statusCode,mode==='read_only'?200:403);}
      finally{await admin.query('DELETE FROM "CompanySubscription" WHERE "companyId"=$1',[company]);}
    }
    assert.deepEqual(await db.maintenanceRequest.findMany({where:{companyId:company}}),[]);
  });

  await t.test('invalid, changed-filter, changed-anchor, empty-window and expired-company-day cursors fail without partial data',async()=>{
    const first=await page(main);
    for(const params of [{...main,cursor:'not-base64!'}, {...main,cursor:'x'.repeat(513)}, {...main,cursor:first.nextCursor,before:first.nextCursor}]){const response=await get('directory-manager',manager,params);assert.equal(response.statusCode,400);assert.equal(response.json().code,'INVALID_DIRECTORY_CURSOR');}
    const changed=await get('directory-manager',manager,{...main,status:'open',cursor:first.nextCursor});assert.equal(changed.statusCode,404);assert.equal(changed.json().code,'DIRECTORY_CURSOR_UNAVAILABLE');assert.ok(!Object.hasOwn(changed.json(),'items'));
    const edge=await page({q:'Directory edge51',status:'open'}),anchor=edge.items.at(-1);
    ok(await call('directory-manager','PATCH','/api/company/maintenance/'+anchor.id,{status:'resolved',expectedVersion:1}));
    try{assert.equal((await get('directory-manager',manager,{q:'Directory edge51',status:'open',cursor:edge.nextCursor})).json().code,'DIRECTORY_CURSOR_UNAVAILABLE');}
    finally{ok(await call('directory-manager','PATCH','/api/company/maintenance/'+anchor.id,{status:'open',expectedVersion:2}));}
    const tail='directory-edge51-0001';await admin.query('UPDATE "MaintenanceRequest" SET title=\'Moved out of edge filter\' WHERE id=$1',[tail]);
    try{assert.equal((await get('directory-manager',manager,{q:'Directory edge51',status:'open',cursor:edge.nextCursor})).statusCode,404);}
    finally{await admin.query('UPDATE "MaintenanceRequest" SET title=\'Directory edge51 1\' WHERE id=$1',[tail]);}
    // Create a >50-row dated set so a real continuation token includes the day.
    await seed('dated',60);await admin.query('UPDATE "MaintenanceRequest" SET "targetOn"=$1::date-1 WHERE id LIKE \'directory-dated-%\'',[today]);
    const dated=await page({q:'Directory dated',due:'overdue'});assert.ok(dated.nextCursor);
    try{let changedDay=false;for(const zone of ['Pacific/Kiritimati','Pacific/Pago_Pago']){
      await admin.query('UPDATE "Company" SET timezone=$1 WHERE id=$2',[zone,company]);
      const now=ok(await call('directory-owner','GET','/api/company/reports/context')).today;
      if(now!==today){changedDay=true;assert.equal((await get('directory-manager',manager,{q:'Directory dated',due:'overdue',cursor:dated.nextCursor})).statusCode,404);break;}
    }assert.equal(changedDay,true);
    }finally{await admin.query('UPDATE "Company" SET timezone=\'America/New_York\' WHERE id=$1',[company]);}
  });

  await t.test('queued directory totals and rows recheck leading assignment, membership and company revocation',async()=>{
    const own=await page(main,'directory-resident',resident);
    for(const [actor,path,params,target,revoke,expected] of [
      ['directory-resident',resident,main,'User','DELETE FROM "ResidentPropertyAssignment" WHERE "userId"=\'directory-resident\' AND "propertyId"=\'directory-home\'',200],
      ['directory-resident',resident,{...main,cursor:own.nextCursor},'User','DELETE FROM "ResidentPropertyAssignment" WHERE "userId"=\'directory-resident\' AND "propertyId"=\'directory-home\'',404],
      ['directory-manager',manager,main,'User','UPDATE "CompanyMembership" SET status=\'disabled\' WHERE "userId"=\'directory-manager\'',403],
      ['directory-manager',manager,main,'Company','UPDATE "Company" SET status=\'suspended\' WHERE id=\'directory-company\'',403],
    ]){
      const leader=await admin.connect();let pending;
      try{
        await leader.query('BEGIN');
        if(target==='User')await leader.query('UPDATE "User" SET "updatedAt"="updatedAt" WHERE id=$1',[actor]);
        else await leader.query('UPDATE "Company" SET "updatedAt"="updatedAt" WHERE id=$1',[company]);
        pending=get(actor,path,params);let blocked=false;
        for(let attempt=0;attempt<250;attempt++){
          if((await admin.query('SELECT pid FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid))>0 AND query LIKE $1',['%'+target+'%'])).rows.length){blocked=true;break;}
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.equal(blocked,true);await leader.query(revoke);await leader.query('COMMIT');const response=await pending;assert.equal(response.statusCode,expected,response.body);
        if(expected===200){countCheck(response.json(),0,{open:0,in_progress:0,resolved:0});assert.deepEqual(response.json().items,[]);}
      }finally{
        await leader.query('ROLLBACK');leader.release();if(pending)await pending;
        await admin.query('UPDATE "CompanyMembership" SET status=\'active\' WHERE "userId"=\'directory-manager\'');await admin.query('UPDATE "Company" SET status=\'active\' WHERE id=$1',[company]);
        await admin.query('INSERT INTO "ResidentPropertyAssignment"("companyId","propertyId","userId") VALUES($1,$2,\'directory-resident\') ON CONFLICT DO NOTHING',[company,home]);
      }
    }
  });

  await t.test('legacy arrays remain complete at1000 authorized matches and fail explicitly at1001 after filtering',async()=>{
    await seed('legacy-cap',1001);await admin.query('UPDATE "MaintenanceRequest" SET status=\'resolved\' WHERE id LIKE \'directory-legacy-cap-%\' AND id<>\'directory-legacy-cap-1001\'');
    for(const [actor,path] of [['directory-manager','/api/company/maintenance'],['directory-resident','/api/resident/maintenance']]){
      const complete=ok(await get(actor,path,{q:'Directory legacy-cap',status:'resolved'}));assert.equal(complete.length,1000);assert.ok(complete.every(row=>row.status==='resolved'));
      const limited=await get(actor,path,{q:'Directory legacy-cap'});assert.equal(limited.statusCode,409);assert.equal(limited.json().code,'MAINTENANCE_DIRECTORY_LIMIT');assert.ok(!Object.hasOwn(limited.json(),'items'));
      assert.equal(ok(await get(actor,path,{q:'Directory legacy-cap',status:'open'})).length,1);
    }
    countCheck(await page({q:'Directory legacy-cap'}),1001,{open:1,in_progress:0,resolved:1000});
  });

  await t.test('real browser opens copied page two, follows the exact source and returns with property/filter context before phone cursor recovery',{skip:!process.env.TEST_MAINTENANCE_BROWSER_URL},async()=>{
    const filters={...main,status:'unresolved',propertyId:home},first=await page(filters),second=await page({...filters,cursor:first.nextCursor});
    const browser=await launchFixtureBrowser({headless:true});
    try{
      const view=await newFixturePage(browser),requests=[];
      await view.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());requests.push(url.pathname+url.search);
        const response=await app.inject({method:req.method(),url:url.pathname+url.search,headers:{...req.headers(),origin:'https://app.test',cookie:'__Host-pf-session=token-directory-manager'},...(req.postData()?{payload:req.postData()}:{})});
        await route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});});
      const copied='/company/properties/'+home+'/maintenance?'+new URLSearchParams({q:main.q,status:'unresolved',cursor:first.nextCursor});
      await view.goto(process.env.TEST_MAINTENANCE_BROWSER_URL+copied);
      await expect(view.getByRole('link',{name:second.items[0].title,exact:true})).toBeVisible();
      await view.getByRole('link',{name:second.items[0].title,exact:true}).click();
      await expect(view.getByRole('heading',{name:second.items[0].title,exact:true})).toBeVisible();
      await view.getByRole('link',{name:'← Back to maintenance',exact:true}).click();
      await expect(view.getByRole('link',{name:second.items[0].title,exact:true})).toBeVisible();
      assert.equal(new URL(view.url()).searchParams.get('cursor'),first.nextCursor);await expect(view.getByLabel('Filter status')).toHaveValue('unresolved');await expect(view.getByLabel('Filter property')).toHaveValue(home);
      await view.setViewportSize({width:390,height:844});
      const anchor=first.items.at(-1),version=(await admin.query('SELECT version FROM "MaintenanceRequest" WHERE id=$1',[anchor.id])).rows[0].version;
      ok(await call('directory-manager','PATCH','/api/company/maintenance/'+anchor.id,{status:anchor.status,title:'Source moved out of current directory search',expectedVersion:version}));
      await view.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await expect(view.getByRole('button',{name:'Return to first page',exact:true})).toBeVisible();
      await expect(view.getByRole('link',{name:second.items[0].title,exact:true})).toHaveCount(0);
      await view.getByRole('button',{name:'Return to first page',exact:true}).click();
      await expect(view.getByRole('button',{name:'Next requests',exact:true})).toBeVisible();assert.equal(new URL(view.url()).searchParams.has('cursor'),false);
      await expect(view.getByLabel('Filter status')).toHaveValue('unresolved');assert.ok(requests.some(path=>path.startsWith(manager)&&path.includes('cursor=')));
      assert.equal(await view.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    }finally{await browser.close();}
  });
}
