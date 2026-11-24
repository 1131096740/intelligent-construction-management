import gzip
import hashlib
import json
import subprocess
import sys
from pathlib import Path

archive_name, workspace_name, work_name, *options = sys.argv[1:]
if options not in ([], ['--current-320']):
    raise SystemExit('TASK410_STAGE_MODE')
archive, workspace, work = map(Path, (archive_name, workspace_name, work_name))
pins = json.loads((archive / 'fixed-overlay-pins.json').read_text())
names = [
    'services/api/src/database/task25-public-cash-handover.http.pg.spec.ts',
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

lane_plan = archive.parents[1] / 'company-proxy'
lane_pins = json.loads((lane_plan / 'assembly-pins.json').read_text())
if options:
    # The 329 expense fixture sends the required parallel duty coordinates.
    lane_pins['expense.spec.ts'].update(
        base='c66c7725bc05c63a01d0ccf1e1a21f44bab0068f5dd9d9d68698e7f8f18fa53d',
        result='60226141cad6ab8404ba012f62da7aa65d0a096668a8252e6373ce46caf15464',
    )
for name in ('runner.cjs','handover.spec.ts','company.spec.ts','expense.spec.ts','task410-owned-test-database.ts'):
    pin = lane_pins[name]
    dest = pin['destination'].removeprefix('workspace/')
    target = work / dest
    target.parent.mkdir(parents=True, exist_ok=True)
    if pin['basePath'] is None:
        if (workspace / dest).exists():
            raise SystemExit('TASK410_UNEXPECTED_SOURCE')
        target.write_bytes((lane_plan / name).read_bytes())
    else:
        if not target.exists():
            target.write_bytes((workspace / dest).read_bytes())
        delta = gzip.decompress((lane_plan / (name + '.patch.gz')).read_bytes())
        verify(target.read_bytes(), pin['base'], name)
        verify(delta, pin['patch'], name)
        subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(target)],input=delta,check=True)
    verify(target.read_bytes(), pin['result'], name)
    if dest not in names:
        names.append(dest)

for target, delta in [('services/api/prisma/run-task398-shared-standard-local.cjs','task410-runner-295.patch'),
                      ('services/api/src/database/task410-owned-test-database.ts','task410-support-295.patch')]:
    subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent',str(work/target),str(Path(__file__).with_name(delta))],check=True)
for relative, delta in [('services/api/prisma/run-task398-shared-standard-local.cjs', 'task410-runner-320.patch'),
                        ('services/api/src/database/task410-owned-test-database.ts', 'task410-support-320.patch')]:
    subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                    str(work / relative), str(Path(__file__).with_name(delta))], check=True)
if options:
    for relative, delta in [
        ('services/api/prisma/run-task398-shared-standard-local.cjs', 'task410-replay-runner-329.patch'),
        ('services/api/src/database/company-proxy-repayment.http.pg.spec.ts', 'task410-replay-spec-329.patch'),
    ]:
        subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                        str(work / relative), str(Path(__file__).with_name(delta))], check=True)
for name in names:
    (work / name).chmod(0o644)
    print(name)
