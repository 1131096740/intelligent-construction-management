import hashlib
import json
from pathlib import Path
import subprocess
import sys

repo, workspace, output = map(Path, sys.argv[1:4])
options = sys.argv[4:]
if options not in ([], ['--payment-remainder-331'], ['--upward-archive-332'], ['--historical-settlement-334']):
    raise SystemExit('TASK398_BROWSER_COMPLETION_STAGING_MODE')
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
        read_acl = diagnostics.with_name('task398-browser-read-acl.patch')
        subprocess.run(['patch', '--batch', '--fuzz=0', '--silent', str(target), str(read_acl)], check=True)
        if options:
            check(target.read_bytes(), '70eab0c53fe72130f3f4530a6859b9dad2aee2ec3d3a8ecfb35ee338317841a5', target.name)
            payment_remainder = Path(__file__).with_name('completion331.patch')
            subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                            str(target), str(payment_remainder)], check=True)
            check(target.read_bytes(), '81781b68d0791237751515f46cf0d8de0f72ff8e433220649ce206b5e60dd2a8', target.name)
        if options in (['--upward-archive-332'], ['--historical-settlement-334']):
            upward_archive = Path(__file__).with_name('completion332.patch')
            subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                            str(target), str(upward_archive)], check=True)
            check(target.read_bytes(), '72e21f6d1b94de329b1ef3c8c1e70c2e3ec830fc45895749df22a852067b9d3f', target.name)
        if options == ['--historical-settlement-334']:
            historical_settlement = Path(__file__).with_name('completion334.patch')
            subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                            str(target), str(historical_settlement)], check=True)
            check(target.read_bytes(), '6f491555ea8051b3f7e9a932f08b6554839aca37d2854ec691d2cebb6e0faa7e', target.name)
    target.chmod(0o644)
    print(name)
