'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {isCiDynamicDatabase,projectTechnicalSql,ciDynamicRecoveryMigration}=require('./local-staged-technical-profile-policy.cjs');
const source=fs.readFileSync(path.join(__dirname,'local-staged-tail-post213.sql'),'utf8');
const legacy='jiangkong_project_financing_quota_main';
const ciFixture='DYNAMIC_PAYMENT_EXECUTION_V1';

test('allows only the fixed CI payment primary and valid retained databases',()=>{
 for(const database of ['jiangkong_payment_execution_concurrency','jiangkong_payment_execution_retained_valid']){
  assert.equal(isCiDynamicDatabase(ciFixture,database),true);
  const projected=projectTechnicalSql({ciFixture,database},source,'post213');
  assert.equal(projected.sql.split("'^"+database+"$'").length,3);
  assert.equal(projected.sql.split("'^"+database+"$'").join("'^jiangkong_project_financing_quota_[a-z0-9_]+$'"),source);
  assert.equal(projectTechnicalSql({ciFixture,database},source,'setup').sql,source);
 }
 for(const database of ['postgres',legacy,'jiangkong_payment_execution_retained_paid_mismatch','jiangkong_payment_execution_concurrency_other']){
  assert.equal(isCiDynamicDatabase(ciFixture,database),false);
  assert.throws(()=>projectTechnicalSql({ciFixture,database},source,'post213'));
 }
 assert.equal(projectTechnicalSql({database:legacy},source,'post213').sql,source);
});

test('only the two explicit expense recovery databases recognize their own historical rollback',()=>{
 const execution='DYNAMIC_PROJECT_EXPENSE_EXECUTION_V1';
 const finance='DYNAMIC_PROJECT_EXPENSE_FINANCE_V1';
 const executionRecovery='jiangkong_project_expense_execution_retained_audit_missing';
 const financeRecovery='jiangkong_project_expense_finance_retained_audit_missing';
 assert.equal(ciDynamicRecoveryMigration(execution,executionRecovery),'20260728140000_project_expense_execution_idempotency');
 assert.equal(ciDynamicRecoveryMigration(finance,financeRecovery),'20260728150000_project_expense_finance_idempotency');
 assert.equal(ciDynamicRecoveryMigration(execution,financeRecovery),undefined);
 assert.equal(ciDynamicRecoveryMigration(finance,'jiangkong_project_expense_finance_retained_valid'),undefined);
 assert.equal(isCiDynamicDatabase(finance,executionRecovery),false);
});

test('the CI adapter only observes and executes inside the captured container and database',async()=>{
 const entry=path.join(__dirname,'local-staged-ci-dynamic.cjs'),mod={exports:{}};
 const load=name=>name==='./local-staged-migrations.cjs'?
  {createLocalMigrationFixture:input=>input}:require(name);
 new Function('require','module',fs.readFileSync(entry,'utf8'))(load,mod);
 const {createCiDynamicMigrationFixture,CI_DYNAMIC_MIGRATION_LABEL}=mod.exports;
 const container={id:'a'.repeat(64),name:'jiangkong-payment-ci',runId:'12345678-1234-4234-8234-123456789012'};
 const databaseNames=['jiangkong_payment_execution_concurrency'],calls=[];
 let foreignPort=false;
 const fixture=createCiDynamicMigrationFixture({ciFixture,container,databaseNames,temporaryRoot:'/synthetic',deploy(){},
  async dockerCommand(args,options){
   calls.push({args,options});
   if(args[0]==='inspect')return {stdout:JSON.stringify({
    id:'a'.repeat(64),name:'/jiangkong-payment-ci',runId:container.runId,running:true,
    ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'35432'},...(foreignPort?[{HostIp:'0.0.0.0',HostPort:'35432'}]:[])]}
   })};
   return {stdout:'fixed output'};
  }
 });
 container.id='b'.repeat(64);databaseNames.push('postgres');
 await assert.rejects(fixture.inspectContainer(container.id),/RESOURCE/u);
 assert.deepEqual(await fixture.inspectContainer('a'.repeat(64)),{
  id:'a'.repeat(64),name:'jiangkong-payment-ci',runId:container.runId,running:true,publishedHost:'127.0.0.1',publishedPort:'35432'
 });
 assert.match(calls[0].args[4],new RegExp(CI_DYNAMIC_MIGRATION_LABEL,'u'));
 assert.equal(calls[0].args[5],'a'.repeat(64));
 await assert.rejects(fixture.executeSql({database:'postgres',phase:'stage205-readback',sql:'fixed'}),/RESOURCE/u);
 const database='jiangkong_payment_execution_concurrency';
 await fixture.executeSql({database,phase:'stage205-readback',sql:'fixed'});
 assert.deepEqual(calls.at(-1).args,['exec','--interactive','a'.repeat(64),'psql','-h','127.0.0.1','-U','jiangkong','-d',database,
  '-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse','-f','-']);
 assert.equal(calls.at(-1).options.stdinText,'fixed');
 assert.ok(calls.at(-1).options.maxOutputBytes>1024*1024);
 foreignPort=true;
 await assert.rejects(fixture.inspectContainer('a'.repeat(64)),/RESOURCE/u);
});
