import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
import { createApiValidationPipe } from "../validation/api-validation";
import { ConfirmAbnormalTerminationDto } from "./dto/confirm-abnormal-termination.dto";
import { RequestAbnormalTerminationDto } from "./dto/request-abnormal-termination.dto";
import { SpotProcurementApplicationService } from "./spot-procurement-application.service";

const realFormDraft = {
  projectId: "project-1",
  applicationDepartment: "工程部",
  applicationName: "杨帅",
  requestedArrivalAt: "2026-07-20T00:00:00.000Z",
  reason: "新运粮河分洪工程现场需补充免烧砖",
  note: "优先送至北门",
  lines: [
    {
      materialName: "免烧砖",
      specification: "240×115×53",
      unit: "块",
      quantity: "1200",
      note: "二次结构"
    }
  ],
  attachments: []
};

function procurement(status = "draft") {
  return {
    id: "procurement-1",
    projectId: "project-1",
    code: "LXCG-001",
    applicantUserId: "material-1",
    handlerUserId: "material-1",
    currentVersionId: "version-1",
    status,
    closedAt: null,
    supplierPartyId: null,
    supplierKey: null,
    supplierNameSnapshot: null,
    approvedAmountCents: null,
    actualCostCents: null
  };
}

function version(status = "draft") {
  return {
    id: "version-1",
    procurementId: "procurement-1",
    versionNo: 1,
    status,
    reason: realFormDraft.reason,
    note: realFormDraft.note,
    supplierPartyId: null,
    supplierKey: null,
    supplierNameSnapshot: null,
    handlerUserId: "material-1",
    applicationDepartmentSnapshot: realFormDraft.applicationDepartment,
    applicationNameSnapshot: realFormDraft.applicationName,
    purchaserNameSnapshot: "杨帅",
    purchaserDepartmentId: "department-1",
    purchaserDepartmentNameSnapshot: "工程部",
    requestedArrivalAt: new Date(realFormDraft.requestedArrivalAt),
    totalAmountCents: null,
    changeReason: null,
    changeSummary: null,
    submittedAt: null,
    approvedAt: null,
    createdByUserId: "material-1"
  };
}

function frozenRealFormLine(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    versionId: "version-1",
    sortOrder: 1,
    materialName: "免烧砖",
    specification: "240×115×53",
    unit: "块",
    quantity: { toString: () => "1200" },
    invoiceMode: null,
    invoiceType: null,
    vatRateOptionId: null,
    vatRateValueSnapshot: null,
    vatRateLabelSnapshot: null,
    unitPrice: null,
    amountCents: null,
    usageLocation: null,
    note: "二次结构",
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    ...overrides
  };
}

function context(roleKey = "material_staff") {
  const tx = {
    project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true }) },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: { findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }]) },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "material-1",
        name: "杨帅",
        departmentId: "department-1",
        isActive: true
      })
    },
    department: { findUnique: jest.fn().mockResolvedValue({ name: "工程部", isActive: true }) },
    fileObject: { findMany: jest.fn().mockResolvedValue([]) },
    spotProcurement: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...procurement(), ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    spotProcurementVersion: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...version(), ...data })),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    spotProcurementLine: {
      count: jest.fn().mockResolvedValue(1),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([frozenRealFormLine()])
    },
    spotProcurementAttachment: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([])
    },
    approvalInstance: {
      create: jest.fn().mockResolvedValue({ id: "approval-1" }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    approvalActionLog: { create: jest.fn().mockResolvedValue({}) },
    spotProcurementPayment: {
      create: jest.fn().mockResolvedValue({ id: "payment-1", code: "LXCG-001-V1-P001" }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    spotProcurementReceipt: {
      create: jest.fn().mockResolvedValue({ id: "receipt-1" }),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    spotProcurementReceiptDelegation: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    spotProcurementReceiptRevision: {
      create: jest.fn().mockResolvedValue({ id: "receipt-revision-1" })
    },
    spotProcurementPaymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
    spotProcurementAbnormalTermination: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "termination-1",
          requestedAt: new Date("2026-07-18T08:00:00.000Z"),
          confirmedByUserId: null,
          confirmedAt: null,
          ...data
        })
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    $queryRaw: jest.fn()
  };
  const prisma = { $transaction: jest.fn(async (operation) => operation(tx)) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const pilot = { assertEnabled: jest.fn() };
  const approvalForms = { tryRefreshLatestForBusiness: jest.fn().mockResolvedValue(undefined) };
  const balances = { releaseForShortage: jest.fn().mockResolvedValue({}) };
  return {
    tx,
    audit,
    balances,
    pilot,
    approvalForms,
    service: new SpotProcurementApplicationService(
      prisma as never,
      audit as never,
      pilot as never,
      approvalForms as never,
      undefined,
      balances as never
    )
  };
}

function mockAbandonmentLocks(
  tx: ReturnType<typeof context>["tx"],
  options: {
    root?: ReturnType<typeof procurement>;
    currentVersion?: ReturnType<typeof version>;
    versions?: Array<{ id: string; submittedAt: Date | null }>;
    payments?: Array<{
      id: string;
      status: string;
      submittedAt: Date | null;
      supplierBalanceAmountCents: bigint;
    }>;
    approvals?: Array<{ id: string; businessType: string; status: string }>;
    approvalActions?: Array<{ id: string }>;
    reservations?: Array<{
      accountId: string;
      paymentId: string;
      amountCents: bigint;
      releasedAmountCents: bigint;
      status: string;
    }>;
    executions?: Array<{ id: string }>;
    receipt?: Record<string, unknown> | null;
    receiptRevision?: Array<{ id: string }>;
    delegations?: Array<{ id: string; revokedAt: Date | null }>;
    reviews?: Array<{ id: string }>;
    discrepancies?: Array<{ id: string }>;
    refunds?: Array<{ id: string }>;
    paymentArchives?: Array<{ id: string }>;
    archiveRecords?: Array<{ id: string }>;
    lockCurrentVersion?: boolean;
  } = {}
) {
  const versions = options.versions ?? [{ id: "version-1", submittedAt: null }];
  const payments = options.payments ?? [];
  const approvals = options.approvals ?? [];
  tx.$queryRaw
    .mockResolvedValueOnce([options.root ?? procurement()]);
  if (options.lockCurrentVersion !== false) {
    tx.$queryRaw.mockResolvedValueOnce([options.currentVersion ?? version()]);
  }
  tx.$queryRaw
    .mockResolvedValueOnce(versions)
    .mockResolvedValueOnce(payments)
    .mockResolvedValueOnce(approvals);
  if (approvals.length) {
    tx.$queryRaw.mockResolvedValueOnce(options.approvalActions ?? []);
  }
  if (payments.length) {
    const reservations = options.reservations ?? [];
    tx.$queryRaw.mockResolvedValueOnce(reservations);
    if (reservations.length) {
      tx.$queryRaw.mockResolvedValueOnce(
        reservations.map((reservation) => ({ id: reservation.accountId }))
      );
    }
    tx.$queryRaw.mockResolvedValueOnce(options.executions ?? []);
  }
  tx.$queryRaw.mockResolvedValueOnce(options.receipt ? [options.receipt] : []);
  if (options.receipt) {
    tx.$queryRaw
      .mockResolvedValueOnce(options.receiptRevision ?? [{ id: "receipt-revision-1" }])
      .mockResolvedValueOnce(options.delegations ?? [])
      .mockResolvedValueOnce(options.reviews ?? []);
  }
  tx.$queryRaw
    .mockResolvedValueOnce(options.discrepancies ?? [])
    .mockResolvedValueOnce(options.refunds ?? []);
  if (payments.length) {
    tx.$queryRaw.mockResolvedValueOnce(options.paymentArchives ?? []);
  }
  tx.$queryRaw.mockResolvedValueOnce(options.archiveRecords ?? []);
}

describe("SpotProcurementApplicationService real-form application", () => {
  it("requires an explicit confirmation before the finance director can terminate a paid procurement", async () => {
    const pipe = createApiValidationPipe();

    await expect(
      pipe.transform(
        { reason: "   " },
        { type: "body", metatype: RequestAbnormalTerminationDto }
      )
    ).rejects.toMatchObject({
      response: { errors: expect.arrayContaining(["异常终止原因不能为空白"]) }
    });
    await expect(
      pipe.transform(
        { confirmTermination: false },
        { type: "body", metatype: ConfirmAbnormalTerminationDto }
      )
    ).rejects.toMatchObject({
      response: {
        errors: expect.arrayContaining([
          "请明确确认异常终止本次零星采购"
        ])
      }
    });
  });

  it("freezes the paper A4 application facts without supplier, price, amount, or invoice data", async () => {
    const { service, tx } = context();

    const result = await service.createDraft("material-1", realFormDraft);

    expect(tx.spotProcurement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: expect.stringMatching(/^LXCG-\d{8}-001$/u),
        supplierPartyId: null,
        supplierKey: null,
        supplierNameSnapshot: null,
        applicantUserId: "material-1",
        handlerUserId: "material-1",
        approvedAmountCents: null
      })
    });
    expect(tx.spotProcurementVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicationDepartmentSnapshot: "工程部",
        applicationNameSnapshot: "杨帅",
        purchaserNameSnapshot: "杨帅",
        purchaserDepartmentNameSnapshot: "工程部",
        requestedArrivalAt: new Date(realFormDraft.requestedArrivalAt),
        totalAmountCents: null,
        supplierNameSnapshot: null
      })
    });
    expect(tx.spotProcurementLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          materialName: "免烧砖",
          quantity: expect.anything(),
          unitPrice: null,
          amountCents: null,
          invoiceMode: null,
          invoiceType: null
        })
      ]
    });
    expect(result).toMatchObject({
      code: expect.stringMatching(/^LXCG-\d{8}-001$/u),
      status: "draft",
      totalAmountCents: null,
      amountStatus: "pending_payment_application"
    });
  });

  it("generates a Shanghai-date application number after locking the daily sequence", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-19T00:30:00.000Z"));
    try {
      const { service, tx } = context();
      tx.spotProcurement.findMany.mockResolvedValue([
        { code: "LXCG-20260719-002" },
        { code: "LXCG-20260719-009" }
      ]);

      await expect(service.createDraft("material-1", realFormDraft)).resolves.toMatchObject({
        code: "LXCG-20260719-010"
      });
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.spotProcurement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ code: "LXCG-20260719-010" })
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("logs the material-director skip when the purchaser is the material director", async () => {
    const { service, tx } = context("material_director");
    tx.$queryRaw
      .mockResolvedValueOnce([procurement()])
      .mockResolvedValueOnce([version()]);

    await service.submit("procurement-1", "material-1");

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        frozenNodes: [
          expect.objectContaining({ name: "项目经理审批", roleKeys: ["project_manager"] })
        ]
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "node_skipped",
        comment: "申请人具备物资主管岗位，自动跳过物资主管审批"
      })
    });
  });

  it("creates the only payment draft and a receipt kept closed until actual payment", async () => {
    const { service, tx } = context("project_manager");
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approval_pending")])
      .mockResolvedValueOnce([version("approval_pending")])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] }
          ],
          applicantUserId: "material-1"
        }
      ]);

    const result = await service.review("procurement-1", "manager-1", {
      decision: "approve",
      expectedVersionId: "version-1",
      expectedApprovalInstanceId: "approval-1",
      expectedNodeIndex: 0
    });

    expect(tx.spotProcurementPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        status: "draft",
        payeeNameSnapshot: null,
        settlementAmountCents: 0n,
        companyPaymentAmountCents: 0n,
        draftOrigin: "auto_after_procurement_approval"
      })
    });
    expect(tx.spotProcurementReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        handlerUserId: "material-1",
        status: "draft",
        currentRevisionNo: 1
      })
    });
    expect(tx.spotProcurementReceiptRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        receiptId: "receipt-1",
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        revisionNo: 1,
        handlerUserId: "material-1"
      })
    });
    expect(result).toMatchObject({ status: "approved_in_progress" });
  });

  it("returns the frozen approval to a new draft revision without creating payment or receipt facts", async () => {
    const { service, tx, audit } = context("project_manager");
    tx.spotProcurementLine.findMany.mockResolvedValue([
      frozenRealFormLine()
    ]);
    tx.spotProcurementAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-1",
        versionId: "version-1",
        fileId: "file-1",
        category: "quotation",
        uploadedByUserId: "material-1"
      }
    ]);
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approval_pending")])
      .mockResolvedValueOnce([version("approval_pending")])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "项目经理审批",
              mode: "any",
              roleKeys: ["project_manager"]
            }
          ],
          applicantUserId: "material-1"
        }
      ]);
    tx.spotProcurementVersion.create.mockResolvedValueOnce({
      ...version("draft"),
      id: "version-2",
      versionNo: 2,
      changeReason: "请补充报价依据",
      createdByUserId: "manager-1"
    });

    await expect(
      service.review("procurement-1", "manager-1", {
        decision: "return_to_applicant",
        comment: "  请补充报价依据  ",
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 0
      })
    ).resolves.toMatchObject({
      status: "draft",
      currentVersionId: "version-2",
      versionNo: 2,
      versionStatus: "draft"
    });

    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        approvalInstanceId: "approval-1",
        action: "return_to_applicant",
        actorUserId: "manager-1",
        comment: "请补充报价依据",
        metadata: { reviewRoleKey: "project_manager" }
      })
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: { status: "returned_to_applicant" }
    });
    expect(tx.spotProcurementVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: { status: "returned" }
    });
    expect(tx.spotProcurementVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        procurementId: "procurement-1",
        versionNo: 2,
        status: "draft",
        changeReason: "请补充报价依据",
        createdByUserId: "manager-1"
      })
    });
    expect(tx.spotProcurementLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          versionId: "version-2",
          materialName: "免烧砖",
          quantity: expect.anything(),
          invoiceMode: null,
          invoiceType: null,
          vatRateOptionId: null,
          vatRateValueSnapshot: null,
          vatRateLabelSnapshot: null,
          unitPrice: null,
          amountCents: null,
          usageLocation: null
        })
      ]
    });
    expect(tx.spotProcurementAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          versionId: "version-2",
          fileId: "file-1",
          category: "quotation",
          uploadedByUserId: "material-1"
        }
      ]
    });
    expect(tx.spotProcurement.update).toHaveBeenCalledWith({
      where: { id: "procurement-1" },
      data: expect.objectContaining({
        currentVersionId: "version-2",
        status: "draft"
      })
    });
    expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementReceipt.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.approval.return_to_applicant",
        businessId: "version-1",
        metadata: expect.objectContaining({
          procurementId: "procurement-1",
          sourceVersionId: "version-1",
          newVersionId: "version-2",
          reviewRoleKey: "project_manager"
        })
      })
    );
  });

  it("withdraws one exact pending approval into a new draft revision with frozen coordinates", async () => {
    const { service, tx, audit, pilot } = context();
    tx.spotProcurementLine.findMany.mockResolvedValue([
      frozenRealFormLine()
    ]);
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approval_pending")])
      .mockResolvedValueOnce([version("approval_pending")])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 1,
          frozenNodes: [
            {
              name: "项目经理审批",
              mode: "any",
              roleKeys: ["project_manager"]
            }
          ],
          applicantUserId: "material-1"
        }
      ]);
    tx.spotProcurementVersion.create.mockResolvedValueOnce({
      ...version("draft"),
      id: "version-2",
      versionNo: 2,
      changeReason: "申请人撤回采购审批",
      createdByUserId: "material-1"
    });

    await expect(
      service.withdrawApproval("procurement-1", "material-1", {
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 1
      })
    ).resolves.toMatchObject({
      status: "draft",
      currentVersionId: "version-2",
      versionNo: 2,
      versionStatus: "draft"
    });

    expect(pilot.assertEnabled).toHaveBeenCalledWith("project-1");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        approvalInstanceId: "approval-1",
        action: "withdraw",
        actorUserId: "material-1"
      })
    });
    expect(tx.spotProcurementVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.spotProcurementLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          versionId: "version-2",
          materialName: "免烧砖",
          invoiceMode: null,
          vatRateOptionId: null,
          unitPrice: null,
          amountCents: null,
          usageLocation: null
        })
      ]
    });
    expect(tx.spotProcurement.update).toHaveBeenCalledWith({
      where: { id: "procurement-1" },
      data: expect.objectContaining({
        currentVersionId: "version-2",
        status: "draft"
      })
    });
    expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementReceipt.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.approval.withdraw",
        businessId: "version-1",
        metadata: expect.objectContaining({
          procurementId: "procurement-1",
          sourceVersionId: "version-1",
          newVersionId: "version-2",
          expectedVersionId: "version-1",
          expectedApprovalInstanceId: "approval-1",
          expectedNodeIndex: 1
        })
      })
    );
  });

  it.each([
    [
      "version",
      {
        expectedVersionId: "version-stale",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 1
      }
    ],
    [
      "approval instance",
      {
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-stale",
        expectedNodeIndex: 1
      }
    ],
    [
      "approval node",
      {
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 0
      }
    ]
  ])(
    "rejects a stale withdrawal %s with zero writes",
    async (_label, coordinates) => {
      const { service, tx, audit, approvalForms } = context();
      tx.$queryRaw
        .mockResolvedValueOnce([procurement("approval_pending")])
        .mockResolvedValueOnce([version("approval_pending")])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 1,
            frozenNodes: [],
            applicantUserId: "material-1"
          }
        ]);

      await expect(
        service.withdrawApproval(
          "procurement-1",
          "material-1",
          coordinates
        )
      ).rejects.toMatchObject({ status: 409 });

      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
      expect(tx.spotProcurement.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(
        approvalForms.tryRefreshLatestForBusiness
      ).not.toHaveBeenCalled();
    }
  );

  it.each(["approval_pending", "draft"])(
    "checks withdrawal ownership before pilot, current-version, and %s status disclosure",
    async (status) => {
    const { service, tx, audit, pilot } = context();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          ...procurement(status),
          applicantUserId: "applicant-1"
        }
      ])
      .mockResolvedValueOnce([version("approval_pending")]);

    await expect(
      service.withdrawApproval("procurement-1", "observer-1", {
        expectedVersionId:
          status === "approval_pending" ? "version-1" : "forged-version",
        expectedApprovalInstanceId:
          status === "approval_pending" ? "approval-1" : "forged-approval",
        expectedNodeIndex: status === "approval_pending" ? 1 : 99
      })
    ).rejects.toMatchObject({ status: 403 });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(pilot.assertEnabled).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      "legacy root and version facts on withdrawal",
      "withdraw",
      {
        root: {
          supplierPartyId: "party-1",
          supplierKey: "party:party-1",
          supplierNameSnapshot: "旧版供应商",
          approvedAmountCents: 12_000n
        },
        currentVersion: {
          supplierPartyId: "party-1",
          supplierKey: "party:party-1",
          supplierNameSnapshot: "旧版供应商",
          totalAmountCents: 12_000n
        },
        line: {
          invoiceMode: "invoice",
          invoiceType: "vat_general",
          vatRateOptionId: "vat-13",
          vatRateValueSnapshot: { toString: () => "0.13" },
          vatRateLabelSnapshot: "13%",
          unitPrice: { toString: () => "10" },
          amountCents: 12_000n,
          usageLocation: "旧版使用地点"
        }
      }
    ],
    [
      "mixed line financial facts on return to applicant",
      "return",
      {
        root: {},
        currentVersion: {},
        line: { amountCents: 1n }
      }
    ]
  ])(
    "fails %s closed before any workflow or revision write",
    async (_label, operation, legacyFacts) => {
      const { service, tx, audit, approvalForms } = context(
        "project_manager"
      );
      tx.$queryRaw
        .mockResolvedValueOnce([
          {
            ...procurement("approval_pending"),
            ...legacyFacts.root
          }
        ])
        .mockResolvedValueOnce([
          {
            ...version("approval_pending"),
            ...legacyFacts.currentVersion
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 0,
            frozenNodes: [
              {
                name: "项目经理审批",
                mode: "any",
                roleKeys: ["project_manager"]
              }
            ],
            applicantUserId: "material-1"
          }
        ]);
      tx.spotProcurementLine.findMany.mockResolvedValue([
        frozenRealFormLine(legacyFacts.line)
      ]);

      const request =
        operation === "withdraw"
          ? service.withdrawApproval("procurement-1", "material-1", {
              expectedVersionId: "version-1",
              expectedApprovalInstanceId: "approval-1",
              expectedNodeIndex: 0
            })
          : service.review("procurement-1", "manager-1", {
              decision: "return_to_applicant",
              comment: "请补充资料",
              expectedVersionId: "version-1",
              expectedApprovalInstanceId: "approval-1",
              expectedNodeIndex: 0
            });

      await expect(request).rejects.toMatchObject({ status: 409 });

      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.create).not.toHaveBeenCalled();
      expect(tx.spotProcurementLine.createMany).not.toHaveBeenCalled();
      expect(tx.spotProcurementAttachment.createMany).not.toHaveBeenCalled();
      expect(tx.spotProcurement.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(
        approvalForms.tryRefreshLatestForBusiness
      ).not.toHaveBeenCalled();
    }
  );

  it.each(["update", "submit", "approve", "create_version"] as const)(
    "keeps legacy procurement facts read-only through the %s entry point",
    async (operation) => {
      const { service, tx, audit, approvalForms } = context(
        operation === "approve" ? "project_manager" : "material_staff"
      );
      const rootStatus = operation === "approve" ? "approval_pending" : "draft";
      const versionStatus =
        operation === "approve"
          ? "approval_pending"
          : operation === "create_version"
            ? "rejected"
            : "draft";
      tx.$queryRaw
        .mockResolvedValueOnce([
          {
            ...procurement(rootStatus),
            supplierPartyId: "party-legacy",
            supplierKey: "party:party-legacy",
            supplierNameSnapshot: "旧版供应商"
          }
        ])
        .mockResolvedValueOnce([version(versionStatus)]);
      if (operation === "approve") {
        tx.$queryRaw.mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 0,
            frozenNodes: [
              {
                name: "项目经理审批",
                mode: "any",
                roleKeys: ["project_manager"]
              }
            ],
            applicantUserId: "material-1"
          }
        ]);
      }

      const request =
        operation === "update"
          ? service.updateDraft(
              "procurement-1",
              "material-1",
              realFormDraft
            )
          : operation === "submit"
            ? service.submit("procurement-1", "material-1")
            : operation === "approve"
              ? service.review("procurement-1", "manager-1", {
                  decision: "approve",
                  expectedVersionId: "version-1",
                  expectedApprovalInstanceId: "approval-1",
                  expectedNodeIndex: 0
                })
              : service.createVersion("procurement-1", "material-1", {
                  ...realFormDraft,
                  changeReason: "调整采购范围"
                });

      await expect(request).rejects.toMatchObject({ status: 409 });

      expect(tx.approvalInstance.create).not.toHaveBeenCalled();
      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.create).not.toHaveBeenCalled();
      expect(tx.spotProcurementLine.deleteMany).not.toHaveBeenCalled();
      expect(tx.spotProcurementLine.createMany).not.toHaveBeenCalled();
      expect(tx.spotProcurementAttachment.deleteMany).not.toHaveBeenCalled();
      expect(tx.spotProcurementAttachment.createMany).not.toHaveBeenCalled();
      expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
      expect(tx.spotProcurement.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(
        approvalForms.tryRefreshLatestForBusiness
      ).not.toHaveBeenCalled();
    }
  );

  it.each<
    [
      string,
      {
        lines?: Array<ReturnType<typeof frozenRealFormLine>>;
        version?: { handlerUserId: string };
        payment?: boolean;
        receipt?: boolean;
      }
    ]
  >([
    ["empty material facts", { lines: [] }],
    ["mismatched frozen handler", { version: { handlerUserId: "other-handler" } }],
    ["existing payment facts", { payment: true }],
    ["existing receipt facts", { receipt: true }]
  ])(
    "fails withdrawal closed for %s before any workflow write",
    async (_label, anomaly) => {
      const { service, tx, audit, approvalForms } = context();
      tx.$queryRaw
        .mockResolvedValueOnce([procurement("approval_pending")])
        .mockResolvedValueOnce([
          {
            ...version("approval_pending"),
            ...(anomaly.version ?? {})
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 1,
            frozenNodes: [],
            applicantUserId: "material-1"
          }
        ]);
      tx.spotProcurementLine.findMany.mockResolvedValue(
        anomaly.lines ?? [frozenRealFormLine()]
      );
      if (anomaly.payment) {
        tx.spotProcurementPayment.findMany.mockResolvedValue([
          { id: "payment-legacy" }
        ]);
      }
      if (anomaly.receipt) {
        tx.spotProcurementReceipt.findUnique.mockResolvedValue({
          id: "receipt-legacy"
        });
      }

      await expect(
        service.withdrawApproval("procurement-1", "material-1", {
          expectedVersionId: "version-1",
          expectedApprovalInstanceId: "approval-1",
          expectedNodeIndex: 1
        })
      ).rejects.toMatchObject({ status: 409 });

      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.create).not.toHaveBeenCalled();
      expect(tx.spotProcurement.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(
        approvalForms.tryRefreshLatestForBusiness
      ).not.toHaveBeenCalled();
    }
  );

  it("rejects a withdrawal when the frozen approval applicant does not match the procurement applicant", async () => {
    const { service, tx, audit } = context();
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approval_pending")])
      .mockResolvedValueOnce([version("approval_pending")])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 1,
          frozenNodes: [],
          applicantUserId: "different-applicant"
        }
      ]);

    await expect(
      service.withdrawApproval("procurement-1", "material-1", {
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 1
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
    expect(tx.spotProcurement.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects approval review when the frozen applicant does not match the procurement applicant", async () => {
    const { service, tx, audit } = context("project_manager");
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approval_pending")])
      .mockResolvedValueOnce([version("approval_pending")])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "项目经理审批",
              mode: "any",
              roleKeys: ["project_manager"]
            }
          ],
          applicantUserId: "different-applicant"
        }
      ]);

    await expect(
      service.review("procurement-1", "manager-1", {
        decision: "approve",
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 0
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
    expect(tx.spotProcurement.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    [
      "duplicate",
      [
        {
          id: "approval-2",
          status: "approval_pending",
          currentNodeIndex: 1,
          frozenNodes: [],
          applicantUserId: "material-1"
        },
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 1,
          frozenNodes: [],
          applicantUserId: "material-1"
        }
      ]
    ]
  ])(
    "fails withdrawal closed for a %s pending approval instance set",
    async (_label, approvals) => {
      const { service, tx, audit, approvalForms } = context();
      tx.$queryRaw
        .mockResolvedValueOnce([procurement("approval_pending")])
        .mockResolvedValueOnce([version("approval_pending")])
        .mockResolvedValueOnce(approvals);

      await expect(
        service.withdrawApproval("procurement-1", "material-1", {
          expectedVersionId: "version-1",
          expectedApprovalInstanceId: "approval-1",
          expectedNodeIndex: 1
        })
      ).rejects.toMatchObject({ status: 409 });

      const approvalLockSql = tx.$queryRaw.mock.calls[2]?.[0] as {
        strings?: readonly string[];
      };
      const approvalLockText =
        approvalLockSql.strings?.join(" ") ?? "";
      expect(approvalLockText).toContain(
        'ORDER BY "updatedAt" DESC, "id" DESC'
      );
      expect(approvalLockText).toContain("FOR UPDATE");
      expect(approvalLockText).not.toContain("LIMIT 1");
      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
      expect(tx.spotProcurement.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(
        approvalForms.tryRefreshLatestForBusiness
      ).not.toHaveBeenCalled();
    }
  );

  it("rejects a row-lock-serialized duplicate review before it crosses into the actor's next role", async () => {
    const { service, tx, audit } = context();
    tx.projectMember.findMany.mockResolvedValue([
      { positionKey: "material_director" },
      { positionKey: "project_manager" }
    ]);
    const frozenNodes = [
      {
        name: "物资主管审批",
        mode: "any",
        roleKeys: ["material_director"]
      },
      {
        name: "项目经理审批",
        mode: "any",
        roleKeys: ["project_manager"]
      }
    ];
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approval_pending")])
      .mockResolvedValueOnce([version("approval_pending")])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes,
          applicantUserId: "material-1"
        }
      ])
      .mockResolvedValueOnce([procurement("approval_pending")])
      .mockResolvedValueOnce([version("approval_pending")])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 1,
          frozenNodes: [
            { ...frozenNodes[0], approvedRoleKeys: ["material_director"] },
            frozenNodes[1]
          ],
          applicantUserId: "material-1"
        }
      ]);
    const frozenRequest = {
      decision: "approve" as const,
      expectedVersionId: "version-1",
      expectedApprovalInstanceId: "approval-1",
      expectedNodeIndex: 0
    };

    await expect(
      service.review("procurement-1", "dual-role-1", frozenRequest)
    ).resolves.toMatchObject({ status: "approval_pending" });
    await expect(
      service.review("procurement-1", "dual-role-1", frozenRequest)
    ).rejects.toMatchObject({
      status: 409
    });

    expect(tx.approvalActionLog.create).toHaveBeenCalledTimes(1);
    expect(tx.approvalInstance.update).toHaveBeenCalledTimes(1);
    expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "version",
      {
        decision: "approve",
        expectedVersionId: "version-stale",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 0
      }
    ],
    [
      "approval instance",
      {
        decision: "reject",
        comment: "资料不完整",
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-stale",
        expectedNodeIndex: 0
      }
    ],
    [
      "approval node",
      {
        decision: "approve",
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 1
      }
    ]
  ])("rejects a stale expected %s with zero writes", async (_label, coordinates) => {
    const { service, tx, audit, approvalForms } = context("project_manager");
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approval_pending")])
      .mockResolvedValueOnce([version("approval_pending")])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [
            {
              name: "项目经理审批",
              mode: "any",
              roleKeys: ["project_manager"]
            }
          ],
          applicantUserId: "applicant-1"
        }
      ]);

    await expect(
      service.review("procurement-1", "manager-1", coordinates as never)
    ).rejects.toMatchObject({
      status: 409
    });

    const approvalLockSql = tx.$queryRaw.mock.calls[2]?.[0] as {
      strings?: readonly string[];
    };
    const approvalLockText = approvalLockSql.strings?.join(" ") ?? "";
    expect(approvalLockText).toContain(
      'ORDER BY "updatedAt" DESC, "id" DESC'
    );
    expect(approvalLockText).toContain("FOR UPDATE");
    expect(approvalLockText).not.toContain("LIMIT 1");
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.spotProcurement.update).not.toHaveBeenCalled();
    expect(tx.spotProcurement.updateMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementReceipt.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementReceiptRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(approvalForms.tryRefreshLatestForBusiness).not.toHaveBeenCalled();
  });

  it.each([
    [
      "non-node reviewer with wrong coordinates",
      "finance_director",
      "finance-director-1",
      "applicant-1",
      {
        expectedVersionId: "version-stale",
        expectedApprovalInstanceId: "approval-stale",
        expectedNodeIndex: 9
      }
    ],
    [
      "non-node reviewer with correctly guessed coordinates",
      "finance_director",
      "finance-director-1",
      "applicant-1",
      {
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 0
      }
    ],
    [
      "ordinary self-reviewer with wrong coordinates",
      "project_manager",
      "manager-1",
      "manager-1",
      {
        expectedVersionId: "version-stale",
        expectedApprovalInstanceId: "approval-stale",
        expectedNodeIndex: 9
      }
    ],
    [
      "ordinary self-reviewer with correctly guessed coordinates",
      "project_manager",
      "manager-1",
      "manager-1",
      {
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-1",
        expectedNodeIndex: 0
      }
    ]
  ])(
    "returns the same 403 with zero writes for %s",
    async (_label, roleKey, actorUserId, applicantUserId, coordinates) => {
      const { service, tx, audit, approvalForms } = context(roleKey);
      tx.$queryRaw
        .mockResolvedValueOnce([procurement("approval_pending")])
        .mockResolvedValueOnce([version("approval_pending")])
        .mockResolvedValueOnce([
          {
            id: "approval-1",
            status: "approval_pending",
            currentNodeIndex: 0,
            frozenNodes: [
              {
                name: "项目经理审批",
                mode: "any",
                roleKeys: ["project_manager"]
              }
            ],
            applicantUserId
          }
        ]);

      await expect(
        service.review("procurement-1", actorUserId, {
          decision: "approve",
          ...coordinates
        } as never)
      ).rejects.toMatchObject({
        status: 403
      });

      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.updateMany).not.toHaveBeenCalled();
      expect(tx.spotProcurement.update).not.toHaveBeenCalled();
      expect(tx.spotProcurement.updateMany).not.toHaveBeenCalled();
      expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
      expect(tx.spotProcurementReceipt.create).not.toHaveBeenCalled();
      expect(tx.spotProcurementReceiptRevision.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(approvalForms.tryRefreshLatestForBusiness).not.toHaveBeenCalled();
    }
  );

  it("fails closed with zero writes when the current version has two pending approval instances", async () => {
    const { service, tx, audit, approvalForms } = context("project_manager");
    const frozenNodes = [
      {
        name: "项目经理审批",
        mode: "any",
        roleKeys: ["project_manager"]
      }
    ];
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approval_pending")])
      .mockResolvedValueOnce([version("approval_pending")])
      .mockResolvedValueOnce([
        {
          id: "approval-2",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes,
          applicantUserId: "applicant-1"
        },
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes,
          applicantUserId: "applicant-1"
        }
      ]);

    await expect(
      service.review("procurement-1", "manager-1", {
        decision: "approve",
        expectedVersionId: "version-1",
        expectedApprovalInstanceId: "approval-2",
        expectedNodeIndex: 0
      })
    ).rejects.toMatchObject({
      status: 409
    });

    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.spotProcurement.update).not.toHaveBeenCalled();
    expect(tx.spotProcurement.updateMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementReceipt.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementReceiptRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(approvalForms.tryRefreshLatestForBusiness).not.toHaveBeenCalled();
  });

  it("refuses a normal procurement version change after any real payment", async () => {
    const { service, tx } = context("material_staff");
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approved_in_progress")])
      .mockResolvedValueOnce([version("approved")]);
    tx.spotProcurementPayment.findMany.mockResolvedValue([{ id: "payment-1", status: "paid" }]);
    tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue({ id: "execution-1" });

    await expect(
      service.createVersion("procurement-1", "material-1", {
        ...realFormDraft,
        changeReason: "材料范围发生变化"
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<ConflictException>>({
        message: "采购已发生真实付款，不能通过普通版本变更覆盖既有事实"
      })
    );
  });

  it("keeps normal voiding available only before real payment", async () => {
    const { service, tx } = context("project_manager");
    mockAbandonmentLocks(tx, {
      root: procurement("approved_in_progress"),
      payments: [{
        id: "payment-1",
        status: "draft",
        submittedAt: null,
        supplierBalanceAmountCents: 0n
      }],
      executions: [{ id: "execution-1" }]
      ,lockCurrentVersion: false
    });

    await expect(
      service.voidProcurement(
        "procurement-1",
        "manager-1",
        "已付款，改走异常终止"
      )
    ).rejects.toMatchObject({ message: "采购已发生实际付款历史，不能放弃或撤销" });
  });

  it("deletes a never-submitted procurement draft without deleting evidence", async () => {
    const { service, tx, audit } = context("material_staff");
    mockAbandonmentLocks(tx);

    await expect(
      service.abandonDraft("procurement-1", "material-1", {
        action: "delete_pristine_draft"
      })
    ).resolves.toMatchObject({
      status: "abandoned",
      action: "delete_pristine_draft",
      idempotent: false
    });
    expect(tx.spotProcurementVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({ status: "abandoned", abandonReason: null })
    });
    expect(tx.spotProcurement.updateMany).toHaveBeenCalledWith({
      where: {
        id: "procurement-1",
        status: "draft",
        currentVersionId: "version-1"
      },
      data: expect.objectContaining({ status: "abandoned", abandonReason: null })
    });
    expect(tx.fileObject.findMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "spot_procurement.draft.delete",
      businessId: "procurement-1"
    }));
  });

  it("requires abandonment with a reason when any procurement version was submitted", async () => {
    const { service, tx } = context("material_staff");
    mockAbandonmentLocks(tx, {
      versions: [
        { id: "version-0", submittedAt: new Date("2026-07-18T00:00:00.000Z") },
        { id: "version-1", submittedAt: null }
      ],
      approvals: [{
        id: "approval-1",
        businessType: "spot_procurement_version",
        status: "returned_to_applicant"
      }],
      approvalActions: [{ id: "action-1" }]
    });
    await expect(
      service.abandonDraft("procurement-1", "material-1", {
        action: "delete_pristine_draft"
      })
    ).rejects.toThrow("只能放弃申请");

    const second = context("material_staff");
    mockAbandonmentLocks(second.tx, {
      versions: [
        { id: "version-0", submittedAt: new Date("2026-07-18T00:00:00.000Z") },
        { id: "version-1", submittedAt: null }
      ],
      approvals: [{
        id: "approval-1",
        businessType: "spot_procurement_version",
        status: "returned_to_applicant"
      }],
      approvalActions: [{ id: "action-1" }]
    });
    await expect(
      second.service.abandonDraft("procurement-1", "material-1", {
        action: "abandon_application",
        reason: "   "
      })
    ).rejects.toThrow("必须填写原因");
  });

  it("allows only the current handler who still has a material role", async () => {
    const other = context("material_staff");
    other.tx.$queryRaw
      .mockResolvedValueOnce([procurement()])
      .mockResolvedValueOnce([version()]);
    await expect(
      other.service.abandonDraft("procurement-1", "other-material-user", {
        action: "delete_pristine_draft"
      })
    ).rejects.toThrow("只有当前采购经办人");

    const noRole = context("employee");
    noRole.tx.$queryRaw
      .mockResolvedValueOnce([procurement()])
      .mockResolvedValueOnce([version()]);
    await expect(
      noRole.service.abandonDraft("procurement-1", "material-1", {
        action: "delete_pristine_draft"
      })
    ).rejects.toThrow("不再具备物资岗位");
  });

  it("invalidates only safe child drafts, revokes receipt delegation, and closes returned approvals", async () => {
    const { service, tx } = context("material_staff");
    mockAbandonmentLocks(tx, {
      versions: [
        { id: "version-0", submittedAt: new Date("2026-07-18T00:00:00.000Z") },
        { id: "version-1", submittedAt: null }
      ],
      payments: [{
        id: "payment-draft",
        status: "draft",
        submittedAt: null,
        supplierBalanceAmountCents: 0n
      }],
      approvals: [{
        id: "approval-returned",
        businessType: "spot_procurement_version",
        status: "returned_to_applicant"
      }],
      receipt: {
        id: "receipt-1",
        status: "draft",
        currentRevisionNo: 1,
        firstSubmittedAt: null,
        submittedAt: null,
        invalidatedAt: null
      },
      delegations: [{ id: "delegation-1", revokedAt: null }]
    });

    await service.abandonDraft("procurement-1", "material-1", {
      action: "abandon_application",
      reason: "现场需求已取消"
    });

    expect(tx.spotProcurementPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["payment-draft"] }, submittedAt: null })
      })
    );
    expect(tx.spotProcurementReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "invalidated" })
      })
    );
    expect(tx.spotProcurementReceiptDelegation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["delegation-1"] }, revokedAt: null }
      })
    );
    expect(tx.approvalInstance.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["approval-returned"] },
        status: {
          in: ["approval_pending", "in_progress", "returned_to_applicant"]
        }
      },
      data: { status: "cancelled" }
    });
  });

  it("releases only the residual reserved balance once before invalidating a child draft", async () => {
    const { service, tx, balances } = context("material_staff");
    mockAbandonmentLocks(tx, {
      root: { ...procurement(), supplierKey: "party:supplier-1" } as never,
      payments: [{
        id: "payment-draft",
        status: "draft",
        submittedAt: null,
        supplierBalanceAmountCents: 100n
      }],
      reservations: [{
        accountId: "balance-account-1",
        paymentId: "payment-draft",
        amountCents: 100n,
        releasedAmountCents: 40n,
        status: "reserved"
      }]
    });

    await service.abandonDraft("procurement-1", "material-1", {
      action: "delete_pristine_draft"
    });

    expect(balances.releaseForShortage).toHaveBeenCalledTimes(1);
    expect(balances.releaseForShortage).toHaveBeenCalledWith(tx, {
      paymentId: "payment-draft",
      expectedReservedAmountCents: 100n,
      releaseAmountCents: 60n,
      expectedProjectId: "project-1",
      expectedSupplierKey: "party:supplier-1",
      actorUserId: "material-1",
      reason: "删除从未提交的采购草稿"
    });
  });

  it.each([
    ["submitted payment", { payments: [{ id: "payment-1", status: "approval_pending", submittedAt: new Date(), supplierBalanceAmountCents: 0n }] }, "正式付款申请"],
    ["executed balance", { payments: [{ id: "payment-1", status: "draft", submittedAt: null, supplierBalanceAmountCents: 100n }], reservations: [{ accountId: "balance-account-1", paymentId: "payment-1", amountCents: 100n, releasedAmountCents: 0n, status: "executed" }] }, "余额抵扣"],
    ["submitted receipt", { receipt: { id: "receipt-1", status: "submitted", currentRevisionNo: 1, firstSubmittedAt: new Date(), submittedAt: new Date(), invalidatedAt: null } }, "收货单已提交"],
    ["discrepancy", { discrepancies: [{ id: "discrepancy-1" }] }, "收货差异"],
    ["refund", { refunds: [{ id: "refund-1" }] }, "退款事实"],
    ["archive", { archiveRecords: [{ id: "archive-1" }] }, "归档证据"]
  ])("fails closed on %s facts", async (_name, options, message) => {
    const { service, tx } = context("material_staff");
    mockAbandonmentLocks(tx, options as never);
    await expect(
      service.abandonDraft("procurement-1", "material-1", {
        action: "delete_pristine_draft"
      })
    ).rejects.toThrow(message as string);
    expect(tx.spotProcurement.updateMany).not.toHaveBeenCalled();
  });

  it("returns an existing abandonment without releasing or auditing twice", async () => {
    const { service, tx, audit, balances } = context("material_staff");
    tx.$queryRaw.mockResolvedValueOnce([{
      ...procurement("abandoned"),
      abandonedAt: new Date("2026-07-19T10:00:00.000Z"),
      abandonedByUserId: "material-1",
      abandonReason: "现场取消"
    }]);

    await expect(
      service.abandonDraft("procurement-1", "material-1", {
        action: "abandon_application",
        reason: "现场取消"
      })
    ).resolves.toMatchObject({ status: "abandoned", idempotent: true });
    expect(balances.releaseForShortage).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("lets the handler request paid-procurement termination and makes the same request idempotent", async () => {
    const { service, tx } = context("material_staff");
    const request = { reason: "商户无法继续供货，需要终止" };
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approved_in_progress")])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([procurement("approved_in_progress")])
      .mockResolvedValueOnce([
        {
          id: "termination-1",
          procurementId: "procurement-1",
          status: "requested",
          reason: request.reason,
          requestedByUserId: "material-1",
          requestedAt: new Date("2026-07-18T08:00:00.000Z"),
          confirmedByUserId: null,
          confirmedAt: null
        }
      ]);
    tx.spotProcurementPayment.findMany.mockResolvedValue([
      { id: "payment-1" }
    ]);
    tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue({
      id: "execution-1"
    });

    const first = await service.requestAbnormalTermination(
      "procurement-1",
      "material-1",
      request
    );
    const replay = await service.requestAbnormalTermination(
      "procurement-1",
      "material-1",
      request
    );

    expect(first).toEqual(replay);
    expect(
      tx.spotProcurementAbnormalTermination.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        procurementId: "procurement-1",
        status: "requested",
        reason: request.reason,
        requestedByUserId: "material-1"
      })
    });
    expect(
      tx.spotProcurementAbnormalTermination.create
    ).toHaveBeenCalledTimes(1);
  });

  it("only lets the finance director confirm once and locks the procurement as abnormally terminated", async () => {
    const { service, tx } = context("finance_director");
    const termination = {
      id: "termination-1",
      procurementId: "procurement-1",
      status: "requested",
      reason: "商户无法继续供货",
      requestedByUserId: "material-1",
      requestedAt: new Date("2026-07-18T08:00:00.000Z"),
      confirmedByUserId: null,
      confirmedAt: null
    };
    tx.$queryRaw
      .mockResolvedValueOnce([procurement("approved_in_progress")])
      .mockResolvedValueOnce([termination]);
    tx.spotProcurementPayment.findMany.mockResolvedValue([
      { id: "payment-1" }
    ]);
    tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue({
      id: "execution-1"
    });

    const result = await service.confirmAbnormalTermination(
      "procurement-1",
      "finance-director-1",
      { confirmTermination: true }
    );

    expect(result).toMatchObject({ status: "confirmed" });
    expect(
      tx.spotProcurementAbnormalTermination.updateMany
    ).toHaveBeenCalledWith({
      where: { id: "termination-1", status: "requested" },
      data: expect.objectContaining({
        status: "confirmed",
        confirmedByUserId: "finance-director-1"
      })
    });
    expect(tx.spotProcurement.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "procurement-1",
        status: "approved_in_progress"
      }),
      data: { status: "abnormally_terminated" }
    });

    tx.$queryRaw
      .mockResolvedValueOnce([procurement("abnormally_terminated")]);
    await expect(
      service.confirmAbnormalTermination(
        "procurement-1",
        "finance-director-1",
        { confirmTermination: true }
      )
    ).rejects.toEqual(
      new ConflictException("零星采购已经异常终止")
    );
  });

  it("rejects termination before actual payment and confirmation by a project manager", async () => {
    const noPayment = context("material_staff");
    noPayment.tx.$queryRaw.mockResolvedValueOnce([
      procurement("approved_in_progress")
    ]);
    noPayment.tx.spotProcurementPayment.findMany.mockResolvedValue([
      { id: "payment-1" }
    ]);
    noPayment.tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue(null);
    await expect(
      noPayment.service.requestAbnormalTermination(
        "procurement-1",
        "material-1",
        { reason: "尚未实际付款" }
      )
    ).rejects.toEqual(
      new ConflictException("采购尚未发生真实付款，不能异常终止")
    );

    const manager = context("project_manager");
    manager.tx.$queryRaw.mockResolvedValueOnce([
      procurement("approved_in_progress")
    ]);
    await expect(
      manager.service.confirmAbnormalTermination(
        "procurement-1",
        "manager-1",
        { confirmTermination: true }
      )
    ).rejects.toMatchObject({
      message: "只有本项目财务主管可以确认异常终止"
    });
  });
});
