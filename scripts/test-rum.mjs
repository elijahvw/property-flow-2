// Real SDK/wire check. Every browser request is intercepted; no preview database,
// Grafana collector, Auth0 account or external network is used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const root = fileURLToPath(new URL('../client/dist/', import.meta.url));
const index = await readFile(root+'index.html','utf8');
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  const batches = [], requests = [];
  await page.route('**/*', async route => {
    const request=route.request(), url=new URL(request.url());
    requests.push({url:request.url(),headers:request.headers()});
    if(url.hostname==='faro-collector-prod-us-east-3.grafana.net') {
      assert.equal(request.method(),'POST');
      batches.push(JSON.parse(request.postData()));
      return route.fulfill({status:202,body:'{}',headers:{'access-control-allow-origin':'*'}});
    }
    if(url.hostname==='app.test' && url.pathname.startsWith('/assets/')) {
      const filename=url.pathname.split('/').pop();
      assert.match(filename,/^[a-zA-Z0-9_-]+\.(js|css)$/);
      return route.fulfill({body:await readFile(root+'assets/'+filename),contentType:filename.endsWith('.css')?'text/css':'text/javascript'});
    }
    if(url.hostname==='app.test' && !url.pathname.startsWith('/api/')) return route.fulfill({body:index,contentType:'text/html'});
    return route.fulfill({status:url.pathname==='/api/bootstrap'?401:503,body:'{"error":"private-wire-sentinel"}',contentType:'application/json',headers:{'access-control-allow-origin':'*'}});
  });
  await page.goto('https://app.test/invite?contact=1#private-wire-sentinel');
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>entry.name.includes('/assets/rum-')));
  // Wait for dynamic module evaluation, not merely its resource download.
  await page.waitForFunction(()=>performance.getEntriesByType('resource').some(entry=>entry.name.includes('/collect/')), undefined, {timeout:20000});
  await page.evaluate(async()=>{
    console.error('private-wire-sentinel');
    window.dispatchEvent(new ErrorEvent('error',{error:new TypeError('private-wire-sentinel'),message:'private-wire-sentinel'}));
    await fetch('/api/company/properties/private-wire-sentinel?q=private-wire-sentinel');
    await fetch('/api/auth/login?token=private-wire-sentinel');
    await fetch('https://external.test/api/private-wire-sentinel');
    history.pushState({},'', '/company/maintenance/private-wire-sentinel?q=private-wire-sentinel');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(12000);
  const wire=JSON.stringify(batches);
  assert.ok(batches.length,'SDK emitted actual collector batches');
  assert.doesNotMatch(wire,/private-wire-sentinel|pf-invitation|console\.error|isSampled/);
  assert.match(wire,/web-vitals/);
  assert.match(wire,/Browser TypeError/);
  assert.match(wire,/\/company\/maintenance\/:id/);
  assert.match(wire,/resourceSpans/);
  assert.match(wire,/faro\.tracing\.fetch/);
  const business=requests.find(row=>row.url.includes('/api/company/properties/private-wire-sentinel'));
  assert.match(business.headers.traceparent,/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  for(const row of requests.filter(row=>row.url.includes('/api/auth/login') || row.url.includes('external.test') || row.url.includes('/collect/'))) assert.equal(row.headers.traceparent,undefined,'trace headers stay on business API requests');
  console.log('PASS: real Faro SDK emits sanitized sessions, views, Web Vitals, errors, API timings and traces; business API correlation excludes auth, third parties and collector requests.');
} finally { await browser.close(); }
