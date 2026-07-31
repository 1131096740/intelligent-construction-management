import { ContractNegotiationService } from "./contract-negotiation.service";

describe("ContractNegotiationService", () => {
  const audit = { record: jest.fn() };
  const files = {
    assertCanDownloadFile: jest.fn(),
    linkFileReplacement: jest.fn(),
    createDownloadTicket: jest.fn()
  };
  const auth = { confirmPassword: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    auth.confirmPassword.mockResolvedValue(undefined);
    files.createDownloadTicket.mockResolvedValue({
      fileId: "preview-pdf-secret",
      fileName: "修订预览.pdf",
      mimeType: "application/pdf",
      sizeBytes: 123,
      expiresAt: "2026-07-12T12:05:00.000Z",
      downloadUrl: "/files/preview-pdf-secret/download?token=signed"
    });
    files.assertCanDownloadFile.mockResolvedValue({
      id: "revision-file",
      originalName: "对方修订稿.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });
  });

  function makeTx(options: { formalEvidence?: boolean } = {}) {
    const version = {
      id: "version-1",
      contractId: "contract-1",
      status: "draft",
      changeType: "original",
      draftRevision: 7,
      amountCents: 12_300n,
      draftData: { fieldValues: { signingDate: "2026-07-12" } },
      templateSnapshot: {
        fieldSchema: [{ key: "signingDate", label: "签订日期" }]
      },
      clauseSnapshot: [
        {
          key: "payment",
          title: "付款条款",
          content: { text: "付款条款：按月结算" }
        }
      ]
    };
    const contract = {
      id: "contract-1",
      ownerUserId: "owner-1",
      voidedAt: null
    };
    const round = {
      id: "round-1",
      contractVersionId: "version-1",
      roundNo: 1,
      status: "open",
      sourceGeneratedDocumentId: "generated-1",
      sourceRevision: 7,
      note: null,
      openedAt: new Date("2026-07-12T10:00:00.000Z"),
      closedAt: null
    };
    return {
      $queryRaw: jest.fn(async (query: { strings?: readonly string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [version];
        }
        if (sql.includes("FOR UPDATE OF c")) return [contract];
        if (sql.includes('AS "hasSignedFormalFile"')) {
          return [{
            hasSignedFormalFile: options.formalEvidence ?? false,
            hasActiveSealTask: false,
            hasArchiveFile: false,
            hasSettlement: false,
            hasPaymentRequest: false
          }];
        }
        if (sql.includes('FROM "ContractNegotiationRound"')) return [round];
        return [];
      }),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue(version)
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue(contract)
      },
      contractGeneratedDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "generated-1",
          contractVersionId: "version-1",
          sourceRevision: 7,
          status: "success",
          docxFileId: "generated-docx"
        }),
        findUnique: jest.fn().mockResolvedValue({
          id: "generated-1",
          contractVersionId: "version-1",
          sourceRevision: 7,
          status: "success",
          docxFileId: "generated-docx"
        })
      },
      contractNegotiationRound: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _max: { roundNo: null } }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: "round-1", ...data })),
        findUnique: jest.fn().mockResolvedValue({
          id: "round-1",
          contractVersionId: "version-1",
          status: "open",
          sourceGeneratedDocumentId: "generated-1",
          sourceRevision: 7
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractOfflineRevision: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: "revision-1", ...data })),
        findUnique: jest.fn().mockResolvedValue({
          id: "revision-1",
          contractVersionId: "version-1",
          negotiationRoundId: "round-1",
          sourceGeneratedDocumentId: "generated-1",
          sourceRevision: 7,
          status: "failed"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([
          { id: "revision-1", negotiationRoundId: "round-1", status: "succeeded" }
        ])
      },
      contractDocumentComparison: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: "comparison-1", ...data })),
        findUnique: jest.fn().mockResolvedValue({
          id: "comparison-1",
          negotiationRoundId: "round-1",
          offlineRevisionId: "revision-1",
          sourceRevision: 7,
          status: "succeeded"
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: "comparison-1", offlineRevisionId: "revision-1", status: "succeeded" }
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractDocumentDifference: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      }
    };
  }

  function service(tx = makeTx()) {
    const prisma = {
      $transaction: jest.fn(async (callback) => callback(tx))
    };
    return {
      service: new ContractNegotiationService(
        prisma as never,
        audit as never,
        files as never,
        auth as never
      ),
      tx
    };
  }

  function expectContractThenVersionBoundary(tx: ReturnType<typeof makeTx>) {
    const sql = tx.$queryRaw.mock.calls.map(
      ([query]: [{ strings?: readonly string[] }]) =>
        query.strings?.join(" ") ?? ""
    );
    expect(sql[0]).toContain("FOR UPDATE OF c");
    expect(sql[1]).toContain("FOR UPDATE OF cv");
    expect(sql[2]).toContain('AS "hasSignedFormalFile"');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[1]
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[2]
    );
  }

  it("opens a round from the latest current successful DOCX without accepting a client source", async () => {
    const { service: subject, tx } = service();

    const result = await subject.openRound("version-1", "owner-1", { note: "首轮磋商" });
    expect(result).toMatchObject({
        id: "round-1",
        sourceRevision: 7,
        roundNo: 1,
        status: "open"
      });
    expect(JSON.stringify(result)).not.toContain("generated-1");
    expect(JSON.stringify(result)).not.toContain("owner-1");
    expect(tx.contractGeneratedDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractVersionId: "version-1",
          sourceRevision: 7,
          status: "success",
          docxFileId: { not: null }
        })
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "contract.negotiation_round.open" })
    );
  });

  it("does not open a negotiation round after signed formal evidence exists", async () => {
    const tx = makeTx({ formalEvidence: true });
    const { service: subject } = service(tx);

    await expect(
      subject.openRound("version-1", "owner-1")
    ).rejects.toThrow("正式业务事实");
    expect(tx.contractNegotiationRound.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("derives upload source and source revision only from the open round", async () => {
    const { service: subject, tx } = service();
    tx.contractNegotiationRound.findFirst.mockResolvedValue({
      id: "round-1",
      contractVersionId: "version-1",
      status: "open",
      sourceGeneratedDocumentId: "generated-1",
      sourceRevision: 7
    });

    const result = await subject.uploadRevision("version-1", "owner-1", {
      fileId: "revision-file",
      label: "对方第一次修订",
      confirmationStatementAccepted: true
    });

    expect(tx.contractOfflineRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        negotiationRoundId: "round-1",
        sourceGeneratedDocumentId: "generated-1",
        sourceRevision: 7,
        status: "queued"
      })
    });
    expect(tx.contractDocumentComparison.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        offlineRevisionId: "revision-1",
        negotiationRoundId: "round-1",
        sourceRevision: 7,
        status: "queued"
      })
    });
    expect(files.linkFileReplacement).toHaveBeenCalledWith(tx, {
      newFileId: "revision-file",
      oldFileId: "generated-docx",
      actorUserId: "owner-1"
    });
    expect(result).toEqual({
      id: "revision-1",
      status: "queued",
      label: "对方第一次修订",
      hasPreviewPdf: false,
      comparison: { id: "comparison-1", status: "queued" }
    });
    expect(JSON.stringify(result)).not.toContain("revision-file");
    expect(JSON.stringify(result)).not.toContain("generated-1");
    expect(JSON.stringify(result)).not.toContain("owner-1");
    expectContractThenVersionBoundary(tx);
    expect(tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      tx.contractNegotiationRound.findFirst.mock.invocationCallOrder[0]
    );
    expect(tx.contractNegotiationRound.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[3]
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[3]).toBeLessThan(
      tx.contractOfflineRevision.create.mock.invocationCallOrder[0]
    );
  });

  it("does not confirm an amount candidate until the current ledger is exactly equal", async () => {
    const tx = makeTx();
    tx.contractDocumentDifference.findUnique.mockResolvedValue({
      id: "difference-1",
      comparisonId: "comparison-1",
      disposition: "pending",
      candidate: { kind: "amount", label: "合同金额", cents: "999" }
    });
    const { service: subject } = service(tx);

    await expect(
      subject.disposeDifference("difference-1", "owner-1", { disposition: "confirmed" })
    ).rejects.toThrow("结构候选与当前合同账本不一致");
    expect(tx.contractDocumentDifference.updateMany).not.toHaveBeenCalled();
    expectContractThenVersionBoundary(tx);
    expect(tx.contractVersion.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    { candidate: { kind: "amount", label: "合同金额", cents: "12300" } },
    {
      candidate: {
        kind: "date",
        fieldKey: "signingDate",
        label: "签订日期",
        isoDate: "2026-07-12"
      }
    },
    {
      candidate: {
        kind: "key_clause",
        clauseKey: "payment",
        title: "付款条款",
        proposedText: "付款条款：按月结算",
        baseTextSha256: "hash"
      }
    }
  ])("allows confirmation only after candidate $candidate.kind exactly matches the ledger", async ({ candidate }) => {
    const tx = makeTx();
    tx.contractDocumentDifference.findUnique.mockResolvedValue({
      id: "difference-1",
      comparisonId: "comparison-1",
      disposition: "pending",
      candidate
    });
    const { service: subject } = service(tx);

    await expect(
      subject.disposeDifference("difference-1", "owner-1", { disposition: "confirmed" })
    ).resolves.toBeDefined();
    expectContractThenVersionBoundary(tx);
    expect(tx.contractVersion.findUnique).not.toHaveBeenCalled();
    expect(tx.contractVersion).not.toHaveProperty("update");
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "contract.document_difference.dispose" })
    );
  });

  it("blocks closing a round while a difference is pending", async () => {
    const tx = makeTx();
    tx.contractDocumentDifference.findFirst.mockResolvedValue({ id: "difference-pending" });
    const { service: subject } = service(tx);

    await expect(subject.closeRound("round-1", "owner-1")).rejects.toThrow(
      "仍有待处理差异"
    );
    expect(tx.contractNegotiationRound.updateMany).not.toHaveBeenCalled();
  });

  it("does not close an empty negotiation round without a succeeded revision and comparison", async () => {
    const tx = makeTx();
    tx.contractOfflineRevision.findMany.mockResolvedValue([]);
    tx.contractDocumentComparison.findMany.mockResolvedValue([]);
    const { service: subject } = service(tx);

    await expect(subject.closeRound("round-1", "owner-1")).rejects.toThrow(
      "至少上传并完成一份线下修订稿比较"
    );
    expect(tx.contractNegotiationRound.updateMany).not.toHaveBeenCalled();
  });

  it("locks the round before close reads and returns only the safe closed projection", async () => {
    const tx = makeTx();
    const { service: subject } = service(tx);

    const result = await subject.closeRound("round-1", "owner-1");

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.contractOfflineRevision.findMany.mock.invocationCallOrder[0]
    );
    expect(tx.contractDocumentComparison.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.contractNegotiationRound.updateMany.mock.invocationCallOrder[0]
    );
    expect(result).toMatchObject({ id: "round-1", roundNo: 1, status: "closed" });
    expect(JSON.stringify(result)).not.toContain("generated-1");
    expect(JSON.stringify(result)).not.toContain("owner-1");
  });

  it("returns a safe round read model without private file or actor identifiers", async () => {
    const tx = makeTx();
    tx.contractNegotiationRound.findMany.mockResolvedValue([
      {
        id: "round-1",
        roundNo: 1,
        status: "open",
        sourceRevision: 7,
        sourceGeneratedDocumentId: "generated-secret",
        openedByUserId: "owner-secret",
        note: null,
        openedAt: new Date("2026-07-12T10:00:00.000Z"),
        closedAt: null
      }
    ]);
    tx.contractOfflineRevision.findMany.mockResolvedValue([
      {
        id: "revision-1",
        label: "第一轮修订",
        note: null,
        status: "succeeded",
        fileId: "raw-docx-secret",
        previewPdfFileId: "preview-pdf-secret",
        confirmedByUserId: "owner-secret",
        errorMessage: null,
        createdAt: new Date("2026-07-12T10:01:00.000Z"),
        completedAt: new Date("2026-07-12T10:02:00.000Z")
      }
    ]);
    const { service: subject } = service(tx);

    const rounds = await subject.listRounds("version-1", "owner-1");
    const serialized = JSON.stringify(rounds);

    expect(rounds[0].revisions[0]).toMatchObject({
      id: "revision-1",
      hasPreviewPdf: true
    });
    expect(serialized).not.toContain("raw-docx-secret");
    expect(serialized).not.toContain("preview-pdf-secret");
    expect(serialized).not.toContain("owner-secret");
    expect(serialized).not.toContain("generated-secret");
  });

  it("issues a revision-scoped preview ticket without returning the raw file id", async () => {
    const tx = makeTx();
    tx.contractOfflineRevision.findUnique.mockResolvedValue({
      id: "revision-1",
      contractVersionId: "version-1",
      status: "succeeded",
      previewPdfFileId: "preview-pdf-secret"
    });
    const { service: subject } = service(tx);

    const ticket = await subject.createPreviewDownloadTicket("revision-1", "owner-1", {
      confirmationPassword: "current-password",
      downloadReason: "复核本轮合同差异"
    });

    expect(auth.confirmPassword).toHaveBeenCalledWith("owner-1", "current-password");
    expect(files.createDownloadTicket).toHaveBeenCalledWith("preview-pdf-secret", {
      actorUserId: "owner-1",
      downloadReason: "复核本轮合同差异"
    });
    expect(ticket).not.toHaveProperty("fileId");
  });

  it("keeps the previous preview reference during retry so the worker can extend its file chain", async () => {
    const tx = makeTx();
    tx.contractOfflineRevision.findUnique.mockResolvedValue({
      id: "revision-1",
      contractVersionId: "version-1",
      negotiationRoundId: "round-1",
      sourceGeneratedDocumentId: "generated-1",
      sourceRevision: 7,
      status: "failed",
      previewPdfFileId: "old-preview-pdf"
    });
    const { service: subject } = service(tx);

    const result = await subject.retryRevision("revision-1", "owner-1");

    expect(tx.contractOfflineRevision.updateMany).toHaveBeenCalledWith({
      where: { id: "revision-1", status: "failed" },
      data: expect.not.objectContaining({ previewPdfFileId: null })
    });
    expect(tx.contractOfflineRevision.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0]
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.contractOfflineRevision.updateMany.mock.invocationCallOrder[0]
    );
    expect(result).toEqual({
      id: "revision-1",
      status: "queued",
      label: undefined,
      hasPreviewPdf: false,
      comparison: { id: "comparison-1", status: "queued" }
    });
    expect(JSON.stringify(result)).not.toContain("old-preview-pdf");
    expect(JSON.stringify(result)).not.toContain("generated-1");
  });
});
