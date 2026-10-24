#!/usr/bin/env python3
"""One disposable Ubuntu CI prefix; keep preinstalled GLib .9, never downgrade.

Private command output stays below --private-root. Only public-result.json and
one fixed-schema stdout record are safe to publish. This is environment evidence,
not a reconstruction of the historical host or proof of the PR's root cause.
"""
import argparse
import hashlib
import json
import lzma
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import time
import urllib.parse
import urllib.request

VERSION = '2.80.0-6ubuntu3.9'
SNAPSHOT = 'https://snapshot.ubuntu.com/ubuntu/20261019T160000Z'
RELEASE_SHA = '05c2c50a69e01a09541b744202c5267e5cdf0392f9cc5e3668f6771236c9ebd1'
INDEX_SHA = '1b79de5bbdc9bfffde72130dac32d60ce0a3c12d1c9d4295d9bf840462028c86'
INDEX_BYTES = 1397080
CLI_SHA = '7c46f799363eee3e0bb7a7d7c870a92316a1601bf6fda780b656df4209542aa9'
CORE_SHA = '2325ca4c1c83070e89dc49fb82525508f0a68e0cf12e2a624277968da216b7e0'
NODE = Path('/opt/hostedtoolcache/node/20.20.2/x64/bin/node')
KEYRING = '/usr/share/keyrings/ubuntu-archive-keyring.gpg'
MIRROR_URI = 'mirror+file:/etc/apt/apt-mirrors.txt'
NAMES = frozenset(('gir1.2-girepository-3.0', 'gir1.2-girepository-3.0-dev',
    'gir1.2-glib-2.0', 'gir1.2-glib-2.0-dev', 'libgirepository-2.0-0',
    'libglib2.0-0t64', 'libglib2.0-bin', 'libglib2.0-data', 'libglib2.0-dev',
    'libglib2.0-dev-bin', 'libglib2.0-doc'))
HOSTS = frozenset(('archive.ubuntu.com', 'security.ubuntu.com', 'azure.archive.ubuntu.com'))
SUITES = frozenset(('noble', 'noble-updates', 'noble-security', 'noble-backports'))
COMPONENTS = frozenset(('main', 'universe', 'restricted', 'multiverse'))
FORMAT = '${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\t${db:Status-Abbrev}\t${Architecture}\n'


class EnvironmentFailure(Exception):
    pass


def require(condition, code):
    if not condition:
        raise EnvironmentFailure(code)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def paragraphs(text):
    result = []
    for block in re.split(r'\n\s*\n', text):
        row = {}
        key = None
        for line in block.splitlines():
            if not line or line.startswith('#'):
                continue
            if line[0].isspace() and key:
                row[key] += '\n' + line
            else:
                require(': ' in line, 'METADATA_FORMAT')
                key, value = line.split(': ', 1)
                require(key not in row, 'METADATA_FORMAT')
                row[key] = value
        if row:
            result.append(row)
    return result


def candidates(raw):
    require(len(raw) == INDEX_BYTES and hashlib.sha256(raw).hexdigest() == INDEX_SHA, 'INDEX_HASH')
    result = {}
    for row in paragraphs(lzma.decompress(raw).decode()):
        if row.get('Source', '').split(' ')[0] != 'glib2.0':
            continue
        name = row.get('Package')
        require(name in NAMES and name not in result, 'UNKNOWN_GLIB_METADATA')
        require(row.get('Version') == VERSION and row.get('Architecture') in ('amd64', 'all'), 'GLIB_METADATA_VERSION')
        require(re.fullmatch('[a-f0-9]{64}', row.get('SHA256', '')) is not None, 'GLIB_METADATA_HASH')
        require(row.get('Filename', '').startswith('pool/main/g/glib2.0/') and '..' not in row['Filename'], 'GLIB_METADATA_PATH')
        result[name] = row
    require(set(result) == NAMES, 'GLIB_METADATA_CLOSURE')
    return result


def manifest(text):
    rows = {}
    for line in text.splitlines():
        fields = line.split('\t')
        require(len(fields) == 6 and fields[0] not in rows, 'DPKG_FORMAT')
        rows[fields[0]] = fields[1:]
    return rows


def installed_glib(rows, known):
    found = {}
    for binary, row in rows.items():
        version, source, source_version, status, arch = row
        if source != 'glib2.0':
            continue
        if len(status) < 2 or status[1] != 'i':
            require(status in ('rc ', 'un '), 'INITIAL_GLIB_STATE')
            continue
        name = binary.split(':', 1)[0]
        require(name in known and name not in found, 'UNKNOWN_INSTALLED_GLIB')
        require(status == 'ii ' and version == source_version == VERSION, 'INITIAL_GLIB_VERSION')
        require(arch == known[name]['Architecture'], 'INITIAL_GLIB_ARCH')
        found[name] = binary
    require('libglib2.0-0t64' in found, 'INITIAL_GLIB_MISSING')
    # Versioned Provides matters: dev-bin supplies dev-bin-linux. This checks
    # only exact GLib constraints, leaving all other dependency solving to APT.
    exact = re.compile(r'([a-z0-9.+-]+)(?::[a-z0-9-]+)?\s*\(=\s*' + re.escape(VERSION) + r'\)')
    providers = set(found)
    for name in found:
        providers.update(exact.findall(known[name].get('Provides', '')))
    for name in found:
        for group in (known[name].get('Depends', '') + ',' + known[name].get('Pre-Depends', '')).split(','):
            needed = exact.findall(group)
            require(not needed or any(item in providers for item in needed), 'INITIAL_GLIB_CLOSURE')
    return found


def official_source(uri, suites, components):
    if uri.startswith('mirror+file:'):
        require(uri == MIRROR_URI, 'SOURCE_MIRROR_PATH')
        require(set(suites) <= SUITES and suites and set(components) <= COMPONENTS and components, 'SOURCE_SUITE')
        return {'uri': uri, 'suites': suites, 'components': components}
    value = urllib.parse.urlsplit(uri)
    if value.hostname not in HOSTS:
        return None  # Third-party sources are never copied into the task config.
    require(value.scheme in ('http', 'https') and not value.username and not value.password
            and not value.query and not value.fragment and value.port in (None, 80, 443), 'SOURCE_URI')
    require(value.path.rstrip('/') == '/ubuntu', 'SOURCE_URI')
    require(set(suites) <= SUITES and suites and set(components) <= COMPONENTS and components, 'SOURCE_SUITE')
    return {'uri': 'https://' + value.hostname + '/ubuntu', 'suites': suites, 'components': components}


def trusted_mirrors(text):
    require(len(text.encode()) <= 100000, 'MIRROR_METADATA_LIMIT')
    entries = [line.split() for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#')]
    azure = 'http://azure.archive.ubuntu.com/ubuntu/'
    official_https = {'https://archive.ubuntu.com/ubuntu/', 'https://security.ubuntu.com/ubuntu/'}
    urls = {entry[0] for entry in entries}
    if azure in urls:
        require(bool(urls & official_https), 'MIRROR_HTTPS_MISSING')
        entries = [entry for entry in entries if entry[0] != azure]
    require(entries, 'MIRROR_HTTPS_MISSING')
    for entry in entries:
        uri = urllib.parse.urlsplit(entry[0])
        require(uri.scheme == 'https' and uri.hostname in HOSTS and not uri.username and not uri.password
                and not uri.query and not uri.fragment and uri.port in (None, 443)
                and uri.path.rstrip('/') == '/ubuntu', 'MIRROR_URI')
        require(all(re.fullmatch(r'priority:[0-9]+', token) for token in entry[1:]), 'MIRROR_OPTIONS')
    return ''.join('\t'.join(entry) + '\n' for entry in entries)


def copied_sources(files):
    found = []
    require(sum(len(text.encode()) for _, text in files) <= 1000000, 'SOURCE_METADATA_LIMIT')
    for suffix, text in files:
        if suffix == '.sources':
            for row in paragraphs(text):
                if row.get('Enabled', 'yes') == 'no' or 'deb' not in row.get('Types', '').split():
                    continue
                for uri in row.get('URIs', '').split():
                    item = official_source(uri, row.get('Suites', '').split(), row.get('Components', '').split())
                    if item:
                        require(row.get('Signed-By') == KEYRING, 'SOURCE_KEYRING')
                        found.append(item)
        else:
            for line in text.splitlines():
                line = line.split('#', 1)[0].strip()
                if not line or line.startswith('deb-src '):
                    continue
                match = re.fullmatch(r'deb\s+(?:\[([^]]+)\]\s+)?(\S+)\s+(\S+)\s+(.+)', line)
                require(match is not None, 'SOURCE_FORMAT')
                options, uri, suite, components = match.groups()
                item = official_source(uri, [suite], components.split())
                if item:
                    require(not options or all(part in ('arch=amd64', 'signed-by=' + KEYRING) for part in options.split()), 'SOURCE_OPTIONS')
                    found.append(item)
    require(found and {'noble', 'noble-updates', 'noble-security'} <= {s for row in found for s in row['suites']}, 'OFFICIAL_SOURCES_MISSING')
    return found


def apt_preferences():
    # Unknown GLib binaries and versions are ineligible; explicit reviewed names
    # at .9 are the only exceptions. Source pins are supported by Ubuntu APT 2.8.
    return ('Package: ' + ' '.join(sorted(NAMES)) + '\nPin: version ' + VERSION +
            '\nPin-Priority: 990\n\nPackage: src:glib2.0:any\nPin: version *\nPin-Priority: -1\n')


def dependency_command(node, cli, config, home, seconds):
    require(all(Path(p).is_absolute() and '\n' not in str(p) for p in (node, cli, config, home)), 'COMMAND_PATH')
    require(Path(node) == NODE and Path(cli).name == 'cli.js', 'COMMAND_PATH')
    require(1 <= seconds <= 600, 'COMMAND_TIMEOUT')
    return ['/usr/bin/sudo', '-n', '/usr/bin/env', '-i', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            'HOME=' + str(home), 'CI=true', 'DEBIAN_FRONTEND=noninteractive', 'APT_CONFIG=' + str(config),
            '/usr/bin/timeout', '--signal=TERM', '--kill-after=5s', str(seconds) + 's',
            str(node), str(cli), 'install-deps', 'chromium', 'webkit']


def execute(args, root):
    deadline = time.monotonic() + 600
    clean = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(root), 'LC_ALL': 'C'}
    def remaining():
        value = int(deadline - time.monotonic())
        require(value > 5, 'PREFIX_TIMEOUT')
        return value
    def run(command, label, env=None):
        seconds = remaining()
        proc = subprocess.run(command, cwd=root, env=env or clean, capture_output=True, timeout=seconds + 5)
        (root / (label + '.stdout')).write_bytes(proc.stdout)
        (root / (label + '.stderr')).write_bytes(proc.stderr)
        require(proc.returncode == 0, 'PREFIX_COMMAND_FAILED')
        return proc.stdout.decode()
    require(os.geteuid() != 0 and os.uname().sysname == 'Linux', 'RUNNER_BASELINE')
    release = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    require(release.get('ID', '').strip('"') == 'ubuntu' and release.get('VERSION_ID', '').strip('"') == '24.04', 'RUNNER_BASELINE')
    require(run(['/usr/bin/dpkg', '--print-architecture'], 'architecture').strip() == 'amd64', 'RUNNER_ARCH')
    node, cli = Path(args.node).resolve(), Path(args.playwright_cli).resolve()
    require(Path(args.node).is_absolute() and Path(args.playwright_cli).is_absolute()
            and node == NODE and node.is_file() and cli.is_file() and os.access(node, os.X_OK), 'COMMAND_PATH')
    require(run([str(node), '--version'], 'node-version').strip() == 'v20.20.2', 'NODE_VERSION')
    package = json.loads((cli.parent / 'package.json').read_text())
    require(package.get('name') == 'playwright-core' and package.get('version') == '1.64.0'
            and digest(cli) == CLI_SHA and digest(cli.parent / 'lib/coreBundle.js') == CORE_SHA, 'PLAYWRIGHT_IDENTITY')
    command_pins = {str(path): digest(path) for path in (node, cli, cli.parent / 'lib/coreBundle.js')}
    before = manifest(run(['/usr/bin/dpkg-query', '-W', '-f=' + FORMAT], 'dpkg-before'))
    # Reject a mixed/upgraded initial GLib state before any APT operation.
    initial_names = {binary.split(':', 1)[0] for binary, row in before.items() if row[1] == 'glib2.0' and len(row[3]) > 1 and row[3][1] == 'i'}
    require(initial_names <= NAMES and initial_names, 'UNKNOWN_INSTALLED_GLIB')
    require(all(row[0] == row[2] == VERSION and row[3] == 'ii ' for row in before.values()
                if row[1] == 'glib2.0' and len(row[3]) > 1 and row[3][1] == 'i'), 'INITIAL_GLIB_VERSION')
    context = ssl.create_default_context(cafile='/etc/ssl/certs/ca-certificates.crt')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))
    fetched = 0
    for suffix, filename, expected, cap in (
        ('InRelease', 'snapshot.InRelease', RELEASE_SHA, 200000),
        ('main/binary-amd64/Packages.xz', 'snapshot.Packages.xz', INDEX_SHA, 1500000),
    ):
        with opener.open(SNAPSHOT + '/dists/noble-updates/' + suffix, timeout=min(20, remaining())) as response:
            require(urllib.parse.urlsplit(response.url).scheme == 'https'
                    and urllib.parse.urlsplit(response.url).hostname == 'snapshot.ubuntu.com', 'METADATA_REDIRECT')
            data = response.read(cap + 1)
        fetched += len(data)
        require(len(data) <= cap and fetched <= 100000000 and hashlib.sha256(data).hexdigest() == expected, 'SNAPSHOT_METADATA_HASH')
        (root / filename).write_bytes(data)
    known = candidates((root / 'snapshot.Packages.xz').read_bytes())
    initial = installed_glib(before, known)
    (root / 'gpgv-home').mkdir(mode=0o700)
    run(['/usr/bin/gpgv', '--homedir', str(root / 'gpgv-home'), '--keyring', KEYRING,
         str(root / 'snapshot.InRelease')], 'snapshot-signature')
    signed = (root / 'snapshot.InRelease').read_text().split('SHA256:\n', 1)[1]
    require(any(line.split() == [INDEX_SHA, str(INDEX_BYTES), 'main/binary-amd64/Packages.xz']
                for line in signed.splitlines()), 'RELEASE_INDEX_LINK')
    paths = ([Path('/etc/apt/sources.list')] if Path('/etc/apt/sources.list').is_file() else [])
    paths += sorted(path for path in Path('/etc/apt/sources.list.d').iterdir() if path.suffix in ('.list', '.sources') and path.is_file())
    sources = copied_sources([(path.suffix, path.read_text()) for path in paths])
    apt = root / 'apt'
    for sub in ('sources', 'preferences.d', 'config.d', 'lists/partial', 'archives/partial'):
        (apt / sub).mkdir(parents=True)
    for name in ('sources.list', 'main.conf'):
        (apt / name).write_text('')
    original_mirrors = Path('/etc/apt/apt-mirrors.txt')
    if original_mirrors.is_file():
        (apt / 'mirrors.txt').write_text(trusted_mirrors(original_mirrors.read_text()))
    def source_text(uri, suites, components):
        return ('Types: deb\nURIs: ' + uri + '\nSuites: ' + ' '.join(suites) + '\nComponents: ' +
                ' '.join(components) + '\nArchitectures: amd64\nSigned-By: ' + KEYRING + '\n')
    for i, source in enumerate(sources):
        if source['uri'] == MIRROR_URI:
            require((apt / 'mirrors.txt').is_file(), 'MIRROR_HTTPS_MISSING')
            source = {**source, 'uri': 'mirror+file:' + str(apt / 'mirrors.txt')}
        (apt / 'sources' / ('official-' + str(i) + '.sources')).write_text(source_text(source['uri'], source['suites'], source['components']))
    (apt / 'sources/snapshot.sources').write_text(source_text(SNAPSHOT, ['noble-updates'], ['main']))
    (apt / 'preferences').write_text(apt_preferences())
    config = apt / 'task.conf'
    settings = {'Dir::Etc::sourcelist': apt / 'sources.list', 'Dir::Etc::sourceparts': apt / 'sources',
        'Dir::Etc::preferences': apt / 'preferences', 'Dir::Etc::preferencesparts': apt / 'preferences.d',
        'Dir::Etc::parts': apt / 'config.d', 'Dir::Etc::main': apt / 'main.conf',
        'Dir::State::lists': apt / 'lists', 'Dir::Cache::archives': apt / 'archives'}
    config.write_text(''.join(key + ' "' + str(value) + '";\n' for key, value in settings.items()) +
        'Acquire::Languages "none";\nAcquire::Retries "0";\nAcquire::https::Timeout "20";\n'
        'Acquire::Check-Valid-Until "true";\nAcquire::AllowInsecureRepositories "false";\n'
        'Acquire::https::Verify-Peer "true";\nAcquire::https::Verify-Host "true";\n'
        'APT::Get::Remove "false";\nAPT::Install-Recommends "false";\n')
    commands = dependency_command(node, cli, config, root, remaining() - 5)
    (root / 'dependency-command.json').write_text(json.dumps(commands) + '\n')
    run(commands, 'playwright-system-dependencies')
    apt_metadata_bytes = sum(path.stat().st_size for path in (apt / 'lists').rglob('*') if path.is_file())
    require(fetched + apt_metadata_bytes <= 100000000, 'APT_METADATA_LIMIT')
    after = manifest(run(['/usr/bin/dpkg-query', '-W', '-f=' + FORMAT], 'dpkg-after'))
    final = installed_glib(after, known)
    require(set(initial) <= set(final), 'INSTALLED_GLIB_REMOVED')
    require(all(binary in after and len(after[binary][3]) > 1 and after[binary][3][1] == 'i'
                for binary, row in before.items() if len(row[3]) > 1 and row[3][1] == 'i'), 'INSTALLED_PACKAGE_REMOVED')
    for name in set(final) - set(initial):
        package_file = apt / 'archives' / Path(known[name]['Filename']).name
        require(package_file.is_file() and package_file.stat().st_size == int(known[name]['Size'])
                and digest(package_file) == known[name]['SHA256'], 'NEW_GLIB_PACKAGE_HASH')
    require(all(digest(path) == value for path, value in command_pins.items()), 'COMMAND_IDENTITY_CHANGED')
    def nss(rows):
        return sorted({row[0] for binary, row in rows.items() if binary.split(':', 1)[0] == 'libnss3' and len(row[3]) > 1 and row[3][1] == 'i'})
    return {'status': 'qualified', 'scope': 'glib9-prefix-only', 'glibVersion': VERSION,
            'initialGlibNames': sorted(initial), 'finalGlibNames': sorted(final),
            'nssBefore': nss(before), 'nssAfter': nss(after), 'snapshotSignatureVerified': True,
            'observedMetadataBytes': fetched + apt_metadata_bytes, 'observedMetadataSizeLimit': 100000000,
            'nodeVersion': '20.20.2', 'playwrightVersion': '1.64.0',
            'applicationsBrowsersDatabaseStarted': False}


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        raise EnvironmentFailure('CLI_GUARD')


def main():
    root = None
    try:
        parser = SafeParser(description=__doc__)
        parser.add_argument('--private-root', required=True)
        parser.add_argument('--node', required=True)
        parser.add_argument('--playwright-cli', required=True)
        args = parser.parse_args()
        requested = Path(args.private_root)
        require(requested.is_absolute() and not requested.exists() and requested.parent.is_dir()
                and re.fullmatch(r'[A-Za-z0-9_./-]+', str(requested)) is not None, 'PRIVATE_ROOT')
        os.umask(0o077)
        requested.mkdir(mode=0o700)
        root = requested.resolve()
        result = execute(args, root)
        code = 0
    except EnvironmentFailure as error:
        result, code = {'status': 'environment_failed', 'reason': str(error)}, 20
    except (Exception, KeyboardInterrupt):
        result, code = {'status': 'environment_failed', 'reason': 'INTERNAL_ENVIRONMENT_FAILURE'}, 20
    if root is not None:
        (root / 'public-result.json').write_text(json.dumps(result, sort_keys=True) + '\n')
    print(json.dumps(result, sort_keys=True))
    return code


if __name__ == '__main__':
    sys.exit(main())
