import importlib.util, json, os, pathlib, subprocess, sys, tempfile, unittest, tarfile, io, hashlib, copy
sys.dont_write_bytecode = True
TOOL = pathlib.Path(__file__).with_name('dependency-closure.py')

class DependencyClosureTests(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.tmp.name).resolve()
        self.root = self.base / 'source'
        self.root.mkdir()
        (self.root / 'opt/app').mkdir(parents=True)
        (self.root / 'opt/app/main.js').write_text('synthetic module')
        (self.root / 'opt/app/main.js').chmod(416)
        (self.root / 'srv').mkdir()
        (self.root / 'srv/app').symlink_to('/opt/app')

    def tearDown(self):
        self.tmp.cleanup()

    def run_tool(self, *args):
        return subprocess.run([sys.executable, str(TOOL), *map(str, args)], capture_output=True, text=True)

    def test_original_dangling_workspace_and_stale_hoist_are_reported(self):
        (self.root / 'opt/app/hoist').symlink_to('../missing@0.8.3')
        r = self.run_tool('seal', '--root', self.root, '--output', self.base / 'pack')
        self.assertEqual(r.returncode, 1)
        d = json.loads((self.base / 'pack/failure.json').read_text())
        self.assertEqual(d['status'], 'failed')
        self.assertTrue(any(('hoist' in str(x) for x in d['missingLinks'])))
        self.assertFalse((self.base / 'pack/passed.json').exists())

    def test_complete_tree_is_actually_restored_with_metadata_and_relocated_links(self):
        r = self.run_tool('seal', '--root', self.root, '--output', self.base / 'pack')
        self.assertEqual(r.returncode, 0, r.stderr)
        r = self.run_tool('restore', '--bundle', self.base / 'pack', '--output', self.base / 'restored')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((self.base / 'restored/tree/srv/app/main.js').is_file())
        proof = json.loads((self.base / 'restored/passed.json').read_text())
        self.assertEqual(proof['originalDifferences'], [])
        self.assertEqual(proof['relocatedDifferences'], [])
        self.assertEqual((self.base / 'restored/tree/opt/app/main.js').stat().st_mode & 511, 416)

    def test_archive_bytes_tamper_fails_closed(self):
        self.assertEqual(self.run_tool('seal', '--root', self.root, '--output', self.base / 'pack').returncode, 0)
        a = self.base / 'pack/tree.tar.gz'
        a.write_bytes(a.read_bytes() + b'tamper')
        r = self.run_tool('restore', '--bundle', self.base / 'pack', '--output', self.base / 'restored')
        self.assertEqual(r.returncode, 1)
        self.assertTrue((self.base / 'restored/failure.json').exists())

    def test_undeclared_external_and_cycles_fail(self):
        for target in ['/etc/unknown', 'cycle']:
            link = self.root / 'opt/app/cycle'
            link.symlink_to(target)
            r = self.run_tool('seal', '--root', self.root, '--output', self.base / ('pack' + str(len(target))))
            self.assertEqual(r.returncode, 1)
            link.unlink()

    def test_no_overwrite_of_existing_evidence_or_restore(self):
        pack = self.base / 'pack'
        pack.mkdir()
        (pack / 'sentinel').write_text('preserve')
        self.assertNotEqual(self.run_tool('seal', '--root', self.root, '--output', pack).returncode, 0)
        self.assertEqual((pack / 'sentinel').read_text(), 'preserve')

    def test_nested_absolute_directory_link_and_hidden_files_are_preserved(self):
        (self.root / 'opt/app/.hidden').write_text('private')
        (self.root / 'opt/indirect').symlink_to('/srv/app')
        self.assertEqual(self.run_tool('seal', '--root', self.root, '--output', self.base / 'pack').returncode, 0)
        self.assertEqual(self.run_tool('restore', '--bundle', self.base / 'pack', '--output', self.base / 'restore').returncode, 0)
        self.assertEqual((self.base / 'restore/tree/opt/indirect/.hidden').read_text(), 'private')

    def test_output_inside_source_never_mutates_source(self):
        r = self.run_tool('seal', '--root', self.root, '--output', self.root / 'bad-output')
        self.assertEqual(r.returncode, 1)
        self.assertFalse((self.root / 'bad-output').exists())

    def test_manifest_tamper_fails_before_restoring(self):
        self.assertEqual(self.run_tool('seal', '--root', self.root, '--output', self.base / 'pack').returncode, 0)
        p = self.base / 'pack/source-manifest.json'
        d = json.loads(p.read_text())
        d['entries']['opt/app/main.js']['uid'] += 1
        p.write_text(json.dumps(d))
        r = self.run_tool('restore', '--bundle', self.base / 'pack', '--output', self.base / 'restored')
        self.assertEqual(r.returncode, 1)
        self.assertFalse((self.base / 'restored/tree').exists())

    def test_parent_after_symbolic_directory_keeps_resolved_identity(self):
        (self.root / 'other/deeper').mkdir(parents=True)
        (self.root / 'other/result').write_text('correct')
        (self.root / 'opt/alias').symlink_to('/other/deeper')
        (self.root / 'opt/result').write_text('wrong')
        (self.root / 'srv/indirect').symlink_to('/opt/alias/../result')
        self.assertEqual(self.run_tool('seal', '--root', self.root, '--output', self.base / 'pack').returncode, 0)
        self.assertEqual(self.run_tool('restore', '--bundle', self.base / 'pack', '--output', self.base / 'restore').returncode, 0)
        self.assertEqual((self.base / 'restore/tree/srv/indirect').read_text(), 'correct')

    def test_linux_root_preserves_real_uid_gid_for_links_and_files(self):
        if os.geteuid() != 0:
            self.skipTest('requires isolated Linux root')
        os.chown(self.root / 'opt/app/main.js', 1001, 1002)
        os.chown(self.root / 'srv/app', 1003, 1004, follow_symlinks=False)
        self.assertEqual(self.run_tool('seal', '--root', self.root, '--output', self.base / 'pack').returncode, 0)
        self.assertEqual(self.run_tool('restore', '--bundle', self.base / 'pack', '--output', self.base / 'restore').returncode, 0)
        self.assertEqual((self.base / 'restore/tree/srv/app').lstat().st_uid, 1003)
        self.assertEqual((self.base / 'restore/tree/opt/app/main.js').stat().st_gid, 1002)

    def forge_archive(self, pack, mutate):
        source = pack / 'tree.tar.gz'
        replacement = pack / 'replacement.tar.gz'
        with tarfile.open(source) as old, tarfile.open(replacement, 'w:gz') as new:
            for member in old:
                data = old.extractfile(member).read() if member.isfile() else None
                (changed, content) = mutate(copy.copy(member), data)
                new.addfile(changed, io.BytesIO(content) if content is not None else None)
        replacement.replace(source)
        p = pack / 'passed.json'
        d = json.loads(p.read_text())
        d['archiveSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        d['archiveBytes'] = source.stat().st_size
        p.write_text(json.dumps(d))

    def test_archive_metadata_or_link_tamper_saves_per_path_difference(self):
        for field in ['mode', 'uid', 'gid', 'linkname']:
            with self.subTest(field=field):
                pack = self.base / ('pack-' + field)
                self.assertEqual(self.run_tool('seal', '--root', self.root, '--output', pack).returncode, 0)

                def mutate(member, data):
                    if str(pathlib.PurePosixPath(member.name)) == ('srv/app' if field == 'linkname' else 'opt/app/main.js'):
                        setattr(member, field, '/unknown' if field == 'linkname' else getattr(member, field) + 1)
                    return (member, data)
                self.forge_archive(pack, mutate)
                out = self.base / ('restored-' + field)
                self.assertEqual(self.run_tool('restore', '--bundle', pack, '--output', out).returncode, 1)
                diff = json.loads((out / 'archive.diff.json').read_text())
                self.assertIn(diff[0]['path'], ['srv/app', 'opt/app/main.js'])
                self.assertFalse((out / 'passed.json').exists())

    def test_actual_restored_content_hash_is_verified_even_with_valid_archive_checksum(self):
        pack = self.base / 'pack'
        self.assertEqual(self.run_tool('seal', '--root', self.root, '--output', pack).returncode, 0)

        def mutate(member, data):
            return (member, b'X' * len(data) if str(pathlib.PurePosixPath(member.name)) == 'opt/app/main.js' else data)
        self.forge_archive(pack, mutate)
        out = self.base / 'restored'
        self.assertEqual(self.run_tool('restore', '--bundle', pack, '--output', out).returncode, 1)
        diff = json.loads((out / 'original.diff.json').read_text())
        self.assertTrue(any((x['path'] == 'opt/app/main.js' for x in diff)))
        self.assertFalse((out / 'passed.json').exists())
class HistoricalRehearsalGuards(unittest.TestCase):

    def setUp(self):
        spec = importlib.util.spec_from_file_location('historical_rehearsal', TOOL.with_name('rehearse-captured-dependency-closure.py'))
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def test_preserved_manifest_header_tamper_rejected_with_same_body(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = pathlib.Path(directory) / 'prior.tar.gz'
            def write(uid):
                with tarfile.open(archive, 'w:gz') as stream:
                    for name in ['opt/jiangkong/services/api/package.json', 'opt/jiangkong/apps/web-admin/package.json']:
                        member = tarfile.TarInfo(name); member.size = 2; member.uid = uid; member.gid = 1001; member.mode = 436
                        stream.addfile(member, io.BytesIO(b'{}'))
            write(1000)
            pinned = hashlib.sha256(archive.read_bytes()).hexdigest()
            self.assertEqual(set(self.module.read_prior_manifests(archive, pinned)), {'api', 'web'})
            write(1001)
            with self.assertRaises(ValueError): self.module.read_prior_manifests(archive, pinned)

    def test_original_forensic_mutation_rejected(self):
        with self.assertRaises(ValueError): self.module.require_unchanged({'original': 1}, {'original': 2})

    def test_optimized_rehearsal_still_rejects_artifact_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); evidence = root / 'evidence'; evidence.mkdir(); (evidence / 'source').mkdir()
            # It must stop on its missing unit runner rather than skip nonzero exit under -O.
            work, proof = root / 'work', root / 'proof'
            result = subprocess.run([sys.executable, '-O', str(TOOL.with_name('rehearse-captured-dependency-closure.py')), '--evidence', str(evidence), '--work', str(work), '--proof', str(proof)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((proof / 'result.json').exists())

if __name__ == '__main__':
    unittest.main()
