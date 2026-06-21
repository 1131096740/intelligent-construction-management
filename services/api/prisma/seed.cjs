const { PrismaClient } = require("@prisma/client");
const { coreFlowSeedData } = require("../dist/database/core-flow-seed-data");

const prisma = new PrismaClient();
const seed = coreFlowSeedData;

async function main() {
  await prisma.user.upsert({
    where: { id: seed.users.contractStaff.id },
    update: {
      name: seed.users.contractStaff.name,
      phone: seed.users.contractStaff.phone,
      isActive: true
    },
    create: {
      id: seed.users.contractStaff.id,
      name: seed.users.contractStaff.name,
      phone: seed.users.contractStaff.phone
    }
  });

  await prisma.user.upsert({
    where: { id: seed.users.cashier.id },
    update: {
      name: seed.users.cashier.name,
      phone: seed.users.cashier.phone,
      isActive: true
    },
    create: {
      id: seed.users.cashier.id,
      name: seed.users.cashier.name,
      phone: seed.users.cashier.phone
    }
  });

  await prisma.project.upsert({
    where: { code: seed.project.code },
    update: { name: seed.project.name, isActive: true },
    create: {
      id: seed.project.id,
      code: seed.project.code,
      name: seed.project.name
    }
  });

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
