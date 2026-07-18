import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
import { createApiValidationPipe } from "../validation/api-validation";
import { ConfirmAbnormalTerminationDto } from "./dto/confirm-abnormal-termination.dto";
import { RequestAbnormalTerminationDto } from "./dto/request-abnormal-termination.dto";
import { SpotProcurementApplicationService } from "./spot-procurement-application.service";

const realFormDraft = {
  projectId: "project-1",
  code: "LXCG-001",
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
    closedAt: null
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
    handlerUserId: "material-1",
    applicationDepartmentSnapshot: realFormDraft.applicationDepartment,
    applicationNameSnapshot: realFormDraft.applicationName,
    purchaserNameSnapshot: "杨帅",
    purchaserDepartmentId: "department-1",
    purchaserDepartmentNameSnapshot: "工程部",
    requestedArrivalAt: new Date(realFormDraft.requestedArrivalAt),
    changeReason: null,
    changeSummary: null,
    submittedAt: null,
    approvedAt: null,
    createdByUserId: "material-1"
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
      findMany: jest.fn().mockResolvedValue([])
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
      create: jest.fn().mockResolvedValue({ id: "receipt-1" })
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
    $queryRaw: jest.fn()
  };
  const prisma = { $transaction: jest.fn(async (operation) => operation(tx)) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const pilot = { assertEnabled: jest.fn() };
  const approvalForms = { tryRefreshLatestForBusiness: jest.fn().mockResolvedValue(undefined) };
  return {
    tx,
    pilot,
    approvalForms,
    service: new SpotProcurementApplicationService(
      prisma as never,
      audit as never,
      pilot as never,
      approvalForms as never
    )
  };
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
      status: "draft",
      totalAmountCents: null,
      amountStatus: "pending_payment_application"
    });
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
      decision: "approve"
    });

    expect(tx.spotProcurementPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        status: "draft",
        payeeNameSnapshot: null,
        settlementAmountCents: 0n,
        companyPaymentAmountCents: 0n
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
    tx.$queryRaw.mockResolvedValueOnce([
      procurement("approved_in_progress")
    ]);
    tx.spotProcurementPayment.findMany.mockResolvedValue([
      { id: "payment-1" }
    ]);
    tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue({
      id: "execution-1"
    });

    await expect(
      service.voidProcurement(
        "procurement-1",
        "manager-1",
        "已付款，改走异常终止"
      )
    ).rejects.toEqual(
      new ConflictException("采购已发生真实付款，不能直接撤销")
    );
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
