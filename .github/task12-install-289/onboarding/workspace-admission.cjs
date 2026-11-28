'use strict';

const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const exact=require('./application-source.json');
const baseline='a1be083076018686dd8afba68c44ff9c75502014';
const known=[
  'services/api/src/organization/organization.service.spec.ts',
  'services/api/src/organization/organization.service.ts',
];
const [, ,mode,root]=process.argv;
assert.equal(process.argv.length,4);
assert.equal(mode,'--preflight','ONBOARDING_289_HOSTED_NOT_ADMITTED');
assert.deepEqual(Object.keys(exact.files).sort(),known);
const git=(args)=>execFileSync('git',['-C',root,...args]);
assert.deepEqual(git(['diff','--name-only',baseline,exact.tree]).toString().trim().split('\n'),known);
for(const [file,expected] of Object.entries(exact.files)){
  const product=readFileSync(path.join(__dirname,'product',file));
  assert.equal(createHash('sha256').update(product).digest('hex'),expected);
  assert.equal(Buffer.compare(git(['show',exact.tree+':'+file]),product),0);
}
assert.equal(git(['diff','--name-only',baseline,exact.tree,'--','services/api/prisma','apps/web-admin','packages/shared-domain','pnpm-lock.yaml']).toString(),'');
console.log(JSON.stringify({status:'ONBOARDING_289_HOSTED_NOT_ADMITTED',reason:'PORTABLE_LANE_IMAGE_IDENTITY_UNVERIFIED',exactApplicationTree:exact.tree,installerProductTree:baseline,unchangedOtherProductFiles:true}));
