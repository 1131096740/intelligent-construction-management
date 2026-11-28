'use strict';

const assert = require('node:assert/strict');
const {createRequire} = require('node:module');

// Financial seed follows the effective source-version fixture in
// contract-bill-transition-confirm-concurrency.spec.ts. Only the historical side
// of that case is needed here; it stays until the isolated database is dropped.
async function seedSettlementHistory(context,{textDirect330=false}={}) {
  const {PrismaClient} = createRequire('/qualification/workspace/services/api/package.json')('@prisma/client');
  const prisma = new PrismaClient({datasources:{db:{url:context.ownerUrl}}});
  try {
    return await prisma.$transaction(async tx => {
      const loan = await tx.companyTransfer.findFirstOrThrow({
        where:{kind:'loan', sourceProjectId:{not:null}}, orderBy:{id:'asc'},
        select:{id:true,sourceProjectId:true,applicantUserId:true},
      });
      const prefix = 'backup-history-' + context.runId;
      const id = suffix => prefix + '-' + suffix;
      const contract = await tx.contract.create({data:{
        id:id('contract'), projectId:loan.sourceProjectId, name:'跨版本映射并发验证合同',
        counterparty:'验证单位', ownerUserId:loan.applicantUserId,
      }});
      const version = await tx.contractVersion.create({data:{
        id:id('source-version'), contractId:contract.id, versionNo:1, changeType:'original',
        status:'effective', amountCents:10000n, draftRevision:1, settlementMode:'settlement_required',
        settlementModeSource:'rule', draftData:{}, templateSnapshot:{}, clauseSnapshot:[],
      }});
      const terms = await tx.paymentTermsVersion.create({data:{
        id:id('payment-terms'), contractId:contract.id, contractVersionId:version.id, versionNo:1,
        status:'effective', originalText:'按已生效结算支付',
      }});
      const bill = await tx.contractBill.create({data:{
        id:id('source-bill'), contractVersionId:version.id, billKey:'main', name:'来源清单',
        amountRole:'included', pricingMode:'tax_inclusive', quantityScale:2, unitPriceScale:2,
        schemaSnapshot:{},
      }});
      const row = await tx.contractBillRow.create({data:{
        id:id('source-row'), contractBillId:bill.id, rowKey:'source-row', sortOrder:1,
        itemName:'来源钢筋', unit:'t', quantity:'30', unitPrice:'100', customData:{},
      }});
      const settlement = await tx.settlement.create({data:{
        id:id('settlement'), projectId:loan.sourceProjectId, contractId:contract.id,
        contractVersionId:version.id, paymentTermsVersionId:terms.id, code:id('transition-confirm'),
        periodLabel:'并发确认验证', status:'effective', amountCents:3000n, payableAmountCents:3000n,
      }});
      const line = await tx.settlementLine.create({data:{
        id:id('settlement-line'), settlementId:settlement.id, contractBillRowId:row.id,
        sourceType:'contract_bill_row', name:'来源钢筋', unit:'t', quantity:'30', unitPriceCents:100n,
        amountCents:3000n, sortOrder:1,
      }});
      assert.equal(line.amountCents,settlement.payableAmountCents,'SETTLEMENT_FIXTURE_LINE_AMOUNT');
      assert.equal(settlement.paidAmountCents,0n,'SETTLEMENT_FIXTURE_PAID_AMOUNT');
      if (textDirect330) {
        await tx.paymentRequest.create({data:{
          id:id('historical-payment'), projectId:loan.sourceProjectId, settlementId:settlement.id,
          sourceType:'settlement', contractId:contract.id, contractVersionId:version.id, paymentTermsVersionId:terms.id,
          code:id('payment-request'), status:'approved_pending_payment', requestedAmountCents:3000n, approvedAmountCents:3000n,
          paymentSubjectType:'our_company',
        }});
      }
      return 'original-effective-3000-cent-fixture';
    });
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {seedSettlementHistory};
