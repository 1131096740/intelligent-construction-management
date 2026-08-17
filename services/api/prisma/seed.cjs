const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { createHash } = require("crypto");
const {
  copyFile,
  mkdir,
  readFile,
  writeFile
} = require("fs/promises");
const { dirname, join } = require("path");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");
const {
  resolveSeedAuthRuntime,
  seedAuthLogLines
} = require("../dist/database/seed-auth-runtime");

const prisma = new PrismaClient();
const seed = coreFlowSeedData;
const testPassword = "Jgzg@2026";
const seedAuthRuntime = resolveSeedAuthRuntime(process.env, testPassword);
const seedPaymentFundingAllocationId =
  "seed-project-funding-allocation-fk-2026-006-001";
const seedPaymentExecutionAuditId =
  "seed-audit-payment-execution-fk-2026-006-001";
const seedConstructionEnterpriseId = "seed-construction-enterprise-jgxm-001";
const seedConstructionEnterpriseVersionId = "seed-construction-enterprise-version-jgxm-001";
const seedConstructionEnterpriseAssignmentId = "seed-construction-enterprise-assignment-jgxm-001";
const seedParticipatingCompanyId = "seed-project-participating-company-jgxm-001";
const positions = [
  ["chairman", "董事长"],
  ["general_manager", "总经理"],
  ["project_manager", "项目经理"],
  ["contract_director", "合同部主管"],
  ["contract_staff", "合同部成员"],
  ["budget_director", "预算部主管"],
  ["budget_staff", "预算部成员"],
  ["finance_director", "财务部主管"],
  ["finance_staff", "财务部成员/出纳"],
  ["material_director", "材料部主管"],
  ["material_staff", "材料部成员"],
  ["engineering_department_member", "公司工程技术部成员"],
  ["engineering_department_director", "公司工程技术部部长"],
  ["engineering_director", "项目总工"],
  ["engineering_foreman", "施工员/工长"],
  ["engineering_tech", "技术负责人"],
  ["comprehensive_director", "综合部主管"],
  ["employee", "普通员工"],
  ["super_admin", "技术管理员"]
];
const authSeedUsers = [
  {
    id: seed.users.contractStaff.id,
    name: seed.users.contractStaff.name,
    phone: seed.users.contractStaff.phone,
    positionKey: "contract_staff"
  },
  {
    id: seed.users.cashier.id,
    name: seed.users.cashier.name,
    phone: seed.users.cashier.phone,
    positionKey: "finance_staff"
  },
  { id: "seed-user-chairman", name: "董事长 赵总", phone: "13800001001", positionKey: "chairman" },
  {
    id: "seed-user-general-manager",
    name: "总经理 钱总",
    phone: "13800001002",
    positionKey: "general_manager"
  },
  {
    id: "seed-user-project-manager",
    name: "项目经理 孙工",
    phone: "13800001003",
    positionKey: "project_manager"
  },
  {
    id: "seed-user-contract-director",
    name: "合同部主管 周工",
    phone: "13800001004",
    positionKey: "contract_director"
  },
  {
    id: "seed-user-budget-director",
    name: "预算部主管 吴工",
    phone: "13800001005",
    positionKey: "budget_director"
  },
  {
    id: "seed-user-budget-staff",
    name: "预算部成员 郑工",
    phone: "13800001006",
    positionKey: "budget_staff"
  },
  {
    id: "seed-user-finance-director",
    name: "财务部主管 冯会计",
    phone: "13800001007",
    positionKey: "finance_director"
  },
  {
    id: "seed-user-material-director",
    name: "材料部主管 陈工",
    phone: "13800001008",
    positionKey: "material_director"
  },
  {
    id: "seed-user-material-staff",
    name: "材料部成员 褚工",
    phone: "13800001009",
    positionKey: "material_staff"
  },
  {
    id: "seed-user-engineering-director",
    name: "工程部主管 卫工",
    phone: "13800001010",
    positionKey: "engineering_director"
  },
  {
    id: "seed-user-engineering-foreman",
    name: "工长 蒋工",
    phone: "13800001011",
    positionKey: "engineering_foreman"
  },
  {
    id: "seed-user-engineering-tech",
    name: "技术负责人 沈工",
    phone: "13800001012",
    positionKey: "engineering_tech"
  },
  {
    id: "seed-user-comprehensive-director",
    name: "综合部主管 韩工",
    phone: "13800001013",
    positionKey: "comprehensive_director"
  },
  { id: "seed-user-employee", name: "员工 杨工", phone: "13800001014", positionKey: "employee" },
  {
    id: "seed-user-super-admin",
    name: "系统管理员",
    phone: "13800001015",
    positionKey: "super_admin"
  }
];

async function seedUserWithPosition(user, passwordHash) {
  await prisma.user.upsert({
    where: { id: user.id },
    update: {
      name: user.name,
      phone: user.phone,
      passwordHash,
      mustChangePassword: true,
      isActive: true
    },
    create: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      passwordHash,
      mustChangePassword: true
    }
  });
}

async function seedAuthAssignments() {
  for (const user of authSeedUsers) {
    const position = await prisma.position.findUnique({
      where: { key: user.positionKey }
    });

    if (!position) {
      throw new Error(`Position not found: ${user.positionKey}`);
    }

    await prisma.userPosition.deleteMany({
      where: {
        userId: user.id,
        positionId: position.id,
        projectId: null
      }
    });
    await prisma.userPosition.create({
      data: {
        userId: user.id,
        positionId: position.id,
        projectId: null
      }
    });
    await prisma.projectMember.upsert({
      where: {
        projectId_userId_positionKey: {
          projectId: seed.project.id,
          userId: user.id,
          positionKey: user.positionKey
        }
      },
      update: {},
      create: {
        projectId: seed.project.id,
        userId: user.id,
        positionKey: user.positionKey
      }
    });
  }
}

function privateStoragePath(objectKey) {
  return join(process.cwd(), "storage", "private", objectKey);
}

async function copyPrivateSeedFile(file, sourcePath) {
  const targetPath = privateStoragePath(file.objectKey);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  return fileMetadata(await readFile(targetPath));
}

async function writePrivateSeedFile(file, buffer) {
  const targetPath = privateStoragePath(file.objectKey);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, buffer);
  return fileMetadata(buffer);
}

function fileMetadata(buffer) {
  return {
    sizeBytes: buffer.length,
    contentSha256: createHash("sha256").update(buffer).digest("hex")
  };
}

function minimalPreviewPdf() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 760 Td (Template preview) Tj ET\nendstream\nendobj\n"
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object) => {
    const offset = Buffer.byteLength(body);
    body += object;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

async function upsertSeedFile(file, uploadedByUserId, metadata) {
  await prisma.fileObject.upsert({
    where: { id: file.id },
    update: {
      bucket: file.bucket,
      objectKey: file.objectKey,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: metadata.sizeBytes,
      contentSha256: metadata.contentSha256,
      uploadedByUserId,
      storageStatus: "active"
    },
    create: {
      id: file.id,
      bucket: file.bucket,
      objectKey: file.objectKey,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: metadata.sizeBytes,
      contentSha256: metadata.contentSha256,
      uploadedByUserId,
      storageStatus: "active"
    }
  });
}

function canonicalSeedFact(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalSeedFact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalSeedFact(value[key])])
    );
  }
  return value;
}

function assertExactSeedFacts(label, actual, expected) {
  if (
    JSON.stringify(canonicalSeedFact(actual)) !==
    JSON.stringify(canonicalSeedFact(expected))
  ) {
    throw new Error(`${label} exists with different seed facts`);
  }
}

function assertExactPaymentExecutionFacts(actual, expected) {
  assertExactSeedFacts("PaymentExecution", actual, expected);
}

function assertExactProjectFundingAllocationFacts(actual, expected) {
  assertExactSeedFacts("ProjectFundingAllocation", actual, expected);
}

function assertExactPaymentExecutionAuditFacts(actual, expected) {
  assertExactSeedFacts("payment.execution.record AuditLog", actual, expected);
}

async function assertSeedProjectCashAvailable(tx, amountCents) {
  const [receipts, allocations] = await Promise.all([
    tx.projectReceipt.aggregate({
      where: {
        projectId: seed.project.id,
        voidedAt: null,
        sourceType: { in: ["general_contractor_payment", "other"] }
      },
      _sum: { amountCents: true }
    }),
    tx.projectFundingAllocation.findMany({
      where: {
        projectId: seed.project.id,
        sourceKey: "project_cash"
      },
      select: { direction: true, amountCents: true }
    })
  ]);
  const receivedCents = receipts._sum.amountCents ?? 0n;
  const usedCents = allocations.reduce(
    (total, allocation) =>
      total +
      (allocation.direction === "credit"
        ? -allocation.amountCents
        : allocation.amountCents),
    0n
  );
  if (receivedCents - usedCents < amountCents) {
    throw new Error("Seed project cash is insufficient for PaymentExecution");
  }
}

async function seedPaymentExecutionClosedLoop() {
  const amountCents = BigInt(seed.paymentExecution.amountCents);
  const expectedExecution = {
    id: seed.paymentExecution.id,
    idempotencyKey: seed.paymentExecution.idempotencyKey,
    paymentRequestId: seed.paymentRequest.id,
    settlementId: seed.settlement.id,
    paymentSubjectType: seed.paymentExecution.paymentSubjectType,
    companyEntityIdSnapshot: seed.paymentExecution.companyEntityIdSnapshot,
    companyEntityNameSnapshot: seed.paymentExecution.companyEntityNameSnapshot,
    companyEntityCreditCodeSnapshot:
      seed.paymentExecution.companyEntityCreditCodeSnapshot,
    amountCents,
    paidAt: seed.paymentExecution.paidAt,
    executedByUserId: seed.users.cashier.id,
    voucherFileId: seed.voucherFile.id
  };
  const expectedFundingAllocation = {
    id: seedPaymentFundingAllocationId,
    projectId: seed.project.id,
    executionType: "payment_execution",
    executionId: seed.paymentExecution.id,
    businessType: "payment_request",
    businessId: seed.paymentRequest.id,
    sourceType: "project_cash",
    sourceKey: "project_cash",
    sourceId: null,
    direction: "debit",
    amountCents,
    occurredAt: seed.paymentExecution.paidAt,
    createdByUserId: seed.users.cashier.id,
    reversalOfAllocationId: null,
    reversalKey: "original",
    reason: null
  };
  const expectedAuditLog = {
    id: seedPaymentExecutionAuditId,
    actorUserId: seed.users.cashier.id,
    action: "payment.execution.record",
    businessType: "payment_request",
    businessId: seed.paymentRequest.id,
    ipAddress: null,
    userAgent: null,
    metadata: {
      code: seed.paymentRequest.code,
      projectId: seed.project.id,
      executionId: seed.paymentExecution.id,
      amountCents: amountCents.toString(),
      paidAt: seed.paymentExecution.paidAt.toISOString(),
      voucherFileId: seed.voucherFile.id,
      idempotencyKey: seed.paymentExecution.idempotencyKey,
      payer: {
        paymentSubjectType: seed.paymentExecution.paymentSubjectType,
        companyEntityIdSnapshot: seed.paymentExecution.companyEntityIdSnapshot,
        companyEntityNameSnapshot:
          seed.paymentExecution.companyEntityNameSnapshot,
        companyEntityCreditCodeSnapshot:
          seed.paymentExecution.companyEntityCreditCodeSnapshot
      },
      funding: {
        kind: "allocated",
        projectCashAmountCents: amountCents.toString(),
        financingQuotaAmountCents: "0",
        allocations: [
          {
            sourceType: "project_cash",
            sourceId: null,
            amountCents: amountCents.toString()
          }
        ]
      },
      fromStatus: "approved_pending_payment",
      toStatus: seed.paymentRequest.status
    }
  };

  await prisma.$transaction(async (tx) => {
    const voucher = await tx.fileObject.findUnique({
      where: { id: seed.voucherFile.id },
      select: {
        id: true,
        uploadedByUserId: true,
        storageStatus: true
      }
    });
    assertExactSeedFacts("PaymentExecution voucher", voucher, {
      id: seed.voucherFile.id,
      uploadedByUserId: seed.users.cashier.id,
      storageStatus: "active"
    });

    const paymentExecutionSelect = {
      id: true,
      idempotencyKey: true,
      paymentRequestId: true,
      settlementId: true,
      paymentSubjectType: true,
      companyEntityIdSnapshot: true,
      companyEntityNameSnapshot: true,
      companyEntityCreditCodeSnapshot: true,
      amountCents: true,
      paidAt: true,
      executedByUserId: true,
      voucherFileId: true
    };
    const executions = await tx.paymentExecution.findMany({
      where: {
        OR: [
          { id: seed.paymentExecution.id },
          { idempotencyKey: seed.paymentExecution.idempotencyKey },
          { voucherFileId: seed.voucherFile.id }
        ]
      },
      select: paymentExecutionSelect
    });
    if (executions.length > 1) {
      throw new Error("PaymentExecution seed identities resolve to multiple rows");
    }
    const execution =
      executions[0] ??
      (await tx.paymentExecution.create({
        data: expectedExecution,
        select: paymentExecutionSelect
      }));
    assertExactPaymentExecutionFacts(execution, expectedExecution);

    const fundingAllocationSelect = {
      id: true,
      projectId: true,
      executionType: true,
      executionId: true,
      businessType: true,
      businessId: true,
      sourceType: true,
      sourceKey: true,
      sourceId: true,
      direction: true,
      amountCents: true,
      occurredAt: true,
      createdByUserId: true,
      reversalOfAllocationId: true,
      reversalKey: true,
      reason: true
    };
    const fundingAllocations = await tx.projectFundingAllocation.findMany({
      where: {
        executionType: "payment_execution",
        executionId: seed.paymentExecution.id
      },
      select: fundingAllocationSelect
    });
    if (fundingAllocations.length > 1) {
      throw new Error(
        "PaymentExecution seed resolves to multiple funding allocations"
      );
    }
    if (!fundingAllocations.length) {
      await assertSeedProjectCashAvailable(tx, amountCents);
    }
    const fundingAllocation =
      fundingAllocations[0] ??
      (await tx.projectFundingAllocation.create({
        data: expectedFundingAllocation,
        select: fundingAllocationSelect
      }));
    assertExactProjectFundingAllocationFacts(
      fundingAllocation,
      expectedFundingAllocation
    );

    const auditLogSelect = {
      id: true,
      actorUserId: true,
      action: true,
      businessType: true,
      businessId: true,
      ipAddress: true,
      userAgent: true,
      metadata: true
    };
    const existingAuditLog = await tx.auditLog.findUnique({
      where: { id: seedPaymentExecutionAuditId },
      select: auditLogSelect
    });
    const auditLog =
      existingAuditLog ??
      (await tx.auditLog.create({
        data: expectedAuditLog,
        select: auditLogSelect
      }));
    assertExactPaymentExecutionAuditFacts(auditLog, expectedAuditLog);
  });
}

async function seedWorkbenchTemplate(data) {
  const docxMetadata = await copyPrivateSeedFile(
    data.layout.docxFile,
    join(__dirname, "..", "assets", "templates", data.layout.docxFile.originalName)
  );
  const previewMetadata = await writePrivateSeedFile(
    data.layout.previewPdfFile,
    minimalPreviewPdf()
  );

  await upsertSeedFile(data.layout.docxFile, seed.users.contractStaff.id, docxMetadata);
  await upsertSeedFile(data.layout.previewPdfFile, seed.users.contractStaff.id, previewMetadata);

  await prisma.standardClause.upsert({
    where: { code: data.standardPaymentClause.code },
    update: {
      category: data.standardPaymentClause.category,
      name: data.standardPaymentClause.name
    },
    create: {
      id: data.standardPaymentClause.id,
      code: data.standardPaymentClause.code,
      category: data.standardPaymentClause.category,
      name: data.standardPaymentClause.name,
      createdByUserId: seed.users.contractStaff.id
    }
  });
  await prisma.standardClauseVersion.upsert({
    where: { id: data.standardPaymentClause.versionId },
    update: {
      title: data.standardPaymentClause.title,
      content: data.standardPaymentClause.content,
      status: data.standardPaymentClause.status,
      submittedByUserId: seed.users.contractStaff.id,
      publishedByUserId: "seed-user-contract-director",
      publishedAt: data.publishedAt,
      changeSummary: data.version.changeSummary
    },
    create: {
      id: data.standardPaymentClause.versionId,
      clauseId: data.standardPaymentClause.id,
      versionNo: data.standardPaymentClause.versionNo,
      title: data.standardPaymentClause.title,
      content: data.standardPaymentClause.content,
      status: data.standardPaymentClause.status,
      submittedByUserId: seed.users.contractStaff.id,
      publishedByUserId: "seed-user-contract-director",
      publishedAt: data.publishedAt,
      changeSummary: data.version.changeSummary
    }
  });

  await prisma.contractBusinessTemplate.upsert({
    where: { code: data.template.code },
    update: {
      name: data.template.name,
      contractTypeKey: data.template.contractTypeKey,
      status: data.template.status
    },
    create: {
      id: data.template.id,
      code: data.template.code,
      name: data.template.name,
      contractTypeKey: data.template.contractTypeKey,
      status: data.template.status,
      createdByUserId: seed.users.contractStaff.id
    }
  });
  await prisma.contractBusinessTemplateVersion.upsert({
    where: { id: data.version.id },
    update: {
      status: data.version.status,
      fieldSchema: data.fields,
      billSchema: data.bills,
      clauseSchema: data.clauses,
      attachmentSchema: data.attachments,
      validationSchema: data.validations,
      submittedByUserId: seed.users.contractStaff.id,
      publishedByUserId: "seed-user-contract-director",
      publishedAt: data.publishedAt,
      changeSummary: data.version.changeSummary
    },
    create: {
      id: data.version.id,
      templateId: data.template.id,
      versionNo: data.version.versionNo,
      status: data.version.status,
      fieldSchema: data.fields,
      billSchema: data.bills,
      clauseSchema: data.clauses,
      attachmentSchema: data.attachments,
      validationSchema: data.validations,
      submittedByUserId: seed.users.contractStaff.id,
      publishedByUserId: "seed-user-contract-director",
      publishedAt: data.publishedAt,
      changeSummary: data.version.changeSummary
    }
  });

  await prisma.contractLayoutTemplate.upsert({
    where: { id: data.layout.id },
    update: {
      name: data.layout.name,
      contractTypeKey: data.template.contractTypeKey
    },
    create: {
      id: data.layout.id,
      name: data.layout.name,
      contractTypeKey: data.template.contractTypeKey,
      createdByUserId: seed.users.contractStaff.id
    }
  });
  await prisma.contractLayoutTemplateVersion.upsert({
    where: { id: data.layout.versionId },
    update: {
      status: data.layout.status,
      docxFileId: data.layout.docxFile.id,
      placeholderSchema: {
        fields: data.fields,
        bills: data.bills,
        clauses: data.clauses,
        required: ["contract.amountUppercase"]
      },
      previewPdfFileId: data.layout.previewPdfFile.id,
      inspectionReport: data.layout.inspectionReport,
      submittedByUserId: seed.users.contractStaff.id,
      publishedByUserId: "seed-user-contract-director",
      publishedAt: data.publishedAt,
      changeSummary: data.version.changeSummary
    },
    create: {
      id: data.layout.versionId,
      layoutTemplateId: data.layout.id,
      versionNo: data.layout.versionNo,
      status: data.layout.status,
      docxFileId: data.layout.docxFile.id,
      placeholderSchema: {
        fields: data.fields,
        bills: data.bills,
        clauses: data.clauses,
        required: ["contract.amountUppercase"]
      },
      previewPdfFileId: data.layout.previewPdfFile.id,
      inspectionReport: data.layout.inspectionReport,
      submittedByUserId: seed.users.contractStaff.id,
      publishedByUserId: "seed-user-contract-director",
      publishedAt: data.publishedAt,
      changeSummary: data.version.changeSummary
    }
  });
  await prisma.contractLayoutPreviewJob.upsert({
    where: { id: data.layout.previewJob.id },
    update: {
      status: data.layout.previewJob.status,
      sampleData: data.layout.previewJob.sampleData,
      previewPdfFileId: data.layout.previewPdfFile.id,
      errorMessage: null,
      completedAt: data.layout.previewJob.completedAt
    },
    create: {
      id: data.layout.previewJob.id,
      layoutTemplateVersionId: data.layout.versionId,
      status: data.layout.previewJob.status,
      sampleData: data.layout.previewJob.sampleData,
      previewPdfFileId: data.layout.previewPdfFile.id,
      completedAt: data.layout.previewJob.completedAt,
      createdByUserId: seed.users.contractStaff.id
    }
  });

  await prisma.contractNumberRule.upsert({
    where: { id: data.numberingRule.id },
    update: {
      name: data.numberingRule.name,
      pattern: data.numberingRule.pattern,
      contractTypeKey: data.numberingRule.contractTypeKey,
      nextSequence: data.numberingRule.nextSequence,
      sequenceWidth: data.numberingRule.sequenceWidth,
      isActive: data.numberingRule.isActive
    },
    create: {
      id: data.numberingRule.id,
      name: data.numberingRule.name,
      pattern: data.numberingRule.pattern,
      contractTypeKey: data.numberingRule.contractTypeKey,
      nextSequence: data.numberingRule.nextSequence,
      sequenceWidth: data.numberingRule.sequenceWidth,
      isActive: data.numberingRule.isActive,
      createdByUserId: "seed-user-contract-director"
    }
  });
}

async function seedContractWorkbenchTemplates() {
  for (const data of [
    seed.materialPurchaseWorkbench,
    seed.equipmentRentalWorkbench,
    seed.laborSubcontractWorkbench,
    seed.genericContractWorkbench
  ]) {
    await seedWorkbenchTemplate(data);
  }
}

async function main() {
  const passwordHash = await bcrypt.hash(seedAuthRuntime.password, 10);

  for (const [key, name] of positions) {
    await prisma.position.upsert({
      where: { key },
      update: { name },
      create: { key, name }
    });
  }

  for (const user of authSeedUsers) {
    await seedUserWithPosition(user, passwordHash);
  }

  await prisma.project.upsert({
    where: { code: seed.project.code },
    update: { name: seed.project.name, isActive: true },
    create: {
      id: seed.project.id,
      code: seed.project.code,
      name: seed.project.name
    }
  });

  await prisma.companyEntity.upsert({
    where: { id: seed.companyEntity.id },
    update: {
      name: seed.companyEntity.name,
      unifiedSocialCreditCode: seed.companyEntity.unifiedSocialCreditCode,
      registeredAddress: seed.companyEntity.registeredAddress,
      dataStatus: seed.companyEntity.dataStatus,
      currentVersionNo: seed.companyEntity.currentVersionNo,
      isActive: seed.companyEntity.isActive
    },
    create: {
      id: seed.companyEntity.id,
      name: seed.companyEntity.name,
      unifiedSocialCreditCode: seed.companyEntity.unifiedSocialCreditCode,
      registeredAddress: seed.companyEntity.registeredAddress,
      dataStatus: seed.companyEntity.dataStatus,
      currentVersionNo: seed.companyEntity.currentVersionNo,
      isActive: seed.companyEntity.isActive
    }
  });
  await prisma.companyEntityVersion.upsert({
    where: { id: seed.companyEntityVersion.id },
    update: {
      companyEntityId: seed.companyEntityVersion.companyEntityId,
      versionNo: seed.companyEntityVersion.versionNo,
      name: seed.companyEntityVersion.name,
      unifiedSocialCreditCode: seed.companyEntityVersion.unifiedSocialCreditCode,
      registeredAddress: seed.companyEntityVersion.registeredAddress,
      isActive: seed.companyEntityVersion.isActive,
      action: seed.companyEntityVersion.action
    },
    create: {
      id: seed.companyEntityVersion.id,
      companyEntityId: seed.companyEntityVersion.companyEntityId,
      versionNo: seed.companyEntityVersion.versionNo,
      name: seed.companyEntityVersion.name,
      unifiedSocialCreditCode: seed.companyEntityVersion.unifiedSocialCreditCode,
      registeredAddress: seed.companyEntityVersion.registeredAddress,
      isActive: seed.companyEntityVersion.isActive,
      action: seed.companyEntityVersion.action
    }
  });
  await prisma.businessParty.upsert({
    where: { id: seedConstructionEnterpriseId },
    update: { name: "示例施工企业", status: "active" },
    create: {
      id: seedConstructionEnterpriseId,
      name: "示例施工企业",
      unifiedSocialCreditCode: "91310000SEEDBUILD01",
      status: "active",
      createdByUserId: seed.users.contractStaff.id
    }
  });
  await prisma.businessPartyVersion.upsert({
    where: { id: seedConstructionEnterpriseVersionId },
    update: {
      snapshot: { name: "示例施工企业", unifiedSocialCreditCode: "91310000SEEDBUILD01", attachments: [] }
    },
    create: {
      id: seedConstructionEnterpriseVersionId,
      businessPartyId: seedConstructionEnterpriseId,
      versionNo: 1,
      snapshot: { name: "示例施工企业", unifiedSocialCreditCode: "91310000SEEDBUILD01", attachments: [] },
      createdByUserId: seed.users.contractStaff.id
    }
  });
  await prisma.projectAffiliateAssignment.upsert({
    where: { id: seedConstructionEnterpriseAssignmentId },
    update: {
      affiliateNameSnapshot: "示例施工企业",
      affiliateCreditCodeSnapshot: "91310000SEEDBUILD01"
    },
    create: {
      id: seedConstructionEnterpriseAssignmentId,
      projectId: seed.project.id,
      businessPartyId: seedConstructionEnterpriseId,
      businessPartyVersionId: seedConstructionEnterpriseVersionId,
      affiliateNameSnapshot: "示例施工企业",
      affiliateCreditCodeSnapshot: "91310000SEEDBUILD01",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      changeReason: "本地示例数据前置条件",
      assignedByUserId: seed.users.contractStaff.id
    }
  });
  await prisma.projectParticipatingCompany.upsert({
    where: { id: seedParticipatingCompanyId },
    update: { endedAt: null, endedByUserId: null },
    create: {
      id: seedParticipatingCompanyId,
      projectId: seed.project.id,
      companyEntityId: seed.companyEntity.id,
      companyEntityVersionId: seed.companyEntityVersion.id,
      companyNameSnapshot: seed.companyEntityVersion.name,
      companyCreditCodeSnapshot: seed.companyEntityVersion.unifiedSocialCreditCode,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      changeReason: "本地示例数据前置条件",
      addedByUserId: seed.users.cashier.id
    }
  });

  await seedAuthAssignments();
  await seedContractWorkbenchTemplates();

  const ownerContractFileMetadata = await writePrivateSeedFile(
    seed.ownerContractFile,
    minimalPreviewPdf()
  );
  await upsertSeedFile(
    seed.ownerContractFile,
    seed.users.contractStaff.id,
    ownerContractFileMetadata
  );
  await prisma.projectOwnerContract.upsert({
    where: { id: seed.ownerContract.id },
    update: {
      projectId: seed.project.id,
      ownerName: seed.ownerContract.ownerName,
      contractName: seed.ownerContract.contractName,
      contractCode: seed.ownerContract.contractCode,
      signedAt: seed.ownerContract.signedAt,
      amountCents: BigInt(seed.ownerContract.amountCents),
      taxRateBps: seed.ownerContract.taxRateBps,
      pricingMethod: seed.ownerContract.pricingMethod,
      paymentTermsSummary: seed.ownerContract.paymentTermsSummary,
      retentionSummary: seed.ownerContract.retentionSummary,
      fileId: seed.ownerContractFile.id,
      documentVersion: seed.ownerContract.documentVersion,
      fileContentSha256Snapshot: ownerContractFileMetadata.contentSha256,
      recordedByUserId: seed.users.contractStaff.id,
      confirmedByUserId: "seed-user-contract-director",
      confirmedAt: seed.ownerContract.confirmedAt,
      status: seed.ownerContract.status,
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null
    },
    create: {
      id: seed.ownerContract.id,
      projectId: seed.project.id,
      ownerName: seed.ownerContract.ownerName,
      contractName: seed.ownerContract.contractName,
      contractCode: seed.ownerContract.contractCode,
      signedAt: seed.ownerContract.signedAt,
      amountCents: BigInt(seed.ownerContract.amountCents),
      taxRateBps: seed.ownerContract.taxRateBps,
      pricingMethod: seed.ownerContract.pricingMethod,
      paymentTermsSummary: seed.ownerContract.paymentTermsSummary,
      retentionSummary: seed.ownerContract.retentionSummary,
      fileId: seed.ownerContractFile.id,
      documentVersion: seed.ownerContract.documentVersion,
      fileContentSha256Snapshot: ownerContractFileMetadata.contentSha256,
      recordedByUserId: seed.users.contractStaff.id,
      confirmedByUserId: "seed-user-contract-director",
      confirmedAt: seed.ownerContract.confirmedAt,
      status: seed.ownerContract.status
    }
  });

  const upstreamSettlementFileMetadata = await writePrivateSeedFile(
    seed.upstreamSettlementFile,
    minimalPreviewPdf()
  );
  await upsertSeedFile(
    seed.upstreamSettlementFile,
    "seed-user-budget-staff",
    upstreamSettlementFileMetadata
  );
  await prisma.projectUpstreamSettlement.upsert({
    where: { id: seed.upstreamSettlement.id },
    update: {
      projectId: seed.project.id,
      settledAt: seed.upstreamSettlement.settledAt,
      reportedAmountCents: BigInt(seed.upstreamSettlement.reportedAmountCents),
      approvedAmountCents: BigInt(seed.upstreamSettlement.approvedAmountCents),
      approvingPartyName: seed.upstreamSettlement.approvingPartyName,
      periodLabel: seed.upstreamSettlement.periodLabel,
      isFinal: seed.upstreamSettlement.isFinal,
      description: seed.upstreamSettlement.description,
      voucherFileId: seed.upstreamSettlementFile.id,
      documentVersion: seed.upstreamSettlement.documentVersion,
      fileContentSha256Snapshot: upstreamSettlementFileMetadata.contentSha256,
      recordedByUserId: "seed-user-budget-staff",
      status: seed.upstreamSettlement.status,
      confirmedByUserId: null,
      confirmedAt: null,
      confirmationSignatureVersionId: null,
      confirmationSignatureFileId: null,
      confirmationSignatureSha256: null,
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null
    },
    create: {
      id: seed.upstreamSettlement.id,
      projectId: seed.project.id,
      settledAt: seed.upstreamSettlement.settledAt,
      reportedAmountCents: BigInt(seed.upstreamSettlement.reportedAmountCents),
      approvedAmountCents: BigInt(seed.upstreamSettlement.approvedAmountCents),
      approvingPartyName: seed.upstreamSettlement.approvingPartyName,
      periodLabel: seed.upstreamSettlement.periodLabel,
      isFinal: seed.upstreamSettlement.isFinal,
      description: seed.upstreamSettlement.description,
      voucherFileId: seed.upstreamSettlementFile.id,
      documentVersion: seed.upstreamSettlement.documentVersion,
      fileContentSha256Snapshot: upstreamSettlementFileMetadata.contentSha256,
      recordedByUserId: "seed-user-budget-staff",
      status: seed.upstreamSettlement.status
    }
  });

  const projectReceiptFileMetadata = await writePrivateSeedFile(
    seed.projectReceiptFile,
    minimalPreviewPdf()
  );
  await upsertSeedFile(seed.projectReceiptFile, seed.users.cashier.id, projectReceiptFileMetadata);
  await prisma.projectReceipt.upsert({
    where: { id: seed.projectReceipt.id },
    update: {
      projectId: seed.project.id,
      receivedAt: seed.projectReceipt.receivedAt,
      amountCents: BigInt(seed.projectReceipt.amountCents),
      payerName: seed.projectReceipt.payerName,
      sourceType: seed.projectReceipt.sourceType,
      description: seed.projectReceipt.description,
      voucherFileId: seed.projectReceiptFile.id,
      recordedByUserId: seed.users.cashier.id,
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null
    },
    create: {
      id: seed.projectReceipt.id,
      projectId: seed.project.id,
      receivedAt: seed.projectReceipt.receivedAt,
      amountCents: BigInt(seed.projectReceipt.amountCents),
      payerName: seed.projectReceipt.payerName,
      sourceType: seed.projectReceipt.sourceType,
      description: seed.projectReceipt.description,
      voucherFileId: seed.projectReceiptFile.id,
      recordedByUserId: seed.users.cashier.id
    }
  });

  await prisma.companyEntity.upsert({
    where: { id: seed.companyEntity.id },
    update: {
      name: seed.companyEntity.name,
      unifiedSocialCreditCode: seed.companyEntity.unifiedSocialCreditCode,
      registeredAddress: seed.companyEntity.registeredAddress,
      dataStatus: seed.companyEntity.dataStatus,
      currentVersionNo: seed.companyEntity.currentVersionNo,
      isActive: seed.companyEntity.isActive
    },
    create: {
      id: seed.companyEntity.id,
      name: seed.companyEntity.name,
      unifiedSocialCreditCode: seed.companyEntity.unifiedSocialCreditCode,
      registeredAddress: seed.companyEntity.registeredAddress,
      dataStatus: seed.companyEntity.dataStatus,
      currentVersionNo: seed.companyEntity.currentVersionNo,
      isActive: seed.companyEntity.isActive
    }
  });

  await prisma.companyEntityVersion.upsert({
    where: { id: seed.companyEntityVersion.id },
    update: {
      companyEntityId: seed.companyEntityVersion.companyEntityId,
      versionNo: seed.companyEntityVersion.versionNo,
      name: seed.companyEntityVersion.name,
      unifiedSocialCreditCode:
        seed.companyEntityVersion.unifiedSocialCreditCode,
      registeredAddress: seed.companyEntityVersion.registeredAddress,
      isActive: seed.companyEntityVersion.isActive,
      action: seed.companyEntityVersion.action
    },
    create: {
      id: seed.companyEntityVersion.id,
      companyEntityId: seed.companyEntityVersion.companyEntityId,
      versionNo: seed.companyEntityVersion.versionNo,
      name: seed.companyEntityVersion.name,
      unifiedSocialCreditCode:
        seed.companyEntityVersion.unifiedSocialCreditCode,
      registeredAddress: seed.companyEntityVersion.registeredAddress,
      isActive: seed.companyEntityVersion.isActive,
      action: seed.companyEntityVersion.action
    }
  });

  await prisma.contract.upsert({
    where: { code: seed.contract.code },
    update: {
      projectId: seed.project.id,
      name: seed.contract.name,
      counterparty: seed.contract.counterparty,
      companyEntityId: seed.companyEntity.id,
      companyEntityName: seed.companyEntity.name
    },
    create: {
      id: seed.contract.id,
      projectId: seed.project.id,
      code: seed.contract.code,
      name: seed.contract.name,
      counterparty: seed.contract.counterparty,
      companyEntityId: seed.companyEntity.id,
      companyEntityName: seed.companyEntity.name
    }
  });

  await prisma.contractVersion.upsert({
    where: { id: seed.contractVersion.id },
    update: {
      status: seed.contractVersion.status,
      amountCents: BigInt(seed.contractVersion.amountCents),
      effectiveAt: seed.contractVersion.effectiveAt,
      signingSubjectType: seed.contractVersion.signingSubjectType,
      companyEntityIdSnapshot:
        seed.contractVersion.companyEntityIdSnapshot,
      companyEntityVersionId: seed.contractVersion.companyEntityVersionId,
      companyEntityNameSnapshot:
        seed.contractVersion.companyEntityNameSnapshot,
      companyEntityCreditCodeSnapshot:
        seed.contractVersion.companyEntityCreditCodeSnapshot,
      companyEntityRegisteredAddressSnapshot:
        seed.contractVersion.companyEntityRegisteredAddressSnapshot,
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: []
    },
    create: {
      id: seed.contractVersion.id,
      contractId: seed.contract.id,
      versionNo: seed.contractVersion.versionNo,
      changeType: seed.contractVersion.changeType,
      status: seed.contractVersion.status,
      amountCents: BigInt(seed.contractVersion.amountCents),
      effectiveAt: seed.contractVersion.effectiveAt,
      signingSubjectType: seed.contractVersion.signingSubjectType,
      companyEntityIdSnapshot:
        seed.contractVersion.companyEntityIdSnapshot,
      companyEntityVersionId: seed.contractVersion.companyEntityVersionId,
      companyEntityNameSnapshot:
        seed.contractVersion.companyEntityNameSnapshot,
      companyEntityCreditCodeSnapshot:
        seed.contractVersion.companyEntityCreditCodeSnapshot,
      companyEntityRegisteredAddressSnapshot:
        seed.contractVersion.companyEntityRegisteredAddressSnapshot,
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: []
    }
  });

  await prisma.paymentTermsVersion.upsert({
    where: { id: seed.paymentTermsVersion.id },
    update: {
      status: seed.paymentTermsVersion.status,
      originalText: seed.paymentTermsVersion.originalText
    },
    create: {
      id: seed.paymentTermsVersion.id,
      contractId: seed.contract.id,
      contractVersionId: seed.contractVersion.id,
      versionNo: seed.paymentTermsVersion.versionNo,
      status: seed.paymentTermsVersion.status,
      originalText: seed.paymentTermsVersion.originalText
    }
  });

  for (const stage of seed.paymentStages) {
    await prisma.paymentTermsStage.upsert({
      where: { id: stage.id },
      update: {
        name: stage.name,
        stageType: stage.stageType,
        basis: stage.basis,
        ratioBps: stage.ratioBps,
        triggerEvent: stage.triggerEvent,
        triggerAnchor: stage.triggerAnchor,
        dueDays: stage.dueDays,
        requiresInvoice: stage.requiresInvoice,
        allowsEarlyPayment: stage.allowsEarlyPayment,
        allowsInstallments: stage.allowsInstallments,
        retentionBps: stage.retentionBps,
        originalText: stage.originalText
      },
      create: {
        id: stage.id,
        paymentTermsVersionId: seed.paymentTermsVersion.id,
        name: stage.name,
        stageType: stage.stageType,
        basis: stage.basis,
        ratioBps: stage.ratioBps,
        triggerAnchor: stage.triggerAnchor,
        triggerEvent: stage.triggerEvent,
        dueDays: stage.dueDays,
        requiresInvoice: stage.requiresInvoice,
        allowsEarlyPayment: stage.allowsEarlyPayment,
        allowsInstallments: stage.allowsInstallments,
        retentionBps: stage.retentionBps,
        originalText: stage.originalText
      }
    });
  }

  await prisma.settlement.upsert({
    where: { code: seed.settlement.code },
    update: {
      status: seed.settlement.status,
      amountCents: seed.settlement.amountCents,
      payableAmountCents: seed.settlement.payableAmountCents,
      paidAmountCents: seed.settlement.paidAmountCents,
      isFinal: seed.settlement.isFinal
    },
    create: {
      id: seed.settlement.id,
      projectId: seed.project.id,
      contractId: seed.contract.id,
      contractVersionId: seed.contractVersion.id,
      paymentTermsVersionId: seed.paymentTermsVersion.id,
      code: seed.settlement.code,
      periodLabel: seed.settlement.periodLabel,
      status: seed.settlement.status,
      amountCents: seed.settlement.amountCents,
      payableAmountCents: seed.settlement.payableAmountCents,
      paidAmountCents: seed.settlement.paidAmountCents,
      isFinal: seed.settlement.isFinal
    }
  });

  await prisma.paymentRequest.upsert({
    where: { code: seed.paymentRequest.code },
    update: {
      status: seed.paymentRequest.status,
      requestedAmountCents: seed.paymentRequest.requestedAmountCents,
      approvedAmountCents: seed.paymentRequest.approvedAmountCents,
      paidAmountCents: seed.paymentRequest.paidAmountCents,
      paymentSubjectType: seed.paymentExecution.paymentSubjectType,
      dueDate: seed.paymentRequest.dueDate
    },
    create: {
      id: seed.paymentRequest.id,
      projectId: seed.project.id,
      settlementId: seed.settlement.id,
      contractId: seed.contract.id,
      contractVersionId: seed.contractVersion.id,
      paymentTermsVersionId: seed.paymentTermsVersion.id,
      code: seed.paymentRequest.code,
      status: seed.paymentRequest.status,
      requestedAmountCents: seed.paymentRequest.requestedAmountCents,
      approvedAmountCents: seed.paymentRequest.approvedAmountCents,
      paidAmountCents: seed.paymentRequest.paidAmountCents,
      paymentSubjectType: seed.paymentExecution.paymentSubjectType,
      dueDate: seed.paymentRequest.dueDate
    }
  });

  await prisma.fileObject.upsert({
    where: { id: seed.voucherFile.id },
    update: {
      bucket: seed.voucherFile.bucket,
      objectKey: seed.voucherFile.objectKey,
      originalName: seed.voucherFile.originalName,
      mimeType: seed.voucherFile.mimeType,
      sizeBytes: seed.voucherFile.sizeBytes,
      uploadedByUserId: seed.users.cashier.id,
      storageStatus: "active"
    },
    create: {
      id: seed.voucherFile.id,
      bucket: seed.voucherFile.bucket,
      objectKey: seed.voucherFile.objectKey,
      originalName: seed.voucherFile.originalName,
      mimeType: seed.voucherFile.mimeType,
      sizeBytes: seed.voucherFile.sizeBytes,
      uploadedByUserId: seed.users.cashier.id,
      storageStatus: "active"
    }
  });

  await seedPaymentExecutionClosedLoop();

  const accountSummary = authSeedUsers
    .map((user) => `${user.positionKey}:${user.phone}`)
    .join(", ");
  for (const line of seedAuthLogLines(seedAuthRuntime, accountSummary)) {
    console.log(line);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
