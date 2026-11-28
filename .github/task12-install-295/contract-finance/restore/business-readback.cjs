'use strict';

const assert = require('node:assert/strict');

function readBusinessHistory(read) {
  return JSON.parse(read(`
    WITH bank AS (
      SELECT r.id, o.id AS observation, o."amountCents" AS amount, o.direction, o."occurredAt"
      FROM public."ContractBankVerificationRequest" r
      JOIN public."VerifiedBankTransactionObservation" o ON o.id = r."observationId"
      WHERE r.status = 'confirmed'
        AND r."amountCents" = o."amountCents" AND r.direction = o.direction
        AND r."companyEntityId" = o."holderCompanyEntityId"
    ), loans AS (
      SELECT t.id, public.company_transfer_debt_limit(t, NULL::timestamp) AS available
      FROM public."CompanyTransfer" t
      WHERE t.kind = 'loan' AND EXISTS (
        SELECT FROM public."CompanyTransferEvent" e
        JOIN public."CompanyTransferBankClaim" c
          ON c."eventId" = e.id AND c."observationId" = e."observationId"
        WHERE e."transferId" = t.id AND e.kind = 'outgoing'
      ) AND EXISTS (
        SELECT FROM public."CompanyTransferEvent" e
        JOIN public."CompanyTransferBankClaim" c
          ON c."eventId" = e.id AND c."observationId" = e."observationId"
        WHERE e."transferId" = t.id AND e.kind = 'incoming'
      )
    ), settlements AS (
      SELECT s.id, s.status, s."amountCents", s."payableAmountCents", s."paidAmountCents",
        v.version_no, l."amountCents" AS "lineAmount"
      FROM public."Settlement" s
      JOIN (SELECT id, "contractId", status, "versionNo" AS version_no FROM public."ContractVersion") v
        ON v.id = s."contractVersionId" AND v."contractId" = s."contractId"
      JOIN public."PaymentTermsVersion" t ON t.id = s."paymentTermsVersionId"
        AND t."contractVersionId" = v.id
      JOIN public."SettlementLine" l ON l."settlementId" = s.id
      JOIN public."ContractBillRow" r ON r.id = l."contractBillRowId"
      JOIN public."ContractBill" b ON b.id = r."contractBillId" AND b."contractVersionId" = v.id
      WHERE s."amountCents" = 3000 AND s."payableAmountCents" = 3000
        AND l."amountCents" = 3000 AND s."paidAmountCents" = 0
        AND s.status = 'effective' AND v.status = 'effective' AND t.status = 'effective'
    ), corrections AS (
      SELECT r.id, r."previousRegistrationId", previous."balanceYuan", a.id AS round,
        a."currentNodeIndex", a."frozenNodes"
      FROM public."FundAccountBalanceRegistration" r
      JOIN public."FundAccountBalanceRegistration" previous
        ON previous.id = r."previousRegistrationId" AND previous."accountId" = r."accountId"
      JOIN public."ApprovalInstance" a ON a.id = r."approvalInstanceId" AND a."businessId" = r.id
      WHERE r.kind = 'correction' AND r.status = 'pending_review'
        AND previous.status = 'confirmed'
        AND a."businessType" = 'fund_account_balance_registration'
        AND a."flowType" = 'fund_account_balance_correction' AND a.status = 'approval_pending'
    )
    SELECT jsonb_build_object(
      'historicalBank',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM bank t),
      'oldDebt',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM loans t),
      'settlement',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM settlements t),
      'pendingCorrection',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM corrections t));
  `));
}

function validateHistory(history, expected) {
  const fields = ['historicalBank', 'oldDebt', 'settlement', 'pendingCorrection'];
  assert.deepEqual(Object.keys(history).sort(), fields.toSorted(), 'BACKUP292_BUSINESS_READBACK_SHAPE');
  assert.ok(fields.every(field => Array.isArray(history[field]) && history[field].length > 0),
    'BACKUP292_POSITIVE_BUSINESS_READBACK_REQUIRED');
  if (expected && JSON.stringify(history) !== JSON.stringify(expected))
    throw new Error('BACKUP292_BUSINESS_READBACK_CHANGED');
  return Object.fromEntries(fields.map(field => [field, true]));
}

module.exports = {readBusinessHistory, validateHistory};
