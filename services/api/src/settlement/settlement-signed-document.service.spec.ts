import { createHash } from "node:crypto";
import { degrees, PDFDocument } from "pdf-lib";
import { SettlementSignedDocumentService, overlayFrozenSettlementSignatures } from "./settlement-signed-document.service";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function landscapePdf(pageCount: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) pdf.addPage([841.89, 595.28]);
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

describe("SettlementSignedDocumentService", () => {
  const facts = {
    settlementId: "settlement-1", sourceRevision: 3, originalDocumentId: "original-1",
    originalFileId: "original-file-1", originalPageCount: 1, originalContentSha256: "a".repeat(64),
    businessSnapshotToken: "snapshot-1", approvalActionSetHash: "b".repeat(64), signatures: []
  };

  function claimHarness(existing: Record<string, unknown> | null) {
    const claim = {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({})
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: "settlement-1" }]),
      settlement: { findUnique: jest.fn().mockResolvedValue({
        id: "settlement-1", governanceVersion: 1, status: "pending_generation"
      }) },
      settlementSignedDocument: { findFirst: jest.fn() },
      settlementSignedDocumentGenerationClaim: claim
    };
    const audit = { record: jest.fn() };
    const service = new SettlementSignedDocumentService({} as never, {} as never, audit as never);
    jest.spyOn(service as never, "loadFacts" as never).mockResolvedValue(facts as never);
    return { service, tx, claim };
  }

  it("creates one durable fresh claim with the frozen generation facts", async () => {
    const { service, tx, claim } = claimHarness(null);
    await (service as unknown as { claim(...args: unknown[]): Promise<unknown> }).claim(
      tx, "settlement-1", "director-1", false
    );
    expect(claim.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      settlementId: "settlement-1", requestedByUserId: "director-1",
      originalDocumentId: "original-1", approvalActionSetHash: "b".repeat(64), status: "pending"
    }) });
  });

  it("waits on a fresh pending lease without replacing its claim token", async () => {
    const { service, tx, claim } = claimHarness({
      ...facts, claimToken: "owner-token", status: "pending", claimedAt: new Date(),
      requestedByUserId: "director-1", uploadedFileId: null, finalDocumentId: null
    });
    await expect((service as unknown as { claim(...args: unknown[]): Promise<unknown> }).claim(
      tx, "settlement-1", "director-2", false
    )).rejects.toThrow("正在生成");
    expect(claim.update).not.toHaveBeenCalled();
  });

  it("takes over a stale pending lease with a new CAS token", async () => {
    const { service, tx, claim } = claimHarness({
      ...facts, claimToken: "stale-token", status: "pending",
      claimedAt: new Date(Date.now() - 6 * 60 * 1000), requestedByUserId: "director-1",
      uploadedFileId: null, finalDocumentId: null
    });
    const taken = await (service as unknown as { claim(...args: unknown[]): Promise<{ staleObjectClaimToken?: string }> }).claim(
      tx, "settlement-1", "director-2", false
    );
    expect(claim.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        claimToken: expect.not.stringMatching(/^stale-token$/u),
        attemptCount: { increment: 1 }, requestedByUserId: "director-2"
      })
    }));
    expect(taken.staleObjectClaimToken).toBe("stale-token");
  });

  it("uses the owned claim token when recording failure so an old worker cannot poison a takeover", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = new SettlementSignedDocumentService({} as never, {} as never, {} as never);
    await (service as unknown as { markFailure(...args: unknown[]): Promise<unknown> }).markFailure(
      { settlementSignedDocumentGenerationClaim: { updateMany } },
      "settlement-1", "old-token", "activation_failed"
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { settlementId: "settlement-1", claimToken: "old-token", status: { not: "completed" } },
      data: { status: "failed", safeFailureCode: "activation_failed" }
    });
  });

  it("marks the new claim failed when stale deterministic-object cleanup fails", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      settlementSignedDocumentGenerationClaim: { updateMany }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx))
    };
    const files = {
      discardSettlementClaimObject: jest.fn().mockRejectedValue(new Error("COS unavailable"))
    };
    const audit = { record: jest.fn() };
    const service = new SettlementSignedDocumentService(
      prisma as never,
      files as never,
      audit as never
    );
    jest.spyOn(service as never, "claim" as never).mockResolvedValue({
      facts,
      claimToken: "new-token",
      status: "pending",
      uploadedFileId: null,
      staleObjectClaimToken: "old-token"
    } as never);

    await expect(service.generateFinal("settlement-1", "director-1"))
      .rejects.toThrow("COS unavailable");

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        settlementId: "settlement-1",
        claimToken: "new-token",
        status: { not: "completed" }
      },
      data: { status: "failed", safeFailureCode: "render_failed" }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "settlement.signed_document.generation_failed",
      metadata: { safeFailureCode: "render_failed" }
    }));
  });

  it("reconciles a P2002 winner only when the active final uses this claim upload and frozen facts", async () => {
    const tx = {
      $queryRaw: jest.fn(),
      settlement: {
        findUnique: jest.fn().mockResolvedValue({ governanceVersion: 1, status: "pending_archive_confirm" }),
        update: jest.fn()
      },
      settlementSignedDocumentGenerationClaim: {
        findUnique: jest.fn().mockResolvedValue({ claimToken: "token-1", uploadedFileId: "file-1" }),
        update: jest.fn()
      },
      settlementSignedDocument: { findFirst: jest.fn().mockResolvedValue({
        id: "final-1", fileId: "file-1", sourceRevision: 3,
        businessSnapshotToken: "snapshot-1", approvalActionSetHash: "b".repeat(64)
      }) }
    };
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const audit = { record: jest.fn() };
    const service = new SettlementSignedDocumentService(prisma as never, {} as never, audit as never);

    await expect((service as unknown as { reconcileUniqueWinner(...args: unknown[]): Promise<unknown> })
      .reconcileUniqueWinner(facts, "token-1", "file-1", "director-1", false))
      .resolves.toEqual(expect.objectContaining({ id: "final-1" }));
    expect(tx.settlementSignedDocumentGenerationClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed", finalDocumentId: "final-1" })
    }));
  });

  it("maps a mismatched unique winner to a stable conflict without losing the uploaded claim", async () => {
    const tx = {
      $queryRaw: jest.fn(),
      settlement: { findUnique: jest.fn().mockResolvedValue({ governanceVersion: 1, status: "pending_generation" }) },
      settlementSignedDocumentGenerationClaim: {
        findUnique: jest.fn().mockResolvedValue({ claimToken: "token-1", uploadedFileId: "file-1" }),
        update: jest.fn()
      },
      settlementSignedDocument: { findFirst: jest.fn().mockResolvedValue({
        id: "other-final", fileId: "other-file", sourceRevision: 3,
        businessSnapshotToken: "snapshot-1", approvalActionSetHash: "b".repeat(64)
      }) }
    };
    const prisma = { $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const service = new SettlementSignedDocumentService(prisma as never, {} as never, { record: jest.fn() } as never);

    await expect((service as unknown as { reconcileUniqueWinner(...args: unknown[]): Promise<unknown> })
      .reconcileUniqueWinner(facts, "token-1", "file-1", "director-1", false))
      .rejects.toThrow("并发激活冲突");
    expect(tx.settlementSignedDocumentGenerationClaim.update).not.toHaveBeenCalled();
  });

  it("confirms only the active final linked by the completed claim and persists confirmer evidence", async () => {
    const tx = {
      $queryRaw: jest.fn(),
      settlement: { findUnique: jest.fn().mockResolvedValue({
        id: "settlement-1", governanceVersion: 1, status: "pending_archive_confirm"
      }) },
      settlementSignedDocument: {
        findFirst: jest.fn().mockResolvedValue({
          id: "final-1", fileId: "file-1", contentSha256: "c".repeat(64),
          sourceRevision: 3, businessSnapshotToken: "snapshot-1",
          approvalActionSetHash: "b".repeat(64)
        }),
        update: jest.fn().mockResolvedValue({})
      },
      settlementSignedDocumentGenerationClaim: { findUnique: jest.fn().mockResolvedValue({
        status: "completed", finalDocumentId: "final-1", uploadedFileId: "file-1",
        sourceRevision: 3, originalDocumentId: "original-1",
        originalContentSha256: "a".repeat(64), businessSnapshotToken: "snapshot-1",
        approvalActionSetHash: "b".repeat(64)
      }) },
      fileObject: { findUnique: jest.fn().mockResolvedValue({ contentSha256: "c".repeat(64) }) }
    };
    const service = new SettlementSignedDocumentService({} as never, {} as never, { record: jest.fn() } as never);
    jest.spyOn(service as never, "loadFacts" as never).mockResolvedValue(facts as never);

    await expect(service.confirmInTransaction(tx as never, "settlement-1", "director-1"))
      .resolves.toEqual(expect.objectContaining({ confirmedByUserId: "director-1" }));
    expect(tx.settlementSignedDocument.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "final-1" },
      data: expect.objectContaining({ confirmedByUserId: "director-1", confirmedAt: expect.any(Date) })
    }));
  });

  it("overlays frozen signature images on every page without rewriting the original bytes", async () => {
    const original = await landscapePdf(3);
    const originalHash = createHash("sha256").update(original).digest("hex");
    const result = await overlayFrozenSettlementSignatures(original, [{
      roleKey: "preparer",
      fileId: "signature-at-submission",
      sha256: createHash("sha256").update(PNG).digest("hex"),
      signedAt: new Date("2026-07-18T02:03:04.000Z"),
      image: PNG
    }]);

    expect(createHash("sha256").update(original).digest("hex")).toBe(originalHash);
    expect(result.equals(original)).toBe(false);
    expect((await PDFDocument.load(result)).getPageCount()).toBe(3);
  });

  it("refuses a portrait original instead of guessing unsafe signature coordinates", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595.28, 841.89]);
    const original = Buffer.from(await pdf.save());

    await expect(overlayFrozenSettlementSignatures(original, [])).rejects.toThrow(
      "页面尺寸或方向异常"
    );
  });

  it("maps a visually landscape quarter-turned scan instead of rejecting its raw portrait box", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    page.setRotation(degrees(90));
    const original = Buffer.from(await pdf.save({ useObjectStreams: false }));

    await expect(overlayFrozenSettlementSignatures(original, [{
      roleKey: "finance_director", fileId: "frozen-signature", sha256: "a".repeat(64),
      signedAt: new Date("2026-07-18T00:00:00Z"), image: PNG
    }])).resolves.toEqual(expect.any(Buffer));
  });

  it("fails closed when two frozen approvals target the same seven-cell role slot", async () => {
    const original = await landscapePdf(1);
    await expect(overlayFrozenSettlementSignatures(original, [
      { roleKey: "engineering_foreman", fileId: "sig-1", sha256: "a".repeat(64), signedAt: new Date(), image: PNG },
      { roleKey: "engineering_tech", fileId: "sig-2", sha256: "b".repeat(64), signedAt: new Date(), image: PNG }
    ])).rejects.toThrow("同一结算签名岗位存在多个有效签名快照");
  });
});
