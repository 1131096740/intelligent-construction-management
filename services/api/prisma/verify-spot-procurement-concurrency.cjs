const { createHash } = require("node:crypto");
const { ConflictException } = require("@nestjs/common");
const { Prisma, PrismaClient } = require("@prisma/client");
const { AuditService } = require("../dist/audit/audit.service");
const {
  acquireFileBusinessBindingTransactionLock,
  hasNonReceiptBusinessFileBinding
} = require("../dist/file/file-business-binding");
const {
  SpotProcurementBalanceService
} = require("../dist/spot-procurement/spot-procurement-balance.service");
const {
  SpotProcurementApplicationService
} = require("../dist/spot-procurement/spot-procurement-application.service");
const {
  SpotProcurementClosureService
} = require("../dist/spot-procurement/spot-procurement-closure.service");
const {
  InvoiceLedgerService
} = require("../dist/invoice-ledger/invoice-ledger.service");
const {
  ProjectFundingAvailabilityService
} = require("../dist/project-funding/project-funding-availability.service");
const {
  SpotProcurementPaymentService
} = require("../dist/spot-procurement/spot-procurement-payment.service");
const {
  SpotProcurementPilotService
} = require("../dist/spot-procurement/spot-procurement-pilot.service");
const {
  SpotProcurementReceiptService
} = require("../dist/spot-procurement/spot-procurement-receipt.service");
const {
  SpotProcurementReceiptPdfService
} = require("../dist/spot-procurement/spot-procurement-receipt-pdf.service");
const {
  calculateProjectCashPoolBigInt,
  spotProcurementPaymentToMoneyRequestValue
} = require("../dist/money/decimal-money");

const DATABASE_NAME = "jiangkong_spot_procurement_concurrency_verify";
const PROJECT_ID = "concurrency-project";
const EXECUTION_PROJECT_ID = "concurrency-execution-project";
const CASH_SHORT_PROJECT_ID = "concurrency-cash-short-project";
const HANDLER_USER_ID = "concurrency-material-staff";
const MATERIAL_DIRECTOR_USER_ID =
  "concurrency-material-director";
const APPLICATION_REVIEWER_USER_ID =
  "concurrency-application-reviewer";
const FINANCE_USER_ID = "concurrency-finance-staff";
const FINANCE_DIRECTOR_USER_ID =
  "concurrency-finance-director";
const SUPPORT_FILE_ID = "spot-procurement-concurrency-support";
const ACTIVE_PAYMENT_STATUSES = new Set([
  "approval_pending",
  "approved",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "settled"
]);

const clientA = new PrismaClient();
const clientB = new PrismaClient();
const observerClient = new PrismaClient();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBigint(actual, expected, label) {
  assert(typeof actual === "bigint", `${label} 必须由 Prisma 读取为 bigint`);
  assert(actual === expected, `${label} 应为 ${expected}，实际为 ${actual}`);
}

function comparable(value) {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? `${item}n` : item
  );
}

function assertUnchanged(before, after, label) {
  assert(
    comparable(after) === comparable(before),
    `${label} 在失败释放后发生了变化`
  );
}

function errorText(error) {
  if (error && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    if (typeof error.getResponse === "function") {
      return JSON.stringify(error.getResponse());
    }
  }
  return String(error);
}

function isConflictOrP2034(error) {
  return (
    error?.code === "P2034" ||
    (typeof error?.getStatus === "function" && error.getStatus() === 409)
  );
}

function isRawPostgresSerializationFailure(error) {
  return (
    error?.code === "P2010" &&
    String(error?.meta?.code) === "40001"
  );
}

function assertOneWinner(results, label, options = {}) {
  const fulfilled = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert(
    fulfilled.length === 1 && rejected.length === 1,
    `${label} 必须恰好一笔成功、一笔失败，实际 ${results
      .map((result) =>
        result.status === "fulfilled"
          ? result.status
          : `${result.status}:${errorText(result.reason)}`
      )
      .join("/")}`
  );
  const loser = rejected[0].reason;
  if (options.rawP2034) {
    assert(
      loser?.code === "P2034",
      `${label} 失败方必须保留原始 P2034，实际 ${errorText(loser)}`
    );
  } else {
    assert(
      isConflictOrP2034(loser) ||
        (options.allowRawPostgresSerialization &&
          isRawPostgresSerializationFailure(loser)),
      `${label} 失败方必须是 Conflict/P2034，实际 ${errorText(loser)}`
    );
  }
  return fulfilled[0].index;
}

function assertLocalRuntime() {
  const databaseUrlText = process.env.DATABASE_URL ?? "";
  let databaseUrl;
  try {
    databaseUrl = new URL(databaseUrlText);
  } catch {
    throw new Error("零星采购并发验收 DATABASE_URL 不是有效 URL");
  }
  assert(
    ["postgresql:", "postgres:"].includes(databaseUrl.protocol),
    "零星采购并发验收只能连接 PostgreSQL"
  );
  assert(
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      databaseUrl.hostname
    ),
    "零星采购并发验收拒绝连接非本机数据库"
  );
  assert(
    databaseUrl.pathname === `/${DATABASE_NAME}`,
    "零星采购并发验收只允许连接专用的一次性临时数据库"
  );
  assert(
    process.env.NODE_ENV === "test",
    "零星采购并发验收要求 NODE_ENV=test"
  );
  assert(
    (process.env.FILE_STORAGE_DRIVER ?? "").toLowerCase() === "local",
    "零星采购并发验收只允许本地文件存储"
  );
  const pilotProjectIds = new Set(
    (process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  assert(
    [PROJECT_ID, EXECUTION_PROJECT_ID, CASH_SHORT_PROJECT_ID].every(
      (projectId) => pilotProjectIds.has(projectId)
    ),
    "零星采购并发验收未显式开放全部专用临时项目"
  );
}

async function assertRealFormSchemaPrerequisites(prisma) {
  const [
    indexes,
    nullableColumns,
    triggers,
    discrepancyConstraints,
    abnormalTerminationConstraints
  ] = await Promise.all([
    prisma.$queryRaw(
      Prisma.sql`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'SpotProcurementPayment_one_current_per_procurement'
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        SELECT "table_name", "column_name", "is_nullable"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN (
            'SpotProcurement',
            'SpotProcurementVersion',
            'SpotProcurementLine',
            'SpotProcurementPaymentExecution'
          )
          AND column_name IN (
            'supplierKey',
            'supplierNameSnapshot',
            'approvedAmountCents',
            'totalAmountCents',
            'invoiceMode',
            'unitPrice',
            'amountCents',
            'voucherFileId'
          )
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        SELECT relation.relname AS table_name, pg_get_triggerdef(trigger.oid) AS definition
        FROM pg_trigger trigger
        JOIN pg_class relation ON relation.oid = trigger.tgrelid
        JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
        WHERE NOT trigger.tgisinternal
          AND procedure.proname = 'jg_enforce_exclusive_file_business_binding'
          AND relation.relname IN (
            'SpotProcurementPaymentExecution',
            'SpotProcurementPaymentAttachment',
            'SpotProcurementPaymentExecutionVoucher',
            'SpotProcurementPaymentInvoice'
          )
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = '"SpotProcurementDiscrepancy"'::regclass
          AND conname IN (
            'SpotProcurementDiscrepancy_status_check',
            'SpotProcurementDiscrepancy_resolution_type_check',
            'SpotProcurementDiscrepancy_status_resolution_check'
          )
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = '"SpotProcurementAbnormalTermination"'::regclass
          AND conname IN (
            'SpotProcurementAbnormalTermination_status_check',
            'SpotProcurementAbnormalTermination_lifecycle_check'
          )
      `
    )
  ]);
  assert(
    indexes.length === 1,
    "零星采购并发验收缺少唯一当前有效付款数据库约束"
  );
  assert(
    [
      "SpotProcurement:supplierKey",
      "SpotProcurement:supplierNameSnapshot",
      "SpotProcurement:approvedAmountCents",
      "SpotProcurementVersion:supplierKey",
      "SpotProcurementVersion:supplierNameSnapshot",
      "SpotProcurementVersion:totalAmountCents",
      "SpotProcurementLine:invoiceMode",
      "SpotProcurementLine:unitPrice",
      "SpotProcurementLine:amountCents",
      "SpotProcurementPaymentExecution:voucherFileId"
    ].every((key) =>
      nullableColumns.some(
        (column) =>
          `${column.table_name}:${column.column_name}` === key &&
          column.is_nullable === "YES"
      )
    ),
    "零星采购并发验收要求旧供应商、价格、金额和单凭证列均已改为兼容可空"
  );
  assert(
    [
      "SpotProcurementPaymentExecution",
      "SpotProcurementPaymentAttachment",
      "SpotProcurementPaymentExecutionVoucher",
      "SpotProcurementPaymentInvoice"
    ].every((tableName) =>
      triggers.some(
        (trigger) =>
          String(trigger.table_name) === tableName &&
          String(trigger.definition).includes("jg_enforce_exclusive_file_business_binding")
      )
    ),
    "零星采购并发验收缺少统一注册表生成的付款实付、付款依据、执行凭证或付款发票文件绑定触发器"
  );
  const constraints = discrepancyConstraints
    .map((constraint) => String(constraint.definition))
    .join("\n");
  assert(
    constraints.includes("awaiting_replenishment") &&
      constraints.includes("'replenishment'"),
    "零星采购并发验收缺少补货差异状态或补货处置数据库约束"
  );
  const abnormalTerminationChecks = abnormalTerminationConstraints
    .map((constraint) => String(constraint.definition))
    .join("\n");
  assert(
    abnormalTerminationChecks.includes("'requested'") &&
      abnormalTerminationChecks.includes("'confirmed'") &&
      abnormalTerminationChecks.includes("confirmedAt"),
    "零星采购并发验收缺少异常终止状态机数据库约束"
  );
}

function fileAccessFor(prisma) {
  const assertFile = async (client, fileId, actorUserId) => {
    const file = await client.fileObject.findUnique({
      where: { id: fileId }
    });
    if (
      !file ||
      file.storageStatus !== "active" ||
      file.uploadedByUserId !== actorUserId
    ) {
      throw new Error("并发验收付款凭证不可用或无权访问");
    }
    return file;
  };
  return {
    assertCanDownloadFileById: (fileId, actorUserId) =>
      assertFile(prisma, fileId, actorUserId),
    assertCanDownloadFile: (tx, fileId, actorUserId) =>
      assertFile(tx, fileId, actorUserId),
    assertFileHasNoBusinessBinding: async (tx, fileId) => {
      await acquireFileBusinessBindingTransactionLock(tx);
      const rows = await tx.$queryRaw(
        Prisma.sql`
          SELECT "id", "uploadedByUserId", "storageStatus"
          FROM "FileObject"
          WHERE "id" = ${fileId}
          FOR UPDATE
        `
      );
      if (
        rows.length !== 1 ||
        rows[0].storageStatus !== "active"
      ) {
        throw new Error("并发验收付款凭证不存在或已失效");
      }
      const [hasNonReceiptBinding, receiptPhoto] =
        await Promise.all([
          hasNonReceiptBusinessFileBinding(tx, [fileId]),
          tx.spotProcurementReceiptPhoto.findFirst({
            where: {
              OR: [
                { originalFileId: fileId },
                { watermarkedFileId: fileId }
              ]
            },
            select: { id: true }
          })
        ]);
      if (hasNonReceiptBinding || receiptPhoto) {
        throw new ConflictException(
          "该文件已绑定其他业务记录，不能重复使用"
        );
      }
      return rows[0];
    }
  };
}

function servicesFor(prisma) {
  const audit = new AuditService();
  const balances = new SpotProcurementBalanceService(prisma, audit);
  const closure = new SpotProcurementClosureService(audit);
  const pilot = new SpotProcurementPilotService();
  const projectFunding = new ProjectFundingAvailabilityService();
  const payment = new SpotProcurementPaymentService(
    prisma,
    audit,
    pilot,
    balances,
    {
      confirmPassword: async (_actorUserId, password) => {
        if (password !== "current-password") {
          throw new Error("当前密码不正确，请重新输入");
        }
      }
    },
    fileAccessFor(prisma),
    {
      tryRefreshLatestForBusiness: async () => undefined
    },
    closure,
    projectFunding
  );
  const receipt = new SpotProcurementReceiptService(
    prisma,
    audit,
    pilot,
    {},
    {},
    {},
    {
      tryRefreshLatest: async () => undefined
    },
    closure
  );
  const invoices = new InvoiceLedgerService(
    prisma,
    audit,
    fileAccessFor(prisma),
    pilot,
    closure
  );
  return { balances, payment, receipt, invoices };
}

async function seedVerificationFacts() {
  await clientA.project.createMany({
    data: [
      {
        id: PROJECT_ID,
        code: "CONCURRENCY-VERIFY",
        name: "零星采购 PostgreSQL 并发验收临时项目"
      },
      {
        id: EXECUTION_PROJECT_ID,
        code: "CONCURRENCY-EXECUTION",
        name: "零星采购实际付款并发验收项目"
      },
      {
        id: CASH_SHORT_PROJECT_ID,
        code: "CONCURRENCY-CASH-SHORT",
        name: "零星采购现金不足验收项目"
      }
    ]
  });
  await clientA.user.create({
    data: {
      id: HANDLER_USER_ID,
      name: "并发验收物资员",
      isActive: true,
      mustChangePassword: false
    }
  });
  await clientA.projectMember.create({
    data: {
      projectId: PROJECT_ID,
      userId: HANDLER_USER_ID,
      positionKey: "material_staff"
    }
  });
  await clientA.user.create({
    data: {
      id: MATERIAL_DIRECTOR_USER_ID,
      name: "并发验收物资主管",
      isActive: true,
      mustChangePassword: false
    }
  });
  await clientA.projectMember.create({
    data: {
      projectId: PROJECT_ID,
      userId: MATERIAL_DIRECTOR_USER_ID,
      positionKey: "material_director"
    }
  });
  await clientA.user.create({
    data: {
      id: FINANCE_USER_ID,
      name: "并发验收财务人员",
      isActive: true,
      mustChangePassword: false
    }
  });
  await clientA.projectMember.createMany({
    data: [
      {
        projectId: EXECUTION_PROJECT_ID,
        userId: FINANCE_USER_ID,
        positionKey: "finance_staff"
      },
      {
        projectId: CASH_SHORT_PROJECT_ID,
        userId: FINANCE_USER_ID,
        positionKey: "finance_staff"
      }
    ]
  });
  await clientA.user.create({
    data: {
      id: FINANCE_DIRECTOR_USER_ID,
      name: "并发验收财务主管",
      isActive: true,
      mustChangePassword: false
    }
  });
  await clientA.projectMember.create({
    data: {
      projectId: PROJECT_ID,
      userId: FINANCE_DIRECTOR_USER_ID,
      positionKey: "finance_director"
    }
  });
  await clientA.vatRateOption.createMany({
    data: [
      {
        id: "concurrency-vat-13",
        rateValue: "13",
        label: "13%",
        sortOrder: 1,
        createdByUserId: FINANCE_DIRECTOR_USER_ID
      },
      {
        id: "concurrency-vat-9",
        rateValue: "9",
        label: "9%",
        sortOrder: 2,
        createdByUserId: FINANCE_DIRECTOR_USER_ID
      }
    ]
  });
  await clientA.fileObject.create({
    data: {
      id: SUPPORT_FILE_ID,
      bucket: "local-private",
      objectKey: "spot-procurement-concurrency/support.pdf",
      originalName: "零星采购并发验收支撑附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      uploadedByUserId: HANDLER_USER_ID,
      storageStatus: "active"
    }
  });
  await clientA.projectReceipt.create({
    data: {
      projectId: EXECUTION_PROJECT_ID,
      receivedAt: new Date(),
      amountCents: 100_000n,
      payerName: "并发验收资金来源",
      sourceType: "general_contractor_payment",
      voucherFileId: SUPPORT_FILE_ID,
      recordedByUserId: FINANCE_USER_ID
    }
  });
}

async function createApprovedProcurement(prisma, input) {
  const projectId = input.projectId ?? PROJECT_ID;
  const handlerUserId = input.handlerUserId ?? HANDLER_USER_ID;
  await prisma.spotProcurement.create({
    data: {
      id: input.procurementId,
      projectId,
      code: input.code,
      supplierPartyId: null,
      supplierKey: input.supplierKey,
      supplierNameSnapshot: input.supplierName,
      applicantUserId: handlerUserId,
      handlerUserId,
      status: "approved_in_progress",
      approvedAmountCents: input.totalAmountCents
    }
  });
  await prisma.spotProcurementVersion.create({
    data: {
      id: input.versionId,
      procurementId: input.procurementId,
      versionNo: 1,
      status: "approved",
      reason: "本地 PostgreSQL 并发验收",
      supplierPartyId: null,
      supplierKey: input.supplierKey,
      supplierNameSnapshot: input.supplierName,
      handlerUserId,
      applicationDepartmentSnapshot: "工程部",
      applicationNameSnapshot: "并发验收申请人",
      purchaserNameSnapshot: "并发验收采购人",
      purchaserDepartmentNameSnapshot: "工程部",
      requestedArrivalAt: new Date(),
      totalAmountCents: input.totalAmountCents,
      submittedAt: new Date(),
      approvedAt: new Date(),
      createdByUserId: handlerUserId
    }
  });
  await prisma.spotProcurement.update({
    where: { id: input.procurementId },
    data: { currentVersionId: input.versionId }
  });
}

async function createPaymentDraft(prisma, input) {
  const projectId = input.projectId ?? PROJECT_ID;
  const handlerUserId = input.handlerUserId ?? HANDLER_USER_ID;
  return prisma.spotProcurementPayment.create({
    data: {
      id: input.paymentId,
      projectId,
      procurementId: input.procurementId,
      procurementVersionId: input.versionId,
      code: input.code,
      status: input.status ?? "draft",
      settlementAmountCents: input.settlementAmountCents,
      supplierBalanceAmountCents: input.supplierBalanceAmountCents,
      companyPaymentAmountCents:
        input.settlementAmountCents - input.supplierBalanceAmountCents,
      paymentPath: "supplier_direct",
      paymentMethod:
        input.settlementAmountCents === input.supplierBalanceAmountCents
          ? null
          : "cash",
      payeeNameSnapshot: input.supplierName,
      expectedPaymentAt:
        input.settlementAmountCents === input.supplierBalanceAmountCents
          ? null
          : new Date(Date.now() + 24 * 60 * 60 * 1000),
      paymentNote: "本地 PostgreSQL 并发验收",
      supportingAttachmentFileId: SUPPORT_FILE_ID,
      handlerUserId,
      createdByUserId: handlerUserId,
      submittedAt:
        input.status === "approved_pending_payment"
          ? new Date()
          : undefined,
      approvedAt:
        input.status === "approved_pending_payment"
          ? new Date()
          : undefined
    }
  });
}

async function createExecutionVoucher(fileId) {
  const contentSha256 = createHash("sha256")
    .update(fileId)
    .digest("hex");
  return clientA.fileObject.create({
    data: {
      id: fileId,
      bucket: "local-private",
      objectKey: `spot-procurement-concurrency/${fileId}.pdf`,
      originalName: `${fileId}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1,
      uploadedByUserId: FINANCE_USER_ID,
      storageStatus: "active",
      contentSha256
    }
  });
}

async function createTicketFile(
  fileId,
  uploadedByUserId = HANDLER_USER_ID
) {
  return clientA.fileObject.create({
    data: {
      id: fileId,
      bucket: "local-private",
      objectKey: `spot-procurement-concurrency/ticket-${fileId}.pdf`,
      originalName: `${fileId}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1,
      uploadedByUserId,
      storageStatus: "active"
    }
  });
}

async function createTicketReadyProcurement(input) {
  const totalAmountCents = input.lines.reduce(
    (total, line) => total + line.actualCostCents,
    0n
  );
  const versionId = `${input.procurementId}-v1`;
  const receiptId = `${input.procurementId}-receipt`;
  const paymentId = `${input.procurementId}-payment`;
  await createApprovedProcurement(clientA, {
    procurementId: input.procurementId,
    versionId,
    code: input.code,
    supplierKey: `${input.procurementId}-supplier`,
    supplierName: `${input.procurementId} 供应商`,
    totalAmountCents
  });
  const procurementLines = [];
  for (let index = 0; index < input.lines.length; index += 1) {
    const line = input.lines[index];
    procurementLines.push(
      await clientA.spotProcurementLine.create({
        data: {
          id: `${input.procurementId}-line-${index + 1}`,
          versionId,
          sortOrder: index + 1,
          materialName: `并发票据材料 ${index + 1}`,
          unit: "项",
          quantity: "1",
          invoiceMode: line.invoiceMode,
          invoiceType:
            line.invoiceMode === "invoice"
              ? line.invoiceType ?? "vat_general"
              : null,
          vatRateOptionId:
            line.invoiceMode === "invoice"
              ? line.vatRateOptionId ?? "concurrency-vat-13"
              : null,
          vatRateValueSnapshot:
            line.invoiceMode === "invoice"
              ? line.vatRateValue ?? "13"
              : null,
          vatRateLabelSnapshot:
            line.invoiceMode === "invoice"
              ? line.vatRateLabel ?? "13%"
              : null,
          unitPrice: (
            Number(line.actualCostCents) / 100
          ).toFixed(2),
          amountCents: line.actualCostCents
        }
      })
    );
  }
  await clientA.spotProcurement.update({
    where: { id: input.procurementId },
    data: { actualCostCents: totalAmountCents }
  });
  await clientA.spotProcurementPayment.create({
    data: {
      id: paymentId,
      projectId: PROJECT_ID,
      procurementId: input.procurementId,
      procurementVersionId: versionId,
      code: `${input.code}-P`,
      status: "paid",
      settlementAmountCents: totalAmountCents,
      supplierBalanceAmountCents: 0n,
      companyPaymentAmountCents: totalAmountCents,
      paidAmountCents: totalAmountCents,
      payeeNameSnapshot: `${input.procurementId} 供应商`,
      handlerUserId: HANDLER_USER_ID,
      createdByUserId: HANDLER_USER_ID,
      submittedAt: new Date(),
      approvedAt: new Date()
    }
  });
  const voucherFileId = `${paymentId}-voucher`;
  await createTicketFile(voucherFileId, FINANCE_USER_ID);
  await clientA.spotProcurementPaymentExecution.create({
    data: {
      paymentId,
      amountCents: totalAmountCents,
      paidAt: new Date(),
      paymentMethod: "bank_transfer",
      executedByUserId: FINANCE_USER_ID,
      voucherFileId,
      idempotencyKey: `${paymentId}-execution`
    }
  });
  const receiptSubmittedAt = new Date();
  await clientA.$transaction(async (tx) => {
    await tx.spotProcurementReceipt.create({
      data: {
        id: receiptId,
        projectId: PROJECT_ID,
        procurementId: input.procurementId,
        procurementVersionId: versionId,
        status: "reviewed",
        currentRevisionNo: 1,
        handlerUserId: HANDLER_USER_ID,
        actualCostCents: totalAmountCents,
        firstSubmittedAt: receiptSubmittedAt,
        submittedAt: receiptSubmittedAt,
        submittedByUserId: HANDLER_USER_ID,
        createdByUserId: HANDLER_USER_ID
      }
    });
    await tx.spotProcurementReceiptRevision.create({
      data: {
        id: `${receiptId}-revision-1`,
        receiptId,
        revisionNo: 1,
        procurementId: input.procurementId,
        procurementVersionId: versionId,
        handlerUserId: HANDLER_USER_ID,
        actualCostCents: totalAmountCents,
        submittedAt: receiptSubmittedAt,
        submittedByUserId: HANDLER_USER_ID,
        createdByUserId: HANDLER_USER_ID
      }
    });
  });
  for (let index = 0; index < procurementLines.length; index += 1) {
    await clientA.spotProcurementReceiptLine.create({
      data: {
        receiptId,
        receiptRevisionNo: 1,
        procurementId: input.procurementId,
        procurementVersionId: versionId,
        procurementLineId: procurementLines[index].id,
        approvedQuantitySnapshot: "1",
        qualifiedQuantity: "1",
        unqualifiedQuantity: "0",
        freeGiftQuantity: "0",
        actualCostCents: input.lines[index].actualCostCents,
        createdByUserId: HANDLER_USER_ID
      }
    });
  }
  const review = await clientA.spotProcurementReceiptReview.create({
    data: {
      receiptId,
      receiptRevisionNo: 1,
      procurementId: input.procurementId,
      procurementVersionId: versionId,
      sequenceNo: 1,
      decision: "approved",
      comment: "票据并发验收收货复核通过",
      reviewedByUserId: MATERIAL_DIRECTOR_USER_ID,
      reviewedByNameSnapshot: "并发验收物资主管"
    }
  });
  if (input.preventClosure) {
    await clientA.spotProcurementVersion.create({
      data: {
        id: `${input.procurementId}-pending-v2`,
        procurementId: input.procurementId,
        versionNo: 2,
        status: "draft",
        reason: "并发冲销测试期间阻止自动办结",
        supplierKey: `${input.procurementId}-supplier`,
        supplierNameSnapshot: `${input.procurementId} 供应商`,
        handlerUserId: HANDLER_USER_ID,
        applicationDepartmentSnapshot: "工程部",
        applicationNameSnapshot: "并发验收申请人",
        purchaserNameSnapshot: "并发验收采购人",
        purchaserDepartmentNameSnapshot: "工程部",
        requestedArrivalAt: new Date(),
        totalAmountCents,
        createdByUserId: HANDLER_USER_ID
      }
    });
  }
  return {
    procurementId: input.procurementId,
    versionId,
    receiptId,
    paymentId,
    procurementLines,
    review
  };
}

function invoiceInput(input) {
  return {
    invoiceType: input.invoiceType ?? "vat_general",
    invoiceCode: input.invoiceCode,
    invoiceNumber: input.invoiceNumber,
    externalIdentifier: input.externalIdentifier,
    issueDate: "2026-07-17",
    sellerName: "并发验收供应商",
    buyerName: "并发验收购买方",
    totalAmountCents: input.totalAmountCents.toString(),
    fileId: input.fileId,
    lines: input.lines.map((line) => ({
      description: line.description,
      vatRateOptionId:
        line.vatRateOptionId ?? "concurrency-vat-13",
      taxInclusiveAmountCents:
        line.taxInclusiveAmountCents.toString(),
      allocations: line.allocations.map((allocation) => ({
        procurementLineId: allocation.procurementLineId,
        paymentId: allocation.paymentId,
        amountCents: allocation.amountCents.toString()
      }))
    }))
  };
}

async function createExecutionReadyPayment(input) {
  await createApprovedProcurement(clientA, {
    projectId: input.projectId ?? EXECUTION_PROJECT_ID,
    handlerUserId: HANDLER_USER_ID,
    procurementId: input.procurementId,
    versionId: input.versionId,
    code: input.procurementCode,
    supplierKey: input.supplierKey,
    supplierName: input.supplierName,
    totalAmountCents: input.settlementAmountCents
  });
  return createPaymentDraft(clientA, {
    projectId: input.projectId ?? EXECUTION_PROJECT_ID,
    handlerUserId: HANDLER_USER_ID,
    paymentId: input.paymentId,
    procurementId: input.procurementId,
    versionId: input.versionId,
    code: input.paymentCode,
    supplierName: input.supplierName,
    settlementAmountCents: input.settlementAmountCents,
    supplierBalanceAmountCents:
      input.supplierBalanceAmountCents ?? 0n,
    status: "approved_pending_payment"
  });
}

function executionInput({
  amountCents,
  voucherFileId,
  idempotencyKey,
  paidAt = new Date()
}) {
  return {
    amountCents: amountCents.toString(),
    paidAt: paidAt.toISOString(),
    paymentMethod: "bank_transfer",
    voucherFileId,
    idempotencyKey,
    confirmationPassword: "current-password"
  };
}

async function readProjectCash(projectId) {
  const [
    receipts,
    paymentRequests,
    expenseRequests,
    spotPayments
  ] = await Promise.all([
    clientA.projectReceipt.findMany({
      where: { projectId, voidedAt: null },
      select: { amountCents: true }
    }),
    clientA.paymentRequest.findMany({
      where: { projectId },
      select: {
        status: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true
      }
    }),
    clientA.projectExpenseRequest.findMany({
      where: { projectId, voidedAt: null },
      select: {
        status: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true
      }
    }),
    clientA.spotProcurementPayment.findMany({
      where: {
        projectId,
        status: {
          in: [
            "approval_pending",
            "approved_pending_payment",
            "partially_paid",
            "paid",
            "settled"
          ]
        }
      },
      select: {
        status: true,
        companyPaymentAmountCents: true,
        canceledCompanyPaymentAmountCents: true,
        paidAmountCents: true
      }
    })
  ]);
  return calculateProjectCashPoolBigInt({
    receiptAmountCents: receipts.map((row) => row.amountCents),
    paymentRequests,
    expenseRequests,
    spotProcurementPayments: spotPayments.map(
      spotProcurementPaymentToMoneyRequestValue
    )
  });
}

async function readExecutionFacts(paymentIds) {
  return Promise.all([
    clientA.spotProcurementPayment.findMany({
      where: { id: { in: paymentIds } },
      orderBy: { id: "asc" }
    }),
    clientA.spotProcurementPaymentExecution.findMany({
      where: { paymentId: { in: paymentIds } },
      orderBy: { id: "asc" }
    }),
    clientA.auditLog.findMany({
      where: {
        action: "spot_procurement.payment.execution.record",
        businessId: { in: paymentIds }
      },
      orderBy: { createdAt: "asc" }
    })
  ]);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForBlockedQueries(
  prisma,
  queryNeedle,
  expectedCount,
  rootBlockerPid
) {
  let bestSnapshot = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await prisma.$queryRaw`
      SELECT
        pid::int AS "pid",
        wait_event_type AS "waitEventType",
        query,
        pg_blocking_pids(pid) AS "blockingPids"
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
    `;
    const sessionByPid = new Map(
      rows.map((row) => [Number(row.pid), row])
    );
    const reachesRootBlocker = (originPid) => {
      const pending = [originPid];
      const visited = new Set();
      while (pending.length) {
        const pid = pending.pop();
        if (pid === rootBlockerPid) return true;
        if (visited.has(pid)) continue;
        visited.add(pid);
        const blockers = sessionByPid.get(pid)?.blockingPids;
        if (Array.isArray(blockers)) {
          pending.push(...blockers.map(Number));
        }
      }
      return false;
    };
    const chainedWaiters = rows.filter(
      (row) =>
        row.waitEventType === "Lock" &&
        reachesRootBlocker(Number(row.pid))
    );
    const snapshot = rows
      .filter((row) => row.waitEventType === "Lock")
      .map((row) => ({
        pid: Number(row.pid),
        blockingPids: Array.isArray(row.blockingPids)
          ? row.blockingPids.map(Number)
          : [],
        reachesRootBlocker: reachesRootBlocker(Number(row.pid)),
        query: String(row.query).replace(/\s+/gu, " ").slice(0, 180)
      }));
    if (snapshot.length > bestSnapshot.length) {
      bestSnapshot = snapshot;
    }
    if (
      chainedWaiters.length >= expectedCount &&
      chainedWaiters.some((row) =>
        String(row.query).includes(queryNeedle)
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `未观察到 ${expectedCount} 个经 pg_blocking_pids 直接或传递追溯到 backend ${rootBlockerPid}、且至少一个等待 ${queryNeedle} 目标锁的真实 PostgreSQL 会话；最接近快照 ${JSON.stringify(bestSnapshot)}`
  );
}

async function runBehindDatabaseLock({
  blockerClient,
  observerClient,
  acquireLock,
  queryNeedle,
  start
}) {
  const acquired = deferred();
  const release = deferred();
  const blockerBackendPid = deferred();
  const blocker = blockerClient.$transaction(
    async (tx) => {
      await acquireLock(tx);
      const rows = await tx.$queryRaw(
        Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
      );
      blockerBackendPid.resolve(Number(rows[0]?.pid));
      acquired.resolve();
      await release.promise;
    },
    { timeout: 15_000, maxWait: 10_000 }
  );
  await acquired.promise;
  const rootBlockerPid = await blockerBackendPid.promise;
  assert(
    Number.isInteger(rootBlockerPid),
    "真实 PostgreSQL 外置 blocker 必须具备 backend PID"
  );
  const resultsPromise = Promise.allSettled(start());
  let blockingEvidenceError = null;
  try {
    await waitForBlockedQueries(
      observerClient,
      queryNeedle,
      2,
      rootBlockerPid
    );
  } catch (error) {
    blockingEvidenceError = error;
  } finally {
    release.resolve();
    await blocker;
  }
  const results = await resultsPromise;
  if (blockingEvidenceError) {
    throw new Error(
      `${errorText(blockingEvidenceError)}；并发操作结果 ${results
        .map((result) =>
          result.status === "fulfilled"
            ? "fulfilled"
            : `rejected:${errorText(result.reason)}`
        )
        .join("/")}`
    );
  }
  return results;
}

async function verifyApplicationReviewCoordinateConcurrency() {
  const procurementId = "spot-application-review-coordinate-race";
  const versionId = `${procurementId}-v1`;
  const approvalInstanceId = `${procurementId}-approval`;
  const submittedAt = new Date();
  await clientA.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: APPLICATION_REVIEWER_USER_ID,
        name: "并发验收双角色审批人",
        isActive: true,
        mustChangePassword: false
      }
    });
    await tx.projectMember.createMany({
      data: [
        {
          projectId: PROJECT_ID,
          userId: APPLICATION_REVIEWER_USER_ID,
          positionKey: "material_director"
        },
        {
          projectId: PROJECT_ID,
          userId: APPLICATION_REVIEWER_USER_ID,
          positionKey: "project_manager"
        }
      ]
    });
    await tx.spotProcurement.create({
      data: {
        id: procurementId,
        projectId: PROJECT_ID,
        code: "LXCG-CONC-REVIEW-COORDINATE",
        applicantUserId: HANDLER_USER_ID,
        handlerUserId: HANDLER_USER_ID,
        status: "approval_pending"
      }
    });
    await tx.spotProcurementVersion.create({
      data: {
        id: versionId,
        procurementId,
        versionNo: 1,
        status: "approval_pending",
        reason: "应用审批坐标并发验收",
        handlerUserId: HANDLER_USER_ID,
        applicationDepartmentSnapshot: "物资部",
        applicationNameSnapshot: "并发验收申请人",
        purchaserNameSnapshot: "并发验收采购人",
        purchaserDepartmentNameSnapshot: "物资部",
        requestedArrivalAt: submittedAt,
        submittedAt,
        createdByUserId: HANDLER_USER_ID
      }
    });
    await tx.spotProcurement.update({
      where: { id: procurementId },
      data: { currentVersionId: versionId }
    });
    await tx.approvalInstance.create({
      data: {
        id: approvalInstanceId,
        flowType: "spot_procurement.approve",
        businessType: "spot_procurement_version",
        businessId: versionId,
        status: "approval_pending",
        currentNodeIndex: 0,
        frozenNodes: [
          {
            name: "物资主管审批",
            mode: "any",
            roleKeys: ["material_director"]
          },
          {
            name: "项目经理审批",
            mode: "any",
            roleKeys: ["project_manager"]
          }
        ],
        applicantUserId: HANDLER_USER_ID
      }
    });
  });

  const initialApproval = await clientA.approvalInstance.findUnique({
    where: { id: approvalInstanceId },
    select: { currentNodeIndex: true }
  });
  assert(
    initialApproval?.currentNodeIndex === 0,
    "应用审批坐标并发验收必须从第 0 节点开始"
  );

  const firstReviewBackendPid = deferred();
  const secondReviewBackendPid = deferred();
  const firstReviewAuditEntered = deferred();
  const releaseFirstReviewAudit = deferred();
  const createReviewPrisma = (client, backendPid) => ({
    $transaction: (operation, options) =>
      client.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw(
            Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
          );
          backendPid.resolve(Number(rows[0]?.pid));
          return operation(tx);
        },
        {
          ...(options ?? {}),
          maxWait: 10_000,
          timeout: 15_000
        }
      )
  });
  const persistedAudit = new AuditService();
  let pausedFirstReviewAudit = false;
  const firstAudit = {
    record: async (tx, input) => {
      await persistedAudit.record(tx, input);
      if (
        input.action === "spot_procurement.approval.approve" &&
        !pausedFirstReviewAudit
      ) {
        pausedFirstReviewAudit = true;
        firstReviewAuditEntered.resolve(undefined);
        await releaseFirstReviewAudit.promise;
      }
    }
  };
  const approvalForms = {
    tryRefreshLatestForBusiness: async () => undefined
  };
  const firstService = new SpotProcurementApplicationService(
    createReviewPrisma(clientA, firstReviewBackendPid),
    firstAudit,
    new SpotProcurementPilotService(),
    approvalForms
  );
  const secondService = new SpotProcurementApplicationService(
    createReviewPrisma(clientB, secondReviewBackendPid),
    new AuditService(),
    new SpotProcurementPilotService(),
    approvalForms
  );
  const coordinates = {
    decision: "approve",
    expectedVersionId: versionId,
    expectedApprovalInstanceId: approvalInstanceId,
    expectedNodeIndex: 0
  };

  const firstRequest = firstService.review(
    procurementId,
    APPLICATION_REVIEWER_USER_ID,
    coordinates
  );
  await firstReviewAuditEntered.promise;
  const firstReviewBackendPidValue =
    await firstReviewBackendPid.promise;
  const secondRequest = secondService.review(
    procurementId,
    APPLICATION_REVIEWER_USER_ID,
    coordinates
  );
  const secondReviewBackendPidValue =
    await secondReviewBackendPid.promise;
  assert(
    Number.isInteger(firstReviewBackendPidValue) &&
      Number.isInteger(secondReviewBackendPidValue) &&
      firstReviewBackendPidValue !== secondReviewBackendPidValue,
    "应用审批坐标并发验收必须捕获两个不同的 PostgreSQL backend PID"
  );

  let directBlockObserved = false;
  let directBlockObservationError = null;
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const sessions = await observerClient.$queryRaw(
        Prisma.sql`
          SELECT
            pid::int AS "pid",
            state,
            wait_event_type AS "waitEventType",
            pg_blocking_pids(pid) AS "blockingPids"
          FROM pg_stat_activity
          WHERE pid IN (
            ${firstReviewBackendPidValue},
            ${secondReviewBackendPidValue}
          )
        `
      );
      const firstSession = sessions.find(
        (session) =>
          Number(session.pid) === firstReviewBackendPidValue
      );
      const secondSession = sessions.find(
        (session) =>
          Number(session.pid) === secondReviewBackendPidValue
      );
      const blockers = Array.isArray(secondSession?.blockingPids)
        ? secondSession.blockingPids.map(Number)
        : [];
      if (
        firstSession &&
        secondSession?.waitEventType === "Lock" &&
        blockers.includes(firstReviewBackendPidValue)
      ) {
        directBlockObserved = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } catch (error) {
    directBlockObservationError = error;
  } finally {
    releaseFirstReviewAudit.resolve(undefined);
  }
  const results = await Promise.allSettled([
    firstRequest,
    secondRequest
  ]);
  if (directBlockObservationError) {
    throw directBlockObservationError;
  }
  assert(
    directBlockObserved,
    "第二笔应用审批必须由第一笔事务的 backend PID 直接阻塞"
  );
  assert(
    results[0].status === "fulfilled",
    `第一笔应用审批必须成功，实际 ${
      results[0].status === "rejected"
        ? errorText(results[0].reason)
        : results[0].status
    }`
  );
  assert(
    results[1].status === "rejected" &&
      typeof results[1].reason?.getStatus === "function" &&
      results[1].reason.getStatus() === 409,
    `第二笔旧坐标审批必须严格返回 409，实际 ${
      results[1].status === "rejected"
        ? errorText(results[1].reason)
        : results[1].status
    }`
  );

  const [
    approval,
    procurement,
    version,
    actionCount,
    auditCount,
    paymentCount,
    receiptCount
  ] = await Promise.all([
    clientA.approvalInstance.findUnique({
      where: { id: approvalInstanceId }
    }),
    clientA.spotProcurement.findUnique({
      where: { id: procurementId },
      select: { status: true }
    }),
    clientA.spotProcurementVersion.findUnique({
      where: { id: versionId },
      select: { status: true }
    }),
    clientA.approvalActionLog.count({
      where: {
        approvalInstanceId,
        action: "approve",
        actorUserId: APPLICATION_REVIEWER_USER_ID
      }
    }),
    clientA.auditLog.count({
      where: {
        action: "spot_procurement.approval.approve",
        businessType: "spot_procurement_version",
        businessId: versionId,
        actorUserId: APPLICATION_REVIEWER_USER_ID
      }
    }),
    clientA.spotProcurementPayment.count({
      where: { procurementId }
    }),
    clientA.spotProcurementReceipt.count({
      where: { procurementId }
    })
  ]);
  assert(
    approval?.status === "approval_pending" &&
      approval.currentNodeIndex === 1,
    "相同旧坐标并发审批后只能从节点 0 前进到节点 1"
  );
  assert(
    procurement?.status === "approval_pending" &&
      version?.status === "approval_pending",
    "非末节点审批后采购根与版本必须继续保持审批中"
  );
  assert(
    actionCount === 1 && auditCount === 1,
    `相同旧坐标并发审批只能保留一条 ActionLog/Audit，实际 ${actionCount}/${auditCount}`
  );
  assert(
    paymentCount === 0 && receiptCount === 0,
    `非末节点并发审批不得生成付款或收货草稿，实际 ${paymentCount}/${receiptCount}`
  );
  console.log(
    "ok spot application review coordinates: direct backend block, node 0->1, stale replay strict 409, one action/audit, zero payment/receipt"
  );
}

async function verifyCumulativeCapacityCompetition(servicesA, servicesB) {
  const procurementId = "spot-concurrency-capacity";
  const versionId = `${procurementId}-v1`;
  const supplierName = "累计额度并发验收供应商";
  await createApprovedProcurement(clientA, {
    procurementId,
    versionId,
    code: "LXCG-CONC-CAP",
    supplierKey: "spot-concurrency-capacity-supplier",
    supplierName,
    totalAmountCents: 10_000n
  });
  const payment = await createPaymentDraft(clientA, {
    paymentId: `${procurementId}-payment`,
    procurementId,
    versionId,
    code: "LXCG-CONC-CAP-P001",
    supplierName,
    settlementAmountCents: 7_000n,
    supplierBalanceAmountCents: 0n
  });

  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurementVersion" WHERE "id" = ${versionId} FOR UPDATE`
      ),
    queryNeedle: "SpotProcurementVersion",
    start: () => [
      servicesA.payment.submit(payment.id, HANDLER_USER_ID),
      servicesB.payment.submit(payment.id, HANDLER_USER_ID)
    ]
  });
  assertOneWinner(results, "同一付款申请重复提交竞争");

  const persisted = await clientA.spotProcurementPayment.findMany({
    where: { procurementId }
  });
  assert(
    persisted.length === 1 && persisted[0].status === "approval_pending",
    "同一付款申请并发提交后必须只保留一个审批中的当前付款"
  );
  assert(
    (await clientA.approvalInstance.count({
      where: {
        businessType: "spot_procurement_payment",
        businessId: payment.id
      }
    })) === 1,
    "同一付款申请并发提交只能生成一个审批实例"
  );
  console.log(
    "ok spot procurement current payment submit: one payment -> one winner, one Conflict/P2034"
  );
}

async function verifyBalanceCompetitionAndRelease(servicesA, servicesB) {
  const competingSupplierKey =
    "spot-concurrency-balance-over-capacity-supplier";
  const competingSupplierName = "余额超额竞争验收供应商";
  const competingAccount =
    await clientA.supplierBalanceAccount.create({
      data: {
        id: "spot-concurrency-balance-over-capacity-account",
        projectId: PROJECT_ID,
        supplierKey: competingSupplierKey,
        supplierNameSnapshot: competingSupplierName,
        availableAmountCents: 10_000n,
        reservedAmountCents: 0n
      }
    });
  const competingPayments = [];
  for (const suffix of ["a", "b"]) {
    const procurementId = `spot-concurrency-balance-${suffix}`;
    const versionId = `${procurementId}-v1`;
    await createApprovedProcurement(clientA, {
      procurementId,
      versionId,
      code: `LXCG-CONC-BAL-${suffix.toUpperCase()}`,
      supplierKey: competingSupplierKey,
      supplierName: competingSupplierName,
      totalAmountCents: 10_000n
    });
    competingPayments.push(
      await createPaymentDraft(clientA, {
        paymentId: `${procurementId}-payment`,
        procurementId,
        versionId,
        code: `LXCG-CONC-BAL-${suffix.toUpperCase()}-P001`,
        supplierName: competingSupplierName,
        settlementAmountCents: 6_000n,
        supplierBalanceAmountCents: 6_000n
      })
    );
  }

  const competitionResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SupplierBalanceAccount" WHERE "id" = ${competingAccount.id} FOR UPDATE`
      ),
    queryNeedle: "SupplierBalanceAccount",
    start: () => [
      servicesA.payment.submit(
        competingPayments[0].id,
        HANDLER_USER_ID
      ),
      servicesB.payment.submit(
        competingPayments[1].id,
        HANDLER_USER_ID
      )
    ]
  });
  assertOneWinner(competitionResults, "同一供应商余额账户超额竞争");

  const afterCompetition =
    await clientA.supplierBalanceAccount.findUniqueOrThrow({
      where: { id: competingAccount.id }
    });
  assertBigint(
    afterCompetition.reservedAmountCents,
    6_000n,
    "余额超额竞争后的预留金额"
  );
  assert(
    (await clientA.supplierBalanceReservation.count({
      where: {
        accountId: competingAccount.id,
        status: "reserved"
      }
    })) === 1,
    "余额超额竞争只能留下一个有效 reservation"
  );

  const sequenceSupplierKey =
    "spot-concurrency-balance-sequence-supplier";
  const sequenceSupplierName = "余额流水并发验收供应商";
  const sequenceAccount =
    await clientA.supplierBalanceAccount.create({
      data: {
        id: "spot-concurrency-balance-sequence-account",
        projectId: PROJECT_ID,
        supplierKey: sequenceSupplierKey,
        supplierNameSnapshot: sequenceSupplierName,
        availableAmountCents: 10_000n,
        reservedAmountCents: 0n
      }
    });
  const sequenceInputs = [];
  for (const suffix of ["a", "b"]) {
    const procurementId = `spot-concurrency-sequence-${suffix}`;
    const versionId = `${procurementId}-v1`;
    await createApprovedProcurement(clientA, {
      procurementId,
      versionId,
      code: `LXCG-CONC-SEQ-${suffix.toUpperCase()}`,
      supplierKey: sequenceSupplierKey,
      supplierName: sequenceSupplierName,
      totalAmountCents: 5_000n
    });
    const payment = await createPaymentDraft(clientA, {
      paymentId: `${procurementId}-payment`,
      procurementId,
      versionId,
      code: `LXCG-CONC-SEQ-${suffix.toUpperCase()}-P001`,
      supplierName: sequenceSupplierName,
      settlementAmountCents: 3_000n,
      supplierBalanceAmountCents: 3_000n
    });
    sequenceInputs.push({
      projectId: PROJECT_ID,
      supplierKey: sequenceSupplierKey,
      paymentId: payment.id,
      procurementId,
      amountCents: 3_000n,
      actorUserId: HANDLER_USER_ID
    });
  }

  const reserveClients = [clientA, clientB];
  const reserveServices = [servicesA.balances, servicesB.balances];
  const reserveResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SupplierBalanceAccount" WHERE "id" = ${sequenceAccount.id} FOR UPDATE`
      ),
    queryNeedle: "SupplierBalanceAccount",
    start: () =>
      sequenceInputs.map((input, index) =>
        reserveClients[index].$transaction(
          (tx) => reserveServices[index].reserve(tx, input),
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable
          }
        )
      )
  });
  const reserveWinner = assertOneWinner(
    reserveResults,
    "同一余额账户两笔可容纳预留并发竞争",
    { allowRawPostgresSerialization: true }
  );
  const reserveLoser = reserveWinner === 0 ? 1 : 0;
  await reserveClients[reserveLoser].$transaction(
    (tx) =>
      reserveServices[reserveLoser].reserve(
        tx,
        sequenceInputs[reserveLoser]
      ),
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable
    }
  );

  const reserveEntries =
    await clientA.supplierBalanceEntry.findMany({
      where: {
        accountId: sequenceAccount.id,
        entryType: "reserve"
      },
      orderBy: { sequenceNo: "asc" }
    });
  assert(
    reserveEntries.length === 2 &&
      reserveEntries[0].sequenceNo === 1n &&
      reserveEntries[1].sequenceNo === 2n,
    "同一余额账户的 reserve sequenceNo 必须唯一且连续为 1、2"
  );

  const releaseResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SupplierBalanceAccount" WHERE "id" = ${sequenceAccount.id} FOR UPDATE`
      ),
    queryNeedle: "SupplierBalanceAccount",
    start: () => [
      clientA.$transaction(
        (tx) =>
          servicesA.balances.releaseReservation(
            tx,
            {
              paymentId: sequenceInputs[0].paymentId,
              expectedAmountCents: 3_000n,
              expectedProjectId: PROJECT_ID,
              expectedSupplierKey: sequenceSupplierKey,
              actorUserId: HANDLER_USER_ID,
              reason: "本地并发释放验收 A"
            }
          ),
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable
        }
      ),
      clientB.$transaction(
        (tx) =>
          servicesB.balances.releaseReservation(
            tx,
            {
              paymentId: sequenceInputs[0].paymentId,
              expectedAmountCents: 3_000n,
              expectedProjectId: PROJECT_ID,
              expectedSupplierKey: sequenceSupplierKey,
              actorUserId: HANDLER_USER_ID,
              reason: "本地并发释放验收 B"
            }
          ),
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable
        }
      )
    ]
  });
  assertOneWinner(releaseResults, "同一 reservation 严格并发释放", {
    allowRawPostgresSerialization: true
  });

  const [finalAccount, releasedReservation, entries] =
    await Promise.all([
      clientA.supplierBalanceAccount.findUniqueOrThrow({
        where: { id: sequenceAccount.id }
      }),
      clientA.supplierBalanceReservation.findUniqueOrThrow({
        where: { paymentId: sequenceInputs[0].paymentId }
      }),
      clientA.supplierBalanceEntry.findMany({
        where: { accountId: sequenceAccount.id },
        orderBy: { sequenceNo: "asc" }
      })
    ]);
  assertBigint(
    finalAccount.reservedAmountCents,
    3_000n,
    "并发释放后的账户预留余额"
  );
  assert(
    releasedReservation.status === "released",
    "并发释放成功方必须把 reservation 标记为 released"
  );
  assert(
    entries.filter((entry) => entry.entryType === "release").length ===
      1,
    "并发释放只能生成一条 release 流水"
  );
  assert(
    entries.length === 3 &&
      entries.every(
        (entry, index) => entry.sequenceNo === BigInt(index + 1)
      ) &&
      new Set(entries.map((entry) => entry.sequenceNo.toString()))
        .size === entries.length,
    "同一余额账户的全部 sequenceNo 必须唯一且连续为 1、2、3"
  );
  assertBigint(
    entries.reduce(
      (sum, entry) => sum + entry.reservedDeltaCents,
      0n
    ),
    finalAccount.reservedAmountCents,
    "余额流水预留净额"
  );
  console.log(
    "ok supplier balance concurrency: over-capacity race, continuous sequenceNo, strict one-shot release"
  );
}

async function verifyMismatchedReservationReleaseFailsClosed(
  servicesA
) {
  const procurementId = "spot-concurrency-mismatched-payment";
  const versionId = `${procurementId}-v1`;
  const expectedSupplierKey =
    "spot-concurrency-mismatched-supplier-a";
  const expectedSupplierName = "错账验收供应商 A";
  const wrongProjectId = "concurrency-project-b";
  const wrongSupplierKey = "spot-concurrency-mismatched-supplier-b";
  const wrongSupplierName = "错账验收供应商 B";
  const amountCents = 2_500n;

  await clientA.project.create({
    data: {
      id: wrongProjectId,
      code: "CONCURRENCY-VERIFY-B",
      name: "零星采购错账验收临时项目 B"
    }
  });
  await createApprovedProcurement(clientA, {
    procurementId,
    versionId,
    code: "LXCG-CONC-MISMATCH-A",
    supplierKey: expectedSupplierKey,
    supplierName: expectedSupplierName,
    totalAmountCents: 5_000n
  });
  const payment = await createPaymentDraft(clientA, {
    paymentId: `${procurementId}-payment`,
    procurementId,
    versionId,
    code: "LXCG-CONC-MISMATCH-A-P001",
    supplierName: expectedSupplierName,
    settlementAmountCents: amountCents,
    supplierBalanceAmountCents: amountCents
  });
  await clientA.spotProcurementPayment.update({
    where: { id: payment.id },
    data: { status: "approval_pending", submittedAt: new Date() }
  });
  const expectedAccount =
    await clientA.supplierBalanceAccount.create({
      data: {
        id: "spot-concurrency-mismatched-account-a",
        projectId: PROJECT_ID,
        supplierKey: expectedSupplierKey,
        supplierNameSnapshot: expectedSupplierName,
        availableAmountCents: 5_000n,
        reservedAmountCents: 0n
      }
    });
  const wrongAccount =
    await clientA.supplierBalanceAccount.create({
      data: {
        id: "spot-concurrency-mismatched-account-b",
        projectId: wrongProjectId,
        supplierKey: wrongSupplierKey,
        supplierNameSnapshot: wrongSupplierName,
        availableAmountCents: 5_000n,
        reservedAmountCents: amountCents
      }
    });
  const reservation =
    await clientA.supplierBalanceReservation.create({
      data: {
        id: "spot-concurrency-mismatched-reservation",
        accountId: wrongAccount.id,
        paymentId: payment.id,
        amountCents,
        status: "reserved",
        reservedByUserId: HANDLER_USER_ID
      }
    });
  await clientA.supplierBalanceEntry.create({
    data: {
      accountId: wrongAccount.id,
      sequenceNo: 1n,
      reservationId: reservation.id,
      paymentId: payment.id,
      procurementId,
      entryType: "reserve",
      availableDeltaCents: 0n,
      reservedDeltaCents: amountCents,
      availableAmountAfterCents: 5_000n,
      reservedAmountAfterCents: amountCents,
      actorUserId: HANDLER_USER_ID,
      reason: "构造同金额跨项目跨供应商错账"
    }
  });

  const readFacts = () =>
    Promise.all([
      clientA.spotProcurementPayment.findUniqueOrThrow({
        where: { id: payment.id }
      }),
      clientA.spotProcurementVersion.findUniqueOrThrow({
        where: { id: versionId }
      }),
      clientA.supplierBalanceReservation.findUniqueOrThrow({
        where: { paymentId: payment.id }
      }),
      clientA.supplierBalanceAccount.findMany({
        where: {
          id: { in: [expectedAccount.id, wrongAccount.id] }
        },
        orderBy: { id: "asc" }
      }),
      clientA.supplierBalanceEntry.findMany({
        where: { accountId: wrongAccount.id },
        orderBy: { sequenceNo: "asc" }
      })
    ]);
  const before = await readFacts();
  const error = await clientA
    .$transaction(
      (tx) =>
        servicesA.balances.releaseReservation(tx, {
          paymentId: payment.id,
          expectedAmountCents: amountCents,
          expectedProjectId: PROJECT_ID,
          expectedSupplierKey,
          actorUserId: HANDLER_USER_ID,
          reason: "错账释放必须失败"
        }),
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable
      }
    )
    .then(
      () => null,
      (caught) => caught
    );
  assert(
    typeof error?.getStatus === "function" &&
      error.getStatus() === 409,
    `同金额错账释放必须返回 Conflict，实际 ${errorText(error)}`
  );
  assert(
    error.message === "供应商余额预留状态异常，请联系财务处理",
    `同金额错账释放必须返回固定中文提示，实际 ${errorText(error)}`
  );
  const after = await readFacts();
  assertUnchanged(before[0], after[0], "付款申请 A");
  assertUnchanged(before[1], after[1], "采购版本 A");
  assertUnchanged(before[2], after[2], "错误 reservation B");
  assertUnchanged(before[3], after[3], "供应商余额账户 A/B");
  assertUnchanged(before[4], after[4], "供应商余额流水");
  console.log(
    "ok mismatched reservation fail-closed: payment/version A cannot release same-amount reservation/account B"
  );
}

async function verifyExecutionRemainingCompetition(
  servicesA,
  servicesB
) {
  const procurementId = "spot-execution-remaining";
  const versionId = `${procurementId}-v1`;
  const payment = await createExecutionReadyPayment({
    procurementId,
    versionId,
    procurementCode: "LXCG-EXEC-REMAIN",
    paymentId: `${procurementId}-payment`,
    paymentCode: "LXCG-EXEC-REMAIN-P001",
    supplierKey: "spot-execution-remaining-supplier",
    supplierName: "实付剩余额度并发供应商",
    settlementAmountCents: 10_000n
  });
  const voucherIds = [
    "spot-execution-remaining-voucher-a",
    "spot-execution-remaining-voucher-b"
  ];
  await Promise.all(voucherIds.map(createExecutionVoucher));
  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurementVersion" WHERE "id" = ${versionId} FOR UPDATE`
      ),
    queryNeedle: "SpotProcurementVersion",
    start: () => [
      servicesA.payment.recordExecution(
        payment.id,
        FINANCE_USER_ID,
        executionInput({
          amountCents: 6_000n,
          voucherFileId: voucherIds[0],
          idempotencyKey: "spot-execution-remaining-key-a"
        })
      ),
      servicesB.payment.recordExecution(
        payment.id,
        FINANCE_USER_ID,
        executionInput({
          amountCents: 6_000n,
          voucherFileId: voucherIds[1],
          idempotencyKey: "spot-execution-remaining-key-b"
        })
      )
    ]
  });
  assertOneWinner(results, "同一付款剩余额度实际付款竞争");
  const [payments, executions, audits] =
    await readExecutionFacts([payment.id]);
  assertBigint(
    payments[0].paidAmountCents,
    6_000n,
    "同一付款并发后的累计已付"
  );
  assert(
    payments[0].status === "partially_paid",
    "同一付款并发成功方后必须保持部分已付"
  );
  assert(
    executions.length === 1 && audits.length === 1,
    "同一付款并发失败方不得留下 execution 或 audit 部分写入"
  );
  console.log(
    "ok spot execution remaining competition: one active execution, one rolled-back loser"
  );
}

async function verifyExecutionIdempotencyConcurrency(
  servicesA,
  servicesB
) {
  const procurementId = "spot-execution-idempotency";
  const versionId = `${procurementId}-v1`;
  const payment = await createExecutionReadyPayment({
    procurementId,
    versionId,
    procurementCode: "LXCG-EXEC-IDEMP",
    paymentId: `${procurementId}-payment`,
    paymentCode: "LXCG-EXEC-IDEMP-P001",
    supplierKey: "spot-execution-idempotency-supplier",
    supplierName: "实付幂等并发供应商",
    settlementAmountCents: 5_000n
  });
  const voucherFileId = "spot-execution-idempotency-voucher";
  await createExecutionVoucher(voucherFileId);
  const paidAt = new Date();
  const input = executionInput({
    amountCents: 2_000n,
    voucherFileId,
    idempotencyKey: "spot-execution-idempotency-key",
    paidAt
  });
  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurementVersion" WHERE "id" = ${versionId} FOR UPDATE`
      ),
    queryNeedle: "SpotProcurementVersion",
    start: () => [
      servicesA.payment.recordExecution(
        payment.id,
        FINANCE_USER_ID,
        input
      ),
      servicesB.payment.recordExecution(
        payment.id,
        FINANCE_USER_ID,
        input
      )
    ]
  });
  assert(
    results.every((result) => result.status === "fulfilled"),
    `同一幂等键并发必须都返回原记录，实际 ${results
      .map((result) => result.status)
      .join("/")}`
  );
  const executionIds = results.map(
    (result) => result.value.execution.id
  );
  assert(
    new Set(executionIds).size === 1,
    "同一幂等键并发必须返回同一个 executionId"
  );
  const [payments, executions, audits] =
    await readExecutionFacts([payment.id]);
  assertBigint(
    payments[0].paidAmountCents,
    2_000n,
    "幂等并发后的累计已付"
  );
  assert(
    executions.length === 1 && audits.length === 1,
    "同一幂等键并发只能生成一条 execution 和一条 audit"
  );
  console.log(
    "ok spot execution idempotency: concurrent retry returns one original execution"
  );
}

async function verifyExecutionVoucherUniqueness(
  servicesA,
  servicesB
) {
  const voucherFileId = "spot-execution-shared-voucher";
  await createExecutionVoucher(voucherFileId);
  const payments = [];
  for (const suffix of ["a", "b"]) {
    const procurementId = `spot-execution-voucher-${suffix}`;
    payments.push(
      await createExecutionReadyPayment({
        procurementId,
        versionId: `${procurementId}-v1`,
        procurementCode: `LXCG-EXEC-VOUCHER-${suffix.toUpperCase()}`,
        paymentId: `${procurementId}-payment`,
        paymentCode: `LXCG-EXEC-VOUCHER-${suffix.toUpperCase()}-P001`,
        supplierKey: `spot-execution-voucher-supplier-${suffix}`,
        supplierName: `凭证唯一并发供应商 ${suffix.toUpperCase()}`,
        settlementAmountCents: 2_000n
      })
    );
  }
  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${EXECUTION_PROJECT_ID} FOR UPDATE`
      ),
    queryNeedle: 'FROM "Project"',
    start: () => [
      servicesA.payment.recordExecution(
        payments[0].id,
        FINANCE_USER_ID,
        executionInput({
          amountCents: 2_000n,
          voucherFileId,
          idempotencyKey: "spot-execution-shared-voucher-key-a"
        })
      ),
      servicesB.payment.recordExecution(
        payments[1].id,
        FINANCE_USER_ID,
        executionInput({
          amountCents: 2_000n,
          voucherFileId,
          idempotencyKey: "spot-execution-shared-voucher-key-b"
        })
      )
    ]
  });
  assertOneWinner(results, "同一凭证跨付款并发唯一");
  const [persistedPayments, executions, audits] =
    await readExecutionFacts(payments.map((payment) => payment.id));
  assert(
    executions.length === 1 && audits.length === 1,
    "同一凭证跨付款只能留下一个 execution 和 audit"
  );
  assert(
    persistedPayments.filter(
      (payment) => payment.status === "paid"
    ).length === 1 &&
      persistedPayments.filter(
        (payment) =>
          payment.status === "approved_pending_payment"
      ).length === 1,
    "同一凭证竞争失败方付款状态和已付金额必须完整回滚"
  );
  assert(
    persistedPayments.reduce(
      (sum, payment) => sum + payment.paidAmountCents,
      0n
    ) === 2_000n,
    "同一凭证竞争失败方不得增加累计已付"
  );
  console.log(
    "ok spot execution voucher uniqueness: one active voucher binding across payments"
  );
}

function isExclusiveFileBindingConflict(error) {
  return (
    error?.code === "P2002" ||
    (error?.code === "P2010" &&
      String(error?.meta?.code) === "23505") ||
    (typeof error?.getStatus === "function" &&
      error.getStatus() === 409)
  );
}

async function createLegacyOwnerContractBinding(
  tx,
  { id, fileId, suffix }
) {
  return tx.projectOwnerContract.create({
    data: {
      id,
      projectId: EXECUTION_PROJECT_ID,
      ownerName: `独占文件竞态业主 ${suffix}`,
      contractName: `独占文件竞态主合同 ${suffix}`,
      contractCode: `OWNER-EXCLUSIVE-FILE-${suffix}`,
      signedAt: new Date("2026-07-17T00:00:00.000Z"),
      amountCents: 10_000n,
      taxRateBps: 900,
      pricingMethod: "fixed_total",
      paymentTermsSummary: "并发验收",
      retentionSummary: "并发验收",
      fileId,
      recordedByUserId: FINANCE_USER_ID,
      status: "pending_confirm",
      fileContentSha256Snapshot: createHash("sha256")
        .update(fileId)
        .digest("hex")
    }
  });
}

async function createExclusiveExecutionBinding(
  tx,
  { id, paymentId, fileId, suffix }
) {
  await fileAccessFor(clientA).assertFileHasNoBusinessBinding(
    tx,
    fileId
  );
  return tx.spotProcurementPaymentExecution.create({
    data: {
      id,
      paymentId,
      amountCents: 1n,
      paidAt: new Date("2026-07-17T00:00:00.000Z"),
      paymentMethod: "bank_transfer",
      executedByUserId: FINANCE_USER_ID,
      voucherFileId: fileId,
      idempotencyKey: `exclusive-file-binding-${suffix}`
    }
  });
}

async function runHeldFileBindingRace({
  firstWrite,
  secondWrite,
  blockedQueryNeedle,
  label
}) {
  const acquired = deferred();
  const release = deferred();
  const blockerBackendPid = deferred();
  const firstPromise = clientA.$transaction(
    async (tx) => {
      try {
        const result = await firstWrite(tx);
        const rows = await tx.$queryRaw(
          Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
        );
        blockerBackendPid.resolve(Number(rows[0]?.pid));
        acquired.resolve();
        await release.promise;
        return result;
      } catch (error) {
        acquired.reject(error);
        throw error;
      }
    },
    { timeout: 15_000, maxWait: 10_000 }
  );
  await acquired.promise;
  const rootBlockerPid = await blockerBackendPid.promise;
  assert(
    Number.isInteger(rootBlockerPid),
    "文件绑定竞争 blocker 必须具备真实 PostgreSQL backend PID"
  );
  // PrismaPromise is lazy until it is awaited/then'ed. Assimilate it through
  // a native Promise so the second statement really starts before observing
  // pg_stat_activity.
  const secondPromise = Promise.resolve().then(() => secondWrite());
  try {
    await waitForBlockedQueries(
      clientB,
      blockedQueryNeedle,
      1,
      rootBlockerPid
    );
  } finally {
    release.resolve();
  }
  const results = await Promise.allSettled([
    firstPromise,
    secondPromise
  ]);
  assert(
    results[0].status === "fulfilled" &&
      results[1].status === "rejected" &&
      isExclusiveFileBindingConflict(results[1].reason),
    `${label} 必须第一笔成功、第二笔以文件绑定冲突失败，实际 ${results
      .map((result) =>
        result.status === "fulfilled"
          ? result.status
          : `${result.status}:${errorText(result.reason)}`
      )
      .join("/")}`
  );
}

async function createExclusiveRacePayment(suffix) {
  const procurementId = `spot-exclusive-file-${suffix}`;
  return createExecutionReadyPayment({
    procurementId,
    versionId: `${procurementId}-v1`,
    procurementCode: `LXCG-EXCLUSIVE-FILE-${suffix}`,
    paymentId: `${procurementId}-payment`,
    paymentCode: `LXCG-EXCLUSIVE-FILE-${suffix}-P001`,
    supplierKey: `spot-exclusive-file-supplier-${suffix}`,
    supplierName: `独占文件并发供应商 ${suffix}`,
    settlementAmountCents: 2_000n
  });
}

async function verifyExclusiveFileBindingAcrossLegacyEntries() {
  const oldFirstFileId = "spot-exclusive-file-old-first";
  await createExecutionVoucher(oldFirstFileId);
  const oldFirstPayment =
    await createExclusiveRacePayment("OLD-FIRST");
  await runHeldFileBindingRace({
    firstWrite: (tx) =>
      createLegacyOwnerContractBinding(tx, {
        id: "spot-exclusive-owner-old-first",
        fileId: oldFirstFileId,
        suffix: "OLD-FIRST"
      }),
    secondWrite: () =>
      clientB.$transaction((tx) =>
        createExclusiveExecutionBinding(tx, {
          id: "spot-exclusive-execution-old-first",
          paymentId: oldFirstPayment.id,
          fileId: oldFirstFileId,
          suffix: "old-first"
        })
      ),
    blockedQueryNeedle: "pg_advisory_xact_lock",
    label: "旧业务入口先写时的独占文件竞态"
  });

  const exclusiveFirstFileId =
    "spot-exclusive-file-exclusive-first";
  await createExecutionVoucher(exclusiveFirstFileId);
  const exclusiveFirstPayment =
    await createExclusiveRacePayment("EXCLUSIVE-FIRST");
  await runHeldFileBindingRace({
    firstWrite: (tx) =>
      createExclusiveExecutionBinding(tx, {
        id: "spot-exclusive-execution-exclusive-first",
        paymentId: exclusiveFirstPayment.id,
        fileId: exclusiveFirstFileId,
        suffix: "exclusive-first"
      }),
    secondWrite: () =>
      clientB.$transaction((tx) =>
        createLegacyOwnerContractBinding(tx, {
          id: "spot-exclusive-owner-exclusive-first",
          fileId: exclusiveFirstFileId,
          suffix: "EXCLUSIVE-FIRST"
        })
      ),
    blockedQueryNeedle: "ProjectOwnerContract",
    label: "独占业务入口先写时的旧文件绑定竞态"
  });

  const legalSharedFileId = "spot-legal-pdf-archive-file";
  await createExecutionVoucher(legalSharedFileId);
  await clientA.$transaction(async (tx) => {
    await tx.pdfDocument.create({
      data: {
        id: "spot-legal-pdf-document",
        businessType: "spot_guard_verification",
        businessId: "spot-legal-pdf-business",
        fileId: legalSharedFileId,
        templateKey: "spot_guard_verification_v1"
      }
    });
    await tx.archiveRecord.create({
      data: {
        id: "spot-legal-archive-record",
        businessType: "spot_guard_verification",
        businessId: "spot-legal-pdf-business",
        fileId: legalSharedFileId,
        departmentScope: "finance"
      }
    });
  });
  assert(
    (await clientA.pdfDocument.count({
      where: { fileId: legalSharedFileId }
    })) === 1 &&
      (await clientA.archiveRecord.count({
        where: { fileId: legalSharedFileId }
      })) === 1,
    "非独占 PDF 与归档记录必须继续允许同业务合法双写"
  );

  await clientA.projectOwnerContract.update({
    where: { id: "spot-exclusive-owner-old-first" },
    data: {
      status: "effective",
      confirmedByUserId: FINANCE_USER_ID,
      confirmedAt: new Date()
    }
  });
  await expectRejectedFileBinding(
    clientA.projectOwnerContract.update({
      where: { id: "spot-exclusive-owner-old-first" },
      data: { fileId: exclusiveFirstFileId }
    }),
    "旧业务文件列 UPDATE 指向独占文件"
  );

  console.log(
    "ok exclusive file binding guard: both race orders, legal dual binding, status update and file-column update"
  );
}

async function expectRejectedFileBinding(promise, label) {
  try {
    await promise;
  } catch (error) {
    assert(
      isExclusiveFileBindingConflict(error),
      `${label} 必须以文件绑定冲突失败，实际 ${errorText(error)}`
    );
    return;
  }
  throw new Error(`${label} 不应成功`);
}

async function verifyExclusiveFileBindingAgainstReplacementChain() {
  const replacementFirstFileId =
    "spot-exclusive-replacement-old-target";
  const replacementFirstNewFileId =
    "spot-exclusive-replacement-new-file";
  await Promise.all([
    createExecutionVoucher(replacementFirstFileId),
    createExecutionVoucher(replacementFirstNewFileId)
  ]);
  const replacementFirstPayment =
    await createExclusiveRacePayment("REPLACEMENT-FIRST");
  await runHeldFileBindingRace({
    firstWrite: (tx) =>
      tx.fileObject.update({
        where: { id: replacementFirstNewFileId },
        data: {
          supersedesFileObjectId: replacementFirstFileId
        }
      }),
    secondWrite: () =>
      clientB.$transaction((tx) =>
        createExclusiveExecutionBinding(tx, {
          id: "spot-exclusive-execution-replacement-first",
          paymentId: replacementFirstPayment.id,
          fileId: replacementFirstFileId,
          suffix: "replacement-first"
        })
      ),
    blockedQueryNeedle: "pg_advisory_xact_lock",
    label: "替换链先写时的独占文件竞态"
  });

  const exclusiveFirstFileId =
    "spot-exclusive-replacement-exclusive-target";
  const exclusiveFirstNewFileId =
    "spot-exclusive-replacement-exclusive-new";
  await Promise.all([
    createExecutionVoucher(exclusiveFirstFileId),
    createExecutionVoucher(exclusiveFirstNewFileId)
  ]);
  const exclusiveFirstPayment =
    await createExclusiveRacePayment(
      "REPLACEMENT-EXCLUSIVE-FIRST"
    );
  await runHeldFileBindingRace({
    firstWrite: (tx) =>
      createExclusiveExecutionBinding(tx, {
        id: "spot-exclusive-execution-replacement-exclusive",
        paymentId: exclusiveFirstPayment.id,
        fileId: exclusiveFirstFileId,
        suffix: "replacement-exclusive-first"
      }),
    secondWrite: () =>
      clientB.$executeRaw(
        Prisma.sql`
          UPDATE "FileObject"
          SET "supersedesFileObjectId" = ${exclusiveFirstFileId}
          WHERE "id" = ${exclusiveFirstNewFileId}
        `
      ),
    blockedQueryNeedle: "supersedesFileObjectId",
    label: "独占文件先写时的替换链竞态"
  });

  console.log(
    "ok exclusive file replacement guard: both race orders leave one binding fact"
  );
}

async function verifyExecutionProjectSerialization(
  servicesA,
  servicesB
) {
  const inputs = [];
  for (const suffix of ["a", "b"]) {
    const procurementId = `spot-execution-project-lock-${suffix}`;
    const payment = await createExecutionReadyPayment({
      procurementId,
      versionId: `${procurementId}-v1`,
      procurementCode: `LXCG-EXEC-LOCK-${suffix.toUpperCase()}`,
      paymentId: `${procurementId}-payment`,
      paymentCode: `LXCG-EXEC-LOCK-${suffix.toUpperCase()}-P001`,
      supplierKey: `spot-execution-lock-supplier-${suffix}`,
      supplierName: `项目锁串行供应商 ${suffix.toUpperCase()}`,
      settlementAmountCents: 3_000n
    });
    const voucherFileId = `spot-execution-project-lock-voucher-${suffix}`;
    await createExecutionVoucher(voucherFileId);
    inputs.push({
      payment,
      voucherFileId,
      idempotencyKey: `spot-execution-project-lock-key-${suffix}`
    });
  }
  const before = await readProjectCash(EXECUTION_PROJECT_ID);
  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${EXECUTION_PROJECT_ID} FOR UPDATE`
      ),
    queryNeedle: 'FROM "Project"',
    start: () =>
      inputs.map((input, index) =>
        [servicesA, servicesB][index].payment.recordExecution(
          input.payment.id,
          FINANCE_USER_ID,
          executionInput({
            amountCents: 3_000n,
            voucherFileId: input.voucherFileId,
            idempotencyKey: input.idempotencyKey
          })
        )
      )
  });
  const winnerIndex = assertOneWinner(
    results,
    "不同付款同项目 Serializable 串行竞争"
  );
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  const [afterRacePayments, afterRaceExecutions, afterRaceAudits] =
    await readExecutionFacts(
      inputs.map((input) => input.payment.id)
    );
  assert(
    afterRaceExecutions.length === 1 &&
      afterRaceAudits.length === 1 &&
      afterRacePayments.filter(
        (payment) => payment.status === "paid"
      ).length === 1 &&
      afterRacePayments.filter(
        (payment) =>
          payment.status === "approved_pending_payment"
      ).length === 1,
    "项目锁竞争失败方必须零 execution、零 audit 且付款状态不变"
  );
  await [servicesA, servicesB][
    loserIndex
  ].payment.recordExecution(
    inputs[loserIndex].payment.id,
    FINANCE_USER_ID,
    executionInput({
      amountCents: 3_000n,
      voucherFileId: inputs[loserIndex].voucherFileId,
      idempotencyKey: inputs[loserIndex].idempotencyKey
    })
  );
  const after = await readProjectCash(EXECUTION_PROJECT_ID);
  assertBigint(
    after.actualPaidCents - before.actualPaidCents,
    6_000n,
    "项目锁串行后的实际已付增量"
  );
  assertBigint(
    before.occupiedCents - after.occupiedCents,
    6_000n,
    "项目锁串行后的占用释放量"
  );
  assertBigint(
    before.actualPaidCents + before.occupiedCents,
    after.actualPaidCents + after.occupiedCents,
    "项目锁串行前后已付加占用守恒"
  );
  assert(
    after.availableCents >= before.availableCents,
    "项目锁串行后可用资金不得下降"
  );
  assert(
    after.actualPaidCents + after.occupiedCents <=
      after.actualReceiptsCents,
    "项目锁串行后总承诺不得超过项目实收"
  );
  const paymentIds = inputs.map((input) => input.payment.id);
  const [payments, executions, audits] =
    await readExecutionFacts(paymentIds);
  assert(
    payments.every(
      (payment) =>
        payment.status === "paid" &&
        payment.paidAmountCents ===
          payment.companyPaymentAmountCents
    ) &&
      executions.length === 2 &&
      audits.length === 2,
    "项目锁串行的两笔付款都必须各自不超批准额度且完整留痕"
  );
  console.log(
    "ok spot execution project serialization: one Serializable winner, clean loser retry, occupied-to-paid cash invariant"
  );
}

async function verifyExecutionCashShortageZeroWrite(servicesA) {
  const procurementId = "spot-execution-cash-short";
  const payment = await createExecutionReadyPayment({
    projectId: CASH_SHORT_PROJECT_ID,
    procurementId,
    versionId: `${procurementId}-v1`,
    procurementCode: "LXCG-EXEC-CASH-SHORT",
    paymentId: `${procurementId}-payment`,
    paymentCode: "LXCG-EXEC-CASH-SHORT-P001",
    supplierKey: "spot-execution-cash-short-supplier",
    supplierName: "现金不足验收供应商",
    settlementAmountCents: 1_000n
  });
  const voucherFileId = "spot-execution-cash-short-voucher";
  await createExecutionVoucher(voucherFileId);
  const before = await readExecutionFacts([payment.id]);
  const error = await servicesA.payment
    .recordExecution(
      payment.id,
      FINANCE_USER_ID,
      executionInput({
        amountCents: 1_000n,
        voucherFileId,
        idempotencyKey: "spot-execution-cash-short-key"
      })
    )
    .then(
      () => null,
      (caught) => caught
    );
  assert(
    error?.message ===
      "项目可用资金不足，当前最多可实际支付 0 分",
    `现金不足必须固定中文阻断，实际 ${errorText(error)}`
  );
  const after = await readExecutionFacts([payment.id]);
  assertUnchanged(before[0], after[0], "现金不足付款");
  assertUnchanged(before[1], after[1], "现金不足 execution");
  assertUnchanged(before[2], after[2], "现金不足 audit");
  console.log(
    "ok spot execution cash shortage: transaction leaves payment/execution/audit unchanged"
  );
}

function createBarrier(parties, timeoutMs = 5_000) {
  let arrived = 0;
  const gate = deferred();
  const timer = setTimeout(
    () => gate.reject(new Error("原始 P2034 并发屏障超时")),
    timeoutMs
  );
  return async () => {
    arrived += 1;
    if (arrived === parties) {
      clearTimeout(timer);
      gate.resolve();
    }
    await gate.promise;
  };
}

async function verifyRawP2034Sentinel() {
  const account = await clientA.supplierBalanceAccount.create({
    data: {
      id: "spot-concurrency-p2034-account",
      projectId: PROJECT_ID,
      supplierKey: "spot-concurrency-p2034-supplier",
      supplierNameSnapshot: "P2034 哨兵供应商",
      availableAmountCents: 100n,
      reservedAmountCents: 0n
    }
  });
  const barrier = createBarrier(2);
  const mutate = (client) =>
    client.$transaction(
      async (tx) => {
        const snapshot =
          await tx.supplierBalanceAccount.findUniqueOrThrow({
            where: { id: account.id }
          });
        await barrier();
        await tx.supplierBalanceAccount.update({
          where: { id: account.id },
          data: {
            availableAmountCents:
              snapshot.availableAmountCents + 1n
          }
        });
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 15_000
      }
    );
  const results = await Promise.allSettled([
    mutate(clientA),
    mutate(clientB)
  ]);
  assertOneWinner(results, "原始 PostgreSQL Serializable 冲突哨兵", {
    rawP2034: true
  });
  const persisted =
    await clientA.supplierBalanceAccount.findUniqueOrThrow({
      where: { id: account.id }
    });
  assertBigint(
    persisted.availableAmountCents,
    101n,
    "P2034 哨兵最终金额"
  );
  console.log(
    "ok raw P2034 sentinel: PostgreSQL 16 Serializable conflict preserved by Prisma"
  );
}

async function verifyReceiptRootSubmissionAndReview(
  servicesA,
  servicesB
) {
  const procurementId = "spot-receipt-live";
  const versionId = `${procurementId}-v1`;
  const lineIds = [
    `${procurementId}-line-1`,
    `${procurementId}-line-2`
  ];
  await createApprovedProcurement(clientA, {
    procurementId,
    versionId,
    code: "LXCG-RECEIPT-LIVE",
    supplierKey: "spot-receipt-live-supplier",
    supplierName: "收货真实事务验收供应商",
    totalAmountCents: 53_350n
  });
  await clientA.spotProcurementLine.createMany({
    data: [
      {
        id: lineIds[0],
        versionId,
        sortOrder: 1,
        materialName: "免烧砖",
        unit: "块",
        quantity: new Prisma.Decimal("10"),
        invoiceMode: "no_invoice",
        unitPrice: new Prisma.Decimal("3.335"),
        amountCents: 3_335n
      },
      {
        id: lineIds[1],
        versionId,
        sortOrder: 2,
        materialName: "水泥",
        unit: "袋",
        quantity: new Prisma.Decimal("5"),
        invoiceMode: "no_invoice",
        unitPrice: new Prisma.Decimal("10"),
        amountCents: 5_000n
      }
    ]
  });

  // 收货入口以第一次实际付款为开关；这里按真实 A5 付款事实准备
  // 已完成付款和各材料的冻结单价，而不是沿用已废止的 A4 价格列。
  const paymentId = `${procurementId}-payment-1`;
  const paymentChannelId = `${paymentId}-cash`;
  await clientA.spotProcurementPayment.create({
    data: {
      id: paymentId,
      projectId: PROJECT_ID,
      procurementId,
      procurementVersionId: versionId,
      code: `${procurementId}-P001`,
      status: "paid",
      settlementAmountCents: 8_335n,
      supplierBalanceAmountCents: 0n,
      companyPaymentAmountCents: 8_335n,
      paidAmountCents: 8_335n,
      executedSupplierBalanceAmountCents: 0n,
      canceledAmountCents: 0n,
      canceledCompanyPaymentAmountCents: 0n,
      canceledSupplierBalanceAmountCents: 0n,
      paymentPath: "supplier_direct",
      paymentMethod: "cash",
      paymentType: "company_direct",
      merchantNameSnapshot: "收货真实事务验收商户",
      payeeNameSnapshot: "收货真实事务验收收款方",
      approvalAmountCents: 8_335n,
      handlerUserId: HANDLER_USER_ID,
      createdByUserId: HANDLER_USER_ID
    }
  });
  await clientA.spotProcurementPaymentLine.createMany({
    data: [
      {
        id: `${paymentId}-line-1`,
        paymentId,
        procurementVersionId: versionId,
        procurementLineId: lineIds[0],
        sortOrder: 1,
        approvedQuantitySnapshot: new Prisma.Decimal("10"),
        paymentQuantity: new Prisma.Decimal("10"),
        unitPrice: new Prisma.Decimal("3.335"),
        amountCents: 3_335n,
        expectedInvoiceCondition: "no_invoice"
      },
      {
        id: `${paymentId}-line-2`,
        paymentId,
        procurementVersionId: versionId,
        procurementLineId: lineIds[1],
        sortOrder: 2,
        approvedQuantitySnapshot: new Prisma.Decimal("5"),
        paymentQuantity: new Prisma.Decimal("5"),
        unitPrice: new Prisma.Decimal("10"),
        amountCents: 5_000n,
        expectedInvoiceCondition: "no_invoice"
      }
    ]
  });
  await clientA.spotProcurementPaymentChannel.create({
    data: {
      id: paymentChannelId,
      paymentId,
      sortOrder: 1,
      channelType: "cash",
      isPrimary: true
    }
  });
  await clientA.spotProcurementPayment.update({
    where: { id: paymentId },
    data: { primaryPaymentChannelId: paymentChannelId }
  });
  await clientA.spotProcurementPaymentExecution.create({
    data: {
      id: `${paymentId}-execution-1`,
      paymentId,
      amountCents: 8_335n,
      paidAt: new Date("2026-07-18T09:00:00.000Z"),
      paymentMethod: "cash",
      paymentChannelId,
      executedByUserId: FINANCE_USER_ID,
      idempotencyKey: `${paymentId}-execution-key`
    }
  });

  let deferredConstraintFailed = false;
  try {
    await clientA.$transaction(async (tx) => {
      await tx.spotProcurementReceipt.create({
        data: {
          id: "spot-receipt-orphan-root",
          projectId: PROJECT_ID,
          procurementId,
          procurementVersionId: versionId,
          status: "draft",
          currentRevisionNo: 1,
          handlerUserId: HANDLER_USER_ID,
          actualCostCents: 0n,
          createdByUserId: HANDLER_USER_ID
        }
      });
    });
  } catch {
    deferredConstraintFailed = true;
  }
  assert(
    deferredConstraintFailed,
    "缺少首个收货修订时，延迟当前指针外键必须在提交时失败"
  );
  assert(
    (await clientA.spotProcurementReceipt.count({
      where: { id: "spot-receipt-orphan-root" }
    })) === 0,
    "延迟外键失败不得留下孤立收货根单"
  );

  const receipt = await clientA.$transaction(async (tx) => {
    const root = await tx.spotProcurementReceipt.create({
      data: {
        id: "spot-receipt-live-root",
        projectId: PROJECT_ID,
        procurementId,
        procurementVersionId: versionId,
        status: "draft",
        currentRevisionNo: 1,
        handlerUserId: HANDLER_USER_ID,
        actualCostCents: 0n,
        createdByUserId: HANDLER_USER_ID
      }
    });
    await tx.spotProcurementReceiptRevision.create({
      data: {
        id: "spot-receipt-live-revision-1",
        receiptId: root.id,
        revisionNo: 1,
        procurementId,
        procurementVersionId: versionId,
        handlerUserId: HANDLER_USER_ID,
        actualCostCents: 0n,
        createdByUserId: HANDLER_USER_ID
      }
    });
    return root;
  });

  const draft = await servicesA.receipt.updateDraft(
    procurementId,
    HANDLER_USER_ID,
    {
      note: "一次性到货真实事务验收",
      lines: [
        {
          procurementLineId: lineIds[0],
          qualifiedQuantity: "2",
          unqualifiedQuantity: "1",
          unqualifiedReason: "破损",
          freeGiftQuantity: "100",
          replenishmentPending: false,
          discrepancyNote: "赠品和不合格数量均不计成本"
        },
        {
          procurementLineId: lineIds[1],
          qualifiedQuantity: "1",
          unqualifiedQuantity: "0",
          freeGiftQuantity: "0",
          replenishmentPending: false
        }
      ]
    }
  );
  assert(
    draft.actualCostCents === "1667",
    `收货草稿实际成本应为 1667 分，实际 ${draft.actualCostCents}`
  );

  const originalFileId = "spot-receipt-live-original";
  const watermarkedFileId = "spot-receipt-live-watermarked";
  const originalSha =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const watermarkedSha =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await clientA.fileObject.createMany({
    data: [
      {
        id: originalFileId,
        bucket: "local-private",
        objectKey: "spot-receipt-live/original.jpg",
        originalName: "现场原图.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 6,
        uploadedByUserId: HANDLER_USER_ID,
        contentSha256: originalSha,
        storageStatus: "active"
      },
      {
        id: watermarkedFileId,
        bucket: "local-private",
        objectKey: "spot-receipt-live/watermarked.jpg",
        originalName: "现场水印图.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 12,
        uploadedByUserId: HANDLER_USER_ID,
        contentSha256: watermarkedSha,
        storageStatus: "active"
      }
    ]
  });
  await clientA.spotProcurementReceiptPhoto.create({
    data: {
      receiptId: receipt.id,
      receiptRevisionNo: 1,
      originalFileId,
      watermarkedFileId,
      originalSha256: originalSha,
      watermarkedSha256: watermarkedSha,
      source: "album",
      category: "material_scene",
      serverRecordedAt: new Date(),
      note: "免烧砖",
      uploadedByUserId: HANDLER_USER_ID
    }
  });

  const submitted = await servicesA.receipt.submit(
    procurementId,
    HANDLER_USER_ID
  );
  assert(
    submitted.status === "submitted" &&
      submitted.actualCostCents === "1667",
    "最终收货提交必须保存后端重算的实际成本"
  );
  const [persistedRoot, persistedRevision, persistedProcurement, photos] =
    await Promise.all([
      clientA.spotProcurementReceipt.findUniqueOrThrow({
        where: { id: receipt.id }
      }),
      clientA.spotProcurementReceiptRevision.findUniqueOrThrow({
        where: {
          receiptId_revisionNo: {
            receiptId: receipt.id,
            revisionNo: 1
          }
        }
      }),
      clientA.spotProcurement.findUniqueOrThrow({
        where: { id: procurementId }
      }),
      clientA.spotProcurementReceiptPhoto.findMany({
        where: { receiptId: receipt.id }
      })
    ]);
  assert(
    persistedRoot.status === "submitted" &&
      persistedRoot.actualCostCents === 1_667n &&
      persistedRoot.submittedByUserId === HANDLER_USER_ID,
    "收货根单提交 tuple 或实际成本不正确"
  );
  assert(
    persistedRevision.actualCostCents === 1_667n &&
      persistedRevision.submittedByUserId === HANDLER_USER_ID,
    "当前收货修订提交 tuple 或实际成本不正确"
  );
  assertBigint(
    persistedProcurement.actualCostCents,
    1_667n,
    "采购根单最终实际成本"
  );
  assert(
    photos.length === 1 &&
      photos[0].lockedAtFirstSubmission &&
      photos[0].lockedAt instanceof Date,
    "首次提交必须锁定当前收货修订的全部照片"
  );

  const reviewResults = await Promise.allSettled([
    servicesA.receipt.review(
      procurementId,
      MATERIAL_DIRECTOR_USER_ID,
      {
        decision: "approved",
        comment: "真实 PostgreSQL 并发复核通过"
      }
    ),
    servicesB.receipt.review(
      procurementId,
      MATERIAL_DIRECTOR_USER_ID,
      {
        decision: "approved",
        comment: "真实 PostgreSQL 并发复核通过"
      }
    )
  ]);
  assertOneWinner(reviewResults, "同一收货修订并发复核");
  const approvedReview =
    await clientA.spotProcurementReceiptReview.findFirstOrThrow({
      where: {
        receiptId: receipt.id,
        decision: "approved"
      }
    });
  const reviewedRoot =
    await clientA.spotProcurementReceipt.findUniqueOrThrow({
      where: { id: receipt.id }
    });
  assert(
    reviewedRoot.status === "reviewed" &&
      reviewedRoot.currentRevisionNo === 1 &&
      approvedReview.sequenceNo === 1,
    "并发复核后必须只保留一条有效复核并保持原修订"
  );

  const revokeResults = await Promise.allSettled([
    servicesA.receipt.revokeReview(
      procurementId,
      MATERIAL_DIRECTOR_USER_ID,
      {
        targetReviewId: approvedReview.id,
        reason: "真实 PostgreSQL 并发撤销复核",
        confirmReviewRevocation: true
      }
    ),
    servicesB.receipt.revokeReview(
      procurementId,
      MATERIAL_DIRECTOR_USER_ID,
      {
        targetReviewId: approvedReview.id,
        reason: "真实 PostgreSQL 并发撤销复核",
        confirmReviewRevocation: true
      }
    )
  ]);
  assertOneWinner(revokeResults, "同一有效复核并发撤销");
  const [revokedRoot, persistedReviews, revisionTwoLines] =
    await Promise.all([
      clientA.spotProcurementReceipt.findUniqueOrThrow({
        where: { id: receipt.id }
      }),
      clientA.spotProcurementReceiptReview.findMany({
        where: { receiptId: receipt.id },
        orderBy: { sequenceNo: "asc" }
      }),
      clientA.spotProcurementReceiptLine.findMany({
        where: {
          receiptId: receipt.id,
          receiptRevisionNo: 2
        }
      })
    ]);
  assert(
    revokedRoot.status === "review_revoked" &&
      revokedRoot.currentRevisionNo === 2 &&
      persistedReviews.length === 2 &&
      persistedReviews[1].decision === "revoked" &&
      persistedReviews[1].targetReviewId === approvedReview.id &&
      revisionTwoLines.length === 2,
    "撤销复核必须保留旧修订和复核历史，并推进唯一可编辑新修订"
  );
  console.log(
    "ok spot receipt lifecycle: deferred root/revision, exact costs, submit tuple, one review winner and one revoke winner"
  );
  return receipt.id;
}

async function verifyReceiptPdfLatestPointerConcurrency(
  receiptId
) {
  const snapshotTime = new Date(
    "2026-07-17T10:00:00.000Z"
  );
  const snapshot = {
    token: {
      receiptId,
      receiptUpdatedAt: snapshotTime.toISOString(),
      currentRevisionNo: 2,
      receiptStatus: "review_revoked",
      sourceRevisionNo: 1,
      sourceRevisionUpdatedAt: snapshotTime.toISOString(),
      reviewId: "concurrency-revoked-review",
      latestReviewId: "concurrency-revoked-review",
      factFingerprint: "c".repeat(64)
    },
    renderInput: {
      procurementCode: "LXCG-RECEIPT-LIVE",
      receiptRevisionNo: 1
    },
    photoFacts: []
  };
  const sequence = { value: 0 };
  const fileServiceFor = (prisma) => ({
    getFileBuffer: async () => {
      throw new Error("PDF 指针并发验收不应读取照片");
    },
    uploadPrivateFile: async (input) => {
      sequence.value += 1;
      const id = `spot-receipt-pdf-race-${sequence.value}`;
      return prisma.fileObject.create({
        data: {
          id,
          bucket: "local-private",
          objectKey: `spot-receipt-pdf-race/${id}.pdf`,
          originalName: input.originalName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedByUserId: input.uploadedByUserId,
          contentSha256: createHash("sha256")
            .update(input.buffer)
            .digest("hex"),
          storageStatus: "active"
        }
      });
    },
    linkFileReplacement: async (
      tx,
      { newFileId, oldFileId }
    ) =>
      tx.fileObject.update({
        where: { id: newFileId },
        data: { supersedesFileObjectId: oldFileId }
      })
  });
  const serviceA = new SpotProcurementReceiptPdfService(
    clientA,
    fileServiceFor(clientA),
    new AuditService()
  );
  const serviceB = new SpotProcurementReceiptPdfService(
    clientB,
    fileServiceFor(clientB),
    new AuditService()
  );
  const phaseABarrier = createBarrier(2);
  for (const service of [serviceA, serviceB]) {
    service.loadSourceSnapshot = async () => snapshot;
    service.loadWatermarkedEvidence = async () => [];
    service.renderPdf = async () =>
      Buffer.from("%PDF-1.7 receipt pointer race");
    const findCurrent =
      service.findCurrentPdfForSnapshot.bind(service);
    let findCount = 0;
    service.findCurrentPdfForSnapshot = async (...args) => {
      const current = await findCurrent(...args);
      findCount += 1;
      if (findCount === 1) {
        await phaseABarrier();
      }
      return current;
    };
  }

  const results = await Promise.allSettled([
    serviceA.refreshLatest(
      receiptId,
      MATERIAL_DIRECTOR_USER_ID,
      "receipt.review.revoked",
      {
        sourceRevisionNo: 1,
        reviewId: "concurrency-revoked-review"
      }
    ),
    serviceB.refreshLatest(
      receiptId,
      MATERIAL_DIRECTOR_USER_ID,
      "receipt.review.revoked",
      {
        sourceRevisionNo: 1,
        reviewId: "concurrency-revoked-review"
      }
    )
  ]);
  assert(
    results.every((result) => result.status === "fulfilled"),
    `收货 PDF 并发刷新应幂等成功，实际 ${results
      .map((result) => result.status)
      .join("/")}`
  );
  const [documents, generatedFiles, refreshAuditCount] =
    await Promise.all([
      clientA.pdfDocument.findMany({
        where: {
          businessType: "spot_procurement_receipt",
          businessId: receiptId,
          templateKey: "spot_procurement_receipt_v1"
        }
      }),
      clientA.fileObject.findMany({
        where: {
          objectKey: {
            startsWith: "spot-receipt-pdf-race/"
          }
        }
      }),
      clientA.auditLog.count({
        where: {
          action: "spot_procurement.receipt.pdf.refresh",
          businessType: "spot_procurement_receipt",
          businessId: receiptId
        }
      })
    ]);
  assert(
    documents.length === 1 &&
      generatedFiles.length === 2 &&
      generatedFiles.filter(
        (file) => file.storageStatus === "active"
      ).length === 1 &&
      generatedFiles.filter(
        (file) => file.storageStatus === "quarantined"
      ).length === 1 &&
      generatedFiles.some(
        (file) =>
          file.id === documents[0].fileId &&
          file.storageStatus === "active"
      ) &&
      refreshAuditCount === 1,
    "并发刷新必须只留下一个当前 PDF 指针，并隔离未关联派生文件"
  );
  console.log(
    "ok spot receipt PDF concurrency: one current pointer, one refresh audit and orphan quarantine"
  );
}

async function verifyReceiptCrossColumnFileCompetition() {
  const procurements = [
    {
      procurementId: "spot-receipt-file-race-a",
      versionId: "spot-receipt-file-race-a-v1",
      receiptId: "spot-receipt-file-race-a-root",
      revisionId: "spot-receipt-file-race-a-revision-1",
      code: "LXCG-RECEIPT-FILE-RACE-A"
    },
    {
      procurementId: "spot-receipt-file-race-b",
      versionId: "spot-receipt-file-race-b-v1",
      receiptId: "spot-receipt-file-race-b-root",
      revisionId: "spot-receipt-file-race-b-revision-1",
      code: "LXCG-RECEIPT-FILE-RACE-B"
    }
  ];
  for (const item of procurements) {
    await createApprovedProcurement(clientA, {
      procurementId: item.procurementId,
      versionId: item.versionId,
      code: item.code,
      supplierKey: `${item.procurementId}-supplier`,
      supplierName: "收货文件跨列竞争供应商",
      totalAmountCents: 100n
    });
    await clientA.$transaction(async (tx) => {
      await tx.spotProcurementReceipt.create({
        data: {
          id: item.receiptId,
          projectId: PROJECT_ID,
          procurementId: item.procurementId,
          procurementVersionId: item.versionId,
          status: "draft",
          currentRevisionNo: 1,
          handlerUserId: HANDLER_USER_ID,
          actualCostCents: 0n,
          createdByUserId: HANDLER_USER_ID
        }
      });
      await tx.spotProcurementReceiptRevision.create({
        data: {
          id: item.revisionId,
          receiptId: item.receiptId,
          revisionNo: 1,
          procurementId: item.procurementId,
          procurementVersionId: item.versionId,
          handlerUserId: HANDLER_USER_ID,
          actualCostCents: 0n,
          createdByUserId: HANDLER_USER_ID
        }
      });
    });
    const paymentId = `${item.procurementId}-payment-1`;
    await clientA.spotProcurementPayment.create({
      data: {
        id: paymentId,
        projectId: PROJECT_ID,
        procurementId: item.procurementId,
        procurementVersionId: item.versionId,
        code: `${item.code}-P001`,
        status: "paid",
        settlementAmountCents: 100n,
        supplierBalanceAmountCents: 0n,
        companyPaymentAmountCents: 100n,
        paidAmountCents: 100n,
        executedSupplierBalanceAmountCents: 0n,
        canceledAmountCents: 0n,
        canceledCompanyPaymentAmountCents: 0n,
        canceledSupplierBalanceAmountCents: 0n,
        paymentPath: "supplier_direct",
        paymentMethod: "cash",
        payeeNameSnapshot: "收货文件竞争收款方",
        handlerUserId: HANDLER_USER_ID,
        createdByUserId: HANDLER_USER_ID
      }
    });
    await clientA.spotProcurementPaymentExecution.create({
      data: {
        id: `${paymentId}-execution-1`,
        paymentId,
        amountCents: 100n,
        paidAt: new Date("2026-07-18T09:00:00.000Z"),
        paymentMethod: "cash",
        executedByUserId: FINANCE_USER_ID,
        idempotencyKey: `${paymentId}-execution-key`
      }
    });
  }

  const jpeg = (marker) =>
    Buffer.from([0xff, 0xd8, marker, marker, 0xff, 0xd9]);
  const buffers = new Map([
    ["spot-receipt-race-file-x", jpeg(0x11)],
    ["spot-receipt-race-file-y", jpeg(0x22)],
    ["spot-receipt-race-file-z", jpeg(0x33)],
    ["spot-receipt-race-shared-y", jpeg(0x22)],
    ["spot-receipt-restricted-owner-contract", jpeg(0x44)]
  ]);
  const hash = (buffer) =>
    createHash("sha256").update(buffer).digest("hex");
  await clientA.fileObject.createMany({
    data: [...buffers].map(([id, buffer]) => ({
      id,
      bucket: "local-private",
      objectKey: `spot-receipt-race/${id}.jpg`,
      originalName: `${id}.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: buffer.length,
      uploadedByUserId: HANDLER_USER_ID,
      contentSha256: hash(buffer),
      storageStatus: "active"
    }))
  });
  await clientA.projectOwnerContract.create({
    data: {
      id: "spot-receipt-restricted-owner-contract",
      projectId: CASH_SHORT_PROJECT_ID,
      ownerName: "受限甲方",
      contractName: "另一项目受限甲方合同",
      contractCode: "OWNER-RESTRICTED-001",
      signedAt: new Date("2026-07-01T00:00:00.000Z"),
      amountCents: 100n,
      taxRateBps: 900,
      pricingMethod: "fixed_price",
      paymentTermsSummary: "验收专用",
      retentionSummary: "验收专用",
      fileId: "spot-receipt-restricted-owner-contract",
      recordedByUserId: HANDLER_USER_ID,
      status: "pending_confirm",
      fileContentSha256Snapshot: hash(
        buffers.get("spot-receipt-restricted-owner-contract")
      )
    }
  });

  let generatedFileSequence = 0;
  const serviceFor = (prisma) => {
    const audit = new AuditService();
    const fileService = {
      getOwnedVerifiedFileBuffer: async (fileId, actorUserId) => {
        const file = await prisma.fileObject.findUniqueOrThrow({
          where: { id: fileId }
        });
        assert(
          file.uploadedByUserId === actorUserId,
          "跨列竞争原图上传人不匹配"
        );
        return { file, buffer: buffers.get(fileId) };
      },
      uploadPrivateFile: async (input) => {
        const digest = hash(input.buffer);
        if (
          digest === hash(buffers.get("spot-receipt-race-file-y"))
        ) {
          return prisma.fileObject.findUniqueOrThrow({
            where: { id: "spot-receipt-race-shared-y" }
          });
        }
        const id = `spot-receipt-generated-${++generatedFileSequence}`;
        buffers.set(id, Buffer.from(input.buffer));
        return prisma.fileObject.create({
          data: {
            id,
            bucket: "local-private",
            objectKey: `spot-receipt-generated/${id}.jpg`,
            originalName: input.originalName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            uploadedByUserId: input.uploadedByUserId,
            contentSha256: digest,
            storageStatus: "active"
          }
        });
      },
      quarantineUnboundReceiptWatermark: async () => false
    };
    const watermark = {
      generate: async (input) => {
        const sourceId = [...buffers].find(([, buffer]) =>
          buffer.equals(input.originalBuffer)
        )?.[0];
        const targetId =
          sourceId === "spot-receipt-race-file-x"
            ? "spot-receipt-race-file-y"
            : "spot-receipt-race-file-z";
        const target = buffers.get(targetId);
        return {
          buffer: target,
          mimeType: "image/jpeg",
          originalSha256: hash(input.originalBuffer),
          watermarkedSha256: hash(target),
          width: 360,
          height: 400
        };
      }
    };
    return new SpotProcurementReceiptService(
      prisma,
      audit,
      new SpotProcurementPilotService(),
      fileService,
      watermark,
      {},
      { tryRefreshLatest: async () => undefined },
      new SpotProcurementClosureService(audit)
    );
  };
  const serviceA = serviceFor(clientA);
  const serviceB = serviceFor(clientB);
  let restrictedSourceRejected = false;
  try {
    await serviceA.attachPhoto(
      procurements[0].procurementId,
      HANDLER_USER_ID,
      {
        originalFileId:
          "spot-receipt-restricted-owner-contract",
        source: "album",
        category: "material_scene"
      }
    );
  } catch (error) {
    restrictedSourceRejected = errorText(error).includes(
      "收货照片文件已被其他业务使用"
    );
  }
  assert(
    restrictedSourceRejected,
    "另一项目甲方合同文件不得被复用为收货原图"
  );
  assert(
    (await clientA.spotProcurementReceiptPhoto.count({
      where: {
        OR: [
          {
            originalFileId:
              "spot-receipt-restricted-owner-contract"
          },
          {
            watermarkedFileId:
              "spot-receipt-restricted-owner-contract"
          }
        ]
      }
    })) === 0,
    "受限甲方合同文件被拒绝后不得留下收货照片绑定"
  );
  console.log(
    "ok spot receipt source isolation: another-project owner contract file rejected"
  );
  const results = await Promise.allSettled([
    serviceA.attachPhoto(
      procurements[0].procurementId,
      HANDLER_USER_ID,
      {
        originalFileId: "spot-receipt-race-file-x",
        source: "album",
        category: "material_scene"
      }
    ),
    serviceB.attachPhoto(
      procurements[1].procurementId,
      HANDLER_USER_ID,
      {
        originalFileId: "spot-receipt-race-file-y",
        source: "camera",
        category: "material_scene"
      }
    )
  ]);
  assertOneWinner(results, "收货照片原图/水印图跨列占用竞争");
  const photos = await clientA.spotProcurementReceiptPhoto.findMany({
    where: {
      receiptId: {
        in: procurements.map((item) => item.receiptId)
      }
    }
  });
  assert(
    photos.length === 1,
    "跨列文件竞争只能留下一个正式收货照片事实"
  );
  const allBoundFileIds = photos.flatMap((photo) => [
    photo.originalFileId,
    photo.watermarkedFileId
  ]);
  assert(
    new Set(allBoundFileIds).size === allBoundFileIds.length,
    "跨列文件竞争后原图和水印图不得复用同一文件"
  );
  assert(
    photos.every(
      (photo) =>
        ![
          "spot-receipt-race-file-x",
          "spot-receipt-race-file-y"
        ].includes(photo.originalFileId)
    ),
    "正式收货照片必须绑定服务端专用原图副本，不能绑定客户端上传源"
  );
  const dedicatedOriginals = await clientA.fileObject.findMany({
    where: {
      id: { in: photos.map((photo) => photo.originalFileId) }
    }
  });
  assert(
    dedicatedOriginals.every(
      (file) => file.supersedesFileObjectId === null
    ),
    "收货专用原图副本不得接入其它文件替换链"
  );
  console.log(
    "ok spot receipt cross-column file race: shared FileObject lock leaves one winner"
  );
}

async function assertInvoiceAllocationCaches() {
  const records = await clientA.invoiceRecord.findMany({
    where: { sourceBusinessType: "spot_procurement" },
    orderBy: { id: "asc" }
  });
  const lines = await clientA.invoiceLine.findMany({
    where: { invoiceRecordId: { in: records.map((row) => row.id) } },
    orderBy: { id: "asc" }
  });
  const allocations = await clientA.invoiceAllocation.findMany({
    where: {
      invoiceLineId: { in: lines.map((row) => row.id) },
      invalidatedAt: null
    },
    orderBy: { id: "asc" }
  });
  const activeByLineId = new Map();
  for (const allocation of allocations) {
    activeByLineId.set(
      allocation.invoiceLineId,
      (activeByLineId.get(allocation.invoiceLineId) ?? 0n) +
        allocation.amountCents
    );
  }
  const activeByRecordId = new Map();
  for (const line of lines) {
    const active = activeByLineId.get(line.id) ?? 0n;
    assertBigint(
      line.allocatedAmountCents,
      active,
      `发票行 ${line.id} 有效分摊缓存`
    );
    activeByRecordId.set(
      line.invoiceRecordId,
      (activeByRecordId.get(line.invoiceRecordId) ?? 0n) + active
    );
  }
  for (const record of records) {
    assertBigint(
      record.allocatedAmountCents,
      activeByRecordId.get(record.id) ?? 0n,
      `发票 ${record.id} 有效分摊缓存`
    );
  }
}

async function verifyInvoiceLedgerConcurrency(
  servicesA,
  servicesB
) {
  const identityFixtures = await Promise.all(
    ["a", "b"].map((suffix) =>
      createTicketReadyProcurement({
        procurementId: `ticket-invoice-identity-${suffix}`,
        code: `LXCG-TICKET-IDENTITY-${suffix.toUpperCase()}`,
        lines: [
          { invoiceMode: "invoice", actualCostCents: 5_000n }
        ]
      })
    )
  );
  await Promise.all([
    createTicketFile("ticket-invoice-identity-file-a"),
    createTicketFile("ticket-invoice-identity-file-b")
  ]);
  const identityResults = await Promise.allSettled(
    identityFixtures.map((fixture, index) =>
      [servicesA, servicesB][
        index
      ].invoices.createProcurementInvoice(
        fixture.procurementId,
        HANDLER_USER_ID,
        invoiceInput({
          invoiceCode:
            index === 0
              ? "  ｉｎｖ－ｓｈａｒｅｄ  "
              : "inv-shared",
          invoiceNumber:
            index === 0 ? "２０２６０７１７" : "20260717",
          totalAmountCents: 5_000n,
          fileId: `ticket-invoice-identity-file-${index === 0 ? "a" : "b"}`,
          lines: [
            {
              taxInclusiveAmountCents: 5_000n,
              allocations: [
                {
                  procurementLineId:
                    fixture.procurementLines[0].id,
                  paymentId: fixture.paymentId,
                  amountCents: 5_000n
                }
              ]
            }
          ]
        })
      )
    )
  );
  assertOneWinner(
    identityResults,
    "不同采购和不同文件的等价发票身份并发竞争"
  );
  assert(
    (await clientA.invoiceRecord.count({
      where: {
        invoiceCode: "INV-SHARED",
        invoiceNumber: "20260717"
      }
    })) === 1,
    "NFKC、空白和大小写等价的发票身份只能形成一条记录"
  );

  const invoiceLineFixture = await createTicketReadyProcurement({
    procurementId: "ticket-invoice-line-cap",
    code: "LXCG-TICKET-LINE-CAP",
    lines: [
      { invoiceMode: "invoice", actualCostCents: 10_000n },
      { invoiceMode: "invoice", actualCostCents: 10_000n }
    ]
  });
  await createTicketFile("ticket-invoice-line-cap-file");
  const sameInvoiceBase = {
    invoiceCode: "LINE-CAP",
    invoiceNumber: "20260717",
    totalAmountCents: 10_000n,
    fileId: "ticket-invoice-line-cap-file"
  };
  const invoiceLineResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurement" WHERE "id" = ${invoiceLineFixture.procurementId} FOR UPDATE`
      ),
    queryNeedle: 'FROM "SpotProcurement"',
    start: () => [
      servicesA.invoices.createProcurementInvoice(
        invoiceLineFixture.procurementId,
        HANDLER_USER_ID,
        invoiceInput({
          ...sameInvoiceBase,
          lines: [
            {
              taxInclusiveAmountCents: 10_000n,
              allocations: [
                {
                  procurementLineId:
                    invoiceLineFixture.procurementLines[0].id,
                  paymentId: invoiceLineFixture.paymentId,
                  amountCents: 7_000n
                }
              ]
            }
          ]
        })
      ),
      servicesB.invoices.createProcurementInvoice(
        invoiceLineFixture.procurementId,
        HANDLER_USER_ID,
        invoiceInput({
          ...sameInvoiceBase,
          lines: [
            {
              taxInclusiveAmountCents: 10_000n,
              allocations: [
                {
                  procurementLineId:
                    invoiceLineFixture.procurementLines[1].id,
                  paymentId: invoiceLineFixture.paymentId,
                  amountCents: 7_000n
                }
              ]
            }
          ]
        })
      )
    ]
  });
  assertOneWinner(
    invoiceLineResults,
    "同一发票行累计超票面并发竞争"
  );

  const receiptLineFixture = await createTicketReadyProcurement({
    procurementId: "ticket-receipt-line-cap",
    code: "LXCG-TICKET-RECEIPT-CAP",
    lines: [
      { invoiceMode: "invoice", actualCostCents: 10_000n }
    ]
  });
  await Promise.all([
    createTicketFile("ticket-receipt-cap-file-a"),
    createTicketFile("ticket-receipt-cap-file-b")
  ]);
  const receiptLineResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurement" WHERE "id" = ${receiptLineFixture.procurementId} FOR UPDATE`
      ),
    queryNeedle: 'FROM "SpotProcurement"',
    start: () =>
      ["a", "b"].map((suffix, index) =>
        [servicesA, servicesB][index].invoices.createProcurementInvoice(
          receiptLineFixture.procurementId,
          HANDLER_USER_ID,
          invoiceInput({
            invoiceCode: `RECEIPT-CAP-${suffix.toUpperCase()}`,
            invoiceNumber: "20260717",
            totalAmountCents: 7_000n,
            fileId: `ticket-receipt-cap-file-${suffix}`,
            lines: [
              {
                taxInclusiveAmountCents: 7_000n,
                allocations: [
                  {
                    procurementLineId:
                      receiptLineFixture.procurementLines[0].id,
                    paymentId: receiptLineFixture.paymentId,
                    amountCents: 7_000n
                  }
                ]
              }
            ]
          })
        )
      )
  });
  assertOneWinner(
    receiptLineResults,
    "不同发票并发覆盖同一收货行超实际成本"
  );

  const alternativeFixture = await createTicketReadyProcurement({
    procurementId: "ticket-allocation-exception",
    code: "LXCG-TICKET-ALT",
    lines: [
      { invoiceMode: "invoice", actualCostCents: 10_000n }
    ]
  });
  await Promise.all([
    createTicketFile("ticket-allocation-file"),
    createTicketFile("ticket-exception-proof")
  ]);
  const alternativeResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurement" WHERE "id" = ${alternativeFixture.procurementId} FOR UPDATE`
      ),
    queryNeedle: 'FROM "SpotProcurement"',
    start: () => [
      servicesA.invoices.createProcurementInvoice(
        alternativeFixture.procurementId,
        HANDLER_USER_ID,
        invoiceInput({
          invoiceCode: "ALLOCATION-ALT",
          invoiceNumber: "20260717",
          totalAmountCents: 10_000n,
          fileId: "ticket-allocation-file",
          lines: [
            {
              taxInclusiveAmountCents: 10_000n,
              allocations: [
                {
                  procurementLineId:
                    alternativeFixture.procurementLines[0].id,
                  paymentId: alternativeFixture.paymentId,
                  amountCents: 10_000n
                }
              ]
            }
          ]
        })
      ),
      servicesB.invoices.createInvoiceException(
        alternativeFixture.procurementId,
        HANDLER_USER_ID,
        {
          procurementLineId:
            alternativeFixture.procurementLines[0].id,
          paymentId: alternativeFixture.paymentId,
          amountCents: "10000",
          reason: "供应商最终无法提供冻结条件发票",
          proofFileId: "ticket-exception-proof"
        }
      )
    ]
  });
  assertOneWinner(
    alternativeResults,
    "正常发票分摊与待复核票据异常并发竞争"
  );

  const proofFixtures = await Promise.all(
    ["a", "b"].map((suffix) =>
      createTicketReadyProcurement({
        procurementId: `ticket-proof-exclusive-${suffix}`,
        code: `LXCG-TICKET-PROOF-${suffix.toUpperCase()}`,
        lines: [
          { invoiceMode: "no_invoice", actualCostCents: 5_000n }
        ]
      })
    )
  );
  await createTicketFile("ticket-shared-proof");
  const proofResults = await Promise.allSettled(
    proofFixtures.map((fixture, index) =>
      [servicesA, servicesB][
        index
      ].invoices.createNoInvoiceConfirmation(
        fixture.procurementId,
        HANDLER_USER_ID,
        {
          procurementLineId: fixture.procurementLines[0].id,
          paymentId: fixture.paymentId,
          amountCents: "5000",
          reason: "冻结为无票采购",
          proofFileId: "ticket-shared-proof"
        }
      )
    )
  );
  assertOneWinner(
    proofResults,
    "同一替代证明跨采购独占绑定"
  );
  assert(
    (await clientA.noInvoiceConfirmation.count({
      where: { proofFileId: "ticket-shared-proof" }
    })) === 1,
    "同一替代证明只能留下一个无票确认事实"
  );

  const reviewFixture = await createTicketReadyProcurement({
    procurementId: "ticket-review-race",
    code: "LXCG-TICKET-REVIEW",
    lines: [
      { invoiceMode: "no_invoice", actualCostCents: 5_000n }
    ]
  });
  await createTicketFile("ticket-review-proof");
  const pending =
    await servicesA.invoices.createNoInvoiceConfirmation(
      reviewFixture.procurementId,
      HANDLER_USER_ID,
      {
        procurementLineId: reviewFixture.procurementLines[0].id,
        paymentId: reviewFixture.paymentId,
        amountCents: "5000",
        reason: "冻结为无票采购",
        proofFileId: "ticket-review-proof"
      }
    );
  const reviewResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurement" WHERE "id" = ${reviewFixture.procurementId} FOR UPDATE`
      ),
    queryNeedle: 'FROM "SpotProcurement"',
    start: () => [
      servicesA.invoices.reviewNoInvoiceConfirmation(
        reviewFixture.procurementId,
        pending.id,
        FINANCE_DIRECTOR_USER_ID,
        { operation: "confirm", comment: "确认无票" }
      ),
      servicesB.invoices.reviewNoInvoiceConfirmation(
        reviewFixture.procurementId,
        pending.id,
        FINANCE_DIRECTOR_USER_ID,
        { operation: "return", comment: "退回补充证明" }
      )
    ]
  });
  assertOneWinner(reviewResults, "无票确认与退回状态竞争");

  const allocationReversalFixture =
    await createTicketReadyProcurement({
      procurementId: "ticket-allocation-reversal-race",
      code: "LXCG-TICKET-ALLOCATION-REVERSAL",
      lines: [
        { invoiceMode: "invoice", actualCostCents: 10_000n },
        { invoiceMode: "invoice", actualCostCents: 10_000n }
      ]
    });
  await createTicketFile("ticket-allocation-reversal-file");
  const reversalInvoiceBase = {
    invoiceCode: "ALLOCATION-REVERSAL",
    invoiceNumber: "20260717",
    totalAmountCents: 10_000n,
    fileId: "ticket-allocation-reversal-file"
  };
  const initialAllocation =
    await servicesA.invoices.createProcurementInvoice(
      allocationReversalFixture.procurementId,
      HANDLER_USER_ID,
      invoiceInput({
        ...reversalInvoiceBase,
        lines: [
          {
            taxInclusiveAmountCents: 10_000n,
            allocations: [
              {
                procurementLineId:
                  allocationReversalFixture.procurementLines[0].id,
                paymentId: allocationReversalFixture.paymentId,
                amountCents: 6_000n
              }
            ]
          }
        ]
      })
    );
  const allocationReversalResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurement" WHERE "id" = ${allocationReversalFixture.procurementId} FOR UPDATE`
      ),
    queryNeedle: 'FROM "SpotProcurement"',
    start: () => [
      servicesA.invoices.reverseAllocation(
        initialAllocation.allocations[0].id,
        FINANCE_DIRECTOR_USER_ID,
        {
          reason: "并发验收冲销原分摊",
          confirmReversal: true
        }
      ),
      servicesB.invoices.createProcurementInvoice(
        allocationReversalFixture.procurementId,
        HANDLER_USER_ID,
        invoiceInput({
          ...reversalInvoiceBase,
          lines: [
            {
              taxInclusiveAmountCents: 10_000n,
              allocations: [
                {
                  procurementLineId:
                    allocationReversalFixture.procurementLines[1].id,
                  paymentId: allocationReversalFixture.paymentId,
                  amountCents: 7_000n
                }
              ]
            }
          ]
        })
      )
    ]
  });
  assert(
    allocationReversalResults[0].status === "fulfilled",
    "发票分摊冲销与新增分摊竞态中，冲销必须形成唯一有效结果"
  );
  const reversalInvoiceLineId =
    initialAllocation.invoice.lines[0].id;
  const activeAfterReversalRace =
    await clientA.invoiceAllocation.findMany({
      where: {
        invoiceLineId: reversalInvoiceLineId,
        invalidatedAt: null
      }
    });
  assert(
    activeAfterReversalRace.reduce(
      (total, row) => total + row.amountCents,
      0n
    ) <= 10_000n,
    "发票分摊冲销与新增分摊竞态后不得穿透发票行上限"
  );
  await createTicketFile(
    "ticket-allocation-reversal-replacement-file"
  );
  const replacementAllocation =
    await servicesA.invoices.createProcurementInvoice(
      allocationReversalFixture.procurementId,
      HANDLER_USER_ID,
      invoiceInput({
        invoiceCode: "ALLOCATION-REVERSAL-REPLACEMENT",
        invoiceNumber: "20260717",
        totalAmountCents: 6_000n,
        fileId:
          "ticket-allocation-reversal-replacement-file",
        lines: [
          {
            taxInclusiveAmountCents: 6_000n,
            allocations: [
              {
                procurementLineId:
                  allocationReversalFixture.procurementLines[0].id,
                paymentId:
                  allocationReversalFixture.paymentId,
                amountCents: 6_000n
              }
            ]
          }
        ]
      })
    );
  assert(
    replacementAllocation.allocations.length === 1,
    "原分摊冲销后必须释放采购行、付款和采购根单额度"
  );

  const reverseReviewFixture = await createTicketReadyProcurement({
    procurementId: "ticket-review-reversal-race",
    code: "LXCG-TICKET-REVIEW-REVERSAL",
    lines: [
      { invoiceMode: "no_invoice", actualCostCents: 5_000n }
    ],
    preventClosure: true
  });
  await createTicketFile("ticket-review-reversal-proof");
  const reversePending =
    await servicesA.invoices.createNoInvoiceConfirmation(
      reverseReviewFixture.procurementId,
      HANDLER_USER_ID,
      {
        procurementLineId:
          reverseReviewFixture.procurementLines[0].id,
        paymentId: reverseReviewFixture.paymentId,
        amountCents: "5000",
        reason: "冻结为无票采购",
        proofFileId: "ticket-review-reversal-proof"
      }
    );
  await servicesA.invoices.reviewNoInvoiceConfirmation(
    reverseReviewFixture.procurementId,
    reversePending.id,
    FINANCE_DIRECTOR_USER_ID,
    { operation: "confirm", comment: "先确认无票" }
  );
  const reverseReviewResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurement" WHERE "id" = ${reverseReviewFixture.procurementId} FOR UPDATE`
      ),
    queryNeedle: 'FROM "SpotProcurement"',
    start: () => [
      servicesA.invoices.reviewNoInvoiceConfirmation(
        reverseReviewFixture.procurementId,
        reversePending.id,
        FINANCE_DIRECTOR_USER_ID,
        {
          operation: "reverse",
          comment: "并发冲销原因 A",
          confirmReversal: true
        }
      ),
      servicesB.invoices.reviewNoInvoiceConfirmation(
        reverseReviewFixture.procurementId,
        reversePending.id,
        FINANCE_DIRECTOR_USER_ID,
        {
          operation: "reverse",
          comment: "并发冲销原因 B",
          confirmReversal: true
        }
      )
    ]
  });
  assertOneWinner(reverseReviewResults, "已确认票据事实并发冲销");
  const reversedConfirmation =
    await clientA.noInvoiceConfirmation.findUnique({
      where: { id: reversePending.id }
    });
  assert(
    reversedConfirmation?.status === "reversed",
    "并发冲销后无票事实必须留下唯一已冲销状态"
  );
  await createTicketFile(
    "ticket-review-reversal-replacement-proof"
  );
  const replacementConfirmation =
    await servicesA.invoices.createNoInvoiceConfirmation(
      reverseReviewFixture.procurementId,
      HANDLER_USER_ID,
      {
        procurementLineId:
          reverseReviewFixture.procurementLines[0].id,
        paymentId: reverseReviewFixture.paymentId,
        amountCents: "5000",
        reason: "冲销后补充正确证明",
        proofFileId:
          "ticket-review-reversal-replacement-proof"
      }
    );
  await servicesA.invoices.reviewNoInvoiceConfirmation(
    reverseReviewFixture.procurementId,
    replacementConfirmation.id,
    FINANCE_DIRECTOR_USER_ID,
    {
      operation: "return",
      comment: "验证退回会再次释放票据占用"
    }
  );
  const releasedReceiptReview =
    await servicesA.receipt.revokeReview(
      reverseReviewFixture.procurementId,
      MATERIAL_DIRECTOR_USER_ID,
      {
        targetReviewId: reverseReviewFixture.review.id,
        reason: "全部票据占用解除后重新核对收货",
        confirmReviewRevocation: true
      }
    );
  assert(
    releasedReceiptReview.status === "review_revoked",
    "票据冲销或退回解除全部占用后必须允许撤销收货复核"
  );

  const receiptRaceFixture =
    await createTicketReadyProcurement({
      procurementId: "ticket-receipt-revoke-race",
      code: "LXCG-TICKET-REVOKE",
      lines: [
        { invoiceMode: "no_invoice", actualCostCents: 5_000n }
      ]
    });
  await createTicketFile("ticket-revoke-proof");
  const receiptRaceResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurement" WHERE "id" = ${receiptRaceFixture.procurementId} FOR UPDATE`
      ),
    queryNeedle: 'FROM "SpotProcurement"',
    start: () => [
      servicesA.invoices.createNoInvoiceConfirmation(
        receiptRaceFixture.procurementId,
        HANDLER_USER_ID,
        {
          procurementLineId:
            receiptRaceFixture.procurementLines[0].id,
          paymentId: receiptRaceFixture.paymentId,
          amountCents: "5000",
          reason: "冻结为无票采购",
          proofFileId: "ticket-revoke-proof"
        }
      ),
      servicesB.receipt.revokeReview(
        receiptRaceFixture.procurementId,
        MATERIAL_DIRECTOR_USER_ID,
        {
          targetReviewId: receiptRaceFixture.review.id,
          reason: "票据并发验收撤销复核",
          confirmReviewRevocation: true
        }
      )
    ]
  });
  assertOneWinner(
    receiptRaceResults,
    "票据写入与收货复核撤销竞争"
  );

  await assertInvoiceAllocationCaches();
  console.log(
    "ok invoice ledger concurrency: invoice/receipt caps, pending reserve, exclusive proof, review state and receipt-revoke race"
  );
}

async function main() {
  assertLocalRuntime();
  await Promise.all([
    clientA.$connect(),
    clientB.$connect(),
    observerClient.$connect()
  ]);
  await assertRealFormSchemaPrerequisites(clientA);
  const servicesA = servicesFor(clientA);
  const servicesB = servicesFor(clientB);
  await seedVerificationFacts();
  await verifyApplicationReviewCoordinateConcurrency();
  await verifyCumulativeCapacityCompetition(servicesA, servicesB);
  await verifyBalanceCompetitionAndRelease(servicesA, servicesB);
  await verifyMismatchedReservationReleaseFailsClosed(servicesA);
  await verifyExecutionRemainingCompetition(
    servicesA,
    servicesB
  );
  await verifyExecutionIdempotencyConcurrency(
    servicesA,
    servicesB
  );
  await verifyExecutionVoucherUniqueness(
    servicesA,
    servicesB
  );
  await verifyExclusiveFileBindingAcrossLegacyEntries();
  await verifyExclusiveFileBindingAgainstReplacementChain();
  await verifyExecutionProjectSerialization(
    servicesA,
    servicesB
  );
  await verifyExecutionCashShortageZeroWrite(servicesA);
  const reviewedReceiptId =
    await verifyReceiptRootSubmissionAndReview(
      servicesA,
      servicesB
    );
  await verifyReceiptPdfLatestPointerConcurrency(
    reviewedReceiptId
  );
  await verifyReceiptCrossColumnFileCompetition();
  await verifyInvoiceLedgerConcurrency(servicesA, servicesB);
  await verifyRawP2034Sentinel();
  console.log(
    "零星采购真实 PostgreSQL 16 并发验收通过：付款提交、历史余额隔离、补货或退款差异约束、实际付款上限、幂等、凭证唯一、项目现金串行、现金不足零写、收货根/修订、最终收货提交、复核/撤销单胜、PDF 唯一当前指针、收货文件跨列竞争、票据覆盖账本与 P2034"
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await Promise.allSettled([
        clientA.$disconnect(),
        clientB.$disconnect(),
        observerClient.$disconnect()
      ]);
    });
}
