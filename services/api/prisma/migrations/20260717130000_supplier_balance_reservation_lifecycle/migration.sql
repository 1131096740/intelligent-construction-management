ALTER TABLE "SupplierBalanceReservation"
  ADD COLUMN "releasedAmountCents" BIGINT NOT NULL DEFAULT 0;

-- 经办人先冻结整笔多付处置选择，物资主管再确认差异。
-- 因此真实多付在 pending_resolution 阶段已经必须携带 resolutionType。
ALTER TABLE "SpotProcurementDiscrepancy"
  DROP CONSTRAINT "SpotProcurementDiscrepancy_resolution_type_check",
  ADD CONSTRAINT "SpotProcurementDiscrepancy_resolution_type_check"
    CHECK (
      (
        "overpaidAmountCents" = 0
        AND "resolutionType" IS NULL
        AND "status" NOT IN ('awaiting_refund', 'awaiting_supplier_balance')
      )
      OR (
        "overpaidAmountCents" > 0
        AND (
          (
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
    );

-- Older full releases predate partial-release accounting. Preserve their
-- terminal fact by backfilling the original reserved amount as fully released.
UPDATE "SupplierBalanceReservation"
SET "releasedAmountCents" = "amountCents"
WHERE "status" = 'released';

ALTER TABLE "SupplierBalanceReservation"
  ADD CONSTRAINT "SupplierBalanceReservation_released_amount_range_check"
    CHECK (
      "releasedAmountCents" >= 0
      AND "releasedAmountCents" <= "amountCents"
    ),
  ADD CONSTRAINT "SupplierBalanceReservation_status_check"
    CHECK ("status" IN ('reserved', 'released', 'executed')),
  ADD CONSTRAINT "SupplierBalanceReservation_lifecycle_check"
    CHECK (
      (
        "status" = 'reserved'
        AND "releasedAmountCents" < "amountCents"
        AND "executedAt" IS NULL
        AND "executedByUserId" IS NULL
        AND (
          (
            "releasedAmountCents" = 0
            AND "releasedAt" IS NULL
            AND "releasedByUserId" IS NULL
            AND "releaseReason" IS NULL
          )
          OR (
            "releasedAmountCents" > 0
            AND "releasedAt" IS NOT NULL
            AND "releasedByUserId" IS NOT NULL
            AND NULLIF(BTRIM("releaseReason"), '') IS NOT NULL
          )
        )
      )
      OR (
        "status" = 'released'
        AND "releasedAmountCents" = "amountCents"
        AND "releasedAt" IS NOT NULL
        AND "releasedByUserId" IS NOT NULL
        AND NULLIF(BTRIM("releaseReason"), '') IS NOT NULL
        AND "executedAt" IS NULL
        AND "executedByUserId" IS NULL
      )
      OR (
        "status" = 'executed'
        AND "releasedAmountCents" < "amountCents"
        AND "executedAt" IS NOT NULL
        AND "executedByUserId" IS NOT NULL
        AND (
          (
            "releasedAmountCents" = 0
            AND "releasedAt" IS NULL
            AND "releasedByUserId" IS NULL
            AND "releaseReason" IS NULL
          )
          OR (
            "releasedAmountCents" > 0
            AND "releasedAt" IS NOT NULL
            AND "releasedByUserId" IS NOT NULL
            AND NULLIF(BTRIM("releaseReason"), '') IS NOT NULL
          )
        )
      )
    );

ALTER TABLE "SupplierBalanceEntry"
  ADD CONSTRAINT "SupplierBalanceEntry_entry_type_check"
    CHECK (
      "entryType" IN (
        'reserve',
        'release',
        'partial_release',
        'credit_from_discrepancy',
        'execute'
      )
    );
