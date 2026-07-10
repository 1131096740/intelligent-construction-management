const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const {
  PRECISION_SENTINEL_CENTS,
  TARGET_CONTRACT_CENTS,
  assertLocalMoneyVerificationRuntime,
  assertMoneyBigintSchemaRows
} = require("../dist/database/money-bigint-live-verification");

const databaseUrl = process.env.DATABASE_URL ?? "";
const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3000";
const prisma = new PrismaClient();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBigint(actual, expected, label) {
  assert(typeof actual === "bigint", `${label} 必须由 Prisma 读取为 bigint`);
  assert(actual === expected, `${label} 精度不一致：预期 ${expected}，实际 ${actual}`);
}

async function verifyMigrationAndSchema() {
  const migration = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    WHERE migration_name = '20260710153000_money_bigint'
  `;
  assert(migration.length === 1, "临时数据库未应用 20260710153000_money_bigint");
  assert(migration[0].finished_at && !migration[0].rolled_back_at, "money bigint 迁移未成功完成");

  const rows = await prisma.$queryRaw`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name LIKE '%Cents'
  `;
  assertMoneyBigintSchemaRows(rows);
  console.log("ok money bigint schema: 21/21 columns are bigint with expected defaults/nullability");
}

async function verifyCoreFlowPersistence() {
  const payment = await prisma.paymentRequest.findFirst({
    where: { code: { startsWith: "FK-P1-" }, status: "paid" },
    orderBy: { createdAt: "desc" }
  });
  assert(payment, "未找到 verify-core-flow 生成的大额已付款申请");

  const [version, settlement, executions, financeRecords] = await Promise.all([
    prisma.contractVersion.findUnique({ where: { id: payment.contractVersionId } }),
    payment.settlementId
      ? prisma.settlement.findUnique({ where: { id: payment.settlementId } })
      : null,
    prisma.paymentExecution.findMany({
      where: { paymentRequestId: payment.id },
      orderBy: { paidAt: "asc" }
    }),
    prisma.financeRecord.findMany({ where: { paymentRequestId: payment.id } })
  ]);
  const target = BigInt(TARGET_CONTRACT_CENTS);
  assert(version, "大额付款未关联合同版本");
  assert(settlement, "大额付款未关联结算");
  assertBigint(version.amountCents, target, "合同金额");
  assertBigint(settlement.amountCents, target, "结算金额");
  assertBigint(settlement.payableAmountCents, target, "结算可付金额");
  assertBigint(settlement.paidAmountCents, target, "结算累计实付金额");
  assertBigint(payment.requestedAmountCents, target, "付款申请金额");
  assertBigint(payment.approvedAmountCents, target, "付款批准金额");
  assertBigint(payment.paidAmountCents, target, "付款累计实付金额");
  assert(executions.length === 2, `大额付款必须有两次实付，实际 ${executions.length}`);
  assertBigint(
    executions.reduce((sum, execution) => sum + execution.amountCents, 0n),
    target,
    "两次实付合计"
  );
  assertBigint(
    financeRecords.reduce((sum, record) => sum + record.amountCents, 0n),
    target,
    "财务入账合计"
  );
  console.log("ok money bigint core persistence: contract -> settlement -> payment -> 2 executions -> finance");
}

async function verifyPrecisionAndRollback() {
  const runId = `money-bigint-${randomUUID()}`;
  const rollbackSignal = new Error("ROLLBACK_MONEY_BIGINT_VERIFICATION");

  try {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.projectExpenseRequest.create({
        data: {
          id: `${runId}-expense`,
          projectId: "seed-project-jgxm-001",
          code: `BX-${runId}`,
          expenseType: "reimbursement",
          expenseSubtype: "reimbursement",
          paymentSubject: "大额金额事务回滚验收",
          reason: "只写入一次性临时数据库并强制回滚",
          requestedAmountCents: BigInt(PRECISION_SENTINEL_CENTS),
          approvedAmountCents: BigInt(PRECISION_SENTINEL_CENTS),
          paymentMethod: "bank_transfer",
          handlerUserId: "seed-user-contract-staff",
          applicantUserId: "seed-user-contract-staff",
          status: "approved_pending_payment"
        }
      });
      assertBigint(
        expense.requestedAmountCents,
        BigInt(PRECISION_SENTINEL_CENTS),
        "报销/零采精度哨兵"
      );

      const flow = await tx.approvalFlow.create({
        data: { id: `${runId}-flow`, type: "money_bigint_verify", name: "大额金额阈值回滚验收" }
      });
      const node = await tx.approvalFlowNode.create({
        data: {
          id: `${runId}-node`,
          flowId: flow.id,
          sortOrder: 1,
          name: "大额金额阈值",
          mode: "any",
          roleKeys: ["chairman"],
          minAmountCents: BigInt(TARGET_CONTRACT_CENTS),
          maxAmountCents: BigInt(PRECISION_SENTINEL_CENTS)
        }
      });
      assertBigint(node.minAmountCents, BigInt(TARGET_CONTRACT_CENTS), "审批最小金额阈值");
      assertBigint(node.maxAmountCents, BigInt(PRECISION_SENTINEL_CENTS), "审批最大金额阈值");
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) throw error;
  }

  const [expenseCount, flowCount, nodeCount] = await Promise.all([
    prisma.projectExpenseRequest.count({ where: { id: `${runId}-expense` } }),
    prisma.approvalFlow.count({ where: { id: `${runId}-flow` } }),
    prisma.approvalFlowNode.count({ where: { id: `${runId}-node` } })
  ]);
  assert(expenseCount + flowCount + nodeCount === 0, "失败路径未完整回滚临时验收数据");
  console.log("ok precision sentinel and rollback: 9007199254740993 preserved, 0 rows remain");
}

async function main() {
  assertLocalMoneyVerificationRuntime({
    databaseUrl,
    apiBaseUrl,
    storageDriver: process.env.FILE_STORAGE_DRIVER ?? "local"
  });
  await verifyMigrationAndSchema();
  await verifyCoreFlowPersistence();
  await verifyPrecisionAndRollback();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
