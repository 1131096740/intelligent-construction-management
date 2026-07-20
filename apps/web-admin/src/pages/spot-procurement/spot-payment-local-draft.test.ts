import { describe, expect, it } from "vitest";
import {
  clearSpotPaymentLocalDraft,
  readSpotPaymentLocalDraft,
  SPOT_PAYMENT_LOCAL_DRAFT_TTL_MS,
  writeSpotPaymentLocalDraft
} from "./spot-payment-local-draft";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}

const safeDraft = {
  paymentType: "company_direct" as const,
  merchantName: "利民建材店",
  payeeDiffersFromMerchant: false,
  payeeName: "利民建材店",
  merchantPayeeMismatchNote: "",
  paymentMethods: ["cash"],
  lines: [{
    procurementLineId: "line-1",
    included: true,
    paymentQuantity: "10.00",
    unitPrice: "4.40",
    expectedInvoiceCondition: "no_invoice" as const,
    vatRateOptionId: ""
  }]
};

describe("spot payment local draft", () => {
  it("restores only the same payment and user before the short TTL expires", () => {
    const target = storage();
    writeSpotPaymentLocalDraft(target, "payment-1", "user-1", 2, safeDraft, 1_000);

    expect(readSpotPaymentLocalDraft(target, "payment-1", "user-1", 1_001)).toMatchObject({
      resumeStep: 2,
      draft: safeDraft
    });
    expect(readSpotPaymentLocalDraft(target, "payment-1", "user-2", 1_001)).toBeNull();
    expect(readSpotPaymentLocalDraft(target, "payment-2", "user-1", 1_001)).toBeNull();
    expect(readSpotPaymentLocalDraft(target, "payment-1", "user-1", 1_000 + SPOT_PAYMENT_LOCAL_DRAFT_TTL_MS + 1)).toBeNull();
  });

  it("never serializes channel credentials, files, attachments, or passwords", () => {
    const target = storage();
    writeSpotPaymentLocalDraft(target, "payment-1", "user-1", 2, {
      ...safeDraft,
      channels: [{ accountNumber: "6222000012345678", bankName: "测试银行" }],
      attachmentFiles: [{ name: "敏感凭证.pdf" }],
      password: "secret"
    }, 1_000);

    const serialized = target.getItem(target.key(0) ?? "") ?? "";
    expect(serialized).toContain("利民建材店");
    expect(serialized).not.toMatch(/6222000012345678|测试银行|敏感凭证|secret|channels|attachment/i);
  });

  it("clears the local checkpoint after a complete server save", () => {
    const target = storage();
    writeSpotPaymentLocalDraft(target, "payment-1", "user-1", 2, safeDraft, 1_000);
    clearSpotPaymentLocalDraft(target, "payment-1", "user-1");
    expect(readSpotPaymentLocalDraft(target, "payment-1", "user-1", 1_001)).toBeNull();
  });
});
