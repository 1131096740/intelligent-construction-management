'use strict';

const assert = require('node:assert/strict');

const profiles = {
  issue405: {
    file: 'src/database/issue405-other-project-payment.pg.spec.ts',
    sourceDigest: 'cc7b5d5bbdfba6c73f47a808a5c3ce3ebf33b75675c8dc8a253b696c261d0c8e',
    fixtureDigest: '80708330292b60faa092f8fd9a5c16719b016990d27f6e9dbfc807fbbd8b30c3',
    orderedDatabaseKey: 'JG_ISSUE405_ORDERED_DATABASE',
    databaseUrlKey: 'ISSUE405_OTHER_PROJECT_PAYMENT_DATABASE_URL',
    enableKey: 'ISSUE405_OTHER_PROJECT_PAYMENT_RUN',
    stage: 'ORIGINAL_OTHER_PROJECT_PAYMENT_JEST',
    requiresOperatingLedgerWriteSecret: true,
    titles: [
      'registers, approves, splits, refunds and corrects a no-contract project payment with one cost'
    ]
  },
  issue411: {
    file: 'src/database/issue411-third-company-repayment.pg.spec.ts',
    sourceDigest: '46f2bf46d6b1de968da67fd60fea9d90e249870db283210c330c9f59e4c4d86e',
    fixtureDigest: 'aaa48d5b3a6d64dc8a79140d7ec1c854096c534720dada45544cb84ddc77b738',
    orderedDatabaseKey: 'JG_ISSUE411_ORDERED_DATABASE',
    enableKey: 'RUN_ISSUE411_THIRD_COMPANY_REPAYMENT',
    stage: 'ORIGINAL_THIRD_COMPANY_REPAYMENT_JEST',
    requiresOperatingLedgerWriteSecret: true,
    titles: [
      'moves A-B debt to A-C with one payment, rejects a duplicate, and keeps the corrected net',
      're-points a settled third-party repayment to the correct original debt and keeps the A-C debt'
    ]
  },
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
  issue414: {
    file: 'src/database/issue414-construction-enterprise-deduction.pg.spec.ts',
    sourceDigest: 'fbf556937ef4b1a5a1a9b496d2810cc78f667966708519dc5fda2e9b8642ac46',
    fixtureDigest: '7aa536c10c8eb77e845466a1f04a4f302c83bdabebabe47fa2679619fc5a4029',
    orderedDatabaseKey: 'JG_ISSUE414_ORDERED_DATABASE',
    enableKey: 'RUN_ISSUE414_CONSTRUCTION_DEDUCTION_DATABASE',
    stage: 'ORIGINAL_DEDUCTION_JEST',
    requiresOperatingLedgerWriteSecret: true,
    titles: [
      'registers, rejects duplicates, corrects and keeps paid aggregation unchanged'
    ]
  },
  issue416_handover: {
    file: 'src/database/issue416-takeover-handover.pg.spec.ts',
    sourceDigest: 'abde4945f276cbe0f1adef32ee7b69dd86ed63369814ce51c55e57b1136d861a',
    fixtureDigest: '2a4e09cc0cc40d1af577f1eacfb28cd53f750c722013ef44148094f0bd56af17',
    orderedDatabaseKey: 'JG_ISSUE416_HANDOVER_ORDERED_DATABASE',
    databaseUrlKey: 'ISSUE416_HANDOVER_DATABASE_URL',
    enableKey: 'RUN_ISSUE416_HANDOVER_DATABASE',
    stage: 'ORIGINAL_HISTORY_HANDOVER_JEST',
    titles: [
      'blocks a no-grade takeover before its division handover, allows it after registration, keeps facts and traces reassignment'
    ]
  },
  issue416_his: {
    file: 'src/database/issue416-his-gap.pg.spec.ts',
    sourceDigest: '2dd17a1119728583b21e158cd282173222a8db66b690e9d93ba0ddcbab9f0f07',
    orderedDatabaseKey: 'JG_ISSUE416_HIS_ORDERED_DATABASE',
    databaseUrlKey: 'ISSUE416_HIS_DATABASE_URL',
    enableKey: 'RUN_ISSUE416_HIS_DATABASE',
    stage: 'ORIGINAL_HISTORY_GAP_JEST',
    titles: [
      'activates a NONE-level history takeover, projects its payments, keeps opening cash untouched and continues 60 + 10 = 70',
      'relays contract maker -> finance -> contract supervisor and sends both rejections back to the maker',
      'keeps unknown historical facts in their original stage and only records an explicit zero'
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
  },
  issue421b: {
    file: 'src/database/issue421b-four-ledger.http.pg.spec.ts',
    sourceDigest: '8ab0d51bf2a9b0b99cc14b690539f081fa753beaef5b1a4508f72a52d0aafab4',
    fixtureDigest: 'caf4fac4c79e762f26ba72416e1be5d5f64ffd93bdaa29200cdad0b70c634965',
    orderedDatabaseKey: 'JG_ISSUE421B_ORDERED_DATABASE',
    enableKey: 'ISSUE421B_LEDGER_RUN',
    stage: 'ORIGINAL_FOUR_LEDGER_JEST',
    titles: [
      'filters payment ledger on the server and exports the same visible filtered rows',
      'does not let payment export bypass row-level visibility',
      'filters and exports spot procurement with the same accessible rows',
      'filters and exports general procurement with the same access scope',
      'filters and exports expense claims for finance cross-project and employees own-only'
    ]
  },
  issue422: {
    file: 'src/database/issue422-archives.http.pg.spec.ts',
    sourceDigest: 'e1b07c48aabe8ce197cb2d26cdd93a065434c7ef5cb3a1ae51547638ad02f826',
    fixtureDigest: 'e5d23d40b28d09b7054621db4f183dfe5492822483379b365c37774f732f1020',
    orderedDatabaseKey: 'JG_ISSUE422_ORDERED_DATABASE',
    enableKey: 'RUN_ISSUE422_REAL_DB',
    stage: 'ORIGINAL_ARCHIVE_HTTP_JEST',
    titles: [
      'searches archives only inside the current document visibility and filters by project, contract, counterparty, and number',
      "issues short-lived attachment tickets without password or reason, audits downloads, and rejects another project's file",
      'rejects an expired short-lived link and a still-valid link after the role is revoked',
      'authorizes every package file, rejects mixed unauthorized selections, and records package audit'
    ]
  }
};

function profileFor(scope) {
  assert.ok(Object.hasOwn(profiles, scope), 'ORDERED_334_SCOPE');
  return profiles[scope];
}

module.exports = { profileFor };
