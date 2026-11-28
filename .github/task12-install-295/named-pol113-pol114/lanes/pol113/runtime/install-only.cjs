'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {withNamedPol113Pol114292}=require('./installer.cjs');
const {scope}=require('./named292/successor.cjs');
const {stageBrowser}=require('./stage-named-browser.cjs');
const {collectBrowserEvidence,bootSummary}=require('./browser-evidence.cjs');

const recipes=Object.freeze({
  pol113:{
    database:'pol113',file:'src/database/base-entry-http-postgres.spec.ts',count:30,timeout:300_000,
    flags:{RUN_POL113_HTTP_PG16:'1',RUN_POL113_PROJECT_BROWSER:'1'},
    args:['--config','jest.runtime.config.cjs'],
  },
  pol114:{
    database:'jiangkong_pol114',file:'src/database/contract-business-entry-http.spec.ts',count:8,timeout:600_000,
    flags:{RUN_POL114_HTTP_PG16:'1',RUN_POL114_BROWSER:'1',
      RUN_POL114_SETTLEMENT_FINANCE_HTTP_PG16:'1',RUN_POL114_PAYMENT_HTTP_PG16:'1'},
    args:[],
  },
});
const workspace='/qualification/workspace';
const api=path.join(workspace,'services/api');

async function consume(context,receipt,mode){
  const {database,workDir,ownerUrl}=context;
  const recipe=recipes[mode];
  const url=new URL(ownerUrl);
  assert.equal(database,recipe.database);
  assert.equal(url.username,'jiangkong');
  assert.equal(url.pathname,'/'+recipe.database);
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(url.searchParams.get('sslmode'),'require');
  assert.equal(url.searchParams.get('sslaccept'),'strict');
  assert.equal(url.searchParams.get('sslcert'),path.join(workDir,'ca.crt'));
  const owner=JSON.parse((await context.sql(`
SELECT jsonb_build_object('database',current_database(),'actor',current_user,'session',session_user,
  'ownerOid',d.datdba::text,'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
  'protectedArchive',public.jg_require_contract_direct_upward_source_v2() IS NOT NULL)
FROM pg_database d WHERE d.datname=current_database();
`)).stdout);
  assert.deepEqual(owner,{database,actor:'jiangkong',session:'jiangkong',ownerOid:'10',tls:true,protectedArchive:true});
  receipt.namedOwner=owner;
  url.searchParams.delete('connection_limit');

  const files=path.join(workDir,'named-fixture-files');
  fs.mkdirSync(files,{mode:0o700});
  const report=path.join(workDir,'named-jest-report.json');
  const web=stageBrowser(workDir,mode);
  if(mode==='pol114'){
    receipt.compiledLayout=require('./preflight-layout-dist.cjs').verify(workspace);
    receipt.stagedPdfWorker=require('./pol114-pdf-worker.cjs').allowExactPdfWorker(workDir,web);
  }
  const environment={
    PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',LC_ALL:'C.UTF-8',
    HOME:workDir,TMPDIR:workDir,XDG_CACHE_HOME:workDir,COREPACK_HOME:'/opt/corepack',
    COREPACK_DEFAULT_TO_LATEST:'0',COREPACK_ENABLE_NETWORK:'0',NODE_ENV:'test',CI:'true',
    DATABASE_URL:url.toString(),FILE_STORAGE_DRIVER:'local',FILE_STORAGE_ROOT:files,
    OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID(),PLAYWRIGHT_BROWSERS_PATH:'/opt/jg-playwright',
    JG_NAMED_BROWSER_WEB_ROOT:web,JG_NAMED_BROWSER_WORKSPACE_ROOT:workDir,
    ...recipe.flags,
  };
  const args=['--filter','@jiangkong/api','exec','jest','--runInBand',...recipe.args,
    '--runTestsByPath',recipe.file,'--json','--outputFile',report];
  receipt.stages.push('ORIGINAL_'+mode.toUpperCase()+'_HTTP_AND_BROWSER_JEST');
  const result=spawnSync('pnpm',args,{cwd:workspace,env:environment,encoding:'utf8',
    timeout:recipe.timeout,maxBuffer:32*1024*1024});
  let parsed;
  if(fs.existsSync(report)&&fs.lstatSync(report).isFile()&&fs.statSync(report).size<=32*1024*1024){
    parsed=JSON.parse(fs.readFileSync(report,'utf8'));
  }
  const rows=parsed?.testResults?.[0]?.assertionResults??[];
  receipt.originalSuite={
    exactSource:parsed?.testResults?.length===1&&parsed.testResults[0].name===path.join(api,recipe.file),
    total:parsed?.numTotalTests,passed:parsed?.numPassedTests,skipped:parsed?.numPendingTests,
    exit:result.status,signal:result.signal,
  };
  const browserCase="当前项目财务可预检并保存同一经营档案字段，其他项目及全局财务不可借用权限";
  receipt.jestDiagnostic={
    failed: rows.filter(row=>row.status==="failed").slice(0,6).map(row=>{
      const traces=Array.isArray(row.failureMessages)?row.failureMessages:[];
      return {
        titleSha256:typeof row.title==="string"?createHash("sha256").update(row.title).digest("hex"):undefined,
        originalPol113BrowserCase:mode==="pol113"&&row.title===browserCase,
        ...bootSummary(traces),
        httpAssertion:traces.some(value=>typeof value==="string"&&/Expected:\s*(?:[1-5][0-9]{2})[\s\S]{0,125}Received:\s*(?:[1-5][0-9]{2})/u.test(value))
      };
    }),
    runner:bootSummary([result.stdout,result.stderr])
  };
  receipt.prismaCodes=[...new Set(String(result.stderr??'').match(/\bP[0-9]{4}\b/gu)??[])];
  try{receipt.browser=collectBrowserEvidence(workDir,mode);}
  catch{receipt.browser={exact:false,reportFailure:'POL113_POL114_BROWSER_REPORT'};}
  const {exactSource,total,passed,skipped,exit}=receipt.originalSuite;
  if(!exactSource||total!==recipe.count||passed!==recipe.count||skipped!==0||exit!==0||
    parsed.success!==true||rows.length!==recipe.count||rows.some(row=>row.status!=='passed')){
    throw Error('POL113_POL114_NAMED_ORIGINAL_SUITE');
  }
  if(!receipt.browser.exact)throw Error('POL113_POL114_BROWSER_COVERAGE');
}

const mode=process.argv[2];
const admission=require('./candidate-admission.json');
const receipt={schemaVersion:1,purpose:'NAMED_POL113_POL114_EXACT_292',mode,business:'NOT_ENTERED',stages:[],candidateSha:admission.candidateSha};
Promise.resolve().then(async()=>{
  assert.ok(process.argv.length===3&&Object.hasOwn(recipes,mode));
  assert.equal(admission.tree,scope.tree);
  assert.equal(admission.ledger292,scope.expectedLedgerSha256);
  const workspaceProof=spawnSync('sha256sum',['-c','--quiet','/qualification/workspace.sha256'],{
    cwd:workspace,encoding:'utf8',timeout:60_000,maxBuffer:1024*1024,
  });
  assert.equal(workspaceProof.status,0,'POL113_POL114_EXACT_WORKSPACE');
  receipt.workspaceBytesVerified=true;
  await withNamedPol113Pol114292(receipt,mode,context=>consume(context,receipt,mode));
  assert.equal(receipt.releaseTree,scope.tree);
  assert.equal(receipt.business,'CALLBACK_COMPLETED');
  assert.deepEqual(receipt.orderedTails.slice(-3).map(({size})=>size),[290,291,292]);
  assert.equal(receipt.installOnly292?.ledgerSha256,scope.expectedLedgerSha256);
  assert.deepEqual(receipt.postBehavior292,{catalogPreserved:true,keyUnprovisioned:true});
  assert.equal(receipt.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
  receipt.status='POL113_POL114_NAMED_EXACT_292_PASSED';
}).catch(error=>{
  const code=error.code??error.message;
  receipt.status='STOPPED';
  receipt.failure={stage:receipt.stages.at(-1)??'INPUTS',
    code:typeof code==='string'&&/^[A-Z0-9_]+$/u.test(code)?code:'POL113_POL114_NAMED_FAILURE',
    sqlstate:error.sqlstate,prismaCode:error.prismaCode,exit:error.exit,
    ...(receipt.stages.at(-1)==='ARCHIVE_SEVEN_WRITE' ? {sevenWrite:error.namedSevenFailure} : {})};
  process.exitCode=1;
}).finally(()=>process.stdout.write(JSON.stringify(receipt)+'\n'));
