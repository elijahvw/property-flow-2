import {test,expect,Page} from '@playwright/test';
const owner=()=>({user:{id:'fictional-owner',name:'Fictional owner',email:'owner@test.invalid',status:'active',emailVerified:true},membership:{companyId:'fictional-company',role:'owner',version:1,status:'active',company:{id:'fictional-company',name:'Fictional company',status:'active'}},permissions:['property.read','property.write','lease.manage','members.manage','finance.manage','maintenance.manage'],csrfToken:'fixture',destination:'/company/properties'});
async function setup(page:Page,{signedIn=true,newGuide=false}={}){
 const state={guide:{eligible:true,guideKey:'fixture-guide',status:newGuide?'new':'dismissed',step:'overview',version:1,steps:[{id:'overview',title:'Your daily workspace',description:'Find work and follow its source.',path:'/company/overview',action:'Open overview',help:'getting-started'},{id:'properties',title:'Your connected properties',description:'Keep properties and units together.',path:'/company/properties',action:'View properties',help:'properties'}]},guideWrites:[] as any[],delivery:[] as any[],failDelivery:false,historyTotal:26,invitationPage:[] as number[],entryFailed:false,entryTokens:[] as string[]};
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  if(path==='/api/bootstrap')return json(signedIn?owner():{error:'Sign in required'},signedIn?200:401);
  if(path==='/api/account/guide'){
   if(req.method()==='PUT'){const body=req.postDataJSON();expect(body.expectedVersion).toBe(state.guide.version);state.guideWrites.push(body);Object.assign(state.guide,body,{version:state.guide.version+1});}
   return json(state.guide);
  }
  if(path==='/api/invitations/delivery')return json({emailAvailable:true});
  if(path==='/api/invitations'){
   const page=Number(url.searchParams.get('page'));state.invitationPage.push(page);
   return json({items:[{id:'invite-'+page,email:`teammate${page}@test.invalid`,role:'staff',company:{name:'Fictional company'},expiresAt:'2099-01-01',version:1,acceptedAt:null,revokedAt:null}],total:state.historyTotal,pageSize:25,page});
  }
  if(path.endsWith('/revoke')){state.historyTotal=25;return json({success:true});}
  if(path.endsWith('/replace')){
   const body=req.postDataJSON();state.delivery.push(body);if(state.failDelivery)return json({error:'Response interrupted. Retry this action.'},503);
   return json({id:'replacement',version:2,expiresAt:'2099-01-01',acceptanceUrl:null,deliveryStatus:'accepted',recovered:true});
  }
  if(path==='/api/invitations/entry'){state.entryTokens.push(req.postDataJSON().token);return state.entryFailed?json({error:'This invitation has expired or been replaced.'},403):json({company:'Fictional company',role:'staff',kind:'team',expiresAt:'2099-01-01'});}
  if(path==='/api/invitations/preview')return json({error:'Sign in with the invited account.'},403);
  if(path==='/api/company/properties')return json([{id:'fictional-home',name:'Fictional home'}]);
  if(path==='/api/company/overview')return json({today:'2026-10-18',timezone:'UTC',properties:1,units:1,occupiedUnits:0,leases:{active:0,draft:0,endingSoon:0,overdue:0},maintenance:{open:0,urgent:0,inProgress:0},rent:{balanceCents:'0',overdueCents:'0',creditCents:'0'}});
  return json([]);
 });return state;
}
test('first-login walkthrough saves progress, stays dismissed across reload and reopens from Help',async({page})=>{
 const state=await setup(page,{newGuide:true});await page.goto('/company/properties');const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:'Your daily workspace'})).toBeVisible();
 await dialog.getByRole('button',{name:'Next',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Your connected properties'})).toBeVisible();expect(state.guideWrites[0]).toMatchObject({status:'in_progress',step:'properties',expectedVersion:1});
 await dialog.getByRole('button',{name:'Skip for now'}).click();await expect(dialog).not.toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Properties',exact:true})).toBeVisible();await expect(dialog).not.toBeVisible();
 await page.goto('/help');await page.getByRole('button',{name:'Replay walkthrough'}).click();await expect(dialog.getByRole('heading',{name:'Your connected properties'})).toBeVisible();await page.screenshot({path:'/tmp/propertyflow-walkthrough-desktop.png'});
 await dialog.getByRole('button',{name:'Finish walkthrough'}).click();expect(state.guide.status).toBe('complete');
});
test('public Help Center supports search, connected guides and phone layouts without sign-in',async({page})=>{
 await setup(page,{signedIn:false});await page.setViewportSize({width:390,height:844});await page.goto('/help');await page.getByLabel('Find a guide').fill('invitation');await page.getByRole('link',{name:'Send and accept an invitation',exact:true}).click();await expect(page.getByRole('heading',{name:'How to do it'})).toBeVisible();await expect(page.getByRole('button',{name:'Replay walkthrough'})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);await page.screenshot({path:'/tmp/propertyflow-help-mobile.png',fullPage:true});
});
test('invitation history paginates and interrupted email retries preserve the exact action',async({page})=>{
 const state=await setup(page);await page.goto('/company/members');await page.getByRole('button',{name:'Next invitations'}).click();await expect(page.getByText('teammate2@test.invalid',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Send or replace'}).click();state.failDelivery=true;await page.getByRole('button',{name:'Send invitation email',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Response interrupted');state.failDelivery=false;await page.getByRole('button',{name:'Retry invitation email',exact:true}).click();expect(state.delivery).toHaveLength(2);expect(state.delivery[0]).toEqual(state.delivery[1]);await expect(page.getByRole('status').filter({hasText:'Email accepted for sending'})).toBeVisible();expect(state.invitationPage).toContain(2);
});
test('wrong signed-in recipient gets recovery controls without accepting access',async({page})=>{
 await setup(page);await page.goto('/invite#fictional-private-token');await expect(page.getByRole('alert')).toContainText('Sign in with the invited account');await expect(page.getByRole('button',{name:'Use a different account'})).toBeVisible();await expect(page.getByRole('button',{name:'Accept invitation',exact:true})).toHaveCount(0);await expect(page).toHaveURL(/\/invite$/);
});

test('a new private invitation opened in the same tab replaces the earlier token and strips the fragment',async({page})=>{
 const state=await setup(page,{signedIn:false});await page.goto('/invite#fictional-first-link');await expect(page.getByRole('heading',{name:'Welcome to Property Flow'})).toBeVisible();await page.evaluate(()=>{window.location.hash='fictional-replacement-link';});await expect.poll(()=>state.entryTokens.at(-1)).toBe('fictional-replacement-link');await expect(page).toHaveURL(/\/invite$/);await expect(page.getByRole('button',{name:'Sign in to review invitation'})).toBeVisible();
});

test('revoking the last filtered invitation on a later page returns to an available page',async({page})=>{
 await setup(page);await page.goto('/company/members');await page.getByRole('button',{name:'Next invitations'}).click();await expect(page.getByText('teammate2@test.invalid',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Revoke',exact:true}).click();await expect(page.getByText('teammate1@test.invalid',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Previous invitations'})).toBeDisabled();
});
