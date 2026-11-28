from pathlib import Path
import gzip
import hashlib
import json
import subprocess
import sys

plan, source, target = map(Path, sys.argv[1:])
pins = json.loads((plan / 'assembly-pins.json').read_text())
manifest_pins = pins.pop('appInputs')

def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def require(condition, code):
    if not condition:
        raise SystemExit(code)

target.mkdir(mode=0o755)
manifest = source / 'app-inputs.json'
require(sha(manifest) == manifest_pins['base'], 'TASK410_290_MANIFEST_PREIMAGE')
payload = json.loads(manifest.read_bytes())
app_prefix = 'workspace/services/api/src/'
for name, pin in pins.items():
    output = target / name
    if pin['basePath'] is None:
        require(not (source / pin['destination']).exists(), 'TASK410_290_UNEXPECTED_HELPER')
        output.write_bytes((plan / name).read_bytes())
    else:
        preimage = source / pin['basePath']
        delta = gzip.decompress((plan / (name + '.patch.gz')).read_bytes())
        require(sha(preimage) == pin['base'] and hashlib.sha256(delta).hexdigest() == pin['patch'], 'TASK410_290_PREIMAGE')
        output.write_bytes(preimage.read_bytes())
        subprocess.run(['patch', '--silent', '-F', '0', str(output)], input=delta, check=True)
    require(sha(output) == pin['result'], 'TASK410_290_POSTIMAGE')
    if name.endswith('.cjs'):
        subprocess.run(['node', '--check', str(output)], check=True)
    if pin['destination'].startswith(app_prefix):
        filename = pin['destination'][len(app_prefix):]
        payload['actual'][filename] = pin['result']
        if filename not in payload['authorizedTestOverlays']:
            payload['authorizedTestOverlays'].append(filename)
payload['authorizedTestOverlays'].sort()
output = target / 'app-inputs.json'
output.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n')
require(sha(output) == manifest_pins['result'], 'TASK410_290_MANIFEST_POSTIMAGE')
for name, pin in pins.items():
    output = source / pin['destination']
    output.write_bytes((target / name).read_bytes())
manifest.write_bytes((target / 'app-inputs.json').read_bytes())
subprocess.run(['node', str(source / 'verify-behavior.cjs'), str(source / app_prefix)], check=True)
print('TASK410_290_FIXED_OVERLAYS_READY_NO_DATABASE')
