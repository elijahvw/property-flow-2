#!/usr/bin/env python3
"""Publish only bounded performance aggregates to the dedicated Grafana dashboard."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('monitoring',ROOT/'scripts/grafana-monitoring.py')
monitoring=importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitoring)

def publish(paths,api):
    # The JS generator reconstructs every exported field and rejects other targets.
    result=subprocess.run(['node',str(ROOT/'scripts/performance-dashboard.mjs'),*paths],capture_output=True,text=True,check=True)
    dashboard=json.loads(result.stdout)
    assert dashboard['uid']=='propertyflow-local-performance'
    current=api.request('GET','/api/dashboards/uid/propertyflow-local-performance',missing=True)
    if current:
        if current['meta'].get('folderUid')!='propertyflow-dev':
            raise monitoring.SafeFailure('Performance dashboard moved folders; review before replacing it.')
        dashboard.update(id=current['dashboard']['id'],version=current['dashboard']['version'])
    api.request('POST','/api/dashboards/db',{'dashboard':dashboard,'folderUid':'propertyflow-dev','overwrite':True,'message':'Publish isolated local workflow performance measurements'})
    # Actual backend query verification, including Infinity's inline parser.
    for panel in dashboard['panels']:
        if not panel.get('targets'):continue
        response=api.request('POST','/api/ds/query',{'queries':panel['targets'],'from':'now-1h','to':'now'})
        rows=response.get('results',{}).get('A',{})
        if rows.get('error') or not rows.get('frames'):
            raise monitoring.SafeFailure('Saved performance panel failed query verification.')
    print('Published and verified https://slimpillar2069.grafana.net/d/propertyflow-local-performance')

if __name__=='__main__':
    try:
        publish(sys.argv[1:],monitoring.Grafana())
    except (monitoring.SafeFailure,AssertionError,subprocess.CalledProcessError,ValueError):
        sys.exit('Performance publication failed; no credentials or API bodies were logged.')
