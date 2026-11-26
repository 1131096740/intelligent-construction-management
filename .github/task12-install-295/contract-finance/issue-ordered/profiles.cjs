'use strict';

const assert = require('node:assert/strict');

const profiles = {
  issue400: {
    file: 'src/database/issue400-financial-correction-refund.pg.spec.ts',
    sourceDigest: '263db63fb01eb5a821669039c92b645f456d45a51766f08d2345a4cb9986f329',
    fixtureDigest: '4b74d949924a41c7e5e0aa070f616b4d28dcfc0562d06f93086fb6802d3b74b7',
    orderedDatabaseKey: 'JG_ISSUE400_ORDERED_DATABASE',
    databaseUrlKey: 'ISSUE400_FINANCIAL_CORRECTION_DATABASE_URL',
    enableKey: 'ISSUE400_FINANCIAL_CORRECTION_RUN',
    stage: 'ORDERED_REFUND_CORRECTION_ALTERNATE_JEST',
    titles: [
      'registers refunds and corrections as new facts without rewriting the original payment'
    ]
  },
  issue403: {
    "file": "src/database/issue403-actual-purchase-batch.pg.spec.ts",
    "sourceDigest": "dc60ff652c24fde0cc2da5ab75a633ee8ca924221b31401a18b2434a7a26f620",
    "fixtureDigest": "abf05b9a2017b2b80ac3493b6b84341cc44d6006d02c9c487167172428f5eacc",
    "orderedDatabaseKey": "JG_ORDERED_ISSUE333_DATABASE",
    "databaseUrlKey": "ISSUE403_DATABASE_URL",
    "enableKey": "ISSUE403_ACTUAL_PURCHASE_RUN",
    "stage": "ORIGINAL_ACTUAL_PURCHASE_JEST",
    "requiresOperatingLedgerWriteSecret": true,
    "requiredMigrationCount": 340,
    "requiredTerminalMigration": "20261129009000_general_purchase_batch_claim_guard",
    "requiredTerminalMigrationSha256": "96f3eb48fc233b32a7f2af85e0f1813ef1e2b25a8dd52bc1bb6f373e98f8a4a6",
    "titles": [
      "migrates a legacy pending spot payment atomically and accepts a finance signature through HTTP after reopening",
      "confirms batch cost once, splits payments, corrects cost and restores capacity after refund",
      "records a general procurement batch and rejects over-commitment before claim approval"
    ]
  },
  issue404: {
    "file": "src/database/issue404-reimbursement.pg.spec.ts",
    "sourceDigest": "f0916a78e40070fef835509251978102531592ec7991c2769942e3feb15dce65",
    "fixtureDigest": "9c258efa49b32693e9c300bbb6f84507977bd35a1c024fe0ebc6d85a3687b707",
    "orderedDatabaseKey": "JG_ISSUE404_ORDERED_344_DATABASE",
    "databaseUrlKey": "ISSUE404_DATABASE_URL",
    "enableKey": "ISSUE404_REIMBURSEMENT_RUN",
    "stage": "ORIGINAL_REIMBURSEMENT_JEST",
    "requiredMigrationCount": 344,
    "requiredTerminalMigration": "20261129013000_expense_public_cash_voucher",
    "requiredTerminalMigrationSha256": "b35a305dbe45edd2822bf850f3ef8abcd6161820dd065db82b7b084463255106",
    "titles": [
      "records a multi-category direct claim, confirms cost once and keeps batch cost unique",
      "lets an employee claim only the advanced part of a purchase batch without a second cost",
      "carries general procurement and company-daily sources into employee advance claims"
    ]
  },
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
    fixtureDigest: '3f1268ce742078f27bf0ae4c77ad2f99c86a7e60bdf5a439e40fa194b783ca21',
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
    sourceDigest: 'b29b942819024d42e5cdb0a95d614caf84abadf65868a0bada71c6e16e7690e3',
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
  issue418: {
    file: 'src/database/issue418-operating-dedup.pg.spec.ts',
    sourceDigest: 'f9876f2541db34bdd70be1e0e8543cc4c3eb942d7ce3dee2dd044539dcc8e28d',
    fixtureDigest: '0ee201f76bb34da9eff97fa3839abc47cdadf7f6ff2d9eabf860e30798e18939',
    orderedDatabaseKey: 'JG_ORDERED_ISSUE333_DATABASE',
    databaseUrlKey: 'ISSUE418_OPERATING_DEDUP_DATABASE_URL',
    enableKey: 'ISSUE418_OPERATING_DEDUP_RUN',
    stage: 'ORIGINAL_OPERATING_DEDUP_JEST',
    requiredMigrationCount: 346,
    requiredTerminalMigration: '20261129015000_expense_public_cash_operating_source',
    requiredTerminalMigrationSha256: 'd2f1419df6337020ad7dc5385b4b52a2997f276656dd3ff90f71d8c62f5c8b9a',
    titles: [
      '同合同双入口只计一次成本，upward 不进成本，outside 进入成本',
      '施工企业已付80、项目对外支付70，两指标成对且不可相加',
      '成本归属读侧分列承担公司、待归属与公共现金来源',
      '明细可追溯到事实、影响、来源类型和源业务 ID',
      '数据库来源唯一键阻止同一来源重复入账',
      '跨来源写入守卫在真实 Settlement/SignedContractSettlement 行上拒绝同期次重复登记',
      'G4 公共现金待归属确认后转正、幂等且不新增成本',
      'G5 资金流水与经营事实一致，支持类型过滤与导出',
      'G9 总览按合同钻取：审批中与已批待付分列，跨合同不抵扣'
    ]
  },
  issue418_guard: {
    file: 'src/database/issue418-settlement-guard.pg.spec.ts',
    sourceDigest: '71ba45e4ae1722b5c8fbc52178c1216fdabfc29731c41e65f7a7529443ee365b',
    orderedDatabaseKey: 'JG_ORDERED_ISSUE333_DATABASE',
    databaseUrlKey: 'ISSUE418_SETTLEMENT_GUARD_DATABASE_URL',
    enableKey: 'ISSUE418_SETTLEMENT_GUARD_RUN',
    stage: 'ORDERED_CROSS_SOURCE_SETTLEMENT_GUARD_JEST',
    requiredMigrationCount: 346,
    requiredTerminalMigration: '20261129015000_expense_public_cash_operating_source',
    requiredTerminalMigrationSha256: 'd2f1419df6337020ad7dc5385b4b52a2997f276656dd3ff90f71d8c62f5c8b9a',
    titles: ['拒绝合同同版本同期次跨入口登记，允许不同期次']
  },
  issue420: {
    file: 'src/database/issue420-approval-center.http.pg.spec.ts',
    sourceDigest: 'd4effcfb32e745737be3278c0556f903c2ae6c55c631016a59a3c0c79588d5a3',
    fixtureDigest: '108ebe6f851963c968a9cda874024deec0ac121b99a0aab4b76e4d5ad7bcf892',
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
    fixtureDigest: '97ecc2cedbd8ebbb9597602280e4ab4500f389b16dc4c5cefdfdb6d83768c283',
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
    fixtureDigest: '925acf589db22eb185b8c94fd036b63266eb4bfa9a005b4674bf9b1dd973887d',
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
    fixtureDigest: 'bd414e6b5fdc738f0c44c4c439c4cbe75dcdebd5539080564a75c990354c81bf',
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
