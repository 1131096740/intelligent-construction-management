'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { renderCurrent259DatabasePrivileges } = require('./task16-current259-database-privileges.cjs');

const database = 'jg_task01_0123456789abcdef0123456789abcdef';
const ordinary = { oid: '25000', name: 'jg_fixture_app_0123456789abcdef01234567' };
const owner = ['10', '10', 'CREATE', false];
const publicConnect = ['10', '0', 'CONNECT', false];
const publicTemp = ['10', '0', 'TEMPORARY', false];
const appConnect = ['10', ordinary.oid, 'CONNECT', false];
function provision() {
  return {
    databaseIdentity: { database, databaseOid: '16384', ownerOid: '10', systemIdentifier: '7540000000000000000' },
    ordinary,
    roles: [{ name: 'jg_task01_runtime', oid: '25001' }, { name: 'jg_task01_observer', oid: '25002' }],
    databaseAcl: { after: [
      { oid: '16384', name: database, owner: '10', acl: [publicConnect, publicTemp, owner, appConnect, ['10','25001','CONNECT',false], ['10','25002','CONNECT',false]] },
      { oid: '5', name: 'postgres', owner: '10', acl: [publicConnect, publicTemp, owner] },
      { oid: '4', name: 'template0', owner: '10', acl: [publicConnect, owner] },
      { oid: '1', name: 'template1', owner: '10', acl: [publicConnect, owner] }
    ] }
  };
}
test('restricts database PUBLIC only and preserves ordinary target TEMP explicitly', () => {
  const { sql, expected } = renderCurrent259DatabasePrivileges(provision());
  assert.deepEqual(expected.map(db => [db.name, db.acl.filter(acl => acl[1] === '0')]),
    [[database, []], ['postgres', []], ['template0', []], ['template1', []]]);
  assert.deepEqual(expected[0].acl, [owner, appConnect, ['10', ordinary.oid, 'TEMPORARY', false],
    ['10','25001','CONNECT',false], ['10','25002','CONNECT',false]]);
  assert.match(sql, /REVOKE %s ON DATABASE %I FROM PUBLIC/);
  assert.match(sql, /GRANT TEMPORARY ON DATABASE %I TO %I/);
  assert.match(sql, /has_database_privilege/);
  assert.match(sql, /pg_control_system/);
  assert.ok(sql.indexOf('PREIMAGE') < sql.indexOf('REVOKE'));
  assert.ok(sql.indexOf('REVOKE') < sql.indexOf('POSTIMAGE'));
  assert.doesNotMatch(sql, /REVOKE ALL|CASCADE|\bCOMMIT\b|CREATE ROLE|ALTER ROLE/);
});
test('does not duplicate existing ordinary TEMP grant', () => {
  const proof = provision();
  proof.databaseAcl.after[0].acl = [...proof.databaseAcl.after[0].acl, ['10', ordinary.oid, 'TEMPORARY', false]];
  const { sql, expected } = renderCurrent259DatabasePrivileges(proof);
  assert.equal(expected[0].acl.filter(row => row[1] === ordinary.oid && row[2] === 'TEMPORARY').length, 1);
  assert.doesNotMatch(sql, /GRANT TEMPORARY/);
});
test('preserves other roles’ explicit grants and keeps target-only runtime and observer CONNECT', () => {
  const proof = provision();
  const outsideConnect = ['10', '25003', 'CONNECT', false];
  const unrelatedTemp = ['10', '25004', 'TEMPORARY', false];
  proof.databaseAcl.after[0].acl.push(outsideConnect);
  proof.databaseAcl.after[1].acl.push(unrelatedTemp);
  const { sql, expected } = renderCurrent259DatabasePrivileges(proof);
  assert.ok(expected[0].acl.some(row => row[1] === '25003' && row[2] === 'CONNECT'));
  assert.ok(expected[1].acl.some(row => row[1] === '25004' && row[2] === 'TEMPORARY'));
  assert.match(sql, /pg_auth_members/);
  assert.match(sql, /has_database_privilege\(r\.oid,d\.oid,'CONNECT'\) IS DISTINCT FROM \(d\.oid=16384::oid\)/);
});
for (const [name, mutate] of [
  ['unexpected database', p => { p.databaseAcl.after[1].name = 'unexpected'; }],
  ['different target owner', p => { p.databaseAcl.after[0].owner = '51'; }],
  ['different target OID', p => { p.databaseAcl.after[0].oid = '16385'; }],
  ['unexpected PUBLIC grant', p => { p.databaseAcl.after[0].acl.push(['10','0','CREATE',false]); }],
  ['duplicate ACL entry', p => { p.databaseAcl.after[0].acl.push(publicConnect); }],
  ['duplicate restricted identity', p => { p.roles[1].oid = p.roles[0].oid; }],
  ['unexpected explicit cross-database privilege', p => { p.databaseAcl.after[1].acl.push(['10','25001','CONNECT',false]); }],
  ['unexpected explicit target TEMP', p => { p.databaseAcl.after[0].acl.push(['10','25001','TEMPORARY',false]); }],
  ['missing restricted target connect', p => { p.databaseAcl.after[0].acl.pop(); }],
  ['missing ordinary target connect', p => { p.databaseAcl.after[0].acl.splice(3,1); }],
]) test('rejects ' + name, () => {
  const proof = provision();
  mutate(proof);
  assert.throws(() => renderCurrent259DatabasePrivileges(proof), /TASK16_CURRENT259_DATABASE_PRIVILEGES/);
});

test('validates the same input values used to generate SQL', () => {
  const proof = provision();
  let reads = 0;
  proof.ordinary = {
    name: ordinary.name,
    get oid() {
      return ++reads === 1 ? ordinary.oid : '25000 /* changed after validation */';
    }
  };
  const { sql } = renderCurrent259DatabasePrivileges(proof);
  assert.equal(reads, 1);
  assert.doesNotMatch(sql, /changed after validation/);
});
