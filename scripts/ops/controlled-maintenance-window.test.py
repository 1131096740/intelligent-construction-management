import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('window', Path(__file__).with_name('controlled-maintenance-window.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class WindowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.files = {
            m.CRON_PATHS[0]: b'# keep\n30 2 * * * /root/old-backup\n7 * * * * /root/unrelated\n',
            m.CRON_PATHS[1]: b'0 3 * * * root /root/daily\n30 3 1 * * root /root/monthly\n'}
        self.cron = self.files[m.CRON_PATHS[0]]
        self.calls = []; self.failure = None; self.active = False
        self.plan = {'candidateSha':'a'*40, 'runId':'fixture', 'machineIdentitySha256':'b'*64, 'cronBindings':{
            m.CRON_PATHS[0]: {'fileSha256':m.digest(self.files[m.CRON_PATHS[0]]), 'commandSha256':[m.digest(b'/root/old-backup')]},
            m.CRON_PATHS[1]: {'fileSha256':m.digest(self.files[m.CRON_PATHS[1]]), 'commandSha256':[m.digest(b'/root/daily'),m.digest(b'/root/monthly')]}}}
        self.window = m.Window(self.plan, self.command, self.read, self.write, Path(self.temp.name)/'state', '/run/controlled')
    def command(self, argv, payload=None):
        self.calls.append(argv)
        if self.failure and argv[:2] == self.failure: raise ValueError('injected command failure')
        if argv[0]=='crontab':
            if argv[-1]=='-': self.cron=payload; return b''
            return self.cron
        if argv[:2]==['systemctl','show']:
            active=b'active' if self.active else b'inactive'
            if argv[2].endswith('.timer') or argv[-1]=='--property=ActiveState': return b'ActiveState='+active+b'\n'
            return b'ActiveState='+active+b'\nMainPID=0\nControlPID=0\nControlGroup=\nKillMode=control-group\n'
        return b''
    def read(self,path):
        if path not in self.files: raise FileNotFoundError(path)
        return self.files[path], {'uid':0,'gid':0,'mode':0o600}
    def write(self,path,raw,meta):
        if raw is None: del self.files[path]
        else: self.files[path]=raw
    def held(self): self.window.capture(); self.window.hold()
    def test_three_schedules_preserved_and_no_start_commands(self):
        self.held()
        self.assertIn(b'# controlled-launch:fixture 30 2 * * * /root/old-backup',self.cron)
        self.assertIn(b'7 * * * * /root/unrelated\n',self.cron)
        stops=[a[2]for a in self.calls if a[:2]==['systemctl','stop']]
        self.assertTrue(all(x.endswith('.timer')for x in stops[:2]))
        self.assertEqual(len(stops),5)
        self.assertFalse(any('restart' in a or 'start' in a for a in self.calls))
    def test_explicit_matching_restore_no_service_start(self):
        before=dict(self.files); self.held()
        pin=m.digest((self.window.state/'journal.json').read_bytes())
        self.window.restore_controls(pin)
        self.assertEqual(self.cron,before[m.CRON_PATHS[0]])
        self.assertEqual(self.files,before)
        self.assertFalse(any('start' in a for a in self.calls))
    def test_missing_binding_refused_without_state(self):
        self.files[m.CRON_PATHS[1]]+=b'30 3 1 * * root /root/monthly\n'
        with self.assertRaisesRegex(ValueError,'drift'):self.window.capture()
        self.assertFalse(self.window.state.exists())
    def test_duplicate_matching_line_not_accepted(self):
        with self.assertRaisesRegex(ValueError,'repeated'):
            m.isolate_cron(b'0 3 * * * root /x\n0 3 * * * root /x\n',[m.digest(b'/x')],True,'fixture')
    def test_capture_is_exclusive(self):
        self.window.capture()
        with self.assertRaises(FileExistsError):self.window.capture()
    def test_changed_root_cron_prevents_any_hold_write(self):
        self.window.capture(); self.cron+=b'# unknown\n'; before=dict(self.files)
        with self.assertRaisesRegex(ValueError,'changed'):self.window.hold()
        self.assertEqual(self.files,before)
    def test_logical_crontab_drift_between_reads_refuses_capture(self):
        self.cron+=b'# changed during read\n'
        with self.assertRaises(ValueError):self.window.capture()
        self.assertFalse(self.window.state.exists())
    def test_missing_or_unknown_journal_target_refused_before_any_hold(self):
        import json
        self.window.capture();path=self.window.state/'journal.json'
        original=json.loads(path.read_bytes())
        for modify in [lambda d:d.update(records=[]),lambda d:d['records'][0].update(path='/unknown')]:
            data=json.loads(json.dumps(original));modify(data);path.write_text(json.dumps(data))
            calls=len(self.calls)
            with self.assertRaises(ValueError):self.window.hold()
            self.assertEqual(len(self.calls),calls)
    def test_failed_stop_preserves_hold_no_retry_or_release(self):
        self.window.capture(); self.failure=['systemctl','stop']
        with self.assertRaisesRegex(ValueError,'injected'):self.window.hold()
        self.assertEqual(sum(a[:2]==['systemctl','stop']for a in self.calls),1)
        self.assertIn(b'controlled-launch',self.cron)
        self.assertEqual(self.window.load()['state'],'holding')
    def test_active_writer_invalidates_observation(self):
        self.held(); self.active=True
        with self.assertRaisesRegex(ValueError,'drained'):self.window.observe()
    def test_cgroup_child_invalidates_observation(self):
        self.held(); self.files['/sys/fs/cgroup/system.slice/jiangkong-api.service/cgroup.procs']=b'99\n'
        with self.assertRaisesRegex(ValueError,'child processes'):self.window.observe()
    def test_unknown_start_allowance_invalidates_hold(self):
        self.held();self.files['/run/controlled/fixture/jiangkong-api.service.allow']=b''
        with self.assertRaisesRegex(ValueError,'allowance'):self.window.observe()
    def test_unknown_dropin_blocks_capture(self):
        self.files['/run/systemd/system/jiangkong-api.service.d/90-jiangkong-controlled-hold.conf']=b'unknown'
        with self.assertRaisesRegex(ValueError,'existing'):self.window.capture()
    def test_wrong_journal_or_drift_refuses_restore_before_release(self):
        self.held(); old=dict(self.files)
        with self.assertRaisesRegex(ValueError,'journal'):self.window.restore_controls('0'*64)
        self.assertEqual(old,self.files)
        pin=m.digest((self.window.state/'journal.json').read_bytes());self.cron+=b'unknown'
        with self.assertRaisesRegex(ValueError,'drift'):self.window.restore_controls(pin)
        self.assertEqual(old,self.files)
    def test_plan_is_not_a_mutable_authorization_reference(self):
        self.plan['cronBindings'][m.CRON_PATHS[0]]['commandSha256'][0]='0'*64
        self.held()
    def test_duplicate_or_invalid_freeze_keys_refused(self):
        for raw in [b'OPERATIONAL_WRITE_FREEZE_MODE=off',b'OPERATIONAL_WRITE_FREEZE_MODE=all\nOPERATIONAL_WRITE_FREEZE_MODE=all',b'OPERATIONAL_WRITE_FREEZE_MODE=all\nOPERATIONAL_WRITE_FREEZE_MODULES=contract']:
            with self.assertRaises(ValueError):m.assert_all_frozen(raw)
    def test_owned_preview_only_allows_api_and_ends_with_stop(self):
        self.held();self.window.allow_api_preview()
        self.assertEqual(self.window.load()['state'],'api-preview-allowed')
        self.assertTrue('/run/controlled/fixture/jiangkong-api.service.allow' in self.files)
        self.window.observe()
        pin=m.digest((self.window.state/'journal.json').read_bytes())
        with self.assertRaisesRegex(ValueError,'end preview'):self.window.restore_controls(pin)
        self.window.end_api_preview()
        self.assertEqual(self.window.load()['state'],'os-sources-held')
        self.assertNotIn('/run/controlled/fixture/jiangkong-api.service.allow',self.files)

if __name__=='__main__':unittest.main()
