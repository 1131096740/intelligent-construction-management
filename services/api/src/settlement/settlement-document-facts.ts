import { createHash } from "node:crypto";
import type {
  SettlementDocumentInput,
  SettlementDocumentLine
} from "./settlement-document-renderer";

export interface FrozenDraftCalculatedFacts {
  lines: SettlementDocumentLine[];
  amountCents: bigint;
  previousEffectiveSettlementCents: bigint;
  finalCumulativeAmountCents: bigint | null;
  currentSettlementStage: { id: string; ratioBps: number | null };
  payableAmountCents: bigint;
}

export interface FrozenDraftBusinessSnapshot {
  draftId: string;
  revision: number;
  settlementCode: string;
  periodLabel: string;
  settlementTemplateVersionId: string | null;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId: string;
  projectName: string;
  contractCode: string;
  contractName: string;
  contractTypeKey: string;
  counterparty: string;
  companyEntityName: string;
  taxFactRevision: number;
  invoiceType: string | null;
  taxMode: string;
  defaultTaxRatePercent: string | null;
  isFinal: boolean;
  fieldReviewerUserId: string | null;
  fieldReviewerRoleKey: string | null;
  calculated: FrozenDraftCalculatedFacts;
}

export function settlementFrozenBusinessSnapshotToken(
  input: FrozenDraftBusinessSnapshot
): string {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

export function settlementFrozenDocumentInput(
  snapshot: FrozenDraftBusinessSnapshot,
  generatedAt: Date
): SettlementDocumentInput {
  return {
    settlementId: snapshot.draftId,
    settlementCode: snapshot.settlementCode,
    periodLabel: snapshot.periodLabel,
    status: "乙方签署前冻结版",
    projectName: snapshot.projectName,
    contractCode: snapshot.contractCode,
    contractName: snapshot.contractName,
    counterparty: snapshot.counterparty,
    companyEntityName: snapshot.companyEntityName,
    amountCents: snapshot.calculated.amountCents,
    invoiceType: invoiceTypeLabel(snapshot.invoiceType),
    taxMode: taxModeLabel(snapshot.taxMode),
    defaultTaxRatePercent: snapshot.defaultTaxRatePercent,
    taxFactRevision: snapshot.taxFactRevision,
    finalCumulativeAmountCents:
      snapshot.calculated.finalCumulativeAmountCents,
    payableAmountCents: snapshot.calculated.payableAmountCents,
    previousEffectiveSettlementCents:
      snapshot.calculated.previousEffectiveSettlementCents,
    isFinal: snapshot.isFinal,
    generatedAt,
    documentRevision: snapshot.revision,
    contractTypeKey:
      snapshot.contractTypeKey as SettlementDocumentInput["contractTypeKey"],
    fieldReviewerRoleKey:
      snapshot.fieldReviewerRoleKey as SettlementDocumentInput["fieldReviewerRoleKey"],
    lines: snapshot.calculated.lines,
    approvalRows: []
  };
}

function invoiceTypeLabel(value: string | null): string {
  if (value === "vat_general") return "增值税普通发票";
  if (value === "vat_special") return "增值税专用发票";
  return "—";
}

function taxModeLabel(value: string): string {
  if (value === "single_rate") return "单一税率";
  if (value === "multiple_rate") return "多税率";
  return "—";
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)])
    );
  }
  return value;
}
