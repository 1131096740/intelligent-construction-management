import { BadRequestException } from "@nestjs/common";
import {
  assertContractSettlementCapacity,
  assertSettlementContractType,
  historicalPositiveIncreaseCents,
  isUnlimitedFrameworkContract,
  SettlementContractCapacityDenial
} from "./contract-settlement-capacity";

const version = (overrides: Partial<Parameters<typeof assertContractSettlementCapacity>[0]> = {}) => ({
  contractId: "contract-1",
  contractVersionId: "version-1",
  contractAmountCents: 1_000n,
  historicalPositiveIncreaseCents: 0n,
  pricingNature: "fixed_total",
  amountLimitType: "capped",
  ...overrides
});

describe("contract settlement capacity", () => {
  it.each(["material_purchase", "equipment_rental", "labor_subcontract", "professional_subcontract"])(
    "allows the four settlement contract types: %s",
    (contractTypeKey) => expect(() => assertSettlementContractType(contractTypeKey)).not.toThrow()
  );

  it("fails closed for general, missing, and unknown contract types", () => {
    expect(() => assertSettlementContractType("generic_contract")).toThrow("通用合同直接按冻结付款条款申请付款，不办理结算");
    expect(() => assertSettlementContractType(null)).toThrow(BadRequestException);
    expect(() => assertSettlementContractType(undefined)).toThrow(BadRequestException);
    expect(() => assertSettlementContractType("other")).toThrow("合同类型未明确或不支持结算");
  });

  it("allows exactly the current contract cap and rejects one cent over it", () => {
    expect(() => assertContractSettlementCapacity(version(), 700n, 300n)).not.toThrow();
    const error = (() => {
      try { assertContractSettlementCapacity(version(), 700n, 301n); } catch (caught) { return caught; }
    })();
    expect(error).toBeInstanceOf(SettlementContractCapacityDenial);
    expect((error as Error).message).toContain("请先完成合同变更");
  });

  it("requires a new contract after a positive change has already raised the cap", () => {
    expect(() => assertContractSettlementCapacity(
      version({ contractAmountCents: 1_100n, historicalPositiveIncreaseCents: 100n }),
      1_000n,
      101n
    )).toThrow("必须新签合同");
  });

  it("does not treat a decrease as prior positive increase", () => {
    expect(() => assertContractSettlementCapacity(
      version({ contractAmountCents: 900n, historicalPositiveIncreaseCents: 0n }),
      900n,
      1n
    )).toThrow("请先完成合同变更");
  });

  it("skips only the total cap for an unlimited framework contract", () => {
    const unlimited = version({ pricingNature: "framework", amountLimitType: "unlimited", contractAmountCents: 0n });
    expect(isUnlimitedFrameworkContract(unlimited)).toBe(true);
    expect(() => assertContractSettlementCapacity(unlimited, 9_223_372_036_854_775_000n, 807n)).not.toThrow();
  });

  it("derives prior positive increases from the once-effective lineage, not copied current fields", () => {
    expect(historicalPositiveIncreaseCents([
      {
        id: "root",
        baseVersionId: null,
        changeType: "historical_takeover",
        changeDirection: null,
        changeAmountCents: null,
        cumulativeIncreaseCents: 20n,
        status: "superseded",
        effectiveAt: new Date("2026-01-01")
      },
      {
        id: "change-1",
        baseVersionId: "root",
        changeType: "change",
        changeDirection: "increase",
        changeAmountCents: 30n,
        cumulativeIncreaseCents: 999n,
        status: "superseded",
        effectiveAt: new Date("2026-02-01")
      },
      {
        id: "change-2",
        baseVersionId: "change-1",
        changeType: "change",
        changeDirection: "decrease",
        changeAmountCents: 10n,
        cumulativeIncreaseCents: 999n,
        status: "effective",
        effectiveAt: new Date("2026-03-01")
      },
      {
        id: "change-3",
        baseVersionId: "change-2",
        changeType: "supplement",
        changeDirection: "increase",
        changeAmountCents: 50n,
        cumulativeIncreaseCents: 999n,
        status: "draft",
        effectiveAt: null
      },
      {
        id: "change-4",
        baseVersionId: "change-3",
        changeType: "change",
        changeDirection: "increase",
        changeAmountCents: -90n,
        cumulativeIncreaseCents: 999n,
        status: "effective",
        effectiveAt: new Date("2026-04-01")
      }
    ])).toBe(50n);
  });

  it.each([
    ["change", "effective", new Date("2026-01-01"), 0n, "原合同版本类型异常"],
    ["original", "draft", null, 0n, "原合同版本尚未生效"],
    ["historical_takeover", "effective", new Date("2026-01-01"), -1n, "历史合同累计增项事实异常"]
  ] as const)(
    "fails closed for an invalid lineage root: %s/%s",
    (changeType, status, effectiveAt, cumulativeIncreaseCents, expectedMessage) => {
      expect(() => historicalPositiveIncreaseCents([{
        id: "root",
        baseVersionId: null,
        changeType,
        changeDirection: null,
        changeAmountCents: null,
        cumulativeIncreaseCents,
        status,
        effectiveAt
      }])).toThrow(expectedMessage);
    }
  );
});
