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
  ].map(([name, login], index) => ({ name, login, oid: String(17001 + index), xmin: '701', unlimitedValidity: true,
    limit: login ? 1 : 0, password: name.startsWith('jg_task01_') ? 'scram' : 'absent' }));
  const completion = {
    status: 'CURRENT259_ROLES_PROVISIONED_NOT_ADMISSION', executionAllowed: false, nativeAdmission: false,
    sourceSha: 'a'.repeat(40), runId, containerId: 'b'.repeat(64), databaseIdentity,
    ordinary: { name: 'jg_fixture_app_' + 'c'.repeat(24), oid: '16390', login: true, limit: 0, password: 'absent' },
    roles, commitXid: '701', databaseAcl: { before: [], after: [{
      name: databaseIdentity.database, oid: databaseIdentity.databaseOid, owner: '10',
      acl: [['10', '0', 'CONNECT', false], ['10', '0', 'TEMPORARY', false]],
    }], effective: {} },
  };
  const fs = require('node:fs');
  const root = join(__dirname, 'migrations');
  const { createHash } = require('node:crypto');
  const ledger = fs.readdirSync(root, { withFileTypes: true }).filter(item => item.isDirectory())
    .map(item => item.name).sort().map(name => ({ name, sha256: createHash('sha256').update(readFileSync(join(root, name, 'migration.sql'))).digest('hex'), finished: true, rolledBack: false }));
  const source = { candidateSha: completion.sourceSha, tree: 'd'.repeat(40), sourceSealSha256: 'e'.repeat(64) };
  source.profile = structuredClone(require('./task16-current259-profile.cjs').qualifyCurrent259Source({ candidateSha: source.candidateSha,
    sealSha256: source.sourceSealSha256, schemaSha256: createHash('sha256').update(readFileSync(join(__dirname, 'schema.prisma'))).digest('hex'),
    migrations: ledger.map(row => ({ path: `services/api/prisma/migrations/${row.name}/migration.sql`, sha256: row.sha256 })) }));
  alterClaim({ source, completion });
  function freeze(value) {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  }
  freeze(completion);
  const calls = [];
  let closed = 0, expired = false, used = false;
  const check = () => { if (expired) throw Error('expired'); };
  const resource = {
    containerId: completion.containerId,
    databaseName: databaseIdentity.database,
    async execOwnerSql(sql, phase) {
      calls.push({ sql, phase });
      if (phase === 'current259-seven-before') {
        const read = name => readFileSync(join(__dirname, name), 'utf8');
        const original = new Function('require','__dirname',read('task16-current259-seven-install.test.cjs')+'\nreturn {model,registry};')(name => name==='node:test'?{test(){}}:require(name),__dirname);
        const registry = structuredClone(original.registry);
        registry.publicRoutine.acl[1][1] = completion.ordinary.oid;
        const nonce = /'nonce','([a-f0-9]{64})'/u.exec(sql)?.[1];
        return { stdout: JSON.stringify(alter({ nonce, phase,
          backendPid: 703, backendStart: '2026-11-11T00:00:00.000004Z', pre: {...original.model(),nonce}, registry,
          fileRoles: ['10', completion.ordinary.oid], catalogSha256: '9'.repeat(64), installXid: null, commitStatus: null }, phase)) };
      }
      const nonce = /'challenge','([0-9a-f]{64})'/u.exec(sql)?.[1];
      assert.ok(nonce);
      const pre = phase === 'archive-install-before', write = phase.endsWith('-write'), combined = phase.includes('-registered-');
      return { stdout: JSON.stringify(alter({
        challenge: nonce, phase, backendPid: pre ? 700 : write ? 701 : 702,
        backendStart: pre ? '2026-11-11T00:00:00.000001Z' : write ? '2026-11-11T00:00:00.000002Z' : '2026-11-11T00:00:00.000003Z',
        catalogSha256: (pre ? '1' : '2').repeat(64), registrySha256: (combined ? '8' : '3').repeat(64), pendingSha256: '6'.repeat(64),
        installXid: pre ? null : '702', commitStatus: write || pre ? null : 'committed',
        closureSha256: pre ? null : '4'.repeat(64), bindingSha256: pre ? null : '5'.repeat(64),
        ...(combined ? { originalRegistrySha256: '3'.repeat(64), sevenCatalogSha256: '7'.repeat(64) } : {}),
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
  runInThisContext(`(function(require,module,__dirname){${readFileSync(file, 'utf8')}\n})`, { filename: file })(
    name => Object.hasOwn(ports, name) ? ports[name] : require(name), module, __dirname,
  );
  return { ...module.exports, calls, handle, provisionResult, suppliedRoles: completion,
    expire: () => { expired = true; }, closed: () => closed };
}

test('the qualified archive and registered-file chain preserves both before contracts and installs once before the new backend', async () => {
  const f = model();
  const result = await f.installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(f.provisionResult,f.handle);
  assert.deepEqual(f.calls.map(x=>x.phase),['archive-install-before','current259-seven-before','archive-registered-write','archive-registered-committed']);
  assert.match(f.calls[0].sql,/REPEATABLE READ READ ONLY/u);
  assert.match(f.calls[1].sql,/SERIALIZABLE READ WRITE[\s\S]+ROLLBACK;/u);
  const sql=f.calls[2].sql;
  const markers=['CURRENT259_SEVEN_INSTALL_PREIMAGE_DRIFT','PERFORM public.jg_install_contract_direct_archive_outside_v1',
    'PERFORM public.jg_install_direct_outside_operating_basis_bridge_v2','CURRENT259_ARCHIVE_INSTALL_REGISTERED_MIDSTATE',
    'CREATE TABLE public."RegisteredPaymentFunding"','RENAME TO jg_file_business_binding_columns_before_registered_payment',
    'upward := public.jg_install_contract_direct_upward_v2','CURRENT259_ARCHIVE_INSTALL_POSTSTATE'];
  let previous=-1;for(const marker of markers){const at=sql.indexOf(marker,previous+1);assert.ok(at>previous,marker);previous=at;}
  assert.equal([...sql.matchAll(/^COMMIT;/gmu)].length,1);
  assert.match(f.calls[3].sql,/pg_xact_status\('702'::xid8\)/u);
  assert.equal(result.registeredFileSource,true);
  assert.equal(result.nativeAdmission,false);
  const lease=f.claimCurrent259ArchiveInstallation(result,f.handle);
  assert.equal(lease.completion,result);
  assert.throws(()=>f.claimCurrent259ArchiveInstallation(result,f.handle));
});

test('the combined writer rejects an executor already present in the original seven-file closure',async()=>{
 const f=model((row,phase)=>{
  if(phase==='current259-seven-before')row.fileRoles.push('17002');
  return row;
 });
 await assert.rejects(f.installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(f.provisionResult,f.handle),
  error=>error.code==='CURRENT259_ARCHIVE_INSTALL_PRESTATE_REJECTED'&&error.phase==='current259-seven-before');
 assert.deepEqual(f.calls.map(x=>x.phase),['archive-install-before','current259-seven-before']);
 assert.equal(f.closed(),1);
});

test('the registered-file postimages never require the now-installed voucher relation to be absent',async()=>{
 const f=model();
 await f.installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(f.provisionResult,f.handle);
 const [archiveBefore,,writer,committed]=f.calls.map(call=>call.sql);
 const originalOnly=/to_regclass\('public\."RegisteredPaymentVoucher"'\) IS NOT NULL/u;
 const before=writer.match(/DO \$archive_registered_before\$([\s\S]+?)\$archive_registered_before\$;/u)[1];
 assert.match(archiveBefore,originalOnly);
 assert.match(before,originalOnly);
 for(const sql of [writer,committed]){
  const after=sql.match(/DO \$archive_registered_final\$([\s\S]+?)\$archive_registered_final\$;/u)[1];
  assert.doesNotMatch(after,originalOnly);
  assert.match(after,/transaction_read_only[\s\S]+CURRENT259_ARCHIVE_INSTALL_LEDGER[\s\S]+CURRENT259_ARCHIVE_INSTALL_ROUTINES/u);
  assert.match(after,/jg_file_business_binding_columns_before_registered_payment\(\)[\s\S]+CURRENT259_ARCHIVE_INSTALL_COLLISION_POSTIMAGE/u);
  assert.match(after,/'proname','jg_file_business_binding_columns','proconfig',NULL::text\[\]/u);
 }
});

for(const [phase,key,value,calls] of [
 ['archive-registered-write','originalRegistrySha256','0'.repeat(64),3],
 ['archive-registered-write','registrySha256','3'.repeat(64),3],
 ['archive-registered-write','installXid','701',3],
 ['archive-registered-committed','sevenCatalogSha256','0'.repeat(64),4],
 ['archive-registered-committed','backendPid',703,4],
 ['archive-registered-committed','commitStatus','in progress',4],
])test('combined '+phase+' rejects changed '+key+' and never issues a continuation',async()=>{
 const f=model((row,current)=>current===phase?{...row,[key]:value}:row);
 await assert.rejects(f.installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(f.provisionResult,f.handle),
  error=>error.code==='CURRENT259_ARCHIVE_INSTALL_COMMIT_UNCONFIRMED'&&error.phase===phase);
 assert.equal(f.calls.length,calls);
 assert.equal(f.closed(),1);
 await assert.rejects(f.installCurrent259ArchiveAuthorities(f.provisionResult,f.handle));
 assert.equal(f.calls.length,calls);
});

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
  ['a changed pending source binding', row => { row.pendingSha256 = '7'.repeat(64); }],
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

for (const [title, change] of [
  ['a role xmin from another transaction', role => { role.xmin = '702'; }],
  ['a role with an expiration', role => { role.unlimitedValidity = false; }],
]) {
  test(`qualification rejects ${title}`, async () => {
    const f = model(undefined, ({ completion }) => change(completion.roles[0]));
    await assert.rejects(f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle), /PRESTATE_REJECTED/u);
    assert.equal(f.calls.length, 0);
  });
}

test('all three owner scripts recheck role tuple identity and the exact observer setting', async () => {
  const f = model();
  await f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle);
  for (const { sql } of f.calls) {
    assert.ok(sql.includes('r.xmin::text=expected.xmin'));
    assert.ok(sql.includes('r.rolvaliduntil IS NULL'));
    assert.ok(sql.includes('pg_catalog.pg_db_role_setting'));
    assert.ok(sql.includes('default_transaction_read_only=on'));
  }
});

test('archive install verifies the historical collision set and grants its fixed overlay before M234', async () => {
  const f = model();
  await f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle);
  const [before, write, committed] = f.calls.map(call => call.sql);
  const grant = 'GRANT EXECUTE ON FUNCTION %s TO %I';
  assert.ok(write.includes(grant) && write.indexOf(grant) < write.indexOf('PERFORM public.jg_install_contract_direct_archive_outside_v1'));
  assert.ok(!before.includes(grant) && !committed.includes(grant));
  assert.ok(write.includes('CURRENT259_ARCHIVE_INSTALL_COLLISION_PREIMAGE'));
  assert.ok(committed.includes('CURRENT259_ARCHIVE_INSTALL_COLLISION_POSTIMAGE'));
});

test('database ACL provenance crosses only the same-handle archive continuation', async () => {
  const f = model();
  const receipt = await f.installCurrent259ArchiveAuthorities(f.provisionResult, f.handle);
  assert.equal(Object.hasOwn(receipt, 'databaseAcl'), false);
  assert.equal(Object.hasOwn(receipt, 'roleCompletion'), false);
  const continuation = f.claimCurrent259ArchiveInstallation(receipt, f.handle);
  assert.equal(continuation.roleCompletion, f.suppliedRoles);
  assert.equal(continuation.roleCompletion.databaseAcl.after[0].oid, '16384');
  assert.ok(Object.isFrozen(continuation.roleCompletion.databaseAcl.after[0].acl));
});

test('the registered archive prestate retains the common fixed owner diagnostic before closing',async()=>{
 const f=model((row,phase)=>{
  if(phase==='current259-seven-before'){
   throw Object.assign(Error('private database message'),{code:'TASK01_RESOURCE_COMMAND_FAILED',
    sevenOwnerFailure:{sqlState:'P0001',guard:'CURRENT259_SEVEN_INSTALL_SCOPE',section:'SCOPE_GUARD',scopeReason:'OPERATING_IMPACT_ROUTINE',raw:'private field'}});
  }
  return row;
 });
 await assert.rejects(f.installCurrent259ArchiveAuthoritiesWithRegisteredFileSource(f.provisionResult,f.handle),error=>{
  assert.equal(error.code,'CURRENT259_ARCHIVE_INSTALL_PRESTATE_REJECTED');
  assert.equal(error.phase,'current259-seven-before');
  assert.deepEqual(error.sevenFailure,{phase:'current259-seven-before',boundary:'OWNER_SQL',causeCode:'TASK01_RESOURCE_COMMAND_FAILED',
   sqlState:'P0001',guard:'CURRENT259_SEVEN_INSTALL_SCOPE',section:'SCOPE_GUARD',scopeReason:'OPERATING_IMPACT_ROUTINE'});
  assert.doesNotMatch(JSON.stringify(error),/private/u);
  return true;
 });
 assert.deepEqual(f.calls.map(x=>x.phase),['archive-install-before','current259-seven-before']);
 assert.equal(f.closed(),1);
});
