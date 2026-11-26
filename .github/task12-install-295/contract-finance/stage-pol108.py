from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

historical, archive, common, out, shard, count = sys.argv[1:]
if count not in {'295', '329', '330', '331', '332', '334', '346'}:
    raise SystemExit('POL108_MIGRATION_COUNT')
historical,archive,common,out=map(Path,(historical,archive,common,out))
plan=Path(__file__).parent
pins=json.loads((archive/'profile.json').read_text())['pol108Assembly']

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def patch(target, delta):
    subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(target),str(delta)],check=True)

out.mkdir()
for name in ['pol108-289.cjs','pol108-observability.cjs','pol108-shards.cjs',
             'fixtures/jest.runtime.config.cjs',*(('fixtures/operating-projection-postgresql.cases.ts',) if shard=='core' else ())]:
    source=historical/name
    target=out/source.name
    shutil.copyfile(source,target)
    pin=pins.get(source.name)
    if pin:
        delta=archive/(source.name+'.patch')
        if digest(target)!=pin['baseSha256'] or digest(delta)!=pin['patchSha256']:
            raise SystemExit('POL108_ARCHIVE_PREIMAGE')
        patch(target,delta)
        if digest(target)!=pin['resultSha256']:
            raise SystemExit('POL108_ARCHIVE_POSTIMAGE')
if shard=='core':
    cases = out/'operating-projection-postgresql.cases.ts'
    patch(cases, plan/'pol108-core-cases.patch')
    if count != '295':
        text = cases.read_text()
        original = 'COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 295'
        if text.count(original) != 1:
            raise SystemExit('POL108_320_LEDGER_COUNT_ANCHOR')
        cases.write_text(text.replace(original, original.removesuffix('295') + count))
        if count == '346' and digest(cases) != '90ebf581a9ba6d2019560facab6a6329c5b0626c2908b73a526015fbc1437e77':
            raise SystemExit('POL108_346_CORE_FIXTURE')
installer=out/'installer.cjs'
if count in {'334', '346'}:
    subprocess.run(['node', str(plan/'stage-historical-takeover-333.cjs'), str(out), 'historical-settlement-334'],check=True)
else:
    shutil.copyfile(common/'installer.cjs',installer)
if count == '346':
    delta = (plan/'expense-witness/installer.patch').resolve()
    subprocess.run(['git', 'apply', '--unidiff-zero', str(delta)], cwd=out, check=True)
    profile = (plan/'expense-witness-346-profile.cjs').resolve()
    canonical = subprocess.check_output(
        ['node', '-p', 'require(process.argv[1]).installerSha256', str(profile)], text=True).strip()
    if digest(installer) != canonical:
        raise SystemExit('POL108_346_INSTALLER_PREIMAGE')
    patch(installer, plan/'pol108-346-installer.patch')
    if digest(installer) != 'fd1c86f6bc0654199efdeed8ba3753ad8376d99d2b660e9a70e1cf3564110719':
        raise SystemExit('POL108_346_INSTALLER_POSTIMAGE')
else:
    patch(installer,plan/'pol108-installer.patch')
if count == '334':
    if digest(installer) != 'e3a90eb052cce82cd3baa6ed10475e2e793995226a96719164fb66dab52d9fe9':
        raise SystemExit('POL108_334_INSTALLER_PREIMAGE')
    patch(installer,plan/'pol108-334-installer.patch')
    if digest(installer) != '6e5ac94e0bf949e315baca0a56e4489c969700e7009c8898140a13e3dae295d2':
        raise SystemExit('POL108_334_INSTALLER_POSTIMAGE')
for file in out.iterdir():
    file.chmod(0o644)
