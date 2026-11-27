'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const root='/qualification';
const pins={
  'workspace/apps/web-admin/playwright.template-workbench-real.config.ts':'6b389c710266bfdc15f299b7e8a87de5a530eb79d91fabd88ca87f15e3f300c8',
  'workspace/apps/web-admin/e2e/template-workbench-real.e2e.ts':'17dcd6f2c44525f3e2805f0bc8d6ecf8c2055aefb270a4a2e95f027af5a12f7f',
  'workspace/services/api/src/settlement/settlement-template-workbench.owned290.http.pg.spec.ts':'e267ce9537cc33663a711c64eb3b105bf09d01332bdce172fb035aefc5f272e8',
  'task12-pol109-stage-browser.cjs':'8adbaf1cd69af3d8154f163c490922bf5a5150ae8b21d3f705389282babbe71f',
  'task12-pol115-workbench-ci.cjs':'e580eaf12ffb842d350542093a94be59385e901d85002ba541d7cf22d76095cd',
  'issue430-approval-sms-ci.cjs':'f0b5d34a9f9a6e20eb6b383739b13da7a4f6c9bcbeb06951d2c4034ab872b3b3',
  'browser-preflight.cjs':'2f8483b2a066cd5b0024492a3ec8b6f41f8c2dd06714b226cd4b2e6038720ce3',
};
function verifyInputs(readInput = name => readFileSync(join(root,name))){
  for(const [name,digest] of Object.entries(pins))
    assert.equal(createHash('sha256').update(readInput(name)).digest('hex'),digest,name);
}
module.exports={verifyInputs,pins};
