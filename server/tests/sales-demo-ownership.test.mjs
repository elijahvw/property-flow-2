import test from 'node:test';
import assert from 'node:assert/strict';
import { demoOwnershipReview } from '../dist/sales-demo-ownership.js';
import { demoPlanHash } from '../dist/sales-demo-plan.js';

const account = (id='auth0|generated') => ({id,name:'Fictional account',email:'saved@sales-demo.invalid',platformRole:null,companyId:null,membership:{companyId:'demo',role:'resident',status:'active',version:1},identities:[{issuer:'https://issuer.test/',subject:id}]});
const member = user => ({userId:user.id,role:user.membership.role,status:'active',version:1,user});
test('ownership diagnostics name a foreign member and exact generated mismatch without adopting by email',()=>{
 const changed={...account(),platformRole:'support'},extra={...account('existing'),email:changed.email};
 const review=demoOwnershipReview({resident:{user_id:changed.id,email:changed.email}},[changed.id],[member(changed),member(extra)],[changed],'demo','https://issuer.test/');
 assert.equal(review.foreignMembers.length,1);assert.equal(review.foreignMembers[0].userId,'existing');
 assert.deepEqual(review.changedAccounts[0].reasons,['platform_authority']);
 assert.equal(review.changedAccounts[0].reviewPath,'/platform/users?userId=auth0%7Cgenerated');
 assert.equal(review.changedAccounts[0].supportPath,'/platform/impersonation?supportUserId=auth0%7Cgenerated');
 assert.ok(!review.changedAccounts[0].reviewPath.includes('companyId'));
});
test('a ninth prepared tenant joining is owned; email, legacy, company and identity changes remain distinct',()=>{
 const original=account(),accounts={pending:{user_id:original.id,email:original.email}};
 assert.deepEqual(demoOwnershipReview(accounts,[original.id],[member(original)],[original],'demo','https://issuer.test/').changedAccounts,[]);
 assert.deepEqual(demoOwnershipReview(accounts,[original.id],[member(original)],[original],'demo','https://issuer.test/').foreignMembers,[]);
 for(const [patch,reason] of [[{email:'changed@test.invalid'},'email_changed'],[{companyId:'old'},'legacy_company_assignment'],[{membership:{...original.membership,companyId:'customer'}},'other_company_membership'],[{identities:[{issuer:'https://other.test/',subject:original.id}]},'identity_mapping_changed']]){
  const user={...original,...patch};const result=demoOwnershipReview(accounts,[user.id],[],[user],'demo','https://issuer.test/');
  assert.deepEqual(result.changedAccounts[0].reasons,[reason]);
 }
});
test('review hashes change even when the number of blockers stays the same',()=>{
 const original=account(),accounts={resident:{user_id:original.id,email:original.email}};
 const first=demoOwnershipReview(accounts,[original.id],[],[{...original,platformRole:'support'}],'demo','https://issuer.test/');
 const second=demoOwnershipReview(accounts,[original.id],[],[{...original,platformRole:'owner'}],'demo','https://issuer.test/');
 assert.equal(first.changedAccounts.length,second.changedAccounts.length);assert.notEqual(demoPlanHash(first.snapshot),demoPlanHash(second.snapshot));
});
