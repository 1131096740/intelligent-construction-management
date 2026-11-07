import type { Prisma } from "@prisma/client";
import { assertRegisteredPgConnectedRoles, registeredPgHttp } from "./registered-payment-postgres.fixture";
import type { PreparedRegisteredPgFixture, RegisteredPgExecutionContext } from "./registered-payment-postgres.fixture";

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
    limits: ["Pre-approved state fixture; no approval-path acceptance", "Requires future explicitly authorized connected executor", "No failure/concurrency cases or resource driver implemented"]
  }];
}

function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

async function snapshot(tx: Prisma.TransactionClient, fixture: PreparedRegisteredPgFixture) {
  const { ids } = fixture.plan;
  const request = await tx.paymentRequest.findUniqueOrThrow({ where: { id: ids.payment }, select: { approvedAmountCents: true, paidAmountCents: true, status: true } });
  const settlement = await tx.settlement.findUniqueOrThrow({ where: { id: ids.settlement }, select: { payableAmountCents: true, paidAmountCents: true } });
  const executions = await tx.paymentExecution.findMany({ where: { paymentRequestId: ids.payment }, select: { id: true, idempotencyKey: true, amountCents: true, paymentRequestId: true, voucherFileId: true } });
  const executionIds = executions.map(row => row.id);
  const funding = await tx.registeredPaymentFunding.findMany({ where: { executionId: { in: executionIds } }, select: { executionId: true, operatingLedgerEffectiveDateAtRegistration: true, actualPayerId: true, actualPayerKind: true } });
  const allocations = await tx.registeredFundPaymentAllocation.findMany({ where: { executionId: { in: executionIds } }, select: { executionId: true, accountId: true, sourceBatchId: true, amountCents: true } });
  const events = await tx.registeredPaymentEvent.findMany({ where: { executionId: { in: executionIds } }, select: { executionId: true } });
  const roots = await tx.interEntityRelationshipEntry.findMany({ where: { paymentExecutionId: { in: executionIds } }, select: { id: true, paymentExecutionId: true, sourceType: true, entryKind: true, direction: true, status: true, originalDebtorCompanyId: true, creditorCompanyId: true, amountCents: true, projectId: true } });
  const facts = await tx.operatingFact.findMany({ where: { sourceType: "payment_execution", sourceBusinessId: { in: executionIds } }, select: { id: true } });
  const impacts = await tx.operatingImpactEntry.findMany({ where: { sourceType: "payment_execution", sourceBusinessId: { in: executionIds } }, select: { id: true } });
  const audits = await tx.auditLog.findMany({ where: { businessType: "payment_request", businessId: ids.payment, action: "payment.execution.record" }, select: { actorUserId: true, metadata: true } });
  // Independent amounts come from the real immutable opening + canonical
  // postings, never the response or the application balance helper.
  const [openingA, openingB] = await Promise.all([fixture.companyARegistrationId, fixture.companyBRegistrationId].map(id => tx.fundAccountBalanceRegistration.findUniqueOrThrow({ where: { id }, select: { accountId: true, balanceYuan: true, coveredExecutionIds: true } })));
  const allPostings = await tx.registeredFundPaymentAllocation.findMany({ where: { accountId: { in: [openingA.accountId, openingB.accountId] } }, select: { executionId: true, accountId: true, sourceBatchId: true, amountCents: true } });
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

async function observe(context: RegisteredPgExecutionContext, fixture: PreparedRegisteredPgFixture) {
  return context.observer.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return snapshot(tx, fixture);
  }, { isolationLevel: "RepeatableRead" });
}

/** Never called on import. The future executor owns authorization, installation,
 * application startup, client connection and cleanup. This is one case only. */
export async function runRegisteredNullCrossCompanyCommit(context: RegisteredPgExecutionContext, fixture: PreparedRegisteredPgFixture) {
  const identity = await assertRegisteredPgConnectedRoles(context);
  const { plan } = fixture;
  const { ids } = plan;
  const before = await observe(context, fixture);
  check(before.executions.length === 0 && before.roots.length === 0 && before.request.approvedAmountCents === 10000n && before.request.paidAmountCents === 0n && before.settlement.payableAmountCents === 10000n && before.settlement.paidAmountCents === 0n && before.balanceA === "100.0000" && before.balanceB === "100.0000", "PG_CASE_BEFORE_STATE");
  const optionsResponse = await registeredPgHttp(context, `/payment-executions/${ids.payment}/registration-options`, "GET", undefined, fixture.accessToken);
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
  const response = await registeredPgHttp(context, `/payment-executions/${ids.payment}/registrations`, "POST", command, fixture.accessToken);
  check(response.status === 201, "PG_CASE_REGISTRATION_HTTP_STATUS");
  const after = await observe(context, fixture);
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
  const replay = await registeredPgHttp(context, `/payment-executions/${ids.payment}/registrations`, "POST", command, fixture.accessToken);
  check(replay.status === 201, "PG_CASE_ORIGINAL_KEY_REPLAY_HTTP");
  const final = await observe(context, fixture);
  check(final.executions.length === 1 && final.executions[0]?.id === execution.id && final.roots.length === 1 && final.roots[0]?.id === root.id && final.events.length === 1 && final.audits.length === 1 && final.allocations.length === 1 && final.request.paidAmountCents === 4000n && final.settlement.paidAmountCents === 4000n && final.balanceA === "100.0000" && final.balanceB === "60.0000", "PG_CASE_REPLAY_NO_SECOND_FINANCIAL_EFFECT");
  const result = await registeredPgHttp(context, `/payment-executions/results/${ids.requestKey}`, "GET", undefined, fixture.accessToken);
  const resultBody = result.body as { status?: unknown; execution?: { executionId?: unknown; amountCents?: unknown; paidAt?: unknown }; effects?: unknown[]; intercompany?: unknown[] };
  check(result.status === 200 && resultBody.status === "recorded" && resultBody.execution?.executionId === execution.id && resultBody.execution?.amountCents === "4000" && resultBody.execution?.paidAt === plan.paidAt && resultBody.effects?.length === 0 && resultBody.intercompany?.length === 1, "PG_CASE_PUBLIC_ORIGINAL_RESULT");
  return { caseId: registeredPaymentPostgresCases()[0]!.id, executed: true, database: identity.database, observerPid: identity.observerPid, executionId: execution.id, rootId: root.id, passed: true, limits: ["Only the normal NULL-project commit/replay case", "No fault, concurrency, approval-path, TLS or deployment acceptance"] };
}
