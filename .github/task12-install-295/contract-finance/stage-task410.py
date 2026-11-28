import gzip
import hashlib
import json
import subprocess
import sys
from pathlib import Path

archive_name, workspace_name, work_name, *options = sys.argv[1:]
if options not in ([], ['--current-320'], ['--text-direct-330'], ['--payment-remainder-331'], ['--upward-archive-332'], ['--historical-settlement-334']):
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
if options in (['--text-direct-330'], ['--payment-remainder-331'], ['--upward-archive-332'], ['--historical-settlement-334']):
    spec = work / 'services/api/src/database/company-proxy-repayment.http.pg.spec.ts'
    verify(spec.read_bytes(), '54740e4a9fcef9c331eaf2943b850d29a6438bdb06a47a854511effc7c8db6cc', spec.name)
    subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent', str(spec),
                    str(Path(__file__).with_name('task410-signed-settlement-330.patch'))], check=True)
    verify(spec.read_bytes(), '4a0279858087eddb69d5bb5692d261ec90ba83b343649ece908265ae11116401', spec.name)
    for relative, delta, earlier, final in [
        ('services/api/prisma/run-task398-shared-standard-local.cjs', 'task410-runner-330.patch',
         '6861d210dfa7c70e3e79f2eaaf3a25e6665cfe829469400afbfc2095204511e7',
         'e972ef88289361db2249dd2bab43409ee6db00850b8e1f663027cd56b38a51e7'),
        ('services/api/src/database/task410-owned-test-database.ts', 'task410-support-330.patch',
         'b0fd93f5e586d78a5570a3caaa2ef9a455ad7706b4b2af073199c916639af717',
         '511cc6b6019130e15ac882d7b00531f22c0de0613d0fbcaffdc0da7f0d1e27ab'),
    ]:
        target = work / relative
        verify(target.read_bytes(), earlier, relative)
        subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                        str(target), str(Path(__file__).with_name(delta))], check=True)
        verify(target.read_bytes(), final, relative)
if options in (['--payment-remainder-331'], ['--upward-archive-332'], ['--historical-settlement-334']):
    subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent', str(spec),
                    str(Path(__file__).with_name('task410-signed-competition-331.patch'))], check=True)
    verify(spec.read_bytes(), 'a847c18dfa554fe0349b9e1cb57a7ace558c312f158c5f77a78b2689e7dd0f6a', spec.name)
    for relative, delta, earlier, final in [
        ('services/api/prisma/run-task398-shared-standard-local.cjs', 'task410-runner-331.patch',
         'e972ef88289361db2249dd2bab43409ee6db00850b8e1f663027cd56b38a51e7', '4d7db1204623533024ab0fef51cc8541645a953be9c4654b8cd19bda658ed5e0'),
        ('services/api/src/database/task410-owned-test-database.ts', 'task410-support-331.patch',
         '511cc6b6019130e15ac882d7b00531f22c0de0613d0fbcaffdc0da7f0d1e27ab', '1bc51e247679b9f86649eaf1d7c88479e0168a0f02c563a4c3f5ba3876197563'),
    ]:
        target = work / relative
        verify(target.read_bytes(), earlier, relative)
        subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                        str(target), str(Path(__file__).with_name(delta))], check=True)
        verify(target.read_bytes(), final, relative)
if options in (['--upward-archive-332'], ['--historical-settlement-334']):
    for relative, delta, earlier, final in [
        ('services/api/prisma/run-task398-shared-standard-local.cjs', 'task410-runner-332.patch',
         '4d7db1204623533024ab0fef51cc8541645a953be9c4654b8cd19bda658ed5e0', '682658ecf59908e842e0642e418769b90a3e2febe8fdfecd22df9766629d34c5'),
        ('services/api/src/database/task410-owned-test-database.ts', 'task410-support-332.patch',
         '1bc51e247679b9f86649eaf1d7c88479e0168a0f02c563a4c3f5ba3876197563', '9675c13273644d8ecdc5c020f6be3faaa56804860d7a8bce82a2be2477fd98c6'),
    ]:
        target = work / relative
        verify(target.read_bytes(), earlier, relative)
        subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                        str(target), str(Path(__file__).with_name(delta))], check=True)
        verify(target.read_bytes(), final, relative)
if options == ['--historical-settlement-334']:
    for relative, delta, earlier, final in [
        ('services/api/prisma/run-task398-shared-standard-local.cjs', 'task410-runner-334.patch',
         '682658ecf59908e842e0642e418769b90a3e2febe8fdfecd22df9766629d34c5', 'f7876b907c236fcb6ea3d9e304bd225644cff6cd9e76d10e9b339a714781559e'),
        ('services/api/src/database/task410-owned-test-database.ts', 'task410-support-334.patch',
         '9675c13273644d8ecdc5c020f6be3faaa56804860d7a8bce82a2be2477fd98c6', '8f3015d75dba27c95452ada37fe5d8709ba0e0d72af89c3784bf8c380b46195b'),
    ]:
        target = work / relative
        verify(target.read_bytes(), earlier, relative)
        subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                        str(target), str(Path(__file__).with_name(delta))], check=True)
        verify(target.read_bytes(), final, relative)
for name in names:
    (work / name).chmod(0o644)
    print(name)
