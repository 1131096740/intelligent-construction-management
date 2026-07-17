import { ForbiddenException } from "@nestjs/common";
import { SpotProcurementAccessService } from "./spot-procurement-access.service";

type AccessFixture = {
  attachments?: Array<{ fileId: string; versionId: string }>;
  versions?: Array<{ id: string; procurementId: string; handlerUserId: string }>;
  procurements?: Array<{
    id: string;
    projectId: string;
    applicantUserId: string;
    handlerUserId: string;
  }>;
  payments?: Array<{
    id: string;
    procurementId: string;
    projectId: string;
    handlerUserId: string;
    status?: string;
    invalidatedByUserId?: string | null;
    supportingAttachmentFileId?: string | null;
    merchantPaymentProofFileId?: string | null;
  }>;
  receipts?: Array<{
    id: string;
    projectId: string;
    procurementId: string;
    handlerUserId: string;
  }>;
  receiptPhotos?: Array<{
    receiptId: string;
    originalFileId: string;
    watermarkedFileId: string;
  }>;
  receiptDelegations?: Array<{
    receiptId: string;
    delegatorUserId: string;
    delegateUserId: string;
    revokedAt: Date | null;
  }>;
  users?: Array<{ id: string; isActive: boolean }>;
  projectPositionUserIds?: string[];
  projectMemberUserIds?: string[];
  projectRosterUserIds?: string[];
  executions?: Array<{
    paymentId: string;
    executedByUserId: string;
    voidedByUserId?: string | null;
    voucherFileId: string;
    voidedAt: Date | null;
  }>;
  balanceReservations?: Array<{
    paymentId: string;
    reservedByUserId?: string;
    executedByUserId: string | null;
    releasedByUserId: string | null;
  }>;
  balanceEntries?: Array<{
    paymentId: string;
    actorUserId: string;
  }>;
  pdfDocuments?: Array<{
    fileId: string;
    businessType: string;
    businessId: string;
    templateKey: string;
  }>;
  fileObjects?: Array<{
    id: string;
    supersedesFileObjectId: string | null;
  }>;
  approvals?: Array<{
    id: string;
    businessType: string;
    businessId: string;
    status: string;
    currentNodeIndex: number;
    frozenNodes: unknown;
    applicantUserId: string;
  }>;
  actions?: Array<{
    approvalInstanceId: string;
    actorUserId: string;
    action: string;
  }>;
  projectRoleKeys?: string[];
  globalRoleKeys?: string[];
};

function buildPrisma(fixture: AccessFixture = {}) {
  const positions = [
    ...(fixture.projectRoleKeys ?? []).map((key, index) => ({
      id: `project-position-${index}`,
      key
    })),
    ...(fixture.globalRoleKeys ?? []).map((key, index) => ({
      id: `global-position-${index}`,
      key
    })),
    ...(fixture.projectPositionUserIds?.length
      ? [{ id: "affiliation-position", key: "employee" }]
      : [])
  ];
  return {
    spotProcurement: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          fixture.procurements?.find((row) => row.id === where.id) ?? null
        )
      ),
      findMany: jest.fn(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            (fixture.procurements ?? []).filter((row) => where.id.in.includes(row.id))
          )
      )
    },
    spotProcurementVersion: {
      findMany: jest.fn(
        ({ where }: {
          where: {
            id?: { in: string[] };
            procurementId?: { in: string[] };
          };
        }) => Promise.resolve(
          (fixture.versions ?? []).filter((row) =>
            where.id
              ? where.id.in.includes(row.id)
              : where.procurementId?.in.includes(row.procurementId)
          )
        )
      )
    },
    spotProcurementAttachment: {
      findMany: jest.fn(({ where }: { where: { fileId: string } }) =>
        Promise.resolve(
          (fixture.attachments ?? []).filter((row) => row.fileId === where.fileId)
        )
      )
    },
    spotProcurementPayment: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(fixture.payments?.find((row) => row.id === where.id) ?? null)
      ),
      findMany: jest.fn(
        ({ where }: {
          where: {
            id?: { in: string[] };
            OR?: Array<
              | { supportingAttachmentFileId: string }
              | { merchantPaymentProofFileId: string }
            >;
          };
        }) => {
          const rows = fixture.payments ?? [];
          if (where.id) {
            return Promise.resolve(rows.filter((row) => where.id?.in.includes(row.id)));
          }
          const fileIds = new Set(
            (where.OR ?? []).flatMap((condition) => Object.values(condition))
          );
          return Promise.resolve(
            rows.filter(
              (row) =>
                (row.supportingAttachmentFileId !== null &&
                  fileIds.has(row.supportingAttachmentFileId ?? "")) ||
                (row.merchantPaymentProofFileId !== null &&
                  fileIds.has(row.merchantPaymentProofFileId ?? ""))
            )
          );
        }
      )
    },
    spotProcurementReceipt: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(fixture.receipts?.find((row) => row.id === where.id) ?? null)
      ),
      findMany: jest.fn(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            (fixture.receipts ?? []).filter((row) => where.id.in.includes(row.id))
          )
      )
    },
    spotProcurementReceiptPhoto: {
      findMany: jest.fn(
        ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
          const fileIds = new Set((where.OR ?? []).flatMap((condition) => Object.values(condition)));
          return Promise.resolve(
            (fixture.receiptPhotos ?? []).filter(
              (row) =>
                fileIds.has(row.originalFileId) || fileIds.has(row.watermarkedFileId)
            )
          );
        }
      )
    },
    spotProcurementReceiptDelegation: {
      findMany: jest.fn(
        ({ where }: {
          where: {
            receiptId: { in: string[] };
            delegateUserId: string;
            revokedAt: null;
          };
        }) =>
          Promise.resolve(
            (fixture.receiptDelegations ?? []).filter(
              (row) =>
                where.receiptId.in.includes(row.receiptId) &&
                row.delegateUserId === where.delegateUserId &&
                row.revokedAt === null
            )
          )
      )
    },
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(fixture.users?.find((row) => row.id === where.id) ?? null)
      )
    },
    spotProcurementPaymentExecution: {
      findMany: jest.fn(
        ({ where }: {
          where: {
            voucherFileId?: string;
            paymentId?: { in: string[] };
            voidedAt?: null;
          };
        }) =>
          Promise.resolve(
            (fixture.executions ?? []).filter((row) => {
              if (where.voucherFileId && row.voucherFileId !== where.voucherFileId) return false;
              if (where.paymentId && !where.paymentId.in.includes(row.paymentId)) return false;
              if (where.voidedAt === null && row.voidedAt !== null) return false;
              return true;
            })
          )
      )
    },
    supplierBalanceReservation: {
      findMany: jest.fn(
        ({ where }: { where: { paymentId: { in: string[] } } }) =>
          Promise.resolve(
            (fixture.balanceReservations ?? []).filter((row) =>
              where.paymentId.in.includes(row.paymentId)
            )
          )
      )
    },
    supplierBalanceEntry: {
      findMany: jest.fn(
        ({ where }: { where: { paymentId: { in: string[] } } }) =>
          Promise.resolve(
            (fixture.balanceEntries ?? []).filter((row) =>
              where.paymentId.in.includes(row.paymentId)
            )
          )
      )
    },
    pdfDocument: {
      findMany: jest.fn(
        ({
          where
        }: {
          where: { fileId: string | { in: string[] } };
        }) => {
          const fileIds =
            typeof where.fileId === "string" ? [where.fileId] : where.fileId.in;
          return Promise.resolve(
            (fixture.pdfDocuments ?? []).filter((row) => fileIds.includes(row.fileId))
          );
        }
      )
    },
    fileObject: {
      findMany: jest.fn(
        ({
          where
        }: {
          where: { supersedesFileObjectId: { in: string[] } };
        }) =>
          Promise.resolve(
            (fixture.fileObjects ?? []).filter(
              (row) =>
                row.supersedesFileObjectId !== null &&
                where.supersedesFileObjectId.in.includes(row.supersedesFileObjectId)
            )
          )
      )
    },
    approvalInstance: {
      findMany: jest.fn(
        ({ where }: { where: { OR: Array<{ businessType: string; businessId: string }> } }) =>
          Promise.resolve(
            (fixture.approvals ?? []).filter((row) =>
              where.OR.some(
                (pair) =>
                  pair.businessType === row.businessType && pair.businessId === row.businessId
              )
            )
          )
      )
    },
    approvalActionLog: {
      findMany: jest.fn(
        ({ where }: {
          where: {
            approvalInstanceId: { in: string[] };
            actorUserId: string;
            action?: { in: string[] };
          };
        }) =>
          Promise.resolve(
            (fixture.actions ?? []).filter(
              (row) =>
                where.approvalInstanceId.in.includes(row.approvalInstanceId) &&
                row.actorUserId === where.actorUserId &&
                (!where.action || where.action.in.includes(row.action))
            )
          )
      )
    },
    userPosition: {
      findMany: jest.fn(
        ({ where }: { where: { userId: string; projectId: string | null } }) =>
          Promise.resolve([
            ...(where.projectId === null
              ? fixture.globalRoleKeys ?? []
              : fixture.projectRoleKeys ?? []
            ).map((_, index) => ({
              positionId: `${where.projectId === null ? "global" : "project"}-position-${index}`
            })),
            ...(where.projectId !== null &&
            (fixture.projectPositionUserIds ?? []).includes(where.userId)
              ? [{ positionId: "affiliation-position" }]
              : [])
          ])
      )
    },
    projectMember: {
      findMany: jest.fn(({ where }: { where: { userId: string; projectId: string } }) =>
        Promise.resolve(
          (fixture.projectMemberUserIds ?? []).includes(where.userId)
            ? [{ projectId: where.projectId, userId: where.userId, positionKey: "employee" }]
            : []
        )
      )
    },
    projectRosterMember: {
      findMany: jest.fn(({ where }: { where: { userId: string; projectId: string } }) =>
        Promise.resolve(
          (fixture.projectRosterUserIds ?? []).includes(where.userId)
            ? [{ projectId: where.projectId, userId: where.userId }]
            : []
        )
      )
    },
    position: {
      findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(positions.filter((position) => where.id.in.includes(position.id)))
      )
    }
  };
}

describe("SpotProcurementAccessService", () => {
  it("returns not_spot only when no Spot business record binds the file", async () => {
    const service = new SpotProcurementAccessService(buildPrisma() as never);

    await expect(service.resolveFileDownloadAccess("ordinary-file", "user-1")).resolves.toBe(
      "not_spot"
    );
  });

  it("resolves real procurement, payment, and receipt resources and fails closed when missing", async () => {
    const prisma = buildPrisma({
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      payments: [
        {
          id: "payment-1",
          procurementId: "procurement-1",
          projectId: "project-1",
          handlerUserId: "handler-1"
        }
      ],
      receipts: [
        {
          id: "receipt-1",
          procurementId: "procurement-1",
          projectId: "project-1",
          handlerUserId: "handler-1"
        }
      ]
    });
    const service = new SpotProcurementAccessService(prisma as never);

    await expect(service.requireProcurementProjectId("procurement-1")).resolves.toBe("project-1");
    await expect(service.requirePaymentProjectId("payment-1")).resolves.toBe("project-1");
    await expect(service.requireReceiptProjectId("receipt-1")).resolves.toBe("project-1");
    await expect(service.findPaymentProjectId("missing-payment")).resolves.toBeNull();
    await expect(service.requireProcurementProjectId("missing-procurement")).rejects.toBeInstanceOf(
      ForbiddenException
    );
    await expect(service.requireReceiptProjectId("missing-receipt")).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it.each([
    ["applicant-1", "allowed"],
    ["handler-1", "allowed"],
    ["material-director", "allowed"],
    ["unrelated-user", "denied"]
  ] as const)("applies the minimal receipt ACL for %s", async (actorUserId, expected) => {
    const fixture: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      receipts: [
        {
          id: "receipt-1",
          projectId: "project-1",
          procurementId: "procurement-1",
          handlerUserId: "handler-1"
        }
      ],
      projectRoleKeys: actorUserId === "material-director" ? ["material_director"] : []
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma(fixture) as never)
        .resolveReceiptViewAccess("receipt-1", actorUserId)
    ).resolves.toBe(expected);
  });

  it("allows only a current active same-project receipt delegate", async () => {
    const base: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      receipts: [
        {
          id: "receipt-1",
          projectId: "project-1",
          procurementId: "procurement-1",
          handlerUserId: "handler-1"
        }
      ],
      users: [{ id: "delegate-1", isActive: true }],
      projectRosterUserIds: ["delegate-1"]
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma({
        ...base,
        receiptDelegations: [
          {
            receiptId: "receipt-1",
            delegatorUserId: "handler-1",
            delegateUserId: "delegate-1",
            revokedAt: null
          }
        ]
      }) as never).resolveReceiptViewAccess("receipt-1", "delegate-1")
    ).resolves.toBe("allowed");

    await expect(
      new SpotProcurementAccessService(buildPrisma({
        ...base,
        receiptDelegations: [
          {
            receiptId: "receipt-1",
            delegatorUserId: "handler-1",
            delegateUserId: "delegate-1",
            revokedAt: new Date("2026-07-17T00:00:00.000Z")
          }
        ]
      }) as never).resolveReceiptViewAccess("receipt-1", "delegate-1")
    ).resolves.toBe("denied");

    await expect(
      new SpotProcurementAccessService(buildPrisma({
        ...base,
        projectRosterUserIds: [],
        receiptDelegations: [
          {
            receiptId: "receipt-1",
            delegatorUserId: "handler-1",
            delegateUserId: "delegate-1",
            revokedAt: null
          }
        ]
      }) as never).resolveReceiptViewAccess("receipt-1", "delegate-1")
    ).resolves.toBe("denied");

    await expect(
      new SpotProcurementAccessService(buildPrisma({
        ...base,
        users: [{ id: "delegate-1", isActive: false }],
        receiptDelegations: [
          {
            receiptId: "receipt-1",
            delegatorUserId: "handler-1",
            delegateUserId: "delegate-1",
            revokedAt: null
          }
        ]
      }) as never).resolveReceiptViewAccess("receipt-1", "delegate-1")
    ).resolves.toBe("denied");
  });

  it("does not retain receipt delegation access after the current handler changes", async () => {
    const service = new SpotProcurementAccessService(buildPrisma({
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "new-handler"
        }
      ],
      receipts: [
        {
          id: "receipt-1",
          projectId: "project-1",
          procurementId: "procurement-1",
          handlerUserId: "new-handler"
        }
      ],
      receiptDelegations: [
        {
          receiptId: "receipt-1",
          delegatorUserId: "old-handler",
          delegateUserId: "delegate-1",
          revokedAt: null
        }
      ],
      users: [{ id: "delegate-1", isActive: true }],
      projectRosterUserIds: ["delegate-1"]
    }) as never);

    await expect(service.resolveReceiptViewAccess("receipt-1", "delegate-1")).resolves.toBe(
      "denied"
    );
  });

  it.each(["original-file", "watermarked-file"])(
    "protects a bound receipt %s with business ACL instead of uploader fallback",
    async (fileId) => {
      const fixture: AccessFixture = {
        procurements: [
          {
            id: "procurement-1",
            projectId: "project-1",
            applicantUserId: "applicant-1",
            handlerUserId: "handler-1"
          }
        ],
        receipts: [
          {
            id: "receipt-1",
            projectId: "project-1",
            procurementId: "procurement-1",
            handlerUserId: "handler-1"
          }
        ],
        receiptPhotos: [
          {
            receiptId: "receipt-1",
            originalFileId: "original-file",
            watermarkedFileId: "watermarked-file"
          }
        ]
      };

      await expect(
        new SpotProcurementAccessService(buildPrisma(fixture) as never)
          .resolveFileDownloadAccess(fileId, "applicant-1")
      ).resolves.toBe("allowed");
      await expect(
        new SpotProcurementAccessService(buildPrisma(fixture) as never)
          .resolveFileDownloadAccess(fileId, "unrelated-uploader")
      ).resolves.toBe("denied");
    }
  );

  it("fails closed when a receipt file is also bound to another spot business", async () => {
    const fixture: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      versions: [
        {
          id: "version-1",
          procurementId: "procurement-1",
          handlerUserId: "handler-1"
        }
      ],
      attachments: [
        { fileId: "mixed-file", versionId: "version-1" }
      ],
      receipts: [
        {
          id: "receipt-1",
          projectId: "project-1",
          procurementId: "procurement-1",
          handlerUserId: "handler-1"
        }
      ],
      receiptPhotos: [
        {
          receiptId: "receipt-1",
          originalFileId: "mixed-file",
          watermarkedFileId: "watermarked-file"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(
        buildPrisma(fixture) as never
      ).resolveFileDownloadAccess(
        "mixed-file",
        "applicant-1"
      )
    ).resolves.toBe("denied");
  });

  it("fails closed when one file is cross-bound to multiple receipts", async () => {
    const fixture: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        },
        {
          id: "procurement-2",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-2"
        }
      ],
      receipts: [
        {
          id: "receipt-1",
          projectId: "project-1",
          procurementId: "procurement-1",
          handlerUserId: "handler-1"
        },
        {
          id: "receipt-2",
          projectId: "project-1",
          procurementId: "procurement-2",
          handlerUserId: "handler-2"
        }
      ],
      receiptPhotos: [
        {
          receiptId: "receipt-1",
          originalFileId: "shared-file",
          watermarkedFileId: "watermarked-1"
        },
        {
          receiptId: "receipt-2",
          originalFileId: "original-2",
          watermarkedFileId: "shared-file"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(
        buildPrisma(fixture) as never
      ).resolveFileDownloadAccess(
        "shared-file",
        "applicant-1"
      )
    ).resolves.toBe("denied");
  });

  it("retains procurement view access for historical version handlers and action actors", async () => {
    const fixture: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "current-handler"
        }
      ],
      versions: [
        {
          id: "version-1",
          procurementId: "procurement-1",
          handlerUserId: "historical-handler"
        },
        {
          id: "version-2",
          procurementId: "procurement-1",
          handlerUserId: "current-handler"
        }
      ],
      approvals: [
        {
          id: "approval-old",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [],
          applicantUserId: "applicant-1"
        }
      ],
      actions: [
        {
          approvalInstanceId: "approval-old",
          actorUserId: "historical-action-actor",
          action: "transfer"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma(fixture) as never)
        .accessibleProcurementIds(["procurement-1"], "historical-handler")
    ).resolves.toEqual(new Set(["procurement-1"]));
    await expect(
      new SpotProcurementAccessService(buildPrisma(fixture) as never)
        .resolveProcurementViewAccess("procurement-1", "historical-action-actor")
    ).resolves.toBe("allowed");
  });

  it("keeps batch procurement access isolated to the business with a real action", async () => {
    const fixture: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        },
        {
          id: "procurement-2",
          projectId: "project-1",
          applicantUserId: "applicant-2",
          handlerUserId: "handler-2"
        }
      ],
      versions: [
        { id: "version-1", procurementId: "procurement-1", handlerUserId: "handler-1" },
        { id: "version-2", procurementId: "procurement-2", handlerUserId: "handler-2" }
      ],
      approvals: [
        {
          id: "approval-1",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          status: "rejected",
          currentNodeIndex: 0,
          frozenNodes: [],
          applicantUserId: "applicant-1"
        },
        {
          id: "approval-2",
          businessType: "spot_procurement_version",
          businessId: "version-2",
          status: "rejected",
          currentNodeIndex: 0,
          frozenNodes: [],
          applicantUserId: "applicant-2"
        }
      ],
      actions: [
        {
          approvalInstanceId: "approval-1",
          actorUserId: "reviewer-1",
          action: "reject"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma(fixture) as never)
        .accessibleProcurementIds(
          ["procurement-1", "procurement-2", "missing-procurement"],
          "reviewer-1"
        )
    ).resolves.toEqual(new Set(["procurement-1"]));
  });

  it("uses project-scoped effective roles for each procurement instead of globalizing project roles", async () => {
    const base: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      versions: [
        { id: "version-1", procurementId: "procurement-1", handlerUserId: "handler-1" }
      ],
      approvals: [
        {
          id: "approval-1",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [{ roleKeys: ["project_manager"] }],
          applicantUserId: "applicant-1"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...base, globalRoleKeys: ["project_manager"] }) as never
      ).accessibleProcurementIds(["procurement-1"], "global-project-manager")
    ).resolves.toEqual(new Set());
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...base, projectRoleKeys: ["project_manager"] }) as never
      ).accessibleProcurementIds(["procurement-1"], "project-manager")
    ).resolves.toEqual(new Set(["procurement-1"]));
  });

  it("keeps batch payment final-node access isolated to the currently active OR node", async () => {
    const frozenNodes = [
      { roleKeys: ["comprehensive_director"] },
      { roleKeys: ["project_manager"] },
      { roleKeys: ["finance_director"] },
      { roleKeys: ["chairman", "general_manager"], mode: "or" }
    ];
    const service = new SpotProcurementAccessService(
      buildPrisma({
        procurements: [
          {
            id: "procurement-1",
            projectId: "project-1",
            applicantUserId: "applicant-1",
            handlerUserId: "handler-1"
          },
          {
            id: "procurement-2",
            projectId: "project-1",
            applicantUserId: "applicant-2",
            handlerUserId: "handler-2"
          }
        ],
        payments: [
          {
            id: "payment-1",
            procurementId: "procurement-1",
            projectId: "project-1",
            handlerUserId: "handler-1"
          },
          {
            id: "payment-2",
            procurementId: "procurement-2",
            projectId: "project-1",
            handlerUserId: "handler-2"
          }
        ],
        approvals: [
          {
            id: "approval-1",
            businessType: "spot_procurement_payment",
            businessId: "payment-1",
            status: "approval_pending",
            currentNodeIndex: 3,
            frozenNodes,
            applicantUserId: "handler-1"
          },
          {
            id: "approval-2",
            businessType: "spot_procurement_payment",
            businessId: "payment-2",
            status: "approval_pending",
            currentNodeIndex: 2,
            frozenNodes,
            applicantUserId: "handler-2"
          }
        ],
        globalRoleKeys: ["chairman"]
      }) as never
    );

    await expect(
      service.accessiblePaymentIds(["payment-1", "payment-2"], "chairman-1")
    ).resolves.toEqual(new Set(["payment-1"]));
    await expect(service.resolvePaymentViewAccess("payment-2", "chairman-1"))
      .resolves.toBe("denied");
  });

  it("does not grant final-node access from a stale approval instance", async () => {
    const frozenNodes = [
      { roleKeys: ["comprehensive_director"] },
      { roleKeys: ["chairman", "general_manager"], mode: "or" }
    ];
    const service = new SpotProcurementAccessService(
      buildPrisma({
        procurements: [
          {
            id: "procurement-1",
            projectId: "project-1",
            applicantUserId: "applicant-1",
            handlerUserId: "handler-1"
          }
        ],
        payments: [
          {
            id: "payment-1",
            procurementId: "procurement-1",
            projectId: "project-1",
            handlerUserId: "handler-1",
            status: "returned"
          }
        ],
        approvals: [
          {
            id: "approval-new",
            businessType: "spot_procurement_payment",
            businessId: "payment-1",
            status: "approved",
            currentNodeIndex: 1,
            frozenNodes,
            applicantUserId: "handler-1"
          },
          {
            id: "approval-stale",
            businessType: "spot_procurement_payment",
            businessId: "payment-1",
            status: "approval_pending",
            currentNodeIndex: 1,
            frozenNodes,
            applicantUserId: "handler-1"
          }
        ],
        globalRoleKeys: ["chairman"]
      }) as never
    );

    await expect(
      service.accessiblePaymentIds(["payment-1"], "chairman-1")
    ).resolves.toEqual(new Set());
  });

  it("lets only project-scoped finance staff see an executable payment before the first execution", async () => {
    const base: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      payments: [
        {
          id: "payment-1",
          procurementId: "procurement-1",
          projectId: "project-1",
          handlerUserId: "handler-1",
          status: "approved_pending_payment"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(
        buildPrisma({
          ...base,
          projectRoleKeys: ["finance_staff"]
        }) as never
      ).accessiblePaymentIds(["payment-1"], "project-finance")
    ).resolves.toEqual(new Set(["payment-1"]));
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({
          ...base,
          globalRoleKeys: ["finance_staff"]
        }) as never
      ).accessiblePaymentIds(["payment-1"], "global-finance")
    ).resolves.toEqual(new Set());
  });

  it("maps payment execution, void, reservation, balance and approval facts to their own business", async () => {
    const paymentIds = [
      "payment-execution",
      "payment-void",
      "payment-reservation",
      "payment-balance",
      "payment-action",
      "payment-unrelated"
    ];
    const service = new SpotProcurementAccessService(
      buildPrisma({
        procurements: [
          {
            id: "procurement-1",
            projectId: "project-1",
            applicantUserId: "applicant-1",
            handlerUserId: "handler-1"
          }
        ],
        payments: paymentIds.map((id) => ({
          id,
          procurementId: "procurement-1",
          projectId: "project-1",
          handlerUserId: "handler-1"
        })),
        executions: [
          {
            paymentId: "payment-execution",
            executedByUserId: "fact-actor",
            voucherFileId: "voucher-1",
            voidedAt: null
          },
          {
            paymentId: "payment-void",
            executedByUserId: "other-executor",
            voidedByUserId: "fact-actor",
            voucherFileId: "voucher-2",
            voidedAt: new Date("2026-07-17T00:00:00.000Z")
          }
        ],
        balanceReservations: [
          {
            paymentId: "payment-reservation",
            reservedByUserId: "fact-actor",
            executedByUserId: null,
            releasedByUserId: null
          }
        ],
        balanceEntries: [
          { paymentId: "payment-balance", actorUserId: "fact-actor" }
        ],
        approvals: [
          {
            id: "approval-action",
            businessType: "spot_procurement_payment",
            businessId: "payment-action",
            status: "approval_pending",
            currentNodeIndex: 0,
            frozenNodes: [],
            applicantUserId: "handler-1"
          },
          {
            id: "approval-unrelated",
            businessType: "spot_procurement_payment",
            businessId: "payment-unrelated",
            status: "approval_pending",
            currentNodeIndex: 0,
            frozenNodes: [],
            applicantUserId: "handler-1"
          }
        ],
        actions: [
          {
            approvalInstanceId: "approval-action",
            actorUserId: "fact-actor",
            action: "delegate"
          }
        ]
      }) as never
    );

    await expect(service.accessiblePaymentIds(paymentIds, "fact-actor")).resolves.toEqual(
      new Set(paymentIds.slice(0, 5))
    );
  });

  it.each([
    [
      "application attachment",
      { attachments: [{ fileId: "file-1", versionId: "version-1" }] },
      "applicant-1"
    ],
    [
      "payment supporting attachment",
      { payments: [{ supportingAttachmentFileId: "file-1" }] },
      "handler-1"
    ],
    [
      "merchant payment proof",
      { payments: [{ merchantPaymentProofFileId: "file-1" }] },
      "handler-1"
    ],
    [
      "active execution voucher",
      {
        executions: [
          {
            paymentId: "payment-1",
            executedByUserId: "finance-executor",
            voucherFileId: "file-1",
            voidedAt: null
          }
        ]
      },
      "finance-executor"
    ]
  ])("recognizes %s and allows only a real participant", async (_label, partial, actorUserId) => {
    const payment = {
      id: "payment-1",
      procurementId: "procurement-1",
      projectId: "project-1",
      handlerUserId: "handler-1",
      ...((partial as AccessFixture).payments?.[0] ?? {})
    };
    const service = new SpotProcurementAccessService(
      buildPrisma({
        ...partial,
        versions: [
          { id: "version-1", procurementId: "procurement-1", handlerUserId: "handler-1" }
        ],
        procurements: [
          {
            id: "procurement-1",
            projectId: "project-1",
            applicantUserId: "applicant-1",
            handlerUserId: "handler-1"
          }
        ],
        payments: [payment]
      } as AccessFixture) as never
    );

    await expect(service.resolveFileDownloadAccess("file-1", actorUserId)).resolves.toBe(
      "allowed"
    );
    await expect(service.resolveFileDownloadAccess("file-1", "unrelated-uploader")).resolves.toBe(
      "denied"
    );
  });

  it("uses only effective roles from the frozen application workflow", async () => {
    const common: AccessFixture = {
      attachments: [{ fileId: "file-1", versionId: "version-1" }],
      versions: [
        { id: "version-1", procurementId: "procurement-1", handlerUserId: "handler-1" }
      ],
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      approvals: [
        {
          id: "approval-1",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [{ roleKeys: ["material_director", "project_manager"] }],
          applicantUserId: "applicant-1"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...common, globalRoleKeys: ["material_director"] }) as never
      ).resolveFileDownloadAccess("file-1", "material-director")
    ).resolves.toBe("allowed");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...common, globalRoleKeys: ["super_admin"] }) as never
      ).resolveFileDownloadAccess("file-1", "super-admin")
    ).resolves.toBe("denied");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({
          ...common,
          approvals: [],
          globalRoleKeys: ["material_director"]
        }) as never
      ).resolveFileDownloadAccess("file-1", "material-director")
    ).resolves.toBe("denied");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({
          ...common,
          approvals: [
            {
              ...common.approvals![0],
              frozenNodes: [{ roleKeys: ["project_manager"] }]
            }
          ],
          globalRoleKeys: ["material_director"]
        }) as never
      ).resolveFileDownloadAccess("file-1", "material-director")
    ).resolves.toBe("denied");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...common, globalRoleKeys: ["project_manager"] }) as never
      ).resolveFileDownloadAccess("file-1", "invalid-global-project-manager")
    ).resolves.toBe("denied");
  });

  it("allows effective payment workflow roles but not a non-executing finance staff member", async () => {
    const base: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      payments: [
        {
          id: "payment-1",
          procurementId: "procurement-1",
          projectId: "project-1",
          handlerUserId: "handler-1",
          supportingAttachmentFileId: "file-1"
        }
      ],
      approvals: [
        {
          id: "approval-1",
          businessType: "spot_procurement_payment",
          businessId: "payment-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [
            { roleKeys: ["comprehensive_director"] },
            { roleKeys: ["project_manager"] },
            { roleKeys: ["finance_director"] },
            { roleKeys: ["chairman", "general_manager"] }
          ],
          applicantUserId: "handler-1"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...base, globalRoleKeys: ["comprehensive_director"] }) as never
      ).resolveFileDownloadAccess("file-1", "comprehensive-director")
    ).resolves.toBe("allowed");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...base, projectRoleKeys: ["finance_staff"] }) as never
      ).resolveFileDownloadAccess("file-1", "finance-staff")
    ).resolves.toBe("denied");
  });

  it("allows only finance users who actually executed or released a supplier balance fact", async () => {
    const base: AccessFixture = {
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      payments: [
        {
          id: "payment-1",
          procurementId: "procurement-1",
          projectId: "project-1",
          handlerUserId: "handler-1",
          supportingAttachmentFileId: "file-1"
        }
      ],
      balanceReservations: [
        {
          paymentId: "payment-1",
          executedByUserId: "balance-executor",
          releasedByUserId: null
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma(base) as never)
        .resolveFileDownloadAccess("file-1", "balance-executor")
    ).resolves.toBe("allowed");
    await expect(
      new SpotProcurementAccessService(buildPrisma(base) as never)
        .resolveFileDownloadAccess("file-1", "unrelated-finance")
    ).resolves.toBe("denied");
  });

  it("authorizes a formal Spot business before any PDF repair write", async () => {
    const base: AccessFixture = {
      versions: [
        { id: "version-1", procurementId: "procurement-1", handlerUserId: "handler-1" }
      ],
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      approvals: [
        {
          id: "approval-1",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          status: "approval_pending",
          currentNodeIndex: 0,
          frozenNodes: [{ roleKeys: ["material_director"] }],
          applicantUserId: "applicant-1"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma(base) as never)
        .resolveBusinessDownloadAccess(
          "spot_procurement_version",
          "version-1",
          "applicant-1"
        )
    ).resolves.toBe("denied");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({
          ...base,
          approvals: [{ ...base.approvals![0], status: "approved" }]
        }) as never
      ).resolveBusinessDownloadAccess(
        "spot_procurement_version",
        "version-1",
        "applicant-1"
      )
    ).resolves.toBe("allowed");
    await expect(
      new SpotProcurementAccessService(buildPrisma(base) as never)
        .resolveBusinessDownloadAccess(
          "spot_procurement_version",
          "missing-version",
          "applicant-1"
        )
    ).resolves.toBe("denied");
  });

  it("keeps voided execution vouchers inside the Spot ACL instead of falling back to uploader/global shortcuts", async () => {
    const service = new SpotProcurementAccessService(
      buildPrisma({
        procurements: [
          {
            id: "procurement-1",
            projectId: "project-1",
            applicantUserId: "applicant-1",
            handlerUserId: "handler-1"
          }
        ],
        payments: [
          {
            id: "payment-1",
            procurementId: "procurement-1",
            projectId: "project-1",
            handlerUserId: "handler-1"
          }
        ],
        executions: [
          {
            paymentId: "payment-1",
            executedByUserId: "finance-executor",
            voucherFileId: "file-voided-voucher",
            voidedAt: new Date("2026-07-17T00:00:00.000Z")
          }
        ],
        globalRoleKeys: ["super_admin"]
      }) as never
    );

    await expect(
      service.resolveFileDownloadAccess("file-voided-voucher", "unrelated-uploader")
    ).resolves.toBe("denied");
    await expect(
      service.resolveFileDownloadAccess("file-voided-voucher", "finance-executor")
    ).resolves.toBe("allowed");
  });

  it("retains access for an approver who actually rejected the Spot request", async () => {
    const service = new SpotProcurementAccessService(
      buildPrisma({
        attachments: [{ fileId: "file-1", versionId: "version-1" }],
        versions: [
          { id: "version-1", procurementId: "procurement-1", handlerUserId: "handler-1" }
        ],
        procurements: [
          {
            id: "procurement-1",
            projectId: "project-1",
            applicantUserId: "applicant-1",
            handlerUserId: "handler-1"
          }
        ],
        approvals: [
          {
            id: "approval-1",
            businessType: "spot_procurement_version",
            businessId: "version-1",
            status: "rejected",
            currentNodeIndex: 0,
            frozenNodes: [],
            applicantUserId: "applicant-1"
          }
        ],
        actions: [
          { approvalInstanceId: "approval-1", actorUserId: "rejector-1", action: "reject" }
        ]
      }) as never
    );

    await expect(service.resolveFileDownloadAccess("file-1", "rejector-1")).resolves.toBe(
      "allowed"
    );
  });

  it("allows chairman/general manager only at the active OR node or after a real approval action", async () => {
    const base: AccessFixture = {
      payments: [
        {
          id: "payment-1",
          procurementId: "procurement-1",
          projectId: "project-1",
          handlerUserId: "handler-1",
          supportingAttachmentFileId: "file-1"
        }
      ],
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      globalRoleKeys: ["chairman"]
    };
    const frozenNodes = [
      { roleKeys: ["comprehensive_director"] },
      { roleKeys: ["project_manager"] },
      { roleKeys: ["finance_director"] },
      { roleKeys: ["chairman", "general_manager"], mode: "or" }
    ];
    const approval = {
      id: "approval-1",
      businessType: "spot_procurement_payment",
      businessId: "payment-1",
      status: "approval_pending",
      currentNodeIndex: 2,
      frozenNodes,
      applicantUserId: "handler-1"
    };

    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...base, approvals: [approval] }) as never
      ).resolveFileDownloadAccess("file-1", "chairman-1")
    ).resolves.toBe("denied");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({
          ...base,
          approvals: [{ ...approval, currentNodeIndex: 3 }]
        }) as never
      ).resolveFileDownloadAccess("file-1", "chairman-1")
    ).resolves.toBe("allowed");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({
          ...base,
          approvals: [approval],
          actions: [
            { approvalInstanceId: "approval-1", actorUserId: "chairman-1", action: "approve" }
          ]
        }) as never
      ).resolveFileDownloadAccess("file-1", "chairman-1")
    ).resolves.toBe("allowed");
  });

  it.each(["spot_procurement_version", "spot_procurement_payment"])(
    "denies a pending %s PDF even to its applicant and allows it only after approval",
    async (businessType) => {
      const isPayment = businessType === "spot_procurement_payment";
      const businessId = isPayment ? "payment-1" : "version-1";
      const base: AccessFixture = {
        versions: [
          { id: "version-1", procurementId: "procurement-1", handlerUserId: "handler-1" }
        ],
        procurements: [
          {
            id: "procurement-1",
            projectId: "project-1",
            applicantUserId: "applicant-1",
            handlerUserId: "handler-1"
          }
        ],
        payments: [
          {
            id: "payment-1",
            procurementId: "procurement-1",
            projectId: "project-1",
            handlerUserId: "handler-1"
          }
        ],
        pdfDocuments: [
          { fileId: "file-1", businessType, businessId, templateKey: "approval_form" }
        ]
      };
      const approval = {
        id: "approval-1",
        businessType,
        businessId,
        status: "approval_pending",
        currentNodeIndex: 0,
        frozenNodes: [],
        applicantUserId: "applicant-1"
      };

      await expect(
        new SpotProcurementAccessService(
          buildPrisma({ ...base, approvals: [approval] }) as never
        ).resolveFileDownloadAccess("file-1", "applicant-1")
      ).resolves.toBe("denied");
      await expect(
        new SpotProcurementAccessService(
          buildPrisma({ ...base, approvals: [{ ...approval, status: "approved" }] }) as never
        ).resolveFileDownloadAccess("file-1", "applicant-1")
      ).resolves.toBe("allowed");
    }
  );

  it("keeps superseded approval PDFs inside the current Spot business ACL", async () => {
    const base: AccessFixture = {
      versions: [
        { id: "version-1", procurementId: "procurement-1", handlerUserId: "handler-1" }
      ],
      procurements: [
        {
          id: "procurement-1",
          projectId: "project-1",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1"
        }
      ],
      fileObjects: [
        { id: "file-new", supersedesFileObjectId: "file-old" }
      ],
      pdfDocuments: [
        {
          fileId: "file-new",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          templateKey: "approval_form"
        }
      ],
      globalRoleKeys: ["super_admin"]
    };
    const pendingApproval = {
      id: "approval-1",
      businessType: "spot_procurement_version",
      businessId: "version-1",
      status: "approval_pending",
      currentNodeIndex: 0,
      frozenNodes: [{ roleKeys: ["project_manager"] }],
      applicantUserId: "applicant-1"
    };

    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...base, approvals: [pendingApproval] }) as never
      ).resolveFileDownloadAccess("file-old", "super-admin")
    ).resolves.toBe("denied");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({ ...base, approvals: [pendingApproval] }) as never
      ).resolveFileDownloadAccess("file-old", "applicant-1")
    ).resolves.toBe("denied");
    await expect(
      new SpotProcurementAccessService(
        buildPrisma({
          ...base,
          approvals: [{ ...pendingApproval, status: "approved" }]
        }) as never
      ).resolveFileDownloadAccess("file-old", "applicant-1")
    ).resolves.toBe("allowed");
  });
});
