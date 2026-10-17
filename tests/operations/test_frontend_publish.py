import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]

class FrontendPublication(unittest.TestCase):
    def test_chunks_publish_before_html_and_old_chunks_survive(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);build=root/'dist';(build/'assets').mkdir(parents=True)
            (build/'index.html').write_text('<html></html>')
            (build/'assets'/'chunk-hash.js').write_text('export default 1')
            calls=root/'calls.jsonl';aws=root/'aws'
            aws.write_text('#!/usr/bin/env python3\nimport os,json,sys\nwith open(os.environ["TEST_AWS_CALLS"],"a") as f:f.write(json.dumps(sys.argv[1:])+"\\n")\n');aws.chmod(0o700)
            subprocess.run(['bash',str(ROOT/'scripts/deploy-frontend.sh'),str(build)],env={**os.environ,'PATH':str(root)+os.pathsep+os.environ['PATH'],'FRONTEND_BUCKET':'test-frontend','TEST_AWS_CALLS':str(calls)},check=True)
            chunks,maps,entry=[json.loads(line) for line in calls.read_text().splitlines()]
            self.assertEqual(chunks[:4],['s3','sync',str(build/'assets')+'/','s3://test-frontend/assets/'])
            self.assertNotIn('--delete',chunks)
            self.assertEqual(maps,['s3','rm','s3://test-frontend/assets/','--recursive','--exclude','*','--include','*.map'])
            self.assertEqual(entry[:4],['s3','sync',str(build)+'/','s3://test-frontend'])
            self.assertEqual(entry[entry.index('--exclude')+1],'assets/*')
            self.assertIn('--delete',entry)

if __name__=='__main__':unittest.main()
