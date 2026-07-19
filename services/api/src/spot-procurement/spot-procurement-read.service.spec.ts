import { ForbiddenException } from "@nestjs/common";
import { SpotProcurementReadService } from "./spot-procurement-read.service";

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
      findFirst: jest.fn().mockResolvedValue(null)
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
        { positionId: "position-finance-staff" }
      ])
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([])
    },
    position: {
      findFirst: jest.fn().mockResolvedValue({
        id: "position-finance-staff"
      }),
      findMany: jest.fn().mockResolvedValue([])
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
  it("excludes abandoned payment drafts by default and exposes them only through the explicit ended filter", async () => {
    const fixture = buildFixture();
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await service.listPayments("finance-1", {});
    expect(fixture.prisma.spotProcurementPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "invalidated" } })
      })
    );

    fixture.prisma.spotProcurementPayment.findMany.mockClear();
    await service.listPayments("finance-1", { status: "invalidated" });
    expect(fixture.prisma.spotProcurementPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "invalidated" })
      })
    );
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
    expect(fixture.prisma.spotProcurement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "abandoned" } })
      })
    );
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
        invoices: [{ id: "spot-invoice-1", fileId: "invoice-file-1" }]
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
      invoices: [{ id: "spot-invoice-1", fileId: "invoice-file-1" }]
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
        approvedQuantitySnapshot: { toString: () => "100" },
        paymentQuantity: { toString: () => "100" },
        unitPrice: { toString: () => "1.2" },
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
      invalidatedAt: null
    };
    fixture.prisma.spotProcurementReceipt.findUnique.mockResolvedValue(receipt);
    fixture.prisma.spotProcurementReceipt.findMany.mockResolvedValue([receipt]);
    const paymentInvoices = {
      summary: jest.fn().mockResolvedValue({
        status: "pending",
        statusLabel: "待补发票",
        activeCount: 0,
        invoices: []
      })
    };
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
        approvalAmountCents: "12000",
        actualPaidAmountCents: "5000",
        remainingAmountCents: "7000"
      },
      receipt: { openAfterActualPayment: true }
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
      payment: { approvalAmountCents: "12000" }
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
      expect.objectContaining({ vatRateOptionId: "vat-13" })
    ]);
    expect((paymentDetail as { paymentChannels: unknown }).paymentChannels).toEqual([
      expect.objectContaining({ accountNumberLast4: "1234" })
    ]);
    expect(paymentDetail).not.toHaveProperty("balanceExecution");
    expect(JSON.stringify(paymentDetail)).not.toContain("6222020202021234");
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
    expect(result.truncated).toBe(false);
    expect(fixture.prisma.spotProcurement.findMany).toHaveBeenCalledTimes(2);
  });

  it("stops procurement and payment ACL scans at the fixed source-row ceiling", async () => {
    const fixture = buildFixture();
    const deniedProcurements = Array.from(
      { length: 200 },
      (_value, index) =>
        procurementRow({
          id: `denied-${index}`,
          code: `LXCG-DENIED-${index}`
        })
    );
    const deniedPayments = Array.from(
      { length: 200 },
      (_value, index) =>
        paymentRow({
          id: `payment-denied-${index}`,
          code: `LXFK-DENIED-${index}`
        })
    );
    fixture.prisma.spotProcurement.findMany = jest
      .fn()
      .mockResolvedValue(deniedProcurements);
    fixture.prisma.spotProcurementPayment.findMany = jest
      .fn()
      .mockResolvedValue(deniedPayments);
    fixture.access.accessibleProcurementIds.mockResolvedValue(new Set());
    fixture.access.accessiblePaymentIds.mockResolvedValue(new Set());
    const service = new SpotProcurementReadService(
      fixture.prisma as never,
      fixture.visibility as never,
      fixture.access as never,
      fixture.pilot as never
    );

    await expect(
      service.listProcurements("unrelated-user", {})
    ).resolves.toMatchObject({ items: [], truncated: true });
    expect(fixture.prisma.spotProcurement.findMany).toHaveBeenCalledTimes(10);

    await expect(
      service.listPayments("unrelated-user", {})
    ).resolves.toMatchObject({ items: [], truncated: true });
    expect(
      fixture.prisma.spotProcurementPayment.findMany
    ).toHaveBeenCalledTimes(10);
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
});
