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
      controllers: [RegisteredPaymentExecutionController],
      providers: [RegisteredPaymentExecutionService, { provide: PrismaService, useValue: database.prisma }]
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
});
