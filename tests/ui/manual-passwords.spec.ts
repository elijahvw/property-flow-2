import { test, expect, type Page } from '@playwright/test';

async function fixture(page:Page,company=false,impersonating=false){
 const companyRow={id:'manual-company',name:'Fictional password company',status:'active'};
 const target={id:'auth0|manual-target',name:'Fictional Target',email:'target@manual.test.invalid',status:'active',emailVerified:false,platformRole:company?null:'support',updatedAt:'2026-10-25T12:00:00Z',membership:{userId:'auth0|manual-target',companyId:companyRow.id,role:'manager',status:'active',version:1,createdAt:'2026-10-01T12:00:00Z',company:companyRow}};
 const state={target,syncPosts:0,writes:[] as any[],uncertain:false,canSetPassword:true,unavailableReason:null as string|null,operation:null as null|{id:string;userId:string;status:string;reviewAfter:string},releaseCount:0};
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=decodeURIComponent(url.pathname),method=req.method();const json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  if(path==='/api/bootstrap')return json({user:{id:'actor',name:'Fictional Actor',email:'actor@manual.test.invalid',status:'active',emailVerified:true,platformRole:company?null:'owner'},membership:company?{companyId:companyRow.id,role:'owner',status:'active',version:1,company:companyRow}:null,permissions:company?['members.manage','company.manage','property.read','resident.assignment.manage']:['platform.manage','platform.impersonate'],csrfToken:'fixture',destination:company?'/company/overview':'/platform/companies',...(impersonating?{impersonation:{actor:{id:'original-actor',name:'Original Actor',email:'original@test.invalid'},reason:'Fixture read-only test',readOnly:true,unavailable:false,contextId:'fixture-view',expiresAt:'2099-01-01T00:00:00Z'}}:{})});
  if(path==='/api/platform/users/sync'){state.syncPosts++;return json({conflicts:[],limited:false,nextPage:null});}
  if(path==='/api/platform/users')return json([target]);
  if(path==='/api/platform/companies')return json([companyRow]);
  if(path==='/api/company/members')return json([{...target.membership,userId:target.id,user:{id:target.id,name:target.name,email:target.email,status:'active',passwordManageable:true}}]);
  if(path.endsWith('/password')&&method==='GET')return json({userId:target.id,name:target.name,email:target.email,reviewHash:state.canSetPassword?'a'.repeat(64):null,canSetPassword:state.canSetPassword,unavailableReason:state.unavailableReason,operation:state.operation});
  if(path.endsWith('/password')&&method==='POST'){
   expect(req.headers()['x-csrf-token']).toBe('fixture');state.writes.push(req.postDataJSON());state.operation={id:'attempt',userId:target.id,status:state.uncertain?'uncertain':'applied',reviewAfter:'2020-01-01T00:00:00Z'};
   if(state.uncertain)return route.abort('failed');
   return json({...state.operation,message:'Password set. Existing Property Flow sessions were revoked.'});
  }
  if(path.endsWith('/password/release')){expect(req.postDataJSON()).toEqual({operationId:'attempt',confirmed:true});state.releaseCount++;state.operation=null;return json({id:'attempt',status:'abandoned'});}
  if(path.endsWith('/activity'))return json({items:[],total:0,page:1,pageSize:25});
  if(path==='/api/telemetry')return json({accepted:true});
  return json([]);
 });
 return state;
}

test('platform password controls name exact account, clear secret fields and keep platform support separate',async({page},info)=>{
 const state=await fixture(page);await page.setViewportSize({width:390,height:844});
 await page.goto('/platform/users?userId=auth0%7Cmanual-target');
 const editor=page.getByRole('dialog',{name:'Manage Fictional Target',exact:true});
 await expect(editor).toContainText('Platform authority: Platform support');await expect(editor.getByRole('link',{name:'Review platform support access for this account',exact:true})).toHaveAttribute('href','/platform/impersonation?supportUserId=auth0%7Cmanual-target');
 await editor.getByRole('button',{name:'Set password manually',exact:true}).click();
 await editor.getByLabel('New account password',{exact:true}).fill('Fictional-Password-42!');await editor.getByLabel('Confirm new account password',{exact:true}).fill('Fictional-Password-42!');
 await page.screenshot({path:info.outputPath('platform-manual-password-phone.png'),fullPage:true});
 await editor.getByRole('button',{name:'Set account password',exact:true}).click();
 await expect(editor.getByText('Password set. Existing Property Flow sessions were revoked.',{exact:true})).toBeVisible();
 await expect(editor.getByLabel('New account password',{exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(1);expect(state.writes[0]).toMatchObject({reviewHash:'a'.repeat(64),password:'Fictional-Password-42!',confirmation:'Fictional-Password-42!'});expect(state.target.emailVerified).toBe(false);
 expect(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]))).not.toContain('Fictional-Password-42!');
});

test('unconfirmed password attempt clears fields and requires status/release before fresh entry',async({page})=>{
 const state=await fixture(page);state.uncertain=true;
 await page.goto('/platform/users?userId=auth0%7Cmanual-target');const editor=page.getByRole('dialog',{name:'Manage Fictional Target',exact:true});
 await editor.getByRole('button',{name:'Set password manually',exact:true}).click();await editor.getByLabel('New account password',{exact:true}).fill('Fictional-Unconfirmed-42!');await editor.getByLabel('Confirm new account password',{exact:true}).fill('Fictional-Unconfirmed-42!');
 await editor.getByRole('button',{name:'Set account password',exact:true}).click();
 await expect(editor.getByText(/This attempt is unconfirmed/)).toBeVisible();await expect(editor.getByLabel('New account password',{exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'Check attempt status',exact:true}).click();expect(state.writes).toHaveLength(1);
 await editor.getByRole('button',{name:'Release reviewed attempt',exact:true}).click();await expect(editor.getByLabel('New account password',{exact:true})).toHaveValue('');expect(state.releaseCount).toBe(1);expect(state.writes).toHaveLength(1);
 await editor.getByLabel('New account password',{exact:true}).fill('Unsaved-Fictional-Only-42!');await editor.getByRole('button',{name:'Close and clear password fields',exact:true}).click();await editor.getByRole('button',{name:'Set password manually',exact:true}).click();await expect(editor.getByLabel('New account password',{exact:true})).toHaveValue('');
});

test('company owner can set a member password without platform support or impersonation navigation',async({page})=>{
 const state=await fixture(page,true);await page.goto('/company/members');
 await expect(page.getByRole('link',{name:'Impersonation',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Support access',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Manage password',exact:true}).click();const editor=page.getByRole('dialog',{name:'Password for Fictional Target',exact:true});
 await editor.getByRole('button',{name:'Set password manually',exact:true}).click();await editor.getByLabel('New account password',{exact:true}).fill('Company-Fictional-42!');await editor.getByLabel('Confirm new account password',{exact:true}).fill('Company-Fictional-42!');await editor.getByRole('button',{name:'Set account password',exact:true}).click();
 await expect(editor.getByText('Password set. Existing Property Flow sessions were revoked.',{exact:true})).toBeVisible();expect(state.writes).toHaveLength(1);
});

test('read-only platform target view does not synchronize users or expose password mutation',async({page})=>{
 const state=await fixture(page,false,true);await page.goto('/platform/users?userId=auth0%7Cmanual-target');
 await expect(page.getByRole('button',{name:'Add user',exact:true})).toBeDisabled();const editor=page.getByRole('dialog',{name:'Manage Fictional Target',exact:true});
 await expect(editor).toBeVisible();await expect(editor.getByRole('button',{name:'Send password reset email',exact:true})).toBeDisabled();await expect(editor.getByRole('button',{name:'Set password manually',exact:true})).toHaveCount(0);
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect(state.syncPosts).toBe(0);expect(state.writes).toHaveLength(0);
});


test('disabled account retains historical password recovery when new password writes are unavailable',async({page})=>{
 const state=await fixture(page);state.target.status='disabled';state.canSetPassword=false;state.unavailableReason='This account is disabled. Existing attempts can still be reviewed without provider access.';state.operation={id:'attempt',userId:state.target.id,status:'uncertain',reviewAfter:'2020-01-01T00:00:00Z'};
 await page.goto('/platform/users?userId=auth0%7Cmanual-target');const editor=page.getByRole('dialog',{name:'Manage Fictional Target',exact:true});
 await editor.getByRole('button',{name:'Set password manually',exact:true}).click();await expect(editor.getByText(/This attempt is unconfirmed/)).toBeVisible();
 await editor.getByRole('button',{name:'Release reviewed attempt',exact:true}).click();
 await expect(editor.getByText('This account is disabled. Existing attempts can still be reviewed without provider access.',{exact:true})).toBeVisible();
 await expect(editor.getByLabel('New account password',{exact:true})).toHaveCount(0);expect(state.releaseCount).toBe(1);expect(state.writes).toHaveLength(0);
});
