// Real pg + Fastify + OTLP regression. Only a fresh tmpfs database created here.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8'}).trim();
const batches=[];
const collector=createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 batches.push({path:req.url,body:Buffer.concat(chunks),auth:req.headers.authorization});
 res.writeHead(200,{'content-type':'application/x-protobuf'});res.end();
});
let container;
try {
 const image=docker('image','inspect','postgres:17-alpine','--format','{{.Id}}');
 container=docker('run','--detach','--pull','never','--name','pf-otel-'+randomUUID(),'--tmpfs','/var/lib/postgresql/data:rw','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD=isolated-otel-test','--env','POSTGRES_DB=propertyflow_otel_test',image);
 const [info]=JSON.parse(docker('inspect',container));assert.equal(info.Mounts.length,0);assert.equal(info.HostConfig.Tmpfs['/var/lib/postgresql/data'],'rw');
 let ready=false;
 for(let i=0;i<100;i++){
  try{docker('exec',container,'pg_isready','-U','postgres');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}
 }
 assert.ok(ready,'isolated database startup timed out');
 await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
 const code=`
  import assert from 'node:assert/strict';
  const telemetry=await import('./server/dist/tracing.js');
  const {context,trace}=await import('@opentelemetry/api');
  const {default:pg}=await import('pg');
  const {default:fastify}=await import('fastify');
  const observed=[];
  const original=telemetry.PrivateSpanExporter.prototype.export;
  telemetry.PrivateSpanExporter.prototype.export=function(spans,done){observed.push(...spans);return original.call(this,spans,done);};
  const pool=new pg.Pool({connectionString:process.env.PROBE_DATABASE_URL});
  const app=fastify();telemetry.registerTelemetry(app);
  app.get('/api/probe/:id',async request=>{
   assert.ok(trace.getSpan(context.active()),'Fastify must preserve request context');
   const result=await pool.query("SELECT 'fixture-sensitive-sql'::text AS value, $1::text AS parameter",['fixture-private-value']);
   assert.equal(result.rows[0].parameter,'fixture-private-value');return {ok:true};
  });
  assert.equal((await app.inject('/api/probe/fixture-private-person?token=fixture-secret')).statusCode,200);
  await app.close();await pool.end();await telemetry.shutdownTelemetry();
  const http=observed.find(s=>s.name==='GET /api/probe/:id');
  assert.ok(http,'request trace missing');assert.equal(http.kind,1,'HTTP span must be SERVER for native APM');
  const queries=observed.filter(s=>s.instrumentationScope.name.includes('pg'));
  assert.ok(queries.length,'real PostgreSQL spans are missing');
  assert.ok(queries.every(s=>s.spanContext().traceId===http.spanContext().traceId),'PostgreSQL spans must share the HTTP trace');
  assert.ok(queries.some(s=>s.parentSpanContext?.spanId===http.spanContext().spanId),'PostgreSQL must be a request child');
 `;
 const env={...process.env,PROBE_DATABASE_URL:`postgresql://postgres:isolated-otel-test@127.0.0.1:${info.NetworkSettings.Ports['5432/tcp'][0].HostPort}/propertyflow_otel_test`,OTEL_EXPORTER_OTLP_ENDPOINT:`http://127.0.0.1:${collector.address().port}/otlp`,OTEL_EXPORTER_OTLP_HEADERS:'Authorization=Basic%20'+Buffer.from('fixture:isolated-monitoring-token').toString('base64')};
 delete env.DATABASE_URL;delete env.RUNTIME_DATABASE_URL;delete env.TEST_DATABASE_URL;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{env,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);
 const deadline=setTimeout(()=>child.kill('SIGKILL'),20000);
 const [status]=await once(child,'exit');clearTimeout(deadline);assert.equal(status,0,output);
 for(const signal of ['traces','metrics','logs'])assert.ok(batches.some(row=>row.path==='/otlp/v1/'+signal),signal+' export missing');
 assert.ok(batches.every(row=>row.auth==='Basic '+Buffer.from('fixture:isolated-monitoring-token').toString('base64')),'all signal exporters must authenticate');
 const wire=Buffer.concat(batches.map(row=>row.body)).toString('utf8');
 assert.match(wire,/postgresql.query/);assert.match(wire,/propertyflow.database.duration/);
 assert.doesNotMatch(wire,/fixture-sensitive-sql|fixture-private-value|fixture-private-person|fixture-secret|isolated-otel-test|PROBE_DATABASE_URL/);
 console.log('PASS: real PostgreSQL child spans, native SERVER spans, all three authenticated OTLP signals, and SQL/parameter/URL/credential redaction.');
} finally {
 if(collector.listening)await new Promise(resolve=>collector.close(resolve));
 if(container)docker('rm','--force',container);
}
