'use strict';

const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {mkdtempSync, readFileSync} = require('node:fs');
const path = require('node:path');

const spec = 'src/database/file-binding-catalog.pg.spec.ts';
const fixtureSha256 = 'c16cb74906868ec1d7ce3556ad3defb875902834d16f72d727d943eb2c842e16';
const titlesSha256 = '3f66dd28b2cc7845e36729e5e7b221153bdba963ae44ca52cefdca25cbee5690';
const sha256 = value => createHash('sha256').update(value).digest('hex');

function assertFixture(api) {
  const fixture = readFileSync(path.join(api,spec),'utf8');
  assert.equal(sha256(fixture),fixtureSha256,'FILE_BINDING_CATALOG_FIXTURE');
  const titles = [...fixture.matchAll(/^\s+it\("([^"]+)",/gmu)].map(match => match[1]);
  assert.equal(titles.length,6,'FILE_BINDING_CATALOG_CASE_COUNT');
  assert.equal(sha256(JSON.stringify(titles)),titlesSha256,'FILE_BINDING_CATALOG_TITLE_ORDER');
  return {fixtureSha256,titlesSha256};
}

async function outerWitness(context, source) {
  const result = await context.sql(
    "SELECT jsonb_build_object('database', current_database(), 'oid', d.oid::text, 'ownerOid', d.datdba::integer, " +
    "'actorOid', current_user::regrole::oid::integer, 'bootstrap', current_user=session_user AND current_user='jg_task01_owner', " +
    "'systemIdentifier', (pg_control_system()).system_identifier::text, " +
    "'postmasterStart', pg_postmaster_start_time(), 'tls', (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()), " +
    "'scratchDatabases', (SELECT count(*) FROM pg_catalog.pg_database WHERE datname ~ '^file_binding_catalog_[0-9a-f]{12}$'), " +
    "'replayRoles', (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname ~ '^file_binding_catalog_replay_[0-9a-f]{12}$'), " +
    "'ledger', (SELECT jsonb_agg(jsonb_build_object('name', migration_name, 'sha256', checksum, " +
    "'finished', finished_at IS NOT NULL, 'rolledBack', rolled_back_at IS NOT NULL) ORDER BY migration_name COLLATE \"C\") " +
    "FROM public._prisma_migrations)) FROM pg_catalog.pg_database d WHERE d.datname=current_database();"
  );
  const {ledger, ...identity} = JSON.parse(result.stdout);
  assert.equal(identity.database,context.database,'FILE_BINDING_CATALOG_OUTER_DATABASE');
  assert.equal(identity.ownerOid,10,'FILE_BINDING_CATALOG_OUTER_OWNER');
  assert.equal(identity.actorOid,10,'FILE_BINDING_CATALOG_OUTER_ACTOR');
  assert.equal(identity.bootstrap,true,'FILE_BINDING_CATALOG_OUTER_BOOTSTRAP');
  assert.equal(identity.tls,true,'FILE_BINDING_CATALOG_OUTER_TLS');
  assert.equal(identity.scratchDatabases,0,'FILE_BINDING_CATALOG_SCRATCH_DATABASE');
  assert.equal(identity.replayRoles,0,'FILE_BINDING_CATALOG_REPLAY_ROLE');
  assert.equal(ledger.length,source.migrationCount,'FILE_BINDING_CATALOG_OUTER_COUNT');
  assert.equal(
    sha256(JSON.stringify(ledger.map(({name,sha256,finished,rolledBack}) => ({name,sha256,finished,rolledBack})))),
    source.ledgerSha256,
    'FILE_BINDING_CATALOG_OUTER_LEDGER'
  );
  return identity;
}

function runOriginal(context, api) {
  const {ownerUrl,workDir,runId,database} = context;
  const endpoint = new URL(ownerUrl);
  assert.ok(endpoint.protocol==='postgresql:' && endpoint.hostname==='127.0.0.1' &&
    endpoint.username==='jg_task01_owner' && database==='jg_task01_'+runId.replaceAll('-','') &&
    endpoint.pathname==='/'+database && endpoint.searchParams.get('sslmode')==='require' &&
    endpoint.searchParams.get('sslaccept')==='strict' && endpoint.searchParams.get('sslcert')===path.join(workDir,'ca.crt'),
    'FILE_BINDING_CATALOG_CONNECTION');
  const reportFile = path.join(mkdtempSync(path.join(workDir,'file-binding-catalog-')),'jest.json');
  const result = spawnSync(process.execPath,[
    path.join(api,'node_modules/jest/bin/jest.js'),'--runInBand','--runTestsByPath',spec,'--json','--outputFile='+reportFile
  ],{
    cwd:api, timeout:240_000, maxBuffer:8*1024*1024,
    env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:workDir,TMPDIR:workDir,NODE_ENV:'test',CI:'true',
      DATABASE_URL:endpoint.toString(),RUN_FILE_BINDING_CATALOG_DATABASE:'1'}
  });
  assert.equal(result.status,0,'FILE_BINDING_CATALOG_ORIGINAL_JEST');
  const report = JSON.parse(readFileSync(reportFile,'utf8'));
  assert.ok(report.success && report.numTotalTests===6 && report.numPassedTests===6 && report.numPendingTests===0 &&
    report.testResults.length===1 && report.testResults[0].name===path.join(api,spec),'FILE_BINDING_CATALOG_ORIGINAL_COVERAGE');
  const titles = report.testResults[0].assertionResults.map(row => row.title);
  assert.equal(sha256(JSON.stringify(titles)),titlesSha256,'FILE_BINDING_CATALOG_TITLE_ORDER');
}

async function main(receipt, source) {
  const root = '/qualification';
  const api = path.join(root,'workspace/services/api');
  assert.equal(process.argv.length,2);
  assert.notEqual(process.getuid(),0);
  assert.equal(process.env.DATABASE_URL,undefined);
  assert.match(source.sourceSha,/^[a-f0-9]{40}$/u);
  receipt.originalInputs = assertFixture(api);
  const count = source.migrationCount;
  assert.ok([346,349,350,352].includes(count), 'FILE_BINDING_CATALOG_MIGRATION_SCOPE');
  const witness = require('./payment-execution-'+count+'.cjs');
  receipt.input = require('./install-only292.cjs').admitSource(root,root+'/source/services/api/prisma',root+'/source-seal.txt');
  await witness.install(receipt,async context=>{
    receipt.stages.push('FILE_BINDING_CATALOG_OUTER_BEFORE');
    const before = await outerWitness(context,source);
    receipt.stages.push('FILE_BINDING_CATALOG_ORIGINAL_JEST');
    runOriginal(context,api);
    receipt.stages.push('FILE_BINDING_CATALOG_OUTER_AFTER');
    assert.deepEqual(await outerWitness(context,source),before,'FILE_BINDING_CATALOG_OUTER_IDENTITY');
    receipt.original = {passed:6,skipped:0,scratchClean:true,outerIdentityUnchanged:true};
  },source);
  witness.assertInstallation(receipt,source);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status = 'FILE_BINDING_CATALOG_'+count+'_PASSED';
}

module.exports = {assertFixture};

if (require.main === module) {
  const source = require('./contract-finance-source.json');
  const receipt = {schemaVersion:1,sourceSha:source.sourceSha,status:'STOPPED',stages:['INPUTS']};
  main(receipt,source).catch(()=>{
    receipt.failure = {stage:receipt.stages.at(-1)};
    process.exitCode = 1;
  }).finally(()=>console.log(JSON.stringify(receipt)));
}
