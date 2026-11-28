'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('352 POL108 installer exposes the 352 entry without calling an older entry', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'jg-pol108-export-'));
  const out = path.join(work, 'material');
  try {
    execFileSync('python3', [path.join(__dirname, 'stage-pol108.py'),
      path.resolve(__dirname, '../../task12-install-289'),
      path.resolve(__dirname, '../../task12-install-290'),
      path.join(__dirname, 'common'), out, 'core', '352']);
    assert.equal(typeof require(path.join(out, 'installer.cjs')).withPol108At352, 'function');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
