'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {stageWebWorkspace}=require('./task12-pol109-stage-browser.cjs');
const workspace='/qualification/workspace';
function stageBrowser(workDir, mode) {
  if (mode!=='pol113' && mode!=='pol114') throw Error('NAMED_BROWSER_STAGE_MODE');
  const side = stageWebWorkspace(workDir);
  const web = path.join(workDir,'apps/web-admin');
  const shared = path.join(workDir,'packages/shared-domain');
  const copy = file => fs.copyFileSync(path.join(workspace,file),path.join(workDir,file),fs.constants.COPYFILE_EXCL);
  fs.mkdirSync(path.dirname(web));
  fs.renameSync(side,web);
  fs.mkdirSync(path.join(web,'e2e'));
  fs.mkdirSync(path.join(workDir,'scripts'));
  fs.mkdirSync(shared,{recursive:true});
  const files = ['package.json','pnpm-workspace.yaml','scripts/pnpm-workspace.mjs',
    'packages/shared-domain/package.json','packages/shared-domain/tsconfig.json'];
  const browserInputs = mode==='pol113' ? [
    'playwright.pol113-project-real.config.ts',
    'e2e/pol113-business-party-real.e2e.ts','e2e/pol113-company-entity-real.e2e.ts',
    'e2e/pol113-project-profile-real.e2e.ts','e2e/pol113-settings-real.e2e.ts'
  ] : [
    'playwright.layout-preview-real.config.ts','playwright.settlement-entry-history-real.config.ts',
    'e2e/layout-preview-real.e2e.ts','e2e/settlement-entry-history-real.e2e.ts'
  ];
  for (const file of files) copy(file);
  for (const file of browserInputs) copy('apps/web-admin/'+file);
  fs.cpSync(path.join(workspace,'packages/shared-domain/src'),path.join(shared,'src'),
    {recursive:true,force:false,errorOnExist:true});
  fs.symlinkSync(path.join(workspace,'packages/shared-domain/node_modules'),path.join(shared,'node_modules'));
  fs.symlinkSync(path.join(workspace,'apps/web-admin/node_modules/.bin'),path.join(web,'node_modules/.bin'));
  const scope = path.join(web,'node_modules/@jiangkong');
  fs.unlinkSync(scope);
  fs.mkdirSync(scope);
  fs.symlinkSync(shared,path.join(scope,'shared-domain'));
  return web;
}
module.exports={stageBrowser};
