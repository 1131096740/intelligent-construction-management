BEGIN;

LOCK TABLE "SpotProcurementRefund" IN SHARE MODE;
LOCK TABLE "ProjectFundingAllocation" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  refund_row RECORD;
  candidate RECORD;
  reversal_key TEXT;
  existing_reversal_cents BIGINT;
  remaining_cents BIGINT;
  reversal_cents BIGINT;
  inserted_count INTEGER;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SpotProcurementRefund" source
    LEFT JOIN "SpotProcurementDiscrepancy" discrepancy
      ON discrepancy."id" = source."discrepancyId"
    LEFT JOIN "SpotProcurement" procurement
      ON procurement."id" = source."procurementId"
    WHERE source."amountCents" <= 0
      OR discrepancy."id" IS NULL
      OR procurement."id" IS NULL
      OR discrepancy."procurementId" <> source."procurementId"
      OR discrepancy."projectId" <> procurement."projectId"
  ) THEN
    RAISE EXCEPTION '历史供应商退款坐标或金额无效';
  END IF;

  FOR refund_row IN
    SELECT
      source."id" AS "refundId",
      source."procurementId",
      discrepancy."procurementVersionId",
      procurement."projectId",
      source."amountCents",
      source."receivedAt",
      source."recordedByUserId"
    FROM "SpotProcurementRefund" source
    JOIN "SpotProcurementDiscrepancy" discrepancy
      ON discrepancy."id" = source."discrepancyId"
    JOIN "SpotProcurement" procurement
      ON procurement."id" = source."procurementId"
    ORDER BY source."receivedAt", source."id"
  LOOP
    reversal_key := 'spot-refund:' || refund_row."refundId";

    SELECT COALESCE(SUM(allocation."amountCents"), 0)
    INTO existing_reversal_cents
    FROM "ProjectFundingAllocation" allocation
    WHERE allocation."projectId" = refund_row."projectId"
      AND allocation."executionType" =
        'spot_procurement_payment_execution'
      AND allocation."direction" = 'credit'
      AND allocation."reversalKey" = reversal_key;

    IF existing_reversal_cents > refund_row."amountCents" THEN
      RAISE EXCEPTION
        '历史供应商退款资金反向分配总额不一致: %=%/%',
        refund_row."refundId",
        existing_reversal_cents,
        refund_row."amountCents";
    END IF;

    remaining_cents :=
      refund_row."amountCents" - existing_reversal_cents;

    WHILE remaining_cents > 0 LOOP
      candidate := NULL;
      SELECT
        debit.*,
        debit."amountCents" -
          COALESCE(SUM(credit."amountCents"), 0)
          AS "availableCents"
      INTO candidate
      FROM "SpotProcurementPayment" payment
      JOIN "SpotProcurementPaymentExecution" execution
        ON execution."paymentId" = payment."id"
        AND execution."voidedAt" IS NULL
      JOIN "ProjectFundingAllocation" debit
        ON debit."executionType" =
          'spot_procurement_payment_execution'
        AND debit."executionId" = execution."id"
        AND debit."direction" = 'debit'
        AND debit."reversalKey" = 'original'
      LEFT JOIN "ProjectFundingAllocation" credit
        ON credit."reversalOfAllocationId" = debit."id"
        AND credit."direction" = 'credit'
      WHERE payment."procurementId" = refund_row."procurementId"
        AND payment."procurementVersionId" =
          refund_row."procurementVersionId"
        AND debit."projectId" = refund_row."projectId"
      GROUP BY
        debit."id",
        execution."paidAt",
        execution."id"
      HAVING debit."amountCents" >
        COALESCE(SUM(credit."amountCents"), 0)
      ORDER BY
        execution."paidAt" DESC,
        execution."id" DESC,
        CASE
          WHEN debit."sourceType" = 'financing_quota'
            THEN 0
          ELSE 1
        END,
        debit."sourceKey" DESC
      LIMIT 1;

      IF candidate."id" IS NULL THEN
        RAISE EXCEPTION
          '历史供应商退款超过可反向的实际付款资金: % 仍缺 % 分',
          refund_row."refundId",
          remaining_cents;
      END IF;

      reversal_cents := LEAST(
        remaining_cents,
        candidate."availableCents"
      );

      INSERT INTO "ProjectFundingAllocation" (
        "id",
        "projectId",
        "executionType",
        "executionId",
        "businessType",
        "businessId",
        "sourceType",
        "sourceKey",
        "sourceId",
        "direction",
        "amountCents",
        "occurredAt",
        "createdByUserId",
        "reversalOfAllocationId",
        "reversalKey",
        "reason",
        "createdAt"
      )
      VALUES (
        'pf-refund-backfill-' || MD5(
          refund_row."refundId" || ':' || candidate."id"
        ),
        candidate."projectId",
        candidate."executionType",
        candidate."executionId",
        candidate."businessType",
        candidate."businessId",
        candidate."sourceType",
        candidate."sourceKey",
        candidate."sourceId",
        'credit',
        reversal_cents,
        refund_row."receivedAt",
        refund_row."recordedByUserId",
        candidate."id",
        reversal_key,
        '历史零星采购供应商退款到账前向桥接',
        refund_row."receivedAt"
      )
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      IF inserted_count <> 1 THEN
        RAISE EXCEPTION
          '历史供应商退款反向流水发生唯一冲突: %/%',
          refund_row."refundId",
          candidate."id";
      END IF;
      remaining_cents := remaining_cents - reversal_cents;
    END LOOP;

    SELECT COALESCE(SUM(allocation."amountCents"), 0)
    INTO existing_reversal_cents
    FROM "ProjectFundingAllocation" allocation
    WHERE allocation."projectId" = refund_row."projectId"
      AND allocation."executionType" =
        'spot_procurement_payment_execution'
      AND allocation."direction" = 'credit'
      AND allocation."reversalKey" = reversal_key;

    IF existing_reversal_cents <> refund_row."amountCents" THEN
      RAISE EXCEPTION
        '历史供应商退款资金反向分配总额不一致: %=%/%',
        refund_row."refundId",
        existing_reversal_cents,
        refund_row."amountCents";
    END IF;
  END LOOP;
END
$$;

COMMIT;
