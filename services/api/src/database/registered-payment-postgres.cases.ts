import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { assertRegisteredPgCompetitionRoles, assertRegisteredPgConnectedRoles, registeredPgHttp } from "./registered-payment-postgres.fixture";
import type { PreparedRegisteredPgCompetition, PreparedRegisteredPgFixture, RegisteredPgExecutionContext, RegisteredPgSeedContinuity } from "./registered-payment-postgres.fixture";

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

async function snapshot(tx: Prisma.TransactionClient, fixture: PreparedRegisteredPgFixture, continuity?: RegisteredPgSeedContinuity, isolatedPaymentScope = false) {
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
  const projection = { sourceType: "payment_execution", ...(isolatedPaymentScope ? {} : { sourceBusinessId: { in: executionIds } }) };
  const facts = await checked(() => tx.operatingFact.findMany({ where: projection, select: { id: true } }));
  const impacts = await checked(() => tx.operatingImpactEntry.findMany({ where: projection, select: { id: true } }));
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

async function observe(context: RegisteredPgExecutionContext, fixture: PreparedRegisteredPgFixture, continuity?: RegisteredPgSeedContinuity, isolatedPaymentScope = false) {
  const light = () => continuity?.checkLight();
  const checked = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => { light(); const value = await operation(); light(); return value; };
  light();
  return context.observer.$transaction(async tx => {
    const setReadOnly = tx.$executeRawUnsafe;
    await checked(() => setReadOnly.call(tx, "SET TRANSACTION READ ONLY"));
    return snapshot(tx, fixture, continuity, isolatedPaymentScope);
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

async function prepareCrossCompanyCase(context: RegisteredPgExecutionContext, fixture: PreparedRegisteredPgFixture,
  continuity?: RegisteredPgSeedContinuity, isolatedPaymentScope = false) {
  const light = () => continuity?.checkLight();
  const checked = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => { light(); const value = await operation(); light(); return value; };
  light();
  const identity = await checked(() => assertRegisteredPgConnectedRoles(context, continuity));
  const { plan } = fixture;
  const { ids } = plan;
  const before = await checked(() => observe(context, fixture, continuity, isolatedPaymentScope));
  check(before.executions.length === 0 && before.roots.length === 0 && before.request.approvedAmountCents === 10000n && before.request.paidAmountCents === 0n && before.settlement.payableAmountCents === 10000n && before.settlement.paidAmountCents === 0n && before.balanceA === "100.0000" && before.balanceB === "100.0000", "PG_CASE_BEFORE_STATE");
  if (isolatedPaymentScope) {
    check([before.funding, before.allocations, before.events, before.audits, before.facts, before.impacts].every(rows => rows.length === 0),
      "PG_CASE_CANCEL_BEFORE_STATE");
  }
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
  return { checked, identity, before, submit };
}

type CancellationOwnerFields = {
  database: string; databaseOid: string; systemIdentifier: string;
  effectiveRole: string; loginRole: string; ownerOid: string; pid: number; startedAt: string;
  tls: boolean; readOnly: string; isolation: string;
  settlementStatus: string; settlementUpdatedAt: string; requestUpdatedAt: string;
};
const preciseTimestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/u;
const cancellationOwnerFieldsSql = `SELECT
  pg_catalog.current_database() AS database, d.oid::pg_catalog.text AS "databaseOid",
  (SELECT system_identifier::pg_catalog.text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
  current_user::pg_catalog.text AS "effectiveRole", session_user::pg_catalog.text AS "loginRole",
  current_user::pg_catalog.regrole::pg_catalog.oid::pg_catalog.text AS "ownerOid",
  a.pid, pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "startedAt",
  ssl.ssl AS tls, pg_catalog.current_setting('transaction_read_only') AS "readOnly",
  pg_catalog.current_setting('transaction_isolation') AS isolation,
  s."status" AS "settlementStatus",
  pg_catalog.to_char(s."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "settlementUpdatedAt",
  pg_catalog.to_char(p."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "requestUpdatedAt"
FROM public."Settlement" s
JOIN public."PaymentRequest" p ON p."settlementId"=s.id
JOIN pg_catalog.pg_stat_activity a ON a.pid=pg_catalog.pg_backend_pid()
JOIN pg_catalog.pg_database d ON d.oid=a.datid AND d.datname=pg_catalog.current_database()
JOIN pg_catalog.pg_stat_ssl ssl ON ssl.pid=a.pid
WHERE s.id=$1 AND p.id=$2`;

function fixedCancellationMethod(target: object, key: "$transaction" | "$executeRawUnsafe" | "$queryRawUnsafe") {
  const capture = () => {
    for (let layer: object | null = target; layer; layer = Object.getPrototypeOf(layer) as object | null) {
      const descriptor = Object.getOwnPropertyDescriptor(layer, key);
      if (descriptor) {
        check(Object.hasOwn(descriptor, "value"), "PG_CASE_CANCEL_OWNER_CHANGED");
        return { layer, descriptor };
      }
    }
    return null;
  };
  const original = capture();
  return () => {
    const current = capture();
    check(current?.layer === original?.layer && isDeepStrictEqual(current?.descriptor, original?.descriptor),
      "PG_CASE_CANCEL_OWNER_CHANGED");
  };
}

/** The owned case executor provides the one-use commit cancellation gate. */
export async function runRegisteredNullCrossCompanyCommitCancellation(context: RegisteredPgExecutionContext,
  fixture: PreparedRegisteredPgFixture, continuity: RegisteredPgSeedContinuity,
  cancelCommit: (submit: () => Promise<void>) => Promise<void>) {
  // The ordinary observer's fixed ACL omits these columns. Read them only
  // through the already verified, independent owner on this one fixture.
  const owner = context.owner;
  const checkTransaction = fixedCancellationMethod(owner, "$transaction");
  const transaction = owner.$transaction;
  const { checked, identity, before, submit } = await prepareCrossCompanyCase(context, fixture, continuity, true);
  const checkOwner = () => {
    checkTransaction();
    check(context.owner === owner && owner.$transaction === transaction &&
      owner !== context.runtime && owner !== context.observer && typeof transaction === "function",
      "PG_CASE_CANCEL_OWNER_CHANGED");
  };
  const observeOwner = async () => {
    checkOwner();
    const row = await checked(() => owner.$transaction(async tx => {
      const checkSet = fixedCancellationMethod(tx, "$executeRawUnsafe");
      const checkRead = fixedCancellationMethod(tx, "$queryRawUnsafe");
      const setReadOnly = tx.$executeRawUnsafe;
      const read = tx.$queryRawUnsafe;
      await checked(() => setReadOnly.call(tx, "SET TRANSACTION READ ONLY"));
      const checkMethods = () => {
        checkSet();
        checkRead();
        check(tx.$executeRawUnsafe === setReadOnly && tx.$queryRawUnsafe === read,
          "PG_CASE_CANCEL_OWNER_CHANGED");
      };
      checkMethods();
      const rows = await checked(() => read.call(tx, cancellationOwnerFieldsSql, fixture.plan.ids.settlement,
        fixture.plan.ids.payment)) as CancellationOwnerFields[];
      checkMethods();
      const observed = rows[0];
      const proof = context.proof;
      check(rows.length === 1 && observed && observed.database === proof.databaseName &&
        observed.databaseOid === proof.databaseOid && observed.systemIdentifier === proof.systemIdentifier &&
        observed.effectiveRole === proof.ownerRole && observed.loginRole === proof.ownerRole &&
        observed.ownerOid === "10" && observed.pid === identity.ownerPid && observed.tls === true &&
        observed.readOnly === "on" && observed.isolation === "repeatable read" &&
        typeof observed.settlementStatus === "string" && observed.settlementStatus.length > 0 &&
        [observed.startedAt, observed.settlementUpdatedAt, observed.requestUpdatedAt].every(
          value => typeof value === "string" && preciseTimestamp.test(value)), "PG_CASE_CANCEL_OWNER_PROOF");
      return observed;
    }, { isolationLevel: "RepeatableRead" }));
    checkOwner();
    return row;
  };
  const ownerBefore = await observeOwner();
  let submitted = false;
  let status: number | undefined;
  await checked(() => cancelCommit(async () => {
    check(!submitted, "PG_CASE_CANCEL_DUPLICATE_POST");
    submitted = true;
    status = (await checked(() => submit())).status;
  }));
  const after = await checked(() => observe(context, fixture, continuity, true));
  const ownerAfter = await observeOwner();
  check(status === 409 || (status !== undefined && status >= 500 && status <= 599), "PG_CASE_CANCEL_HTTP_STATUS");
  check(isDeepStrictEqual(after, before) && isDeepStrictEqual(ownerAfter, ownerBefore), "PG_CASE_CANCEL_LEDGER_CHANGED");
  return { caseId: "registered.null-cross-company.cancel-commit", database: identity.database,
    observerPid: identity.observerPid, passed: true as const, rollbackObserved: true as const };
}

async function runCrossCompanyCase(context: RegisteredPgExecutionContext, fixture: PreparedRegisteredPgFixture,
  continuity: RegisteredPgSeedContinuity | undefined, scenario: "commit" | "response-loss") {
  const { checked, identity, submit } = await prepareCrossCompanyCase(context, fixture, continuity);
  const { plan } = fixture;
  const { ids } = plan;
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


type CompetitionSubmission = () => ReturnType<typeof registeredPgHttp>;

export async function runRegisteredTwoActorPaymentCompetition(primary: RegisteredPgExecutionContext, contender: RegisteredPgExecutionContext,
  fixture: PreparedRegisteredPgCompetition, controls: {
    lanes: readonly [RegisteredPgSeedContinuity, RegisteredPgSeedContinuity];
    withSamePaymentLock: (paymentId: string, pids: readonly [number, number], submissions: readonly [CompetitionSubmission, CompetitionSubmission]) =>
      Promise<readonly [Awaited<ReturnType<CompetitionSubmission>>, Awaited<ReturnType<CompetitionSubmission>>]>;
  }) {
  const { plan, accessToken, contender: other } = fixture;
  const { ids } = plan;
  const checkLight = () => controls.lanes.forEach(lane => lane.checkLight());
  const checked = async <T>(operation: () => T | PromiseLike<T>): Promise<T> => { checkLight(); const value = await operation(); checkLight(); return value; };
  const identity = await checked(() => assertRegisteredPgCompetitionRoles(primary, contender, controls.lanes[0]));
  const before = await checked(() => observe(primary, fixture, controls.lanes[0], true));
  check(before.request.approvedAmountCents === 4000n && before.request.paidAmountCents === 0n &&
    before.settlement.payableAmountCents === 4000n && before.settlement.paidAmountCents === 0n &&
    before.balanceA === "100.0000" && before.balanceB === "100.0000" &&
    [before.executions, before.funding, before.allocations, before.events, before.audits, before.roots, before.facts, before.impacts].every(rows => rows.length === 0),
  "PG_COMPETITION_BEFORE");
  check(other.actorId !== ids.actor && other.requestKey !== ids.requestKey && other.accessToken !== accessToken, "PG_COMPETITION_ACTORS");
  const actors = [
    { context: primary, key: ids.requestKey, actorId: ids.actor, token: accessToken, continuity: controls.lanes[0] },
    { context: contender, key: other.requestKey, actorId: other.actorId, token: other.accessToken, continuity: controls.lanes[1] }
  ] as const;
  const get = (actor: typeof actors[number], route: string) => registeredPgHttp(actor.context, route, "GET", undefined, actor.token, actor.continuity);
  const work = async (actor: typeof actors[number], paid: string, remaining: string) => {
    const response = await checked(() => get(actor, "/payment-executions/work-items"));
    const body = response.body as { total?: unknown; items?: Array<{ paymentId: string; projectId: string; paidAmountCents: string; remainingAmountCents: string; expectedPaymentUpdatedAt: string }> };
    const item = body.items?.[0];
    check(response.status === 200 && body.total === 1 && body.items?.length === 1 && item?.paymentId === ids.payment && item.projectId === ids.project &&
      item.paidAmountCents === paid && item.remainingAmountCents === remaining && typeof item.expectedPaymentUpdatedAt === "string", "PG_COMPETITION_SHARED_WORK");
    return item.expectedPaymentUpdatedAt;
  };
  const options = async (actor: typeof actors[number]) => {
    const version = await work(actor, "0", "4000");
    const response = await checked(() => get(actor, `/payment-executions/${ids.payment}/registration-options`));
    const body = response.body as { paymentId?: unknown; expectedPaymentUpdatedAt?: unknown; remainingAmountCents?: unknown; accounts?: Array<{scopeKey: string; eligible: boolean}> };
    check(response.status === 200 && body.paymentId === ids.payment && body.expectedPaymentUpdatedAt === version &&
      body.remainingAmountCents === "4000" && body.accounts?.some(row => row.scopeKey === `company:${ids.companyB}` && row.eligible), "PG_COMPETITION_OPTIONS");
    return version;
  };
  const initialVersion = await options(actors[0]);
  check(await options(actors[1]) === initialVersion, "PG_COMPETITION_SAME_INITIAL_VERSION");
  const submit = (actor: typeof actors[number]) => () => registeredPgHttp(actor.context, `/payment-executions/${ids.payment}/registrations`, "POST", {
    idempotencyKey: actor.key, expectedPaymentUpdatedAt: initialVersion, amountCents: "3000", paidAt: plan.paidAt,
    scopeKey: `company:${ids.companyB}`, expectedRegistrationId: fixture.companyBRegistrationId, openingTreatment: "not_included",
    openingReason: "本次实付未计入核对期初", openingEvidence: "隔离PG合成竞办实付及期初依据",
    sourceAllocations: [{ sourceBatchId: fixture.companyBSourceId, amountCents: "3000" }], confirmationPassword: actor.context.password
  }, actor.token, actor.continuity);
  const responses = await checked(() => controls.withSamePaymentLock(ids.payment,
    [identity.primary.runtimePid, identity.contender.runtimePid], [submit(actors[0]), submit(actors[1])]));
  const winner = responses[0].status === 201 ? 0 : 1, loser = winner === 0 ? 1 : 0;
  check(responses[winner].status === 201 && responses[loser].status === 409, "PG_COMPETITION_ONE_HTTP_WINNER");
  const after = await checked(() => observe(primary, fixture, controls.lanes[0], true));
  check(after.executions.length === 1 && after.funding.length === 1 && after.allocations.length === 1 && after.events.length === 1 &&
    after.audits.length === 1 && after.roots.length === 1 && after.facts.length === 0 && after.impacts.length === 0, "PG_COMPETITION_ONE_COMMIT");
  const execution = after.executions[0]!, funding = after.funding[0]!, root = after.roots[0]!, allocation = after.allocations[0]!, audit = after.audits[0]!;
  check(execution.idempotencyKey === actors[winner].key && execution.amountCents === 3000n && execution.paymentRequestId === ids.payment && execution.voucherFileId === null &&
    funding.executionId === execution.id && funding.operatingLedgerEffectiveDateAtRegistration === null && funding.actualPayerId === ids.companyB && funding.actualPayerKind === "participating_company" &&
    allocation.executionId === execution.id && allocation.sourceBatchId === fixture.companyBSourceId && allocation.amountCents === 3000n &&
    after.events[0]?.executionId === execution.id && audit.actorUserId === actors[winner].actorId, "PG_COMPETITION_COMMIT_GRAPH");
  check(root.paymentExecutionId === execution.id && root.sourceType === "registered_payment_execution" && root.entryKind === "proxy_payment" && root.direction === "increase" &&
    root.status === "confirmed" && root.originalDebtorCompanyId === ids.companyA && root.creditorCompanyId === ids.companyB && root.amountCents === 3000n && root.projectId === ids.project &&
    after.request.status === "partially_paid" && after.request.approvedAmountCents === 4000n && after.request.paidAmountCents === 3000n &&
    after.settlement.payableAmountCents === 4000n && after.settlement.paidAmountCents === 3000n && after.balanceA === "100.0000" && after.balanceB === "70.0000", "PG_COMPETITION_CAPACITY_BALANCES");
  for (const index of [winner, loser]) {
    const actor = actors[index]!;
    const response = await checked(() => get(actor, `/payment-executions/results/${actor.key}`));
    const body = response.body as { status?: string; execution?: {executionId?: string; amountCents?: string; paidAt?: string}; effects?: unknown[]; intercompany?: unknown[] };
    check(response.status === 200 && (index === winner ? body.status === "recorded" && body.execution?.executionId === execution.id &&
      body.execution.amountCents === "3000" && body.execution.paidAt === plan.paidAt && body.effects?.length === 0 && body.intercompany?.length === 1 :
      body.status === "unconfirmed" && body.execution === undefined), "PG_COMPETITION_ORIGINAL_KEY_RESULT");
  }
  const finalVersion = await work(actors[0], "3000", "1000");
  check(finalVersion !== initialVersion && await work(actors[1], "3000", "1000") === finalVersion, "PG_COMPETITION_SHARED_AFTER_COMMIT");
  return { caseId: "registered.two-actor.payment-competition", passed: true, executionId: execution.id, rootId: root.id,
    winner: winner === 0 ? "finance_staff" : "comprehensive_director", competitionObserved: true } as const;
}
