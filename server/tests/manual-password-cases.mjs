import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { digest } from '../dist/sessions.js';
import {chromium,expect} from '@playwright/test';
import {newFixturePage} from './browser-fixture.mjs';

export async function manualPasswordCases(t,{db,admin,app,provider,remote}) {
  let addressIndex=1,address='127.0.1.1';
  const call=(actor,method,path,payload,extra={})=>app.inject({method,url:path,remoteAddress:address,headers:{cookie:`__Host-pf-session=token-${actor}`,origin:'https://app.test','x-csrf-token':'csrf',...extra},...(payload?{payload}:{})});
  const subtest=(name,optionsOrRun,run)=>t.test(name,typeof optionsOrRun==='function'?{}:optionsOrRun,async sub=>{address='127.0.1.'+(++addressIndex);return (typeof optionsOrRun==='function'?optionsOrRun:run)(sub);});
  const company=await db.company.create({data:{name:'Fictional password-control company'}});
  const issuer=provider.issuer,connection=provider.databaseConnection;
  async function person(key,role=null,platformRole=null,companyId=company.id) {
    const id='auth0|manual-'+key,email=key+'@manual.test.invalid';
    await db.user.create({data:{id,email,name:'Fictional '+key,emailVerified:true,platformRole,identities:{create:{issuer,subject:id}},...(role?{membership:{create:{companyId,role}}}:{})}});
    remote.set(id,{user_id:id,email,email_verified:true,identities:[{provider:'auth0',connection}]});
    return id;
  }
  async function session(id) {return db.session.upsert({where:{tokenHash:digest('token-'+id)},update:{},create:{tokenHash:digest('token-'+id),csrfToken:'csrf',userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});}
  const owner=await person('owner','owner'),manager=await person('manager','manager'),support=await person('support',null,'support'),target=await person('tenant','resident'),outsider=await person('unassigned'),platformTarget=await person('administrator','staff','owner');
  for(const id of [owner,manager,support,target])await session(id);
  let writes=0,hold=null,entered=null,mode='success';
  const original=provider.setPassword;
  provider.setPassword=async(subject,password)=>{writes++;entered?.();if(hold)await hold;if(mode==='uncertain')throw Error('PRIVATE fictional password provider response');assert.ok(remote.has(subject));};
  t.after(()=>{provider.setPassword=original;});
  const root=id=>'/api/platform/users/'+encodeURIComponent(id)+'/password';
  const local=id=>'/api/company/users/'+encodeURIComponent(id)+'/password';
  const ok=async(...args)=>{const r=await call(...args);assert.equal(r.statusCode,200,r.body);return r.json();};
  async function body(actor,path,password='Fictional-Password-42!') {const review=await ok(actor,'GET',path);return {password,confirmation:password,reviewHash:review.reviewHash,submissionKey:randomUUID()};}
  await subtest('manual password scope is exact company membership and owner authority, not contact/email',async()=>{
    for(const actor of [owner,manager,support,target])assert.equal((await call(actor,'GET',root(target))).statusCode,403);
    for(const actor of [manager,support,target])assert.equal((await call(actor,'GET',local(target))).statusCode,403);
    assert.equal((await call(owner,'GET',local(outsider))).statusCode,404);
    assert.equal((await call(owner,'GET',local(platformTarget))).statusCode,404);
    assert.equal((await call(owner,'GET',local(target),null,{'x-company-id':'b'})).statusCode,403);
    const review=await ok(owner,'GET',local(target));assert.match(review.reviewHash,/^[a-f0-9]{64}$/);assert.equal(review.operation,null);
    assert.equal(writes,0);assert.equal((await call('platform','GET',root(outsider))).statusCode,200);
  });
  await subtest('manual password rejects bad input, CSRF and stale account review before provider writes',async()=>{
    const path=local(target),payload=await body(owner,path);
    assert.equal((await call(owner,'POST',path,payload,{'x-csrf-token':'wrong'})).statusCode,403);
    for(const patch of [{confirmation:'different'},{password:'short',confirmation:'short'},{email:'other@test.invalid'},{reviewHash:'old'}])assert.equal((await call(owner,'POST',path,{...payload,...patch})).statusCode,patch.reviewHash?409:400);
    await db.user.update({where:{id:target},data:{name:'Fictional renamed tenant'}});
    assert.equal((await call(owner,'POST',path,payload)).statusCode,409);
    assert.equal(writes,0);assert.equal(await db.manualPasswordOperation.count(),0);
  });
  await subtest('social provider and mismatched remote subject never receive password writes',async()=>{
    const path=root(outsider),originalRemote=remote.get(outsider);
    for(const patch of [{identities:[{provider:'google-oauth2',connection:'social'}]},{user_id:'auth0|not-the-subject'},{email:'different@test.invalid'}]){
      remote.set(outsider,{...originalRemote,...patch});const payload=await body('platform',path);
      const r=await call('platform','POST',path,payload);assert.equal(r.statusCode,409,r.body);
      assert.equal((await db.manualPasswordOperation.findUniqueOrThrow({where:{actorId_submissionKey:{actorId:'platform',submissionKey:payload.submissionKey}}})).status,'failed');
      assert.equal((await db.user.findUniqueOrThrow({where:{id:outsider}})).credentialChangedAt,null);
    }
    remote.set(outsider,originalRemote);assert.equal(writes,0);
  });
  await subtest('intent audit rollback prevents provider effects and stores no password',async()=>{
    const path=local(target),payload=await body(owner,path),before=await db.manualPasswordOperation.count();
    await admin.query(`CREATE FUNCTION reject_manual_password_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='user.password_change.requested' THEN RAISE EXCEPTION 'fixture rollback'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_manual_password_intent BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_manual_password_intent()`);
    try{assert.equal((await call(owner,'POST',path,payload)).statusCode,500);}finally{await admin.query('DROP TRIGGER reject_manual_password_intent ON "AuditEvent";DROP FUNCTION reject_manual_password_intent()');}
    assert.equal(await db.manualPasswordOperation.count(),before);assert.equal(writes,0);
  });
  await subtest('one dispatch fences access changes, revokes sessions and safely replays the confirmed receipt',async()=>{
    const path=local(target),payload=await body(owner,path),before=writes;
    let release,start;hold=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{start=resolve;});entered=start;
    const running=call(owner,'POST',path,payload);await started;
    const interim=await db.user.findUniqueOrThrow({where:{id:target}});assert.ok(interim.credentialChangedAt);
    assert.equal(await db.session.count({where:{userId:target}}),0);
    const replay=await call(owner,'POST',path,payload);assert.equal(replay.statusCode,409,replay.body);
    const membership=await db.companyMembership.findUniqueOrThrow({where:{userId:target}});
    const moved=await call('platform','PUT','/api/platform/users/'+encodeURIComponent(target)+'/membership',{companyId:'b',role:'resident',status:'active',expectedVersion:membership.version});
    assert.equal(moved.statusCode,409,moved.body);assert.equal(moved.json().code,'PASSWORD_OPERATION_IN_PROGRESS');
    release();hold=null;entered=null;const response=await running;assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.json().status,'applied');
    const repeat=await ok(owner,'POST',path,payload);assert.equal(repeat.id,response.json().id);assert.equal(writes,before+1);
    assert.equal((await call(owner,'POST',path,{...payload,password:'Different-Fictional-42!',confirmation:'Different-Fictional-42!'})).statusCode,409);
    const op=await db.manualPasswordOperation.findUniqueOrThrow({where:{id:repeat.id}}),events=await db.auditEvent.findMany({where:{targetId:target,action:{startsWith:'user.password_change'}}});
    assert.ok(!JSON.stringify(op).includes(payload.password));assert.ok(!JSON.stringify(events).includes(payload.password));assert.ok(!JSON.stringify(response.json()).includes(payload.password));assert.equal(op.issuer,issuer);assert.equal(op.subject,target);
    assert.equal(events.filter(e=>e.action==='user.password_change.applied').length,1);assert.ok(events.every(e=>e.detail?.operationId===op.id));
  });
  await subtest('unconfirmed provider results retain a reviewable reservation and clear only after explicit delayed release',async()=>{
    const path=root(outsider),payload=await body('platform',path),before=writes;await session(outsider);mode='uncertain';
    const r=await call('platform','POST',path,payload);assert.equal(r.statusCode,503,r.body);assert.equal(r.json().code,'PASSWORD_RESULT_UNCERTAIN');assert.ok(!r.body.includes('PRIVATE'));assert.ok(!r.body.includes(payload.password));
    const review=await ok('platform','GET',path+'?submissionKey='+payload.submissionKey);assert.equal(review.operation.status,'uncertain');assert.ok((await db.user.findUniqueOrThrow({where:{id:outsider}})).credentialChangedAt);assert.equal(await db.session.count({where:{userId:outsider}}),0);
    assert.equal((await call('platform','POST',path,payload)).statusCode,409);assert.equal(writes,before+1);
    const release={operationId:review.operation.id,confirmed:true};assert.equal((await call('platform','POST',path+'/release',release)).statusCode,409);
    await db.manualPasswordOperation.update({where:{id:review.operation.id},data:{leaseUntil:new Date(Date.now()-1)}});
    assert.equal((await ok('platform','POST',path+'/release',release)).status,'abandoned');
    mode='success';const fresh=await body('platform',path,'Fresh-Fictional-Password-99!');assert.equal((await ok('platform','POST',path,fresh)).status,'applied');
  });
  await subtest('provider success with failed completion audit is uncertain, never a replayed provider write',async()=>{
    const path=local(target),payload=await body(owner,path),before=writes;
    await admin.query(`CREATE FUNCTION reject_manual_password_finish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='user.password_change.applied' THEN RAISE EXCEPTION 'fixture rollback'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_manual_password_finish BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_manual_password_finish()`);
    try{const r=await call(owner,'POST',path,payload);assert.equal(r.statusCode,503,r.body);}finally{await admin.query('DROP TRIGGER reject_manual_password_finish ON "AuditEvent";DROP FUNCTION reject_manual_password_finish()');}
    const op=(await ok(owner,'GET',path+'?submissionKey='+payload.submissionKey)).operation;assert.equal(op.status,'uncertain');
    assert.equal((await call(owner,'POST',path,payload)).statusCode,409);assert.equal(writes,before+1);
    await db.manualPasswordOperation.update({where:{id:op.id},data:{leaseUntil:new Date(Date.now()-1)}});await ok(owner,'POST',path+'/release',{operationId:op.id,confirmed:true});
  });
  await subtest('lookup failure before dispatch does not invalidate credentials, sessions or password state',async()=>{
    const user=await person('lookup-failure'),path=root(user),payload=await body('platform',path),before=writes;
    await session(user);const get=provider.get;provider.get=async()=>{throw Error('PRIVATE lookup unavailable');};
    try{const r=await call('platform','POST',path,payload);assert.equal(r.statusCode,503,r.body);assert.equal(r.json().code,'PASSWORD_CHANGE_FAILED');}finally{provider.get=get;}
    const op=(await ok('platform','GET',path+'?submissionKey='+payload.submissionKey)).operation;assert.equal(op.status,'failed');assert.equal(writes,before);
    assert.equal((await db.user.findUniqueOrThrow({where:{id:user}})).credentialChangedAt,null);assert.equal(await db.session.count({where:{userId:user}}),1);
  });
  await subtest('platform recovery survives disabled targets, missing provider and changed identity without granting a write',async()=>{
    const user=await person('recovery','resident'),path=root(user),payload=await body('platform',path);mode='uncertain';
    assert.equal((await call('platform','POST',path,payload)).statusCode,503);mode='success';
    const op=(await ok('platform','GET',path+'?submissionKey='+payload.submissionKey)).operation;
    assert.equal((await call('platform','PATCH','/api/platform/users/'+encodeURIComponent(user)+'/status',{status:'disabled'})).statusCode,200);
    assert.equal((await call('platform','PATCH','/api/platform/users/'+encodeURIComponent(user)+'/status',{status:'active'})).statusCode,409);
    const set=provider.setPassword;provider.setPassword=undefined;await db.identity.delete({where:{issuer_subject:{issuer,subject:user}}});
    try{
      const review=await ok('platform','GET',path+'?submissionKey='+payload.submissionKey);assert.equal(review.canSetPassword,false);assert.equal(review.reviewHash,null);assert.equal(review.operation.id,op.id);assert.equal(review.operation.status,'uncertain');
      assert.equal((await call(owner,'GET',local(user))).statusCode,409);
      await db.manualPasswordOperation.update({where:{id:op.id},data:{leaseUntil:new Date(Date.now()-1)}});
      assert.equal((await ok('platform','POST',path+'/release',{operationId:op.id,confirmed:true})).status,'abandoned');
    }finally{provider.setPassword=set;await db.identity.create({data:{issuer,subject:user,userId:user}});}
    assert.equal((await call('platform','PATCH','/api/platform/users/'+encodeURIComponent(user)+'/status',{status:'active'})).statusCode,200);
  });
  await subtest('platform release retains the original company-owner intent audit scope',async()=>{
    const user=await person('company-release','resident'),path=local(user),payload=await body(owner,path);mode='uncertain';
    try{assert.equal((await call(owner,'POST',path,payload)).statusCode,503);}finally{mode='success';}
    const operation=(await ok('platform','GET',root(user))).operation;
    await db.manualPasswordOperation.update({where:{id:operation.id},data:{leaseUntil:new Date(Date.now()-1)}});
    await ok('platform','POST',root(user)+'/release',{operationId:operation.id,confirmed:true});
    const row=await db.manualPasswordOperation.findUniqueOrThrow({where:{id:operation.id}});assert.equal(row.actorId,owner);assert.equal(row.companyId,company.id);assert.equal(row.status,'abandoned');
    const event=await db.auditEvent.findFirstOrThrow({where:{targetId:user,action:'user.password_change.released'},orderBy:{createdAt:'desc'}});assert.equal(event.actorId,'platform');assert.equal(event.companyId,company.id);assert.deepEqual(event.detail,{operationId:operation.id,previousStatus:'uncertain'});
  });
  for(const outcome of ['success','uncertain'])await subtest('a released old '+outcome+' response cannot overwrite a newer password receipt or session state',async()=>{
    const user=await person('late-'+outcome),path=root(user),payload=await body('platform',path),baseSet=provider.setPassword;
    let release,enter;const delayed=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{enter=resolve;});let first=true;
    provider.setPassword=async()=>{writes++;if(first){first=false;enter();await delayed;if(outcome==='uncertain')throw Error('PRIVATE late response');}};
    try{
      const old=call('platform','POST',path,payload);await started;
      const prior=(await ok('platform','GET',path+'?submissionKey='+payload.submissionKey)).operation;
      await db.manualPasswordOperation.update({where:{id:prior.id},data:{leaseUntil:new Date(Date.now()-1)}});
      await ok('platform','POST',path+'/release',{operationId:prior.id,confirmed:true});
      const fresh=await body('platform',path,'Fresh-After-Release-42!'),applied=await ok('platform','POST',path,fresh);assert.equal(applied.status,'applied');
      await session(user);const marker=(await db.user.findUniqueOrThrow({where:{id:user}})).credentialChangedAt;
      release();const response=await old;assert.equal(response.statusCode,409,response.body);assert.equal(response.json().code,'PASSWORD_ATTEMPT_FINISHED');
      assert.equal((await db.manualPasswordOperation.findUniqueOrThrow({where:{id:prior.id}})).status,'abandoned');assert.equal((await db.manualPasswordOperation.findUniqueOrThrow({where:{id:applied.id}})).status,'applied');
      assert.equal(await db.session.count({where:{userId:user}}),1);assert.equal((await db.user.findUniqueOrThrow({where:{id:user}})).credentialChangedAt.toISOString(),marker.toISOString());
    }finally{release?.();provider.setPassword=baseSet;}
  });
  await subtest('queued company-owner request cannot pass a suspended company through an old snapshot',async()=>{
    const user=await person('queued-company','resident'),path=local(user),payload=await body(owner,path),before=writes;
    const locker=await admin.connect();let running;
    try{
      await locker.query('BEGIN');await locker.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',[user]);
      running=call(owner,'POST',path,payload);
      let blocked=false;
      for(let n=0;n<100;n++){
        const result=await admin.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='propertyflow_runtime' AND $1=ANY(pg_blocking_pids(pid))) AS blocked`,[locker.processID]);
        if(result.rows[0].blocked){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,10));
      }
      assert.equal(blocked,true,'fixture must observe the request waiting on its target fence');
      const row=await db.company.findUniqueOrThrow({where:{id:company.id}});
      await ok('platform','PATCH','/api/platform/companies/'+company.id,{name:row.name,status:'suspended',expectedVersion:row.version});
      await locker.query('COMMIT');const response=await running;assert.equal(response.statusCode,403,response.body);assert.equal(writes,before);assert.equal(await db.manualPasswordOperation.count({where:{userId:user}}),0);
    }finally{
      await locker.query('ROLLBACK').catch(()=>{});locker.release();await running?.catch(()=>{});
      const row=await db.company.findUniqueOrThrow({where:{id:company.id}});if(row.status!=='active')await ok('platform','PATCH','/api/platform/companies/'+company.id,{name:row.name,status:'active',expectedVersion:row.version});
    }
  });
  await subtest('manual password endpoint retains its ten-request production limit',async()=>{
    const user=await person('rate-fixture'),path=root(user),payload=await body('platform',path);
    for(let i=0;i<10;i++)assert.equal((await call('platform','POST',path,{...payload,password:'short',confirmation:'short'})).statusCode,400);
    assert.equal((await call('platform','POST',path,payload)).statusCode,429);
  });
  await subtest('development StrictMode password review loads, clears fields and completes a real API dispatch',{skip:!process.env.TEST_USERS_BROWSER_URL},async()=>{
    await session('platform');
    const browser=await chromium.launch({headless:true});
    try{
      const page=await newFixturePage(browser);
      await page.route('**/api/**',async route=>{
        const req=route.request(),url=new URL(req.url());
        const response=await call('platform',req.method(),url.pathname+url.search,req.postDataJSON()||undefined);
        await route.fulfill({status:response.statusCode,headers:{'content-type':'application/json'},body:response.body});
      });
      await page.goto(process.env.TEST_USERS_BROWSER_URL+'/platform/users?userId='+encodeURIComponent(outsider));
      const editor=page.getByRole('dialog',{name:'Manage Fictional unassigned',exact:true});
      await editor.getByRole('button',{name:'Set password manually',exact:true}).click();
      await expect(editor.getByText('Account:',{exact:false})).toContainText('Fictional unassigned');
      await editor.getByLabel('New account password',{exact:true}).fill('StrictMode-Fictional-42!');
      await editor.getByLabel('Confirm new account password',{exact:true}).fill('StrictMode-Fictional-42!');
      await editor.getByRole('button',{name:'Set account password',exact:true}).click();
      await expect(editor.getByText('Password set. Existing Property Flow sessions were revoked.',{exact:true})).toBeVisible();
      await expect(editor.getByLabel('New account password',{exact:true})).toHaveCount(0);
    }finally{await browser.close();}
  });
}
