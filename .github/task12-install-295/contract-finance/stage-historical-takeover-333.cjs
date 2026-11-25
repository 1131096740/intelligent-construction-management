'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { installerSha256 } = require('./historical-takeover-333-profile.cjs');

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(process.argv.length, 3);
const output = fs.realpathSync(process.argv[2]);
const original = path.join(__dirname, 'common/installer.cjs');
const installer = path.join(output, 'installer.cjs');
assert.equal(hash(original), '5f6e2959275504ff409928e6cab08e9cffabacc8dd22e484399db3b3671056d0', 'A28_INSTALLER_PREIMAGE');
fs.copyFileSync(original, installer, fs.constants.COPYFILE_EXCL);
execFileSync('git', ['apply', '--unidiff-zero', path.join(__dirname, 'historical-takeover-333-installer.patch')], { cwd: output });
assert.equal(hash(installer), installerSha256, 'A28_INSTALLER_POSTIMAGE');
fs.chmodSync(installer, 0o644);
