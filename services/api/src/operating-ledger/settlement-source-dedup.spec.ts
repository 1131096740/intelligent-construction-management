import {
  normalizeSettlementPeriod,
  settlementCrossSourceConflict,
  settlementDedupKey,
  settlementEconomicIdentity
} from "./settlement-source-dedup";

describe("settlement cross-source dedup key", () => {
  it("旧 settlement 与新 signed_contract_settlement 同期次得到同一去重键", () => {
    const legacy = settlementEconomicIdentity("settlement", {
      contractVersionId: "version-1",
      periodLabel: "２０２６年 第 1 期"
    });
    const signed = settlementEconomicIdentity("signed_contract_settlement", {
      contractKind: "downstream",
      contractVersionId: "version-1",
      settlementNumber: "2026年第1期"
    });
    expect(legacy).not.toBeNull();
    expect(signed).not.toBeNull();
    expect(settlementDedupKey(legacy!)).toBe(settlementDedupKey(signed!));
  });

  it("合同版本、期次或合同关系任一不同都不去重", () => {
    const base = settlementEconomicIdentity("signed_contract_settlement", {
      contractKind: "downstream",
      contractVersionId: "version-1",
      settlementNumber: "第1期"
    })!;
    const otherVersion = settlementEconomicIdentity("signed_contract_settlement", {
      contractKind: "downstream",
      contractVersionId: "version-2",
      settlementNumber: "第1期"
    })!;
    const otherPeriod = settlementEconomicIdentity("signed_contract_settlement", {
      contractKind: "downstream",
      contractVersionId: "version-1",
      settlementNumber: "第2期"
    })!;
    const upward = settlementEconomicIdentity("signed_contract_settlement", {
      contractKind: "upward",
      contractVersionId: "version-1",
      settlementNumber: "第1期"
    })!;
    const keys = new Set(
      [base, otherVersion, otherPeriod, upward].map(settlementDedupKey)
    );
    expect(keys.size).toBe(4);
  });

  it("合同版本或期次缺失时不猜测去重，也不接受未知来源", () => {
    expect(
      settlementEconomicIdentity("settlement", { periodLabel: "第1期" })
    ).toBeNull();
    expect(
      settlementEconomicIdentity("signed_contract_settlement", {
        contractKind: "downstream",
        contractVersionId: "version-1"
      })
    ).toBeNull();
    expect(settlementEconomicIdentity("payment_execution", {})).toBeNull();
  });

  it("表外与对上结算按合同关系分别取键，不互相去重", () => {
    const outside = settlementEconomicIdentity(
      "project_affiliate_settlement_fact",
      { contractLedgerId: "outside-1", periodLabel: "第1期" }
    )!;
    const upward = settlementEconomicIdentity(
      "project_affiliate_settlement_fact",
      {
        affiliateCompanyContractId: "upward-1",
        contractLedgerId: "outside-1",
        periodLabel: "第1期"
      }
    )!;
    expect(outside.contractKind).toBe("outside_fact");
    expect(upward.contractKind).toBe("upward");
    expect(settlementDedupKey(outside)).not.toBe(settlementDedupKey(upward));
  });

  it("冲突提示使用原期次并明确不再重复计成本", () => {
    const identity = settlementEconomicIdentity(
      "signed_contract_settlement",
      {
        contractKind: "downstream",
        contractVersionId: "version-1",
        settlementNumber: "JS-2026-001"
      }
    )!;
    expect(settlementCrossSourceConflict(identity)).toContain("JS-2026-001");
    expect(settlementCrossSourceConflict(identity)).toContain("不能重复计成本");
    expect(normalizeSettlementPeriod(" a  b ")).toBe("AB");
  });
});

describe("旧结算生效前的跨来源写入守卫", () => {
  it("同合同版本同期次已有新已签结算时抛出冲突", async () => {
    const { assertNoConfirmedSignedSettlementForPeriod } = await import("./settlement-source-dedup");
    const tx = {
      signedContractSettlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            number: "第 1 期",
            confirmedContractSource: { sourceRecordId: "version-1" }
          }
        ])
      }
    };
    await expect(
      assertNoConfirmedSignedSettlementForPeriod(tx as never, {
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "version-1",
        periodLabel: "第1期",
        code: "JS-001"
      })
    ).rejects.toThrow("不能重复计成本");
  });

  it("不同期次或不同合同版本不冲突", async () => {
    const { assertNoConfirmedSignedSettlementForPeriod } = await import("./settlement-source-dedup");
    const tx = {
      signedContractSettlement: {
        findMany: jest.fn().mockResolvedValue([
          {
            number: "第2期",
            confirmedContractSource: { sourceRecordId: "version-1" }
          },
          {
            number: "第1期",
            confirmedContractSource: { sourceRecordId: "version-2" }
          }
        ])
      }
    };
    await expect(
      assertNoConfirmedSignedSettlementForPeriod(tx as never, {
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "version-1",
        periodLabel: "第1期",
        code: "JS-001"
      })
    ).resolves.toBeUndefined();
  });
});

describe("已签结算确认前的跨来源写入守卫", () => {
  it("同合同版本同期次旧结算已生效时抛出冲突", async () => {
    const { assertNoLegacySettlementForSignedPeriod } = await import("./settlement-source-dedup");
    const tx = {
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          { contractVersionId: "version-1", code: "JS-001", periodLabel: "第1期" }
        ])
      }
    };
    await expect(
      assertNoLegacySettlementForSignedPeriod(tx as never, {
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "version-1",
        period: "第 1 期"
      })
    ).rejects.toThrow("不能重复计成本");
  });

  it("不同合同版本或不同期次不冲突", async () => {
    const { assertNoLegacySettlementForSignedPeriod } = await import("./settlement-source-dedup");
    const tx = {
      settlement: {
        findMany: jest.fn().mockResolvedValue([
          { contractVersionId: "version-2", code: "JS-001", periodLabel: "第1期" },
          { contractVersionId: "version-1", code: "JS-002", periodLabel: "第2期" }
        ])
      }
    };
    await expect(
      assertNoLegacySettlementForSignedPeriod(tx as never, {
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "version-1",
        period: "第1期"
      })
    ).resolves.toBeUndefined();
  });
});
