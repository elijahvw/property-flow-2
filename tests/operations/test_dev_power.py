import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MOCK_AWS = r'''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
p=Path(os.environ['MOCK_STATE']); state=json.loads(p.read_text())
log=Path(os.environ['MOCK_LOG'])
with log.open('a') as out: out.write(json.dumps(args)+'\n')
if args[:2]==['sts','get-caller-identity']: print(state.get('account','800754316001'))
elif args[:2]==['ecs','describe-services']:
    if 'status' in args[args.index('--query')+1]: print(state.get('service','ACTIVE'))
    else: print(f"{state['count']}\t{state['count']}\t0")
elif args[:2]==['ecs','update-service']: state['count']=int(args[args.index('--desired-count')+1])
elif args[:3]==['ecs','wait','services-stable']:
    if state.get('ecs_wait_fail'): sys.exit(1)
elif args[:2]==['rds','describe-db-instances']:
    if state.get('db_error'):
        print('An error occurred ('+state['db_error']+') when calling DescribeDBInstances',file=sys.stderr); sys.exit(1)
    queue=state.get('statuses',[])
    if queue: state['db']=queue.pop(0)
    print(state['db'])
elif args[:2]==['rds','start-db-instance']:
    if not state.get('db_start_stuck'): state['db']='available'
elif args[:2]==['rds','stop-db-instance']: state['db']='stopped'
else: raise RuntimeError(args)
p.write_text(json.dumps(state))
'''

class DevPowerTests(unittest.TestCase):
    def run_power(self, action, *arguments, **state):
        with tempfile.TemporaryDirectory() as directory:
            temp=Path(directory)
            (temp/'aws').write_text(MOCK_AWS); (temp/'aws').chmod(0o755)
            (temp/'state').write_text(json.dumps({'db':'available','count':1,**state}))
            (temp/'log').touch()
            env={**os.environ,'PATH':str(temp)+os.pathsep+os.environ['PATH'],
                 'MOCK_STATE':str(temp/'state'),'MOCK_LOG':str(temp/'log'),
                 'DB_WAIT_ATTEMPTS':'2','DB_WAIT_SECONDS':'0'}
            result=subprocess.run(['bash',str(ROOT/'scripts/dev-power.sh'),action,*arguments],env=env,capture_output=True,text=True)
            calls=[json.loads(line) for line in (temp/'log').read_text().splitlines()]
            final=json.loads((temp/'state').read_text())
            return result,calls,final

    def test_start_database_before_backend(self):
        result,calls,state=self.run_power('start',db='stopped',count=0)
        self.assertEqual(result.returncode,0,result.stderr)
        keys=[call[:2] for call in calls]
        self.assertLess(keys.index(['rds','start-db-instance']),keys.index(['ecs','update-service']))
        # A database availability check follows its start and precedes ECS startup.
        between=keys[keys.index(['rds','start-db-instance'])+1:keys.index(['ecs','update-service'])]
        self.assertIn(['rds','describe-db-instances'],between)
        self.assertEqual((state['db'],state['count']),('available',1))

    def test_stop_backend_before_database(self):
        result,calls,state=self.run_power('stop')
        self.assertEqual(result.returncode,0,result.stderr)
        keys=[call[:2] for call in calls]
        self.assertLess(keys.index(['ecs','update-service']),keys.index(['rds','stop-db-instance']))
        self.assertLess(next(i for i,c in enumerate(calls) if c[:3]==['ecs','wait','services-stable']),keys.index(['rds','stop-db-instance']))
        self.assertEqual((state['db'],state['count']),('stopped',0))

    def test_already_started_does_not_restart_database(self):
        result,calls,state=self.run_power('start')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn(['rds','start-db-instance'],[c[:2] for c in calls])

    def test_already_stopped_does_not_stop_database_again(self):
        result,calls,state=self.run_power('stop',db='stopped',count=0)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn(['rds','stop-db-instance'],[c[:2] for c in calls])

    def test_wrong_account_makes_no_changes(self):
        result,calls,state=self.run_power('stop',account='462993244299')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(len(calls),1)

    def test_backend_failure_leaves_database_running(self):
        result,calls,state=self.run_power('stop',ecs_wait_fail=True)
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn(['rds','stop-db-instance'],[c[:2] for c in calls])
        self.assertEqual(state['db'],'available')

    def test_database_timeout_does_not_start_backend(self):
        result,calls,state=self.run_power('start',db='stopped',count=0,db_start_stuck=True)
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn(['ecs','update-service'],[c[:2] for c in calls])

    def test_missing_service_makes_no_changes(self):
        result,calls,state=self.run_power('start',service='None',db='stopped',count=0)
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn(['rds','start-db-instance'],[c[:2] for c in calls])

    def test_start_during_shutdown_waits_then_restarts(self):
        result,calls,state=self.run_power('start',db='stopping',count=0,statuses=['stopping','stopped'])
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((state['db'],state['count']),('available',1))

    def test_deployment_database_start_does_not_require_or_start_ecs(self):
        result,calls,state=self.run_power('start-database',db='stopped',count=0,service='None')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((state['db'],state['count']),('available',0))
        self.assertFalse(any(c[0]=='ecs' for c in calls))

    def test_first_deployment_allows_missing_database(self):
        result,calls,state=self.run_power('start-database','--allow-missing',db_error='DBInstanceNotFound')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(len(calls),2)

    def test_skipped_terraform_requires_existing_database(self):
        result,calls,state=self.run_power('start-database',db_error='DBInstanceNotFound')
        self.assertNotEqual(result.returncode,0)

    def test_first_deployment_does_not_hide_permission_failure(self):
        result,calls,state=self.run_power('start-database','--allow-missing',db_error='AccessDenied')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('AccessDenied',result.stderr)

    def test_deployment_database_timeout_fails(self):
        result,calls,state=self.run_power('start-database',db='stopped',db_start_stuck=True)
        self.assertNotEqual(result.returncode,0)

    def test_existing_backup_finishes_before_startup_without_database_restart(self):
        for action in ('start', 'start-database'):
            with self.subTest(action=action):
                result,calls,state=self.run_power(action,count=0,statuses=['backing-up','backing-up','available'])
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertIn('currently backing-up',result.stdout)
                self.assertNotIn(['rds','start-db-instance'],[c[:2] for c in calls])
                if action=='start':
                    index=next(i for i,c in enumerate(calls) if c[:2]==['ecs','update-service'])
                    self.assertEqual(calls[index-1][:2],['rds','describe-db-instances'])
                    self.assertEqual(state['count'],1)
                else:
                    self.assertFalse(any(c[0]=='ecs' for c in calls))

    def test_backup_during_database_start_is_a_waitable_state(self):
        result,calls,state=self.run_power('start-database',count=0,statuses=['stopped','backing-up','available'])
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([c[:2] for c in calls].count(['rds','start-db-instance']),1)
        self.assertIn('currently backing-up',result.stdout)

    def test_persistent_backup_times_out_without_starting_database_or_backend(self):
        for action in ('start','start-database'):
            with self.subTest(action=action):
                result,calls,state=self.run_power(action,db='backing-up',count=0)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('within the wait limit',result.stderr)
                self.assertFalse(any(c[:2] in (['rds','start-db-instance'],['ecs','update-service']) for c in calls))

    def test_stop_waits_for_backup_before_stopping_database(self):
        result,calls,state=self.run_power('stop',statuses=['backing-up','backing-up','available'])
        self.assertEqual(result.returncode,0,result.stderr)
        index=next(i for i,c in enumerate(calls) if c[:2]==['rds','stop-db-instance'])
        self.assertEqual(calls[index-1][:2],['rds','describe-db-instances'])
        self.assertEqual((state['db'],state['count']),('stopped',0))

    def test_stop_does_not_interrupt_a_persistent_backup(self):
        result,calls,state=self.run_power('stop',db='backing-up')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('within the wait limit',result.stderr)
        self.assertNotIn(['rds','stop-db-instance'],[c[:2] for c in calls])

    def test_unhealthy_or_unknown_state_still_fails_closed(self):
        for status in ('failed','incompatible-restore','unrecognized'):
            with self.subTest(status=status):
                result,calls,state=self.run_power('start-database',statuses=['backing-up',status])
                self.assertNotEqual(result.returncode,0)
                self.assertIn('Unexpected database state: '+status,result.stderr)
                self.assertFalse(any(c[:2]==['rds','start-db-instance'] for c in calls))

    def test_existing_monitoring_configuration_finishes_before_startup(self):
        for action in ('start','start-database'):
            with self.subTest(action=action):
                result,calls,state=self.run_power(action,count=0,statuses=[
                    'configuring-enhanced-monitoring','configuring-enhanced-monitoring','available'])
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertIn('currently configuring-enhanced-monitoring',result.stdout)
                self.assertNotIn(['rds','start-db-instance'],[c[:2] for c in calls])
                if action=='start':
                    index=next(i for i,c in enumerate(calls) if c[:2]==['ecs','update-service'])
                    self.assertEqual(calls[index-1][:2],['rds','describe-db-instances'])
                    self.assertEqual(state['count'],1)
                else:
                    self.assertFalse(any(c[0]=='ecs' for c in calls))

    def test_monitoring_configuration_during_start_does_not_repeat_start(self):
        for action in ('start','start-database'):
            with self.subTest(action=action):
                result,calls,state=self.run_power(action,count=0,statuses=[
                    'stopped','configuring-enhanced-monitoring','available'])
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual([c[:2] for c in calls].count(['rds','start-db-instance']),1)
                self.assertIn('currently configuring-enhanced-monitoring',result.stdout)
                self.assertEqual(state['db'],'available')
                if action=='start':
                    self.assertEqual(state['count'],1)
                else:
                    self.assertFalse(any(c[0]=='ecs' for c in calls))

    def test_stop_waits_for_monitoring_configuration_after_backend_shutdown(self):
        result,calls,state=self.run_power('stop',statuses=[
            'configuring-enhanced-monitoring','configuring-enhanced-monitoring','available'])
        self.assertEqual(result.returncode,0,result.stderr)
        index=next(i for i,c in enumerate(calls) if c[:2]==['rds','stop-db-instance'])
        backend_stable=next(i for i,c in enumerate(calls) if c[:3]==['ecs','wait','services-stable'])
        self.assertLess(backend_stable,index)
        self.assertEqual(calls[index-1][:2],['rds','describe-db-instances'])
        self.assertEqual((state['db'],state['count']),('stopped',0))

    def test_monitoring_configuration_during_stop_does_not_repeat_stop(self):
        result,calls,state=self.run_power('stop',statuses=[
            'available','configuring-enhanced-monitoring','stopped'])
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([c[:2] for c in calls].count(['rds','stop-db-instance']),1)
        self.assertIn('currently configuring-enhanced-monitoring',result.stdout)
        self.assertEqual((state['db'],state['count']),('stopped',0))

    def test_monitoring_configuration_during_shutdown_then_start(self):
        result,calls,state=self.run_power('start',count=0,statuses=[
            'stopping','configuring-enhanced-monitoring','stopped'])
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([c[:2] for c in calls].count(['rds','start-db-instance']),1)
        self.assertEqual((state['db'],state['count']),('available',1))

    def test_persistent_monitoring_configuration_times_out_without_database_changes(self):
        for action in ('start','start-database','stop'):
            with self.subTest(action=action):
                result,calls,state=self.run_power(action,db='configuring-enhanced-monitoring',count=0)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('within the wait limit',result.stderr)
                self.assertEqual([c[:2] for c in calls].count(['rds','describe-db-instances']),3)
                self.assertFalse(any(c[:2] in (['rds','start-db-instance'],['rds','stop-db-instance']) for c in calls))
                self.assertEqual(state['count'],0)
                if action!='stop':
                    self.assertFalse(any(c[:2]==['ecs','update-service'] for c in calls))

    def test_monitoring_transition_to_failure_or_unknown_state_fails_closed(self):
        for action in ('start','start-database','stop'):
            for status in ('failed','incompatible-restore','configuring-unrecognized'):
                with self.subTest(action=action,status=status):
                    result,calls,state=self.run_power(action,count=0,statuses=[
                        'configuring-enhanced-monitoring',status])
                    self.assertNotEqual(result.returncode,0)
                    self.assertIn('Unexpected database state: '+status,result.stderr)
                    self.assertFalse(any(c[:2] in (['rds','start-db-instance'],['rds','stop-db-instance']) for c in calls))
                    self.assertEqual(state['count'],0)

if __name__=='__main__': unittest.main()

