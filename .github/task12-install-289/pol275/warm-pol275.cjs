'use strict';
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const candidateApi='/qualification/workspace/services/api';
const reviewedApi='/qualification/pol275-legacy/services/api';
const current={api:candidateApi,spec:'clearing-reconciliation-concurrency.spec.ts',flag:'RUN_POL275_CLEARING_RECONCILIATION_DATABASE',count:10};
const legacy={api:reviewedApi,spec:'clearing-reconciliation-legacy-compatibility.spec.ts',flag:'RUN_POL275_LEGACY_PROCESS_COMPATIBILITY',count:1};

function executeProcess(profile, env, observe, spawn = spawnSync) {
  const result=spawn(process.execPath,[join(profile.api,'node_modules/jest/bin/jest.js'),'--config','jest.config.cjs','--runInBand','--runTestsByPath',
    'src/database/'+profile.spec,'--json'],{cwd:profile.api,env:{...env,[profile.flag]:'1'},timeout:300000,encoding:'utf8',maxBuffer:16*1024*1024});
  let tests;
  try { tests=result.stdout?.trim() ? JSON.parse(result.stdout) : undefined; } catch {}
  observe(boundedJestResult(result,tests));
  tests ??= {};
  if (result.status!==0 || tests.numTotalTestSuites!==1 || tests.numPassedTestSuites!==1 ||
      tests.numTotalTests!==profile.count || tests.numPassedTests!==profile.count || tests.numPendingTests!==0) {
    throw Object.assign(new Error('POL275_ORIGINAL_TEST_COVERAGE'),{
      exit:result.status,prismaCode:/\bP[0-9]{4}\b/u.exec(result.stderr || '')?.[0],
    });
  }
  return {suite:profile.spec,passed:tests.numPassedTests,skipped:tests.numPendingTests};
}

async function verifyPol275(context,receipt,warm) {
  if (context.candidateTree!=='a1be083076018686dd8afba68c44ff9c75502014') throw new Error('POL275_289_SOURCE');
  const {collectEvidence}=require(join(candidateApi,'prisma/pol275-original-evidence.cjs'));
  if (warm) {
    const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:context.workDir,TMPDIR:context.workDir,NODE_ENV:'test',
      DATABASE_URL:businessDatabaseUrl(context.ownerUrl),FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:join(context.workDir,'storage','private'),
      OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID(),POL275_OWNED_289_RUN_ID:context.runId.replaceAll('-','')};
    receipt.stages.push('POL275_CURRENT_PROCESS');
    receipt.currentProcess=executeProcess(current,env,witness=>receipt.currentProcessObservation=witness);
    receipt.stages.push('POL275_REVIEWED_LEGACY_PROCESS');
    receipt.legacyProcess=executeProcess(legacy,env,witness=>receipt.legacyProcessObservation=witness);
  }
  receipt.stages.push('POL275_ORIGINAL_CATALOG');
  const catalog=await collectEvidence(context.ownerUrl,289);
  receipt.pol275={migrationCount:catalog.migrationCount,originalTerminal:catalog.terminalMigration};
}
function businessDatabaseUrl(ownerUrl) {
  const endpoint=new URL(ownerUrl);
  endpoint.searchParams.delete('connection_limit');
  return endpoint.toString();
}

function boundedJestResult(result,tests) {
  const statuses = new Set(['failed','timedOut']);
  const classify = value => {
    const text = typeof value==='string' ? value : '';
    return {
      prismaCodes:[...new Set(text.match(/\bP[0-9]{4}\b/gu) ?? [])].slice(0,4),
      sqlstates:[...new Set(text.match(/\b(?:42501|23505|23514|55P03|40P01|57014|28P01|28000)\b/gu) ?? [])].slice(0,4),
      categories:['no pg_hba.conf entry','Timed out fetching a new connection','Transaction already closed',
        'Exceeded timeout','POL-275 测试只允许','AssertionError'].filter(marker=>text.includes(marker)),
    };
  };
  const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=20?value:undefined;
  const matches=Array.isArray(tests?.testResults)?tests.testResults.slice(0,1):[];
  const cases=Array.isArray(matches[0]?.assertionResults)?matches[0].assertionResults.slice(0,12):[];
  return {
    exit:Number.isInteger(result.status)?result.status:null,reportPresent:!!tests,
    pending:count(tests?.numPendingTests),passed:count(tests?.numPassedTests),failed:count(tests?.numFailedTests),
    failedCases:cases.flatMap((row,index)=>statuses.has(row.status)?[{position:index+1,
      ...classify((row.failureMessages ?? []).filter(message=>typeof message==='string').join(' '))}]:[]),
    suite:classify([matches[0]?.message,result.stderr].filter(value=>typeof value==='string').join(' ')),
  };
}
module.exports={verifyPol275,executeProcess,boundedJestResult,businessDatabaseUrl};
