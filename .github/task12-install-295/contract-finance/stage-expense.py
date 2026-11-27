import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

archive, common, stage = map(Path, sys.argv[1:4])
mode_args = sys.argv[4:]
assert mode_args in ([], ['--historical-settlement-334'], ['--expense-witness-346'],
                     ['--expense-witness-349'], ['--signed-settlement-350'])
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
if mode_args:
    receipt = app / 'receipt' / profiles['receipt']['spec']
    overlays = (
        (installer, 'expense-334-installer.patch',
         '17b6debf264537c782ab60804d31bce7e3dbe38f938088081fa8a6ada2345916',
         '72e0d4878f163533debbf90ca7a528381a36d94c88072ab3b89b0b6b56aa8cb2'),
        (receipt, 'expense-334-receipt.spec.ts.patch', profiles['receipt']['sha256'],
         'f7e45cce45c77f82992714705e35b5514a744e8645ef35f1fe5f57737ccaafff'),
    )
    for target, delta, before, after in overlays:
        if hashlib.sha256(target.read_bytes()).hexdigest() != before:
            raise SystemExit(f'EXPENSE_334_PREIMAGE {target.name}')
        subprocess.run(['patch','--silent','--batch','--forward','--fuzz=0',str(target),str(plan/delta)],check=True)
        if hashlib.sha256(target.read_bytes()).hexdigest() != after:
            raise SystemExit(f'EXPENSE_334_POSTIMAGE {target.name}')
    profiles['receipt']['sha256'] = overlays[-1][-1]
    (app / 'profiles.json').write_text(json.dumps(profiles, indent=2) + '\n')

if mode_args in (['--expense-witness-346'], ['--expense-witness-349'], ['--signed-settlement-350']):
    historical = stage / 'installer-historical.cjs'
    shutil.copyfile(installer, historical)
    forward = json.loads((plan / 'expense-346-fixtures.json').read_text())
    for name, (before, _) in forward.items():
        if hashlib.sha256((stage / name).read_bytes()).hexdigest() != before:
            raise SystemExit(f'EXPENSE_346_PREIMAGE {name}')
    subprocess.run(
        ['patch', '--silent', '--batch', '--forward', '--fuzz=0', '-p1', '-d', str(stage),
         '-i', str((plan / 'expense-346.patch').resolve())],
        check=True,
    )
    for name, (_, after) in forward.items():
        if hashlib.sha256((stage / name).read_bytes()).hexdigest() != after:
            raise SystemExit(f'EXPENSE_346_POSTIMAGE {name}')
    key = 'app/receipt/' + profiles['receipt']['spec']
    # Each precision profile builds on its pinned predecessor.
    versions = {'--expense-witness-349': (349,), '--signed-settlement-350': (349, 350)}
    for version in versions.get(mode_args[0], ()):
        forward = json.loads((plan / f'expense-{version}-fixtures.json').read_text())
        for name, (before, _) in forward.items():
            if hashlib.sha256((stage / name).read_bytes()).hexdigest() != before:
                raise SystemExit(f'EXPENSE_{version}_PREIMAGE {name}')
        subprocess.run(
            ['git', 'apply', '--unidiff-zero', str((plan / f'expense-{version}.patch').resolve())],
            cwd=stage,
            check=True,
        )
        for name, (_, after) in forward.items():
            if hashlib.sha256((stage / name).read_bytes()).hexdigest() != after:
                raise SystemExit(f'EXPENSE_{version}_POSTIMAGE {name}')
    profiles['receipt']['sha256'] = forward[key][-1]
    (app / 'profiles.json').write_text(json.dumps(profiles, indent=2) + '\n')

for file in stage.rglob('*'):
    if file.is_file():
        file.chmod(0o644)
