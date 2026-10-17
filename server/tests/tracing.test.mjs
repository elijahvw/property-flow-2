import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PrivateSpanExporter, PrivateMetricExporter, DatabaseMetricsProcessor, browserParentContext } from '../dist/tracing.js';
import { trace } from '@opentelemetry/api';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));
test('browser trace identity is strict and cannot control backend sampling or baggage', () => {
  const valid = '00-'+'a'.repeat(32)+'-'+'b'.repeat(16)+'-00';
  assert.deepEqual(trace.getSpanContext(browserParentContext(valid)), { traceId:'a'.repeat(32),spanId:'b'.repeat(16),traceFlags:1,isRemote:true });
  for(const value of [undefined,[valid],valid+'private',valid.replace('00-','ff-'),valid.replace('a'.repeat(32),'0'.repeat(32)),valid.replace('b'.repeat(16),'0'.repeat(16))]) assert.equal(trace.getSpanContext(browserParentContext(value)),undefined);
});
async function run(source, env = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd:serverRoot, env:{...process.env, OTEL_EXPORTER_OTLP_ENDPOINT:'', ...env}, stdio:['ignore','pipe','pipe'],
  });
  let output=''; child.stdout.on('data',data=>output+=data); child.stderr.on('data',data=>output+=data);
  const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
  try { const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}); assert.equal(code,0,output); }
  finally {clearTimeout(timer);}
}
const probe = `
  import assert from 'node:assert/strict';
  await import('./dist/tracing.js');
  const { trace } = await import('@opentelemetry/api');
  const { PrismaClient } = await import('@prisma/client');
  let queried = false;
  const driver = {
    provider: 'postgres', adapterName: 'readiness-test',
    async queryRaw(query) {
      queried = true;
      assert.match(query.sql, /SELECT 1/);
      if (process.env.PROBE_FAILURE === 'true') throw new Error('database unavailable');
      return { columnTypes: [0], columnNames: ['ready'], rows: [[1]] };
    },
    async executeRaw() { return 0; }, async dispose() {},
  };
  const adapter = { provider:'postgres',adapterName:'readiness-test',async connect(){return driver;} };
  const prisma = new PrismaClient({ adapter });
  try {
    const query = () => trace.getTracer('test').startActiveSpan('readiness', async span => {
      try {return await prisma.$queryRawUnsafe('SELECT 1 AS ready');} finally {span.end();}
    });
    if(process.env.PROBE_FAILURE === 'true') await assert.rejects(query, /database unavailable/);
    else assert.deepEqual(await query(), [{ready:1}]);
    assert.equal(queried,true);
  } finally { await prisma.$disconnect(); }
`;
for (const failure of [false,true]) test(failure ? 'database failures reach Prisma without a tracing crash' : 'readiness query works with OpenTelemetry initialization', () => run(probe,{PROBE_FAILURE:String(failure)}));

test('trace export strips SQL, bind values, connection details and exception text', async () => {
  let exported;
  const delegate={export(spans,done){exported=spans;done({code:0});},async shutdown(){}};
  const exporter=new PrivateSpanExporter(delegate);
  const span={duration:[0,1000000],name:'pg.query SELECT private@example.com',instrumentationScope:{name:'@opentelemetry/instrumentation-pg'},spanContext:()=>({traceId:'safe'}),
    attributes:{'db.statement':'SELECT password','db.connection_string':'postgres://secret','db.operation.name':'SELECT','http.route':'/api/leases/:id'},
    events:[{name:'exception',attributes:{'exception.message':'private error'}}],links:[{attributes:{secret:'private'}}],status:{code:2,message:'private error'}};
  exporter.export([span],()=>{});
  assert.equal(exported[0].name,'postgresql.query');
  assert.deepEqual(exported[0].attributes,{'db.operation.name':'SELECT','http.route':'/api/leases/:id'});
  assert.deepEqual(exported[0].events,[]);assert.deepEqual(exported[0].links,[]);
  assert.deepEqual(exported[0].status,{code:2});
  assert.doesNotMatch(JSON.stringify(exported),/private|password|postgres:\/\//);
});

test('OTLP exports HTTP metrics, correlated safe logs and traces without raw URLs or errors', async () => {
  const batches=[];
  const sink=createServer(async(req,res)=>{const body=[];for await(const chunk of req)body.push(chunk);batches.push({path:req.url,body:Buffer.concat(body)});res.writeHead(200,{'content-type':'application/x-protobuf'});res.end();});
  await new Promise(resolve=>sink.listen(0,'127.0.0.1',resolve));
  try {
    await run(`
      import assert from 'node:assert/strict';
      const { registerTelemetry,recordRequestError,shutdownTelemetry } = await import('./dist/tracing.js');
      const { context,trace } = await import('@opentelemetry/api');
      const { default:fastify }=await import('fastify');
      const app=fastify();registerTelemetry(app);
      app.get('/api/example/:id',async(request,reply)=>{
        assert.ok(trace.getSpan(context.active()),'request context must propagate to database calls');
        assert.equal(trace.getSpan(context.active()).spanContext().traceId,'a'.repeat(32));
        recordRequestError(request,'REQUEST_503','Error');return reply.code(503).send({error:'safe'});
      });
      await app.inject({url:'/api/example/private-person?token=secret-token',headers:{traceparent:'00-'+'a'.repeat(32)+'-'+'b'.repeat(16)+'-01',baggage:'email=private-person',tracestate:'private=secret-token'}});
      await app.close();await shutdownTelemetry();
    `,{OTEL_EXPORTER_OTLP_ENDPOINT:`http://127.0.0.1:${sink.address().port}`});
    for(const signal of ['traces','metrics','logs']) assert.ok(batches.some(row=>row.path===`/v1/${signal}`),signal);
    const wire=Buffer.concat(batches.map(row=>row.body)).toString('utf8');
    assert.match(wire,/\/api\/example\/:id/);assert.match(wire,/REQUEST_503/);
    assert.doesNotMatch(wire,/private-person|secret-token|\?token=/);
  } finally {await new Promise(resolve=>sink.close(resolve));}
});

test('collector outage does not fail or delay a business request', () => run(`
  import assert from 'node:assert/strict';
  const {registerTelemetry,shutdownTelemetry}=await import('./dist/tracing.js');
  const {default:fastify}=await import('fastify');const app=fastify();registerTelemetry(app);
  app.get('/api/example',async()=>({ok:true}));
  const start=performance.now();const reply=await app.inject('/api/example');
  assert.equal(reply.statusCode,200);assert.ok(performance.now()-start<1500);
  await app.close();await shutdownTelemetry().catch(()=>{});
`,{OTEL_EXPORTER_OTLP_ENDPOINT:'http://127.0.0.1:1'}));

test('metric export accepts only explicit application instruments and safe labels', () => {
  let exported;
  const exporter=new PrivateMetricExporter({export(data,done){exported=data;done({code:0});},async forceFlush(){},async shutdown(){}});
  const metric={descriptor:{name:'propertyflow.http.requests'},dataPoints:[{attributes:{'http.route':'/api/leases/:id','db.statement':'SELECT secret','user.email':'private@example.com'},value:1}]};
  exporter.export({resource:{},scopeMetrics:[{scope:{name:'propertyflow-server'},metrics:[metric]},{scope:{name:'driver'},metrics:[{...metric,descriptor:{name:'private query text'}}]}]},()=>{});
  assert.equal(exported.scopeMetrics.length,1);
  assert.deepEqual(exported.scopeMetrics[0].metrics[0].dataPoints[0].attributes,{'http.route':'/api/leases/:id'});
  assert.doesNotMatch(JSON.stringify(exported),/private|secret|db.statement/);
});

test('database latency is measured when spans finish independently of export transport', async () => {
  const values=[];const processor=new DatabaseMetricsProcessor(value=>values.push(value));
  processor.onEnd({instrumentationScope:{name:'@opentelemetry/instrumentation-pg'},duration:[2,500000000]});
  processor.onEnd({instrumentationScope:{name:'propertyflow-http'},duration:[9,0]});
  assert.deepEqual(values,[2.5]);await processor.forceFlush();await processor.shutdown();
});
