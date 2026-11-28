import hashlib
import json
import subprocess
import sys
from pathlib import Path

archive, workspace, work = map(Path, sys.argv[1:])
pins = json.loads((archive / 'fixed-overlay-pins.json').read_text())
names = [
    'services/api/src/database/task25-public-cash-handover.http.pg.spec.ts',
    'services/api/src/database/task27-principal-return.http.pg.spec.ts',
    'services/api/src/database/task398-owned-database.test-support.ts',
    'services/api/src/database/task398-voucher281.test-support.ts',
    'services/api/prisma/run-task398-shared-standard-local.cjs',
    'services/api/prisma/contract-bank-runtime-fixture.cjs',
    'services/api/prisma/task398-owned-280-business-read-baseline.json',
]


def verify(data, expected, name):
    if hashlib.sha256(data).hexdigest() != expected:
        raise SystemExit(f'TASK398_STANDARD_FIXED_PIN {name}')


for name in names:
    source = workspace / name
    result = work / name
    result.parent.mkdir(parents=True, exist_ok=True)
    pin = pins[name]
    if 'verbatim' in pin:
        if source.exists():
            raise SystemExit(f'TASK398_STANDARD_UNEXPECTED_FILE {name}')
        data = (archive / source.name).read_bytes()
        verify(data, pin['verbatim'], name)
        result.write_bytes(data)
        continue
    data = source.read_bytes()
    delta = archive / (source.name + '.patch')
    verify(data, pin['base'], name)
    verify(delta.read_bytes(), pin['patch'], delta.name)
    result.write_bytes(data)
    subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent', str(result), str(delta)], check=True)
    verify(result.read_bytes(), pin['result'], name)

lane_plan = archive.parents[1] / 'cash-principal'
lane_pins = json.loads((lane_plan / 'assembly-pins.json').read_text())
runner = work / names[4]
for target, name in [(runner, 'runner.cjs'), (work / names[0], 'handover.spec.ts')]:
    pin = lane_pins[name]
    delta = lane_plan / (name + '.patch')
    verify(target.read_bytes(), pin['base'], name)
    verify(delta.read_bytes(), pin['patch'], delta.name)
    subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent', str(target), str(delta)], check=True)
    verify(target.read_bytes(), pin['result'], name)

delta = Path(__file__).with_name('task398-cash-principal-295.patch')
subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent', str(runner), str(delta)], check=True)
forward = Path(__file__).with_name('task398-cash-principal-320.patch')
subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent', str(runner), str(forward)], check=True)
for name in names:
    (work / name).chmod(0o644)
    print(name)
