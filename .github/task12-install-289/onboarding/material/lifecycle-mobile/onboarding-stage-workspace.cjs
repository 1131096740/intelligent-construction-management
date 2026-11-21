'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { stageWebWorkspace } = require('./stage-browser.cjs');

const original = '/qualification/workspace';

function stageOnboardingWorkspace(workDir) {
  const stagedWeb = stageWebWorkspace(workDir);
  const web = path.join(workDir, 'apps/web-admin');
  const shared = path.join(workDir, 'packages/shared-domain');
  const copy = (relative) => fs.copyFileSync(
    path.join(original, relative), path.join(workDir, relative), fs.constants.COPYFILE_EXCL
  );

  fs.mkdirSync(path.dirname(web));
  fs.renameSync(stagedWeb, web);
  fs.mkdirSync(path.join(workDir, 'scripts'));
  fs.mkdirSync(shared, { recursive: true });
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'scripts/pnpm-workspace.mjs',
    'packages/shared-domain/package.json', 'packages/shared-domain/tsconfig.json']) {
    copy(file);
  }
  fs.cpSync(path.join(original, 'packages/shared-domain/src'), path.join(shared, 'src'), {
    recursive: true, force: false, errorOnExist: true,
  });
  fs.symlinkSync(path.join(original, 'packages/shared-domain/node_modules'), path.join(shared, 'node_modules'));

  fs.symlinkSync(path.join(original, 'apps/web-admin/node_modules/.bin'), path.join(web, 'node_modules/.bin'));
  const webScope = path.join(web, 'node_modules/@jiangkong');
  fs.unlinkSync(webScope);
  fs.mkdirSync(webScope);
  fs.symlinkSync(shared, path.join(webScope, 'shared-domain'));
  fs.mkdirSync(path.join(web, 'e2e'));
  fs.mkdirSync(path.join(web,'e2e/helpers'));
  for (const file of ['playwright.employee-onboarding.config.ts', 'playwright.employee-onboarding-real.config.ts',
    'playwright.project-roster-real.config.ts', 'playwright.personnel-lifecycle-real.config.ts',
    'e2e/employee-onboarding-real.e2e.ts', 'e2e/project-roster-real.e2e.ts',
    'e2e/personnel-lifecycle-real.e2e.ts', 'e2e/helpers/responsive-assertions.ts']) {
    copy('apps/web-admin/'+file);
  }
  return web;
}
module.exports = { stageOnboardingWorkspace };
