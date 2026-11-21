import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


source, base, output = map(Path, sys.argv[1:])
pins = json.loads((source / 'material.json').read_text())
expected = {'material.json', 'run-lanes.sh', 'stage.py', *pins['inputs']}
files = {file.relative_to(source).as_posix() for file in source.rglob('*') if file.is_file()}
if (files != expected or any(file.is_symlink() for file in source.rglob('*'))
        or digest(base) != pins['installerBase'] or output.exists()):
    raise SystemExit('PAYMENT_290_MATERIAL_PREIMAGE')
for file, checksum in pins['inputs'].items():
    if digest(source / file) != checksum:
        raise SystemExit('PAYMENT_290_MATERIAL_CHECKSUM')
output.mkdir()
for file in pins['inputs']:
    destination = output / file
    destination.parent.mkdir(exist_ok=True)
    shutil.copyfile(source / file, destination)
for profile in ('positive', 'negative'):
    installer = output / f'{profile}-installer.cjs'
    shutil.copyfile(base, installer)
    subprocess.run(['patch', '--silent', '-F', '0', str(installer),
                    str(output / f'{profile}-installer.patch')], check=True)
    if digest(installer) != pins['installerResults'][profile]:
        raise SystemExit('PAYMENT_290_INSTALLER_POSTIMAGE')
