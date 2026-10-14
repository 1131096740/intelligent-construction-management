import importlib.util
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import json
import contextlib
import io
spec=importlib.util.spec_from_file_location('preflight',Path(__file__).with_name('controlled-launch-preflight.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class PreflightTests(unittest.TestCase):
    def test_backup_script_selection_ignores_lock_and_attached_redirect(self):
        command='/usr/bin/flock -n /run/backup.lock /usr/local/sbin/fixture-backup.sh >>/var/log/backup-output 2>&1'
        self.assertEqual(m.backup_entry_path(command),'/usr/local/sbin/fixture-backup.sh')
        for raw in ['/usr/local/sbin/first-backup.sh /usr/local/sbin/second-backup.sh','/usr/local/sbin/../fixture-backup.sh','bash -c "$(cat /private/secret)"','/root/fixture-backup.sh']:
            with self.assertRaises(ValueError):m.backup_entry_path(raw)
    def test_exact_existing_legacy_and_offsite_installation_paths(self):
        self.assertEqual(m.backup_entry_path('/usr/local/bin/jiangkong-backup >>/var/log/backup 2>&1'),'/usr/local/bin/jiangkong-backup')
        self.assertEqual(m.backup_entry_path('/usr/local/lib/jiangkong-offsite-backup/run-production-db-backup.sh'),'/usr/local/lib/jiangkong-offsite-backup/run-production-db-backup.sh')
        for raw in ['/usr/local/bin/unknown-backup','/usr/local/lib/other/backup.sh']:
            with self.assertRaises(ValueError):m.backup_entry_path(raw)
    def test_partial_metadata_retained_without_turning_failure_into_success(self):
        def fail():
            m.OBSERVATIONS={'permissions':{'backupRole':None},'migrations':[]};m.phase('three-cron-bindings');raise ValueError('backup executable path ambiguous')
        output=io.StringIO()
        with patch.object(m,'main',side_effect=fail),contextlib.redirect_stdout(output):self.assertEqual(m.run_once(),1)
        data=json.loads(output.getvalue());self.assertEqual(data['status'],'stopped-readonly-gaps');self.assertEqual(data['reasonCode'],'entry-ambiguous');self.assertEqual(data['partialObservations']['permissions'],{'backupRole':None})
    def test_failed_phase_is_safe_and_no_retry(self):
        calls=[]
        def fail():
            calls.append(1);m.phase('database-permission-metadata');raise OSError('fixture PRIVATE_PASSWORD backend diagnostic')
        output=io.StringIO()
        with patch.object(m,'main',side_effect=fail),contextlib.redirect_stdout(output):self.assertEqual(m.run_once(),1)
        data=json.loads(output.getvalue());self.assertEqual(data['phase'],'database-permission-metadata');self.assertEqual(data['errorCategory'],'file-access');self.assertEqual(len(calls),1)
        self.assertNotIn('PRIVATE_PASSWORD',output.getvalue())
    def test_fd_read_refuses_link_and_preserves_actual_digest(self):
        with tempfile.TemporaryDirectory() as root:
            file=Path(root)/'source';file.write_bytes(b'fixture');file.chmod(0o600)
            raw,meta=m.read(str(file));self.assertEqual(raw,b'fixture');self.assertEqual(meta['sha256'],m.digest(b'fixture'))
            link=Path(root)/'link';link.symlink_to(file)
            with self.assertRaises(OSError):m.read(str(link))
    def test_readonly_queries_and_no_secret_environment_or_raw_exec_output(self):
        commands=[];sources={p:b'# fixture\n'for p in m.CRON};pins={}
        for i,path in enumerate(sources):
            count=1 if path.endswith('/root')else 2;hashes=[]
            for j in range(count):
                command='/usr/bin/flock -n /run/fixture-backup.lock /usr/local/sbin/fixture-backup-'+str(i)+'-'+str(j)+'.sh >>/var/log/fixture-backup-output 2>&1'
                line='30 2 * * * '+('' if path.endswith('/root')else 'root ')+command
                sources[path]+=line.encode()+b'\n';hashes.append(m.digest(command.encode()))
            pins[path]=hashes
        def read(path):
            raw=b'fixture-machine' if path=='/etc/machine-id' else sources.get(path,b'fixture bytes')
            return raw,{'path':path,'uid':0,'gid':0,'mode':0o600,'sha256':m.digest(raw)}
        def run(argv,**kwargs):
            commands.append(argv)
            self.assertFalse(any('PASSWORD' in k or k.startswith('PG')for k in kwargs['env']))
            if argv[0]=='runuser':
                sql=kwargs['input'].decode();self.assertIn('BEGIN READ ONLY',sql)
                self.assertNotIn('pg_authid',sql)
                if 'pg_control_system()'in sql:data={'database':'fixture','version':160014,'hba':'/etc/postgresql/16/main/pg_hba.conf'}
                elif '_prisma_migrations'in sql:data=[]
                else:data={'backupRole':None,'helper':{'owner':'fixture-owner','acl':None,'definitionSha256':'a'*64},'defaultPrivileges':[],'creators':['fixture-owner']}
                return types.SimpleNamespace(returncode=0,stdout=json.dumps(data).encode())
            return types.SimpleNamespace(returncode=0,stdout=b'Id=fixture\nActiveState=inactive\nExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node /srv/jiangkong/apps/api/dist/main.js ; }\n')
        original_lstat=m.os.lstat
        def lstat(path):
            if str(path).startswith('/etc/jiangkong/'):raise FileNotFoundError(path)
            if str(path)=='/etc/postgresql/16/main/pg_hba.conf':return types.SimpleNamespace(st_mode=0o100600,st_nlink=1,st_uid=0,st_gid=0,st_size=123)
            return original_lstat(path)
        output=io.StringIO()
        with patch.object(m,'MACHINE',m.digest(b'fixture-machine')),patch.object(m,'CRON',pins),patch.object(m,'read',read),patch.object(m.os,'getuid',return_value=0),patch.object(m.os,'lstat',side_effect=lstat),patch.object(m.subprocess,'run',side_effect=run),patch.dict(m.os.environ,{'PGPASSWORD':'fixture-only-private'}),contextlib.redirect_stdout(output):m.main()
        result=json.loads(output.getvalue());self.assertFalse(result['productionMutation']);self.assertEqual(len([a for a in commands if a[0]=='runuser']),3)
        self.assertTrue(all('execStart' not in row for row in result['units'].values()))
        self.assertNotIn('fixture-only-private',output.getvalue())
        self.assertEqual(set(result['hba']),{'metadata'})
        self.assertNotIn('rawHex',output.getvalue())
        self.assertEqual([x['path']for x in result['configurationPresence']],['/etc/jiangkong/db-backup-database.env','/etc/jiangkong/db-backup.env'])
    def test_wrong_owner_refuses_before_any_command(self):
        with patch.object(m.os,'getuid',return_value=123):
            with self.assertRaises(ValueError):m.main()

if __name__=='__main__':unittest.main()
