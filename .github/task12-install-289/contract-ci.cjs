'use strict';

const { spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { mkdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const releaseWorkspace = '/qualification/workspace';
const profiles = Object.freeze({
  '--contract-template-ci': {
    specs:['contract-template-scenario-concurrency.spec.ts'],
    count:7,
    flags:['RUN_CONTRACT_TEMPLATE_SCENARIO_CONCURRENCY'],
    targets:['CONTRACT_TEMPLATE_SCENARIO_DATABASE_URL'],
  },
  '--settlement-draft-282-ci': {
    specs:['settlement-draft-lifecycle-concurrency.spec.ts'],
    count:1,
    flags:['RUN_SETTLEMENT_DRAFT_LIFECYCLE_CONCURRENCY'],
    targets:[],
  },
  '--contract-settlement-ci': {
    specs:['contract-bill-batch-replace-concurrency.spec.ts','contract-bill-transition-confirm-concurrency.spec.ts'],
    count:2,
    flags:['RUN_CONTRACT_BILL_BATCH_DATABASE','RUN_CONTRACT_BILL_TRANSITION_CONFIRM_DATABASE'],
    targets:['CONTRACT_BILL_BATCH_DATABASE_URL','CONTRACT_BILL_TRANSITION_CONFIRM_DATABASE_URL'],
    settlement:true,
  },
});

function verify(mode, { ownerUrl, runId, workDir }) {
  const profile = profiles[mode];
  if (!profile || !Object.hasOwn(profiles,mode)) throw new Error('OWNED_280_CONTRACT_MODE');
  const report = join(workDir,'contract-jest.json');
  const storage = join(workDir,'contract-storage');
  mkdirSync(storage,{mode:0o700});
  const env = {
    PATH:'/usr/local/bin:/usr/bin:/bin', HOME:workDir, TMPDIR:workDir,
    COREPACK_HOME:'/opt/corepack', COREPACK_ENABLE_NETWORK:'0',
    NODE_ENV:'test', CI:'true', SEED_PASSWORD:randomBytes(32).toString('hex'),
    DATABASE_URL:ownerUrl, FILE_STORAGE_DRIVER:'local', FILE_STORAGE_ROOT:storage,
    JG_TASK12_OWNED_280_RUN_ID:runId,
    ...Object.fromEntries(profile.flags.map(flag=>[flag,'1'])),
    ...Object.fromEntries(profile.targets.map(target=>[target,ownerUrl])),
  };
  function run(stage,file,args,cwd=releaseWorkspace) {
    const result = spawnSync(file,args,{cwd,env,timeout:180_000,maxBuffer:1024*1024,encoding:'utf8'});
    if (result.status !== 0) {
      throw Object.assign(new Error(stage), {
        exit:result.status, signal:result.signal, executionError:result.error?.code ?? /\b(ENOENT|EACCES|MODULE_NOT_FOUND)\b/u.exec(result.stderr || '')?.[1],
        sqlstate:/\b(?:code|SQLSTATE)\W+([0-9A-Z]{5})\b/u.exec(result.stderr || '')?.[1],
        prismaCode:/\bP[0-9]{4}\b/u.exec(result.stderr || '')?.[0],
      });
    }
  }
  const pnpm = ['--filter','@jiangkong/api','exec'];
  run('OWNED_280_CONTRACT_MIGRATION_STATUS','pnpm',[...pnpm,'prisma','migrate','status']);
  let precheckSha256;
  if (profile.settlement) {
    run('OWNED_280_CONTRACT_SETTLEMENT_SEED',process.execPath,[join(releaseWorkspace,'services/api/prisma/seed.cjs')],workDir);
    const precheck = join(workDir,'contract-settlement-precheck.json');
    run('OWNED_280_CONTRACT_SETTLEMENT_PRECHECK',process.execPath,[
      join(releaseWorkspace,'services/api/prisma/precheck-contract-settlement-v2.cjs'),
      '--output',precheck,
    ]);
    precheckSha256 = createHash('sha256').update(readFileSync(precheck)).digest('hex');
  }
  run('OWNED_280_CONTRACT_JEST','pnpm',[...pnpm,'jest','--runInBand','--runTestsByPath',
    ...profile.specs.map(name=>'src/database/'+name),'--json','--outputFile='+report]);
  const parsed = JSON.parse(readFileSync(report,'utf8'));
  const names = profile.specs.map(name=>'services/api/src/database/'+name);
  if (parsed.success !== true || parsed.numPendingTests !== 0 || parsed.numPassedTests !== profile.count ||
     parsed.numPassedTestSuites !== names.length ||
     !names.every(name=>parsed.testResults.some(item=>item.name.endsWith('/'+name)))) {
    throw new Error('OWNED_280_CONTRACT_COVERAGE');
  }
  return {suites:names,tests:parsed.numPassedTests,skipped:parsed.numPendingTests,...(precheckSha256 ? {precheckSha256} : {})};
}
module.exports = { verify };
