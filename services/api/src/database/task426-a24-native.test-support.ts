import "reflect-metadata";
import { Catch, type ArgumentsHost, type INestApplication } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Prisma, PrismaClient } from "@prisma/client";
import * as assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { hash } from "bcryptjs";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { PrismaService } from "./prisma.service";
import { projectTask16RegistrationError } from "./task16-registration-error-diagnostic";
import { projectA24ApprovalFailure, projectA24CashFailure, projectA24SignatureFailure,
  projectA24SubmissionFailure, projectA24CashSnapshot, projectA24FixtureAssertion } from "./task426-a24-signature-diagnostic.test-support";
import { createApiValidationPipe } from "../validation/api-validation";

// The native Jest fixture shares this CommonJS entry point with the node:test suite.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { proveA24CashAttribution } = require("../../test-support/task426-a24-native-business.cjs") as {
  proveA24CashAttribution(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

const ROLES = {
  applicant: "employee", keeper: "comprehensive_director", otherComprehensive: "comprehensive_director",
  requester: "finance_staff", reviewer: "finance_director", manager: "project_manager", leader: "chairman"
} as const;
type Actor = keyof typeof ROLES;
type Command = { path: string; method?: string; json?: Record<string, unknown>; form?: FormData; usePassword?: boolean; cashPhase?: string };
type ActiveRequest = Pick<Command, "path" | "cashPhase"> & { method: string };
type Packet = {
  candidate: string; database: string; ownerUrl: string; applicationOid: string; observerUrl: string; observerOid: string;
};
type CaseScope = { projectId: string; claimId: string; factId: string; costImpactId: string; accountId: string; balanceAfter: string };
const cashSnapshotStages = ["OPENING", "VOUCHER_AUTHORITY_ROLLBACK", "INSUFFICIENT_SOURCE_ROLLBACK", "KEEPER_PAYMENT_COMMITTED",
  "FOREIGN_REPLAY_UNCHANGED", "EXACT_REPLAY_UNCHANGED", "ATTRIBUTION_COMMITTED"] as const;
type CashSnapshotStage = typeof cashSnapshotStages[number];
type CashSnapshotRead = "ORIGINAL_COST" | "EXPENSE_EXECUTION" | "OPERATING_CASH_DEBIT" | "FUND_BALANCE" | "ATTRIBUTION_COUNT" | "TALLIES";
const proofPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");
const signaturePath = "/me/signature/canvas";

function packetForIsolatedDatabase(): Packet {
  const path = process.env.TASK426_A24_NATIVE_PACKET;
  assert.ok(path && /^\/private\/tmp\/jg425-seal-329-[a-zA-Z0-9]+\/a24-input[.]json$/u.test(path), "A24_PRIVATE_PACKET");
  const entry = lstatSync(path);
  assert.ok(entry.isFile() && realpathSync(path) === path && entry.uid === process.getuid?.() && (entry.mode & 0o777) === 0o600,
    "A24_PRIVATE_PACKET");
  const packet = JSON.parse(readFileSync(path, "utf8")) as Packet;
  assert.match(packet.candidate, /^[a-f0-9]{40}$/u);
  assert.match(packet.database, /^jg_task01_[a-f0-9]{32}$/u);
  const owner = new URL(packet.ownerUrl);
  const observer = new URL(packet.observerUrl);
  const app = new URL(process.env.DATABASE_URL ?? "");
  for (const url of [owner, observer, app]) {
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/" + packet.database);
    assert.equal(url.port, owner.port);
    assert.notEqual(url.port, "5432");
    assert.equal(url.searchParams.get("sslaccept"), "strict");
    assert.equal(url.searchParams.get("sslcert"), join(dirname(path), "ca.crt"));
    assert.equal(url.searchParams.get("sslmode"), "require");
  }
  assert.equal(owner.username, "jg_task01_owner");
  assert.notEqual(app.username, owner.username);
  assert.notEqual(observer.username, owner.username);
  assert.notEqual(observer.username, app.username);
  assert.equal(process.env.FILE_STORAGE_DRIVER, "local");
  return packet;
}

async function assertBoundRestrictedRole(db: PrismaClient, packet: Packet, roleOid: string) {
  const [role] = await db.$queryRaw<Array<{ safe: boolean; oid: string }>>`
    SELECT current_database() = ${packet.database} AND current_user = session_user
      AND NOT (rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication)
      AND inet_server_addr() = '127.0.0.1'::inet AS safe, oid::text AS oid
    FROM pg_roles WHERE rolname = current_user`;
  expect(role).toEqual({ safe: true, oid: roleOid });
}

it("records and confirms only an exact A24 public cash slice with separate database roles", async () => {
  const packet = packetForIsolatedDatabase();
  const assignment341 = process.env.TASK426_A24_ASSIGNMENT_341 === "1";
  const owner = new PrismaClient({ datasources: { db: { url: packet.ownerUrl } } });
  const observer = new PrismaClient({ datasources: { db: { url: packet.observerUrl } } });
  let app: INestApplication | undefined;
  let stage = "ROLE";
  let activeRequest: ActiveRequest | undefined;
  const cashRequests = new AsyncLocalStorage<ActiveRequest>();
  let cashPhase: string | undefined;
  let httpStatus: number | undefined;
  let httpError: ReturnType<typeof projectTask16RegistrationError> | undefined;
  let signatureFailure: ReturnType<typeof projectA24SignatureFailure> | undefined;
  let submissionFailure: ReturnType<typeof projectA24SubmissionFailure> | undefined;
  let approvalFailure: ReturnType<typeof projectA24ApprovalFailure> | undefined;
  let cashFailure: ReturnType<typeof projectA24CashFailure> | undefined;
  let cashSnapshotStage: CashSnapshotStage | undefined;
  let cashSnapshotRead: CashSnapshotRead | undefined;
  let observedCashSnapshot: ReturnType<typeof projectA24CashSnapshot> | undefined;
  let keeperReceipt: { id: string; expenseClaimId: unknown; paidAmountCents: unknown } | undefined;
  let cashCommitVisibility: Record<string, boolean | "READ_FAILED"> | undefined;
  const captureDatabaseFailure = (error: unknown, operation?: Parameters<typeof projectA24SubmissionFailure>[1]) => {
    if (activeRequest?.cashPhase && activeRequest === cashRequests.getStore()) {
      cashFailure ??= projectA24CashFailure(error, operation);
      return;
    }
    if (activeRequest?.method !== "POST") return;
    if (activeRequest.path === signaturePath) {
      signatureFailure ??= projectA24SignatureFailure(error, operation);
    } else if (stage === "PUBLIC_APPROVAL_SUBMIT" && /^\/expense-claims\/[0-9a-f-]{36}\/submission$/u.test(activeRequest.path)) {
      submissionFailure ??= projectA24SubmissionFailure(error, operation);
    } else if (stage.startsWith("PUBLIC_APPROVAL_REVIEW_") && /^\/expense-claims\/[0-9a-f-]{36}\/approval$/u.test(activeRequest.path)) {
      approvalFailure ??= projectA24ApprovalFailure(error, operation);
    }
  };
  try {
    await assertBoundRestrictedRole(observer, packet, packet.observerOid);
    const [observerReadOnly] = await observer.$queryRaw<Array<{ readonly: boolean }>>`
      SELECT current_setting('transaction_read_only') = 'on' AS readonly`;
    assert.equal(observerReadOnly?.readonly, true);
    expect(await owner.expenseClaim.count()).toBe(0);
    expect(await owner.registeredFundAccount.count()).toBe(0);
    stage = "MASTER_DATA_ONLY";
    const suffix = randomUUID();
    const password = randomUUID();
    const users = new Map<Actor, { id: string; phone: string }>();
    const positions = new Map<Actor, string>();
    for (const actor of Object.keys(ROLES) as Actor[]) {
      const role = ROLES[actor];
      const user = await owner.user.create({ data: {
        name: "隔离费用" + actor, phone: `${suffix}-${actor}`, passwordHash: await hash(password, 4), mustChangePassword: false
      }, select: { id: true, phone: true } });
      const position = await owner.position.upsert({ where: { key: role }, update: {},
        create: { key: role, name: role } });
      assert.ok(user.phone);
      users.set(actor, { id: user.id, phone: user.phone });
      positions.set(actor, position.id);
      if (actor !== "applicant" && actor !== "manager") {
        await owner.userPosition.create({ data: { userId: user.id, positionId: position.id } });
      }
    }

    const { id: keeperId } = users.get("keeper")!;
    const openingDay = new Date("2026-10-01T00:00:00.000Z");
    const activeDay = new Date("2026-10-02T00:00:00.000Z");
    const affiliate = await owner.businessParty.create({ data: {
      name: "隔离施工企业", normalizedName: suffix, unifiedSocialCreditCode: "91350211M000100Y46", createdByUserId: keeperId
    } });
    const affiliateVersion = await owner.businessPartyVersion.create({ data: {
      businessPartyId: affiliate.id, versionNo: 1, snapshot: { name: affiliate.name }, createdByUserId: keeperId
    } });
    const companies = [];
    for (const [name, credit] of [["隔离债务公司", "91440300708461136T"], ["隔离成本承担公司", "91310115MA1K3X9E25"]]) {
      const company = await owner.companyEntity.create({ data: {
        name, unifiedSocialCreditCode: credit, currentVersionNo: 1, dataStatus: "complete"
      } });
      const version = await owner.companyEntityVersion.create({ data: {
        companyEntityId: company.id, versionNo: 1, name, unifiedSocialCreditCode: credit,
        isActive: true, action: "create", actorUserId: keeperId
      } });
      companies.push({ company, version });
    }
    const [debtor, bearing] = companies;
    const projects: string[] = [];
    for (const label of ["PRIMARY", "REFUND"]) {
      const project = await owner.project.create({
        data: { code: `A24-${label}-${suffix}`, name: `公共现金隔离费用-${label}`, createdAt: openingDay }
      });
      await owner.projectAffiliateAssignment.create({ data: {
        projectId: project.id, businessPartyId: affiliate.id, businessPartyVersionId: affiliateVersion.id,
        affiliateNameSnapshot: affiliate.name, affiliateCreditCodeSnapshot: affiliate.unifiedSocialCreditCode,
        effectiveFrom: openingDay, changeReason: "隔离业务验收", assignedByUserId: keeperId
      } });
      for (const { company, version } of companies) {
        await owner.projectParticipatingCompany.create({ data: { projectId: project.id,
          companyEntityId: company.id, companyEntityVersionId: version.id, companyNameSnapshot: company.name,
          companyCreditCodeSnapshot: company.unifiedSocialCreditCode, effectiveFrom: openingDay,
          changeReason: "隔离业务验收", addedByUserId: keeperId } });
      }
      for (const actor of ["applicant", "manager"] as const) {
        await owner.userPosition.create({
          data: { userId: users.get(actor)!.id, positionId: positions.get(actor)!, projectId: project.id }
        });
      }
      await owner.project.update({ where: { id: project.id }, data: { operatingLedgerEffectiveDate: activeDay } });
      projects.push(project.id);
    }
    const account = await owner.registeredFundAccount.create({ data: { kind: "public_cash", scopeKey: "public_cash" } });
    await owner.fundAccountBalanceRegistration.create({ data: {
      accountId: account.id, version: 1, kind: "opening", status: "confirmed", balanceYuan: "30.0000",
      asOfDate: "2026-10-02", evidenceReference: "合成原始盘点记录", reconciliationNote: "隔离核对",
      reason: "隔离初始余额", idempotencyKey: randomUUID(), payloadFingerprint: "a".repeat(64),
      createdByUserId: keeperId, confirmedByUserId: keeperId, confirmedAt: activeDay,
      sources: { create: [
        { lineNo: 1, amountYuan: "28.0000", sourceStatus: "known", sourceName: "合成出资来源一", projectStatus: "pending" },
        { lineNo: 2, amountYuan: "2.0000", sourceStatus: "pending", projectStatus: "pending" }
      ] }
    } });

    stage = "PUBLIC_HTTP_COMPILE";
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    stage = "PUBLIC_HTTP_CONFIGURE";
    app = module.createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.use((request: { method: string; originalUrl: string }, _response: unknown, next: () => void) => {
      const active = activeRequest;
      if (active?.cashPhase && active.method === request.method && active.path === request.originalUrl) {
        cashRequests.run(active, next);
      } else {
        next();
      }
    });
    app.useGlobalPipes(createApiValidationPipe());
    @Catch()
    class A24NativeHttpDiagnostic extends BaseExceptionFilter {
      override catch(exception: unknown, host: ArgumentsHost) {
        try {
          const request = host.switchToHttp().getRequest<{ method: string; originalUrl: string }>();
          if (activeRequest?.method === request.method && activeRequest.path === request.originalUrl) {
            httpError ??= projectTask16RegistrationError(exception);
            captureDatabaseFailure(exception);
          }
        } catch { /* Diagnostics never replace the original HTTP response. */ }
        super.catch(exception, host);
      }
    }
    app.useGlobalFilters(new A24NativeHttpDiagnostic(app.get(HttpAdapterHost).httpAdapter));
    app.get(PrismaService).$use(async (params, next) => {
      try {
        return await next(params);
      } catch (error) {
        captureDatabaseFailure(error, params);
        throw error;
      }
    });
    stage = "PUBLIC_HTTP_LISTEN";
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    stage = "PUBLIC_HTTP_APPLICATION_ROLE";
    const application = app.get(PrismaService);
    await assertBoundRestrictedRole(application, packet, packet.applicationOid);
    const tokens = new Map<string, string>();
    const send = async (actor: string, command: Command) => {
      const body = command.usePassword ? { ...command.json, confirmationPassword: password } : command.json;
      httpStatus = undefined;
      httpError = undefined;
      signatureFailure = undefined;
      submissionFailure = undefined;
      approvalFailure = undefined;
      cashFailure = undefined;
      cashSnapshotStage = undefined;
      cashSnapshotRead = undefined;
      observedCashSnapshot = undefined;
      cashPhase = command.cashPhase;
      if (cashPhase) {
        assert.match(cashPhase, /^[A-Z0-9_]{1,40}$/u, "A24_CASH_PHASE");
        stage = "A24_CASH_AND_G4";
      }
      const method = command.method ?? "GET";
      activeRequest = { method, path: command.path, cashPhase };
      try {
        const response = await fetch(base + command.path, {
          method, signal: AbortSignal.timeout(10_000),
          headers: { ...(tokens.has(actor) ? { authorization: "Bearer " + tokens.get(actor) } : {}),
            ...(body ? { "content-type": "application/json" } : {}) },
          body: command.form ?? (body ? JSON.stringify(body) : undefined)
        });
        httpStatus = response.status;
        const payload = await response.json();
        if (cashPhase === "KEEPER_PUBLIC_CASH_PAYMENT" && response.status === 201 &&
          typeof payload.id === "string" && /^[0-9a-f-]{36}$/u.test(payload.id)) {
          keeperReceipt = { id: payload.id, expenseClaimId: payload.expenseClaimId, paidAmountCents: payload.paidAmountCents };
        }
        return { status: response.status, body: payload };
      } finally {
        activeRequest = undefined;
      }
    };
    for (const [actor, user] of users) {
      stage = "PUBLIC_HTTP_LOGIN_" + actor.toUpperCase();
      const login = await send(actor, { path: "/auth/login", method: "POST", json: { phone: user.phone, password } });
      assert.equal(login.status, 201, "A24_LOGIN_" + actor);
      stage = "PUBLIC_HTTP_LOGIN_TOKEN_" + actor.toUpperCase();
      assert.equal(typeof login.body.tokens?.accessToken, "string");
      tokens.set(actor, login.body.tokens.accessToken);
    }
    for (const actor of ["keeper", "manager", "reviewer", "leader"] as const) {
      stage = "PUBLIC_HTTP_SIGNATURE_" + actor.toUpperCase();
      const form = new FormData();
      form.append("file", new Blob([proofPng], { type: "image/png" }), "合成签名.png");
      assert.equal((await send(actor, { path: signaturePath, method: "POST", form })).status, 201, "A24_SIGNATURE");
    }
    stage = "PUBLIC_HTTP_INITIAL_CUSTODY";
    const custody = await send("keeper", { path: "/public-cash-handovers/initial-custodian", method: "POST",
      json: { idempotencyKey: randomUUID(), expectedRevision: 0 } });
    assert.equal(custody.status, 201, "A24_INITIAL_CUSTODY");
    stage = "PUBLIC_HTTP_INITIAL_CUSTODY_RECEIPT";
    assert.equal(custody.body.custodianId, keeperId);
    stage = "PUBLIC_APPROVAL";
    const approveExpense = async (projectId: string) => {
      stage = "PUBLIC_APPROVAL_CREATE";
      const created = await send("applicant", { path: "/expense-claims", method: "POST", json: {
        claimType: "incidental_expense", incidentalExpenseCategory: "temporary_service",
        companyEntityId: debtor.company.id, costBearingCompanyEntityId: null, projectId,
        applicantUserId: users.get("applicant")!.id, payeeName: "合成服务方", reason: "隔离费用归属",
        requestedAmountCents: "800"
      } });
      assert.equal(created.status, 201, "A24_CREATE");
      const claimId = created.body.id;
      const path = "/expense-claims/" + claimId;
      stage = "PUBLIC_APPROVAL_SUBMIT";
      const submitted = await send("applicant", { path: path + "/submission", method: "POST", json: {} });
      assert.equal(submitted.status, 201, "A24_SUBMIT");
      if (assignment341 && projectId === projects[0]) {
        stage = "PUBLIC_APPROVAL_ASSIGNMENT_ROLLBACK";
        const where = { id: projectId };
        const select = { constructionEnterpriseLockedAt: true } as const;
        assert.equal((await application.project.findUniqueOrThrow({ where, select })).constructionEnterpriseLockedAt, null);
        const rollback = new Error("A24_EXPECTED_ASSIGNMENT_ROLLBACK");
        await assert.rejects(application.$transaction(async tx => {
          await tx.expenseClaim.update({ where: { id: claimId },
            data: { status: "approved_pending_payment", approvedAt: new Date() }, select: { id: true } });
          assert.ok((await tx.project.findUniqueOrThrow({ where, select })).constructionEnterpriseLockedAt instanceof Date);
          throw rollback;
        }), error => error === rollback);
        assert.equal((await application.project.findUniqueOrThrow({ where, select })).constructionEnterpriseLockedAt, null);
        assert.equal((await application.expenseClaim.findUniqueOrThrow({ where: { id: claimId }, select: { status: true } })).status,
          "approval_pending");
      }
      for (const actor of ["keeper", "manager", "reviewer", "leader"] as const) {
        stage = "PUBLIC_APPROVAL_DETAIL_" + actor.toUpperCase();
        const detail = await send(actor, { path });
        assert.equal(detail.status, 200, "A24_APPROVAL_DETAIL_" + actor);
        assert.equal(detail.body.approval.actionableDuties.length, 1);
        stage = "PUBLIC_APPROVAL_REVIEW_" + actor.toUpperCase();
        const review = await send(actor, { path: path + "/approval", method: "POST", json: {
          decision: "approve", approvalInstanceId: detail.body.approval.approvalInstanceId,
          approvalDutyIndex: detail.body.approval.actionableDuties[0].index
        } });
        assert.equal(review.status, 201, "A24_APPROVAL_" + actor);
      }
      if (assignment341) {
        stage = "PUBLIC_APPROVAL_OBSERVE_ASSIGNMENT_LOCK";
        const lockedProject = await application.project.findUniqueOrThrow({
          where: { id: projectId }, select: { constructionEnterpriseLockedAt: true }
        });
        assert.ok(lockedProject.constructionEnterpriseLockedAt instanceof Date);
      }
      stage = "PUBLIC_APPROVAL_OBSERVE_COST";
      httpStatus = undefined;
      httpError = undefined;
      const fact = await observer.operatingFact.findFirstOrThrow({ where: {
        projectId, sourceType: "expense_claim_approval", sourceBusinessId: claimId
      }, select: { id: true, costBearingCompanySubjectId: true, impacts: {
        where: { impactKind: "confirmed_cost" }, select: { id: true, amountCents: true }
      } } });
      assert.equal(fact.costBearingCompanySubjectId, null);
      assert.deepEqual(fact.impacts.map(row => row.amountCents), [800n]);
      stage = "PUBLIC_APPROVAL_OBSERVE_BALANCE";
      const current = await observer.fundAccountBalanceRegistration.findFirstOrThrow({
        where: { accountId: account.id, status: "confirmed" }, orderBy: { version: "desc" },
        select: { id: true, balanceYuan: true, sources: { orderBy: { lineNo: "asc" }, select: { id: true } } }
      });
      return { projectId, claimId, factId: fact.id, costImpactId: fact.impacts[0].id, accountId: account.id,
        debtorId: debtor.company.id, bearingCompanyId: bearing.company.id, bearingCompanyVersionId: bearing.version.id,
        registrationId: current.id, sourceId: current.sources[0].id, insufficientSourceId: current.sources[1].id,
        balanceBefore: current.balanceYuan?.toFixed(4), balanceAfter: "22.0000", paidAt: "2026-11-20" };
    };

    const primary = await approveExpense(projects[0]);
    stage = "A24_CASH_AND_G4";
    tokens.set("refundOperator", tokens.get("reviewer")!);
    const proof = await proveA24CashAttribution({
      send, primary,
      ...(process.env.TASK426_A24_CASH_VOUCHER_344 === "1" ? {
        voucherBoundary: async (scope: typeof primary, fileId: string) => {
          stage = "A24_CASH_VOUCHER_BOUNDARY";
          const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
          assert.ok(secret, "A24_CASH_VOUCHER_FIXTURE");
          const submit = (credential: string, actorId: string, enforceDebit = false) => application.$transaction(async tx => {
            await tx.$queryRaw`SELECT public.jg_record_expense_public_cash_voucher(
              ${scope.claimId}, ${actorId}, 800::bigint, ${scope.paidAt}::timestamp,
              '现金', ${fileId}, NULL::text, ${scope.registrationId}, ${credential}
            )`;
            if (enforceDebit) await tx.$executeRaw`
              SET CONSTRAINTS public.jg_expense_public_cash_voucher_debit_required IMMEDIATE
            `;
          });
          const exactRejection = (code: string, label: string) => (error: unknown) =>
            error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" &&
            error.meta?.code === code && typeof error.meta.message === "string" &&
            error.meta.message.replace(/^ERROR: /u, "") === label;
          await assert.rejects(submit("invalid-isolated-a24-cash-authority", keeperId),
            exactRejection("42501", "EXPENSE_PUBLIC_CASH_VOUCHER_AUTHORITY"), "A24_CASH_AUTHORITY_DENIAL");
          await assert.rejects(submit(secret, users.get("otherComprehensive")!.id),
            exactRejection("42501", "EXPENSE_PUBLIC_CASH_VOUCHER_KEEPER"), "A24_CASH_KEEPER_DENIAL");
          await assert.rejects(submit(secret, keeperId, true),
            exactRejection("23514", "EXPENSE_PUBLIC_CASH_VOUCHER_DEBIT_REQUIRED"), "A24_CASH_UNFUNDED_DENIAL");
          return { wrongCredentialDenied: true, foreignKeeperDenied: true, unfundedExecutionRolledBack: true };
        }
      } : {}),
      refundCase: async () => ({ ...await approveExpense(projects[1]), refund: { accountScopeKey: "public_cash",
        receivedAt: "2026-11-21", evidenceReference: "隔离退款凭据", reason: "隔离供应商退款" } }),
      snapshot: async (scope: CaseScope, snapshotStage: CashSnapshotStage) => {
        assert.ok(cashSnapshotStages.includes(snapshotStage), "A24_CASH_SNAPSHOT_STAGE");
        cashSnapshotStage = snapshotStage;
        cashSnapshotRead = "ORIGINAL_COST";
        observedCashSnapshot = undefined;
        const costs = await observer.operatingImpactEntry.findMany({
          where: { projectId: scope.projectId, impactKind: "confirmed_cost" }, select: { amountCents: true }
        });
        cashSnapshotRead = "EXPENSE_EXECUTION";
        const ownerPayment = await observer.expenseClaimPaymentExecution.findMany({
          where: { expenseClaimId: scope.claimId }, select: { id: true, amountCents: true }
        });
        cashSnapshotRead = "OPERATING_CASH_DEBIT";
        const cashDebits = await observer.operatingImpactEntry.count({
          where: { projectId: scope.projectId, impactKind: "public_cash_funds_decrease",
            sourceType: "expense_claim_payment_execution", sourceBusinessId: { in: ownerPayment.map(payment => payment.id) } }
        });
        cashSnapshotRead = "FUND_BALANCE";
        const balance = await observer.fundAccountBalanceRegistration.findFirstOrThrow({
          where: { accountId: scope.accountId, status: "confirmed" }, orderBy: { version: "desc" }, select: { balanceYuan: true }
        });
        cashSnapshotRead = "ATTRIBUTION_COUNT";
        const acceptedAttributions = await observer.operatingCostAttributionConfirmation.count({
          where: { projectId: scope.projectId, operatingFactId: scope.factId, status: "confirmed" }
        });
        cashSnapshotRead = "TALLIES";
        const result = { costRows: costs.length, costCents: costs.reduce((sum, row) => sum + (row.amountCents ?? 0n), 0n).toString(),
          paymentExecutions: ownerPayment.length, paidCents: ownerPayment.reduce((sum, row) => sum + row.amountCents, 0n).toString(),
          cashDebits, cashBalanceYuan: balance.balanceYuan?.toFixed(4), acceptedAttributions };
        observedCashSnapshot = projectA24CashSnapshot(result);
        if (snapshotStage === "KEEPER_PAYMENT_COMMITTED" &&
          (result.paymentExecutions !== 1 || result.cashDebits !== 1 || result.cashBalanceYuan !== scope.balanceAfter)) {
          const readRole = async (client: PrismaClient) => {
            const claim = await client.expenseClaim.findUnique({
              where: { id: scope.claimId }, select: { status: true, fundedAmountCents: true }
            });
            const execution = keeperReceipt && await client.expenseClaimPaymentExecution.findUnique({
              where: { id: keeperReceipt.id }, select: { expenseClaimId: true, amountCents: true }
            });
            return {
              claimPaid: claim?.status === "paid" && claim.fundedAmountCents === 800n,
              matchingExecution: execution?.expenseClaimId === scope.claimId && execution.amountCents === 800n
            };
          };
          const roleReads = await Promise.allSettled([readRole(application), readRole(owner),
            owner.fundAccountBalanceRegistration.findFirst({
              where: { accountId: scope.accountId, status: "confirmed" }, orderBy: { version: "desc" },
              select: { balanceYuan: true }
            })]);
          const [applicationRead, ownerRead, ownerBalance] = roleReads;
          cashCommitVisibility = {
            receiptMatchesClaim: keeperReceipt?.expenseClaimId === scope.claimId && keeperReceipt.paidAmountCents === "800",
            applicationClaimPaid: applicationRead.status === "fulfilled" ? applicationRead.value.claimPaid : "READ_FAILED",
            applicationExecution: applicationRead.status === "fulfilled" ? applicationRead.value.matchingExecution : "READ_FAILED",
            ownerClaimPaid: ownerRead.status === "fulfilled" ? ownerRead.value.claimPaid : "READ_FAILED",
            ownerExecution: ownerRead.status === "fulfilled" ? ownerRead.value.matchingExecution : "READ_FAILED",
            ownerBalanceDebited: ownerBalance.status === "fulfilled"
              ? ownerBalance.value?.balanceYuan?.toFixed(4) === scope.balanceAfter : "READ_FAILED"
          };
        }
        return result;
      }
    });
    process.stdout.write("NATIVE_A24_PROOF " + JSON.stringify({ candidate: packet.candidate, ...proof,
      ...(assignment341 ? { assignmentLock: { rollbackVerified: true, approvedProjectsLocked: 2 } } : {})
    }) + "\n");
  } catch (error) {
    const message = projectA24FixtureAssertion(error) ?? "A24_CHECK_FAILED";
    const assertion = error as { code?: unknown; actual?: unknown; expected?: unknown };
    const isHttpStatus = (value: unknown): value is number =>
      typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
    process.stderr.write("NATIVE_A24_FAILURE " + JSON.stringify({
      stage, message,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(assertion?.code === "ERR_ASSERTION" && isHttpStatus(assertion.actual) && assertion.actual === httpStatus &&
        isHttpStatus(assertion.expected) ? { expectedHttpStatus: assertion.expected } : {}),
      ...projectTask16RegistrationError(error),
      ...(httpError ? { httpError } : {}),
      ...(signatureFailure ? { signatureFailure } : {}),
      ...(submissionFailure ? { submissionFailure } : {}),
      ...(approvalFailure ? { approvalFailure } : {}),
      ...(cashPhase ? { cashPhase } : {}),
      ...(cashFailure ? { cashFailure } : {}),
      ...(cashSnapshotStage ? { cashSnapshotStage, cashSnapshotRead,
        ...(observedCashSnapshot ? { observedCashSnapshot } : {}),
        ...(cashCommitVisibility ? { cashCommitVisibility } : {}),
        ...(cashSnapshotRead !== "TALLIES" ? { snapshotReadFailure: projectA24CashFailure(error) } : {}),
        ...(message === "A24_ONE_COST_ONE_CASH_DEBIT" && assertion?.code === "ERR_ASSERTION"
          ? { expectedCashSnapshot: projectA24CashSnapshot(assertion.expected) } : {})
      } : {})
    }) + "\n");
    throw new Error(stage + " " + message);
  } finally {
    await app?.close();
    await observer.$disconnect();
    await owner.$disconnect();
  }
}, 180_000);
