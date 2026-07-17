import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";

const payment = {
  id: "payment-1",
  projectId: "project-1",
  procurementId: "procurement-1",
  procurementVersionId: "version-1",
  code: "LXCG-001-V1-P001",
  status: "draft",
  settlementAmountCents: 0n,
  supplierBalanceAmountCents: 0n,
  companyPaymentAmountCents: 0n,
  paidAmountCents: 0n,
  executedSupplierBalanceAmountCents: 0n,
  canceledAmountCents: 0n,
  canceledCompanyPaymentAmountCents: 0n,
  canceledSupplierBalanceAmountCents: 0n,
  paymentPath: null,
  paymentMethod: null,
  paymentType: null,
  merchantNameSnapshot: null,
  merchantPayeeMismatchNote: null,
  payeePartyId: null,
  payeeUserId: null,
  payeeNameSnapshot: null,
  payeeAccountNameSnapshot: null,
  payeeBankNameSnapshot: null,
  payeeBankAccountSnapshot: null,
  approvalAmountCents: 0n,
  primaryPaymentChannelId: null,
  handlerUserId: "material-1",
  createdByUserId: "manager-1"
};

function createHarness() {
  const tx = {
    spotProcurementPayment: {
      findUnique: jest.fn().mockResolvedValue(payment),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...payment, ...data }))
    },
    spotProcurement: {
      findUnique: jest.fn().mockResolvedValue({
        id: "procurement-1",
        currentVersionId: "version-1",
        status: "approved_in_progress"
      })
    },
    spotProcurementVersion: {
      findUnique: jest.fn().mockResolvedValue({ id: "version-1", status: "approved", versionNo: 1 })
    },
    spotProcurementLine: {
      findMany: jest.fn().mockResolvedValue([
        { id: "procurement-line-1", quantity: new Prisma.Decimal("3") }
      ])
    },
    vatRateOption: {
      findMany: jest.fn().mockResolvedValue([
        { id: "vat-13", rateValue: { toString: () => "13" }, label: "13%" }
      ])
    },
    user: { findUnique: jest.fn().mockResolvedValue({ id: "material-1", name: "杨帅", isActive: true }) },
    fileObject: { findMany: jest.fn().mockResolvedValue([]) },
    spotProcurementPaymentLine: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentChannel: {
      deleteMany: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "channel-1", ...data })),
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentMethodOption: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentAttachment: { deleteMany: jest.fn(), createMany: jest.fn() },
    approvalInstance: { create: jest.fn().mockResolvedValue({ id: "approval-1" }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) }
  };
  const prisma = {
    $transaction: jest.fn((operation) => operation(tx)),
    spotProcurementPayment: { findUnique: jest.fn().mockResolvedValue(payment) }
  };
  const audit = { record: jest.fn((client, input) => client.auditLog.create({ data: input })) };
  const service = new SpotProcurementPaymentService(
    prisma as never,
    audit as never,
    { assertEnabled: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    { tryRefreshLatestForBusiness: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never
  );
  return { service, tx };
}

const realFormInput = {
  paymentType: "company_direct" as const,
  merchantName: "昆明建材商行",
  payeeName: "昆明建材商行",
  paymentLines: [
    {
      procurementLineId: "procurement-line-1",
      paymentQuantity: "2",
      unitPrice: "3.50",
      expectedInvoiceCondition: "vat_general" as const,
      vatRateOptionId: "vat-13"
    }
  ],
  channels: [
    {
      channelType: "bank_transfer" as const,
      accountName: "昆明建材商行",
      accountNumber: "622200001",
      bankName: "建设银行",
      isPrimary: true
    }
  ],
  paymentMethods: ["bank_transfer" as const],
  attachments: []
};

describe("SpotProcurementPaymentService real-form draft", () => {
  it("recalculates payment amount from approved procurement lines and freezes merchant/payment facts on the one draft", async () => {
    const { service, tx } = createHarness();

    const result = await service.updateDraft("payment-1", "material-1", realFormInput);

    expect(tx.spotProcurementPaymentLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          procurementLineId: "procurement-line-1",
          amountCents: 700n,
          expectedInvoiceCondition: "vat_general",
          vatRateOptionId: "vat-13"
        })
      ]
    });
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        merchantNameSnapshot: "昆明建材商行",
        payeeNameSnapshot: "昆明建材商行",
        paymentType: "company_direct",
        approvalAmountCents: 700n,
        settlementAmountCents: 700n
      })
    });
    expect(result).toMatchObject({ settlementAmountCents: "700" });
  });

  it("requires a concise explanation when company-paid merchant and payee differ", async () => {
    const { service } = createHarness();

    await expect(
      service.updateDraft("payment-1", "material-1", {
        ...realFormInput,
        payeeName: "张三"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("submits the frozen payment facts without reserving a merchant balance or inventing a payer company", async () => {
    const { service, tx } = createHarness();
    const completed = {
      ...payment,
      paymentType: "company_direct",
      merchantNameSnapshot: "昆明建材商行",
      payeeNameSnapshot: "昆明建材商行",
      approvalAmountCents: 700n
    };
    tx.spotProcurementPayment.findUnique.mockResolvedValue(completed);
    tx.spotProcurementPaymentLine.findMany.mockResolvedValue([{ amountCents: 700n }]);
    tx.spotProcurementPaymentChannel.findMany.mockResolvedValue([{ isPrimary: true }]);
    tx.spotProcurementPaymentMethodOption.findMany.mockResolvedValue([
      { paymentMethod: "bank_transfer" }
    ]);
    const prisma = (service as unknown as { prisma: { spotProcurementPayment: { findUnique: jest.Mock } } }).prisma;
    prisma.spotProcurementPayment.findUnique.mockResolvedValue(completed);

    await service.submit("payment-1", "material-1");

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "payment-1",
        status: "approval_pending"
      })
    });
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        status: "approval_pending",
        submittedVersionNo: 1
      })
    });
  });
});
