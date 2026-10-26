import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newDemoCredentials, sealDemoCredentials, openDemoCredentials } from '../dist/sales-demo-credentials.js';

test('demo passwords are unique, encrypted and bound to their generation and application key',()=>{
  const id=randomUUID(),credentials=newDemoCredentials(id),key='isolated-unit-test-encryption-secret';
  assert.equal(credentials.length,11);assert.equal(new Set(credentials.map(c=>c.password)).size,11);assert.equal(credentials.filter(c=>c.login).length,8);
  assert.ok(credentials.every(c=>c.password.length>=40&&c.email.endsWith('.sales-demo.invalid')));
  const sealed=sealDemoCredentials(id,credentials,key);
  assert.ok(credentials.every(c=>!sealed.includes(c.password)&&!sealed.includes(c.email)));
  assert.deepEqual(openDemoCredentials(id,sealed,key),credentials);
  for(const [target,box,secret]of [[randomUUID(),sealed,key],[id,sealed,'rotated-key'],[id,sealed.slice(0,-8)+'bad-data',key]])assert.throws(()=>openDemoCredentials(target,box,secret),e=>e.code==='DEMO_CREDENTIALS_UNAVAILABLE');
  assert.throws(()=>sealDemoCredentials(id,credentials,''),e=>e.code==='DEMO_CREDENTIALS_UNAVAILABLE');
});


test('readable generation emails retain exact legacy ownership and isolate new generations', async()=>{
 const {demoEmail,isDemoEmail}=await import('../dist/sales-demo-email.js');
 const id=randomUUID(),credentials=newDemoCredentials(id),other=newDemoCredentials(randomUUID());
 assert.match(credentials.find(c=>c.accountKey==='resident').email,/^jordan\.rivera@oak-elm-[a-f0-9]{10}\.sales-demo\.invalid$/);
 assert.ok(credentials.every(c=>!c.email.includes(id)&&isDemoEmail(id,c.accountKey,c.email)));
 assert.equal(new Set(credentials.map(c=>c.email)).size,11);
 for(const c of credentials){
  assert.ok(!other.some(o=>o.email===c.email));
  assert.equal(isDemoEmail(id,c.accountKey,`${c.accountKey}.${id}@sales-demo.invalid`),true);
  assert.equal(isDemoEmail(randomUUID(),c.accountKey,c.email),false);
 }
 assert.equal(isDemoEmail(id,'unknown','unknown@test.invalid'),false);
 assert.equal(isDemoEmail(id,'owner',demoEmail(id,'resident')),false);
});
