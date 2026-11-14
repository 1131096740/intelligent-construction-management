'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { renderCurrent259PublicAccess, renderCurrent259CompetitionPublicAccess } = require('./task16-current259-public-access.cjs');

function rolesProvisioned() {
  return {
    status: 'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION',
    commitXid: '1234',
    databaseIdentity: {
      database: 'jg_task01_0123456789abcdef0123456789abcdef',
      databaseOid: '16384',
      namespaceOid: '2200',
      ownerOid: '10',
      systemIdentifier: '7540000000000000000'
    },
    ordinary: { oid: '25000', name: 'jg_fixture_app_0123456789abcdef01234567' },
    roles: [
      { name: 'jg_task01_runtime', oid: '25004' },
      { name: 'jg_task01_observer', oid: '25005' }
    ]
  };
}

test('renders only for the committed role scope with archival authorities still inactive', () => {
  const sql = renderCurrent259PublicAccess(rolesProvisioned());
  assert.match(sql, /pg_xact_status\('1234'::xid8\)/);
  assert.match(sql, /transaction_isolation.*serializable/);
  assert.match(sql, /session_user/);
  assert.match(sql, /pg_control_system/);
  assert.match(sql, /pg_stat_ssl/);
  assert.match(sql, /EXISTS \(SELECT FROM public.jg_contract_direct_archive_intent_binding_v1\)/);
  assert.match(sql, /EXISTS \(SELECT FROM public.jg_contract_direct_upward_issuer_binding_v2\)/);
  assert.match(sql, /jg_contract_direct_pending_binding_v1/);
  assert.doesNotMatch(sql, /^\s*COMMIT;|CREATE ROLE|ALTER ROLE|CASCADE|ON ALL ROUTINES/m);
});

test('allows only the explicit schema and digest dependencies as ACL additions', () => {
  const sql = renderCurrent259PublicAccess(rolesProvisioned());
  assert.match(sql, /"fileCallerOids"/);
  assert.match(sql, /public.digest\(bytea,text\)/);
  assert.match(sql, /pg_extension/);
  assert.match(sql, /GRANT USAGE ON SCHEMA public TO %I/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public.digest\(bytea,text\) TO %I/);
  assert.match(sql, /REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC RESTRICT/);
  assert.match(sql, /REVOKE USAGE ON SCHEMA public FROM PUBLIC RESTRICT/);
  assert.match(sql, /EXCEPT ALL/);
  assert.ok(sql.indexOf('PREIMAGE') < sql.indexOf('REVOKE EXECUTE'));
  assert.ok(sql.indexOf('REVOKE EXECUTE') < sql.indexOf('POSTIMAGE'));
});

for (const [name, mutate] of [
  ['unknown phase', a => { a.status = 'pending'; }],
  ['foreign database', a => { a.databaseIdentity.database = 'postgres'; }],
  ['unexpected owner', a => { a.databaseIdentity.ownerOid = '11'; }],
  ['invalid XID', a => { a.commitXid = '18446744073709551616'; }],
  ['unqualified overlapping roles', a => { a.roles[1].oid = a.roles[0].oid; }],
  ['invalid role coordinate', a => { a.roles[0].oid = '25004 /* changed */'; }],
]) test('rejects ' + name, () => {
  const proof = rolesProvisioned();
  mutate(proof);
  assert.throws(() => renderCurrent259PublicAccess(proof), /TASK16_CURRENT259_PUBLIC_ACCESS/);
});

test('standalone payment keeps original callers and does not grant archive roles or UUID aliases', () => {
  const sql = renderCurrent259PublicAccess(rolesProvisioned());
  assert.match(sql, /pg_authid/);
  assert.match(sql, /xmin/);
  assert.match(sql, /EXISTS \(SELECT FROM public.jg_contract_direct_upward_closure_v2\)/);
  assert.doesNotMatch(sql, /jg_c259_outside_executor_owner|public.gen_random_uuid/);
});

test('rejects accessors before reading any value from them', () => {
  const proof = rolesProvisioned();
  let reads = 0;
  Object.defineProperty(proof.ordinary, 'oid', {
    enumerable: true,
    get() { reads += 1; return '25000'; }
  });
  assert.throws(() => renderCurrent259PublicAccess(proof), /TASK16_CURRENT259_PUBLIC_ACCESS/);
  assert.equal(reads, 0);
});


test('fixed competition PUBLIC closure binds runtime two and observer one to committed role OIDs',()=>{
  const original=rolesProvisioned();
  const single=rolesProvisioned();
  single.roles.forEach(role=>{role.limit=1;});
  assert.equal(renderCurrent259PublicAccess(single),renderCurrent259PublicAccess(original));
  const competition=rolesProvisioned();
  competition.roles[0].limit=2;
  competition.roles[1].limit=1;
  assert.throws(()=>renderCurrent259PublicAccess(competition),/TASK16_CURRENT259_PUBLIC_ACCESS/u);
  const sql=renderCurrent259CompetitionPublicAccess(competition);
  assert.match(sql,/VALUES \('jg_task01_runtime',25004::oid,2\),\('jg_task01_observer',25005::oid,1\)\) e\(name,oid,connection_limit\)/u);
  assert.match(sql,/r\.xmin::text=.*r\.rolconnlimit=e\.connection_limit/u);
  assert.throws(()=>renderCurrent259CompetitionPublicAccess(single),/TASK16_CURRENT259_PUBLIC_ACCESS/u);
  competition.roles[1].limit=2;
  assert.throws(()=>renderCurrent259CompetitionPublicAccess(competition),/TASK16_CURRENT259_PUBLIC_ACCESS/u);
});
