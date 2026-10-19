import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {safeReturnTo} from '../dist/access.js';
import {registerSessions} from '../dist/sessions.js';
const paths=[
 '/company/documents?q=report+file&source=maintenance&status=archived&scan=pending&propertyId=home&page=2',
 '/company/maintenance/request?library=1&documentId=document&library_q=report+file&library_source=maintenance&library_status=all&library_scan=pending&library_propertyId=home&library_page=2',
 '/company/leases/lease?library=1&documentId=document&section=documents&library_q=lease&library_source=leases&library_page=2',
 '/company/work-calendar?month=2026-10&day=2026-10-18&kind=request&page=2',
];
test('document and calendar source context remains bounded and cannot establish external redirects',()=>{
 for(const path of paths)assert.equal(safeReturnTo(path),path);
 assert.equal(safeReturnTo('/company/documents?redirect=https://evil.invalid&token=secret&scan=pending'),'/company/documents?scan=pending');
 assert.equal(safeReturnTo('/company/documents?library_q='+ 'x'.repeat(201)),'/company/documents');
 assert.equal(safeReturnTo('/company/documents?library_q=report%0d%0aLocation%3aevil&source=leases'),'/company/documents?source=leases');
 assert.equal(safeReturnTo('//evil.invalid/company/documents?library=1'),'/dashboard');
});
test('actual login route stores the reviewed source return path with a mocked identity provider',async t=>{
 t.mock.method(globalThis,'fetch',async input=>{
  const url=input instanceof Request?input.url:String(input);
  assert.match(url,/^https:\/\/unused\.auth0\.com\/\.well-known\/openid-configuration$/);
  return new Response(JSON.stringify({issuer:'https://unused.auth0.com/',authorization_endpoint:'https://unused.auth0.com/authorize',token_endpoint:'https://unused.auth0.com/oauth/token',jwks_uri:'https://unused.auth0.com/jwks.json',response_types_supported:['code'],code_challenge_methods_supported:['S256']}),{headers:{'content-type':'application/json'}});
 });
 const saved=[];
 const db={loginTransaction:{deleteMany:async()=>({count:0}),create:async({data})=>{saved.push({returnTo:data.returnTo});return data;}},session:{deleteMany:async()=>({count:0})},$transaction:async actions=>Promise.all(actions)};
 const app=Fastify();t.after(()=>app.close());await registerSessions(app,db,{origin:'https://app.test',domain:'unused.auth0.com',clientId:'fixture',clientSecret:'test-only',secure:true});
 for(const path of paths){const response=await app.inject({url:'/api/auth/login?returnTo='+encodeURIComponent(path)});assert.equal(response.statusCode,302,response.body);assert.equal(new URL(response.headers.location).origin,'https://unused.auth0.com');assert.equal(saved.at(-1).returnTo,path);}
});
