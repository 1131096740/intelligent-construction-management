'use strict';

const assert = require('node:assert/strict');

const profiles = {
  issue413: {
    file: 'src/database/issue413-construction-enterprise-paid.pg.spec.ts',
    sourceDigest: '313c9fc331c53eb9912d4f52584d208c414a4953e39518f4627e27892c7aa40f',
    orderedDatabaseKey: 'JG_ISSUE413_ORDERED_DATABASE',
    enableKey: 'RUN_ISSUE413_CONSTRUCTION_PAID_DATABASE',
    stage: 'ORIGINAL_PAYMENT_JEST',
    titles: [
      'allows overpayment, keeps duplicate registration closed, and re-registers a correction'
    ]
  },
  issue420: {
    file: 'src/database/issue420-approval-center.http.pg.spec.ts',
    sourceDigest: 'd4effcfb32e745737be3278c0556f903c2ae6c55c631016a59a3c0c79588d5a3',
    fixtureDigest: 'fe8b03de2fec47e42152497301ab0100a1e9cc4424195b7d901d5bc27fd23a12',
    orderedDatabaseKey: 'JG_ISSUE420_ORDERED_DATABASE',
    enableKey: 'RUN_ISSUE420_REAL_DB',
    stage: 'ORIGINAL_HTTP_PDF_JEST',
    titles: [
      '我方可查看只对管理读取岗位开放，查看权不等于办理权',
      '办理中可下载当前轮审批单：已签显示签字、未签留空、带水印并记下载审计',
      '驳回后重提只保留最新轮审批单，旧轮签字不进入新PDF'
    ]
  },
  issue421: {
    file: 'src/database/issue421-signed-settlement-ledger.http.pg.spec.ts',
    sourceDigest: '2580650f2a96dac37a6f9b9e2720aec8985f9cac8144bf4f08e0cce7859d8e9e',
    fixtureDigest: 'e2362782b0762891701e100c0804f73b923a97c9bb80b77eb4f1951245866c7a',
    orderedDatabaseKey: 'JG_ISSUE421_ORDERED_DATABASE',
    enableKey: 'ISSUE421_LEDGER_RUN',
    stage: 'ORIGINAL_SIGNED_LEDGER_JEST',
    titles: [
      'only puts confirmed signed settlements into the formal ledger',
      'merges visible projects and enforces row-level visibility',
      'filters the whole visible ledger by project, date, status and keyword',
      'exports the same filtered rows with numeric amount, date and escaped text',
      'does not let exports bypass row-level visibility',
      'exports contracts with the current filter, numeric/date cells and unknown amounts kept'
    ]
  }
};

function profileFor(scope) {
  assert.ok(Object.hasOwn(profiles, scope), 'ORDERED_334_SCOPE');
  return profiles[scope];
}

module.exports = { profileFor };
