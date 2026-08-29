import { ConflictException } from "@nestjs/common";

import {
  assertFundMovementAmountConservation,
  assertFundMovementFundingComposition,
  assertFundMovementLegSet,
  assertFundMovementPurpose,
  deriveFundMovementProjection,
  deriveFundMovementLegProjection,
  type FundMovementKind
} from "./fund-movement.domain";

describe("fund movement domain", () => {
  it("requires an explicit project-fund/advance decomposition", () => {
    expect(() => assertFundMovementAmountConservation({
      paymentAmountCents: 100n,
      projectFundUsedCents: 80n,
      companyAdvanceCents: 20n
    })).not.toThrow();

    expect(() => assertFundMovementAmountConservation({
      paymentAmountCents: 100n,
      projectFundUsedCents: 101n,
      companyAdvanceCents: 0n
    })).toThrow(ConflictException);
    expect(() => assertFundMovementAmountConservation({
      paymentAmountCents: 100n,
      projectFundUsedCents: -1n,
      companyAdvanceCents: 101n
    })).toThrow("资金用途金额不能为负数");
  });

  it.each([
    ["same_project_company_transfer", 100n, 0n],
    ["temporary_project_fund_use", 100n, 0n],
    ["temporary_project_fund_return", 100n, 0n],
    ["company_advance", 0n, 100n],
    ["company_advance_recovery", 100n, 0n]
  ] as const)("requires the frozen funding decomposition for %s", (kind, projectFundUsedCents, companyAdvanceCents) => {
    expect(() => assertFundMovementFundingComposition({
      kind,
      paymentAmountCents: 100n,
      projectFundUsedCents,
      companyAdvanceCents
    })).not.toThrow();
  });

  it("rejects an advance or recovery that swaps the funding component", () => {
    expect(() => assertFundMovementFundingComposition({
      kind: "company_advance",
      paymentAmountCents: 100n,
      projectFundUsedCents: 100n,
      companyAdvanceCents: 0n
    })).toThrow("公司垫资必须全部由公司垫资组成");
    expect(() => assertFundMovementFundingComposition({
      kind: "company_advance_recovery",
      paymentAmountCents: 100n,
      projectFundUsedCents: 0n,
      companyAdvanceCents: 100n
    })).toThrow("公司垫资收回必须由项目资金偿还");
  });

  it.each([
    "cross_project_payment",
    "same_project_company_transfer",
    "temporary_project_fund_use",
    "temporary_project_fund_return",
    "company_advance",
    "company_advance_recovery"
  ] as const)("keeps the purpose vocabulary closed for %s", (kind) => {
    expect(() => assertFundMovementPurpose({
      kind,
      sourceProjectId: "project-a",
      beneficiaryProjectId: kind === "cross_project_payment" ? "project-b" : "project-a",
      sourceCompanyId: "company-a",
      beneficiaryCompanyId: "company-b"
    })).not.toThrow();
  });

  it("projects cross-project source and beneficiary legs independently", () => {
    expect(deriveFundMovementLegProjection({
      kind: "cross_project_payment",
      role: "source",
      direction: "decrease",
      amountCents: 100n
    })).toEqual({
      consolidatedFundsDeltaCents: -100n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: 0n,
      relationshipDeltaCents: 100n
    });
    expect(deriveFundMovementLegProjection({
      kind: "cross_project_payment",
      role: "beneficiary",
      direction: "increase",
      amountCents: 100n
    })).toEqual({
      consolidatedFundsDeltaCents: 0n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: -100n,
      relationshipDeltaCents: -100n
    });
  });

  it("reverses the relationship when temporary funds or advances are returned", () => {
    expect(deriveFundMovementProjection({
      kind: "temporary_project_fund_return",
      direction: "increase",
      amountCents: 100n
    })).toEqual({
      consolidatedFundsDeltaCents: 100n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: 0n,
      relationshipDeltaCents: -100n
    });
    expect(deriveFundMovementProjection({
      kind: "company_advance_recovery",
      direction: "increase",
      amountCents: 100n
    })).toEqual({
      consolidatedFundsDeltaCents: -100n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: 0n,
      relationshipDeltaCents: -100n
    });
  });

  it("puts advance recovery funding on the beneficiary project leg", () => {
    expect(deriveFundMovementLegProjection({
      kind: "company_advance",
      role: "source",
      direction: "decrease",
      amountCents: 100n
    }).consolidatedFundsDeltaCents).toBe(0n);
    expect(deriveFundMovementLegProjection({
      kind: "company_advance_recovery",
      role: "source",
      direction: "increase",
      amountCents: 100n
    }).consolidatedFundsDeltaCents).toBe(0n);
    expect(deriveFundMovementLegProjection({
      kind: "company_advance_recovery",
      role: "beneficiary",
      direction: "decrease",
      amountCents: 100n
    })).toEqual({
      consolidatedFundsDeltaCents: -100n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: -100n,
      relationshipDeltaCents: 100n
    });
  });

  it("rejects free-purpose and profit execution without effective #109 authorization", () => {
    expect(() => assertFundMovementPurpose({
      kind: "free_text" as FundMovementKind,
      sourceProjectId: "project-a",
      beneficiaryProjectId: "project-b",
      sourceCompanyId: "company-a",
      beneficiaryCompanyId: "company-b"
    })).toThrow("资金移动用途不在允许范围内");
    expect(() => assertFundMovementPurpose({
      kind: "profit_distribution_execution",
      sourceProjectId: "project-a",
      beneficiaryProjectId: "project-a",
      sourceCompanyId: "company-a",
      beneficiaryCompanyId: "company-a"
    })).toThrow("利润分配执行必须引用 #109 生效授权");

    expect(() => assertFundMovementPurpose({
      kind: "quarantine" as FundMovementKind,
      sourceProjectId: "project-a",
      beneficiaryProjectId: "project-b",
      sourceCompanyId: "company-a",
      beneficiaryCompanyId: "company-b"
    })).toThrow("待核对用途不属于 #222 资金移动交付范围");
  });

  it("does not change project consolidated balances for same-project holding transfer", () => {
    expect(deriveFundMovementProjection({
      kind: "same_project_company_transfer",
      direction: "decrease",
      amountCents: 100n
    })).toEqual({
      consolidatedFundsDeltaCents: 0n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: 0n,
      relationshipDeltaCents: 0n
    });
  });

  it("accepts only an effective #109 authorization with enough remaining amount", () => {
    expect(() => assertFundMovementPurpose({
      kind: "profit_distribution_execution",
      sourceProjectId: "project-a",
      beneficiaryProjectId: "project-a",
      sourceCompanyId: "company-a",
      beneficiaryCompanyId: "company-a",
      amountCents: 100n,
      profitAuthorization: {
        issueKey: "#109",
        authorizationId: "authorization-1",
        status: "effective",
        remainingAmountCents: 100n
      }
    })).not.toThrow();

    expect(() => assertFundMovementPurpose({
      kind: "profit_distribution_execution",
      sourceProjectId: "project-a",
      beneficiaryProjectId: "project-a",
      sourceCompanyId: "company-a",
      beneficiaryCompanyId: "company-a",
      amountCents: 101n,
      profitAuthorization: {
        issueKey: "#109",
        authorizationId: "authorization-1",
        status: "effective",
        remainingAmountCents: 100n
      }
    })).toThrow("利润分配执行超过 #109 授权剩余额度");
  });

  it("keeps cross-project movement as two explicit legs with opposite internal relationship deltas", () => {
    expect(deriveFundMovementProjection({
      kind: "cross_project_payment",
      direction: "decrease",
      amountCents: 100n
    })).toEqual({
      consolidatedFundsDeltaCents: -100n,
      consolidatedCostDeltaCents: 0n,
      consolidatedRevenueDeltaCents: 0n,
      consolidatedPayableDeltaCents: 0n,
      relationshipDeltaCents: 100n
    });
  });

  it("requires one full-value source leg and one full-value beneficiary leg", () => {
    expect(() => assertFundMovementLegSet({
      kind: "cross_project_payment",
      paymentAmountCents: 100n,
      legs: [
        { role: "source", amountCents: 100n },
        { role: "beneficiary", amountCents: 100n }
      ]
    })).not.toThrow();

    expect(() => assertFundMovementLegSet({
      kind: "cross_project_payment",
      paymentAmountCents: 100n,
      legs: [
        { role: "source", amountCents: 100n },
        { role: "beneficiary", amountCents: 99n }
      ]
    })).toThrow("资金移动每条分腿必须等于移动金额");

    expect(() => assertFundMovementLegSet({
      kind: "same_project_company_transfer",
      paymentAmountCents: 100n,
      legs: [
        { role: "source", amountCents: 100n },
        { role: "beneficiary", amountCents: 100n }
      ]
    })).not.toThrow();
  });

  it.each([
    ["cross_project_payment", "project-a", "project-b", "decrease", "increase"],
    ["same_project_company_transfer", "project-a", "project-a", "decrease", "increase"],
    ["temporary_project_fund_use", "project-a", "project-a", "decrease", "increase"],
    ["temporary_project_fund_return", "project-a", "project-a", "increase", "decrease"],
    ["company_advance", "project-a", "project-a", "decrease", "increase"],
    ["company_advance_recovery", "project-a", "project-a", "increase", "decrease"],
    ["profit_distribution_execution", "project-a", "project-a", "decrease", "increase"]
  ] as const)("requires directionally complete legs for %s", (
    kind,
    sourceProjectId,
    beneficiaryProjectId,
    sourceDirection,
    beneficiaryDirection
  ) => {
    expect(() => assertFundMovementLegSet({
      kind,
      paymentAmountCents: 100n,
      sourceProjectId,
      beneficiaryProjectId,
      sourceCompanyId: "company-a",
      beneficiaryCompanyId: "company-b",
      legs: [
        {
          role: "source",
          amountCents: 100n,
          projectId: sourceProjectId,
          companyEntityId: "company-a",
          direction: sourceDirection
        },
        {
          role: "beneficiary",
          amountCents: 100n,
          projectId: beneficiaryProjectId,
          companyEntityId: "company-b",
          direction: beneficiaryDirection
        }
      ]
    })).not.toThrow();
  });
});
