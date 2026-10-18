import {test,expect,Page} from '@playwright/test';
const request=()=>({id:'job',propertyId:'home',unitId:null,unit:null,title:'Fictional repair',description:'Inspect the fictional fixture leak.',category:'plumbing',priority:'normal',status:'open',version:1,targetOn:'2026-10-23',createdAt:'2026-10-17T12:00:00Z',updatedAt:'2026-10-17T12:00:00Z',property:{name:'Fictional home'},activity:[]});
async function setup(page:Page,staff=false){
 const state={row:request(),executionStatus:'unassigned',actions:[] as any[],workPosts:[] as any[],uploads:[] as any[],documents:[] as any[],failUpload:false,failWork:false,scanFails:false,scanningConfigured:false,scanRequests:0,denied:false};
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),json=(value:unknown,status=200)=>route.fulfill({json:value,status});
  if(path==='/api/telemetry')return json({accepted:true});
  if(path==='/api/bootstrap')return json({user:{id:'fixture',name:'Fictional operator',email:'operator@test.invalid',status:'active',emailVerified:true},membership:{companyId:'a',version:1,role:staff?'staff':'owner',status:'active',company:{id:'a',name:'Fictional company',status:'active'}},permissions:staff?['property.read','maintenance.execute']:['property.read','maintenance.manage','members.manage'],destination:staff?'/company/work-orders':'/company/maintenance',csrfToken:'fixture'});
  if(method!=='GET')expect(req.headers()['x-csrf-token']).toBe('fixture');
  if(path.includes('/documents')){
   if(state.denied)return json({error:'Document access revoked'},403);
   if(path.endsWith('/scan')){
    state.scanRequests++;
    if(state.scanFails)return json({error:'Scanner unavailable. File remains quarantined.'},503);
    state.documents[0].versions[0].scanStatus='clean';return json({scanStatus:'clean'});
   }
   if(path.endsWith('/download'))return json({filename:'report.txt',contentBase64:Buffer.from('Fictional report').toString('base64'),mediaType:'text/plain'});
   if(method==='POST'){
    const body=req.postDataJSON();state.uploads.push(body);
    if(state.failUpload)return json({error:'Upload interrupted. Retry this draft.'},503);
    if(body.documentId){state.documents[0].versions.unshift({id:'v2',number:2,filename:body.filename,byteLength:16,scanStatus:'pending',createdAt:'2026-10-17T13:00:00Z'});state.documents[0].version++;}
    else state.documents.push({id:'doc',title:body.title,version:1,archivedAt:null,versions:[{id:'v1',number:1,filename:body.filename,byteLength:16,scanStatus:'pending',createdAt:'2026-10-17T12:00:00Z'}]});
    return json({documentId:'doc',versionId:'v1'});
   }
   if(method==='PATCH'){state.documents[0].archivedAt=req.postDataJSON().archived?'2026-10-17T14:00:00Z':null;state.documents[0].version++;return json({version:state.documents[0].version});}
   return json({items:state.documents,scanningConfigured:state.scanningConfigured});
  }
  if(path==='/api/company/work-orders')return json({items:[{...state.row,executionStatus:state.executionStatus}],nextCursor:null});
  if(path.startsWith('/api/company/work-orders/')){
   if(state.denied)return json({error:'Assigned work unavailable'},404);
   if(method==='POST'){
    const body=req.postDataJSON();state.workPosts.push(body);if(state.failWork)return json({error:'Work changed. Reload before retrying.'},409);
    state.executionStatus=({assign:'assigned',accept:'accepted',submit:'pending_review',approve:'complete',reopen:'assigned'} as any)[body.action]||state.executionStatus;state.row.version++;
    state.actions.unshift({id:'event-'+state.workPosts.length,action:body.action,note:body.note,createdAt:'2026-10-17T14:00:00Z'});return json({version:state.row.version});
   }
   return json({...state.row,executionStatus:state.executionStatus,actions:state.actions,...!staff?{assigneeId:state.executionStatus==='unassigned'?null:'staff',assigneeName:'Fictional teammate',eligible:[{id:'staff',name:'Fictional teammate'}]}:{}});
  }
  if(path.endsWith('/updates'))return json({items:[],nextCursor:null});
  if(path==='/api/company/maintenance/job')return json({...state.row,recordedBy:'Fictional manager',historyLimited:false});
  return json([]);
 });return state;
}
test('private upload retains file/title/retry key, quarantines then downloads only after scanning',async({page})=>{
 const state=await setup(page);await page.goto('/company/maintenance/job');
 await page.getByRole('button',{name:'Upload document',exact:true}).click();await page.getByLabel('Document title',{exact:true}).fill('Fixture repair report');await page.getByLabel('Document file',{exact:true}).setInputFiles({name:'report.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional report')});state.failUpload=true;
 await page.getByRole('button',{name:'Upload to quarantine',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Upload interrupted');await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:/^(Save draft & close|Close & keep recovery)$/,exact:true}).click();await page.getByRole('button',{name:'Upload document',exact:true}).click();await expect(page.getByLabel('Document title',{exact:true})).toHaveValue('Fixture repair report');await expect(page.getByText('Selected: report.txt · 1 KB',{exact:true})).toBeVisible();state.failUpload=false;
 await page.getByRole('button',{name:'Upload to quarantine',exact:true}).click();await expect(page.getByRole('heading',{name:'Fixture repair report',exact:true})).toBeVisible();expect(state.uploads[0]).toEqual(state.uploads[1]);await expect(page.getByRole('button',{name:'Download version 1',exact:true})).toHaveCount(0);
 await expect(page.getByText('Latest version: Quarantined. Download blocked until scanning clears this version.',{exact:true})).toBeVisible();
 await page.getByText('1 retained version',{exact:true}).click();
 state.scanFails=true;await page.getByRole('button',{name:'Scan file',exact:true}).click();await expect(page.getByRole('alert')).toContainText('File remains quarantined');await expect(page.getByRole('button',{name:'Download version 1',exact:true})).toHaveCount(0);state.scanFails=false;await page.getByRole('button',{name:'Scan file',exact:true}).click();await expect(page.getByRole('button',{name:'Download version 1',exact:true})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download version 1',exact:true}).click();expect((await download).suggestedFilename()).toBe('report.txt');
 await page.getByText('1 retained version',{exact:true}).click();await expect(page.getByText('Latest version: Cleared by scanning',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Download version 1',exact:true})).not.toBeVisible();await page.getByText('1 retained version',{exact:true}).click();
 await page.getByRole('button',{name:'Archive document',exact:true}).click();await expect(page.getByRole('button',{name:'Restore document',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Download version 1',exact:true})).toBeVisible();
});
test('management assigns work and reviews submitted completion without recording payment',async({page})=>{
 const state=await setup(page);await page.goto('/company/maintenance/job');await page.getByRole('button',{name:'Assign or reassign work',exact:true}).click();await page.getByLabel('Assign to',{exact:true}).selectOption('staff');await page.getByLabel('Work note',{exact:true}).fill('Inspect this fixture job.');await page.getByRole('button',{name:'Save assignment',exact:true}).click();expect(state.workPosts[0]).toMatchObject({action:'assign',assigneeId:'staff',expectedVersion:1});
 state.executionStatus='pending_review';state.row.version=4;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('button',{name:'Approve completion',exact:true}).click();await expect(page.getByText('Management approval resolves this request. It does not record a payment or expense.',{exact:true})).toBeVisible();await page.getByLabel('Work note',{exact:true}).fill('Reviewed completed fixture repair.');await page.getByRole('button',{name:'Confirm completion approval',exact:true}).click();expect(state.workPosts.at(-1)).toMatchObject({action:'approve',expectedVersion:4});await expect(page.getByRole('button',{name:'Reopen work',exact:true})).toBeVisible();
});
test('assigned staff accept, retain failed progress draft and submit for management review on mobile',async({page})=>{
 const state=await setup(page,true);state.executionStatus='assigned';await page.setViewportSize({width:390,height:844});await page.goto('/company/work-orders');await page.getByRole('link',{name:'Fictional repair',exact:true}).click();await expect(page.getByRole('button',{name:'Assign or reassign work',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Private documents',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Accept work',exact:true}).click();await page.getByLabel('Work note',{exact:true}).fill('I can handle this fixture repair.');await page.getByRole('button',{name:'Confirm acceptance',exact:true}).click();await page.getByRole('button',{name:'Record progress',exact:true}).click();await page.getByLabel('Work note',{exact:true}).fill('Fixture valve replaced.');state.failWork=true;await page.getByRole('button',{name:'Save progress',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Work changed');await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:/^(Save draft & close|Close & keep recovery)$/,exact:true}).click();await page.getByRole('button',{name:'Record progress',exact:true}).click();await expect(page.getByLabel('Work note',{exact:true})).toHaveValue('Fixture valve replaced.');state.failWork=false;await page.getByRole('button',{name:'Save progress',exact:true}).click();expect(state.workPosts[1]).toEqual(state.workPosts[2]);
 await page.getByRole('button',{name:'Submit completion for review',exact:true}).click();await page.getByLabel('Work note',{exact:true}).fill('Fixture repair complete, please review.');await page.getByRole('button',{name:'Submit for review',exact:true}).click();await expect(page.getByText('Completion awaiting review',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Approve completion',exact:true})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});
test('revoked access removes private originals, assigned job details and open drafts',async({page})=>{
 const state=await setup(page,true);state.executionStatus='accepted';await page.goto('/company/work-orders/job');await page.getByRole('button',{name:'Record progress',exact:true}).click();await page.getByLabel('Work note',{exact:true}).fill('Private unsaved fixture detail');state.denied=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('alert')).toContainText('Assigned work unavailable');await expect(page.getByLabel('Work note',{exact:true})).toHaveCount(0);await expect(page.getByText('Inspect the fictional fixture leak.',{exact:true})).toHaveCount(0);
});

test('configured scanning runs after upload and a scan outage preserves the original without uploading again',async({page})=>{
 const state=await setup(page);state.scanningConfigured=true;state.scanFails=true;await page.goto('/company/maintenance/job');
 await page.getByRole('button',{name:'Upload document',exact:true}).click();await page.getByLabel('Document title',{exact:true}).fill('Fictional scan recovery');await page.getByLabel('Document file',{exact:true}).setInputFiles({name:'report.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional report')});
 await page.getByRole('button',{name:'Upload & scan',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Document saved privately. Scanning did not finish'})).toBeVisible();expect(state.uploads).toHaveLength(1);expect(state.scanRequests).toBe(1);
 await page.getByText('1 retained version',{exact:true}).click();state.scanFails=false;await page.getByRole('button',{name:'Scan file',exact:true}).click();await expect(page.getByRole('button',{name:'Download version 1',exact:true})).toBeVisible();expect(state.uploads).toHaveLength(1);
});
