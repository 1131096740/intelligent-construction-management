'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { renderNativeLifecycleFixture, validateNativeLifecycleScope } = require('./task12-native-lifecycle-fixture.cjs');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const migrations=fs.readdirSync(path.join(__dirname,'migrations')).filter(name=>fs.existsSync(path.join(__dirname,'migrations',name,'migration.sql'))).sort().map(name=>({path:'services/api/prisma/migrations/'+name+'/migration.sql',sha256:createHash('sha256').update(fs.readFileSync(path.join(__dirname,'migrations',name,'migration.sql'))).digest('hex')}));
const qualifiedProfile=require('./task16-current259-profile.cjs').qualifyCurrent259Source({candidateSha:'a'.repeat(40),sealSha256:'3'.repeat(64),schemaSha256:createHash('sha256').update(fs.readFileSync(path.join(__dirname,'schema.prisma'))).digest('hex'),migrations});
const source=Object.freeze({candidateSha:'a'.repeat(40),tree:'b'.repeat(40),sourceSealSha256:'3'.repeat(64),profile:qualifiedProfile});
const scope = { source, database: 'jiangkong_contract_draft_aggregate_test', appName: 'jg_fixture_app_' + 'a'.repeat(24),
  appOid: '20000', migrationCount: 261, terminal: '20261111140000_contract_direct_upward_retention_acl_source_v3' };
const secrets = Object.fromEntries(['application','template','worker','queue'].map(name => [name, 'b'.repeat(64)]));

test('native lifecycle grants retain the original staged app and three separate document roles', () => {
  const sql = renderNativeLifecycleFixture(scope, secrets);
  assert.match(sql, /r.oid=20000::oid AND r.rolname='jg_fixture_app_aaaaaaaaaaaaaaaaaaaaaaaa'/u);
  assert.match(sql, /ALTER ROLE "jg_fixture_app_aaaaaaaaaaaaaaaaaaaaaaaa" LOGIN PASSWORD/u);
  for (const role of ['template','worker','queue']) assert.match(sql, new RegExp('CREATE ROLE "jg_c259_doc_' + role + '" LOGIN'));
  assert.match(sql, /GRANT INSERT \([^;]+\) ON public\."ContractArchiveEvidenceFile" TO "jg_fixture_app_/u);
  assert.match(sql, /has_function_privilege[^\n]+jg_has_exclusive_file_business_binding\(text\)/u);
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
 const source=require('node:fs').readFileSync(path.join(__dirname,'../src/database/task12-contract-lifecycle.native.spec.ts'),'utf8');
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

test('runner attempts directory cleanup after container cleanup failure without replacing the business first error',async()=>{
 const {withNativeLifecycleCleanup}=require('./task12-native-lifecycle-fixture.cjs');
 for(const original of [undefined,new Error('private primary')]){
  const trace=[],failure=new Error('TASK12_NATIVE_GATE_CONTAINER_CLEANUP');
  await assert.rejects(withNativeLifecycleCleanup(async()=>{if(original)throw original;return true;},[
   ['CONTAINER_REMOVE',async()=>{trace.push('container');throw failure;}],
   ['DIRECTORY_REMOVE',async()=>{trace.push('directory');throw new Error('TASK12_NATIVE_GATE_DIRECTORY_CLEANUP');}]
  ],{primary(){},cleanup(){}}),error=>error===(original??failure));
  assert.deepEqual(trace,['container','directory']);
 }
 const source=require('node:fs').readFileSync(path.join(__dirname,'run-task12-contract-lifecycle-native-local.cjs'),'utf8');
 assert.match(source,/return withNativeLifecycleCleanup/u);
 assert.match(source,/DIRECTORY_REMOVE/u);
});

test('the real migration constructor admits the runner-owned name without any process or SQL port',()=>{
 const {nativeLifecycleContainerName}=require('./run-task12-contract-lifecycle-native-local.cjs');
 const {createCiDynamicMigrationFixture}=require('./local-staged-ci-dynamic.cjs');
 const runId='22345678-1234-4234-8234-123456789012';let commands=0;
 const options={ciFixture:'DYNAMIC_REMAINING_V1',container:{id:'a'.repeat(64),name:nativeLifecycleContainerName(runId),runId},
  databaseNames:[scope.database],temporaryRoot:'/private/tmp/not-opened-native-model',dockerCommand(){commands++;throw new Error('must not run');},deploy(){commands++;throw new Error('must not run');}};
 const fixture=createCiDynamicMigrationFixture(options);assert.equal(typeof fixture.migrate,'function');assert.equal(commands,0);
 assert.throws(()=>createCiDynamicMigrationFixture({...options,container:{...options.container,name:'jg-task12-native-'+runId}}),/LOCAL_MIGRATION_INPUT/u);
 assert.equal(commands,0);
});

test('runner failure projection retains fixed stages and known staged codes without raw messages or getters',()=>{
 const {describeNativeLifecycleRunnerFailure}=require('./task12-native-lifecycle-fixture.cjs');
 assert.deepEqual(describeNativeLifecycleRunnerFailure(new Error('LOCAL_MIGRATION_INPUT'),'MIGRATION_FIXTURE'),{stage:'MIGRATION_FIXTURE',code:'LOCAL_MIGRATION_INPUT'});
 assert.deepEqual(describeNativeLifecycleRunnerFailure(new Error('LOCAL_MIGRATION_SQL_STAGE205_READBACK'),'MIGRATION_APPLY'),{stage:'MIGRATION_APPLY',code:'LOCAL_MIGRATION_SQL_STAGE205_READBACK'});
 for(const error of [new Error('LOCAL_MIGRATION_INPUT private password'),{message:'private SQL'},new Proxy({}, {get(){assert.fail('proxy get');},getOwnPropertyDescriptor(){assert.fail('proxy descriptor');}})])
  assert.deepEqual(describeNativeLifecycleRunnerFailure(error,'MIGRATION_APPLY'),{stage:'MIGRATION_APPLY',code:'TASK12_NATIVE_GATE_REJECTED'});
 const getter=Object.defineProperty({},'message',{get(){assert.fail('getter called');}});
 assert.equal(describeNativeLifecycleRunnerFailure(getter,'PRIVATE_STAGE').stage,'INPUT');
});

test('runner diagnostics preserve the original migration stage through both later cleanup failures',async()=>{
 const {withNativeLifecycleCleanup,createNativeLifecycleRunnerFailureRecorder}=require('./task12-native-lifecycle-fixture.cjs');
 const evidence=createNativeLifecycleRunnerFailureRecorder(),primary=new Error('LOCAL_MIGRATION_INPUT');
 evidence.enter('MIGRATION_FIXTURE');
 await assert.rejects(withNativeLifecycleCleanup(async()=>{throw primary;},[
  ['CONTAINER_REMOVE',async()=>{evidence.enter('CLEANUP_CONTAINER');throw new Error('TASK12_NATIVE_GATE_COMMAND');}],
  ['DIRECTORY_REMOVE',async()=>{evidence.enter('CLEANUP_DIRECTORY');throw new Error('private filesystem');}]
 ],{primary:evidence.capture,cleanup(_step,error){evidence.capture(error);}}),error=>error===primary);
 assert.deepEqual(evidence.describe(primary),{stage:'MIGRATION_FIXTURE',code:'LOCAL_MIGRATION_INPUT'});
});

test('psql diagnostics project only a known SQLSTATE and bounded static stdin line',()=>{
 const {projectNativeLifecyclePsqlFailure}=require('./task12-native-lifecycle-fixture.cjs');
 assert.deepEqual(projectNativeLifecyclePsqlFailure('psql:<stdin>:41: ERROR:  42601\n',100),{sqlState:'42601',sqlLine:41});
 for(const text of ['psql:<stdin>:401: ERROR:  42601\n','psql:<stdin>:4: ERROR:  ZZ999\n','psql:<stdin>:4: ERROR:  private password\n','ERROR: 42601 SELECT private'])
  assert.equal(projectNativeLifecyclePsqlFailure(text,100),undefined);
});

test('runner recovers only its exact daemon-owned container after a lost create response and still removes its directory',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const file=path.join(__dirname,'run-task12-contract-lifecycle-native-local.cjs');
 const runId='22345678-1234-4234-8234-123456789012',name='jiangkong-task12-native-'+runId,id='a'.repeat(64),sha='b'.repeat(40);
 for(const owner of ['same','foreign','wrong-name','invalid-id','multiple','absent','inspect-failure','remove-failure','returned-mismatch','known-id-name-missing']){
  let directory,created=false;const removed=[],calls=[],diagnostics=[];
  const output=value=>({status:0,stdout:value,stderr:''});
  const daemon=(bin,args)=>{
   calls.push([bin,...args]);
   if(bin==='git')return output(args[0]==='rev-parse'?sha:'');
   if(bin!=='docker')return output('');
   const op=args.slice(2);
   if(op[0]==='image')return output('sha256:model');
   if(op[0]==='run'){created=true;if(['returned-mismatch','known-id-name-missing'].includes(owner))return output(id);return {error:new Error('private timeout after daemon creation'),status:null,stderr:''};}
   if(op[0]==='container'&&op[1]==='ls'){
    const filter=op[op.indexOf('--filter')+1];
    if(filter==='id='+id)return output(created?id:'');
    assert.equal(filter,'name=^/'+name+'$');
    if(owner==='known-id-name-missing')return output('');
    if(owner==='inspect-failure')return {status:1,stderr:'private daemon error'};
    const row=(owner==='invalid-id'?'invalid':owner==='returned-mismatch'?'d'.repeat(64):id)+' '+(owner==='wrong-name'?'another-container':name)+' '+(owner==='foreign'?'foreign-run':runId);
    return output(created&&owner!=='absent'?row+(owner==='multiple'?'\n'+row:''):'');
   }
   if(op[0]==='rm'){removed.push(op.at(-1));if(owner==='remove-failure')return {status:1,stderr:'private remove error'};created=false;return output(id);}
   if(op[0]==='exec'&&['returned-mismatch','known-id-name-missing'].includes(owner))return {status:1,stderr:'private ready error'};
   assert.fail('unexpected daemon operation '+op[0]);
  };
  const localFs={...fs,mkdtempSync(prefix){directory=fs.mkdtempSync(prefix);return directory;}};
  const entry={exports:{}};
  const load=key=>key==='node:fs'?localFs:key==='node:child_process'?{spawnSync:daemon}:
   key==='node:crypto'?{...require(key),randomUUID:()=>runId}:
   key==='./task12-current259-generated-document-runtime.cjs'?{verifyCurrent259GeneratedDocumentRuntime(){}}:
   key==='./task16-current259-build.cjs'?{observeCurrent259Build(){return {executionAllowed:false};},claimCurrent259Build(){return {source:{candidateSha:sha},check(){}};}}:require(key);
  const invoke=vm.runInNewContext('(function(require,module,__dirname,__filename){'+fs.readFileSync(file,'utf8').replace(/^#![^\n]*\n/u,'')+'\n})', {process:{env:{NODE_ENV:'test',DOCKER_HOST:'unix:///model-only'},stderr:{write(value){diagnostics.push(value);}}}});
  invoke(load,entry,__dirname,file);
  await assert.rejects(entry.exports.main(['--candidate-sha',sha,'--runtime-input','/private/tmp/model-runtime','--runtime-sha256','c'.repeat(64),'--confirm','LOCAL_TASK12_NATIVE_LIFECYCLE']),error=>error.message==='TASK12_NATIVE_GATE_COMMAND');
  assert.equal(calls.filter(row=>row[0]==='docker'&&row[3]==='run').length,1,'creation is never retried');
  assert.equal(fs.existsSync(directory),false,'private directory removed despite create failure');
  assert.deepEqual(removed,['same','remove-failure'].includes(owner)?[id]:[],'unknown ownership is never deleted');
  assert.equal(diagnostics.some(row=>row==='TASK12_NATIVE_GATE_CLEANUP_FAILED_CONTAINER_REMOVE\n'),!['same','absent'].includes(owner),'failed ownership or cleanup cannot report success');
  assert.ok(calls.some(row=>row.includes('ls')),'daemon ownership is independently observed even without a returned id');
 }
});

test('the migration-only lifecycle grants exclude only the two post-migration registered-payment relations',()=>{
 const fs=require('node:fs');const migrationRoot=path.join(__dirname,'migrations');
 const migrations=fs.readdirSync(migrationRoot).filter(name=>fs.existsSync(path.join(migrationRoot,name,'migration.sql'))).map(name=>fs.readFileSync(path.join(migrationRoot,name,'migration.sql'),'utf8')).join('\n');
 const sql=renderNativeLifecycleFixture(scope,secrets);
 for(const table of ['RegisteredPaymentFunding','RegisteredPaymentVoucher']){
  assert.doesNotMatch(migrations,new RegExp('CREATE TABLE(?: IF NOT EXISTS)? (?:public\\.)?"'+table+'"','u'));
  assert.doesNotMatch(sql,new RegExp('ON public\\."'+table+'"','u'));
  assert.match(fs.readFileSync(path.join(__dirname,'prepared/task16/registered-funding.sql'),'utf8'),new RegExp('CREATE TABLE public\\."'+table+'"','u'));
 }
 const requirements=require('./task16-current259-ordinary-archive-acl.requirements.json');
 for(const table of Object.keys(requirements.tables).filter(table=>!['RegisteredPaymentFunding','RegisteredPaymentVoucher'].includes(table)))assert.match(sql,new RegExp('ON public\\."'+table+'"','u'),table);
});


test('native fixed-case grants are exactly the authenticated lifecycle producer projections, not private fixture overrides',()=>{
 const ordinary=require('./task16-current259-ordinary-archive-acl.cjs').describeMigration261GeneratedLifecycleOrdinaryAcl(source);
 const document=require('./task12-current259-document-acl.cjs').describeMigration261GeneratedLifecycleDocumentAcl(source);
 const sql=renderNativeLifecycleFixture(scope,secrets),expected=[];
 for(const row of ordinary.rows)expected.push([scope.appName,row.relation,row.column,row.privilege].join('/'));
 for(const row of document.rows)expected.push([row.role,row.relation,row.column,row.privilege].join('/'));
 const actual=[];
 for(const m of sql.matchAll(/GRANT (SELECT|INSERT|UPDATE) \(([^)]+)\) ON (?:TABLE )?public\."([^"]+)" TO "([^"]+)";/gu))for(const col of m[2].matchAll(/"([^"]+)"/gu))actual.push([m[4],m[3],col[1],m[1]].join('/'));
 for(const m of sql.matchAll(/GRANT (DELETE) ON (?:TABLE )?public\."([^"]+)" TO "([^"]+)";/gu))actual.push([m[3],m[2],null,m[1]].join('/'));
 assert.deepEqual(actual.sort(),expected.sort());
 assert.doesNotMatch(sql,/EXECUTE 'GRANT SELECT|GRANT ALL|GRANT UPDATE \("id"\) ON public\."FileObject"/u);
 assert.match(sql,/has_function_privilege/u);
 assert.equal((sql.match(/^GRANT EXECUTE ON FUNCTION /gmu)??[]).length,46);
 assert.ok(!sql.match(/GRANT EXECUTE[^\n]+jg_c259_doc_queue/u));
 assert.ok(sql.includes('actual EXCEPT ALL SELECT * FROM expected'));
 assert.ok(!sql.includes('GRANT SELECT ("fileId") ON public."RegisteredPaymentVoucher"'));
 assert.throws(()=>renderNativeLifecycleFixture({...scope,source:{...source,profile:{...qualifiedProfile,ledger:qualifiedProfile.ledger.slice(0,259)}}},secrets));
 assert.throws(()=>renderNativeLifecycleFixture({...scope,source:undefined},secrets));
});
