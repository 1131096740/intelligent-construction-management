"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { proveA24CashAttribution } = require("./task426-a24-native-business.cjs");

function fixture({ companyCents = "300", netCents = "600" } = {}) {
  const primary = {
    claimId: "primary-claim", projectId: "primary-project", debtorId: "debtor", factId: "original",
    costImpactId: "original-cost", bearingCompanyId: "bearing", bearingCompanyVersionId: "bearing-v1",
    registrationId: "registration-1", sourceId: "large-source", insufficientSourceId: "small-source",
    paidAt: "2026-11-20", balanceBefore: "30.0000", balanceAfter: "22.0000"
  };
  const refund = { ...primary, projectId: "refund-project", claimId: "refund-claim", factId: "refund-original",
    costImpactId: "refund-cost", registrationId: "registration-2", refund: { accountScopeKey: "public_cash",
      receivedAt: "2026-11-21", evidenceReference: "隔离退款依据", reason: "隔离退款" } };
  const receipt = { id: "paid", status: "paid", registeredFunding: {
    actualPayerKind: "public_cash", actualPayerCompanyId: null, relationshipEntryId: null
  } };
  const original = { costRows: 1, costCents: "800", paymentExecutions: 0, cashDebits: 0, paidCents: "0",
    cashBalanceYuan: primary.balanceBefore, acceptedAttributions: 0 };
  const afterPay = { ...original, paymentExecutions: 1, cashDebits: 1, paidCents: "800", cashBalanceYuan: primary.balanceAfter };
  const option = scope => ({ costBearingCompanySpecified: true, costBearingCompanyEntityId: null,
    originalDebtorCompanyId: scope.debtorId, cashCostAllocationOptions: [{costImpactId: scope.costImpactId}] });
  const responses = [
    [200, option(primary)], [201, {id:"voucher"}], [409], [201, receipt], [409], [201, receipt],
    [200, { candidates: [{ factId: primary.factId, expenseCashCostLinkId: "link", amountCents: "300" }] }],
    [409], [201, { id: "pending", revision: 1, attributedAmountCents: "300" }], [403],
    [201, { status: "confirmed", attributedAmountCents: "300" }],
    [200, { operating: { confirmedCostCents: "800" }, costAttribution: { unattributedCostCents: "500",
      byBearingCompany: [{ id: "bearing-v1", costCents: companyCents }] } }],
    [200, option(refund)], [201, {id:"refund-voucher"}], [201, {id:"refund-payment"}],
    [200, { candidates: [{ factId: refund.factId, expenseCashCostLinkId: "refund-link", amountCents: "800" }] }],
    [201, { id: "previous", revision: 1 }], [201], [409], [201],
    [201, { status: "pending_review", attributedAmountCents: netCents }]
  ];
  const snapshots = [original, original, afterPay, { ...afterPay, acceptedAttributions: 1 }];
  const requests = [];
  const input = { primary, refundCase: async () => refund, snapshot: async () => snapshots.shift(),
    send: async (actor, request) => {
      requests.push({ actor, request });
      const [status, body] = responses.shift();
      return { status, body };
    } };
  return { input, requests };
}

test("drives all expected scoped HTTP operations and keeps the actual debit and cost unchanged after G4", async () => {
  const { input, requests } = fixture();
  const result = await proveA24CashAttribution(input);
  assert.equal(result.steps.length, 21);
  assert.deepEqual(result.positive, { costCents: "800", companyCents: "300", pendingCents: "500", payments: 1, cashDebits: 1 });
  assert.deepEqual(result.refund, { previousCents: "800", returnedCents: "200", availableCents: "600" });
  assert.equal(requests[3].actor, "keeper");
  assert.equal(requests[10].actor, "reviewer");
  assert.equal(requests[3].request.json.registeredFunding.scopeKey, "public_cash");
  assert.equal(requests[17].request.path, "/other-project-payments/refund-claim/payments/refund-payment/refunds");
  assert.deepEqual(requests.map(({ request }) => request.cashPhase), result.steps.map(step => step.phase));
});

test("a failed 409 gate identifies its fixed phase and does not send later requests", async () => {
  const { input, requests } = fixture();
  const send = input.send;
  input.send = async (...args) => {
    const response = await send(...args);
    return args[1].cashPhase === "INSUFFICIENT_SOURCE" ? { status: 500 } : response;
  };
  await assert.rejects(proveA24CashAttribution(input), error =>
    error.message.split("\n", 1)[0] === "INSUFFICIENT_SOURCE" && error.actual === 500 && error.expected === 409);
  assert.deepEqual(requests.map(({ request }) => request.cashPhase), ["COST_OPTIONS", "KEEPER_VOUCHER", "INSUFFICIENT_SOURCE"]);
});

test("refuses a whole-cost projection or an old refund gross amount", async () => {
  await assert.rejects(proveA24CashAttribution(fixture({ companyCents: "800" }).input));
  await assert.rejects(proveA24CashAttribution(fixture({ netCents: "800" }).input));
});
