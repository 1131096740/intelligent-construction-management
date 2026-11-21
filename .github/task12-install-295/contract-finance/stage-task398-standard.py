import hashlib
import json
import subprocess
import sys
from pathlib import Path

archive, workspace, work = map(Path, sys.argv[1:])
pins = json.loads((archive / 'fixed-overlay-pins.json').read_text())
names = [
    'services/api/src/database/task16-shared-standard.http.pg.spec.ts',
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

runner = work / names[3]
delta = Path(__file__).with_name('task398-standard-295.patch')
subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent', str(runner), str(delta)], check=True)
for name in names:
    (work / name).chmod(0o644)
    print(name)
