from pathlib import Path
from hashlib import sha256
import gzip
import json
import subprocess
import sys

plan = Path(__file__).resolve().parent
lane, repo_name, workspace_name, out_name = sys.argv[1:]
if lane not in ('general16', 'project11'):
    sys.exit('PROCUREMENT_295_MODE')
repo, workspace, out = map(Path, (repo_name, workspace_name, out_name))
prior = repo / '.github/task12-install-290/procurement'
common = repo / '.github/task12-install-295/contract-finance/common'
port = json.loads((plan / 'port-pins.json').read_bytes())
original = json.loads((prior / 'pins.json').read_bytes())[lane]
delta = {row['path']: row for row in json.loads((plan / 'candidate-delta.json').read_bytes())}
digest = lambda data: sha256(data).hexdigest()
out.mkdir()


def read(file):
    if not file.is_file() or file.is_symlink():
        raise ValueError(f'PROCUREMENT_295_INPUT {file.name}')
    return file.read_bytes()


def write(file, content):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(content)
    file.chmod(0o644)


def patch(source, target, expected, patch_name):
    before = read(source)
    if digest(before) != expected['base']:
        raise ValueError(f'PROCUREMENT_295_PATCH_PREIMAGE {source.name}')
    write(target, before)
    subprocess.run(['patch', '--batch', '--fuzz=0', '--no-backup-if-mismatch', str(target)],
                   input=read(plan / patch_name), stdout=subprocess.DEVNULL, check=True)
    if digest(read(target)) != expected['after']:
        raise ValueError(f'PROCUREMENT_295_PATCH_POSTIMAGE {source.name}')


runtime = prior / 'plans' / lane
manifest = gzip.decompress(read(runtime / 'source-inputs.json.gz'))
if digest(manifest) != original['runtime']['source-inputs.json']:
    raise ValueError('PROCUREMENT_295_ORIGINAL_INVENTORY')
seen = set()
role_material = {
    'services/api/prisma/general-procurement-owned-ci.cjs',
    'services/api/prisma/general-procurement-runtime-grants.sql',
    'services/api/prisma/local-staged-migration-qualification.json',
    'services/api/prisma/task398-owned-280-business-read-baseline.json',
}
staged_role = set()
for row in json.loads(manifest)['files']:
    relative, expected = row['file'], row['sha256']
    current = workspace / relative
    tested = digest(read(current)) if current.is_file() else None
    if tested == expected:
        if relative in role_material:
            write(out / 'workspace' / relative, read(current))
            staged_role.add(relative)
        continue
    if relative in delta:
        proof = delta[relative]
        if proof['expected'] != expected or proof['candidate'] != tested:
            raise ValueError(f'PROCUREMENT_295_CANDIDATE_PIN {relative}')
        seen.add(relative)
        continue
    if original['overlays'].get(relative) != {'candidate': tested, 'after': expected}:
        raise ValueError(f'PROCUREMENT_295_ORIGINAL_OVERLAY_PIN {relative}')
    bytes_ = read(prior / 'overlays' / expected)
    if digest(bytes_) != expected:
        raise ValueError(f'PROCUREMENT_295_ORIGINAL_OVERLAY_BYTES {relative}')
    write(out / 'workspace' / relative, bytes_)
    if relative in role_material:
        staged_role.add(relative)
if staged_role != role_material:
    raise ValueError('PROCUREMENT_295_ROLE_MATERIAL_CLOSURE')
if seen != set(delta):
    raise ValueError('PROCUREMENT_295_DELTA_CLOSURE')

patch(common / 'installer.cjs', out / 'installer.cjs', port['installer'], 'installer-procurement.patch')
for name, pin in port[lane].items():
    patch(runtime / name, out / name, pin, pin['patch'])
for name in ['owner-observation.cjs', *(
    ['project-scope-http-report.cjs', 'project-scope-browser-report.cjs', 'project-scope-browser-pins.json']
    if lane == 'project11' else []
)]:
    material = read(runtime / name)
    if digest(material) != original['runtime'][name]:
        raise ValueError(f'PROCUREMENT_295_REPORT_PIN {name}')
    write(out / ('procurement-owner-observation.cjs' if name == 'owner-observation.cjs' else name), material)
print(json.dumps({'lane': lane, 'candidateDriftPaths': len(seen),
                  'runtimeWorkspaceOverlays': len([p for p in (out/'workspace').rglob('*') if p.is_file()])}))
