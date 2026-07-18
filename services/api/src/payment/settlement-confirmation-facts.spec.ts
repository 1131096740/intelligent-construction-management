import { loadSettlementPaymentConfirmationFacts } from "./settlement-confirmation-facts";

describe("loadSettlementPaymentConfirmationFacts", () => {
  it("同时读取历史归档和受治理最终签名件并取最早确认时间", async () => {
    const legacyConfirmedAt = new Date("2026-07-18T10:00:00.000Z");
    const governedConfirmedAt = new Date("2026-07-18T09:00:00.000Z");
    const client = {
      settlementArchiveFile: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-legacy", confirmedAt: legacyConfirmedAt },
          { settlementId: "settlement-both", confirmedAt: legacyConfirmedAt }
        ])
      },
      settlementSignedDocument: {
        findMany: jest.fn().mockResolvedValue([
          { settlementId: "settlement-governed", confirmedAt: governedConfirmedAt },
          { settlementId: "settlement-both", confirmedAt: governedConfirmedAt }
        ])
      }
    };

    await expect(loadSettlementPaymentConfirmationFacts(client, [
      "settlement-governed",
      "settlement-legacy",
      "settlement-both",
      "settlement-both"
    ])).resolves.toEqual([
      { settlementId: "settlement-both", confirmedAt: governedConfirmedAt },
      { settlementId: "settlement-governed", confirmedAt: governedConfirmedAt },
      { settlementId: "settlement-legacy", confirmedAt: legacyConfirmedAt }
    ]);
    expect(client.settlementSignedDocument.findMany).toHaveBeenCalledWith({
      where: {
        settlementId: { in: ["settlement-both", "settlement-governed", "settlement-legacy"] },
        purpose: "final_internal_signed_copy",
        status: "active",
        generationStatus: "completed",
        confirmedAt: { not: null }
      },
      select: { settlementId: true, confirmedAt: true }
    });
  });

  it("无结算时不读取数据库", async () => {
    const client = {
      settlementArchiveFile: { findMany: jest.fn() },
      settlementSignedDocument: { findMany: jest.fn() }
    };

    await expect(loadSettlementPaymentConfirmationFacts(client, [])).resolves.toEqual([]);
    expect(client.settlementArchiveFile.findMany).not.toHaveBeenCalled();
    expect(client.settlementSignedDocument.findMany).not.toHaveBeenCalled();
  });
});
