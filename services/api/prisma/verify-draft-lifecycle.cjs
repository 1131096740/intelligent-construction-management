const { PrismaClient } = require("@prisma/client");

const DATABASE_NAME = "jiangkong_draft_lifecycle_verify";
const EXPECTED_MIGRATION_COUNT = 72;
const LIFECYCLE_MIGRATIONS = [
  "20260719210000_contract_settlement_draft_lifecycle",
  "20260719211000_payment_spot_draft_lifecycle",
  "20260719212000_template_draft_lifecycle"
];

const EXPECTED_COLUMNS = {
  ContractVersion: ["abandonedAt", "abandonedByUserId", "abandonReason"],
  ContractTakeover: ["abandonedAt", "abandonedByUserId", "abandonReason"],
  ContractTaxFactRevision: ["abandonedAt", "abandonedByUserId", "abandonReason"],
  SettlementDraft: ["abandonedAt", "abandonedByUserId", "abandonReason"],
  PaymentRequest: ["abandonedAt", "abandonedByUserId", "abandonReason"],
  SpotProcurement: ["abandonedAt", "abandonedByUserId", "abandonReason"],
  SpotProcurementVersion: ["abandonedAt", "abandonedByUserId", "abandonReason"],
  SpotProcurementPayment: ["draftOrigin", "sourcePaymentId"],
  SpotProcurementReceipt: ["invalidatedAt", "invalidatedByUserId", "invalidationReason"],
  ContractBusinessTemplateVersion: ["discardedAt", "discardedByUserId", "discardReason"],
  StandardClauseVersion: ["discardedAt", "discardedByUserId", "discardReason"],
  ContractLayoutTemplateVersion: ["discardedAt", "discardedByUserId", "discardReason"],
  SettlementTemplateVersion: ["discardedAt", "discardedByUserId", "discardReason"]
};

const EXPECTED_CONSTRAINT_FRAGMENTS = {
  ContractVersion_status_check: "'abandoned'",
  ContractVersion_abandonment_facts_check: '"abandonedAt" IS NOT NULL',
  ContractTakeover_status_check: "'abandoned'",
  ContractTakeover_abandonment_facts_check: '"abandonedAt" IS NOT NULL',
  ContractTaxFactRevision_status_check: "'abandoned'",
  ContractTaxFactRevision_abandonment_facts_check: '"abandonedAt" IS NOT NULL',
  SettlementDraft_status_check: "'abandoned'",
  SettlementDraft_abandonment_facts_check: '"abandonedAt" IS NOT NULL',
  PaymentRequest_status_check: "'abandoned'",
  PaymentRequest_abandonment_facts_check: '"abandonedAt" IS NOT NULL',
  SpotProcurement_status_check: "'abandoned'",
  SpotProcurement_abandonment_facts_check: '"abandonedAt" IS NOT NULL',
  SpotProcurementVersion_status_check: "'abandoned'",
  SpotProcurementVersion_abandonment_facts_check: '"abandonedAt" IS NOT NULL',
  SpotProcurementReceipt_status_check: "'invalidated'",
  SpotProcurementReceipt_invalidation_facts_check: '"invalidatedAt" IS NOT NULL',
  SpotProcurementPayment_sourcePaymentId_fkey: "ON DELETE RESTRICT",
  ContractBusinessTemplateVersion_status_check: "'discarded'",
  ContractBusinessTemplateVersion_discard_facts_check: '"discardedAt" IS NOT NULL',
  StandardClauseVersion_status_check: "'discarded'",
  StandardClauseVersion_discard_facts_check: '"discardedAt" IS NOT NULL',
  ContractLayoutTemplateVersion_status_check: "'discarded'",
  ContractLayoutTemplateVersion_discard_facts_check: '"discardedAt" IS NOT NULL',
  SettlementTemplateVersion_status_check: "'discarded'",
  SettlementTemplateVersion_discard_facts_check: '"discardedAt" IS NOT NULL'
};

const EXPECTED_INDEXES = [
  "ContractVersion_status_updatedAt_idx",
  "ContractTakeover_takeoverStatus_updatedAt_idx",
  "ContractTaxFactRevision_status_updatedAt_idx",
  "SettlementDraft_status_updatedAt_idx",
  "PaymentRequest_status_updatedAt_idx",
  "SpotProcurement_status_updatedAt_idx",
  "SpotProcurementVersion_status_updatedAt_idx",
  "SpotProcurementPayment_sourcePaymentId_idx",
  "SpotProcurementReceipt_status_updatedAt_idx",
  "ContractBusinessTemplateVersion_status_updatedAt_idx",
  "StandardClauseVersion_status_updatedAt_idx",
  "ContractLayoutTemplateVersion_status_updatedAt_idx",
  "SettlementTemplateVersion_status_updatedAt_idx"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDedicatedLocalDatabase(databaseUrl, options = {}) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("草稿生命周期验证 DATABASE_URL 不是有效 URL");
  }
  assert(
    parsed.protocol === "postgresql:" || parsed.protocol === "postgres:",
    "草稿生命周期验证只允许 PostgreSQL"
  );
  assert(
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname),
    "草稿生命周期验证拒绝连接非本机数据库"
  );
  const isDedicatedLocalDatabase = parsed.pathname === `/${DATABASE_NAME}`;
  const isExplicitRestoreDatabase =
    options.allowIsolatedRestore === true &&
    /^\/jiangkong_restore_[a-z0-9_]+$/u.test(parsed.pathname);
  assert(
    isDedicatedLocalDatabase || isExplicitRestoreDatabase,
    "草稿生命周期验证只允许固定的一次性隔离数据库"
  );
  return { isDedicatedLocalDatabase, isExplicitRestoreDatabase };
}

function normalizeSnapshot(rows) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "bigint" ? value.toString() : value
      ])
    )
  );
}

async function readBusinessSnapshot(client) {
  const rows = await client.$queryRawUnsafe(`
    SELECT 'Contract' AS entity, count(*)::bigint AS count, 0::numeric AS "moneyDigest" FROM "Contract"
    UNION ALL SELECT 'Settlement', count(*)::bigint,
      COALESCE(sum("amountCents" + "payableAmountCents" + "paidAmountCents"), 0)::numeric FROM "Settlement"
    UNION ALL SELECT 'PaymentRequest', count(*)::bigint,
      COALESCE(sum("requestedAmountCents" + COALESCE("approvedAmountCents", 0) + "paidAmountCents"), 0)::numeric FROM "PaymentRequest"
    UNION ALL SELECT 'PaymentExecution', count(*)::bigint,
      COALESCE(sum("amountCents"), 0)::numeric FROM "PaymentExecution"
    UNION ALL SELECT 'SpotProcurement', count(*)::bigint,
      COALESCE(sum(COALESCE("actualCostCents", 0)), 0)::numeric FROM "SpotProcurement"
    UNION ALL SELECT 'SpotProcurementReceipt', count(*)::bigint,
      COALESCE(sum("actualCostCents"), 0)::numeric FROM "SpotProcurementReceipt"
    UNION ALL SELECT 'SpotProcurementRefund', count(*)::bigint,
      COALESCE(sum("amountCents"), 0)::numeric FROM "SpotProcurementRefund"
    UNION ALL SELECT 'FileObject', count(*)::bigint, 0::numeric FROM "FileObject"
    UNION ALL SELECT 'AuditLog', count(*)::bigint, 0::numeric FROM "AuditLog"
    ORDER BY entity
  `);
  return normalizeSnapshot(rows);
}

function normalizeProbeFacts({ contract, payment, template }) {
  return {
    contract: {
      id: contract.id,
      status: contract.status,
      amountCents: contract.amountCents.toString(),
      abandonedAt: contract.abandonedAt?.toISOString() ?? null,
      abandonedByUserId: contract.abandonedByUserId,
      abandonReason: contract.abandonReason
    },
    payment: {
      id: payment.id,
      status: payment.status,
      requestedAmountCents: payment.requestedAmountCents.toString(),
      approvedAmountCents: payment.approvedAmountCents?.toString() ?? null,
      paidAmountCents: payment.paidAmountCents.toString(),
      abandonedAt: payment.abandonedAt?.toISOString() ?? null,
      abandonedByUserId: payment.abandonedByUserId,
      abandonReason: payment.abandonReason
    },
    template: {
      id: template.id,
      status: template.status,
      discardedAt: template.discardedAt?.toISOString() ?? null,
      discardedByUserId: template.discardedByUserId,
      discardReason: template.discardReason
    }
  };
}

async function readProbeFacts(client) {
  const [contract, payment, template] = await Promise.all([
    client.contractVersion.findFirst({ orderBy: { createdAt: "asc" } }),
    client.paymentRequest.findFirst({ orderBy: { createdAt: "asc" } }),
    client.contractBusinessTemplateVersion.findFirst({ orderBy: { createdAt: "asc" } })
  ]);
  assert(contract && payment && template, "回滚探针需要本地 seed 的合同、付款和模板事实");
  return normalizeProbeFacts({ contract, payment, template });
}

async function verifyReadOnly(client) {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");

    const migrations = await tx.$queryRawUnsafe(`
      SELECT migration_name
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name
    `);
    assert(
      migrations.length === EXPECTED_MIGRATION_COUNT,
      `必须完整应用 ${EXPECTED_MIGRATION_COUNT} 个迁移，实际 ${migrations.length}`
    );
    const migrationNames = new Set(migrations.map((row) => row.migration_name));
    for (const name of LIFECYCLE_MIGRATIONS) {
      assert(migrationNames.has(name), `缺少草稿生命周期迁移 ${name}`);
    }

    const columnRows = await tx.$queryRawUnsafe(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `);
    const columnKeys = new Set(
      columnRows.map((row) => `${row.table_name}.${row.column_name}`)
    );
    for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
      for (const column of columns) {
        assert(columnKeys.has(`${table}.${column}`), `缺少字段 ${table}.${column}`);
      }
    }

    const constraintRows = await tx.$queryRawUnsafe(`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = current_schema()::regnamespace
    `);
    const constraints = new Map(
      constraintRows.map((row) => [row.conname, row.definition])
    );
    for (const [name, fragment] of Object.entries(EXPECTED_CONSTRAINT_FRAGMENTS)) {
      const definition = constraints.get(name);
      assert(definition, `缺少约束 ${name}`);
      assert(definition.includes(fragment), `约束 ${name} 缺少 ${fragment}`);
    }

    const indexRows = await tx.$queryRawUnsafe(`
      SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()
    `);
    const indexes = new Set(indexRows.map((row) => row.indexname));
    for (const name of EXPECTED_INDEXES) {
      assert(indexes.has(name), `缺少索引 ${name}`);
    }

    const invalidFacts = await tx.$queryRawUnsafe(`
      SELECT
        (SELECT count(*) FROM "ContractVersion" WHERE "status" = 'abandoned' AND ("abandonedAt" IS NULL OR "abandonedByUserId" IS NULL)) +
        (SELECT count(*) FROM "ContractTakeover" WHERE "takeoverStatus" = 'abandoned' AND ("abandonedAt" IS NULL OR "abandonedByUserId" IS NULL)) +
        (SELECT count(*) FROM "ContractTaxFactRevision" WHERE "status" = 'abandoned' AND ("abandonedAt" IS NULL OR "abandonedByUserId" IS NULL)) +
        (SELECT count(*) FROM "SettlementDraft" WHERE "status" = 'abandoned' AND ("abandonedAt" IS NULL OR "abandonedByUserId" IS NULL)) +
        (SELECT count(*) FROM "PaymentRequest" WHERE "status" = 'abandoned' AND ("abandonedAt" IS NULL OR "abandonedByUserId" IS NULL)) +
        (SELECT count(*) FROM "SpotProcurement" WHERE "status" = 'abandoned' AND ("abandonedAt" IS NULL OR "abandonedByUserId" IS NULL)) +
        (SELECT count(*) FROM "SpotProcurementVersion" WHERE "status" = 'abandoned' AND ("abandonedAt" IS NULL OR "abandonedByUserId" IS NULL)) +
        (SELECT count(*) FROM "SpotProcurementReceipt" WHERE "status" = 'invalidated' AND ("invalidatedAt" IS NULL OR "invalidatedByUserId" IS NULL OR "invalidationReason" IS NULL)) +
        (SELECT count(*) FROM "ContractBusinessTemplateVersion" WHERE "status" = 'discarded' AND ("discardedAt" IS NULL OR "discardedByUserId" IS NULL)) +
        (SELECT count(*) FROM "StandardClauseVersion" WHERE "status" = 'discarded' AND ("discardedAt" IS NULL OR "discardedByUserId" IS NULL)) +
        (SELECT count(*) FROM "ContractLayoutTemplateVersion" WHERE "status" = 'discarded' AND ("discardedAt" IS NULL OR "discardedByUserId" IS NULL)) +
        (SELECT count(*) FROM "SettlementTemplateVersion" WHERE "status" = 'discarded' AND ("discardedAt" IS NULL OR "discardedByUserId" IS NULL))
        AS count
    `);
    assert(BigInt(invalidFacts[0].count) === 0n, "存在缺少必要操作事实的结束记录");

    return readBusinessSnapshot(tx);
  });
}

async function verifyRollbackProbe(client) {
  const before = await verifyReadOnly(client);
  const probeFactsBefore = await readProbeFacts(client);
  const rollbackSignal = new Error("ROLLBACK_DRAFT_LIFECYCLE_PROBE");
  try {
    await client.$transaction(async (tx) => {
      const [contract, payment, template] = await Promise.all([
        tx.contractVersion.findUnique({ where: { id: probeFactsBefore.contract.id } }),
        tx.paymentRequest.findUnique({ where: { id: probeFactsBefore.payment.id } }),
        tx.contractBusinessTemplateVersion.findUnique({
          where: { id: probeFactsBefore.template.id }
        })
      ]);
      assert(contract && payment && template, "回滚探针目标在事务开始前发生变化");
      const contractAmount = contract.amountCents;
      const paymentAmounts = [
        payment.requestedAmountCents,
        payment.approvedAmountCents,
        payment.paidAmountCents
      ];
      const now = new Date();
      const actor = "seed-user-contract-staff";

      const changedContract = await tx.contractVersion.update({
        where: { id: contract.id },
        data: {
          status: "abandoned",
          abandonedAt: now,
          abandonedByUserId: actor,
          abandonReason: "本地隔离库强制回滚探针"
        }
      });
      const changedPayment = await tx.paymentRequest.update({
        where: { id: payment.id },
        data: {
          status: "abandoned",
          abandonedAt: now,
          abandonedByUserId: actor,
          abandonReason: "本地隔离库强制回滚探针"
        }
      });
      await tx.contractBusinessTemplateVersion.update({
        where: { id: template.id },
        data: {
          status: "discarded",
          discardedAt: now,
          discardedByUserId: actor,
          discardReason: "本地隔离库强制回滚探针"
        }
      });

      assert(changedContract.amountCents === contractAmount, "合同结束探针改写了金额");
      assert(
        changedPayment.requestedAmountCents === paymentAmounts[0] &&
          changedPayment.approvedAmountCents === paymentAmounts[1] &&
          changedPayment.paidAmountCents === paymentAmounts[2],
        "付款结束探针改写了金额"
      );
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) throw error;
  }

  const after = await verifyReadOnly(client);
  const probeFactsAfter = await readProbeFacts(client);
  assert(
    JSON.stringify(after) === JSON.stringify(before),
    "回滚探针后正式表计数或金额摘要发生变化"
  );
  assert(
    JSON.stringify(probeFactsAfter) === JSON.stringify(probeFactsBefore),
    "回滚探针后生命周期状态、操作事实或金额字段发生变化"
  );
  return after;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const allowIsolatedRestore = process.argv.includes("--allow-isolated-restore");
  const runtime = assertDedicatedLocalDatabase(databaseUrl, { allowIsolatedRestore });
  assert(
    !(process.argv.includes("--probe-rollback") && runtime.isExplicitRestoreDatabase),
    "隔离恢复库只允许读验证，拒绝运行回滚写探针"
  );
  const prisma = new PrismaClient();
  try {
    const snapshot = process.argv.includes("--probe-rollback")
      ? await verifyRollbackProbe(prisma)
      : await verifyReadOnly(prisma);
    console.log(
      `ok draft lifecycle: ${EXPECTED_MIGRATION_COUNT} migrations, schema constraints and indexes verified`
    );
    console.log(`ok formal facts unchanged: ${JSON.stringify(snapshot)}`);
    console.log(
      process.argv.includes("--probe-rollback")
        ? "ok local synthetic lifecycle probe rolled back completely"
        : "ok verification ran in an explicit read-only transaction"
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DATABASE_NAME,
  EXPECTED_MIGRATION_COUNT,
  LIFECYCLE_MIGRATIONS,
  assertDedicatedLocalDatabase,
  normalizeSnapshot,
  normalizeProbeFacts,
  verifyReadOnly,
  verifyRollbackProbe
};
