from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys

historical, archive, common, out, shard = sys.argv[1:]
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
    patch(out/'operating-projection-postgresql.cases.ts',plan/'pol108-core-cases.patch')
installer=out/'installer.cjs'
shutil.copyfile(common/'installer.cjs',installer)
patch(installer,plan/'pol108-installer.patch')
for file in out.iterdir():
    file.chmod(0o644)
