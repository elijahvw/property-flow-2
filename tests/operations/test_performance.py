"""The performance runner must never accept a preview/cloud database or leak records."""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]

class PerformanceContracts(unittest.TestCase):
    def test_dashboard_accepts_only_aggregate_fields(self):
        script = '''
import {performanceDashboard} from './scripts/performance-dashboard.mjs';
const names=['overview','properties','tenants','leases','lease','rent','deposits','maintenance'];
const report={schemaVersion:1,environment:'isolated-local',label:'test',revision:'abcdef0',measuredAt:'2026-10-17T12:00:00Z',dataset:{properties:20,units:200,tenants:200,leases:200},load:{vus:5,durationSeconds:20,requests:100,failedRate:0,checks:1,thresholdsPassed:true},browser:names.map(workflow=>({workflow,samples:5,medianMs:10,maxMs:20,apiRequests:2,javascriptGzipBytes:1000,privateName:'PRIVATE-SENTINEL'})),api:names.map(workflow=>({workflow,p95Ms:15,medianMs:10,token:'SECRET-SENTINEL'})),session:'COOKIE-SENTINEL'};
const dashboard=performanceDashboard([report]);
const text=JSON.stringify(dashboard);if(/SENTINEL/.test(text))throw Error('private data leaked');
for(const invalid of [{...report,environment:'dev'},{...report,label:'https://customer.example'},{...report,browser:[]},{...report,load:{...report.load,failedRate:NaN}}]){let rejected=false;try{performanceDashboard([invalid]);}catch{rejected=true;}if(!rejected)throw Error('unsafe report accepted');}
console.log(JSON.stringify({uid:dashboard.uid,panels:dashboard.panels.length}));
'''
        result = subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(result.stdout),{'uid':'propertyflow-local-performance','panels':8})

    def test_rejects_external_targets_before_starting_resources(self):
        for args in [['https://propertyflow.saasapps.cloud'],['local','--database-url','postgres://preview.invalid']]:
            result=subprocess.run(['node','scripts/test-performance.mjs',*args],cwd=ROOT,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertNotIn('Performance fixture:',result.stdout)

if __name__=='__main__': unittest.main()
