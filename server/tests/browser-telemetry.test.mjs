import assert from 'node:assert/strict';
import test from 'node:test';
import fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { registerBrowserTelemetry } from '../dist/browser-telemetry.js';
test('browser intake rejects unauthenticated, forged-CSRF, unknown and oversized telemetry',async()=>{
 const app=fastify();await app.register(rateLimit,{global:false});
 registerBrowserTelemetry(app,async(req,reply)=>{
   if(req.headers.cookie!=='session=test')return reply.code(401).send();
   if(req.headers.origin!=='https://app.example'||req.headers['x-csrf-token']!=='test')return reply.code(403).send();
   req.principal={id:'test-user'};
 });
 const row={name:'lease.update',outcome:'success',duration:120};
 const headers={cookie:'session=test',origin:'https://app.example','x-csrf-token':'test'};
 try {
   assert.equal((await app.inject({method:'POST',url:'/api/telemetry',payload:{events:[row]}})).statusCode,401);
   assert.equal((await app.inject({method:'POST',url:'/api/telemetry',headers:{...headers,origin:'https://forged.example'},payload:{events:[row]}})).statusCode,403);
   assert.equal((await app.inject({method:'POST',url:'/api/telemetry',headers,payload:{events:[{...row,name:'resident@example.com'}]}})).statusCode,400);
   assert.equal((await app.inject({method:'POST',url:'/api/telemetry',headers,payload:{events:Array(17).fill(row)}})).statusCode,400);
   assert.equal((await app.inject({method:'POST',url:'/api/telemetry',headers,payload:{events:[row]}})).statusCode,204);
   const statuses=[];for(let i=0;i<10;i++)statuses.push((await app.inject({method:'POST',url:'/api/telemetry',headers,payload:{events:[row]}})).statusCode);
   assert.ok(statuses.includes(429),'authenticated telemetry must be rate-limited');
 } finally {await app.close();}
});
