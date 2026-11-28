'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { runtimeProbeSql } = require('./task12-onboarding-282-admission.cjs');
const { renderTemporaryMetadataAlias } = require('./task12-onboarding-metadata-alias.cjs');

const { summarizeDownstream } = require('./onboarding-downstream-failures.cjs');
const { verifyOriginalAcl } = require('./onboarding-original-acl.cjs');
const { stageOnboardingWorkspace } = require('./onboarding-stage-workspace.cjs');
const suites = [{phase:'ONBOARDING_ORIGINAL_INDEPENDENT_29',expected:29,specs:{
  'employee-onboarding-http-postgres':12,
  'employee-role-consistency-http-postgres':8,
  'employee-phone-reuse-postgres':7,
  'personnel-roster-read-http-postgres':2,
}}];
const workspace = '/qualification/workspace';
const api = path.join(workspace, 'services/api');

function need(condition, stage) {
  if (!condition) throw new Error('ONBOARDING_CANVAS_'+stage);
}

async function run(context, receipt) {
  const { database, runId } = context;
  const url = new URL(context.onboardingUrl);
  const port = Number(url.port);
  need(context.candidateTree==='a1be083076018686dd8afba68c44ff9c75502014'
    && url.username==='onboarding_runtime' && url.hostname==='127.0.0.1' && url.pathname==='/'+database
    && database==='jg_task01_'+runId.replaceAll('-','') && url.searchParams.get('sslaccept')==='strict','OWNER_CONTEXT');
  receipt.stages.push('ONBOARDING_ORIGINAL_ACL');
  await context.bootstrapOnboarding();
  receipt.onboardingOriginalAcl=await verifyOriginalAcl(context);
  const roleOid=(await context.sql("SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname='onboarding_runtime'")).stdout.trim();
  const probe=runtimeProbeSql(database,port);
  need((await context.onboardingSql(probe)).stdout.trim()==='t','RUNTIME_LOGIN');
  const state=async()=>JSON.parse((await context.onboardingSql(`SELECT jsonb_build_object(
    'metadata',has_function_privilege(current_user,'public.jg_file_business_binding_columns_before_registered_payment()','EXECUTE'),
    'voucherFileRead',has_column_privilege(current_user,'public."RegisteredPaymentVoucher"','fileId','SELECT'),
    'voucherOtherRead',has_column_privilege(current_user,'public."RegisteredPaymentVoucher"','executionId','SELECT'),
    'voucherGrantOption',has_column_privilege(current_user,'public."RegisteredPaymentVoucher"','fileId','SELECT WITH GRANT OPTION'),
    'voucherTableWrite',has_table_privilege(current_user,'public."RegisteredPaymentVoucher"','INSERT,UPDATE,DELETE'),
    'metadataGrantable',has_function_privilege(current_user,'public.jg_file_business_binding_columns_before_registered_payment()','EXECUTE WITH GRANT OPTION'),
    'raw',has_function_privilege(current_user,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE'),
    'deleteApplication',has_table_privilege(current_user,'public."EmployeeRegistration"','DELETE'),
    'writeLedger',has_table_privilege(current_user,'public."OperatingFact"','INSERT'),
    'readSecret',has_table_privilege(current_user,'public."OperatingLedgerWriteSecret"','SELECT'),
    'readNativeBinding',has_table_privilege(current_user,'public.jg_registered_payment_voucher_check_binding_v1','SELECT'),
    'deletePersonnelChange',has_table_privilege(current_user,'public."PersonnelChange"','DELETE'));`)).stdout);
  const assertState=async(metadata)=>{
    const observed=await state();
    need(observed.metadata===metadata && observed.voucherFileRead===metadata && Object.entries(observed).filter(([key])=>key!=='metadata'&&key!=='voucherFileRead')
      .every(([,present])=>present===false),'RUNTIME_ACL');
    return observed;
  };
  const before=await assertState(false);
  receipt.stages.push('ONBOARDING_ALIAS_GRANT');
  await context.sql(renderTemporaryMetadataAlias({database,port,roleOid,stage:'grant'}));
  try {
    const active=await assertState(true);
    receipt.onboardingAclScope={before,active};
    const scopedWorkspace=context.workDir;
    stageOnboardingWorkspace(scopedWorkspace);
    const storage=path.join(scopedWorkspace,'onboarding-files');
    fs.mkdirSync(storage,{mode:0o700});
    url.searchParams.delete('connection_limit');
    url.searchParams.delete('pool_timeout');
    const randomSecret=()=>randomBytes(32).toString('hex');
    const env={PATH:process.env.PATH,NODE_ENV:'test',HOME:scopedWorkspace,TMPDIR:scopedWorkspace,CI:'true',
      RUN_EMPLOYEE_ONBOARDING_PG16:'1',TASK_ONBOARDING_282_RUN_ID:runId.replaceAll('-',''),
      TASK_ONBOARDING_282_WEB_ROOT:scopedWorkspace,COREPACK_HOME:'/opt/corepack',
      COREPACK_DEFAULT_TO_LATEST:'0',COREPACK_ENABLE_NETWORK:'0',PLAYWRIGHT_BROWSERS_PATH:'/opt/jg-playwright',
      FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:storage,INITIAL_USER_TEMPORARY_PASSWORD:'Local-Initial-Only-01',
      SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',DATABASE_URL:url.toString(),
      JWT_ACCESS_SECRET:randomSecret(),JWT_REFRESH_SECRET:randomSecret(),FILE_DOWNLOAD_SECRET:randomSecret()};
    receipt.onboardingSuites=[];
    for(const {phase,expected,specs} of suites){
      receipt.stages.push(phase);
      const entries=Object.entries(specs).map(([file,count])=>['src/database/'+file+'.owned282.spec.ts',count]);
      const args=[path.join(api,'node_modules/jest/bin/jest.js'),'--runInBand','--json','--runTestsByPath',
        ...entries.map(([file])=>file)];
      const logSize=context.readPostgresLog().length;
      const result=await new Promise(resolve=>execFile(process.execPath,args,{
        cwd:api,encoding:'utf8',timeout:180_000,maxBuffer:32*1024*1024,env,
      },(error,stdout,stderr)=>resolve({
        status:error ? (typeof error.code==='number' ? error.code : null) : 0,
        signal:error?.signal ?? null, stdout,stderr,error,
      })));
      let json;
      try {json=JSON.parse(result.stdout||'{}');}catch{json={};}
      const messages=(result.stderr??'')+(json.testResults??[]).flatMap(suite=>suite.assertionResults??[])
        .flatMap(test=>test.failureMessages??[]).join('\n');
      const errors=context.readPostgresLog().slice(logSize).split('\n').flatMap(line=>{
        const match=/permission denied for (table|function|schema) ([A-Za-z0-9_".]{1,100})\s*$/u.exec(line);
        return match ? [{kind:match[1],name:match[2]}] : [];
      });
      receipt.onboardingSuites.push({phase,exit:result.status,signal:result.signal,passed:json.numPassedTests,
        failed:json.numFailedTests,skipped:json.numPendingTests,
        bootError:typeof result.error?.code==='string' ? result.error.code : undefined,
        suites:summarizeDownstream(json,api,entries),
        denied:[...new Map(errors.map(error=>[error.kind+error.name,error])).values()].slice(0,8)});
      const exactCounts=entries.every(([file,count])=>json.testResults?.some(suite=>suite.name===path.join(api,file)
        && suite.assertionResults.filter(test=>test.status==='passed').length===count));
      need(result.status===0&&json.numPassedTestSuites===entries.length&&json.numPassedTests===expected
        &&json.numFailedTests===0&&json.numPendingTests===0&&exactCounts,'ORIGINAL_JEST');
    }
  } finally {
    receipt.stages.push('ONBOARDING_ALIAS_REVOKE');
    await context.sql(renderTemporaryMetadataAlias({database,port,roleOid,stage:'revoke'}));
    await assertState(false);
    receipt.onboardingAliasRevoked=true;
    receipt.onboardingVoucherColumnRevoked=true;
  }
}

module.exports = { run };
