'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { current259ClientIdentitySql, parseCurrent259ClientSessions } = require('./task16-current259-session-identity.cjs');

const scope = {
  database: 'jg_task01_0123456789abcdef0123456789abcdef',
  databaseOid: '16384',
  systemIdentifier: '7540000000000000000',
  ownerOid: '10',
  runtimeOid: '25004',
  observerOid: '25005',
  publishedPort: 52123,
  nonce: '9'.repeat(64)
};
function sessions() {
  return ['owner', 'runtime', 'observer'].map((kind, index) => {
    const role = 'jg_task01_' + kind;
    return [{
      database: scope.database, databaseOid: scope.databaseOid, systemIdentifier: scope.systemIdentifier,
      ownerOid: scope.ownerOid, effectiveRole: role, loginRole: role, effectiveOid: scope[kind+'Oid'],
      loginOid: scope[kind+'Oid'], pid: 101 + index, start: '2026-11-11T00:00:0' + (index + 1) + '.000001Z',
      tls: true, version: 160010, encoding: 'UTF8', replication: 'origin',
      readOnly: kind === 'observer' ? 'on' : 'off', defaultReadOnly: kind === 'observer' ? 'on' : 'off',
      clientAddress: '192.168.64.1', clientPort: 53100 + index, serverAddress: '172.19.0.2', serverPort: 5432,
      nonce: scope.nonce
    }];
  });
}

test('uses fixed no-write SQL and cross-checks the installed identity helper', () => {
  assert.match(current259ClientIdentitySql, /FROM public\.jg_task01_connection_identity\(\)/);
  assert.match(current259ClientIdentitySql, /i\."backendPid"=pg_catalog\.pg_backend_pid\(\)/);
  assert.match(current259ClientIdentitySql, /pg_catalog\.host\(pg_catalog\.inet_client_addr\(\)\)/);
  assert.match(current259ClientIdentitySql, /pg_catalog\.pg_stat_ssl/);
  assert.match(current259ClientIdentitySql, /\$1::pg_catalog\.text AS nonce/);
  assert.doesNotMatch(current259ClientIdentitySql, /SET ROLE|pg_control_system|pg_terminate_backend|\bUPDATE\b/);
});

test('binds three independent roles and the runtime NAT coordinates', () => {
  const proof = parseCurrent259ClientSessions(sessions(), scope);
  assert.deepEqual(proof.identity.map(row => [row.loginRole, row.loginOid, row.pid]),
    [['jg_task01_owner','10',101],['jg_task01_runtime','25004',102],['jg_task01_observer','25005',103]]);
  assert.deepEqual(proof.endpoint, { publishedHost: '127.0.0.1', publishedPort: 52123,
    clientAddress: '192.168.64.1', clientPort: 53101, serverAddress: '172.19.0.2', serverPort: 5432 });
  assert.ok(Object.isFrozen(proof) && Object.isFrozen(proof.identity) && Object.isFrozen(proof.identity[1]) &&
    Object.isFrozen(proof.endpoint));
  assert.equal(Object.hasOwn(proof, 'nativeAdmission'), false);
});

for (const [name, mutate] of [
  ['empty runtime result', x => { x[1]=[]; }],
  ['duplicate runtime result', x => { x[1].push(x[1][0]); }],
  ['changed runtime backend role', x => { x[1][0].effectiveRole='jg_task01_owner'; }],
  ['different physical cluster', x => { x[2][0].systemIdentifier='7540000000000000001'; }],
  ['same backend for distinct clients', x => { x[2][0].pid=x[1][0].pid; }],
  ['same backend start for distinct clients', x => { x[2][0].start=x[1][0].start; }],
  ['reused same NAT tuple', x => { x[2][0].clientPort=x[1][0].clientPort; }],
  ['observer default changed', x => { x[2][0].defaultReadOnly='off'; }],
  ['runtime wrong CA route reported as plaintext', x => { x[1][0].tls=false; }],
  ['masked address projection', x => { x[1][0].clientAddress+='\/32'; }],
  ['different server address', x => { x[2][0].serverAddress='172.19.0.3'; }],
  ['public server address', x => { for (const [row] of x) row.serverAddress='198.51.100.1'; }],
  ['other database owner', x => { x[1][0].ownerOid='42'; }],
  ['missing scoped nonce', x => { delete x[0][0].nonce; }],
  ['unexpected response field', x => { x[0][0].password='unexpected'; }]
]) test('rejects ' + name, () => {
  const observations = sessions();
  mutate(observations);
  assert.throws(() => parseCurrent259ClientSessions(observations, scope), /TASK16_CURRENT259_SESSION_IDENTITY/);
});

test('does not invoke accessors on observations or expected scope', () => {
  let called = 0;
  const observations = sessions();
  Object.defineProperty(observations[1][0], 'loginOid', { enumerable: true, get() { called += 1; return '25004'; } });
  assert.throws(() => parseCurrent259ClientSessions(observations, scope), /TASK16_CURRENT259_SESSION_IDENTITY/);
  const unsafeScope = { ...scope, get nonce() { called += 1; return scope.nonce; } };
  assert.throws(() => parseCurrent259ClientSessions(sessions(), unsafeScope), /TASK16_CURRENT259_SESSION_IDENTITY/);
  assert.equal(called, 0);
});
