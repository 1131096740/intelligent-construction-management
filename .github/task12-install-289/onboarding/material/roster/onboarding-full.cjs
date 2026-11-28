'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { runtimeProbeSql } = require('./task12-onboarding-282-admission.cjs');
const { renderTemporaryMetadataAlias } = require('./task12-onboarding-metadata-alias.cjs');

const { reportLifecycleFailures } = require('./onboarding-failure-fields.cjs');
const { verifyOriginalAcl } = require('./onboarding-original-acl.cjs');
const { stageOnboardingWorkspace } = require('./onboarding-stage-workspace.cjs');
const { openRosterVersionSeed } = require('./onboarding-roster-seed.cjs');
const suites = [{ phase:'ONBOARDING_ORIGINAL_ROSTER10',expected:10,specs:{
  'project-roster-http-postgres':10,
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
  let rosterSeed;
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
    rosterSeed=await openRosterVersionSeed(context,receipt);
    Object.assign(env,rosterSeed.env);
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
      const detailClick=phase==='ONBOARDING_ORIGINAL_PERSONNEL_LIFECYCLE'
        ? [...messages.matchAll(/ONBOARDING_DETAILS_OBS (\{"project":"(?:desktop|mobile)","controls":(?:null|\[(?:\{"visible":(?:true|false),"enabled":(?:true|false)\}(?:,\{"visible":(?:true|false),"enabled":(?:true|false)\})?)?\]),"capabilityStatus":(?:null|[1-5][0-9]{2}),"capabilityTarget":(?:null|true|false)\})/gu)]
          .slice(0,2).map(match=>JSON.parse(match[1]))
        : [];
      const rosterFailures=(json.testResults??[]).flatMap(suite=>suite.assertionResults??[])
        .filter(test=>test.status==='failed').slice(0,10).map(test=>{
          const failure=(test.failureMessages??[]).join('\n').replace(/\x1b\[[0-9;]*m/gu,'');
          const statuses=/Expected:\s*(\d{3})\s+Received:\s*(\d{3})/u.exec(failure);
          return {caseSha256:createHash('sha256').update(test.fullName).digest('hex'),
            ...(statuses&&{expectedHttp:Number(statuses[1]),actualHttp:Number(statuses[2])}),
            prisma:[...new Set(failure.match(/\bP[0-9]{4}\b/gu)??[])].slice(0,4),
            fields:['ROSTER10_SEED_ORIGINAL_PROJECT','ROSTER10_SEED_REFUSED','ROSTER10_SEED_TIMEOUT','ROSTER10_SEED_COORDINATES',
              'Timeout','ERR_ABORTED','page crashed'].filter(field=>failure.includes(field))};
        });
      receipt.onboardingSuites.push({phase,detailClick,rosterFailures,exit:result.status,signal:result.signal,passed:json.numPassedTests,
        failed:json.numFailedTests,skipped:json.numPendingTests,bootError:result.error?.code,
        browser:[...new Set(['webkit','chromium','page crashed','ERR_ABORTED','Timeout'].filter(marker=>
          messages.toLowerCase().includes(marker.toLowerCase())))],
        denied:[...new Map(errors.map(error=>[error.kind+error.name,error])).values()].slice(0,8),
        ...(phase==='ONBOARDING_ORIGINAL_PERSONNEL_LIFECYCLE' && {
          failedCases:reportLifecycleFailures(json),
        })});
      const exactCounts=entries.every(([file,count])=>json.testResults?.some(suite=>suite.name===path.join(api,file)
        && suite.assertionResults.filter(test=>test.status==='passed').length===count));
      receipt.rosterPeer=rosterSeed.report();
      need(result.status===0&&json.numPassedTestSuites===entries.length&&json.numPassedTests===expected
        &&json.numFailedTests===0&&json.numPendingTests===0&&exactCounts,'ORIGINAL_JEST');
      need(receipt.rosterPeer.coordinates.every(Boolean)&&receipt.rosterPeer.denials===2,'ROSTER_SEED_WITNESS');
    }
  } finally {
    try { if(rosterSeed)await rosterSeed.close(); }
    finally{
      receipt.stages.push('ONBOARDING_ALIAS_REVOKE');
      await context.sql(renderTemporaryMetadataAlias({database,port,roleOid,stage:'revoke'}));
      await assertState(false);
      receipt.onboardingAliasRevoked=true;
      receipt.onboardingVoucherColumnRevoked=true;
    }
  }
}

module.exports = { run };
