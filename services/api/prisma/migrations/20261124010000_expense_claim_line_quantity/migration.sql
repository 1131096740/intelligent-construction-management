-- #404 EXP-02：报销明细新增“数量（可空）”。
-- 精度依据技术方案 D02：新协议数量/单价最多 4 位，金额/单价/数量建议 numeric(24,4)。
-- 既有数量列（SettlementLine、SpotProcurementLine、ActualPurchaseBatchLine 等）是
-- 历史 numeric(24,6)，本迁移不回填、不缩小、不改写任何历史值，也没有默认值。
ALTER TABLE "ExpenseClaimLine" ADD COLUMN "quantity" DECIMAL(24,4);

-- ENFORCEMENT-BEGIN
-- 数量可空（NULL 不是 0）；有值时必须是正数，最多 4 位小数，禁止隐式截断。
-- 该段可在 `prisma db push` 建列后单独重放，用于真实数据库约束证据。
ALTER TABLE "ExpenseClaimLine"
  ADD CONSTRAINT "ExpenseClaimLine_quantity_positive_check"
  CHECK ("quantity" IS NULL OR "quantity" > 0);

COMMENT ON COLUMN "ExpenseClaimLine"."quantity" IS '费用明细数量，可空；有值时为正数且最多 4 位小数（D02 新精度协议）';
