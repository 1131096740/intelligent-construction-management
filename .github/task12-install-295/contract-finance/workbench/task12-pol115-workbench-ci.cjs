'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const { stageWebWorkspace } = require('./task12-pol109-stage-browser.cjs');

const execute = promisify(execFile);
const workspace = '/qualification/workspace';
const apiRoot = path.join(workspace,'services/api');
const tree = '67644d9465a0ab4ee80ede099139d9c129d66f14';

function stageBrowser(workDir) {
  const side = stageWebWorkspace(workDir);
  const web = path.join(workDir,'apps/web-admin');
  const shared = path.join(workDir,'packages/shared-domain');
  const copy = file => fs.copyFileSync(path.join(workspace,file),path.join(workDir,file),fs.constants.COPYFILE_EXCL);
  fs.mkdirSync(path.dirname(web));
  fs.renameSync(side,web);
  fs.mkdirSync(path.join(web,'e2e'));
  fs.mkdirSync(path.join(workDir,'scripts'));
  fs.mkdirSync(shared,{recursive:true});
  for (const file of ['package.json','pnpm-workspace.yaml','scripts/pnpm-workspace.mjs',
    'packages/shared-domain/package.json','packages/shared-domain/tsconfig.json',
    'apps/web-admin/playwright.template-workbench-real.config.ts','apps/web-admin/e2e/template-workbench-real.e2e.ts']) copy(file);
  fs.cpSync(path.join(workspace,'packages/shared-domain/src'),path.join(shared,'src'),
    {recursive:true,force:false,errorOnExist:true});
  fs.mkdirSync(path.join(workDir,'node_modules'));
  fs.symlinkSync(path.join(workspace,'node_modules/.pnpm'),path.join(workDir,'node_modules/.pnpm'));
  fs.symlinkSync(path.join(workspace,'packages/shared-domain/node_modules'),path.join(shared,'node_modules'));
  fs.symlinkSync(path.join(workspace,'apps/web-admin/node_modules/.bin'),path.join(web,'node_modules/.bin'));
  const scope = path.join(web,'node_modules/@jiangkong');
  fs.unlinkSync(scope);
  fs.mkdirSync(scope);
  fs.symlinkSync(shared,path.join(scope,'shared-domain'));
  return web;
}

async function runWorkbench(context, receipt, source) {
  const precision=source?.mode==='expense-witness-349';
  const expenseWitness=precision||source?.mode==='expense-witness-346';
  const historicalSettlement=expenseWitness||source?.mode==='historical-settlement-334';
  const upwardArchive=historicalSettlement||source?.mode==='upward-archive-332';
  const paymentRemainder=upwardArchive||source?.mode==='payment-remainder-331';
  const textDirect=paymentRemainder||source?.mode==='text-direct-330';
  const current320=textDirect||source?.mode==='current-320';
  const count=precision?349:expenseWitness?346:historicalSettlement?334:upwardArchive?332:paymentRemainder?331:textDirect?330:current320?329:295;
  if (receipt.purpose !== 'POL115_WORKBENCH_ORIGINAL_'+count || context.candidateTree !== (current320?source.sourceTree:tree) ||
      context.database !== 'jg_task01_'+context.runId.replaceAll('-','')) {
    throw new Error('POL115_WORKBENCH_OWNED_SCOPE');
  }
  const uri = new URL(context.ownerUrl);
  if (uri.hostname !== '127.0.0.1' || uri.username !== 'jg_task01_owner' ||
      uri.pathname !== '/'+context.database || uri.searchParams.get('sslmode') !== 'require' ||
      uri.searchParams.get('sslaccept') !== 'strict') throw new Error('POL115_WORKBENCH_OWNED_ENDPOINT');
  uri.searchParams.set('connection_limit','2');

  const web = stageBrowser(context.workDir);
  const files = path.join(context.workDir,'workbench-files');
  fs.mkdirSync(files,{mode:0o700});
  const cache = path.join(context.workDir,'cache');
  fs.mkdirSync(cache,{mode:0o700});
  const resultPath = path.join(context.workDir,'workbench-jest-report.json');
  const browserReport = path.join(context.workDir,'workbench-playwright-report.json');
  const suite = 'src/settlement/settlement-template-workbench.owned290.http.pg.spec.ts';
  const environment = {
    PATH:'/usr/local/bin:/usr/bin:/bin', NODE_ENV:'test', HOME:context.workDir, TMPDIR:context.workDir,
    DATABASE_URL:uri.toString(), COREPACK_HOME:'/opt/corepack', XDG_CACHE_HOME:cache,
    PLAYWRIGHT_BROWSERS_PATH:'/opt/jg-playwright', PLAYWRIGHT_JSON_OUTPUT_FILE:browserReport,
    FILE_STORAGE_DRIVER:'local', FILE_STORAGE_ROOT:files, APPROVAL_SMS_ENABLED:'false', SMS_ENABLED:'false',
    OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID(), RUN_TEMPLATE_WORKBENCH_PG16:'1',
    ...(current320?{TASK_POL115_WORKBENCH_EXACT_320:'1'}:{}),
    ...(textDirect?{TASK_POL115_WORKBENCH_TEXT_DIRECT_330:'1'}:{}),
    ...(paymentRemainder?{TASK_POL115_WORKBENCH_PAYMENT_REMAINDER_331:'1'}:{}),
    ...(upwardArchive?{TASK_POL115_WORKBENCH_UPWARD_ARCHIVE_332:'1'}:{}),
    ...(historicalSettlement?{TASK_POL115_WORKBENCH_HISTORICAL_SETTLEMENT_334:'1'}:{}),
    ...(expenseWitness?{TASK_POL115_WORKBENCH_EXPENSE_WITNESS_346:'1'}:{}),
    ...(precision?{TASK_POL115_WORKBENCH_EXPENSE_WITNESS_349:'1'}:{}),
    TASK_POL115_WORKBENCH_290_RUN_ID:context.runId.replaceAll('-',''), TASK_POL115_WORKBENCH_290_WEB_ROOT:web,
  };

  try {
    await execute(process.execPath,[path.join(apiRoot,'node_modules/jest/bin/jest.js'),'--runInBand',
      '--runTestsByPath',suite,'--json','--outputFile',resultPath],
      {cwd:apiRoot,env:environment,maxBuffer:16*1024*1024,timeout:15*60*1000});
  } catch (error) {
    const available = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath,'utf8')) : null;
    receipt.workbench = {
      jestExit:Number.isInteger(error.code) ? error.code : null,
      failedCases:available?.testResults?.flatMap(item=>item.assertionResults)
        .filter(test=>test.status==='failed').map(test=>test.title),
      prismaCodes:[...new Set(String(error.stderr ?? '').match(/\bP[0-9]{4}\b/gu) ?? [])],
    };
    throw new Error('POL115_WORKBENCH_ORIGINAL_JEST');
  }
  const result = JSON.parse(fs.readFileSync(resultPath,'utf8'));
  if (result.numTotalTestSuites!==1 || result.numPassedTestSuites!==1 || result.numTotalTests!==9 ||
      result.numPassedTests!==9 || result.numPendingTests!==0) throw new Error('POL115_WORKBENCH_ORIGINAL_COVERAGE');
  const browser = JSON.parse(fs.readFileSync(browserReport,'utf8'));
  const projectTests = suite => [
    ...(suite.specs ?? []).flatMap(spec=>spec.tests),
    ...(suite.suites ?? []).flatMap(projectTests),
  ];
  const observed = browser.suites.flatMap(projectTests).map(test=>({
    name:test.projectName, expected:test.status==='expected',
    passages:test.results.filter(run=>run.status==='passed').length,
  })).sort((left,right)=>left.name.localeCompare(right.name));
  if (observed.length!==2 || observed[0].name!=='desktop' || observed[1].name!=='mobile' ||
      !observed.every(test=>test.expected && test.passages===1) || browser.stats.unexpected!==0 ||
      browser.stats.skipped!==0 || browser.stats.flaky!==0) throw new Error('POL115_WORKBENCH_BROWSER_COVERAGE');
  receipt.workbench = { suite, tests:9, skipped:0, browserProjects:observed.map(test=>test.name) };
}

module.exports = {runWorkbench,stageBrowser};
