import type { MoneyCents } from "./money";
import type {
  ContractInvoiceType,
  ContractTaxFactSource,
  ContractTaxFactStatus,
  ContractTaxMode
} from "./contract-tax-facts";

/**
 * Contract workbench schemas and read models.
 *
 * These types are shared between the backend API and Web/mini-program frontends.
 * No runtime dependencies; all validation is hand-rolled.
 */

// ---------------------------------------------------------------------------
// Field type
// ---------------------------------------------------------------------------

export type ContractFieldType =
  | "text"
  | "long_text"
  | "number"
  | "money"
  | "date"
  | "single_select"
  | "multi_select"
  | "boolean";

const SUPPORTED_FIELD_TYPES: ReadonlySet<string> = new Set<ContractFieldType>([
  "text",
  "long_text",
  "number",
  "money",
  "date",
  "single_select",
  "multi_select",
  "boolean"
]);

// ---------------------------------------------------------------------------
// Schema definitions
// ---------------------------------------------------------------------------

export interface ContractFieldDefinition {
  key: string;
  label: string;
  type: ContractFieldType;
  required?: boolean;
  defaultValue?: unknown;
  options?: Array<{ label: string; value: string }>;
  group?: string;
  order?: number;
  visibleWhen?: { fieldKey: string; operator: "eq" | "neq"; value: unknown };
}

const MATERIAL_PURCHASE_REMOVED_FIELDS = new Set(["deliveryDeadline"]);
const OPTIONAL_PERIOD_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  equipment_rental: new Set(["rentalStartDate", "rentalEndDate"]),
  labor_subcontract: new Set(["plannedStartDate", "plannedEndDate"])
};

/**
 * Applies company-wide field policy to historical template snapshots without
 * mutating the immutable snapshot stored on a contract version.
 */
export function contractFieldsForBusinessUse(
  contractTypeKey: string | null | undefined,
  fields: ReadonlyArray<ContractFieldDefinition>
): ContractFieldDefinition[] {
  const typeKey = contractTypeKey ?? "";
  const optionalKeys = OPTIONAL_PERIOD_FIELDS[typeKey];
  return fields
    .filter((field) =>
      typeKey !== "material_purchase" || !MATERIAL_PURCHASE_REMOVED_FIELDS.has(field.key)
    )
    .map((field) =>
      optionalKeys?.has(field.key) && field.required
        ? { ...field, required: false }
        : { ...field }
    );
}

export interface ContractBillDefinition {
  key: string;
  name: string;
  amountRole: "included" | "reference" | "non_priced" | "provisional";
  pricingMode: "tax_inclusive" | "tax_exclusive";
  /** Decimal places for quantity; valid range 0–6 */
  quantityScale: number;
  /** Decimal places for unit price; company contract standard is fixed at 2 */
  unitPriceScale: number;
  columns: Array<{
    key: string;
    label: string;
    type: "text" | "number" | "boolean";
    required?: boolean;
  }>;
}

export interface ContractClauseDefinition {
  key: string;
  title: string;
  numberingMode: "automatic" | "fixed";
  required?: boolean;
  standardClauseVersionId?: string;
  content: unknown;
}

export interface ContractAttachmentDefinition {
  key: string;
  name: string;
  required: boolean;
  mustBeValid?: boolean;
}

export interface ContractValidationRule {
  key: string;
  level: "block" | "warning";
  targetClauseKey: string;
  requiredPhrases: string[];
  message: string;
}

export interface SupplementChangePolicy {
  version: 1;
  editableFieldKeys: string[];
  editableClauseKeys: string[];
  coreClauseKeys: string[];
}

export interface ContractTemplateSchema {
  fields: ContractFieldDefinition[];
  bills: ContractBillDefinition[];
  clauses: ContractClauseDefinition[];
  attachments: ContractAttachmentDefinition[];
  validations: ContractValidationRule[];
  supplementChangePolicy?: SupplementChangePolicy;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface ContractBillReadModel {
  id: string;
  billKey: string;
  name: string;
  totalAmountCents: MoneyCents;
  rows: Array<Record<string, unknown>>;
}

export interface ContractDraftCheckpointReadModel {
  id: string;
  createdAt: string;
  label: string;
  draftData: Record<string, unknown>;
}

export interface ContractCompanyEntitySelection {
  id: string;
  versionId: string;
  versionNo: number;
  name: string;
  unifiedSocialCreditCode: string;
  registeredAddress: string | null;
}

export interface ContractGeneratedDocumentReadModel {
  id: string;
  name: string;
  generatedAt: string;
  cosKey: string;
}

export interface ContractReadinessResult {
  ready: boolean;
  blockingMessages: string[];
  warningMessages: string[];
}

export type ContractPricingPolicy =
  | { kind: "fixed_total_without_bill"; amountSource: "manual" }
  | { kind: "priced_bill"; amountSource: "bill_sum" }
  | {
      kind: "unlimited_framework";
      amountSource: "bill_sum";
      contractAmountCents: 0n;
    };

export function contractPricingPolicy(input: {
  pricingNature: string;
  amountLimitType: string;
  hasPricedRows: boolean;
}): ContractPricingPolicy {
  if (
    input.pricingNature === "framework" &&
    input.amountLimitType === "unlimited"
  ) {
    return {
      kind: "unlimited_framework",
      amountSource: "bill_sum",
      contractAmountCents: 0n
    };
  }
  if (input.hasPricedRows || input.pricingNature !== "fixed_total") {
    return { kind: "priced_bill", amountSource: "bill_sum" };
  }
  return { kind: "fixed_total_without_bill", amountSource: "manual" };
}

export interface ContractWorkbenchReadModel {
  lifecycleKind?: "pristine_draft" | "approval_draft";
  availableLifecycleActions?: Array<"delete_pristine_draft" | "abandon_application">;
  lifecycleBlockers?: string[];
  contract: {
    id: string;
    temporaryCode: string;
    code: string | null;
    projectId: string;
    contractTypeKey: string;
    ownerUserId: string;
    name: string;
  };
  version: {
    id: string;
    versionNo: number;
    status: string;
    draftRevision: number;
    contractGovernanceVersion?: number | null;
    amountCents: MoneyCents;
    pricingNature: string;
    amountSource: string;
    taxFacts: {
      invoiceType: ContractInvoiceType | null;
      taxMode: ContractTaxMode;
      defaultTaxRatePercent: string | null;
      status: ContractTaxFactStatus;
      source: ContractTaxFactSource | null;
      revision: number;
      frozenAt: string | null;
    };
    draftData: Record<string, unknown>;
    clauseSnapshot: ContractClauseDefinition[];
    templateSnapshot: {
      fieldSchema: ContractTemplateSchema["fields"];
      billSchema: ContractTemplateSchema["bills"];
      clauseSchema: ContractTemplateSchema["clauses"];
      attachmentSchema: ContractTemplateSchema["attachments"];
      validationSchema: ContractTemplateSchema["validations"];
    };
  };
  parties: Array<{
    id: string;
    roleKey: string;
    displayOrder: number;
    businessPartyVersionId?: string;
    snapshot: Record<string, unknown>;
  }>;
  bills: ContractBillReadModel[];
  paymentTerms: {
    originalText: string;
    stages: Array<{
      id: string;
      name: string;
      basis: string;
      ratioBps: number | null;
      triggerEvent: string;
      dueDays: number;
      requiresInvoice: boolean;
      allowsInstallments: boolean;
      originalText: string;
    }>;
  };
  checkpoints: ContractDraftCheckpointReadModel[];
  documents: ContractGeneratedDocumentReadModel[];
  governance?: {
    version: 1;
    authorizationLinks: Array<{
      id: string;
      side: string;
      required: boolean;
      authorizationId: string | null;
      reusedFromContractVersionId: string | null;
    }>;
    authorizations: Array<{
      id: string;
      originContractVersionId: string;
      side: string;
      grantorName: string;
      agentName: string;
      scopeSummary: string;
      fileId: string;
      contentSha256: string;
      pageCount: number;
      status: string;
    }>;
    authorizationReuseCandidates: Array<{
      authorizationId: string;
      sourceContractVersionId: string;
      sourceVersionNo: number;
      sourceVersionStatus: string;
      side: string;
      grantorName: string;
      agentName: string;
      scopeSummary: string;
      contentSha256: string;
      pageCount: number;
      fileStatus: "active";
    }>;
    formalFiles: Array<{
      id: string;
      purpose: string;
      fileId: string;
      contentSha256: string;
      pageCount: number;
      sourceRevision: number;
      status: string;
      declarationSnapshot: unknown;
    }>;
  } | null;
  readiness: ContractReadinessResult;
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Returns true only when the value is a structurally valid
 * {@link ContractFieldDefinition} with a supported (non-script/formula) type.
 *
 * Intentionally keeps the script/formula types out of
 * {@link SUPPORTED_FIELD_TYPES} so there is no back-door entry point.
 */
export function isContractFieldDefinition(value: unknown): value is ContractFieldDefinition {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v["key"] === "string" &&
    typeof v["label"] === "string" &&
    typeof v["type"] === "string" &&
    SUPPORTED_FIELD_TYPES.has(v["type"])
  );
}

// ---------------------------------------------------------------------------
// Schema validator
// ---------------------------------------------------------------------------

/** Asserts no duplicate keys within an array of items that each have a `key` property. */
function assertNoDuplicateKeys(
  items: ReadonlyArray<{ key: string }>,
  categoryLabel: string
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) {
      throw new Error(`Duplicate ${categoryLabel} key: ${item.key}`);
    }
    seen.add(item.key);
  }
}

/**
 * Validates a {@link ContractTemplateSchema} and throws a descriptive
 * {@link Error} on the first violation found. Returns void on success.
 *
 * Rules enforced:
 * - Field keys unique within `fields`.
 * - Bill keys unique within `bills`.
 * - Clause keys unique within `clauses`.
 * - Attachment keys unique within `attachments`.
 * - Validation keys unique within `validations`.
 * - `quantityScale` in [0, 6] for every bill.
 * - `unitPriceScale` must be exactly 2 for every bill.
 */
export function validateContractTemplateSchema(schema: ContractTemplateSchema): void {
  assertNoDuplicateKeys(schema.fields, "field");
  assertNoDuplicateKeys(schema.bills, "bill");
  assertNoDuplicateKeys(schema.clauses, "clause");
  assertNoDuplicateKeys(schema.attachments, "attachment");
  assertNoDuplicateKeys(schema.validations, "validation");

  const policy = schema.supplementChangePolicy;
  if (policy) {
    if (policy.version !== 1) throw new Error("unsupported supplement change policy version");
    const fieldKeys = new Set(schema.fields.map((field) => field.key));
    const clauseKeys = new Set(schema.clauses.map((clause) => clause.key));
    if (policy.editableFieldKeys.some((key) => !fieldKeys.has(key))) {
      throw new Error("supplement change policy contains unknown field key");
    }
    if (policy.editableFieldKeys.includes("myCompanyEntity")) {
      throw new Error("myCompanyEntity cannot be editable in supplement changes");
    }
    if ([...policy.editableClauseKeys, ...policy.coreClauseKeys].some((key) => !clauseKeys.has(key))) {
      throw new Error("supplement change policy contains unknown clause key");
    }
    if (policy.editableClauseKeys.some((key) => policy.coreClauseKeys.includes(key))) {
      throw new Error("core clauses cannot be editable in supplement changes");
    }
  }

  for (const bill of schema.bills) {
    if (bill.quantityScale < 0 || bill.quantityScale > 6) {
      throw new Error(`quantityScale must be between 0 and 6 (bill: ${bill.key})`);
    }
    if (bill.unitPriceScale !== 2) {
      throw new Error(`unitPriceScale must be exactly 2 (bill: ${bill.key})`);
    }
  }
}
