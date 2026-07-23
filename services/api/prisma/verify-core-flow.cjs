const { coreFlowApiVerificationTargets } = require("../dist/database/core-flow-api-verification");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");
const {
  PRECISION_SENTINEL_CENTS,
  TARGET_CONTRACT_CENTS,
  assertExactMoneyFields,
  assertExactMoneyText,
  assertLocalMoneyVerificationRuntime
} = require("../dist/database/money-bigint-live-verification");
const { Prisma, PrismaClient } = require("@prisma/client");

const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3000";
const prisma = new PrismaClient();

// 与 prisma/seed.cjs 中 testPassword 一致；所有 seed 账号同一初始密码。
const PASSWORD = process.env.SEED_PASSWORD || "Jgzg@2026";
const PHONES = {
  contractStaff: coreFlowSeedData.users.contractStaff.phone,
  cashier: coreFlowSeedData.users.cashier.phone,
  chairman: "13800001001",
  projectManager: "13800001003",
  contractDirector: "13800001004",
  financeDirector: "13800001007",
  materialStaff: "13800001009",
  materialDirector: "13800001008",
  comprehensiveDirector: "13800001013"
};

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function login(phone) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password: PASSWORD })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`/auth/login (${phone}) returned HTTP ${response.status}: ${body}`);
  }

  const data = await response.json();

  if (!data.tokens?.accessToken) {
    throw new Error(`/auth/login (${phone}) did not return an access token`);
  }

  return data.tokens.accessToken;
}

async function loginAll() {
  const entries = await Promise.all(
    Object.entries(PHONES).map(async ([role, phone]) => [role, await login(phone)])
  );
  return Object.fromEntries(entries);
}

async function readJson(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: authHeaders(token)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} returned HTTP ${response.status}: ${body}`);
  }

  return response.json();
}

async function postJson(path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token)
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`${path} returned HTTP ${response.status}: ${responseBody}`);
  }

  return response.json();
}

async function postJsonExpectFailure(path, body, token, label) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token)
    },
    body: JSON.stringify(body)
  });
  const responseBody = await response.text();

  if (response.ok) {
    throw new Error(`${label} should be rejected, received success: ${responseBody}`);
  }
  if (response.status < 400 || response.status >= 500) {
    throw new Error(
      `${label} returned unexpected HTTP ${response.status}: ${responseBody}`
    );
  }
  if (!responseBody.includes("付款申请金额必须为大于 0 的整数分")) {
    throw new Error(`${label} did not return the expected Chinese validation error: ${responseBody}`);
  }

  return { status: response.status, body: responseBody };
}

async function uploadPrivateFile(fileName, token) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([`一期闭环验证文件：${fileName}\n`], {
      type: "application/pdf"
    }),
    fileName
  );

  // 上传人来自登录态（access token），不再随表单传 uploadedByUserId。
  const response = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: authHeaders(token),
    body: form
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`/files returned HTTP ${response.status}: ${body}`);
  }

  return response.json();
}

async function copyFrozenDocumentAsCounterpartySignedScan(frozenFileId, fileName, token) {
  const ticket = await postJson(
    `/files/${frozenFileId}/download-ticket`,
    {
      confirmationPassword: PASSWORD,
      downloadReason: "一期闭环验证乙方签章扫描件归档",
      accessMode: "download"
    },
    token
  );
  const download = await fetch(`${baseUrl}${ticket.downloadUrl}`);
  if (!download.ok) {
    throw new Error(`frozen settlement document download returned HTTP ${download.status}`);
  }
  const form = new FormData();
  form.append(
    "file",
    new Blob([await download.arrayBuffer()], { type: "application/pdf" }),
    fileName
  );
  const upload = await fetch(`${baseUrl}/files`, {
    method: "POST",
    headers: authHeaders(token),
    body: form
  });
  if (!upload.ok) {
    throw new Error(`counterparty signed scan upload returned HTTP ${upload.status}: ${await upload.text()}`);
  }
  return upload.json();
}

async function configureLocalCanvasSignature(token) {
  const form = new FormData();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  form.append("file", new Blob([png], { type: "image/png" }), "一期闭环验证手写签名.png");
  const response = await fetch(`${baseUrl}/me/signature/canvas`, {
    method: "POST",
    headers: authHeaders(token),
    body: form
  });
  if (!response.ok) {
    throw new Error(`local canvas signature upload returned HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

async function assertSeedDataReady() {
  const [project, contractStaff, cashier] = await Promise.all([
    prisma.project.findUnique({ where: { id: coreFlowSeedData.project.id } }),
    prisma.user.findUnique({ where: { id: coreFlowSeedData.users.contractStaff.id } }),
    prisma.user.findUnique({ where: { id: coreFlowSeedData.users.cashier.id } })
  ]);

  if (!project || !contractStaff || !cashier) {
    throw new Error("Seed data is required. Run `pnpm --filter @jiangkong/api seed` first.");
  }
}

async function verifyTarget(target, token) {
  const url = `${baseUrl}${target.path}`;
  const response = await fetch(url, { headers: authHeaders(token) });

  if (!response.ok) {
    throw new Error(`${target.path} returned HTTP ${response.status}`);
  }

  const body = await response.text();
  const missing = target.requiredText.filter((text) => !body.includes(text));

  if (missing.length > 0) {
    throw new Error(`${target.path} missing required text: ${missing.join(", ")}`);
  }

  console.log(`ok ${target.path}`);
}

async function verifySeedReadModels(token) {
  for (const target of coreFlowApiVerificationTargets) {
    const requiredText = target.path === "/payments/FK-2026-006"
      ? target.requiredText.filter((text) => text !== "approved_pending_payment")
      : target.requiredText;
    await verifyTarget({ ...target, requiredText }, token);
  }
  const seedPayment = await prisma.paymentRequest.findUnique({
    where: { id: coreFlowSeedData.paymentRequest.id }
  });
  assertEqual(seedPayment?.status, "approved_pending_payment", "seed payment database status");
}

async function verifyUnauthenticatedIsRejected() {
  // 安全回归：未带 token 的写接口必须被拒（401/403），不能"前端传谁就信谁"。
  const response = await fetch(`${baseUrl}/contracts/seed-contract-version/seal-approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  if (response.status !== 401 && response.status !== 403) {
    throw new Error(
      `unauthenticated write should be rejected, received HTTP ${response.status}`
    );
  }

  console.log(`ok unauthenticated write rejected (HTTP ${response.status})`);
}

async function verifyWrongRoleIsRejected(tokens) {
  // 安全回归：合同部成员不能做用章审批（应为综合部主管），必须 403。
  // 先直接通过 Prisma 建一个可处置合同版本（进入"待用章"状态），再用错误岗位尝试用章。
  const codeSuffix = `${Date.now()}-rbac`;
  const { versionId: contractVersionId } = await seedDisposableContract(codeSuffix, "5000000");

  await postJson(
    `/contracts/${contractVersionId}/approval-submission`,
    {},
    tokens.contractStaff
  );
  await postJson(
    `/contracts/${contractVersionId}/approval`,
    { decision: "approve" },
    tokens.chairman
  );

  const response = await fetch(`${baseUrl}/contracts/${contractVersionId}/seal-approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(tokens.contractStaff) },
    body: JSON.stringify({})
  });

  if (response.status !== 403) {
    throw new Error(
      `contract_staff performing seal approval should be 403, received HTTP ${response.status}`
    );
  }

  console.log(`ok wrong-role seal approval rejected (HTTP 403)`);
}

/**
 * 直接通过 Prisma 创建可处置的合同/版本/付款条款行，用于 RBAC 和生命周期验证。
 * POST /contracts 已替换为工作台草稿接口（需要已发布模板），不再用于验证辅助合同的创建。
 */
async function seedDisposableContract(codeSuffix, amountCents = TARGET_CONTRACT_CENTS) {
  const { randomUUID } = require("crypto");
  const contractId = randomUUID();
  const versionId = randomUUID();
  const termsId = randomUUID();
  const settlementTemplateId = randomUUID();
  const settlementTemplateVersionId = randomUUID();
  const settlementTemplateFileId = randomUUID();

  await prisma.contract.create({
    data: {
      id: contractId,
      projectId: coreFlowSeedData.project.id,
      contractTypeKey: "material_purchase",
      code: `HT-P1-${codeSuffix}`,
      name: "一期闭环验证合同",
      counterparty: "一期验证供应商"
    }
  });

  await prisma.contractVersion.create({
    data: {
      id: versionId,
      contractId,
      versionNo: 1,
      changeType: "original",
      status: "draft",
      amountCents: BigInt(amountCents),
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {},
      invoiceType: "vat_general",
      taxMode: "single_rate",
      defaultTaxRatePercent: new Prisma.Decimal("13"),
      taxFactStatus: "frozen",
      taxFactSource: "contract_document",
      taxFactRevision: 1,
      taxFactsFrozenAt: new Date()
    }
  });

  await prisma.paymentTermsVersion.create({
    data: {
      id: termsId,
      contractId,
      contractVersionId: versionId,
      versionNo: 1,
      status: "draft",
      originalText: "当期结算款按已生效结算单金额的80%支付，结算归档确认生效后30天内付款。"
    }
  });

  await prisma.paymentTermsStage.create({
    data: {
      paymentTermsVersionId: termsId,
      name: "当期结算款",
      stageType: "progress",
      basis: "current_settlement",
      ratioBps: 10000,
      triggerAnchor: "settlement_effective",
      triggerEvent: "结算归档确认生效",
      dueDays: 0,
      requiresInvoice: true,
      allowsEarlyPayment: false,
      allowsInstallments: true,
      originalText: "结算归档确认生效后可支付当期结算款100%。"
    }
  });

  await prisma.settlementTemplate.create({
    data: {
      id: settlementTemplateId,
      name: "一期闭环验证结算模板",
      code: `core-flow-${codeSuffix}`,
      createdByUserId: coreFlowSeedData.users.contractStaff.id
    }
  });

  await prisma.fileObject.create({
    data: {
      id: settlementTemplateFileId,
      bucket: "private-local",
      objectKey: `core-flow/${codeSuffix}-settlement-template.xlsx`,
      originalName: `一期闭环验证结算模板-${codeSuffix}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 1,
      uploadedByUserId: coreFlowSeedData.users.contractStaff.id,
      storageStatus: "active"
    }
  });

  await prisma.settlementTemplateVersion.create({
    data: {
      id: settlementTemplateVersionId,
      settlementTemplateId,
      versionNo: 1,
      status: "published",
      xlsxFileId: settlementTemplateFileId,
      compatibleContractTypeKeys: ["material_purchase"],
      compatibleAmountRoles: [],
      compatiblePricingModes: [],
      columnSchema: {},
      printRules: {},
      evidenceRules: {},
      anomalyRules: {},
      publishedByUserId: coreFlowSeedData.users.contractStaff.id,
      publishedAt: new Date()
    }
  });

  return { contractId, versionId, termsId, settlementTemplateVersionId };
}

async function verifyPhase1WriteLoop(tokens) {
  const codeSuffix = Date.now();
  const settlementAmountCents = TARGET_CONTRACT_CENTS;
  const payableAmountCents = TARGET_CONTRACT_CENTS;
  const firstExecutionCents = "1000000001";
  const secondExecutionCents = "1100000000";

  for (const token of Object.values(tokens)) {
    await configureLocalCanvasSignature(token);
  }

  const beforeReceiptOverview = await readJson(
    `/projects/${coreFlowSeedData.project.id}/operating-funds-overview`,
    tokens.cashier
  );
  assertExactMoneyText(
    beforeReceiptOverview.cash.actualReceiptsCents,
    String(beforeReceiptOverview.cash.actualReceiptsCents),
    "project receipts before bigint verification"
  );
  const receiptVoucher = await uploadPrivateFile(
    `SK-P1-${codeSuffix}-precision-voucher.pdf`,
    tokens.cashier
  );
  const precisionReceipt = await postJson(
    `/projects/${coreFlowSeedData.project.id}/receipts`,
    {
      receivedAt: "2026-06-20T00:00:00.000Z",
      amountCents: PRECISION_SENTINEL_CENTS,
      payerName: "一期大额金额验收业主",
      sourceType: "owner_direct_payment",
      description: "超过 JavaScript 安全整数的本地临时库精度哨兵",
      voucherFileId: receiptVoucher.id,
      confirmationPassword: PASSWORD
    },
    tokens.cashier
  );
  assertExactMoneyText(
    precisionReceipt.amountCents,
    PRECISION_SENTINEL_CENTS,
    "project receipt API"
  );
  const afterReceiptOverview = await readJson(
    `/projects/${coreFlowSeedData.project.id}/operating-funds-overview`,
    tokens.cashier
  );
  const expectedReceipts = (
    BigInt(beforeReceiptOverview.cash.actualReceiptsCents) + BigInt(PRECISION_SENTINEL_CENTS)
  ).toString();
  assertExactMoneyText(
    afterReceiptOverview.cash.actualReceiptsCents,
    expectedReceipts,
    "project receipt aggregate API"
  );

  // 合同：草稿 → 提交(合同部) → 审批(董事长) → 用章(综合部主管) → 归档上传(合同部) → 归档确认(合同部主管) → 生效
  // 直接通过 Prisma 创建可处置合同行（POST /contracts 已替换为需要已发布模板的工作台接口）。
  const { versionId: contractVersionId, settlementTemplateVersionId } = await seedDisposableContract(codeSuffix);

  let contractVersion = await postJson(
    `/contracts/${contractVersionId}/approval-submission`,
    {},
    tokens.contractStaff
  );
  assertEqual(contractVersion.status, "in_approval", "contract approval submission");

  contractVersion = await postJson(
    `/contracts/${contractVersionId}/approval`,
    { decision: "approve" },
    tokens.chairman
  );
  assertEqual(contractVersion.status, "approved_pending_seal", "contract approval");

  contractVersion = await postJson(
    `/contracts/${contractVersionId}/seal-approval`,
    {},
    tokens.comprehensiveDirector
  );
  assertEqual(
    contractVersion.status,
    "seal_approved_pending_archive",
    "contract seal approval"
  );

  const contractArchiveFile = await uploadPrivateFile(
    `HT-P1-${codeSuffix}-signed.pdf`,
    tokens.contractStaff
  );
  const contractArchive = await postJson(
    `/contracts/${contractVersionId}/archive-files`,
    { fileId: contractArchiveFile.id },
    tokens.contractStaff
  );
  contractVersion = await postJson(
    `/contracts/${contractVersionId}/archive-confirmation`,
    { archiveFileId: contractArchive.id, confirmationPassword: PASSWORD },
    tokens.contractDirector
  );
  assertEqual(contractVersion.status, "effective", "contract archive confirmation");

  // 结算：工作台草稿 → 现场复核人 → 冻结结算单 → 乙方签章件 → 材料类审批流(物资员 → 物资主管 → 合同部主管 → 项目经理 → 财务总监)
  // → 归档上传(合同部) → 归档确认(合同部主管) → 生效
  const settlementDraft = await postJson(
    `/projects/${coreFlowSeedData.project.id}/settlement-drafts`,
    {
      contractVersionId,
      settlementTemplateVersionId,
      code: `JS-P1-${codeSuffix}`,
      periodLabel: "2026-06",
      fieldReviewerUserId: "seed-user-material-staff",
      fieldReviewerRoleKey: "material_staff",
      settlementLines: [
        {
          sourceType: "manual_adjustment",
          name: "一期闭环现场签认金额",
          amountCents: settlementAmountCents,
          reason: "本期现场签认"
        }
      ]
    },
    tokens.contractStaff
  );
  const frozenSettlementDocument = await postJson(
    `/projects/${coreFlowSeedData.project.id}/settlement-drafts/${settlementDraft.id}/frozen-document`,
    { expectedRevision: settlementDraft.revision },
    tokens.contractStaff
  );
  const counterpartySignedScan = await copyFrozenDocumentAsCounterpartySignedScan(
    frozenSettlementDocument.fileId,
    `JS-P1-${codeSuffix}-counterparty-signed.pdf`,
    tokens.contractStaff
  );
  await postJson(
    `/projects/${coreFlowSeedData.project.id}/settlement-drafts/${settlementDraft.id}/counterparty-signed-documents`,
    {
      expectedRevision: settlementDraft.revision,
      frozenDocumentId: frozenSettlementDocument.id,
      uploadedFileId: counterpartySignedScan.id,
      declaration: {
        pageOrderMatchesFrozenDocument: true,
        counterpartySignedAndDated: true,
        everyPageStamped: true,
        crossPageSealCompleted: true
      }
    },
    tokens.contractStaff
  );
  let settlement = await postJson(
    `/projects/${coreFlowSeedData.project.id}/settlement-drafts/${settlementDraft.id}/approval-submission`,
    { expectedRevision: settlementDraft.revision },
    tokens.contractStaff
  );
  assertEqual(settlement.status, "approval_pending", "settlement creation");
  assertExactMoneyText(
    settlement.amountCents,
    settlementAmountCents,
    "settlement amount API"
  );
  assertExactMoneyText(
    settlement.payableAmountCents,
    payableAmountCents,
    "settlement payable amount API"
  );

  for (const token of [
    tokens.materialStaff,
    tokens.materialDirector,
    tokens.contractDirector,
    tokens.projectManager,
    tokens.financeDirector
  ]) {
    settlement = await postJson(
      `/settlements/${settlement.id}/approval`,
      { decision: "approve" },
      token
    );
  }
  assertEqual(settlement.status, "pending_generation", "settlement approval");
  const finalSignedDocument = await postJson(
    `/settlements/${settlement.id}/signed-document-generation-retry`,
    {},
    tokens.contractDirector
  );
  if (!finalSignedDocument?.id) {
    throw new Error("settlement final signed document generation returned no document id");
  }
  const pendingArchiveConfirmation = await prisma.settlement.findUnique({
    where: { id: settlement.id }
  });
  assertEqual(
    pendingArchiveConfirmation?.status,
    "pending_archive_confirm",
    "settlement final signed document generation"
  );
  settlement = await postJson(
    `/settlements/${settlement.id}/archive-confirmation`,
    { confirmationPassword: PASSWORD },
    tokens.contractDirector
  );
  assertEqual(settlement.status, "effective", "settlement archive confirmation");

  const invalidPaymentCodes = [];
  for (const invalidAmount of [2100000001, "1.5", "1e3", "-1"]) {
    const invalidCode = `FK-P1-${codeSuffix}-INVALID-${String(invalidAmount).replace(/\W/g, "")}`;
    invalidPaymentCodes.push(invalidCode);
    await postJsonExpectFailure(
      "/payments",
      {
        settlementId: settlement.id,
        code: invalidCode,
        requestedAmountCents: invalidAmount
      },
      tokens.contractStaff,
      `invalid payment amount ${String(invalidAmount)}`
    );
  }
  const invalidPaymentCount = await prisma.paymentRequest.count({
    where: { code: { in: invalidPaymentCodes } }
  });
  assertEqual(invalidPaymentCount, 0, "invalid payment amounts leave no database rows");

  // 付款：创建 → 按当前代码冻结的审批节点流转 → 两次实际付款 → 财务流水 → PDF 留档
  let payment = await postJson(
    "/payments",
    {
      settlementId: settlement.id,
      code: `FK-P1-${codeSuffix}`,
      requestedAmountCents: payableAmountCents
    },
    tokens.contractStaff
  );
  assertEqual(payment.status, "approval_pending", "payment request creation");
  assertEqual(payment.sourceType, "settlement", "payment request settlement source");
  assertEqual(payment.settlementId, settlement.id, "payment request settlement link");
  assertExactMoneyText(
    payment.requestedAmountCents,
    payableAmountCents,
    "payment request API"
  );

  for (const [role, token] of [
    ["projectManager", tokens.projectManager],
    ["contractDirector", tokens.contractDirector],
    ["financeDirector", tokens.financeDirector],
    ["chairman", tokens.chairman]
  ]) {
    payment = await postJson(
      `/payments/${payment.id}/approval`,
      {
        decision: "approve",
        ...(role === "chairman" ? { approvedAmountCents: payableAmountCents } : {})
      },
      token
    );
  }
  assertEqual(payment.status, "approved_pending_payment", "payment approval");
  assertExactMoneyText(
    payment.approvedAmountCents,
    payableAmountCents,
    "payment approval API"
  );

  const firstVoucherFile = await uploadPrivateFile(
    `FK-P1-${codeSuffix}-voucher-1.pdf`,
    tokens.cashier
  );
  const firstExecution = await postJson(
    `/payments/${payment.id}/executions`,
    {
      amountCents: firstExecutionCents,
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: firstVoucherFile.id,
      confirmationPassword: PASSWORD
    },
    tokens.cashier
  );
  assertExactMoneyText(
    firstExecution.amountCents,
    firstExecutionCents,
    "first payment execution API"
  );

  const afterFirstExecution = await prisma.paymentRequest.findUnique({
    where: { id: payment.id }
  });
  if (!afterFirstExecution) {
    throw new Error("Payment request disappeared after first execution");
  }
  assertEqual(afterFirstExecution.status, "partially_paid", "payment partial status");
  assertEqual(
    afterFirstExecution.paidAmountCents,
    BigInt(firstExecutionCents),
    "payment partial paid amount"
  );
  const secondVoucherFile = await uploadPrivateFile(
    `FK-P1-${codeSuffix}-voucher-2.pdf`,
    tokens.cashier
  );
  const secondExecution = await postJson(
    `/payments/${payment.id}/executions`,
    {
      amountCents: secondExecutionCents,
      paidAt: "2026-06-22T00:30:00.000Z",
      voucherFileId: secondVoucherFile.id,
      confirmationPassword: PASSWORD
    },
    tokens.cashier
  );
  assertExactMoneyText(
    secondExecution.amountCents,
    secondExecutionCents,
    "second payment execution API"
  );

  const financeRecord = await postJson(
    `/payments/${payment.id}/finance-records`,
    {
      amountCents: payableAmountCents,
      occurredAt: "2026-06-22T01:00:00.000Z",
      confirmationPassword: PASSWORD
    },
    tokens.cashier
  );
  assertExactMoneyFields(
    financeRecord,
    { amountCents: payableAmountCents },
    "payment finance record API"
  );

  const pdfArchiveFile = await uploadPrivateFile(`FK-P1-${codeSuffix}-archive.pdf`, tokens.cashier);
  await postJson(
    `/payments/${payment.id}/pdf-archive`,
    { fileId: pdfArchiveFile.id },
    tokens.cashier
  );

  const paymentDetail = await readJson(`/payments/${payment.code}`, tokens.contractStaff);
  assertEqual(paymentDetail.id, payment.code, "payment detail read model");

  const finalPayment = await prisma.paymentRequest.findUnique({
    where: { id: payment.id }
  });

  if (!finalPayment) {
    throw new Error("Payment request was not persisted");
  }

  assertEqual(finalPayment.status, "paid", "payment final status");
  assertEqual(
    finalPayment.paidAmountCents,
    BigInt(payableAmountCents),
    "payment paid amount"
  );

  const auditActions = await prisma.auditLog.findMany({
    where: {
      OR: [
        { businessType: "contract_version", businessId: contractVersionId },
        { businessType: "settlement", businessId: settlement.id },
        { businessType: "payment_request", businessId: payment.id }
      ]
    },
    select: { action: true, actorUserId: true }
  });
  const actionSet = new Set(auditActions.map((row) => row.action));
  const requiredActions = [
    "contract.approval.submit",
    "contract.approval.approve",
    "contract.seal.approve",
    "contract.archive.upload",
    "contract.archive.confirm",
    "settlement.approval.approve",
    "settlement.archive.upload",
    "settlement.archive.confirm",
    "payment.approval.approve",
    "payment.execution.record",
    "payment.finance.record",
    "payment.pdf_archive.record"
  ];
  const missingActions = requiredActions.filter((action) => !actionSet.has(action));

  if (missingActions.length > 0) {
    throw new Error(`Missing audit actions: ${missingActions.join(", ")}`);
  }

  // 审计的操作人必须来自登录态，不能为空。
  const anonymousAudit = auditActions.find((row) => !row.actorUserId);
  if (anonymousAudit) {
    throw new Error(`Audit log missing actorUserId for action ${anonymousAudit.action}`);
  }

  console.log(
    `ok phase1 write loop ${contractVersionId} -> ${settlement.code} -> ${payment.code}`
  );
}

async function main() {
  assertLocalMoneyVerificationRuntime({
    databaseUrl: process.env.DATABASE_URL ?? "",
    apiBaseUrl: baseUrl,
    host: process.env.HOST ?? "",
    storageDriver: process.env.FILE_STORAGE_DRIVER ?? "local"
  });
  await assertSeedDataReady();
  const tokens = await loginAll();
  await verifyUnauthenticatedIsRejected();
  await verifyWrongRoleIsRejected(tokens);
  await verifySeedReadModels(tokens.contractStaff);
  await verifyPhase1WriteLoop(tokens);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
