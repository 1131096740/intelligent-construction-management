import { ForbiddenException } from "@nestjs/common";
import {
  deriveSpotPaymentCurrentTask,
  SpotProcurementReadService
} from "./spot-procurement-read.service";
import * as spotProcurementMoney from "./spot-procurement-money";

const now = new Date("2026-07-17T08:00:00.000Z");

function procurementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "procurement-1",
    projectId: "project-1",
    code: "LXCG-2026-001",
    supplierPartyId: "party-1",
    supplierKey: "party:party-1",
    supplierNameSnapshot: "昆明建材门市",
    applicantUserId: "applicant-1",
    handlerUserId: "handler-1",
    currentVersionId: "version-1",
    status: "approved_in_progress",
    approvedAmountCents: 12_345n,
    actualCostCents: null,
    closedAt: null,
    voidedAt: null,
    voidedByUserId: null,
    voidReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    procurementId: "procurement-1",
    versionNo: 1,
    status: "approved",
    reason: "现场砌筑临时补料",
    note: "当天送达",
    supplierPartyId: "party-1",
    supplierKey: "party:party-1",
    supplierNameSnapshot: "昆明建材门市",
    handlerUserId: "handler-1",
    totalAmountCents: 12_345n,
    changeReason: null,
    changeSummary: null,
    submittedAt: now,
    approvedAt: now,
    createdByUserId: "applicant-1",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    projectId: "project-1",
    procurementId: "procurement-1",
    procurementVersionId: "version-1",
    code: "LXFK-2026-001",
    status: "partially_paid",
    settlementAmountCents: 12_345n,
    supplierBalanceAmountCents: 345n,
    companyPaymentAmountCents: 12_000n,
    paidAmountCents: 5_000n,
    executedSupplierBalanceAmountCents: 345n,
    canceledAmountCents: 0n,
    canceledCompanyPaymentAmountCents: 0n,
    canceledSupplierBalanceAmountCents: 0n,
    paymentPath: "supplier_direct",
    paymentMethod: "bank_transfer",
    paymentType: null,
    merchantNameSnapshot: null,
    merchantPayeeMismatchNote: null,
    payeePartyId: "party-1",
    payeeUserId: null,
    payeeNameSnapshot: "昆明建材门市",
    payeeAccountNameSnapshot: "昆明建材门市",
    payeeBankNameSnapshot: "某银行",
    payeeBankAccountSnapshot: "6222020202021234",
    expectedPaymentAt: now,
    paymentNote: "按审批金额付款",
    supportingAttachmentFileId: "file-support",
    merchantPaymentProofFileId: null,
    balanceOverrideReason: null,
    payerCompanyEntityId: null,
    payerCompanyNameSnapshot: null,
    payerUnifiedSocialCreditCodeSnapshot: null,
    approvalAmountCents: 0n,
    primaryPaymentChannelId: null,
    submittedVersionNo: null,
    factsFrozenAt: null,
    handlerUserId: "handler-1",
    createdByUserId: "handler-1",
    submittedAt: now,
    approvedAt: now,
    invalidatedAt: null,
    invalidatedByUserId: null,
    invalidatedReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function buildFixture() {
  const procurements = [
    procurementRow(),
    procurementRow({
      id: "procurement-denied",
      code: "LXCG-2026-002",
      currentVersionId: "version-denied"
    })
  ];
  const versions = [
    versionRow(),
    versionRow({
      id: "version-denied",
      procurementId: "procurement-denied"
    })
  ];
  const payments = [paymentRow()];
  const approval = {
    id: "approval-1",
    flowType: "spot_procurement.approve",
    businessType: "spot_procurement_version",
    businessId: "version-1",
    status: "approved",
    currentNodeIndex: 2,
    frozenNodes: [
      { name: "物资主管审批", roleKeys: ["material_director"] },
      { name: "项目经理审批", roleKeys: ["project_manager"] }
    ],
    applicantUserId: "applicant-1",
    createdAt: now,
    updatedAt: now
  };
  const paymentApproval = {
    ...approval,
    id: "approval-payment",
    businessType: "spot_procurement_payment",
    businessId: "payment-1"
  };
  const prisma = {
    project: {
      findFirst: jest.fn().mockResolvedValue({
        id: "project-1",
        code: "XM-001",
        name: "一号项目",
        isActive: true
      }),
      findMany: jest.fn().mockResolvedValue([
        { id: "project-1", code: "XM-001", name: "一号项目" }
      ])
    },
    spotProcurement: {
      findMany: jest.fn().mockResolvedValue(procurements),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(procurements.find((row) => row.id === where.id) ?? null)
      )
    },
    spotProcurementVersion: {
      findMany: jest.fn().mockResolvedValue(versions),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(versions.find((row) => row.id === where.id) ?? null)
      )
    },
    spotProcurementLine: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "line-1",
          versionId: "version-1",
          sortOrder: 1,
          materialName: "免烧砖",
          specification: "240×115×53",
          unit: "块",
          quantity: { toString: () => "100" },
          invoiceMode: "invoice",
          invoiceType: "vat_general",
          vatRateOptionId: "vat-1",
          vatRateValueSnapshot: { toString: () => "0.13" },
          vatRateLabelSnapshot: "13%",
          unitPrice: { toString: () => "1.2" },
          amountCents: 12_000n,
          usageLocation: "二层砌体",
          note: "免烧砖",
          createdAt: now
        },
        {
          id: "line-2",
          versionId: "version-1",
          sortOrder: 2,
          materialName: "零配件",
          specification: null,
          unit: "套",
          quantity: { toString: () => "1" },
          invoiceMode: "no_invoice",
          invoiceType: null,
          vatRateOptionId: null,
          vatRateValueSnapshot: null,
          vatRateLabelSnapshot: null,
          unitPrice: { toString: () => "3.45" },
          amountCents: 345n,
          usageLocation: null,
          note: null,
          createdAt: now
        }
      ])
    },
    spotProcurementAttachment: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPayment: {
      findMany: jest.fn().mockResolvedValue(payments),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(payments.find((row) => row.id === where.id) ?? null)
      )
    },
    spotProcurementPaymentExecution: {
      findFirst: jest.fn().mockResolvedValue({ id: "execution-1" }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: "execution-1",
          paymentId: "payment-1",
          amountCents: 5_000n,
          paidAt: now,
          paymentMethod: "bank_transfer",
          executedByUserId: "finance-1",
          voucherFileId: "voucher-1",
          idempotencyKey: "idem-1",
          voidedAt: null,
          voidedByUserId: null,
          voidReason: null,
          createdAt: now
        }
      ])
    },
    spotProcurementPaymentLine: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentChannel: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentMethodOption: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentAttachment: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentExecutionVoucher: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentInvoice: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementAbnormalTermination: {
      findUnique: jest.fn().mockResolvedValue(null)
    },
    spotProcurementPaymentArchive: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementPaymentArchiveFile: {
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementReceiptRevision: {
      findUnique: jest.fn().mockResolvedValue({
        submittedAt: null,
        note: null,
        actualCostCents: 0n
      })
    },
    spotProcurementReceiptDelegation: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementReceiptReview: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    spotProcurementReceiptLine: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    spotProcurementReceiptPhoto: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    invoiceAllocation: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    noInvoiceConfirmation: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    invoiceExceptionConfirmation: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    spotProcurementDiscrepancy: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementRefund: {
      findMany: jest.fn().mockResolvedValue([])
    },
    supplierBalanceReservation: {
      findMany: jest.fn().mockResolvedValue([])
    },
    approvalInstance: {
      findMany: jest.fn().mockResolvedValue([approval, paymentApproval]),
      findFirst: jest.fn(
        ({ where }: { where: { businessType: string; businessId: string } }) =>
          Promise.resolve(
            [approval, paymentApproval].find(
              (row) =>
                row.businessType === where.businessType &&
                row.businessId === where.businessId
            ) ?? null
          )
      )
    },
    approvalActionLog: {
      findMany: jest.fn().mockResolvedValue([])
    },
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: "applicant-1", name: "申请人" },
        { id: "handler-1", name: "采购经办人" },
        { id: "finance-1", name: "财务人员" }
      ])
    },
    userPosition: {
      findMany: jest.fn().mockResolvedValue([
        {
          userId: "finance-1",
          projectId: "project-1",
          positionId: "position-finance-staff"
        }
      ])
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([])
    },
    position: {
      findFirst: jest.fn().mockResolvedValue({
        id: "position-finance-staff"
      }),
      findMany: jest.fn().mockResolvedValue([
        { id: "position-finance-staff", key: "finance_staff" }
      ])
    },
    fileObject: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "file-support",
          originalName: "付款说明.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          storageStatus: "active",
          uploadedByUserId: "handler-1",
          createdAt: now
        },
        {
          id: "voucher-1",
          originalName: "付款凭证.png",
          mimeType: "image/png",
          sizeBytes: 2048,
          storageStatus: "active",
          uploadedByUserId: "finance-1",
          createdAt: now
        }
      ])
    },
    pdfDocument: {
      findFirst: jest.fn().mockResolvedValue(null)
    }
  };
  const visibility = {
    visibleProjectIds: jest.fn().mockResolvedValue(["project-1"]),
    effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"])
  };
  const access = {
    resolveProcurementViewAccess: jest.fn((procurementId: string) =>
      Promise.resolve(procurementId === "procurement-1" ? "allowed" : "denied")
    ),
    resolvePaymentViewAccess: jest.fn().mockResolvedValue("allowed"),
    accessibleProcurementIds: jest.fn((procurementIds: string[]) =>
      Promise.resolve(
        new Set(
          procurementIds.filter(
            (procurementId) => procurementId === "procurement-1"
          )
        )
      )
    ),
    accessiblePaymentIds: jest.fn((paymentIds: string[]) =>
      Promise.resolve(new Set(paymentIds))
    )
  };
  const pilot = { isEnabled: jest.fn().mockReturnValue(true) };
  return { prisma, visibility, access, pilot };
}

describe("SpotProcurementReadService", () => {
  it("exposes frozen review coordinates only to the legal non-applicant reviewer", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurement.findUnique.mockResolvedValue(
      procurementRow({
        status: "approval_pending",
        applicantUserId: "applicant-1"
      })
    );
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      versionRow({
        status: "approval_pending",
        submittedAt: now,
        approvedAt: null
      })
    ]);
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);
    fixture.prisma.approvalInstance.findMany.mockResolvedValue([
      {
        id: "approval-1",
        flowType: "spot_procurement.approve",
        businessType: "spot_procurement_version",
        businessId: "version-1",
        status: "approval_pending",
        currentNodeIndex: 0,
        frozenNodes: [
          {
            name: "物资主管审批",
            mode: "any",
            roleKeys: ["material_director"]
          }
        ],
        applicantUserId: "applicant-1",
        createdAt: now,
        updatedAt: now
      }
    ]);
    fixture.visibility.effectiveRoleKeys.mockResolvedValue([
      "material_director"
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const reviewer = await service.getProcurement(
      "procurement-1",
      "material-director-1"
    );
    expect(reviewer.reviewApprovalContext).toEqual({
      expectedVersionId: "version-1",
      expectedApprovalInstanceId: "approval-1",
      expectedNodeIndex: 0
    });
    expect(
      reviewer.availableActions.find(
        (action) => action.key === "review_approval"
      )
    ).toMatchObject({ enabled: true });

    fixture.visibility.effectiveRoleKeys.mockResolvedValue(["employee"]);
    const observer = await service.getProcurement(
      "procurement-1",
      "observer-1"
    );
    expect(observer.reviewApprovalContext).toBeNull();
    expect(observer.approval).not.toHaveProperty("approvalInstanceId");
    expect(observer.approval).not.toHaveProperty("currentNodeIndex");

    fixture.visibility.effectiveRoleKeys.mockResolvedValue([
      "material_director"
    ]);
    const applicant = await service.getProcurement(
      "procurement-1",
      "applicant-1"
    );
    expect(applicant.reviewApprovalContext).toBeNull();
  });

  it("fails the review capability closed when the current version has duplicate pending approvals", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurement.findUnique.mockResolvedValue(
      procurementRow({
        status: "approval_pending",
        applicantUserId: "applicant-1"
      })
    );
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      versionRow({
        status: "approval_pending",
        submittedAt: now,
        approvedAt: null
      })
    ]);
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);
    fixture.prisma.approvalInstance.findMany.mockResolvedValue([
      {
        id: "approval-2",
        flowType: "spot_procurement.approve",
        businessType: "spot_procurement_version",
        businessId: "version-1",
        status: "approval_pending",
        currentNodeIndex: 0,
        frozenNodes: [
          {
            name: "物资主管审批",
            mode: "any",
            roleKeys: ["material_director"]
          }
        ],
        applicantUserId: "applicant-1",
        createdAt: new Date("2026-07-17T09:00:00.000Z"),
        updatedAt: new Date("2026-07-17T09:00:00.000Z")
      },
      {
        id: "approval-1",
        flowType: "spot_procurement.approve",
        businessType: "spot_procurement_version",
        businessId: "version-1",
        status: "approval_pending",
        currentNodeIndex: 0,
        frozenNodes: [
          {
            name: "物资主管审批",
            mode: "any",
            roleKeys: ["material_director"]
          }
        ],
        applicantUserId: "applicant-1",
        createdAt: now,
        updatedAt: now
      }
    ]);
    fixture.visibility.effectiveRoleKeys.mockResolvedValue([
      "material_director"
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const detail = await service.getProcurement(
      "procurement-1",
      "material-director-1"
    );

    expect(
      detail.availableActions.find(
        (action) => action.key === "review_approval"
      )
    ).toMatchObject({
      enabled: false,
      disabledReason: "当前采购存在多个待审批实例，请联系管理员处理"
    });
    expect(detail.reviewApprovalContext).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("approval-2");
    expect(JSON.stringify(detail)).not.toContain("approval-1");
  });

  it("returns historical three-place decimal text unchanged without applying new-write validation", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementLine.findMany.mockResolvedValue([
      {
        id: "line-historical",
        versionId: "version-1",
        sortOrder: 1,
        materialName: "历史零配件",
        specification: null,
        unit: "套",
        quantity: { toString: () => "3.335" },
        invoiceMode: "no_invoice",
        invoiceType: null,
        vatRateOptionId: null,
        vatRateValueSnapshot: null,
        vatRateLabelSnapshot: null,
        unitPrice: { toString: () => "3.335" },
        amountCents: 1_112n,
        usageLocation: null,
        note: null,
        createdAt: now
      }
    ]);
    const writeValidator = jest.spyOn(
      spotProcurementMoney,
      "isSpotProcurementQuantity"
    );
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.getProcurement(
      "procurement-1",
      "finance-1"
    );

    expect(result.lines).toEqual([
      expect.objectContaining({ quantity: "3.335", unitPrice: "3.335" })
    ]);
    expect(writeValidator).not.toHaveBeenCalled();
    writeValidator.mockRestore();
  });

  it("keeps abandoned payment drafts in the explicit closed task view", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
      paymentRow(),
      paymentRow({ id: "payment-invalidated", code: "LXFK-END-001", status: "invalidated" })
    ]);
    fixture.access.accessiblePaymentIds.mockImplementation((ids: string[]) => Promise.resolve(new Set(ids)));
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await expect(service.listPayments("finance-1", { view: "closed" })).resolves.toMatchObject({
      view: "closed",
      items: [expect.objectContaining({ id: "payment-invalidated" })]
    });
  });

  it("offers payment draft recreation only after the prior draft is invalidated and no active payment remains", async () => {
    const fixture = buildFixture();
    const invalidated = paymentRow({
      status: "invalidated",
      submittedAt: null,
      approvedAt: null,
      invalidatedAt: now,
      draftOrigin: "auto_after_procurement_approval",
      sourcePaymentId: null
    });
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([invalidated]);
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);
    fixture.prisma.approvalInstance.findMany.mockResolvedValue([
      {
        id: "approval-1",
        businessType: "spot_procurement_version",
        businessId: "version-1",
        status: "approved",
        currentNodeIndex: 1,
        frozenNodes: [],
        applicantUserId: "applicant-1",
        createdAt: now,
        updatedAt: now
      }
    ]);
    fixture.visibility.effectiveRoleKeys.mockResolvedValue(["material_staff"]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const detail = await service.getProcurement("procurement-1", "handler-1");

    expect(
      detail.availableActions.find((action) => action.key === "create_payment_draft")
    ).toMatchObject({ enabled: true });
    expect(detail.paymentSummary).toMatchObject({
      paymentCount: 0,
      activeSettlementAmountCents: "0"
    });
  });

  it("returns a server-derived receipt reset action for a note-only draft", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      versionRow({
        totalAmountCents: null,
        applicationDepartmentSnapshot: "物资部",
        applicationNameSnapshot: "采购经办人",
        purchaserNameSnapshot: "采购经办人",
        purchaserDepartmentNameSnapshot: "物资部",
        requestedArrivalAt: now
      })
    ]);
    fixture.prisma.spotProcurementReceipt.findUnique.mockResolvedValue({
      id: "receipt-1",
      procurementId: "procurement-1",
      status: "draft",
      currentRevisionNo: 3,
      handlerUserId: "handler-1",
      firstSubmittedAt: null,
      submittedAt: null,
      lockedAt: null,
      invalidatedAt: null
    });
    fixture.prisma.spotProcurementReceiptRevision.findUnique.mockResolvedValue({
      submittedAt: null,
      note: "货物已到场，明细待补",
      actualCostCents: 0n
    });
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue(
      []
    );
    fixture.visibility.effectiveRoleKeys.mockResolvedValue([
      "material_staff"
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const detail = await service.getProcurement(
      "procurement-1",
      "handler-1"
    );

    expect(detail.receipt).toMatchObject({
      openAfterActualPayment: true,
      hasActualPayment: false,
      blockedReason: null,
      workflow: {
        stage: "reset_unsubmitted_receipt",
        stageLabel: "可重置未提交收货",
        resetAction: {
          key: "reset_receipt_draft",
          enabled: true,
          disabledReason: null,
          expectedRevision: 3
        }
      }
    });
  });

  it("returns only pilot projects where the current user can create a procurement", async () => {
    const fixture = buildFixture();
    fixture.prisma.project.findMany.mockResolvedValue([
      { id: "project-1", code: "XM-001", name: "一号项目" },
      { id: "project-2", code: "XM-002", name: "二号项目" }
    ]);
    fixture.visibility.visibleProjectIds.mockResolvedValue([
      "project-1",
      "project-2"
    ]);
    fixture.visibility.effectiveRoleKeys
      .mockResolvedValueOnce(["material_staff"])
      .mockResolvedValueOnce(["employee"]);
    fixture.pilot.isEnabled.mockImplementation((projectId: string) => projectId === "project-1");
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await expect(service.createProjectOptions("material-1")).resolves.toEqual([
      { id: "project-1", code: "XM-001", name: "一号项目" }
    ]);
  });

  it("returns only centrally-authorized procurement rows and serializes money facts", async () => {
    const fixture = buildFixture();
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.listProcurements("finance-1", {});

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "procurement-1",
      approvedAmountCents: "12345",
      currentTotalAmountCents: "12345",
      invoiceComposition: "mixed",
      payment: {
        activeSettlementAmountCents: "12345",
        paidAmountCents: "5000",
        supplierBalanceAmountCents: "345"
      },
      receipt: {
        available: false,
        status: "not_available"
      },
      invoiceCoverage: {
        available: false,
        status: "not_available"
      }
    });
    expect(JSON.stringify(result)).not.toContain("12345n");
    expect(fixture.access.accessibleProcurementIds).toHaveBeenCalledWith(
      ["procurement-1", "procurement-denied"],
      "finance-1"
    );
    expect(result).toMatchObject({
      view: "active",
      pagination: { page: 1, pageSize: 20, total: 1 },
      statistics: { total: 1, byStatus: { approved_in_progress: 1 } }
    });
  });

  it("returns the server-derived parent abandonment action and exact downstream blocker", async () => {
    const fixture = buildFixture();
    const draftProcurement = procurementRow({
      status: "draft",
      applicantUserId: "handler-1",
      handlerUserId: "handler-1"
    });
    const draftVersion = versionRow({
      status: "draft",
      submittedAt: null,
      approvedAt: null
    });
    fixture.prisma.spotProcurement.findUnique.mockResolvedValue(draftProcurement);
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([draftVersion]);
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);
    fixture.prisma.approvalInstance.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementReceipt.findUnique.mockResolvedValue(null);
    fixture.prisma.spotProcurementDiscrepancy.findFirst.mockResolvedValue(null);
    fixture.prisma.spotProcurementRefund.findMany.mockResolvedValue([]);
    fixture.visibility.effectiveRoleKeys.mockResolvedValue(["material_staff"]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const pristine = await service.getProcurement("procurement-1", "handler-1");
    expect(
      pristine.availableActions.find(
        (action) => action.key === "delete_pristine_draft"
      )
    ).toMatchObject({ enabled: true, label: "删除采购草稿" });

    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([{
      ...draftVersion,
      submittedAt: now
    }]);
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([{
      ...paymentRow(),
      status: "approval_pending",
      submittedAt: now
    }]);
    const blocked = await service.getProcurement("procurement-1", "handler-1");
    expect(
      blocked.availableActions.find(
        (action) => action.key === "abandon_application"
      )
    ).toMatchObject({
      enabled: false,
      disabledReason: "已形成正式付款申请，不能放弃"
    });
  });

  it("advertises abnormal termination request and confirmation from server-owned payment and role facts", async () => {
    const fixture = buildFixture();
    fixture.visibility.effectiveRoleKeys.mockResolvedValue(["finance_staff"]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const requestable = await service.getProcurement(
      "procurement-1",
      "finance-1"
    );
    expect(
      requestable.availableActions.find(
        (action) => action.key === "request_abnormal_termination"
      )
    ).toMatchObject({
      enabled: true,
      requiredAction: "spot_procurement.abnormal_termination.request",
      requiresComment: true
    });
    expect(
      requestable.availableActions.find(
        (action) => action.key === "confirm_abnormal_termination"
      )
    ).toMatchObject({ enabled: false });

    fixture.visibility.effectiveRoleKeys.mockResolvedValue(["employee"]);
    const handlerWithoutRequiredRole = await service.getProcurement(
      "procurement-1",
      "handler-1"
    );
    expect(
      handlerWithoutRequiredRole.availableActions.find(
        (action) => action.key === "request_abnormal_termination"
      )
    ).toMatchObject({
      enabled: false,
      disabledReason: "当前岗位无权执行此动作"
    });

    fixture.prisma.spotProcurementAbnormalTermination.findUnique.mockResolvedValue({
      id: "termination-1",
      procurementId: "procurement-1",
      status: "requested",
      reason: "已付款但商户无法继续履约",
      requestedByUserId: "finance-1",
      requestedAt: now,
      confirmedByUserId: null,
      confirmedAt: null
    });
    fixture.visibility.effectiveRoleKeys.mockResolvedValue(["finance_director"]);

    const confirmable = await service.getProcurement(
      "procurement-1",
      "finance-director-1"
    );
    expect(confirmable.abnormalTermination).toMatchObject({
      id: "termination-1",
      status: "requested",
      reason: "已付款但商户无法继续履约"
    });
    expect(
      confirmable.availableActions.find(
        (action) => action.key === "request_abnormal_termination"
      )
    ).toMatchObject({ enabled: false });
    expect(
      confirmable.availableActions.find(
        (action) => action.key === "confirm_abnormal_termination"
      )
    ).toMatchObject({
      enabled: true,
      requiredAction: "spot_procurement.abnormal_termination.confirm"
    });
  });

  it("projects the shared ticket coverage into procurement and payment reads without double-counting payment attribution", async () => {
    const fixture = buildFixture();
    const procurementCoverage = {
      available: true,
      status: "partially_covered",
      label: "尚差 7345 分",
      actualCostCents: "12345",
      normalInvoiceCents: "4000",
      confirmedNoInvoiceCents: "1000",
      confirmedExceptionCents: "0",
      effectiveCoveredCents: "5000",
      remainingCents: "7345",
      pendingCount: 0
    };
    const paymentCoverage = {
      ...procurementCoverage,
      paymentAttribution: {
        normalInvoiceCents: "4000",
        confirmedNoInvoiceCents: "0",
        confirmedExceptionCents: "0",
        attributedCents: "4000",
        pendingCount: 0,
        countsTowardProcurementCoverageAgain: false
      }
    };
    const procurementLedgerDetail = {
      available: true,
      currentCoordinates: {
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        receiptId: "receipt-1",
        receiptRevisionNo: 1
      },
      invoices: [{ id: "invoice-1", lines: [] }],
      allocations: [{ id: "allocation-1", status: "active" }],
      noInvoiceConfirmations: [
        { id: "no-invoice-1", status: "pending_review" }
      ],
      invoiceExceptions: []
    };
    const paymentLedgerDetail = {
      ...procurementLedgerDetail,
      paymentId: "payment-1",
      paymentCurrent: true
    };
    const invoiceLedger = {
      coverageForProcurementIds: jest
        .fn()
        .mockResolvedValue(
          new Map([["procurement-1", procurementCoverage]])
        ),
      coverageForPaymentIds: jest
        .fn()
        .mockResolvedValue(
          new Map([["payment-1", paymentCoverage]])
        ),
      detailForProcurement: jest
        .fn()
        .mockResolvedValue(procurementLedgerDetail),
      detailForPayment: jest
        .fn()
        .mockResolvedValue(paymentLedgerDetail)
    };
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never,
      invoiceLedger as never
    );

    const [procurementList, procurementDetail, paymentDetail] =
      await Promise.all([
      service.listProcurements("finance-1", {}),
      service.getProcurement("procurement-1", "finance-1"),
      service.getPayment("payment-1", "finance-1")
      ]);

    expect((procurementList.items[0] as { invoiceCoverage: unknown }).invoiceCoverage).toEqual(
      procurementCoverage
    );
    expect((procurementDetail as { invoiceLedger: unknown }).invoiceLedger).toEqual(
      procurementLedgerDetail
    );
    expect((paymentDetail as { invoiceCoverage: unknown }).invoiceCoverage).toEqual(paymentCoverage);
    expect((paymentDetail as { invoiceLedger: unknown }).invoiceLedger).toEqual(paymentLedgerDetail);
    expect(
      (paymentDetail as { invoiceCoverage: typeof paymentCoverage }).invoiceCoverage.paymentAttribution
        .countsTowardProcurementCoverageAgain
    ).toBe(false);
    expect(
      invoiceLedger.coverageForProcurementIds
    ).toHaveBeenCalledWith(["procurement-1"]);
    expect(
      invoiceLedger.coverageForPaymentIds
    ).toHaveBeenCalledWith(["payment-1"]);
    expect(invoiceLedger.detailForProcurement).toHaveBeenCalledWith(
      "procurement-1"
    );
    expect(invoiceLedger.detailForPayment).toHaveBeenCalledWith(
      "payment-1"
    );
  });

  it("fails closed before loading procurement details when business access is denied", async () => {
    const fixture = buildFixture();
    fixture.access.resolveProcurementViewAccess.mockResolvedValue("denied");
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await expect(
      service.getProcurement("procurement-1", "unrelated-user")
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.prisma.spotProcurementLine.findMany).not.toHaveBeenCalled();
    expect(fixture.prisma.spotProcurementPayment.findMany).not.toHaveBeenCalled();
  });

  it("never exposes a full bank account and keeps actual payment separate from balance deduction", async () => {
    const fixture = buildFixture();
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.getPayment("payment-1", "finance-1");

    expect(result.payment).toMatchObject({
      settlementAmountCents: "12345",
      supplierBalanceAmountCents: "345",
      companyPaymentAmountCents: "12000",
      paidAmountCents: "5000",
      executedSupplierBalanceAmountCents: "345",
      payeeBankAccountLast4: "1234"
    });
    expect(result.executions[0]).toMatchObject({
      amountCents: "5000",
      voucherFileId: "voucher-1"
    });
    expect(result).not.toHaveProperty("payment.payeeBankAccountSnapshot");
    expect(JSON.stringify(result)).not.toContain("6222020202021234");
    expect((result as { invoiceCoverage: unknown }).invoiceCoverage).toEqual({
      available: false,
      status: "not_available",
      label: "代码阶段 B 完成后开放"
    });
  });

  it("keeps real-form payment invoices separate from the retired structured invoice ledger", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementPayment.findUnique.mockResolvedValue(
      paymentRow({
        paymentType: "company_direct",
        factsFrozenAt: now
      })
    );
    const invoiceLedger = {
      coverageForPaymentIds: jest.fn(),
      detailForPayment: jest.fn()
    };
    const paymentInvoices = {
      summary: jest.fn().mockResolvedValue({
        status: "uploaded",
        statusLabel: "已上传发票",
        activeCount: 1,
        invoices: [
          {
            id: "spot-invoice-1",
            fileId: "invoice-file-1",
            status: "active"
          }
        ]
      })
    };
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never,
      invoiceLedger as never,
      paymentInvoices as never
    );

    const result = await service.getPayment("payment-1", "finance-1");

    expect((result as { invoice: unknown }).invoice).toEqual({
      status: "uploaded",
      statusLabel: "已上传发票",
      activeCount: 1,
      invoices: [
        {
          id: "spot-invoice-1",
          fileId: "invoice-file-1",
          status: "active",
          availableActions: [
            expect.objectContaining({
              key: "invalidate_invoice",
              enabled: true,
              requiredAction: "spot_procurement.invoice.append",
              requiresComment: true
            })
          ]
        }
      ]
    });

    fixture.visibility.effectiveRoleKeys.mockResolvedValue(["employee"]);
    const handlerWithoutRequiredRole = await service.getPayment(
      "payment-1",
      "handler-1"
    );
    const handlerInvoice = (
      handlerWithoutRequiredRole as {
        invoice: {
          invoices: Array<{
            availableActions: Array<{ key: string; enabled: boolean; disabledReason: string | null }>;
          }>;
        };
      }
    ).invoice;
    expect(
      handlerInvoice.invoices[0]?.availableActions.find(
        (action) => action.key === "invalidate_invoice"
      )
    ).toMatchObject({
      enabled: false,
      disabledReason: "当前岗位无权执行此动作"
    });
    expect(invoiceLedger.coverageForPaymentIds).not.toHaveBeenCalled();
    expect(invoiceLedger.detailForPayment).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("invoiceLedger");
  });

  it("exposes the real-form workbench facts without legacy procurement amounts, merchant balances, or full accounts", async () => {
    const fixture = buildFixture();
    const realProcurement = procurementRow({
      supplierPartyId: null,
      supplierKey: null,
      supplierNameSnapshot: null,
      approvedAmountCents: null
    });
    const realVersion = versionRow({
      totalAmountCents: null,
      applicationDepartmentSnapshot: "工程部",
      applicationNameSnapshot: "赵凤平",
      purchaserNameSnapshot: "杨帅",
      purchaserDepartmentId: "department-material",
      purchaserDepartmentNameSnapshot: "物资部",
      requestedArrivalAt: now
    });
    const realPayment = paymentRow({
      paymentType: "company_direct",
      merchantNameSnapshot: "昆明建材门市",
      merchantPayeeMismatchNote: null,
      payerCompanyNameSnapshot: "云南建工集团有限公司",
      payeeNameSnapshot: "昆明建材门市",
      payeeAccountNameSnapshot: "昆明建材门市",
      payeeBankAccountSnapshot: "6222020202021234",
      approvalAmountCents: 12_000n,
      factsFrozenAt: now
    });
    fixture.prisma.spotProcurement.findMany.mockResolvedValue([
      realProcurement
    ]);
    fixture.prisma.spotProcurement.findUnique.mockResolvedValue(
      realProcurement
    );
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      realVersion
    ]);
    fixture.prisma.spotProcurementVersion.findUnique.mockResolvedValue(
      realVersion
    );
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
      realPayment
    ]);
    fixture.prisma.spotProcurementPayment.findUnique.mockResolvedValue(
      realPayment
    );
    fixture.prisma.spotProcurementPaymentLine.findMany.mockResolvedValue([
      {
        id: "payment-line-1",
        paymentId: "payment-1",
        procurementLineId: "line-1",
        sortOrder: 1,
        approvedQuantitySnapshot: { toString: () => "3.335" },
        paymentQuantity: { toString: () => "3.335" },
        unitPrice: { toString: () => "3.335" },
        amountCents: 12_000n,
        expectedInvoiceCondition: "vat_general",
        vatRateOptionId: "vat-13",
        vatRateLabelSnapshot: "13%"
      }
    ]);
    fixture.prisma.spotProcurementPaymentChannel.findMany.mockResolvedValue([
      {
        id: "channel-1",
        sortOrder: 1,
        channelType: "bank_transfer",
        accountNameSnapshot: "昆明建材门市",
        accountNumberSnapshot: "6222020202021234",
        bankNameSnapshot: "某银行",
        channelNote: null,
        isPrimary: true
      }
    ]);
    fixture.prisma.spotProcurementPaymentMethodOption.findMany.mockResolvedValue([
      { id: "method-1", paymentId: "payment-1", paymentMethod: "bank_transfer", sortOrder: 1 }
    ]);
    const receipt = {
      id: "receipt-1",
      procurementId: "procurement-1",
      status: "draft",
      currentRevisionNo: 1,
      handlerUserId: "handler-1",
      firstSubmittedAt: null,
      submittedAt: null,
      lockedAt: null,
      updatedAt: now,
      invalidatedAt: null
    };
    fixture.prisma.spotProcurementReceipt.findUnique.mockResolvedValue(receipt);
    fixture.prisma.spotProcurementReceipt.findMany.mockResolvedValue([receipt]);
    fixture.prisma.spotProcurementReceiptDelegation.findMany.mockResolvedValue([
      {
        id: "delegation-1",
        receiptId: "receipt-1",
        delegatorUserId: "handler-1",
        delegateUserId: "delegate-1",
        delegatedAt: now
      }
    ]);
    fixture.prisma.user.findMany.mockResolvedValue([
      { id: "applicant-1", name: "申请人" },
      { id: "handler-1", name: "采购经办人" },
      { id: "delegate-1", name: "收货受托人" },
      { id: "finance-1", name: "财务人员" }
    ]);
    const paymentInvoices = {
      summary: jest.fn().mockResolvedValue({
        status: "pending",
        statusLabel: "待补发票",
        activeCount: 0,
        invoices: []
      })
    };
    const quantityWriteValidator = jest.spyOn(
      spotProcurementMoney,
      "isSpotProcurementQuantity"
    );
    const unitPriceWriteValidator = jest.spyOn(
      spotProcurementMoney,
      "isSpotProcurementUnitPrice"
    );
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never,
      undefined,
      paymentInvoices as never
    );

    const [procurementList, paymentList, procurementDetail, paymentDetail] =
      await Promise.all([
        service.listProcurements("finance-1", {}),
        service.listPayments("finance-1", {}),
        service.getProcurement("procurement-1", "finance-1"),
        service.getPayment("payment-1", "finance-1")
      ]);

    expect(procurementList.items[0]).toMatchObject({
      form: "real_application",
      applicationDepartment: "工程部",
      applicationName: "赵凤平",
      requestedArrivalAt: now.toISOString(),
      payment: {
        paymentId: "payment-1",
        approvalAmountCents: "12000",
        actualPaidAmountCents: "5000",
        remainingAmountCents: "7000"
      },
      receipt: { openAfterActualPayment: true }
    });
    expect(procurementList.items[0]).toMatchObject({
      receiptWorkbench: {
        materialSummary: "免烧砖（240×115×53）；零配件",
        approvedQuantitySummary: "100 块；1 套",
        actualPaidAmountCents: "5000",
        receiptResponsible: { id: "handler-1", name: "采购经办人" },
        receiptDelegate: { id: "delegate-1", name: "收货受托人" },
        updatedAt: now.toISOString()
      }
    });
    expect(procurementList.items[0]).not.toHaveProperty("approvedAmountCents");
    expect(procurementList.items[0]).not.toHaveProperty("supplierName");
    expect(paymentList.items[0]).toMatchObject({
      form: "real_payment",
      payerCompanyName: "云南建工集团有限公司",
      merchantName: "昆明建材门市",
      approvalAmountCents: "12000",
      actualPaidAmountCents: "5000",
      remainingAmountCents: "7000",
      payee: { accountNumberLast4: "1234" },
      invoice: { status: "pending" }
    });
    expect(paymentList.items[0]).not.toHaveProperty("supplierBalanceAmountCents");
    expect(procurementDetail.procurement).toMatchObject({
      form: "real_application",
      payment: { paymentId: "payment-1", approvalAmountCents: "12000" }
    });
    expect(paymentDetail.payment).toMatchObject({
      form: "real_payment",
      payerCompanyName: "云南建工集团有限公司",
      approvalAmountCents: "12000",
      payee: { primaryChannel: { accountNumberLast4: "1234" } },
      payerManagement: {
        visible: true,
        enabled: false,
        disabledReason: "已发生实际付款，不能再调整付款主体"
      }
    });
    expect((paymentDetail as { procurementMaterials: unknown }).procurementMaterials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "line-1",
          materialName: "免烧砖",
          approvedQuantity: "100"
        })
      ])
    );
    expect((paymentDetail as { materials: unknown }).materials).toEqual([
      expect.objectContaining({
        approvedQuantity: "3.335",
        paymentQuantity: "3.335",
        unitPrice: "3.335",
        vatRateOptionId: "vat-13"
      })
    ]);
    expect(quantityWriteValidator).not.toHaveBeenCalled();
    expect(unitPriceWriteValidator).not.toHaveBeenCalled();
    quantityWriteValidator.mockRestore();
    unitPriceWriteValidator.mockRestore();
    expect((paymentDetail as { paymentChannels: unknown }).paymentChannels).toEqual([
      expect.objectContaining({ accountNumberLast4: "1234" })
    ]);
    expect(paymentDetail).not.toHaveProperty("balanceExecution");
    expect(JSON.stringify(paymentDetail)).not.toContain("6222020202021234");
  });

  it.each([
    {
      name: "returns the only current visible payment",
      payments: [
        paymentRow({
          id: "payment-old",
          status: "returned",
          paymentType: "company_direct"
        }),
        paymentRow({
          id: "payment-current",
          status: "draft",
          paymentType: "company_direct"
        })
      ],
      visibleIds: ["payment-old", "payment-current"],
      expectedPaymentId: "payment-current",
      expectedPaymentStatus: "draft"
    },
    {
      name: "does not expose a current payment without payment access",
      payments: [paymentRow({ id: "payment-current", status: "draft" })],
      visibleIds: [],
      expectedPaymentId: null,
      expectedPaymentStatus: "pending_determination"
    },
    {
      name: "fails closed instead of choosing an arbitrary current payment",
      payments: [
        paymentRow({ id: "payment-current-a", status: "draft" }),
        paymentRow({ id: "payment-current-b", status: "approval_pending" })
      ],
      visibleIds: ["payment-current-a", "payment-current-b"],
      expectedPaymentId: null,
      expectedPaymentStatus: "pending_determination"
    }
  ])("$name", async ({ payments, visibleIds, expectedPaymentId, expectedPaymentStatus }) => {
    const fixture = buildFixture();
    const realVersion = versionRow({
      totalAmountCents: null,
      applicationDepartmentSnapshot: "工程部",
      applicationNameSnapshot: "申请人",
      purchaserNameSnapshot: "采购经办人",
      purchaserDepartmentNameSnapshot: "物资部",
      requestedArrivalAt: now
    });
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([realVersion]);
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue(payments);
    fixture.access.accessiblePaymentIds.mockResolvedValue(new Set(visibleIds));
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const [list, detail] = await Promise.all([
      service.listProcurements("finance-1", {}),
      service.getProcurement("procurement-1", "finance-1")
    ]);

    expect(list.items[0]?.payment).toMatchObject({
      paymentId: expectedPaymentId,
      status: expectedPaymentStatus
    });
    expect(
      (detail.procurement as { payment: unknown }).payment
    ).toMatchObject({ paymentId: expectedPaymentId });
    expect(detail.paymentSummary).toMatchObject({ paymentId: expectedPaymentId });
  });

  it("keeps an auto-created A5 draft editable before the handler selects its payment type", async () => {
    const fixture = buildFixture();
    const realProcurement = procurementRow({
      supplierPartyId: null,
      supplierKey: null,
      supplierNameSnapshot: null,
      approvedAmountCents: null
    });
    const realVersion = versionRow({
      totalAmountCents: null,
      applicationDepartmentSnapshot: "工程部",
      applicationNameSnapshot: "赵凤平",
      purchaserNameSnapshot: "杨帅",
      purchaserDepartmentId: "department-material",
      purchaserDepartmentNameSnapshot: "物资部",
      requestedArrivalAt: now
    });
    const unfilledPayment = paymentRow({
      status: "draft",
      settlementAmountCents: 0n,
      supplierBalanceAmountCents: 0n,
      companyPaymentAmountCents: 0n,
      paymentType: null,
      merchantNameSnapshot: null,
      payerCompanyNameSnapshot: null,
      payeeNameSnapshot: null,
      payeeAccountNameSnapshot: null,
      payeeBankNameSnapshot: null,
      payeeBankAccountSnapshot: null,
      approvalAmountCents: 0n,
      submittedAt: null,
      approvedAt: null,
      factsFrozenAt: null
    });
    fixture.prisma.spotProcurement.findMany.mockResolvedValue([realProcurement]);
    fixture.prisma.spotProcurement.findUnique.mockResolvedValue(realProcurement);
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([realVersion]);
    fixture.prisma.spotProcurementVersion.findUnique.mockResolvedValue(realVersion);
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([unfilledPayment]);
    fixture.prisma.spotProcurementPayment.findUnique.mockResolvedValue(unfilledPayment);
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementPaymentLine.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementPaymentChannel.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementPaymentMethodOption.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementPaymentInvoice.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementRefund.findMany.mockResolvedValue([]);
    fixture.visibility.effectiveRoleKeys.mockResolvedValue(["material_staff"]);
    fixture.prisma.userPosition.findMany.mockResolvedValue([
      {
        userId: "handler-1",
        projectId: "project-1",
        positionId: "position-material-staff"
      }
    ]);
    fixture.prisma.position.findMany.mockResolvedValue([
      { id: "position-material-staff", key: "material_staff" }
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const [procurementList, paymentList, paymentDetail] = await Promise.all([
      service.listProcurements("handler-1", {}),
      service.listPayments("handler-1", {}),
      service.getPayment("payment-1", "handler-1")
    ]);

    expect(procurementList.items[0]).toMatchObject({
      form: "real_application",
      payment: {
        status: "pending_determination",
        statusLabel: "付款金额待确定",
        approvalAmountCents: null
      }
    });
    expect(paymentList.items[0]).toMatchObject({
      form: "real_payment",
      paymentType: null,
      paymentTypeLabel: "付款类型待确认",
      approvalAmountCents: null,
      merchantName: null
    });
    expect(paymentDetail.payment).toMatchObject({
      form: "real_payment",
      paymentType: null,
      paymentTypeLabel: "付款类型待确认",
      approvalAmountCents: null,
      merchantName: null
    });
    expect((paymentDetail as { procurementMaterials: unknown }).procurementMaterials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "line-1", materialName: "免烧砖" })
      ])
    );
    expect(
      paymentDetail.availableActions.find((action) => action.key === "edit_draft")
    ).toMatchObject({ enabled: true });
  });

  it("does not add an inaccessible payment refund into a procurement money summary", async () => {
    const fixture = buildFixture();
    const version = versionRow({
      totalAmountCents: null,
      applicationDepartmentSnapshot: "工程部",
      applicationNameSnapshot: "赵凤平",
      purchaserNameSnapshot: "杨帅",
      purchaserDepartmentId: "department-material",
      purchaserDepartmentNameSnapshot: "物资部",
      requestedArrivalAt: now
    });
    const visiblePayment = paymentRow({
      paymentType: "company_direct",
      approvalAmountCents: 12_000n,
      factsFrozenAt: now
    });
    const hiddenPayment = paymentRow({
      id: "payment-hidden",
      code: "LXFK-2026-002",
      paymentType: "company_direct",
      approvalAmountCents: 8_000n,
      factsFrozenAt: now
    });
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([version]);
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
      visiblePayment,
      hiddenPayment
    ]);
    fixture.prisma.spotProcurementRefund.findMany.mockResolvedValue([
      {
        id: "refund-hidden",
        procurementId: "procurement-1",
        paymentId: "payment-hidden",
        amountCents: 8_000n,
        receivedAt: now
      }
    ]);
    fixture.access.accessiblePaymentIds.mockResolvedValue(
      new Set(["payment-1"])
    );
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.getProcurement("procurement-1", "finance-1");

    expect(result.paymentSummary).toMatchObject({
      approvalAmountCents: "12000",
      refundAmountCents: "0",
      visibilityRestricted: true
    });
  });

  it("does not expose hidden payment execution through the procurement receipt summary", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      versionRow({
        totalAmountCents: null,
        applicationDepartmentSnapshot: "工程部",
        applicationNameSnapshot: "赵凤平",
        purchaserNameSnapshot: "杨帅",
        purchaserDepartmentNameSnapshot: "物资部",
        requestedArrivalAt: now
      })
    ]);
    fixture.access.accessiblePaymentIds.mockResolvedValue(new Set());
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.getProcurement(
      "procurement-1",
      "unrelated-user"
    );

    expect(result.paymentSummary).toMatchObject({
      paymentId: null,
      actualPaidAmountCents: null,
      visibilityRestricted: true
    });
    expect(result.receipt).toMatchObject({
      openAfterActualPayment: false,
      hasActualPayment: false,
      blockedReason: "尚未生成收货单"
    });
    expect(
      fixture.prisma.spotProcurementPaymentExecution.findMany
    ).not.toHaveBeenCalled();
  });

  it("offers a real revision action for an owner after rejection without exposing false draft editing", async () => {
    const fixture = buildFixture();
    const rejectedProcurement = procurementRow({ status: "draft" });
    const rejectedVersion = versionRow({ status: "rejected" });
    fixture.prisma.spotProcurement.findUnique.mockResolvedValue(
      rejectedProcurement
    );
    fixture.prisma.spotProcurementVersion.findUnique.mockResolvedValue(
      rejectedVersion
    );
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      rejectedVersion
    ]);
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([]);
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue(
      []
    );
    fixture.visibility.effectiveRoleKeys.mockResolvedValue([
      "material_staff"
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.getProcurement(
      "procurement-1",
      "handler-1"
    );

    expect(
      result.availableActions.find((action) => action.key === "edit_draft")
    ).toMatchObject({ enabled: false });
    expect(
      result.availableActions.find(
        (action) => action.key === "create_version"
      )
    ).toMatchObject({ enabled: true });
  });

  it("reports project capability without turning a visible project into an implicit action grant", async () => {
    const fixture = buildFixture();
    fixture.visibility.effectiveRoleKeys.mockResolvedValue(["employee"]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await expect(
      service.capabilities("employee-1", "project-outside")
    ).rejects.toBeInstanceOf(ForbiddenException);

    const result = await service.capabilities("employee-1", "project-1");
    expect(result).toEqual({
      projectId: "project-1",
      enabled: true,
      canCreate: false,
      canExecutePayment: false,
      unavailableReason: "当前账号不是本项目物资员或物资主管",
      handlerOptions: []
    });
  });

  it("filters handler options to active material staff and directors on the project", async () => {
    const fixture = buildFixture();
    fixture.visibility.effectiveRoleKeys.mockResolvedValue([
      "material_director"
    ]);
    fixture.prisma.position.findMany = jest.fn().mockResolvedValue([
      { id: "position-material-staff", key: "material_staff" },
      { id: "position-material-director", key: "material_director" }
    ]);
    fixture.prisma.userPosition.findMany.mockResolvedValue([
      {
        userId: "handler-1",
        positionId: "position-material-staff",
        projectId: "project-1"
      },
      {
        userId: "global-staff-1",
        positionId: "position-material-staff",
        projectId: null
      }
    ]);
    fixture.prisma.projectMember.findMany.mockResolvedValue([
      {
        userId: "director-1",
        positionKey: "material_director"
      }
    ]);
    fixture.prisma.user.findMany.mockResolvedValue([
      { id: "handler-1", name: "物资员甲" },
      { id: "director-1", name: "物资主管乙" }
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.capabilities("director-1", "project-1");

    expect(result.handlerOptions).toEqual([
      {
        id: "handler-1",
        name: "物资员甲",
        roleKeys: ["material_staff"]
      },
      {
        id: "director-1",
        name: "物资主管乙",
        roleKeys: ["material_director"]
      }
    ]);
    expect(fixture.prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["handler-1", "director-1"] },
        isActive: true
      },
      select: { id: true, name: true }
    });
  });

  it("continues scanning after a full unauthorized batch before deciding the visible list", async () => {
    const fixture = buildFixture();
    const deniedRows = Array.from({ length: 200 }, (_value, index) =>
      procurementRow({
        id: `denied-${index}`,
        code: `LXCG-DENIED-${index}`,
        currentVersionId: `version-denied-${index}`
      })
    );
    fixture.prisma.spotProcurement.findMany = jest.fn(
      ({ cursor }: { cursor?: { id: string } }) =>
        Promise.resolve(cursor ? [procurementRow()] : deniedRows)
    );
    fixture.access.accessibleProcurementIds.mockImplementation(
      (procurementIds: string[]) =>
        Promise.resolve(
          new Set(
            procurementIds.filter(
              (procurementId) => procurementId === "procurement-1"
            )
          )
        )
    );
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.listProcurements("finance-1", {});

    expect(result.items.map((item) => item.id)).toEqual(["procurement-1"]);
    expect(result.pagination).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(fixture.prisma.spotProcurement.findMany).toHaveBeenCalledTimes(2);
  });

  it("paginates every ACL-authorized row without the former 200-row truncation", async () => {
    const fixture = buildFixture();
    const firstProcurements = Array.from(
      { length: 200 },
      (_value, index) =>
        procurementRow({
          id: `procurement-${index}`,
          code: `LXCG-${index}`
        })
    );
    const remainingProcurements = Array.from(
      { length: 50 },
      (_value, index) =>
        procurementRow({
          id: `procurement-${index + 200}`,
          code: `LXCG-${index + 200}`
        })
    );
    fixture.prisma.spotProcurement.findMany = jest.fn(
      ({ cursor }: { cursor?: { id: string } }) =>
        Promise.resolve(cursor ? remainingProcurements : firstProcurements)
    );
    fixture.access.accessibleProcurementIds.mockImplementation(
      (ids: string[]) => Promise.resolve(new Set(ids) as never)
    );
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const scan = await (service as unknown as {
      scanAccessibleProcurements(where: object, actorUserId: string): Promise<{ rows: Array<{ id: string }> }>;
    }).scanAccessibleProcurements({}, "finance-1");

    expect(scan.rows).toHaveLength(250);
    expect(fixture.prisma.spotProcurement.findMany).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a payment points at a version owned by another procurement", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementVersion.findUnique.mockResolvedValue(
      versionRow({ procurementId: "procurement-other" })
    );
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await expect(
      service.getPayment("payment-1", "finance-1")
    ).rejects.toThrow(
      "零星采购付款关联事实不完整，请联系管理员核对"
    );
  });

  it("fails closed in the payment list when a payment version belongs to another procurement", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      versionRow({ procurementId: "procurement-other" })
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await expect(
      service.listPayments("finance-1", {})
    ).rejects.toThrow(
      "零星采购付款关联事实不完整，请联系管理员核对"
    );
  });

  it("uses unvoided execution facts and reports missing vouchers or amount drift", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([
      {
        id: "execution-active",
        paymentId: "payment-1",
        amountCents: 7_000n,
        paidAt: now,
        paymentMethod: "bank_transfer",
        executedByUserId: "finance-1",
        voucherFileId: "voucher-missing",
        idempotencyKey: "idem-active",
        voidedAt: null,
        voidedByUserId: null,
        voidReason: null,
        createdAt: now
      },
      {
        id: "execution-voided",
        paymentId: "payment-1",
        amountCents: 9_000n,
        paidAt: now,
        paymentMethod: "bank_transfer",
        executedByUserId: "finance-1",
        voucherFileId: "voucher-1",
        idempotencyKey: "idem-voided",
        voidedAt: now,
        voidedByUserId: "finance-1",
        voidReason: "登记错误",
        createdAt: now
      }
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.getPayment("payment-1", "finance-1");

    expect(result.payment).toMatchObject({
      paidAmountCents: "7000",
      remainingCompanyPaymentAmountCents: "5000",
      paymentFactConsistent: false,
      voucherStatus: "anomaly"
    });
    expect((result as { companyPayment: unknown }).companyPayment).toMatchObject({
      paidAmountCents: "7000",
      statusLabel: "部分已付",
      voucherStatus: "anomaly"
    });
    expect(
      result.availableActions.find(
        (action) => action.key === "record_execution"
      )
    ).toMatchObject({
      enabled: false,
      disabledReason:
        "付款累计与实际执行记录不一致，请先由管理员核对，禁止继续登记实付"
    });
  });

  it("blocks further execution when an existing actual payment has no active voucher", async () => {
    const fixture = buildFixture();
    fixture.prisma.fileObject.findMany.mockResolvedValue([
      {
        id: "file-support",
        originalName: "付款说明.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        storageStatus: "active",
        uploadedByUserId: "handler-1",
        createdAt: now
      }
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.getPayment(
      "payment-1",
      "finance-1"
    );

    expect(result.payment).toMatchObject({
      paymentFactConsistent: true,
      voucherStatus: "anomaly"
    });
    expect(
      result.availableActions.find(
        (action) => action.key === "record_execution"
      )
    ).toMatchObject({
      enabled: false,
      disabledReason:
        "已有实际付款缺少有效凭证，请先核对凭证事实，禁止继续登记实付"
    });
  });

  it.each([1, 2])(
    "uses %i active real-form execution voucher(s) for list and detail completeness",
    async (voucherCount) => {
      const fixture = buildFixture();
      const realPayment = paymentRow({
        paymentType: "company_direct",
        payerCompanyEntityId: "company-1",
        payerCompanyNameSnapshot: "云南建工",
        approvalAmountCents: 12_000n
      });
      fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
        realPayment
      ]);
      fixture.prisma.spotProcurementPayment.findUnique.mockResolvedValue(
        realPayment
      );
      fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([
        {
          id: "execution-real",
          paymentId: "payment-1",
          amountCents: 5_000n,
          paidAt: now,
          paymentMethod: "bank_transfer",
          executedByUserId: "finance-1",
          voucherFileId: null,
          idempotencyKey: "idem-real",
          voidedAt: null,
          voidedByUserId: null,
          voidReason: null,
          createdAt: now
        }
      ]);
      fixture.prisma.spotProcurementPaymentExecutionVoucher.findMany.mockResolvedValue(
        Array.from({ length: voucherCount }, (_value, index) => ({
          id: `execution-voucher-${index + 1}`,
          paymentExecutionId: "execution-real",
          fileId: `voucher-real-${index + 1}`,
          sortOrder: index + 1,
          uploadedByUserId: "finance-1",
          createdAt: now
        }))
      );
      fixture.prisma.fileObject.findMany.mockResolvedValue(
        Array.from({ length: voucherCount }, (_value, index) => ({
          id: `voucher-real-${index + 1}`,
          originalName: `付款凭证${index + 1}.png`,
          mimeType: "image/png",
          sizeBytes: 1024,
          storageStatus: "active",
          uploadedByUserId: "finance-1",
          createdAt: now
        }))
      );
      const service = new SpotProcurementReadService(
        fixture.prisma as never,
        fixture.visibility as never,
        fixture.access as never,
        fixture.pilot as never
      );

      const list = await service.listPayments("finance-1", { view: "all" });
      const detail = await service.getPayment("payment-1", "finance-1");

      expect(list.items[0]).toMatchObject({
        voucherStatus: "complete",
        currentTask: { key: "record_execution", priority: 300 }
      });
      expect(detail.payment).toMatchObject({ voucherStatus: "complete" });
      expect(detail.currentTask).not.toMatchObject({ key: "view_only" });
    }
  );

  it("reports an anomaly when a real-form execution has no active associated voucher", async () => {
    const fixture = buildFixture();
    const realPayment = paymentRow({
      paymentType: "company_direct",
      payerCompanyEntityId: "company-1",
      payerCompanyNameSnapshot: "云南建工",
      approvalAmountCents: 12_000n
    });
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
      realPayment
    ]);
    fixture.prisma.spotProcurementPayment.findUnique.mockResolvedValue(
      realPayment
    );
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([
      {
        id: "execution-real",
        paymentId: "payment-1",
        amountCents: 5_000n,
        paidAt: now,
        paymentMethod: "bank_transfer",
        executedByUserId: "finance-1",
        voucherFileId: null,
        idempotencyKey: "idem-real",
        voidedAt: null,
        voidedByUserId: null,
        voidReason: null,
        createdAt: now
      }
    ]);
    fixture.prisma.spotProcurementPaymentExecutionVoucher.findMany.mockResolvedValue([
      {
        id: "execution-voucher-inactive",
        paymentExecutionId: "execution-real",
        fileId: "voucher-inactive",
        sortOrder: 1,
        uploadedByUserId: "finance-1",
        createdAt: now
      }
    ]);
    fixture.prisma.fileObject.findMany.mockResolvedValue([
      {
        id: "voucher-inactive",
        originalName: "失效凭证.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        storageStatus: "deleted",
        uploadedByUserId: "finance-1",
        createdAt: now
      }
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const list = await service.listPayments("finance-1", { view: "all" });
    const detail = await service.getPayment("payment-1", "finance-1");

    expect(list.items[0]).toMatchObject({
      voucherStatus: "anomaly",
      currentTask: { key: "view_only", priority: 400 }
    });
    expect(detail.payment).toMatchObject({ voucherStatus: "anomaly" });
    expect(detail.currentTask).toMatchObject({
      key: "view_only",
      priority: 400
    });
  });

  it("derives personal draft and frozen-node approval tasks without granting material directors view-only work", () => {
    const draftInput = {
      payment: paymentRow({ status: "draft" }) as never,
      approval: null,
      discrepancy: null,
      actorUserId: "handler-1",
      roleKeys: ["material_staff"] as const,
      projectScopedRoleKeys: ["material_staff"] as const,
      paymentMethodCount: 0,
      availableActions: [
        { key: "edit_draft", label: "编辑付款草稿", enabled: true }
      ] as never
    };
    expect(deriveSpotPaymentCurrentTask(draftInput)).toMatchObject({
      key: "complete_payment_draft",
      scope: "personal",
      priority: 300,
      enabled: true
    });
    expect(
      deriveSpotPaymentCurrentTask({
        ...draftInput,
        actorUserId: "another-material-1",
        availableActions: []
      })
    ).toMatchObject({ key: "none", scope: "none", priority: 0 });

    const approval = {
      status: "approval_pending",
      currentNodeIndex: 1,
      frozenNodes: [
        { name: "综合部主管", roleKeys: ["comprehensive_director"] },
        { name: "项目经理", roleKeys: ["project_manager"] }
      ],
      applicantUserId: "handler-1"
    };
    expect(
      deriveSpotPaymentCurrentTask({
        payment: paymentRow({ status: "approval_pending" }) as never,
        approval: approval as never,
        discrepancy: null,
        actorUserId: "manager-1",
        roleKeys: ["project_manager"],
        projectScopedRoleKeys: ["project_manager"],
        paymentMethodCount: 1,
        availableActions: [
          { key: "review_approval", label: "处理付款审批", enabled: true }
        ] as never
      })
    ).toMatchObject({ key: "review_payment", scope: "personal", priority: 300 });
    expect(
      deriveSpotPaymentCurrentTask({
        payment: paymentRow({ status: "approval_pending" }) as never,
        approval: approval as never,
        discrepancy: null,
        actorUserId: "material-director-1",
        roleKeys: ["material_director"],
        projectScopedRoleKeys: ["material_director"],
        paymentMethodCount: 0,
        availableActions: []
      })
    ).toMatchObject({
      key: "none",
      scope: "none",
      priority: 0,
      enabled: false,
      hint: "当前无需办理付款；后续需复核收货"
    });

    expect(
      deriveSpotPaymentCurrentTask({
        payment: paymentRow({ status: "approval_pending" }) as never,
        approval: approval as never,
        discrepancy: null,
        actorUserId: "readonly-1",
        roleKeys: ["employee"],
        projectScopedRoleKeys: ["employee"],
        paymentMethodCount: 0,
        availableActions: []
      })
    ).toMatchObject({
      key: "none",
      scope: "none",
      priority: 0,
      enabled: false,
      hint: "当前付款无需您办理"
    });
  });

  it("keeps the seven trial roles on their own payment task and never infers a privileged action", () => {
    const approvalFor = (roleKey: string, nodeName: string) => ({
      status: "approval_pending",
      currentNodeIndex: 0,
      frozenNodes: [{ name: nodeName, roleKeys: [roleKey] }],
      applicantUserId: "handler-1"
    });
    const cases = [
      {
        roleKey: "material_staff",
        actorUserId: "handler-1",
        payment: paymentRow({ status: "draft" }),
        approval: null,
        paymentMethodCount: 0,
        availableActions: [{ key: "edit_draft", label: "编辑付款草稿", enabled: true }],
        expectedTask: "complete_payment_draft",
        forbiddenActions: ["review_approval", "complete_payer", "record_execution"]
      },
      {
        roleKey: "material_director",
        actorUserId: "material-director-1",
        payment: paymentRow({
          status: "approval_pending",
          payerCompanyEntityId: "company-1",
          payerCompanyNameSnapshot: "云南建工"
        }),
        approval: approvalFor("comprehensive_director", "综合部主管审批"),
        paymentMethodCount: 1,
        availableActions: [],
        expectedTask: "none",
        forbiddenActions: ["edit_draft", "review_approval", "complete_payer", "record_execution"]
      },
      {
        roleKey: "comprehensive_director",
        actorUserId: "comprehensive-1",
        payment: paymentRow({
          status: "approval_pending",
          payerCompanyEntityId: "company-1",
          payerCompanyNameSnapshot: "云南建工"
        }),
        approval: approvalFor("comprehensive_director", "综合部主管审批"),
        paymentMethodCount: 1,
        availableActions: [{ key: "review_approval", label: "办理审批", enabled: true }],
        expectedTask: "review_payment",
        forbiddenActions: ["edit_draft", "record_execution"]
      },
      {
        roleKey: "project_manager",
        actorUserId: "project-manager-1",
        payment: paymentRow({
          status: "approval_pending",
          payerCompanyEntityId: "company-1",
          payerCompanyNameSnapshot: "云南建工"
        }),
        approval: approvalFor("project_manager", "项目经理审批"),
        paymentMethodCount: 1,
        availableActions: [{ key: "review_approval", label: "办理审批", enabled: true }],
        expectedTask: "review_payment",
        forbiddenActions: ["edit_draft", "complete_payer", "record_execution"]
      },
      {
        roleKey: "finance_staff",
        actorUserId: "finance-1",
        payment: paymentRow({
          status: "approval_pending",
          payerCompanyEntityId: null,
          payerCompanyNameSnapshot: null
        }),
        approval: approvalFor("comprehensive_director", "综合部主管审批"),
        paymentMethodCount: 0,
        availableActions: [],
        expectedTask: "complete_payer",
        forbiddenActions: ["edit_draft", "review_approval", "record_execution"]
      },
      {
        roleKey: "finance_director",
        actorUserId: "finance-director-1",
        payment: paymentRow({
          status: "approval_pending",
          payerCompanyEntityId: "company-1",
          payerCompanyNameSnapshot: "云南建工"
        }),
        approval: approvalFor("finance_director", "财务主管审批"),
        paymentMethodCount: 1,
        availableActions: [{ key: "review_approval", label: "办理审批", enabled: true }],
        expectedTask: "review_payment",
        forbiddenActions: ["edit_draft", "record_execution"]
      },
      {
        roleKey: "chairman",
        actorUserId: "chairman-1",
        payment: paymentRow({
          status: "approval_pending",
          payerCompanyEntityId: "company-1",
          payerCompanyNameSnapshot: "云南建工"
        }),
        approval: approvalFor("chairman", "董事长或总经理审批"),
        paymentMethodCount: 1,
        availableActions: [{ key: "review_approval", label: "办理审批", enabled: true }],
        expectedTask: "review_payment",
        forbiddenActions: ["edit_draft", "complete_payer", "record_execution"]
      }
    ] as const;

    for (const current of cases) {
      const task = deriveSpotPaymentCurrentTask({
        payment: current.payment as never,
        approval: current.approval as never,
        discrepancy: null,
        actorUserId: current.actorUserId,
        roleKeys: [current.roleKey],
        projectScopedRoleKeys: [current.roleKey],
        paymentMethodCount: current.paymentMethodCount,
        availableActions: current.availableActions as never
      });

      expect(task.key).toBe(current.expectedTask);
      expect(current.availableActions.map((action) => action.key)).toEqual(
        expect.not.arrayContaining([...current.forbiddenActions])
      );
    }
  });

  it("derives shared payer completion and project-finance blocking tasks", () => {
    const missingPayer = paymentRow({
      status: "draft",
      payerCompanyEntityId: null,
      payerCompanyNameSnapshot: null
    });
    for (const role of [
      "finance_staff",
      "comprehensive_director",
      "finance_director"
    ] as const) {
      expect(
        deriveSpotPaymentCurrentTask({
          payment: missingPayer as never,
          approval: null,
          discrepancy: null,
          actorUserId: `${role}-1`,
          roleKeys: [role],
          projectScopedRoleKeys: [role],
          paymentMethodCount: 0,
          availableActions: []
        })
      ).toMatchObject({ key: "complete_payer", scope: "shared", priority: 200 });
    }
    const payerWithoutMethods = paymentRow({
      status: "approval_pending",
      payerCompanyEntityId: "company-1",
      payerCompanyNameSnapshot: "云南建工"
    });
    const comprehensiveApproval = {
      status: "approval_pending",
      currentNodeIndex: 0,
      frozenNodes: [
        { name: "综合部主管", roleKeys: ["comprehensive_director"] }
      ],
      applicantUserId: "handler-1"
    };
    for (const role of [
      "finance_staff",
      "comprehensive_director",
      "finance_director"
    ] as const) {
      expect(
        deriveSpotPaymentCurrentTask({
          payment: payerWithoutMethods as never,
          approval: comprehensiveApproval as never,
          discrepancy: null,
          actorUserId: `${role}-1`,
          roleKeys: [role],
          projectScopedRoleKeys: [role],
          paymentMethodCount: 0,
          availableActions:
            role === "comprehensive_director"
              ? ([
                  {
                    key: "review_approval",
                    label: "处理付款审批",
                    enabled: true
                  }
                ] as never)
              : []
        })
      ).toMatchObject({ key: "complete_payer", scope: "shared" });
    }
    expect(
      deriveSpotPaymentCurrentTask({
        payment: payerWithoutMethods as never,
        approval: comprehensiveApproval as never,
        discrepancy: null,
        actorUserId: "material-director-1",
        roleKeys: ["material_director"],
        projectScopedRoleKeys: ["material_director"],
        paymentMethodCount: 0,
        availableActions: []
      })
    ).toMatchObject({ key: "none", scope: "none" });
    expect(
      deriveSpotPaymentCurrentTask({
        payment: payerWithoutMethods as never,
        approval: comprehensiveApproval as never,
        discrepancy: null,
        actorUserId: "comprehensive-1",
        roleKeys: ["comprehensive_director"],
        projectScopedRoleKeys: ["comprehensive_director"],
        paymentMethodCount: 1,
        availableActions: [
          {
            key: "review_approval",
            label: "处理付款审批",
            enabled: true
          }
        ] as never
      })
    ).toMatchObject({ key: "review_payment", scope: "personal" });
    expect(
      deriveSpotPaymentCurrentTask({
        payment: paymentRow({
          status: "approval_pending",
          payerCompanyEntityId: "company-1",
          payerCompanyNameSnapshot: "云南建工"
        }) as never,
        approval: null,
        discrepancy: null,
        actorUserId: "finance-1",
        roleKeys: ["finance_staff"],
        projectScopedRoleKeys: ["finance_staff"],
        paymentMethodCount: 1,
        availableActions: []
      })
    ).toMatchObject({ key: "none", priority: 0 });

    const executionInput = {
      payment: paymentRow({
        status: "approved_pending_payment",
        payerCompanyEntityId: "company-1",
        payerCompanyNameSnapshot: "云南建工"
      }) as never,
      approval: null,
      actorUserId: "finance-1",
      roleKeys: ["finance_staff"] as const,
      projectScopedRoleKeys: ["finance_staff"] as const,
      paymentMethodCount: 1,
      availableActions: [
        { key: "record_execution", label: "登记公司实际付款", enabled: true }
      ] as never
    };
    expect(
      deriveSpotPaymentCurrentTask({ ...executionInput, discrepancy: null })
    ).toMatchObject({ key: "record_execution", scope: "personal", priority: 300 });
    expect(
      deriveSpotPaymentCurrentTask({
        ...executionInput,
        discrepancy: {
          status: "awaiting_refund",
          resolutionType: "full_refund"
        } as never
      })
    ).toMatchObject({ key: "record_refund", priority: 400 });
    expect(
      deriveSpotPaymentCurrentTask({
        ...executionInput,
        discrepancy: null,
        availableActions: [
          {
            key: "record_execution",
            label: "登记公司实际付款",
            enabled: false,
            disabledReason: "已有实际付款缺少有效凭证"
          }
        ] as never
      })
    ).toMatchObject({ key: "view_only", priority: 400 });
  });

  it("keeps a half-complete payer task in the finance mine view until methods exist", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
      paymentRow({
        status: "draft",
        handlerUserId: "another-handler",
        payerCompanyEntityId: "company-1",
        payerCompanyNameSnapshot: "云南建工"
      })
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const halfComplete = await service.listPayments("finance-1", {});

    expect(halfComplete.items).toEqual([
      expect.objectContaining({
        id: "payment-1",
        currentTask: expect.objectContaining({
          key: "complete_payer",
          scope: "shared"
        })
      })
    ]);
    expect(
      fixture.prisma.spotProcurementPaymentMethodOption.findMany
    ).toHaveBeenCalledWith({
      where: { paymentId: { in: ["payment-1"] } },
      select: { paymentId: true }
    });

    fixture.prisma.spotProcurementPaymentMethodOption.findMany.mockResolvedValue([
      { paymentId: "payment-1" }
    ]);
    const completed = await service.listPayments("finance-1", {});
    expect(completed.items).toEqual([]);
    expect(completed.viewCounts.mine).toBe(0);
  });

  it("defaults the payment workbench to mine, validates views, and reuses its task in detail", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
      paymentRow({
        status: "approved_pending_payment",
        payerCompanyEntityId: "company-1",
        payerCompanyNameSnapshot: "云南建工"
      }),
      paymentRow({ id: "closed-1", code: "LXFK-CLOSED", status: "settled" })
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await expect(
      service.listPayments("finance-1", { view: "bad" })
    ).rejects.toThrow("零星采购付款工作台视图不正确");
    const mine = await service.listPayments("finance-1", {});
    expect(mine.items.map((item) => item.id)).toEqual(["payment-1"]);
    expect(mine.items[0]?.currentTask).toMatchObject({ key: "record_execution" });
    expect(mine).toMatchObject({
      view: "mine",
      viewCounts: { mine: 1, all: 2, closed: 1 },
      amountSummary: null
    });
    await expect(
      service.listPayments("finance-1", { view: "closed" })
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: "closed-1" })],
      amountSummary: null
    });

    const detail = await service.getPayment("payment-1", "finance-1");
    expect(detail.currentTask).toEqual(mine.items[0]?.currentTask);
  });

  it("returns an all-view financial summary from the complete server scan", async () => {
    const fixture = buildFixture();
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
      paymentRow({
        paymentType: "company_direct",
        approvalAmountCents: 12_000n,
        payerCompanyEntityId: "company-1",
        payerCompanyNameSnapshot: "云南建工"
      })
    ]);
    fixture.prisma.spotProcurementRefund.findMany.mockResolvedValue([
      { paymentId: "payment-1", amountCents: 500n, receivedAt: now }
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await expect(service.listPayments("finance-1", { view: "all" })).resolves.toMatchObject({
      amountSummary: {
        approvalAmountCents: "12000",
        actualPaidAmountCents: "5000",
        refundAmountCents: "500",
        netPaidAmountCents: "4500",
        complete: true
      }
    });
    expect(fixture.visibility.effectiveRoleKeys).not.toHaveBeenCalled();

    fixture.prisma.userPosition.findMany.mockResolvedValue([
      {
        userId: "material-1",
        projectId: "project-1",
        positionId: "position-material-staff"
      }
    ]);
    fixture.prisma.position.findMany.mockResolvedValue([
      { id: "position-material-staff", key: "material_staff" }
    ]);
    await expect(
      service.listPayments("material-1", { view: "all" })
    ).resolves.toMatchObject({ amountSummary: null });

    fixture.prisma.spotProcurement.findMany.mockImplementation(
      ({ select }: { select?: { id?: boolean } }) =>
        Promise.resolve(
          select?.id
            ? Array.from({ length: 2_001 }, (_value, index) => ({
                id: `match-${index}`
              }))
            : [procurementRow()]
        )
    );
    fixture.prisma.userPosition.findMany.mockResolvedValue([
      {
        userId: "finance-1",
        projectId: "project-1",
        positionId: "position-finance-staff"
      }
    ]);
    fixture.prisma.position.findMany.mockResolvedValue([
      { id: "position-finance-staff", key: "finance_staff" }
    ]);
    await expect(
      service.listPayments("finance-1", { view: "all", keyword: "建材" })
    ).resolves.toMatchObject({
      truncated: true,
      amountSummary: { complete: false }
    });
  });

  it("projects and filters the complete accessible source before applying the list limit", async () => {
    const fixture = buildFixture();
    const nonTasks = Array.from({ length: 200 }, (_value, index) =>
      paymentRow({
        id: `non-task-${index}`,
        code: `LXFK-NON-TASK-${index}`,
        status: "draft",
        handlerUserId: "another-handler"
      })
    );
    const task = paymentRow({
      id: "task-after-limit",
      code: "LXFK-TASK-AFTER-LIMIT",
      status: "draft",
      handlerUserId: "handler-1"
    });
    fixture.prisma.spotProcurementPayment.findMany = jest.fn(
      ({ cursor }: { cursor?: { id: string } }) =>
        Promise.resolve(cursor ? [task] : nonTasks)
    );
    fixture.access.accessiblePaymentIds.mockImplementation(
      (paymentIds: string[]) => Promise.resolve(new Set(paymentIds))
    );
    fixture.prisma.userPosition.findMany.mockResolvedValue([
      {
        userId: "handler-1",
        projectId: "project-1",
        positionId: "position-material-staff"
      }
    ]);
    fixture.prisma.position.findMany.mockResolvedValue([
      { id: "position-material-staff", key: "material_staff" }
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.listPayments("handler-1", {});

    expect(result.items.map((item) => item.id)).toEqual(["task-after-limit"]);
    expect(result.viewCounts).toEqual({ mine: 1, all: 201, closed: 0 });
    expect(result.truncated).toBe(false);
    expect(fixture.prisma.spotProcurementPayment.findMany).toHaveBeenCalledTimes(3);
  });

  it("does not stop a fully visible payment scan at 201 rows", async () => {
    const fixture = buildFixture();
    const rows = Array.from({ length: 400 }, (_value, index) =>
      paymentRow({
        id: `payment-${String(index).padStart(3, "0")}`,
        code: `LXFK-${index}`,
        status: "settled",
        approvalAmountCents: 1n
      })
    );
    fixture.prisma.spotProcurementPayment.findMany = jest
      .fn()
      .mockResolvedValueOnce(rows.slice(0, 200))
      .mockResolvedValueOnce(rows.slice(200))
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    fixture.access.accessiblePaymentIds.mockImplementation(
      (paymentIds: string[]) => Promise.resolve(new Set(paymentIds))
    );
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.listPayments("finance-1", { view: "all" });

    expect(result.items).toHaveLength(200);
    expect(result.viewCounts).toEqual({ mine: 0, all: 400, closed: 400 });
    expect(result.truncated).toBe(true);
    expect(result.amountSummary).toMatchObject({
      approvalAmountCents: "400",
      complete: true
    });
    expect(fixture.prisma.spotProcurementPayment.findMany).toHaveBeenCalledTimes(4);
  });

  it.each([
    { sourceCount: 1_999, truncated: false },
    { sourceCount: 2_000, truncated: false },
    { sourceCount: 2_001, truncated: true }
  ])(
    "reports source truncation accurately for $sourceCount payment rows",
    async ({ sourceCount, truncated }) => {
      const fixture = buildFixture();
      const rows = Array.from({ length: sourceCount }, (_value, index) =>
        paymentRow({
          id: `boundary-payment-${index}`,
          code: `LXFK-BOUNDARY-${index}`
        })
      );
      fixture.prisma.spotProcurementPayment.findMany.mockImplementation(
        ({
          cursor,
          take
        }: {
          cursor?: { id: string };
          take: number;
        }) => {
          const start = cursor
            ? Number(cursor.id.replace("boundary-payment-", "")) + 1
            : 0;
          return Promise.resolve(rows.slice(start, start + take));
        }
      );
      fixture.access.accessiblePaymentIds.mockResolvedValue(new Set());
      const service = new SpotProcurementReadService(
        fixture.prisma as never,
        fixture.visibility as never,
        fixture.access as never,
        fixture.pilot as never
      );

      await expect(
        service.listPayments("finance-1", { view: "all" })
      ).resolves.toMatchObject({
        items: [],
        truncated,
        amountSummary: { complete: !truncated }
      });
      expect(
        fixture.prisma.spotProcurementPayment.findMany
      ).toHaveBeenCalledTimes(10);
    }
  );

  it("does not assign a handler draft task to a material director without material staff", () => {
    expect(
      deriveSpotPaymentCurrentTask({
        payment: paymentRow({ status: "draft", handlerUserId: "director-1" }) as never,
        approval: null,
        discrepancy: null,
        actorUserId: "director-1",
        roleKeys: ["material_director"],
        projectScopedRoleKeys: ["material_director"],
        paymentMethodCount: 0,
        availableActions: [
          { key: "edit_draft", label: "编辑付款草稿", enabled: true }
        ] as never
      })
    ).toMatchObject({ key: "none", scope: "none", priority: 0 });
  });

  it("keeps legacy null-payment refund ownership stable when the owner is excluded from the list", async () => {
    const fixture = buildFixture();
    const visiblePayment = paymentRow({
      id: "payment-visible",
      code: "LXFK-VISIBLE",
      paymentType: "company_direct",
      status: "approved_pending_payment",
      payerCompanyEntityId: "company-1",
      payerCompanyNameSnapshot: "云南建工",
      approvalAmountCents: 7_000n,
      paidAmountCents: 0n
    });
    const ownerPayment = paymentRow({
      id: "payment-owner",
      code: "LXFK-OWNER",
      paymentType: "company_direct",
      status: "paid",
      payerCompanyEntityId: "company-1",
      payerCompanyNameSnapshot: "云南建工",
      approvalAmountCents: 12_000n
    });
    fixture.prisma.spotProcurementPayment.findMany.mockImplementation(
      ({ select }: { select?: { procurementVersionId?: boolean } }) =>
        Promise.resolve(
          select?.procurementVersionId
            ? [visiblePayment, ownerPayment]
            : [visiblePayment]
        )
    );
    fixture.prisma.spotProcurementPayment.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          [visiblePayment, ownerPayment].find((row) => row.id === where.id) ??
            null
        )
    );
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      versionRow()
    ]);
    const currentDiscrepancy = {
      id: "discrepancy-current",
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      status: "resolved",
      resolutionType: "full_refund",
      replenishedAt: null,
      refundExpectedAmountCents: 500n,
      createdAt: now,
      updatedAt: now
    };
    fixture.prisma.spotProcurementDiscrepancy.findMany.mockResolvedValue([
      currentDiscrepancy
    ]);
    fixture.prisma.spotProcurementDiscrepancy.findFirst.mockResolvedValue(
      currentDiscrepancy
    );
    fixture.prisma.spotProcurementRefund.findMany.mockResolvedValue([
      {
        id: "refund-current",
        discrepancyId: "discrepancy-current",
        procurementId: "procurement-1",
        paymentId: null,
        amountCents: 500n,
        receivedAt: now
      }
    ]);
    const ownerExecution = {
      id: "execution-1",
      paymentId: "payment-owner",
      amountCents: 5_000n,
      paidAt: now,
      voucherFileId: "voucher-1",
      voidedAt: null,
      createdAt: now
    };
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockImplementation(
      ({ where }: { where: { paymentId: string | { in: string[] } } }) => {
        const paymentIds =
          typeof where.paymentId === "string"
            ? [where.paymentId]
            : where.paymentId.in;
        return Promise.resolve(
          paymentIds.includes("payment-owner") ? [ownerExecution] : []
        );
      }
    );
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    fixture.access.accessiblePaymentIds.mockResolvedValue(
      new Set(["payment-visible"])
    );
    const result = await service.listPayments("finance-1", {
      view: "all",
      keyword: "VISIBLE"
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "payment-visible",
      refundAmountCents: "0",
      netPaidAmountCents: "0"
    });
    expect(result.items[0]?.currentTask).toMatchObject({
      key: "record_execution",
      priority: 300
    });
    expect(result.amountSummary).toMatchObject({
      refundAmountCents: "0",
      netPaidAmountCents: "0"
    });
    expect(
      fixture.prisma.spotProcurementPayment.findMany
    ).toHaveBeenNthCalledWith(2, {
      where: {
        procurementVersionId: { in: ["version-1"] }
      },
      select: {
        id: true,
        procurementId: true,
        procurementVersionId: true,
        status: true,
        createdAt: true
      }
    });
    expect(
      fixture.prisma.spotProcurementDiscrepancy.findMany
    ).toHaveBeenNthCalledWith(1, {
      where: {
        procurementVersionId: { in: ["version-1"] }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    await expect(
      service.getPayment("payment-owner", "finance-1")
    ).resolves.toMatchObject({
      payment: { refundAmountCents: "500", netPaidAmountCents: "4500" }
    });
    await expect(
      service.getPayment("payment-visible", "finance-1")
    ).resolves.toMatchObject({
      payment: { refundAmountCents: "0", netPaidAmountCents: "0" }
    });
  });

  it("assigns an awaiting-refund task only to the unique owner payment", async () => {
    const fixture = buildFixture();
    const voidedPayment = paymentRow({
      id: "payment-voided",
      code: "LXFK-VOIDED",
      status: "voided",
      invalidatedAt: now
    });
    const invalidatedPayment = paymentRow({
      id: "payment-invalidated",
      code: "LXFK-INVALIDATED",
      status: "invalidated",
      invalidatedAt: now
    });
    const replacementPayment = paymentRow({
      id: "payment-replacement",
      code: "LXFK-REPLACEMENT",
      status: "paid"
    });
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
      voidedPayment,
      invalidatedPayment,
      replacementPayment
    ]);
    fixture.prisma.spotProcurementPayment.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          [voidedPayment, invalidatedPayment, replacementPayment].find(
            (payment) => payment.id === where.id
          ) ?? null
        )
    );
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      versionRow()
    ]);
    const awaitingRefund = {
      id: "discrepancy-awaiting-refund",
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      status: "awaiting_refund",
      resolutionType: "full_refund",
      replenishedAt: null,
      refundExpectedAmountCents: 500n,
      createdAt: now,
      updatedAt: now
    };
    fixture.prisma.spotProcurementDiscrepancy.findMany.mockResolvedValue([
      awaitingRefund
    ]);
    fixture.prisma.spotProcurementDiscrepancy.findFirst.mockResolvedValue(
      awaitingRefund
    );
    fixture.prisma.spotProcurementRefund.findMany.mockResolvedValue([]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const mine = await service.listPayments("finance-1", { view: "mine" });

    expect(mine.items.map((item) => item.id)).toEqual([
      "payment-replacement"
    ]);
    expect(mine.items[0]?.currentTask).toMatchObject({
      key: "record_refund",
      priority: 400
    });
    await expect(
      service.getPayment("payment-replacement", "finance-1")
    ).resolves.toMatchObject({
      currentTask: { key: "record_refund", priority: 400 }
    });
    await expect(
      service.getPayment("payment-voided", "finance-1")
    ).resolves.toMatchObject({
      currentTask: { key: "none", priority: 0 }
    });
    await expect(
      service.getPayment("payment-invalidated", "finance-1")
    ).resolves.toMatchObject({
      currentTask: { key: "none", priority: 0 }
    });
  });

  it("orders blocking tasks by their discrepancy fact time before payment update time", async () => {
    const fixture = buildFixture();
    const latePaymentUpdate = new Date("2026-07-19T10:00:00.000Z");
    const earlyPaymentUpdate = new Date("2026-07-18T10:00:00.000Z");
    const olderDiscrepancy = new Date("2026-07-17T09:00:00.000Z");
    const newerDiscrepancy = new Date("2026-07-18T09:00:00.000Z");
    fixture.prisma.spotProcurementPayment.findMany.mockResolvedValue([
      paymentRow({
        id: "payment-old-fact",
        code: "LXFK-OLD-FACT",
        procurementVersionId: "version-old-fact",
        status: "paid",
        updatedAt: latePaymentUpdate
      }),
      paymentRow({
        id: "payment-new-fact",
        code: "LXFK-NEW-FACT",
        procurementVersionId: "version-new-fact",
        status: "partially_paid",
        paidAmountCents: 1_000n,
        updatedAt: earlyPaymentUpdate
      })
    ]);
    fixture.prisma.spotProcurementVersion.findMany.mockResolvedValue([
      versionRow({ id: "version-old-fact" }),
      versionRow({ id: "version-new-fact" })
    ]);
    fixture.prisma.spotProcurementDiscrepancy.findMany.mockResolvedValue([
      {
        id: "discrepancy-old",
        procurementId: "procurement-1",
        procurementVersionId: "version-old-fact",
        status: "awaiting_refund",
        resolutionType: "full_refund",
        createdAt: olderDiscrepancy,
        updatedAt: olderDiscrepancy
      }
    ]);
    fixture.prisma.spotProcurementPaymentExecution.findMany.mockResolvedValue([
      {
        id: "execution-new-fact",
        paymentId: "payment-new-fact",
        amountCents: 1_000n,
        paidAt: newerDiscrepancy,
        voucherFileId: null,
        voidedAt: null,
        createdAt: newerDiscrepancy
      }
    ]);
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    const result = await service.listPayments("finance-1", {});

    expect(result.items.map((item) => item.id)).toEqual([
      "payment-old-fact",
      "payment-new-fact"
    ]);
    expect(result.items.map((item) => item.currentTask.key)).toEqual([
      "record_refund",
      "view_only"
    ]);
  });
});
