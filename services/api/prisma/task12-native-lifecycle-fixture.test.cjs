'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { renderNativeLifecycleFixture, validateNativeLifecycleScope } = require('./task12-native-lifecycle-fixture.cjs');
const scope = { database: 'jiangkong_contract_draft_aggregate_test', appName: 'jg_fixture_app_' + 'a'.repeat(24),
  appOid: '20000', migrationCount: 261, terminal: '20261111140000_contract_direct_upward_retention_acl_source_v3' };
const secrets = Object.fromEntries(['application','template','worker','queue'].map(name => [name, 'b'.repeat(64)]));

test('native lifecycle grants retain the original staged app and three separate document roles', () => {
  const sql = renderNativeLifecycleFixture(scope, secrets);
  assert.match(sql, /r.oid=20000::oid AND r.rolname='jg_fixture_app_aaaaaaaaaaaaaaaaaaaaaaaa'/u);
  assert.match(sql, /ALTER ROLE "jg_fixture_app_aaaaaaaaaaaaaaaaaaaaaaaa" LOGIN PASSWORD/u);
  for (const role of ['template','worker','queue']) assert.match(sql, new RegExp('CREATE ROLE "jg_c259_doc_' + role + '" LOGIN'));
  assert.match(sql, /GRANT INSERT \([^;]+\) ON public\."ContractArchiveEvidenceFile" TO "jg_fixture_app_/u);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public.jg_has_exclusive_file_business_binding\(text\)/u);
  assert.doesNotMatch(sql, /TO PUBLIC|GRANT ALL|GRANT [^;]* TO jiangkong|ALTER TABLE|DISABLE TRIGGER|SET ROLE|row_security=off/iu);
});

test('native lifecycle refuses another database, owner identity, malformed role or stale ledger', () => {
  for (const change of [{ database: 'postgres' }, { appOid: '10' }, { appName: 'jiangkong' },
    { appName: scope.appName + '";SELECT' }, { migrationCount: 260 }, { terminal: 'other' }]) {
    assert.throws(() => validateNativeLifecycleScope({ ...scope, ...change }), /TASK12_NATIVE_FIXTURE_SCOPE/u);
  }
  assert.throws(() => renderNativeLifecycleFixture(scope, { ...secrets, application: "x'" }), /TASK12_NATIVE_FIXTURE_SECRET/u);
});

test('native lifecycle entry with no explicit inputs reports its required native scope without a process child', () => {
  const file = path.join(__dirname, 'run-task12-contract-lifecycle-native-local.cjs');
  const result = spawnSync(process.execPath, [file], { env: { PATH: '', NODE_ENV: 'test' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TASK12_NATIVE_LIFECYCLE_NOT_EXECUTED/u);
});

// The immutable manifests are checked inside render; prove every emitted scalar
// grant names a current physical model column before a real PG run.
test('native per-column fixture grants match the exact current schema', () => {
  const schema = require('node:fs').readFileSync(path.join(__dirname, 'schema.prisma'), 'utf8');
  const sql = renderNativeLifecycleFixture(scope, secrets);
  for (const match of sql.matchAll(/GRANT (?:SELECT|INSERT|UPDATE) \(([^)]+)\) ON public\."([^"]+)"/gu)) {
    const model = schema.match(new RegExp('model ' + match[2] + ' \\{([\\s\\S]*?)\\n\\}'));
    assert.ok(model, match[2]);
    for (const column of match[1].matchAll(/"([^"]+)"/gu)) {
      assert.match(model[1], new RegExp('^\\s+' + column[1] + '\\s', 'm'), match[2] + '.' + column[1]);
    }
  }
});

test('native entry rejects partial and misleading inputs before any child process', () => {
  const { parseArgs } = require('./run-task12-contract-lifecycle-native-local.cjs');
  for (const args of [['--help'], ['--confirm', 'yes'],
    ['--candidate-sha', 'a'.repeat(40), '--runtime-input', 'relative', '--runtime-sha256', 'b'.repeat(64), '--confirm', 'LOCAL_TASK12_NATIVE_LIFECYCLE']]) {
    assert.throws(() => parseArgs(args), /TASK12_NATIVE_GATE_ARGUMENTS/u);
  }
  const source = require('node:fs').readFileSync(path.join(__dirname, 'run-task12-contract-lifecycle-native-local.cjs'), 'utf8');
  assert.match(source, /--testRegex.*task12-contract-lifecycle/);
  assert.doesNotMatch(source, /task12-contract-lifecycle\.pg\.spec\.ts/);
});

test('outer and audit cleanup preserve the exact private primary while attempting every cleanup',async()=>{
 const { withNativeLifecycleCleanup, createNativeLifecycleDiagnostics }=require('./task12-native-lifecycle-fixture.cjs');
 for(const labels of [['PROCESSOR_CLOSE','APP_CLOSE','APPLICATION_DISCONNECT','TEMPLATE_DISCONNECT','WORKER_DISCONNECT','QUEUE_DISCONNECT','OWNER_DISCONNECT'],['AUDIT_TRIGGER_DROP','AUDIT_FUNCTION_DROP']]){
  const trace=[],primary=Object.assign(new Error('private SQL and request'),{code:'P2010',meta:{code:'42501',message:'private SQL'}});
  const evidence=createNativeLifecycleDiagnostics();evidence.enter('ARCHIVE');
  await assert.rejects(withNativeLifecycleCleanup(async()=>{evidence.database('application',primary);throw primary;},labels.map(label=>[label,async()=>{trace.push(label);throw Object.assign(new Error('private cleanup'),{code:'P1001'});}]),evidence),error=>error===primary);
  assert.deepEqual(trace,labels);
  const report=evidence.report();assert.equal(report.stage,'ARCHIVE');assert.equal(report.code,'P2010');assert.equal(report.sqlState,'42501');assert.equal(report.role,'application');
  assert.deepEqual(report.cleanupFailures.map(row=>row.step),labels);assert.equal(JSON.stringify(report).includes('private'),false);
 }
});
test('a successful native business case still fails if cleanup fails, and diagnostic ignores unknown errors/getters',async()=>{
 const { withNativeLifecycleCleanup, createNativeLifecycleDiagnostics }=require('./task12-native-lifecycle-fixture.cjs');
 const evidence=createNativeLifecycleDiagnostics(),secret=Object.defineProperty(new Error('private'), 'code',{get(){assert.fail('getter called');}});
 evidence.enter('SEED');evidence.database('owner',secret);
 const cleanup=Object.assign(new Error('private'),{code:'P1001'});
 await assert.rejects(withNativeLifecycleCleanup(async()=>42,[['APP_CLOSE',async()=>{throw cleanup;}]],evidence),error=>error===cleanup);
 assert.deepEqual(evidence.report(),{stage:'CLEANUP',code:'P1001',role:'application',cleanupFailures:[{step:'APP_CLOSE',role:'application',code:'P1001'}]});
});

test('native lifecycle source uses both guarded cleanup boundaries and no raw error logger',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'../src/database/task12-contract-lifecycle.native.ts'),'utf8');
 assert.equal((source.match(/await withNativeLifecycleCleanup\(async/g)||[]).length,2);
 assert.match(source,/createNestApplication\(\{ logger: false \}\)/u);
 assert.match(source,/diagnostic\.database\(role,error\);throw error/u);
 assert.match(source,/JSON\.stringify\(report\)/u);
 assert.doesNotMatch(source,/JSON\.stringify\(error\)|error\.message|cause: error/u);
});

test('expected audit faults cannot replace a later independent read failure and cleanup projection is bounded',()=>{
 const {createNativeLifecycleDiagnostics}=require('./task12-native-lifecycle-fixture.cjs');
 const evidence=createNativeLifecycleDiagnostics();evidence.enter('AUDIT_FAULT_ARCHIVE');
 evidence.database('application',{code:'P2010',meta:{code:'P0001'}});
 evidence.enter('AUDIT_FAULT_ROLLBACK_VERIFY');evidence.database('owner',{code:'P1001'});evidence.primary({message:'private read'});
 for(let i=0;i<20;i++)evidence.cleanup('APP_CLOSE',{code:'P1001',message:'private cleanup'});
 const report=evidence.report();assert.equal(report.stage,'AUDIT_FAULT_ROLLBACK_VERIFY');assert.equal(report.role,'owner');assert.equal(report.code,'P1001');
 assert.equal(Object.hasOwn(report,'sqlState'),false);assert.equal(report.cleanupFailures.length,9);assert.equal(JSON.stringify(report).includes('private'),false);
});
