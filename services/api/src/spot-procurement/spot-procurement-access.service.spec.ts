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
  paymentInvoices?: Array<{
    paymentId: string;
    fileId: string;
    uploadedByUserId: string;
    invalidatedByUserId?: string | null;
  }>;
  receipts?: Array<{
    id: string;
    projectId: string;
    procurementId: string;
    handlerUserId: string;
    status?: string;
    currentRevisionNo?: number;
  }>;
  receiptReviews?: Array<{
    id: string;
    receiptId: string;
    sequenceNo: number;
    receiptRevisionNo?: number;
    decision?: string;
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
  invoiceAllocations?: Array<{ id: string; projectId: string }>;
  invoiceRecords?: Array<{
    id: string;
    fileId: string;
    projectId: string;
    sourceBusinessType: string;
    sourceBusinessId: string;
    sourceProcurementId: string | null;
    uploadedByUserId: string;
    invalidatedByUserId?: string | null;
  }>;
  noInvoiceConfirmations?: Array<{
    id: string;
    proofFileId: string;
    projectId: string;
    procurementId: string;
    submittedByUserId: string;
    reviewedByUserId?: string | null;
    reversedByUserId?: string | null;
  }>;
  invoiceExceptionConfirmations?: Array<{
    id: string;
    proofFileId: string;
    projectId: string;
    procurementId: string;
    submittedByUserId: string;
    reviewedByUserId?: string | null;
    reversedByUserId?: string | null;
  }>;
  users?: Array<{ id: string; isActive: boolean }>;
  projectPositionUserIds?: string[];
  projectMemberUserIds?: string[];
  projectRosterUserIds?: string[];
  executions?: Array<{
    id?: string;
    paymentId: string;
    executedByUserId: string;
    voidedByUserId?: string | null;
    voucherFileId: string;
    voidedAt: Date | null;
  }>;
  executionVouchers?: Array<{
    paymentExecutionId: string;
    fileId: string;
  }>;
  discrepancies?: Array<{
    id: string;
    procurementId: string;
  }>;
  refunds?: Array<{
    id: string;
    discrepancyId: string;
    procurementId: string;
    recordedByUserId: string;
    voucherFileId: string;
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
    id?: string;
    fileId: string;
    businessType: string;
    businessId: string;
    templateKey: string;
  }>;
  auditLogs?: Array<{
    id: string;
    action: string;
    businessType: string;
    businessId: string;
    metadata: unknown;
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
    spotProcurementPaymentInvoice: {
      findMany: jest.fn(({ where }: { where: { fileId: string } }) =>
        Promise.resolve(
          (fixture.paymentInvoices ?? []).filter(
            (row) => row.fileId === where.fileId
          )
        )
      )
    },
    spotProcurementReceipt: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          (() => {
            const row = fixture.receipts?.find((item) => item.id === where.id);
            return row ? { currentRevisionNo: 1, ...row } : null;
          })()
        )
      ),
      findMany: jest.fn(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            (fixture.receipts ?? [])
              .filter((row) => where.id.in.includes(row.id))
              .map((row) => ({ currentRevisionNo: 1, ...row }))
          )
      )
    },
    spotProcurementReceiptReview: {
      findMany: jest.fn(
        ({ where }: { where: { receiptId: string } }) =>
          Promise.resolve(
            (fixture.receiptReviews ?? [])
              .filter((row) => row.receiptId === where.receiptId)
              .sort((left, right) =>
                left.sequenceNo === right.sequenceNo
                  ? left.id.localeCompare(right.id)
                  : left.sequenceNo - right.sequenceNo
              )
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
    invoiceAllocation: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          fixture.invoiceAllocations?.find((row) => row.id === where.id) ?? null
        )
      )
    },
    invoiceRecord: {
      findMany: jest.fn(({ where }: { where: { fileId: string } }) =>
        Promise.resolve(
          (fixture.invoiceRecords ?? []).filter(
            (row) => row.fileId === where.fileId
          )
        )
      )
    },
    noInvoiceConfirmation: {
      findMany: jest.fn(({ where }: { where: { proofFileId: string } }) =>
        Promise.resolve(
          (fixture.noInvoiceConfirmations ?? []).filter(
            (row) => row.proofFileId === where.proofFileId
          )
        )
      )
    },
    invoiceExceptionConfirmation: {
      findMany: jest.fn(({ where }: { where: { proofFileId: string } }) =>
        Promise.resolve(
          (fixture.invoiceExceptionConfirmations ?? []).filter(
            (row) => row.proofFileId === where.proofFileId
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
            id?: { in: string[] };
            voucherFileId?: string;
            paymentId?: { in: string[] };
            voidedAt?: null;
          };
        }) =>
          Promise.resolve(
            (fixture.executions ?? []).filter((row) => {
              if (where.id && !where.id.in.includes(row.id ?? "")) return false;
              if (where.voucherFileId && row.voucherFileId !== where.voucherFileId) return false;
              if (where.paymentId && !where.paymentId.in.includes(row.paymentId)) return false;
              if (where.voidedAt === null && row.voidedAt !== null) return false;
              return true;
            })
          )
      )
    },
    spotProcurementPaymentExecutionVoucher: {
      findMany: jest.fn(({ where }: { where: { fileId: string } }) =>
        Promise.resolve(
          (fixture.executionVouchers ?? []).filter(
            (row) => row.fileId === where.fileId
          )
        )
      )
    },
    spotProcurementDiscrepancy: {
      findMany: jest.fn(
        ({ where }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            (fixture.discrepancies ?? []).filter((row) =>
              where.id.in.includes(row.id)
            )
          )
      )
    },
    spotProcurementRefund: {
      findMany: jest.fn(
        ({ where }: { where: { voucherFileId: string } }) =>
          Promise.resolve(
            (fixture.refunds ?? []).filter(
              (row) => row.voucherFileId === where.voucherFileId
            )
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
          where: {
            fileId?: string | { in: string[] };
            businessType?: string | { in: string[] };
            businessId?: string;
            templateKey?: string;
          };
        }) => {
          const fileIds = where.fileId
            ? typeof where.fileId === "string"
              ? [where.fileId]
              : where.fileId.in
            : null;
          return Promise.resolve(
            (fixture.pdfDocuments ?? []).filter(
              (row) =>
                (!fileIds || fileIds.includes(row.fileId)) &&
                (!where.businessType ||
                  (typeof where.businessType === "string"
                    ? row.businessType === where.businessType
                    : where.businessType.in.includes(row.businessType))) &&
                (!where.businessId || row.businessId === where.businessId) &&
                (!where.templateKey || row.templateKey === where.templateKey)
            ).map((row, index) => ({ ...row, id: row.id ?? `pdf-${index + 1}` }))
          );
        }
      )
    },
    auditLog: {
      findFirst: jest.fn(
        ({
          where
        }: {
          where: {
            action: string;
            businessType: string;
            businessId: string;
          };
        }) =>
          Promise.resolve(
            [...(fixture.auditLogs ?? [])]
              .reverse()
              .find(
                (row) =>
                  row.action === where.action &&
                  row.businessType === where.businessType &&
                  row.businessId === where.businessId
              ) ?? null
          )
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

function receiptPdfRefreshFacts(input: {
  receiptId?: string;
  status: string;
  currentRevisionNo?: number;
  reviewId?: string;
  pdfDocumentId?: string;
  fileId?: string;
  tokenOverrides?: Record<string, unknown>;
  auditOverrides?: Record<string, unknown>;
}): Pick<AccessFixture, "receiptReviews" | "auditLogs"> {
  const receiptId = input.receiptId ?? "receipt-1";
  const currentRevisionNo = input.currentRevisionNo ?? 1;
  const reviewId = input.reviewId ?? "review-1";
  const pdfDocumentId = input.pdfDocumentId ?? "receipt-pdf-document";
  const fileId = input.fileId ?? "receipt-pdf";
  return {
    receiptReviews: [
      {
        id: reviewId,
        receiptId,
        sequenceNo: 1,
        receiptRevisionNo: currentRevisionNo,
        decision: "approved"
      }
    ],
    auditLogs: [
      {
        id: "receipt-pdf-refresh-audit",
        action: "spot_procurement.receipt.pdf.refresh",
        businessType: "spot_procurement_receipt",
        businessId: receiptId,
        metadata: {
          pdfDocumentId,
          newFileId: fileId,
          templateKey: "spot_procurement_receipt_v1",
          sourceSnapshotToken: {
            receiptId,
            receiptStatus: input.status,
            currentRevisionNo,
            sourceRevisionNo: currentRevisionNo,
            reviewId,
            latestReviewId: reviewId,
            ...input.tokenOverrides
          },
          ...input.auditOverrides
        }
      }
    ]
  };
}

function invoiceEvidenceFixture(
  kind: "invoice" | "no_invoice" | "invoice_exception",
  projectRoleKeys: string[] = []
): AccessFixture {
  const fixture: AccessFixture = {
    procurements: [
      {
        id: "procurement-1",
        projectId: "project-1",
        applicantUserId: "applicant-1",
        handlerUserId: "handler-1"
      }
    ],
    projectRoleKeys
  };
  if (kind === "invoice") {
    fixture.invoiceRecords = [
      {
        id: "invoice-1",
        fileId: "invoice-evidence-file",
        projectId: "project-1",
        sourceBusinessType: "spot_procurement",
        sourceBusinessId: "procurement-1",
        sourceProcurementId: "procurement-1",
        uploadedByUserId: "evidence-submitter",
        invalidatedByUserId: null
      }
    ];
  } else if (kind === "no_invoice") {
    fixture.noInvoiceConfirmations = [
      {
        id: "no-invoice-1",
        proofFileId: "invoice-evidence-file",
        projectId: "project-1",
        procurementId: "procurement-1",
        submittedByUserId: "evidence-submitter",
        reviewedByUserId: "evidence-reviewer",
        reversedByUserId: null
      }
    ];
  } else {
    fixture.invoiceExceptionConfirmations = [
      {
        id: "invoice-exception-1",
        proofFileId: "invoice-evidence-file",
        projectId: "project-1",
        procurementId: "procurement-1",
        submittedByUserId: "evidence-submitter",
        reviewedByUserId: "evidence-reviewer",
        reversedByUserId: null
      }
    ];
  }
  return fixture;
}

describe("SpotProcurementAccessService", () => {
  it("returns not_spot only when no Spot business record binds the file", async () => {
    const service = new SpotProcurementAccessService(buildPrisma() as never);

    await expect(service.resolveFileDownloadAccess("ordinary-file", "user-1")).resolves.toBe(
      "not_spot"
    );
  });

  it.each([
    ["finance-recorder", "allowed"],
    ["applicant-1", "allowed"],
    ["handler-1", "allowed"],
    ["unrelated-user", "denied"]
  ] as const)(
    "applies procurement ACL and direct participation to a refund voucher for %s",
    async (actorUserId, expected) => {
      const fixture: AccessFixture = {
        procurements: [
          {
            id: "procurement-1",
            projectId: "project-1",
            applicantUserId: "applicant-1",
            handlerUserId: "handler-1"
          }
        ],
        discrepancies: [
          { id: "discrepancy-1", procurementId: "procurement-1" }
        ],
        refunds: [
          {
            id: "refund-1",
            discrepancyId: "discrepancy-1",
            procurementId: "procurement-1",
            recordedByUserId: "finance-recorder",
            voucherFileId: "refund-voucher"
          }
        ]
      };

      await expect(
        new SpotProcurementAccessService(buildPrisma(fixture) as never)
          .resolveFileDownloadAccess("refund-voucher", actorUserId)
      ).resolves.toBe(expected);
    }
  );

  it("fails closed when a refund does not belong to its discrepancy procurement", async () => {
    const fixture: AccessFixture = {
      discrepancies: [
        { id: "discrepancy-1", procurementId: "procurement-other" }
      ],
      refunds: [
        {
          id: "refund-1",
          discrepancyId: "discrepancy-1",
          procurementId: "procurement-1",
          recordedByUserId: "finance-recorder",
          voucherFileId: "refund-voucher"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma(fixture) as never)
        .resolveFileDownloadAccess("refund-voucher", "finance-recorder")
    ).resolves.toBe("denied");
  });

  it.each(["multiple_refunds", "payment_voucher"])(
    "fails closed when a refund voucher has %s bindings",
    async (mixedBinding) => {
      const fixture: AccessFixture = {
        discrepancies: [
          { id: "discrepancy-1", procurementId: "procurement-1" },
          { id: "discrepancy-2", procurementId: "procurement-1" }
        ],
        refunds: [
          {
            id: "refund-1",
            discrepancyId: "discrepancy-1",
            procurementId: "procurement-1",
            recordedByUserId: "finance-recorder",
            voucherFileId: "mixed-refund-voucher"
          }
        ]
      };
      if (mixedBinding === "multiple_refunds") {
        fixture.refunds!.push({
          id: "refund-2",
          discrepancyId: "discrepancy-2",
          procurementId: "procurement-1",
          recordedByUserId: "finance-recorder",
          voucherFileId: "mixed-refund-voucher"
        });
      } else {
        fixture.executions = [
          {
            paymentId: "payment-1",
            executedByUserId: "finance-recorder",
            voucherFileId: "mixed-refund-voucher",
            voidedAt: null
          }
        ];
      }

      await expect(
        new SpotProcurementAccessService(buildPrisma(fixture) as never)
          .resolveFileDownloadAccess(
            "mixed-refund-voucher",
            "finance-recorder"
          )
      ).resolves.toBe("denied");
    }
  );

  it("resolves real procurement, payment, receipt, and invoice-allocation resources and fails closed when missing", async () => {
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
      ],
      invoiceAllocations: [
        { id: "allocation-1", projectId: "project-1" }
      ]
    });
    const service = new SpotProcurementAccessService(prisma as never);

    await expect(service.requireProcurementProjectId("procurement-1")).resolves.toBe("project-1");
    await expect(service.requirePaymentProjectId("payment-1")).resolves.toBe("project-1");
    await expect(service.requireReceiptProjectId("receipt-1")).resolves.toBe("project-1");
    await expect(
      service.requireInvoiceAllocationProjectId("allocation-1")
    ).resolves.toBe("project-1");
    await expect(service.findPaymentProjectId("missing-payment")).resolves.toBeNull();
    await expect(service.requireProcurementProjectId("missing-procurement")).rejects.toBeInstanceOf(
      ForbiddenException
    );
    await expect(service.requireReceiptProjectId("missing-receipt")).rejects.toBeInstanceOf(
      ForbiddenException
    );
    await expect(
      service.requireInvoiceAllocationProjectId("missing-allocation")
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ["invoice", "evidence-submitter"],
    ["no_invoice", "evidence-reviewer"],
    ["invoice_exception", "evidence-submitter"]
  ] as const)(
    "allows a direct participant to download %s evidence",
    async (kind, actorUserId) => {
      await expect(
        new SpotProcurementAccessService(
          buildPrisma(invoiceEvidenceFixture(kind)) as never
        ).resolveFileDownloadAccess("invoice-evidence-file", actorUserId)
      ).resolves.toBe("allowed");
    }
  );

  it("allows same-project material and finance invoice roles", async () => {
    for (const roleKey of [
      "material_staff",
      "material_director",
      "finance_staff",
      "finance_director"
    ]) {
      await expect(
        new SpotProcurementAccessService(
          buildPrisma(invoiceEvidenceFixture("invoice", [roleKey])) as never
        ).resolveFileDownloadAccess("invoice-evidence-file", `${roleKey}-1`)
      ).resolves.toBe("allowed");
    }
  });

  it("allows a procurement participant and denies an unrelated user", async () => {
    const fixture = invoiceEvidenceFixture("no_invoice");
    const service = new SpotProcurementAccessService(
      buildPrisma(fixture) as never
    );

    await expect(
      service.resolveFileDownloadAccess("invoice-evidence-file", "applicant-1")
    ).resolves.toBe("allowed");
    await expect(
      service.resolveFileDownloadAccess("invoice-evidence-file", "unrelated-user")
    ).resolves.toBe("denied");
  });

  it.each(["other_spot_binding", "multiple_evidence", "coordinate_mismatch"])(
    "fails closed for invoice evidence with %s",
    async (conflict) => {
      const fixture = invoiceEvidenceFixture("invoice");
      if (conflict === "other_spot_binding") {
        fixture.attachments = [
          { fileId: "invoice-evidence-file", versionId: "version-1" }
        ];
      } else if (conflict === "multiple_evidence") {
        fixture.noInvoiceConfirmations = [
          {
            id: "no-invoice-1",
            proofFileId: "invoice-evidence-file",
            projectId: "project-1",
            procurementId: "procurement-1",
            submittedByUserId: "evidence-submitter"
          }
        ];
      } else {
        fixture.invoiceRecords![0].sourceBusinessId = "procurement-other";
      }

      await expect(
        new SpotProcurementAccessService(buildPrisma(fixture) as never)
          .resolveFileDownloadAccess(
            "invoice-evidence-file",
            "evidence-submitter"
          )
      ).resolves.toBe("denied");
    }
  );

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
      "payment invoice attachment",
      {
        paymentInvoices: [
          {
            paymentId: "payment-1",
            fileId: "file-1",
            uploadedByUserId: "handler-1"
          }
        ]
      },
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
    ],
    [
      "multi-voucher execution evidence",
      {
        executions: [
          {
            id: "execution-1",
            paymentId: "payment-1",
            executedByUserId: "finance-executor",
            voucherFileId: "legacy-voucher",
            voidedAt: null
          }
        ],
        executionVouchers: [
          { paymentExecutionId: "execution-1", fileId: "file-1" }
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

  it.each(["reviewed", "locked"])(
    "allows a %s receipt PDF business download through the receipt ACL",
    async (status) => {
      const service = new SpotProcurementAccessService(buildPrisma({
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
            handlerUserId: "handler-1",
            status,
            currentRevisionNo: 1
          }
        ],
        pdfDocuments: [
          {
            id: "receipt-pdf-document",
            fileId: "receipt-pdf",
            businessType: "spot_procurement_receipt",
            businessId: "receipt-1",
            templateKey: "spot_procurement_receipt_v1"
          }
        ],
        ...receiptPdfRefreshFacts({ status })
      }) as never);

      await expect(
        service.resolveBusinessDownloadAccess(
          "spot_procurement_receipt",
          "receipt-1",
          "applicant-1"
        )
      ).resolves.toBe("allowed");
    }
  );

  it("keeps the last reviewed PDF formal after automatic closure locks the receipt", async () => {
    const service = new SpotProcurementAccessService(buildPrisma({
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
          handlerUserId: "handler-1",
          status: "locked",
          currentRevisionNo: 1
        }
      ],
      pdfDocuments: [
        {
          id: "receipt-pdf-document",
          fileId: "receipt-pdf",
          businessType: "spot_procurement_receipt",
          businessId: "receipt-1",
          templateKey: "spot_procurement_receipt_v1"
        }
      ],
      ...receiptPdfRefreshFacts({
        status: "reviewed"
      })
    }) as never);

    await expect(
      service.resolveBusinessDownloadAccess(
        "spot_procurement_receipt",
        "receipt-1",
        "applicant-1"
      )
    ).resolves.toBe("allowed");
  });

  it.each(["submitted", "returned", "review_revoked"])(
    "denies a %s receipt PDF business download even to the applicant",
    async (status) => {
      const service = new SpotProcurementAccessService(buildPrisma({
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
            handlerUserId: "handler-1",
            status,
            currentRevisionNo: 1
          }
        ],
        pdfDocuments: [
          {
            id: "receipt-pdf-document",
            fileId: "receipt-pdf",
            businessType: "spot_procurement_receipt",
            businessId: "receipt-1",
            templateKey: "spot_procurement_receipt_v1"
          }
        ],
        ...receiptPdfRefreshFacts({ status })
      }) as never);

      await expect(
        service.resolveBusinessDownloadAccess(
          "spot_procurement_receipt",
          "receipt-1",
          "applicant-1"
        )
      ).resolves.toBe("denied");
    }
  );

  it.each(["file-current", "file-ancestor"])(
    "keeps a reviewed receipt PDF at %s inside the current receipt ACL",
    async (fileId) => {
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
            handlerUserId: "handler-1",
            status: "reviewed",
            currentRevisionNo: 1
          }
        ],
        fileObjects: [
          { id: "file-current", supersedesFileObjectId: "file-ancestor" }
        ],
        pdfDocuments: [
          {
            id: "receipt-pdf-document",
            fileId: "file-current",
            businessType: "spot_procurement_receipt",
            businessId: "receipt-1",
            templateKey: "spot_procurement_receipt_v1"
          }
        ],
        ...receiptPdfRefreshFacts({ status: "reviewed", fileId: "file-current" })
      };

      await expect(
        new SpotProcurementAccessService(buildPrisma(base) as never)
          .resolveFileDownloadAccess(fileId, "applicant-1")
      ).resolves.toBe("allowed");
      await expect(
        new SpotProcurementAccessService(buildPrisma(base) as never)
          .resolveFileDownloadAccess(fileId, "unrelated-user")
      ).resolves.toBe("denied");
    }
  );

  it.each(["submitted", "returned", "review_revoked"])(
    "denies a %s receipt PDF file even to the applicant",
    async (status) => {
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
            handlerUserId: "handler-1",
            status,
            currentRevisionNo: 1
          }
        ],
        pdfDocuments: [
          {
            id: "receipt-pdf-document",
            fileId: "receipt-pdf",
            businessType: "spot_procurement_receipt",
            businessId: "receipt-1",
            templateKey: "spot_procurement_receipt_v1"
          }
        ],
        ...receiptPdfRefreshFacts({ status })
      };

      await expect(
        new SpotProcurementAccessService(buildPrisma(fixture) as never)
          .resolveFileDownloadAccess("receipt-pdf", "applicant-1")
      ).resolves.toBe("denied");
    }
  );

  it.each([
    ["stale receipt status", { tokenOverrides: { receiptStatus: "submitted" } }],
    ["stale revision", { tokenOverrides: { currentRevisionNo: 1 } }],
    ["stale latest review", { tokenOverrides: { latestReviewId: "review-1" } }],
    ["stale file pointer", { auditOverrides: { newFileId: "previous-file" } }]
  ] as const)(
    "denies a reviewed receipt PDF backed by a %s refresh audit",
    async (_caseName, refreshOverrides) => {
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
            handlerUserId: "handler-1",
            status: "reviewed",
            currentRevisionNo: 2
          }
        ],
        pdfDocuments: [
          {
            id: "receipt-pdf-document",
            fileId: "receipt-pdf",
            businessType: "spot_procurement_receipt",
            businessId: "receipt-1",
            templateKey: "spot_procurement_receipt_v1"
          }
        ],
        ...receiptPdfRefreshFacts({
          status: "reviewed",
          currentRevisionNo: 2,
          reviewId: "review-2",
          ...refreshOverrides
        })
      };

      await expect(
        new SpotProcurementAccessService(buildPrisma(fixture) as never)
          .resolveFileDownloadAccess("receipt-pdf", "applicant-1")
      ).resolves.toBe("denied");
    }
  );

  it.each([
    ["returned", 2],
    ["revoked", 2],
    ["approved", 1]
  ] as const)(
    "denies a reviewed receipt PDF when the latest review is %s on revision %s",
    async (decision, receiptRevisionNo) => {
      const refreshFacts = receiptPdfRefreshFacts({
        status: "reviewed",
        currentRevisionNo: 2,
        reviewId: "review-2"
      });
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
            handlerUserId: "handler-1",
            status: "reviewed",
            currentRevisionNo: 2
          }
        ],
        pdfDocuments: [
          {
            id: "receipt-pdf-document",
            fileId: "receipt-pdf",
            businessType: "spot_procurement_receipt",
            businessId: "receipt-1",
            templateKey: "spot_procurement_receipt_v1"
          }
        ],
        ...refreshFacts,
        receiptReviews: [
          {
            id: "review-2",
            receiptId: "receipt-1",
            sequenceNo: 2,
            receiptRevisionNo,
            decision
          }
        ]
      };

      await expect(
        new SpotProcurementAccessService(buildPrisma(fixture) as never)
          .resolveFileDownloadAccess(
            "receipt-pdf",
            "applicant-1"
          )
      ).resolves.toBe("denied");
    }
  );

  it("denies a reviewed receipt PDF without a successful refresh audit", async () => {
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
          handlerUserId: "handler-1",
          status: "reviewed",
          currentRevisionNo: 1
        }
      ],
      receiptReviews: [{ id: "review-1", receiptId: "receipt-1", sequenceNo: 1 }],
      pdfDocuments: [
        {
          id: "receipt-pdf-document",
          fileId: "receipt-pdf",
          businessType: "spot_procurement_receipt",
          businessId: "receipt-1",
          templateKey: "spot_procurement_receipt_v1"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma(fixture) as never)
        .resolveFileDownloadAccess("receipt-pdf", "applicant-1")
    ).resolves.toBe("denied");
  });

  it("fails closed when a receipt PdfDocument uses the wrong template", async () => {
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
          handlerUserId: "handler-1",
          status: "reviewed"
        }
      ],
      pdfDocuments: [
        {
          fileId: "receipt-pdf",
          businessType: "spot_procurement_receipt",
          businessId: "receipt-1",
          templateKey: "approval_form"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma(fixture) as never)
        .resolveFileDownloadAccess("receipt-pdf", "applicant-1")
    ).resolves.toBe("denied");
  });

  it.each(["application", "payment", "second_receipt", "receipt_photo"])(
    "fails closed when one receipt PDF file is also bound to %s",
    async (mixedBinding) => {
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
        versions: [
          {
            id: "version-1",
            procurementId: "procurement-1",
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
            projectId: "project-1",
            procurementId: "procurement-1",
            handlerUserId: "handler-1",
            status: "reviewed"
          },
          {
            id: "receipt-2",
            projectId: "project-1",
            procurementId: "procurement-2",
            handlerUserId: "handler-2",
            status: "reviewed"
          }
        ],
        pdfDocuments: [
          {
            fileId: "mixed-file",
            businessType: "spot_procurement_receipt",
            businessId: "receipt-1",
            templateKey: "spot_procurement_receipt_v1"
          }
        ],
        approvals: []
      };
      if (mixedBinding === "application") {
        fixture.pdfDocuments!.push({
          fileId: "mixed-file",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          templateKey: "approval_form"
        });
        fixture.approvals!.push({
          id: "approval-1",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          status: "approved",
          currentNodeIndex: 0,
          frozenNodes: [],
          applicantUserId: "applicant-1"
        });
      } else if (mixedBinding === "payment") {
        fixture.pdfDocuments!.push({
          fileId: "mixed-file",
          businessType: "spot_procurement_payment",
          businessId: "payment-1",
          templateKey: "approval_form"
        });
        fixture.approvals!.push({
          id: "approval-1",
          businessType: "spot_procurement_payment",
          businessId: "payment-1",
          status: "approved",
          currentNodeIndex: 0,
          frozenNodes: [],
          applicantUserId: "applicant-1"
        });
      } else if (mixedBinding === "second_receipt") {
        fixture.pdfDocuments!.push({
          fileId: "mixed-file",
          businessType: "spot_procurement_receipt",
          businessId: "receipt-2",
          templateKey: "spot_procurement_receipt_v1"
        });
      } else {
        fixture.receiptPhotos = [
          {
            receiptId: "receipt-1",
            originalFileId: "mixed-file",
            watermarkedFileId: "watermarked-file"
          }
        ];
      }

      await expect(
        new SpotProcurementAccessService(buildPrisma(fixture) as never)
          .resolveFileDownloadAccess("mixed-file", "applicant-1")
      ).resolves.toBe("denied");
    }
  );

  it("fails closed when one approval PDF file is bound to both application and payment", async () => {
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
      payments: [
        {
          id: "payment-1",
          procurementId: "procurement-1",
          projectId: "project-1",
          handlerUserId: "handler-1"
        }
      ],
      pdfDocuments: [
        {
          fileId: "mixed-file",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          templateKey: "approval_form"
        },
        {
          fileId: "mixed-file",
          businessType: "spot_procurement_payment",
          businessId: "payment-1",
          templateKey: "approval_form"
        }
      ],
      approvals: [
        {
          id: "approval-1",
          businessType: "spot_procurement_version",
          businessId: "version-1",
          status: "approved",
          currentNodeIndex: 0,
          frozenNodes: [],
          applicantUserId: "applicant-1"
        },
        {
          id: "approval-2",
          businessType: "spot_procurement_payment",
          businessId: "payment-1",
          status: "approved",
          currentNodeIndex: 0,
          frozenNodes: [],
          applicantUserId: "applicant-1"
        }
      ]
    };

    await expect(
      new SpotProcurementAccessService(buildPrisma(fixture) as never)
        .resolveFileDownloadAccess("mixed-file", "applicant-1")
    ).resolves.toBe("denied");
  });
});
