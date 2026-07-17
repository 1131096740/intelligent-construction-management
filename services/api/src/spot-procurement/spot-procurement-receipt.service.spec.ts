import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { AttachReceiptPhotoDto } from "./dto/attach-receipt-photo.dto";
import { ReviewReceiptDto } from "./dto/review-receipt.dto";
import { RevokeReceiptReviewDto } from "./dto/revoke-receipt-review.dto";
import { UpdateReceiptDraftDto } from "./dto/update-receipt-draft.dto";
import {
  SpotProcurementReceiptService,
  calculateReceiptActualCostCents,
  hasStrictImageContainerEnd,
  parseReceiptQuantity
} from "./spot-procurement-receipt.service";

describe("SpotProcurementReceiptService domain rules", () => {
  it("accepts canonical nonnegative receipt quantities including zero", () => {
    expect(parseReceiptQuantity("0").toString()).toBe("0");
    expect(parseReceiptQuantity("12.345600").toString()).toBe(
      "12.3456"
    );
    expect(() => parseReceiptQuantity("-1")).toThrow(
      "收货数量格式不正确"
    );
    expect(() => parseReceiptQuantity("01")).toThrow(
      "收货数量格式不正确"
    );
  });

  it("calculates actual cost from qualified quantity only with half-up rounding", () => {
    expect(
      calculateReceiptActualCostCents(
        new Prisma.Decimal("2"),
        new Prisma.Decimal("3.335")
      )
    ).toBe(667n);
    expect(
      calculateReceiptActualCostCents(
        new Prisma.Decimal("0"),
        new Prisma.Decimal("999")
      )
    ).toBe(0n);
    expect(
      calculateReceiptActualCostCents(
        new Prisma.Decimal("1"),
        new Prisma.Decimal("12345678901234567.894999")
      )
    ).toBe(1234567890123456789n);
  });

  it("requires JPEG EOI or PNG IEND to be the actual container tail", () => {
    expect(
      hasStrictImageContainerEnd(
        Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]),
        "image/jpeg"
      )
    ).toBe(true);
    expect(
      hasStrictImageContainerEnd(
        Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00]),
        "image/jpeg"
      )
    ).toBe(false);

    const pngTail = Buffer.from(
      "0000000049454e44ae426082",
      "hex"
    );
    expect(
      hasStrictImageContainerEnd(
        Buffer.concat([
          Buffer.from("89504e470d0a1a0a", "hex"),
          pngTail
        ]),
        "image/png"
      )
    ).toBe(true);
    expect(
      hasStrictImageContainerEnd(
        Buffer.concat([
          Buffer.from("89504e470d0a1a0a", "hex"),
          pngTail,
          Buffer.from([0x00])
        ]),
        "image/png"
      )
    ).toBe(false);
  });

  it("rejects location and client-provided watermark fields from the photo API", async () => {
    const pipe = createApiValidationPipe();

    await expect(
      pipe.transform(
        {
          originalFileId: "file-1",
          source: "album",
          category: "material_scene",
          latitude: 30.1,
          watermarkedFileId: "forged-file"
        },
        {
          type: "body",
          metatype: AttachReceiptPhotoDto,
          data: ""
        }
      )
    ).rejects.toMatchObject({
      response: {
        errors: expect.arrayContaining([
          "latitude 不是允许提交的字段",
          "watermarkedFileId 不是允许提交的字段"
        ])
      }
    });
  });

  it("accepts an explicit null receipt note while keeping line validation strict", async () => {
    const pipe = createApiValidationPipe();

    await expect(
      pipe.transform(
        {
          note: null,
          lines: [
            {
              procurementLineId: "line-1",
              qualifiedQuantity: "0",
              unqualifiedQuantity: "0",
              freeGiftQuantity: "0",
              replenishmentPending: false
            }
          ]
        },
        {
          type: "body",
          metatype: UpdateReceiptDraftDto,
          data: ""
        }
      )
    ).resolves.toBeInstanceOf(UpdateReceiptDraftDto);
  });

  it("keeps receipt review DTOs limited to conclusions and explicit revocation confirmation", async () => {
    const pipe = createApiValidationPipe();

    await expect(
      pipe.transform(
        {
          decision: "approved",
          qualifiedQuantity: "999"
        },
        {
          type: "body",
          metatype: ReviewReceiptDto,
          data: ""
        }
      )
    ).rejects.toMatchObject({
      response: {
        errors: expect.arrayContaining([
          "qualifiedQuantity 不是允许提交的字段"
        ])
      }
    });

    await expect(
      pipe.transform(
        {
          targetReviewId: "review-approved",
          reason: "数量需要重新核对",
          confirmReviewRevocation: false
        },
        {
          type: "body",
          metatype: RevokeReceiptReviewDto,
          data: ""
        }
      )
    ).rejects.toMatchObject({
      response: {
        errors: expect.arrayContaining([
          "请明确确认撤销本次收货复核"
        ])
      }
    });
  });
});

describe("SpotProcurementReceiptService workflow", () => {
  const originalBuffer = Buffer.from([
    0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9
  ]);
  const originalSha =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const watermarkedSha =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  function createHarness(options?: {
    receiptStatus?: string;
    revisionSubmittedAt?: Date | null;
    activeDelegation?: boolean;
    delegateInProject?: boolean;
    photos?: Array<Record<string, unknown>>;
    receiptLines?: Array<Record<string, unknown>>;
    occupiedPhoto?: boolean;
    versionHandlerUserId?: string;
    nonReceiptBusinessBinding?: boolean;
    materialDirector?: boolean;
    latestReview?: Record<string, unknown> | null;
    firstSubmittedAt?: Date | null;
    lockedAt?: Date | null;
    activeDiscrepancy?: boolean;
    activeTicketFact?:
      | "allocation"
      | "no_invoice"
      | "exception";
  }) {
    const receiptStatus = options?.receiptStatus ?? "draft";
    const revisionSubmittedAt =
      options?.revisionSubmittedAt ?? null;
    const procurement = {
      id: "procurement-1",
      projectId: "project-1",
      code: "LXCG-2026-0001",
      applicantUserId: "applicant-1",
      handlerUserId: "handler-1",
      currentVersionId: "version-1",
      status: "approved_in_progress",
      actualCostCents: revisionSubmittedAt ? 1667n : null
    };
    const version = {
      id: "version-1",
      procurementId: "procurement-1",
      versionNo: 1,
      status: "approved",
      handlerUserId:
        options?.versionHandlerUserId ?? "handler-1",
      totalAmountCents: 2_000n
    };
    const receipt = {
      id: "receipt-1",
      projectId: "project-1",
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      status: receiptStatus,
      currentRevisionNo: 1,
      handlerUserId: "handler-1",
      note: null,
      actualCostCents: revisionSubmittedAt ? 1667n : 0n,
      firstSubmittedAt:
        options?.firstSubmittedAt ?? revisionSubmittedAt,
      submittedAt: revisionSubmittedAt,
      submittedByUserId: revisionSubmittedAt
        ? "handler-1"
        : null,
      submissionDelegationId: null,
      lockedAt: options?.lockedAt ?? null
    };
    const revision = {
      id: "revision-1",
      receiptId: "receipt-1",
      revisionNo: 1,
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      handlerUserId: "handler-1",
      note: null,
      actualCostCents: revisionSubmittedAt ? 1667n : 0n,
      submittedAt: revisionSubmittedAt,
      submittedByUserId: revisionSubmittedAt
        ? "handler-1"
        : null,
      submissionDelegationId: null
    };
    const delegation = options?.activeDelegation
      ? {
          id: "delegation-1",
          receiptId: "receipt-1",
          delegatorUserId: "handler-1",
          delegateUserId: "delegate-1",
          scope: "receipt_confirmation",
          delegatedAt: new Date("2026-07-17T00:00:00.000Z"),
          revokedAt: null
        }
      : null;
    const procurementLines = [
      {
        id: "line-1",
        versionId: "version-1",
        sortOrder: 1,
        materialName: "免烧砖",
        specification: null,
        unit: "块",
        quantity: new Prisma.Decimal("10"),
        unitPrice: new Prisma.Decimal("3.335")
      },
      {
        id: "line-2",
        versionId: "version-1",
        sortOrder: 2,
        materialName: "水泥",
        specification: "P.O 42.5",
        unit: "袋",
        quantity: new Prisma.Decimal("5"),
        unitPrice: new Prisma.Decimal("10")
      }
    ];
    const defaultReceiptLines = [
      {
        id: "receipt-line-1",
        receiptId: "receipt-1",
        receiptRevisionNo: 1,
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        procurementLineId: "line-1",
        approvedQuantitySnapshot: new Prisma.Decimal("10"),
        qualifiedQuantity: new Prisma.Decimal("2"),
        unqualifiedQuantity: new Prisma.Decimal("1"),
        unqualifiedReason: "破损",
        freeGiftQuantity: new Prisma.Decimal("100"),
        replenishmentPending: false,
        discrepancyNote: null,
        actualCostCents: 0n
      },
      {
        id: "receipt-line-2",
        receiptId: "receipt-1",
        receiptRevisionNo: 1,
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        procurementLineId: "line-2",
        approvedQuantitySnapshot: new Prisma.Decimal("5"),
        qualifiedQuantity: new Prisma.Decimal("1"),
        unqualifiedQuantity: new Prisma.Decimal("0"),
        unqualifiedReason: null,
        freeGiftQuantity: new Prisma.Decimal("0"),
        replenishmentPending: false,
        discrepancyNote: null,
        actualCostCents: 0n
      }
    ];
    const materialPhoto = {
      id: "photo-1",
      receiptId: "receipt-1",
      receiptRevisionNo: 1,
      originalFileId: "original-1",
      watermarkedFileId: "watermarked-1",
      originalSha256: originalSha,
      watermarkedSha256: watermarkedSha,
      source: "album",
      category: "material_scene",
      serverRecordedAt: new Date("2026-07-17T08:00:00.000Z"),
      note: "免烧砖",
      uploadedByUserId: "handler-1",
      lockedAtFirstSubmission: false,
      lockedAt: null,
      appendReason: null
    };
    const photos =
      options?.photos ??
      ([materialPhoto] as Array<Record<string, unknown>>);
    const receiptLines =
      options?.receiptLines ??
      (defaultReceiptLines as Array<Record<string, unknown>>);
    const fileRows = [
      {
        id: "original-1",
        mimeType: "image/jpeg",
        sizeBytes: originalBuffer.length,
        uploadedByUserId: "handler-1",
        contentSha256: originalSha,
        storageStatus: "active"
      },
      {
        id: "receipt-original-1",
        mimeType: "image/jpeg",
        sizeBytes: originalBuffer.length,
        uploadedByUserId: "handler-1",
        contentSha256: originalSha,
        storageStatus: "active"
      },
      {
        id: "watermarked-1",
        mimeType: "image/jpeg",
        sizeBytes: 12,
        uploadedByUserId: "handler-1",
        contentSha256: watermarkedSha,
        storageStatus: "active"
      }
    ];

    const sqlRows = (query: unknown) => {
      const text = (
        query as { strings?: readonly string[] }
      ).strings?.join("?") ?? String(query);
      if (text.includes("pg_advisory_xact_lock")) {
        return [{ pg_advisory_xact_lock: null }];
      }
      if (
        text.includes("receipt_non_receipt_file_binding")
      ) {
        return options?.nonReceiptBusinessBinding
          ? [{ fileId: "original-1" }]
          : [];
      }
      if (text.includes('FROM "SpotProcurementVersion"')) {
        return [version];
      }
      if (
        text.includes('FROM "SpotProcurementReceiptRevision"')
      ) {
        return [revision];
      }
      if (
        text.includes('FROM "SpotProcurementReceiptReview"')
      ) {
        return options?.latestReview
          ? [options.latestReview]
          : [];
      }
      if (
        text.includes('FROM "SpotProcurementReceiptDelegation"')
      ) {
        return delegation ? [delegation] : [];
      }
      if (text.includes('FROM "SpotProcurementReceiptLine"')) {
        return receiptLines;
      }
      if (text.includes('FROM "SpotProcurementReceiptPhoto"')) {
        return photos;
      }
      if (text.includes('FROM "SpotProcurementReceipt"')) {
        return [receipt];
      }
      if (text.includes('FROM "SpotProcurementLine"')) {
        return procurementLines;
      }
      if (text.includes('FROM "FileObject"')) {
        const values = (
          query as { values?: readonly unknown[] }
        ).values ?? [];
        const requestedIds = new Set(
          values.filter(
            (value): value is string => typeof value === "string"
          )
        );
        return requestedIds.size
          ? fileRows.filter((file) => requestedIds.has(file.id))
          : fileRows;
      }
      if (text.includes('FROM "SpotProcurement"')) {
        return [procurement];
      }
      throw new Error(`unexpected SQL in test: ${text}`);
    };

    const tx = {
      $queryRaw: jest.fn().mockImplementation(sqlRows),
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "audit-1" })
      },
      pdfDocument: {
        findMany: jest.fn().mockResolvedValue([])
      },
      user: {
        findUnique: jest.fn().mockImplementation(
          ({ where }: { where: { id: string } }) =>
            Promise.resolve({
              id: where.id,
              name:
                where.id === "delegate-1" ? "李四" : "张三",
              isActive: true
            })
        ),
        findMany: jest.fn().mockResolvedValue([
          { id: "handler-1", name: "张三" },
          { id: "delegate-1", name: "李四" }
        ])
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          code: "P-001",
          name: "示范项目",
          isActive: true
        })
      },
      userPosition: {
        findFirst: jest.fn().mockResolvedValue(
          options?.delegateInProject === false
            ? null
            : { id: "assignment-1" }
        ),
        findMany: jest.fn().mockImplementation(
          ({ where }: { where: { projectId: string | null } }) =>
            Promise.resolve(
              options?.materialDirector
                ? [
                    {
                      positionId:
                        where.projectId === null
                          ? "position-material-global"
                          : "position-material-project"
                    }
                  ]
                : []
            )
        )
      },
      projectMember: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      projectRosterMember: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      spotProcurementReceiptDelegation: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "delegation-created",
            ...data
          })
        ),
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue(delegation)
      },
      spotProcurementReceiptLine: {
        findMany: jest.fn().mockResolvedValue(receiptLines),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        update: jest.fn().mockResolvedValue({})
      },
      spotProcurementReceiptRevision: {
        findUnique: jest.fn().mockResolvedValue(revision),
        findMany: jest
          .fn()
          .mockResolvedValue([{ revisionNo: 1 }]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({})
      },
      spotProcurementReceiptReview: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            options?.latestReview
              ? [options.latestReview]
              : []
          ),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: `review-${data.decision}`,
            ...data,
            createdAt: new Date(
              "2026-07-17T09:00:00.000Z"
            )
          })
        )
      },
      spotProcurementDiscrepancy: {
        findFirst: jest.fn().mockResolvedValue(
          options?.activeDiscrepancy
            ? { id: "discrepancy-1" }
            : null
        )
      },
      invoiceAllocation: {
        findFirst: jest.fn().mockResolvedValue(
          options?.activeTicketFact === "allocation"
            ? { id: "allocation-1" }
            : null
        )
      },
      noInvoiceConfirmation: {
        findFirst: jest.fn().mockResolvedValue(
          options?.activeTicketFact === "no_invoice"
            ? { id: "no-invoice-1" }
            : null
        )
      },
      invoiceExceptionConfirmation: {
        findFirst: jest.fn().mockResolvedValue(
          options?.activeTicketFact === "exception"
            ? { id: "exception-1" }
            : null
        )
      },
      position: {
        findMany: jest.fn().mockImplementation(
          ({
            where
          }: {
            where: { id: { in: string[] } };
          }) =>
            Promise.resolve(
              where.id.in.map((id) => ({
                id,
                key: "material_director"
              }))
            )
        )
      },
      spotProcurementReceipt: {
        findUnique: jest.fn().mockResolvedValue(receipt),
        update: jest.fn().mockResolvedValue({})
      },
      spotProcurement: {
        findUnique: jest.fn().mockResolvedValue(procurement),
        update: jest.fn().mockResolvedValue({})
      },
      spotProcurementVersion: {
        findUnique: jest.fn().mockResolvedValue(version)
      },
      spotProcurementLine: {
        findMany: jest.fn().mockResolvedValue(procurementLines)
      },
      spotProcurementReceiptPhoto: {
        findMany: jest.fn().mockResolvedValue(photos),
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options?.occupiedPhoto ? { id: "occupied" } : null
          ),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "photo-created",
            ...data,
            createdAt: new Date(),
            updatedAt: new Date()
          })
        ),
        delete: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: photos.length })
      },
      fileObject: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 })
      }
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation(
          (operation: (client: typeof tx) => unknown) =>
            operation(tx)
        )
    };
    const pilot = { assertEnabled: jest.fn() };
    const files = {
      getOwnedVerifiedFileBuffer: jest.fn().mockResolvedValue({
        file: {
          id: "original-1",
          mimeType: "image/jpeg",
          sizeBytes: originalBuffer.length,
          uploadedByUserId: "handler-1",
          contentSha256: originalSha,
          storageStatus: "active"
        },
        buffer: originalBuffer
      }),
      uploadPrivateFile: jest
        .fn()
        .mockImplementation(
          ({ originalName }: { originalName: string }) =>
            Promise.resolve({
              id: originalName.includes("专用原图")
                ? "receipt-original-1"
                : "watermarked-1"
            })
        ),
      quarantineUnboundReceiptWatermark: jest
        .fn()
        .mockResolvedValue(true)
    };
    const watermark = {
      generate: jest.fn().mockResolvedValue({
        buffer: Buffer.alloc(12, 1),
        mimeType: "image/jpeg",
        originalSha256: originalSha,
        watermarkedSha256: watermarkedSha,
        width: 360,
        height: 400
      })
    };
    const access = {
      resolveReceiptViewAccess: jest
        .fn()
        .mockResolvedValue("allowed")
    };
    const receiptPdfs = {
      tryRefreshLatest: jest.fn().mockResolvedValue(undefined),
      refreshLatest: jest.fn().mockResolvedValue({
        id: "receipt-pdf-1",
        fileId: "receipt-pdf-file-1",
        templateKey: "spot_procurement_receipt_v1"
      })
    };
    const closure = {
      recalculateAndClose: jest.fn().mockResolvedValue({ closed: false })
    };
    const service = new SpotProcurementReceiptService(
      prisma as never,
      new AuditService(),
      pilot as never,
      files as never,
      watermark as never,
      access as never,
      receiptPdfs as never,
      closure as never
    );

    return {
      service,
      tx,
      prisma,
      access,
      files,
      watermark,
      receiptPdfs,
      procurementLines,
      receipt,
      revision
    };
  }

  const completeDraft = {
    note: "一次性到货",
    lines: [
      {
        procurementLineId: "line-1",
        qualifiedQuantity: "2",
        unqualifiedQuantity: "1",
        unqualifiedReason: "破损",
        freeGiftQuantity: "100",
        replenishmentPending: false,
        discrepancyNote: "现场清点"
      },
      {
        procurementLineId: "line-2",
        qualifiedQuantity: "1",
        unqualifiedQuantity: "0",
        freeGiftQuantity: "0",
        replenishmentPending: false
      }
    ]
  };

  const lockedMaterialPhoto = {
    id: "photo-1",
    receiptId: "receipt-1",
    receiptRevisionNo: 1,
    originalFileId: "original-1",
    watermarkedFileId: "watermarked-1",
    originalSha256: originalSha,
    watermarkedSha256: watermarkedSha,
    source: "album",
    category: "material_scene",
    serverRecordedAt: new Date(
      "2026-07-17T08:00:00.000Z"
    ),
    note: "免烧砖",
    uploadedByUserId: "handler-1",
    lockedAtFirstSubmission: true,
    lockedAt: new Date("2026-07-17T08:30:00.000Z"),
    appendReason: null
  };

  it("reads receipt authorization and detail from one repeatable-read snapshot", async () => {
    const harness = createHarness({
      activeDelegation: true
    });

    const detail = await harness.service.getReceipt(
      "procurement-1",
      "delegate-1"
    );
    expect(detail).toMatchObject({
      receipt: {
        id: "receipt-1",
        handler: { id: "handler-1", name: "张三" }
      },
      delegation: {
        id: "delegation-1",
        delegateUserId: "delegate-1",
        delegateName: "李四"
      }
    });
    expect(detail.photos[0]).not.toHaveProperty(
      "originalFileId"
    );
    expect(harness.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.RepeatableRead
      }
    );
    expect(
      harness.access.resolveReceiptViewAccess
    ).toHaveBeenCalledWith(
      "receipt-1",
      "delegate-1",
      harness.tx
    );
    expect(
      harness.tx.spotProcurementReceipt.findUnique
    ).toHaveBeenCalled();
    expect(harness.tx.user.findMany).toHaveBeenCalled();
  });

  it("exposes only the current formally reviewed PDF pointer in the receipt snapshot", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const approvedReview = {
      id: "review-approved",
      receiptId: "receipt-1",
      receiptRevisionNo: 1,
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      sequenceNo: 1,
      decision: "approved",
      comment: "数量和照片一致",
      reviewedByUserId: "material-director-1",
      reviewedByNameSnapshot: "复核时姓名",
      submissionDelegationId: null,
      targetReviewId: null,
      createdAt: new Date("2026-07-17T09:00:00.000Z")
    };
    const buildHarness = (receiptStatus: string) => {
      const harness = createHarness({
        receiptStatus: "reviewed",
        revisionSubmittedAt: submittedAt,
        latestReview: approvedReview
      });
      harness.tx.pdfDocument.findMany.mockResolvedValue([
        {
          id: "receipt-pdf-document",
          fileId: "receipt-pdf-file",
          templateKey: "spot_procurement_receipt_v1",
          createdAt: new Date(
            "2026-07-17T09:05:00.000Z"
          )
        }
      ]);
      harness.tx.auditLog.findFirst.mockResolvedValue({
        metadata: {
          pdfDocumentId: "receipt-pdf-document",
          newFileId: "receipt-pdf-file",
          templateKey: "spot_procurement_receipt_v1",
          sourceSnapshotToken: {
            receiptId: "receipt-1",
            receiptStatus,
            currentRevisionNo: 1,
            sourceRevisionNo: 1,
            reviewId: "review-approved",
            latestReviewId: "review-approved"
          }
        }
      });
      return harness;
    };

    await expect(
      buildHarness("reviewed").service.getReceipt(
        "procurement-1",
        "handler-1"
      )
    ).resolves.toMatchObject({
      latestPdf: {
        documentId: "receipt-pdf-document",
        fileId: "receipt-pdf-file",
        templateKey: "spot_procurement_receipt_v1"
      },
      reviews: [
        {
          reviewedBy: {
            id: "material-director-1",
            name: "复核时姓名"
          }
        }
      ]
    });
    await expect(
      buildHarness("submitted").service.getReceipt(
        "procurement-1",
        "handler-1"
      )
    ).resolves.toMatchObject({ latestPdf: null });
  });

  it("fails closed when the current procurement version handler differs from the receipt", async () => {
    const harness = createHarness({
      versionHandlerUserId: "stale-handler"
    });

    await expect(
      harness.service.getReceipt(
        "procurement-1",
        "handler-1"
      )
    ).rejects.toThrow(
      "零星采购收货当前版本坐标不一致，请刷新后重试"
    );
  });

  it("allows the handler to delegate receipt confirmation only to an active same-project user", async () => {
    const harness = createHarness();

    await expect(
      harness.service.createDelegation(
        "procurement-1",
        "handler-1",
        { delegateUserId: "delegate-1" }
      )
    ).resolves.toMatchObject({
      receiptId: "receipt-1",
      delegatorUserId: "handler-1",
      delegateUserId: "delegate-1"
    });
    expect(
      harness.tx.spotProcurementReceiptDelegation.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        receiptId: "receipt-1",
        delegatorUserId: "handler-1",
        delegateUserId: "delegate-1"
      })
    });
  });

  it("rejects a receipt delegate who is not affiliated with the project", async () => {
    const harness = createHarness({
      delegateInProject: false
    });

    await expect(
      harness.service.createDelegation(
        "procurement-1",
        "handler-1",
        { delegateUserId: "delegate-1" }
      )
    ).rejects.toThrow("只能委托本项目启用人员办理收货");
    expect(
      harness.tx.spotProcurementReceiptDelegation.create
    ).not.toHaveBeenCalled();
  });

  it("authorizes the receipt actor before exposing business-state errors", async () => {
    const harness = createHarness({
      receiptStatus: "reviewed"
    });

    await expect(
      harness.service.updateDraft(
        "procurement-1",
        "unrelated-employee",
        completeDraft
      )
    ).rejects.toThrow(
      "只有采购经办人或当前有效受托人可以办理收货"
    );
  });

  it("stores the exact current-version line set and excludes gifts and rejects from actual cost", async () => {
    const harness = createHarness();

    await expect(
      harness.service.updateDraft(
        "procurement-1",
        "handler-1",
        completeDraft
      )
    ).resolves.toMatchObject({
      receiptId: "receipt-1",
      actualCostCents: "1667",
      lineCount: 2
    });
    expect(
      harness.tx.spotProcurementReceiptLine.createMany
    ).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          procurementLineId: "line-1",
          actualCostCents: 667n,
          freeGiftQuantity: new Prisma.Decimal("100")
        }),
        expect.objectContaining({
          procurementLineId: "line-2",
          actualCostCents: 1000n
        })
      ])
    });
  });

  it("rejects an incomplete receipt line set instead of treating omitted lines as zero", async () => {
    const harness = createHarness();

    await expect(
      harness.service.updateDraft(
        "procurement-1",
        "handler-1",
        {
          lines: [completeDraft.lines[0]]
        }
      )
    ).rejects.toThrow(
      "收货明细必须完整对应当前采购版本全部明细"
    );
    expect(
      harness.tx.spotProcurementReceiptLine.createMany
    ).not.toHaveBeenCalled();
  });

  it("rejects quantities above approval and requires a reason for rejects", async () => {
    const harness = createHarness();
    const excessive = {
      ...completeDraft,
      lines: [
        {
          ...completeDraft.lines[0],
          qualifiedQuantity: "11"
        },
        completeDraft.lines[1]
      ]
    };
    await expect(
      harness.service.updateDraft(
        "procurement-1",
        "handler-1",
        excessive
      )
    ).rejects.toThrow("合格数量不能大于审批数量");

    const missingReason = {
      ...completeDraft,
      lines: [
        {
          ...completeDraft.lines[0],
          unqualifiedReason: undefined
        },
        completeDraft.lines[1]
      ]
    };
    await expect(
      harness.service.updateDraft(
        "procurement-1",
        "handler-1",
        missingReason
      )
    ).rejects.toThrow(
      "存在不合格数量时必须填写不合格原因"
    );
  });

  it("copies the upload into a dedicated receipt original and binds both hashes", async () => {
    const harness = createHarness();

    const result = await harness.service.attachPhoto(
      "procurement-1",
      "handler-1",
      {
        originalFileId: "original-1",
        source: "album",
        category: "material_scene",
        note: "免烧砖"
      }
    );
    expect(result).toMatchObject({
      watermarkedFileId: "watermarked-1",
      primaryFileId: "watermarked-1",
      originalSha256: originalSha,
      watermarkedSha256: watermarkedSha
    });
    expect(result).not.toHaveProperty("originalFileId");
    expect(harness.watermark.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectLabel: "示范项目（P-001）",
        procurementCode: "LXCG-2026-0001",
        uploaderName: "张三",
        source: "album",
        category: "material_scene",
        note: "免烧砖"
      })
    );
    expect(harness.files.uploadPrivateFile).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "image/jpeg",
        uploadedByUserId: "handler-1"
      })
    );
    expect(
      harness.files.uploadPrivateFile
    ).toHaveBeenCalledTimes(2);
    expect(
      harness.tx.spotProcurementReceiptPhoto.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        originalFileId: "receipt-original-1",
        watermarkedFileId: "watermarked-1",
        originalSha256: originalSha,
        watermarkedSha256: watermarkedSha
      })
    });
  });

  it("rejects photos above the per-procurement evidence limit before file processing", async () => {
    const harness = createHarness({
      photos: Array.from({ length: 20 }, (_, index) => ({
        id: `photo-${index + 1}`
      }))
    });

    await expect(
      harness.service.attachPhoto(
        "procurement-1",
        "handler-1",
        {
          originalFileId: "original-1",
          source: "album",
          category: "material_scene"
        }
      )
    ).rejects.toThrow(
      "每笔零星采购最多上传 20 张收货照片"
    );
    expect(
      harness.files.getOwnedVerifiedFileBuffer
    ).not.toHaveBeenCalled();
    expect(harness.watermark.generate).not.toHaveBeenCalled();
  });

  it("quarantines both generated files when final photo binding loses a race", async () => {
    const harness = createHarness({ occupiedPhoto: true });

    await expect(
      harness.service.attachPhoto(
        "procurement-1",
        "handler-1",
        {
          originalFileId: "original-1",
          source: "camera",
          category: "material_scene"
        }
      )
    ).rejects.toThrow(
      "该收货照片文件已被绑定，请刷新后重试"
    );
    expect(
      harness.files.quarantineUnboundReceiptWatermark
    ).toHaveBeenCalledWith("receipt-original-1", "handler-1");
    expect(
      harness.files.quarantineUnboundReceiptWatermark
    ).toHaveBeenCalledWith("watermarked-1", "handler-1");
    expect(
      harness.tx.spotProcurementReceiptPhoto.create
    ).not.toHaveBeenCalled();
  });

  it("rejects an original file already bound to another restricted business", async () => {
    const harness = createHarness({
      nonReceiptBusinessBinding: true
    });

    await expect(
      harness.service.attachPhoto(
        "procurement-1",
        "handler-1",
        {
          originalFileId: "original-1",
          source: "album",
          category: "material_scene"
        }
      )
    ).rejects.toThrow(
      "收货照片文件已被其他业务使用，请重新上传专用原图"
    );
    expect(
      harness.tx.spotProcurementReceiptPhoto.create
    ).not.toHaveBeenCalled();
    expect(
      harness.files.quarantineUnboundReceiptWatermark
    ).toHaveBeenCalledWith("receipt-original-1", "handler-1");
    expect(
      harness.files.quarantineUnboundReceiptWatermark
    ).toHaveBeenCalledWith("watermarked-1", "handler-1");
  });

  it("quarantines only the generated original copy when watermark storage fails", async () => {
    const harness = createHarness();
    harness.files.uploadPrivateFile
      .mockResolvedValueOnce({ id: "receipt-original-1" })
      .mockRejectedValueOnce(new Error("storage failed"));

    await expect(
      harness.service.attachPhoto(
        "procurement-1",
        "handler-1",
        {
          originalFileId: "original-1",
          source: "album",
          category: "material_scene"
        }
      )
    ).rejects.toThrow("收货照片水印文件保存失败，请重试");
    expect(
      harness.files.quarantineUnboundReceiptWatermark
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.files.quarantineUnboundReceiptWatermark
    ).toHaveBeenCalledWith("receipt-original-1", "handler-1");
    expect(
      harness.files.quarantineUnboundReceiptWatermark
    ).not.toHaveBeenCalledWith("original-1", "handler-1");
  });

  it("creates no file or photo fact when watermark generation fails", async () => {
    const harness = createHarness();
    harness.watermark.generate.mockRejectedValueOnce(
      new Error("render failed")
    );

    await expect(
      harness.service.attachPhoto(
        "procurement-1",
        "handler-1",
        {
          originalFileId: "original-1",
          source: "camera",
          category: "material_scene"
        }
      )
    ).rejects.toThrow("render failed");
    expect(harness.files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(
      harness.tx.spotProcurementReceiptPhoto.create
    ).not.toHaveBeenCalled();
  });

  it("requires a reason and locks a photo appended after the current revision was submitted", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:00:00.000Z"
    );
    const missingReason = createHarness({
      receiptStatus: "submitted",
      revisionSubmittedAt: submittedAt
    });
    await expect(
      missingReason.service.attachPhoto(
        "procurement-1",
        "handler-1",
        {
          originalFileId: "original-1",
          source: "album",
          category: "material_scene"
        }
      )
    ).rejects.toThrow(
      "首次提交后补充照片必须填写原因"
    );
    expect(
      missingReason.files.getOwnedVerifiedFileBuffer
    ).not.toHaveBeenCalled();

    const supplement = createHarness({
      receiptStatus: "submitted",
      revisionSubmittedAt: submittedAt
    });
    await supplement.service.attachPhoto(
      "procurement-1",
      "handler-1",
      {
        originalFileId: "original-1",
        source: "album",
        category: "material_scene",
        appendReason: "补充另一车卸货照片"
      }
    );
    expect(
      supplement.tx.spotProcurementReceiptPhoto.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        appendReason: "补充另一车卸货照片",
        lockedAtFirstSubmission: false,
        lockedAt: expect.any(Date)
      })
    });
    expect(
      supplement.receiptPdfs.tryRefreshLatest
    ).toHaveBeenCalledWith(
      "receipt-1",
      "handler-1",
      "receipt.photo.supplement",
      { sourceRevisionNo: 1 }
    );
  });

  it("deletes only an unsubmitted draft photo and quarantines both generated files", async () => {
    const harness = createHarness();

    await expect(
      harness.service.deleteDraftPhoto(
        "procurement-1",
        "photo-1",
        "handler-1"
      )
    ).resolves.toEqual({
      receiptId: "receipt-1",
      photoId: "photo-1",
      deleted: true
    });
    expect(
      harness.tx.spotProcurementReceiptPhoto.delete
    ).toHaveBeenCalledWith({ where: { id: "photo-1" } });
    expect(harness.tx.fileObject.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ["original-1", "watermarked-1"]
        },
        uploadedByUserId: "handler-1",
        storageStatus: "active"
      },
      data: { storageStatus: "quarantined" }
    });
  });

  it("does not delete photos after the current revision was submitted", async () => {
    const harness = createHarness({
      receiptStatus: "submitted",
      revisionSubmittedAt: new Date(
        "2026-07-17T08:00:00.000Z"
      )
    });

    await expect(
      harness.service.deleteDraftPhoto(
        "procurement-1",
        "photo-1",
        "handler-1"
      )
    ).rejects.toThrow("当前收货单不是可编辑草稿");
    expect(
      harness.tx.spotProcurementReceiptPhoto.delete
    ).not.toHaveBeenCalled();
  });

  it("fails closed instead of quarantining a derivative referenced by another photo", async () => {
    const harness = createHarness({ occupiedPhoto: true });

    await expect(
      harness.service.deleteDraftPhoto(
        "procurement-1",
        "photo-1",
        "handler-1"
      )
    ).rejects.toThrow(
      "收货照片文件仍被其他业务使用，不能删除"
    );
    expect(
      harness.tx.spotProcurementReceiptPhoto.delete
    ).not.toHaveBeenCalled();
    expect(harness.tx.fileObject.updateMany).not.toHaveBeenCalled();
  });

  it("does not quarantine draft photo files that another business has bound", async () => {
    const harness = createHarness({
      nonReceiptBusinessBinding: true
    });

    await expect(
      harness.service.deleteDraftPhoto(
        "procurement-1",
        "photo-1",
        "handler-1"
      )
    ).rejects.toThrow(
      "收货照片文件仍被其他业务使用，不能删除"
    );
    expect(
      harness.tx.spotProcurementReceiptPhoto.delete
    ).not.toHaveBeenCalled();
    expect(
      harness.tx.fileObject.updateMany
    ).not.toHaveBeenCalled();
  });

  it("requires a material-scene photo; an optional delivery note alone is insufficient", async () => {
    const harness = createHarness({
      photos: [
        {
          id: "photo-delivery",
          receiptId: "receipt-1",
          receiptRevisionNo: 1,
          originalFileId: "original-1",
          watermarkedFileId: "watermarked-1",
          originalSha256: originalSha,
          watermarkedSha256: watermarkedSha,
          source: "album",
          category: "delivery_note",
          serverRecordedAt: new Date(),
          note: null,
          uploadedByUserId: "handler-1",
          lockedAtFirstSubmission: false,
          lockedAt: null,
          appendReason: null
        }
      ]
    });

    await expect(
      harness.service.submit(
        "procurement-1",
        "handler-1"
      )
    ).rejects.toThrow(
      "请至少上传一张材料或卸货现场照片"
    );
    expect(
      harness.tx.spotProcurementReceipt.update
    ).not.toHaveBeenCalled();
  });

  it("fails closed when a file is reused across original and watermarked photo columns", async () => {
    const harness = createHarness({
      photos: [
        {
          id: "photo-1",
          receiptId: "receipt-1",
          receiptRevisionNo: 1,
          originalFileId: "original-1",
          watermarkedFileId: "watermarked-1",
          originalSha256: originalSha,
          watermarkedSha256: watermarkedSha,
          source: "album",
          category: "material_scene",
          serverRecordedAt: new Date(),
          note: null,
          uploadedByUserId: "handler-1",
          lockedAtFirstSubmission: false,
          lockedAt: null,
          appendReason: null
        },
        {
          id: "photo-2",
          receiptId: "receipt-1",
          receiptRevisionNo: 1,
          originalFileId: "watermarked-1",
          watermarkedFileId: "original-1",
          originalSha256: watermarkedSha,
          watermarkedSha256: originalSha,
          source: "camera",
          category: "material_scene",
          serverRecordedAt: new Date(),
          note: null,
          uploadedByUserId: "handler-1",
          lockedAtFirstSubmission: false,
          lockedAt: null,
          appendReason: null
        }
      ]
    });

    await expect(
      harness.service.submit(
        "procurement-1",
        "handler-1"
      )
    ).rejects.toThrow("收货照片文件绑定存在重复");
    expect(
      harness.tx.spotProcurementReceipt.update
    ).not.toHaveBeenCalled();
  });

  it("lets the active delegate submit while preserving the handler as business owner", async () => {
    const harness = createHarness({
      activeDelegation: true
    });

    await expect(
      harness.service.submit(
        "procurement-1",
        "delegate-1"
      )
    ).resolves.toMatchObject({
      status: "submitted",
      handlerUserId: "handler-1",
      submittedByUserId: "delegate-1",
      submissionDelegationId: "delegation-1",
      actualCostCents: "1667"
    });
    expect(
      harness.tx.spotProcurementReceipt.update
    ).toHaveBeenCalledWith({
      where: { id: "receipt-1" },
      data: expect.objectContaining({
        status: "submitted",
        submittedByUserId: "delegate-1",
        submissionDelegationId: "delegation-1",
        actualCostCents: 1667n
      })
    });
    expect(
      harness.tx.spotProcurementReceiptPhoto.updateMany
    ).toHaveBeenCalledWith({
      where: {
        id: { in: ["photo-1"] },
        lockedAt: null,
        lockedAtFirstSubmission: false
      },
      data: expect.objectContaining({
        lockedAtFirstSubmission: true
      })
    });
    expect(
      harness.receiptPdfs.tryRefreshLatest
    ).toHaveBeenCalledWith(
      "receipt-1",
      "delegate-1",
      "receipt.submit",
      { sourceRevisionNo: 1 }
    );
  });

  it("keeps the receipt in draft while any line is pending replenishment", async () => {
    const pendingLines = [
      {
        id: "receipt-line-1",
        receiptId: "receipt-1",
        receiptRevisionNo: 1,
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        procurementLineId: "line-1",
        approvedQuantitySnapshot: new Prisma.Decimal("10"),
        qualifiedQuantity: new Prisma.Decimal("2"),
        unqualifiedQuantity: new Prisma.Decimal("0"),
        unqualifiedReason: null,
        freeGiftQuantity: new Prisma.Decimal("0"),
        replenishmentPending: true,
        discrepancyNote: "供应商承诺补货",
        actualCostCents: 667n
      },
      {
        id: "receipt-line-2",
        receiptId: "receipt-1",
        receiptRevisionNo: 1,
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        procurementLineId: "line-2",
        approvedQuantitySnapshot: new Prisma.Decimal("5"),
        qualifiedQuantity: new Prisma.Decimal("1"),
        unqualifiedQuantity: new Prisma.Decimal("0"),
        unqualifiedReason: null,
        freeGiftQuantity: new Prisma.Decimal("0"),
        replenishmentPending: false,
        discrepancyNote: null,
        actualCostCents: 1000n
      }
    ];
    const harness = createHarness({
      receiptLines: pendingLines
    });

    await expect(
      harness.service.submit(
        "procurement-1",
        "handler-1"
      )
    ).rejects.toThrow(
      "仍有供应商承诺补货的明细，暂不能提交最终收货"
    );
    expect(
      harness.tx.spotProcurementReceipt.update
    ).not.toHaveBeenCalled();
  });

  it("allows only an active material director to review a submitted receipt", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const harness = createHarness({
      receiptStatus: "submitted",
      revisionSubmittedAt: submittedAt,
      photos: [lockedMaterialPhoto]
    });

    await expect(
      harness.service.review(
        "procurement-1",
        "project-manager-1",
        { decision: "approved" }
      )
    ).rejects.toThrow(
      "只有本项目物资主管可以复核收货"
    );
    expect(
      harness.tx.spotProcurementReceiptReview.create
    ).not.toHaveBeenCalled();
  });

  it("does not let an approved review from an older procurement version block the current submitted revision", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const harness = createHarness({
      receiptStatus: "submitted",
      revisionSubmittedAt: submittedAt,
      materialDirector: true,
      photos: [lockedMaterialPhoto],
      latestReview: {
        id: "review-old-version",
        receiptId: "receipt-1",
        receiptRevisionNo: 1,
        procurementId: "procurement-1",
        procurementVersionId: "version-old",
        sequenceNo: 3,
        decision: "approved",
        comment: null,
        reviewedByUserId: "material-director-1",
        reviewedByNameSnapshot: "物资主管旧姓名",
        submissionDelegationId: null,
        targetReviewId: null,
        createdAt: new Date(
          "2026-07-16T09:00:00.000Z"
        )
      }
    });

    await expect(
      harness.service.review(
        "procurement-1",
        "material-director-1",
        { decision: "approved" }
      )
    ).resolves.toMatchObject({
      sequenceNo: 4,
      status: "reviewed"
    });
    expect(
      harness.tx.spotProcurementReceiptReview.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        procurementVersionId: "version-1",
        sequenceNo: 4,
        decision: "approved"
      })
    });
  });

  it("approves a complete submitted receipt without letting the reviewer rewrite receipt facts", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const harness = createHarness({
      receiptStatus: "submitted",
      revisionSubmittedAt: submittedAt,
      materialDirector: true,
      photos: [lockedMaterialPhoto]
    });

    await expect(
      harness.service.review(
        "procurement-1",
        "material-director-1",
        {
          decision: "approved",
          comment: "数量和照片一致"
        }
      )
    ).resolves.toMatchObject({
      reviewId: "review-approved",
      decision: "approved",
      status: "reviewed",
      reviewedReceiptRevisionNo: 1,
      currentReceiptRevisionNo: 1
    });
    expect(
      harness.tx.spotProcurementReceiptReview.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        receiptId: "receipt-1",
        receiptRevisionNo: 1,
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        sequenceNo: 1,
        decision: "approved",
        comment: "数量和照片一致",
        reviewedByUserId: "material-director-1",
        reviewedByNameSnapshot: "张三",
        targetReviewId: null
      })
    });
    expect(
      harness.tx.spotProcurementReceipt.update
    ).toHaveBeenCalledWith({
      where: { id: "receipt-1" },
      data: { status: "reviewed" }
    });
    expect(
      harness.tx.spotProcurementReceiptRevision.create
    ).not.toHaveBeenCalled();
    expect(
      harness.tx.spotProcurementReceiptLine.deleteMany
    ).not.toHaveBeenCalled();
    expect(
      harness.receiptPdfs.tryRefreshLatest
    ).toHaveBeenCalledWith(
      "receipt-1",
      "material-director-1",
      "receipt.review.approved",
      {
        sourceRevisionNo: 1,
        reviewId: "review-approved"
      }
    );
  });

  it("requires a return reason and advances to a copied editable revision", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const missingReason = createHarness({
      receiptStatus: "submitted",
      revisionSubmittedAt: submittedAt,
      materialDirector: true,
      photos: [lockedMaterialPhoto]
    });
    expect(() =>
      missingReason.service.review(
        "procurement-1",
        "material-director-1",
        { decision: "returned" }
      )
    ).toThrow(
      "退回收货确认必须填写原因"
    );

    const harness = createHarness({
      receiptStatus: "submitted",
      revisionSubmittedAt: submittedAt,
      materialDirector: true,
      photos: [lockedMaterialPhoto]
    });
    await expect(
      harness.service.review(
        "procurement-1",
        "material-director-1",
        {
          decision: "returned",
          comment: "请复核破损砖数量"
        }
      )
    ).resolves.toMatchObject({
      decision: "returned",
      status: "returned",
      reviewedReceiptRevisionNo: 1,
      currentReceiptRevisionNo: 2
    });
    expect(
      harness.tx.spotProcurementReceiptRevision.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        receiptId: "receipt-1",
        revisionNo: 2,
        procurementVersionId: "version-1",
        submittedAt: null,
        submittedByUserId: null,
        submissionDelegationId: null
      })
    });
    expect(
      harness.tx.spotProcurementReceiptLine.createMany
    ).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          receiptRevisionNo: 2,
          procurementLineId: "line-1",
          qualifiedQuantity: new Prisma.Decimal("2"),
          actualCostCents: 667n
        }),
        expect.objectContaining({
          receiptRevisionNo: 2,
          procurementLineId: "line-2",
          actualCostCents: 1000n
        })
      ])
    });
    expect(
      harness.tx.spotProcurementReceipt.update
    ).toHaveBeenCalledWith({
      where: { id: "receipt-1" },
      data: expect.objectContaining({
        status: "returned",
        currentRevisionNo: 2,
        submittedAt: null,
        submittedByUserId: null
      })
    });
    expect(
      harness.tx.spotProcurementReceiptPhoto.updateMany
    ).not.toHaveBeenCalled();
    expect(
      harness.receiptPdfs.tryRefreshLatest
    ).toHaveBeenCalledWith(
      "receipt-1",
      "material-director-1",
      "receipt.review.returned",
      {
        sourceRevisionNo: 1,
        reviewId: "review-returned"
      }
    );
  });

  it("revokes only the current approved review with an explicit confirmation and preserves the reviewed revision", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const approvedReview = {
      id: "review-approved",
      receiptId: "receipt-1",
      receiptRevisionNo: 1,
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      sequenceNo: 1,
      decision: "approved",
      comment: "一致",
      reviewedByUserId: "material-director-1",
      reviewedByNameSnapshot: "张三",
      submissionDelegationId: null,
      targetReviewId: null,
      createdAt: new Date("2026-07-17T09:00:00.000Z")
    };
    const harness = createHarness({
      receiptStatus: "reviewed",
      revisionSubmittedAt: submittedAt,
      materialDirector: true,
      latestReview: approvedReview,
      photos: [lockedMaterialPhoto]
    });

    await expect(
      harness.service.revokeReview(
        "procurement-1",
        "material-director-1",
        {
          targetReviewId: "review-approved",
          reason: "发现送货数量需要重新核对",
          confirmReviewRevocation: true
        }
      )
    ).resolves.toMatchObject({
      decision: "revoked",
      targetReviewId: "review-approved",
      status: "review_revoked",
      revokedReceiptRevisionNo: 1,
      currentReceiptRevisionNo: 2
    });
    expect(
      harness.tx.spotProcurementReceiptReview.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        receiptRevisionNo: 1,
        sequenceNo: 2,
        decision: "revoked",
        targetReviewId: "review-approved",
        comment: "发现送货数量需要重新核对"
      })
    });
    expect(
      harness.tx.spotProcurementReceiptRevision.create
    ).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revisionNo: 2,
        submittedAt: null
      })
    });
    expect(
      harness.receiptPdfs.tryRefreshLatest
    ).toHaveBeenCalledWith(
      "receipt-1",
      "material-director-1",
      "receipt.review.revoked",
      {
        sourceRevisionNo: 1,
        reviewId: "review-revoked"
      }
    );
  });

  it("rejects review revocation after an active discrepancy fact exists", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const approvedReview = {
      id: "review-approved",
      receiptId: "receipt-1",
      receiptRevisionNo: 1,
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      sequenceNo: 1,
      decision: "approved",
      comment: "一致",
      reviewedByUserId: "material-director-1",
      reviewedByNameSnapshot: "张三",
      submissionDelegationId: null,
      targetReviewId: null,
      createdAt: new Date("2026-07-17T09:00:00.000Z")
    };
    const harness = createHarness({
      receiptStatus: "reviewed",
      revisionSubmittedAt: submittedAt,
      materialDirector: true,
      latestReview: approvedReview,
      activeDiscrepancy: true
    });

    await expect(
      harness.service.revokeReview(
        "procurement-1",
        "material-director-1",
        {
          targetReviewId: "review-approved",
          reason: "重新核对",
          confirmReviewRevocation: true
        }
      )
    ).rejects.toThrow(
      "当前收货复核已形成差异结算事实，不能撤销"
    );
    expect(
      harness.tx.spotProcurementReceiptReview.create
    ).not.toHaveBeenCalled();
    expect(
      harness.tx.spotProcurementReceiptRevision.create
    ).not.toHaveBeenCalled();
  });

  it.each([
    "allocation",
    "no_invoice",
    "exception"
  ] as const)(
    "rejects review revocation while a current %s ticket fact still reserves the receipt",
    async (activeTicketFact) => {
      const submittedAt = new Date(
        "2026-07-17T08:30:00.000Z"
      );
      const approvedReview = {
        id: "review-approved",
        receiptId: "receipt-1",
        receiptRevisionNo: 1,
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        sequenceNo: 1,
        decision: "approved",
        comment: "一致",
        reviewedByUserId: "material-director-1",
        reviewedByNameSnapshot: "张三",
        submissionDelegationId: null,
        targetReviewId: null,
        createdAt: new Date("2026-07-17T09:00:00.000Z")
      };
      const harness = createHarness({
        receiptStatus: "reviewed",
        revisionSubmittedAt: submittedAt,
        materialDirector: true,
        latestReview: approvedReview,
        activeTicketFact
      });

      await expect(
        harness.service.revokeReview(
          "procurement-1",
          "material-director-1",
          {
            targetReviewId: "review-approved",
            reason: "重新核对",
            confirmReviewRevocation: true
          }
        )
      ).rejects.toThrow(
        "当前收货复核已形成有效或待复核票据事实"
      );
      expect(
        harness.tx.spotProcurementReceiptReview.create
      ).not.toHaveBeenCalled();
      expect(
        harness.tx.spotProcurementReceiptRevision.create
      ).not.toHaveBeenCalled();
    }
  );

  it.each(["reviewed", "locked"] as const)(
    "lets the project material director explicitly retry the current formal receipt PDF from %s",
    async (receiptStatus) => {
      const submittedAt = new Date(
        "2026-07-17T08:30:00.000Z"
      );
      const approvedReview = {
        id: "review-approved",
        receiptId: "receipt-1",
        receiptRevisionNo: 1,
        procurementId: "procurement-1",
        procurementVersionId: "version-1",
        sequenceNo: 1,
        decision: "approved",
        comment: "一致",
        reviewedByUserId: "material-director-1",
        reviewedByNameSnapshot: "张三",
        submissionDelegationId: null,
        targetReviewId: null,
        createdAt: new Date(
          "2026-07-17T09:00:00.000Z"
        )
      };
      const harness = createHarness({
        receiptStatus,
        revisionSubmittedAt: submittedAt,
        materialDirector: true,
        latestReview: approvedReview,
        lockedAt:
          receiptStatus === "locked"
            ? new Date(
                "2026-07-17T10:00:00.000Z"
              )
            : null
      });

      await expect(
        harness.service.retryFormalPdf(
          "procurement-1",
          "material-director-1"
        )
      ).resolves.toEqual({
        receiptId: "receipt-1",
        documentId: "receipt-pdf-1",
        fileId: "receipt-pdf-file-1",
        templateKey: "spot_procurement_receipt_v1"
      });
      expect(
        harness.receiptPdfs.refreshLatest
      ).toHaveBeenCalledWith(
        "receipt-1",
        "material-director-1",
        "receipt.pdf.manual_retry",
        {
          sourceRevisionNo: 1,
          reviewId: "review-approved"
        }
      );
    }
  );

  it("rejects a formal receipt PDF retry before review and never starts PDF generation", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const harness = createHarness({
      receiptStatus: "submitted",
      revisionSubmittedAt: submittedAt,
      materialDirector: true
    });

    await expect(
      harness.service.retryFormalPdf(
        "procurement-1",
        "material-director-1"
      )
    ).rejects.toThrow(
      "只有复核通过或已办结锁定的收货确认可以重试生成正式 PDF"
    );
    expect(
      harness.receiptPdfs.refreshLatest
    ).not.toHaveBeenCalled();
  });

  it("rejects revocation of a stale review and requires explicit confirmation before any write", async () => {
    const submittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const approvedReview = {
      id: "review-current",
      receiptId: "receipt-1",
      receiptRevisionNo: 1,
      procurementId: "procurement-1",
      procurementVersionId: "version-1",
      sequenceNo: 3,
      decision: "approved",
      comment: null,
      reviewedByUserId: "material-director-1",
      reviewedByNameSnapshot: "张三",
      submissionDelegationId: null,
      targetReviewId: null,
      createdAt: new Date("2026-07-17T09:00:00.000Z")
    };
    const unconfirmed = createHarness({
      receiptStatus: "reviewed",
      revisionSubmittedAt: submittedAt,
      materialDirector: true,
      latestReview: approvedReview
    });
    expect(() =>
      unconfirmed.service.revokeReview(
        "procurement-1",
        "material-director-1",
        {
          targetReviewId: "review-current",
          reason: "重新核对",
          confirmReviewRevocation: false
        }
      )
    ).toThrow(
      "请明确确认撤销本次收货复核"
    );
    expect(
      unconfirmed.prisma.$transaction
    ).not.toHaveBeenCalled();

    const stale = createHarness({
      receiptStatus: "reviewed",
      revisionSubmittedAt: submittedAt,
      materialDirector: true,
      latestReview: approvedReview
    });
    await expect(
      stale.service.revokeReview(
        "procurement-1",
        "material-director-1",
        {
          targetReviewId: "review-old",
          reason: "重新核对",
          confirmReviewRevocation: true
        }
      )
    ).rejects.toThrow(
      "只能撤销当前有效且坐标一致的收货复核"
    );
    expect(
      stale.tx.spotProcurementReceiptReview.create
    ).not.toHaveBeenCalled();
  });

  it("inherits only locked photos from the same procurement version without relabeling supplements on resubmission", async () => {
    const firstSubmittedAt = new Date(
      "2026-07-17T08:30:00.000Z"
    );
    const inheritedSupplement = {
      ...lockedMaterialPhoto,
      lockedAtFirstSubmission: false,
      appendReason: "退回后补充卸货照片"
    };
    const harness = createHarness({
      receiptStatus: "returned",
      revisionSubmittedAt: null,
      firstSubmittedAt,
      photos: [inheritedSupplement]
    });

    await expect(
      harness.service.submit(
        "procurement-1",
        "handler-1"
      )
    ).resolves.toMatchObject({
      status: "submitted",
      actualCostCents: "1667"
    });
    expect(
      harness.tx.spotProcurementReceiptPhoto.updateMany
    ).not.toHaveBeenCalled();
    const photoLockQuery = harness.tx.$queryRaw.mock.calls
      .map(([query]) =>
        (
          query as { strings?: readonly string[] }
        ).strings?.join("?")
      )
      .find((query) =>
        query?.includes(
          'FROM "SpotProcurementReceiptPhoto" photo'
        )
      );
    expect(photoLockQuery).toContain(
      'revision."procurementVersionId"'
    );
  });
});
