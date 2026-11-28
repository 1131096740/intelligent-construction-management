'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readdirSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('352 payment materials remain readable after patching under a private umask', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'jg-payment-permissions-'));
  const stage = path.join(root, 'material');
  const previous = process.umask(0o077);
  try {
    execFileSync('python3', [path.join(__dirname, 'stage-payment-execution.py'),
      path.resolve(__dirname, '../../task12-install-290/payment'),
      path.join(__dirname, 'common'), stage, '--company-history-352']);
    const pending = [stage];
    let count = 0;
    while (pending.length) {
      const directory = pending.pop();
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const name = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(name);
        else if (entry.isFile()) { assert.equal(statSync(name).mode & 0o777, 0o644, name); count++; }
      }
    }
    assert.ok(count > 0);
  } finally {
    process.umask(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
