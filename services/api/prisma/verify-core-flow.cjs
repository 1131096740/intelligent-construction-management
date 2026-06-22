const { coreFlowApiVerificationTargets } = require("../dist/database/core-flow-api-verification");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");
const { PrismaClient } = require("@prisma/client");

const baseUrl = process.env.API_BASE_URL || "http://127.0.0.1:3000";
const prisma = new PrismaClient();

async function readJson(path) {
  const response = await fetch(`${baseUrl}${path}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} returned HTTP ${response.status}: ${body}`);
  }

  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(`${path} returned HTTP ${response.status}: ${responseBody}`);
  }

  return response.json();
}

async function uploadPrivateFile(fileName, uploadedByUserId) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([`Phase 1 verification file: ${fileName}\n`], {
      type: "application/pdf"
    }),
    fileName
  );
  form.append("uploadedByUserId", uploadedByUserId);

  const response = await fetch(`${baseUrl}/files`, {
    method: "POST",
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

async function verifyTarget(target) {
  const url = `${baseUrl}${target.path}`;
  const response = await fetch(url);

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

async function verifySeedReadModels() {
  for (const target of coreFlowApiVerificationTargets) {
    await verifyTarget(target);
  }
}

async function verifyPhase1WriteLoop() {
  const seed = coreFlowSeedData;
  const contractStaffUserId = seed.users.contractStaff.id;
  const contractDirectorUserId = seed.users.contractStaff.id;
  const chairmanUserId = seed.users.contractStaff.id;
  const budgetDirectorUserId = seed.users.contractStaff.id;
  const cashierUserId = seed.users.cashier.id;
  const financeUserId = seed.users.cashier.id;
  const codeSuffix = Date.now();
  const settlementAmountCents = 1000000;
  const payableAmountCents = 800000;

  const contractResult = await postJson("/contracts", {
    projectId: seed.project.id,
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
  });
  const contractVersionId = contractResult.version.id;

  let contractVersion = await postJson(
    `/contracts/${contractVersionId}/approval-submission`,
    {
      submittedByUserId: contractStaffUserId
    }
  );
  assertEqual(contractVersion.status, "in_approval", "contract approval submission");

  contractVersion = await postJson(`/contracts/${contractVersionId}/approval`, {
    decision: "approve",
    reviewedByUserId: chairmanUserId
  });
  assertEqual(contractVersion.status, "approved_pending_seal", "contract approval");

  contractVersion = await postJson(`/contracts/${contractVersionId}/seal-approval`, {
    sealedByUserId: contractStaffUserId
  });
  assertEqual(
    contractVersion.status,
    "seal_approved_pending_archive",
    "contract seal approval"
  );

  const contractArchiveFile = await uploadPrivateFile(
    `HT-P1-${codeSuffix}-signed.pdf`,
    contractStaffUserId
  );
  const contractArchive = await postJson(`/contracts/${contractVersionId}/archive-files`, {
    fileId: contractArchiveFile.id,
    uploadedByUserId: contractStaffUserId
  });
  contractVersion = await postJson(`/contracts/${contractVersionId}/archive-confirmation`, {
    archiveFileId: contractArchive.id,
    confirmedByUserId: contractDirectorUserId
  });
  assertEqual(contractVersion.status, "effective", "contract archive confirmation");

  let settlement = await postJson("/settlements", {
    contractVersionId,
    code: `JS-P1-${codeSuffix}`,
    periodLabel: "2026-06",
    amountCents: settlementAmountCents
  });
  assertEqual(settlement.status, "approval_pending", "settlement creation");
  assertEqual(settlement.payableAmountCents, payableAmountCents, "settlement payable amount");

  settlement = await postJson(`/settlements/${settlement.id}/approval`, {
    decision: "approve",
    reviewedByUserId: budgetDirectorUserId
  });
  assertEqual(settlement.status, "approved_pending_archive", "settlement approval");

  const settlementArchiveFile = await uploadPrivateFile(
    `JS-P1-${codeSuffix}-signed.pdf`,
    contractStaffUserId
  );
  const settlementArchive = await postJson(`/settlements/${settlement.id}/archive-files`, {
    fileId: settlementArchiveFile.id,
    uploadedByUserId: contractStaffUserId
  });
  settlement = await postJson(`/settlements/${settlement.id}/archive-confirmation`, {
    archiveFileId: settlementArchive.id,
    confirmedByUserId: contractDirectorUserId
  });
  assertEqual(settlement.status, "effective", "settlement archive confirmation");

  let payment = await postJson("/payments", {
    settlementId: settlement.id,
    code: `FK-P1-${codeSuffix}`,
    requestedAmountCents: payableAmountCents
  });
  assertEqual(payment.status, "approval_pending", "payment request creation");

  payment = await postJson(`/payments/${payment.id}/approval`, {
    decision: "approve",
    approvedAmountCents: payableAmountCents,
    reviewedByUserId: chairmanUserId
  });
  assertEqual(payment.status, "approved_pending_payment", "payment approval");

  const voucherFile = await uploadPrivateFile(`FK-P1-${codeSuffix}-voucher.pdf`, cashierUserId);
  await postJson(`/payments/${payment.id}/executions`, {
    amountCents: payableAmountCents,
    paidAt: "2026-06-22T00:00:00.000Z",
    executedByUserId: cashierUserId,
    voucherFileId: voucherFile.id
  });

  await postJson(`/payments/${payment.id}/finance-records`, {
    amountCents: payableAmountCents,
    occurredAt: "2026-06-22T01:00:00.000Z",
    createdByUserId: financeUserId
  });

  const pdfArchiveFile = await uploadPrivateFile(`FK-P1-${codeSuffix}-archive.pdf`, financeUserId);
  await postJson(`/payments/${payment.id}/pdf-archive`, {
    fileId: pdfArchiveFile.id,
    archivedByUserId: financeUserId
  });

  const paymentDetail = await readJson(`/payments/${payment.code}`);
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
    select: { action: true }
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

  console.log(
    `ok phase1 write loop ${contractResult.contract.code} -> ${settlement.code} -> ${payment.code}`
  );
}

async function main() {
  await assertSeedDataReady();
  await verifySeedReadModels();
  await verifyPhase1WriteLoop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
