import { type INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { JwtTokenService } from "../auth/jwt-token.service";
import { PrismaService } from "../database/prisma.service";
import { createFundAccountSyntheticDb } from "../fund-account/testing/fund-account.synthetic-db";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { createApiValidationPipe } from "../validation/api-validation";
import { RegisteredPaymentExecutionController } from "./registered-payment-execution.controller";
import { RegisteredPaymentExecutionService } from "./registered-payment-execution.service";
import { MeController } from "../me/me.controller";
import { MeService } from "../me/me.service";
import { FileService } from "../file/file.service";
import { AuditService } from "../audit/audit.service";

// Persistence and identity facts are synthetic. HTTP, role resolution, JWT,
// permission/retirement guards and the business service remain real.
describe("registered payment execution public HTTP (synthetic persistence)", () => {
  let app: INestApplication;
  let database: ReturnType<typeof createFundAccountSyntheticDb>;
  const tokens = new JwtTokenService();
  beforeEach(async () => {
    database = createFundAccountSyntheticDb();
    const seed = database.prisma as unknown as {
      paymentRequest: { create(input: { data: Record<string, unknown> }): Promise<unknown> };
      approvalInstance: { create(input: { data: Record<string, unknown> }): Promise<unknown> };
    };
    await seed.approvalInstance.create({ data: {
      id: "approved-round-a", businessType: "payment_request", businessId: "payment-a",
      flowType: "payment.approve", status: "approved", frozenNodes: [], currentNodeIndex: 1, applicantUserId: "employee",
      createdAt: new Date("2026-11-01T00:00:00Z")
    } });
    await seed.paymentRequest.create({ data: {
      id: "payment-a", code: "FK-16-01", projectId: "project-a", sourceType: "contract_due",
      paymentSubjectType: "our_company", contractId: "contract-a", contractVersionId: "version-a", paymentTermsVersionId: "terms-a",
      requestedAmountCents: 10000n, approvedAmountCents: 10000n, paidAmountCents: 0n,
      status: "approved_pending_payment",
      updatedAt: new Date("2026-11-05T00:00:00Z")
    } });
    const module = await Test.createTestingModule({
      controllers: [RegisteredPaymentExecutionController, MeController],
      providers: [RegisteredPaymentExecutionService, MeService, AuditService, { provide: FileService, useValue: {} }, { provide: PrismaService, useValue: database.prisma }]
    }).compile();
    app = module.createNestApplication({ logger: false });
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(reflector, tokens, database.prisma as never),
      new RetiredWriteEntryGuard(), new PermissionGuard(reflector, database.prisma as never));
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
  });
  afterEach(async () => { await app?.close(); });
  async function get(actor: string, path = "/payment-executions/work-items") {
    const token = tokens.signAccessToken({ id: actor, name: "合成付款人员", phone: null, sessionVersion: 0 });
    const response = await fetch(`${await app.getUrl()}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  }
  it("gives current finance and comprehensive director the same approved unpaid request without fabricating bank information", async () => {
    for (const actor of ["finance", "keeper"]) {
      const response = await get(actor);
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([expect.objectContaining({
        paymentId: "payment-a", code: "FK-16-01", paidAmountCents: "0", remainingAmountCents: "10000"
      })]);
    }
  });
  it("keeps a previously partially-paid fixture in both current queues and removes a fully paid fixture", async () => {
    const payments = (database.prisma as unknown as { paymentRequest: { update(input: {where: {id: string}; data: Record<string, unknown>}): Promise<unknown> } }).paymentRequest;
    await payments.update({ where: { id: "payment-a" }, data: { paidAmountCents: 4000n, status: "partially_paid" } });
    for (const actor of ["finance", "keeper"]) {
      expect(await get(actor)).toMatchObject({ status: 200, body: { total: 1, items: [
        expect.objectContaining({ paidAmountCents: "4000", remainingAmountCents: "6000" })
      ] } });
    }
    await payments.update({ where: { id: "payment-a" }, data: { paidAmountCents: 10000n, status: "paid" } });
    expect(await get("finance")).toMatchObject({ status: 200, body: { total: 0, items: [] } });
    expect(await get("keeper")).toMatchObject({ status: 200, body: { total: 0, items: [] } });
  });
  it("rechecks current company positions and never grants technical administrators payment authority", async () => {
    database.setRole("keeper", "employee");
    expect((await get("keeper")).status).toBe(403);
    expect((await get("admin")).status).toBe(403);
    expect((await get("project_finance")).status).toBe(403);
    database.setActive("finance", false);
    expect((await get("finance")).status).toBe(401);
  });
  it("does not offer a stale approved request after its latest approval round has returned", async () => {
    await (database.prisma as unknown as {approvalInstance: {create(input: {data: Record<string, unknown>}): Promise<unknown>}}).approvalInstance.create({ data: {
      id: "returned-round-a", businessType: "payment_request", businessId: "payment-a", flowType: "payment.approve",
      status: "returned", frozenNodes: [], currentNodeIndex: 0, applicantUserId: "employee", createdAt: new Date("2026-11-02T00:00:00Z")
    } });
    expect(await get("finance")).toMatchObject({ status: 200, body: { total: 0, items: [] } });
  });
  it("queries the canonical execution by the original request key and leaves an unseen result unconfirmed", async () => {
    const key = "76b3c58b-d43a-479e-9d5a-7a729fa45099";
    const path = `/payment-executions/results/${key}`;
    const initial = await get("keeper", path);
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ status: "unconfirmed", message: "尚未查到付款登记结果，请保留原请求并继续查询" });
    await (database.prisma as unknown as { paymentExecution: { create(input: { data: Record<string, unknown> }): Promise<unknown> } }).paymentExecution.create({ data: {
      id: "execution-a", idempotencyKey: key, paymentRequestId: "payment-a", paymentSubjectType: "our_company",
      companyEntityIdSnapshot: "company-a", companyEntityNameSnapshot: "甲公司", companyEntityCreditCodeSnapshot: "SYNTHETIC-COMPANY-A",
      amountCents: 4000n, paidAt: new Date("2026-11-04T00:00:00Z"), executedByUserId: "finance", voucherFileId: "voucher-a"
    } });
    for (const actor of ["keeper", "finance"]) {
      const observed = await get(actor, path);
      expect(observed.status).toBe(200);
      expect(observed.body).toMatchObject({ status: "recorded", execution: {
        executionId: "execution-a", paymentId: "payment-a", amountCents: "4000", paidAt: "2026-11-04", voucherPending: false
      } });
    }
    database.setRole("keeper", "employee");
    expect((await get("keeper", path)).status).toBe(403);
  });
  it("keeps Me queue and card consistent after a partial fixture, full fixture and current duty revocation", async () => {
    const payments = (database.prisma as unknown as { paymentRequest: { update(input: {where: {id: string}; data: Record<string, unknown>}): Promise<unknown> } }).paymentRequest;
    await payments.update({ where: { id: "payment-a" }, data: { paidAmountCents: 4000n, status: "partially_paid" } });
    for (const actor of ["finance", "keeper"]) {
      const work = await get(actor, "/me/work-items");
      expect(work.status).toBe(200);
      expect(work.body.queues.pending.filter((item: {type: string}) => item.type === "payment_execution")).toEqual([
        expect.objectContaining({ businessId: "payment-a", amountText: "¥60.00" })
      ]);
      const summary = await get(actor, "/me/workbench-summary");
      expect(summary.status).toBe(200);
      expect(summary.body.cards).toContainEqual(expect.objectContaining({ id: "approved_pending_payment", count: 1 }));
    }
    await payments.update({ where: { id: "payment-a" }, data: { paidAmountCents: 10000n, status: "paid" } });
    expect((await get("keeper", "/me/work-items")).body.queues.pending).not.toContainEqual(expect.objectContaining({ type: "payment_execution" }));
    expect((await get("keeper", "/me/workbench-summary")).body.cards).toContainEqual(expect.objectContaining({ id: "approved_pending_payment", count: 0 }));
    database.setRole("keeper", "employee");
    expect((await get("keeper", "/me/work-items")).body.queues.pending).not.toContainEqual(expect.objectContaining({ type: "payment_execution" }));
    expect((await get("keeper", "/me/workbench-summary")).body.cards).not.toContainEqual(expect.objectContaining({ id: "approved_pending_payment" }));
  });
  it("projects the shared execution duty into the comprehensive director's actual Me queue and homepage count", async () => {
    const work = await get("keeper", "/me/work-items");
    expect(work.status).toBe(200);
    expect(work.body.queues.pending).toContainEqual(expect.objectContaining({
      type: "payment_execution", businessType: "payment_request", businessId: "payment-a"
    }));
    const summary = await get("keeper", "/me/workbench-summary");
    expect(summary.status).toBe(200);
    expect(summary.body.cards).toContainEqual(expect.objectContaining({ id: "approved_pending_payment", count: 1 }));
  });
});
