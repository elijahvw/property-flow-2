import test from 'node:test';
import assert from 'node:assert/strict';
import {taskDraftValues,taskDraftContext} from '../dist/task-drafts.js';
test('draft allowlists preserve partial typed text and reject credentials, files and non-draft operations',()=>{
 assert.deepEqual(taskDraftValues('lease_create',{startsOn:'',monthlyRent:'12.',graceDays:''}),{startsOn:'',monthlyRent:'12.',graceDays:''});
 for(const [kind,payload] of [['rent_payment',{}],['lease_create',{accessToken:'secret'}],['lease_renewal',{file:{contentBase64:'private'}}],['inspection',{leaseId:'lease',items:[{key:'item',area:'',item:'',condition:'good',notes:'',evidenceVersionIds:['original']}]}]])assert.throws(()=>taskDraftValues(kind,payload));
});
test('inspection draft limits account for the combined UTF-8 bytes of field-valid observations',()=>{
 const item=(key,notes)=>({key,area:'Kitchen',item:'Wall',condition:'good',notes});
 const normal={leaseId:'lease',items:[item('wall','Paint reviewed · 壁の状態')]};
 assert.deepEqual(taskDraftValues('inspection',normal),normal);
 const large={leaseId:'lease',items:Array.from({length:100},(_,i)=>item(`item-${i}`,'é'.repeat(300)))};
 assert.ok(JSON.stringify(large).length<48*1024,'individual fields and character count can fit while their UTF-8 bytes exceed storage');
 assert.ok(Buffer.byteLength(JSON.stringify(large),'utf8')>65536);
 assert.throws(()=>taskDraftValues('inspection',large),error=>error.statusCode===400&&error.code==='INVALID_INPUT'&&/Shorten the observation notes/.test(error.message));
});
test('directory context has a separate UTF-8 budget and keeps normal partial filters intact',()=>{
 const normal={leaseListProperty:'home',leaseListQ:'Maple · 物件'};
 assert.deepEqual(taskDraftContext(normal),normal);
 assert.deepEqual(taskDraftContext(undefined),{});
 const large={leaseListProperty:'p'.repeat(200),leaseListUnit:'u'.repeat(200),leaseListStatus:'界'.repeat(200),leaseListQ:'界'.repeat(200),leaseListNested:'界'.repeat(200)};
 assert.ok(JSON.stringify(large).length<1536);
 assert.ok(Buffer.byteLength(JSON.stringify(large),'utf8')>2048);
 assert.throws(()=>taskDraftContext(large),error=>error.statusCode===400&&error.code==='INVALID_INPUT'&&/Shorten the directory search/.test(error.message));
});
test('task drafts preserve exact opaque user identities and bounded source-return context',()=>{
 const user='auth0|'+ '界'.repeat(1000);
 assert.deepEqual(taskDraftValues('lease_create',{residentId:user}),{residentId:user});
 assert.throws(()=>taskDraftValues('lease_create',{residentId:'界'.repeat(1400)}),error=>error.statusCode===400);
 const context={prospectId:'prospect-a',prospectQ:'A retained inquiry',tenantId:'resident-a',tenantHistoryCursor:'a'.repeat(320),tenantSection:'rentals'};
 assert.deepEqual(taskDraftContext(context),context);
 assert.throws(()=>taskDraftContext({returnTo:'https://foreign.invalid'}));
});
