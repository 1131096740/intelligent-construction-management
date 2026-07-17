-- Task 2 已预建异常终止事实表；本迁移补齐其状态机约束，防止确认和驳回字段混写。
ALTER TABLE "SpotProcurementAbnormalTermination"
  ADD CONSTRAINT "SpotProcurementAbnormalTermination_status_check"
    CHECK ("status" IN ('requested', 'confirmed', 'rejected')),
  ADD CONSTRAINT "SpotProcurementAbnormalTermination_lifecycle_check"
    CHECK (
      (
        "status" = 'requested'
        AND "confirmedAt" IS NULL
        AND "confirmedByUserId" IS NULL
        AND "rejectedAt" IS NULL
        AND "rejectedByUserId" IS NULL
        AND "rejectionReason" IS NULL
      )
      OR (
        "status" = 'confirmed'
        AND "confirmedAt" IS NOT NULL
        AND "confirmedByUserId" IS NOT NULL
        AND "rejectedAt" IS NULL
        AND "rejectedByUserId" IS NULL
        AND "rejectionReason" IS NULL
      )
      OR (
        "status" = 'rejected'
        AND "confirmedAt" IS NULL
        AND "confirmedByUserId" IS NULL
        AND "rejectedAt" IS NOT NULL
        AND "rejectedByUserId" IS NOT NULL
        AND "rejectionReason" IS NOT NULL
      )
    );
