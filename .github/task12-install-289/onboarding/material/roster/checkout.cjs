'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

const prismaPath = 'services/api/prisma';
const asset = /^services\/api\/prisma\/(?:schema\.prisma|migrations\/(?:migration_lock\.toml|[0-9]{14}_[a-z0-9_]+\/migration\.sql))$/u;
const release = Object.freeze({
  mode: 'EXACT_282_CHECKOUT_INSTALLER_V1',
  tree: '8d3e50a0c525a68e717b74fbecbcceabc80840f7',
  previousTree: 'f43891a0af6cb6f2aeadb327bb0e7dc3eff40441',
  expenseReceiptSha256: 'ea54644eb83ce9523a7e9a85b57c73388838d88ec339cf865ce5d188ff682e58',
  indexRows: 4259,
  indexSha256: '5cfbf1b556af3afaca8643fc2a325cc12a6769338533e0069db5210a154bedb5',
  materializedFiles: 284,
  materializedSha256: '093c2dc00b3589038904f66da7036e65109eb8dbfcf5916bf5683c046e10c8a7',
});

const projectLegacyReviewRelease = Object.freeze({
  mode: 'EXACT_287_CHECKOUT_INSTALLER_V1',
  tree: '456cfea1321e0af223ac8e1c8d4fdf55bdc1a386',
  previousTree: '4aa24065cf62eec23d8a602328cfe08b5cd84d9b',
  indexRows: 4264,
  indexSha256: '40af2af6570d21c1cac6e4471f6ee08d1de05d2917ba0203cac7c8c6b46560ee',
  materializedFiles: 289,
  materializedSha256: '230b678e10112c79d0112a53b2be7922d6af7368ae3b32d5dcbe47e831d5abb5',
});

const contract289 = Object.freeze({
  mode: 'EXACT_289_CHECKOUT_INSTALLER_INPUT_V1',
  tree: 'a1be083076018686dd8afba68c44ff9c75502014',
  indexRows: 4285,
  indexSha256: '3c5823b2cbf95802ebf90716f8a6fed5ac203747cc619b8bf0a5af11f6b6a01b',
  materializedFiles: 291,
  materializedSha256: 'de505917cda4131a6fe3f162575a2e72338dfb81eb70d3db92dd6313ce64e289',
});

// These exact paths are CI/test overlays in 9f0880f5, plus this admission
// module. They contribute no bytes to the installer product directory.
const ciOnly = new Set([
  'services/api/prisma/task12-pfq-app-spec.cjs',
  'services/api/prisma/task12-pfq-app.cjs',
  'services/api/prisma/task12-pfq-jest-wire.cjs',
  'services/api/prisma/task12-pfq-positive-fixtures.json',
  'services/api/prisma/task12-pfq-recovery.cjs',
  'services/api/prisma/task12-pfq-recovery.json',

  'services/api/prisma/task12-expense-execution-retained-valid.json',
  'services/api/prisma/task12-expense-execution-app-spec.cjs',
  'services/api/prisma/task12-expense-execution-retained-negative.cjs',
  'services/api/prisma/task12-expense-execution-retained-negative.json',

  'services/api/prisma/task12-expense-execution-recovery.cjs',
  'services/api/prisma/task12-expense-execution-recovery.json',

  'services/api/prisma/task12-expense-finance-recovery.cjs',
  'services/api/prisma/task12-expense-finance-recovery.json',

  'services/api/prisma/task12-expense-finance-app-spec.cjs',
  'services/api/prisma/task12-expense-finance-retained-negative.json',
  'services/api/prisma/task12-expense-finance-retained-negative.cjs',
  'services/api/prisma/task12-expense-finance-retained-valid.json',
  'services/api/prisma/task12-payment-retained-ci.cjs',
  'services/api/prisma/task12-payment-retained-material.json',
  'services/api/prisma/task12-payment-fresh-ci.cjs',
  'services/api/prisma/task12-payment-seed-readback.sql',
  'services/api/src/database/payment-execution-concurrency.spec.ts',
  'scripts/run-task12-linux-280-installer.sh',
  'services/api/prisma/task12-pol109-ci.cjs',
  'services/api/prisma/task12-pol109-stage-browser.cjs',
  'services/api/prisma/task12-pol109-stage-workspace.cjs',
  'services/api/prisma/task12-pol109-spec.cjs',

  'services/api/prisma/task12-linux-282-pol108-ci.cjs',
  'services/api/src/database/operating-projection-postgresql.cases.ts',
  'services/api/src/database/company-proxy-repayment.http.pg.spec.ts',
  'services/api/src/database/task410-owned-test-database.ts',
  'services/api/src/expense-claim/expense-claim-registered-payment.http.pg.spec.ts',
  'services/api/src/invoice-ledger/invoice-ledger.postgres.spec.ts',
  'services/api/prisma/contract-bank-runtime-fixture.cjs',
  'services/api/prisma/database-dynamic-gate-manifest.json',
  'services/api/prisma/run-database-dynamic-gate-local.cjs',
  'services/api/prisma/run-database-dynamic-gate-local.test.cjs',
  'services/api/prisma/run-task398-shared-standard-local.cjs',
  'services/api/prisma/run-project-expense-receipt-concurrency-local.cjs',
  'services/api/prisma/task12-expense-receipt-retained-seed.json',
  'services/api/src/database/project-expense-receipt-concurrency.spec.ts',
  'services/api/prisma/task12-linux-280-contract-ci.cjs',
  'services/api/prisma/task12-linux-280-installer.cjs',
  'services/api/prisma/task12-linux-282-checkout-source.cjs',
  'services/api/prisma/task398-linux-282-standard-ci.cjs',
  'services/api/prisma/task398-owned-280-business-read-baseline.json',
  'services/api/src/database/contract-bill-batch-replace-concurrency.spec.ts',
  'services/api/src/database/contract-bill-transition-confirm-concurrency.spec.ts',
  'services/api/src/database/contract-template-scenario-concurrency.spec.ts',
  'services/api/src/database/settlement-draft-lifecycle-concurrency.spec.ts',
  'services/api/src/database/task12-owned-280.test-support.ts',
  'services/api/src/database/task16-shared-standard.http.pg.spec.ts',
  'services/api/src/database/task25-public-cash-handover.http.pg.spec.ts',
  'services/api/src/database/task27-principal-return.http.pg.spec.ts',
  'services/api/src/database/task398-owned-database.test-support.ts',
  'services/api/src/database/task398-voucher281.test-support.ts',
]);

const expensePins = [
  ['services/api/src/auth/auth.service.ts', '2b23e474ff43ac1a366e664f748c71651eb14dd94ed88015e112438fdc9458f0'],
  ['services/api/src/expense-claim/expense-claim.service.spec.ts', '509550e06797e74897e0c471211f3b046c7af5e6a9dda1677d691518ee1fb3a1'],
  ['services/api/src/expense-claim/expense-claim.service.ts', 'cc8f09b2593690cd9a8bbb2d7baab0e56db0fa6b4564d0ceda857235a8d80601'],
];

const workspaceRoots = [
  'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','scripts/pnpm-workspace.mjs','packages/shared-domain',
  'services/api/package.json','services/api/tsconfig.json','services/api/jest.config.cjs',
  'services/api/tsconfig.build.json','services/api/nest-cli.json',
  'services/api/scripts/operational-write-freeze-policy.cjs','services/api/scripts/operational-write-freeze-policy.d.cts',
  'services/api/jest.task10-acceptance-paths.cjs','services/api/jest.task09-task11-document-acceptance-paths.cjs',
  'services/api/src','services/api/prisma',
];
const settlementAssets = ['material-purchase-real-v1.docx','equipment-rental-real-v1.docx',
  'labor-subcontract-real-v1.docx','generic-contract-v1.docx'].map(file => 'services/api/assets/templates/'+file);
const contractModes = Object.freeze({
  '--contract-template-282-ci':['contract-template-scenario-concurrency.spec.ts'],
  '--contract-settlement-282-ci':['contract-bill-batch-replace-concurrency.spec.ts','contract-bill-transition-confirm-concurrency.spec.ts'],
  '--settlement-draft-282-ci':['settlement-draft-lifecycle-concurrency.spec.ts'],
});
const cashModes = Object.freeze({
  '--cash-standard-ci':'task16-shared-standard.http.pg.spec.ts',
  '--cash-handover-ci':'task25-public-cash-handover.http.pg.spec.ts',
  '--cash-principal-ci':'task27-principal-return.http.pg.spec.ts',
  '--cash-company-proxy-ci':'company-proxy-repayment.http.pg.spec.ts',
});
const prismaFixtures = {
  'task12-payment-retained-ci.cjs':'6bcd400ab092ea4edafbd6798d3401c7d94bc70eff39f1922f2dab773270dea2',
  'task12-payment-retained-material.json':'65abe64ccd8d0d3f2a169d783317930514a5200855c0f8a92d5d540dfe1a6d80',
  'task12-payment-fresh-ci.cjs':'79e5fae7ed9ef78dd8c7b49bea24177e6dfe00aef67eb96aa3828347e49d8c3e',
  'task12-payment-seed-readback.sql':'298413ce4de87a37ef5d4fe15d700b4292cea3f2383af42ab01831d895444554',

  'task12-linux-282-pol108-ci.cjs':'87439ee2a978b3e2fbbd934afd4f1026898d1b07b0ea466b92a131692a11fe75',
  'database-dynamic-gate-manifest.json':'877d6b02bb8547c5a37ca4a579e57801f5f991983da83dbcdf8a479cfbd482a6',
  'task12-linux-280-contract-ci.cjs':'540543e501ff906d07827bf213215e833157a15b635c25dd7d0627bd4ad4df11',
  'run-task398-shared-standard-local.cjs':'7c98f45b904d99200aebf49d92daf8137c30aea205f20970c90d4d12ffcdbae4',
  'contract-bank-runtime-fixture.cjs':'f8a52c20be644145418a7b643b8bb279589a94b1000bbdd9861750afebc4693b',
  'task12-expense-receipt-retained-seed.json':'19a02261145cce67ef8250e89020e1aa55b1015f30d19d7e97c3acb979a761b8',
  'task398-owned-280-business-read-baseline.json':'d9406ad3c45b4b77db171eca6bdf7a5cbad285dd107988f5ab6f33051b5beb60',
};
const specFixtures = {
  'payment-execution-concurrency.spec.ts':'73a99d8c3ea900b463679a3a0851cceea88ebd3f9cbcdd260cc25b0d3e62e02c',

  'operating-projection-postgresql.cases.ts':'6588211f0626648571af4aec33ecd5015bcd93718f1b89c26db8550a9b71f71b',
  'project-expense-receipt-concurrency.spec.ts':'a39d2a412bcf31d09387fdd2ca0e127bbe97cd6a796474ef8f32084e5da980c6',
  'company-proxy-repayment.http.pg.spec.ts':'8d6713ee6171bd661d05fa30c0f2b5a4ebb2e52df2c51ac71b18de3e3f7f0064',
  'task410-owned-test-database.ts':'7f9226199dacf6eac7c29768a34cf95af72d724ffdd5c6cd2554a955c35eedb9',
  'contract-bill-batch-replace-concurrency.spec.ts':'224758ab9e34ec43fba6ecadf30b5b000c94d8305af7c11ec135569b7ae6c375',
  'contract-bill-transition-confirm-concurrency.spec.ts':'a7ba4396881dbbf7cedd5c6adcafaa6e9570c013ab895b63c598d16fe1dd3b93',
  'contract-template-scenario-concurrency.spec.ts':'1237f6557bc1505625d0368c23cb68ca41f869afe0b8b61103af20bd9ba9d08a',
  'settlement-draft-lifecycle-concurrency.spec.ts':'b61fe7baf4ed3459c710b9634585f1f611367256137010bf79dadad5e6ce7685',
  'task12-owned-280.test-support.ts':'0653380689b72c974ab8abf63aa19dcd2fda7e8dc48114ccdd7a6d38793d5ba7',
  'task16-shared-standard.http.pg.spec.ts':'e70aa4d7364f7232f694881bb96fce88bfa57a89bd24fc6f527b4d85dfa6b901',
  'task25-public-cash-handover.http.pg.spec.ts':'69ae9c107a37cb946cc1d32ca93490109abcca7140a508d1890b8b41c520e28b',
  'task27-principal-return.http.pg.spec.ts':'c541006fafbe750c4d8d1f5ee94c1fab74acc33083d4761b0167f5c3c2b85ca9',
  'task398-owned-database.test-support.ts':'e8cab9ed9d2e1822e3d75023b91f404f409ef9baf4dca779789d745adb37ae3a',
  'task398-voucher281.test-support.ts':'27262f4a6c6166b797b7da68faa7f9d401f0d76e0c2f3053f39de8adb996c355',
};
const workspaceClaims = new WeakMap();

const pol109WorkspaceProfile = Object.freeze({
  includes: [...workspaceRoots, ...settlementAssets,
    'apps/web-admin/index.html','apps/web-admin/package.json','apps/web-admin/public','apps/web-admin/src',
    'apps/web-admin/tsconfig.json','apps/web-admin/vite.config.ts','apps/web-admin/playwright.config.ts',
    'apps/web-admin/e2e/project-close-profit.e2e.ts'],
  count: 3187,
  sha256: 'f7f826ecf7547aa11b181d1403bdf958d63587665b7500ee8133fdb501cbf173',
  fixtures: [
    ['services/api/prisma/task12-pol109-ci.cjs','d9f582c265dd96e684b62a910dbda9c1e9c18455627366b5cf44bbc18dbc279b'],
    ['services/api/prisma/task12-pol109-stage-browser.cjs','8adbaf1cd69af3d8154f163c490922bf5a5150ae8b21d3f705389282babbe71f'],
    ['services/api/prisma/task12-pol109-stage-workspace.cjs','eed760e392bb8a212e96ed0fb083c49b1dac9d062847efea4f5700f2a52eb2cc'],
    ['services/api/prisma/task12-pol109-spec.cjs','a108781c418e8dd4b45b832fe5800a9130f956cc1cb9ec17b8cd6f368cc41028'],
  ],
});

function workspaceProfile(mode) {
  if (mode === '--project-expense-execution-retained-valid-282-local') return {
    includes:workspaceRoots,count:2505,
    sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',
    fixtures:[['services/api/prisma/task12-expense-execution-retained-valid.json','6628e9cd7512d80a1c078f9d816a6e6397a0c54c8bfeca11f291cb6d54b9cce4']],
  };
  if (mode === '--project-expense-execution-app-282-local') return {
    includes:workspaceRoots,count:2505,
    sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',
    fixtures:[['services/api/prisma/task12-expense-execution-app-spec.cjs','214e923188b7eb6ef5d123979711db0743bda90b35a571a0d0e2be58ba53d8f5']],
  };
  if (mode === '--project-expense-execution-retained-negative-282-local') return {
    includes:workspaceRoots,count:2505,
    sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',
    fixtures:[
      ['services/api/prisma/task12-expense-execution-retained-negative.cjs','a5092f5ad1232e27b1e9cc24ea58751fa2dc2321b1fd3dce0f72e2aa199f8d2c'],
      ['services/api/prisma/task12-expense-execution-retained-negative.json','39830ed9512bfa269f19547608945ec612f33c053c8d86390d6b7a24e4ca34b6'],
    ],
  };
  if (mode === '--project-expense-execution-audit-recovery-282-local') return {
    includes:workspaceRoots,count:2505,
    sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',
    fixtures:[
      ['services/api/prisma/task12-expense-execution-recovery.cjs','1af16f07d094ec18f85025c1b5c15352ff48e2e3fffa1735b32d9acd2f6aa224'],
      ['services/api/prisma/task12-expense-execution-recovery.json','a7a852fb53dcada5be21fe5283342ed0a2c26952311f9453dd6f1cab107dff09'],
    ],
  };
  const pfqFixtures = {
    positive: [
      ['services/api/prisma/task12-pfq-positive-fixtures.json','3b16099b9024ba052b4cbf66e25869b1ce26321931677ac37bbebbfe4fe5a07e']
    ],
    recovery: [
      ['services/api/prisma/task12-pfq-recovery.cjs','02f3d7fa16c12e81d3006668e9a9c7ad6eb711e2b78f7b538fa50f95c87606f3'],
      ['services/api/prisma/task12-pfq-recovery.json','fb27ad2ca98929b53f262d9a42ef9df655239e4b9248f6fd0679d912dbb2e8db']
    ],
    app: [
      ['services/api/prisma/task12-pfq-app.cjs','95f4712e9df222a798da2aab5631f69b85f8808e2cf2b6b38c1a6a990e5976a6'],
      ['services/api/prisma/task12-pfq-app-spec.cjs','903e044da0bb8f70538c4bcd141e01945f9718a200fef5373aa9f23efb84ddd0'],
      ['services/api/prisma/task12-pfq-jest-wire.cjs','9fcf13fff0e1393588a1da9f505413c704f56644ad2033b1cee4299c1be875f8']
    ],
  };
  if (['--pfq-pre115-clean-282-local','--pfq-pre116-legacy-282-local'].includes(mode)) return {
    includes:workspaceRoots,count:2505,sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',fixtures:pfqFixtures.positive,
  };
  if (['--pfq-duplicate-282-local','--pfq-cross-business-282-local',
      '--pfq-replacement-child-282-local','--pfq-replacement-parent-282-local'].includes(mode)) return {
    includes:workspaceRoots,count:2505,sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',fixtures:pfqFixtures.recovery,
  };
  if (mode === '--pfq-app-282-local') return {
    includes:workspaceRoots,count:2505,sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',fixtures:pfqFixtures.app,
  };
  if (mode === '--project-expense-finance-audit-recovery-282-local') return {
    includes:workspaceRoots,count:2505,
    sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',
    fixtures:[
      ['services/api/prisma/task12-expense-finance-recovery.cjs','132f52f374dd40b62bc737beef5d68866fbd5b61bd00ac026397fb1e5f6f706c'],
      ['services/api/prisma/task12-expense-finance-recovery.json','645d1c45aaa1f2e55392bc6665467d01b57ea22e98cf2dae31fad1dec1ffa577'],
    ],
  };
  if (mode === '--project-expense-finance-app-282-local') return {
    includes:workspaceRoots,count:2505,
    sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',
    fixtures:[['services/api/prisma/task12-expense-finance-app-spec.cjs','2d544051fae0272ca15ac533b7d7cc3f4c74169489f46014722a4aeb3d9a347c']],
  };
  if (mode === '--project-expense-finance-retained-negative-282-local') return {
    includes:workspaceRoots,count:2505,
    sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',
    fixtures:[
      ['services/api/prisma/task12-expense-finance-retained-negative.json','c2ee555adc46318dc78e64ce0e9489ea97def10f6d34d8a091a393545327eefe'],
      ['services/api/prisma/task12-expense-finance-retained-negative.cjs','177a6f16806540a56060d8d271fbb6ac7cf2a46a8ce68e1a5bd466fe547e2d7e'],
    ],
  };
  if (mode === '--project-expense-finance-retained-valid-282-local') return {
    includes:workspaceRoots,count:2505,
    sha256:'8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',
    fixtures:[['services/api/prisma/task12-expense-finance-retained-valid.json','7bd2f78236db2c38d0e7a616f1569f45bf6907daaa772c7a9d85a11ef6c4ce42']],
  };
  if (mode === '--project-close-profit-pol109-282-ci') return pol109WorkspaceProfile;
  const contract = Object.hasOwn(contractModes,mode);
  const pol108Core = ['--pol108-core-282-ci','--pol108-facts-282-ci','--pol108-impacts-282-ci'].includes(mode);
  const freshOwner = pol108Core || ['--fund-execution-v7-282-ci','--invoice-ledger-282-ci',
    '--necessary-expense-reserve-282-ci','--project-fund-dispute-282-ci'].includes(mode);
  const paymentFresh=mode==='--payment-execution-fresh-282-ci';
  const paymentRetained=['--payment-retained-valid-282-ci','--payment-retained-negative-282-ci'].includes(mode);
  const retainedReceipt = mode === '--project-expense-receipt-retained-282-ci';
  const receiptConcurrency = mode === '--project-expense-receipt-app-282-ci';
  requireMatch(paymentFresh || paymentRetained || retainedReceipt || receiptConcurrency || freshOwner || contract || Object.hasOwn(cashModes,mode), 'CHECKOUT_282_WORKSPACE_MODE');
  const documentAssets = paymentFresh || pol108Core || ['--contract-settlement-282-ci','--necessary-expense-reserve-282-ci',
    '--project-fund-dispute-282-ci'].includes(mode);
  const prisma = paymentFresh ? ['task12-payment-fresh-ci.cjs','task12-payment-seed-readback.sql'] :
    paymentRetained ? ['task12-payment-retained-ci.cjs','task12-payment-retained-material.json'] : pol108Core ? ['task12-linux-282-pol108-ci.cjs'] : retainedReceipt ? ['task12-expense-receipt-retained-seed.json'] :
    receiptConcurrency || freshOwner ? [] : contract ? ['task12-linux-280-contract-ci.cjs'] :
    ['run-task398-shared-standard-local.cjs','contract-bank-runtime-fixture.cjs','task398-owned-280-business-read-baseline.json'];
  const proxy = mode === '--cash-company-proxy-ci';
  const spec = paymentFresh ? ['payment-execution-concurrency.spec.ts','task12-owned-280.test-support.ts'] :
    paymentRetained ? [] : pol108Core ? ['operating-projection-postgresql.cases.ts'] : receiptConcurrency ? ['project-expense-receipt-concurrency.spec.ts'] :
    retainedReceipt || freshOwner ? [] : contract ? ['task12-owned-280.test-support.ts',...contractModes[mode]] :
    ['task398-owned-database.test-support.ts','task398-voucher281.test-support.ts',cashModes[mode],...(proxy ? ['task410-owned-test-database.ts'] : [])];
  return {
    includes: documentAssets ? [...workspaceRoots,...settlementAssets] : workspaceRoots,
    count: documentAssets ? 2509 : 2505,
    sha256: documentAssets ? '9a3855ae34de08f8f45ac22af5564fa172082f9760295ef97e29a7875d8704d8' :
      '8ddfd5bd871d4f0d3191caa121603aab3fa5f9ab16ee8702eb5280c8afced44c',
    fixtures: [
      ...(pol108Core ? [['services/api/jest.runtime.config.cjs','e1ace21f431b8c9dcc14a04d050a1db1713f8ba1004bcd0068efda16f3bbba07']] : []),
      ...(proxy ? [['services/api/src/expense-claim/expense-claim-registered-payment.http.pg.spec.ts',
        '99e0849aef89f399bc5b1ac827b545b6ed1febb72f82babd077d282b23aad3c1']] : []),
      ...(mode === '--invoice-ledger-282-ci' ? [['services/api/src/invoice-ledger/invoice-ledger.postgres.spec.ts','762209074671fb72a606cda13a83aa72092df463133b9cb7cd13fffdc34b0114']] : []),
      ...['database-dynamic-gate-manifest.json',...prisma]
        .map(file => [prismaPath+'/'+file,prismaFixtures[file]]),
      ...spec.map(file => ['services/api/src/database/'+file,specFixtures[file]]),
    ],
  };
}

function requireMatch(ok, code) {
  if (!ok) throw new Error(code);
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const seal = rows => sha256(JSON.stringify(rows));
const order = (a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));

function git(root, ...args) {
  const bytes = execFileSync('git', ['-C', root, ...args], { maxBuffer: 8 * 1024 * 1024 });
  const output = bytes.toString('utf8');
  requireMatch(bytes.equals(Buffer.from(output)), 'CHECKOUT_282_ENCODING');
  return output;
}

function indexRows(root, profile = release) {
  requireMatch(!git(root, 'diff-files', '--no-renames', '--name-only', '-z', '--') &&
    !git(root, 'ls-files', '--others', '--exclude-standard', '-z'), 'CHECKOUT_282_DIRTY');
  requireMatch(git(root, 'ls-files', '-v', '-z').split('\0').filter(Boolean)
    .every(record => record.startsWith('H ')), 'CHECKOUT_282_INDEX_HINTS');

  const indexed = git(root, 'ls-files', '--stage', '-z').split('\0').filter(Boolean).map(line => {
    const match = /^(100644|100755|120000|160000) ([0-9a-f]{40}) 0\t([\s\S]+)$/u.exec(line);
    requireMatch(match, 'CHECKOUT_282_INDEX_RECORD');
    const [, mode, oid, file] = match;
    requireMatch(!file.startsWith('/') && file.split('/').every(part => part && part !== '.' && part !== '..'),
      'CHECKOUT_282_INDEX_PATH');
    return { path:file, mode, oid };
  }).filter(({path:file}) => profile === contract289 || !ciOnly.has(file)).sort(order);
  requireMatch(indexed.length === profile.indexRows && seal(indexed) === profile.indexSha256, 'CHECKOUT_282_PRODUCT_INDEX');
  return indexed;
}

function capture(root, file) {
  const absolute = path.join(root, file);
  const stat = fs.lstatSync(absolute);
  requireMatch(stat.isFile() && fs.realpathSync(absolute) === absolute, 'CHECKOUT_282_NOT_REGULAR');
  const bytes = fs.readFileSync(absolute);
  return {
    row: {
      path: file,
      mode: (stat.mode & 0o111) === 0 ? '100644' : '100755',
      oid:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),
      sha256:sha256(bytes),
    },
    bytes,
  };
}

function validateArchive(rows, profile) {
  requireMatch(rows.length === profile.materializedFiles &&
    seal(rows.sort(order)) === profile.materializedSha256, 'CHECKOUT_282_ARCHIVE_DIGEST');
}

function captureIndexed(root, entry) {
  const archived = capture(root, entry.path);
  requireMatch(archived.row.mode === entry.mode && archived.row.oid === entry.oid, 'CHECKOUT_282_FILE_BYTES');
  return archived;
}

function writeArtifacts(target, artifacts) {
  for (const {row, bytes} of artifacts) {
    const output = path.join(target, row.path);
    fs.mkdirSync(path.dirname(output), { recursive:true, mode:0o755 });
    fs.writeFileSync(output, bytes, { flag:'wx', mode:row.mode === '100755' ? 0o755 : 0o644 });
  }
}

function captureFixture(root, [file,expected]) {
  const result = capture(root,file);
  requireMatch(result.row.mode === '100644' && result.row.sha256 === expected, 'CHECKOUT_282_FIXTURE_BYTES');
  return result;
}

function materializeWorkspace(root, target, mode) {
  root = fs.realpathSync(root);
  requireMatch(fs.realpathSync(target) === target && fs.readdirSync(target).length === 0, 'CHECKOUT_282_OUTPUT');
  const profile = workspaceProfile(mode);
  const files = indexRows(root).filter(({path:file}) =>
    profile.includes.some(entry => file === entry || file.startsWith(entry+'/')))
    .map(entry => captureIndexed(root,entry));
  const rows = files.map(({row})=>row);
  requireMatch(rows.length === profile.count && seal(rows) === profile.sha256, 'CHECKOUT_282_WORKSPACE_BYTES');
  const fixtures = profile.fixtures.map(pin => captureFixture(root,pin));
  writeArtifacts(target, [...files,...fixtures]);
  const record = {mode,tree:release.tree,rows};
  fs.writeFileSync(path.join(target,'checkout-workspace.json'),JSON.stringify(record)+'\n',{flag:'wx',mode:0o644});
  return {mode,tree:release.tree,files:rows.length,sha256:profile.sha256,fixtures:fixtures.length};
}

function verifyMaterializedWorkspace(root, mode) {
  const profile = workspaceProfile(mode);
  const file = path.join(root,'checkout-workspace.json');
  const stat = fs.lstatSync(file);
  requireMatch(stat.isFile() && stat.size < 1024*1024, 'CHECKOUT_282_WORKSPACE_METADATA');
  const record = JSON.parse(fs.readFileSync(file,'utf8'));
  requireMatch(record.mode === mode && record.tree === release.tree && Array.isArray(record.rows) &&
    record.rows.length === profile.count && seal(record.rows) === profile.sha256, 'CHECKOUT_282_WORKSPACE_METADATA');
  for (const row of record.rows) {
    requireMatch(isDeepStrictEqual(capture(root,row.path).row,row), 'CHECKOUT_282_WORKSPACE_BYTES');
  }
  for (const pin of profile.fixtures) captureFixture(root,pin);
  const claim = Object.freeze({mode,tree:release.tree,files:profile.count,sha256:profile.sha256,fixtures:profile.fixtures.length});
  workspaceClaims.set(claim,mode);
  return claim;
}

function isVerifiedWorkspaceProof(claim, mode) {
  return workspaceClaims.get(claim) === mode && typeof mode === 'string';
}

function materializeCheckout(root, target, profile) {
  root = fs.realpathSync(root);
  requireMatch(fs.realpathSync(target) === target && fs.readdirSync(target).length === 0, 'CHECKOUT_282_OUTPUT');
  const indexed = indexRows(root, profile);
  const pins = new Map(profile === contract289 ? [] : expensePins);
  if (profile === projectLegacyReviewRelease) {
    pins.set('services/api/src/expense-claim/expense-claim.service.ts',
      '6d254a9271a611bfaa8fefbf9ff2d1933c67e0a1224d2f35a4bb09aace487584');
  }
  for (const [file, expected] of pins) {
    requireMatch(capture(root, file).row.sha256 === expected, 'CHECKOUT_282_EXPENSE_BYTES');
  }

  const artifacts = indexed.filter(entry => asset.test(entry.path)).map(entry => captureIndexed(root,entry));
  validateArchive(artifacts.map(({row}) => row), profile);
  writeArtifacts(target,artifacts);
  fs.writeFileSync(path.join(target, 'checkout-source.json'), JSON.stringify(profile)+'\n', {flag:'wx',mode:0o644});
  return profile;
}

function verifyMaterialized(target, profile = release) {
  requireMatch(profile === release || profile === projectLegacyReviewRelease || profile === contract289, 'CHECKOUT_INSTALLER_PROFILE');
  const attestation = path.join(target, 'checkout-source.json');
  const marker = fs.lstatSync(attestation);
  requireMatch(marker.isFile() && marker.size < 1024 &&
    isDeepStrictEqual(JSON.parse(fs.readFileSync(attestation,'utf8')),profile), 'CHECKOUT_282_ATTESTATION');
  requireMatch(isDeepStrictEqual(fs.readdirSync(target).sort(), ['checkout-source.json','services']) &&
    isDeepStrictEqual(fs.readdirSync(path.join(target,'services')), ['api']) &&
    isDeepStrictEqual(fs.readdirSync(path.join(target,'services/api')), ['prisma']), 'CHECKOUT_282_ARCHIVE_ROOT');
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(target,dir), {withFileTypes:true})) {
      const file = path.posix.join(dir,entry.name);
      if (entry.isDirectory()) {
        const isMigration = dir === prismaPath+'/migrations' && /^[0-9]{14}_[a-z0-9_]+$/u.test(entry.name);
        requireMatch(file === prismaPath+'/migrations' || isMigration, 'CHECKOUT_282_ARCHIVE_PATH');
        if (isMigration) requireMatch(isDeepStrictEqual(fs.readdirSync(path.join(target,file)), ['migration.sql']),
          'CHECKOUT_282_ARCHIVE_PATH');
        walk(file);
      } else {
        requireMatch(entry.isFile() && asset.test(file), 'CHECKOUT_282_ARCHIVE_PATH');
        files.push(capture(target,file).row);
      }
    }
  };
  walk(prismaPath);
  validateArchive(files, profile);
  return profile;
}

if (require.main === module) {
  const [command,root,target,mode] = process.argv.slice(2);
  const installer = process.argv.length === 5 && ['--materialize','--materialize-287','--materialize-289'].includes(command);
  const profile = command === '--materialize-289' ? contract289 :
    command === '--materialize-287' ? projectLegacyReviewRelease : release;
  requireMatch(installer || process.argv.length === 6 && command === '--workspace', 'CHECKOUT_282_ARGUMENTS');
  console.log(JSON.stringify(installer ? materializeCheckout(root,fs.realpathSync(target),profile) :
    materializeWorkspace(root,fs.realpathSync(target),mode)));
}

module.exports = { release, projectLegacyReviewRelease, contract289, verifyMaterialized, verifyMaterializedWorkspace, isVerifiedWorkspaceProof };
