import { hash } from "bcryptjs";
import type { INestApplication } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { apiJsonReplacer } from "../api-json-replacer";
import { createApiValidationPipe } from "../validation/api-validation";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { PrismaService } from "./prisma.service";
import { armTask16RegistrationError, takeTask16RegistrationError, Task16RegistrationErrorFilter } from "./task16-registration-error-diagnostic";
import { seedSharedPaymentPredecessors } from "./task16-shared-standard-fixture";

const run = process.env.RUN_TASK425_TEXT_FINANCE === "1" ? it : it.skip;

function dateBefore(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

run("records a two-part text agreement payment with original replay, real refund and repayment", async () => {
  const runId = process.env.TASK398_RUN_ID ?? "";
  const runtime = new URL(process.env.DATABASE_URL ?? "");
  const setup = new URL(process.env.TASK398_OWNER_URL ?? "");
  if (process.env.NODE_ENV !== "test" || process.env.TASK398_OWNED_280 !== "1" ||
      !/^[a-f0-9]{32}$/u.test(runId) || runtime.username !== "jg_task01_runtime" ||
      setup.username !== "jg_task01_owner" || runtime.port !== setup.port ||
      [runtime, setup].some(url => url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" ||
        url.pathname !== "/jg_task01_" + runId || url.searchParams.get("sslmode") !== "require" ||
        url.searchParams.get("sslaccept") !== "strict")) {
    throw new Error("TASK425_TEXT_FINANCE_ISOLATED_DATABASE_REQUIRED");
  }
  const owner = new PrismaClient({ datasources: { db: { url: setup.href } } });
  let app: INestApplication | undefined;
  try {
    const [identity] = await owner.$queryRaw<Array<{ count: number; run: string }>>`
      SELECT (SELECT count(*)::int FROM public._prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS count,
        current_setting('jg.task398_run_id', true) AS run
    `;
    const expectedCount = process.env.TASK425_TEXT_FINANCE_331 === "1" ? 331 : 330;
    expect(identity).toEqual({ count: expectedCount, run: runId });
    const plan = buildRegisteredPgFixturePlan(runId.slice(0, 12), dateBefore(1), dateBefore(2));
    const password = randomBytes(24).toString("hex");
    const passwordHash = await hash(password, 4);
    const actors = await seedSharedPaymentPredecessors(owner, plan, {
      financeHash: passwordHash, keeperHash: passwordHash, directorHash: passwordHash
    }, process.env.FILE_STORAGE_ROOT!, true);
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ logger: false });
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    const registrationErrors = new Task16RegistrationErrorFilter(app.get(HttpAdapterHost));
    app.useGlobalFilters(registrationErrors);
    await app.listen(0, "127.0.0.1");
    const runtimeDb = app.get(PrismaService);
    const [privileges] = await runtimeDb.$queryRaw<Array<{
      role: string; append: boolean; allocationWrite: boolean; executionLockColumns: string[]; executionWriteFence: boolean;
    }>>`
      SELECT session_user::text AS role,
        pg_catalog.has_function_privilege(session_user, 'public.jg_append_text_payment_allocation_v1(text)', 'EXECUTE') AS append,
        pg_catalog.has_any_column_privilege(session_user, 'public."PaymentExecutionAllocation"', 'INSERT,UPDATE') AS "allocationWrite",
        ARRAY(SELECT a.attname::text FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'public."PaymentExecution"'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND pg_catalog.has_column_privilege(session_user, a.attrelid, a.attname::text, 'UPDATE')
          ORDER BY a.attname) AS "executionLockColumns",
        EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = 'public."PaymentExecution"'::regclass
          AND t.tgname = 'jg_task16_runtime_voucher_payment_no_update' AND t.tgenabled = 'A'
          AND t.tgfoid = 'public.jg_task16_runtime_reference_read_only()'::regprocedure) AS "executionWriteFence"
    `;
    expect(privileges).toEqual({ role: "jg_task01_runtime", append: true, allocationWrite: false,
      executionLockColumns: ["id"], executionWriteFence: true });
    const origin = await app.getUrl();
    const json = async (path: string, token?: string, input?: object) => {
      const response = await fetch(origin + path, {
        method: input ? "POST" : "GET",
        headers: {
          ...(token ? { authorization: "Bearer " + token } : {}),
          ...(input ? { "content-type": "application/json" } : {})
        },
        ...(input ? { body: JSON.stringify(input) } : {})
      });
      return { status: response.status, body: await response.json() };
    };
    const login = async (phone: string) => {
      const result = await json("/auth/login", undefined, { phone, password });
      expect(result.status).toBe(201);
      return result.body.tokens.accessToken as string;
    };
    const finance = await login(plan.phone);
    const director = await login(actors.directorPhone);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
    const signature = new FormData();
    signature.append("file", new Blob([png], { type: "image/png" }), "signature.png");
    const signed = await fetch(origin + "/me/signature/canvas", {
      method: "POST", headers: { authorization: "Bearer " + director }, body: signature
    });
    expect(signed.status).toBe(201);
    const payment = await owner.paymentRequest.findUniqueOrThrow({ where: { id: plan.ids.payment } });
    const round = await owner.approvalInstance.findUniqueOrThrow({ where: { id: plan.ids.approvedRound } });
    const approval = await json("/payments/" + payment.id + "/approval", director, {
      decision: "approve", expectedPaymentUpdatedAt: payment.updatedAt.toISOString(),
      expectedApprovalInstanceId: round.id, expectedNodeIndex: 0, expectedApprovalUpdatedAt: round.updatedAt.toISOString()
    });
    expect(approval.status).toBe(201);
    expect(await owner.paymentRequest.findUnique({ where: { id: payment.id } })).toMatchObject({
      approvedAmountCents: 10_000n, status: "approved_pending_payment", paymentTermsStageId: null, settlementId: null
    });

    const scopeKey = "company:" + plan.ids.companyA;
    const opened = await json("/fund-accounts/openings", finance, {
      scopeKey, balanceYuan: "100", asOfDate: plan.openingDate, evidenceReference: "合成资金凭据",
      reconciliationNote: "合成项目来源", reason: "核对同一业务角色的资金状态", idempotencyKey: randomUUID(),
      sources: [{ projectId: plan.ids.project, amountYuan: "100", sourceStatus: "known", sourceName: "合成项目资金", projectStatus: "project" }]
    });
    expect(opened.status).toBe(201);
    const account = await owner.registeredFundAccount.findUniqueOrThrow({ where: { scopeKey } });
    const registrationPath = "/payment-executions/" + payment.id + "/registrations";
    const optionsPath = "/payment-executions/" + payment.id + "/registration-options";
    const body = async (amountCents: string, sourceAmounts: string[]) => {
      const options = await json(optionsPath, finance);
      expect(options.status).toBe(200);
      const current = await owner.fundAccountBalanceRegistration.findFirstOrThrow({
        where: { accountId: account.id, status: "confirmed" }, orderBy: { version: "desc" }, include: { sources: { orderBy: { lineNo: "asc" } } }
      });
      expect(current.sources).toHaveLength(sourceAmounts.length);
      return {
        idempotencyKey: randomUUID(), expectedPaymentUpdatedAt: options.body.expectedPaymentUpdatedAt, amountCents,
        paidAt: plan.paidAt, scopeKey, expectedRegistrationId: current.id, openingTreatment: "not_included",
        openingReason: "付款未含期初", openingEvidence: "合成隔离证据", confirmationPassword: password,
        sourceAllocations: current.sources.map((source, index) => ({ sourceBatchId: source.id, amountCents: sourceAmounts[index] }))
      };
    };
    const firstBody = await body("6000", ["6000"]);
    const server = app.getHttpServer() as object;
    const register = async (input: typeof firstBody) => {
      const ticket = armTask16RegistrationError(registrationErrors, server, payment.id, input.idempotencyKey);
      try {
        return await json(registrationPath, finance, input);
      } finally {
        const diagnostic = takeTask16RegistrationError(registrationErrors, server, ticket);
        expect(diagnostic).toBeUndefined();
      }
    };
    const first = await register(firstBody);
    expect(first.status).toBe(201);
    await expect(runtimeDb.$executeRaw`UPDATE public."PaymentExecution" SET "id" = "id" WHERE "id" = ${first.body.id}`)
      .rejects.toMatchObject({ code: "P2010", meta: { code: "P0001" } });
    await expect(runtimeDb.$executeRaw`SELECT public.jg_append_text_payment_allocation_v1(${first.body.id}::text)`)
      .rejects.toMatchObject({ code: "P2010", meta: { code: "23514" } });
    expect(await json(registrationPath, finance, firstBody)).toEqual(first);
    expect((await json(optionsPath, finance)).body).toMatchObject({ paidAmountCents: "6000", remainingAmountCents: "4000" });

    const refundPath = "/payment-financial/payments/" + payment.id + "/executions/" + first.body.id + "/refunds";
    const refundBody = { amountCents: "2000", receivedAt: plan.paidAt, accountId: account.id,
      reason: "实收部分退款", idempotencyKey: randomUUID() };
    const refund = await json(refundPath, finance, refundBody);
    expect(refund).toMatchObject({ status: 201, body: { refundId: expect.any(String), executionId: first.body.id, idempotent: false } });
    expect(await json(refundPath, finance, refundBody)).toMatchObject({ status: 201, body: {
      refundId: refund.body.refundId, executionId: first.body.id, idempotent: true
    } });
    expect((await json(optionsPath, finance)).body).toMatchObject({ paidAmountCents: "4000", remainingAmountCents: "6000" });

    const secondBody = await body("6000", ["4000", "2000"]);
    const second = await register(secondBody);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(await json(registrationPath, finance, secondBody)).toEqual(second);
    expect(await json(registrationPath, finance, firstBody)).toEqual(first);
    const funds = await json("/fund-accounts", finance);
    expect(funds).toMatchObject({ status: 200, body: { accounts: expect.arrayContaining([
      expect.objectContaining({ scopeKey, balanceYuan: "0.0000" })
    ]) } });
    expect(await owner.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } })).toMatchObject({
      paidAmountCents: 10_000n, status: "paid", approvedAmountCents: 10_000n, settlementId: null, paymentTermsStageId: null
    });
    const executionIds = [first.body.id, second.body.id];
    expect(await owner.paymentExecution.count({ where: { paymentRequestId: payment.id } })).toBe(2);
    expect(await owner.paymentExecutionRefund.findMany({ where: { paymentRequestId: payment.id } })).toEqual([
      expect.objectContaining({ id: refund.body.refundId, amountCents: 2_000n, paymentExecutionId: first.body.id, accountId: account.id })
    ]);
    const paymentAllocations = await owner.paymentExecutionAllocation.findMany({ where: { paymentRequestId: payment.id } });
    expect(paymentAllocations).toHaveLength(2);
    expect(paymentAllocations).toEqual(
      expect.arrayContaining(executionIds.map(id => expect.objectContaining({
        paymentExecutionId: id, amountCents: 6_000n, sourcePayableAmountCents: 10_000n,
        sourceRowId: "payment-request:" + payment.id, settlementId: null, stageId: null, stageType: null
      })))
    );
    expect(await owner.registeredPaymentFunding.count({ where: { executionId: { in: executionIds } } })).toBe(2);
    expect(await owner.operatingFact.count({ where: { sourceType: "payment_execution", sourceBusinessId: { in: executionIds } } })).toBe(2);
    expect(await owner.operatingImpactEntry.findMany({ where: { sourceType: "payment_execution", sourceBusinessId: { in: executionIds } } }))
      .toEqual(expect.arrayContaining(executionIds.flatMap(id => ["payable_decrease", "company_project_funds_decrease"].map(impactKind =>
        expect.objectContaining({ sourceBusinessId: id, impactKind, amountCents: 6_000n })))));
    expect(await owner.paymentTermsStage.count({ where: { paymentTermsVersionId: plan.ids.terms } })).toBe(0);
    expect(await owner.settlement.count({ where: { contractId: plan.ids.contract } })).toBe(0);
  } finally {
    await app?.close();
    await owner.$disconnect();
  }
}, 120_000);
