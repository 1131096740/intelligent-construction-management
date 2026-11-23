'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const root='/qualification';
const pins={
  'workspace/apps/web-admin/playwright.template-workbench-real.config.ts':'6b389c710266bfdc15f299b7e8a87de5a530eb79d91fabd88ca87f15e3f300c8',
  'workspace/apps/web-admin/e2e/template-workbench-real.e2e.ts':'17dcd6f2c44525f3e2805f0bc8d6ecf8c2055aefb270a4a2e95f027af5a12f7f',
  'workspace/services/api/src/settlement/settlement-template-workbench.owned290.http.pg.spec.ts':'82bc3635ffd165afb407c18df21717403d21fe3231b777af8b4eeaf85462c065',
  'task12-pol109-stage-browser.cjs':'8adbaf1cd69af3d8154f163c490922bf5a5150ae8b21d3f705389282babbe71f',
  'task12-pol115-workbench-ci.cjs':'b139105b23bc36c32fee893286ddf7f894660fd0a76b9c8777ab1db1d7696141',
  'browser-preflight.cjs':'2f8483b2a066cd5b0024492a3ec8b6f41f8c2dd06714b226cd4b2e6038720ce3',
};
function verifyInputs(){
  for(const [name,digest] of Object.entries(pins))
    assert.equal(createHash('sha256').update(readFileSync(join(root,name))).digest('hex'),digest,name);
}
module.exports={verifyInputs,pins};
