import hashlib
import json
from pathlib import Path
import subprocess
import sys

repo, workspace, output = map(Path, sys.argv[1:])
original = repo / '.github/task12-install-290'
partial = original / 'browser-partial'
completion = original / 'browser-completion'
partial_pins = json.loads((partial / 'assembly-pins.json').read_text())['browserOverlays']
completion_pins = json.loads((completion / 'pins.json').read_text())['workspace']


def digest(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def check(data, expected, name):
    if digest(data) != expected:
        raise SystemExit(f'TASK398_COMPLETION_BYTE_PIN {name}')


for name in sorted(partial_pins.keys() | completion_pins.keys()):
    source = workspace / name
    target = output / name
    target.parent.mkdir(parents=True, exist_ok=True)
    base = source.read_bytes() if source.is_file() else None
    if name in partial_pins:
        pin = partial_pins[name]
        if 'verbatim' in pin:
            check(base, None, name)
            data = (partial / 'fixtures' / source.name).read_bytes()
            check(data, pin['verbatim'], name)
        else:
            check(base, pin['base'], name)
            patch = partial / 'fixtures' / (source.name + '.patch')
            check(patch.read_bytes(), pin['patch'], patch.name)
            target.write_bytes(base)
            subprocess.run(['patch', '--batch', '--fuzz=0', '--silent', str(target), str(patch)], check=True)
            data = target.read_bytes()
            check(data, pin['result'], name)
    else:
        data = base
    if name in completion_pins:
        pin = completion_pins[name]
        check(data, pin['base'], name)
        data = (completion / 'fixtures' / pin['file']).read_bytes()
        check(data, pin['result'], name)
    if data == base:
        continue
    target.write_bytes(data)
    if source.name == 'run-task398-shared-standard-local.cjs':
        patch = Path(__file__).with_name('completion295.patch')
        subprocess.run(['patch', '--batch', '--fuzz=0', '--silent', str(target), str(patch)], check=True)
        forward = Path(__file__).with_name('completion320.patch')
        subprocess.run(['patch', '--batch', '--fuzz=0', '--silent', str(target), str(forward)], check=True)
        diagnostics = Path(__file__).resolve().parents[1] / 'task398-browser-diagnostics.patch'
        subprocess.run(['patch', '--batch', '--fuzz=0', '--silent', str(target), str(diagnostics)], check=True)
    target.chmod(0o644)
    print(name)
