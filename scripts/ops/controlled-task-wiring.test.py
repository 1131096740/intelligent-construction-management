import importlib.util
from pathlib import Path
import unittest
import tempfile,os
spec=importlib.util.spec_from_file_location('wiring',Path(__file__).with_name('controlled-task-wiring.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TaskWiringTests(unittest.TestCase):
    def test_actual_save_and_owned_withdrawal_refuse_identical_byte_replacement(self):
        with tempfile.TemporaryDirectory()as root:
            root=Path(root).resolve()
            path=Path(root)/'drop-in';body=b'fixture unit body\n'
            meta=m.create_drop_in(path,body,owner_uid=os.getuid())
            with self.assertRaises(FileExistsError):m.create_drop_in(path,body,owner_uid=os.getuid())
            replacement=Path(root)/'other';replacement.write_bytes(body);replacement.chmod(0o644);replacement.replace(path)
            with self.assertRaises(ValueError):m.remove_drop_in(path,m.digest(body),meta)
            self.assertEqual(path.read_bytes(),body)
    def test_exact_owned_file_can_be_removed_without_touching_neighbour(self):
        with tempfile.TemporaryDirectory()as root:
            root=Path(root).resolve()
            path=Path(root)/'drop-in';other=Path(root)/'untouched';other.write_bytes(b'other')
            meta=m.create_drop_in(path,b'fixture',owner_uid=os.getuid());m.remove_drop_in(path,m.digest(b'fixture'),meta)
            self.assertFalse(path.exists());self.assertEqual(other.read_bytes(),b'other')
    def test_missing_parent_is_owned_and_creation_pin_survives_json(self):
        import json
        with tempfile.TemporaryDirectory()as root:
            root=Path(root).resolve()
            path=Path(root)/'task.service.d'/'owned.conf';body=b'fixture'
            meta=m.create_drop_in(path,body,owner_uid=os.getuid(),create_parent=True)
            saved=json.loads(json.dumps(meta))
            m.created_file_matches(path,m.digest(body),saved)
            replacement=Path(root)/'replacement';replacement.write_bytes(body);replacement.chmod(0o644);replacement.replace(path)
            with self.assertRaises(ValueError):m.created_file_matches(path,m.digest(body),saved)
            self.assertTrue(path.exists())
    def test_effective_arguments_remain_exact(self):
        unit=next(iter(m.TASKS));script,flag=m.TASKS[unit]
        m.assert_effective(unit,f'{{ path=/usr/bin/node ; argv[]=/usr/bin/node /srv/jiangkong/apps/api/scripts/{script} {flag} ; ignore_errors=no ; }}','/srv/jiangkong/apps/api')
        with self.assertRaises(ValueError):m.assert_effective(unit,f'{{ argv[]=/usr/bin/node /srv/jiangkong/apps/api/scripts/{script} {flag} --unknown ; }}','/srv/jiangkong/apps/api')
    def test_replaces_only_paths_and_preserves_existing_approved_argument(self):
        for unit,(script,flag) in m.TASKS.items():
            raw=f'[Service]\nUser=ubuntu\nWorkingDirectory=/opt/jiangkong/services/api\nEnvironmentFile=/etc/jiangkong/api.env\nExecStart=/usr/bin/node /opt/jiangkong/services/api/scripts/{script} {flag}\nNoNewPrivileges=true\n'.encode()
            output=m.drop_in(raw,unit,'a'*40,'release-one')
            self.assertIn(f'ExecStart=/usr/bin/node /srv/jiangkong/apps/api/scripts/{script} {flag}\n'.encode(),output)
            self.assertIn(b'WorkingDirectory=/srv/jiangkong/apps/api\n',output)
            self.assertNotIn(b'EnvironmentFile=',output)
            self.assertIn(b'ExecStart=\nExecStart=',output)
    def test_ambiguous_command_or_unknown_flags_do_not_change_unit(self):
        unit=next(iter(m.TASKS));script,flag=m.TASKS[unit]
        base=f'[Service]\nUser=ubuntu\nWorkingDirectory=/opt/jiangkong/services/api\nExecStart=/usr/bin/node /opt/jiangkong/services/api/scripts/{script} {flag}\n'
        for raw in [base+'ExecStart=/bin/true\n',base.replace(flag,'--delete-everything'),base.replace('User=ubuntu','User=root'),base.replace('/usr/bin/node','/bin/sh')]:
            with self.assertRaises(ValueError):m.drop_in(raw.encode(),unit,'a'*40,'release-one')
    def test_journal_paths_and_content_are_derived_not_accepted_from_unknown_rows(self):
        with self.assertRaises(ValueError):m.validate_journal({'candidateSha':'a'*40,'runId':'release-one','files':[{'unit':'unknown.service'}]})
if __name__=='__main__':unittest.main()
