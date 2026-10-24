// Fixed synthetic scales in an owned tmpfs fixture. No URLs, database targets,
// private query text, request payloads or session material are report fields.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performanceFixture } from './performance-fixture.mjs';

const mode=process.argv[2];
assert.ok(process.argv.length===3&&['baseline','paged'].includes(mode),'Use only baseline or paged; targets and URLs are not accepted');
const root=new URL('../',import.meta.url);
const fingerprint=async()=>{
  const hash=createHash('sha256');
  for(const file of (await readdir(new URL('server/dist/',root))).filter(name=>name.endsWith('.js')).sort()) {
    hash.update(file);hash.update(await readFile(new URL('server/dist/'+file,root)));
  }
  return hash.digest('hex');
};
const serverFingerprint=await fingerprint(), startedAt=new Date().toISOString();
const clientBuildFingerprint=async()=>createHash('sha256').update(await readFile(new URL('client/dist/index.html',root))).digest('hex').slice(0,16);
const initialClientFingerprint=await clientBuildFingerprint();
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const round=value=>Math.round(value*100)/100;
const planNode=node=>({
  nodeType:node['Node Type'],...(node['Relation Name']?{relation:node['Relation Name']}:{}),...(node['Index Name']?{index:node['Index Name']}:{}),
  ...(node['Index Name']?{dateInIndexCondition:(node['Index Cond']||'').includes('createdAt')}:{}),
  ...(node['Scan Direction']?{scanDirection:node['Scan Direction']}:{}),
  estimatedRows:node['Plan Rows'],actualRows:node['Actual Rows'],loops:node['Actual Loops'],totalMs:node['Actual Total Time'],
  ...(node['Rows Removed by Filter']!==undefined?{rowsRemoved:node['Rows Removed by Filter']}:{}),
  ...(node['Shared Hit Blocks']!==undefined?{sharedHitBlocks:node['Shared Hit Blocks']}:{}),
  ...(node['Shared Read Blocks']!==undefined?{sharedReadBlocks:node['Shared Read Blocks']}:{}),
  ...(node['Sort Method']?{sortMethod:node['Sort Method'],sortSpaceKb:node['Sort Space Used'],sortSpaceType:node['Sort Space Type']}:{}),
  ...(node.Plans?{children:node.Plans.map(planNode)}:{}),
});
const scenarios=[
  {name:'all',role:'owner',query:''},
  {name:'unresolved',role:'owner',query:'status=unresolved'},
  {name:'property_unresolved',role:'owner',query:'propertyId=perf-property-1&status=unresolved'},
  {name:'description_search',role:'owner',query:'q=capacity-description-sentinel'},
  {name:'property_search',role:'owner',query:'q=Capacity+property+sentinel'},
  {name:'unit_search',role:'owner',query:'q=Capacity+unit+sentinel'},
  {name:'due_overdue',role:'owner',query:'due=overdue'},
  {name:'assignee',role:'owner',query:'assignee=Performance+Staff'},
  {name:'resident_all',role:'resident',query:''},
];
let fixture,startup,stage='fixture startup',closing,interrupted=false,sourceBefore;
const cleanup=()=>closing??=(async()=>{
  let owned=fixture;
  if(!owned&&startup)try{owned=await startup;}catch{/* startup owns failure cleanup */}
  try{await owned?.close();}finally{fixture=null;startup=null;}
})();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  if(interrupted)return;interrupted=true;
  void cleanup().finally(()=>process.exit(1));
});
const validatePage=(body,expected,first=false)=>{
  assert.equal(body.companyId,'perf-company');assert.equal(body.pageSize,50);
  assert.equal(body.total,expected.total);assert.deepEqual(body.statusCounts,expected.statusCounts);
  assert.ok(Array.isArray(body.items)&&body.items.length<=50);assert.equal(new Set(body.items.map(row=>row.id)).size,body.items.length);
  assert.ok(body.items.every(row=>!['description','updatedAt','version','assigneeId'].some(key=>Object.hasOwn(row,key))));
  for(const cursor of [body.nextCursor,body.previousCursor])assert.ok(cursor===null||typeof cursor==='string'&&cursor.length<=512);
  if(first){assert.equal(body.items.length,Math.min(50,expected.total));assert.equal(body.previousCursor,null);}
};
const measurements=[];
const writeSnapshot=async(complete,suffix)=>{
  assert.equal(await fingerprint(),serverFingerprint,'Production build changed during the measurement');
  assert.equal(await clientBuildFingerprint(),initialClientFingerprint,'Client build changed during the measurement');
  assert.ok(measurements.every(scale=>scale.clientFingerprint===initialClientFingerprint));
  const report={schemaVersion:1,kind:'maintenance-capacity',mode,complete,startedAt,finishedAt:new Date().toISOString(),environment:'isolated-loopback-tmpfs-postgresql17',
    revision:execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim(),serverFingerprint,clientFingerprint:initialClientFingerprint,
    hasServerFailures:measurements.some(scale=>scale.scenarios.some(scenario=>scenario.serverFailures>0)),
    methodology:{warmupPerScenario:2,samplesPerScenario:10,concurrency:1,statistics:'ANALYZE before measurement',runtimeRls:true,
      semantics:mode==='baseline'?'complete unbounded legacy arrays':'50-row directory with complete filtered totals',
      sqlCount:'real Prisma query events through final response hook, including authentication, transaction and usage bookkeeping',
      plans:'actual captured maintenance SELECT statements under restricted runtime role and company RLS; constants/query text omitted'},
    limitations:['Synthetic local single-user reads, not deployed capacity, network/provider latency or write throughput.','Warm-cache small samples; p95 is the largest of ten observations.','HTTP time includes receiving the complete body; SQL count includes response-hook bookkeeping.','Plan execution excludes application serialization and body transfer.','The fixture maps unhandled application errors to a fixed safe503 envelope; underlying error class/SQLSTATE are reported separately.'],measurements};
  const output=join(tmpdir(),`propertyflow-maintenance-capacity-${mode}-${startedAt.replace(/\D/g,'')}-${serverFingerprint.slice(0,10)}-${suffix}.json`);
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(`Immutable sanitized report: ${output}`);
};
try {
  for(const scale of [1000,10000,50000]) {
    stage=`${scale} fixture startup`;
    sourceBefore=null;
    closing=null;startup=performanceFixture({maintenanceScale:scale});fixture=await startup;startup=null;
    if(interrupted)throw new Error('Interrupted before measurement');
    const before=await fixture.counts(), rows=[];sourceBefore=before;
    for(const scenario of scenarios) {
      stage=`${scale} ${scenario.name}`;
      const base=`/api/${scenario.role==='resident'?'resident':'company'}/maintenance${mode==='paged'?'/directory':''}`;
      const path=base+(scenario.query?'?'+scenario.query:'');
      const samples=[];let captured,lastPage;
      for(let sample=0;sample<12;sample++) {
        fixture.beginQueryCapture();
        const start=performance.now();
        const response=await fetch(fixture.origin+path,{headers:{cookie:`pf-session=${fixture.sessions[scenario.role].token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
        const text=await response.text(),elapsed=performance.now()-start;
        captured=await fixture.endQueryCapture();
        assert.ok(captured.count>0);assert.ok(captured.maintenanceQueries.length>0);
        const body=JSON.parse(text), expected=fixture.capacityExpectations[scenario.name];
        if(response.status!==200) {
          assert.ok(response.status>=500&&response.status<=599,'Unexpected non-server-error response');
          console.log(`${mode} ${scale} ${scenario.name}: safe failure status ${response.status} code ${fixture.applicationFailure()?.sqlState||fixture.applicationFailure()?.code||'UNCLASSIFIED'} rollback ${captured.rollbacks}`);
        } else if(mode==='baseline') {
          assert.ok(Array.isArray(body));assert.equal(body.length,expected.total);
          assert.deepEqual(Object.fromEntries(['open','in_progress','resolved'].map(status=>[status,body.filter(row=>row.status===status).length])),expected.statusCounts);
        } else {
          validatePage(body,expected,true);
        }
        lastPage=body;
        if(sample>=2)samples.push({httpMs:elapsed,bytes:Buffer.byteLength(text),sqlQueries:captured.count,databaseMs:captured.databaseMs,status:response.status,
          commits:captured.commits,rollbacks:captured.rollbacks,...(response.status===200?{}:{failure:fixture.applicationFailure()})});
      }
      const explained=await fixture.explainMaintenance(captured.maintenanceQueries);
      const result={scenario:scenario.name,role:scenario.role,expectedTotal:fixture.capacityExpectations[scenario.name].total,expectedStatusCounts:fixture.capacityExpectations[scenario.name].statusCounts,
        successfulResponses:samples.filter(sample=>sample.status===200).length,serverFailures:samples.filter(sample=>sample.status>=500).length,
        httpStatuses:Object.fromEntries([...new Set(samples.map(sample=>sample.status))].map(status=>[status,samples.filter(sample=>sample.status===status).length])),
        transactionCommits:Math.max(...samples.map(sample=>sample.commits)),transactionRollbacks:Math.max(...samples.map(sample=>sample.rollbacks)),
        ...(samples.some(sample=>sample.failure)?{failure:samples.find(sample=>sample.failure).failure}:{}),
        samples:samples.length,httpMedianMs:round(percentile(samples.map(row=>row.httpMs),.5)),httpP95Ms:round(percentile(samples.map(row=>row.httpMs),.95)),
        responseBytes:Math.max(...samples.map(row=>row.bytes)),sqlQueriesMin:Math.min(...samples.map(row=>row.sqlQueries)),sqlQueriesMax:Math.max(...samples.map(row=>row.sqlQueries)),
        databaseMedianMs:round(percentile(samples.map(row=>row.databaseMs),.5)),
        timingPopulation:'all attempted responses; success/failure counts must be considered',
        successOnly:samples.some(sample=>sample.status===200)?{samples:samples.filter(sample=>sample.status===200).length,
          httpMedianMs:round(percentile(samples.filter(sample=>sample.status===200).map(sample=>sample.httpMs),.5)),
          httpP95Ms:round(percentile(samples.filter(sample=>sample.status===200).map(sample=>sample.httpMs),.95)),
          responseBytes:Math.max(...samples.filter(sample=>sample.status===200).map(sample=>sample.bytes))}:null,
        plans:explained.map(plan=>({planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],plan:planNode(plan.Plan)}))};
      if(mode==='paged'&&lastPage.nextCursor) {
        let page=lastPage,pages=1,forwardQueries;const traversed=[page],seen=new Set(page.items.map(row=>row.id));
        while(page.nextCursor&&pages<20) {
          const token=page.nextCursor,params=new URLSearchParams(scenario.query);params.set('cursor',token);
          fixture.beginQueryCapture();
          const response=await fetch(fixture.origin+base+'?'+params,{headers:{cookie:`pf-session=${fixture.sessions[scenario.role].token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
          assert.equal(response.status,200);page=await response.json();forwardQueries=(await fixture.endQueryCapture()).maintenanceQueries;validatePage(page,fixture.capacityExpectations[scenario.name]);
          assert.notEqual(page.nextCursor,token);assert.ok(page.items.every(row=>!seen.has(row.id)));
          for(const row of page.items)seen.add(row.id);traversed.push(page);pages++;
        }
        result.deepPageNumber=pages;
        result.deepForwardPage={page:pages,plans:(await fixture.explainMaintenance(forwardQueries)).map(plan=>({planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],plan:planNode(plan.Plan)}))};
        fixture.beginQueryCapture();
        const params=new URLSearchParams(scenario.query);
        if(page.previousCursor)params.set('before',page.previousCursor);
        const start=performance.now(),response=await fetch(fixture.origin+base+'?'+params,{headers:{cookie:`pf-session=${fixture.sessions[scenario.role].token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
        const text=await response.text();const elapsed=performance.now()-start,queries=await fixture.endQueryCapture();assert.equal(response.status,200);
        const previous=JSON.parse(text);validatePage(previous,fixture.capacityExpectations[scenario.name]);
        assert.deepEqual(previous.items.map(row=>row.id),traversed.at(-2).items.map(row=>row.id));
        result.deepPreviousPage={httpMs:round(elapsed),responseBytes:Buffer.byteLength(text),sqlQueries:queries.count};
        result.deepPreviousPage.plans=(await fixture.explainMaintenance(queries.maintenanceQueries)).map(plan=>({planningMs:plan['Planning Time'],executionMs:plan['Execution Time'],plan:planNode(plan.Plan)}));
        if(scenario.name==='all'){
          // Small selective windows can correctly use BitmapOr index scans and
          // a final Sort. Such scans have no direction; the range must remain
          // an index condition, while exact page identity is checked above.
          const hasRange=node=>node.index==='maintenance_directory_order'&&node.dateInIndexCondition||node.children?.some(hasRange);
          assert.ok(result.deepForwardPage.plans.some(plan=>hasRange(plan.plan)),'Older page must use the date range in its ordering index');
          assert.ok(result.deepPreviousPage.plans.some(plan=>hasRange(plan.plan)),'Newer page must use the date range in its ordering index');
        }
      }
      rows.push(result);
      console.log(`${mode} ${scale} ${scenario.name}: median ${result.httpMedianMs}ms p95 ${result.httpP95Ms}ms ${result.responseBytes} bytes SQL ${result.sqlQueriesMin}-${result.sqlQueriesMax}`);
    }
    assert.deepEqual(await fixture.counts(),before,'Read workload must preserve fictional source records');
    const transactions=await fixture.transactionState();assert.equal(transactions.idle_transactions,0);
    measurements.push({scale,dataset:fixture.dataset,clientFingerprint:fixture.clientFingerprint,sourceFingerprintsUnchanged:true,idleRuntimeTransactions:0,scenarios:rows});
    await writeSnapshot(false,`through-${scale}`);
    await cleanup();
  }
  await writeSnapshot(true,'complete');
} catch (error) {
  const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:'MEASUREMENT_FAILURE';
  const actual=typeof error?.actual==='number'?` actual=${error.actual}`:'';
  const expected=typeof error?.expected==='number'?` expected=${error.expected}`:'';
  const checks=['Older page must use the date range in its ordering index','Newer page must use the date range in its ordering index'];
  const check=checks.find(label=>typeof error?.message==='string'&&error.message.startsWith(label));
  let sourceFingerprintsUnchanged=null,idleRuntimeTransactions=null;
  if(fixture&&sourceBefore)try{sourceFingerprintsUnchanged=JSON.stringify(await fixture.counts())===JSON.stringify(sourceBefore);idleRuntimeTransactions=(await fixture.transactionState()).idle_transactions;}catch{/* unavailable evidence remains null */}
  const failure={schemaVersion:1,kind:'maintenance-capacity-failure',mode,stage,code,...(check?{check}:{}),sourceFingerprintsUnchanged,idleRuntimeTransactions,serverFingerprint};
  const output=join(tmpdir(),`propertyflow-maintenance-capacity-${mode}-${startedAt.replace(/\D/g,'')}-${serverFingerprint.slice(0,10)}-failure.json`);
  try{await writeFile(output,JSON.stringify(failure,null,2)+'\n',{mode:0o600,flag:'wx'});console.error(`Immutable sanitized failure report: ${output}`);}catch{console.error('Failure report could not be written.');}
  console.error(`Capacity measurement failed during ${stage} (${code}${actual}${expected}); no complete report published.`);process.exitCode=1;
} finally {await cleanup();}
