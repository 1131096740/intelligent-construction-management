import { hash } from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { loadSignedSettlementPaymentBasis } from "../payment/signed-settlement-payment-capacity";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";
import { type PrismaService } from "./prisma.service";

export async function verifySignedSettlementRoundedPayment(
  owner: PrismaService,
  password: string,
  loginActor: (userId: string, phone: string) => Promise<void>,
  call: (userId: string, path: string, body?: unknown) => Promise<unknown>,
) {
  const runId = createHash("sha256").update(`${process.env.TASK410_ISOLATED_RUN_ID}:signed-rounding`).digest("hex").slice(0, 12);
  const rounding = buildRegisteredPgFixturePlan(runId, "2026-11-07", "2026-11-01");
  const passwordHash = await hash(password, 4);
  const roundingActors = await seedSharedPaymentPredecessors(owner, rounding, {
    financeHash: passwordHash, keeperHash: passwordHash, directorHash: passwordHash
  }, process.env.FILE_STORAGE_ROOT!, true);
  const [contractId, versionId, termsId, signedSettlementId, paymentRequestId] = Array.from({ length: 5 }, () => randomUUID());
  const checkedAt = new Date(rounding.openingDate);
  const company = await owner.companyEntity.findUniqueOrThrow({ where: { id: rounding.ids.companyA } });
  const party = await owner.contractPartySnapshot.findFirstOrThrow({
    where: { contractVersionId: rounding.ids.version, roleKey: "party_b" }, select: { businessPartyVersionId: true }
  });
  await owner.$transaction([
    owner.contract.create({ data: {
      id: contractId, projectId: rounding.ids.project, companyEntityId: company.id, companyEntityName: company.name,
      code: `T16-${rounding.runId}-HT-R`, name: "合成四位劳务合同", counterparty: "虚构供应商",
      contractTypeKey: "labor_subcontract", ownerUserId: rounding.ids.actor
    } }),
    owner.contractVersion.create({ data: {
      id: versionId, contractId, versionNo: 1, changeType: "original", status: "effective", effectiveAt: checkedAt,
      amountCents: 10_001n, amountYuan: "100.0050", amountLimitType: "capped", numericProtocolVersion: 2,
      pricingNature: "fixed_total", settlementMode: "settlement_required", settlementModeSource: "contract_director",
      settlementModeConfirmedAt: checkedAt, settlementModeConfirmedByUserId: roundingActors.director,
      signingSubjectType: "our_company", companyEntityIdSnapshot: company.id, companyEntityVersionId: rounding.ids.companyVersionA,
      companyEntityNameSnapshot: company.name, companyEntityCreditCodeSnapshot: company.unifiedSocialCreditCode,
      draftData: {}, templateSnapshot: {}, clauseSnapshot: {}
    } }),
    owner.contractPartySnapshot.create({ data: {
      contractVersionId: versionId, roleKey: "party_b", displayOrder: 0,
      businessPartyVersionId: party.businessPartyVersionId, snapshot: { name: "虚构供应商" }
    } }),
    owner.paymentTermsVersion.create({ data: {
      id: termsId, contractId, contractVersionId: versionId, versionNo: 1, status: "effective", originalText: "按确认的结算付款"
    } }),
    owner.signedContractSettlement.create({ data: {
      id: signedSettlementId, contractKind: "downstream", contractId,
      projectId: rounding.ids.project, ownerUserId: rounding.ids.actor, number: "合成四位结算",
      amountYuan: "100.0050", state: "confirmed", revision: 2, confirmationNo: 1n,
      submittedAt: checkedAt, reviewedAt: checkedAt, reviewedByUserId: roundingActors.director,
      confirmedContractSource: { sourceRecordId: versionId, sourceVersion: "1", relationship: "inside",
        contractTypeKey: "labor_subcontract" }
    } }),
    owner.paymentRequest.create({ data: {
      id: paymentRequestId, projectId: rounding.ids.project, contractId, contractVersionId: versionId,
      paymentTermsVersionId: termsId, code: `T16-${rounding.runId}-FK-R`,
      sourceType: "signed_settlement", signedSettlementId, signedSettlementConfirmationNo: 1n,
      signedSettlementConfirmedYuan: "100.0050", signedSettlementContractConfirmedYuan: "100.0050",
      signedSettlementOccupiedCents: 0n, signedSettlementBasisAt: checkedAt, paymentSubjectType: "our_company",
      status: "approved_pending_payment", requestedAmountCents: 10_001n, approvedAmountCents: 10_001n, paidAmountCents: 0n
    } }),
    owner.approvalInstance.create({ data: {
      flowType: "payment.approve", businessType: "payment_request", businessId: paymentRequestId,
      status: "approved", currentNodeIndex: 0, frozenNodes: [], applicantUserId: rounding.ids.actor
    } })
  ]);
  const finance = rounding.ids.actor;
  await loginActor(finance, rounding.phone);
  const scopeKey = `company:${rounding.ids.companyA}`;
  const opening = await call(finance, "/fund-accounts/openings", {
    scopeKey, balanceYuan: "100.01", asOfDate: rounding.openingDate, evidenceReference: "合成资金期初",
    reconciliationNote: "合成项目来源", reason: "四位结算按分实付复验", idempotencyKey: randomUUID(),
    sources: [{ projectId: rounding.ids.project, amountYuan: "100.01", sourceStatus: "known", sourceName: "合成项目资金", projectStatus: "project" }]
  }) as { id: string; sources: Array<{ id: string }> };
  const path = `/payment-executions/${paymentRequestId}`;
  const options = await call(finance, `${path}/registration-options`) as { remainingAmountCents: string; expectedPaymentUpdatedAt: string };
  expect(options.remainingAmountCents).toBe("10001");
  const registration = {
    idempotencyKey: randomUUID(), expectedPaymentUpdatedAt: options.expectedPaymentUpdatedAt,
    amountCents: "10001", paidAt: rounding.paidAt, scopeKey, expectedRegistrationId: opening.id,
    openingTreatment: "not_included", openingReason: "付款未含期初", openingEvidence: "隔离合成证据", confirmationPassword: password,
    sourceAllocations: [{ sourceBatchId: opening.sources[0].id, amountCents: "10001" }]
  };
  let execution: { id: string };
  try {
    execution = await call(finance, `${path}/registrations`, registration) as { id: string };
  } catch (error) {
    const fact = await owner.paymentExecution.findUnique({
      where: { idempotencyKey: registration.idempotencyKey }, select: { id: true }
    });
    const payment = await owner.paymentRequest.findUniqueOrThrow({
      where: { id: paymentRequestId }, select: { status: true, paidAmountCents: true }
    });
    throw new Error(
      `四位结算实付未确认（实付事实：${Boolean(fact)}，付款状态：${payment.status}，累计已付：${payment.paidAmountCents} 分）`,
      { cause: error }
    );
  }
  expect(await call(finance, `/payment-executions/results/${registration.idempotencyKey}`)).toMatchObject({
    status: "recorded", execution: { executionId: execution.id, amountCents: "10001" }
  });
  expect(await call(finance, `${path}/registrations`, registration)).toMatchObject({ id: execution.id });
  expect(await owner.paymentExecution.findUniqueOrThrow({ where: { id: execution.id } }))
    .toMatchObject({ paymentRequestId, amountCents: 10_001n });
  expect(await owner.paymentRequest.findUniqueOrThrow({ where: { id: paymentRequestId } }))
    .toMatchObject({ status: "paid", paidAmountCents: 10_001n });
  expect(await owner.paymentExecution.count({ where: { paymentRequestId } })).toBe(1);
  expect(await owner.registeredFundPaymentAllocation.findMany({
    where: { executionId: execution.id }, select: { amountCents: true, sourceBatchId: true }
  })).toEqual([{ amountCents: 10_001n, sourceBatchId: opening.sources[0].id }]);
  expect(await owner.registeredPaymentEvent.count({ where: { executionId: execution.id } })).toBe(1);
  expect(await owner.auditLog.count({ where: { businessId: paymentRequestId, action: "payment.execution.record" } })).toBe(1);
  const rounded = await owner.$transaction(tx => loadSignedSettlementPaymentBasis(tx, contractId));
  expect(rounded).toMatchObject({ confirmedCents: 10_001n, netPaidCents: 10_001n, remainingCents: 0n,
    overpayCents: 0n, capacityShortfallCents: 0n, suspended: false });
  expect((await owner.signedContractSettlement.findUniqueOrThrow({ where: { id: signedSettlementId } })).amountYuan?.toFixed(4))
    .toBe("100.0050");
}
