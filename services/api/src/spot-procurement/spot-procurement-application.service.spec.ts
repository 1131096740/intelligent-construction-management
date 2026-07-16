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
import type { CreateSpotProcurementDto } from "./dto/create-spot-procurement.dto";
import { CreateSpotProcurementVersionDto } from "./dto/create-spot-procurement-version.dto";
import { ReviewSpotProcurementDto } from "./dto/review-spot-procurement.dto";
import { SpotProcurementApplicationService } from "./spot-procurement-application.service";
import { procurementApprovalNodes } from "./spot-procurement-approval-nodes";
import { SpotProcurementController } from "./spot-procurement.controller";

const invoiceLine = {
  materialName: "免烧砖",
  specification: "240×115×53",
  unit: "块",
  quantity: "12.500000",
  invoiceMode: "invoice" as const,
  invoiceType: "vat_special" as const,
  vatRateOptionId: "vat-13",
  unitPrice: "3.28",
  usageLocation: "二次结构",
  note: "当天送达",
  amountCents: "1"
};

const draftInput: CreateSpotProcurementDto = {
  projectId: "project-1",
  code: "LXCG-001",
  supplierPartyId: "party-1",
  supplierName: "  北京   某某商贸  ",
  handlerUserId: "material-1",
  reason: "现场临时补充",
  note: "优先送到北门",
  lines: [invoiceLine],
  attachments: [],
  totalAmountCents: "1"
};

function storedInvoiceLine(
  unitPrice = invoiceLine.unitPrice,
  amountCents = 4100n
) {
  return {
    sortOrder: 1,
    materialName: invoiceLine.materialName,
    specification: invoiceLine.specification,
    unit: invoiceLine.unit,
    quantity: new Prisma.Decimal(invoiceLine.quantity),
    invoiceMode: invoiceLine.invoiceMode,
    invoiceType: invoiceLine.invoiceType,
    vatRateOptionId: invoiceLine.vatRateOptionId,
    vatRateValueSnapshot: new Prisma.Decimal("13"),
    vatRateLabelSnapshot: "13%",
    unitPrice: new Prisma.Decimal(unitPrice),
    amountCents,
    usageLocation: invoiceLine.usageLocation,
    note: invoiceLine.note
  };
}

const rootLock = {
  id: "procurement-1",
  projectId: "project-1",
  code: "LXCG-001",
  supplierPartyId: "party-1",
  supplierKey: "party:party-1",
  supplierNameSnapshot: "北京 某某商贸",
  applicantUserId: "material-1",
  handlerUserId: "material-1",
  currentVersionId: "version-1",
  status: "draft",
  approvedAmountCents: 0n
};

const versionLock = {
  id: "version-1",
  procurementId: "procurement-1",
  versionNo: 1,
  status: "draft",
  reason: "现场临时补充",
  note: "优先送到北门",
  supplierPartyId: "party-1",
  supplierKey: "party:party-1",
  supplierNameSnapshot: "北京 某某商贸",
  handlerUserId: "material-1",
  totalAmountCents: 4100n,
  changeReason: null,
  changeSummary: null,
  submittedAt: null,
  approvedAt: null,
  createdByUserId: "material-1"
};

function transactionDelegate() {
  return {
    $queryRaw: jest.fn(),
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: "project-1", status: "active" })
    },
    userPosition: { findMany: jest.fn() },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn() },
    businessParty: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: "party-1", name: "北京某某商贸", status: "active" })
    },
    fileObject: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: jest.fn().mockImplementation(
        async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          isActive: true
        })
      )
    },
    spotProcurement: {
      create: jest.fn().mockResolvedValue({ ...rootLock, currentVersionId: null }),
      update: jest.fn().mockImplementation(async ({ data }: { data: object }) => ({
        ...rootLock,
        ...data
      }))
    },
    spotProcurementVersion: {
      create: jest.fn().mockResolvedValue(versionLock),
      update: jest.fn().mockImplementation(async ({ data }: { data: object }) => ({
        ...versionLock,
        ...data
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([])
    },
    spotProcurementLine: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([
        {
          sortOrder: 1,
          materialName: invoiceLine.materialName,
          specification: invoiceLine.specification,
          unit: invoiceLine.unit,
          quantity: new Prisma.Decimal(invoiceLine.quantity),
          invoiceMode: invoiceLine.invoiceMode,
          invoiceType: invoiceLine.invoiceType,
          vatRateOptionId: invoiceLine.vatRateOptionId,
          vatRateValueSnapshot: new Prisma.Decimal("13"),
          vatRateLabelSnapshot: "13%",
          unitPrice: new Prisma.Decimal(invoiceLine.unitPrice),
          amountCents: 4100n,
          usageLocation: invoiceLine.usageLocation,
          note: invoiceLine.note
        }
      ])
    },
    spotProcurementAttachment: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([])
    },
    approvalInstance: {
      create: jest.fn().mockResolvedValue({
        id: "approval-1",
        status: "approval_pending",
        currentNodeIndex: 0
      }),
      update: jest.fn().mockResolvedValue({ id: "approval-1" })
    },
    approvalActionLog: {
      create: jest.fn().mockResolvedValue({ id: "action-1" })
    },
    spotProcurementPayment: {
      create: jest.fn().mockResolvedValue({
        id: "payment-1",
        code: "LXCG-001-V1-P001",
        status: "draft"
      }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    spotProcurementPaymentExecution: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) }
  };
}

function role(tx: ReturnType<typeof transactionDelegate>, roleKey: string) {
  tx.userPosition.findMany
    .mockResolvedValueOnce([{ positionId: `position-${roleKey}`, projectId: null }])
    .mockResolvedValueOnce([]);
  tx.position.findMany.mockResolvedValue([{ id: `position-${roleKey}`, key: roleKey }]);
}

function harness() {
  const tx = transactionDelegate();
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx)
    )
  };
  const audit = {
    record: jest.fn((client: typeof tx, input: object) =>
      client.auditLog.create({ data: input })
    )
  };
  const pilot = { assertEnabled: jest.fn() };
  const vatRates = {
    requireEnabledOption: jest.fn().mockResolvedValue({
      id: "vat-13",
      rateValue: "13",
      label: "13%",
      enabled: true,
      sortOrder: 10
    })
  };
  const balances = {
    suggestionWithClient: jest.fn().mockResolvedValue({
      availableBalanceAmountCents: "0",
      suggestedBalanceAmountCents: "0"
    })
  };
  const service = new SpotProcurementApplicationService(
    prisma as never,
    audit as never,
    pilot as never,
    vatRates as never,
    balances as never
  );
  return {
    service,
    prisma,
    tx,
    audit,
    pilot,
    vatRates,
    balances
  };
}

describe("SpotProcurementController", () => {
  it("uses the exact independent route surface and project-role actions", () => {
    expect(Reflect.getMetadata(PATH_METADATA, SpotProcurementController)).toBe(
      "spot-procurements"
    );
    const expectations = [
      ["create", RequestMethod.POST, "/", "spot_procurement.create"],
      [
        "updateDraft",
        RequestMethod.PATCH,
        ":procurementId/draft",
        "spot_procurement.create"
      ],
      [
        "createVersion",
        RequestMethod.POST,
        ":procurementId/versions",
        "spot_procurement.create"
      ],
      [
        "submit",
        RequestMethod.POST,
        ":procurementId/submission",
        "spot_procurement.create"
      ],
      [
        "review",
        RequestMethod.POST,
        ":procurementId/approval",
        "spot_procurement.approve"
      ],
      [
        "withdrawApproval",
        RequestMethod.POST,
        ":procurementId/approval-withdrawal",
        undefined
      ],
      [
        "voidProcurement",
        RequestMethod.POST,
        ":procurementId/voiding",
        "spot_procurement.void"
      ]
    ] as const;
    for (const [method, requestMethod, path, action] of expectations) {
      expect(
        Reflect.getMetadata(
          METHOD_METADATA,
          SpotProcurementController.prototype[method]
        )
      ).toBe(requestMethod);
      expect(
        Reflect.getMetadata(
          PATH_METADATA,
          SpotProcurementController.prototype[method]
        )
      ).toBe(path);
      expect(
        Reflect.getMetadata(
          REQUIRED_PROJECT_ACTION_KEY,
          SpotProcurementController.prototype[method]
        )
      ).toBe(action);
    }
  });
});

describe("SpotProcurementApplicationService", () => {
  it.each(["material_staff", "material_director"])(
    "allows %s to create a draft and recalculates trusted amounts",
    async (roleKey) => {
      const { service, tx, pilot } = harness();
      role(tx, roleKey);

      const result = await service.createDraft("material-1", draftInput);

      expect(pilot.assertEnabled).toHaveBeenCalledWith("project-1");
      expect(tx.spotProcurement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          supplierNameSnapshot: "北京 某某商贸",
          supplierKey: "party:party-1",
          applicantUserId: "material-1",
          handlerUserId: "material-1",
          status: "draft"
        })
      });
      expect(tx.spotProcurementVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          supplierNameSnapshot: "北京 某某商贸",
          totalAmountCents: 4100n,
          status: "draft"
        })
      });
      expect(tx.spotProcurementLine.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            sortOrder: 1,
            amountCents: 4100n,
            vatRateValueSnapshot: new Prisma.Decimal("13"),
            vatRateLabelSnapshot: "13%"
          })
        ]
      });
      expect(result.totalAmountCents).toBe("4100");
    }
  );

  it("rejects draft creation for roles outside material staff/director", async () => {
    const { service, tx } = harness();
    role(tx, "finance_staff");

    await expect(
      service.createDraft("finance-1", {
        ...draftInput,
        handlerUserId: "finance-1"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.spotProcurement.create).not.toHaveBeenCalled();
  });

  it("stores exactly one supplier at the root/version header and accepts zero attachments", async () => {
    const { service, tx } = harness();
    role(tx, "material_staff");

    await service.createDraft("material-1", draftInput);

    const rootData = tx.spotProcurement.create.mock.calls[0]?.[0].data;
    const versionData = tx.spotProcurementVersion.create.mock.calls[0]?.[0].data;
    expect(rootData).toEqual(
      expect.objectContaining({
        supplierPartyId: "party-1",
        supplierNameSnapshot: "北京 某某商贸"
      })
    );
    expect(versionData).toEqual(
      expect.objectContaining({
        supplierPartyId: "party-1",
        supplierNameSnapshot: "北京 某某商贸"
      })
    );
    expect(tx.spotProcurementAttachment.createMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementLine.createMany.mock.calls[0]?.[0].data[0]).not.toHaveProperty(
      "supplierName"
    );
  });

  it("updates only the current draft, replaces optional attachments and recalculates totals", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([rootLock])
      .mockResolvedValueOnce([versionLock]);
    role(tx, "material_staff");
    tx.fileObject.findMany.mockResolvedValue([
      {
        id: "quote-1",
        storageStatus: "active",
        uploadedByUserId: "material-1"
      }
    ]);

    const result = await service.updateDraft("procurement-1", "material-1", {
      ...draftInput,
      lines: [{ ...invoiceLine, quantity: "2", unitPrice: "4.50" }],
      attachments: [{ fileId: "quote-1", category: "merchant_quote" }]
    });

    expect(tx.spotProcurementLine.deleteMany).toHaveBeenCalled();
    expect(tx.spotProcurementLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ amountCents: 900n })]
    });
    expect(tx.spotProcurementAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          versionId: "version-1",
          fileId: "quote-1",
          category: "merchant_quote",
          uploadedByUserId: "material-1"
        }
      ]
    });
    expect(result.totalAmountCents).toBe("900");
  });

  it("inherits omitted optional draft facts instead of silently replacing the assigned handler", async () => {
    const { service, tx } = harness();
    const delegatedRoot = {
      ...rootLock,
      applicantUserId: "applicant-a",
      handlerUserId: "handler-b"
    };
    const delegatedVersion = {
      ...versionLock,
      handlerUserId: "handler-b"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([delegatedRoot])
      .mockResolvedValueOnce([delegatedVersion]);
    role(tx, "material_staff");
    role(tx, "material_staff");
    tx.spotProcurementAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-b",
        fileId: "handler-b-quote",
        category: "merchant_quote",
        uploadedByUserId: "handler-b",
        createdAt: new Date("2026-07-17T00:00:00.000Z")
      }
    ]);
    tx.fileObject.findMany.mockResolvedValue([
      {
        id: "handler-b-quote",
        storageStatus: "active",
        uploadedByUserId: "handler-b"
      }
    ]);

    await service.updateDraft("procurement-1", "applicant-a", {
      supplierName: draftInput.supplierName,
      reason: draftInput.reason,
      lines: draftInput.lines
    });

    expect(tx.spotProcurementVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({
        supplierPartyId: "party-1",
        handlerUserId: "handler-b",
        note: "优先送到北门"
      })
    });
    expect(tx.spotProcurement.update).toHaveBeenCalledWith({
      where: { id: "procurement-1" },
      data: expect.objectContaining({ handlerUserId: "handler-b" })
    });
    expect(tx.spotProcurementAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          versionId: "version-1",
          fileId: "handler-b-quote",
          category: "merchant_quote",
          uploadedByUserId: "handler-b"
        }
      ]
    });
  });

  it("recomputes a version draft change summary against the preceding frozen version on update", async () => {
    const { service, tx } = harness();
    const previousVersion = {
      ...versionLock,
      status: "invalidated"
    };
    const currentVersion = {
      ...versionLock,
      id: "version-2",
      versionNo: 2,
      status: "draft",
      totalAmountCents: 5000n,
      changeReason: "调整单价",
      changeSummary: {
        changes: [{ field: "lines[0].unitPrice", before: "3.28", after: "4" }]
      }
    };
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          ...rootLock,
          currentVersionId: "version-2",
          status: "draft"
        }
      ])
      .mockResolvedValueOnce([currentVersion])
      .mockResolvedValueOnce([previousVersion]);
    role(tx, "material_staff");
    tx.spotProcurementLine.findMany
      .mockResolvedValueOnce([storedInvoiceLine("4", 5000n)])
      .mockResolvedValueOnce([storedInvoiceLine()]);

    await service.updateDraft("procurement-1", "material-1", {
      ...draftInput,
      lines: [{ ...invoiceLine, unitPrice: "5" }]
    });

    const updateData =
      tx.spotProcurementVersion.update.mock.calls[0]?.[0].data;
    expect(updateData.changeSummary.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "lines[0].unitPrice",
          before: "3.28",
          after: "5"
        })
      ])
    );
  });

  it("rejects an active private attachment uploaded by an unrelated user", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([rootLock])
      .mockResolvedValueOnce([versionLock]);
    role(tx, "material_staff");
    tx.fileObject.findMany.mockResolvedValue([
      {
        id: "foreign-file",
        storageStatus: "active",
        uploadedByUserId: "unrelated-user"
      }
    ]);

    await expect(
      service.updateDraft("procurement-1", "material-1", {
        ...draftInput,
        attachments: [
          { fileId: "foreign-file", category: "merchant_quote" }
        ]
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.spotProcurementAttachment.createMany).not.toHaveBeenCalled();
  });

  it("accepts active attachments uploaded by the root applicant or current handler and preserves their uploaders", async () => {
    const { service, tx } = harness();
    const delegatedRoot = {
      ...rootLock,
      applicantUserId: "material-applicant",
      handlerUserId: "material-handler"
    };
    const delegatedVersion = {
      ...versionLock,
      handlerUserId: "material-handler"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([delegatedRoot])
      .mockResolvedValueOnce([delegatedVersion]);
    role(tx, "material_staff");
    role(tx, "material_staff");
    tx.fileObject.findMany.mockResolvedValue([
      {
        id: "applicant-file",
        storageStatus: "active",
        uploadedByUserId: "material-applicant"
      },
      {
        id: "handler-file",
        storageStatus: "active",
        uploadedByUserId: "material-handler"
      }
    ]);

    await service.updateDraft(
      "procurement-1",
      "material-handler",
      {
        ...draftInput,
        handlerUserId: "material-handler",
        attachments: [
          { fileId: "applicant-file", category: "merchant_quote" },
          { fileId: "handler-file", category: "reference_photo" }
        ]
      }
    );

    expect(tx.spotProcurementAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          versionId: "version-1",
          fileId: "applicant-file",
          category: "merchant_quote",
          uploadedByUserId: "material-applicant"
        },
        {
          versionId: "version-1",
          fileId: "handler-file",
          category: "reference_photo",
          uploadedByUserId: "material-handler"
        }
      ]
    });
  });

  it("rejects an active handler updating a draft whose root applicant is inactive before replacing facts", async () => {
    const { service, tx } = harness();
    const delegatedRoot = {
      ...rootLock,
      applicantUserId: "inactive-applicant",
      handlerUserId: "active-handler"
    };
    const delegatedVersion = {
      ...versionLock,
      handlerUserId: "active-handler"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([delegatedRoot])
      .mockResolvedValueOnce([delegatedVersion]);
    role(tx, "material_staff");
    tx.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        isActive: where.id !== "inactive-applicant"
      })
    );

    await expect(
      service.updateDraft("procurement-1", "active-handler", {
        ...draftInput,
        handlerUserId: "active-handler"
      })
    ).rejects.toThrow("采购申请人不存在或已停用");
    expect(tx.spotProcurementLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementAttachment.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
  });

  it("rejects draft updates when the active root applicant has lost the procurement role", async () => {
    const { service, tx } = harness();
    const delegatedRoot = {
      ...rootLock,
      applicantUserId: "former-applicant",
      handlerUserId: "active-handler"
    };
    const delegatedVersion = {
      ...versionLock,
      handlerUserId: "active-handler"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([delegatedRoot])
      .mockResolvedValueOnce([delegatedVersion]);
    tx.userPosition.findMany.mockImplementation(
      async ({ where }: { where: { userId: string; projectId: string | null } }) =>
        where.projectId === null
          ? [
              {
                positionId:
                  where.userId === "active-handler"
                    ? "position-material_staff"
                    : "position-employee",
                projectId: null
              }
            ]
          : []
    );
    tx.position.findMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          key: id.replace("position-", "")
        }))
    );

    await expect(
      service.updateDraft("procurement-1", "active-handler", {
        ...draftInput,
        handlerUserId: "active-handler"
      })
    ).rejects.toThrow("采购申请人当前不具备物资员或物资主管岗位");
    expect(tx.spotProcurementLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementAttachment.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
  });

  it("freezes only project manager and records node_skipped for a database-resolved material director applicant", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([rootLock])
      .mockResolvedValueOnce([versionLock]);
    role(tx, "material_director");

    await service.submit("procurement-1", "material-1");

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        frozenNodes: [
          { name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] }
        ]
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "node_skipped",
        actorUserId: "material-1"
      })
    });
  });

  it("freezes material director then project manager for a material staff applicant", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([rootLock])
      .mockResolvedValueOnce([versionLock]);
    role(tx, "material_staff");

    await service.submit("procurement-1", "material-1");

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        frozenNodes: procurementApprovalNodes(["material_staff"])
      })
    });
    expect(tx.approvalActionLog.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "node_skipped" })
    });
  });

  it("freezes nodes from the database applicant roles rather than a delegated handler submitter", async () => {
    const { service, tx } = harness();
    const delegatedRoot = {
      ...rootLock,
      applicantUserId: "staff-applicant",
      handlerUserId: "director-handler"
    };
    const delegatedVersion = {
      ...versionLock,
      handlerUserId: "director-handler"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([delegatedRoot])
      .mockResolvedValueOnce([delegatedVersion]);
    tx.userPosition.findMany.mockImplementation(
      async ({ where }: { where: { userId: string; projectId: string | null } }) =>
        where.projectId === null
          ? [
              {
                positionId:
                  where.userId === "staff-applicant"
                    ? "position-material_staff"
                    : "position-material_director",
                projectId: null
              }
            ]
          : []
    );
    tx.position.findMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          key: id.replace("position-", "")
        }))
    );

    await service.submit("procurement-1", "director-handler");

    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        applicantUserId: "staff-applicant",
        frozenNodes: procurementApprovalNodes(["material_staff"])
      })
    });
    expect(tx.approvalActionLog.create).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "node_skipped" })
    });
  });

  it("rejects submission when the root applicant is inactive even if an active handler submits", async () => {
    const { service, tx } = harness();
    const delegatedRoot = {
      ...rootLock,
      applicantUserId: "inactive-applicant",
      handlerUserId: "active-handler"
    };
    const delegatedVersion = {
      ...versionLock,
      handlerUserId: "active-handler"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([delegatedRoot])
      .mockResolvedValueOnce([delegatedVersion]);
    role(tx, "material_staff");
    tx.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        isActive: where.id !== "inactive-applicant"
      })
    );

    await expect(
      service.submit("procurement-1", "active-handler")
    ).rejects.toThrow("采购申请人不存在或已停用");
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementAttachment.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects an inactive referenced procurement handler", async () => {
    const { service, tx } = harness();
    role(tx, "material_staff");
    tx.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        isActive: where.id !== "inactive-handler"
      })
    );

    await expect(
      service.createDraft("material-1", {
        ...draftInput,
        handlerUserId: "inactive-handler"
      })
    ).rejects.toThrow("采购经办人不存在或已停用");
    expect(tx.spotProcurement.create).not.toHaveBeenCalled();
  });

  it("recomputes the final submitted change summary from the preceding frozen version", async () => {
    const { service, tx } = harness();
    const previousVersion = {
      ...versionLock,
      status: "invalidated"
    };
    const currentVersion = {
      ...versionLock,
      id: "version-2",
      versionNo: 2,
      status: "draft",
      totalAmountCents: 6250n,
      changeReason: "调整单价",
      changeSummary: {
        changes: [{ field: "lines[0].unitPrice", before: "3.28", after: "4" }]
      }
    };
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          ...rootLock,
          currentVersionId: "version-2",
          status: "draft"
        }
      ])
      .mockResolvedValueOnce([currentVersion])
      .mockResolvedValueOnce([previousVersion]);
    role(tx, "material_staff");
    tx.spotProcurementLine.findMany
      .mockResolvedValueOnce([storedInvoiceLine("5", 6250n)])
      .mockResolvedValueOnce([storedInvoiceLine()]);

    await service.submit("procurement-1", "material-1");

    expect(tx.spotProcurementVersion.update).toHaveBeenCalledWith({
      where: { id: "version-2" },
      data: expect.objectContaining({
        status: "approval_pending",
        totalAmountCents: 6250n,
        changeSummary: {
          changes: expect.arrayContaining([
            expect.objectContaining({
              field: "lines[0].unitPrice",
              before: "3.28",
              after: "5"
            })
          ])
        }
      })
    });
  });

  it.each(["invalidated", "returned"])(
    "rejects submitting a non-withdrawn revision restored to the previous facts when predecessor is %s",
    async (previousStatus) => {
      const { service, tx } = harness();
      const previousVersion = {
        ...versionLock,
        status: previousStatus
      };
      const currentVersion = {
        ...versionLock,
        id: "version-2",
        versionNo: 2,
        status: "draft",
        changeReason: "普通变更或审批退回",
        changeSummary: { changes: [] }
      };
      tx.$queryRaw
        .mockResolvedValueOnce([
          {
            ...rootLock,
            currentVersionId: "version-2",
            status: "draft"
          }
        ])
        .mockResolvedValueOnce([currentVersion])
        .mockResolvedValueOnce([previousVersion]);
      role(tx, "material_staff");
      tx.spotProcurementLine.findMany
        .mockResolvedValueOnce([storedInvoiceLine()])
        .mockResolvedValueOnce([storedInvoiceLine()]);

      await expect(
        service.submit("procurement-1", "material-1")
      ).rejects.toThrow("采购版本没有实际字段变化，不能提交审批");
      expect(tx.approvalInstance.create).not.toHaveBeenCalled();
      expect(tx.spotProcurementLine.deleteMany).not.toHaveBeenCalled();
      expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
    }
  );

  it("allows a withdrawn revision to be resubmitted unchanged while storing an accurate empty summary", async () => {
    const { service, tx } = harness();
    const previousVersion = {
      ...versionLock,
      status: "withdrawn"
    };
    const currentVersion = {
      ...versionLock,
      id: "version-2",
      versionNo: 2,
      status: "draft",
      changeReason: "申请人撤回采购审批",
      changeSummary: { changes: [] }
    };
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          ...rootLock,
          currentVersionId: "version-2",
          status: "draft"
        }
      ])
      .mockResolvedValueOnce([currentVersion])
      .mockResolvedValueOnce([previousVersion]);
    role(tx, "material_staff");
    tx.spotProcurementLine.findMany
      .mockResolvedValueOnce([storedInvoiceLine()])
      .mockResolvedValueOnce([storedInvoiceLine()]);

    await service.submit("procurement-1", "material-1");

    expect(tx.spotProcurementVersion.update).toHaveBeenCalledWith({
      where: { id: "version-2" },
      data: expect.objectContaining({
        status: "approval_pending",
        changeSummary: { changes: [] }
      })
    });
  });

  it("exposes only approve/reject/return_to_applicant review decisions and rejects detail mutation", async () => {
    const pipe = createApiValidationPipe();
    for (const decision of ["approve", "reject", "return_to_applicant"]) {
      await expect(
        pipe.transform(
          { decision, comment: decision === "approve" ? undefined : "说明" },
          { type: "body", metatype: ReviewSpotProcurementDto, data: undefined }
        )
      ).resolves.toEqual(
        expect.objectContaining({ decision })
      );
    }
    await expect(
      pipe.transform(
        {
          decision: "approve",
          lines: [{ materialName: "审批人偷改明细" }]
        },
        { type: "body", metatype: ReviewSpotProcurementDto, data: undefined }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("moves to approved states and creates the first payment draft inside the final approval transaction", async () => {
    const { service, prisma, tx, balances } = harness();
    const pendingRoot = { ...rootLock, status: "approval_pending" };
    const pendingVersion = {
      ...versionLock,
      status: "approval_pending",
      submittedAt: new Date("2026-07-17T00:00:00.000Z")
    };
    tx.$queryRaw
      .mockResolvedValueOnce([pendingRoot])
      .mockResolvedValueOnce([pendingVersion])
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
    role(tx, "project_manager");
    balances.suggestionWithClient.mockResolvedValue({
      availableBalanceAmountCents: "3000",
      suggestedBalanceAmountCents: "3000"
    });

    const result = await service.review("procurement-1", "manager-1", {
      decision: "approve"
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.spotProcurementVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({ status: "approved", approvedAt: expect.any(Date) })
    });
    expect(tx.spotProcurement.update).toHaveBeenCalledWith({
      where: { id: "procurement-1" },
      data: expect.objectContaining({
        status: "approved_in_progress",
        currentVersionId: "version-1",
        approvedAmountCents: 4100n
      })
    });
    expect(tx.spotProcurementPayment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: "LXCG-001-V1-P001",
        status: "draft",
        settlementAmountCents: 4100n,
        supplierBalanceAmountCents: 3000n,
        companyPaymentAmountCents: 1100n,
        payeeNameSnapshot: "北京 某某商贸",
        handlerUserId: "material-1",
        createdByUserId: "manager-1"
      })
    });
    expect(result.status).toBe("approved_in_progress");
  });

  it("advances the material-staff two-node flow without creating payment at the director node", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([{ ...rootLock, status: "approval_pending" }])
      .mockResolvedValueOnce([{ ...versionLock, status: "approval_pending" }])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: procurementApprovalNodes(["material_staff"]),
          applicantUserId: "material-1"
        }
      ]);
    role(tx, "material_director");

    const result = await service.review("procurement-1", "director-1", {
      decision: "approve",
      comment: "同意"
    });

    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: {
        currentNodeIndex: 1,
        frozenNodes: [
          {
            name: "物资主管审批",
            mode: "any",
            roleKeys: ["material_director"],
            approvedRoleKeys: ["material_director"]
          },
          {
            name: "项目经理审批",
            mode: "any",
            roleKeys: ["project_manager"]
          }
        ]
      }
    });
    expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({ status: "approved" })
    });
    expect(result).toEqual(
      expect.objectContaining({
        status: "approval_pending",
        versionStatus: "approval_pending"
      })
    );
  });

  it("propagates payment draft failure so final approval cannot commit separately", async () => {
    const { service, prisma, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([{ ...rootLock, status: "approval_pending" }])
      .mockResolvedValueOnce([{ ...versionLock, status: "approval_pending" }])
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
    role(tx, "project_manager");
    tx.spotProcurementPayment.create.mockRejectedValue(
      new Error("simulated payment insert failure")
    );

    await expect(
      service.review("procurement-1", "manager-1", { decision: "approve" })
    ).rejects.toThrow("simulated payment insert failure");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.spotProcurementPayment.create).toHaveBeenCalled();
  });

  it("requires comments for reject/return and keeps the frozen version immutable during review", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([{ ...rootLock, status: "approval_pending" }])
      .mockResolvedValueOnce([{ ...versionLock, status: "approval_pending" }])
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
    role(tx, "project_manager");

    await expect(
      service.review("procurement-1", "manager-1", {
        decision: "reject"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.spotProcurementLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementAttachment.deleteMany).not.toHaveBeenCalled();
  });

  it("does not mark a node approved when the reviewer rejects the application", async () => {
    const { service, tx } = harness();
    const frozenNodes = [
      { name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] }
    ];
    tx.$queryRaw
      .mockResolvedValueOnce([{ ...rootLock, status: "approval_pending" }])
      .mockResolvedValueOnce([{ ...versionLock, status: "approval_pending" }])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes,
          applicantUserId: "material-1"
        }
      ]);
    role(tx, "project_manager");

    await service.review("procurement-1", "manager-1", {
      decision: "reject",
      comment: "采购条件不完整"
    });

    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: { status: "rejected" }
    });
    expect(frozenNodes[0]).not.toHaveProperty("approvedRoleKeys");
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "reject" })
    });
  });

  it("returns an approval by preserving the submitted version and cloning a revision draft", async () => {
    const { service, tx, audit, vatRates } = harness();
    const submittedAt = new Date("2026-07-17T01:00:00.000Z");
    const submittedVersion = {
      ...versionLock,
      status: "approval_pending",
      submittedAt
    };
    tx.$queryRaw
      .mockResolvedValueOnce([{ ...rootLock, status: "approval_pending" }])
      .mockResolvedValueOnce([submittedVersion])
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
    role(tx, "project_manager");
    tx.spotProcurementVersion.create.mockResolvedValue({
      ...versionLock,
      id: "version-2",
      versionNo: 2,
      status: "draft",
      changeReason: "请补充运输费用说明",
      changeSummary: { changes: [] },
      submittedAt: null,
      createdByUserId: "manager-1"
    });
    tx.spotProcurementAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-1",
        versionId: "version-1",
        fileId: "quote-1",
        category: "merchant_quote",
        uploadedByUserId: "material-1",
        createdAt: new Date("2026-07-17T00:00:00.000Z")
      }
    ]);
    vatRates.requireEnabledOption.mockRejectedValue(
      new Error("历史税率已经停用，不应在冻结复制时重新查询")
    );

    const result = await service.review("procurement-1", "manager-1", {
      decision: "return_to_applicant",
      comment: "请补充运输费用说明"
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
        changeReason: "请补充运输费用说明",
        changeSummary: { changes: [] },
        createdByUserId: "manager-1"
      })
    });
    expect(tx.spotProcurementLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          versionId: "version-2",
          vatRateOptionId: "vat-13",
          vatRateValueSnapshot: new Prisma.Decimal("13"),
          vatRateLabelSnapshot: "13%"
        })
      ]
    });
    expect(tx.spotProcurementAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          versionId: "version-2",
          fileId: "quote-1",
          category: "merchant_quote",
          uploadedByUserId: "material-1"
        }
      ]
    });
    expect(tx.spotProcurement.update).toHaveBeenCalledWith({
      where: { id: "procurement-1" },
      data: expect.objectContaining({
        currentVersionId: "version-2",
        status: "draft",
        handlerUserId: "material-1"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.approval.return_to_applicant",
        businessId: "version-1",
        metadata: expect.objectContaining({
          sourceVersionId: "version-1",
          newVersionId: "version-2"
        })
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        versionId: "version-2",
        versionNo: 2,
        versionStatus: "draft"
      })
    );
    expect(submittedVersion.submittedAt).toBe(submittedAt);
    expect(vatRates.requireEnabledOption).not.toHaveBeenCalled();
    expect(tx.spotProcurementLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementAttachment.deleteMany).not.toHaveBeenCalled();
  });

  it("reuses the ordinary-applicant self-review guard at the current frozen node", async () => {
    const { service, tx } = harness();
    const selfApplicantRoot = {
      ...rootLock,
      applicantUserId: "dual-role-user",
      status: "approval_pending"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([selfApplicantRoot])
      .mockResolvedValueOnce([{ ...versionLock, status: "approval_pending" }])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [
            { name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] }
          ],
          applicantUserId: "dual-role-user"
        }
      ]);
    role(tx, "project_manager");

    await expect(
      service.review("procurement-1", "dual-role-user", {
        decision: "approve"
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementPayment.create).not.toHaveBeenCalled();
  });

  it("withdraws approval by preserving the submitted version and cloning a new editable draft", async () => {
    const { service, prisma, tx, audit, pilot } = harness();
    const submittedAt = new Date("2026-07-17T01:00:00.000Z");
    const submittedVersion = {
      ...versionLock,
      status: "approval_pending",
      submittedAt
    };
    tx.$queryRaw
      .mockResolvedValueOnce([{ ...rootLock, status: "approval_pending" }])
      .mockResolvedValueOnce([submittedVersion])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: procurementApprovalNodes(["material_staff"]),
          applicantUserId: "material-1"
        }
      ])
      .mockResolvedValueOnce([
        {
          ...rootLock,
          currentVersionId: "version-2",
          status: "draft"
        }
      ])
      .mockResolvedValueOnce([
        {
          ...versionLock,
          id: "version-2",
          versionNo: 2,
          status: "draft",
          changeReason: "申请人撤回采购审批",
          changeSummary: { changes: [] },
          submittedAt: null
        }
      ])
      .mockResolvedValueOnce([submittedVersion]);
    tx.spotProcurementVersion.create.mockResolvedValue({
      ...versionLock,
      id: "version-2",
      versionNo: 2,
      status: "draft",
      changeReason: "申请人撤回采购审批",
      changeSummary: { changes: [] },
      submittedAt: null
    });
    tx.spotProcurementAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-1",
        versionId: "version-1",
        fileId: "quote-1",
        category: "merchant_quote",
        uploadedByUserId: "material-1",
        createdAt: new Date("2026-07-17T00:00:00.000Z")
      }
    ]);

    const result = await service.withdrawApproval(
      "procurement-1",
      "material-1"
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(pilot.assertEnabled).toHaveBeenCalledWith("project-1");
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: {
        approvalInstanceId: "approval-1",
        action: "withdraw",
        actorUserId: "material-1",
        comment: "申请人撤回采购审批"
      }
    });
    expect(tx.spotProcurementVersion.update).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: { status: "withdrawn" }
    });
    expect(tx.spotProcurementVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        procurementId: "procurement-1",
        versionNo: 2,
        status: "draft",
        reason: versionLock.reason,
        note: versionLock.note,
        supplierPartyId: "party-1",
        supplierKey: "party:party-1",
        supplierNameSnapshot: "北京 某某商贸",
        handlerUserId: "material-1",
        totalAmountCents: 4100n,
        changeReason: "申请人撤回采购审批",
        changeSummary: { changes: [] },
        createdByUserId: "material-1"
      })
    });
    expect(tx.spotProcurementLine.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          versionId: "version-2",
          vatRateOptionId: "vat-13",
          vatRateValueSnapshot: new Prisma.Decimal("13"),
          vatRateLabelSnapshot: "13%",
          amountCents: 4100n
        })
      ]
    });
    expect(tx.spotProcurementAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          versionId: "version-2",
          fileId: "quote-1",
          category: "merchant_quote",
          uploadedByUserId: "material-1"
        }
      ]
    });
    expect(tx.spotProcurement.update).toHaveBeenCalledWith({
      where: { id: "procurement-1" },
      data: expect.objectContaining({
        currentVersionId: "version-2",
        status: "draft",
        supplierPartyId: "party-1",
        supplierKey: "party:party-1",
        supplierNameSnapshot: "北京 某某商贸",
        handlerUserId: "material-1"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        actorUserId: "material-1",
        action: "spot_procurement.approval.withdraw",
        businessId: "version-1",
        metadata: expect.objectContaining({
          sourceVersionId: "version-1",
          newVersionId: "version-2"
        })
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "draft",
        versionId: "version-2",
        versionNo: 2,
        versionStatus: "draft"
      })
    );
    expect(submittedVersion.submittedAt).toBe(submittedAt);
    expect(tx.spotProcurementLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementAttachment.deleteMany).not.toHaveBeenCalled();

    tx.spotProcurementVersion.update.mockClear();
    role(tx, "material_staff");
    await service.updateDraft("procurement-1", "material-1", {
      ...draftInput,
      lines: [{ ...invoiceLine, unitPrice: "4" }]
    });
    expect(tx.spotProcurementVersion.update).toHaveBeenCalledWith({
      where: { id: "version-2" },
      data: expect.objectContaining({ totalAmountCents: 5000n })
    });
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.anything()
    });
  });

  it("rejects approval withdrawal by a non-applicant or outside approval_pending", async () => {
    const unauthorized = harness();
    unauthorized.tx.$queryRaw
      .mockResolvedValueOnce([{ ...rootLock, status: "approval_pending" }])
      .mockResolvedValueOnce([{ ...versionLock, status: "approval_pending" }])
      .mockResolvedValueOnce([
        {
          id: "approval-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: procurementApprovalNodes(["material_staff"]),
          applicantUserId: "material-1"
        }
      ]);
    await expect(
      unauthorized.service.withdrawApproval(
        "procurement-1",
        "other-material-user"
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(unauthorized.tx.approvalInstance.update).not.toHaveBeenCalled();

    const wrongState = harness();
    wrongState.tx.$queryRaw
      .mockResolvedValueOnce([{ ...rootLock, status: "draft" }])
      .mockResolvedValueOnce([{ ...versionLock, status: "draft" }]);
    await expect(
      wrongState.service.withdrawApproval("procurement-1", "material-1")
    ).rejects.toBeInstanceOf(ConflictException);
    expect(wrongState.tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("hard-blocks ordinary version changes after a real non-voided payment", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
      ])
      .mockResolvedValueOnce([{ ...versionLock, status: "approved" }]);
    role(tx, "material_staff");
    tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue({
      id: "execution-1"
    });

    await expect(
      service.createVersion("procurement-1", "material-1", {
        ...draftInput,
        changeReason: "现场规格发生变化"
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.spotProcurementVersion.create).not.toHaveBeenCalled();
  });

  it("rejects an active handler creating a version for an inactive root applicant before invalidating facts", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          ...rootLock,
          status: "approved_in_progress",
          applicantUserId: "inactive-applicant",
          handlerUserId: "active-handler",
          approvedAmountCents: 4100n
        }
      ])
      .mockResolvedValueOnce([
        {
          ...versionLock,
          status: "approved",
          handlerUserId: "active-handler"
        }
      ]);
    role(tx, "material_staff");
    tx.user.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        isActive: where.id !== "inactive-applicant"
      })
    );
    tx.spotProcurementPayment.findMany.mockResolvedValue([
      { id: "payment-draft", status: "draft" }
    ]);

    await expect(
      service.createVersion("procurement-1", "active-handler", {
        ...draftInput,
        handlerUserId: "active-handler",
        lines: [{ ...invoiceLine, unitPrice: "4" }],
        changeReason: "调整采购单价"
      })
    ).rejects.toThrow("采购申请人不存在或已停用");
    expect(tx.spotProcurementPayment.updateMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementLine.deleteMany).not.toHaveBeenCalled();
    expect(tx.spotProcurementAttachment.deleteMany).not.toHaveBeenCalled();
  });

  it("does not abandon a draft or in-flight approval by creating another ordinary version", async () => {
    for (const versionStatus of ["draft", "approval_pending"]) {
      const { service, tx } = harness();
      tx.$queryRaw
        .mockResolvedValueOnce([
          {
            ...rootLock,
            status:
              versionStatus === "draft" ? "draft" : "approval_pending"
          }
        ])
        .mockResolvedValueOnce([{ ...versionLock, status: versionStatus }]);
      role(tx, "material_staff");

      await expect(
        service.createVersion("procurement-1", "material-1", {
          ...draftInput,
          changeReason: "不应绕过当前状态"
        })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.spotProcurementVersion.create).not.toHaveBeenCalled();
    }
  });

  it("blocks active submitted/approved payments but invalidates old drafts with a complete reason tuple", async () => {
    for (const activeStatus of [
      "approval_pending",
      "approved_pending_payment",
      "partially_paid"
    ]) {
      const activeHarness = harness();
      activeHarness.tx.$queryRaw
        .mockResolvedValueOnce([
          { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
        ])
        .mockResolvedValueOnce([{ ...versionLock, status: "approved" }]);
      role(activeHarness.tx, "material_staff");
      activeHarness.tx.spotProcurementPayment.findMany.mockResolvedValue([
        { id: "payment-active", status: activeStatus }
      ]);

      await expect(
        activeHarness.service.createVersion("procurement-1", "material-1", {
          ...draftInput,
          changeReason: "调整单价"
        })
      ).rejects.toBeInstanceOf(ConflictException);
      expect(activeHarness.tx.spotProcurementVersion.create).not.toHaveBeenCalled();
    }

    const draftHarness = harness();
    draftHarness.tx.$queryRaw
      .mockResolvedValueOnce([
        { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
      ])
      .mockResolvedValueOnce([{ ...versionLock, status: "approved" }]);
    role(draftHarness.tx, "material_staff");
    draftHarness.tx.spotProcurementPayment.findMany.mockResolvedValue([
      { id: "payment-draft", status: "draft" }
    ]);
    draftHarness.tx.spotProcurementVersion.create.mockResolvedValue({
      ...versionLock,
      id: "version-2",
      versionNo: 2,
      status: "draft",
      changeReason: "调整单价"
    });

    const result = await draftHarness.service.createVersion(
      "procurement-1",
      "material-1",
      {
        ...draftInput,
        lines: [{ ...invoiceLine, unitPrice: "4" }],
        changeReason: "调整单价"
      }
    );

    expect(draftHarness.tx.spotProcurementPayment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["payment-draft"] }, status: "draft" },
      data: {
        status: "invalidated",
        invalidatedAt: expect.any(Date),
        invalidatedByUserId: "material-1",
        invalidatedReason: "采购版本变更：调整单价"
      }
    });
    expect(
      draftHarness.tx.spotProcurementVersion.create.mock.calls[0]?.[0].data
        .changeSummary
    ).toEqual(
      expect.objectContaining({
        changes: expect.arrayContaining([
          expect.objectContaining({ field: "lines[0].unitPrice" })
        ])
      })
    );
    expect(result.versionNo).toBe(2);
  });

  it("rejects a new version whose field-by-field change summary is empty", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
      ])
      .mockResolvedValueOnce([{ ...versionLock, status: "approved" }]);
    role(tx, "material_staff");

    await expect(
      service.createVersion("procurement-1", "material-1", {
        ...draftInput,
        changeReason: "仅填写原因但未改字段"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.spotProcurementVersion.create).not.toHaveBeenCalled();
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
  });

  it("treats attachment-only reordering as no business change because attachment order is not frozen", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
      ])
      .mockResolvedValueOnce([{ ...versionLock, status: "approved" }]);
    role(tx, "material_staff");
    tx.fileObject.findMany.mockResolvedValue([
      {
        id: "file-a",
        storageStatus: "active",
        uploadedByUserId: "material-1"
      },
      {
        id: "file-b",
        storageStatus: "active",
        uploadedByUserId: "material-1"
      }
    ]);
    tx.spotProcurementAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-a",
        fileId: "file-a",
        category: "merchant_quote",
        uploadedByUserId: "material-1",
        createdAt: new Date("2026-07-17T00:00:00.000Z")
      },
      {
        id: "attachment-b",
        fileId: "file-b",
        category: "reference_photo",
        uploadedByUserId: "material-1",
        createdAt: new Date("2026-07-17T00:01:00.000Z")
      }
    ]);

    await expect(
      service.createVersion("procurement-1", "material-1", {
        ...draftInput,
        attachments: [
          { fileId: "file-b", category: "reference_photo" },
          { fileId: "file-a", category: "merchant_quote" }
        ],
        changeReason: "仅调整附件展示顺序"
      })
    ).rejects.toThrow("采购版本没有实际字段变化");
    expect(tx.spotProcurementVersion.create).not.toHaveBeenCalled();
  });

  it("copies omitted optional version facts from the previous backend snapshot", async () => {
    const { service, tx } = harness();
    const previousWithHandler = {
      ...versionLock,
      status: "approved",
      handlerUserId: "old-handler"
    };
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          ...rootLock,
          status: "approved_in_progress",
          handlerUserId: "old-handler",
          approvedAmountCents: 4100n
        }
      ])
      .mockResolvedValueOnce([previousWithHandler]);
    tx.userPosition.findMany.mockImplementation(
      async ({ where }: { where: { userId: string; projectId: string | null } }) =>
        where.projectId === null
          ? [{ positionId: `position-${where.userId}`, projectId: null }]
          : []
    );
    tx.position.findMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          key: "material_staff"
        }))
    );
    tx.spotProcurementAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-old",
        fileId: "old-quote",
        category: "merchant_quote",
        uploadedByUserId: "material-1",
        createdAt: new Date("2026-07-17T00:00:00.000Z")
      }
    ]);
    tx.fileObject.findMany.mockResolvedValue([
      {
        id: "old-quote",
        storageStatus: "active",
        uploadedByUserId: "material-1"
      }
    ]);
    tx.spotProcurementVersion.create.mockResolvedValue({
      ...previousWithHandler,
      id: "version-2",
      versionNo: 2,
      status: "draft"
    });

    await service.createVersion("procurement-1", "material-1", {
      supplierName: draftInput.supplierName,
      reason: draftInput.reason,
      lines: [{ ...invoiceLine, unitPrice: "4" }],
      changeReason: "调整单价，其他事实沿用"
    });

    expect(tx.spotProcurementVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supplierPartyId: "party-1",
        handlerUserId: "old-handler",
        note: "优先送到北门"
      })
    });
    expect(tx.spotProcurementAttachment.createMany).toHaveBeenCalledWith({
      data: [
        {
          versionId: "version-2",
          fileId: "old-quote",
          category: "merchant_quote",
          uploadedByUserId: "material-1"
        }
      ]
    });
    const summary =
      tx.spotProcurementVersion.create.mock.calls[0]?.[0].data.changeSummary;
    expect(summary.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "lines[0].unitPrice" })
      ])
    );
    expect(summary.changes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: expect.stringMatching(
            /supplierPartyId|handlerUserId|note|attachments/u
          )
        })
      ])
    );
  });

  it("inherits a previously frozen attachment after the uploader is replaced as procurement handler", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          ...rootLock,
          applicantUserId: "applicant-a",
          handlerUserId: "handler-b"
        }
      ])
      .mockResolvedValueOnce([
        {
          ...versionLock,
          handlerUserId: "handler-b"
        }
      ])
      .mockResolvedValueOnce([
        {
          ...rootLock,
          status: "approved_in_progress",
          applicantUserId: "applicant-a",
          handlerUserId: "handler-c",
          approvedAmountCents: 4100n
        }
      ])
      .mockResolvedValueOnce([
        {
          ...versionLock,
          status: "approved",
          handlerUserId: "handler-c"
        }
      ]);
    tx.userPosition.findMany.mockImplementation(
      async ({ where }: { where: { userId: string; projectId: string | null } }) =>
        where.projectId === null
          ? [
              {
                positionId: `position-${where.userId}`,
                projectId: null
              }
            ]
          : []
    );
    tx.position.findMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          key: "material_staff"
        }))
    );
    tx.spotProcurementAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-b",
        fileId: "handler-b-quote",
        category: "merchant_quote",
        uploadedByUserId: "handler-b",
        createdAt: new Date("2026-07-17T00:00:00.000Z")
      }
    ]);
    tx.fileObject.findMany.mockResolvedValue([
      {
        id: "handler-b-quote",
        storageStatus: "active",
        uploadedByUserId: "handler-b"
      }
    ]);
    tx.spotProcurementVersion.create.mockResolvedValue({
      ...versionLock,
      id: "version-2",
      versionNo: 2,
      status: "draft",
      handlerUserId: "handler-c"
    });

    await service.updateDraft("procurement-1", "handler-b", {
      ...draftInput,
      handlerUserId: "handler-c",
      attachments: [
        { fileId: "handler-b-quote", category: "merchant_quote" }
      ]
    });
    await service.createVersion("procurement-1", "handler-c", {
      supplierName: draftInput.supplierName,
      reason: draftInput.reason,
      lines: [{ ...invoiceLine, unitPrice: "4" }],
      changeReason: "调整单价，沿用原报价"
    });

    expect(tx.spotProcurementAttachment.createMany).toHaveBeenLastCalledWith({
      data: [
        {
          versionId: "version-2",
          fileId: "handler-b-quote",
          category: "merchant_quote",
          uploadedByUserId: "handler-b"
        }
      ]
    });
  });

  it("accepts null and empty-list clears for new-version optional facts and records them in changeSummary", async () => {
    const pipe = createApiValidationPipe();
    await expect(
      pipe.transform(
        {
          supplierPartyId: null,
          supplierName: draftInput.supplierName,
          reason: draftInput.reason,
          note: null,
          lines: draftInput.lines,
          attachments: [],
          changeReason: "取消合作单位引用、备注和附件"
        },
        {
          type: "body",
          metatype: CreateSpotProcurementVersionDto,
          data: undefined
        }
      )
    ).resolves.toEqual(
      expect.objectContaining({
        supplierPartyId: null,
        note: null,
        attachments: []
      })
    );

    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
      ])
      .mockResolvedValueOnce([{ ...versionLock, status: "approved" }]);
    role(tx, "material_staff");
    tx.spotProcurementAttachment.findMany.mockResolvedValue([
      {
        id: "attachment-old",
        fileId: "old-quote",
        category: "merchant_quote",
        uploadedByUserId: "material-1",
        createdAt: new Date("2026-07-17T00:00:00.000Z")
      }
    ]);
    tx.spotProcurementVersion.create.mockResolvedValue({
      ...versionLock,
      id: "version-2",
      versionNo: 2,
      status: "draft",
      supplierPartyId: null,
      note: null
    });

    await service.createVersion("procurement-1", "material-1", {
      supplierPartyId: null,
      supplierName: draftInput.supplierName,
      reason: draftInput.reason,
      note: null,
      lines: draftInput.lines,
      attachments: [],
      changeReason: "取消合作单位引用、备注和附件"
    });

    const createData =
      tx.spotProcurementVersion.create.mock.calls[0]?.[0].data;
    expect(createData).toEqual(
      expect.objectContaining({
        supplierPartyId: null,
        handlerUserId: "material-1",
        note: null
      })
    );
    expect(tx.spotProcurementAttachment.createMany).not.toHaveBeenCalled();
    expect(createData.changeSummary.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "supplierPartyId", after: null }),
        expect.objectContaining({ field: "note", after: null }),
        expect.objectContaining({ field: "attachments[0].fileId", after: null })
      ])
    );
  });

  it("allows an authorized pre-closure void but rejects a formally closed procurement", async () => {
    const closedHarness = harness();
    closedHarness.tx.$queryRaw.mockResolvedValueOnce([
      { ...rootLock, status: "closed", closedAt: new Date() }
    ]);
    role(closedHarness.tx, "project_manager");
    await expect(
      closedHarness.service.voidProcurement(
        "procurement-1",
        "manager-1",
        "业务终止"
      )
    ).rejects.toBeInstanceOf(ConflictException);

    const openHarness = harness();
    openHarness.tx.$queryRaw
      .mockResolvedValueOnce([
        { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
      ])
      .mockResolvedValueOnce([{ ...versionLock, status: "approved" }])
      .mockResolvedValueOnce([{ id: "payment-draft", status: "draft" }])
      .mockResolvedValueOnce([]);
    role(openHarness.tx, "project_manager");
    openHarness.tx.spotProcurementPayment.updateMany.mockResolvedValue({
      count: 1
    });

    const result = await openHarness.service.voidProcurement(
      "procurement-1",
      "manager-1",
      "业务终止"
    );

    expect(openHarness.tx.spotProcurement.update).toHaveBeenCalledWith({
      where: { id: "procurement-1" },
      data: {
        status: "voided",
        voidedAt: expect.any(Date),
        voidedByUserId: "manager-1",
        voidReason: "业务终止"
      }
    });
    expect(result.status).toBe("voided");
  });

  it("locks the current version before all procurement payments in stable order when voiding", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
      ])
      .mockResolvedValueOnce([{ ...versionLock, status: "approved" }])
      .mockResolvedValueOnce([{ id: "payment-draft", status: "draft" }])
      .mockResolvedValueOnce([]);
    role(tx, "project_manager");
    tx.spotProcurementPayment.updateMany.mockResolvedValue({ count: 1 });

    await service.voidProcurement(
      "procurement-1",
      "manager-1",
      "业务终止"
    );

    const sqlTexts = tx.$queryRaw.mock.calls.map(
      ([query]) =>
        ((query as { strings?: readonly string[] }).strings ?? []).join(" ")
    );
    expect(sqlTexts[0]).toContain('FROM "SpotProcurement"');
    expect(sqlTexts[1]).toContain('FROM "SpotProcurementVersion"');
    expect(sqlTexts[2]).toContain('FROM "SpotProcurementPayment"');
    expect(sqlTexts[2]).toContain('ORDER BY "id"');
    expect(sqlTexts[2]).toContain("FOR UPDATE");
    expect(sqlTexts[3]).toContain('FROM "ApprovalInstance"');
    expect(tx.spotProcurementPayment.findMany).not.toHaveBeenCalled();
  });

  it("stops voiding when locked draft payment invalidation loses its CAS", async () => {
    const { service, tx } = harness();
    tx.$queryRaw
      .mockResolvedValueOnce([
        { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
      ])
      .mockResolvedValueOnce([{ ...versionLock, status: "approved" }])
      .mockResolvedValueOnce([{ id: "payment-draft", status: "draft" }])
      .mockResolvedValueOnce([]);
    role(tx, "project_manager");
    tx.spotProcurementPayment.findMany.mockResolvedValue([
      { id: "payment-draft", status: "draft" }
    ]);
    tx.spotProcurementPayment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.voidProcurement(
        "procurement-1",
        "manager-1",
        "业务终止"
      )
    ).rejects.toThrow("付款状态已变化，请重试采购撤销");
    expect(tx.spotProcurementVersion.update).not.toHaveBeenCalled();
    expect(tx.spotProcurement.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("does not void a procurement that already has real or active payment facts", async () => {
    for (const paymentFact of ["execution", "active_payment"]) {
      const { service, tx } = harness();
      tx.$queryRaw
        .mockResolvedValueOnce([
          { ...rootLock, status: "approved_in_progress", approvedAmountCents: 4100n }
        ])
        .mockResolvedValueOnce([{ ...versionLock, status: "approved" }])
        .mockResolvedValueOnce([
          {
            id: "payment-1",
            status:
              paymentFact === "active_payment"
                ? "approved_pending_payment"
                : "draft"
          }
        ]);
      role(tx, "project_manager");
      if (paymentFact === "execution") {
        tx.spotProcurementPaymentExecution.findFirst.mockResolvedValue({
          id: "execution-1"
        });
      }

      await expect(
        service.voidProcurement(
          "procurement-1",
          "manager-1",
          "不应覆盖付款事实"
        )
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.spotProcurement.update).not.toHaveBeenCalled();
    }
  });

  it.each(["P2002", "P2003", "P2025", "P2034"])(
    "maps Prisma write error %s to a controlled Chinese conflict",
    async (code) => {
      const { service, prisma } = harness();
      prisma.$transaction.mockRejectedValue({ code, detail: "sensitive-db-detail" });

      await expect(
        service.createDraft("material-1", draftInput)
      ).rejects.toEqual(
        expect.objectContaining({
          status: 409,
          message: expect.not.stringContaining("sensitive-db-detail")
        })
      );
    }
  );
});
