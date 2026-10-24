#!/usr/bin/env python3
"""Pure fixtures only: no APT, subprocess, network or environment installation."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('pr348_glib9_prefix', Path(__file__).with_name('pr348-glib9-prefix.py'))
PREFIX = importlib.util.module_from_spec(SPEC)
sys.dont_write_bytecode = True
SPEC.loader.exec_module(PREFIX)


def fixture():
    known = {name: {'Package': name, 'Architecture': 'all' if name in
             ('libglib2.0-data', 'libglib2.0-doc') else 'amd64'} for name in PREFIX.NAMES}
    known['libglib2.0-dev']['Depends'] = ('libglib2.0-0t64 (= ' + PREFIX.VERSION +
        '), libglib2.0-dev-bin-linux (= ' + PREFIX.VERSION + ')')
    known['libglib2.0-dev-bin']['Provides'] = 'libglib2.0-dev-bin-linux (= ' + PREFIX.VERSION + ')'
    rows = {name + (':amd64' if value['Architecture'] == 'amd64' else ''):
            [PREFIX.VERSION, 'glib2.0', PREFIX.VERSION, 'ii ', value['Architecture']]
            for name, value in known.items()}
    return known, rows


class PrefixGuardTests(unittest.TestCase):
    def test_initial_old_version_and_versioned_virtual_provider(self):
        known, rows = fixture()
        self.assertEqual(set(PREFIX.installed_glib(rows, known)), PREFIX.NAMES)

    def test_core_only_is_a_valid_installed_subset(self):
        known, rows = fixture()
        self.assertEqual(PREFIX.installed_glib({'libglib2.0-0t64:amd64': rows['libglib2.0-0t64:amd64']}, known),
                         {'libglib2.0-0t64': 'libglib2.0-0t64:amd64'})

    def test_upgraded_mixed_or_held_initial_glib_is_rejected(self):
        known, rows = fixture()
        for version, status in [('2.80.0-6ubuntu3.10', 'ii '), (PREFIX.VERSION, 'hi ')]:
            changed = copy.deepcopy(rows)
            changed['libglib2.0-0t64:amd64'][0] = version
            changed['libglib2.0-0t64:amd64'][3] = status
            with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^INITIAL_GLIB_VERSION$'):
                PREFIX.installed_glib(changed, known)

    def test_unknown_same_source_package_is_rejected(self):
        known, rows = fixture()
        rows['libglib-unknown:amd64'] = [PREFIX.VERSION, 'glib2.0', PREFIX.VERSION, 'ii ', 'amd64']
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^UNKNOWN_INSTALLED_GLIB$'):
            PREFIX.installed_glib(rows, known)

    def test_missing_versioned_provider_is_rejected(self):
        known, rows = fixture()
        del known['libglib2.0-dev-bin']['Provides']
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^INITIAL_GLIB_CLOSURE$'):
            PREFIX.installed_glib(rows, known)

    def test_wrong_provider_version_does_not_close_old_dependency(self):
        known, rows = fixture()
        known['libglib2.0-dev-bin']['Provides'] = 'libglib2.0-dev-bin-linux (= 2.80.0-6ubuntu3.10)'
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^INITIAL_GLIB_CLOSURE$'):
            PREFIX.installed_glib(rows, known)

    def test_multiarch_and_partial_state_are_rejected(self):
        known, rows = fixture()
        rows['libglib2.0-0t64:amd64'][-1] = 'i386'
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^INITIAL_GLIB_ARCH$'):
            PREFIX.installed_glib(rows, known)
        known, rows = fixture()
        rows['libglib2.0-0t64:amd64'][3] = 'iU '
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^INITIAL_GLIB_STATE$'):
            PREFIX.installed_glib(rows, known)

    def test_tampered_index_is_rejected_before_decompression(self):
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^INDEX_HASH$'):
            PREFIX.candidates(b'tampered public package metadata')

    def test_duplicate_manifest_name_is_rejected(self):
        row = 'libglib2.0-0t64:amd64\t' + PREFIX.VERSION + '\tglib2.0\t' + PREFIX.VERSION + '\tii \tamd64\n'
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^DPKG_FORMAT$'):
            PREFIX.manifest(row + row)

    def test_only_official_current_sources_are_copied_with_https(self):
        source = ('Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu\n'
                  'Suites: noble noble-updates noble-security\nComponents: main universe\n'
                  'Signed-By: ' + PREFIX.KEYRING + '\n')
        rows = PREFIX.copied_sources([('.sources', source), ('.list', 'deb https://example.invalid/ubuntu noble main\n')])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['uri'], 'https://azure.archive.ubuntu.com/ubuntu')
        self.assertEqual(rows[0]['components'], ['main', 'universe'])

    def test_source_credentials_and_trust_bypass_are_rejected_without_echo(self):
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^SOURCE_URI$') as error:
            PREFIX.official_source('https://user:secret@archive.ubuntu.com/ubuntu', ['noble'], ['main'])
        self.assertNotIn('secret', str(error.exception))
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^SOURCE_OPTIONS$'):
            PREFIX.copied_sources([('.list', 'deb [trusted=yes] https://archive.ubuntu.com/ubuntu noble main\n')])

    def test_fixed_github_mirror_file_source_is_preserved_for_private_rebinding(self):
        text = ('Types: deb\nURIs: ' + PREFIX.MIRROR_URI + '\nSuites: noble noble-updates noble-security\n'
                'Components: main universe\nSigned-By: ' + PREFIX.KEYRING + '\n')
        result = PREFIX.copied_sources([('.sources', text)])
        self.assertEqual(result[0]['uri'], PREFIX.MIRROR_URI)
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^SOURCE_MIRROR_PATH$'):
            PREFIX.official_source('mirror+file:/etc/other-private-file', ['noble'], ['main'])

    def test_azure_http_is_removed_only_when_official_https_already_exists(self):
        text = ('http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n'
                'https://archive.ubuntu.com/ubuntu/\tpriority:2\n'
                'https://security.ubuntu.com/ubuntu/\tpriority:3\n')
        copied = PREFIX.trusted_mirrors(text)
        self.assertNotIn('azure', copied)
        self.assertIn('priority:2', copied)
        with self.assertRaisesRegex(PREFIX.EnvironmentFailure, '^MIRROR_HTTPS_MISSING$'):
            PREFIX.trusted_mirrors('http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n')

    def test_mirror_credentials_unknown_hosts_and_extra_options_are_rejected(self):
        for value in ['https://secret@archive.ubuntu.com/ubuntu/\n',
                      'https://example.invalid/ubuntu/\n',
                      'https://archive.ubuntu.com/ubuntu/ token:secret\n']:
            with self.assertRaises(PREFIX.EnvironmentFailure) as error:
                PREFIX.trusted_mirrors(value)
            self.assertNotIn('secret', str(error.exception))

    def test_preferences_cannot_select_upgraded_or_unknown_glib(self):
        value = PREFIX.apt_preferences()
        self.assertIn('Pin: version ' + PREFIX.VERSION + '\nPin-Priority: 990', value)
        self.assertIn('Package: src:glib2.0:any\nPin: version *\nPin-Priority: -1', value)
        self.assertNotIn('1001', value)  # This prefix must not authorize downgrades.

    def test_private_apt_configuration_keeps_compressed_indexes_and_security_guards(self):
        apt = Path('/private/task/apt')
        settings = dict(line[:-1].split(' ', 1) for line in PREFIX.apt_configuration(apt).splitlines())
        expected_paths = {'Dir::Etc::sourcelist': 'sources.list', 'Dir::Etc::sourceparts': 'sources',
            'Dir::Etc::preferences': 'preferences', 'Dir::Etc::preferencesparts': 'preferences.d',
            'Dir::Etc::parts': 'config.d', 'Dir::Etc::main': 'main.conf',
            'Dir::State::lists': 'lists', 'Dir::Cache::archives': 'archives'}
        self.assertEqual({key: value for key, value in settings.items() if key.startswith('Dir::')},
                         {key: '"' + str(apt / value) + '"' for key, value in expected_paths.items()})
        for key, value in {'Acquire::Check-Valid-Until': 'true', 'Acquire::AllowInsecureRepositories': 'false',
                           'Acquire::https::Verify-Peer': 'true', 'Acquire::https::Verify-Host': 'true',
                           'APT::Get::Remove': 'false', 'APT::Install-Recommends': 'false',
                           'Acquire::Retries': '0', 'Acquire::https::Timeout': '20'}.items():
            self.assertEqual(settings.get(key), '"' + value + '"', key)
        self.assertEqual(settings.get('Acquire::GzipIndexes'), '"true"')

    def test_dependency_command_preserves_only_explicit_apt_config(self):
        args = PREFIX.dependency_command(PREFIX.NODE, '/work/playwright-core/cli.js', '/private/task.conf', '/private/home', 590)
        self.assertEqual(args[:5], ['/usr/bin/sudo', '-n', '/usr/bin/env', '-i', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'])
        self.assertIn('APT_CONFIG=/private/task.conf', args)
        self.assertEqual(args[-5:], [str(PREFIX.NODE), '/work/playwright-core/cli.js', 'install-deps', 'chromium', 'webkit'])
        self.assertFalse(any('NODE_OPTIONS' in arg or 'TOKEN' in arg or arg == '-E' for arg in args))
        self.assertIn('--kill-after=5s', args)

    def test_dependency_command_rejects_unfixed_node_relative_path_and_wrong_cli(self):
        for node, cli, config in [('/tmp/node', '/work/cli.js', '/private/task.conf'),
                                  (str(PREFIX.NODE), 'cli.js', '/private/task.conf'),
                                  (str(PREFIX.NODE), '/work/other.js', '/private/task.conf'),
                                  (str(PREFIX.NODE), '/work/cli.js', '/private/config\nsecret')]:
            with self.assertRaises(PREFIX.EnvironmentFailure):
                PREFIX.dependency_command(node, cli, config, '/private/home', 10)

    def test_invalid_public_cli_is_fixed_failure_and_never_executes(self):
        output = io.StringIO()
        with patch.object(PREFIX.sys, 'argv', ['prefix', '--unexpected-secret-value']), \
             patch.object(PREFIX, 'execute') as execute, contextlib.redirect_stdout(output):
            self.assertEqual(PREFIX.main(), 20)
        self.assertEqual(json.loads(output.getvalue()), {'status': 'environment_failed', 'reason': 'CLI_GUARD'})
        execute.assert_not_called()


if __name__ == '__main__':
    unittest.main()
