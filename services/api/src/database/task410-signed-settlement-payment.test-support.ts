import { hash } from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { loadSignedSettlementPaymentBasis } from "../payment/signed-settlement-payment-capacity";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";
import { type PrismaService } from "./prisma.service";

type SignedSettlementCall = (userId: string, path: string, body?: unknown, expectedStatus?: number) => Promise<unknown>;

async function seedSignedSettlementContract(owner: PrismaService, password: string, scenario: string, amountYuan: string, amountCents: bigint) {
  const runId = createHash("sha256").update(`${process.env.TASK410_ISOLATED_RUN_ID}:${scenario}`).digest("hex").slice(0, 12);
  const rounding = buildRegisteredPgFixturePlan(runId, "2026-11-07", "2026-11-01");
  const passwordHash = await hash(password, 4);
  const roundingActors = await seedSharedPaymentPredecessors(owner, rounding, {
    financeHash: passwordHash, keeperHash: passwordHash, directorHash: passwordHash
  }, process.env.FILE_STORAGE_ROOT!, true);
  const [contractId, versionId, termsId, signedSettlementId] = Array.from({ length: 4 }, () => randomUUID());
  const checkedAt = new Date(rounding.openingDate);
  const company = await owner.companyEntity.findUniqueOrThrow({ where: { id: rounding.ids.companyA } });
  const party = await owner.contractPartySnapshot.findFirstOrThrow({
    where: { contractVersionId: rounding.ids.version, roleKey: "party_b" }, select: { businessPartyVersionId: true }
  });
  await owner.$transaction([
    owner.contract.create({ data: {
      id: contractId, projectId: rounding.ids.project, companyEntityId: company.id, companyEntityName: company.name,
      code: `T16-${rounding.runId}-HT-R`, name: "合成已签结算劳务合同", counterparty: "虚构供应商",
      contractTypeKey: "labor_subcontract", ownerUserId: rounding.ids.actor
    } }),
    owner.contractVersion.create({ data: {
      id: versionId, contractId, versionNo: 1, changeType: "original", status: "effective", effectiveAt: checkedAt,
      amountCents, amountYuan, amountLimitType: "capped", numericProtocolVersion: 2,
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
      projectId: rounding.ids.project, ownerUserId: rounding.ids.actor, number: "合成已签结算",
      amountYuan, state: "confirmed", revision: 2, confirmationNo: 1n,
      submittedAt: checkedAt, reviewedAt: checkedAt, reviewedByUserId: roundingActors.director,
      confirmedContractSource: { sourceRecordId: versionId, sourceVersion: "1", relationship: "inside",
        contractTypeKey: "labor_subcontract" }
    } })
  ]);
  return { rounding, roundingActors, contractId, versionId, termsId, signedSettlementId, checkedAt };
}

export async function verifySignedSettlementRoundedPayment(
  owner: PrismaService,
  password: string,
  loginActor: (userId: string, phone: string) => Promise<void>,
  call: SignedSettlementCall,
) {
  const { rounding, contractId, versionId, termsId, signedSettlementId, checkedAt } =
    await seedSignedSettlementContract(owner, password, "signed-rounding", "100.0050", 10_001n);
  const paymentRequestId = randomUUID();
  await owner.$transaction([
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
  expect(await owner.operatingFact.findFirstOrThrow({
    where: { sourceType: "payment_execution", sourceBusinessId: execution.id }
  })).toMatchObject({ sourceSnapshot: {
    paymentSourceType: "signed_settlement", payableAllocations: [{ sourceId: signedSettlementId, amountCents: "10001" }]
  } });
  expect(await owner.operatingImpactEntry.findMany({
    where: { sourceType: "payment_execution", sourceBusinessId: execution.id },
    select: { impactKind: true, amountCents: true }
  })).toEqual(expect.arrayContaining([
    { impactKind: "payable_decrease", amountCents: 10_001n },
    { impactKind: "company_project_funds_decrease", amountCents: 10_001n }
  ]));
  const rounded = await owner.$transaction(tx => loadSignedSettlementPaymentBasis(tx, contractId));
  expect(rounded).toMatchObject({ confirmedCents: 10_001n, netPaidCents: 10_001n, remainingCents: 0n,
    overpayCents: 0n, capacityShortfallCents: 0n, suspended: false });
  expect((await owner.signedContractSettlement.findUniqueOrThrow({ where: { id: signedSettlementId } })).amountYuan?.toFixed(4))
    .toBe("100.0050");
}

export async function verifySignedSettlementPaymentCompetition(
  owner: PrismaService,
  password: string,
  loginActor: (userId: string, phone: string) => Promise<void>,
  call: SignedSettlementCall,
) {
  const { rounding, roundingActors, contractId, versionId, termsId, signedSettlementId, checkedAt } =
    await seedSignedSettlementContract(owner, password, "signed-competition", "90.0000", 9_000n);
  const { ids, phone, openingDate, paidAt } = rounding;
  const { keeper, keeperPhone, director } = roundingActors;
  await owner.projectMember.createMany({ data: [
    { projectId: ids.project, userId: ids.actor, positionKey: "contract_staff" },
    { projectId: ids.project, userId: keeper, positionKey: "contract_staff" },
    { projectId: ids.project, userId: keeper, positionKey: "comprehensive_director" },
    { projectId: ids.project, userId: director, positionKey: "project_manager" },
    { projectId: ids.project, userId: director, positionKey: "contract_director" },
    { projectId: ids.project, userId: director, positionKey: "chairman" },
  ] });
  for (const [userId, userPhone] of [[ids.actor, phone], [keeper, keeperPhone]]) {
    await loginActor(userId, userPhone);
  }
  const previouslyPaid = await owner.paymentRequest.create({ data: {
    projectId: ids.project, contractId, contractVersionId: versionId, paymentTermsVersionId: termsId,
    code: `T16-${rounding.runId}-FK-50`, sourceType: "signed_settlement", signedSettlementId,
    signedSettlementConfirmationNo: 1n, signedSettlementConfirmedYuan: "90.0000",
    signedSettlementContractConfirmedYuan: "90.0000", signedSettlementOccupiedCents: 0n,
    signedSettlementBasisAt: checkedAt, paymentSubjectType: "our_company",
    status: "paid", requestedAmountCents: 5_000n, approvedAmountCents: 5_000n, paidAmountCents: 5_000n
  } });
  const basis = () => owner.$transaction(tx => loadSignedSettlementPaymentBasis(tx, contractId));
  expect(await basis()).toMatchObject({
    confirmedCents: 9_000n, netPaidCents: 5_000n, remainingCents: 4_000n, outstandingCents: 0n
  });

  const application = { sourceType: "signed_settlement", signedSettlementId, requestedAmountCents: "4000" };
  const applications = await Promise.allSettled([ids.actor, keeper].map((actor, index) =>
    call(actor, "/payments", { ...application, code: `T16-${rounding.runId}-FK-40-${index}` })
  ));
  expect(applications.map(result => result.status === "fulfilled" ? 201 : result.reason.message))
    .toEqual(expect.arrayContaining([201, expect.stringMatching(/Unexpected HTTP status 400.*合同已签结算累计可付金额不足/u)]));
  const [payment, ...extras] = await owner.paymentRequest.findMany({ where: { contractId, id: { not: previouslyPaid.id } } });
  expect(extras).toEqual([]);
  expect(payment).toMatchObject({ status: "approval_pending", requestedAmountCents: 4_000n });
  expect(await basis()).toMatchObject({ occupiedCents: 9_000n, remainingCents: 0n, outstandingCents: 4_000n });

  const scopeKey = `company:${ids.companyA}`;
  const opening = await call(ids.actor, "/fund-accounts/openings", {
    scopeKey, balanceYuan: "50.00", asOfDate: openingDate, evidenceReference: "合成资金期初",
    reconciliationNote: "合成项目来源", reason: "已签结算实付竞争验收", idempotencyKey: randomUUID(),
    sources: ["40.00", "10.00"].map(amountYuan => ({
      projectId: ids.project, amountYuan, sourceStatus: "known", sourceName: `合成项目资金 ${amountYuan}`, projectStatus: "project"
    }))
  }) as { id: string; sources: Array<{ id: string }> };
  const expectedRound = await owner.approvalInstance.findFirstOrThrow({
    where: { businessType: "payment_request", businessId: payment.id }
  });
  // Approval is a predecessor fixture. Registration must independently recheck the stored application and approval.
  const approved = await owner.$transaction(async tx => {
    await tx.approvalInstance.update({ where: { id: expectedRound.id }, data: { status: "approved" } });
    return tx.paymentRequest.update({ where: { id: payment.id },
      data: { status: "approved_pending_payment", approvedAmountCents: 4_000n } });
  });
  const path = `/payment-executions/${payment.id}`;
  const options = await call(ids.actor, `${path}/registration-options`) as {
    remainingAmountCents: string; expectedPaymentUpdatedAt: string
  };
  expect(options).toMatchObject({ remainingAmountCents: "4000", expectedPaymentUpdatedAt: approved.updatedAt.toISOString() });
  const registrations = `${path}/registrations`;
  const command = {
    expectedPaymentUpdatedAt: options.expectedPaymentUpdatedAt, amountCents: "4000", paidAt, scopeKey,
    expectedRegistrationId: opening.id, openingTreatment: "not_included", openingReason: "本次付款未含期初",
    openingEvidence: "隔离合成证据", confirmationPassword: password,
    sourceAllocations: [{ sourceBatchId: opening.sources[0].id, amountCents: "4000" }]
  };
  const resultOf = (actor: string, idempotencyKey: string) => call(actor, `/payment-executions/results/${idempotencyKey}`);
  const loadAccount = () => owner.registeredFundAccount.findUniqueOrThrow({ where: { scopeKey } });
  const beforeAccount = await loadAccount();
  const attempted = async (changes: Partial<typeof command>, status: number, message: string) => {
    const idempotencyKey = randomUUID();
    expect(await call(ids.actor, registrations, { ...command, ...changes, idempotencyKey }, status))
      .toMatchObject({ message: expect.stringContaining(message) });
    expect(await resultOf(ids.actor, idempotencyKey)).toMatchObject({ status: "unconfirmed" });
  };

  await attempted({ amountCents: "4001", sourceAllocations: [{ sourceBatchId: opening.sources[0].id, amountCents: "4001" }] },
    400, "实付金额超过付款申请剩余可实付金额");
  const reduce = await owner.signedContractSettlement.create({ data: {
    contractKind: "downstream", contractId, projectId: ids.project, ownerUserId: director,
    number: "合成调减", amountYuan: "-1.0000", state: "confirmed", revision: 2, confirmationNo: 2n,
    submittedAt: checkedAt, reviewedAt: checkedAt, reviewedByUserId: director,
    confirmedContractSource: { sourceRecordId: versionId, sourceVersion: "1", relationship: "inside", contractTypeKey: "labor_subcontract" }
  } });
  expect(await basis()).toMatchObject({ confirmedCents: 8_900n, suspended: true });
  await attempted({}, 409, "合同已签结算累计可付金额不足");
  await owner.signedContractSettlement.create({ data: {
    contractKind: reduce.contractKind, contractId, projectId: ids.project, ownerUserId: director,
    number: "合成补回", amountYuan: "1.0000", state: "confirmed", revision: 2, confirmationNo: 3n,
    submittedAt: checkedAt, reviewedAt: checkedAt, reviewedByUserId: director,
    confirmedContractSource: reduce.confirmedContractSource!
  } });
  await attempted({ sourceAllocations: [{ sourceBatchId: opening.sources[1].id, amountCents: "4000" }] },
    409, "所选来源可用余额不足");
  expect(await loadAccount()).toEqual(beforeAccount);
  expect(await owner.auditLog.count({ where: { businessId: payment.id, action: "payment.capacity.blocked" } })).toBe(1);
  expect(await owner.auditLog.count({ where: { businessId: payment.id, action: "payment.capacity.recheck" } })).toBe(0);
  expect(await owner.auditLog.count({ where: { businessId: payment.id, action: "payment.execution.record" } })).toBe(0);
  expect(await owner.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(approved);
  expect(await owner.paymentExecution.count({ where: { paymentRequestId: payment.id } })).toBe(0);

  const actors = [ids.actor, keeper].map(actor => ({ actor, idempotencyKey: randomUUID() }));
  const attempts = await Promise.allSettled(actors.map(({ actor, idempotencyKey }) =>
    call(actor, registrations, { ...command, idempotencyKey })
  ));
  expect(attempts.map(result => result.status === "fulfilled" ? 201 : result.reason.message))
    .toEqual(expect.arrayContaining([201, expect.stringMatching(/Unexpected HTTP status 409/u)]));
  const [execution] = await owner.paymentExecution.findMany({ where: { paymentRequestId: payment.id } });
  expect(execution).toMatchObject({ amountCents: 4_000n, idempotencyKey: actors[attempts.findIndex(result => result.status === "fulfilled")].idempotencyKey });
  expect(await owner.paymentExecution.count({ where: { paymentRequestId: payment.id } })).toBe(1);
  for (const { actor, idempotencyKey } of actors) {
    expect(await resultOf(actor, idempotencyKey)).toMatchObject(execution.idempotencyKey === idempotencyKey
      ? { status: "recorded", execution: { executionId: execution.id, amountCents: "4000" } }
      : { status: "unconfirmed" });
  }
  expect(await owner.registeredFundPaymentAllocation.findMany({
    where: { accountId: beforeAccount.id }, select: { executionId: true, amountCents: true, sourceBatchId: true }
  })).toEqual([{ executionId: execution.id, amountCents: 4_000n, sourceBatchId: opening.sources[0].id }]);
  expect(await owner.registeredPaymentFunding.count({ where: { accountId: beforeAccount.id } })).toBe(1);
  expect(await owner.registeredPaymentEvent.count({ where: { executionId: execution.id } })).toBe(1);
  expect(await owner.operatingFact.count({ where: { projectId: ids.project, sourceType: "payment_execution" } })).toBe(1);
  expect(await owner.auditLog.count({ where: { businessId: payment.id, action: "payment.execution.record" } })).toBe(1);
  expect(await owner.auditLog.findFirstOrThrow({ where: { businessId: payment.id, action: "payment.capacity.recheck" } }))
    .toMatchObject({ metadata: { stage: "execution", confirmedCents: "9000", availableCents: "4000", amountCents: "4000" } });
  expect(await owner.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } }))
    .toMatchObject({ status: "paid", paidAmountCents: 4_000n });
  expect(await owner.paymentRequest.findUniqueOrThrow({ where: { id: previouslyPaid.id } })).toEqual(previouslyPaid);
  expect(await basis()).toMatchObject({
    confirmedCents: 9_000n, netPaidCents: 9_000n, occupiedCents: 9_000n, outstandingCents: 0n, remainingCents: 0n
  });
}
