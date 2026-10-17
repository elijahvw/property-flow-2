import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// This file never accepts an arbitrary URL. The runner creates this private file
// only after verifying a new empty, loopback-only tmpfs database.
const fixture=JSON.parse(open(__ENV.PF_PERFORMANCE_FIXTURE));
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin) || fixture.marker!=='fresh-tmpfs-performance-v1')throw Error('Use scripts/test-performance.mjs');
const duration=new Trend('workflow_api_duration',true);
const routes=[
 ['overview','/api/company/overview'],
 ['properties','/api/company/properties'],
 ['tenants','/api/company/resident-profiles'],
 ['leases','/api/company/leases'],
 ['lease','/api/company/leases/perf-lease-1'],
 ['rent','/api/company/rent'],
 ['deposits','/api/company/deposits'],
 ['maintenance','/api/company/maintenance'],
];
export const options={
  scenarios:{management:{executor:'constant-vus',vus:5,duration:'20s',gracefulStop:'5s'}},
  // Fixed route names only: no cookies, request URLs/IDs or response bodies exported.
  systemTags:['name','method','status','scenario','expected_response'],
  tags:{service:'propertyflow',environment:'local-performance'},
  summaryTrendStats:['avg','min','med','max','p(90)','p(95)','p(99)'],
  thresholds:{checks:['rate==1'],http_req_failed:['rate==0'],workflow_api_duration:['p(95)<750','p(99)<1500'],...Object.fromEntries(routes.map(([name])=>[`workflow_api_duration{workflow:${name}}`,['p(95)<750']]))},
};
export default function() {
  for(const [name,path] of routes) {
    const response=http.get(fixture.origin+path,{headers:{Cookie:`pf-session=${fixture.token}`},redirects:0,tags:{name,workflow:name},timeout:'5s'});
    check(response,{[`${name} returns JSON`]:r=>r.status===200 && (r.headers['Content-Type']||'').includes('application/json')});
    duration.add(response.timings.duration,{workflow:name});
  }
  sleep(.25);
}
export function handleSummary(data) {return {[__ENV.PF_PERFORMANCE_SUMMARY]:JSON.stringify(data)};}
