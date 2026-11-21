"""Produce the sealed Linux installation input from the exact, clean CI checkout."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
import tarfile

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    checkout, head, archive, installer, output = sys.argv[1:]
    checkout, archive, installer, output = map(Path, (checkout, archive, installer, output))
    review = Path(__file__).with_name('review-manifest.json')
    if digest(review) != '7bdc13ad646b948abdf525900bc1b8a9fe5fca341b7407cf7f0b58d2e3e77c11':
        raise ValueError('REVIEW_MANIFEST_MISMATCH')
    metadata = json.loads(review.read_bytes())
    if digest(archive) != metadata['archiveSha256'] or digest(installer) != metadata['installerSha256']:
        raise ValueError('APPROVED_INPUT_DIGEST_MISMATCH')

    def git(*args):
        return subprocess.check_output(['git', '-C', checkout, *args], stderr=subprocess.DEVNULL).strip()

    if not re.fullmatch('[a-f0-9]{40}', head) or git('rev-parse', 'HEAD').decode() != head:
        raise ValueError('CHECKOUT_HEAD_MISMATCH')
    if git('status', '--porcelain=v1', '--untracked-files=all'):
        raise ValueError('CHECKOUT_NOT_CLEAN')
    base = '0a5b607cf912ffbb50237af2608ac8b2a5360c16'
    try:
        git('merge-base', '--is-ancestor', base, head)
    except subprocess.CalledProcessError as error:
        raise ValueError('SEALED_BASE_NOT_IN_CHECKOUT_ANCESTRY') from error

    output.mkdir(mode=0o700)
    bundle = output / 'bundle'
    material = output / 'source'
    material.mkdir()
    expected = {row['path']: row for row in metadata['files']}
    with tarfile.open(archive, 'r:gz') as package:
        entries = package.getmembers()
        if len(entries) != 10 or sorted(entry.name for entry in entries) != sorted(expected):
            raise ValueError('SEALED_ARCHIVE_INVENTORY')
        for entry in entries:
            row = expected[entry.name]
            if not entry.isfile() or entry.size != row['bytes'] or entry.mode != int(row['mode'], 8):
                raise ValueError('SEALED_ARCHIVE_FILE')
            data = package.extractfile(entry).read()
            if hashlib.sha256(data).hexdigest() != row['sha256']:
                raise ValueError('SEALED_ARCHIVE_FILE_DIGEST')
            path = bundle / row['path']
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as handle:
                handle.write(data)
            path.chmod(entry.mode)

    admission = output / 'source-admission.json'
    command = ['node', str(installer.resolve())]
    seal = subprocess.check_output(command + ['--materialize-sealed', str(bundle), str(checkout), str(material), str(admission)])
    (output / 'source-seal.txt').write_bytes(seal)
    result = subprocess.check_output(command + ['--verify-sealed', str(material), str(admission)])
    receipt = dict(json.loads(result), ciCheckoutHead=head, requiredBase=base, archiveSha256=metadata['archiveSha256'])
    (output / 'receipt.json').write_text(json.dumps(receipt) + '\n')
    print(json.dumps(receipt))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        exit(str(error))
