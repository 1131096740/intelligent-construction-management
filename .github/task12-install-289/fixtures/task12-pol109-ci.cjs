'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomBytes,randomUUID}=require('node:crypto');
const {spawn}=require('node:child_process');
const {createServer}=require('node:net');
const {once}=require('node:events');
const {setTimeout:delay}=require('node:timers/promises');
const {stagePol109Workspace}=require('./task12-pol109-stage-workspace.cjs');
const workspace='/qualification/workspace';
const api=path.join(workspace,'services/api');
const need=(ok,stage)=>{if(!ok)throw new Error('POL109_'+stage);};
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function verifyInputs() {
  for(const [file,sha] of [
    ['services/api/src/project-close-profit/project-close-profit.owned282.http.pg.spec.ts','3894bbde1ebb0b7bcae424171a9fdffe4e5ae23d3f76b5cf103a8406a9013ae3'],
    ['apps/web-admin/playwright.config.ts','006df77011a7025b79776c34cb4c536e3c0fdc81944084dcb2c2c386b7c94c93'],
    ['apps/web-admin/e2e/project-close-profit.e2e.ts','23b6784cf8f944d22d9f779240871befc1b7d4bef96fc405f32d31a79894ed56'],
  ]) need(hash(path.join(workspace,file))===sha,'SOURCE');
  need(fs.statSync('/opt/jg-playwright/chromium_headless_shell-1248').isDirectory()&&fs.statSync(path.join(api,'dist/main.js')).isFile(),'PACKAGE');
}

function parseJson(contents,stage) {
  try { return JSON.parse(contents); } catch { throw new Error('POL109_'+stage); }
}

async function runTool(receipt,stage,script,args,{cwd,env,ms}) {
  receipt.stages.push(stage);
  const runner=spawn(process.execPath,[script,...args],{cwd,env,stdio:['ignore','pipe','pipe']});
  const out=[],error=[];
  let length=0,overflow=false;
  const capture=(destination,bytes)=>{
    length+=bytes.length;
    if(length>16*1024*1024){overflow=true;runner.kill('SIGKILL');return;}
    destination.push(bytes);
  };
  runner.stdout.on('data',bytes=>capture(out,bytes));runner.stderr.on('data',bytes=>capture(error,bytes));
  const timer=setTimeout(()=>runner.kill('SIGKILL'),ms);
  try {
    const [code,signal]=await once(runner,'close');
    const stdout=Buffer.concat(out).toString('utf8'),stderr=Buffer.concat(error).toString('utf8');
    if(code!==0||overflow){
      const messages=stdout+'\n'+stderr;
      if(stage==='BROWSER'){
        let report;
        try { report=JSON.parse(stdout); } catch {}
        const outcomes=report?.suites?.flatMap(suite=>suite.specs??[])
          .flatMap(spec=>spec.tests??[]).flatMap(test=>test.results??[])??[];
        const error=report?.errors?.[0]?.message??outcomes.find(test=>test.status==='failed'||test.status==='timedOut')?.error?.message??'';
        receipt.browser={passed:report?.stats?.expected,failed:report?.stats?.unexpected,skipped:report?.stats?.skipped,
          results:outcomes.length,stage:/config\.webServer/u.test(error)?'WEB_START':
            /ERR_ABORTED/u.test(error)?'NAVIGATION_ABORT':
            /browserType\.launch/u.test(error)?'CHROMIUM_START':
            /toHaveURL/u.test(error)?'URL_ASSERTION':
            /toBeVisible/u.test(error)?'VISIBILITY_ASSERTION':
            /Timeout/u.test(error)?'TIMEOUT':'OTHER'};
      }
      receipt.toolFailure={stage,code,signal,overflow,
        prismaCode:/\bP(?:1001|1010|1011|2010|2024|2028|2034|3018)\b/u.exec(messages)?.[0],
        sqlstate:/\b(?:23505|23514|42501|42P01|55000|55P03|57014)\b/u.exec(messages)?.[0],
        readiness:/POL109_OWNED_282_IDENTITY/u.test(messages)?'OWNED_IDENTITY':
          /ERR_ABORTED/u.test(messages)?'BROWSER_ABORT':
          /Target page, context or browser has been closed/u.test(messages)?'BROWSER_CLOSED':undefined};
      throw new Error('POL109_'+stage);
    }
    return stdout;
  } finally { clearTimeout(timer); }
}

async function freePort(){
  const listener=createServer();
  await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const {port}=listener.address();
  await new Promise((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));
  return port;
}

async function runPol109(context,receipt,workspaceProof){
  verifyInputs();
  need(require('/qualification/workspace-proof.cjs').isVerifiedWorkspaceProof(workspaceProof),'WORKSPACE');
  const endpoint=new URL(context.ownerUrl);
  need(context.candidateTree==='a1be083076018686dd8afba68c44ff9c75502014'&&endpoint.username==='jg_task01_owner'&&
    endpoint.hostname==='127.0.0.1'&&endpoint.pathname==='/'+context.database&&
    context.database==='jg_task01_'+context.runId.replaceAll('-','')&&endpoint.searchParams.get('sslaccept')==='strict','CONTEXT');
  const proof=await context.sql(`SELECT CASE WHEN current_user=session_user AND current_user::regrole::oid=10 AND
    EXISTS(SELECT FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=10) AND
    EXISTS(SELECT FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AND
    (SELECT count(*)=289 FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
    THEN 'accepted' ELSE 'denied' END;`);
  need(proof.stdout.trim()==='accepted','OWNER_READBACK');
  const storage=path.join(context.workDir,'pol109-private');
  fs.mkdirSync(storage,{mode:0o700});
  const apiPort=await freePort();
  const apiBaseUrl='http://127.0.0.1:'+apiPort;
  const env={PATH:process.env.PATH,HOME:context.workDir,TMPDIR:context.workDir,NODE_ENV:'test',CI:'true',
    COREPACK_HOME:'/opt/corepack',COREPACK_DEFAULT_TO_LATEST:'0',COREPACK_ENABLE_NETWORK:'0',
    FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:storage,PORT:String(apiPort),HOST:'127.0.0.1',API_BASE_URL:apiBaseUrl,
    SMS_ENABLED:'false',APPROVAL_SMS_ENABLED:'false',JWT_ACCESS_SECRET:randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET:randomBytes(32).toString('hex'),FILE_DOWNLOAD_SECRET:randomBytes(32).toString('hex'),
    OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID(),SEED_PASSWORD:'Local@1-'+randomUUID(),
    RUN_POL109_PROJECT_CLOSE_PG16:'1',TASK_POL109_282_RUN_ID:context.runId.replaceAll('-','')};
  const prisma=path.join(api,'node_modules/prisma/build/index.js');
  const migrations=path.join(context.workDir,'prefixes/combined289/schema.prisma');
  const noop=await runTool(receipt,'NOOP',prisma,['migrate','deploy','--schema',migrations],
    {cwd:api,env:{...env,DATABASE_URL:context.ownerUrl},ms:15*60_000});
  need(/No pending migrations to apply\.?/u.test(noop),'NOOP_RESULT');
  receipt.noOpDeploy=true;
  await runTool(receipt,'SEED',path.join(api,'prisma/seed.cjs'),[],{cwd:context.workDir,env:{...env,DATABASE_URL:context.ownerUrl},ms:15*60_000});
  receipt.seed=true;
  endpoint.searchParams.set('connection_limit','2');
  const appEnv={...env,DATABASE_URL:endpoint.toString()};
  const jest=await runTool(receipt,'JEST',path.join(api,'node_modules/jest/bin/jest.js'),['--runInBand','--json','--runTestsByPath',
    'src/database/project-close-profit-postgresql.spec.ts','src/project-close-profit/project-close-profit.owned282.http.pg.spec.ts'],
    {cwd:api,env:appEnv,ms:30*60_000});
  const result=parseJson(jest,'JEST_JSON');
  const raw=path.join(api,'src/database/project-close-profit-postgresql.spec.ts');
  const http=path.join(api,'src/project-close-profit/project-close-profit.owned282.http.pg.spec.ts');
  const passed=(file)=>result.testResults.find(suite=>suite.name===file)?.assertionResults.filter(test=>test.status==='passed').length;
  receipt.jest={passed:result.numPassedTests,suites:result.numPassedTestSuites,failed:result.numFailedTests,
    skipped:result.numPendingTests,postgresql:passed(raw),http:passed(http)};
  need(result.numTotalTests===8&&result.numPassedTests===8&&result.numPassedTestSuites===2&&
    result.numFailedTests===0&&result.numPendingTests===0&&receipt.jest.postgresql===7&&receipt.jest.http===1,'JEST_COUNTS');
  const stagedWeb=stagePol109Workspace(context.workDir);
  const originalWeb=path.join(workspace,'apps/web-admin');
  const playwright=require.resolve('@playwright/test/cli',{paths:[originalWeb]});
  receipt.stages.push('NEST_BOOT');
  const server=spawn(process.execPath,[path.join(api,'dist/main.js')],{cwd:workspace,env:appEnv,stdio:['ignore','ignore','pipe']});
  server.stderr.resume();
  const stopped=once(server,'close');
  try {
    let ready=false;
    for(let count=0; count<120&&server.exitCode===null&&!ready; count++){
      try{ready=(await fetch(apiBaseUrl+'/health',{signal:AbortSignal.timeout(5000)})).ok;}catch{}
      if(!ready)await delay(500);
    }
    need(ready,'NEST_HEALTH');
    receipt.nestHealth=true;
    const browser=await runTool(receipt,'BROWSER',playwright,['test','e2e/project-close-profit.e2e.ts','--project=chromium','--reporter=json'],
      {cwd:stagedWeb,env:{...env,CI:'false',WEB_BASE_URL:'http://127.0.0.1:5173',VITE_API_PROXY_TARGET:apiBaseUrl,
        POL109_REAL_BROWSER:'1',PLAYWRIGHT_BROWSERS_PATH:'/opt/jg-playwright'},ms:10*60_000});
    const output=parseJson(browser,'BROWSER_JSON');
    receipt.browser={passed:output.stats?.expected,failed:output.stats?.unexpected,flakes:output.stats?.flaky,skipped:output.stats?.skipped};
    need(output.stats?.expected===5&&output.stats?.unexpected===0&&output.stats?.flaky===0&&output.stats?.skipped===0,'BROWSER_COUNTS');
  } finally {
    if(server.exitCode===null&&server.signalCode===null)server.kill('SIGTERM');
    const timeout=setTimeout(()=>server.kill('SIGKILL'),5000);
    try{await stopped;receipt.nestCleanup=true;}finally{clearTimeout(timeout);}
  }
}

module.exports = { runPol109 };
