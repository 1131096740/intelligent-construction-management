import { createHash } from "node:crypto";

export interface ContractDocumentContentFingerprintInput {
  templateSnapshot: unknown;
  layoutTemplateVersionId: string | null;
  parties: Array<{
    roleKey: string;
    displayOrder: number;
    businessPartyVersionId: string | null;
    snapshot: unknown;
  }>;
  subjectAndScope: unknown;
  amountAndTax: {
    pricingNature: string;
    amountSource: string;
    amountCents: string;
    estimatedAmountCents: string | null;
    amountAdjustmentReason: string | null;
    taxFacts: unknown;
    bills: Array<{
      billKey: string;
      name: string;
      amountRole: string;
      pricingMode: string;
      quantityScale: number;
      unitPriceScale: number;
      schemaSnapshot: unknown;
      sourceExcelFileId: string | null;
      taxInclusiveAmountCents: string;
      taxExclusiveAmountCents: string;
      taxAmountCents: string;
      rows: Array<{
        rowKey: string;
        sortOrder: number;
        itemCode: string | null;
        itemName: string;
        specification: string | null;
        unit: string;
        quantity: string | null;
        unitPrice: string | null;
        taxRate: string | null;
        taxRateSource: string;
        pricingFactStatus: string;
        precisionPolicy: string;
        taxInclusiveAmountCents: string | null;
        taxExclusiveAmountCents: string | null;
        taxAmountCents: string | null;
        taxExclusiveUnitPrice: string | null;
        isProvisional: boolean;
        settlementBasis: string | null;
        customData: unknown;
      }>;
    }>;
  };
  paymentTerms: {
    originalText: string;
    stages: Array<{
      name: string;
      stageType: string;
      basis: string;
      ratioBps: number | null;
      fixedAmountCents: string | null;
      triggerAnchor: string;
      triggerEvent: string;
      dueDays: number;
      advanceDeductionMode: string;
      advanceDeductionRatioBps: number | null;
      advanceDeductionStartRatioBps: number | null;
      requiresInvoice: boolean;
      allowsEarlyPayment: boolean;
      allowsInstallments: boolean;
      retentionBps: number | null;
      originalText: string;
    }>;
  } | null;
  clauses: unknown;
  attachments: Array<{
    slotKey: string;
    fileId: string;
    displayOrder: number;
  }>;
}

export function calculateContractDocumentContentFingerprint(
  input: ContractDocumentContentFingerprintInput
) {
  return sha256(stableJson({
    templateSnapshot: input.templateSnapshot,
    layoutTemplateVersionId: input.layoutTemplateVersionId,
    parties: [...input.parties]
      .sort((left, right) =>
        `${left.roleKey}:${left.displayOrder}`.localeCompare(
          `${right.roleKey}:${right.displayOrder}`
        )
      ),
    subjectAndScope: withoutWorkbenchReferences(input.subjectAndScope),
    amountAndTax: {
      ...input.amountAndTax,
      bills: [...input.amountAndTax.bills]
        .sort((left, right) => left.billKey.localeCompare(right.billKey))
        .map((bill) => ({
          ...bill,
          rows: [...bill.rows].sort((left, right) =>
            `${left.sortOrder}:${left.rowKey}`.localeCompare(
              `${right.sortOrder}:${right.rowKey}`
            )
          )
        }))
    },
    paymentTerms: input.paymentTerms,
    clauses: input.clauses,
    attachments: [...input.attachments].sort((left, right) =>
      `${left.slotKey}:${left.displayOrder}`.localeCompare(
        `${right.slotKey}:${right.displayOrder}`
      )
    )
  }));
}

function withoutWorkbenchReferences(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const draftData = { ...(value as Record<string, unknown>) };
  Reflect.deleteProperty(draftData, "workbenchReferences");
  return draftData;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
