import { contractChangeVersionsReadModel } from "./contract-change-read-model";

const original = {
  id: "internal-version-v1",
  versionNo: 1,
  status: "effective",
  changeType: "original",
  baseVersionId: null,
  supersedesVersionId: null,
  changeReason: null,
  changeDirection: null,
  changeAmountCents: null,
  amountCents: 1_000_000n,
  amountLimitType: "capped",
  originalBaseAmountCents: null,
  cumulativeIncreaseCents: 0n,
  cumulativeDecreaseCents: 0n
};

const supplement = {
  id: "internal-version-v2",
  versionNo: 2,
  status: "pending_archive_confirm",
  changeType: "supplement",
  baseVersionId: original.id,
  supersedesVersionId: null,
  changeReason: "补充工程量",
  changeDirection: "increase",
  changeAmountCents: 200_000n,
  amountCents: 1_200_000n,
  amountLimitType: "capped",
  originalBaseAmountCents: 1_000_000n,
  cumulativeIncreaseCents: 200_000n,
  cumulativeDecreaseCents: 0n
};

describe("contractChangeVersionsReadModel", () => {
  it("projects a structured pending archive replacement before confirmation", () => {
    const result = contractChangeVersionsReadModel([supplement, original]);

    expect(result[0].archiveEffect).toEqual({
      status: "pending",
      replacesVersionNo: 1,
      beforeAmountCents: "1000000",
      afterAmountCents: "1200000",
      historyReferencesStable: true
    });
    expect(JSON.stringify(result)).not.toContain("internal-version");
    expect(result[0]).not.toHaveProperty("baseVersionId");
    expect(result[0]).not.toHaveProperty("supersedesVersionId");
    expect(result[0]).not.toHaveProperty("id");
  });

  it("marks the same replacement completed after atomic archive confirmation", () => {
    const result = contractChangeVersionsReadModel([
      { ...supplement, status: "effective", supersedesVersionId: original.id },
      { ...original, status: "superseded" }
    ]);

    expect(result[0].archiveEffect).toEqual({
      status: "completed",
      replacesVersionNo: 1,
      beforeAmountCents: "1000000",
      afterAmountCents: "1200000",
      historyReferencesStable: true
    });
  });

  it("keeps a completed archive effect after the change version is later superseded", () => {
    const result = contractChangeVersionsReadModel([
      { ...supplement, status: "superseded", supersedesVersionId: original.id },
      { ...original, status: "superseded" }
    ]);

    expect(result[0].archiveEffect).toEqual({
      status: "completed",
      replacesVersionNo: 1,
      beforeAmountCents: "1000000",
      afterAmountCents: "1200000",
      historyReferencesStable: true
    });
  });

  it("does not project an archive effect before the change reaches archive confirmation", () => {
    const result = contractChangeVersionsReadModel([
      { ...supplement, status: "draft" },
      original
    ]);

    expect(result[0].archiveEffect).toBeNull();
  });

  it.each([
    [
      "effective change without its direct supersedes edge",
      { ...supplement, status: "effective", supersedesVersionId: null },
      { ...original, status: "superseded" }
    ],
    [
      "pending change with a premature supersedes edge",
      { ...supplement, supersedesVersionId: original.id },
      original
    ]
  ])("fails closed for %s", (_label, changed, base) => {
    expect(() => contractChangeVersionsReadModel([changed, base])).toThrow(
      "合同版本归档替代谱系异常"
    );
  });
});
