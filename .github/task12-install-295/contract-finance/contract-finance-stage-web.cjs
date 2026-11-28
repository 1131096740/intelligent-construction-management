'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {stageWebWorkspace}=require('./task12-pol109-stage-browser.cjs');
const source='/qualification/workspace';

function stageCompanyTransferWeb(workDir){
  const staged=stageWebWorkspace(workDir);
  const web=path.join(workDir,'apps/web-admin');
  const domain=path.join(workDir,'packages/shared-domain');
  const copy=file=>fs.copyFileSync(path.join(source,file),path.join(workDir,file),fs.constants.COPYFILE_EXCL);
  fs.mkdirSync(path.dirname(web));
  fs.renameSync(staged,web);
  fs.mkdirSync(path.join(workDir,'scripts'));
  fs.mkdirSync(domain,{recursive:true});
  fs.mkdirSync(path.join(web,'e2e'));
  for(const file of ['package.json','pnpm-workspace.yaml','scripts/pnpm-workspace.mjs',
    'packages/shared-domain/package.json','packages/shared-domain/tsconfig.json',
    'apps/web-admin/playwright.company-transfer-real.config.ts','apps/web-admin/company-transfer-finite-reporter.cjs','apps/web-admin/e2e/company-transfer-real.e2e.ts']) copy(file);
  fs.cpSync(path.join(source,'packages/shared-domain/src'),path.join(domain,'src'),
    {recursive:true,force:false,errorOnExist:true});
  fs.symlinkSync(path.join(source,'packages/shared-domain/node_modules'),path.join(domain,'node_modules'));
  fs.symlinkSync(path.join(source,'apps/web-admin/node_modules/.bin'),path.join(web,'node_modules/.bin'));
  const scope=path.join(web,'node_modules/@jiangkong');
  fs.unlinkSync(scope);
  fs.mkdirSync(scope);
  fs.symlinkSync(domain,path.join(scope,'shared-domain'));
  return web;
}
module.exports={stageCompanyTransferWeb};
