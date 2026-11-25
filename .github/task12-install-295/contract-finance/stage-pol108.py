from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

historical, archive, common, out, shard, count = sys.argv[1:]
if count not in {'295', '329', '330', '331', '332'}:
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
installer=out/'installer.cjs'
shutil.copyfile(common/'installer.cjs',installer)
patch(installer,plan/'pol108-installer.patch')
for file in out.iterdir():
    file.chmod(0o644)
