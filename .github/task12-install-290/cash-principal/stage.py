from pathlib import Path
import hashlib
import json
import subprocess
import sys

plan, source, target = map(Path, sys.argv[1:])
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
pins = json.loads((plan / 'assembly-pins.json').read_text())
inputs = {
    'entry.cjs': source / 'install-only.cjs',
    'runner.cjs': source / 'workspace/services/api/prisma/run-task398-shared-standard-local.cjs',
    'handover.spec.ts': source / 'workspace/services/api/src/database/task25-public-cash-handover.http.pg.spec.ts',
}

def need(ok, code):
    if not ok:
        raise SystemExit(code)

target.mkdir(mode=0o755)
for name, preimage in inputs.items():
    delta = plan / (name + '.patch')
    pin = pins[name]
    need(sha(preimage) == pin['base'] and sha(delta) == pin['patch'], 'CASH_PRINCIPAL_290_PREIMAGE')
    output = target / name
    output.write_bytes(preimage.read_bytes())
    subprocess.run(['patch', '--silent', '-F', '0', str(output), str(delta)], check=True)
    need(sha(output) == pin['result'], 'CASH_PRINCIPAL_290_POSTIMAGE')
    if name.endswith('.cjs'):
        subprocess.run(['node', '--check', str(output)], check=True)

manifest = source / 'app-inputs.json'
need(sha(manifest) == pins['appInputs']['base'], 'CASH_PRINCIPAL_290_SOURCE_MANIFEST')
payload = json.loads(manifest.read_bytes())
handover = 'database/task25-public-cash-handover.http.pg.spec.ts'
need(handover in payload['authorizedTestOverlays'] and handover in payload['actual'], 'CASH_PRINCIPAL_290_SOURCE_SCOPE')
payload['actual'][handover] = pins['handover.spec.ts']['result']
output = target / 'app-inputs.json'
output.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n')
need(sha(output) == pins['appInputs']['result'], 'CASH_PRINCIPAL_290_SOURCE_POSTIMAGE')
print('CASH_PRINCIPAL_290_FIXED_OVERLAYS_READY_NO_DATABASE')
