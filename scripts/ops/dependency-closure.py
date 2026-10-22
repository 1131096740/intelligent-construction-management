#!/usr/bin/env python3
"""Offline, fail-closed sealing and actual restoration of a complete virtual filesystem.

Absolute links refer to paths within --root, never the host filesystem. No package
installation, repairs, exclusions or production transport is performed by this tool.
"""
import argparse
import collections
import hashlib
import importlib.util
import json
import os
import stat
import sys
import tarfile
from pathlib import Path, PurePosixPath

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('runtime_manifest', Path(__file__).with_name('runtime-manifest.py'))
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def resolved(entries, name):
    todo = collections.deque(PurePosixPath(name).parts)
    current, hops = [], 0
    while todo:
        part = todo.popleft()
        if part in ('', '.', '/'):
            continue
        if part == '..':
            if not current:
                raise ValueError('link escapes virtual root')
            current.pop()
            continue
        current.append(part)
        entry = entries.get('/'.join(current))
        if entry is None:
            raise ValueError('link target absent from captured closure')
        if entry['kind'] == 'link':
            hops += 1
            if hops > 64:
                raise ValueError('link cycle or excessive indirection')
            target = PurePosixPath(entry['target'])
            current = [] if target.is_absolute() else current[:-1]
            todo.extendleft(reversed(target.parts))
        elif todo and entry['kind'] != 'dir':
            raise ValueError('link traverses a non-directory')
    return '/'.join(current) or '.'


def missing_links(entries):
    missing = []
    for name, entry in entries.items():
        if entry['kind'] == 'link':
            try:
                resolved(entries, name)
            except ValueError:
                missing.append({'path': name, 'target': entry['target'],
                                'error': 'missing, escaping or cyclic link target'})
    return missing


def verified_manifest(path):
    value = json.loads(Path(path).read_text())
    encoded = json.dumps(value['entries'], sort_keys=True, separators=(',', ':')).encode()
    if value.get('schemaVersion') != 1 or value.get('status') != 'captured' or hashlib.sha256(encoded).hexdigest() != value['entriesSha256']:
        raise ValueError('manifest identity mismatch')
    return value


def seal(root, output):
    root = Path(root).absolute()
    if root.is_symlink() or not root.is_dir():
        raise ValueError('source root must be a real directory')
    before = manifest.capture(root)
    manifest.write_new(output / 'source-manifest.json', before)
    missing = missing_links(before['entries'])
    if missing:
        manifest.write_new(output / 'failure.json', {'status': 'failed', 'missingLinks': missing})
        raise ValueError('incomplete dependency closure')
    archive = output / 'tree.tar.gz'
    with tarfile.open(archive, 'x:gz', dereference=False) as stream:
        stream.add(root, arcname='.', recursive=True)
    after = manifest.capture(root)
    changes = manifest.differences(before['entries'], after['entries'])
    manifest.write_new(output / 'source-after.json', after)
    if changes:
        manifest.write_new(output / 'source.diff.json', changes)
        raise ValueError('source changed during sealing')
    manifest.write_new(output / 'passed.json', {
        'schemaVersion': 1, 'status': 'passed', 'archiveSha256': digest(archive),
        'archiveBytes': archive.stat().st_size, 'entries': len(before['entries']),
        'manifestEntriesSha256': before['entriesSha256'], 'missingLinks': [],
        'productionTransport': False, 'packageInstallation': False})


def member_name(value):
    p = PurePosixPath(value)
    if p.is_absolute() or '..' in p.parts:
        raise ValueError('unsafe archive path')
    return str(p)


def metadata(path, item):
    info = path.lstat()
    if (info.st_uid, info.st_gid) != (item['uid'], item['gid']):
        os.chown(path, item['uid'], item['gid'], follow_symlinks=False)
    if item['kind'] != 'link':
        os.chmod(path, item['mode'])
    elif stat.S_IMODE(path.lstat().st_mode) != item['mode'] and hasattr(os, 'lchmod'):
        os.lchmod(path, item['mode'])
    # Symlinks have fixed modes on Linux; a different recorded mode must fail.
    info = path.lstat()
    if (stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid) != (item['mode'], item['uid'], item['gid']):
        raise ValueError('restored metadata mismatch')


def restore(bundle, output):
    source = verified_manifest(bundle / 'source-manifest.json')
    expected = source['entries']
    receipt = json.loads((bundle / 'passed.json').read_text())
    archive = bundle / 'tree.tar.gz'
    actual_sha = digest(archive)
    if receipt.get('status') != 'passed' or actual_sha != receipt['archiveSha256'] or archive.stat().st_size != receipt['archiveBytes'] or source['entriesSha256'] != receipt['manifestEntriesSha256']:
        manifest.write_new(output / 'identity.diff.json', {'expectedArchiveSha256': receipt.get('archiveSha256'), 'actualArchiveSha256': actual_sha, 'expectedBytes': receipt.get('archiveBytes'), 'actualBytes': archive.stat().st_size})
        raise ValueError('archive identity mismatch')
    if missing_links(expected):
        raise ValueError('recorded closure is incomplete')
    tree = output / 'tree'
    tree.mkdir(mode=0o700)
    hard, links, seen = [], [], set()

    def archive_error(name, reason, expected_item=None, actual_item=None):
        manifest.write_new(output / 'archive.diff.json', [{'path': name, 'reason': reason, 'expected': expected_item, 'actual': actual_item}])
        raise ValueError('archive entry differs from captured source')
    with tarfile.open(archive) as stream:
        for entry in stream:
            name = member_name(entry.name)
            if name in seen or name not in expected:
                archive_error(name, 'unexpected or duplicate archive entry')
            seen.add(name)
            item = expected[name]
            if (entry.mode, entry.uid, entry.gid) != (item['mode'], item['uid'], item['gid']):
                archive_error(name, 'metadata', {k: item[k] for k in ('mode', 'uid', 'gid')}, {'mode': entry.mode, 'uid': entry.uid, 'gid': entry.gid})
            path = tree / name
            if name != '.':
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                if not path.parent.resolve().is_relative_to(tree):
                    raise ValueError('archive escapes restore root')
            if entry.isdir() and item['kind'] == 'dir':
                path.mkdir(mode=0o700, exist_ok=True)
            elif entry.isfile() and item['kind'] == 'file' and entry.size == item['bytes']:
                with stream.extractfile(entry) as src, path.open('xb') as dest:
                    for chunk in iter(lambda: src.read(1024 * 1024), b''):
                        dest.write(chunk)
            elif entry.islnk() and item['kind'] == 'file':
                target = member_name(entry.linkname)
                if expected.get(target, {}).get('kind') != 'file':
                    raise ValueError('invalid archive hardlink')
                hard.append((path, tree / target))
            elif entry.issym() and item['kind'] == 'link' and entry.linkname == item['target']:
                links.append((name, path, entry.linkname))
            else:
                archive_error(name, 'type, byte length or link target', item, {'tarType': str(entry.type), 'bytes': entry.size, 'target': entry.linkname})
    if seen != set(expected):
        manifest.write_new(output / 'archive.diff.json', [{'path': name, 'reason': 'missing'} for name in sorted(set(expected) - seen)])
        raise ValueError('archive entries missing')
    for path, target in hard:
        if not target.is_file() or not target.resolve().is_relative_to(tree):
            raise ValueError('unavailable archive hardlink')
        os.link(target, path)
    for _, path, value in links:
        path.symlink_to(value)
    for name in sorted(expected, key=lambda x: len(PurePosixPath(x).parts), reverse=True):
        metadata(tree / name, expected[name])
    original = manifest.capture(tree)
    manifest.write_new(output / 'restored-original-manifest.json', original)
    original_diff = manifest.differences(expected, original['entries'])
    manifest.write_new(output / 'original.diff.json', original_diff)
    if original_diff:
        raise ValueError('actual restoration differs from original archive')
    relocated_expected = {k: dict(v) for k, v in expected.items()}
    mapping = []
    for name, path, value in links:
        # Absolute links are changed in the private verification copy only.
        if PurePosixPath(value).is_absolute():
            target = tree / resolved(expected, name)
            replacement = os.path.relpath(target, path.parent)
            path.unlink()
            path.symlink_to(replacement)
            metadata(path, expected[name])
            relocated_expected[name]['target'] = replacement
            mapping.append({'path': name, 'originalTarget': value, 'relocatedTarget': replacement,
                            'resolvedLogicalTarget': resolved(expected, name),
                            'mode': expected[name]['mode'], 'uid': expected[name]['uid'], 'gid': expected[name]['gid']})
    relocated = manifest.capture(tree)
    manifest.write_new(output / 'restored-relocated-manifest.json', relocated)
    delta = manifest.differences(relocated_expected, relocated['entries'])
    manifest.write_new(output / 'relocated.diff.json', delta)
    manifest.write_new(output / 'link-relocation-map.json', mapping)
    if any(resolved(expected, name) != resolved(relocated['entries'], name) for name, _, _ in links):
        raise ValueError('relocation changes the resolved dependency identity')
    if delta or missing_links(relocated['entries']):
        raise ValueError('relocated restoration differs or closure is incomplete')
    for name, _, _ in links:
        path = tree / name
        if not path.exists() or not path.resolve().is_relative_to(tree):
            raise ValueError('restored dependency escapes or is missing')
    manifest.write_new(output / 'passed.json', {
        'schemaVersion': 1, 'status': 'passed', 'archiveSha256': receipt['archiveSha256'],
        'entries': len(expected), 'originalDifferences': [], 'relocatedDifferences': [],
        'allContentsTypesBytesModesUidGidAndLinksMatch': True,
        'relocationMap': 'link-relocation-map.json', 'missingLinks': [],
        'nativeImportsVerified': False, 'productionTransport': False})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['seal', 'restore'])
    parser.add_argument('--root')
    parser.add_argument('--bundle')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).absolute().resolve()
    # Never overwrite evidence or mutate the captured filesystem.
    if output.exists():
        print(json.dumps({'status': 'failed', 'error': 'output already exists'}))
        return 1
    if args.operation == 'seal' and args.root and output.is_relative_to(Path(args.root).absolute().resolve()):
        print(json.dumps({'status': 'failed', 'error': 'output must be outside source root'}))
        return 1
    output.mkdir(mode=0o700)
    try:
        if args.operation == 'seal':
            if not args.root or output.is_relative_to(Path(args.root).absolute().resolve()):
                raise ValueError('output must be outside source root')
            seal(args.root, output)
        else:
            if not args.bundle:
                raise ValueError('bundle required')
            restore(Path(args.bundle).absolute().resolve(), output)
        print(json.dumps({'status': 'passed', 'operation': args.operation, 'receipt': str(output / 'passed.json')}))
        return 0
    except Exception as error:
        failure = output / 'failure.json'
        if not failure.exists():
            manifest.write_new(failure, {'status': 'failed', 'errorClass': type(error).__name__,
                                         'error': 'dependency closure operation failed',
                                         'errorPath': getattr(error, 'path', None),
                                         'nativeImportsVerified': False})
        print(json.dumps({'status': 'failed', 'errorClass': type(error).__name__, 'receipt': str(failure)}))
        return 1


if __name__ == '__main__':
    os.umask(0o077)
    sys.exit(main())
