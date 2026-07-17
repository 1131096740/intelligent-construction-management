-- 新零星采购真实表单不再转商户余额。少货多付仅可选择补货或全额退款；
-- 历史余额单据继续保留原状态与原 resolutionType，以支持历史查询。
ALTER TABLE "SpotProcurementDiscrepancy"
  DROP CONSTRAINT "SpotProcurementDiscrepancy_status_check",
  ADD CONSTRAINT "SpotProcurementDiscrepancy_status_check"
    CHECK (
      "status" IN (
        'pending_resolution',
        'awaiting_replenishment',
        'awaiting_refund',
        'awaiting_supplier_balance',
        'resolved',
        'invalidated'
      )
    ),
  DROP CONSTRAINT "SpotProcurementDiscrepancy_resolution_type_check",
  ADD CONSTRAINT "SpotProcurementDiscrepancy_resolution_type_check"
    CHECK (
      (
        "overpaidAmountCents" = 0
        AND "resolutionType" IS NULL
        AND "status" NOT IN (
          'awaiting_replenishment',
          'awaiting_refund',
          'awaiting_supplier_balance'
        )
      )
      OR (
        "overpaidAmountCents" > 0
        AND (
          (
            "resolutionType" = 'replenishment'
            AND "status" IN (
              'pending_resolution',
              'awaiting_replenishment',
              'resolved',
              'invalidated'
            )
          )
          OR (
            "resolutionType" = 'full_refund'
            AND "status" IN (
              'pending_resolution',
              'awaiting_refund',
              'resolved',
              'invalidated'
            )
          )
          OR (
            "resolutionType" = 'full_supplier_balance'
            AND "status" IN (
              'pending_resolution',
              'awaiting_supplier_balance',
              'resolved',
              'invalidated'
            )
          )
        )
      )
    ),
  DROP CONSTRAINT "SpotProcurementDiscrepancy_status_resolution_check",
  ADD CONSTRAINT "SpotProcurementDiscrepancy_status_resolution_check"
    CHECK (
      (
        "status" IN (
          'pending_resolution',
          'awaiting_replenishment',
          'awaiting_refund',
          'awaiting_supplier_balance'
        )
        AND "resolvedAt" IS NULL
        AND "resolvedByUserId" IS NULL
      )
      OR (
        "status" = 'resolved'
        AND "resolvedAt" IS NOT NULL
        AND "resolvedByUserId" IS NOT NULL
      )
      OR "status" = 'invalidated'
    );
