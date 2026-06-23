const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");

const prisma = new PrismaClient();
const seed = coreFlowSeedData;
const testPassword = "Jgzg@2026";
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
  ["engineering_director", "工程部主管"],
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

async function main() {
  const passwordHash = await bcrypt.hash(testPassword, 10);

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

  await seedAuthAssignments();

  await prisma.contract.upsert({
    where: { code: seed.contract.code },
    update: {
      projectId: seed.project.id,
      name: seed.contract.name,
      counterparty: seed.contract.counterparty
    },
    create: {
      id: seed.contract.id,
      projectId: seed.project.id,
      code: seed.contract.code,
      name: seed.contract.name,
      counterparty: seed.contract.counterparty
    }
  });

  await prisma.contractVersion.upsert({
    where: { id: seed.contractVersion.id },
    update: {
      status: seed.contractVersion.status,
      amountCents: seed.contractVersion.amountCents,
      effectiveAt: seed.contractVersion.effectiveAt
    },
    create: {
      id: seed.contractVersion.id,
      contractId: seed.contract.id,
      versionNo: seed.contractVersion.versionNo,
      changeType: seed.contractVersion.changeType,
      status: seed.contractVersion.status,
      amountCents: seed.contractVersion.amountCents,
      effectiveAt: seed.contractVersion.effectiveAt
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
        basis: stage.basis,
        ratioBps: stage.ratioBps,
        triggerEvent: stage.triggerEvent,
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
        basis: stage.basis,
        ratioBps: stage.ratioBps,
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
      paidAmountCents: seed.settlement.paidAmountCents
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
      paidAmountCents: seed.settlement.paidAmountCents
    }
  });

  await prisma.paymentRequest.upsert({
    where: { code: seed.paymentRequest.code },
    update: {
      status: seed.paymentRequest.status,
      requestedAmountCents: seed.paymentRequest.requestedAmountCents,
      approvedAmountCents: seed.paymentRequest.approvedAmountCents,
      paidAmountCents: seed.paymentRequest.paidAmountCents,
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
      sizeBytes: seed.voucherFile.sizeBytes
    },
    create: {
      id: seed.voucherFile.id,
      bucket: seed.voucherFile.bucket,
      objectKey: seed.voucherFile.objectKey,
      originalName: seed.voucherFile.originalName,
      mimeType: seed.voucherFile.mimeType,
      sizeBytes: seed.voucherFile.sizeBytes,
      uploadedByUserId: seed.users.cashier.id
    }
  });

  await prisma.paymentExecution.upsert({
    where: { id: seed.paymentExecution.id },
    update: {
      amountCents: seed.paymentExecution.amountCents,
      paidAt: seed.paymentExecution.paidAt,
      voucherFileId: seed.voucherFile.id
    },
    create: {
      id: seed.paymentExecution.id,
      paymentRequestId: seed.paymentRequest.id,
      settlementId: seed.settlement.id,
      amountCents: seed.paymentExecution.amountCents,
      paidAt: seed.paymentExecution.paidAt,
      executedByUserId: seed.users.cashier.id,
      voucherFileId: seed.voucherFile.id
    }
  });

  console.log("Auth seed accounts password:", testPassword);
  console.log(
    "Auth seed accounts:",
    authSeedUsers.map((user) => `${user.positionKey}:${user.phone}`).join(", ")
  );
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
