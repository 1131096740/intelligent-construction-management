#!/usr/bin/env python3
"""Materialize one sealed procurement group from project Git and its tracked 289 installer pack."""
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

if len(sys.argv) != 5 or sys.argv[1] not in ('general16', 'project11'):
    sys.exit('usage: prepare.py MODE CHECKOUT CANDIDATE_SHA NEW_OUTPUT_DIRECTORY')

mode, checkout, ref, output = sys.argv[1:]
checkout, output = Path(checkout).resolve(), Path(output).resolve()
here = Path(__file__).resolve().parent
pack = checkout / '.github' / 'task12-install-289'
profile = checkout / '.github' / 'task12-install-290'
pinned = json.loads((here / 'pins.json').read_text())[mode]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def run(*args):
    subprocess.run(args, check=True)

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as dest:
        dest.write(data)
    path.chmod(0o644)

output.mkdir()
context = output / 'context'
for name, expected in pinned['runtime'].items():
    src = here / 'plans' / mode / name
    data = gzip.decompress(src.with_suffix('.json.gz').read_bytes()) if name == 'source-inputs.json' else src.read_bytes()
    if sha(data) != expected:
        sys.exit(f'PROCUREMENT_RUNTIME_PIN {name}')
    write(context / name, data)

manifest = json.loads((context / 'source-inputs.json').read_bytes())['files']
with subprocess.Popen(['git', '-C', str(checkout), 'cat-file', '--batch'],
                      stdin=subprocess.PIPE, stdout=subprocess.PIPE) as git:
    def read_blob(revision, file):
        git.stdin.write(f'{revision}:{file}\n'.encode())
        git.stdin.flush()
        header = git.stdout.readline().split()
        if header and header[-1] == b'missing':
            return None
        if len(header) != 3 or header[1] != b'blob':
            sys.exit(f'PROCUREMENT_NOT_BLOB {file}')
        contents = git.stdout.read(int(header[2]))
        if git.stdout.read(1) != b'\n':
            sys.exit('PROCUREMENT_GIT_STREAM')
        return contents

    def matching(blob, digest):
        return blob is not None and sha(blob) == digest

    for record in manifest:
        file, digest = record['file'], record['sha256']
        relative = Path(file)
        if relative.is_absolute() or '..' in relative.parts or '.git' in relative.parts:
            sys.exit('PROCUREMENT_PATH')
        tested = read_blob(ref, file)
        if not matching(tested, digest):
            preimage = sha(tested) if tested is not None else None
            if pinned['overlays'].get(file) != {'candidate': preimage, 'after': digest}:
                sys.exit(f'PROCUREMENT_WORKSPACE_PIN {file}')
            tested = (here / 'overlays' / digest).read_bytes()
        if not matching(tested, digest):
            sys.exit(f'PROCUREMENT_WORKSPACE_BYTES {file}')
        write(context / 'workspace' / relative, tested)
    git.stdin.close()

product = output / 'product'
product.mkdir()
run('node', str(profile / 'materialize.cjs'), '--materialize', str(checkout), str(product), ref)
if (product / 'successor.sql').read_bytes() != (context / 'successor.sql').read_bytes():
    sys.exit('PROCUREMENT_SUCCESSOR_MISMATCH')
run('python3', str(pack / 'produce.py'), str(checkout), ref, str(pack / 'historical-install-inputs.tar.gz'),
    str(pack / 'installer.cjs'), str(output / 'admission'))
admission = output / 'admission'
for name in ('source-seal.txt', 'source-admission.json'):
    write(context / name, (admission / name).read_bytes())
shutil.copytree(admission / 'source', context / 'source')
run('node', '-e', 'console.log(require(process.argv[1]).verify(process.argv[2], process.argv[3]));',
    str(context / 'input-check.cjs'), str(context / 'workspace'), str(product / 'predecessor'))
