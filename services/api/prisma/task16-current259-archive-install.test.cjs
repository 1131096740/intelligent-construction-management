'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInThisContext } = require('node:vm');

const expectedInstallers = [
  'jg_install_contract_direct_archive_outside_v1',
  'jg_install_direct_outside_operating_archive_read_v2',
  'jg_install_direct_outside_operating_parent_v2',
  'jg_install_direct_outside_operating_slot_v2',
  'jg_install_direct_outside_operating_version_v2',
  'jg_install_direct_outside_runtime_tls_v2',
  'jg_install_direct_outside_operating_assignment_lock_v2',
  'jg_install_direct_outside_operating_reference_clock_v2',
  'jg_install_direct_outside_operating_pair_v2',
  'jg_install_direct_outside_operating_archive_completion_v2',
  'jg_install_direct_outside_operating_generation_v2',
  'jg_install_direct_outside_operating_nonce_v2',
  'jg_install_direct_outside_operating_basis_bridge_v2',
  'jg_install_contract_direct_upward_v2',
];

function model(alter = row => row, alterClaim = () => {}) {
  const handle = Object.freeze({}), provisionResult = Object.freeze({});
  const runId = '01234567-89ab-cdef-0123-456789abcdef';
  const databaseIdentity = {
    database: 'jg_task01_0123456789abcdef0123456789abcdef', databaseOid: '16384',
    namespaceOid: '2200', systemIdentifier: '1234567890123456789', ownerOid: '10',
  };
  const roles = [
    ['jg_c259_outside_executor_login', true], ['jg_c259_outside_executor_owner', false],
    ['jg_c259_outside_issuer_login', true], ['jg_c259_outside_issuer_owner', false],
    ['jg_c259_upward_issuer_login', true], ['jg_c259_upward_issuer_owner', false],
    ['jg_c259_upward_runtime_login', true], ['jg_task01_observer', true], ['jg_task01_runtime', true],
  ].map(([name, login], index) => ({ name, login, oid: String(17001 + index) }));
  const completion = {
    sourceSha: 'a'.repeat(40), runId, containerId: 'b'.repeat(64), databaseIdentity,
    ordinary: { name: 'jg_fixture_app_' + 'c'.repeat(24), oid: '16390', login: true },
    roles, commitXid: '701',
  };
  const fs = require('node:fs');
  const root = join(__dirname, 'migrations');
  const { createHash } = require('node:crypto');
  const ledger = fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())
    .map(item => item.name).sort().map(name => ({ name, sha256: createHash('sha256').update(readFileSync(join(root, name, 'migration.sql'))).digest('hex'), finished: true, rolledBack: false }));
  const source = { candidateSha: completion.sourceSha, tree: 'd'.repeat(40), sourceSealSha256: 'e'.repeat(64),
    profile: { ledger, ledgerSha256: 'd3538d5a3cc3a74627d70cf0e445915ef8a84c07ae06851f9aa50292d90d2952' },
  };
  alterClaim({ source, completion });
  const calls = [];
  let closed = 0, expired = false, used = false;
  const check = () => { if (expired) throw Error('expired'); };
  const resource = {
    containerId: completion.containerId,
    async execOwnerSql(sql, phase) {
      calls.push({ sql, phase });
      const nonce = /'challenge','([0-9a-f]{64})'/u.exec(sql)?.[1];
      assert.ok(nonce);
      const pre = phase === 'archive-install-before', write = phase === 'archive-install-write';
      return { stdout: JSON.stringify(alter({
        challenge: nonce, phase, backendPid: pre ? 700 : write ? 701 : 702,
        backendStart: pre ? '2026-11-11T00:00:00.000001Z' : write ? '2026-11-11T00:00:00.000002Z' : '2026-11-11T00:00:00.000003Z',
        catalogSha256: (pre ? '1' : '2').repeat(64), registrySha256: '3'.repeat(64),
        installXid: pre ? null : '702', commitStatus: write || pre ? null : 'committed',
        closureSha256: pre ? null : '4'.repeat(64), bindingSha256: pre ? null : '5'.repeat(64),
      }, phase)) };
    },
  };
  const view = { source, runId, resource, check, verifyFull: check };
  const ports = {
    './task16-current259-role-provision.cjs': {
      claimCurrent259ProvisionedRoles(result, actualHandle) {
        assert.equal(result, provisionResult);
        assert.equal(actualHandle, handle);
        assert.equal(used, false);
        used = true;
        return { source, completion, check };
      },
    },
    './task16-current259-owned-resource.cjs': {
      claimCurrent259TechnicalResource(value) { assert.equal(value, handle); return view; },
      async closeCurrent259OwnedResource(value) { assert.equal(value, handle); closed++; expired = true; },
    },
  };
  const file = join(__dirname, 'task16-current259-archive-install.cjs');
  const module = { exports: {} };
  runInThisContext(`(function(require,module){${readFileSync(file, 'utf8')}\n})`, { filename: file })(
    name => Object.hasOwn(ports, name) ? ports[name] : require(name), module,
  );
  return { ...module.exports, calls, handle, provisionResult, expire: () => { expired = true; }, closed: () => closed };
}

test('qualified owned roles install the fixed archive chain and require a new backend commit readback', async () => {
  const f = model();
  const receipt = await f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle);
  assert.deepEqual(f.calls.map(call => call.phase), ['archive-install-before', 'archive-install-write', 'archive-install-committed']);
  const sql = f.calls[1].sql;
  assert.deepEqual([...sql.matchAll(/(?:PERFORM|:=) public\.(jg_install_[a-z0-9_]+)\(/gu)].map(match => match[1]), expectedInstallers);
  assert.match(sql, /jg_install_contract_direct_archive_outside_v1\('jg_c259_outside_issuer_login'::name,'jg_c259_outside_issuer_owner'::name,'jg_c259_outside_executor_login'::name,'jg_c259_outside_executor_owner'::name\)/u);
  assert.match(sql, /jg_install_contract_direct_upward_v2\('jg_c259_upward_issuer_login'::text,'jg_c259_upward_issuer_owner'::text,'jg_c259_upward_runtime_login'::text,install_nonce\)/u);
  assert.match(sql, /BEGIN ISOLATION LEVEL SERIALIZABLE/u);
  assert.match(f.calls[2].sql, /pg_catalog\.pg_xact_status/u);
  assert.equal(receipt.installXid, '702');
  assert.equal(receipt.upwardClosureSha256, '4'.repeat(64));
  assert.equal(receipt.ordinary.oid, '16390');
  assert.equal(JSON.stringify(receipt).includes('channelNonce'), false);
  const claimed = f.claimCurrent259ArchiveInstallation(receipt, f.handle);
  assert.equal(claimed.completion, receipt);
  assert.throws(() => f.claimCurrent259ArchiveInstallation(receipt, f.handle));
  f.expire();
  assert.throws(() => claimed.check());
});

for (const [title, change] of [
  ['an uncommitted XID', row => { row.commitStatus = 'in progress'; }],
  ['a reused write backend', row => { row.backendPid = 701; row.backendStart = '2026-11-11T00:00:00.000002Z'; }],
  ['different binding rows', row => { row.bindingSha256 = '7'.repeat(64); }],
  ['different installed catalog', row => { row.catalogSha256 = '8'.repeat(64); }],
]) {
  test(`commit readback rejects ${title} and retires the original owned resource`, async () => {
    const f = model((row, phase) => { if (phase === 'archive-install-committed') change(row); return row; });
    await assert.rejects(f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle), error =>
      error.code === 'CURRENT259_ARCHIVE_INSTALL_COMMIT_UNCONFIRMED' && error.phase === 'archive-install-committed');
    assert.equal(f.calls.length, 3);
    assert.equal(f.closed(), 1);
    await assert.rejects(f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle), /QUALIFICATION/u);
    assert.equal(f.calls.length, 3);
  });
}

test('prestate mismatch never reaches the write phase', async () => {
  const f = model((row, phase) => {
    if (phase === 'archive-install-before') row.challenge = '9'.repeat(64);
    return row;
  });
  await assert.rejects(f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle), /PRESTATE_REJECTED/u);
  assert.deepEqual(f.calls.map(call => call.phase), ['archive-install-before']);
  assert.equal(f.closed(), 1);
});

test('a changed original registry prevents the committed continuation', async () => {
  const f = model((row, phase) => {
    if (phase === 'archive-install-write') row.registrySha256 = '9'.repeat(64);
    return row;
  });
  await assert.rejects(f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle), /COMMIT_UNCONFIRMED/u);
  assert.deepEqual(f.calls.map(call => call.phase), ['archive-install-before', 'archive-install-write']);
  assert.equal(f.closed(), 1);
});

test('plain provision and archive receipts cannot replace the private same-handle claims', async () => {
  const f = model();
  await assert.rejects(f.installCurrent259ArchiveAuthorities({}, f.handle));
  assert.equal(f.calls.length, 0);
  const installed = await f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle);
  assert.throws(() => f.claimCurrent259ArchiveInstallation({ ...installed }, f.handle), /QUALIFICATION/u);
  assert.throws(() => f.claimCurrent259ArchiveInstallation(installed, {}), /QUALIFICATION/u);
  assert.equal(f.claimCurrent259ArchiveInstallation(installed, f.handle).completion, installed);
});

for (const [title, alterClaim] of [
  ['an ordinary role switched to NOLOGIN', ({ completion }) => { completion.ordinary.login = false; }],
  ['an ordinary OID reused for a dedicated role', ({ completion }) => { completion.roles[0].oid = completion.ordinary.oid; }],
  ['a changed ledger checksum', ({ source }) => { source.profile.ledger[0].sha256 = 'f'.repeat(64); }],
]) {
  test(`qualification rejects ${title} before any SQL transport`, async () => {
    const f = model(undefined, alterClaim);
    await assert.rejects(f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle), /PRESTATE_REJECTED/u);
    assert.equal(f.calls.length, 0);
    assert.equal(f.closed(), 1);
  });
}

test('a write transport failure retains its fixed phase without disclosing the SQL exception', async () => {
  const f = model((row, phase) => {
    if (phase === 'archive-install-write') throw Error('synthetic private error');
    return row;
  });
  await assert.rejects(f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle), error =>
    error.message === 'CURRENT259_ARCHIVE_INSTALL_COMMIT_UNCONFIRMED' && error.phase === 'archive-install-write');
  assert.deepEqual(f.calls.map(call => call.phase), ['archive-install-before', 'archive-install-write']);
  assert.equal(f.closed(), 1);
});

test('upward channel nonce is generated inside the installer transaction', async () => {
  const f = model();
  await f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle);
  assert.match(f.calls[1].sql, /install_nonce := pg_catalog\.gen_random_uuid\(\);/u);
  for (const { sql } of f.calls) assert.doesNotMatch(sql, /'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'/u);
});
