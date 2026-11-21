'use strict';

const assert=require('node:assert/strict');
const path=require('node:path');
const {createRequire}=require('node:module');
const {spawnSync}=require('node:child_process');
const expected=[
  ['src/database/general-procurement-http-postgres.spec.ts',15],
  ['src/database/project-business-scope-http-postgres.spec.ts',11],
  ['src/database/approval-v6-migration-postgres.spec.ts',1],
];
const root='/qualification/procurement289-nodb';

let phase='admission';

async function main() {
  assert.equal(process.getuid() > 0,true);
  const source=process.argv[2];
  assert.equal(process.argv.length,3);
  assert.match(source,/^[a-f0-9]{40}$/u);
  for (const variable of ['DATABASE_URL','DIRECT_URL','RUN_GENERAL_PROCUREMENT_PG16','RUN_PROJECT_BUSINESS_SCOPE_PG16']) {
    assert(!process.env[variable]);
  }
  const fs=require('node:fs');
  assert.equal(fs.readFileSync('/qualification/procurement-source-head','utf8'),source+'\n');
  const {createHash}=require('node:crypto');
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,'services/api/assets/fonts/NotoSansSC-Regular.otf'))).digest('hex'),'faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9');
  assert.equal(process.platform,'linux');
  assert.equal(process.arch,'x64');
  assert.equal(process.env.PLAYWRIGHT_BROWSERS_PATH,'/opt/jg-playwright');
  phase='discovery';
  const api=path.join(root,'services/api');
  const PDFDocument=createRequire(path.join(api,'package.json'))('pdfkit');
  const pdf=new PDFDocument();
  const chunks=[];
  pdf.on('data',chunk=>chunks.push(chunk));
  await new Promise((resolve,reject)=>{
    pdf.once('end',resolve);
    pdf.once('error',reject);
    pdf.font(path.join(root,'services/api/assets/fonts/NotoSansSC-Regular.otf')).text('采购');
    pdf.end();
  });
  assert.equal(Buffer.concat(chunks).subarray(0,5).toString(),'%PDF-');
  const result=spawnSync(process.execPath,[path.join(api,'node_modules/jest/bin/jest.js'),'--runInBand',
    '--runTestsByPath',...expected.map(([file])=>file),'--json'],{
    cwd:api,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
    env:{PATH:process.env.PATH,HOME:'/tmp',TMPDIR:'/tmp',NODE_ENV:'test',CI:'true'},
  });
  assert.equal(result.status,0);
  const report=JSON.parse(result.stdout);
  assert.equal(report.numTotalTestSuites,3);
  assert.equal(report.numTotalTests,27);
  assert.equal(report.numPendingTests,27);
  assert(expected.every(([file,count])=>report.testResults.some(suite=>suite.name===path.join(api,file)&&
    suite.assertionResults.length===count&&suite.assertionResults.every(test=>test.status==='pending'))));
  phase='installer-syntax';
  assert.equal(spawnSync(process.execPath,['--check','/qualification/installer.cjs']).status,0);
  for (const lane of ['general16','project11']) {
    phase=lane+'-predev';
    const workDir=fs.mkdtempSync('/tmp/jg394-');
    try {
      const {stageProcurementWorkspace}=require('/qualification/'+lane+'-web-stage.cjs');
      const workspace=stageProcurementWorkspace(workDir);
      assert.equal(workspace,path.join(workDir,'apps/web-admin'));
      const boot=spawnSync('pnpm',['run','predev'],{cwd:workspace,encoding:'utf8',timeout:30000});
      assert.equal(boot.status,0);
    } finally {
      fs.rmSync(workDir,{recursive:true,force:true});
    }
  }
  phase='browser-package';
  const webRequire=createRequire(path.join(root,'apps/web-admin/package.json'));
  assert.equal(webRequire('@playwright/test/package.json').version,'1.64.0');
  const {chromium,webkit}=webRequire('@playwright/test');
  for (const engine of [chromium,webkit]) {
    phase=engine.name();
    const browser=await engine.launch();
    try {
      const page=await browser.newPage();
      await page.setContent('<main>PROCUREMENT289_NO_DB</main>');
      assert.equal(await page.locator('main').textContent(),'PROCUREMENT289_NO_DB');
    } finally {
      await browser.close();
    }
  }
  console.log(JSON.stringify({status:'PROCUREMENT_289_LINUX_NO_DB_PASSED',
    source,fontSha256:'faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9',webBootstrap:['general16','project11'],discovered:27,liveSkipped:27,engines:['chromium','webkit'],postgresStarted:false}));
}

main().catch(()=>{console.error(JSON.stringify({status:'PROCUREMENT_289_NO_DB_FAILED',phase}));process.exitCode=1;});
