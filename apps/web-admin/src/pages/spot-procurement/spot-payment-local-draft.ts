import type { SpotProcurementPaymentMethod } from "../../api/spot-procurement.api";

const SCHEMA_VERSION = 2;
export const SPOT_PAYMENT_LOCAL_DRAFT_TTL_MS = 2 * 60 * 60 * 1_000;
const PAYMENT_METHODS = new Set<SpotProcurementPaymentMethod>([
  "bank_transfer",
  "cash",
  "wechat",
  "alipay",
  "other"
]);

type InvoiceCondition = "vat_general" | "vat_special" | "no_invoice";

export interface SpotPaymentLocalDraftSource {
  paymentType: "company_direct" | "handler_reimbursement";
  merchantName: string;
  payeeDiffersFromMerchant: boolean;
  payeeName: string;
  merchantPayeeMismatchNote: string;
  paymentMethods: readonly string[];
  lines: readonly {
    procurementLineId: string;
    included: boolean;
    paymentQuantity: string;
    unitPrice: string;
    expectedInvoiceCondition: InvoiceCondition;
    vatRatePercent: string;
  }[];
  [key: string]: unknown;
}

export interface SpotPaymentLocalDraft {
  schemaVersion: 2;
  paymentId: string;
  userId: string;
  savedAt: number;
  expiresAt: number;
  resumeStep: 0 | 1 | 2 | 3;
  draft: {
    paymentType: "company_direct" | "handler_reimbursement";
    merchantName: string;
    payeeDiffersFromMerchant: boolean;
    payeeName: string;
    merchantPayeeMismatchNote: string;
    paymentMethods: SpotProcurementPaymentMethod[];
    lines: Array<{
      procurementLineId: string;
      included: boolean;
      paymentQuantity: string;
      unitPrice: string;
      expectedInvoiceCondition: InvoiceCondition;
      vatRatePercent: string;
    }>;
  };
}

function storageKey(paymentId: string, userId: string) {
  return `jg:spot-payment-local-draft:v${SCHEMA_VERSION}:${encodeURIComponent(userId)}:${encodeURIComponent(paymentId)}`;
}

export function writeSpotPaymentLocalDraft(
  storage: Storage,
  paymentId: string,
  userId: string,
  resumeStep: 0 | 1 | 2 | 3,
  source: SpotPaymentLocalDraftSource,
  now = Date.now()
): boolean {
  const value: SpotPaymentLocalDraft = {
    schemaVersion: SCHEMA_VERSION,
    paymentId,
    userId,
    savedAt: now,
    expiresAt: now + SPOT_PAYMENT_LOCAL_DRAFT_TTL_MS,
    resumeStep,
    draft: {
      paymentType: source.paymentType,
      merchantName: source.merchantName,
      payeeDiffersFromMerchant: source.payeeDiffersFromMerchant,
      payeeName: source.payeeName,
      merchantPayeeMismatchNote: source.merchantPayeeMismatchNote,
      paymentMethods: source.paymentMethods.filter(
        (method): method is SpotProcurementPaymentMethod => PAYMENT_METHODS.has(method as SpotProcurementPaymentMethod)
      ),
      lines: source.lines.map((line) => ({
        procurementLineId: line.procurementLineId,
        included: line.included,
        paymentQuantity: line.paymentQuantity,
        unitPrice: line.unitPrice,
        expectedInvoiceCondition: line.expectedInvoiceCondition,
        vatRatePercent: line.vatRatePercent
      }))
    }
  };
  try {
    storage.setItem(storageKey(paymentId, userId), JSON.stringify(value));
    return true;
  } catch {
    // A blocked or full sessionStorage must never prevent the normal form flow.
    return false;
  }
}

export function readSpotPaymentLocalDraft(
  storage: Storage,
  paymentId: string,
  userId: string,
  now = Date.now()
): SpotPaymentLocalDraft | null {
  const key = storageKey(paymentId, userId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SpotPaymentLocalDraft>;
    if (
      value.schemaVersion !== SCHEMA_VERSION ||
      value.paymentId !== paymentId ||
      value.userId !== userId ||
      typeof value.savedAt !== "number" ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= now ||
      ![0, 1, 2, 3].includes(value.resumeStep as number) ||
      !isSafeDraft(value.draft)
    ) {
      safeRemove(storage, key);
      return null;
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      paymentId,
      userId,
      savedAt: value.savedAt as number,
      expiresAt: value.expiresAt,
      resumeStep: value.resumeStep as 0 | 1 | 2 | 3,
      draft: rebuildSafeDraft(value.draft as SpotPaymentLocalDraft["draft"])
    };
  } catch {
    safeRemove(storage, key);
    return null;
  }
}

export function clearSpotPaymentLocalDraft(
  storage: Storage,
  paymentId: string,
  userId: string
) {
  safeRemove(storage, storageKey(paymentId, userId));
}

function safeRemove(storage: Storage, key: string) {
  try { storage.removeItem(key); }
  catch { /* Storage cleanup is best effort. */ }
}

function rebuildSafeDraft(draft: SpotPaymentLocalDraft["draft"]): SpotPaymentLocalDraft["draft"] {
  return {
    paymentType: draft.paymentType,
    merchantName: draft.merchantName,
    payeeDiffersFromMerchant: draft.payeeDiffersFromMerchant,
    payeeName: draft.payeeName,
    merchantPayeeMismatchNote: draft.merchantPayeeMismatchNote,
    paymentMethods: [...draft.paymentMethods],
    lines: draft.lines.map((line) => ({
      procurementLineId: line.procurementLineId,
      included: line.included,
      paymentQuantity: line.paymentQuantity,
      unitPrice: line.unitPrice,
      expectedInvoiceCondition: line.expectedInvoiceCondition,
      vatRatePercent: line.vatRatePercent
    }))
  };
}

function isSafeDraft(value: unknown): value is SpotPaymentLocalDraft["draft"] {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SpotPaymentLocalDraft["draft"]>;
  return (
    (draft.paymentType === "company_direct" || draft.paymentType === "handler_reimbursement") &&
    typeof draft.merchantName === "string" &&
    typeof draft.payeeDiffersFromMerchant === "boolean" &&
    typeof draft.payeeName === "string" &&
    typeof draft.merchantPayeeMismatchNote === "string" &&
    Array.isArray(draft.paymentMethods) &&
    draft.paymentMethods.every((method) => PAYMENT_METHODS.has(method)) &&
    Array.isArray(draft.lines) &&
    draft.lines.every((line) => Boolean(
      line &&
      typeof line.procurementLineId === "string" &&
      typeof line.included === "boolean" &&
      typeof line.paymentQuantity === "string" &&
      typeof line.unitPrice === "string" &&
      ["vat_general", "vat_special", "no_invoice"].includes(line.expectedInvoiceCondition) &&
      typeof line.vatRatePercent === "string"
    ))
  );
}
