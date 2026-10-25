import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const label=process.argv[2]||'local';
assert.match(label,/^[a-z0-9-]{1,40}$/,'Pass a short run label; targets/URLs are not accepted');
assert.ok(process.argv.length<=3,'Only a run label is accepted');
const {chromium}=await import('@playwright/test');
const {performanceFixture}=await import('./performance-fixture.mjs');
const folder=await mkdtemp(join(tmpdir(),'pf-performance-'));await chmod(folder,0o700);
let fixture,browser,load;
const cleanup=async()=>{load?.kill('SIGTERM');try {await browser?.close();} finally {try {await fixture?.close();} finally {await rm(folder,{recursive:true,force:true});}}};
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void cleanup().finally(()=>process.exit(1)));
const percentile=(rows,p)=>[...rows].sort((a,b)=>a-b)[Math.max(0,Math.ceil(rows.length*p)-1)];
try {
  fixture=await performanceFixture();const before=await fixture.counts();
  const privateFile=join(folder,'fixture.json'),summaryFile=join(folder,'k6-summary.json');
  await writeFile(privateFile,JSON.stringify({marker:'fresh-tmpfs-performance-v1',origin:fixture.origin,token:fixture.sessions.owner.token}),{mode:0o600});
  console.log('Performance fixture: 20 properties, 200 units/tenants/leases; isolated PostgreSQL, production client.');
  // Probe real role boundaries separately; denied reads are not load-test errors.
  for(const role of ['staff','resident']) {
    const r=await fetch(fixture.origin+'/api/company/leases',{headers:{cookie:`pf-session=${fixture.sessions[role].token}`},redirect:'error'});assert.equal(r.status,403);
  }
  browser=await chromium.launch({headless:true});
  const journeys=[
    ['overview','/company/overview','/api/company/overview','Overview'],
    ['properties','/company/properties','/api/company/property-directory','Properties'],
    ['tenants','/company/residents','/api/company/resident-profiles','Tenants'],
    ['leases','/company/leases','/api/company/leases','Lease records'],
    ['lease','/company/leases/perf-lease-1','/api/company/leases/perf-lease-1','Test Property 01 · Unit 1'],
    ['rent','/company/rent','/api/company/rent','Rent & charges'],
    ['deposits','/company/deposits','/api/company/deposits','Security deposits'],
    ['maintenance','/company/maintenance','/api/company/maintenance/directory','Maintenance requests'],
  ];
  const ui=[];
  for(const [name,path,endpoint,heading] of journeys) {
    const durations=[],requests=[],bytes=[];
    for(let sample=0;sample<5;sample++) {
      const context=await browser.newContext({viewport:{width:1365,height:900}});
      await context.addCookies([{name:'pf-session',value:fixture.sessions.owner.token,url:fixture.origin}]);
      const page=await context.newPage();page.setDefaultTimeout(10000);let apiCalls=0;const scripts=[];
      page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/') && !r.url().includes('/telemetry'))apiCalls++;});
      page.on('response',r=>{if(r.request().resourceType()==='script')scripts.push(r.body().then(body=>gzipSync(body).length));});
      // Unexpected external requests are blocked and fail the run. No Auth0/Grafana calls.
      await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
      const response=page.waitForResponse(r=>new URL(r.url()).pathname===endpoint && r.status()===200);
      const start=performance.now();await page.goto(fixture.origin+path);await response;
      await page.getByRole('heading',{name:heading,exact:true}).waitFor();
      // React renders API data on the next frame. Include it in time to usable view.
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await page.getByRole('alert').count(),0,`${name} contains an error`);
      durations.push(performance.now()-start);requests.push(apiCalls);bytes.push((await Promise.all(scripts)).reduce((a,b)=>a+b,0));
      await context.close();
    }
    ui.push({workflow:name,samples:durations.length,medianMs:Math.round(percentile(durations,.5)),maxMs:Math.round(Math.max(...durations)),apiRequests:Math.max(...requests),javascriptGzipBytes:Math.max(...bytes)});
    console.log(`${name}: browser median ${ui.at(-1).medianMs}ms; ${ui.at(-1).apiRequests} API requests; ${ui.at(-1).javascriptGzipBytes} gzip JS bytes`);
  }
  await browser.close();browser=null;
  const k6=process.env.K6_BIN||'k6';
  load=spawn(k6,['run','--no-usage-report','--quiet','--env',`PF_PERFORMANCE_FIXTURE=${privateFile}`,'--env',`PF_PERFORMANCE_SUMMARY=${summaryFile}`,'tests/performance/workflows.k6.js'],{cwd:fixture.root,env:{PATH:process.env.PATH,HOME:folder},stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{load.once('error',reject);load.once('exit',resolve);});load=null;
  const metrics=JSON.parse(await readFile(summaryFile,'utf8')).metrics;
  const api=Object.entries(metrics).filter(([name])=>name.startsWith('workflow_api_duration{workflow:')).map(([name,m])=>({workflow:name.match(/workflow:(\w+)/)[1],p95Ms:Math.round(m.values['p(95)']*100)/100,p99Ms:Math.round(m.values['p(99)']*100)/100,medianMs:Math.round(m.values.med*100)/100}));
  assert.deepEqual(await fixture.counts(),before,'Read workload changed source records');
  const browserBudgetsPassed=ui.every(row=>row.javascriptGzipBytes<135000 && row.maxMs<2500 && row.apiRequests<=6);
  const report={schemaVersion:1,label,measuredAt:new Date().toISOString(),revision:execFileSync('git',['rev-parse','--short','HEAD'],{cwd:fixture.root,encoding:'utf8'}).trim(),sourceDirty:!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:fixture.root,encoding:'utf8'}).trim(),clientFingerprint:fixture.clientFingerprint,environment:'isolated-local',dataset:fixture.dataset,load:{vus:5,durationSeconds:20,requests:metrics.http_reqs.values.count,failedRate:metrics.http_req_failed.values.rate,checks:metrics.checks.values.rate,thresholdsPassed:code===0},browserBudgetsPassed,browser:ui,api};
  const output=join(tmpdir(),`propertyflow-performance-${label}.json`);await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(`Sanitized performance report: ${output}`);console.log(`Browser budgets: ${browserBudgetsPassed?'passed':'failed'} (gzip JS <135 KB, view <2.5s, <=6 business API calls).`);process.exitCode=code===0&&browserBudgetsPassed?0:1;
} finally {await cleanup();}
