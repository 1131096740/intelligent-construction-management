import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

archive, common, stage = map(Path, sys.argv[1:])
plan = Path(__file__).parent
pins = json.loads((archive / 'material.json').read_text())['inputs']
for name, checksum in pins.items():
    source = archive / name
    if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest() != checksum:
        raise SystemExit(f'PAYMENT_295_MATERIAL_PIN {name}')
    target = stage / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)

installer = stage / 'installer.cjs'
shutil.copyfile(common / 'installer.cjs', installer)
for name, delta in [('installer.cjs','payment-execution-installer.patch'),
                    *[(name, name + '.patch') for name in
                      ('fresh.cjs','valid.cjs','payment-execution-concurrency.spec.ts')]]:
    subprocess.run(['patch','--silent','--batch','--fuzz=0',str(stage/name),str(plan/delta)],check=True)
subprocess.run(['patch','--silent','--batch','--fuzz=0',str(stage/'payment-execution-concurrency.spec.ts'),
                str(plan/'payment-concurrency-320.patch')],check=True)
for file in stage.rglob('*'):
    if file.is_file():
        file.chmod(0o644)
