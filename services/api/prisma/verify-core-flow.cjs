const { coreFlowApiVerificationTargets } = require("../dist/database/core-flow-api-verification");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");
const { PrismaClient } = require("@prisma/client");

const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3000";
const prisma = new PrismaClient();

// 与 prisma/seed.cjs 中 testPassword 一致；所有 seed 账号同一初始密码。
const PASSWORD = process.env.SEED_PASSWORD || "Jgzg@2026";
const PHONES = {
  contractStaff: coreFlowSeedData.users.contractStaff.phone,
  cashier: coreFlowSeedData.users.cashier.phone,
  chairman: "13800001001",
  contractDirector: "13800001004",
  budgetDirector: "13800001005",
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

async function uploadPrivateFile(fileName, token) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([`Phase 1 verification file: ${fileName}\n`], {
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
    await verifyTarget(target, token);
  }
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
  // 先建一个进入"待用章"状态的合同版本，再用错误岗位尝试用章。
  const codeSuffix = `${Date.now()}-rbac`;
  const contractResult = await postJson(
    "/contracts",
    minimalContractPayload(codeSuffix),
    tokens.contractStaff
  );
  const contractVersionId = contractResult.version.id;

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

function minimalContractPayload(codeSuffix) {
  return {
    projectId: coreFlowSeedData.project.id,
    code: `HT-P1-${codeSuffix}`,
    name: "Phase1闭环验证合同",
    counterparty: "Phase1验证供应商",
    amountCents: 5000000,
    paymentTermsOriginalText:
      "当期结算款按已生效结算单金额的80%支付，结算归档确认生效后30天内付款。",
    paymentStages: [
      {
        name: "当期结算款",
        basis: "current_settlement",
        ratioBps: 8000,
        triggerEvent: "结算归档确认生效",
        dueDays: 30,
        requiresInvoice: true,
        allowsEarlyPayment: false,
        allowsInstallments: true,
        originalText: "结算归档确认生效后30天内支付当期结算款80%。"
      }
    ]
  };
}

async function verifyPhase1WriteLoop(tokens) {
  const codeSuffix = Date.now();
  const settlementAmountCents = 1000000;
  const payableAmountCents = 800000;

  // 合同：草稿 → 提交(合同部) → 审批(董事长) → 用章(综合部主管) → 归档上传(合同部) → 归档确认(合同部主管) → 生效
  const contractResult = await postJson(
    "/contracts",
    minimalContractPayload(codeSuffix),
    tokens.contractStaff
  );
  const contractVersionId = contractResult.version.id;

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
    { archiveFileId: contractArchive.id },
    tokens.contractDirector
  );
  assertEqual(contractVersion.status, "effective", "contract archive confirmation");

  // 结算：创建 → 审批(预算部主管) → 归档上传(合同部) → 归档确认(合同部主管) → 生效
  let settlement = await postJson(
    "/settlements",
    {
      contractVersionId,
      code: `JS-P1-${codeSuffix}`,
      periodLabel: "2026-06",
      amountCents: settlementAmountCents
    },
    tokens.contractStaff
  );
  assertEqual(settlement.status, "approval_pending", "settlement creation");
  assertEqual(settlement.payableAmountCents, payableAmountCents, "settlement payable amount");

  settlement = await postJson(
    `/settlements/${settlement.id}/approval`,
    { decision: "approve" },
    tokens.budgetDirector
  );
  assertEqual(settlement.status, "approved_pending_archive", "settlement approval");

  const settlementArchiveFile = await uploadPrivateFile(
    `JS-P1-${codeSuffix}-signed.pdf`,
    tokens.contractStaff
  );
  const settlementArchive = await postJson(
    `/settlements/${settlement.id}/archive-files`,
    { fileId: settlementArchiveFile.id },
    tokens.contractStaff
  );
  settlement = await postJson(
    `/settlements/${settlement.id}/archive-confirmation`,
    { archiveFileId: settlementArchive.id },
    tokens.contractDirector
  );
  assertEqual(settlement.status, "effective", "settlement archive confirmation");

  // 付款：创建 → 审批(董事长) → 实际付款(出纳) → 财务流水(出纳) → PDF 留档(出纳)
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

  payment = await postJson(
    `/payments/${payment.id}/approval`,
    { decision: "approve", approvedAmountCents: payableAmountCents },
    tokens.chairman
  );
  assertEqual(payment.status, "approved_pending_payment", "payment approval");

  const voucherFile = await uploadPrivateFile(`FK-P1-${codeSuffix}-voucher.pdf`, tokens.cashier);
  await postJson(
    `/payments/${payment.id}/executions`,
    {
      amountCents: payableAmountCents,
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: voucherFile.id
    },
    tokens.cashier
  );

  await postJson(
    `/payments/${payment.id}/finance-records`,
    {
      amountCents: payableAmountCents,
      occurredAt: "2026-06-22T01:00:00.000Z"
    },
    tokens.cashier
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
  assertEqual(finalPayment.paidAmountCents, payableAmountCents, "payment paid amount");

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
    `ok phase1 write loop ${contractResult.contract.code} -> ${settlement.code} -> ${payment.code}`
  );
}

async function main() {
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
