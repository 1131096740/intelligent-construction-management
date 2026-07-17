import {
  settlementFrozenDocumentInput,
  settlementFrozenBusinessSnapshotToken,
  type FrozenDraftBusinessSnapshot
} from "./settlement-document-facts";

function snapshot(): FrozenDraftBusinessSnapshot {
  return {
    draftId: "draft-1",
    revision: 3,
    settlementCode: "JS-001",
    periodLabel: "2026-07",
    settlementTemplateVersionId: "template-1",
    contractId: "contract-1",
    contractVersionId: "version-2",
    paymentTermsVersionId: "terms-2",
    projectName: "示例项目",
    contractCode: "HT-001",
    contractName: "钢材采购合同",
    contractTypeKey: "material_purchase",
    counterparty: "示例供应商",
    companyEntityName: "示例建设公司",
    taxFactRevision: 4,
    invoiceType: "vat_special",
    taxMode: "single_rate",
    defaultTaxRatePercent: "13",
    isFinal: false,
    fieldReviewerUserId: "material-1",
    fieldReviewerRoleKey: "material_staff",
    calculated: {
      lines: [
        {
          sourceType: "contract_bill_row",
          name: "钢材",
          specification: "HRB400",
          unit: "吨",
          quantity: "2",
          taxInclusiveUnitPrice: "561",
          taxExclusiveUnitPrice: "496.46",
          taxRatePercent: "13",
          taxInclusiveAmountCents: 112_200n,
          taxExclusiveAmountCents: 99_292n,
          taxAmountCents: 12_908n,
          remark: null
        }
      ],
      amountCents: 112_200n,
      previousEffectiveSettlementCents: 2_000_000n,
      finalCumulativeAmountCents: null,
      currentSettlementStage: { id: "stage-1", ratioBps: 8500 },
      payableAmountCents: 95_370n
    }
  };
}

describe("settlement frozen document facts", () => {
  it("binds normalized lines, prior cumulative, payable, tax revision and contract version", () => {
    const first = snapshot();
    const token = settlementFrozenBusinessSnapshotToken(first);
    expect(token).toMatch(/^[0-9a-f]{64}$/u);

    for (const change of [
      (value: FrozenDraftBusinessSnapshot) => { value.calculated.lines[0]!.taxInclusiveAmountCents += 1n; },
      (value: FrozenDraftBusinessSnapshot) => { value.calculated.previousEffectiveSettlementCents += 1n; },
      (value: FrozenDraftBusinessSnapshot) => { value.calculated.payableAmountCents += 1n; },
      (value: FrozenDraftBusinessSnapshot) => { value.calculated.currentSettlementStage.ratioBps = 8000; },
      (value: FrozenDraftBusinessSnapshot) => { value.calculated.finalCumulativeAmountCents = 2_112_200n; },
      (value: FrozenDraftBusinessSnapshot) => { value.taxFactRevision += 1; },
      (value: FrozenDraftBusinessSnapshot) => { value.contractVersionId = "version-3"; }
    ]) {
      const changed = snapshot();
      change(changed);
      expect(settlementFrozenBusinessSnapshotToken(changed)).not.toBe(token);
    }
  });

  it("includes the formal inclusive/exclusive/tax facts without recomputation", () => {
    const input = snapshot();
    expect(input.calculated.lines[0]).toEqual(expect.objectContaining({
      specification: "HRB400",
      taxInclusiveUnitPrice: "561",
      taxExclusiveUnitPrice: "496.46",
      taxInclusiveAmountCents: 112_200n,
      taxExclusiveAmountCents: 99_292n,
      taxAmountCents: 12_908n
    }));
  });

  it("builds process and final renderer inputs from the same formal snapshot", () => {
    const process = snapshot();
    const generatedAt = new Date("2026-07-18T01:02:03.000Z");
    expect(settlementFrozenDocumentInput(process, generatedAt)).toEqual(
      expect.objectContaining({
        amountCents: 112_200n,
        previousEffectiveSettlementCents: 2_000_000n,
        payableAmountCents: 95_370n,
        finalCumulativeAmountCents: null,
        isFinal: false,
        generatedAt,
        lines: process.calculated.lines
      })
    );

    const final = snapshot();
    final.isFinal = true;
    final.calculated.amountCents = 112_200n;
    final.calculated.finalCumulativeAmountCents = 2_112_200n;
    expect(settlementFrozenDocumentInput(final, generatedAt)).toEqual(
      expect.objectContaining({
        amountCents: 112_200n,
        previousEffectiveSettlementCents: 2_000_000n,
        finalCumulativeAmountCents: 2_112_200n,
        isFinal: true
      })
    );
  });

  it("preserves tax-exclusive facts exactly as prepared by the formal algorithm", () => {
    const input = snapshot();
    Object.assign(input.calculated.lines[0]!, {
      taxInclusiveUnitPrice: "561.00",
      taxExclusiveUnitPrice: "496.46",
      taxInclusiveAmountCents: 112_200n,
      taxExclusiveAmountCents: 99_292n,
      taxAmountCents: 12_908n
    });
    expect(settlementFrozenDocumentInput(input, new Date()).lines[0]).toEqual(
      input.calculated.lines[0]
    );
  });
});
