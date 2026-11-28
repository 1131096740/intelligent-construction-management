'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {mkdtempSync} = require('node:fs');
const {createRequire} = require('node:module');
const {stageBrowser} = require('./task12-pol115-workbench-ci.cjs');

async function main() {
  assert.ok(process.platform==='linux' && process.getuid()!==0 && process.env.NODE_ENV==='test');
  for(const key of ['DATABASE_URL','TASK398_OWNER_URL','PGHOST']) assert.equal(process.env[key],undefined,key);
  require('./workbench-inputs.cjs').verifyInputs();
  const work=mkdtempSync('/tmp/jg394-');
  const web=stageBrowser(work);
  const load=createRequire(web+'/package.json');
  assert.equal(load('@playwright/test/package.json').version,'1.64.0');
  const {chromium,webkit}=load('@playwright/test');
  const browsers=[];
  for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
    const running=await engine.launch({headless:true});
    try{
      const page=await running.newPage();
      await page.setContent('<h1>合成模板工作台</h1>');
      assert.equal(await page.locator('h1').textContent(),'合成模板工作台');
      browsers.push({name,version:running.version()});
    }finally{await running.close();}
  }
  const listed=execFileSync('pnpm',['exec','playwright','test','--list','--config','playwright.template-workbench-real.config.ts'],{
    cwd:web,encoding:'utf8',env:{PATH:process.env.PATH,HOME:work,TMPDIR:work,COREPACK_HOME:'/opt/corepack',
      COREPACK_ENABLE_NETWORK:'0',COREPACK_DEFAULT_TO_LATEST:'0',PLAYWRIGHT_BROWSERS_PATH:'/opt/jg-playwright',
      TEMPLATE_WORKBENCH_API_URL:'http://127.0.0.1:1',TEMPLATE_WORKBENCH_SESSION:'{}'}
  });
  assert.match(listed,/\[desktop\]/u);
  assert.match(listed,/\[mobile\]/u);
  assert.match(listed,/Total: 2 tests in 1 file/u);
  const reqApi=createRequire('/qualification/workspace/services/api/package.json');
  const workbook=new (reqApi('exceljs').Workbook)();
  workbook.addWorksheet('合成').addRow(['合成模板预览']);
  const {convertXlsxToPdf}=reqApi('./dist/contract-document/libreoffice-converter.js');
  const pdf=await convertXlsxToPdf(Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  console.log(JSON.stringify({status:'POL115_290_REUSED_BROWSER_PRECHECK_PASSED',browsers,pdfBytes:pdf.length}));
}
main().catch(error=>{
  console.error(error.code??error.message);
  process.exitCode=1;
});
