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
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...payment, ...data }))
    },
    spotProcurementPaymentExecution: {
      findFirst: jest.fn().mockResolvedValue(null)
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
        { id: "procurement-line-1", quantity: new Prisma.Decimal("1") }
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
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0)
    },
    spotProcurementPaymentAttachment: { deleteMany: jest.fn(), createMany: jest.fn() },
    approvalInstance: {
      create: jest.fn().mockResolvedValue({ id: "approval-1" }),
      update: jest.fn().mockResolvedValue({ id: "approval-1" })
    },
    approvalActionLog: { create: jest.fn().mockResolvedValue({}) },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }]) },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    companyEntity: {
      findFirst: jest.fn().mockResolvedValue({
        id: "company-1",
        name: "云南建工集团",
        unifiedSocialCreditCode: "91530000TEST000001"
      })
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([
      {
        id: "version-1",
        procurementId: "procurement-1",
        projectId: "project-1",
        procurementCode: "LXCG-001",
        currentVersionId: "version-1",
        rootStatus: "approved_in_progress",
        versionStatus: "approved",
        versionNo: 1,
        supplierPartyId: null,
        supplierKey: "",
        supplierNameSnapshot: "",
        handlerUserId: "material-1",
        totalAmountCents: null
      }
    ])
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
    {} as never,
    {} as never
  );
  return { service, tx, prisma };
}

const realFormInput = {
  paymentType: "company_direct" as const,
  merchantName: "昆明建材商行",
  payeeName: "昆明建材商行",
  paymentLines: [
    {
      procurementLineId: "procurement-line-1",
      paymentQuantity: "1.00",
      unitPrice: "3.50",
      expectedInvoiceCondition: "vat_general" as const,
      vatRatePercent: "13"
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
          amountCents: 350n,
          expectedInvoiceCondition: "vat_general",
          vatRateOptionId: null,
          vatRateValueSnapshot: new Prisma.Decimal("13"),
          vatRateLabelSnapshot: "13%"
        })
      ]
    });
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        merchantNameSnapshot: "昆明建材商行",
        payeeNameSnapshot: "昆明建材商行",
        paymentType: "company_direct",
        approvalAmountCents: 350n,
        settlementAmountCents: 350n
      })
    });
    expect(result).toMatchObject({ settlementAmountCents: "350" });
  });

  it.each([
    ["付款数量", { paymentQuantity: "1.001" }],
    ["含税或无票单价", { unitPrice: "3.333" }]
  ])("rejects a three-place %s before saving the payment draft", async (_label, override) => {
    const { service, tx } = createHarness();

    await expect(
      service.updateDraft("payment-1", "material-1", {
        ...realFormInput,
        paymentLines: [{ ...realFormInput.paymentLines[0], ...override }]
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.spotProcurementPaymentLine.createMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
  });

  it.each([
    ["0", "0%"],
    ["13.12", "13.12%"]
  ])("freezes %s%% as a payment-line tax snapshot", async (vatRatePercent, label) => {
    const { service, tx } = createHarness();

    await service.updateDraft("payment-1", "material-1", {
      ...realFormInput,
      paymentLines: [{ ...realFormInput.paymentLines[0], vatRatePercent }]
    });

    expect(tx.spotProcurementPaymentLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        vatRateOptionId: null,
        vatRateValueSnapshot: new Prisma.Decimal(vatRatePercent),
        vatRateLabelSnapshot: label
      })]
    });
  });

  it.each(["100.01", "13.123", "-1", "税率13"])(
    "rejects invalid free tax rate %s",
    async (vatRatePercent) => {
      const { service, tx } = createHarness();

      await expect(service.updateDraft("payment-1", "material-1", {
        ...realFormInput,
        paymentLines: [{ ...realFormInput.paymentLines[0], vatRatePercent }]
      })).rejects.toThrow("税率必须是 0 到 100、最多 2 位小数的数字");
      expect(tx.spotProcurementPaymentLine.createMany).not.toHaveBeenCalled();
    }
  );

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
    tx.spotProcurementPaymentLine.findMany.mockResolvedValue([
      {
        procurementLineId: "procurement-line-1",
        paymentQuantity: new Prisma.Decimal("1"),
        amountCents: 700n
      }
    ]);
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

  it("rejects a real-form material payment at the 3000 yuan boundary", async () => {
    const { service, tx } = createHarness();
    const completed = {
      ...payment,
      paymentType: "company_direct",
      merchantNameSnapshot: "昆明建材商行",
      payeeNameSnapshot: "昆明建材商行",
      approvalAmountCents: 300_000n
    };
    tx.spotProcurementPayment.findUnique.mockResolvedValue(completed);
    tx.spotProcurementPaymentLine.findMany.mockResolvedValue([
      {
        procurementLineId: "procurement-line-1",
        paymentQuantity: new Prisma.Decimal("1"),
        amountCents: 300_000n
      }
    ]);
    tx.spotProcurementPaymentChannel.findMany.mockResolvedValue([{ isPrimary: true }]);
    tx.spotProcurementPaymentMethodOption.findMany.mockResolvedValue([
      { paymentMethod: "bank_transfer" }
    ]);
    const prisma = (service as unknown as {
      prisma: { spotProcurementPayment: { findUnique: jest.Mock } };
    }).prisma;
    prisma.spotProcurementPayment.findUnique.mockResolvedValue(completed);

    await expect(service.submit("payment-1", "material-1")).rejects.toThrow(
      "材料申请合计达到 3000 元，请重新走材料采购审批流程"
    );
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
  });

  it("uses the aggregate of every material line for the 3000 yuan boundary", async () => {
    const { service, tx } = createHarness();
    const completed = {
      ...payment,
      paymentType: "company_direct",
      merchantNameSnapshot: "昆明建材商行",
      payeeNameSnapshot: "昆明建材商行",
      approvalAmountCents: 300_000n
    };
    tx.spotProcurementPayment.findUnique.mockResolvedValue(completed);
    tx.spotProcurementLine.findMany.mockResolvedValue([
      { id: "procurement-line-1", quantity: new Prisma.Decimal("1") },
      { id: "procurement-line-2", quantity: new Prisma.Decimal("2") }
    ]);
    tx.spotProcurementPaymentLine.findMany.mockResolvedValue([
      {
        procurementLineId: "procurement-line-1",
        paymentQuantity: new Prisma.Decimal("1"),
        amountCents: 100_000n
      },
      {
        procurementLineId: "procurement-line-2",
        paymentQuantity: new Prisma.Decimal("2"),
        amountCents: 200_000n
      }
    ]);
    tx.spotProcurementPaymentChannel.findMany.mockResolvedValue([{ isPrimary: true }]);
    tx.spotProcurementPaymentMethodOption.findMany.mockResolvedValue([
      { paymentMethod: "bank_transfer" }
    ]);
    const prisma = (service as unknown as {
      prisma: { spotProcurementPayment: { findUnique: jest.Mock } };
    }).prisma;
    prisma.spotProcurementPayment.findUnique.mockResolvedValue(completed);

    await expect(service.submit("payment-1", "material-1")).rejects.toThrow(
      "材料申请合计达到 3000 元，请重新走材料采购审批流程"
    );
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("requires one full payment line for every approved material line", async () => {
    const { service, tx } = createHarness();
    tx.spotProcurementLine.findMany.mockResolvedValue([
      { id: "procurement-line-1", quantity: new Prisma.Decimal("3") },
      { id: "procurement-line-2", quantity: new Prisma.Decimal("2") }
    ]);

    await expect(
      service.updateDraft("payment-1", "material-1", realFormInput)
    ).rejects.toThrow("零星材料付款必须完整覆盖本申请全部批准材料和数量");
    expect(tx.spotProcurementPaymentLine.createMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
  });

  it("rejects a sibling active payment for the same material application version", async () => {
    const { service, tx } = createHarness();
    const completed = {
      ...payment,
      paymentType: "company_direct",
      merchantNameSnapshot: "昆明建材商行",
      payeeNameSnapshot: "昆明建材商行",
      approvalAmountCents: 700n
    };
    tx.spotProcurementPayment.findUnique.mockResolvedValue(completed);
    tx.spotProcurementPaymentLine.findMany.mockResolvedValue([
      {
        procurementLineId: "procurement-line-1",
        paymentQuantity: new Prisma.Decimal("3"),
        amountCents: 700n
      }
    ]);
    tx.spotProcurementPaymentChannel.findMany.mockResolvedValue([{ isPrimary: true }]);
    tx.spotProcurementPaymentMethodOption.findMany.mockResolvedValue([
      { paymentMethod: "bank_transfer" }
    ]);
    tx.spotProcurementPayment.findMany.mockResolvedValue([
      {
        ...completed,
        id: "payment-sibling",
        code: "LXCG-001-V1-P002",
        status: "approval_pending"
      }
    ]);
    const prisma = (service as unknown as {
      prisma: { spotProcurementPayment: { findUnique: jest.Mock } };
    }).prisma;
    prisma.spotProcurementPayment.findUnique.mockResolvedValue(completed);

    await expect(service.submit("payment-1", "material-1")).rejects.toThrow(
      "同一材料申请已有活动付款，不能拆分或重复提交"
    );
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
  });

  it("lets a project finance staff select only an active payer company on the draft", async () => {
    const { service, tx } = createHarness();
    tx.$queryRaw.mockResolvedValueOnce([payment]);

    await service.updatePayer("payment-1", "finance-1", {
      companyEntityId: "company-1",
      paymentMethods: ["bank_transfer"]
    });

    expect(tx.spotProcurementPaymentMethodOption.createMany).toHaveBeenCalledWith({
      data: [
        {
          paymentId: "payment-1",
          paymentMethod: "bank_transfer",
          sortOrder: 1
        }
      ]
    });
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        payerCompanyEntityId: "company-1",
        payerCompanyNameSnapshot: "云南建工集团"
      })
    });
  });

  it.each([
    ["finance_staff", "finance-1"],
    ["comprehensive_director", "comprehensive-1"],
    ["finance_director", "finance-director-1"]
  ])("shares the first payer completion task with %s", async (positionKey, actorUserId) => {
    const { service, tx } = createHarness();
    tx.$queryRaw.mockResolvedValueOnce([payment]);
    tx.projectMember.findMany.mockResolvedValue([{ positionKey }]);

    await service.updatePayer("payment-1", actorUserId, {
      companyEntityId: "company-1",
      paymentMethods: ["bank_transfer"]
    });

    expect(tx.spotProcurementPayment.update).toHaveBeenCalledTimes(1);
  });

  it("locks the payment row and rejects a stale shared-task save without duplicate writes", async () => {
    const { service, tx } = createHarness();
    tx.spotProcurementPaymentMethodOption.count.mockResolvedValue(1);
    tx.$queryRaw.mockResolvedValueOnce([
      {
        ...payment,
        payerCompanyEntityId: "company-already-selected",
        payerCompanyNameSnapshot: "已选付款主体"
      }
    ]);

    await expect(
      service.updatePayer("payment-1", "finance-1", {
        companyEntityId: "company-1",
        paymentMethods: ["bank_transfer"]
      })
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: "SPOT_PAYMENT_PAYER_TASK_COMPLETED",
        message: "付款主体任务已由其他岗位完成，请刷新后查看最新事实"
      }
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.spotProcurementPaymentMethodOption.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("repairs a missing payer name snapshot instead of treating methods alone as task completion", async () => {
    const { service, tx } = createHarness();
    tx.spotProcurementPaymentMethodOption.count.mockResolvedValue(1);
    tx.$queryRaw.mockResolvedValueOnce([
      {
        ...payment,
        payerCompanyEntityId: "company-1",
        payerCompanyNameSnapshot: null
      }
    ]);

    await service.updatePayer("payment-1", "finance-1", {
      companyEntityId: "company-1",
      paymentMethods: ["bank_transfer"]
    });

    expect(tx.companyEntity.findFirst).toHaveBeenCalledWith({
      where: { id: "company-1" },
      select: { id: true, name: true, unifiedSocialCreditCode: true }
    });
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        payerCompanyEntityId: "company-1",
        payerCompanyNameSnapshot: "云南建工集团"
      })
    });
  });

  it("rejects changing an existing payer while repairing its missing snapshot without writes", async () => {
    const { service, tx } = createHarness();
    tx.$queryRaw.mockResolvedValueOnce([
      {
        ...payment,
        payerCompanyEntityId: "company-legacy",
        payerCompanyNameSnapshot: null
      }
    ]);

    await expect(
      service.updatePayer("payment-1", "finance-1", {
        companyEntityId: "company-different",
        paymentMethods: ["bank_transfer"]
      })
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: "SPOT_PAYMENT_EXISTING_PAYER_IMMUTABLE",
        message: "已有付款主体只能补齐名称或拟付款方式，不能变更主体"
      }
    });

    expect(tx.companyEntity.findFirst).not.toHaveBeenCalled();
    expect(tx.spotProcurementPaymentMethodOption.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPaymentMethodOption.createMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("repairs a missing payer snapshot from the frozen company id even when the company is inactive", async () => {
    const { service, tx } = createHarness();
    tx.$queryRaw.mockResolvedValueOnce([
      {
        ...payment,
        payerCompanyEntityId: "company-inactive",
        payerCompanyNameSnapshot: null
      }
    ]);
    tx.companyEntity.findFirst.mockResolvedValue({
      id: "company-inactive",
      name: "历史停用主体",
      unifiedSocialCreditCode: "91530000INACTIVE01"
    });

    await service.updatePayer("payment-1", "finance-1", {
      companyEntityId: "company-inactive",
      paymentMethods: ["bank_transfer"]
    });

    expect(tx.companyEntity.findFirst).toHaveBeenCalledWith({
      where: { id: "company-inactive" },
      select: { id: true, name: true, unifiedSocialCreditCode: true }
    });
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        payerCompanyEntityId: "company-inactive",
        payerCompanyNameSnapshot: "历史停用主体"
      })
    });
    expect(tx.spotProcurementPaymentMethodOption.createMany).toHaveBeenCalledTimes(1);
  });

  it("retries one payer serialization conflict and then returns the stable completed-task conflict", async () => {
    const { service, tx, prisma } = createHarness();
    tx.spotProcurementPaymentMethodOption.count.mockResolvedValue(1);
    prisma.$transaction
      .mockRejectedValueOnce(Object.assign(new Error("serialization conflict"), { code: "P2034" }))
      .mockImplementationOnce((operation) => operation(tx));
    tx.$queryRaw.mockResolvedValueOnce([
      {
        ...payment,
        payerCompanyEntityId: "company-already-selected",
        payerCompanyNameSnapshot: "已选付款主体"
      }
    ]);

    await expect(
      service.updatePayer("payment-1", "finance-1", {
        companyEntityId: "company-1",
        paymentMethods: ["bank_transfer"]
      })
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: "SPOT_PAYMENT_PAYER_TASK_COMPLETED",
        message: "付款主体任务已由其他岗位完成，请刷新后查看最新事实"
      }
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.spotProcurementPaymentMethodOption.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ["finance_staff", "finance-1"],
    ["comprehensive_director", "comprehensive-1"],
    ["finance_director", "finance-director-1"]
  ])("lets %s complete payment methods on a legacy payer without changing it", async (positionKey, actorUserId) => {
    const { service, tx } = createHarness();
    const legacyHalfComplete = {
      ...payment,
      payerCompanyEntityId: "company-legacy",
      payerCompanyNameSnapshot: "历史付款主体",
      payerUnifiedSocialCreditCodeSnapshot: "91530000LEGACY0001"
    };
    tx.$queryRaw.mockResolvedValueOnce([legacyHalfComplete]);
    tx.projectMember.findMany.mockResolvedValue([{ positionKey }]);

    await service.updatePayer("payment-1", actorUserId, {
      companyEntityId: "company-legacy",
      paymentMethods: ["bank_transfer"]
    });

    expect(tx.spotProcurementPaymentMethodOption.createMany).toHaveBeenCalledTimes(1);
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
    expect(tx.companyEntity.findFirst).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          completedLegacyPaymentMethods: true
        })
      })
    });
  });

  it("returns the stable shared-task conflict after a legacy payer method completion", async () => {
    const { service, tx } = createHarness();
    const legacyHalfComplete = {
      ...payment,
      payerCompanyEntityId: "company-legacy",
      payerCompanyNameSnapshot: "历史付款主体",
      payerUnifiedSocialCreditCodeSnapshot: "91530000LEGACY0001"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([legacyHalfComplete])
      .mockResolvedValueOnce([legacyHalfComplete]);
    tx.spotProcurementPaymentMethodOption.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    await service.updatePayer("payment-1", "finance-1", {
      companyEntityId: "company-legacy",
      paymentMethods: ["bank_transfer"]
    });
    await expect(
      service.updatePayer("payment-1", "finance-1", {
        companyEntityId: "company-legacy",
        paymentMethods: ["bank_transfer"]
      })
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "SPOT_PAYMENT_PAYER_TASK_COMPLETED" }
    });

    expect(tx.spotProcurementPaymentMethodOption.createMany).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty planned payment method list before completing the shared task", async () => {
    const { service, tx } = createHarness();
    tx.$queryRaw.mockResolvedValueOnce([payment]);

    await expect(
      service.updatePayer("payment-1", "finance-1", {
        companyEntityId: "company-1",
        paymentMethods: []
      })
    ).rejects.toThrow("拟付款方式至少保留一种");

    expect(tx.spotProcurementPaymentMethodOption.createMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
  });

  it("maps a second payer serialization conflict to the same stable conflict without writes", async () => {
    const { service, tx, prisma } = createHarness();
    prisma.$transaction.mockRejectedValue(
      Object.assign(new Error("serialization conflict"), { code: "P2034" })
    );

    await expect(
      service.updatePayer("payment-1", "finance-1", {
        companyEntityId: "company-1",
        paymentMethods: ["bank_transfer"]
      })
    ).rejects.toMatchObject({
      status: 409,
      response: {
        code: "SPOT_PAYMENT_PAYER_TASK_COMPLETED",
        message: "付款主体任务已由其他岗位完成，请刷新后查看最新事实"
      }
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.spotProcurementPaymentMethodOption.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns a finance-director payer change to comprehensive approval and preserves the prior approval trail", async () => {
    const { service, tx } = createHarness();
    const submitted = {
      ...payment,
      status: "approval_pending",
      paymentMethod: "bank_transfer",
      payerCompanyEntityId: "company-before"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([submitted])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 2,
          applicantUserId: "material-1",
          frozenNodes: [
            {
              name: "综合部主管审批",
              mode: "any",
              roleKeys: ["comprehensive_director"],
              approvedRoleKeys: ["comprehensive_director"]
            },
            {
              name: "项目经理审批",
              mode: "any",
              roleKeys: ["project_manager"],
              approvedRoleKeys: ["project_manager"]
            },
            {
              name: "财务主管审批",
              mode: "any",
              roleKeys: ["finance_director"]
            }
          ]
        }
      ]);
    tx.projectMember.findMany.mockResolvedValue([{ positionKey: "finance_director" }]);

    await service.updatePayer("payment-1", "finance-director", {
      companyEntityId: "company-1",
      paymentMethods: ["bank_transfer"],
      changeReason: "付款主体需要改为实际出款公司"
    });

    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "payer_changed_reapproval",
        actorUserId: "finance-director"
      })
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: expect.objectContaining({
        currentNodeIndex: 0,
        status: "approval_pending",
        frozenNodes: expect.arrayContaining([
          expect.not.objectContaining({ approvedRoleKeys: expect.anything() })
        ])
      })
    });
  });

  it("does not allow a payer change after any effective actual payment", async () => {
    const { service, tx } = createHarness();
    tx.$queryRaw.mockResolvedValueOnce([payment]);
    tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue({ id: "execution-1" });

    await expect(
      service.updatePayer("payment-1", "finance-1", {
        companyEntityId: "company-1",
        paymentMethods: ["bank_transfer"]
      })
    ).rejects.toThrow("已发生实际付款");
  });

  it("blocks comprehensive approval until the payer and a planned method are both set", async () => {
    const { service, tx } = createHarness();
    const pending = { ...payment, status: "approval_pending", paymentType: "company_direct" };
    const internal = service as unknown as {
      requireLockedVersionForPayment: jest.Mock;
      lockProcurementPayments: jest.Mock;
      requireLockedApproval: jest.Mock;
      requireActiveUser: jest.Mock;
      loadActorRoleKeys: jest.Mock;
    };
    internal.requireLockedVersionForPayment = jest.fn().mockResolvedValue({
      id: "version-1",
      projectId: "project-1",
      procurementId: "procurement-1"
    });
    internal.lockProcurementPayments = jest.fn().mockResolvedValue([pending]);
    internal.requireLockedApproval = jest.fn().mockResolvedValue({
      id: "approval-1",
      applicantUserId: "material-1",
      currentNodeIndex: 0,
      frozenNodes: [
        { name: "综合部主管审批", mode: "any", roleKeys: ["comprehensive_director"] }
      ]
    });
    internal.requireActiveUser = jest.fn().mockResolvedValue(undefined);
    internal.loadActorRoleKeys = jest.fn().mockResolvedValue(["comprehensive_director"]);
    tx.spotProcurementPayment.findUnique.mockResolvedValue({
      paymentType: "company_direct",
      payerCompanyEntityId: null,
      payerCompanyNameSnapshot: null
    });

    await expect(
      service.review("payment-1", "comprehensive-1", { decision: "approve" })
    ).rejects.toThrow("综合部主管审批通过前必须确定付款主体和至少一种拟付款方式");
  });

  it("blocks comprehensive approval when a legacy payer still has no planned method", async () => {
    const { service, tx } = createHarness();
    const pending = { ...payment, status: "approval_pending", paymentType: "company_direct" };
    const internal = service as unknown as {
      requireLockedVersionForPayment: jest.Mock;
      lockProcurementPayments: jest.Mock;
      requireLockedApproval: jest.Mock;
      requireActiveUser: jest.Mock;
      loadActorRoleKeys: jest.Mock;
    };
    internal.requireLockedVersionForPayment = jest.fn().mockResolvedValue({
      id: "version-1",
      projectId: "project-1",
      procurementId: "procurement-1"
    });
    internal.lockProcurementPayments = jest.fn().mockResolvedValue([pending]);
    internal.requireLockedApproval = jest.fn().mockResolvedValue({
      id: "approval-1",
      applicantUserId: "material-1",
      currentNodeIndex: 0,
      frozenNodes: [
        { name: "综合部主管审批", mode: "any", roleKeys: ["comprehensive_director"] }
      ]
    });
    internal.requireActiveUser = jest.fn().mockResolvedValue(undefined);
    internal.loadActorRoleKeys = jest.fn().mockResolvedValue(["comprehensive_director"]);
    tx.spotProcurementPayment.findUnique.mockResolvedValue({
      paymentType: "company_direct",
      payerCompanyEntityId: "company-legacy",
      payerCompanyNameSnapshot: "历史付款主体"
    });

    await expect(
      service.review("payment-1", "comprehensive-1", { decision: "approve" })
    ).rejects.toThrow("综合部主管审批通过前必须确定付款主体和至少一种拟付款方式");
  });
});
