import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

archive, common, stage = map(Path, sys.argv[1:])
plan = Path(__file__).parent
pins = json.loads((archive / 'material.json').read_text())
for mode, scope in pins.items():
    for name, checksum in scope['inputs'].items():
        source = archive / mode / name
        if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest() != checksum:
            raise SystemExit(f'EXPENSE_295_MATERIAL_PIN {mode}/{name}')
        target = stage / mode / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)

installer = stage / 'installer.cjs'
shutil.copyfile(common / 'installer.cjs', installer)
deltas = [(installer, 'expense-installer.patch'),
          (stage/'app'/'expense-app.cjs','expense-app.cjs.patch'),
          (stage/'app'/'profiles.json','profiles.json.patch'),
          (stage/'app'/'receipt'/'project-expense-receipt-concurrency.spec.ts','receipt.spec.ts.patch')]
deltas += [(stage / mode / 'entry.cjs', mode + '.entry.cjs.patch') for mode in pins]
for target, delta in deltas:
    subprocess.run(['patch','--silent','--batch','--forward','--fuzz=0',str(target),str(plan/delta)],check=True)
app = stage / 'app'
profiles = json.loads((app / 'profiles.json').read_text())
for lane, profile in profiles.items():
    spec = app / lane / profile['spec']
    if hashlib.sha256(spec.read_bytes()).hexdigest() != profile['sha256']:
        raise SystemExit(f'EXPENSE_295_TEST_SOURCE {lane}')
for file in stage.rglob('*'):
    if file.is_file():
        file.chmod(0o644)
