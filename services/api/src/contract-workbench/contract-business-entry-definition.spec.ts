import { Prisma, type ContractVersion } from "@prisma/client";
import { createBusinessEntryDefinitionRegistry } from "@jiangkong/shared-domain";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";
import { CONTRACT_COMMERCIAL_ENTRY_DEFINITION, CONTRACT_PAYMENT_STAGE_ENTRY_DEFINITION, contractBasicEntryValues, contractCommercialEntryValues, contractPartyRoleName } from "./contract-business-entry-definition";

describe("contract business entry definitions", () => {
  it("freezes the inherited contract name for a change draft without overriding an explicit draft name", () => {
    expect(contractBasicEntryValues({}, "原合同名称")).toMatchObject({ contractName: "原合同名称" });
    expect(contractBasicEntryValues({ contractName: "草稿合同名称" }, "原合同名称")).toMatchObject({
      contractName: "草稿合同名称"
    });
    expect(contractBasicEntryValues({ contractName: "" }, "原合同名称")).toMatchObject({ contractName: "" });
  });

  it("keeps exact money text, tax rate zero, and omits absent optional facts", () => {
    const version = {
      pricingNature: "fixed_total",
      amountSource: "manual",
      amountCents: 900719925474099300n,
      estimatedAmountCents: null,
      amountAdjustmentReason: null,
      invoiceType: null,
      taxMode: "single_rate",
      defaultTaxRatePercent: new Prisma.Decimal(0),
      taxFactSource: "contract_document"
    } as ContractVersion;

    const values = contractCommercialEntryValues(version);
    expect(values).toEqual({
      pricingNature: "fixed_total",
      amountSource: "manual",
      contractAmountYuan: "9007199254740993.00",
      taxMode: "single_rate",
      defaultTaxRatePercent: 0,
      taxFactSource: "contract_document"
    });
    expect(createBusinessEntryDefinitionRegistry([CONTRACT_COMMERCIAL_ENTRY_DEFINITION]).validateDraft({
      sceneKey: CONTRACT_COMMERCIAL_ENTRY_DEFINITION.key,
      definitionVersion: 1,
      target: { projectId: "project-1", entityType: "contract_version", entityId: "version-1" },
      expectedRevision: 0,
      values
    }, ["contract_staff"]).valid).toBe(true);
  });

  it("uses the existing Chinese role labels without exposing an unknown technical key", () => {
    expect(contractPartyRoleName("party_b")).toBe("乙方");
    expect(contractPartyRoleName("legacy_custom_role")).toBe("主体位置待确认");
  });

  it("validates a fixed payment stage amount above one thousand yuan without grouping separators", () => {
    const values = {
      name: "固定款", stageType: "other", basis: "fixed_amount",
      fixedAmountYuan: formatMoneyCentsAsPlainYuan(500000n), triggerAnchor: "contract_effective",
      triggerEvent: "合同生效", dueDays: 0, advanceDeductionMode: "none",
      requiresInvoice: false, allowsEarlyPayment: false, allowsInstallments: true, originalText: "合同生效后支付"
    };
    const result = createBusinessEntryDefinitionRegistry([CONTRACT_PAYMENT_STAGE_ENTRY_DEFINITION]).validateDraft({
      sceneKey: CONTRACT_PAYMENT_STAGE_ENTRY_DEFINITION.key, definitionVersion: 1,
      target: { projectId: "project-1", entityType: "payment_terms_stage", entityId: "stage-1" },
      expectedRevision: 0, values
    }, ["contract_staff"]);
    expect(values.fixedAmountYuan).toBe("5000.00");
    expect(result.valid).toBe(true);
  });
});
