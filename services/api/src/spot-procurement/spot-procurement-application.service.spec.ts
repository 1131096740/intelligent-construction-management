import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
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
      update: jest.fn().mockResolvedValue({})
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
    spotProcurementPaymentExecution: { findFirst: jest.fn().mockResolvedValue(null) },
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

  it("creates the only payment draft automatically after the final procurement approval", async () => {
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
});
