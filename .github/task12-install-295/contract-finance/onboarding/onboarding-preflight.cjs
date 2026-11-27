'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {verify}=require('./verify-application-source.cjs');
const {withInstalled295Onboarding}=require('./installer.cjs');
const count=require('./contract-finance-source.json').migrationCount;
assert.equal(typeof withInstalled295Onboarding,'function');
if(count===350||count===352) {
  const {install,assertInstallation}=require('./payment-execution-'+count+'.cjs');
  assert.equal(typeof install,'function');
  assert.equal(typeof assertInstallation,'function');
}
assert.equal(typeof require('./task12-onboarding-role-fixture.cjs').renderOriginalSetup,'function');
assert.equal(typeof require('./task12-onboarding-metadata-alias.cjs').renderTemporaryMetadataAlias,'function');
const lane=verify();
const workspace='/qualification/workspace';
const webRequire=createRequire(workspace+'/apps/web-admin/package.json');
const {chromium,webkit}=webRequire('@playwright/test');
for(const browser of [chromium,webkit]) fs.accessSync(browser.executablePath(),fs.constants.X_OK);
assert.ok(['dist/main.js','dist/src/main.js'].some(p=>fs.existsSync(workspace+'/services/api/'+p)));
assert.equal(spawnSync('soffice',['--version']).status,0);
assert.equal(spawnSync('fc-match',['--format=%{family}','Noto Sans CJK SC'],{encoding:'utf8'}).stdout,'Noto Sans CJK SC');
console.log(JSON.stringify({status:'ONBOARDING_'+count+'_CONTEXT_NO_DATABASE_VERIFIED',application:lane}));
