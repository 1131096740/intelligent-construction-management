import "reflect-metadata";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  RequestMethod
} from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { Prisma } from "@prisma/client";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { createApiValidationPipe } from "../validation/api-validation";
import { RecordSpotProcurementPaymentDto } from "./dto/record-spot-procurement-payment.dto";
import { ReviewSpotProcurementPaymentDto } from "./dto/review-spot-procurement-payment.dto";
import { UpdateSpotProcurementPaymentDraftDto } from "./dto/update-spot-procurement-payment-draft.dto";
import { SpotProcurementPaymentController } from "./spot-procurement-payment.controller";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";

const version = {
  id: "version-1",
  procurementId: "procurement-1",
  projectId: "project-1",
  procurementCode: "LXCG-001",
  currentVersionId: "version-1",
  rootStatus: "approved_in_progress",
  versionStatus: "approved",
  versionNo: 1,
  supplierPartyId: "party-1",
  supplierKey: "party:party-1",
  supplierNameSnapshot: "北京某某商贸",
  handlerUserId: "material-1",
  totalAmountCents: 10_000n
};

const draftPayment = {
  id: "payment-1",
  projectId: "project-1",
  procurementId: "procurement-1",
  procurementVersionId: "version-1",
  code: "LXCG-001-V1-P001",
  status: "draft",
  settlementAmountCents: 10_000n,
  supplierBalanceAmountCents: 0n,
  companyPaymentAmountCents: 10_000n,
  paidAmountCents: 0n,
  executedSupplierBalanceAmountCents: 0n,
  canceledAmountCents: 0n,
  canceledCompanyPaymentAmountCents: 0n,
  canceledSupplierBalanceAmountCents: 0n,
  paymentPath: null,
  paymentMethod: null,
  payeePartyId: "party-1",
  payeeUserId: null,
  payeeNameSnapshot: "北京某某商贸",
  payeeAccountNameSnapshot: null,
  payeeBankNameSnapshot: null,
  payeeBankAccountSnapshot: null,
  expectedPaymentAt: null,
  paymentNote: null,
  supportingAttachmentFileId: null,
  merchantPaymentProofFileId: null,
  balanceOverrideReason: null,
  handlerUserId: "material-1",
  createdByUserId: "manager-1",
  submittedAt: null,
  approvedAt: null,
  invalidatedAt: null,
  invalidatedByUserId: null,
  invalidatedReason: null
};

function transactionDelegate() {
  return {
    $queryRaw: jest.fn(),
    userPosition: { findMany: jest.fn() },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn() },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "material-1",
        name: "张三",
        isActive: true
      })
    },
    fileObject: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([
        {
          id: "file-support",
          storageStatus: "active",
          uploadedByUserId: "material-1"
        }
      ])
    },
    spotProcurementPayment: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn()
    },
    spotProcurementDiscrepancy: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    spotProcurement: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementRefund: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentExecution: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn()
    },
    projectReceipt: { findMany: jest.fn() },
    paymentRequest: { findMany: jest.fn() },
    projectExpenseRequest: { findMany: jest.fn() },
    approvalInstance: {
      create: jest.fn().mockResolvedValue({
        id: "approval-1",
        status: "approval_pending",
        currentNodeIndex: 0
      }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    approvalActionLog: { create: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
  };
}

const CANONICAL_GLOBAL_ROLES = new Set([
  "chairman",
  "general_manager",
  "engineering_department_director",
  "finance_staff",
  "finance_director",
  "contract_director",
  "budget_director",
  "material_director",
  "comprehensive_director"
]);

function roles(
  tx: ReturnType<typeof transactionDelegate>,
  input: {
    global?: string[];
    project?: string[];
    member?: string[];
  }
) {
  const global = input.global ?? [];
  const project = input.project ?? [];
  tx.userPosition.findMany
    .mockResolvedValueOnce(
      global.map((roleKey) => ({
        positionId: `position-global-${roleKey}`,
        projectId: null
      }))
    )
    .mockResolvedValueOnce(
      project.map((roleKey) => ({
        positionId: `position-project-${roleKey}`,
        projectId: "project-1"
      }))
    );
  tx.projectMember.findMany.mockResolvedValue(
    (input.member ?? []).map((positionKey) => ({ positionKey }))
  );
  tx.position.findMany.mockResolvedValue([
    ...global.map((key) => ({
      id: `position-global-${key}`,
      key
    })),
    ...project.map((key) => ({
      id: `position-project-${key}`,
      key
    }))
  ]);
}

function role(tx: ReturnType<typeof transactionDelegate>, roleKey: string) {
  roles(tx, {
    [CANONICAL_GLOBAL_ROLES.has(roleKey) ? "global" : "project"]: [
      roleKey
    ]
  });
}

function harness() {
  const tx = transactionDelegate();
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
    ),
    spotProcurementPaymentExecution: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null)
    },
    spotProcurementPayment: {
      findUnique: jest.fn()
    }
  };
  const audit = {
    record: jest.fn((client: typeof tx, input: object) =>
      client.auditLog.create({ data: input })
    )
  };
  const pilot = { assertEnabled: jest.fn() };
  const balance = {
    suggestion: jest.fn().mockResolvedValue({
      availableBalanceAmountCents: "0",
      suggestedBalanceAmountCents: "0"
    }),
    suggestionWithClient: jest.fn().mockResolvedValue({
      availableBalanceAmountCents: "0",
      suggestedBalanceAmountCents: "0"
    }),
    reserve: jest.fn().mockResolvedValue({
      reservationId: null,
      amountCents: 0n
    }),
    releaseReservation: jest.fn().mockResolvedValue({
      released: false,
      amountCents: 0n
    })
  };
  const auth = {
    confirmPassword: jest.fn().mockResolvedValue(undefined)
  };
  const files = {
    assertCanDownloadFileById: jest.fn().mockResolvedValue(undefined),
    assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({
      id: "file-voucher",
      uploadedByUserId: "finance-1",
      storageStatus: "active"
    }),
    assertCanDownloadFile: jest.fn().mockResolvedValue({
      id: "file-voucher",
      storageStatus: "active"
    })
  };
  const approvalForms = {
    tryRefreshLatestForBusiness: jest.fn().mockResolvedValue(undefined)
  };
  const closure = {
    recalculateAndClose: jest.fn().mockResolvedValue({ closed: false })
  };
  const service = Reflect.construct(SpotProcurementPaymentService, [
    prisma,
    audit,
    pilot,
    balance,
    auth,
    files,
    approvalForms,
    closure
  ]) as SpotProcurementPaymentService;
  return {
    service,
    prisma,
    tx,
    audit,
    pilot,
    balance,
    auth,
    files,
    approvalForms
  };
}

function chairmanSelfReviewHarness() {
  const current = harness();
  current.tx.$queryRaw
    .mockResolvedValueOnce([version])
    .mockResolvedValueOnce([
      {
        ...draftPayment,
        status: "approval_pending",
        submittedAt: new Date()
      }
    ])
    .mockResolvedValueOnce([
      {
        id: "approval-1",
        status: "approval_pending",
        currentNodeIndex: 0,
        applicantUserId: "leader-1",
        frozenNodes: [
          {
            name: "董事长或总经理审批",
            mode: "any",
            roleKeys: ["chairman", "general_manager"]
          }
        ]
      }
    ]);
  roles(current.tx, { global: ["chairman"] });
  return current;
}

function expectNoPaymentReviewWrites(
  current: ReturnType<typeof harness>
) {
  expect(current.balance.releaseReservation).not.toHaveBeenCalled();
  expect(current.tx.approvalActionLog.create).not.toHaveBeenCalled();
  expect(current.tx.approvalInstance.update).not.toHaveBeenCalled();
  expect(current.tx.spotProcurementPayment.update).not.toHaveBeenCalled();
  expect(current.tx.spotProcurementPayment.create).not.toHaveBeenCalled();
  expect(current.audit.record).not.toHaveBeenCalled();
}

function validDraftInput(): UpdateSpotProcurementPaymentDraftDto {
  return {
    settlementAmountCents: "8000",
    supplierBalanceAmountCents: "3000",
    companyPaymentAmountCents: "5000",
    paymentPath: "supplier_direct",
    paymentMethod: "bank_transfer",
    payeeAccountName: "北京某某商贸",
    payeeBankName: "中国建设银行",
    payeeBankAccount: "622200001",
    expectedPaymentAt: "2026-07-20T00:00:00.000Z",
    paymentNote: "第一期付款",
    supportingAttachmentFileId: "file-support"
  };
}

function completePayment(
  overrides: Record<string, unknown> = {}
) {
  return {
    ...draftPayment,
    paymentPath: "supplier_direct",
    paymentMethod: "bank_transfer",
    payeeAccountNameSnapshot: "北京某某商贸",
    payeeBankNameSnapshot: "中国建设银行",
    payeeBankAccountSnapshot: "622200001",
    expectedPaymentAt: new Date("2026-07-20T00:00:00.000Z"),
    paymentNote: "第一期付款",
    supportingAttachmentFileId: "file-support",
    ...overrides
  };
}

function approvedExecutionPayment(
  overrides: Record<string, unknown> = {}
) {
  return completePayment({
    status: "approved_pending_payment",
    submittedAt: new Date("2026-07-16T00:00:00.000Z"),
    approvedAt: new Date("2026-07-16T01:00:00.000Z"),
    ...overrides
  });
}

function validExecutionInput(
  overrides: Partial<RecordSpotProcurementPaymentDto> = {}
): RecordSpotProcurementPaymentDto {
  return {
    amountCents: "4000",
    paidAt: new Date(Date.now() - 60_000).toISOString(),
    paymentMethod: "bank_transfer",
    voucherFileId: "file-voucher",
    idempotencyKey: "spot-execution-key-1",
    confirmationPassword: "Current@123",
    ...overrides
  };
}

function executionHarness(
  options: {
    payment?: ReturnType<typeof approvedExecutionPayment>;
    receipts?: bigint[];
    activeExecutions?: Array<{ id: string; amountCents: bigint }>;
    projectRoles?: string[];
    globalRoles?: string[];
  } = {}
) {
  const current = harness();
  const payment =
    options.payment ?? approvedExecutionPayment();
  const activeExecutions = options.activeExecutions ?? [];
  current.tx.$queryRaw
    .mockResolvedValueOnce([version])
    .mockResolvedValueOnce([payment])
    .mockResolvedValueOnce([
      { id: "project-1", isActive: true }
    ])
    .mockResolvedValueOnce(activeExecutions);
  roles(current.tx, {
    project: options.projectRoles ?? ["finance_staff"],
    global: options.globalRoles ?? []
  });
  current.tx.fileObject.findUnique.mockResolvedValue({
    id: "file-voucher",
    storageStatus: "active",
    uploadedByUserId: "other-user"
  });
  current.tx.projectReceipt.findMany.mockResolvedValue(
    (options.receipts ?? [10_000n]).map((amountCents) => ({
      amountCents
    }))
  );
  current.tx.paymentRequest.findMany.mockResolvedValue([]);
  current.tx.projectExpenseRequest.findMany.mockResolvedValue([]);
  current.tx.spotProcurementPayment.findMany.mockResolvedValue([
    payment
  ]);
  current.tx.spotProcurementPaymentExecution.findUnique.mockResolvedValue(
    null
  );
  current.tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue(
    null
  );
  current.tx.spotProcurementPaymentExecution.create.mockResolvedValue({
    id: "execution-1",
    paymentId: payment.id,
    amountCents: 4_000n,
    paidAt: new Date(
      validExecutionInput().paidAt
    ),
    paymentMethod: "bank_transfer",
    executedByUserId: "finance-1",
    voucherFileId: "file-voucher",
    idempotencyKey: "spot-execution-key-1",
    voidedAt: null,
    voidedByUserId: null,
    voidReason: null,
    createdAt: new Date()
  });
  current.tx.spotProcurementPayment.updateMany.mockResolvedValue({
    count: 1
  });
  return { ...current, payment };
}

async function validationErrors(
  value: unknown,
  metatype:
    | typeof UpdateSpotProcurementPaymentDraftDto
    | typeof RecordSpotProcurementPaymentDto
    | typeof ReviewSpotProcurementPaymentDto
) {
  try {
    await createApiValidationPipe().transform(value, {
      type: "body",
      metatype
    });
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as {
      message: string;
      errors: string[];
    };
  }
  throw new Error("Expected validation to fail");
}

describe("SpotProcurementPaymentController", () => {
  it("exposes independent payment routes with exact project-role actions", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, SpotProcurementPaymentController)
    ).toBe("spot-procurement-payments");
    const expectations = [
      ["list", RequestMethod.GET, "/", undefined],
      ["detail", RequestMethod.GET, ":paymentId", undefined],
      [
        "updateDraft",
        RequestMethod.PATCH,
        ":paymentId/draft",
        "spot_procurement.payment.submit"
      ],
      [
        "submit",
        RequestMethod.POST,
        ":paymentId/submission",
        "spot_procurement.payment.submit"
      ],
      [
        "review",
        RequestMethod.POST,
        ":paymentId/approval",
        "spot_procurement.payment.approve"
      ],
      [
        "withdrawApproval",
        RequestMethod.POST,
        ":paymentId/approval-withdrawal",
        "spot_procurement.payment.submit"
      ],
      [
        "recordExecution",
        RequestMethod.POST,
        ":paymentId/executions",
        "spot_procurement.payment.execute"
      ],
      [
        "executeSupplierBalance",
        RequestMethod.POST,
        ":paymentId/balance-execution",
        "spot_procurement.balance.execute"
      ]
    ] as const;

    for (const [method, requestMethod, path, action] of expectations) {
      const target = SpotProcurementPaymentController.prototype[
        method
      ] as unknown as object;
      expect(Reflect.getMetadata(METHOD_METADATA, target)).toBe(requestMethod);
      expect(Reflect.getMetadata(PATH_METADATA, target)).toBe(path);
      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, target)).toBe(
        action
      );
    }
  });
});

describe("Spot procurement payment DTOs", () => {
  it("accepts canonical string cents and rejects unknown or numeric amount fields", async () => {
    const unknown = await validationErrors(
      { ...validDraftInput(), unknown: true },
      UpdateSpotProcurementPaymentDraftDto
    );
    const numeric = await validationErrors(
      { ...validDraftInput(), settlementAmountCents: 8000 },
      UpdateSpotProcurementPaymentDraftDto
    );

    expect(unknown.errors).toContain("unknown 不是允许提交的字段");
    expect(numeric.errors).toContain("本次结算金额格式不正确");
  });

  it("does not accept a client-authored balance override reason", async () => {
    const response = await validationErrors(
      { ...validDraftInput(), balanceOverrideReason: "本次不用余额" },
      UpdateSpotProcurementPaymentDraftDto
    );
    expect(response.errors).toContain(
      "balanceOverrideReason 不是允许提交的字段"
    );
  });

  it("limits payment review decisions and comment shape at runtime", async () => {
    const response = await validationErrors(
      { decision: "return_to_previous" },
      ReviewSpotProcurementPaymentDto
    );
    expect(response.errors).toContain("付款审批决定不正确");
  });

  it("validates the finance-return adjusted balance as canonical string cents", async () => {
    const numeric = await validationErrors(
      {
        decision: "return_to_applicant",
        comment: "本次减少余额抵扣",
        adjustedSupplierBalanceAmountCents: 1000
      },
      ReviewSpotProcurementPaymentDto
    );
    const negative = await validationErrors(
      {
        decision: "return_to_applicant",
        comment: "本次减少余额抵扣",
        adjustedSupplierBalanceAmountCents: "-1"
      },
      ReviewSpotProcurementPaymentDto
    );

    expect(numeric.errors).toContain("调整后的供应商余额抵扣金额格式不正确");
    expect(negative.errors).toContain(
      "调整后的供应商余额抵扣金额必须按分填写为 0 或更大的整数"
    );
  });

  it("accepts controlled self-review confirmation fields and enforces Unicode limits", async () => {
    const valid = await createApiValidationPipe().transform(
      {
        decision: "approve",
        selfReviewReason: "  项目紧急且由本人发起  ",
        confirmationPassword: "Current@123"
      },
      {
        type: "body",
        metatype: ReviewSpotProcurementPaymentDto
      }
    );
    expect(valid).toEqual(
      expect.objectContaining({
        selfReviewReason: "  项目紧急且由本人发起  ",
        confirmationPassword: "Current@123"
      })
    );

    const longReason = await validationErrors(
      {
        decision: "approve",
        selfReviewReason: "原".repeat(501)
      },
      ReviewSpotProcurementPaymentDto
    );
    const longPassword = await validationErrors(
      {
        decision: "approve",
        confirmationPassword: "密".repeat(257)
      },
      ReviewSpotProcurementPaymentDto
    );
    expect(longReason.errors).toContain("自审原因不能超过 500 个字符");
    expect(longPassword.errors).toContain("当前密码格式不正确");
  });

  it("validates actual payment facts as a strict canonical DTO", async () => {
    const paidAt = new Date(Date.now() - 1_000).toISOString();
    await expect(
      createApiValidationPipe().transform(
        {
          amountCents: "100",
          paidAt,
          paymentMethod: "cash",
          voucherFileId: "file-voucher",
          idempotencyKey: "spot-execution-1",
          confirmationPassword: "Current@123"
        },
        {
          type: "body",
          metatype: RecordSpotProcurementPaymentDto
        }
      )
    ).resolves.toEqual(
      expect.objectContaining({
        amountCents: "100",
        paymentMethod: "cash",
        idempotencyKey: "spot-execution-1"
      })
    );

    const unknown = await validationErrors(
      {
        amountCents: "100",
        paidAt,
        paymentMethod: "cash",
        voucherFileId: "file-voucher",
        idempotencyKey: "spot-execution-1",
        confirmationPassword: "Current@123",
        invoiceMode: "no_invoice"
      },
      RecordSpotProcurementPaymentDto
    );
    const numeric = await validationErrors(
      {
        amountCents: 100,
        paidAt,
        paymentMethod: "cash",
        voucherFileId: "file-voucher",
        idempotencyKey: "spot-execution-1",
        confirmationPassword: "Current@123"
      },
      RecordSpotProcurementPaymentDto
    );
    const badMethod = await validationErrors(
      {
        amountCents: "100",
        paidAt,
        paymentMethod: "invoice",
        voucherFileId: "file-voucher",
        idempotencyKey: "spot-execution-1",
        confirmationPassword: "Current@123"
      },
      RecordSpotProcurementPaymentDto
    );
    const longPassword = await validationErrors(
      {
        amountCents: "100",
        paidAt,
        paymentMethod: "cash",
        voucherFileId: "file-voucher",
        idempotencyKey: "spot-execution-1",
        confirmationPassword: "密".repeat(257)
      },
      RecordSpotProcurementPaymentDto
    );

    expect(unknown.errors).toContain("invoiceMode 不是允许提交的字段");
    expect(numeric.errors).toContain("实付金额格式不正确");
    expect(badMethod.errors).toContain("实际付款方式不正确");
    expect(longPassword.errors).toContain("当前密码不能超过 256 个字符");
  });
});

describe("SpotProcurementPaymentService", () => {
  it("creates a smaller subsequent draft for the frozen handler without occupying capacity", async () => {
    const { service, prisma, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approval_pending",
          settlementAmountCents: 6_000n,
          companyPaymentAmountCents: 6_000n
        }
    ]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "1500",
      suggestedBalanceAmountCents: "1500"
    });
    tx.spotProcurementPayment.create.mockResolvedValue({
      ...draftPayment,
      id: "payment-2",
      code: "LXCG-001-V1-P002",
      settlementAmountCents: 4_000n,
      supplierBalanceAmountCents: 1_500n,
      companyPaymentAmountCents: 2_500n
    });

    const result = await service.createNextDraft(
      "procurement-1",
      "material-1"
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: "payment-2",
        status: "draft",
        settlementAmountCents: "4000",
        supplierBalanceAmountCents: "1500",
        companyPaymentAmountCents: "2500",
        handlerUserId: "material-1"
      })
    );
    expect(tx.spotProcurementPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementAmountCents: 4_000n,
        supplierBalanceAmountCents: 1_500n,
        companyPaymentAmountCents: 2_500n,
        paymentNote: null,
        supportingAttachmentFileId: null
      })
    });
    expect(balance.reserve).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  });

  it("does not count other drafts when suggesting the next draft amount", async () => {
    const { service, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          settlementAmountCents: 10_000n,
          status: "draft"
        }
      ]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "0",
      suggestedBalanceAmountCents: "0"
    });
    tx.spotProcurementPayment.create.mockResolvedValue({
      ...draftPayment,
      id: "payment-2",
      code: "LXCG-001-V1-P002"
    });

    await service.createNextDraft("procurement-1", "material-1");

    expect(tx.spotProcurementPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementAmountCents: 10_000n,
        companyPaymentAmountCents: 10_000n
      })
    });
  });

  it("uses the confirmed actual cost as the remaining payment capacity after a shortage", async () => {
    const { service, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approved_pending_payment",
          settlementAmountCents: 6_000n,
          companyPaymentAmountCents: 6_000n
        }
      ]);
    tx.spotProcurementDiscrepancy.findFirst.mockResolvedValue({
      procurementVersionId: "version-1",
      status: "resolved",
      actualCostCentsSnapshot: 8_000n
    });
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "0",
      suggestedBalanceAmountCents: "0"
    });
    tx.spotProcurementPayment.create.mockResolvedValue({
      ...draftPayment,
      id: "payment-2",
      code: "LXCG-001-V1-P002",
      settlementAmountCents: 2_000n,
      companyPaymentAmountCents: 2_000n
    });

    await service.createNextDraft(
      "procurement-1",
      "material-1"
    );

    expect(tx.spotProcurementPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        settlementAmountCents: 2_000n,
        companyPaymentAmountCents: 2_000n
      })
    });
  });

  it("updates a supplier-direct draft and locks its payee to the frozen supplier", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([draftPayment]);
    role(tx, "material_staff");
    tx.fileObject.findMany.mockResolvedValue([
      {
        id: "file-support",
        storageStatus: "active",
        uploadedByUserId: "material-1"
      }
    ]);
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...draftPayment,
      ...validDraftInput(),
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents: 3_000n,
      companyPaymentAmountCents: 5_000n,
      paymentPath: "supplier_direct",
      payeePartyId: "party-1",
      payeeUserId: null,
      payeeNameSnapshot: "北京某某商贸"
    });

    await service.updateDraft(
      "payment-1",
      "material-1",
      validDraftInput()
    );

    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        payeePartyId: "party-1",
        payeeUserId: null,
        payeeNameSnapshot: "北京某某商贸",
        settlementAmountCents: 8_000n,
        supplierBalanceAmountCents: 3_000n,
        companyPaymentAmountCents: 5_000n
      })
    });
  });

  it("locks reimbursement payee to the handler and requires a real merchant proof uploaded by the handler", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([draftPayment]);
    role(tx, "material_staff");
    tx.fileObject.findMany.mockResolvedValue([
      {
        id: "proof-1",
        storageStatus: "active",
        uploadedByUserId: "someone-else"
      }
    ]);

    await expect(
      service.updateDraft("payment-1", "material-1", {
        ...validDraftInput(),
        paymentPath: "handler_reimbursement",
        supportingAttachmentFileId: null,
        merchantPaymentProofFileId: "proof-1"
      })
    ).rejects.toEqual(
      new ForbiddenException("商家付款证明必须由采购经办人本人上传")
    );
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
  });

  it("allows a zero-company-payment balance-only draft without bank account but keeps supplier payee", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([draftPayment]);
    role(tx, "material_staff");
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...draftPayment,
      settlementAmountCents: 5_000n,
      supplierBalanceAmountCents: 5_000n,
      companyPaymentAmountCents: 0n,
      paymentPath: "supplier_direct",
      payeePartyId: "party-1",
      payeeNameSnapshot: "北京某某商贸"
    });

    await service.updateDraft("payment-1", "material-1", {
      settlementAmountCents: "5000",
      supplierBalanceAmountCents: "5000",
      companyPaymentAmountCents: "0",
      paymentPath: "supplier_direct",
      expectedPaymentAt: "2026-07-20T00:00:00.000Z",
      paymentNote: "全部使用供应商余额"
    });

    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        payeePartyId: "party-1",
        payeeNameSnapshot: "北京某某商贸",
        payeeBankAccountSnapshot: null
      })
    });
  });

  it.each([
    {
      name: "供应商直付",
      payment: completePayment(),
      missing: {
        paymentNote: null,
        supportingAttachmentFileId: "file-support"
      },
      message: "请填写真实付款说明"
    },
    {
      name: "经办人垫付报回",
      payment: completePayment({
        paymentPath: "handler_reimbursement",
        merchantPaymentProofFileId: "file-support"
      }),
      missing: {
        paymentNote: "垫付报回",
        supportingAttachmentFileId: null
      },
      message: "请上传付款申请支撑附件"
    },
    {
      name: "全额余额抵扣",
      payment: completePayment({
        settlementAmountCents: 5_000n,
        supplierBalanceAmountCents: 5_000n,
        companyPaymentAmountCents: 0n,
        paymentMethod: null,
        payeeAccountNameSnapshot: null,
        payeeBankNameSnapshot: null,
        payeeBankAccountSnapshot: null,
        expectedPaymentAt: null
      }),
      missing: {
        paymentNote: null,
        supportingAttachmentFileId: "file-support"
      },
      message: "请填写真实付款说明"
    }
  ])("提交$name仍要求真实说明和支撑附件", async ({ payment, missing, message }) => {
    const { service, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([{ ...payment, ...missing }]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents:
        payment.supplierBalanceAmountCents.toString(),
      suggestedBalanceAmountCents:
        payment.supplierBalanceAmountCents.toString()
    });

    await expect(
      service.submit("payment-1", "material-1")
    ).rejects.toThrow(message);
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(balance.reserve).not.toHaveBeenCalled();
  });

  it("allows one active handler-uploaded file to serve both support and merchant-proof semantic fields", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([draftPayment]);
    role(tx, "material_staff");
    tx.spotProcurementPayment.update.mockResolvedValue(
      completePayment({
        paymentPath: "handler_reimbursement",
        merchantPaymentProofFileId: "file-support"
      })
    );

    await service.updateDraft("payment-1", "material-1", {
      ...validDraftInput(),
      paymentPath: "handler_reimbursement",
      merchantPaymentProofFileId: "file-support"
    });

    expect(tx.fileObject.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["file-support"] } },
      select: {
        id: true,
        storageStatus: true,
        uploadedByUserId: true
      }
    });
  });

  it("clears stale payee accounts when the payment path changes and requires fresh bank details", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([completePayment()]);
    role(tx, "material_staff");

    await expect(
      service.updateDraft("payment-1", "material-1", {
        paymentPath: "handler_reimbursement",
        merchantPaymentProofFileId: "file-support"
      })
    ).rejects.toThrow("银行转账必须填写完整收款账户信息");
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
  });

  it("clears bank-only snapshots when payment method changes away from bank transfer", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([completePayment()]);
    role(tx, "material_staff");
    tx.spotProcurementPayment.update.mockResolvedValue(
      completePayment({
        paymentMethod: "cash",
        payeeAccountNameSnapshot: null,
        payeeBankNameSnapshot: null,
        payeeBankAccountSnapshot: null
      })
    );

    await service.updateDraft("payment-1", "material-1", {
      paymentMethod: "cash"
    });

    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        paymentMethod: "cash",
        payeeAccountNameSnapshot: null,
        payeeBankNameSnapshot: null,
        payeeBankAccountSnapshot: null
      })
    });
  });

  it("rejects a malformed three-part amount composition before writing", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([draftPayment]);
    role(tx, "material_staff");

    await expect(
      service.updateDraft("payment-1", "material-1", {
        ...validDraftInput(),
        settlementAmountCents: "8000",
        supplierBalanceAmountCents: "3000",
        companyPaymentAmountCents: "4999"
      })
    ).rejects.toEqual(
      new BadRequestException(
        "本次结算金额必须等于供应商余额抵扣金额与公司实际付款金额之和"
      )
    );
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
  });

  it("submits under Serializable after version then stable payment locks, reserves balance and freezes approval facts", async () => {
    const { service, prisma, tx, balance, audit, approvalForms } = harness();
    const completeDraft = completePayment({
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents: 3_000n,
      companyPaymentAmountCents: 5_000n
    });
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([completeDraft]);
    role(tx, "material_staff");
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...completeDraft,
      status: "approval_pending",
      submittedAt: new Date()
    });
    balance.reserve.mockResolvedValue({
      reservationId: "reservation-1",
      amountCents: 3_000n
    });
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "3000",
      suggestedBalanceAmountCents: "3000"
    });

    const result = await service.submit("payment-1", "material-1");

    expect(result.status).toBe("approval_pending");
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[1]
    );
    expect(balance.reserve).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        paymentId: "payment-1",
        amountCents: 3_000n
      })
    );
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "spot_procurement.payment.approve",
        businessType: "spot_procurement_payment",
        businessId: "payment-1",
        applicantUserId: "material-1",
        frozenNodes: [
          {
            name: "综合部主管审批",
            mode: "any",
            roleKeys: ["comprehensive_director"]
          },
          {
            name: "项目经理审批",
            mode: "any",
            roleKeys: ["project_manager"]
          },
          {
            name: "财务主管审批",
            mode: "any",
            roleKeys: ["finance_director"]
          },
          {
            name: "董事长或总经理审批",
            mode: "any",
            roleKeys: ["chairman", "general_manager"]
          }
        ]
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.payment.approval.submit",
        metadata: expect.objectContaining({
          settlementAmountCents: "8000",
          supplierBalanceAmountCents: "3000",
          companyPaymentAmountCents: "5000",
          reservationId: "reservation-1",
          bankAccountProvided: true,
          bankAccountLast4: "0001"
        })
      })
    );
    expect(approvalForms.tryRefreshLatestForBusiness).toHaveBeenCalledWith(
      "spot_procurement_payment",
      "payment-1",
      "material-1",
      "approval.submit"
    );
    expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      approvalForms.tryRefreshLatestForBusiness.mock.invocationCallOrder[0]
    );
    const submitAudit = audit.record.mock.calls.find(
      ([, input]) =>
        (input as { action?: string }).action ===
        "spot_procurement.payment.approval.submit"
    )?.[1] as { metadata?: Record<string, unknown> };
    expect(submitAudit.metadata).not.toHaveProperty(
      "payeeBankAccountSnapshot"
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  });

  it.each([
    {
      account: "12",
      companyPaymentAmountCents: 5_000n,
      supplierBalanceAmountCents: 3_000n,
      expectedProvided: true,
      expectedLast4: "12"
    },
    {
      account: null,
      companyPaymentAmountCents: 0n,
      supplierBalanceAmountCents: 8_000n,
      expectedProvided: false,
      expectedLast4: null
    }
  ])("stores only safe bank-account audit facts for short or absent accounts", async ({
    account,
    companyPaymentAmountCents,
    supplierBalanceAmountCents,
    expectedProvided,
    expectedLast4
  }) => {
    const { service, tx, balance, audit } = harness();
    const completeDraft = completePayment({
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents,
      companyPaymentAmountCents,
      paymentMethod:
        companyPaymentAmountCents === 0n ? null : "bank_transfer",
      payeeAccountNameSnapshot:
        companyPaymentAmountCents === 0n ? null : "北京某某商贸",
      payeeBankNameSnapshot:
        companyPaymentAmountCents === 0n ? null : "中国建设银行",
      payeeBankAccountSnapshot: account,
      expectedPaymentAt:
        companyPaymentAmountCents === 0n
          ? null
          : new Date("2026-07-20T00:00:00.000Z")
    });
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([completeDraft]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents:
        supplierBalanceAmountCents.toString(),
      suggestedBalanceAmountCents:
        supplierBalanceAmountCents.toString()
    });
    balance.reserve.mockResolvedValue({
      reservationId: "reservation-safe-audit",
      amountCents: supplierBalanceAmountCents
    });
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...completeDraft,
      status: "approval_pending"
    });

    await service.submit("payment-1", "material-1");

    const submitAudit = audit.record.mock.calls.find(
      ([, input]) =>
        (input as { action?: string }).action ===
        "spot_procurement.payment.approval.submit"
    )?.[1] as { metadata?: Record<string, unknown> };
    expect(submitAudit.metadata).toEqual(
      expect.objectContaining({
        bankAccountProvided: expectedProvided,
        bankAccountLast4: expectedLast4
      })
    );
    expect(submitAudit.metadata).not.toHaveProperty(
      "payeeBankAccountSnapshot"
    );
  });

  it("rejects a later submit when active payment settlement would exceed the frozen version", async () => {
    const { service, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        completePayment({
          settlementAmountCents: 6_000n,
          companyPaymentAmountCents: 6_000n
        }),
        {
          ...draftPayment,
          id: "payment-2",
          code: "LXCG-001-V1-P002",
          status: "approval_pending",
          settlementAmountCents: 5_000n,
          companyPaymentAmountCents: 5_000n
        }
      ]);
    role(tx, "material_staff");

    await expect(
      service.submit("payment-1", "material-1")
    ).rejects.toEqual(
      new ConflictException("有效付款申请累计结算金额不能超过当前采购批准金额")
    );
    expect(balance.reserve).not.toHaveBeenCalled();
  });

  it("lets only the frozen handler submit or create payment drafts even when another material role is valid", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([draftPayment]);
    role(tx, "material_director");

    await expect(
      service.submit("payment-1", "material-director-1")
    ).rejects.toEqual(
      new ForbiddenException("只有采购经办人可以确认并提交付款申请")
    );
  });

  it("moves through fixed nodes and final approval stops at approved pending payment", async () => {
    const { service, tx, approvalForms } = harness();
    const approval = {
      id: "approval-1",
      status: "approval_pending",
      currentNodeIndex: 3,
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
          roleKeys: ["finance_director"],
          approvedRoleKeys: ["finance_director"]
        },
        {
          name: "董事长或总经理审批",
          mode: "any",
          roleKeys: ["chairman", "general_manager"]
        }
      ]
    };
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        { ...draftPayment, status: "approval_pending", submittedAt: new Date() }
      ])
      .mockResolvedValueOnce([approval]);
    role(tx, "chairman");
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...draftPayment,
      status: "approved_pending_payment"
    });

    const result = await service.review("payment-1", "chairman-1", {
      decision: "approve"
    });

    expect(result.status).toBe("approved_pending_payment");
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        status: "approved_pending_payment",
        approvedAt: expect.any(Date)
      })
    });
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ paidAmountCents: expect.anything() })
      })
    );
    expect(approvalForms.tryRefreshLatestForBusiness).toHaveBeenCalledWith(
      "spot_procurement_payment",
      "payment-1",
      "chairman-1",
      "approval.approve"
    );
  });

  it("uses canonical global/project role resolution at the current project-manager node", async () => {
    const invalidGlobal = harness();
    invalidGlobal.tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approval_pending",
          submittedAt: new Date()
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          applicantUserId: "material-1",
          frozenNodes: [
            {
              name: "项目经理审批",
              mode: "any",
              roleKeys: ["project_manager"]
            }
          ]
        }
      ]);
    roles(invalidGlobal.tx, {
      global: ["finance_director", "project_manager"]
    });

    await expect(
      invalidGlobal.service.review(
        "payment-1",
        "finance-director-1",
        { decision: "approve" }
      )
    ).rejects.toThrow("当前用户不是本付款审批节点处理人");
    expect(
      invalidGlobal.tx.approvalActionLog.create
    ).not.toHaveBeenCalled();

    const validProject = harness();
    validProject.tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approval_pending",
          submittedAt: new Date()
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          applicantUserId: "material-1",
          frozenNodes: [
            {
              name: "项目经理审批",
              mode: "any",
              roleKeys: ["project_manager"]
            },
            {
              name: "财务主管审批",
              mode: "any",
              roleKeys: ["finance_director"]
            }
          ]
        }
      ]);
    roles(validProject.tx, { project: ["project_manager"] });

    await expect(
      validProject.service.review(
        "payment-1",
        "project-manager-1",
        { decision: "approve" }
      )
    ).resolves.toEqual(
      expect.objectContaining({ status: "approval_pending" })
    );
    expect(validProject.approvalForms.tryRefreshLatestForBusiness).toHaveBeenCalledWith(
      "spot_procurement_payment",
      "payment-1",
      "project-manager-1",
      "approval.approve"
    );

    const validGlobal = harness();
    validGlobal.tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approval_pending",
          submittedAt: new Date()
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          applicantUserId: "material-1",
          frozenNodes: [
            {
              name: "财务主管审批",
              mode: "any",
              roleKeys: ["finance_director"]
            },
            {
              name: "董事长或总经理审批",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }
      ]);
    roles(validGlobal.tx, { global: ["finance_director"] });

    await expect(
      validGlobal.service.review(
        "payment-1",
        "finance-director-1",
        { decision: "approve" }
      )
    ).resolves.toEqual(
      expect.objectContaining({ status: "approval_pending" })
    );
  });

  it.each([
    "approve",
    "reject",
    "return_to_applicant"
  ] as const)(
    "does not let an ordinary applicant %s their own payment",
    async (decision) => {
      const current = harness();
      current.tx.$queryRaw
        .mockResolvedValueOnce([version])
        .mockResolvedValueOnce([
          {
            ...draftPayment,
            status: "approval_pending",
            submittedAt: new Date()
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 0,
            applicantUserId: "material-1",
            frozenNodes: [
              {
                name: "综合部主管审批",
                mode: "any",
                roleKeys: ["comprehensive_director"]
              }
            ]
          }
        ]);
      role(current.tx, "comprehensive_director");

      await expect(
        current.service.review("payment-1", "material-1", {
          decision,
          comment:
            decision === "approve" ? undefined : "申请人不能处理自己的单据"
        })
      ).rejects.toThrow("申请人不能审批自己发起的业务");
      expectNoPaymentReviewWrites(current);
    }
  );

  it("requires reason and current-password confirmation for chairman or GM approving their own payment", async () => {
    const makeHarness = () => {
      const current = harness();
      current.tx.$queryRaw
        .mockResolvedValueOnce([version])
        .mockResolvedValueOnce([
          {
            ...draftPayment,
            status: "approval_pending",
            submittedAt: new Date()
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 0,
            applicantUserId: "leader-1",
            frozenNodes: [
              {
                name: "董事长或总经理审批",
                mode: "any",
                roleKeys: ["chairman", "general_manager"]
              }
            ]
          }
        ]);
      roles(current.tx, { global: ["chairman"] });
      current.tx.spotProcurementPayment.update.mockResolvedValue({
        ...draftPayment,
        status: "approved_pending_payment"
      });
      return current;
    };

    const missingReason = makeHarness();
    await expect(
      missingReason.service.review(
        "payment-1",
        "leader-1",
        {
          decision: "approve",
          confirmationPassword: "Current@123"
        } as ReviewSpotProcurementPaymentDto
      )
    ).rejects.toThrow(
      "董事长或总经理审批自己发起的业务时，请填写自审原因"
    );
    expect(
      missingReason.tx.approvalActionLog.create
    ).not.toHaveBeenCalled();

    const missingPassword = makeHarness();
    await expect(
      missingPassword.service.review(
        "payment-1",
        "leader-1",
        {
          decision: "approve",
          selfReviewReason: "项目紧急"
        } as ReviewSpotProcurementPaymentDto
      )
    ).rejects.toThrow(
      "董事长或总经理自审前，请输入当前密码完成二次确认"
    );
    expect(
      missingPassword.tx.approvalActionLog.create
    ).not.toHaveBeenCalled();

    const wrongPassword = makeHarness();
    wrongPassword.auth.confirmPassword.mockRejectedValue(
      new ForbiddenException("当前密码不正确")
    );
    await expect(
      wrongPassword.service.review(
        "payment-1",
        "leader-1",
        {
          decision: "approve",
          selfReviewReason: "项目紧急",
          confirmationPassword: "wrong-password"
        } as ReviewSpotProcurementPaymentDto
      )
    ).rejects.toThrow("当前密码不正确");
    expect(
      wrongPassword.tx.approvalActionLog.create
    ).not.toHaveBeenCalled();
    expect(
      wrongPassword.tx.spotProcurementPayment.update
    ).not.toHaveBeenCalled();
  });

  it("records only trimmed self-review reason after successful password confirmation", async () => {
    const { service, tx, audit, auth } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approval_pending",
          submittedAt: new Date()
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          applicantUserId: "leader-1",
          frozenNodes: [
            {
              name: "董事长或总经理审批",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }
      ]);
    roles(tx, { global: ["chairman"] });
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...draftPayment,
      status: "approved_pending_payment"
    });

    await service.review(
      "payment-1",
      "leader-1",
      {
        decision: "approve",
        selfReviewReason: "  项目紧急且由本人发起  ",
        confirmationPassword: "Current@123"
      } as ReviewSpotProcurementPaymentDto
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "leader-1",
      "Current@123"
    );
    const actionData =
      tx.approvalActionLog.create.mock.calls[0]?.[0].data;
    expect(actionData.metadata).toEqual(
      expect.objectContaining({
        reviewRoleKey: "chairman",
        selfReview: true,
        selfReviewReason: "项目紧急且由本人发起"
      })
    );
    const reviewAudit = audit.record.mock.calls.find(
      ([, input]) =>
        (input as { action?: string }).action ===
        "spot_procurement.payment.approval.approve"
    )?.[1];
    expect(reviewAudit).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          selfReview: true,
          selfReviewReason: "项目紧急且由本人发起"
        })
      })
    );
    expect(JSON.stringify(actionData)).not.toContain("Current@123");
    expect(JSON.stringify(reviewAudit)).not.toContain("Current@123");
  });

  it.each(["reject", "return_to_applicant"] as const)(
    "requires full chairman self-review confirmation before %s and writes nothing on failure",
    async (decision) => {
      const comment = "本人复核后不同意";

      const missingReason = chairmanSelfReviewHarness();
      await expect(
        missingReason.service.review("payment-1", "leader-1", {
          decision,
          comment,
          confirmationPassword: "Current@123"
        } as ReviewSpotProcurementPaymentDto)
      ).rejects.toThrow(
        "董事长或总经理审批自己发起的业务时，请填写自审原因"
      );
      expectNoPaymentReviewWrites(missingReason);

      const missingPassword = chairmanSelfReviewHarness();
      await expect(
        missingPassword.service.review("payment-1", "leader-1", {
          decision,
          comment,
          selfReviewReason: "  本人复核确认  "
        } as ReviewSpotProcurementPaymentDto)
      ).rejects.toThrow(
        "董事长或总经理自审前，请输入当前密码完成二次确认"
      );
      expectNoPaymentReviewWrites(missingPassword);

      const wrongPassword = chairmanSelfReviewHarness();
      wrongPassword.auth.confirmPassword.mockRejectedValue(
        new ForbiddenException("当前密码不正确")
      );
      const caught = await wrongPassword.service
        .review("payment-1", "leader-1", {
          decision,
          comment,
          selfReviewReason: "  本人复核确认  ",
          confirmationPassword: "wrong-password"
        } as ReviewSpotProcurementPaymentDto)
        .catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(ForbiddenException);
      expect((caught as Error).message).toBe("当前密码不正确");
      expect(
        JSON.stringify({
          message: (caught as Error).message,
          response: (caught as ForbiddenException).getResponse()
        })
      ).not.toContain("wrong-password");
      expectNoPaymentReviewWrites(wrongPassword);
    }
  );

  it.each([
    ["reject", "rejected"],
    ["return_to_applicant", "returned"]
  ] as const)(
    "records trimmed chairman self-review metadata for %s without persisting the password",
    async (decision, expectedStatus) => {
      const { service, tx, balance, audit, auth } =
        chairmanSelfReviewHarness();
      tx.spotProcurementPayment.update.mockResolvedValue({
        ...draftPayment,
        status: expectedStatus
      });
      tx.spotProcurementPayment.create.mockResolvedValue({
        ...draftPayment,
        id: "payment-2",
        code: "LXCG-001-V1-P002",
        status: "draft"
      });

      const result = await service.review("payment-1", "leader-1", {
        decision,
        comment: "本人复核后不同意",
        selfReviewReason: "  本人复核确认  ",
        confirmationPassword: "Current@123"
      } as ReviewSpotProcurementPaymentDto);

      expect(auth.confirmPassword).toHaveBeenCalledWith(
        "leader-1",
        "Current@123"
      );
      expect(balance.releaseReservation).toHaveBeenCalled();
      const actionData =
        tx.approvalActionLog.create.mock.calls[0]?.[0].data;
      expect(actionData.metadata).toEqual(
        expect.objectContaining({
          reviewRoleKey: "chairman",
          selfReview: true,
          selfReviewReason: "本人复核确认"
        })
      );
      const reviewAudit = audit.record.mock.calls.find(
        ([, input]) =>
          (input as { action?: string }).action ===
          `spot_procurement.payment.approval.${decision}`
      )?.[1];
      expect(reviewAudit).toEqual(
        expect.objectContaining({
          metadata: expect.objectContaining({
            selfReview: true,
            selfReviewReason: "本人复核确认"
          })
        })
      );
      expect(JSON.stringify(actionData)).not.toContain("Current@123");
      expect(JSON.stringify(reviewAudit)).not.toContain("Current@123");
      expect(JSON.stringify(result)).not.toContain("Current@123");
    }
  );

  it.each([
    ["return_to_applicant", "returned"],
    ["reject", "rejected"]
  ] as const)(
    "%s releases the reservation and preserves the submitted payment as a terminal frozen fact",
    async (decision, expectedStatus) => {
      const { service, tx, balance, approvalForms } = harness();
      tx.$queryRaw
        .mockResolvedValueOnce([version])
        .mockResolvedValueOnce([
          {
            ...draftPayment,
            status: "approval_pending",
            submittedAt: new Date()
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 0,
            applicantUserId: "material-1",
            frozenNodes: [
              {
                name: "综合部主管审批",
                mode: "any",
                roleKeys: ["comprehensive_director"]
              }
            ]
          }
        ]);
      role(tx, "comprehensive_director");
      tx.spotProcurementPayment.update.mockResolvedValue({
        ...draftPayment,
        status: expectedStatus
      });
      tx.spotProcurementPayment.create.mockResolvedValue({
        ...draftPayment,
        id: "payment-2",
        code: "LXCG-001-V1-P002"
      });

      await service.review("payment-1", "comprehensive-1", {
        decision,
        comment: "请重新确认"
      });

      expect(balance.releaseReservation).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          paymentId: "payment-1",
          expectedAmountCents: 0n,
          expectedProjectId: "project-1",
          expectedSupplierKey: "party:party-1",
          actorUserId: "comprehensive-1",
          reason: expect.any(String)
        })
      );
      expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
        where: { id: "payment-1" },
        data: expect.objectContaining({ status: expectedStatus })
      });
      if (decision === "return_to_applicant") {
        expect(tx.spotProcurementPayment.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            status: "draft",
            procurementId: "procurement-1",
            procurementVersionId: "version-1",
            handlerUserId: "material-1"
          })
        });
      } else {
        expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
      }
      expect(approvalForms.tryRefreshLatestForBusiness).toHaveBeenCalledWith(
        "spot_procurement_payment",
        "payment-1",
        "comprehensive-1",
        `approval.${decision}`
      );
    }
  );

  it.each(["reject", "return_to_applicant"] as const)(
    "aborts %s before writing any approval or payment terminal fact when balance release fails",
    async (decision) => {
      const { service, tx, balance, audit } = harness();
      tx.$queryRaw
        .mockResolvedValueOnce([version])
        .mockResolvedValueOnce([
          {
            ...draftPayment,
            status: "approval_pending",
            supplierBalanceAmountCents: 3_000n,
            companyPaymentAmountCents: 7_000n,
            submittedAt: new Date()
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 0,
            applicantUserId: "material-1",
            frozenNodes: [
              {
                name: "综合部主管审批",
                mode: "any",
                roleKeys: ["comprehensive_director"]
              }
            ]
          }
        ]);
      role(tx, "comprehensive_director");
      balance.releaseReservation.mockRejectedValue(
        new ConflictException(
          "供应商余额预留状态异常，请联系财务处理"
        )
      );

      await expect(
        service.review("payment-1", "comprehensive-1", {
          decision,
          comment: "冻结事实异常，停止终止付款"
        })
      ).rejects.toThrow("供应商余额预留状态异常，请联系财务处理");

      expect(balance.releaseReservation).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          paymentId: "payment-1",
          expectedAmountCents: 3_000n,
          expectedProjectId: "project-1",
          expectedSupplierKey: "party:party-1",
          actorUserId: "comprehensive-1",
          reason: expect.any(String)
        })
      );
      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("lets only the finance-director return node specify a lower balance amount and binds it to a new draft", async () => {
    const { service, tx, balance, audit } = harness();
    const submitted = {
      ...draftPayment,
      status: "approval_pending",
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents: 3_000n,
      companyPaymentAmountCents: 5_000n,
      paymentPath: "supplier_direct",
      submittedAt: new Date("2026-07-17T02:00:00.000Z")
    };
    tx.$queryRaw
      .mockResolvedValueOnce([version])
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
            },
            {
              name: "董事长或总经理审批",
              mode: "any",
              roleKeys: ["chairman", "general_manager"]
            }
          ]
        }
      ]);
    role(tx, "finance_director");
    balance.releaseReservation.mockResolvedValue({
      released: true,
      amountCents: 3_000n
    });
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "5000",
      suggestedBalanceAmountCents: "5000"
    });
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...submitted,
      status: "returned"
    });
    tx.spotProcurementPayment.create.mockResolvedValue({
      ...submitted,
      id: "payment-2",
      code: "LXCG-001-V1-P002",
      status: "draft",
      supplierBalanceAmountCents: 1_000n,
      companyPaymentAmountCents: 7_000n,
      balanceOverrideReason: "项目现金安排需要保留供应商余额",
      submittedAt: null,
      approvedAt: null
    });

    const result = await service.review("payment-1", "finance-1", {
      decision: "return_to_applicant",
      comment: "项目现金安排需要保留供应商余额",
      adjustedSupplierBalanceAmountCents: "1000"
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "returned",
        newDraftPaymentId: "payment-2"
      })
    );
    expect(balance.releaseReservation).toHaveBeenCalledWith(
      tx,
      {
        paymentId: "payment-1",
        expectedAmountCents: 3_000n,
        expectedProjectId: "project-1",
        expectedSupplierKey: "party:party-1",
        actorUserId: "finance-1",
        reason:
          "付款申请退回经办人：项目现金安排需要保留供应商余额"
      }
    );
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: { status: "returned" }
    });
    expect(tx.spotProcurementPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: "LXCG-001-V1-P002",
        status: "draft",
        handlerUserId: "material-1",
        settlementAmountCents: 8_000n,
        supplierBalanceAmountCents: 1_000n,
        companyPaymentAmountCents: 7_000n,
        balanceOverrideReason: "项目现金安排需要保留供应商余额"
      })
    });
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ submittedAt: null })
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.payment.approval.return_to_applicant",
        metadata: expect.objectContaining({
          oldPaymentId: "payment-1",
          newDraftPaymentId: "payment-2",
          originalSupplierBalanceAmountCents: "3000",
          adjustedSupplierBalanceAmountCents: "1000",
          suggestedBalanceAmountCents: "5000",
          balanceOverrideReason: "项目现金安排需要保留供应商余额",
          reservationReleased: true,
          releasedReservationAmountCents: "3000"
        })
      })
    );
  });

  it("rejects adjusted balance fields outside a finance-director return action", async () => {
    const { service, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        { ...draftPayment, status: "approval_pending", submittedAt: new Date() }
      ])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          applicantUserId: "material-1",
          frozenNodes: [
            {
              name: "综合部主管审批",
              mode: "any",
              roleKeys: ["comprehensive_director"]
            }
          ]
        }
      ]);
    role(tx, "comprehensive_director");

    await expect(
      service.review("payment-1", "comprehensive-1", {
        decision: "return_to_applicant",
        comment: "尝试修改抵扣",
        adjustedSupplierBalanceAmountCents: "0"
      })
    ).rejects.toEqual(
      new BadRequestException(
        "只有财务主管在退回申请人时可以指定调整后的供应商余额抵扣金额"
      )
    );
    expect(balance.releaseReservation).not.toHaveBeenCalled();
  });

  it.each(["approve", "reject"] as const)(
    "rejects finance %s with an adjusted balance field",
    async (decision) => {
      const { service, tx, balance } = harness();
      tx.$queryRaw
        .mockResolvedValueOnce([version])
        .mockResolvedValueOnce([
          {
            ...draftPayment,
            status: "approval_pending",
            submittedAt: new Date()
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 0,
            applicantUserId: "material-1",
            frozenNodes: [
              {
                name: "财务主管审批",
                mode: "any",
                roleKeys: ["finance_director"]
              }
            ]
          }
        ]);
      role(tx, "finance_director");

      await expect(
        service.review("payment-1", "finance-1", {
          decision,
          comment: decision === "reject" ? "不同意" : undefined,
          adjustedSupplierBalanceAmountCents: "0"
        })
      ).rejects.toEqual(
        new BadRequestException(
          "财务调整后的供应商余额抵扣金额只能随退回申请人动作提交"
        )
      );
      expect(balance.releaseReservation).not.toHaveBeenCalled();
    }
  );

  it("requires both adjusted balance amount and reason on a finance-director return", async () => {
    const makeHarness = () => {
      const current = harness();
      current.tx.$queryRaw
        .mockResolvedValueOnce([version])
        .mockResolvedValueOnce([
          {
            ...draftPayment,
            status: "approval_pending",
            submittedAt: new Date()
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 0,
            applicantUserId: "material-1",
            frozenNodes: [
              {
                name: "财务主管审批",
                mode: "any",
                roleKeys: ["finance_director"]
              }
            ]
          }
        ]);
      role(current.tx, "finance_director");
      return current;
    };
    const missingAmount = makeHarness();
    await expect(
      missingAmount.service.review("payment-1", "finance-1", {
        decision: "return_to_applicant",
        comment: "需要减少抵扣"
      })
    ).rejects.toEqual(
      new BadRequestException("财务主管退回付款申请时必须指定调整后的供应商余额抵扣金额")
    );

    const missingReason = makeHarness();
    await expect(
      missingReason.service.review("payment-1", "finance-1", {
        decision: "return_to_applicant",
        adjustedSupplierBalanceAmountCents: "0"
      })
    ).rejects.toEqual(
      new BadRequestException("财务主管调整供应商余额抵扣时必须填写原因")
    );
  });

  it("rejects finance adjustment above settlement or the latest available balance after release", async () => {
    const { service, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approval_pending",
          settlementAmountCents: 8_000n,
          supplierBalanceAmountCents: 3_000n,
          companyPaymentAmountCents: 5_000n,
          submittedAt: new Date()
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          applicantUserId: "material-1",
          frozenNodes: [
            {
              name: "财务主管审批",
              mode: "any",
              roleKeys: ["finance_director"]
            }
          ]
        }
      ]);
    role(tx, "finance_director");
    balance.releaseReservation.mockResolvedValue({
      released: true,
      amountCents: 3_000n
    });
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "2000",
      suggestedBalanceAmountCents: "2000"
    });

    await expect(
      service.review("payment-1", "finance-1", {
        decision: "return_to_applicant",
        comment: "只允许少量抵扣",
        adjustedSupplierBalanceAmountCents: "2500"
      })
    ).rejects.toEqual(
      new BadRequestException(
        "调整后的供应商余额抵扣金额不能超过当前可用供应商余额"
      )
    );
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
  });

  it("blocks a handler from submitting below the latest suggestion without a finance-bound override reason", async () => {
    const { service, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        completePayment({
          settlementAmountCents: 8_000n,
          supplierBalanceAmountCents: 1_000n,
          companyPaymentAmountCents: 7_000n,
          paymentNote: "申请付款"
        })
      ]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "5000",
      suggestedBalanceAmountCents: "5000"
    });

    await expect(
      service.submit("payment-1", "material-1")
    ).rejects.toEqual(
      new BadRequestException(
        "本次供应商余额抵扣低于系统建议，请先由财务主管退回并指定调整金额"
      )
    );
    expect(balance.reserve).not.toHaveBeenCalled();
  });

  it("allows the handler to submit the finance-adjusted draft unchanged and freezes the reason", async () => {
    const { service, tx, balance, audit } = harness();
    const financeDraft = completePayment({
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents: 1_000n,
      companyPaymentAmountCents: 7_000n,
      paymentNote: "申请付款",
      balanceOverrideReason: "项目现金安排需要保留供应商余额"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([financeDraft]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "5000",
      suggestedBalanceAmountCents: "5000"
    });
    balance.reserve.mockResolvedValue({
      reservationId: "reservation-2",
      amountCents: 1_000n
    });
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...financeDraft,
      status: "approval_pending",
      submittedAt: new Date()
    });

    const result = await service.submit("payment-1", "material-1");

    expect(result.status).toBe("approval_pending");
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        status: "approval_pending",
        supplierBalanceAmountCents: 1_000n,
        balanceOverrideReason: "项目现金安排需要保留供应商余额"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.payment.approval.submit",
        metadata: expect.objectContaining({
          suggestedBalanceAmountCents: "5000",
          balanceOverrideReason: "项目现金安排需要保留供应商余额"
        })
      })
    );
  });

  it("preserves the finance reason when the handler raises but remains below suggestion, and rejects any later decrease", async () => {
    const { service, tx, balance } = harness();
    const financeDraft = {
      ...draftPayment,
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents: 1_000n,
      companyPaymentAmountCents: 7_000n,
      paymentPath: "supplier_direct",
      balanceOverrideReason: "项目现金安排需要保留供应商余额"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([financeDraft]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "5000",
      suggestedBalanceAmountCents: "5000"
    });
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...financeDraft,
      supplierBalanceAmountCents: 2_000n,
      companyPaymentAmountCents: 6_000n
    });

    await service.updateDraft("payment-1", "material-1", {
      supplierBalanceAmountCents: "2000",
      companyPaymentAmountCents: "6000"
    });
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        supplierBalanceAmountCents: 2_000n,
        balanceOverrideReason: "项目现金安排需要保留供应商余额"
      })
    });

    const lower = harness();
    lower.tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...financeDraft,
          supplierBalanceAmountCents: 2_000n,
          companyPaymentAmountCents: 6_000n
        }
      ]);
    role(lower.tx, "material_staff");
    lower.balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "5000",
      suggestedBalanceAmountCents: "5000"
    });
    await expect(
      lower.service.updateDraft("payment-1", "material-1", {
        supplierBalanceAmountCents: "1500",
        companyPaymentAmountCents: "6500"
      })
    ).rejects.toEqual(
      new BadRequestException(
        "经办人不能把供应商余额抵扣金额降到财务主管指定金额以下，请再次提交财务主管调整"
      )
    );
  });

  it("clears the finance override reason after the handler restores balance use to the latest system suggestion", async () => {
    const { service, tx, balance } = harness();
    const financeDraft = {
      ...draftPayment,
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents: 1_000n,
      companyPaymentAmountCents: 7_000n,
      paymentPath: "supplier_direct",
      balanceOverrideReason: "项目现金安排需要保留供应商余额"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([financeDraft]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "5000",
      suggestedBalanceAmountCents: "5000"
    });
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...financeDraft,
      supplierBalanceAmountCents: 5_000n,
      companyPaymentAmountCents: 3_000n,
      balanceOverrideReason: null
    });

    await service.updateDraft("payment-1", "material-1", {
      supplierBalanceAmountCents: "5000",
      companyPaymentAmountCents: "3000"
    });
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        supplierBalanceAmountCents: 5_000n,
        balanceOverrideReason: null
      })
    });
  });

  it("allows only an exact latest-suggestion decrease when availability falls below the finance floor and audits the system adjustment", async () => {
    const { service, tx, balance, audit } = harness();
    const financeDraft = completePayment({
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents: 1_000n,
      companyPaymentAmountCents: 7_000n,
      balanceOverrideReason: "财务指定保留现金"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([financeDraft]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "500",
      suggestedBalanceAmountCents: "500"
    });
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...financeDraft,
      supplierBalanceAmountCents: 500n,
      companyPaymentAmountCents: 7_500n,
      balanceOverrideReason: null
    });

    await service.updateDraft("payment-1", "material-1", {
      supplierBalanceAmountCents: "500",
      companyPaymentAmountCents: "7500"
    });

    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        supplierBalanceAmountCents: 500n,
        balanceOverrideReason: null
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.payment.balance.system_adjust",
        businessId: "payment-1",
        metadata: expect.objectContaining({
          procurementVersionId: "version-1",
          oldSupplierBalanceAmountCents: "1000",
          financeFloorAmountCents: "1000",
          latestSuggestedBalanceAmountCents: "500",
          reason: "供应商可用余额变化，按最新系统建议同步降低抵扣金额"
        })
      })
    );
  });

  it("does not treat a handler-driven settlement reduction as a system-constrained floor adjustment", async () => {
    const { service, tx, balance, audit } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        completePayment({
          settlementAmountCents: 8_000n,
          supplierBalanceAmountCents: 1_000n,
          companyPaymentAmountCents: 7_000n,
          balanceOverrideReason: "财务指定保留现金"
        })
      ]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "500",
      suggestedBalanceAmountCents: "500"
    });

    await expect(
      service.updateDraft("payment-1", "material-1", {
        settlementAmountCents: "500",
        supplierBalanceAmountCents: "500",
        companyPaymentAmountCents: "0"
      })
    ).rejects.toThrow(
      "经办人不能把供应商余额抵扣金额降到财务主管指定金额以下，请再次提交财务主管调整"
    );
    expect(audit.record).not.toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.payment.balance.system_adjust"
      })
    );
  });

  it("does not clear a finance override merely because the handler raises above the latest suggestion, preventing a two-step decrease", async () => {
    const raised = harness();
    const financeDraft = completePayment({
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents: 1_000n,
      companyPaymentAmountCents: 7_000n,
      balanceOverrideReason: "财务指定保留现金"
    });
    raised.tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([financeDraft]);
    role(raised.tx, "material_staff");
    raised.balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "500",
      suggestedBalanceAmountCents: "500"
    });
    raised.tx.spotProcurementPayment.update.mockResolvedValue({
      ...financeDraft,
      supplierBalanceAmountCents: 1_500n,
      companyPaymentAmountCents: 6_500n
    });

    await raised.service.updateDraft("payment-1", "material-1", {
      supplierBalanceAmountCents: "1500",
      companyPaymentAmountCents: "6500"
    });
    expect(raised.tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        balanceOverrideReason: "财务指定保留现金"
      })
    });

    const lowered = harness();
    lowered.tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...financeDraft,
          supplierBalanceAmountCents: 1_500n,
          companyPaymentAmountCents: 6_500n
        }
      ]);
    role(lowered.tx, "material_staff");
    lowered.balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "500",
      suggestedBalanceAmountCents: "500"
    });
    await expect(
      lowered.service.updateDraft("payment-1", "material-1", {
        supplierBalanceAmountCents: "700",
        companyPaymentAmountCents: "7300"
      })
    ).rejects.toThrow(
      "经办人不能把供应商余额抵扣金额降到财务主管指定金额以下，请再次提交财务主管调整"
    );
  });

  it("keeps the finance override when the handler only edits the payment note", async () => {
    const { service, tx, balance } = harness();
    const financeDraft = completePayment({
      settlementAmountCents: 8_000n,
      supplierBalanceAmountCents: 1_000n,
      companyPaymentAmountCents: 7_000n,
      balanceOverrideReason: "财务指定保留现金"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([financeDraft]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "500",
      suggestedBalanceAmountCents: "500"
    });
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...financeDraft,
      paymentNote: "只修改付款备注"
    });

    await service.updateDraft("payment-1", "material-1", {
      paymentNote: "只修改付款备注"
    });

    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({
        supplierBalanceAmountCents: 1_000n,
        balanceOverrideReason: "财务指定保留现金"
      })
    });
  });

  it("rejects submit with a fixed re-adjust message when the latest suggestion changed again", async () => {
    const { service, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        completePayment({
          settlementAmountCents: 8_000n,
          supplierBalanceAmountCents: 500n,
          companyPaymentAmountCents: 7_500n,
          balanceOverrideReason: null
        })
      ]);
    role(tx, "material_staff");
    balance.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "400",
      suggestedBalanceAmountCents: "400"
    });

    await expect(
      service.submit("payment-1", "material-1")
    ).rejects.toThrow(
      "供应商可用余额已变化，请将抵扣金额调整为最新系统建议后重新提交"
    );
    expect(balance.reserve).not.toHaveBeenCalled();
  });

  it("applicant withdrawal releases once, keeps old submission immutable and creates a new draft", async () => {
    const { service, tx, balance, approvalForms } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        { ...draftPayment, status: "approval_pending", submittedAt: new Date() }
      ])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 1,
          applicantUserId: "material-1",
          frozenNodes: []
        }
      ]);
    tx.spotProcurementPayment.update.mockResolvedValue({
      ...draftPayment,
      status: "withdrawn"
    });
    tx.spotProcurementPayment.create.mockResolvedValue({
      ...draftPayment,
      id: "payment-2",
      code: "LXCG-001-V1-P002"
    });
    role(tx, "material_staff");

    await service.withdrawApproval("payment-1", "material-1");

    expect(balance.releaseReservation).toHaveBeenCalledTimes(1);
    expect(tx.spotProcurementPayment.update).toHaveBeenCalledWith({
      where: { id: "payment-1" },
      data: expect.objectContaining({ status: "withdrawn" })
    });
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ submittedAt: null })
      })
    );
    expect(tx.spotProcurementPayment.create).toHaveBeenCalled();
    expect(approvalForms.tryRefreshLatestForBusiness).toHaveBeenCalledWith(
      "spot_procurement_payment",
      "payment-1",
      "material-1",
      "approval.withdraw"
    );
  });

  it("aborts withdrawal before writing any approval or payment fact when balance release fails", async () => {
    const { service, tx, balance, audit } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approval_pending",
          supplierBalanceAmountCents: 3_000n,
          companyPaymentAmountCents: 7_000n,
          submittedAt: new Date()
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 1,
          applicantUserId: "material-1",
          frozenNodes: []
        }
      ]);
    role(tx, "material_staff");
    balance.releaseReservation.mockRejectedValue(
      new ConflictException(
        "供应商余额预留状态异常，请联系财务处理"
      )
    );

    await expect(
      service.withdrawApproval("payment-1", "material-1")
    ).rejects.toThrow("供应商余额预留状态异常，请联系财务处理");

    expect(balance.releaseReservation).toHaveBeenCalledWith(
      tx,
      {
        paymentId: "payment-1",
        expectedAmountCents: 3_000n,
        expectedProjectId: "project-1",
        expectedSupplierKey: "party:party-1",
        actorUserId: "material-1",
        reason: "采购经办人撤回付款审批"
      }
    );
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.update).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("voids a non-executed approved payment and releases its balance reservation", async () => {
    const { service, tx, balance, audit, approvalForms } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approved_pending_payment",
          submittedAt: new Date(),
          approvedAt: new Date()
        }
      ]);
    role(tx, "finance_director");
    tx.spotProcurementPayment.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.voidPayment(
      "payment-1",
      "finance-1",
      "采购已取消"
    );

    expect(result.status).toBe("voided");
    expect(tx.spotProcurementPayment.updateMany).toHaveBeenCalledWith({
      where: {
        id: "payment-1",
        status: "approved_pending_payment"
      },
      data: expect.objectContaining({
        status: "voided",
        invalidatedByUserId: "finance-1",
        invalidatedReason: "采购已取消"
      })
    });
    expect(balance.releaseReservation).toHaveBeenCalledWith(
      tx,
      {
        paymentId: "payment-1",
        expectedAmountCents: 0n,
        expectedProjectId: "project-1",
        expectedSupplierKey: "party:party-1",
        actorUserId: "finance-1",
        reason: "付款申请作废：采购已取消"
      }
    );
    expect(approvalForms.tryRefreshLatestForBusiness).toHaveBeenCalledWith(
      "spot_procurement_payment",
      "payment-1",
      "finance-1",
      "approval.void"
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.payment.void",
        metadata: expect.objectContaining({
          fromStatus: "approved_pending_payment",
          reason: "采购已取消"
        })
      })
    );
  });

  it("aborts voiding before writing any terminal fact when balance release fails", async () => {
    const { service, tx, balance, audit } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        {
          ...draftPayment,
          status: "approved_pending_payment",
          supplierBalanceAmountCents: 3_000n,
          companyPaymentAmountCents: 7_000n,
          submittedAt: new Date(),
          approvedAt: new Date()
        }
      ]);
    role(tx, "finance_director");
    balance.releaseReservation.mockRejectedValue(
      new ConflictException(
        "供应商余额预留状态异常，请联系财务处理"
      )
    );

    await expect(
      service.voidPayment("payment-1", "finance-1", "采购已取消")
    ).rejects.toThrow("供应商余额预留状态异常，请联系财务处理");

    expect(balance.releaseReservation).toHaveBeenCalledWith(
      tx,
      {
        paymentId: "payment-1",
        expectedAmountCents: 3_000n,
        expectedProjectId: "project-1",
        expectedSupplierKey: "party:party-1",
        actorUserId: "finance-1",
        reason: "付款申请作废：采购已取消"
      }
    );
    expect(tx.spotProcurementPayment.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalInstance.updateMany).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    "returned",
    "rejected",
    "withdrawn",
    "voided",
    "invalidated"
  ])("keeps terminal payment status %s immutable during void", async (status) => {
    const { service, tx, balance } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([{ ...draftPayment, status }]);
    role(tx, "finance_director");

    await expect(
      service.voidPayment("payment-1", "finance-1", "不得覆盖终态")
    ).rejects.toThrow("当前付款申请状态不允许作废");
    expect(balance.releaseReservation).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.updateMany).not.toHaveBeenCalled();
  });

  it("stops voiding when the payment or approval state CAS loses a concurrent race", async () => {
    const paymentRace = harness();
    paymentRace.tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        { ...draftPayment, status: "approved_pending_payment" }
      ]);
    role(paymentRace.tx, "finance_director");
    paymentRace.tx.spotProcurementPayment.updateMany.mockResolvedValue({
      count: 0
    });
    await expect(
      paymentRace.service.voidPayment(
        "payment-1",
        "finance-1",
        "并发测试"
      )
    ).rejects.toThrow("付款状态已变化，请重试付款作废");
    expect(paymentRace.balance.releaseReservation).toHaveBeenCalledWith(
      paymentRace.tx,
      {
        paymentId: "payment-1",
        expectedAmountCents: 0n,
        expectedProjectId: "project-1",
        expectedSupplierKey: "party:party-1",
        actorUserId: "finance-1",
        reason: "付款申请作废：并发测试"
      }
    );

    const approvalRace = harness();
    approvalRace.tx.approvalInstance.updateMany.mockResolvedValue({
      count: 0
    });
    approvalRace.tx.$queryRaw
      .mockResolvedValueOnce([version])
      .mockResolvedValueOnce([
        { ...draftPayment, status: "approval_pending" }
      ])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          applicantUserId: "material-1",
          frozenNodes: []
        }
      ]);
    role(approvalRace.tx, "finance_director");
    await expect(
      approvalRace.service.voidPayment(
        "payment-1",
        "finance-1",
        "并发测试"
      )
    ).rejects.toThrow("付款审批状态已变化，请重试付款作废");
    expect(approvalRace.balance.releaseReservation).toHaveBeenCalledWith(
      approvalRace.tx,
      {
        paymentId: "payment-1",
        expectedAmountCents: 0n,
        expectedProjectId: "project-1",
        expectedSupplierKey: "party:party-1",
        actorUserId: "finance-1",
        reason: "付款申请作废：并发测试"
      }
    );
  });

  it("does not expose a direct version-invalidation shortcut for active payments", () => {
    const { service } = harness();
    expect(
      (
        service as unknown as {
          invalidateForVersionChange?: unknown;
        }
      ).invalidateForVersionChange
    ).toBeUndefined();
  });

  it("records a partial company payment by current-project finance staff and preserves supplier-balance facts", async () => {
    const current = executionHarness();
    const input = validExecutionInput();

    const result = await current.service.recordExecution(
      "payment-1",
      "finance-1",
      input
    );

    expect(current.auth.confirmPassword).toHaveBeenCalledWith(
      "finance-1",
      "Current@123"
    );
    expect(
      current.files.assertCanDownloadFileById
    ).toHaveBeenCalledWith("file-voucher", "finance-1");
    expect(current.files.assertCanDownloadFile).toHaveBeenCalledWith(
      current.tx,
      "file-voucher",
      "finance-1"
    );
    expect(
      current.tx.spotProcurementPaymentExecution.create
    ).toHaveBeenCalledWith({
      data: {
        paymentId: "payment-1",
        amountCents: 4_000n,
        paidAt: new Date(input.paidAt),
        paymentMethod: "bank_transfer",
        executedByUserId: "finance-1",
        voucherFileId: "file-voucher",
        idempotencyKey: "spot-execution-key-1"
      }
    });
    expect(
      current.tx.spotProcurementPayment.updateMany
    ).toHaveBeenCalledWith({
      where: {
        id: "payment-1",
        status: "approved_pending_payment",
        paidAmountCents: 0n,
        companyPaymentAmountCents: 10_000n,
        canceledCompanyPaymentAmountCents: 0n
      },
      data: {
        paidAmountCents: 4_000n,
        status: "partially_paid"
      }
    });
    expect(
      current.tx.spotProcurementPayment.updateMany
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          executedSupplierBalanceAmountCents: expect.anything()
        })
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({
          id: "execution-1",
          amountCents: "4000",
          voucherFileId: "file-voucher"
        }),
        payment: expect.objectContaining({
          id: "payment-1",
          status: "partially_paid",
          paidAmountCents: "4000",
          remainingCompanyPaymentAmountCents: "6000"
        })
      })
    );
    const auditInput = current.audit.record.mock.calls.at(-1)?.[1] as {
      metadata?: Record<string, unknown>;
    };
    expect(auditInput.metadata).toEqual(
      expect.objectContaining({
        executionId: "execution-1",
        amountCents: "4000",
        paymentMethod: "bank_transfer",
        voucherFileId: "file-voucher",
        paidAmountCents: "4000",
        remainingCompanyPaymentAmountCents: "6000",
        projectCashBefore: expect.any(Object),
        projectCashAfter: expect.any(Object)
      })
    );
    expect(auditInput.metadata?.projectCashBefore).toEqual({
      actualReceiptsCents: "10000",
      supplierRefundsCents: "0",
      actualPaidCents: "0",
      occupiedCents: "10000",
      availableCents: "0"
    });
    expect(auditInput.metadata?.projectCashAfter).toEqual({
      actualReceiptsCents: "10000",
      supplierRefundsCents: "0",
      actualPaidCents: "4000",
      occupiedCents: "6000",
      availableCents: "0"
    });
    expect(JSON.stringify(auditInput)).not.toContain("Current@123");
    expect(current.approvalForms.tryRefreshLatestForBusiness).toHaveBeenCalledWith(
      "spot_procurement_payment",
      "payment-1",
      "finance-1",
      "payment.execution.record"
    );
    expect(current.prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      current.approvalForms.tryRefreshLatestForBusiness.mock.invocationCallOrder[0]
    );
  });

  it("converts the current payment's own outstanding occupation into paid cash and keeps a company-only payment at paid", async () => {
    const current = executionHarness();
    current.tx.spotProcurementPaymentExecution.create.mockResolvedValue({
      id: "execution-full",
      paymentId: "payment-1",
      amountCents: 10_000n,
      paidAt: new Date(),
      paymentMethod: "cash",
      executedByUserId: "finance-1",
      voucherFileId: "file-voucher",
      idempotencyKey: "spot-execution-full",
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      createdAt: new Date()
    });

    const result = await current.service.recordExecution(
      "payment-1",
      "finance-1",
      validExecutionInput({
        amountCents: "10000",
        paymentMethod: "cash",
        idempotencyKey: "spot-execution-full"
      })
    );

    expect(result.payment.status).toBe("paid");
    expect(
      current.tx.spotProcurementPayment.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          paidAmountCents: 10_000n,
          status: "paid"
        }
      })
    );
  });

  it("settles when company payment is recorded after the approved supplier balance was already executed", async () => {
    const current = executionHarness({
      payment: approvedExecutionPayment({
        settlementAmountCents: 10_000n,
        supplierBalanceAmountCents: 4_000n,
        companyPaymentAmountCents: 6_000n,
        executedSupplierBalanceAmountCents: 4_000n
      })
    });
    current.tx.spotProcurementPaymentExecution.create.mockResolvedValue({
      id: "execution-after-balance",
      paymentId: "payment-1",
      amountCents: 6_000n,
      paidAt: new Date(),
      paymentMethod: "bank_transfer",
      executedByUserId: "finance-1",
      voucherFileId: "file-voucher",
      idempotencyKey: "execution-after-balance",
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      createdAt: new Date()
    });

    const result = await current.service.recordExecution(
      "payment-1",
      "finance-1",
      validExecutionInput({
        amountCents: "6000",
        idempotencyKey: "execution-after-balance"
      })
    );

    expect(result.payment.status).toBe("settled");
    expect(
      current.tx.spotProcurementPayment.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          paidAmountCents: 6_000n,
          status: "settled"
        }
      })
    );
  });

  it("keeps actual payment arithmetic exact above the JavaScript safe-integer boundary", async () => {
    const amountCents = 9_007_199_254_740_993n;
    const paidAt = new Date(Date.now() - 60_000);
    const current = executionHarness({
      payment: approvedExecutionPayment({
        settlementAmountCents: amountCents,
        companyPaymentAmountCents: amountCents
      }),
      receipts: [amountCents]
    });
    current.tx.spotProcurementPaymentExecution.create.mockResolvedValue({
      id: "execution-bigint",
      paymentId: "payment-1",
      amountCents,
      paidAt,
      paymentMethod: "bank_transfer",
      executedByUserId: "finance-1",
      voucherFileId: "file-voucher",
      idempotencyKey: "spot-execution-bigint",
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      createdAt: new Date()
    });

    const result = await current.service.recordExecution(
      "payment-1",
      "finance-1",
      validExecutionInput({
        amountCents: amountCents.toString(),
        paidAt: paidAt.toISOString(),
        idempotencyKey: "spot-execution-bigint"
      })
    );

    expect(
      current.tx.spotProcurementPayment.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          paidAmountCents: amountCents,
          status: "paid"
        }
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({
          amountCents: amountCents.toString()
        }),
        payment: expect.objectContaining({
          paidAmountCents: amountCents.toString(),
          remainingCompanyPaymentAmountCents: "0"
        })
      })
    );
  });

  it("blocks payment when project cash excluding the current payment's own occupation is insufficient and writes nothing", async () => {
    const current = executionHarness({ receipts: [9_000n] });

    await expect(
      current.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput({ amountCents: "10000" })
      )
    ).rejects.toThrow(
      "项目现金不足，当前最多可实际支付 9000 分"
    );
    expect(
      current.tx.spotProcurementPaymentExecution.create
    ).not.toHaveBeenCalled();
    expect(
      current.tx.spotProcurementPayment.updateMany
    ).not.toHaveBeenCalled();
    expect(current.audit.record).not.toHaveBeenCalled();
  });

  it("requires project-scoped finance staff and does not grant execution to global finance staff or finance director", async () => {
    const globalOnly = executionHarness({
      projectRoles: [],
      globalRoles: ["finance_staff"]
    });
    await expect(
      globalOnly.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput()
      )
    ).rejects.toThrow(
      "只有当前项目财务人员可以登记零星采购实际付款"
    );

    const director = executionHarness({
      projectRoles: ["finance_director"]
    });
    await expect(
      director.service.recordExecution(
        "payment-1",
        "finance-director-1",
        validExecutionInput()
      )
    ).rejects.toThrow(
      "只有当前项目财务人员可以登记零星采购实际付款"
    );
    expect(
      director.tx.spotProcurementPaymentExecution.create
    ).not.toHaveBeenCalled();
  });

  it("rejects future dates, zero amounts, inactive vouchers and non-payable statuses before ledger writes", async () => {
    const future = executionHarness();
    await expect(
      future.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput({
          paidAt: new Date(Date.now() + 60_000).toISOString()
        })
      )
    ).rejects.toThrow("实付日期不能晚于当前时间");

    const zero = executionHarness();
    await expect(
      zero.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput({ amountCents: "0" })
      )
    ).rejects.toThrow("实付金额必须大于 0");

    const inactiveVoucher = executionHarness();
    inactiveVoucher.tx.fileObject.findUnique.mockResolvedValue({
      id: "file-voucher",
      storageStatus: "replaced",
      uploadedByUserId: "finance-1"
    });
    await expect(
      inactiveVoucher.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput()
      )
    ).rejects.toThrow("付款凭证当前不可用");

    const draft = executionHarness({
      payment: approvedExecutionPayment({ status: "approval_pending" })
    });
    await expect(
      draft.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput()
      )
    ).rejects.toThrow("当前付款申请尚未批准，不能登记实际付款");

    for (const current of [future, zero, inactiveVoucher, draft]) {
      expect(
        current.tx.spotProcurementPaymentExecution.create
      ).not.toHaveBeenCalled();
      expect(
        current.tx.spotProcurementPayment.updateMany
      ).not.toHaveBeenCalled();
    }
  });

  it("returns the same execution for an exact idempotent retry and rejects changed facts or actor", async () => {
    const paidAt = new Date(
      validExecutionInput().paidAt
    );
    const exact = executionHarness();
    exact.tx.spotProcurementPaymentExecution.findUnique.mockResolvedValue({
      id: "execution-existing",
      paymentId: "payment-1",
      amountCents: 4_000n,
      paidAt,
      paymentMethod: "bank_transfer",
      executedByUserId: "finance-1",
      voucherFileId: "file-voucher",
      idempotencyKey: "spot-execution-key-1",
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      createdAt: new Date()
    });
    const result = await exact.service.recordExecution(
      "payment-1",
      "finance-1",
      validExecutionInput({ paidAt: paidAt.toISOString() })
    );
    expect(result.execution.id).toBe("execution-existing");
    expect(
      exact.tx.spotProcurementPaymentExecution.create
    ).not.toHaveBeenCalled();
    expect(
      exact.tx.spotProcurementPayment.updateMany
    ).not.toHaveBeenCalled();
    expect(exact.audit.record).not.toHaveBeenCalled();

    const changed = executionHarness();
    changed.tx.spotProcurementPaymentExecution.findUnique.mockResolvedValue({
      id: "execution-existing",
      paymentId: "payment-1",
      amountCents: 3_000n,
      paidAt,
      paymentMethod: "bank_transfer",
      executedByUserId: "finance-1",
      voucherFileId: "file-voucher",
      idempotencyKey: "spot-execution-key-1",
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      createdAt: new Date()
    });
    await expect(
      changed.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput({ paidAt: paidAt.toISOString() })
      )
    ).rejects.toThrow("幂等键已用于不同的实际付款事实");

    const actor = executionHarness();
    actor.tx.spotProcurementPaymentExecution.findUnique.mockResolvedValue({
      id: "execution-existing",
      paymentId: "payment-1",
      amountCents: 4_000n,
      paidAt,
      paymentMethod: "bank_transfer",
      executedByUserId: "other-finance",
      voucherFileId: "file-voucher",
      idempotencyKey: "spot-execution-key-1",
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      createdAt: new Date()
    });
    await expect(
      actor.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput({ paidAt: paidAt.toISOString() })
      )
    ).rejects.toThrow("幂等键已用于不同的实际付款事实");

    const otherPayment = executionHarness();
    otherPayment.tx.spotProcurementPaymentExecution.findUnique.mockResolvedValue({
      id: "execution-existing",
      paymentId: "payment-2",
      amountCents: 4_000n,
      paidAt,
      paymentMethod: "bank_transfer",
      executedByUserId: "finance-1",
      voucherFileId: "file-voucher",
      idempotencyKey: "spot-execution-key-1",
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      createdAt: new Date()
    });
    await expect(
      otherPayment.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput({ paidAt: paidAt.toISOString() })
      )
    ).rejects.toThrow("幂等键已用于不同的实际付款事实");
  });

  it("rejects a voucher already bound to another active execution and reconciles paid ledger facts before writing", async () => {
    const duplicateVoucher = executionHarness();
    duplicateVoucher.tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue(
      {
        id: "execution-other",
        paymentId: "payment-2",
        voucherFileId: "file-voucher"
      }
    );
    await expect(
      duplicateVoucher.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput()
      )
    ).rejects.toThrow("该付款凭证已绑定其他有效实际付款记录");

    const mismatch = executionHarness({
      payment: approvedExecutionPayment({
        status: "partially_paid",
        paidAmountCents: 2_000n
      }),
      activeExecutions: [{ id: "old-execution", amountCents: 1_000n }]
    });
    await expect(
      mismatch.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput()
      )
    ).rejects.toThrow(
      "付款累计已付与实际付款明细不一致，请联系财务核对"
    );
    expect(
      mismatch.tx.spotProcurementPaymentExecution.create
    ).not.toHaveBeenCalled();
  });

  it("rejects execution above the effective company amount after cancellation", async () => {
    const current = executionHarness({
      payment: approvedExecutionPayment({
        companyPaymentAmountCents: 10_000n,
        canceledCompanyPaymentAmountCents: 3_000n
      }),
      receipts: [10_000n]
    });

    await expect(
      current.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput({ amountCents: "7001" })
      )
    ).rejects.toThrow(
      "实付金额超过剩余公司付款额度，当前最多可实付 7000 分"
    );
    expect(
      current.tx.spotProcurementPaymentExecution.create
    ).not.toHaveBeenCalled();
  });

  it("excludes supplier balance from project cash even when it is most of the settlement", async () => {
    const current = executionHarness({
      payment: approvedExecutionPayment({
        settlementAmountCents: 10_000n,
        supplierBalanceAmountCents: 9_000n,
        companyPaymentAmountCents: 1_000n
      }),
      receipts: [1_000n]
    });
    current.tx.spotProcurementPaymentExecution.create.mockResolvedValue({
      id: "execution-balance-separated",
      paymentId: "payment-1",
      amountCents: 1_000n,
      paidAt: new Date(),
      paymentMethod: "cash",
      executedByUserId: "finance-1",
      voucherFileId: "file-voucher",
      idempotencyKey: "balance-separated",
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      createdAt: new Date()
    });

    const result = await current.service.recordExecution(
      "payment-1",
      "finance-1",
      validExecutionInput({
        amountCents: "1000",
        paymentMethod: "cash",
        idempotencyKey: "balance-separated"
      })
    );

    expect(result.payment.status).toBe("paid");
    expect(
      current.tx.spotProcurementPayment.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          paidAmountCents: 1_000n,
          status: "paid"
        }
      })
    );
  });

  it("fails before the transaction when password confirmation or file authorization fails", async () => {
    const password = executionHarness();
    password.auth.confirmPassword.mockRejectedValue(
      new ForbiddenException("当前密码不正确，请重新输入")
    );
    await expect(
      password.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput()
      )
    ).rejects.toThrow("当前密码不正确，请重新输入");
    expect(password.prisma.$transaction).not.toHaveBeenCalled();

    const file = executionHarness();
    file.files.assertCanDownloadFileById.mockRejectedValue(
      new ForbiddenException("当前账号无权下载该资料")
    );
    await expect(
      file.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput()
      )
    ).rejects.toThrow("当前账号无权下载该资料");
    expect(file.auth.confirmPassword).not.toHaveBeenCalled();
    expect(file.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back execution and audit when the payment CAS loses a race", async () => {
    const current = executionHarness();
    current.tx.spotProcurementPayment.updateMany.mockResolvedValue({
      count: 0
    });

    await expect(
      current.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput()
      )
    ).rejects.toThrow(
      "付款状态或已付金额已变化，请刷新后重试"
    );
    expect(
      current.tx.spotProcurementPaymentExecution.create
    ).toHaveBeenCalled();
    expect(current.audit.record).not.toHaveBeenCalled();
  });

  it("safely reads back an exact concurrent idempotent winner and distinguishes voucher uniqueness", async () => {
    const exact = executionHarness();
    const paidAt = new Date(
      validExecutionInput().paidAt
    );
    exact.prisma.$transaction.mockRejectedValueOnce({
      code: "P2002"
    });
    exact.prisma.spotProcurementPaymentExecution.findUnique.mockResolvedValue(
      {
        id: "execution-concurrent",
        paymentId: "payment-1",
        amountCents: 4_000n,
        paidAt,
        paymentMethod: "bank_transfer",
        executedByUserId: "finance-1",
        voucherFileId: "file-voucher",
        idempotencyKey: "spot-execution-key-1",
        voidedAt: null,
        voidedByUserId: null,
        voidReason: null,
        createdAt: new Date()
      }
    );
    exact.prisma.spotProcurementPayment.findUnique.mockResolvedValue({
      id: "payment-1",
      status: "partially_paid",
      paidAmountCents: 4_000n,
      companyPaymentAmountCents: 10_000n,
      canceledCompanyPaymentAmountCents: 0n
    });

    await expect(
      exact.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput({ paidAt: paidAt.toISOString() })
      )
    ).resolves.toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({
          id: "execution-concurrent"
        }),
        payment: expect.objectContaining({
          paidAmountCents: "4000"
        })
      })
    );

    const voucher = executionHarness();
    voucher.prisma.$transaction.mockRejectedValueOnce({
      code: "P2002"
    });
    voucher.prisma.spotProcurementPaymentExecution.findFirst.mockResolvedValue(
      { id: "execution-other" }
    );
    await expect(
      voucher.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput()
      )
    ).rejects.toThrow(
      "该付款凭证已绑定其他有效实际付款记录"
    );

    const serializedRetry = executionHarness();
    serializedRetry.prisma.$transaction.mockRejectedValueOnce({
      code: "P2034"
    });
    serializedRetry.prisma.spotProcurementPaymentExecution.findUnique.mockResolvedValue(
      {
        id: "execution-serialized-winner",
        paymentId: "payment-1",
        amountCents: 4_000n,
        paidAt,
        paymentMethod: "bank_transfer",
        executedByUserId: "finance-1",
        voucherFileId: "file-voucher",
        idempotencyKey: "spot-execution-key-1",
        voidedAt: null,
        voidedByUserId: null,
        voidReason: null,
        createdAt: new Date()
      }
    );
    serializedRetry.prisma.spotProcurementPayment.findUnique.mockResolvedValue(
      {
        id: "payment-1",
        status: "partially_paid",
        paidAmountCents: 4_000n,
        companyPaymentAmountCents: 10_000n,
        canceledCompanyPaymentAmountCents: 0n
      }
    );
    await expect(
      serializedRetry.service.recordExecution(
        "payment-1",
        "finance-1",
        validExecutionInput({ paidAt: paidAt.toISOString() })
      )
    ).resolves.toEqual(
      expect.objectContaining({
        execution: expect.objectContaining({
          id: "execution-serialized-winner"
        })
      })
    );
  });

  it.each([
    ["P2003", "实际付款关联数据已变化，请刷新后重试"],
    ["P2025", "实际付款关联数据已变化，请刷新后重试"],
    ["P2034", "实际付款并发冲突，请刷新后重试"]
  ])(
    "maps actual execution Prisma %s to fixed Chinese errors",
    async (code, message) => {
      const current = executionHarness();
      current.prisma.$transaction.mockRejectedValueOnce({ code });

      await expect(
        current.service.recordExecution(
          "payment-1",
          "finance-1",
          validExecutionInput()
        )
      ).rejects.toThrow(message);
    }
  );

  it.each(["P2002", "P2003", "P2025", "P2034"])(
    "maps Prisma %s without exposing technical details",
    async (code) => {
      const { service, prisma } = harness();
      prisma.$transaction.mockRejectedValueOnce({ code });

      await expect(
        service.submit("payment-1", "material-1")
      ).rejects.toThrow(
        code === "P2034"
          ? "付款或供应商余额已变化，请刷新后重试"
          : "零星采购付款数据已变化，请刷新后重试"
      );
    }
  );

  it.each(["40001", "40P01"])(
    "normalizes raw PostgreSQL P2010/%s to the same concurrency conflict",
    async (postgresCode) => {
      const { service, prisma } = harness();
      prisma.$transaction.mockRejectedValueOnce({
        code: "P2010",
        meta: {
          code: postgresCode,
          message: "concurrent transaction conflict"
        }
      });

      await expect(
        service.submit("payment-1", "material-1")
      ).rejects.toThrow(
        "付款或供应商余额已变化，请刷新后重试"
      );
    }
  );

  it.each(["40001", "40P01"])(
    "normalizes actual-payment P2010/%s to the fixed execution concurrency conflict",
    async (postgresCode) => {
      const current = executionHarness();
      current.prisma.$transaction.mockRejectedValueOnce({
        code: "P2010",
        meta: {
          code: postgresCode,
          message: "concurrent transaction conflict"
        }
      });

      await expect(
        current.service.recordExecution(
          "payment-1",
          "finance-1",
          validExecutionInput()
        )
      ).rejects.toThrow(
        "实际付款并发冲突，请刷新后重试"
      );
    }
  );
});
