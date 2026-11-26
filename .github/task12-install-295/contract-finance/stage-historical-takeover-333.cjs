'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { installerSha256 } = require('./historical-takeover-333-profile.cjs');

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.ok(process.argv.length === 3 || process.argv.length === 4);
const mode = process.argv[3] ?? 'historical-takeover-333';
assert.ok(['historical-takeover-333', 'historical-settlement-334', 'historical-settlement-334-restore', 'historical-settlement-334-remaining'].includes(mode));
const output = fs.realpathSync(process.argv[2]);
const original = path.join(__dirname, 'common/installer.cjs');
const installer = path.join(output, 'installer.cjs');
assert.equal(hash(original), '5f6e2959275504ff409928e6cab08e9cffabacc8dd22e484399db3b3671056d0', 'A28_INSTALLER_PREIMAGE');
fs.copyFileSync(original, installer, fs.constants.COPYFILE_EXCL);
execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, 'historical-takeover-333-installer.patch')], { cwd: output });
assert.equal(hash(installer), installerSha256, 'A28_INSTALLER_POSTIMAGE');
if (mode !== 'historical-takeover-333') {
  const next = require('./historical-settlement-334-profile.cjs');
  execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, 'historical-settlement-334-installer.patch')], { cwd: output });
  assert.equal(hash(installer), next.installerSha256, 'A28_334_INSTALLER_POSTIMAGE');
  if (mode === 'historical-settlement-334-remaining') {
    execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, 'historical-settlement-334-remaining-installer.patch')], { cwd: output });
    assert.equal(hash(installer), 'dd09fc0b457761a8b9779661c4ee8b47e7805b988e9e9548562b5999fbdaa0df', 'A28_334_REMAINING_INSTALLER_POSTIMAGE');
  }
  if (mode === 'historical-settlement-334-restore') {
    execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, 'historical-settlement-334-restore-installer.patch')], { cwd: output });
    assert.equal(hash(installer), next.restoreInstallerSha256, 'A28_334_RESTORE_INSTALLER_POSTIMAGE');
  }
}
fs.chmodSync(installer, 0o644);
