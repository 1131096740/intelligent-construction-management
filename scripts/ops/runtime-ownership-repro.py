"""Local Linux-only integration: real rsync, real root/non-root UID/GID, no network."""
import json
import hashlib
import os
import subprocess
import sys
import tempfile
from pathlib import Path

out = Path(sys.argv[1])
tool = Path(__file__).with_name('runtime-manifest.py')
out.mkdir(parents=True, exist_ok=True)
assert os.getuid() == 0 and sys.platform == 'linux'

def run(*args):
    subprocess.run(list(map(str, args)), check=True, capture_output=True, text=True)

def user(*args):
    run('setpriv', '--reuid=1000', '--regid=1000', '--clear-groups', *args)

def capture(root, name):
    run(sys.executable, tool, 'capture', '--root', root, '--manifest', out / (name + '.json'))

def compare(root, expected, name, code):
    result = subprocess.run([sys.executable, str(tool), 'compare', '--root', str(root),
        '--expected', str(out / (expected + '.json')), '--actual-manifest', str(out / (name + '.actual.json')),
        '--receipt', str(out / (name + '.diff.json'))], capture_output=True, text=True)
    assert result.returncode == code, result.stderr
    return json.loads((out / (name + '.diff.json')).read_text())

with tempfile.TemporaryDirectory(prefix='jgzg-local-rsync-') as folder:
    p = Path(folder)
    p.chmod(0o755)
    live, bad, good = [p / name for name in ['live', 'nonroot-snapshot', 'root-snapshot']]
    for root in [live, bad, good]:
        root.mkdir()
        os.chown(root, 1000, 1000)
    link = live / 'node_modules'
    link.symlink_to('/sealed-old-dependency-closure')
    os.chown(link, 0, 0, follow_symlinks=False)
    capture(live, 'old-runtime')
    user('rsync', '-a', '--delete', str(live) + '/', str(bad) + '/')
    failed = compare(bad, 'old-runtime', 'nonroot-snapshot', 1)
    assert next(x for x in failed['differences'] if x['path'] == 'node_modules')['actual']['uid'] == 1000
    user('ln', '-sfn', '/new-dependency', link)
    user('rsync', '-a', '--delete', str(bad) + '/', str(live) + '/')
    compare(live, 'old-runtime', 'nonroot-rollback', 1)
    # Recreate the exact original fixture; the production filesystem is never mounted.
    os.chown(link, 0, 0, follow_symlinks=False)
    run('rsync', '-ac', '--delete', str(live) + '/', str(good) + '/')
    compare(good, 'old-runtime', 'privileged-snapshot', 0)
    user('ln', '-sfn', '/new-dependency', link)
    run('rsync', '-ac', '--delete', str(good) + '/', str(live) + '/')
    compare(live, 'old-runtime', 'privileged-rollback', 0)
    assert link.lstat().st_uid == 0 and link.lstat().st_gid == 0
    # Prove rsync's quick-check failure separately; not claimed as the historical cause.
    source, target = p / 'built', p / 'copied'
    source.mkdir(); target.mkdir()
    (source / 'main.js').write_text('new'); (target / 'main.js').write_text('old')
    for f in [source / 'main.js', target / 'main.js']:
        os.utime(f, (1700000000, 1700000000))
    capture(source, 'built')
    run('rsync', '-a', '--delete', str(source) + '/', str(target) + '/')
    compare(target, 'built', 'quick-check-content-missed', 1)
    run('rsync', '-ac', '--delete', str(source) + '/', str(target) + '/')
    compare(target, 'built', 'checksum-copy', 0)
    summary = {'status': 'passed', 'nonRootOriginalSnapshotAndRollbackLoseLinkOwnership': True,
               'privilegedSnapshotAndRollbackPreserveExactOwnerAndTarget': True,
               'sameSizeMtimePayloadDifferenceBlocked': True, 'checksumCopyRestoresActualContent': True,
               'quickCheckCaseIsPreventiveNotHistoricalRootCause': True,
               'runtimeManifestSha256': hashlib.sha256(tool.read_bytes()).hexdigest(),
               'productionAccess': False, 'network': 'none'}
    (out / 'result.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary))
