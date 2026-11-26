"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const voucher = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");

async function proveA24CashAttribution({ send, snapshot, primary, refundCase, voucherBoundary, key = randomUUID }) {
  const steps = [];
  const request = async (phase, actor, path, status, command = {}) => {
    const result = await send(actor, { path, ...command, cashPhase: phase });
    steps.push({ phase, status: result.status });
    assert.equal(result.status, status, phase);
    return result.body;
  };
  const expense = scope => "/expense-claims/" + scope.claimId;
  const attributions = scope => "/projects/" + scope.projectId + "/cost-attributions";
  const scopeCost = async scope => {
    const detail = await request("COST_OPTIONS", "keeper", expense(scope), 200);
    assert.equal(detail.costBearingCompanySpecified, true);
    assert.equal(detail.costBearingCompanyEntityId, null);
    assert.equal(detail.originalDebtorCompanyId, scope.debtorId);
    assert.ok(detail.cashCostAllocationOptions.some(option => option.costImpactId === scope.costImpactId));
  };
  const upload = scope => {
    const form = new FormData();
    form.append("idempotencyKey", key());
    form.append("file", new Blob([voucher], { type: "image/png" }), "隔离凭证.png");
    return request("KEEPER_VOUCHER", "keeper", expense(scope) + "/payment-voucher-file-uploads?scopeKey=public_cash", 201,
      { method: "POST", form });
  };
  const cashCommand = (scope, id, amount, linked) => ({
    method: "POST",
    usePassword: true,
    json: { amountCents: amount, paidAt: scope.paidAt, paymentMethod: "现金", voucherFileId: id,
      registeredFunding: { scopeKey: "public_cash", expectedRegistrationId: scope.registrationId,
        sourceAllocations: [{ sourceBatchId: scope.sourceId, amountCents: amount }],
        costAllocations: [{ costImpactId: scope.costImpactId, amountCents: linked }] } }
  });
  const source = await snapshot(primary);
  assert.deepEqual(source, { costRows: 1, costCents: "800", paymentExecutions: 0, cashDebits: 0,
    paidCents: "0", cashBalanceYuan: primary.balanceBefore, acceptedAttributions: 0 }, "A24_ORIGINAL_COST");
  await scopeCost(primary);
  const file = await upload(primary);
  const voucherBoundaryProof = await voucherBoundary?.(primary, file.id);
  if (voucherBoundaryProof) assert.deepEqual(await snapshot(primary), source, "A24_VOUCHER_BOUNDARY_ROLLBACK");
  const exact = cashCommand(primary, file.id, "800", "300");
  const insufficient = cashCommand({ ...primary, sourceId: primary.insufficientSourceId }, file.id, "800", "300");
  await request("INSUFFICIENT_SOURCE", "keeper", expense(primary) + "/payments", 409, insufficient);
  assert.deepEqual(await snapshot(primary), source, "A24_DECLINE_IS_ATOMIC");
  const paid = await request("KEEPER_PUBLIC_CASH_PAYMENT", "keeper", expense(primary) + "/payments", 201, exact);
  assert.equal(paid.status, "paid");
  assert.equal(paid.registeredFunding.actualPayerKind, "public_cash");
  assert.equal(paid.registeredFunding.actualPayerCompanyId, null);
  assert.equal(paid.registeredFunding.relationshipEntryId, null);
  await request("FOREIGN_VOUCHER_REPLAY", "otherComprehensive", expense(primary) + "/payments", 409, exact);
  assert.deepEqual(await request("EXACT_PAYMENT_REPLAY", "keeper", expense(primary) + "/payments", 201, exact), paid);
  const afterPay = await snapshot(primary);
  assert.deepEqual(afterPay, { ...source, paymentExecutions: 1, cashDebits: 1, paidCents: "800",
    cashBalanceYuan: primary.balanceAfter }, "A24_ONE_COST_ONE_CASH_DEBIT");

  const candidate = (await request("LINKED_COST_CANDIDATES", "requester", attributions(primary), 200)).candidates
    .find(row => row.factId === primary.factId && row.expenseCashCostLinkId);
  assert.equal(candidate?.amountCents, "300");
  const first = { companyEntityId: primary.bearingCompanyId, reason: "按原现金费用行", idempotencyKey: key(),
    expenseCashCostLinkId: candidate.expenseCashCostLinkId };
  await request("FOREIGN_COST_LINK", "requester", attributions(primary) + "/" + key(), 409, { method: "POST", json: first });
  const pending = await request("REQUEST_CASH_SLICE", "requester", attributions(primary) + "/" + primary.factId, 201,
    { method: "POST", json: first });
  assert.equal(pending.attributedAmountCents, "300");
  const review = { method: "POST", json: { decision: "confirm", revision: pending.revision } };
  await request("NON_SUPERVISOR_REJECTED", "requester", attributions(primary) + "/" + pending.id + "/review", 403, review);
  const confirmed = await request("FINANCE_SUPERVISOR_CONFIRM", "reviewer", attributions(primary) + "/" + pending.id + "/review", 201, review);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.attributedAmountCents, "300");
  assert.deepEqual(await snapshot(primary), { ...afterPay, acceptedAttributions: 1 }, "A24_ATTRIBUTION_PRESERVES_FINANCIAL_FACTS");
  const view = await request("PROJECT_PROJECTION", "reviewer", "/operating-projections/project/" + primary.projectId, 200);
  assert.equal(view.operating.confirmedCostCents, "800");
  assert.equal(view.costAttribution.unattributedCostCents, "500");
  assert.equal(view.costAttribution.byBearingCompany.find(row => row.id === primary.bearingCompanyVersionId)?.costCents, "300");

  const refundScope = await refundCase();
  await scopeCost(refundScope);
  const refundFile = await upload(refundScope);
  const refundPaid = await request("SECOND_CASH_PAYMENT", "keeper", expense(refundScope) + "/payments", 201,
    cashCommand(refundScope, refundFile.id, "800", "800"));
  const refundCandidate = (await request("REFUND_COST_CANDIDATE", "requester", attributions(refundScope), 200)).candidates
    .find(row => row.factId === refundScope.factId && row.expenseCashCostLinkId);
  assert.equal(refundCandidate?.amountCents, "800");
  const refundAttribution = { ...first, companyEntityId: refundScope.bearingCompanyId, idempotencyKey: key(),
    expenseCashCostLinkId: refundCandidate.expenseCashCostLinkId };
  const old = await request("REQUEST_BEFORE_REFUND", "requester", attributions(refundScope) + "/" + refundScope.factId, 201,
    { method: "POST", json: refundAttribution });
  await request("REGISTER_REAL_REFUND", "refundOperator", "/other-project-payments/" + refundScope.claimId + "/payments/" + refundPaid.id + "/refunds",
    201, { method: "POST", json: { ...refundScope.refund, amountCents: "200", idempotencyKey: key() } });
  await request("PRE_REFUND_PROOF_CANNOT_CONFIRM", "reviewer", attributions(refundScope) + "/" + old.id + "/review", 409,
    { method: "POST", json: { decision: "confirm", revision: old.revision } });
  await request("RETURN_PRE_REFUND_PROOF", "reviewer", attributions(refundScope) + "/" + old.id + "/review", 201,
    { method: "POST", json: { decision: "return", revision: old.revision, reason: "按实付净额重提" } });
  const net = await request("REQUEST_NET_600", "requester", attributions(refundScope) + "/" + refundScope.factId, 201,
    { method: "POST", json: { ...refundAttribution, idempotencyKey: key() } });
  assert.equal(net.attributedAmountCents, "600");
  assert.equal(net.status, "pending_review");
  return { ...(voucherBoundaryProof ? { voucherBoundary: voucherBoundaryProof } : {}), steps, positive: { costCents: "800", companyCents: "300", pendingCents: "500", payments: 1, cashDebits: 1 },
    refund: { previousCents: "800", returnedCents: "200", availableCents: "600" } };
}

module.exports = { proveA24CashAttribution };
