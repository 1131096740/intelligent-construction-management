import { registeredPaymentFingerprint } from "./registered-payment-funding";
import { planRegisteredProjectAdvance, registeredProjectAdvanceReceiptStatus } from "./registered-payment-project-advance";

const base = {
  projectId: "P",
  payerCompanyId: "C",
  debtorCompanyId: "C",
  paidCents: 800n,
  openingTreatment: "not_included",
  projectAllocations: [{ sourceBatchId: "project", amount: 500n }],
  sources: [
    { id: "project", projectId: "P", projectStatus: "project", ownedByCompanyId: null },
    { id: "company", projectId: null, projectStatus: "pending", ownedByCompanyId: "C" },
    { id: "external", projectId: null, projectStatus: "pending", ownedByCompanyId: null },
    { id: "other-project", projectId: "P2", projectStatus: "project", ownedByCompanyId: "C" }
  ]
} as const;
const confirmed = {
  amountCents: "300", reason: "  核对为本公司补足项目  ", evidence: " 已核对公司出款凭据 ",
  sourceAllocations: [{ sourceBatchId: "company", amountCents: "300" }]
};

it("keeps an explicit project shortfall as 300 cents without creating a receipt", () => {
  expect(() => planRegisteredProjectAdvance({ ...base })).toThrow("项目资金差额待确认");
  expect(() => planRegisteredProjectAdvance({ ...base })).toThrow(expect.objectContaining({
    response: { statusCode: 409, code: "REGISTERED_PROJECT_ADVANCE_CONFIRMATION_REQUIRED", message: "项目资金差额待确认", differenceCents: "300" }
  }));
});

it("separates the 800-cent cash debit from the specifically confirmed 300-cent project advance", () => {
  expect(planRegisteredProjectAdvance({ ...base, confirmed })).toEqual({
    amount: 300n, companyId: "C", reason: "核对为本公司补足项目", evidence: "已核对公司出款凭据",
    companyAllocations: [{ sourceBatchId: "company", amountCents: "300", amount: 300n }]
  });
});

it.each([
  ["missing difference", { amountCents: "299" }],
  ["overstated source", { sourceAllocations: [{ sourceBatchId: "company", amountCents: "301" }] }],
  ["empty evidence", { evidence: " " }],
  ["external origin", { sourceAllocations: [{ sourceBatchId: "external", amountCents: "300" }] }],
  ["another project", { sourceAllocations: [{ sourceBatchId: "other-project", amountCents: "300" }] }],
  ["same source twice", { sourceAllocations: [{ sourceBatchId: "company", amountCents: "100" }, { sourceBatchId: "company", amountCents: "200" }] }]
])("rejects %s when preparing an explicit advance", (_name, changed) => {
  expect(() => planRegisteredProjectAdvance({ ...base, confirmed: { ...confirmed, ...changed } })).toThrow();
});

it("does not double count another company's proxy payment as a project advance", () => {
  expect(() => planRegisteredProjectAdvance({ ...base, debtorCompanyId: "other", confirmed })).toThrow("代付");
  expect(() => planRegisteredProjectAdvance({ ...base, payerCompanyId: null, confirmed })).toThrow("公司");
});

it("does not apply a new advance to a historical included-in-opening payment", () => {
  expect(() => planRegisteredProjectAdvance({ ...base, openingTreatment: "included", confirmed })).toThrow("期初");
  expect(planRegisteredProjectAdvance({ ...base, openingTreatment: "included" })).toBeNull();
});

it("leaves previously supported full allocation requests on the original flow", () => {
  expect(planRegisteredProjectAdvance({ ...base, projectAllocations: [{ sourceBatchId: "other-project", amount: 800n }] })).toBeNull();
});

it("keeps old payment fingerprints and binds the original advance reason, evidence, and source amounts", () => {
  const payment = {
    idempotencyKey: "00000000-0000-4000-8000-000000000001", expectedPaymentUpdatedAt: "2026-11-05T00:00:00Z",
    amountCents: "800", paidAt: "2026-11-06", scopeKey: "company:company-c", expectedRegistrationId: "reg-c",
    openingTreatment: "not_included" as const, openingReason: "原依据", openingEvidence: "出款",
    sourceAllocations: [{ sourceBatchId: "project", amountCents: "500" }]
  };
  const old = registeredPaymentFingerprint("payment-p", "finance-f", payment);
  expect(old).toBe("8b2106a6f8e25d7989bf7971f4ebe7c2b92a214dfd5473c3007b96e904e87427");
  const proof = { ...confirmed, sourceAllocations: [{ sourceBatchId: "company-b", amountCents: "100" },
    { sourceBatchId: "company", amountCents: "200" }] };
  const full = registeredPaymentFingerprint("payment-p", "finance-f", { ...payment, confirmedProjectAdvance: proof });
  expect(full).not.toBe(old);
  const reordered = { ...proof, reason: proof.reason.trim(), evidence: proof.evidence.trim(), sourceAllocations: [...proof.sourceAllocations].reverse() };
  expect(registeredPaymentFingerprint("payment-p", "finance-f", { ...payment, confirmedProjectAdvance: reordered })).toBe(full);
  for (const mutated of [{ ...proof, reason: "不同原因" }, { ...proof, evidence: "不同凭据" },
    { ...proof, sourceAllocations: [{ sourceBatchId: "other", amountCents: "300" }] }]) {
    expect(registeredPaymentFingerprint("payment-p", "finance-f", { ...payment, confirmedProjectAdvance: mutated })).not.toBe(full);
  }
});

it("treats an absent or mismatched recorded advance as unknown or mismatched during recovery", () => {
  const receipt = { amountCents: 300n, reason: confirmed.reason.trim(), evidence: confirmed.evidence.trim(),
    companyAllocations: [{ sourceBatchId: "company", amountCents: "300" }] };
  expect(registeredProjectAdvanceReceiptStatus(confirmed, receipt)).toBe("matched");
  expect(registeredProjectAdvanceReceiptStatus(confirmed, null)).toBe("missing");
  expect(registeredProjectAdvanceReceiptStatus(confirmed, { ...receipt, amountCents: 301n })).toBe("mismatch");
  expect(registeredProjectAdvanceReceiptStatus(confirmed, { ...receipt, companyAllocations: [{ sourceBatchId: "external", amountCents: "300" }] })).toBe("mismatch");
});
