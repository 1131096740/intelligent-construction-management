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
    vatRatePercent: ""
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

  it("rebuilds restored lines from the whitelist and drops forged server facts", () => {
    const target = storage();
    writeSpotPaymentLocalDraft(target, "payment-1", "user-1", 2, safeDraft, 1_000);
    const key = target.key(0) ?? "";
    const forged = JSON.parse(target.getItem(key) ?? "{}") as {
      draft: { lines: Array<Record<string, unknown>> };
    };
    Object.assign(forged.draft.lines[0]!, {
      materialName: "伪造材料",
      approvedQuantity: "999999.00",
      unit: "伪造单位",
      channels: [{ accountNumber: "62220000" }]
    });
    target.setItem(key, JSON.stringify(forged));

    const restored = readSpotPaymentLocalDraft(target, "payment-1", "user-1", 1_001);
    expect(restored?.draft.lines[0]).toEqual(safeDraft.lines[0]);
    expect(restored?.draft.lines[0]).not.toHaveProperty("materialName");
    expect(restored?.draft.lines[0]).not.toHaveProperty("approvedQuantity");
    expect(restored?.draft.lines[0]).not.toHaveProperty("channels");
  });

  it("fails open when storage get, cleanup, or JSON parsing throws", () => {
    const getFailure = storage();
    getFailure.getItem = () => { throw new Error("blocked"); };
    getFailure.removeItem = () => { throw new Error("cleanup blocked"); };
    expect(() => readSpotPaymentLocalDraft(getFailure, "payment-1", "user-1")).not.toThrow();
    expect(readSpotPaymentLocalDraft(getFailure, "payment-1", "user-1")).toBeNull();

    const parseFailure = storage();
    writeSpotPaymentLocalDraft(parseFailure, "payment-1", "user-1", 2, safeDraft, 1_000);
    parseFailure.setItem(parseFailure.key(0) ?? "", "not-json");
    parseFailure.removeItem = () => { throw new Error("cleanup blocked"); };
    expect(() => readSpotPaymentLocalDraft(parseFailure, "payment-1", "user-1", 1_001)).not.toThrow();
    expect(readSpotPaymentLocalDraft(parseFailure, "payment-1", "user-1", 1_001)).toBeNull();
  });
});
