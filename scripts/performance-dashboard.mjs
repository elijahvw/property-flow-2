// Builds a Grafana payload from explicit, bounded aggregate fields only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const workflows=['overview','properties','tenants','leases','lease','rent','deposits','maintenance'];
const numeric=(value,max=1e9)=>{assert.ok(Number.isFinite(value)&&value>=0&&value<=max,'Invalid aggregate');return value;};
export function performanceDashboard(reports) {
  assert.ok(reports.length>0 && reports.length<=10,'Supply 1–10 reports');
  const browser=[],api=[],runs=[];
  for(const r of reports) {
    assert.equal(r.schemaVersion,1);assert.equal(r.environment,'isolated-local');assert.match(r.label,/^[a-z0-9-]{1,40}$/);assert.match(r.revision,/^[a-f0-9]{7,40}$/);
    assert.ok(Number.isFinite(Date.parse(r.measuredAt)),'Invalid measured timestamp');
    assert.deepEqual(r.dataset,{properties:20,units:200,tenants:200,leases:200});
    assert.equal(r.load.vus,5);assert.equal(r.load.durationSeconds,20);assert.equal(typeof r.load.thresholdsPassed,'boolean');
    if(r.clientFingerprint)assert.match(r.clientFingerprint,/^[a-f0-9]{16}$/);
    const browserPassed=r.browser.every(row=>row.javascriptGzipBytes<135000 && row.maxMs<2500 && row.apiRequests<=6);
    runs.push({run:r.label,measuredAt:new Date(r.measuredAt).toISOString(),revision:r.revision+(r.sourceDirty?' + local changes':''),clientBuild:r.clientFingerprint||'not recorded',requests:numeric(r.load.requests),failedRate:numeric(r.load.failedRate,1),checks:numeric(r.load.checks,1),apiBudgets:r.load.thresholdsPassed?'Passed':'Failed',browserBudgets:browserPassed?'Passed':'Failed'});
    for(const [kind,target] of [['browser',browser],['api',api]]) {
      assert.equal(r[kind].length,workflows.length);
      assert.deepEqual([...new Set(r[kind].map(row=>row.workflow))].sort(),[...workflows].sort());
      for(const row of r[kind])target.push({run:r.label,workflow:row.workflow,...(kind==='browser'?{samples:numeric(row.samples,100),medianMs:numeric(row.medianMs),maxMs:numeric(row.maxMs),apiRequests:numeric(row.apiRequests),javascriptGzipKB:numeric(row.javascriptGzipBytes)/1000}:{p95Ms:numeric(row.p95Ms),medianMs:numeric(row.medianMs)})});
    }
  }
  const datasource={type:'yesoreyeram-infinity-datasource',uid:'grafanacloud-infinity'};
  const target=(rows)=>({refId:'A',datasource,type:'json',source:'inline',format:'table',parser:'backend',root_selector:'',data:JSON.stringify(rows),columns:Object.keys(rows[0]).map(key=>({selector:key,text:key,type:typeof rows[0][key]==='number'?'number':'string'}))});
  const comparison=(rows,key)=>workflows.map(workflow=>({workflow,...Object.fromEntries(reports.map(r=>[r.label,rows.find(row=>row.workflow===workflow&&row.run===r.label)?.[key]]))}));
  const panel=(id,title,rows,x,y,w,h,type='table',unit='short')=>({id,title,type,datasource,gridPos:{x,y,w,h},targets:[target(rows)],options:type==='barchart'?{xField:'workflow',orientation:'horizontal',showValue:'auto',legend:{displayMode:'list',placement:'bottom'}}:{showHeader:true},fieldConfig:{defaults:{unit,decimals:1},overrides:[]}});
  return {
    uid:'propertyflow-local-performance',title:'Property Flow · Local workflow performance',schemaVersion:39,tags:['propertyflow','local-performance'],timezone:'utc',editable:true,refresh:'',time:{from:'now-24h',to:'now'},
    panels:[
      {id:1,title:'Repeatable local baseline',type:'text',gridPos:{x:0,y:0,w:24,h:5},options:{mode:'markdown',content:'Real production-client and API measurements against a fresh loopback-only PostgreSQL database. **20 properties, 200 units, tenants and leases.** k6: 5 concurrent users × 20 seconds, eight management reads per iteration. Browser: 5 fresh desktop contexts per screen. API budgets: p95 <750 ms, p99 <1,500 ms; zero failed requests/checks.\n\nThese are **saved run snapshots**, independent of the dashboard time picker; publish a new report after rerunning. They measure local fixtures, not deployed capacity, Auth0, payment processing or an internet connection. JavaScript sizes are gzip estimates of the scripts actually fetched. No private records, URLs, cookies, tokens, forms or response bodies are uploaded.'}},
      panel(2,'Recorded runs and correctness gates',runs,0,5,24,6),
      panel(3,'JavaScript loaded per screen (gzip KB)',comparison(browser,'javascriptGzipKB'),0,11,12,12,'barchart','kbytes'),
      panel(4,'Time to rendered view · median of 5 (ms)',comparison(browser,'medianMs'),12,11,12,12,'barchart','ms'),
      panel(5,'API latency under 5 concurrent users · p95 (ms)',comparison(api,'p95Ms'),0,23,12,12,'barchart','ms'),
      panel(6,'Business API requests per cold navigation',comparison(browser,'apiRequests'),12,23,12,12,'barchart'),
      panel(7,'Browser measurement details',browser,0,35,24,10),
      panel(8,'API measurement details',api,0,45,24,10),
    ],
  };
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const reports=await Promise.all(process.argv.slice(2).map(async file=>JSON.parse(await readFile(file,'utf8'))));
  console.log(JSON.stringify(performanceDashboard(reports),null,2));
}
