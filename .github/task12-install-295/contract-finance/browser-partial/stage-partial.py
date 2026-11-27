import hashlib
import json
from pathlib import Path
import subprocess
import sys

repo, workspace, output = map(Path, sys.argv[1:4])
options = sys.argv[4:]
if options not in ([], ['--payment-remainder-331'], ['--upward-archive-332'], ['--historical-settlement-334'], ['--expense-witness-346'], ['--expense-witness-349'], ['--company-history-352']):
    raise SystemExit('TASK398_BROWSER_PARTIAL_STAGING_MODE')
original = repo / '.github/task12-install-290'
partial = original / 'browser-partial'
completion = original / 'browser-completion'
partial_pins = json.loads((partial / 'assembly-pins.json').read_text())['browserOverlays']
completion_pins = {}


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
        patch = Path(__file__).with_name('partial295.patch')
        subprocess.run(['patch', '--batch', '--fuzz=0', '--silent', str(target), str(patch)], check=True)
        forward = Path(__file__).with_name('partial320.patch')
        subprocess.run(['patch', '--batch', '--fuzz=0', '--silent', str(target), str(forward)], check=True)
        diagnostics = Path(__file__).resolve().parents[1] / 'task398-browser-diagnostics.patch'
        subprocess.run(['patch', '--batch', '--fuzz=0', '--silent', str(target), str(diagnostics)], check=True)
        read_acl = diagnostics.with_name('task398-browser-read-acl.patch')
        subprocess.run(['patch', '--batch', '--fuzz=0', '--silent', str(target), str(read_acl)], check=True)
        if options:
            check(target.read_bytes(), '9a469bf3cc8fe19c261df34768f6dd17db7e2055343379d4adf0d65971ebd22d', target.name)
            payment_remainder = Path(__file__).with_name('partial331.patch')
            subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                            str(target), str(payment_remainder)], check=True)
            check(target.read_bytes(), '6a33493fa5f0e10d95e8a9cb8989ef663b43277340374336fd3a10d3cf287741', target.name)
        if options in (['--upward-archive-332'], ['--historical-settlement-334'], ['--expense-witness-346'], ['--expense-witness-349'], ['--company-history-352']):
            upward_archive = Path(__file__).with_name('partial332.patch')
            subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                            str(target), str(upward_archive)], check=True)
            check(target.read_bytes(), '83e28caef3edcd4202b818447905faf71ec1ef9cc8089448a311a728b4df4758', target.name)
        if options in (['--historical-settlement-334'], ['--expense-witness-346'], ['--expense-witness-349'], ['--company-history-352']):
            historical_settlement = Path(__file__).with_name('partial334.patch')
            subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                            str(target), str(historical_settlement)], check=True)
            check(target.read_bytes(), 'b0f660099f96e0b9143dd7e6f3d09d8ebfd0c48fc31ce5aeb028c94524225015', target.name)
        if options in (['--expense-witness-346'], ['--expense-witness-349'], ['--company-history-352']):
            expense_witness = Path(__file__).with_name('partial346.patch')
            subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent',
                            str(target), str(expense_witness)], check=True)
            check(target.read_bytes(), '2fecb10aa8a0eb21e9431070e37a79f20f82605fc752203f06af1fcf6b6ee0d7', target.name)
        if options in (['--expense-witness-349'], ['--company-history-352']):
            precision = Path(__file__).with_name('partial349.patch').resolve()
            subprocess.run(['git', 'apply', '-p0', '--unidiff-zero', str(precision)], cwd=target.parent, check=True)
            check(target.read_bytes(), '129823777fcde7df9e1ac42282e9777a9827d16ed70a9147814a0e167cf073aa', target.name)
        if options == ['--company-history-352']:
            forward352 = Path(__file__).with_name('partial352.patch').resolve()
            subprocess.run(['git', 'apply', '-p0', '--unidiff-zero', str(forward352)], cwd=target.parent, check=True)
            check(target.read_bytes(), '54f65ce29121e19570019fe1c3c87d5fefa1345c2685059f15c01a3e8a7f2f2a', target.name)
    if source.name == 'task16-real-browser.pg.spec.ts' and options == ['--company-history-352']:
        check(target.read_bytes(), 'f1d73217d4a308e3bd8bb436f1b7f62ff3b00c1a22228c1e19c16e59ae551477', target.name)
        subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '--silent', str(target),
                        str(Path(__file__).with_name('status352.patch'))], check=True)
        check(target.read_bytes(), 'ee97feb71614f3242efb0e1b79793f02eb7a8f4b39bbd1e2c0b5c6dc2f01cc2f', target.name)
    target.chmod(0o644)
    print(name)
