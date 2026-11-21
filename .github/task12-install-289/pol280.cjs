'use strict';
const {join} = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const api = '/qualification/workspace/services/api';
const suite = 'src/database/project-fund-dispute-postgresql.spec.ts';

function runPol280(context, receipt, spawn = spawnSync) {
  const {ownerUrl, workDir} = context;
  const env = {
    PATH:'/usr/local/bin:/usr/bin:/bin:/usr/lib/postgresql/16/bin', LANG:'C', LC_ALL:'C', TZ:'UTC',
    HOME:workDir, TMPDIR:workDir, DATABASE_URL:ownerUrl, NODE_ENV:'test', CI:'true',
    RUN_POL280_PROJECT_FUND_DISPUTE_PG16:'1', FILE_STORAGE_DRIVER:'local',
    FILE_STORAGE_ROOT:join(workDir,'storage','private'),
    OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID(), SEED_PASSWORD:'Local@1-'+randomUUID(),
  };
  function run(stage,args,cwd,timeout,childEnv=env) {
    receipt.stages.push(stage);
    const result = spawn(process.execPath,args,{cwd,timeout,env:childEnv,encoding:'utf8',maxBuffer:16*1024*1024});
    if (result.status !== 0 && stage !== 'POL280_ORIGINAL_JEST') {
      throw Object.assign(new Error(stage),{exit:result.status,signal:result.signal,
        prismaCode:/\bP[0-9]{4}\b/u.exec(result.stderr || '')?.[0],
        sqlstate:/(?:Database error code:\s*|ERROR:\s+)([0-9A-Z]{5})(?=[:\s]|$)/u.exec(result.stderr || '')?.[1]});
    }
    return result;
  }

  const replay = run('POL280_REPLAY',[join(api,'node_modules/prisma/build/index.js'),'migrate','deploy',
    '--schema',join(api,'prisma/schema.prisma')],api,180_000);
  if (!replay.stdout.includes('No pending migrations to apply.')) throw new Error('POL280_REPLAY_NOT_NOOP');
  run('POL280_SEED',[join(api,'prisma/seed.cjs')],workDir,180_000);
  const endpoint = new URL(ownerUrl);
  endpoint.searchParams.set('connection_limit','3');
  const result = run('POL280_ORIGINAL_JEST',[join(api,'node_modules/jest/bin/jest.js'),
    '--runInBand','--runTestsByPath',suite,'--json'],api,300_000,{...env,DATABASE_URL:endpoint.toString()});
  const tests = result.stdout.trim() ? JSON.parse(result.stdout) : {};
  receipt.pol280={suite,replayNoop:true,seed:true,lockSessionCapacity:3,jestExit:result.status,
    total:tests.numTotalTests,passed:tests.numPassedTests,failed:tests.numFailedTests,skipped:tests.numPendingTests,
    failedCases:tests.testResults?.flatMap(row=>row.assertionResults.filter(test=>test.status==='failed').map(test=>({
      title:test.title,
      prismaCodes:[...new Set((test.failureMessages ?? []).join(' ').match(/\bP[0-9]{4}\b/gu) ?? [])],
      categories:['duplicate_blocked','FUND_EXECUTION_REFRESH_REQUIRED','Transaction already closed',
        'Timed out fetching a new connection','deadlock detected'].filter(text=>
          test.failureMessages?.some(message=>message.includes(text))),
    })))};
  if (result.status!==0 || tests.numTotalTestSuites!==1 || tests.numPassedTestSuites!==1 ||
      tests.numTotalTests!==5 || tests.numPassedTests!==5 || tests.numPendingTests!==0) throw new Error('POL280_ORIGINAL_COVERAGE');
}
module.exports={runPol280};
