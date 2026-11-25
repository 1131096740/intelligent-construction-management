'use strict';

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync, writeFileSync} = require('node:fs');
const path = require('node:path');

const [work,plan] = process.argv.slice(2);
assert.equal(process.argv.length,4);
const sourceFile = path.join(work,'source/source.json');
const source = require(sourceFile);
const upwardArchive = source.mode==='upward-archive-332';
const paymentRemainder = source.mode==='payment-remainder-331'||upwardArchive;
const count=upwardArchive?332:paymentRemainder?331:330;
const method=upwardArchive?'withCombined332UpwardArchive':paymentRemainder?'withCombined331PaymentRemainder':'withCombined330TextAgreement';
assert.equal(typeof require(path.join(plan,'common/installer.cjs'))[method],'function');
const bankFiles = path.join(work,'bank/bank/execution-files.json');
const bank = require(bankFiles);
const {fixtures} = require(path.join(plan,'core-payment-330-fixtures.json'));
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const wrapperInputs = [
  'run.sh','run-bank-restore.sh','run-core-payment.sh','stage-overlays.py','stage-core-payment.sh',
  'text-direct-330-profile.cjs','text-direct-330-host-receipt.cjs','common/installer.cjs',
  'bank/named-bank-ci.cjs','bank/original-titles.json','bank/staging-330.json',
  'core-payment-entry.cjs','core-payment-runner.cjs','contract-finance-owned.test-support.ts',
  'core-payment-330-fixtures.json','contract-finance-stage-web.cjs','task12-pol109-stage-browser.cjs',
  'task12-owned-280.test-support.ts','company-transfer-finite-reporter.cjs',
  ...(paymentRemainder?['payment-remainder-331-profile.cjs','bank/staging-331.json','core-payment-331-fixtures.json']:[]),
  ...(upwardArchive?['upward-archive-332-profile.cjs','bank/staging-332.json','core-payment-332-fixtures.json']:[])
];
const receipt = {
  status:'CONTRACT_FINANCE_'+count+'_HOST_INPUTS_VERIFIED',
  sourceSha:source.sourceSha,sourceTree:source.sourceTree,
  migrationCount:source.migrationCount,ledgerSha256:source.ledgerSha256,
  ...(upwardArchive?{predecessor331:source.predecessor331}:{}),
  sourceManifestSha256:hash(sourceFile),
  bank:{executionFiles:bank.length,manifestSha256:hash(bankFiles)},
  corePayment:{fixtures:Object.keys(fixtures).length},
  wrapperInputs:Object.fromEntries(wrapperInputs.map(relative=>[relative,hash(path.join(plan,relative))])),
  restore:'UNAVAILABLE',
  database:'NOT_STARTED'
};
const file=path.join(work,'host-receipt.json');
writeFileSync(file,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({receipt:file,sha256:hash(file),...receipt}));
