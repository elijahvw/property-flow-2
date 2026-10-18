import { chromium, expect } from "@playwright/test";
import { newFixturePage } from "./browser-fixture.mjs";
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from '../dist/sessions.js';
import {InvitationEmailError} from '../dist/invitation-email.js';

export async function invitationWorkflowCases(t,db,admin,call,deliveries,setSendHook,app){
 const ok=response=>{assert.equal(response.statusCode,200,response.body);return response.json();};
 await admin.query(`INSERT INTO "Company"(id,name,"updatedAt") VALUES('invite-company','Invitation Company',NOW());
 INSERT INTO "User"(id,email,"emailVerified","updatedAt") VALUES('invite-owner','invite-owner@test.invalid',true,NOW()),('invite-successor','invite-successor@test.invalid',true,NOW());
 INSERT INTO "CompanyMembership"("userId","companyId",role,"updatedAt") VALUES('invite-owner','invite-company','owner',NOW()),('invite-successor','invite-company','owner',NOW());`);
 for(const id of ['invite-owner','invite-successor'])await db.session.create({data:{tokenHash:digest('token-'+id),csrfToken:'csrf',userId:id,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});
 const create=async(email,extra={})=>ok(await call('invite-owner','POST','/api/invitations',{name:'Invited teammate',email,role:'manager',submissionKey:randomUUID(),...extra}));
 const signIn=async invitation=>{const row=await db.invitation.findUniqueOrThrow({where:{id:invitation.id}});await db.user.update({where:{id:row.accountId},data:{emailVerified:true}});await db.session.create({data:{tokenHash:digest('token-'+row.accountId),csrfToken:'csrf',userId:row.accountId,expiresAt:new Date(Date.now()+3600000),idleExpiresAt:new Date(Date.now()+3600000)}});return row.accountId;};
 await t.test('durable creation replays once, concurrent duplicate invitations are prevented, and hashes stay private',async()=>{
   const body={email:'retry-invitation@test.invalid',role:'staff',name:'Retry teammate',submissionKey:randomUUID()};
   const results=await Promise.all([call('invite-owner','POST','/api/invitations',body),call('invite-owner','POST','/api/invitations',body)]);
   const rows=results.map(ok);assert.equal(rows[0].id,rows[1].id);assert.equal(rows.filter(row=>row.acceptanceUrl).length,1);
   assert.ok(rows.every(row=>!('submissionHash' in row)&&!('tokenHash' in row)));
   assert.equal(await db.invitation.count({where:{submissionKey:body.submissionKey}}),1);
   assert.equal((await call('invite-owner','POST','/api/invitations',{...body,role:'manager'})).statusCode,409);
   assert.equal((await call('invite-owner','POST','/api/invitations',{...body,submissionKey:randomUUID()})).statusCode,409);
 });
 await t.test('a disabled, demoted or departed inviter cannot grant access; current authority can create a replacement',async()=>{
   const invite=await create('authority-invitation@test.invalid'),account=await signIn(invite),token=new URL(invite.acceptanceUrl).hash.slice(1);
   for(const change of ['disabled','demoted','departed']){
     if(change==='disabled')await db.user.update({where:{id:'invite-owner'},data:{status:'disabled'}});
     else await db.companyMembership.update({where:{userId:'invite-owner'},data:{role:'manager',...(change==='departed'?{companyId:'a'}:{})}});
     assert.equal((await call(account,'POST','/api/invitations/accept',{token})).statusCode,403);
     assert.equal(await db.companyMembership.findUnique({where:{userId:account}}),null);
     await db.user.update({where:{id:'invite-owner'},data:{status:'active'}});
     await db.companyMembership.update({where:{userId:'invite-owner'},data:{role:'owner',companyId:'invite-company'}});
   }
   const preview=ok(await call(account,'POST','/api/invitations/preview',{token}));assert.equal(preview.company,'Invitation Company');assert.equal(preview.role,'manager');
   const accepted=await Promise.all([call(account,'POST','/api/invitations/accept',{token}),call(account,'POST','/api/invitations/accept',{token})]);accepted.forEach(ok);
   assert.equal(await db.auditEvent.count({where:{targetId:invite.id,action:'invitation.accepted'}}),1);
   assert.equal(ok(await call(account,'POST','/api/invitations/accept',{token})).alreadyAccepted,true);
   await db.companyMembership.update({where:{userId:account},data:{status:'disabled'}});
   assert.equal((await call(account,'POST','/api/invitations/accept',{token})).statusCode,403);
   assert.equal((await db.companyMembership.findUniqueOrThrow({where:{userId:account}})).status,'disabled');
 });
 await t.test('existing resident access and an inconsistent company selection cannot produce unusable team invitations',async()=>{
   const initial=await create('existing-resident-invitation@test.invalid',{role:'resident'}),actor=await signIn(initial);
   ok(await call(actor,'POST','/api/invitations/accept',{token:new URL(initial.acceptanceUrl).hash.slice(1)}));
   const before=await db.invitation.count({where:{accountId:actor}});
   assert.equal((await call('invite-owner','POST','/api/invitations',{email:'existing-resident-invitation@test.invalid',role:'manager',submissionKey:randomUUID()})).statusCode,409);
   assert.equal(await db.invitation.count({where:{accountId:actor}}),before);
   assert.equal((await call('invite-owner','POST','/api/invitations',{companyId:'a',email:'wrong-company-selection@test.invalid',role:'staff',submissionKey:randomUUID()})).statusCode,403);
 });
 await t.test('email replacement rotates the link, sends once under retries and preserves exact identity',async()=>{
   const initial=await create('email-invitation@test.invalid'),body={expectedVersion:initial.version,submissionKey:randomUUID(),delivery:'email'},before=deliveries.length;
   const row=ok(await call('invite-owner','POST',`/api/invitations/${initial.id}/replace`,body));
   assert.equal(row.deliveryStatus,'accepted');assert.equal(deliveries.length,before+1);
   assert.equal(deliveries.at(-1).acceptanceUrl,row.acceptanceUrl);
   const retry=ok(await call('invite-owner','POST',`/api/invitations/${initial.id}/replace`,body));assert.equal(retry.id,row.id);assert.equal(retry.acceptanceUrl,null);assert.equal(deliveries.length,before+1);assert.ok(!('submissionHash' in retry));
   const old=await db.invitation.findUniqueOrThrow({where:{id:initial.id}}),current=await db.invitation.findUniqueOrThrow({where:{id:row.id}});assert.ok(old.revokedAt);assert.equal(old.accountId,current.accountId);
   const account=await signIn(row);assert.equal((await call(account,'POST','/api/invitations/accept',{token:new URL(initial.acceptanceUrl).hash.slice(1)})).statusCode,403);
   ok(await call(account,'POST','/api/invitations/accept',{token:new URL(row.acceptanceUrl).hash.slice(1)}));
 });
 await t.test('ambiguous email outcomes never auto-resend and a failed provider leaves a usable private link',async()=>{
   const initial=await create('uncertain-invitation@test.invalid'),body={expectedVersion:initial.version,submissionKey:randomUUID(),delivery:'email'};
   let calls=0;setSendHook(async()=>{calls++;throw new InvitationEmailError('unknown');});
   try {
    const row=ok(await call('invite-owner','POST',`/api/invitations/${initial.id}/replace`,body));assert.equal(row.deliveryStatus,'unknown');assert.ok(row.acceptanceUrl);
    ok(await call('invite-owner','POST',`/api/invitations/${initial.id}/replace`,body));assert.equal(calls,1);
    assert.equal((await call('invite-owner','POST',`/api/invitations/${row.id}/replace`,{expectedVersion:row.version,submissionKey:randomUUID(),delivery:'email'})).statusCode,429);
   }finally{setSendHook(async()=>{});}
 });
 await t.test('invitation history is complete and filtered, and other companies/residents cannot administer it',async()=>{
   const rows=Array.from({length:31},(_,i)=>({id:'history-invitation-'+i,companyId:'invite-company',email:`history${i}@test.invalid`,role:'staff',tokenHash:digest('history-'+i),createdBy:'invite-owner',expiresAt:new Date(Date.now()+3600000)}));await db.invitation.createMany({data:rows});
   const first=ok(await call('invite-owner','GET','/api/invitations?audience=team&page=1&q=history'));const second=ok(await call('invite-owner','GET','/api/invitations?audience=team&page=2&q=history'));
   assert.equal(first.total,31);assert.equal(first.items.length,25);assert.equal(second.items.length,6);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,31);
   assert.equal((await call('foreign','POST',`/api/invitations/${rows[0].id}/revoke`,{expectedVersion:1})).statusCode,403);
   assert.equal((await call('resident','GET','/api/invitations?page=1')).statusCode,403);
   assert.equal((await call('staff','GET','/api/invitations/delivery')).statusCode,403);
 });
 await t.test('real browser creates, sends and accepts one exact staff account through the shared invitation flow',{skip:!process.env.TEST_USERS_BROWSER_URL},async()=>{
  const browser=await chromium.launch({headless:true});
  try{
   let actor='invite-owner';const page=await newFixturePage(browser);page.setDefaultTimeout(15000);
   await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/api/telemetry')return route.fulfill({status:202,json:{accepted:true}});
    const response=await app.inject({method:req.method(),url:url.pathname+url.search,headers:{...req.headers(),origin:'https://app.test',cookie:`__Host-pf-session=token-${actor}`},...(req.postData()?{payload:req.postData()}:{})});
    return route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});
   });
   console.info('Invitation browser: owner creation');
   await page.goto(process.env.TEST_USERS_BROWSER_URL+'/company/members');await page.getByRole('button',{name:'Invite team member',exact:true}).click();await page.getByLabel('Email address',{exact:true}).fill('browser-invitation@test.invalid');await page.getByLabel('Company role',{exact:true}).selectOption('staff');await page.getByRole('button',{name:'Create invitation',exact:true}).click();
   console.info('Invitation browser: delivery');
   await expect(page.getByLabel('Private invitation link')).toBeVisible();const count=deliveries.length;await page.getByRole('button',{name:'Send invitation email',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Email accepted for sending'})).toBeVisible();assert.equal(deliveries.length,count+1);
   const invitation=await db.invitation.findFirstOrThrow({where:{email:'browser-invitation@test.invalid',revokedAt:null}});actor=await signIn(invitation);
   console.info('Invitation browser: recipient review');
   const link=new URL(deliveries.at(-1).acceptanceUrl);await page.goto(process.env.TEST_USERS_BROWSER_URL+link.pathname+link.search+link.hash);await expect(page.getByRole('definition').filter({hasText:'Invitation Company'})).toBeVisible();await page.getByRole('button',{name:'Accept invitation',exact:true}).click();await expect(page).toHaveURL(/\/company\/overview$/);
   const member=await db.companyMembership.findUniqueOrThrow({where:{userId:actor}});assert.equal(member.companyId,'invite-company');assert.equal(member.role,'staff');assert.equal(member.maintenanceExecution,false);assert.equal(await db.auditEvent.count({where:{targetId:invitation.id,action:'invitation.accepted'}}),1);
  }finally{await browser.close();}
 });

}
