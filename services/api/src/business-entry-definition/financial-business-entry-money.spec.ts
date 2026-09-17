import { createBusinessEntryDefinitionRegistry, type RoleKey } from "@jiangkong/shared-domain";
import { paymentApprovalAmountEntryValues, PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION } from "../payment/payment-approval-amount-business-entry-definition";
import { paymentRequestEntryDefinition, paymentRequestEntryValues } from "../payment/payment-request-business-entry-definition";
import { settlementBasicEntryDefinition, settlementBasicEntryValues } from "../settlement/settlement-business-entry-definition";
import { settlementLineEntryDefinition, settlementLineEntryValues } from "../settlement/settlement-line-business-entry-definition";
import { canonicalSettlementLine } from "../settlement/settlement-line-calculator";

const target = (entityType: string) => ({ projectId: "project-1", entityType, entityId: `${entityType}-1` });
const valid = (definition: Parameters<typeof createBusinessEntryDefinitionRegistry>[0][number], values: Record<string, unknown>, roles: RoleKey[]) =>
  createBusinessEntryDefinitionRegistry([definition]).validateDraft({
    sceneKey: definition.key, definitionVersion: definition.version, target: target(definition.entityType), expectedRevision: 0, values
  }, roles).valid;

describe("financial business-entry money values", () => {
  it("keeps payment request and approval amounts above one thousand yuan validator-safe", () => {
    const facts = { code: "FK-1", sourceType: "settlement", paymentSubjectType: "our_company", settlementId: "settlement-1",
      contractId: "contract-1", contractVersionId: "version-1", paymentTermsVersionId: "terms-1", paymentTermsStageId: null,
      paymentMatter: null, amountCalculationExplanation: null, requestedAmountCents: 500000n };
    expect(valid(paymentRequestEntryDefinition(facts), paymentRequestEntryValues(facts), ["contract_staff"])).toBe(true);
    expect(valid(PAYMENT_APPROVAL_AMOUNT_ENTRY_DEFINITION, paymentApprovalAmountEntryValues(500000n), ["finance_director"])).toBe(true);
  });

  it("keeps settlement header and line amounts above one thousand yuan validator-safe", () => {
    const basicFacts = { contractVersionId: "version-1", settlementTemplateVersionId: "template-1", code: "JS-1",
      periodLabel: "2026-09", periodEnd: null, isFinal: false, finalDeclarationSnapshot: null,
      finalCumulativeAmountCents: 500000n, fieldReviewerUserId: null, fieldReviewerRoleKey: null };
    const basic = settlementBasicEntryValues(basicFacts);
    expect(valid(settlementBasicEntryDefinition(basicFacts), basic, ["contract_staff"])).toBe(true);
    const facts = { sourceType: "manual_adjustment", name: "调整", amountCents: 500000n };
    expect(valid(settlementLineEntryDefinition(facts), settlementLineEntryValues(facts), ["contract_staff"])).toBe(true);
  });

  it("documents that the current number contract rejects exact decimal quantity text", () => {
    const facts = { sourceType: "manual_adjustment", name: "调整", quantity: "2.5", amountCents: 500000n };
    const result = createBusinessEntryDefinitionRegistry([settlementLineEntryDefinition(facts)]).validateDraft({
      sceneKey: "settlement_line", definitionVersion: 1, target: target("settlement_line"), expectedRevision: 0,
      values: settlementLineEntryValues(facts)
    }, ["contract_staff"]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ fieldKey: "quantity", code: "invalid_type" }));
  });

  it("documents that the current money contract rejects a legal negative manual adjustment", () => {
    const facts = canonicalSettlementLine({
      sourceType: "manual_adjustment", adjustmentKind: "over_settlement_offset",
      name: "超结冲减", amountCents: "-500000", reason: "冲减前期超结",
      relatedSettlementLineId: "settlement-line-previous", overageReason: "原清单工程量调减"
    }, undefined, 0);
    expect(facts).toMatchObject({ amountCents: -500000n, relatedSettlementLineId: "settlement-line-previous" });
    const result = createBusinessEntryDefinitionRegistry([settlementLineEntryDefinition(facts)]).validateDraft({
      sceneKey: "settlement_line", definitionVersion: 1, target: target("settlement_line"), expectedRevision: 0,
      values: settlementLineEntryValues(facts)
    }, ["contract_staff"]);
    expect(settlementLineEntryValues(facts).amountYuan).toBe("-5000.00");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ fieldKey: "amountYuan", code: "invalid_type" }));
  });
});
