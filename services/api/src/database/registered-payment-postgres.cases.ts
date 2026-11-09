import type { Prisma } from "@prisma/client";
import { assertRegisteredPgConnectedRoles, registeredPgHttp } from "./registered-payment-postgres.fixture";
import type { PreparedRegisteredPgFixture, RegisteredPgExecutionContext, RegisteredPgSeedContinuity } from "./registered-payment-postgres.fixture";

/** Source-derived inventory, not an executable resource runner or a PG result. */
export function registeredPaymentPostgresCases() {
  return [{
    id: "registered.null-cross-company.commit",
    handlerExport: "runRegisteredNullCrossCompanyCommit",
    fixture: "approved-settlement-project-unenabled-company-b-pays-a",
    publicEntry: "POST /payment-executions/:paymentId/registrations",
    amountCents: "4000", executed: false, sqlExecuted: false,
    independentExpectation: {
      execution: 1, funding: 1, allocation: 1, event: 1, audit: 1,
      debtor: "A", creditor: "B", rootAmountCents: "4000", roots: 1,
      operatingFacts: 0, operatingImpacts: 0,
      balanceA: "100.0000", balanceB: "60.0000", paidCents: "4000", remainingCents: "6000"
    },
    limits: ["Pre-approved state fixture; no approval-path acceptance", "Requires future explicitly authorized connected executor", "No failure/concurrency cases or live resource acceptance"]
  }];
}

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

async function snapshot(tx: Prisma.TransactionClient, fixture: PreparedRegisteredPgFixture, continuity?: RegisteredPgSeedContinuity) {
  const light = () => continuity?.checkLight();
  const checked = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => { light(); const value = await operation(); light(); return value; };
  light();
  const { ids } = fixture.plan;
  const request = await checked(() => tx.paymentRequest.findUniqueOrThrow({ where: { id: ids.payment }, select: { approvedAmountCents: true, paidAmountCents: true, status: true } }));
  const settlement = await checked(() => tx.settlement.findUniqueOrThrow({ where: { id: ids.settlement }, select: { payableAmountCents: true, paidAmountCents: true } }));
  const executions = await checked(() => tx.paymentExecution.findMany({ where: { paymentRequestId: ids.payment }, select: { id: true, idempotencyKey: true, amountCents: true, paymentRequestId: true, voucherFileId: true } }));
  const executionIds = executions.map(row => row.id);
  const funding = await checked(() => tx.registeredPaymentFunding.findMany({ where: { executionId: { in: executionIds } }, select: { executionId: true, operatingLedgerEffectiveDateAtRegistration: true, actualPayerId: true, actualPayerKind: true } }));
  const allocations = await checked(() => tx.registeredFundPaymentAllocation.findMany({ where: { executionId: { in: executionIds } }, select: { executionId: true, accountId: true, sourceBatchId: true, amountCents: true } }));
  const events = await checked(() => tx.registeredPaymentEvent.findMany({ where: { executionId: { in: executionIds } }, select: { executionId: true } }));
  const roots = await checked(() => tx.interEntityRelationshipEntry.findMany({ where: { paymentExecutionId: { in: executionIds } }, select: { id: true, paymentExecutionId: true, sourceType: true, entryKind: true, direction: true, status: true, originalDebtorCompanyId: true, creditorCompanyId: true, amountCents: true, projectId: true } }));
  const facts = await checked(() => tx.operatingFact.findMany({ where: { sourceType: "payment_execution", sourceBusinessId: { in: executionIds } }, select: { id: true } }));
  const impacts = await checked(() => tx.operatingImpactEntry.findMany({ where: { sourceType: "payment_execution", sourceBusinessId: { in: executionIds } }, select: { id: true } }));
  const audits = await checked(() => tx.auditLog.findMany({ where: { businessType: "payment_request", businessId: ids.payment, action: "payment.execution.record" }, select: { actorUserId: true, metadata: true } }));
  // Independent amounts come from the real immutable opening + canonical
  // postings, never the response or the application balance helper.
  const [openingA, openingB] = await checked(() => Promise.all([fixture.companyARegistrationId, fixture.companyBRegistrationId].map(id => tx.fundAccountBalanceRegistration.findUniqueOrThrow({ where: { id }, select: { accountId: true, balanceYuan: true, coveredExecutionIds: true } }))));
  const allPostings = await checked(() => tx.registeredFundPaymentAllocation.findMany({ where: { accountId: { in: [openingA.accountId, openingB.accountId] } }, select: { executionId: true, accountId: true, sourceBatchId: true, amountCents: true } }));
  const accountAmount = (opening: typeof openingA) => {
    check(opening.balanceYuan !== null, "PG_CASE_INITIAL_BALANCE_MUST_BE_KNOWN");
    const covered = new Set(opening.coveredExecutionIds);
    const spent = allPostings.filter(row => row.accountId === opening.accountId && !covered.has(row.executionId)).reduce((sum, row) => sum + row.amountCents, 0n);
    check(spent >= 0n, "PG_CASE_POSTING_DIRECTION");
    const spentYuan = `${spent / 100n}.${(spent % 100n).toString().padStart(2, "0")}`;
    return opening.balanceYuan.minus(spentYuan).toFixed(4);
  };
  return { request, settlement, executions, funding, allocations, events, roots, facts, impacts, audits, balanceA: accountAmount(openingA), balanceB: accountAmount(openingB) };
}

async function observe(context: RegisteredPgExecutionContext, fixture: PreparedRegisteredPgFixture, continuity?: RegisteredPgSeedContinuity) {
  const light = () => continuity?.checkLight();
  const checked = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => { light(); const value = await operation(); light(); return value; };
  light();
  return context.observer.$transaction(async tx => {
    const setReadOnly = tx.$executeRawUnsafe;
    await checked(() => setReadOnly.call(tx, "SET TRANSACTION READ ONLY"));
    return snapshot(tx, fixture, continuity);
  }, { isolationLevel: "RepeatableRead" });
}

/** Never called on import. The future executor owns authorization, installation,
 * application startup, client connection and cleanup. This is one case only. */
export function runRegisteredNullCrossCompanyCommit(context: RegisteredPgExecutionContext, fixture: PreparedRegisteredPgFixture, continuity?: RegisteredPgSeedContinuity) {
  return runCrossCompanyCase(context, fixture, continuity, "commit");
}

/** Separate acceptance case. The executor must explicitly admit it and provide an owned transport. */
export function runRegisteredNullCrossCompanyResponseLoss(context: RegisteredPgExecutionContext, fixture: PreparedRegisteredPgFixture, continuity: RegisteredPgSeedContinuity) {
  return runCrossCompanyCase(context, fixture, continuity, "response-loss");
}

async function runCrossCompanyCase(context: RegisteredPgExecutionContext, fixture: PreparedRegisteredPgFixture,
  continuity: RegisteredPgSeedContinuity | undefined, scenario: "commit" | "response-loss") {
  const light = () => continuity?.checkLight();
  const checked = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => { light(); const value = await operation(); light(); return value; };
  light();
  const identity = await checked(() => assertRegisteredPgConnectedRoles(context, continuity));
  const { plan } = fixture;
  const { ids } = plan;
  const before = await checked(() => observe(context, fixture, continuity));
  check(before.executions.length === 0 && before.roots.length === 0 && before.request.approvedAmountCents === 10000n && before.request.paidAmountCents === 0n && before.settlement.payableAmountCents === 10000n && before.settlement.paidAmountCents === 0n && before.balanceA === "100.0000" && before.balanceB === "100.0000", "PG_CASE_BEFORE_STATE");
  const optionsResponse = await checked(() => registeredPgHttp(context, `/payment-executions/${ids.payment}/registration-options`, "GET", undefined, fixture.accessToken, continuity));
  const options = optionsResponse.body as { expectedPaymentUpdatedAt?: unknown; remainingAmountCents?: unknown; accounts?: Array<{ scopeKey: string; eligible: boolean }> };
  check(optionsResponse.status === 200 && typeof options.expectedPaymentUpdatedAt === "string" && options.remainingAmountCents === "10000" && options.accounts?.some(account => account.scopeKey === `company:${ids.companyB}` && account.eligible), "PG_CASE_PUBLIC_OPTIONS");
  const command = {
    idempotencyKey: ids.requestKey, expectedPaymentUpdatedAt: options.expectedPaymentUpdatedAt,
    amountCents: "4000", paidAt: plan.paidAt, scopeKey: `company:${ids.companyB}`,
    expectedRegistrationId: fixture.companyBRegistrationId, openingTreatment: "not_included",
    openingReason: "本次实付未计入核对期初", openingEvidence: "隔离PG合成付款及期初依据",
    sourceAllocations: [{ sourceBatchId: fixture.companyBSourceId, amountCents: "4000" }],
    confirmationPassword: context.password
  };
  const registration = `/payment-executions/${ids.payment}/registrations`;
  const submit = (transport = continuity) => registeredPgHttp(context, registration, "POST", command, fixture.accessToken, transport);
  if (scenario === "response-loss") {
    check(continuity?.assertHttpRequest, "PG_CASE_RESPONSE_LOSS_REQUIRES_OWNED_TRANSPORT");
    const dropped = new Error("PG_CASE_RESPONSE_LOST_AFTER_UPSTREAM_HEADERS");
    const fetchWithoutDelivery: typeof fetch = async (target, init) => {
      const upstream = await checked(() => continuity.fetch(target, init));
      const body = upstream.body;
      check(upstream.status === 201 && upstream.url === String(target) && !upstream.redirected && body,
        "PG_CASE_RESPONSE_LOSS_BOUNDARY");
      // Cancel the first response before delivering a body to the HTTP caller.
      // Only the independent observer below can establish that a commit exists.
      await checked(() => body.cancel());
      throw dropped;
    };
    const lost = await submit({ ...continuity, fetch: fetchWithoutDelivery }).then(() => false, error => {
      if (error !== dropped) throw error;
      return true;
    });
    check(lost, "PG_CASE_RESPONSE_LOSS_BOUNDARY");
  } else {
    const response = await checked(() => submit());
    check(response.status === 201, "PG_CASE_REGISTRATION_HTTP_STATUS");
  }
  const after = await checked(() => observe(context, fixture, continuity));
  check(after.executions.length === 1 && after.funding.length === 1 && after.allocations.length === 1 && after.events.length === 1 && after.audits.length === 1 && after.roots.length === 1 && after.facts.length === 0 && after.impacts.length === 0, "PG_CASE_COMMITTED_GRAPH_COUNTS");
  const execution = after.executions[0]!;
  const funding = after.funding[0]!;
  const root = after.roots[0]!;
  check(execution.idempotencyKey === ids.requestKey && execution.amountCents === 4000n && execution.paymentRequestId === ids.payment && execution.voucherFileId === null && funding.executionId === execution.id && funding.operatingLedgerEffectiveDateAtRegistration === null && funding.actualPayerId === ids.companyB && funding.actualPayerKind === "participating_company", "PG_CASE_COMMITTED_EXECUTION_SCOPE");
  check(root.paymentExecutionId === execution.id && root.sourceType === "registered_payment_execution" && root.entryKind === "proxy_payment" && root.direction === "increase" && root.status === "confirmed" && root.originalDebtorCompanyId === ids.companyA && root.creditorCompanyId === ids.companyB && root.amountCents === 4000n && root.projectId === ids.project, "PG_CASE_COMMITTED_A_OWES_B_ROOT");
  check(after.allocations[0]?.amountCents === 4000n && after.allocations[0]?.sourceBatchId === fixture.companyBSourceId && after.request.paidAmountCents === 4000n && after.settlement.paidAmountCents === 4000n && after.request.status === "partially_paid" && after.balanceA === "100.0000" && after.balanceB === "60.0000", "PG_CASE_COMMITTED_CAPACITY_BALANCE");
  const audit = after.audits[0]!;
  const metadata = audit.metadata;
  check(audit.actorUserId === ids.actor && metadata !== null && typeof metadata === "object" && !Array.isArray(metadata), "PG_CASE_COMMITTED_AUDIT_ACTOR");
  const actualPayer = metadata.actualPayer;
  check(metadata.voucherFileId === null && metadata.voucherPending === true && actualPayer !== null && typeof actualPayer === "object" && !Array.isArray(actualPayer) && actualPayer.kind === "participating_company" && actualPayer.id === ids.companyB && !JSON.stringify(metadata).includes(context.password), "PG_CASE_COMMITTED_AUDIT_FACTS");
  const verifyOriginalResult = async () => {
    const result = await checked(() => registeredPgHttp(context, `/payment-executions/results/${ids.requestKey}`, "GET", undefined, fixture.accessToken, continuity));
    const resultBody = result.body as { status?: unknown; execution?: { executionId?: unknown; amountCents?: unknown; paidAt?: unknown }; effects?: unknown[]; intercompany?: unknown[] };
    check(result.status === 200 && resultBody.status === "recorded" && resultBody.execution?.executionId === execution.id && resultBody.execution?.amountCents === "4000" && resultBody.execution?.paidAt === plan.paidAt && resultBody.effects?.length === 0 && resultBody.intercompany?.length === 1, "PG_CASE_PUBLIC_ORIGINAL_RESULT");
  };
  if (scenario === "response-loss") await verifyOriginalResult();
  const replay = await checked(() => submit());
  check(replay.status === 201, "PG_CASE_ORIGINAL_KEY_REPLAY_HTTP");
  const final = await checked(() => observe(context, fixture, continuity));
  check(final.executions.length === 1 && final.executions[0]?.id === execution.id && final.roots.length === 1 && final.roots[0]?.id === root.id && final.events.length === 1 && final.audits.length === 1 && final.allocations.length === 1 && final.request.paidAmountCents === 4000n && final.settlement.paidAmountCents === 4000n && final.balanceA === "100.0000" && final.balanceB === "60.0000", "PG_CASE_REPLAY_NO_SECOND_FINANCIAL_EFFECT");
  check(final.funding.length === 1 && final.funding[0]?.executionId === execution.id && final.funding[0]?.operatingLedgerEffectiveDateAtRegistration === null && final.funding[0]?.actualPayerId === ids.companyB && final.funding[0]?.actualPayerKind === "participating_company" && final.facts.length === 0 && final.impacts.length === 0, "PG_CASE_REPLAY_CANONICAL_SCOPE");
  if (scenario === "commit") await verifyOriginalResult();
  return { caseId: scenario === "commit" ? registeredPaymentPostgresCases()[0]!.id : "registered.null-cross-company.response-loss",
    executed: true, database: identity.database, observerPid: identity.observerPid, executionId: execution.id, rootId: root.id, passed: true,
    limits: scenario === "commit" ? ["Only the normal NULL-project commit/replay case", "No fault, concurrency, approval-path, TLS or deployment acceptance"]
      : ["Only the original-key recovery and replay after one lost HTTP response", "No database disconnect, rollback or concurrency acceptance"] };
}
