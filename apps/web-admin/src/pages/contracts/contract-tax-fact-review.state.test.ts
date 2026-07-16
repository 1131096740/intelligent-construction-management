import { describe, expect, it } from "vitest";
import type {
  ContractTaxFactRevisionListReadModel,
  ContractTaxFactRevisionReadModel
} from "../../api/contract-tax-facts.api";
import {
  buildContractTaxFactReviewState,
  createContractTaxFactDraft,
  normalizeContractTaxFactDraft,
  revisionStatusLabel
} from "./contract-tax-fact-review.state";

describe("contract tax fact review state", () => {
  it("never grants business actions to super_admin", () => {
    const state = buildContractTaxFactReviewState({
      data: list(),
      missingFields: ["发票类型", "默认税率"],
      userId: "admin-1",
      roleKeys: ["super_admin"]
    });

    expect(state.canRead).toBe(false);
    expect(state.canCreate).toBe(false);
    expect(state.canEdit).toBe(false);
    expect(state.canSubmitFinance).toBe(false);
    expect(state.canFinanceReview).toBe(false);
    expect(state.canContractConfirm).toBe(false);
  });

  it("allows only the real role at each frozen workflow state", () => {
    const draft = revision({ status: "draft", createdByUserId: "contract-staff-1" });
    const contractStaff = buildContractTaxFactReviewState({
      data: list({ revisions: [draft] }),
      missingFields: ["默认税率"],
      userId: "contract-staff-1",
      roleKeys: ["contract_staff"]
    });
    expect(contractStaff.canEdit).toBe(true);
    expect(contractStaff.canSubmitFinance).toBe(true);
    expect(contractStaff.canFinanceReview).toBe(false);

    const finance = buildContractTaxFactReviewState({
      data: list({ revisions: [revision({ status: "pending_finance_review" })] }),
      missingFields: ["默认税率"],
      userId: "finance-1",
      roleKeys: ["finance_director"]
    });
    expect(finance.canFinanceReview).toBe(true);
    expect(finance.canContractConfirm).toBe(false);

    const contractDirector = buildContractTaxFactReviewState({
      data: list({ revisions: [revision({ status: "pending_contract_confirmation" })] }),
      missingFields: ["默认税率"],
      userId: "director-1",
      roleKeys: ["contract_director"]
    });
    expect(contractDirector.canContractConfirm).toBe(true);
    expect(contractDirector.canFinanceReview).toBe(false);
  });

  it.each([
    "finance_staff",
    "comprehensive_director"
  ] as const)("grants %s read-only tax revision access without any write action", (roleKey) => {
    const state = buildContractTaxFactReviewState({
      data: list({ revisions: [revision({ status: "pending_finance_review" })] }),
      missingFields: ["默认税率"],
      userId: "reader-1",
      roleKeys: [roleKey]
    });

    expect(state.canRead).toBe(true);
    expect(state.canCreate).toBe(false);
    expect(state.canEdit).toBe(false);
    expect(state.canSubmitFinance).toBe(false);
    expect(state.canFinanceReview).toBe(false);
    expect(state.canContractConfirm).toBe(false);
  });

  it("explains the settlement release condition without treating missing facts as zero", () => {
    const blocked = buildContractTaxFactReviewState({
      data: list(),
      missingFields: ["发票类型", "清单项目“钢材”含税单价"],
      userId: "contract-staff-1",
      roleKeys: ["contract_staff"]
    });
    expect(blocked.gapText).toBe("发票类型、清单项目“钢材”含税单价");
    expect(blocked.settlementReleaseText).toContain("财务复核");
    expect(blocked.settlementReleaseText).toContain("合同部确认");
    expect(blocked.settlementReleaseText).toContain("缺口清零");

    const released = buildContractTaxFactReviewState({
      data: list({
        current: {
          ...list().current,
          status: "confirmed",
          invoiceType: "vat_special",
          defaultTaxRatePercent: "13"
        }
      }),
      missingFields: [],
      userId: "director-1",
      roleKeys: ["contract_director"]
    });
    expect(released.settlementReleaseText).toContain("已解除税务事实阻断");
  });

  it("keeps agreed-term changes outside the revision draft and validates two decimals", () => {
    const draft = createContractTaxFactDraft(list().current, null);
    draft.invoiceType = "vat_special";
    draft.defaultTaxRatePercent = "13.00";
    draft.source = "contract_document";
    draft.confirmationExplanation = "按原合同签署页核对";

    expect(normalizeContractTaxFactDraft(draft)).toEqual({
      kind: "supplement",
      invoiceType: "vat_special",
      taxMode: "single_rate",
      defaultTaxRatePercent: "13.00",
      source: "contract_document",
      confirmationExplanation: "按原合同签署页核对",
      rowFacts: []
    });
    draft.defaultTaxRatePercent = "13.001";
    expect(() => normalizeContractTaxFactDraft(draft)).toThrow("最多保留 2 位小数");
  });

  it("hydrates the first revision with current bill row ids and preserves row overrides", () => {
    const draft = createContractTaxFactDraft(list().current, null, [
      {
        contractBillRowId: "row-1",
        billName: "材料清单",
        rowKey: "ROW-1",
        itemName: "钢筋",
        specification: "HRB400",
        unit: "吨",
        taxInclusiveUnitPrice: null,
        taxRatePercent: null,
        taxRateSource: "version_default",
        pricingFactStatus: "unconfirmed"
      },
      {
        contractBillRowId: "row-2",
        billName: "材料清单",
        rowKey: "ROW-2",
        itemName: "混凝土",
        specification: "C30",
        unit: "立方米",
        taxInclusiveUnitPrice: "360.00",
        taxRatePercent: "9",
        taxRateSource: "row_override",
        pricingFactStatus: "confirmed"
      }
    ]);

    expect(draft.rowFacts).toEqual([
      {
        contractBillRowId: "row-1",
        taxInclusiveUnitPrice: "",
        taxRatePercentOverride: ""
      },
      {
        contractBillRowId: "row-2",
        taxInclusiveUnitPrice: "360.00",
        taxRatePercentOverride: "9"
      }
    ]);
  });

  it("builds a readable revision timeline with review comments", () => {
    const state = buildContractTaxFactReviewState({
      data: list({
        revisions: [
          revision({
            status: "confirmed",
            financeReviewComment: "财务核对通过",
            contractReviewComment: "合同部确认完成"
          })
        ]
      }),
      missingFields: [],
      userId: "director-1",
      roleKeys: ["contract_director"]
    });

    expect(revisionStatusLabel("pending_contract_confirmation")).toBe("待合同部确认");
    expect(state.timeline[0]?.title).toContain("第 1 次补录");
    expect(state.timeline[0]?.comments).toEqual([
      "财务意见：财务核对通过",
      "合同部意见：合同部确认完成"
    ]);
  });
});

function list(
  overrides: Partial<ContractTaxFactRevisionListReadModel> = {}
): ContractTaxFactRevisionListReadModel {
  return {
    contractId: "contract-1",
    current: {
      invoiceType: null,
      taxMode: "single_rate",
      defaultTaxRatePercent: null,
      status: "unconfirmed",
      source: null,
      confirmationExplanation: null,
      evidenceFileId: null,
      revision: 0
    },
    rows: [],
    revisions: [],
    ...overrides
  };
}

function revision(
  overrides: Partial<ContractTaxFactRevisionReadModel> = {}
): ContractTaxFactRevisionReadModel {
  return {
    id: "revision-1",
    revisionNo: 1,
    kind: "supplement",
    status: "draft",
    invoiceType: "vat_special",
    taxMode: "single_rate",
    defaultTaxRatePercent: "13",
    source: "contract_document",
    confirmationExplanation: "按原合同签署页核对",
    evidenceFileId: null,
    rowFacts: [],
    beforeSnapshot: {},
    createdByUserId: "contract-staff-1",
    submittedByUserId: null,
    submittedAt: null,
    financeReviewedByUserId: null,
    financeReviewedAt: null,
    financeReviewComment: null,
    confirmedByUserId: null,
    confirmedAt: null,
    contractReviewComment: null,
    createdAt: "2026-07-17T01:00:00.000Z",
    updatedAt: "2026-07-17T01:00:00.000Z",
    ...overrides
  };
}
