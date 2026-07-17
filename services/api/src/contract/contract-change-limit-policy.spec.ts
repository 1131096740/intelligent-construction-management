import { evaluateContractIncreaseLimit } from "./contract-change-limit-policy";

describe("evaluateContractIncreaseLimit", () => {
  it("allows exactly ten percent and rejects one cent above it", () => {
    expect(evaluateContractIncreaseLimit({
      originalAmountCents: 100_000n,
      historicalPositiveIncreaseCents: 10_000n,
      proposedChangeCents: 0n
    }).allowed).toBe(true);
    expect(evaluateContractIncreaseLimit({
      originalAmountCents: 100_000n,
      historicalPositiveIncreaseCents: 10_000n,
      proposedChangeCents: 1n
    }).allowed).toBe(false);
  });

  it("never lets a decrease return consumed increase quota", () => {
    expect(evaluateContractIncreaseLimit({
      originalAmountCents: 100_000n,
      historicalPositiveIncreaseCents: 8_000n,
      proposedChangeCents: -5_000n
    })).toMatchObject({
      allowed: true,
      positiveIncreaseAfterChangeCents: 8_000n
    });
  });

  it("uses bigint multiplication without floating point loss", () => {
    const original = 9_000_000_000_000_000_000n;
    expect(evaluateContractIncreaseLimit({
      originalAmountCents: original,
      historicalPositiveIncreaseCents: original / 10n,
      proposedChangeCents: 0n
    }).allowed).toBe(true);
  });

  it("fails closed for a missing or invalid capped baseline", () => {
    expect(evaluateContractIncreaseLimit({
      originalAmountCents: null,
      historicalPositiveIncreaseCents: 0n,
      proposedChangeCents: 0n
    }).reason).toContain("历史变更基线");
    expect(evaluateContractIncreaseLimit({
      originalAmountCents: 0n,
      historicalPositiveIncreaseCents: 0n,
      proposedChangeCents: 0n
    }).allowed).toBe(false);
  });

  it("skips the ratio only for unlimited framework contracts", () => {
    expect(evaluateContractIncreaseLimit({
      originalAmountCents: 0n,
      historicalPositiveIncreaseCents: 999n,
      proposedChangeCents: 999n,
      unlimitedFramework: true
    })).toMatchObject({ allowed: true, skipped: true });
  });
});
