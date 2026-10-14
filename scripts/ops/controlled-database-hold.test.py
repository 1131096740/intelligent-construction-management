import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('dbhold',Path(__file__).with_name('controlled-database-hold.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class DatabaseHoldTests(unittest.TestCase):
    def test_bootstrap_fence_has_no_reader_exception_before_identity_install(self):
        out=m.hold_bytes(b'original','fixture',backup_enabled=False)
        self.assertNotIn(b'jiangkong_backup_reader',out)
        self.assertIn(b'local all postgres peer',out)
        self.assertIn(b'host all all 0.0.0.0/0 reject',out)
        with self.assertRaises(ValueError):m.hold_bytes(b'original','fixture',backup_enabled=False,runtime='fixture_runtime')
    def test_backup_capability_query_targets_business_database(self):
        argv=m.peer_query_argv('business_fixture')
        self.assertEqual(argv[argv.index('-d')+1],'business_fixture')
        calls=[]
        def query(sql,decode=True,database='postgres'):
            calls.append(database)
            if database=='business_fixture':raise ValueError('business backup role lacks read permission')
        with self.assertRaisesRegex(ValueError,'lacks read permission'):
            m.assert_backup_capability(query,{'database':'business_fixture'},'SELECT 1')
        self.assertEqual(calls,['business_fixture'])
        with self.assertRaises(ValueError):m.peer_query_argv('business;other')
    def test_fence_preserves_original_bytes_and_has_only_explicit_backup_exception(self):
        raw=b'# original\r\nhost all all 127.0.0.1/32 scram-sha-256\n'
        out=m.hold_bytes(raw,'fixture-db')
        self.assertTrue(out.endswith(raw))
        self.assertIn(b'local replication all reject\n',out)
        self.assertIn(b'host replication all ::/0 reject\n',out)
        self.assertIn(b'host "fixture-db" jiangkong_backup_reader 127.0.0.1/32 scram-sha-256\n',out)
        self.assertLess(out.index(b'local replication'),out.index(b'local all postgres peer'))
        self.assertLess(out.index(b'jiangkong_backup_reader'),out.index(b'host all all 0.0.0.0/0 reject'))
    def test_existing_fence_cannot_be_stacked(self):
        with self.assertRaises(ValueError):m.hold_bytes(m.hold_bytes(b'original','fixture'),'fixture')
    def test_runtime_preview_adds_only_exact_loopback_identity(self):
        out=m.hold_bytes(b'original','fixture',runtime='fixture_runtime')
        self.assertIn(b'host "fixture" fixture_runtime 127.0.0.1/32 scram-sha-256',out)
        self.assertIn(b'host all all 0.0.0.0/0 reject',out)
        with self.assertRaises(ValueError):m.hold_bytes(b'original','fixture',runtime='postgres')
    def test_unknown_or_injected_identities_refused(self):
        for db,role in [('all,other','reader'),('fixture','postgres all trust'),('"fixture"','reader'),('fixture\n','reader')]:
            with self.assertRaises(ValueError):m.hold_bytes(b'original',db,role)
    def test_no_login_or_empty_session_count_does_not_ignore_prepared_or_subscribed_writes(self):
        for snap in [{'preparedTransactions':1,'subscriptions':0,'sessions':[]},{'preparedTransactions':0,'subscriptions':1,'sessions':[]},{'preparedTransactions':0,'subscriptions':0,'sessions':[{'pid':99}]}]:
            with self.assertRaises(ValueError):m.no_writers(snap)
        m.no_writers({'preparedTransactions':0,'subscriptions':0,'sessions':[]})
if __name__=='__main__':unittest.main()
