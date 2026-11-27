#!/usr/bin/env python3
"""Run two exact migrations after the existing isolated 350 installation."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

if len(sys.argv) != 5:
    raise SystemExit('usage: run.py BASE_WORKTREE PREPARED_350 BUILD_350 CANDIDATE_SHA')
base, prepared, build = map(lambda value: Path(value).resolve(), sys.argv[1:4])
candidate = sys.argv[4]
root = Path(__file__).resolve().parents[4]
proof = Path(tempfile.mkdtemp(prefix='jg382-forward352-'))
print('FORWARD_352_EVIDENCE', proof, flush=True)

def git(*args):
    return subprocess.check_output(['git', '-C', str(root), *args])

def replace_once(value, old, new):
    if value.count(old) != 1:
        raise RuntimeError('unexpected runner source: ' + old[:80])
    return value.replace(old, new, 1)

base_sha = subprocess.check_output(['git', '-C', str(base), 'rev-parse', 'HEAD'], text=True).strip()
if subprocess.check_output(['git', '-C', str(base), 'status', '--porcelain'], text=True).strip():
    raise RuntimeError('350 worktree must be clean')
if len(candidate) != 40 or git('rev-parse', candidate).decode().strip() != candidate:
    raise RuntimeError('candidate must be a full commit SHA')
if os.environ.get('JG_FORWARD_352_BUSINESS') == '1':
    image = (build / 'image.id').read_text().strip()
    label = subprocess.check_output(['docker', 'image', 'inspect', image, '--format',
        '{{index .Config.Labels "org.jiangkong.candidate-352"}}'], text=True).strip()
    if label != candidate:
        raise RuntimeError('business image candidate label mismatch')
source = json.loads((prepared / 'source.json').read_text())
if source['sourceSha'] != base_sha or source['migrationCount'] != 350:
    raise RuntimeError('prepared source does not match the 350 base')
prefix = 'services/api/prisma/migrations/'
def paths(sha):
    return sorted(p for p in git('ls-tree', '-r', '--name-only', sha, '--', prefix).decode().splitlines()
                  if p.endswith('/migration.sql'))
old, new = paths(base_sha), paths(candidate)
if len(old) != 350 or len(new) != 352 or new[:350] != old:
    raise RuntimeError('unexpected migration order')
for name in old:
    if git('rev-parse', f'{base_sha}:{name}') != git('rev-parse', f'{candidate}:{name}'):
        raise RuntimeError('350 predecessor migration changed: ' + name)
tail = proof / 'forward-352'
tail.mkdir()
for helper in ['forward.cjs', 'business.cjs']:
    (tail / helper).write_bytes((Path(__file__).resolve().parent / helper).read_bytes())
rows = []
for name in new[350:]:
    data = git('show', f'{candidate}:{name}')
    name = Path(name).parent.name
    directory = tail / name
    directory.mkdir()
    (directory / 'migration.sql').write_bytes(data)
    rows.append({'name': name, 'sha256': hashlib.sha256(data).hexdigest()})
(tail / 'manifest.json').write_text(json.dumps({'candidate': candidate, 'base': base_sha, 'migrations': rows}) + '\n')
plan = base / '.github/task12-install-295/contract-finance'
entry = (plan / 'remaining-owner-entry.cjs').read_text()
entry = replace_once(entry, "assert.equal(installerSha,expense.installerSha256,", "assert.equal(installerSha,process.env.JG_FORWARD_352_INSTALLER_SHA,")
(proof / 'entry.cjs').write_text(entry)
runner = (plan / 'run-remaining-owner.sh').read_text()
runner = replace_once(runner, 'plan=$(cd "$(dirname "$0")" && pwd -P)', 'plan=' + str(plan))
runner = replace_once(runner, 'src=$plan/remaining-owner-entry.cjs,dst=/qualification/remaining-owner-entry.cjs', 'src=' + str(proof / 'entry.cjs') + ',dst=/qualification/remaining-owner-entry.cjs')
injection = '''append_remaining_installer "$source_mode" owner
python3 - "$work/installer.cjs" <<'PYHOOK'
from pathlib import Path
import sys
p=Path(sys.argv[1]); s=p.read_text()
old="      receipt.business = 'CALLBACK_COMPLETED';"
new=old+"\\n      await require('/qualification/forward-352/forward.cjs')({folder,cli,engine,endpoint,command,jsonSql,control,roleIdentity,qualifiedLedger,receipt,enter,finalSql,final,runId,workDir:root});"
assert s.count(old)==1
p.write_text(s.replace(old,new))
PYHOOK
args+=(--env "JG_FORWARD_352_BUSINESS=${JG_FORWARD_352_BUSINESS:-0}" --env "JG_FORWARD_352_INSTALLER_SHA=$(shasum -a 256 "$work/installer.cjs" | cut -d' ' -f1)"
  --mount "type=bind,src=''' + str(tail) + ''',dst=/qualification/forward-352,readonly")'''
runner = replace_once(runner, 'append_remaining_installer "$source_mode" owner', injection)
script = proof / 'run.sh'
script.write_text(runner)
env = dict(os.environ, RUNNER_TEMP=str(proof))
command = ['bash', str(script), str(base), str(prepared), base_sha, str(build), 'fund-movement', '--signed-settlement-350']
result = subprocess.run(command, cwd=base, env=env)
if result.returncode == 0:
    receipts = list(proof.glob('jg-remaining-fund-movement.*/receipt.json'))
    if len(receipts) != 1:
        raise RuntimeError('missing unique installer receipt')
    receipt = json.loads(receipts[0].read_text())
    forward = receipt.get('forward352', {})
    if (receipt.get('status') != 'REMAINING_OWNER_350_PASSED' or
        receipt.get('cleanup') != 'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT' or
        forward.get('candidateSha') != candidate or forward.get('migrationCount') != 352 or
        forward.get('sameDatabase') is not True or forward.get('protectedCatalog') is not True):
        raise RuntimeError('352 forward receipt is incomplete')
    if os.environ.get('JG_FORWARD_352_BUSINESS') == '1':
        case = receipt.get('issue436_352', {})
        if (case.get('total'), case.get('passed'), case.get('skipped'), case.get('exit')) != (1, 1, 0, 0):
            raise RuntimeError('352 business receipt is incomplete')
(proof / 'exit').write_text(str(result.returncode) + '\n')
raise SystemExit(result.returncode)
