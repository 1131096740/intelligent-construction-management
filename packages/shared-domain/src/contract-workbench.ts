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

export interface ContractBillDefinition {
  key: string;
  name: string;
  amountRole: "included" | "reference" | "non_priced" | "provisional";
  pricingMode: "tax_inclusive" | "tax_exclusive";
  /** Decimal places for quantity; valid range 0–6 */
  quantityScale: number;
  /** Decimal places for unit price; valid range 2–6 */
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

export interface ContractTemplateSchema {
  fields: ContractFieldDefinition[];
  bills: ContractBillDefinition[];
  clauses: ContractClauseDefinition[];
  attachments: ContractAttachmentDefinition[];
  validations: ContractValidationRule[];
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface ContractBillReadModel {
  id: string;
  billKey: string;
  name: string;
  totalAmountCents: number;
  rows: Array<Record<string, unknown>>;
}

export interface ContractDraftCheckpointReadModel {
  id: string;
  createdAt: string;
  label: string;
  draftData: Record<string, unknown>;
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

export interface ContractWorkbenchReadModel {
  contract: {
    id: string;
    temporaryCode: string;
    code: string | null;
    projectId: string;
    contractTypeKey: string;
    ownerUserId: string;
    name: string;
    status: string;
  };
  version: {
    id: string;
    revision: number;
    amountCents: number;
    pricingNature: string;
    amountSource: string;
    draftData: Record<string, unknown>;
    clauses: ContractClauseDefinition[];
    template: ContractTemplateSchema;
  };
  parties: Array<{
    id: string;
    roleKey: string;
    displayOrder: number;
    businessPartyVersionId?: string;
    snapshot: Record<string, unknown>;
  }>;
  bills: ContractBillReadModel[];
  checkpoints: ContractDraftCheckpointReadModel[];
  documents: ContractGeneratedDocumentReadModel[];
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
 * - `unitPriceScale` in [2, 6] for every bill.
 */
export function validateContractTemplateSchema(schema: ContractTemplateSchema): void {
  assertNoDuplicateKeys(schema.fields, "field");
  assertNoDuplicateKeys(schema.bills, "bill");
  assertNoDuplicateKeys(schema.clauses, "clause");
  assertNoDuplicateKeys(schema.attachments, "attachment");
  assertNoDuplicateKeys(schema.validations, "validation");

  for (const bill of schema.bills) {
    if (bill.quantityScale < 0 || bill.quantityScale > 6) {
      throw new Error(`quantityScale must be between 0 and 6 (bill: ${bill.key})`);
    }
    if (bill.unitPriceScale < 2 || bill.unitPriceScale > 6) {
      throw new Error(`unitPriceScale must be between 2 and 6 (bill: ${bill.key})`);
    }
  }
}
