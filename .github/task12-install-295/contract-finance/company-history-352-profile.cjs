'use strict';

const assert = require('node:assert/strict');
const previous = require('./signed-settlement-350-profile.cjs');

const mode = 'company-history-352';
const count = 352;
const tails = Object.freeze([
  Object.freeze({ name: '20261129020000_company_transfer_settled_return',
    sha256: 'cbaf785b470e8e0de1d79256e9ed19b181bf875131c741d866754fd1277d8fff', finished: true, rolledBack: false }),
  Object.freeze({ name: '20261129021000_company_history_expense',
    sha256: '8cb43f1ae9a6fb6108280f1ea08df4d2d2edf7c060b39b37dfbeeaff7ae368e5', finished: true, rolledBack: false })
]);
const terminal = tails[1];
const prefix351 = '53d70b4560eee375eb2a587596ec096c5f0d89762f25b1744d363ba18fdd69dc';
const ledgerSha256 = '155903a7032c978e10b8d73f48a0621bf9561ae69ef58a0128d2455f1ccfa5f8';

function assertSource(source, predecessor295) {
  assert.equal(source.mode, mode, 'COMPANY_HISTORY_352_MODE');
  assert.equal(source.migrationCount, count, 'COMPANY_HISTORY_352_COUNT');
  assert.equal(source.ledgerSha256, ledgerSha256, 'COMPANY_HISTORY_352_LEDGER');
  assert.deepEqual(source.predecessor350, { migrationCount: previous.count, ledgerSha256: previous.ledgerSha256 },
    'COMPANY_HISTORY_352_PREDECESSOR');
  assert.equal(source.tails.length, count - 295, 'COMPANY_HISTORY_352_TAIL_COUNT');
  assert.deepEqual(source.tails.slice(-2), tails, 'COMPANY_HISTORY_352_TERMINAL_MIGRATIONS');
  previous.assertSource({ ...source, mode: previous.mode, migrationCount: previous.count,
    ledgerSha256: previous.ledgerSha256, tails: source.tails.slice(0, -2) }, predecessor295);
}

function assertPrefix(size, digest) {
  if (size === count) assert.equal(digest, ledgerSha256, 'COMPANY_HISTORY_352_PREFIX');
  else if (size === 351) assert.equal(digest, prefix351, 'COMPANY_HISTORY_351_PREFIX');
  else previous.assertPrefix(size, digest);
}

function assertRuntimeBaseline({ loadManifest, deriveMigrationBaseline, DEFAULT_MANIFEST_PATH }) {
  const expected = [count, terminal.name, terminal.sha256];
  const tuple = row => [row.expectedDirectoryCount, row.terminalMigration, row.terminalMigrationChecksum];
  assert.deepEqual(tuple(loadManifest(DEFAULT_MANIFEST_PATH).migrationBaseline), expected, 'COMPANY_HISTORY_352_MANIFEST');
  assert.deepEqual(tuple(deriveMigrationBaseline()), expected, 'COMPANY_HISTORY_352_RUNTIME');
}

module.exports = { mode, count, tails, terminal, prefix351, ledgerSha256, assertSource, assertPrefix, assertRuntimeBaseline };
