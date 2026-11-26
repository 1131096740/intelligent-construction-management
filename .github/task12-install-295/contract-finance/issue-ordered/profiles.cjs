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
  }
};

function profileFor(scope) {
  assert.ok(Object.hasOwn(profiles, scope), 'ORDERED_334_SCOPE');
  return profiles[scope];
}

module.exports = { profileFor };
