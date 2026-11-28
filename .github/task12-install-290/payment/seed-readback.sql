
      SELECT
        (
          SELECT COUNT(*)::text
          FROM "PaymentExecution"
          WHERE "id" = 'seed-payment-execution-fk-2026-006-001'
        )
        || '|' || (
          SELECT COUNT(*)::text
          FROM "ProjectFundingAllocation"
          WHERE "executionType" = 'payment_execution'
            AND "executionId" = 'seed-payment-execution-fk-2026-006-001'
        )
        || '|' || COALESCE((
          SELECT SUM("amountCents")::text
          FROM "ProjectFundingAllocation"
          WHERE "executionType" = 'payment_execution'
            AND "executionId" = 'seed-payment-execution-fk-2026-006-001'
            AND "direction" = 'debit'
            AND "reversalKey" = 'original'
        ), '0')
        || '|' || (
          SELECT COUNT(*)::text
          FROM "AuditLog"
          WHERE "action" = 'payment.execution.record'
            AND "businessType" = 'payment_request'
            AND "businessId" = 'seed-payment-request-fk-2026-006'
            AND "metadata"->>'executionId'
              = 'seed-payment-execution-fk-2026-006-001'
        )
        || '|' || CASE WHEN
          EXISTS (
            SELECT 1
            FROM "PaymentExecution"
            WHERE "id" = 'seed-payment-execution-fk-2026-006-001'
              AND "idempotencyKey"
                = 'b1111111-1111-4111-8111-111111111111'
              AND "paymentRequestId" = 'seed-payment-request-fk-2026-006'
              AND "settlementId" = 'seed-settlement-js-2026-018'
              AND "paymentSubjectType" = 'our_company'
              AND "companyEntityIdSnapshot" = 'seed-company-entity-jgzg'
              AND "companyEntityNameSnapshot" = '建工智管建设有限公司'
              AND "companyEntityCreditCodeSnapshot" = '91350211M000100Y46'
              AND "amountCents" = 12800000
              AND "executedByUserId" = 'seed-user-cashier'
              AND "voucherFileId" = 'seed-file-payment-voucher-fk-2026-006'
          )
          AND EXISTS (
            SELECT 1
            FROM "ProjectFundingAllocation"
            WHERE "id"
              = 'seed-project-funding-allocation-fk-2026-006-001'
              AND "projectId" = 'seed-project-jgxm-001'
              AND "executionType" = 'payment_execution'
              AND "executionId"
                = 'seed-payment-execution-fk-2026-006-001'
              AND "businessType" = 'payment_request'
              AND "businessId" = 'seed-payment-request-fk-2026-006'
              AND "sourceType" = 'project_cash'
              AND "sourceKey" = 'project_cash'
              AND "sourceId" IS NULL
              AND "direction" = 'debit'
              AND "amountCents" = 12800000
              AND "createdByUserId" = 'seed-user-cashier'
              AND "reversalOfAllocationId" IS NULL
              AND "reversalKey" = 'original'
          )
          AND EXISTS (
            SELECT 1
            FROM "AuditLog"
            WHERE "id" = 'seed-audit-payment-execution-fk-2026-006-001'
              AND "actorUserId" = 'seed-user-cashier'
              AND "action" = 'payment.execution.record'
              AND "businessType" = 'payment_request'
              AND "businessId" = 'seed-payment-request-fk-2026-006'
              AND "metadata"->>'amountCents' = '12800000'
              AND "metadata"->>'idempotencyKey'
                = 'b1111111-1111-4111-8111-111111111111'
              AND "metadata"->'funding'->>'projectCashAmountCents'
                = '12800000'
              AND "metadata"->'funding'->>'financingQuotaAmountCents'
                = '0'
          )
        THEN 'exact' ELSE 'drift' END;
