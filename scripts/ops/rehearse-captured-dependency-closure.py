#!/usr/bin/env python3
import argparse, pathlib, os, stat, sys, json, tarfile, hashlib, subprocess, shutil, importlib.util, datetime
P = pathlib.Path
os.umask(63)
parser = argparse.ArgumentParser(description='Offline Linux rehearsal of the pinned 2026-10-22 historical artifact; no production transport.')
parser.add_argument('--evidence', required=True, type=P)
parser.add_argument('--work', required=True, type=P)
parser.add_argument('--proof', required=True, type=P)
a = parser.parse_args()
(E, W, O) = (a.evidence.resolve(), a.work.resolve(), a.proof.resolve())
assert E != W and E != O and (W != O)
for directory in (W, O):
    directory.mkdir(exist_ok=True)
    assert not any(directory.iterdir()), 'work/proof must be empty; preserve earlier evidence'
ignored = {'.git', 'node_modules', 'dist', 'storage', 'test-results', 'playwright-report', '__pycache__'}

def source_fingerprints():
    found = {}
    for (directory, dirs, files) in os.walk(E / 'source'):
        dirs[:] = [name for name in dirs if name not in ignored]
        for name in files:
            path = P(directory) / name
            found[str(path.relative_to(E / 'source'))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return found
inputs = source_fingerprints()
TOOL = E / 'source/scripts/ops/dependency-closure.py'
spec = importlib.util.spec_from_file_location('closure', TOOL)
dc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dc)

def put(name, data):
    with (O / name).open('x') as stream:
        json.dump(data, stream, indent=2)

def run(*args, cwd=None, env=None, log=None):
    if log:
        with (O / log).open('w') as f:
            r = subprocess.run(args, cwd=cwd, env=env, stdout=f, stderr=subprocess.STDOUT)
    else:
        r = subprocess.run(args, cwd=cwd, env=env)
    assert r.returncode == 0, {'failed': args[:3], 'log': log, 'exit': r.returncode}
print('phase: linux root metadata regressions', flush=True)
run('python3', str(E / 'source/scripts/ops/dependency-closure.test.py'), log='linux-unit.log')
archive = E / 'captured-runtime-original.tar.gz'
assert dc.digest(archive) == '0eff23afcb8be2220c934563015c124c31ace9e79c697cb71c8594ee0758ca4f'
expected = json.loads((E.parent / 'release-7b8f9a85-20261022/seal-evidence/runtime-source-manifest.json').read_text()) if (E.parent / 'release-7b8f9a85-20261022').exists() else json.loads((E / 'captured-source-manifest.json').read_text())
raw = W / 'raw'
raw.mkdir()
print('phase: forensic extraction, exact original bytes and metadata', flush=True)
with tarfile.open(archive) as t:
    seen = set()
    for m in t:
        n = dc.member_name(m.name)
        assert n not in seen and n in expected
        seen.add(n)
        i = expected[n]
        assert (m.mode, m.uid, m.gid) == (i['mode'], i['uid'], i['gid'])
        if m.issym():
            assert m.linkname == i['target']
        elif m.islnk():
            assert dc.member_name(m.linkname) in expected
        else:
            assert m.isdir() or m.isfile()
    assert seen == set(expected)
run('tar', '--extract', '--gzip', '--file', str(archive), '--directory', str(raw), '--numeric-owner', '--same-owner', '--same-permissions')
before = dc.manifest.capture(raw)
diff = dc.manifest.differences(expected, {k: v for (k, v) in before['entries'].items() if k in expected})
put('forensic-original.diff.json', diff)
assert not diff
missing = dc.missing_links(before['entries'])
put('forensic-incomplete.json', {'status': 'forensic-restored-incomplete', 'missingLinks': missing, 'coveredOriginalEntries': len(expected), 'implicitAncestorMetadataHistoricalProof': False})
assert len(missing) == 3
prepared = W / 'prepared'
run('cp', '-a', '--reflink=auto', str(raw), str(prepared))
old = 'srv/jiangkong-runtime-recovery/31b44a22-20261020-actual-before-verified/opt/jiangkong'
current = 'opt/jiangkong'
prior = {}
with tarfile.open(E / 'prior-workspace-manifests.tar.gz') as t:
    for m in t:
        if m.isfile():
            prior['api' if '/services/api/' in m.name else 'web'] = (t.extractfile(m).read(), m)
assert hashlib.sha256(prior['api'][0]).hexdigest() == 'e812a128cb16e10b2520a939cc7df3c071b18f36349e07b3781bc55a339f45e1'
assert hashlib.sha256(prior['web'][0]).hexdigest() == 'f5985ef42f1578c78a7ba83bd89692a8e42acac716026de93c7b52bbff65684d'
assert dc.digest(prepared / old / 'pnpm-lock.yaml') == dc.digest(prepared / current / 'pnpm-lock.yaml') == dc.digest(E / 'source/pnpm-lock.yaml')
for (key, rel) in [('api', 'services/api'), ('web', 'apps/web-admin')]:
    original = json.loads(prior[key][0])
    present = json.loads((prepared / current / rel / 'package.json').read_text())
    candidate = json.loads((E / 'source' / rel / 'package.json').read_text())
    for field in ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']:
        assert original.get(field, {}) == present.get(field, {}) == candidate.get(field, {}), (key, field)
orphans = [old + '/node_modules/.pnpm/node_modules/fflate', current + '/node_modules/.pnpm/node_modules/fflate']
for prefix in [old, current]:
    for rel in ['pnpm-lock.yaml', 'node_modules/.pnpm/lock.yaml', 'node_modules/.modules.yaml']:
        assert 'fflate' not in (prepared / prefix / rel).read_text()
for (name, item) in before['entries'].items():
    if item['kind'] == 'file' and P(name).name == 'package.json':
        package = json.loads((raw / name).read_text())
        for key in ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']:
            assert 'fflate' not in package.get(key, {}), ('fflate required by', name)
repairs = []
for name in orphans:
    link = prepared / name
    assert link.is_symlink() and os.readlink(link) == '../fflate@0.8.3/node_modules/fflate'
    repairs.append({'path': name, 'action': 'remove-proven-orphan-in-private-copy', 'original': before['entries'][name]})
    link.unlink()
for rel in ['apps', 'apps/web-admin']:
    directory = prepared / old / rel
    directory.mkdir(exist_ok=True)
    os.chown(directory, 1000, 1001)
    os.chmod(directory, 493)
for (key, rel) in [('api', 'services/api/package.json'), ('web', 'apps/web-admin/package.json')]:
    dest = prepared / old / rel
    assert not dest.exists()
    (data, header) = prior[key]
    dest.write_bytes(data)
    os.chown(dest, header.uid, header.gid)
    os.chmod(dest, header.mode)
    repairs.append({'path': old + '/' + rel, 'action': 'restore-original-preserved-manifest', 'sha256': hashlib.sha256(data).hexdigest(), 'uid': header.uid, 'gid': header.gid, 'mode': header.mode})
run('cp', '-a', str(prepared / current / 'apps/web-admin/node_modules'), str(prepared / old / 'apps/web-admin/node_modules'))
after = dc.manifest.capture(prepared)
delta = dc.manifest.differences(before['entries'], after['entries'])
put('repair-copy.diff.json', delta)
for row in delta:
    name = row['path']
    assert name in orphans or name == old + '/services/api/package.json' or name == old + '/apps' or name.startswith(old + '/apps/web-admin'), ('unapproved repair', name)
assert not dc.missing_links(after['entries'])
put('repair-plan-applied.json', {'status': 'passed-private-copy-only', 'originalSourceUnchanged': dc.manifest.capture(raw)['entries'] == before['entries'], 'originalMissingTargets': missing, 'explicitRepairs': repairs, 'workspaceNodeModulesSource': current + '/apps/web-admin/node_modules', 'allPackageDependencyIdentitiesEqual': True, 'lockSha256': dc.digest(E / 'source/pnpm-lock.yaml'), 'remainingMissingLinks': [], 'productionAccess': False})
print('phase: strict complete-closure seal and actual restoration', flush=True)
run('python3', str(TOOL), 'seal', '--root', str(prepared), '--output', str(W / 'sealed'), log='seal.log')
run('python3', str(TOOL), 'restore', '--bundle', str(W / 'sealed'), '--output', str(W / 'restored'), log='restore.log')
for name in ['passed.json', 'source-manifest.json', 'source-after.json']:
    shutil.copy2(W / 'sealed' / name, O / ('seal-' + name))
for name in ['passed.json', 'original.diff.json', 'relocated.diff.json', 'link-relocation-map.json', 'restored-original-manifest.json', 'restored-relocated-manifest.json']:
    shutil.copy2(W / 'restored' / name, O / ('restore-' + name))
print('phase: actual Linux x64 native modules and captured AppModule import, network none', flush=True)
tree = W / 'restored/tree'
api = tree / 'srv/jiangkong/apps/api/dist/app.module.js'
apiPackage = tree / old / 'services/api/package.json'
env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/work/home', 'NODE_ENV': 'test', 'FILE_STORAGE_DRIVER': 'local', 'FILE_STORAGE_ROOT': '/work/probe-storage', 'DATABASE_URL': 'postgresql://synthetic:synthetic@127.0.0.1:1/never_connect', 'JWT_ACCESS_SECRET': 'synthetic-local-probe-only', 'JWT_REFRESH_SECRET': 'synthetic-local-probe-only', 'CLOSURE_PROBE_DIAGNOSTICS_FILE': str(O / 'native-probe-private-error.json')}
run('node', str(E / 'source/scripts/ops/dependency-native-probe.cjs'), str(tree), str(api), str(apiPackage), env=env, cwd=W, log='native-probe.json')
healthy = json.loads((O / 'native-probe.json').read_text())
engines = [P(name) for name in healthy['prismaEnginePaths']]
assert engines
for engine in engines:
    assert engine.resolve().is_relative_to(tree.resolve())
    engine.rename(engine.with_name(engine.name + '.held-for-negative-test'))
try:
    with (O / 'native-missing-engine.json').open('x') as log:
        negative = subprocess.run(['node', str(E / 'source/scripts/ops/dependency-native-probe.cjs'), str(tree), str(api), str(apiPackage)], env=env, cwd=W, stdout=log, stderr=subprocess.STDOUT)
    assert negative.returncode != 0, 'missing real native engine incorrectly passed'
finally:
    for engine in engines:
        engine.with_name(engine.name + '.held-for-negative-test').rename(engine)
restored = json.loads((W / 'restored/restored-relocated-manifest.json').read_text())
negative_delta = dc.manifest.differences(restored['entries'], dc.manifest.capture(tree)['entries'])
put('native-negative-restored.diff.json', negative_delta)
assert not negative_delta
run('node', str(E / 'source/scripts/ops/dependency-native-probe.cjs'), str(tree), str(api), str(apiPackage), env=env, cwd=W, log='native-recovered-probe.json')
put('native-negative-result.json', {'missingEngineExit': negative.returncode, 'restorationDifferences': [], 'freshRecoveryProbePassed': True})
print('phase: independent candidate API/Web builds with captured Linux dependencies', flush=True)
build = W / 'candidate-build'
shutil.copytree(E / 'source', build, symlinks=True, ignore=shutil.ignore_patterns('.git', 'node_modules', 'dist', 'test-results', 'playwright-report', '__pycache__'))
run('cp', '-a', str(prepared / current / 'node_modules'), str(build / 'node_modules'))
for rel in ['services/api', 'apps/web-admin', 'packages/shared-domain']:
    source = prepared / current / rel / 'node_modules'
    if source.exists():
        run('cp', '-a', str(source), str(build / rel / 'node_modules'))
buildEnv = dict(env, NODE_OPTIONS='--max-old-space-size=4096')
pnpm = str(E / 'pnpm-tool/bin/pnpm.cjs')
for (key, command) in [('shared', ['node', pnpm, '--filter', '@jiangkong/shared-domain', 'build']), ('prisma', ['node', pnpm, '--filter', '@jiangkong/api', 'prisma:generate']), ('api', ['node', pnpm, '--filter', '@jiangkong/api', 'build']), ('web', ['node', pnpm, '--filter', '@jiangkong/web-admin', 'build'])]:
    run(*command, cwd=build, env=buildEnv, log='build-' + key + '.log')
assert source_fingerprints() == inputs, 'candidate source changed during rehearsal'
put('source-fingerprints.json', inputs)
put('result.json', {'status': 'passed-local-only', 'originalArchiveSha256': dc.digest(archive), 'originalMissingTargets': len(missing), 'repairedCopyMissingTargets': 0, 'repairDifferences': len(delta), 'actualOriginalAndRelocatedRestorationDifferences': 0, 'nativeProbe': 'native-probe.json', 'linuxRootTests': 'linux-unit.log', 'linuxApiWebBuilds': True, 'productionWrites': False, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
print('passed: complete local closure, full original/relocated metadata, native imports and candidate builds', flush=True)
