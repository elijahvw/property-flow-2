import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newDemoCredentials, sealDemoCredentials, openDemoCredentials } from '../dist/sales-demo-credentials.js';

test('demo passwords are unique, encrypted and bound to their generation and application key',()=>{
  const id=randomUUID(),credentials=newDemoCredentials(id),key='isolated-unit-test-encryption-secret';
  assert.equal(credentials.length,11);assert.equal(new Set(credentials.map(c=>c.password)).size,11);assert.equal(credentials.filter(c=>c.login).length,8);
  assert.ok(credentials.every(c=>c.password.length>=40&&c.email.endsWith('@sales-demo.invalid')));
  const sealed=sealDemoCredentials(id,credentials,key);
  assert.ok(credentials.every(c=>!sealed.includes(c.password)&&!sealed.includes(c.email)));
  assert.deepEqual(openDemoCredentials(id,sealed,key),credentials);
  for(const [target,box,secret]of [[randomUUID(),sealed,key],[id,sealed,'rotated-key'],[id,sealed.slice(0,-8)+'bad-data',key]])assert.throws(()=>openDemoCredentials(target,box,secret),e=>e.code==='DEMO_CREDENTIALS_UNAVAILABLE');
  assert.throws(()=>sealDemoCredentials(id,credentials,''),e=>e.code==='DEMO_CREDENTIALS_UNAVAILABLE');
});
