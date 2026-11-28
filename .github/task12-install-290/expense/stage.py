import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    source, base, dest = map(Path, sys.argv[1:])
    plan = json.loads((source / 'material.json').read_text())
    if set(plan) != {'app', 'valid', 'negative', 'recovery'} or dest.exists():
        raise SystemExit('EXPENSE_290_MATERIAL_PLAN')
    dest.mkdir()
    for mode, pins in plan.items():
        package = source / mode
        target = dest / mode
        target.mkdir()
        patch = package / 'installer.patch'
        if digest(base) != pins['installerBase'] or digest(patch) != pins['installerPatch']:
            raise SystemExit('EXPENSE_290_INSTALLER_PREIMAGE')
        installer = target / 'installer.cjs'
        shutil.copyfile(base, installer)
        subprocess.run(['patch', '--silent', '-F', '0', str(installer), str(patch)], check=True)
        if digest(installer) != pins['installerResult']:
            raise SystemExit('EXPENSE_290_INSTALLER_POSTIMAGE')
        expected = {'installer.patch', *pins['inputs']}
        observed = {f.relative_to(package).as_posix() for f in package.rglob('*') if f.is_file()}
        if observed != expected or any(f.is_symlink() for f in package.rglob('*')):
            raise SystemExit('EXPENSE_290_UNEXPECTED_MATERIAL')
        for file, checksum in pins['inputs'].items():
            src = package / file
            if digest(src) != checksum:
                raise SystemExit('EXPENSE_290_INPUT')
            output = target / file
            output.parent.mkdir(exist_ok=True)
            shutil.copyfile(src, output)
if __name__ == '__main__':
    main()
