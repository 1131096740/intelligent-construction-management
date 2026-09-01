import {
  BadRequestException,
  ConflictException,
  ForbiddenException
} from "@nestjs/common";
import { validate } from "class-validator";
import { PaymentAmountService } from "./payment-amount.service";
import { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import { PaymentRequestService } from "./payment-request.service";

describe("PaymentRequestService", () => {
  const service = new PaymentRequestService(new PaymentAmountService());
  const auth = {
    confirmPassword: jest.fn()
  };
  const audit = {
    record: jest.fn()
  };
  const fileAccess = {
    assertCanDownloadFile: jest.fn(),
    assertFileHasNoBusinessBinding: jest.fn()
  };
  const projectFunding = {
    lockFundingContext: jest.fn(),
    allocateExecution: jest.fn()
  };
  const paymentApprovalNodes = [
    { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"] },
    { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
    { name: "财务", mode: "any", roleKeys: ["finance_director"] },
    { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
  ];
  const paymentReviewCoordinates = {
    expectedPaymentUpdatedAt: "2026-07-31T01:00:00.000Z",
    expectedApprovalInstanceId: "approval-instance-1",
    expectedNodeIndex: 0,
    expectedApprovalUpdatedAt: "2026-07-31T01:01:00.000Z"
  };
  const paymentExecutionCoordinates = {
    expectedPaymentUpdatedAt: "2026-07-31T02:00:00.000Z",
    idempotencyKey: "a1111111-1111-4111-8111-111111111111"
  };
  const paymentReviewPaymentVersion = {
    updatedAt: new Date(paymentReviewCoordinates.expectedPaymentUpdatedAt),
    paymentSubjectType: "our_company",
    signingSubjectType: "our_company",
    companyEntityIdSnapshot: "company-1",
    companyEntityNameSnapshot: "建工智管建设有限公司",
    companyEntityCreditCodeSnapshot: "91310000TEST000001"
  };
  const paymentReviewApprovalVersion = {
    updatedAt: new Date(paymentReviewCoordinates.expectedApprovalUpdatedAt)
  };

  beforeEach(() => {
    auth.confirmPassword.mockReset();
    auth.confirmPassword.mockResolvedValue({ ok: true });
    audit.record.mockReset();
    fileAccess.assertCanDownloadFile.mockReset();
    fileAccess.assertCanDownloadFile.mockResolvedValue({ id: "file-1" });
    fileAccess.assertFileHasNoBusinessBinding.mockReset();
    fileAccess.assertFileHasNoBusinessBinding.mockResolvedValue({
      id: "file-1",
      uploadedByUserId: "cashier-1",
      storageStatus: "active"
    });
    projectFunding.lockFundingContext.mockReset();
    projectFunding.lockFundingContext.mockResolvedValue(undefined);
    projectFunding.allocateExecution.mockReset();
    projectFunding.allocateExecution.mockResolvedValue({
      kind: "allocated",
      projectCashAmountCents: 30_000n,
      financingQuotaAmountCents: 0n,
      allocations: [
        {
          sourceType: "project_cash",
          sourceId: null,
          amountCents: 30_000n
        }
      ]
    });
  });

  it.each([
    ["number", 2_100_000_001],
    ["decimal", "1.5"],
    ["exponent", "1e3"],
    ["negative", "-1"],
    ["zero", "0"]
  ])(
    "rejects invalid %s payment amount as HTTP 400 before opening a transaction",
    async (_label, value) => {
      const prisma = { $transaction: jest.fn() };
      const paymentService = new PaymentRequestService(
        new PaymentAmountService(),
        prisma as never
      );

      const error = await paymentService
        .create({
          sourceType: "settlement",
          settlementId: "settlement-1",
          code: "FK-INVALID-AMOUNT",
          requestedAmountCents: value
        } as never)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect((error as Error).message).toBe("付款申请金额必须为大于 0 的整数分");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  function pdfHexText(value: string) {
    const buffer = Buffer.from(value, "utf16le");
    for (let index = 0; index < buffer.length; index += 2) {
      const low = buffer[index];
      buffer[index] = buffer[index + 1];
      buffer[index + 1] = low;
    }
    return buffer.toString("hex").toUpperCase();
  }

  function approvalRoleTables(roleKey: string) {
    return {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
  }

  function projectCashPoolTables({
    receiptAmountCents = 200_000n,
    projectPayments = [],
    projectExpenses = [],
    spotProcurementPayments = [],
    financingQuotas = [],
    financingUsages = []
  }: {
    receiptAmountCents?: bigint;
    projectPayments?: Array<{
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents?: bigint | null;
      paidAmountCents: bigint;
    }>;
    projectExpenses?: Array<{
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents?: bigint | null;
      paidAmountCents: bigint;
    }>;
    spotProcurementPayments?: Array<{
      status: string;
      companyPaymentAmountCents: bigint;
      canceledCompanyPaymentAmountCents: bigint;
      paidAmountCents: bigint;
    }>;
    financingQuotas?: Array<{ id: string; amountCents: bigint }>;
    financingUsages?: Array<{ quotaId: string; amountCents: bigint }>;
  } = {}) {
    return {
      tables: {
        contract: {
          findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "equipment_rental" })
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({ signingSubjectType: "our_company" })
        },
        $queryRaw: jest.fn().mockResolvedValue([{ id: "project-1", isActive: true }]),
        projectReceipt: {
          findMany: jest.fn().mockResolvedValue(
            receiptAmountCents > 0n ? [{ amountCents: receiptAmountCents }] : []
          )
        },
        projectFinancingQuota: {
          findMany: jest.fn().mockResolvedValue(financingQuotas)
        },
        projectFinancingQuotaUsage: {
          findMany: jest.fn().mockResolvedValue(financingUsages),
          createMany: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 0 })
        },
        projectExpenseRequest: {
          findMany: jest.fn().mockResolvedValue(projectExpenses)
        },
        spotProcurement: {
          findMany: jest.fn().mockResolvedValue([])
        },
        spotProcurementRefund: {
          findMany: jest.fn().mockResolvedValue([])
        },
        spotProcurementPayment: {
          findMany: jest.fn().mockResolvedValue(spotProcurementPayments)
        },
        projectExpenseFinancingQuotaUsage: {
          findMany: jest.fn().mockResolvedValue([])
        }
      },
      projectPayments
    };
  }

  function financingUsageUpdates(
    occupiedUsages: Array<{
      id: string;
      quotaId: string;
      projectId: string;
      amountCents: bigint;
      status?: string;
    }> = []
  ) {
    const rows = occupiedUsages.map((usage) => ({ status: "occupied", ...usage }));
    return {
      projectFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue(rows),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({})
      }
    };
  }

  function paymentExecutionRow(
    overrides: Partial<{
      id: string;
      code: string;
      projectId: string;
      contractId: string;
      contractTypeKey: string;
      contractVersionId: string;
      paymentTermsVersionId: string;
      paymentTermsStageId: string | null;
      settlementId: string | null;
      sourceType: string;
      updatedAt: Date;
      paymentSubjectType: string;
      signingSubjectType: string;
      companyEntityIdSnapshot: string | null;
      companyEntityNameSnapshot: string | null;
      companyEntityCreditCodeSnapshot: string | null;
      status: string;
      requestedAmountCents: bigint;
      approvedAmountCents: bigint | null;
      paidAmountCents: bigint;
    }> = {}
  ) {
    return {
      id: "payment-1",
      code: "FK-2026-012",
      projectId: "project-1",
      contractId: "contract-1",
      contractTypeKey: "labor_subcontract",
      contractVersionId: "contract-version-1",
      settlementId: "settlement-1",
      sourceType: "settlement",
      updatedAt: new Date(paymentExecutionCoordinates.expectedPaymentUpdatedAt),
      paymentSubjectType: "our_company",
      signingSubjectType: "our_company",
      companyEntityIdSnapshot: "company-1",
      companyEntityNameSnapshot: "建工智管建设有限公司",
      companyEntityCreditCodeSnapshot: "91310000TEST000001",
      status: "approved_pending_payment",
      requestedAmountCents: 50_000n,
      approvedAmountCents: 50_000n,
      paidAmountCents: 0n,
      ...overrides
    };
  }

  function paymentExecutionGuardTx<T extends object>(tx: T): T {
    const current = tx as T & {
      $executeRaw?: unknown;
      paymentRequest?: Record<string, unknown>;
      paymentExecution?: Record<string, unknown>;
      contractVersion?: Record<string, unknown>;
      user?: Record<string, unknown>;
      userPosition?: Record<string, unknown>;
      projectMember?: Record<string, unknown>;
      position?: Record<string, unknown>;
    };
    const existingPaymentFindFirst = current.paymentRequest?.findFirst as
      | ((args: unknown) => Promise<Record<string, unknown> | null | undefined>)
      | undefined;
    const stablePaymentIdentity = {
      id: "payment-1",
      projectId: "project-1",
      settlementId: "settlement-1",
      contractVersionId: "contract-version-1",
      paymentSubjectType: "our_company"
    };
    return Object.assign(tx, {
      $executeRaw:
        current.$executeRaw ?? jest.fn().mockResolvedValue(1),
      paymentRequest: {
        ...(current.paymentRequest ?? {}),
        findFirst: jest.fn(async (args: unknown) => {
          const existing = await existingPaymentFindFirst?.(args);
          if (existing === null) return null;
          if (existing === undefined) {
            return stablePaymentIdentity;
          }
          return {
            ...stablePaymentIdentity,
            ...existing,
            projectId: existing.projectId ?? "project-1"
          };
        })
      },
      paymentExecution: {
        ...(current.paymentExecution ?? {}),
        findUnique:
          current.paymentExecution?.findUnique ??
          current.paymentExecution?.findFirst ??
          jest.fn().mockResolvedValue(null)
      },
      contractVersion: {
        ...(current.contractVersion ?? {}),
        findUnique:
          current.contractVersion?.findUnique ??
          jest.fn().mockResolvedValue({
            signingSubjectType: "our_company",
            companyEntityIdSnapshot: "company-1",
            companyEntityNameSnapshot: "建工智管建设有限公司",
            companyEntityCreditCodeSnapshot: "91310000TEST000001"
          }),
        findMany:
          current.contractVersion?.findMany ?? jest.fn().mockResolvedValue([])
      },
      user: {
        ...(current.user ?? {}),
        findUnique:
          current.user?.findUnique ??
          jest.fn().mockResolvedValue({ id: "cashier-1", isActive: true })
      },
      userPosition: {
        ...(current.userPosition ?? {}),
        findMany: current.userPosition?.findMany ?? jest.fn().mockResolvedValue([])
      },
      projectMember: {
        ...(current.projectMember ?? {}),
        findMany:
          current.projectMember?.findMany ??
          jest.fn().mockResolvedValue([{ positionKey: "finance_staff" }])
      },
      position: {
        ...(current.position ?? {}),
        findMany: current.position?.findMany ?? jest.fn().mockResolvedValue([])
      }
    });
  }

  function concurrentPaymentExecutionPrisma<T extends object>(
    code: string,
    tx: T
  ) {
    const guardedTx = paymentExecutionGuardTx(tx);
    const transaction = jest
      .fn()
      .mockRejectedValueOnce({ code })
      .mockImplementationOnce(
        async (callback: (client: T) => Promise<unknown>) => callback(guardedTx)
      );
    return Object.assign(guardedTx, { $transaction: transaction });
  }

  function paymentExecutionService(
    ...args: ConstructorParameters<typeof PaymentRequestService>
  ): PaymentRequestService {
    const paymentService = new PaymentRequestService(...args);
    const dependencies = paymentService as unknown as {
      files?: typeof fileAccess;
      projectFunding?: typeof projectFunding;
    };
    dependencies.files ??= fileAccess;
    dependencies.projectFunding ??= projectFunding;
    return paymentService;
  }

  function hardenedPaymentExecutionFixture(
    paymentOverrides: Parameters<typeof paymentExecutionRow>[0] = {},
    existingExecution: Record<string, unknown> | null = null
  ) {
    const payment = paymentExecutionRow(paymentOverrides);
    const createdExecution = {
      id: "execution-hardened-1",
      idempotencyKey: paymentExecutionCoordinates.idempotencyKey,
      paymentRequestId: payment.id,
      settlementId: payment.settlementId,
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: payment.companyEntityIdSnapshot,
      companyEntityNameSnapshot: payment.companyEntityNameSnapshot,
      companyEntityCreditCodeSnapshot:
        payment.companyEntityCreditCodeSnapshot,
      amountCents: 30_000n,
      paidAt: new Date("2026-06-22T00:00:00.000Z"),
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
    };
    const tx = paymentExecutionGuardTx({
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([payment])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: payment.id,
          projectId: payment.projectId,
          settlementId: payment.settlementId,
          contractVersionId: payment.contractVersionId,
          paymentSubjectType: payment.paymentSubjectType
        }),
        update: jest.fn().mockResolvedValue({
          id: payment.id,
          status: "paid",
          paidAmountCents: 30_000n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: payment.contractId,
          contractVersionId: payment.contractVersionId,
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn()
      },
      paymentExecution: {
        findUnique: jest.fn().mockResolvedValue(existingExecution),
        create: jest.fn().mockResolvedValue(createdExecution)
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: "cashier-1",
          isActive: true
        })
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn().mockResolvedValue([
          { positionKey: "finance_staff" }
        ])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      }
    });
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    return { payment, createdExecution, tx, prisma };
  }

  it("requires payment execution CAS and UUID v4 idempotency coordinates", async () => {
    const dto = Object.assign(new RecordPaymentExecutionDto(), {
      amountCents: "10000",
      paidAt: "2026-07-31T01:00:00.000Z",
      voucherFileId: "voucher-1",
      confirmationPassword: "current-password"
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(["expectedPaymentUpdatedAt", "idempotencyKey"])
    );
  });

  it("rejects an incomplete wage-creditor matrix before opening the payment transaction", async () => {
    const prisma = { $transaction: jest.fn() };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(paymentService.recordExecution("payment-1", "cashier-1", {
      ...paymentExecutionCoordinates,
      amountCents: "30000",
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password",
      wagePayableBindings: [{
        payableRef: "00000000-0000-4000-8000-000000000031",
        amountCents: "29999"
      }]
    })).rejects.toThrow("工资债权关联金额必须完整等于本次实付金额");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("fails closed before the transaction when a bank Claim lacks server-verifiable payer authority", async () => {
    const prisma = { $transaction: jest.fn() };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("payment-1", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password",
        observationSelectionRef: "server-signed-observation-selection",
        wagePayableBindings: [
          {
            payableRef: "00000000-0000-4000-8000-000000000031",
            amountCents: "30000"
          }
        ]
      })
    ).rejects.toThrow("认领银行流水的付款执行必须提交服务端付款账户核验引用");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("fails closed before the transaction when the shared Claim allocator is unavailable", async () => {
    const prisma = { $transaction: jest.fn() };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("payment-1", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password",
        observationSelectionRef: "server-signed-observation-selection",
        payerAttestation: {
          bankAccountReference: "server-payer-verification-reference"
        },
        wagePayableBindings: [
          {
            payableRef: "00000000-0000-4000-8000-000000000031",
            amountCents: "30000"
          }
        ]
      })
    ).rejects.toThrow("付款执行共享分配服务暂不可用，请稍后重试");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("freezes multiple employee and business-party wage creditors on one payment execution", async () => {
    const fixture = hardenedPaymentExecutionFixture();
    const employeeRef = "00000000-0000-4000-8000-000000000032";
    const institutionRef = "00000000-0000-4000-8000-000000000033";
    const wagePayableRow = (input: {
      id: string;
      subjectType: "employee_user" | "business_party";
      identityKey: string;
      name: string;
      amountCents: bigint;
    }) => ({
      id: input.id,
      confirmedVersionId: "version-1",
      projectAllocationId: "project-allocation-1",
      creditorBreakdownId: `creditor-${input.id}`,
      debtorCompanyId: "company-1",
      costBearingCompanyId: "company-1",
      projectId: "project-1",
      personLineId: "person-line-1",
      amountCents: input.amountCents,
      direction: "increase",
      adjustsPayableRefId: null,
      debtorCompanySnapshot: { companyId: "company-1" },
      projectSnapshot: { projectId: "project-1" },
      creditorSnapshot: {
        subjectType: input.subjectType,
        identityKey: input.identityKey,
        name: input.name
      },
      confirmedVersion: { status: "confirmed" },
      creditorBreakdown: {
        creditorSubjectType: input.subjectType,
        creditorUserId: input.subjectType === "employee_user" ? "user-1" : null,
        creditorBusinessPartyVersionId: input.subjectType === "business_party" ? "party-version-1" : null,
        creditorSubjectIdentityKey: input.identityKey,
        creditorNameSnapshot: input.name,
        creditorUnifiedIdentitySnapshot: input.subjectType === "business_party" ? "统一社会信用代码-1" : null,
        creditorVersionFingerprint: "version-fingerprint-1"
      },
      adjustments: []
    });
    const payableRows = [
      wagePayableRow({
        id: employeeRef,
        subjectType: "employee_user",
        identityKey: "employee_user:user-1",
        name: "员工冻结名",
        amountCents: 20_000n
      }),
      wagePayableRow({
        id: institutionRef,
        subjectType: "business_party",
        identityKey: "business_party:party-version-1",
        name: "代发机构冻结名",
        amountCents: 10_000n
      })
    ];
    const tx = fixture.tx as typeof fixture.tx & {
      wagePayableRef: { findMany: jest.Mock };
      paymentExecutionWagePayableBinding: { findMany: jest.Mock; create: jest.Mock };
    };
    tx.wagePayableRef = {
      findMany: jest.fn().mockResolvedValue(payableRows)
    };
    tx.paymentExecutionWagePayableBinding = {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({})
    };

    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      fixture.prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never
    );

    const result = await paymentService.recordExecution("FK-2026-012", "cashier-1", {
      ...paymentExecutionCoordinates,
      amountCents: "30000",
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password",
      wagePayableBindings: [
        { payableRef: employeeRef, amountCents: "20000" },
        { payableRef: institutionRef, amountCents: "10000" }
      ]
    });

    expect(result).toEqual({
      amountCents: "30000",
      paidAt: new Date("2026-06-22T00:00:00.000Z"),
      paymentSubjectType: "our_company"
    });
    for (const forbiddenField of [
      "id",
      "idempotencyKey",
      "paymentRequestId",
      "settlementId",
      "executedByUserId",
      "voucherFileId",
      "companyEntityIdSnapshot",
      "companyEntityNameSnapshot",
      "companyEntityCreditCodeSnapshot"
    ]) {
      expect(result).not.toHaveProperty(forbiddenField);
    }
    expect(JSON.stringify(result)).not.toContain("execution-hardened-1");
    const auditMetadata = audit.record.mock.calls.at(-1)?.[1]?.metadata;
    expect(auditMetadata).toEqual(expect.objectContaining({ executionFingerprint: expect.any(String) }));
    expect(auditMetadata).not.toHaveProperty("executionId");
    expect(auditMetadata).not.toHaveProperty("voucherFileId");
    expect(JSON.stringify(auditMetadata)).not.toContain("execution-hardened-1");

    expect(tx.paymentExecutionWagePayableBinding.create).toHaveBeenCalledTimes(2);
    expect(tx.paymentExecutionWagePayableBinding.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        paymentExecutionId: "execution-hardened-1",
        wagePayableRefId: employeeRef,
        creditorSubjectType: "employee_user",
        creditorUserId: "user-1",
        creditorBusinessPartyVersionId: null,
        creditorSubjectIdentityKey: "employee_user:user-1",
        amountCents: 20_000n
      })
    });
    expect(tx.paymentExecutionWagePayableBinding.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        paymentExecutionId: "execution-hardened-1",
        wagePayableRefId: institutionRef,
        creditorSubjectType: "business_party",
        creditorUserId: null,
        creditorBusinessPartyVersionId: "party-version-1",
        creditorSubjectIdentityKey: "business_party:party-version-1",
        amountCents: 10_000n
      })
    });
  });

  it("routes a claimed PaymentExecution through the shared allocator in the same transaction and forces deferred contracts", async () => {
    const fixture = hardenedPaymentExecutionFixture();
    const tx = fixture.tx as typeof fixture.tx & {
      $executeRawUnsafe: jest.Mock;
      wagePayableRef: { findMany: jest.Mock };
      paymentExecutionWagePayableBinding: {
        findMany: jest.Mock;
        create: jest.Mock;
      };
      paymentExecutionPayerVerification: { findUnique: jest.Mock };
      companyEntity: { findUnique: jest.Mock };
      fileObject: { findUnique: jest.Mock };
      paymentExecutionPayerAttestation: { create: jest.Mock };
    };
    const verifiedAt = new Date("2026-06-20T00:00:00.000Z");
    tx.$executeRawUnsafe = jest.fn().mockResolvedValue(0);
    tx.wagePayableRef = {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "00000000-0000-4000-8000-000000000034",
          confirmedVersionId: "version-1",
          projectAllocationId: "project-allocation-1",
          creditorBreakdownId: "creditor-1",
          debtorCompanyId: "company-1",
          costBearingCompanyId: "company-1",
          projectId: "project-1",
          personLineId: "person-line-1",
          amountCents: 30_000n,
          direction: "increase",
          adjustsPayableRefId: null,
          debtorCompanySnapshot: { companyId: "company-1" },
          projectSnapshot: { projectId: "project-1" },
          creditorSnapshot: {
            subjectType: "employee_user",
            identityKey: "employee_user:user-1",
            name: "测试员工"
          },
          confirmedVersion: { status: "confirmed" },
          creditorBreakdown: {
            creditorSubjectType: "employee_user",
            creditorUserId: "user-1",
            creditorBusinessPartyVersionId: null,
            creditorSubjectIdentityKey: "employee_user:user-1",
            creditorNameSnapshot: "测试员工",
            creditorUnifiedIdentitySnapshot: null,
            creditorVersionFingerprint: "version-fingerprint-1"
          },
          adjustments: []
        }
      ])
    };
    tx.paymentExecutionWagePayableBinding = {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({})
    };
    tx.paymentExecutionPayerVerification = {
      findUnique: jest.fn().mockResolvedValue({
        id: "payer-verification-1",
        reference: "server-payer-verification-reference",
        holderCompanyEntityId: "company-1",
        holderNameSnapshot: "建工智管建设有限公司",
        holderCreditCodeSnapshot: "91310000TEST000001",
        verificationReference: "verification-record-1",
        verifiedByUserId: "finance-director-1",
        verifiedAt,
        verificationEvidenceFileId: "verification-evidence-1",
        verificationEvidenceContentSha256: "a".repeat(64),
        status: "verified",
        sourceType: "bank_account_legal_holder",
        sourceRecordId: "bank-source-record-1"
      })
    };
    tx.user.findUnique = jest.fn().mockResolvedValue({ id: "user", isActive: true });
    tx.userPosition.findMany = jest.fn(
      ({ where }: { where: { userId: string; projectId?: string | null } }) =>
        Promise.resolve(
          where.userId === "finance-director-1" && where.projectId === null
            ? [{ positionId: "finance-director-position" }]
            : []
        )
    );
    tx.position.findMany = jest.fn().mockResolvedValue([
      { id: "finance-director-position", key: "finance_director" }
    ]);
    tx.companyEntity = {
      findUnique: jest.fn().mockResolvedValue({ id: "company-1", isActive: true })
    };
    tx.fileObject = {
      findUnique: jest.fn().mockResolvedValue({
        id: "verification-evidence-1",
        uploadedByUserId: "finance-director-1",
        storageStatus: "active",
        contentSha256: "a".repeat(64)
      })
    };
    tx.paymentExecutionPayerAttestation = {
      create: jest.fn().mockResolvedValue({})
    };
    const sharedAllocations = {
      materializeInTransaction: jest.fn().mockResolvedValue({
        allocationLineCount: 1
      }),
      assertReplayInTransaction: jest.fn()
    };
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest.fn()
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      fixture.prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never,
      undefined,
      operatingSources as never,
      sharedAllocations as never
    );

    await paymentService.recordExecution("FK-2026-012", "cashier-1", {
      ...paymentExecutionCoordinates,
      amountCents: "30000",
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password",
      observationSelectionRef: "server-signed-observation-selection",
      payerAttestation: {
        bankAccountReference: "server-payer-verification-reference"
      },
      wagePayableBindings: [
        {
          payableRef: "00000000-0000-4000-8000-000000000034",
          amountCents: "30000"
        }
      ]
    });

    expect(tx.paymentExecutionPayerAttestation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentExecutionId: "execution-hardened-1",
        payerVerificationId: "payer-verification-1",
        holderCompanyEntityId: "company-1",
        verifiedByUserId: "finance-director-1",
        verificationEvidenceContentSha256: "a".repeat(64)
      })
    });
    expect(sharedAllocations.materializeInTransaction).toHaveBeenCalledWith(tx, {
      actorUserId: "cashier-1",
      auditRequestId: paymentExecutionCoordinates.idempotencyKey,
      observationSelectionRef: "server-signed-observation-selection",
      paymentExecutionId: "execution-hardened-1",
      paymentRequestId: "payment-1",
      projectId: "project-1",
      amountCents: 30_000n,
      occurredAt: new Date("2026-06-22T00:00:00.000Z"),
      wagePayableBindings: [
        {
          payableRef: "00000000-0000-4000-8000-000000000034",
          amountCents: 30_000n
        }
      ]
    });
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).not.toHaveBeenCalled();
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      "SET CONSTRAINTS ALL IMMEDIATE"
    );
    expect(
      sharedAllocations.materializeInTransaction.mock.invocationCallOrder[0]
    ).toBeLessThan(tx.paymentRequest.update.mock.invocationCallOrder[0]);
    expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$executeRawUnsafe.mock.invocationCallOrder[0]
    );
  });

  it("rejects payment request creation when the service is unavailable", async () => {
    await expect(
      service.create({
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: "10000"
      })
    ).rejects.toThrow("付款申请创建服务暂不可用，请稍后重试或联系管理员");
  });

  it.each(["P2002", "P2034"])(
    "redacts a wage-bound idempotent replay after %s",
    async (code) => {
      const existingExecution = {
        id: "execution-wage-replay",
        idempotencyKey: paymentExecutionCoordinates.idempotencyKey,
        paymentRequestId: "payment-1",
        settlementId: "settlement-1",
        paymentSubjectType: "our_company",
        companyEntityIdSnapshot: "company-1",
        companyEntityNameSnapshot: "建工智管建设有限公司",
        companyEntityCreditCodeSnapshot: "91310000TEST000001",
        amountCents: 30_000n,
        paidAt: new Date("2026-06-22T00:00:00.000Z"),
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      };
      const prisma = concurrentPaymentExecutionPrisma(code, {
        paymentExecution: {
          findUnique: jest.fn().mockResolvedValue(existingExecution)
        },
        paymentRequest: {
          findFirst: jest.fn().mockResolvedValue({
            id: "payment-1",
            settlementId: "settlement-1",
            contractVersionId: "contract-version-1",
            paymentSubjectType: "our_company"
          })
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            signingSubjectType: "our_company",
            companyEntityIdSnapshot: "company-1",
            companyEntityNameSnapshot: "建工智管建设有限公司",
            companyEntityCreditCodeSnapshot: "91310000TEST000001"
          })
        },
        paymentExecutionWagePayableBinding: {
          findMany: jest.fn().mockResolvedValue([{
            wagePayableRefId: "00000000-0000-4000-8000-000000000031",
            amountCents: 30_000n
          }])
        }
      });
      const paymentService = paymentExecutionService(
        new PaymentAmountService(),
        prisma as never,
        audit as never,
        fileAccess as never,
        auth as never,
        undefined,
        undefined,
        projectFunding as never
      );

      await expect(
        paymentService.recordExecution("FK-2026-012", "cashier-1", {
          ...paymentExecutionCoordinates,
          amountCents: "30000",
          paidAt: "2026-06-22T00:00:00.000Z",
          voucherFileId: "file-1",
          confirmationPassword: "current-password",
          wagePayableBindings: [{
            payableRef: "00000000-0000-4000-8000-000000000031",
            amountCents: "30000"
          }]
        })
      ).resolves.toEqual({
        amountCents: "30000",
        paidAt: new Date("2026-06-22T00:00:00.000Z"),
        paymentSubjectType: "our_company"
      });
    }
  );

  it("rejects payment request before settlement is effective", () => {
    expect(() =>
      service.assertRequestAllowed(
        "approved_pending_archive",
        {
          payableAmountCents: 100_000n,
          approvedPendingPaymentCents: 0n,
          paidAmountCents: 0n
        },
        10_000n
      )
    ).toThrow("当前结算尚未归档生效，不能发起付款申请");
  });

  it("allows partial payment request within settlement capacity", () => {
    expect(() =>
      service.assertRequestAllowed(
        "effective",
        {
          payableAmountCents: 100_000n,
          approvedPendingPaymentCents: 20_000n,
          paidAmountCents: 20_000n
        },
        60_000n
      )
    ).not.toThrow();
  });

  it("allows later payment requests after a settlement is partially paid", () => {
    expect(() =>
      service.assertRequestAllowed(
        "partially_paid",
        {
          payableAmountCents: 100_000n,
          approvedPendingPaymentCents: 0n,
          paidAmountCents: 50_000n
        },
        50_000n
      )
    ).not.toThrow();
  });

  it("creates payment request from an effective settlement within remaining capacity", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 20_000n
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              status: "approved_pending_payment",
              requestedAmountCents: 30_000n,
              approvedAmountCents: 30_000n,
              paidAmountCents: 10_000n
            }
          ])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          requestedAmountCents: 50_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        })
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const created = await paymentService.create({
      settlementId: "settlement-1",
      code: "FK-2026-012",
      requestedAmountCents: "50000"
    });

    expect(created.code).toBe("FK-2026-012");
    expect(created).toMatchObject({
      requestedAmountCents: "50000",
      approvedAmountCents: null,
      paidAmountCents: "0"
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.paymentRequest.findMany.mock.invocationCallOrder[0]
    );
    expect(tx.paymentRequest.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        settlementId: "settlement-1",
        sourceType: "settlement",
        paymentSubjectType: "our_company",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-version-1",
        code: "FK-2026-012",
        status: "approval_pending",
        requestedAmountCents: 50_000n,
        approvedAmountCents: null,
        paidAmountCents: 0n
      }
    });
  });

  it("rejects a payment subject that differs from the contract signing subject at creation", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      ...cashPool.tables,
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "material_purchase" })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ signingSubjectType: "affiliate" })
      },
      paymentRequest: {
        findMany: jest.fn(),
        create: jest.fn()
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        paymentSubjectType: "our_company",
        code: "FK-SUBJECT-MISMATCH-001",
        requestedAmountCents: "50000"
      })
    ).rejects.toThrow("付款主体必须与合同签约主体一致");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it.each(["generic_contract", "machinery_rental", null, "unknown_contract_type"])(
    "rejects settlement payment for contract type %s after locking the settlement contract",
    async (contractTypeKey) => {
      const cashPool = projectCashPoolTables();
      const tx = {
        ...cashPool.tables,
        settlement: {
          findUnique: jest.fn().mockResolvedValue({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            status: "effective",
            payableAmountCents: 100_000n,
            paidAmountCents: 0n
          })
        },
        paymentRequest: { findMany: jest.fn(), create: jest.fn() },
        ...cashPool.tables,
        contract: { findUnique: jest.fn().mockResolvedValue({ contractTypeKey }) },
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ id: "contract-1" }])
          .mockResolvedValueOnce([{ id: "settlement-1" }])
      };
      const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      await expect(paymentService.create({
        settlementId: "settlement-1",
        code: "FK-JS-TYPE-001",
        requestedAmountCents: "10000"
      })).rejects.toThrow("该合同类型应从合同已冻结的付款阶段发起付款");

      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(tx.contract.findUnique).toHaveBeenCalledWith({
        where: { id: "contract-1" },
        select: { contractTypeKey: true }
      });
      expect(tx.paymentRequest.findMany).not.toHaveBeenCalled();
      expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    }
  );

  it("rejects settlement payment when historical takeover is not confirmed", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "pending_review",
          historicalBalanceConfirmedAt: null
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await expect(
      paymentService.create(
        {
          settlementId: "settlement-1",
          code: "FK-2026-HIS-001",
          requestedAmountCents: "10000"
        },
        "applicant-1"
      )
    ).rejects.toThrow("历史合同接管尚未主管确认，不能发起付款申请");

    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "payment.contract_takeover.blocked",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: {
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceType: "settlement",
        reason: "takeover_not_confirmed",
        takeoverStatus: "pending_review"
      }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects settlement payment when historical takeover is C level", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "confirmed",
          takeoverLevel: "C",
          historicalBalanceConfirmedAt: new Date("2026-07-01T00:00:00.000Z")
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await expect(
      paymentService.create(
        {
          settlementId: "settlement-1",
          code: "FK-2026-HIS-C-001",
          requestedAmountCents: "10000"
        },
        "applicant-1"
      )
    ).rejects.toThrow("C级历史接管仍有资料缺口或争议，不能发起付款申请");

    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "payment.contract_takeover.blocked",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: {
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceType: "settlement",
        reason: "takeover_level_c",
        takeoverStatus: "confirmed"
      }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("blocks a new payment request while historical abnormal overpayment remains unresolved", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          takeoverStatus: "confirmed",
          takeoverLevel: "A",
          historicalBalanceConfirmedAt: new Date(
            "2026-07-01T00:00:00.000Z"
          )
        })
      },
      paymentRequest: {
        findMany: jest.fn(),
        create: jest.fn()
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const balances = {
      assertNoAbnormalOverpayForContract: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException(
            "历史接管存在尚未解除的异常超付，不能发起付款申请"
          )
        )
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      balances as never
    );

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-ABNORMAL-BLOCK-1",
        requestedAmountCents: "10000"
      })
    ).rejects.toThrow(
      "历史接管存在尚未解除的异常超付，不能发起付款申请"
    );
    expect(
      balances.assertNoAbnormalOverpayForContract
    ).toHaveBeenCalledWith(
      tx,
      "contract-1",
      "发起付款申请"
    );
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("deducts contract-level allocations from settlement payment request capacity", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValueOnce([]),
        create: jest.fn()
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 80_000n }
        ])
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-099",
        requestedAmountCents: "30000"
      })
    ).rejects.toThrow("付款申请金额超过当前可申请余额，当前最多可申请 200.00 元");

    expect(tx.paymentExecutionAllocation.findMany).toHaveBeenCalledWith({
      where: {
        settlementId: "settlement-1",
        allocationType: { in: ["contract_due_payment", "advance_deduction"] }
      },
      select: { amountCents: true }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("creates a payment request when an effective historical contract change baseline is missing", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000n });
      const tx = {
        ...cashPool.tables,
        settlement: {
          findUnique: jest.fn()
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "effective",
            changeType: "historical_takeover",
            originalBaseAmountCents: null,
            amountCents: BigInt(1_000_000),
            effectiveAt: new Date("2026-06-01T00:00:00.000Z")
          })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            projectId: "project-1",
            contractTypeKey: "generic_contract"
          })
        },
        contractTakeover: {
          findUnique: jest.fn().mockResolvedValue({
            id: "takeover-1",
            contractVersionId: "contract-version-1",
            takeoverStatus: "confirmed",
            historicalBalanceConfirmedAt: new Date("2026-07-01T00:00:00.000Z")
          })
        },
        paymentTermsVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: "terms-version-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            status: "effective"
          })
        },
        paymentTermsStage: {
          findUnique: jest.fn().mockResolvedValue({
            id: "stage-contract-due",
            paymentTermsVersionId: "terms-version-1",
            stageType: "progress",
            basis: "contract_amount",
            ratioBps: null,
            fixedAmountCents: 100_000n,
            triggerAnchor: "contract_effective",
            dueDays: 0,
            allowsEarlyPayment: false,
            allowsInstallments: true
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "advance",
              basis: "contract_amount",
              ratioBps: 1000,
              fixedAmountCents: null,
              triggerAnchor: "contract_effective",
              dueDays: 30
            }
          ])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string } }) => {
            if (args.where?.contractId === "contract-1") {
              return Promise.resolve([]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn().mockResolvedValue({
            id: "payment-advance-1",
            code: "FK-YF-2026-001"
          })
        }
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      const created = await paymentService.create({
        sourceType: "contract_advance",
        contractVersionId: "contract-version-1",
        code: "FK-YF-2026-001",
        requestedAmountCents: "100000"
      } as never);

      expect(created.code).toBe("FK-YF-2026-001");
      expect(tx.settlement.findUnique).not.toHaveBeenCalled();
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.paymentRequest.findMany.mock.invocationCallOrder[0]
      );
      expect(tx.paymentRequest.create).toHaveBeenCalledWith({
        data: {
          projectId: "project-1",
          settlementId: null,
          sourceType: "contract_advance",
          paymentSubjectType: "our_company",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-YF-2026-001",
          status: "approval_pending",
          requestedAmountCents: 100_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        }
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects non-positive contract advance payment amount with a Chinese business reason", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        })
      },
      contractTakeover: { findUnique: jest.fn().mockResolvedValue(null) },
      contract: { findUnique: jest.fn().mockResolvedValue({ source: "system", projectId: "project-1" }) },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1", status: "effective" })
      },
      paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-1" }])
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_advance",
        contractVersionId: "contract-version-1",
        code: "FK-YF-2026-000",
        requestedAmountCents: 0n
      } as never)
    ).rejects.toThrow("付款申请金额必须为大于 0 的整数分");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects contract advance payment for historical contracts without takeover row", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          source: "historical_takeover"
        })
      },
      paymentRequest: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await expect(
      paymentService.create(
        {
          sourceType: "contract_advance",
          contractVersionId: "contract-version-1",
          code: "FK-YF-HIS-001",
          requestedAmountCents: "10000"
        } as never,
        "applicant-1"
      )
    ).rejects.toThrow("历史合同接管尚未主管确认，不能发起付款申请");

    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "payment.contract_takeover.blocked",
      businessType: "contract",
      businessId: "contract-1",
      metadata: {
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceType: "contract_advance",
        reason: "takeover_missing",
        takeoverStatus: null
      }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("creates a contract due payment request for a confirmed direct-payment contract without selecting a settlement", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000n });
      const tx = {
        ...cashPool.tables,
        settlement: {
          findUnique: jest.fn(),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "settlement-1",
              status: "effective",
              amountCents: 100_000n,
              paidAmountCents: 0n,
              contractVersionId: "contract-version-1",
              isFinal: false,
              paymentTermsVersionId: "terms-version-1"
            }
          ])
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "effective",
            amountCents: BigInt(1_000_000),
            effectiveAt: new Date("2026-06-01T00:00:00.000Z"),
            settlementMode: "direct_payment",
            settlementModeConfirmedAt: new Date("2026-07-01T00:00:00.000Z")
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "contract-version-1",
              amountCents: BigInt(1_000_000)
            }
          ])
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            projectId: "project-1",
            contractTypeKey: "material_purchase"
          })
        },
        paymentTermsVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: "terms-version-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            status: "effective"
          })
        },
        paymentTermsStage: {
          findUnique: jest.fn().mockResolvedValue({
            id: "stage-contract-due",
            paymentTermsVersionId: "terms-version-1",
            stageType: "progress",
            basis: "contract_amount",
            ratioBps: null,
            fixedAmountCents: 100_000n,
            triggerAnchor: "contract_effective",
            dueDays: 0
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "progress",
              basis: "current_settlement",
              ratioBps: 8000,
              fixedAmountCents: null,
              triggerAnchor: "settlement_effective",
              dueDays: 0,
              advanceDeductionMode: "none",
              advanceDeductionRatioBps: null,
              advanceDeductionStartRatioBps: null
            }
          ])
        },
        settlementArchiveFile: {
          findMany: jest.fn().mockResolvedValue([
            {
              settlementId: "settlement-1",
              confirmedAt: new Date("2026-06-01T00:00:00.000Z")
            }
          ])
        },
        projectProxyPayment: {
          findMany: jest.fn().mockResolvedValue([])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string; sourceType?: unknown } }) => {
            if (args.where?.contractId === "contract-1") {
              return Promise.resolve([]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn().mockResolvedValue({
            id: "payment-contract-due-1",
            code: "FK-HT-2026-001"
          })
        }
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      const created = await paymentService.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-1",
        paymentTermsStageId: "stage-contract-due",
        code: "FK-HT-2026-001",
        requestedAmountCents: "80000"
      } as never);

      expect(created.code).toBe("FK-HT-2026-001");
      expect(tx.settlement.findUnique).not.toHaveBeenCalled();
      expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contractId: "contract-1"
          })
        })
      );
      expect(tx.paymentRequest.create).toHaveBeenCalledWith({
        data: {
          projectId: "project-1",
          settlementId: null,
          sourceType: "contract_due",
          paymentSubjectType: "our_company",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          paymentTermsStageId: "stage-contract-due",
          code: "FK-HT-2026-001",
          status: "approval_pending",
          requestedAmountCents: 80_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        }
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects non-positive contract due payment amount with a Chinese business reason", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contractTakeover: { findUnique: jest.fn().mockResolvedValue(null) },
      contract: { findUnique: jest.fn().mockResolvedValue({ source: "system", projectId: "project-1" }) },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: "terms-version-1", status: "effective" })
      },
      paymentRequest: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-1",
        code: "FK-HT-2026-000",
        requestedAmountCents: 0n
      } as never)
    ).rejects.toThrow("付款申请金额必须为大于 0 的整数分");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    "material_purchase",
    "equipment_rental",
    "labor_subcontract",
    "professional_subcontract",
    null,
    "unknown_contract_type"
  ])("rejects contract due payment without settlement for %s", async (contractTypeKey) => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: 100_000n,
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey
        })
      },
      paymentTermsVersion: { findFirst: jest.fn() },
      paymentTermsStage: { findUnique: jest.fn() },
      paymentRequest: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-1",
        paymentTermsStageId: "stage-1",
        code: "FK-HT-2026-NON-GENERIC",
        requestedAmountCents: "10000"
      } as never)
    ).rejects.toThrow("该合同类型应从生效结算发起付款");

    expect(tx.paymentTermsVersion.findFirst).not.toHaveBeenCalled();
    expect(tx.paymentTermsStage.findUnique).not.toHaveBeenCalled();
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a generic contract payment without a frozen stage", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: 100_000n,
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "generic_contract"
        })
      },
      paymentRequest: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-1",
        code: "FK-HT-2026-NO-STAGE",
        requestedAmountCents: "10000"
      } as never)
    ).rejects.toThrow("请选择合同已冻结的付款阶段");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("requires payment matter and calculation explanation for an unlimited direct-payment contract", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-unlimited",
          contractId: "contract-unlimited",
          status: "effective",
          amountCents: 0n,
          pricingNature: "framework",
          amountLimitType: "unlimited",
          effectiveAt: new Date("2026-06-01T00:00:00.000Z"),
          settlementMode: "direct_payment",
          settlementModeConfirmedAt: new Date("2026-06-02T00:00:00.000Z")
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-unlimited",
          projectId: "project-1",
          contractTypeKey: "generic_contract",
          source: "system"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-unlimited",
          contractVersionId: "contract-version-unlimited",
          status: "effective"
        })
      },
      paymentTermsStage: {
        findUnique: jest.fn().mockResolvedValue({
          id: "stage-unlimited",
          paymentTermsVersionId: "terms-unlimited",
          stageType: "progress",
          basis: "contract_amount",
          ratioBps: null,
          fixedAmountCents: 10_000n,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          allowsEarlyPayment: true,
          allowsInstallments: true
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      },
      projectProxyPayment: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-unlimited" }])
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never
    );

    await expect(
      service.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-unlimited",
        paymentTermsStageId: "stage-unlimited",
        code: "FK-WGDZJ-RED-1",
        requestedAmountCents: "50000"
      } as never)
    ).rejects.toThrow("无固定总价合同必须填写本次付款事项和金额计算说明");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("allows repeated unlimited direct payments without treating estimates or prior occupancy as a legal cap", async () => {
    const create = jest.fn().mockResolvedValue({
      id: "payment-unlimited-2",
      code: "FK-WGDZJ-2"
    });
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-unlimited",
          contractId: "contract-unlimited",
          status: "effective",
          amountCents: 0n,
          estimatedAmountCents: 30_000n,
          pricingNature: "framework",
          amountLimitType: "unlimited",
          effectiveAt: new Date("2026-06-01T00:00:00.000Z"),
          settlementMode: "direct_payment",
          settlementModeConfirmedAt: new Date("2026-06-02T00:00:00.000Z")
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-unlimited",
          projectId: "project-1",
          contractTypeKey: "generic_contract",
          source: "system"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-unlimited",
          contractVersionId: "contract-version-unlimited",
          status: "effective"
        })
      },
      paymentTermsStage: {
        findUnique: jest.fn().mockResolvedValue({
          id: "stage-unlimited",
          paymentTermsVersionId: "terms-unlimited",
          stageType: "progress",
          basis: "contract_amount",
          ratioBps: null,
          fixedAmountCents: 10_000n,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          allowsEarlyPayment: true,
          allowsInstallments: false
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsStageId: "stage-unlimited",
            status: "paid",
            requestedAmountCents: 900_000n,
            approvedAmountCents: 900_000n,
            paidAmountCents: 900_000n
          }
        ]),
        create
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 500_000n }])
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-unlimited" }])
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never
    );

    await expect(
      service.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-unlimited",
        paymentTermsStageId: "stage-unlimited",
        code: "FK-WGDZJ-2",
        requestedAmountCents: "50000",
        paymentMatter: "六月驻场服务费",
        amountCalculationExplanation: "5 人 × 10 天 × 100 元/人天"
      } as never)
    ).resolves.toMatchObject({ code: "FK-WGDZJ-2" });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedAmountCents: 50_000n,
        paymentMatter: "六月驻场服务费",
        amountCalculationExplanation: "5 人 × 10 天 × 100 元/人天"
      })
    });
  });

  it("caps a generic stage by every existing contract payment across contract versions", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-1" }]),
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsStageId: null,
            status: "paid",
            requestedAmountCents: 20_000n,
            approvedAmountCents: 20_000n,
            paidAmountCents: 20_000n
          },
          {
            paymentTermsStageId: null,
            status: "approval_pending",
            requestedAmountCents: 30_000n,
            approvedAmountCents: null,
            paidAmountCents: 0n
          }
        ])
      }
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), {} as never);
    const assertCapacity = (
      paymentService as unknown as {
        assertGenericContractPaymentStageCapacity(
          tx: unknown,
          contractVersion: unknown,
          stage: unknown,
          requestedAmountCents: bigint
        ): Promise<void>;
      }
    ).assertGenericContractPaymentStageCapacity.bind(paymentService);

    await expect(assertCapacity(
      tx,
      {
        id: "contract-version-1",
        contractId: "contract-1",
        amountCents: 100_000n,
        effectiveAt: new Date("2026-06-01T00:00:00.000Z")
      },
      {
        id: "stage-1",
        paymentTermsVersionId: "terms-1",
        stageType: "progress",
        basis: "contract_amount",
        ratioBps: null,
        fixedAmountCents: 100_000n,
        triggerAnchor: "contract_effective",
        dueDays: 0,
        allowsEarlyPayment: false,
        allowsInstallments: true
      },
      90_000n
    )).rejects.toThrow("合同付款阶段当前可申请金额不足，当前最多可申请 500.00 元");
    expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: "contract-1"
        })
      })
    );
    expect(tx.paymentRequest.findMany.mock.calls[0]?.[0]?.where).not.toHaveProperty(
      "contractVersionId"
    );
    expect(tx.paymentRequest.findMany.mock.calls[0]?.[0]?.where).not.toHaveProperty(
      "sourceType"
    );
    expect(tx.paymentRequest.findMany.mock.calls[0]?.[0]?.where).not.toHaveProperty(
      "settlementId"
    );
  });

  it.each([null, "unknown_contract_type"])(
    "rejects contract advance payment when contract type is %s",
    async (contractTypeKey) => {
      const tx = {
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "effective",
            amountCents: 100_000n,
            effectiveAt: new Date("2026-06-01T00:00:00.000Z")
          })
        },
        contractTakeover: { findUnique: jest.fn().mockResolvedValue(null) },
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            projectId: "project-1",
            contractTypeKey
          })
        },
        paymentTermsVersion: { findFirst: jest.fn() },
        paymentRequest: { create: jest.fn() }
      };
      const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      await expect(paymentService.create({
        sourceType: "contract_advance",
        contractVersionId: "contract-version-1",
        code: "FK-YF-2026-UNKNOWN-TYPE",
        requestedAmountCents: "10000"
      } as never)).rejects.toThrow("请先明确合同类型，再发起预付款申请");
      expect(tx.paymentTermsVersion.findFirst).not.toHaveBeenCalled();
      expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    }
  );

  it.each([
    { ratioBps: 0, fixedAmountCents: null },
    { ratioBps: null, fixedAmountCents: 0n },
    { ratioBps: 5000, fixedAmountCents: 50_000n }
  ])("rejects an ambiguous or non-positive frozen generic stage %#", (stageAmount) => {
    const paymentService = new PaymentRequestService(new PaymentAmountService(), {} as never);
    const assertStage = (
      paymentService as unknown as {
        assertGenericContractPaymentStage(stage: unknown, termsId: string): void;
      }
    ).assertGenericContractPaymentStage.bind(paymentService);

    expect(() => assertStage({
      paymentTermsVersionId: "terms-1",
      stageType: "progress",
      basis: "contract_amount",
      triggerAnchor: "contract_effective",
      dueDays: 0,
      ...stageAmount
    }, "terms-1")).toThrow("请选择合同已冻结的付款阶段");
  });

  it("returns a stable business error when the selected frozen stage no longer exists", () => {
    const paymentService = new PaymentRequestService(new PaymentAmountService(), {} as never);
    const assertStage = (
      paymentService as unknown as {
        assertGenericContractPaymentStage(stage: unknown, termsId: string): void;
      }
    ).assertGenericContractPaymentStage.bind(paymentService);

    expect(() => assertStage(null, "terms-1"))
      .toThrow("请选择合同已冻结的付款阶段");
  });

  it("caps a changed contract by contract due payments from the previous version", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-1" }]),
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsStageId: "stage-v1",
            status: "paid",
            requestedAmountCents: 80_000n,
            approvedAmountCents: 80_000n,
            paidAmountCents: 80_000n
          }
        ])
      }
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), {} as never);
    const assertCapacity = (
      paymentService as unknown as {
        assertGenericContractPaymentStageCapacity(
          tx: unknown,
          contractVersion: unknown,
          stage: unknown,
          requestedAmountCents: bigint
        ): Promise<void>;
      }
    ).assertGenericContractPaymentStageCapacity.bind(paymentService);

    await expect(assertCapacity(
      tx,
      {
        id: "contract-version-v2",
        contractId: "contract-1",
        amountCents: 120_000n,
        effectiveAt: new Date("2026-07-01T00:00:00.000Z")
      },
      {
        id: "stage-v2",
        paymentTermsVersionId: "terms-v2",
        stageType: "progress",
        basis: "contract_amount",
        ratioBps: null,
        fixedAmountCents: 120_000n,
        triggerAnchor: "contract_effective",
        dueDays: 0,
        allowsEarlyPayment: false,
        allowsInstallments: true
      },
      50_000n
    )).rejects.toThrow("合同付款阶段当前可申请金额不足，当前最多可申请 400.00 元");
  });

  it("allows an early generic stage only when the frozen stage permits early payment", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-1" }]),
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), {} as never);
    const assertCapacity = (
      paymentService as unknown as {
        assertGenericContractPaymentStageCapacity(
          tx: unknown,
          contractVersion: unknown,
          stage: unknown,
          requestedAmountCents: bigint
        ): Promise<void>;
      }
    ).assertGenericContractPaymentStageCapacity.bind(paymentService);

    await expect(assertCapacity(
      tx,
      {
        id: "contract-version-1",
        contractId: "contract-1",
        amountCents: 100_000n,
        effectiveAt: new Date("2099-01-01T00:00:00.000Z")
      },
      {
        id: "stage-1",
        paymentTermsVersionId: "terms-1",
        stageType: "progress",
        basis: "contract_amount",
        ratioBps: null,
        fixedAmountCents: 100_000n,
        triggerAnchor: "contract_effective",
        dueDays: 30,
        allowsEarlyPayment: true,
        allowsInstallments: true
      },
      100_000n
    )).resolves.toBeUndefined();
  });

  it("requires the full remaining amount when a frozen stage disallows installments", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-1" }]),
      paymentRequest: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), {} as never);
    const assertCapacity = (
      paymentService as unknown as {
        assertGenericContractPaymentStageCapacity(
          tx: unknown,
          contractVersion: unknown,
          stage: unknown,
          requestedAmountCents: bigint
        ): Promise<void>;
      }
    ).assertGenericContractPaymentStageCapacity.bind(paymentService);

    await expect(assertCapacity(
      tx,
      {
        id: "contract-version-1",
        contractId: "contract-1",
        amountCents: 100_000n,
        effectiveAt: new Date("2026-06-01T00:00:00.000Z")
      },
      {
        id: "stage-1",
        paymentTermsVersionId: "terms-1",
        stageType: "progress",
        basis: "contract_amount",
        ratioBps: null,
        fixedAmountCents: 100_000n,
        triggerAnchor: "contract_effective",
        dueDays: 0,
        allowsEarlyPayment: false,
        allowsInstallments: false
      },
      50_000n
    )).rejects.toThrow(
      "该付款阶段不允许分次申请，本次申请金额必须等于当前可申请金额 1,000.00 元"
    );
  });

  it("rejects contract due payment when historical balance is not confirmed", async () => {
    const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000n });
    const tx = {
      ...cashPool.tables,
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000n,
            paidAmountCents: 0n,
            contractVersionId: "contract-version-1",
            isFinal: false,
            paymentTermsVersionId: "terms-version-1"
          }
        ])
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: BigInt(1_000_000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "generic_contract"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: null
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string } }) => {
          if (args.where?.contractId === "contract-1") {
            return Promise.resolve([]);
          }

          if (args.where?.projectId === "project-1") {
            return Promise.resolve(cashPool.projectPayments);
          }

          return Promise.resolve([]);
        }),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await expect(
      paymentService.create(
        {
          sourceType: "contract_due",
          contractVersionId: "contract-version-1",
          paymentTermsStageId: "stage-contract-due",
          code: "FK-HT-2026-HIS-002",
          requestedAmountCents: "80000"
        } as never,
        "applicant-1"
      )
    ).rejects.toThrow("历史余额尚未确认，不能发起付款申请");

    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "applicant-1",
      action: "payment.contract_takeover.blocked",
      businessType: "contract_takeover",
      businessId: "takeover-1",
      metadata: {
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        sourceType: "contract_due",
        reason: "historical_balance_not_confirmed",
        takeoverStatus: "confirmed"
      }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects contract due payment when confirmed historical balances consume capacity", async () => {
    const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000n });
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const tx = {
      ...cashPool.tables,
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000n,
            paidAmountCents: 0n,
            contractVersionId: "contract-version-1",
            isFinal: false,
            paymentTermsVersionId: "terms-version-1"
          }
        ])
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(100_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: BigInt(1_000_000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "generic_contract"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(0),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(30_000),
          historicalPaidCents: BigInt(40_000),
          historicalProxyPaidCents: BigInt(10_000),
          historicalAdvancePaidCents: BigInt(0),
          historicalAdvanceDeductedCents: BigInt(0),
          otherConfirmedOccupancyCents: BigInt(0)
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective"
        })
      },
      paymentTermsStage: {
        findUnique: jest.fn().mockResolvedValue({
          id: "stage-contract-due",
          paymentTermsVersionId: "terms-version-1",
          stageType: "progress",
          basis: "contract_amount",
          ratioBps: null,
          fixedAmountCents: 100_000n,
          triggerAnchor: "contract_effective",
          dueDays: 0
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string } }) => {
          if (args.where?.contractId === "contract-1") {
            return Promise.resolve([]);
          }

          if (args.where?.projectId === "project-1") {
            return Promise.resolve(cashPool.projectPayments);
          }

          return Promise.resolve([]);
        }),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-1",
        paymentTermsStageId: "stage-contract-due",
        code: "FK-HT-HIS-CAP-001",
        requestedAmountCents: "30000"
      } as never)
    ).rejects.toThrow("合同付款阶段当前可申请金额不足，当前最多可申请 200.00 元");

    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("allows contract due payment from a historical initial settlement without double counting historical paid", async () => {
    const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000n });
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const historicalSettlement = {
      id: "settlement-history",
      status: "effective",
      amountCents: 100_000n,
      paidAmountCents: 40_000n,
      contractVersionId: "contract-version-1",
      isFinal: false,
      paymentTermsVersionId: "terms-version-1",
      sourceType: "historical_takeover",
      sourceTakeoverId: "takeover-1"
    };
    const tx = {
      ...cashPool.tables,
      settlement: {
        findMany: jest.fn((args: { select?: Record<string, boolean> }) =>
          Promise.resolve([
            Object.fromEntries(
              Object.entries(historicalSettlement).filter(
                ([key]) => !args.select || args.select[key] === true
              )
            )
          ])
        )
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: BigInt(1_000_000)
          }
        ])
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "generic_contract"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(100_000),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(0),
          historicalPaidCents: BigInt(40_000),
          historicalProxyPaidCents: BigInt(0),
          historicalAdvancePaidCents: BigInt(0),
          historicalAdvanceDeductedCents: BigInt(0),
          otherConfirmedOccupancyCents: BigInt(0)
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective"
        })
      },
      paymentTermsStage: {
        findUnique: jest.fn().mockResolvedValue({
          id: "stage-contract-due",
          paymentTermsVersionId: "terms-version-1",
          stageType: "progress",
          basis: "contract_amount",
          ratioBps: null,
          fixedAmountCents: 100_000n,
          triggerAnchor: "contract_effective",
          dueDays: 0
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 10000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: "none",
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentRequest: {
        findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string } }) => {
          if (args.where?.contractId === "contract-1") {
            return Promise.resolve([]);
          }

          if (args.where?.projectId === "project-1") {
            return Promise.resolve(cashPool.projectPayments);
          }

          return Promise.resolve([]);
        }),
        create: jest.fn().mockResolvedValue({
          id: "payment-due-history",
          code: "FK-HT-HIS-CAP-002"
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.create({
      sourceType: "contract_due",
      contractVersionId: "contract-version-1",
      paymentTermsStageId: "stage-contract-due",
      code: "FK-HT-HIS-CAP-002",
      requestedAmountCents: "60000"
    } as never);

    expect(tx.paymentRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementId: null,
        sourceType: "contract_due",
        requestedAmountCents: 60_000n
      })
    });
  });

  it("rejects contract due payment requests that still carry a settlement id", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_due",
        settlementId: "settlement-in-other-project",
        contractVersionId: "contract-version-1",
        code: "FK-HT-2026-002",
        requestedAmountCents: "80000"
      } as never)
    ).rejects.toThrow("按合同应付款发起付款时不能选择结算，请从合同付款入口办理");
    expect(tx.contractVersion.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["contract_due", "FK-HT-2026-MISS"],
    ["contract_advance", "FK-YF-2026-MISS"]
  ])("rejects %s payment request without selecting contract", async (sourceType, code) => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType,
        code,
        requestedAmountCents: "80000"
      } as never)
    ).rejects.toThrow("请选择已归档生效的合同后再发起付款申请");
    expect(tx.contractVersion.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["contract_due", "FK-HT-2026-NOTFOUND"],
    ["contract_advance", "FK-YF-2026-NOTFOUND"]
  ])("rejects %s payment request when contract version cannot be found", async (sourceType, code) => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      paymentRequest: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType,
        contractVersionId: "contract-version-missing",
        code,
        requestedAmountCents: "80000"
      } as never)
    ).rejects.toThrow("未找到合同版本，请刷新合同台账后重试");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it.each([
    ["contract_due", "FK-HT-2026-DRAFT"],
    ["contract_advance", "FK-YF-2026-DRAFT"]
  ])("rejects %s payment request from a non-effective contract", async (sourceType, code) => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        })
      },
      paymentRequest: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType,
        contractVersionId: "contract-version-1",
        code,
        requestedAmountCents: "80000"
      } as never)
    ).rejects.toThrow("当前合同尚未归档生效，不能发起付款申请");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects contract advance payment when contract effective date is missing", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: null
        })
      },
      paymentRequest: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_advance",
        contractVersionId: "contract-version-1",
        code: "FK-YF-2026-NO-DATE",
        requestedAmountCents: "80000"
      } as never)
    ).rejects.toThrow("合同生效日期缺失，不能发起预付款申请");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects contract due payment when contract cannot be found", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      paymentRequest: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_due",
        contractVersionId: "contract-version-1",
        code: "FK-HT-2026-NO-CONTRACT",
        requestedAmountCents: "80000"
      } as never)
    ).rejects.toThrow("未找到关联合同，请刷新合同台账后重试");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects contract advance payment when effective payment terms are missing", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-1" }]),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "material_purchase"
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      paymentRequest: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_advance",
        contractVersionId: "contract-version-1",
        code: "FK-YF-2026-NO-TERMS",
        requestedAmountCents: "80000"
      } as never)
    ).rejects.toThrow("未找到已生效的付款条款，请先补齐合同付款条款");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a contract advance payment request before the contract-effective due date", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000n });
      const tx = {
        ...cashPool.tables,
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-version-1",
            contractId: "contract-1",
            status: "effective",
            amountCents: BigInt(1_000_000),
            effectiveAt: new Date("2026-06-01T00:00:00.000Z")
          })
        },
        contract: {
          findUnique: jest.fn().mockResolvedValue({
            id: "contract-1",
            projectId: "project-1",
            contractTypeKey: "material_purchase"
          })
        },
        paymentTermsVersion: {
          findFirst: jest.fn().mockResolvedValue({
            id: "terms-version-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            status: "effective"
          })
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "advance",
              basis: "contract_amount",
              ratioBps: 1000,
              fixedAmountCents: null,
              triggerAnchor: "contract_effective",
              dueDays: 30
            }
          ])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { contractId?: string; projectId?: string } }) => {
            if (args.where?.contractId === "contract-1") {
              return Promise.resolve([]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn()
        }
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      await expect(
        paymentService.create({
          sourceType: "contract_advance",
          contractVersionId: "contract-version-1",
          code: "FK-YF-2026-002",
          requestedAmountCents: "100000"
        } as never)
      ).rejects.toThrow("合同预付款当前可申请金额不足，当前最多可申请 0.00 元");
      expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects contract advance payment when confirmed historical advance already uses capacity", async () => {
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "contract-1" }]),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: BigInt(1_000_000),
          effectiveAt: new Date("2026-06-01T00:00:00.000Z")
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "material_purchase"
        })
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractVersionId: "contract-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(0),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(0),
          historicalPaidCents: BigInt(0),
          historicalProxyPaidCents: BigInt(0),
          historicalAdvancePaidCents: BigInt(100_000),
          historicalAdvanceDeductedCents: BigInt(0),
          otherConfirmedOccupancyCents: BigInt(0)
        })
      },
      paymentTermsVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "terms-version-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective"
        })
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            paymentTermsVersionId: "terms-version-1",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0
          }
        ])
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "contract_advance",
        contractVersionId: "contract-version-1",
        code: "FK-YF-HIS-CAP-001",
        requestedAmountCents: "1"
      } as never)
    ).rejects.toThrow("合同预付款当前可申请金额不足，当前最多可申请 0.00 元");

    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("freezes payment approval route when payment request is created by an applicant", async () => {
    const cashPool = projectCashPoolTables();
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn().mockResolvedValue({
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          sourceType: "settlement",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-012",
          requestedAmountCents: 50_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        })
      },
      approvalInstance: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...cashPool.tables,
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }])
        .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.create(
      {
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: "50000"
      },
      "contract-staff-1"
    );

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "payment.approve",
        businessType: "payment_request",
        businessId: "payment-1",
        status: "in_progress",
        currentNodeIndex: 0,
        frozenNodes: paymentApprovalNodes,
        applicantUserId: "contract-staff-1"
      })
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: "contract-staff-1",
        action: "payment.request.create",
        businessType: "payment_request",
        businessId: "payment-1",
        metadata: {
          projectId: "project-1",
          settlementId: "settlement-1",
          sourceType: "settlement",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          code: "FK-2026-012",
          requestedAmountCents: "50000"
        }
      }
    });
  });

  it("rejects create payment request from a non-effective settlement", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "approval_pending",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        })
      },
      paymentRequest: {
        findMany: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: "50000"
      })
    ).rejects.toThrow("当前结算尚未归档生效，不能发起付款申请");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects settlement payment request with an unsupported source type", async () => {
    const prisma = {
      $transaction: jest.fn(async (callback) => callback({}))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        sourceType: "legacy_manual",
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: "50000"
      } as never)
    ).rejects.toThrow("不支持的付款申请来源，请从结算或合同付款入口发起");
  });

  it("rejects settlement payment request without selecting settlement", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        code: "FK-2026-012",
        requestedAmountCents: "50000"
      })
    ).rejects.toThrow("请选择已归档生效的结算后再发起付款申请");
    expect(tx.settlement.findUnique).not.toHaveBeenCalled();
  });

  it("rejects settlement payment request when settlement cannot be found", async () => {
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      paymentRequest: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: "50000"
      })
    ).rejects.toThrow("未找到结算记录，请刷新结算台账后重试");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects create payment request above remaining settlement capacity", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "material_purchase" })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ signingSubjectType: "our_company" })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 20_000n
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            status: "approved_pending_payment",
            requestedAmountCents: 30_000n,
            approvedAmountCents: 30_000n,
            paidAmountCents: 0n
          }
        ]),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: "51000"
      })
    ).rejects.toThrow("付款申请金额超过当前可申请余额，当前最多可申请 500.00 元");
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("blocks payment request creation above contract due payment capacity", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000n });
      const tx = {
        settlement: {
          findUnique: jest.fn().mockResolvedValue({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            status: "effective",
            amountCents: 100_000n,
            payableAmountCents: 100_000n,
            paidAmountCents: 0n
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "settlement-1",
              amountCents: 100_000n,
              paidAmountCents: 0n,
              paymentTermsVersionId: "terms-version-1",
              status: "effective"
            },
            {
              id: "settlement-2",
              amountCents: 100_000n,
              paidAmountCents: 0n,
              paymentTermsVersionId: "terms-version-1",
              status: "effective"
            }
          ])
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              basis: "current_settlement",
              ratioBps: 8000,
              fixedAmountCents: null,
              dueDays: 30
            }
          ])
        },
        settlementArchiveFile: {
          findMany: jest.fn().mockResolvedValue([
            {
              settlementId: "settlement-1",
              confirmedAt: new Date("2026-01-01T00:00:00.000Z")
            },
            {
              settlementId: "settlement-2",
              confirmedAt: new Date()
            }
          ])
        },
        projectProxyPayment: {
          findMany: jest.fn().mockResolvedValue([])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { settlementId?: string; contractId?: string; projectId?: string } }) => {
            if (args.where?.contractId === "contract-1") {
              return Promise.resolve([
                {
                  settlementId: "settlement-2",
                  status: "approval_pending",
                  requestedAmountCents: 30_000n,
                  approvedAmountCents: null,
                  paidAmountCents: 0n
                }
              ]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn()
        },
        ...cashPool.tables
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      await expect(
        paymentService.create({
          settlementId: "settlement-1",
          code: "FK-2026-014",
          requestedAmountCents: "60000"
        })
      ).rejects.toThrow("合同应付款当前可申请金额不足，当前最多可申请 500.00 元");
      expect(tx.settlement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            contractId: "contract-1",
            status: { in: ["effective", "partially_paid", "paid"] }
          },
          select: expect.objectContaining({
            isFinal: true
          })
        })
      );
      expect(tx.paymentTermsStage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            stageType: true,
            triggerAnchor: true
          })
        })
      );
      expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contractId: "contract-1",
            sourceType: { in: ["settlement", "contract_due"] }
          })
        })
      );
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.settlement.findMany.mock.invocationCallOrder[0]
      );
      expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("deducts paid contract advances from contract due payment capacity", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));

    try {
      const cashPool = projectCashPoolTables({ receiptAmountCents: 200_000n });
      const tx = {
        settlement: {
          findUnique: jest.fn().mockResolvedValue({
            id: "settlement-1",
            projectId: "project-1",
            contractId: "contract-1",
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-version-1",
            status: "effective",
            amountCents: 100_000n,
            payableAmountCents: 100_000n,
            paidAmountCents: 0n
          }),
          findMany: jest.fn().mockResolvedValue([
            {
              id: "settlement-1",
              amountCents: 100_000n,
              paidAmountCents: 0n,
              paymentTermsVersionId: "terms-version-1",
              status: "effective",
              isFinal: false
            }
          ])
        },
        paymentTermsStage: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "progress",
              basis: "current_settlement",
              ratioBps: 8000,
              fixedAmountCents: null,
              triggerAnchor: "settlement_effective",
              dueDays: 0,
              advanceDeductionMode: null,
              advanceDeductionRatioBps: null,
              advanceDeductionStartRatioBps: null
            },
            {
              paymentTermsVersionId: "terms-version-1",
              stageType: "advance",
              basis: "contract_amount",
              ratioBps: 1000,
              fixedAmountCents: null,
              triggerAnchor: "contract_effective",
              dueDays: 0,
              advanceDeductionMode: "per_settlement_ratio",
              advanceDeductionRatioBps: 2000,
              advanceDeductionStartRatioBps: null
            }
          ])
        },
        settlementArchiveFile: {
          findMany: jest.fn().mockResolvedValue([
            {
              settlementId: "settlement-1",
              confirmedAt: new Date("2026-06-01T00:00:00.000Z")
            }
          ])
        },
        projectProxyPayment: {
          findMany: jest.fn().mockResolvedValue([])
        },
        paymentRequest: {
          findMany: jest.fn((args: { where?: { settlementId?: string; contractId?: string; projectId?: string; sourceType?: string } }) => {
            if (args.where?.contractId === "contract-1" && args.where?.sourceType === "contract_advance") {
              return Promise.resolve([
                {
                  paymentTermsVersionId: "terms-version-1",
                  status: "paid",
                  requestedAmountCents: 20_000n,
                  approvedAmountCents: 20_000n,
                  paidAmountCents: 20_000n
                }
              ]);
            }

            if (args.where?.projectId === "project-1") {
              return Promise.resolve(cashPool.projectPayments);
            }

            return Promise.resolve([]);
          }),
          create: jest.fn()
        },
        ...cashPool.tables,
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ id: "contract-1" }])
          .mockResolvedValueOnce([{ id: "settlement-1" }])
          .mockResolvedValueOnce([{ id: "project-1", isActive: true }])
      };
      const prisma = {
        $transaction: jest.fn(async (callback) => callback(tx))
      };
      const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

      await expect(
        paymentService.create({
          settlementId: "settlement-1",
          code: "FK-2026-ADV-DED",
          requestedAmountCents: "61000"
        })
      ).rejects.toThrow("合同应付款当前可申请金额不足，当前最多可申请 600.00 元");
      expect(tx.paymentRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contractId: "contract-1",
            sourceType: "contract_advance",
            paymentTermsVersionId: { in: ["terms-version-1"] },
            paidAmountCents: { gt: 0 }
          }),
          select: expect.objectContaining({
            paidAmountCents: true
          })
        })
      );
      expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not occupy project financing quota when a payment request is submitted for approval", async () => {
    const cashPool = projectCashPoolTables({
      receiptAmountCents: 20_000n,
      financingQuotas: [{ id: "financing-quota-1", amountCents: BigInt(100_000) }]
    });
    const tx = {
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 200_000n,
          paidAmountCents: 0n
        })
      },
      paymentRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(cashPool.projectPayments),
        create: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-013",
          projectId: "project-1",
          settlementId: "settlement-1",
          sourceType: "settlement",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          requestedAmountCents: 50_000n
        })
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...cashPool.tables
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await paymentService.create(
      {
        settlementId: "settlement-1",
        code: "FK-2026-013",
        requestedAmountCents: "50000"
      },
      "contract-staff-1"
    );

    expect(tx.projectFinancingQuotaUsage.createMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "payment.financing_quota.occupy"
      })
    );
    expect(tx.approvalInstance.create).toHaveBeenCalled();
  });

  it("counts linked project proxy payments against remaining settlement capacity", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
      contract: {
        findUnique: jest.fn().mockResolvedValue({ contractTypeKey: "material_purchase" })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ signingSubjectType: "our_company" })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 20_000n
        })
      },
      paymentRequest: {
        findMany: jest.fn().mockResolvedValue([
          {
            status: "approved_pending_payment",
            requestedAmountCents: 30_000n,
            approvedAmountCents: 30_000n,
            paidAmountCents: 0n
          }
        ]),
        create: jest.fn()
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: BigInt(25_000) }
        ])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.create({
        settlementId: "settlement-1",
        code: "FK-2026-012",
        requestedAmountCents: "26000"
      })
    ).rejects.toThrow("付款申请金额超过当前可申请余额，当前最多可申请 250.00 元");
    expect(tx.projectProxyPayment.findMany).toHaveBeenCalledWith({
      where: { settlementId: "settlement-1", voidedAt: null },
      select: { amountCents: true }
    });
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("approves the first payment node, keeps payment pending, and advances the instance", async () => {
    const governedPaymentApprovalNodes = paymentApprovalNodes.map((node, index) => index === 0
      ? {
          ...node,
          candidateUserIdsByRole: { comprehensive_director: ["pm-1"] },
          candidateUserIds: ["pm-1"]
        }
      : node);
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: "50000"
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending",
          approvedAmountCents: null
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: governedPaymentApprovalNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "pm-1", isActive: true }])
        .mockResolvedValueOnce([{ id: "sig-version-pm", fileId: "sig-pm", contentSha256: "c".repeat(64) }])
        .mockResolvedValueOnce([{ id: "sig-pm", contentSha256: "c".repeat(64), storageStatus: "active" }]),
      ...approvalRoleTables("comprehensive_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const approved = await paymentService.reviewApproval("FK-2026-012", "pm-1", {
      ...paymentReviewCoordinates,
      decision: "approve"
    });

    expect(approved.status).toBe("approval_pending");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "approval_pending" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            ...governedPaymentApprovalNodes[0],
            approvedRoleKeys: ["comprehensive_director"]
          },
          governedPaymentApprovalNodes[1],
          governedPaymentApprovalNodes[2],
          governedPaymentApprovalNodes[3]
        ],
        status: "in_progress"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "pm-1",
        action: "payment.approval.approve",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "approve",
        actorUserId: "pm-1",
        comment: undefined,
        approvedRoleKey: "comprehensive_director",
        representedUserId: "pm-1",
        signatureFileIdSnapshot: "sig-pm",
        signatureSha256Snapshot: "c".repeat(64),
        signatureVersionIdSnapshot: "sig-version-pm"
      }
    });
  });

  it("拒绝普通岗位申请人审批自己发起的付款", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: paymentApprovalNodes,
          applicantUserId: "comprehensive-director-1"
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...approvalRoleTables("comprehensive_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "comprehensive-director-1", {
        ...paymentReviewCoordinates,
        decision: "approve"
      })
    ).rejects.toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  function paymentLeaderSelfReviewFixture() {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n,
          approvedAmountCents: null
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000n
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ],
          applicantUserId: "leader-1"
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      projectFinancingQuotaUsage: { findMany: jest.fn().mockResolvedValue([]) },
      ...approvalRoleTables("chairman")
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      undefined,
      auth as never
    );
    return { service, tx };
  }

  it.each([
    [
      { decision: "approve", confirmationPassword: "top-secret" },
      "董事长或总经理审批自己发起的业务时，请填写自审原因"
    ],
    [
      { decision: "approve", selfReviewReason: "业务紧急" },
      "董事长或总经理自审前，请输入当前密码完成二次确认"
    ]
  ] as const)("付款领导自审缺少确认事实时零写入", async (input, message) => {
    const { service, tx } = paymentLeaderSelfReviewFixture();

    await expect(service.reviewApproval("payment-1", "leader-1", {
      ...paymentReviewCoordinates,
      ...input
    })).rejects.toThrow(message);
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("付款领导自审当前密码错误时零写入", async () => {
    auth.confirmPassword.mockRejectedValue(new Error("当前密码不正确，请重新输入"));
    const { service, tx } = paymentLeaderSelfReviewFixture();

    await expect(
      service.reviewApproval("payment-1", "leader-1", {
        ...paymentReviewCoordinates,
        decision: "approve",
        selfReviewReason: "业务紧急",
        confirmationPassword: "wrong-password"
      })
    ).rejects.toThrow("当前密码不正确，请重新输入");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("付款领导自审成功后只记录修剪后的原因和自审标记", async () => {
    const { service, tx } = paymentLeaderSelfReviewFixture();

    await service.reviewApproval("payment-1", "leader-1", {
      ...paymentReviewCoordinates,
      decision: "approve",
      selfReviewReason: "  业务紧急且由本人发起  ",
      confirmationPassword: "top-secret"
    });

    expect(auth.confirmPassword).toHaveBeenCalledWith("leader-1", "top-secret");
    const actionMetadata = tx.approvalActionLog.create.mock.calls[0]?.[0].data.metadata;
    const auditMetadata = audit.record.mock.calls[0]?.[1].metadata;
    expect(actionMetadata).toEqual({ selfReview: true, selfReviewReason: "业务紧急且由本人发起" });
    expect(auditMetadata).toEqual(expect.objectContaining({
      selfReview: true,
      selfReviewReason: "业务紧急且由本人发起"
    }));
    expect(JSON.stringify(actionMetadata)).not.toContain("confirmationPassword");
    expect(JSON.stringify(actionMetadata)).not.toContain("top-secret");
    expect(JSON.stringify(auditMetadata)).not.toContain("confirmationPassword");
    expect(JSON.stringify(auditMetadata)).not.toContain("top-secret");
  });

  it("rejects setting approved amount before the final payment approval node", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: paymentApprovalNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("comprehensive_director")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "pm-1", {
        ...paymentReviewCoordinates,
        decision: "approve",
        approvedAmountCents: "45000"
      })
    ).rejects.toThrow("只有最后一个付款审批节点才能调整批准金额");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("付款审批服务不可用时给出中文业务提示", async () => {
    const paymentService = new PaymentRequestService(new PaymentAmountService());

    await expect(
      paymentService.reviewApproval("FK-2026-012", "pm-1", {
        ...paymentReviewCoordinates,
        decision: "approve"
      })
    ).rejects.toThrow("付款审批服务暂不可用，请稍后重试或联系管理员");
  });

  it("approves the final OR node into approved pending payment", async () => {
    const frozenNodes = [
      { ...paymentApprovalNodes[0], approvedRoleKeys: ["comprehensive_director"] },
      { ...paymentApprovalNodes[1], approvedRoleKeys: ["project_manager"] },
      { ...paymentApprovalNodes[2], approvedRoleKeys: ["finance_director"] },
      paymentApprovalNodes[3]
    ];
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment",
          approvedAmountCents: 45_000n
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 3,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates(),
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const approved = await paymentService.reviewApproval("FK-2026-012", "chairman-1", {
      ...paymentReviewCoordinates,
      expectedNodeIndex: 3,
      decision: "approve",
      approvedAmountCents: "45000"
    });

    expect(approved.status).toBe("approved_pending_payment");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: {
        status: "approved_pending_payment",
        approvedAmountCents: 45_000n
      }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 4,
        frozenNodes: [
          frozenNodes[0],
          frozenNodes[1],
          frozenNodes[2],
          {
            ...paymentApprovalNodes[3],
            approvedRoleKeys: ["chairman"]
          }
        ],
        status: "approved"
      }
    });
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["non-integer", "45000.5"],
    ["non-finite", Number.NaN as unknown as string]
  ])("rejects %s approved amount values", async (_label, approvedAmountCents) => {
    const frozenNodes = [
      { ...paymentApprovalNodes[0], approvedRoleKeys: ["comprehensive_director"] },
      { ...paymentApprovalNodes[1], approvedRoleKeys: ["project_manager"] },
      { ...paymentApprovalNodes[2], approvedRoleKeys: ["finance_director"] },
      paymentApprovalNodes[3]
    ];
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 3,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        expectedNodeIndex: 3,
        decision: "approve",
        approvedAmountCents
      })
    ).rejects.toThrow("批准付款金额必须大于 0，请按元填写有效金额");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("fails closed before final approval when the frozen payer snapshot is not our company", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n,
          signingSubjectType: "affiliate",
          companyEntityIdSnapshot: null,
          companyEntityNameSnapshot: null,
          companyEntityCreditCodeSnapshot: null
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      ...financingUsageUpdates(),
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never
    );

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "approve"
      })
    ).rejects.toThrow(
      "付款合同不是完整的我方付款主体，不能完成付款审批"
    );
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("persists the approver's remark on the approval action log", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000n
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...financingUsageUpdates(),
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.reviewApproval("FK-2026-012", "chairman-1", {
      ...paymentReviewCoordinates,
      decision: "approve",
      comment: "  同意付款  "
    });

    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "approve",
        actorUserId: "chairman-1",
        comment: "同意付款",
        approvedRoleKey: "chairman",
        representedUserId: "chairman-1"
      }
    });
  });

  it("lets a standing delegate approve a payment node as the delegator's role", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment",
          approvedAmountCents: 45_000n
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"],
              candidateUserIdsByRole: {
                chairman: ["delegator-1"],
                general_manager: []
              },
              candidateUserIds: ["delegator-1"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectMember: {
        findMany: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(where.userId === "delegator-1" ? [{ positionKey: "chairman" }] : [])
        )
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          id: "delegate-user-1",
          isActive: true,
          signatureFileId: "sig-delegate"
        }])
        .mockResolvedValueOnce([{ id: "sig-version-delegate", fileId: "sig-delegate", contentSha256: "9".repeat(64) }])
        .mockResolvedValueOnce([{
          id: "sig-delegate",
          contentSha256: "9".repeat(64),
          storageStatus: "active"
        }]),
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const delegations = {
      activeDelegatorIds: jest.fn().mockResolvedValue(["delegator-1"])
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      undefined,
      delegations as never
    );

    const approved = await paymentService.reviewApproval("FK-2026-012", "delegate-user-1", {
      ...paymentReviewCoordinates,
      decision: "approve",
      approvedAmountCents: "45000"
    });

    expect(approved.status).toBe("approved_pending_payment");
    expect(delegations.activeDelegatorIds).toHaveBeenCalledWith(tx, "delegate-user-1");
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "delegate-user-1",
        approvedRoleKey: "chairman",
        representedUserId: "delegator-1",
        signatureFileIdSnapshot: "sig-delegate",
        signatureSha256Snapshot: "9".repeat(64),
        signatureVersionIdSnapshot: "sig-version-delegate"
      })
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "delegate-user-1",
        action: "payment.approval.approve"
      })
    });
  });

  it("rejects a pending payment request without making it payable", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_rejected",
          approvedAmountCents: null
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates(),
      ...approvalRoleTables("general_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const rejected = await paymentService.reviewApproval("FK-2026-012", "general-manager-1", {
      ...paymentReviewCoordinates,
      decision: "reject",
      comment: "付款条件尚未满足"
    });

    expect(rejected.status).toBe("approval_rejected");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: {
        status: "approval_rejected",
        approvedAmountCents: null
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "general-manager-1",
        action: "payment.approval.reject",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "reject",
        actorUserId: "general-manager-1",
        comment: "付款条件尚未满足",
        approvedRoleKey: "general_manager",
        representedUserId: "general-manager-1"
      }
    });
  });

  it("rejects unsupported payment approval decisions before the transaction", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "invalid"
      } as never)
    ).rejects.toThrow("不支持的付款审批处理方式");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires a comment when rejecting or returning payment approval", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "reject_previous",
        comment: "   "
      })
    ).rejects.toThrow("请填写审批意见，说明驳回或退回原因");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a payment approval to the previous node and keeps it pending", async () => {
    const frozenNodes = [
      {
        name: "预算部主管",
        mode: "any",
        roleKeys: ["budget_director"],
        approvedRoleKeys: ["budget_director"]
      },
      {
        name: "董事长/总经理",
        mode: "any",
        roleKeys: ["chairman", "general_manager"],
        approvedRoleKeys: ["chairman"]
      }
    ];
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 1,
          frozenNodes
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.reviewApproval("FK-2026-012", "chairman-1", {
      ...paymentReviewCoordinates,
      expectedNodeIndex: 1,
      decision: "reject_previous",
      comment: "请上一节点复核付款金额"
    });

    expect(result.status).toBe("approval_pending");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "approval_pending" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        currentNodeIndex: 0,
        frozenNodes: [
          {
            ...frozenNodes[0],
            approvedRoleKeys: []
          },
          {
            ...frozenNodes[1],
            approvedRoleKeys: []
          }
        ],
        status: "in_progress"
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "reject_previous",
        actorUserId: "chairman-1",
        comment: "请上一节点复核付款金额",
        approvedRoleKey: "chairman",
        representedUserId: "chairman-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "chairman-1",
        action: "payment.approval.reject_previous",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects returning to a previous node from the first payment approval node", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "reject_previous",
        comment: "无法退回上一节点"
      })
    ).rejects.toThrow("当前已经是第一个审批节点，不能退回上一节点");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("returns a payment approval to the applicant as draft and closes the instance", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "draft"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates(),
      ...approvalRoleTables("general_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.reviewApproval("FK-2026-012", "general-manager-1", {
      ...paymentReviewCoordinates,
      decision: "return_to_applicant",
      comment: "退回申请人补充付款依据"
    });

    expect(result.status).toBe("draft");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "draft" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "returned_to_applicant" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "return_to_applicant",
        actorUserId: "general-manager-1",
        comment: "退回申请人补充付款依据",
        approvedRoleKey: "general_manager",
        representedUserId: "general-manager-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "general-manager-1",
        action: "payment.approval.return_to_applicant",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("transfers the current payment approval node", async () => {
    const frozenNodes = [
      {
        name: "董事长/总经理",
        mode: "any",
        roleKeys: ["chairman", "general_manager"]
      }
    ];
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes
        }),
        update: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.transferApproval("FK-2026-012", "chairman-1", {
      toUserId: "transfer-user-1"
    });

    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: {
        frozenNodes: [
          {
            ...frozenNodes[0],
            assignments: [
              {
                kind: "transfer",
                fromUserId: "chairman-1",
                fromRoleKey: "chairman",
                toUserId: "transfer-user-1"
              }
            ]
          }
        ]
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "transfer",
        actorUserId: "chairman-1",
        approvedRoleKey: "chairman",
        representedUserId: "chairman-1",
        metadata: {
          kind: "transfer",
          fromUserId: "chairman-1",
          toUserId: "transfer-user-1",
          fromRoleKey: "chairman"
        }
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "chairman-1",
        action: "payment.approval.transfer",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("lets the transferred user approve a payment as the source role", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          status: "approved_pending_payment"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"],
              candidateUserIdsByRole: {
                chairman: ["chairman-1"],
                general_manager: []
              },
              candidateUserIds: ["chairman-1"],
              assignments: [
                {
                  kind: "transfer",
                  fromUserId: "chairman-1",
                  fromRoleKey: "chairman",
                  toUserId: "transfer-user-1"
                }
              ]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "transfer-user-1", isActive: true }])
        .mockResolvedValueOnce([{ id: "sig-version-transfer", fileId: "sig-transfer", contentSha256: "f".repeat(64) }])
        .mockResolvedValueOnce([{ id: "sig-transfer", contentSha256: "f".repeat(64), storageStatus: "active" }]),
      ...financingUsageUpdates(),
      ...approvalRoleTables("employee")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.reviewApproval("FK-2026-012", "transfer-user-1", {
      ...paymentReviewCoordinates,
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_payment");
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "transfer-user-1",
        action: "payment.approval.approve",
        businessType: "payment_request",
        businessId: "payment-1",
        metadata: expect.objectContaining({
          approvedRoleKey: "chairman"
        })
      })
    });
  });

  it("delegates the current payment approval node and records delegation ledger", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
      },
      approvalActionLog: {
        create: jest.fn()
      },
      approvalDelegation: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...approvalRoleTables("general_manager")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await paymentService.delegateApproval("FK-2026-012", "general-manager-1", {
      toUserId: "agent-user-1"
    });

    expect(tx.approvalDelegation.create).toHaveBeenCalledWith({
      data: {
        fromUserId: "general-manager-1",
        toUserId: "agent-user-1",
        startsAt: expect.any(Date),
        endsAt: expect.any(Date)
      }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "delegate",
        actorUserId: "general-manager-1",
        approvedRoleKey: "general_manager",
        representedUserId: "general-manager-1",
        metadata: {
          kind: "delegate",
          fromUserId: "general-manager-1",
          toUserId: "agent-user-1",
          fromRoleKey: "general_manager"
        }
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "general-manager-1",
        action: "payment.approval.delegate",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects payment approval assignment when the target user is invalid", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.transferApproval("FK-2026-012", "chairman-1", {
        toUserId: "chairman-1"
      })
    ).rejects.toThrow("请选择有效的审批接收人，不能选择当前操作人");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("付款审批转交服务不可用时给出中文业务提示", async () => {
    const paymentService = new PaymentRequestService(new PaymentAmountService());

    await expect(
      paymentService.transferApproval("FK-2026-012", "chairman-1", {
        toUserId: "transfer-user-1"
      })
    ).rejects.toThrow("付款审批转交服务暂不可用，请稍后重试或联系管理员");
  });

  it("rejects payment approval assignment when payment request cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      approvalInstance: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.transferApproval("FK-2026-012", "chairman-1", {
        toUserId: "transfer-user-1"
      })
    ).rejects.toThrow("未找到付款申请，请刷新付款台账后重试");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });

  it("rejects payment approval assignment unless payment is pending approval", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment"
        })
      },
      approvalInstance: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.delegateApproval("FK-2026-012", "chairman-1", {
        toUserId: "agent-user-1"
      })
    ).rejects.toThrow("当前付款申请已离开审批中，不能转交或委托审批");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });

  it("rejects payment approval assignment when approval instance cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.transferApproval("FK-2026-012", "chairman-1", {
        toUserId: "transfer-user-1"
      })
    ).rejects.toThrow("未找到进行中的付款审批，请刷新后重试");
  });

  it("rejects payment approval assignment when the current node cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 2,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.delegateApproval("FK-2026-012", "chairman-1", {
        toUserId: "agent-user-1"
      })
    ).rejects.toThrow("当前付款审批节点异常，请刷新后重试");
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("rejects payment approval assignment when the actor cannot assign the node", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }),
        update: jest.fn()
      },
      ...approvalRoleTables("employee")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.transferApproval("FK-2026-012", "employee-1", {
        toUserId: "transfer-user-1"
      })
    ).rejects.toThrow("当前账号不能转交或委托“董事长/总经理”付款审批节点");
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("rejects approval review unless the payment request is pending approval", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const error = await paymentService
      .reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "approve"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as Error).message).toBe("当前付款申请已离开审批中，不能处理审批");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("rejects approval review when payment request cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "approve"
      })
    ).rejects.toThrow("未找到付款申请，请刷新付款台账后重试");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });

  it("rejects approval review when approval instance cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const error = await paymentService
      .reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "approve"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as Error).message).toBe("未找到进行中的付款审批，请刷新后重试");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects approval review when the current approval node cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 3,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "approve"
      })
    ).rejects.toThrow("当前付款审批节点异常，请刷新后重试");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("rejects approval review when the actor cannot approve the current node", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending"
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"],
              candidateUserIdsByRole: {
                chairman: ["chairman-1"],
                general_manager: []
              },
              candidateUserIds: ["chairman-1"]
            }
          ]
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...financingUsageUpdates(),
      ...approvalRoleTables("employee")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const error = await paymentService
      .reviewApproval("FK-2026-012", "employee-1", {
        ...paymentReviewCoordinates,
        expectedApprovalInstanceId: "forged-instance",
        expectedNodeIndex: 99,
        decision: "approve"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
    expect((error as Error).message).toBe("当前账号不能处理“董事长/总经理”付款审批节点");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.projectFinancingQuotaUsage.update).not.toHaveBeenCalled();
  });

  it.each([
    ["payment version", { expectedPaymentUpdatedAt: "2026-07-31T01:00:01.000Z" }],
    ["approval instance", { expectedApprovalInstanceId: "approval-instance-stale" }],
    ["approval node", { expectedNodeIndex: 1 }],
    ["approval version", { expectedApprovalUpdatedAt: "2026-07-31T01:01:01.000Z" }]
  ] as const)("rejects a stale %s coordinate before approval writes", async (_label, override) => {
    const paymentUpdatedAt = new Date(paymentReviewCoordinates.expectedPaymentUpdatedAt);
    const approvalUpdatedAt = new Date(paymentReviewCoordinates.expectedApprovalUpdatedAt);
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n,
          approvedAmountCents: null,
          updatedAt: paymentUpdatedAt
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ],
          applicantUserId: "applicant-1",
          updatedAt: approvalUpdatedAt
        }),
        findMany: jest.fn().mockResolvedValue([{
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ],
          applicantUserId: "applicant-1",
          updatedAt: approvalUpdatedAt
        }]),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...approvalRoleTables("chairman"),
      ...financingUsageUpdates()
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const error = await paymentService
      .reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        ...override,
        decision: "approve"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as Error).message).toBe("付款审批坐标已变化，请刷新页面后重试");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.projectFinancingQuotaUsage.update).not.toHaveBeenCalled();
  });

  it("rejects duplicate in-progress payment approval instances before approval writes", async () => {
    const paymentUpdatedAt = new Date(paymentReviewCoordinates.expectedPaymentUpdatedAt);
    const approvalUpdatedAt = new Date(paymentReviewCoordinates.expectedApprovalUpdatedAt);
    const approval = {
      id: "approval-instance-1",
      currentNodeIndex: 0,
      frozenNodes: [
        { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
      ],
      applicantUserId: "applicant-1",
      updatedAt: approvalUpdatedAt
    };
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n,
          approvedAmountCents: null,
          updatedAt: paymentUpdatedAt
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(approval),
        findMany: jest.fn().mockResolvedValue([
          approval,
          { ...approval, id: "approval-instance-2" }
        ]),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() },
      ...approvalRoleTables("chairman"),
      ...financingUsageUpdates()
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const error = await paymentService
      .reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "approve"
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getStatus()).toBe(409);
    expect((error as Error).message).toBe("付款审批实例异常，请刷新页面后重试");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects approved amount above requested amount", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewPaymentVersion,
          id: "payment-1",
          code: "FK-2026-012",
          projectId: "project-1",
          status: "approval_pending",
          requestedAmountCents: 50_000n
        }),
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          ...paymentReviewApprovalVersion,
          id: "approval-instance-1",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "董事长/总经理",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        })
      },
      ...approvalRoleTables("chairman")
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.reviewApproval("FK-2026-012", "chairman-1", {
        ...paymentReviewCoordinates,
        decision: "approve",
        approvedAmountCents: "50001"
      })
    ).rejects.toThrow("批准付款金额不能超过申请金额，当前最多可批准 500.00 元");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("records actual payment execution and marks payment and settlement paid", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          paidAmountCents: 20_000n
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000n,
          paidAmountCents: 20_000n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          status: "paid",
          paidAmountCents: 50_000n
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "partially_paid",
          payableAmountCents: 100_000n,
          paidAmountCents: 70_000n
        }),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-1",
          paymentRequestId: "payment-1",
          amountCents: 30_000n,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest.fn()
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never,
      undefined,
      undefined,
      undefined,
      undefined,
      operatingSources as never
    );

    const execution = await paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
      amountCents: "30000",
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(execution.id).toBe("execution-1");
    expect(execution.amountCents).toBe("30000");
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).toHaveBeenCalledWith(
      expect.anything(),
      {
        projectId: "project-1",
        sourceType: "payment_execution",
        sourceBusinessId: "execution-1"
      },
      "cashier-1"
    );
    expect(auth.confirmPassword).toHaveBeenCalledWith("cashier-1", "current-password");
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.settlement.findUnique.mock.invocationCallOrder[0]
    );
    expect(tx.paymentExecution.create).toHaveBeenCalledWith({
      data: {
        idempotencyKey: paymentExecutionCoordinates.idempotencyKey,
        paymentRequestId: "payment-1",
        settlementId: "settlement-1",
        paymentSubjectType: "our_company",
        companyEntityIdSnapshot: "company-1",
        companyEntityNameSnapshot: "建工智管建设有限公司",
        companyEntityCreditCodeSnapshot: "91310000TEST000001",
        amountCents: 30_000n,
        paidAt: new Date("2026-06-22T00:00:00.000Z"),
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      }
    });
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: {
        paidAmountCents: 50_000n,
        status: "paid"
      }
    });
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: {
        paidAmountCents: 100_000n,
        status: "paid"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "cashier-1",
        action: "payment.execution.record",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("allocates shared project funding only after the voucher-backed payment execution exists", async () => {
    const payment = paymentExecutionRow({
      paidAmountCents: 20_000n
    });
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([payment])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(payment),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          status: "paid",
          paidAmountCents: 50_000n
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "partially_paid",
          payableAmountCents: 100_000n,
          paidAmountCents: 70_000n
        }),
        update: jest.fn()
      },
      paymentExecution: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "execution-1",
          paymentRequestId: "payment-1",
          amountCents: 30_000n,
          paidAt: new Date("2026-06-22T00:00:00.000Z"),
          executedByUserId: "cashier-1",
          voucherFileId: "file-1"
        })
      },
      projectFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never
    );

    await paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
      amountCents: "30000",
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(projectFunding.lockFundingContext).toHaveBeenCalledWith(tx, "project-1");
    expect(projectFunding.allocateExecution).toHaveBeenCalledWith(tx, {
      projectId: "project-1",
      executionType: "payment_execution",
      executionId: "execution-1",
      businessType: "payment_request",
      businessId: "payment-1",
      amountCents: 30_000n,
      occurredAt: new Date("2026-06-22T00:00:00.000Z"),
      actorUserId: "cashier-1"
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "cashier-1",
        action: "payment.execution.record",
        businessType: "payment_request",
        businessId: "payment-1",
        metadata: expect.objectContaining({
          projectId: "project-1",
          paidAt: "2026-06-22T00:00:00.000Z",
          idempotencyKey: paymentExecutionCoordinates.idempotencyKey,
          payer: {
            paymentSubjectType: "our_company",
            companyEntityIdSnapshot: "company-1",
            companyEntityNameSnapshot: "建工智管建设有限公司",
            companyEntityCreditCodeSnapshot: "91310000TEST000001"
          },
          funding: expect.objectContaining({
            kind: "allocated",
            projectCashAmountCents: "30000",
            financingQuotaAmountCents: "0"
          })
        })
      })
    );
    expect(tx.paymentExecution.create.mock.invocationCallOrder[0]).toBeLessThan(
      projectFunding.allocateExecution.mock.invocationCallOrder[0]
    );
    expect(tx.settlement.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      fileAccess.assertFileHasNoBusinessBinding.mock.invocationCallOrder[0]
    );
    expect(
      fileAccess.assertFileHasNoBusinessBinding.mock.invocationCallOrder[0]
    ).toBeLessThan(
      tx.paymentExecution.create.mock.invocationCallOrder[0]
    );
    expect(projectFunding.allocateExecution.mock.invocationCallOrder[0]).toBeLessThan(
      audit.record.mock.invocationCallOrder[0]
    );
  });

  it("does not update payment, settlement, or audit when shared project funding is insufficient", async () => {
    projectFunding.allocateExecution.mockRejectedValue(
      new BadRequestException("项目可用资金不足，当前最多可实际支付 20000 分")
    );
    const payment = paymentExecutionRow();
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([payment])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(payment),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn()
      },
      paymentExecution: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "execution-1",
          paymentRequestId: "payment-1",
          amountCents: 30_000n,
          paidAt: new Date("2026-06-22T00:00:00.000Z"),
          executedByUserId: "cashier-1",
          voucherFileId: "file-1"
        })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("项目可用资金不足，当前最多可实际支付 20000 分");

    expect(tx.paymentExecution.create).toHaveBeenCalledTimes(1);
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns an exact payment execution receipt before password confirmation or project funding locks", async () => {
    projectFunding.allocateExecution.mockResolvedValue({
      kind: "replayed",
      projectCashAmountCents: 30_000n,
      financingQuotaAmountCents: 0n,
      allocations: [
        {
          sourceType: "project_cash",
          sourceId: null,
          amountCents: 30_000n
        }
      ]
    });
    const payment = paymentExecutionRow({
      status: "paid",
      paidAmountCents: 50_000n,
      updatedAt: new Date("2026-07-31T02:00:01.000Z")
    });
    const existingExecution = {
      id: "execution-1",
      idempotencyKey: paymentExecutionCoordinates.idempotencyKey,
      paymentRequestId: "payment-1",
      settlementId: "settlement-1",
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: "company-1",
      companyEntityNameSnapshot: "建工智管建设有限公司",
      companyEntityCreditCodeSnapshot: "91310000TEST000001",
      amountCents: 30_000n,
      paidAt: new Date("2026-06-22T00:00:00.000Z"),
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValueOnce([payment]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(payment),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentExecution: {
        findFirst: jest.fn().mockResolvedValue(existingExecution),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).resolves.toEqual({
      ...existingExecution,
      amountCents: "30000"
    });

    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(projectFunding.lockFundingContext).not.toHaveBeenCalled();
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("normalizes an uppercase UUID to the canonical lowercase execution key", async () => {
    const { tx, prisma } = hardenedPaymentExecutionFixture();
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never
    );

    await paymentService.recordExecution("FK-2026-012", "cashier-1", {
      ...paymentExecutionCoordinates,
      idempotencyKey:
        paymentExecutionCoordinates.idempotencyKey.toUpperCase(),
      amountCents: "30000",
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.paymentExecution.findUnique).toHaveBeenCalledWith({
      where: {
        idempotencyKey: paymentExecutionCoordinates.idempotencyKey
      }
    });
    expect(tx.paymentExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: paymentExecutionCoordinates.idempotencyKey
      })
    });
  });

  it("rejects a reused payment execution idempotency key with different persisted facts before CAS", async () => {
    const existingExecution = {
      id: "execution-existing-1",
      idempotencyKey: paymentExecutionCoordinates.idempotencyKey,
      paymentRequestId: "payment-1",
      settlementId: "settlement-1",
      paymentSubjectType: "our_company",
      companyEntityIdSnapshot: "company-1",
      companyEntityNameSnapshot: "建工智管建设有限公司",
      companyEntityCreditCodeSnapshot: "91310000TEST000001",
      amountCents: 29_999n,
      paidAt: new Date("2026-06-22T00:00:00.000Z"),
      executedByUserId: "cashier-1",
      voucherFileId: "file-1"
    };
    const { tx, prisma } = hardenedPaymentExecutionFixture(
      { updatedAt: new Date("2026-07-31T02:00:01.000Z") },
      existingExecution
    );
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("该付款实付登记幂等键已绑定不同的持久事实");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(fileAccess.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
  });

  it("rejects a stale payment execution CAS before binding the voucher or writing money", async () => {
    const { tx, prisma } = hardenedPaymentExecutionFixture({
      updatedAt: new Date("2026-07-31T02:00:01.000Z")
    });
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("付款申请已变化，请刷新后重试");
    expect(fileAccess.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["inactive actor", false, ["finance_staff"], "当前付款登记账号不存在或已停用"],
    ["non-project finance actor", true, [], "只有当前项目财务人员可以登记实际付款"]
  ])(
    "fails closed for %s",
    async (_label, isActive, projectRoles, expectedMessage) => {
      const { tx, prisma } = hardenedPaymentExecutionFixture();
      tx.user.findUnique.mockResolvedValue({ id: "cashier-1", isActive });
      tx.projectMember.findMany.mockResolvedValue(
        projectRoles.map((positionKey) => ({ positionKey }))
      );
      const paymentService = paymentExecutionService(
        new PaymentAmountService(),
        prisma as never,
        audit as never,
        fileAccess as never,
        auth as never,
        undefined,
        undefined,
        projectFunding as never
      );

      await expect(
        paymentService.recordExecution("FK-2026-012", "cashier-1", {
          ...paymentExecutionCoordinates,
          amountCents: "30000",
          paidAt: "2026-06-22T00:00:00.000Z",
          voucherFileId: "file-1",
          confirmationPassword: "current-password"
        })
      ).rejects.toThrow(expectedMessage);
      expect(tx.paymentExecution.create).not.toHaveBeenCalled();
      expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      "non-company payment request",
      { paymentSubjectType: "affiliate" },
      "施工企业付款申请不得登记我方实际付款，请登记施工企业外部付款事实"
    ],
    [
      "incomplete company snapshot",
      { companyEntityCreditCodeSnapshot: null },
      "付款合同缺少完整的我方付款主体快照，请先补齐合同主体后重试"
    ]
  ])("rejects %s before execution writes", async (_label, overrides, message) => {
    const { tx, prisma } = hardenedPaymentExecutionFixture(overrides);
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow(message);
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a voucher uploaded by a different actor after taking the unbound-file lock", async () => {
    const { tx, prisma } = hardenedPaymentExecutionFixture();
    fileAccess.assertFileHasNoBusinessBinding.mockResolvedValueOnce({
      id: "file-1",
      uploadedByUserId: "other-user",
      storageStatus: "active"
    });
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      fileAccess as never,
      auth as never,
      undefined,
      undefined,
      projectFunding as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("付款凭证必须由当前登记人上传");
    expect(fileAccess.assertFileHasNoBusinessBinding).toHaveBeenCalledWith(
      tx,
      "file-1"
    );
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it.each([
    ["file binding", undefined, projectFunding],
    ["project funding", fileAccess, undefined]
  ])("fails closed when the %s dependency is unavailable", async (_label, files, funding) => {
    const prisma = { $transaction: jest.fn() };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      files as never,
      auth as never,
      undefined,
      undefined,
      funding as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("付款实付登记依赖服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(["P2002", "P2034"])(
    "returns only the exact committed winner after %s",
    async (code) => {
      const existingExecution = {
        id: "execution-winner-1",
        idempotencyKey: paymentExecutionCoordinates.idempotencyKey,
        paymentRequestId: "payment-1",
        settlementId: "settlement-1",
        paymentSubjectType: "our_company",
        companyEntityIdSnapshot: "company-1",
        companyEntityNameSnapshot: "建工智管建设有限公司",
        companyEntityCreditCodeSnapshot: "91310000TEST000001",
        amountCents: 30_000n,
        paidAt: new Date("2026-06-22T00:00:00.000Z"),
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      };
      const prisma = concurrentPaymentExecutionPrisma(code, {
        paymentExecution: {
          findUnique: jest.fn().mockResolvedValue(existingExecution)
        },
        paymentRequest: {
          findFirst: jest.fn().mockResolvedValue({
            id: "payment-1",
            settlementId: "settlement-1",
            contractVersionId: "contract-version-1",
            paymentSubjectType: "our_company"
          })
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            signingSubjectType: "our_company",
            companyEntityIdSnapshot: "company-1",
            companyEntityNameSnapshot: "建工智管建设有限公司",
            companyEntityCreditCodeSnapshot: "91310000TEST000001"
          })
        }
      });
      const paymentService = paymentExecutionService(
        new PaymentAmountService(),
        prisma as never,
        audit as never,
        fileAccess as never,
        auth as never,
        undefined,
        undefined,
        projectFunding as never
      );

      await expect(
        paymentService.recordExecution("FK-2026-012", "cashier-1", {
          ...paymentExecutionCoordinates,
          amountCents: "30000",
          paidAt: "2026-06-22T00:00:00.000Z",
          voucherFileId: "file-1",
          confirmationPassword: "current-password"
        })
      ).resolves.toEqual({
        ...existingExecution,
        amountCents: "30000"
      });
    }
  );

  it.each(["P2002", "P2034"])(
    "rejects a non-exact concurrent winner after %s",
    async (code) => {
      const prisma = concurrentPaymentExecutionPrisma(code, {
        paymentExecution: {
          findUnique: jest.fn().mockResolvedValue({
            id: "execution-winner-1",
            idempotencyKey: paymentExecutionCoordinates.idempotencyKey,
            paymentRequestId: "payment-1",
            settlementId: "settlement-1",
            paymentSubjectType: "our_company",
            companyEntityIdSnapshot: "company-1",
            companyEntityNameSnapshot: "建工智管建设有限公司",
            companyEntityCreditCodeSnapshot: "91310000TEST000001",
            amountCents: 30_001n,
            paidAt: new Date("2026-06-22T00:00:00.000Z"),
            executedByUserId: "cashier-1",
            voucherFileId: "file-1"
          })
        },
        paymentRequest: {
          findFirst: jest.fn().mockResolvedValue({
            id: "payment-1",
            settlementId: "settlement-1",
            contractVersionId: "contract-version-1",
            paymentSubjectType: "our_company"
          })
        },
        contractVersion: {
          findUnique: jest.fn().mockResolvedValue({
            signingSubjectType: "our_company",
            companyEntityIdSnapshot: "company-1",
            companyEntityNameSnapshot: "建工智管建设有限公司",
            companyEntityCreditCodeSnapshot: "91310000TEST000001"
          })
        }
      });
      const paymentService = paymentExecutionService(
        new PaymentAmountService(),
        prisma as never,
        audit as never,
        fileAccess as never,
        auth as never,
        undefined,
        undefined,
        projectFunding as never
      );

      await expect(
        paymentService.recordExecution("FK-2026-012", "cashier-1", {
          ...paymentExecutionCoordinates,
          amountCents: "30000",
          paidAt: "2026-06-22T00:00:00.000Z",
          voucherFileId: "file-1",
          confirmationPassword: "current-password"
        })
      ).rejects.toBeInstanceOf(ConflictException);
    }
  );

  it("rejects payment execution when the voucher cannot be bound", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({ paidAmountCents: 20_000n })
      ]),
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 70_000n
        }),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    fileAccess.assertFileHasNoBusinessBinding.mockRejectedValueOnce(
      new Error("Voucher already has a business binding")
    );
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      fileAccess as never,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-other",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("Voucher already has a business binding");
    expect(fileAccess.assertFileHasNoBusinessBinding).toHaveBeenCalledWith(
      tx,
      "file-other"
    );
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects settlement execution when contract-level allocations consumed the settlement capacity", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 40_000n
        }),
        update: jest.fn()
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 40_000n }
        ])
      },
      paymentExecution: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("实付金额超过结算剩余可付金额，当前最多可实付 200.00 元");

    expect(tx.paymentExecutionAllocation.findMany).toHaveBeenCalledWith({
      where: {
        settlementId: "settlement-1",
        allocationType: { in: ["contract_due_payment", "advance_deduction"] }
      },
      select: { amountCents: true }
    });
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("rejects historical takeover settlement execution when takeover is no longer confirmed", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            requestedAmountCents: 80_000n,
            approvedAmountCents: 80_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n,
          sourceType: "historical_takeover",
          sourceTakeoverId: "takeover-1"
        }),
        update: jest.fn()
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          takeoverStatus: "reviewing",
          historicalBalanceConfirmedAt: new Date("2026-07-01T00:00:00.000Z")
        })
      },
      paymentExecution: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "80000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("历史合同接管尚未主管确认，不能登记实付");

    expect(tx.contractTakeover.findUnique).toHaveBeenCalledWith({
      where: { contractVersionId: "contract-version-1" },
      select: {
        id: true,
        takeoverStatus: true,
        takeoverLevel: true,
        historicalBalanceConfirmedAt: true
      }
    });
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("rejects payment execution when linked settlement is no longer payable", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            requestedAmountCents: 80_000n,
            approvedAmountCents: 80_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "draft",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "80000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow(
      "当前结算不是已归档可付款状态，不能登记实付；请先核对结算归档或更正记录"
    );

    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("rejects historical takeover settlement execution when takeover is C level", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            requestedAmountCents: 80_000n,
            approvedAmountCents: 80_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn()
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          takeoverStatus: "confirmed",
          takeoverLevel: "C",
          historicalBalanceConfirmedAt: new Date("2026-07-01T00:00:00.000Z")
        })
      },
      paymentExecution: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "80000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("C级历史接管仍有资料缺口或争议，不能登记实付");

    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
  });

  it("rechecks abnormal overpayment inside the execution lock path", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            requestedAmountCents: 80_000n,
            approvedAmountCents: 80_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn()
      },
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          id: "takeover-1",
          takeoverStatus: "confirmed",
          takeoverLevel: "A",
          historicalBalanceConfirmedAt: new Date(
            "2026-07-01T00:00:00.000Z"
          )
        })
      },
      paymentExecution: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const balances = {
      assertNoAbnormalOverpayForContract: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException(
            "历史接管存在尚未解除的异常超付，不能登记实付"
          )
        )
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      audit as never,
      undefined,
      auth as never,
      undefined,
      undefined,
      undefined,
      balances as never
    );

    await expect(
      paymentService.recordExecution(
        "FK-2026-012",
        "cashier-1",
        {
        ...paymentExecutionCoordinates,
          amountCents: "80000",
          paidAt: "2026-06-22T00:00:00.000Z",
          voucherFileId: "file-1",
          confirmationPassword: "current-password"
        }
      )
    ).rejects.toThrow(
      "历史接管存在尚未解除的异常超付，不能登记实付"
    );
    expect(
      balances.assertNoAbnormalOverpayForContract
    ).toHaveBeenCalledWith(tx, "contract-1", "登记实付");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("records contract advance execution without touching settlement ledger", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-advance-1",
            code: "FK-YF-2026-001",
            settlementId: null,
            sourceType: "contract_advance",
            requestedAmountCents: 100_000n,
            approvedAmountCents: 100_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-advance-1",
          code: "FK-YF-2026-001",
          settlementId: null,
          status: "approved_pending_payment",
          requestedAmountCents: 100_000n,
          approvedAmountCents: 100_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-advance-1",
          status: "paid",
          paidAmountCents: 100_000n
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 100_000n,
          approvedAmountCents: 100_000n,
          paidAmountCents: 100_000n
        })
      },
      settlement: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-advance-1",
          paymentRequestId: "payment-advance-1",
          amountCents: 100_000n,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    const execution = await paymentService.recordExecution("FK-YF-2026-001", "cashier-1", {
        ...paymentExecutionCoordinates,
      amountCents: "100000",
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(execution.id).toBe("execution-advance-1");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.paymentRequest.update.mock.invocationCallOrder[0]
    );
    expect(tx.settlement.findUnique).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(tx.paymentExecution.create).toHaveBeenCalledWith({
      data: {
        idempotencyKey: paymentExecutionCoordinates.idempotencyKey,
        paymentRequestId: "payment-advance-1",
        settlementId: null,
        paymentSubjectType: "our_company",
        companyEntityIdSnapshot: "company-1",
        companyEntityNameSnapshot: "建工智管建设有限公司",
        companyEntityCreditCodeSnapshot: "91310000TEST000001",
        amountCents: 100_000n,
        paidAt: new Date("2026-07-03T00:00:00.000Z"),
        executedByUserId: "cashier-1",
        voucherFileId: "file-1"
      }
    });
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-advance-1" },
      data: {
        paidAmountCents: 100_000n,
        status: "paid"
      }
    });
  });

  it("records allocation ledger rows for contract-level due payment executions", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-due-1",
            code: "FK-HT-2026-001",
            settlementId: null,
            sourceType: "contract_due",
            requestedAmountCents: 70_000n,
            approvedAmountCents: 70_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }, { id: "settlement-2" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-due-1",
          code: "FK-HT-2026-001",
          settlementId: null,
          sourceType: "contract_due",
          status: "approved_pending_payment",
          requestedAmountCents: 70_000n,
          approvedAmountCents: 70_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-due-1",
          status: "paid",
          paidAmountCents: 50_000n
        }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 70_000n,
          approvedAmountCents: 70_000n,
          paidAmountCents: 50_000n
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000n,
            paidAmountCents: 0n,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          },
          {
            id: "settlement-2",
            status: "effective",
            amountCents: 80_000n,
            paidAmountCents: 0n,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          }
        ]),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            name: "进度款",
            paymentTermsVersionId: "terms-v1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 5000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: null,
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-1", confirmedAt: new Date("2026-07-01T00:00:00.000Z") },
          { settlementId: "settlement-2", confirmedAt: new Date("2026-07-02T00:00:00.000Z") }
        ])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([
          { sourceRowId: "settlement-1:progress:0", amountCents: 30_000n }
        ]),
        createMany: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-due-1",
          paymentRequestId: "payment-due-1",
          amountCents: 50_000n,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    const execution = await paymentService.recordExecution("FK-HT-2026-001", "cashier-1", {
        ...paymentExecutionCoordinates,
      amountCents: "50000",
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(execution.id).toBe("execution-due-1");
    expect(tx.settlement.findUnique).not.toHaveBeenCalled();
    expect(tx.settlement.update).not.toHaveBeenCalled();
    expect(tx.paymentExecutionAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentExecutionId: "execution-due-1",
          paymentRequestId: "payment-due-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          settlementId: "settlement-1",
          sourceType: "contract_due",
          allocationType: "contract_due_payment",
          sourceRowId: "settlement-1:progress:0",
          paymentTermsVersionId: "terms-v1",
          stageType: "progress",
          stageId: "stage-progress",
          stageName: "进度款",
          triggerAnchor: "settlement_effective",
          dueDays: 0,
          ratioBps: 5000,
          fixedAmountCents: null,
          sourceEffectiveAt: new Date("2026-07-01T00:00:00.000Z"),
          expectedPayableAt: new Date("2026-07-01T00:00:00.000Z"),
          sourcePayableAmountCents: 50_000n,
          allocationOrder: 0,
          createdByUserId: "cashier-1",
          amountCents: 20_000n
        }),
        expect.objectContaining({
          paymentExecutionId: "execution-due-1",
          paymentRequestId: "payment-due-1",
          projectId: "project-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          settlementId: "settlement-2",
          sourceType: "contract_due",
          allocationType: "contract_due_payment",
          sourceRowId: "settlement-2:progress:0",
          paymentTermsVersionId: "terms-v1",
          stageType: "progress",
          stageId: "stage-progress",
          stageName: "进度款",
          sourcePayableAmountCents: 40_000n,
          allocationOrder: 1,
          createdByUserId: "cashier-1",
          amountCents: 30_000n
        })
      ]
    });
  });

  it("inherits the frozen generic contract stage into the execution allocation", async () => {
    const effectiveAt = new Date("2026-06-01T00:00:00.000Z");
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-generic-1",
            code: "FK-TY-2026-001",
            settlementId: null,
            sourceType: "contract_due",
            paymentTermsVersionId: "terms-generic-1",
            paymentTermsStageId: "stage-generic-1",
            requestedAmountCents: 50_000n,
            approvedAmountCents: 50_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([]),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          amountCents: 200_000n,
          effectiveAt
        })
      },
      paymentTermsStage: {
        findUnique: jest.fn().mockResolvedValue({
          id: "stage-generic-1",
          paymentTermsVersionId: "terms-generic-1",
          name: "合同生效后付款",
          stageType: "progress",
          basis: "contract_amount",
          ratioBps: 5000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 10
        })
      },
      settlement: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({ id: "execution-generic-1" })
      },
      paymentExecutionAllocation: {
        createMany: jest.fn()
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-generic-1",
          projectId: "project-1"
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-generic-1",
          status: "paid",
          paidAmountCents: 50_000n
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n
        })
      },
      auditLog: { create: jest.fn() },
      ...financingUsageUpdates()
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx))) };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await paymentService.recordExecution("FK-TY-2026-001", "cashier-1", {
        ...paymentExecutionCoordinates,
      amountCents: "50000",
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.settlement.findMany).not.toHaveBeenCalled();
    expect(tx.paymentExecutionAllocation.createMany).toHaveBeenCalledWith({
      data: [{
        paymentExecutionId: "execution-generic-1",
        paymentRequestId: "payment-generic-1",
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        settlementId: null,
        sourceType: "contract_due",
        allocationType: "contract_due_payment",
        sourceRowId: "contract:terms-generic-1:stage-generic-1",
        paymentTermsVersionId: "terms-generic-1",
        stageType: "progress",
        stageId: "stage-generic-1",
        stageName: "合同生效后付款",
        triggerAnchor: "contract_effective",
        dueDays: 10,
        ratioBps: 5000,
        fixedAmountCents: null,
        sourceEffectiveAt: effectiveAt,
        expectedPayableAt: new Date("2026-06-11T00:00:00.000Z"),
        sourcePayableAmountCents: 100_000n,
        amountCents: 50_000n,
        allocationOrder: 0,
        createdByUserId: "cashier-1"
      }]
    });
  });

  it("登记合同应付款实付时没有可分摊有效结算来源则拒绝", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-due-1",
            code: "FK-HT-2026-NO-SOURCE",
            settlementId: null,
            sourceType: "contract_due",
            requestedAmountCents: 50_000n,
            approvedAmountCents: 50_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-due-1",
          code: "FK-HT-2026-NO-SOURCE",
          settlementId: null,
          sourceType: "contract_due",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn(),
        findUnique: jest.fn()
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-due-1",
          paymentRequestId: "payment-due-1",
          amountCents: 50_000n,
          voucherFileId: "file-1"
        })
      },
      paymentExecutionAllocation: {
        createMany: jest.fn()
      },
      projectFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    const result = paymentService.recordExecution(
      "FK-HT-2026-NO-SOURCE",
      "cashier-1",
      {
        ...paymentExecutionCoordinates,
        amountCents: "50000",
        paidAt: "2026-07-03T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      }
    );

    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toThrow(
      "未找到可分摊的有效结算来源，请先核对合同结算和历史期初结算"
    );
    expect(tx.paymentExecutionAllocation.createMany).not.toHaveBeenCalled();
  });

  it("allocates contract-level due execution to a historical initial settlement", async () => {
    const confirmedAt = new Date("2026-07-01T00:00:00.000Z");
    const historicalSettlement = {
      id: "settlement-history",
      status: "effective",
      amountCents: 100_000n,
      paidAmountCents: 40_000n,
      contractVersionId: "contract-version-1",
      paymentTermsVersionId: "terms-v1",
      isFinal: false,
      sourceType: "historical_takeover",
      sourceTakeoverId: "takeover-1"
    };
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-due-history",
            code: "FK-HT-HIS-ALLOC-001",
            settlementId: null,
            sourceType: "contract_due",
            requestedAmountCents: 50_000n,
            approvedAmountCents: 50_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-history" }]),
      contractTakeover: {
        findFirst: jest.fn().mockResolvedValue({
          id: "takeover-1",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          paymentTermsVersionId: "terms-v1",
          takeoverStatus: "confirmed",
          historicalBalanceConfirmedAt: confirmedAt,
          historicalSettledCents: BigInt(100_000),
          historicalApprovalPendingPaymentCents: BigInt(0),
          historicalApprovedPendingPaymentCents: BigInt(0),
          historicalPaidCents: BigInt(40_000),
          historicalProxyPaidCents: BigInt(0),
          historicalAdvancePaidCents: BigInt(0),
          historicalAdvanceDeductedCents: BigInt(0),
          otherConfirmedOccupancyCents: BigInt(0)
        })
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: BigInt(1_000_000)
          }
        ])
      },
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-due-history",
          code: "FK-HT-HIS-ALLOC-001",
          settlementId: null,
          sourceType: "contract_due",
          status: "approved_pending_payment",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-due-history",
          status: "paid",
          paidAmountCents: 50_000n
        }),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n
        })
      },
      settlement: {
        findMany: jest.fn((args: { select?: Record<string, boolean> }) =>
          Promise.resolve([
            Object.fromEntries(
              Object.entries(historicalSettlement).filter(
                ([key]) => !args.select || args.select[key] === true
              )
            )
          ])
        ),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            name: "历史结算款",
            paymentTermsVersionId: "terms-v1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 10000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: null,
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-history",
          paymentRequestId: "payment-due-history",
          amountCents: 50_000n,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([])
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    const execution = await paymentService.recordExecution("FK-HT-HIS-ALLOC-001", "cashier-1", {
        ...paymentExecutionCoordinates,
      amountCents: "50000",
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(execution.id).toBe("execution-history");
    expect(tx.paymentExecutionAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentExecutionId: "execution-history",
          paymentRequestId: "payment-due-history",
          contractId: "contract-1",
          contractVersionId: "contract-version-1",
          settlementId: "settlement-history",
          allocationType: "contract_due_payment",
          sourceRowId: "settlement-history:progress:0",
          paymentTermsVersionId: "terms-v1",
          stageName: "历史结算款",
          sourceEffectiveAt: confirmedAt,
          expectedPayableAt: confirmedAt,
          sourcePayableAmountCents: 100_000n,
          amountCents: 50_000n
        })
      ]
    });
  });

  it("keeps contract-level execution allocations away from active settlement payment reservations", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-due-2",
            code: "FK-HT-2026-002",
            settlementId: null,
            sourceType: "contract_due",
            requestedAmountCents: 30_000n,
            approvedAmountCents: 30_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }, { id: "settlement-2" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-due-2",
          projectId: "project-1"
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-due-2",
          status: "paid",
          paidAmountCents: 30_000n
        }),
        findMany: jest.fn((args: { where?: { sourceType?: string } }) => {
          if (args.where?.sourceType === "settlement") {
            return Promise.resolve([
              {
                settlementId: "settlement-1",
                status: "approved_pending_payment",
                requestedAmountCents: 50_000n,
                approvedAmountCents: 50_000n,
                paidAmountCents: 0n
              }
            ]);
          }

          return Promise.resolve([]);
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 30_000n,
          approvedAmountCents: 30_000n,
          paidAmountCents: 30_000n
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000n,
            paidAmountCents: 0n,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          },
          {
            id: "settlement-2",
            status: "effective",
            amountCents: 80_000n,
            paidAmountCents: 0n,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          }
        ]),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            name: "进度款",
            paymentTermsVersionId: "terms-v1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 5000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: null,
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-1", confirmedAt: new Date("2026-07-01T00:00:00.000Z") },
          { settlementId: "settlement-2", confirmedAt: new Date("2026-07-02T00:00:00.000Z") }
        ])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-due-2",
          paymentRequestId: "payment-due-2",
          amountCents: 30_000n,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await paymentService.recordExecution("FK-HT-2026-002", "cashier-1", {
        ...paymentExecutionCoordinates,
      amountCents: "30000",
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.paymentExecutionAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          settlementId: "settlement-2",
          sourceRowId: "settlement-2:progress:0",
          allocationType: "contract_due_payment",
          amountCents: 30_000n
        })
      ]
    });
  });

  it("persists advance deduction ledger rows before contract-level execution allocations", async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          paymentExecutionRow({
            id: "payment-due-3",
            code: "FK-HT-2026-003",
            settlementId: null,
            sourceType: "contract_due",
            requestedAmountCents: 30_000n,
            approvedAmountCents: 30_000n,
            paidAmountCents: 0n
          })
        ])
        .mockResolvedValueOnce([{ id: "contract-1" }])
        .mockResolvedValueOnce([{ id: "settlement-1" }]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-due-3",
          projectId: "project-1"
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-due-3",
          status: "paid",
          paidAmountCents: 30_000n
        }),
        findMany: jest.fn((args: { where?: { sourceType?: string } }) => {
          if (args.where?.sourceType === "contract_advance") {
            return Promise.resolve([
              {
                paymentTermsVersionId: "terms-v1",
                status: "paid",
                requestedAmountCents: 50_000n,
                approvedAmountCents: 50_000n,
                paidAmountCents: 50_000n
              }
            ]);
          }

          return Promise.resolve([]);
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 30_000n,
          approvedAmountCents: 30_000n,
          paidAmountCents: 30_000n
        })
      },
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000n,
            paidAmountCents: 0n,
            contractVersionId: "contract-version-1",
            paymentTermsVersionId: "terms-v1",
            isFinal: false
          }
        ]),
        findUnique: jest.fn(),
        update: jest.fn()
      },
      contractVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-version-1",
            amountCents: 1_000_000n
          }
        ])
      },
      paymentTermsStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-progress",
            name: "进度款",
            paymentTermsVersionId: "terms-v1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0,
            advanceDeductionMode: null,
            advanceDeductionRatioBps: null,
            advanceDeductionStartRatioBps: null
          },
          {
            id: "stage-advance",
            name: "预付款",
            paymentTermsVersionId: "terms-v1",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0,
            advanceDeductionMode: "per_settlement_ratio",
            advanceDeductionRatioBps: 2000,
            advanceDeductionStartRatioBps: null
          }
        ])
      },
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-1", confirmedAt: new Date("2026-07-01T00:00:00.000Z") }
        ])
      },
      paymentExecutionAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({
          id: "execution-due-3",
          paymentRequestId: "payment-due-3",
          amountCents: 30_000n,
          voucherFileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await paymentService.recordExecution("FK-HT-2026-003", "cashier-1", {
        ...paymentExecutionCoordinates,
      amountCents: "30000",
      paidAt: "2026-07-03T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.paymentExecutionAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          allocationType: "advance_deduction",
          sourceRowId: "settlement-1:progress:0",
          amountCents: 20_000n,
          allocationOrder: 0
        }),
        expect.objectContaining({
          allocationType: "contract_due_payment",
          sourceRowId: "settlement-1:progress:0",
          amountCents: 30_000n,
          allocationOrder: 1
        })
      ]
    });
  });

  it("records partial actual payment execution without completing payment", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          paidAmountCents: 10_000n
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000n,
          paidAmountCents: 10_000n
        }),
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          status: "partially_paid",
          paidAmountCents: 30_000n
        }),
        findUnique: jest.fn().mockResolvedValue({
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 30_000n
        })
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 10_000n
        }),
        update: jest.fn()
      },
      paymentExecution: {
        create: jest.fn().mockResolvedValue({ id: "execution-1" })
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
      amountCents: "20000",
      paidAt: "2026-06-22T00:00:00.000Z",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: {
        paidAmountCents: 30_000n,
        status: "partially_paid"
      }
    });
    expect(tx.settlement.update).toHaveBeenCalledWith({
      where: { id: "settlement-1" },
      data: {
        paidAmountCents: 30_000n,
        status: "partially_paid"
      }
    });
  });

  it("rejects actual payment execution before payment approval passes", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          status: "approval_pending",
          approvedAmountCents: null,
          paidAmountCents: 0n
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approval_pending",
          approvedAmountCents: null,
          paidAmountCents: 0n
        }),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "20000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("当前付款申请还未批准，不能登记实付；请先完成付款审批");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution when payment request cannot be found", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-MISSING", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "20000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("未找到付款申请，请刷新付款台账后重试");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution with a future paid date", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "20000",
        paidAt: "2999-07-04T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("实付日期不能晚于当前时间");

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution with an invalid paid date", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "20000",
        paidAt: "not-a-date",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("实付日期格式不正确，请重新选择实付日期");

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution above approved remaining amount", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          approvedAmountCents: 50_000n,
          paidAmountCents: 20_000n
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          approvedAmountCents: 50_000n,
          paidAmountCents: 20_000n
        }),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "30001",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("实付金额超过付款申请剩余可实付金额，当前最多可实付 300.00 元");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution when proxy payments consumed settlement capacity after approval", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          requestedAmountCents: 80_000n,
          approvedAmountCents: 80_000n,
          paidAmountCents: 0n
        })
      ]),
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          approvedAmountCents: 80_000n,
          requestedAmountCents: 80_000n,
          paidAmountCents: 0n
        }),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue({
          id: "settlement-1",
          status: "effective",
          payableAmountCents: 100_000n,
          paidAmountCents: 0n
        })
      },
      projectProxyPayment: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: BigInt(80_000) }])
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "80000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("实付金额超过结算剩余可付金额，当前最多可实付 200.00 元");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution when linked settlement cannot be found", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        paymentExecutionRow({
          requestedAmountCents: 80_000n,
          approvedAmountCents: 80_000n,
          paidAmountCents: 0n
        })
      ]),
      paymentRequest: {
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "80000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("未找到关联结算，请先核对结算归档记录");
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution without positive amount and voucher file", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "0",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "",
        confirmationPassword: ""
      })
    ).rejects.toThrow("实付金额必须大于 0");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution when payment record service is unavailable", async () => {
    const paymentService = paymentExecutionService(new PaymentAmountService());

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "10000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("付款实付登记服务暂不可用，请稍后重试或联系管理员");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution without voucher file", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      settlement: {
        findUnique: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "10000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("登记实付必须上传付款凭证");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution with missing runtime fields", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: undefined as never,
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("实付金额必须大于 0");
    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "10000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: undefined as never,
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("登记实付必须上传付款凭证");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution without second confirmation password", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "10000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: ""
      })
    ).rejects.toThrow("登记实付需要当前登录密码确认");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution when confirmation service is unavailable", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    const paymentService = paymentExecutionService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "10000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "current-password"
      })
    ).rejects.toThrow("登记实付确认服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("rejects actual payment execution when second confirmation fails", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn()
      },
      paymentExecution: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(paymentExecutionGuardTx(tx)))
    };
    auth.confirmPassword.mockRejectedValue(new Error("当前密码不正确，请重新输入"));
    const paymentService = paymentExecutionService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordExecution("FK-2026-012", "cashier-1", {
        ...paymentExecutionCoordinates,
        amountCents: "10000",
        paidAt: "2026-06-22T00:00:00.000Z",
        voucherFileId: "file-1",
        confirmationPassword: "wrong-password"
      })
    ).rejects.toThrow("当前密码不正确，请重新输入");
    expect(tx.paymentRequest.findFirst).not.toHaveBeenCalled();
    expect(tx.paymentExecution.create).not.toHaveBeenCalled();
  });

  it("records finance outflow after actual payment execution", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          status: "paid",
          paidAmountCents: 50_000n
        }
      ]),
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 20_000n }
        ]),
        create: jest.fn().mockResolvedValue({
          id: "finance-record-1",
          direction: "outflow",
          amountCents: 30_000n
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    const record = await paymentService.recordFinance("FK-2026-012", "finance-1", {
      amountCents: "30000",
      occurredAt: "2026-06-22T00:00:00.000Z",
      confirmationPassword: "Current@123"
    });

    expect(record.id).toBe("finance-record-1");
    expect(record.amountCents).toBe("30000");
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-1", "Current@123");
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.financeRecord.create).toHaveBeenCalledWith({
      data: {
        projectId: "project-1",
        paymentRequestId: "payment-1",
        settlementId: "settlement-1",
        direction: "outflow",
        amountCents: 30_000n,
        occurredAt: new Date("2026-06-22T00:00:00.000Z"),
        createdByUserId: "finance-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "finance-1",
        action: "payment.finance.record",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects finance record without current password confirmation", async () => {
    const tx = {
      $queryRaw: jest.fn(),
      financeRecord: {
        findMany: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordFinance("FK-2026-012", "finance-1", {
        amountCents: "10000",
        occurredAt: "2026-06-22T00:00:00.000Z"
      } as never)
    ).rejects.toThrow("财务入账需要当前登录密码确认");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });

  it("rejects finance record when finance record service is unavailable", async () => {
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      undefined,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordFinance("FK-2026-012", "finance-1", {
        amountCents: "10000",
        occurredAt: "2026-06-22T00:00:00.000Z",
        confirmationPassword: "Current@123"
      })
    ).rejects.toThrow("财务入账记录服务暂不可用，请稍后重试或联系管理员");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("rejects finance record when confirmation service is unavailable", async () => {
    const tx = {
      $queryRaw: jest.fn(),
      financeRecord: {
        findMany: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordFinance("FK-2026-012", "finance-1", {
        amountCents: "10000",
        occurredAt: "2026-06-22T00:00:00.000Z",
        confirmationPassword: "Current@123"
      })
    ).rejects.toThrow("财务入账确认服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });

  it("rejects finance record without positive amount", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordFinance("FK-2026-012", "finance-1", {
        amountCents: "0",
        occurredAt: "2026-06-22T00:00:00.000Z",
        confirmationPassword: "Current@123"
      })
    ).rejects.toThrow("财务入账金额必须大于 0");
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects finance record when payment request cannot be found", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      financeRecord: {
        findMany: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordFinance("FK-2026-012", "finance-1", {
        amountCents: "10000",
        occurredAt: "2026-06-22T00:00:00.000Z",
        confirmationPassword: "Current@123"
      })
    ).rejects.toThrow("未找到付款申请，请刷新付款台账后重试");
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });

  it("rejects finance record before actual payment execution", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "payment-1",
          status: "approved_pending_payment",
          paidAmountCents: 0n
        }
      ]),
      financeRecord: {
        findMany: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordFinance("FK-2026-012", "finance-1", {
        amountCents: "10000",
        occurredAt: "2026-06-22T00:00:00.000Z",
        confirmationPassword: "Current@123"
      })
    ).rejects.toThrow("付款尚未登记实付，不能做财务入账");
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });

  it("rejects finance record above unrecorded paid amount", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "payment-1",
          projectId: "project-1",
          settlementId: "settlement-1",
          status: "partially_paid",
          paidAmountCents: 50_000n
        }
      ]),
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 40_000n }
        ]),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      undefined,
      auth as never
    );

    await expect(
      paymentService.recordFinance("FK-2026-012", "finance-1", {
        amountCents: "10001",
        occurredAt: "2026-06-22T00:00:00.000Z",
        confirmationPassword: "Current@123"
      })
    ).rejects.toThrow("财务入账金额超过未入账实付金额，当前最多可入账 100.00 元");
    expect(tx.financeRecord.create).not.toHaveBeenCalled();
  });

  it("records payment pdf document and archive after finance entry is complete", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          paidAmountCents: 50_000n
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 50_000n }
        ])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "pdf-1",
          fileId: "file-1"
        })
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({
          id: "archive-1",
          fileId: "file-1"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
      fileId: "file-1"
    });

    expect(result.pdfDocument.id).toBe("pdf-1");
    expect(result.archiveRecord.id).toBe("archive-1");
    expect(tx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "payment_request",
        businessId: "payment-1",
        fileId: "file-1",
        templateKey: "payment_finance_archive"
      }
    });
    expect(tx.archiveRecord.create).toHaveBeenCalledWith({
      data: {
        businessType: "payment_request",
        businessId: "payment-1",
        fileId: "file-1",
        departmentScope: "finance"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "finance-1",
        action: "payment.pdf_archive.record",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("rejects payment pdf archive when archive service is unavailable", async () => {
    const paymentService = new PaymentRequestService(new PaymentAmountService());

    await expect(
      paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
        fileId: "file-1"
      })
    ).rejects.toThrow("付款 PDF 归档服务暂不可用，请稍后重试或联系管理员");
  });

  it("generates a payment PDF file and records its archive", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          requestedAmountCents: 60_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 50_000n }])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-generated" })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "pdf-1",
          fileId: "file-generated"
        })
      },
      archiveRecord: {
        create: jest.fn().mockResolvedValue({
          id: "archive-1",
          fileId: "file-generated"
        })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "file-generated" })
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      files as never
    );

    const result = await paymentService.generatePdfArchive("FK-2026-012", "finance-1");

    expect(result.pdfDocument.id).toBe("pdf-1");
    expect(files.uploadPrivateFile).toHaveBeenCalledWith({
      originalName: "FK-2026-012-payment_finance_archive.pdf",
      mimeType: "application/pdf",
      sizeBytes: expect.any(Number),
      uploadedByUserId: "finance-1",
      buffer: expect.any(Buffer)
    });
    const uploadedBuffer = files.uploadPrivateFile.mock.calls[0][0].buffer as Buffer;
    const pdfText = uploadedBuffer.toString("ascii");
    expect(pdfText.slice(0, 8)).toBe("%PDF-1.4");
    expect(pdfText).toContain(pdfHexText("付款财务归档单"));
    expect(pdfText).toContain(pdfHexText("财务入账金额：500.00 元"));
    expect(pdfText).not.toContain("Payment Finance Archive");
    expect(pdfText).not.toContain("Finance Recorded Amount");
    expect(tx.pdfDocument.create).toHaveBeenCalledWith({
      data: {
        businessType: "payment_request",
        businessId: "payment-1",
        fileId: "file-generated",
        templateKey: "payment_finance_archive"
      }
    });
  });

  it("rejects payment PDF generation when file service is unavailable", async () => {
    const prisma = {
      $transaction: jest.fn()
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never
    );

    await expect(
      paymentService.generatePdfArchive("FK-2026-012", "finance-1")
    ).rejects.toThrow("付款 PDF 归档文件服务暂不可用，请稍后重试或联系管理员");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects payment PDF generation when archive generation service is unavailable", async () => {
    const paymentService = new PaymentRequestService(new PaymentAmountService());

    await expect(
      paymentService.generatePdfArchive("FK-2026-012", "finance-1")
    ).rejects.toThrow("付款 PDF 生成服务暂不可用，请稍后重试或联系管理员");
  });

  it("rejects payment PDF generation when the PDF archive already exists", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          requestedAmountCents: 60_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 50_000n }])
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "pdf-existing" })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn()
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      files as never
    );

    await expect(
      paymentService.generatePdfArchive("FK-2026-012", "finance-1")
    ).rejects.toThrow("付款 PDF 已归档，不能重复归档");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("rejects payment PDF generation when payment request cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn()
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      files as never
    );

    await expect(
      paymentService.generatePdfArchive("FK-2026-012", "finance-1")
    ).rejects.toThrow("未找到付款申请，请刷新付款台账后重试");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("rejects payment PDF generation before finance entry covers paid amount", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          paidAmountCents: 50_000n
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([{ amountCents: 20_000n }])
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const files = {
      uploadPrivateFile: jest.fn()
    };
    const paymentService = new PaymentRequestService(
      new PaymentAmountService(),
      prisma as never,
      undefined,
      files as never
    );

    await expect(
      paymentService.generatePdfArchive("FK-2026-012", "finance-1")
    ).rejects.toThrow("财务入账尚未覆盖全部实付金额，不能生成付款 PDF");
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });

  it("rejects payment pdf archive before finance entry covers paid amount", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          paidAmountCents: 50_000n
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 20_000n }
        ])
      },
      fileObject: {
        findUnique: jest.fn()
      },
      pdfDocument: {
        create: jest.fn()
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
        fileId: "file-1"
      })
    ).rejects.toThrow("财务入账尚未覆盖全部实付金额，不能归档付款 PDF");
    expect(tx.pdfDocument.create).not.toHaveBeenCalled();
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
  });

  it("rejects payment pdf archive when payment request cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: {
        create: jest.fn()
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
        fileId: "file-1"
      })
    ).rejects.toThrow("未找到付款申请，请刷新付款台账后重试");
    expect(tx.pdfDocument.create).not.toHaveBeenCalled();
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
  });

  it("rejects payment pdf archive when archive file is missing", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          paidAmountCents: 50_000n
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 50_000n }
        ])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      pdfDocument: {
        create: jest.fn()
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
        fileId: "missing-file"
      })
    ).rejects.toThrow("未找到付款归档文件，请重新上传后再归档");
    expect(tx.pdfDocument.create).not.toHaveBeenCalled();
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate payment pdf archive for the same template", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          paidAmountCents: 50_000n
        })
      },
      financeRecord: {
        findMany: jest.fn().mockResolvedValue([
          { amountCents: 50_000n }
        ])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1"
        })
      },
      pdfDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "pdf-existing"
        }),
        create: jest.fn()
      },
      archiveRecord: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.recordPdfArchive("FK-2026-012", "finance-1", {
        fileId: "file-1"
      })
    ).rejects.toThrow("付款 PDF 已归档，不能重复归档");
    expect(tx.pdfDocument.create).not.toHaveBeenCalled();
    expect(tx.archiveRecord.create).not.toHaveBeenCalled();
  });

  it("lets the applicant remind an overdue in-progress payment approval", async () => {
    const lastActivityAt = new Date("2026-06-23T00:00:00.000Z");
    const now = new Date("2026-06-25T00:00:00.000Z"); // +48h, hits the default SLA
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: lastActivityAt,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "action-log-1", action: "remind" })
      },
      auditLog: {
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.remindApproval("FK-2026-012", "applicant-1", now);

    expect(result.action).toBe("remind");
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "remind",
        actorUserId: "applicant-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "applicant-1",
        action: "payment.approval.remind",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("付款审批催办服务不可用时给出中文业务提示", async () => {
    const paymentService = new PaymentRequestService(new PaymentAmountService());

    await expect(
      paymentService.remindApproval("FK-2026-012", "applicant-1", new Date("2026-06-25T01:00:00.000Z"))
    ).rejects.toThrow("付款审批催办服务暂不可用，请稍后重试或联系管理员");
  });

  it("rejects a payment approval reminder before the SLA has elapsed", async () => {
    const lastActivityAt = new Date("2026-06-23T00:00:00.000Z");
    const now = new Date("2026-06-24T00:00:00.000Z"); // +24h, under the default 48h SLA
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: lastActivityAt,
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.remindApproval("FK-2026-012", "applicant-1", now)
    ).rejects.toThrow("当前付款审批还未达到催办时间，请稍后再试");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("rejects a payment approval reminder from a non-applicant", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress",
          currentNodeIndex: 0,
          updatedAt: new Date("2026-06-23T00:00:00.000Z"),
          frozenNodes: [
            { name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }
          ]
        })
      },
      approvalActionLog: {
        findFirst: jest.fn(),
        create: jest.fn()
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.remindApproval(
        "FK-2026-012",
        "intruder-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("只有付款申请人可以催办审批");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("rejects a payment approval reminder when payment request cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.remindApproval(
        "FK-2026-012",
        "applicant-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("未找到付款申请，请刷新付款台账后重试");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("rejects a payment approval reminder after payment leaves approval", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment"
        })
      },
      approvalInstance: {
        findFirst: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.remindApproval(
        "FK-2026-012",
        "applicant-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("当前付款申请已离开审批中，不能催办");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("rejects a payment approval reminder when approval instance cannot be found", async () => {
    const tx = {
      paymentRequest: {
        findFirst: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      approvalActionLog: {
        create: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.remindApproval(
        "FK-2026-012",
        "applicant-1",
        new Date("2026-06-25T00:00:00.000Z")
      )
    ).rejects.toThrow("未找到进行中的付款审批，请刷新后重试");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("lets the payment approval applicant withdraw before approval completes", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        }
      ]),
      paymentRequest: {
        update: jest.fn().mockResolvedValue({
          id: "payment-1",
          code: "FK-2026-012",
          status: "withdrawn"
        })
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress"
        }),
        update: jest.fn()
      },
      approvalActionLog: {
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      ...financingUsageUpdates()
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    const result = await paymentService.withdrawApproval("FK-2026-012", "applicant-1");

    expect(result.status).toBe("withdrawn");
    expect(tx.paymentRequest.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-instance-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "withdraw",
        actorUserId: "applicant-1"
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "applicant-1",
        action: "payment.approval.withdraw",
        businessType: "payment_request",
        businessId: "payment-1"
      })
    });
  });

  it("付款审批撤回服务不可用时给出中文业务提示", async () => {
    const paymentService = new PaymentRequestService(new PaymentAmountService());

    await expect(
      paymentService.withdrawApproval("FK-2026-012", "applicant-1")
    ).rejects.toThrow("付款审批撤回服务暂不可用，请稍后重试或联系管理员");
  });

  it("rejects payment approval withdrawal from a non-applicant", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        }
      ]),
      paymentRequest: {
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({
          id: "approval-instance-1",
          applicantUserId: "applicant-1",
          status: "in_progress"
        }),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.withdrawApproval("FK-2026-012", "other-user")
    ).rejects.toThrow("只有付款申请人可以撤回审批");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("rejects payment approval withdrawal when payment request cannot be found", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentRequest: {
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn(),
        update: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.withdrawApproval("FK-2026-012", "applicant-1")
    ).rejects.toThrow("未找到付款申请，请刷新付款台账后重试");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });

  it("rejects payment approval withdrawal when approval instance cannot be found", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "payment-1",
          code: "FK-2026-012",
          status: "approval_pending"
        }
      ]),
      paymentRequest: {
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn()
      }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.withdrawApproval("FK-2026-012", "applicant-1")
    ).rejects.toThrow("未找到进行中的付款审批，请刷新后重试");
    expect(tx.paymentRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("rejects payment approval withdrawal once it has left approval_pending", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "payment-1",
          code: "FK-2026-012",
          status: "approved_pending_payment"
        }
      ]),
      paymentRequest: {
        update: jest.fn()
      },
      approvalInstance: {
        findFirst: jest.fn(),
        update: jest.fn()
      },
      approvalActionLog: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(
      paymentService.withdrawApproval("FK-2026-012", "applicant-1")
    ).rejects.toThrow("当前付款申请已离开审批中，不能撤回");
    expect(tx.approvalInstance.findFirst).not.toHaveBeenCalled();
  });

  function returnedPaymentAbandonmentFixture(overrides: {
    paymentStatus?: string;
    actorUserId?: string;
    latestApprovalStatus?: string;
    returnAction?: object | null;
    executionCount?: number;
    allocationCount?: number;
    financeRecordCount?: number;
    pdfArchiveCount?: number;
    archiveCount?: number;
    usages?: Array<{ id: string; quotaId: string; projectId: string; amountCents: bigint; status: string }>;
    updateCount?: number;
  } = {}) {
    const updatedAt = new Date("2026-07-19T10:00:00.000Z");
    const payment = {
      ...paymentExecutionRow({ status: overrides.paymentStatus ?? "draft" }),
      updatedAt,
      abandonedAt: overrides.paymentStatus === "abandoned" ? updatedAt : null,
      abandonedByUserId: overrides.paymentStatus === "abandoned" ? "applicant-1" : null,
      abandonReason: overrides.paymentStatus === "abandoned" ? "已放弃" : null
    };
    const usages = overrides.usages ?? [];
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([payment])
        .mockResolvedValueOnce([{
          id: "approval-instance-1",
          status: overrides.latestApprovalStatus ?? "returned_to_applicant",
          applicantUserId: overrides.actorUserId ?? "applicant-1"
        }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
      paymentRequest: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(payment)
          .mockResolvedValueOnce({ ...payment, status: "abandoned", abandonReason: "资料无法补齐" }),
        updateMany: jest.fn().mockResolvedValue({ count: overrides.updateCount ?? 1 })
      },
      approvalActionLog: {
        findFirst: jest.fn().mockResolvedValue(
          overrides.returnAction === undefined ? { id: "return-action-1" } : overrides.returnAction
        ),
        create: jest.fn()
      },
      paymentExecution: { count: jest.fn().mockResolvedValue(overrides.executionCount ?? 0) },
      paymentExecutionAllocation: { count: jest.fn().mockResolvedValue(overrides.allocationCount ?? 0) },
      financeRecord: { count: jest.fn().mockResolvedValue(overrides.financeRecordCount ?? 0) },
      pdfDocument: { count: jest.fn().mockResolvedValue(overrides.pdfArchiveCount ?? 0) },
      archiveRecord: { count: jest.fn().mockResolvedValue(overrides.archiveCount ?? 0) },
      projectFinancingQuotaUsage: {
        findMany: jest.fn().mockResolvedValue(usages),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({})
      },
      auditLog: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    return {
      tx,
      service: new PaymentRequestService(new PaymentAmountService(), prisma as never),
      input: { expectedUpdatedAt: updatedAt.toISOString(), reason: "资料无法补齐" }
    };
  }

  it("abandons only the latest returned payment approval and keeps the approval instance history", async () => {
    const { tx, service: paymentService, input } = returnedPaymentAbandonmentFixture();

    const result = await paymentService.abandonReturnedRequest("payment-1", "applicant-1", input);

    expect(result).toMatchObject({ status: "abandoned", abandonReason: "资料无法补齐" });
    expect(tx.paymentRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "payment-1",
        status: "draft",
        updatedAt: new Date(input.expectedUpdatedAt),
        abandonedAt: null
      },
      data: expect.objectContaining({
        status: "abandoned",
        abandonedByUserId: "applicant-1",
        abandonReason: "资料无法补齐"
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-instance-1",
        action: "abandon_application",
        actorUserId: "applicant-1",
        comment: "资料无法补齐"
      }
    });
    expect(tx.projectFinancingQuotaUsage.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "payment.request.abandon" })
    });
  });

  it("releases an abnormal residual occupied financing usage exactly once", async () => {
    const usage = {
      id: "usage-1",
      quotaId: "quota-1",
      projectId: "project-1",
      amountCents: 12_000n,
      status: "occupied"
    };
    const { tx, service: paymentService, input } = returnedPaymentAbandonmentFixture({ usages: [usage] });

    await paymentService.abandonReturnedRequest("payment-1", "applicant-1", input);

    expect(tx.projectFinancingQuotaUsage.update).toHaveBeenCalledTimes(1);
    expect(tx.projectFinancingQuotaUsage.update).toHaveBeenCalledWith({
      where: { id: "usage-1" },
      data: { status: "released" }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "payment.financing_quota.release.abandonment" })
    });
  });

  it("is idempotent after payment abandonment without releasing quota or writing history again", async () => {
    const { tx, service: paymentService, input } = returnedPaymentAbandonmentFixture({
      paymentStatus: "abandoned"
    });

    const result = await paymentService.abandonReturnedRequest("payment-1", "applicant-1", input);

    expect(result.status).toBe("abandoned");
    expect(tx.paymentRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.projectFinancingQuotaUsage.findMany).not.toHaveBeenCalled();
  });

  it("does not expose an idempotent abandonment result to another user", async () => {
    const { tx, service: paymentService, input } = returnedPaymentAbandonmentFixture({
      paymentStatus: "abandoned"
    });

    await expect(
      paymentService.abandonReturnedRequest("payment-1", "other-user", input)
    ).rejects.toThrow("只有当前付款申请人可以查看放弃结果");
    expect(tx.paymentRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it.each([
    "approved_pending_payment",
    "partially_paid",
    "paid",
    "approval_rejected",
    "rejected",
    "withdrawn"
  ])(
    "rejects abandonment from terminal or formal payment status %s",
    async (paymentStatus) => {
      const { tx, service: paymentService, input } = returnedPaymentAbandonmentFixture({ paymentStatus });

      await expect(
        paymentService.abandonReturnedRequest("payment-1", "applicant-1", input)
      ).rejects.toThrow("当前付款申请不是退回待修改状态，不能放弃申请");
      expect(tx.paymentRequest.updateMany).not.toHaveBeenCalled();
    }
  );

  it("rejects payment abandonment by anyone except the latest approval applicant", async () => {
    const { tx, service: paymentService, input } = returnedPaymentAbandonmentFixture({
      actorUserId: "applicant-1"
    });

    await expect(
      paymentService.abandonReturnedRequest("payment-1", "other-user", input)
    ).rejects.toThrow("只有当前付款申请人可以放弃申请");
    expect(tx.paymentRequest.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["实际付款或付款凭证", { executionCount: 1 }],
    ["实付分摊记录", { allocationCount: 1 }],
    ["财务入账记录", { financeRecordCount: 1 }],
    ["PDF 归档", { pdfArchiveCount: 1 }],
    ["业务归档记录", { archiveCount: 1 }]
  ] as const)("blocks abandonment when the payment has %s", async (message, blocker) => {
    const { tx, service: paymentService, input } = returnedPaymentAbandonmentFixture(blocker);

    await expect(
      paymentService.abandonReturnedRequest("payment-1", "applicant-1", input)
    ).rejects.toThrow(message);
    expect(tx.paymentRequest.updateMany).not.toHaveBeenCalled();
  });

  it("blocks abandonment when financing quota has already become used", async () => {
    const { tx, service: paymentService, input } = returnedPaymentAbandonmentFixture({
      usages: [{
        id: "usage-used",
        quotaId: "quota-1",
        projectId: "project-1",
        amountCents: 1_000n,
        status: "used"
      }]
    });

    await expect(
      paymentService.abandonReturnedRequest("payment-1", "applicant-1", input)
    ).rejects.toThrow("付款申请已有融资额度转为实付使用，不能放弃申请");
    expect(tx.paymentRequest.updateMany).not.toHaveBeenCalled();
  });

  it("uses expectedUpdatedAt as a CAS guard", async () => {
    const { tx, service: paymentService, input } = returnedPaymentAbandonmentFixture();

    await expect(
      paymentService.abandonReturnedRequest("payment-1", "applicant-1", {
        ...input,
        expectedUpdatedAt: "2026-07-19T10:00:01.000Z"
      })
    ).rejects.toThrow("付款申请已被更新，请刷新后重试");
    expect(tx.paymentRequest.updateMany).not.toHaveBeenCalled();
  });

  it("blocks ordinary contract-due payment until the settlement mode is confirmed", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: 100_000n,
          effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
          settlementMode: null,
          settlementModeConfirmedAt: null
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "generic_contract"
        })
      },
      paymentTermsVersion: { findFirst: jest.fn() },
      paymentTermsStage: { findUnique: jest.fn() },
      paymentRequest: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(paymentService.create({
      sourceType: "contract_due",
      contractVersionId: "contract-version-1",
      paymentTermsStageId: "stage-1",
      code: "FK-HT-MODE-001",
      requestedAmountCents: "10000"
    } as never)).rejects.toThrow("合同结算方式尚未由合同部主管确认");

    expect(tx.paymentTermsVersion.findFirst).not.toHaveBeenCalled();
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects contract-due payment for a confirmed settlement-required contract", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "effective",
          amountCents: 100_000n,
          effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
          settlementMode: "settlement_required",
          settlementModeConfirmedAt: new Date("2026-07-27T00:00:00.000Z")
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          projectId: "project-1",
          contractTypeKey: "generic_contract"
        })
      },
      paymentTermsVersion: { findFirst: jest.fn() },
      paymentTermsStage: { findUnique: jest.fn() },
      paymentRequest: { create: jest.fn() }
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const paymentService = new PaymentRequestService(new PaymentAmountService(), prisma as never);

    await expect(paymentService.create({
      sourceType: "contract_due",
      contractVersionId: "contract-version-1",
      paymentTermsStageId: "stage-1",
      code: "FK-HT-MODE-002",
      requestedAmountCents: "10000"
    } as never)).rejects.toThrow("该合同已确认需要结算");

    expect(tx.paymentTermsVersion.findFirst).not.toHaveBeenCalled();
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("requires the latest returned approval instance and its return action", async () => {
    const noReturned = returnedPaymentAbandonmentFixture({ latestApprovalStatus: "rejected" });
    await expect(
      noReturned.service.abandonReturnedRequest("payment-1", "applicant-1", noReturned.input)
    ).rejects.toThrow("付款申请没有有效的退回待修改审批记录，不能放弃申请");

    const noAction = returnedPaymentAbandonmentFixture({ returnAction: null });
    await expect(
      noAction.service.abandonReturnedRequest("payment-1", "applicant-1", noAction.input)
    ).rejects.toThrow("付款申请缺少退回审批动作记录，不能放弃申请");
  });
});
