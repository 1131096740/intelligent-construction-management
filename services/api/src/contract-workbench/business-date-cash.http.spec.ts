import { ForbiddenException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PaymentController } from "../payment/payment.controller";
import { PaymentRequestService } from "../payment/payment-request.service";
import { PaymentReadService } from "../payment/payment-read.service";
import { ProjectController } from "../project/project.controller";
import { ProjectService } from "../project/project.service";
import { ProjectExpenseController } from "../project-expense/project-expense.controller";
import { ProjectExpenseService } from "../project-expense/project-expense.service";
import { SpotProcurementController } from "../spot-procurement/spot-procurement.controller";
import { SpotProcurementApplicationService } from "../spot-procurement/spot-procurement-application.service";
import { SpotProcurementPaymentController } from "../spot-procurement/spot-procurement-payment.controller";
import { SpotProcurementPaymentService } from "../spot-procurement/spot-procurement-payment.service";
import { SpotProcurementReadService } from "../spot-procurement/spot-procurement-read.service";
import { SpotProcurementSettlementService } from "../spot-procurement/spot-procurement-settlement.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { FileService } from "../file/file.service";

// Actual HTTP/controller/service date preflight; every persistence/file/bank/auth
// collaborator is a local denial adapter. Reaching it proves only date admission,
// never a successful cash transaction or real PG acceptance.
describe("cash HTTP Beijing date preflight (no resources)", () => {
  const stop = jest.fn(async () => { throw new ForbiddenException("合成边界停止，未办理业务"); });
  const prisma = { $transaction: stop };
  const files = { assertCanDownloadFileById: stop };
  const auth = { confirmPassword: stop }; // No SMS or real authentication gateway.
  const isolated = { lockFundingContext: stop, appendConfirmedSourceIfEnabledInTransaction: stop };
  const payments = new PaymentRequestService({} as never, prisma as never, {} as never, files as never, auth as never, {} as never, {} as never, isolated as never, {} as never, isolated as never, {} as never);
  const expenses = new ProjectExpenseService(prisma as never, {} as never, auth as never, files as never, isolated as never, {} as never);
  const spotPayments = new SpotProcurementPaymentService(prisma as never, {} as never, {} as never, {} as never, auth as never, files as never, {} as never, {} as never, isolated as never, {} as never, isolated as never);
  const refunds = new SpotProcurementSettlementService(prisma as never, {} as never, {} as never, {} as never, auth as never, files as never, {} as never, {} as never, isolated as never, {} as never, isolated as never);
  const receipts = new ProjectService(prisma as never, {} as never, auth as never, isolated as never, isolated as never, {} as never, {} as never, {} as never);
  let app: INestApplication;
  const cash = { amountCents: "100", idempotencyKey: "a8181385-f0ba-49da-b1d5-0f25bbbc7950", voucherFileId: "synthetic-file", confirmationPassword: "synthetic-only", paymentMethod: "bank_transfer", expectedPaymentUpdatedAt: "2026-01-01T00:00:00Z", expectedExpenseUpdatedAt: "2026-01-01T00:00:00Z" };
  const cases = [
    { path: "/payments/payment-1/executions", field: "paidAt", body: cash },
    { path: "/spot-procurement-payments/payment-1/executions", field: "paidAt", body: cash },
    { path: "/projects/project-1/expense-requests/expense-1/executions", field: "paidAt", body: cash },
    { path: "/spot-procurements/procurement-1/refunds", field: "receivedAt", body: { ...cash, refundMethod: "bank_transfer" } },
    { path: "/projects/project-1/upstream-fund-facts", field: "occurredAt", body: { amountCents: "100", factType: "owner_payment_to_affiliate", basisType: "oral", entryKind: "original", effectDirection: "increase", counterpartyName: "合成付款方", idempotencyKey: cash.idempotencyKey } }
  ];
  beforeAll(async () => {
    jest.useFakeTimers({ now: new Date("2026-11-04T16:30:00Z"), doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "hrtime", "performance"] });
    const module = await Test.createTestingModule({ controllers: [PaymentController, ProjectController, ProjectExpenseController, SpotProcurementController, SpotProcurementPaymentController], providers: [
      { provide: PaymentRequestService, useValue: payments }, { provide: ProjectService, useValue: receipts }, { provide: ProjectExpenseService, useValue: expenses },
      { provide: SpotProcurementPaymentService, useValue: spotPayments }, { provide: SpotProcurementSettlementService, useValue: refunds }, { provide: FileService, useValue: files },
      ...[PaymentReadService, ProjectVisibilityService, SpotProcurementApplicationService, SpotProcurementReadService].map(provide => ({ provide, useValue: {} }))
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.use((request: { user?: unknown }, _response: unknown, next: () => void) => { request.user = { id: "synthetic-actor" }; next(); });
    await app.listen(0, "127.0.0.1");
  });
  afterAll(async () => { await app?.close(); jest.useRealTimers(); });
  it.each(cases)("admits Beijing today and past dates at $path only as far as the synthetic boundary", async ({ path, field, body }) => {
    for (const value of ["2026-11-05", "2024-02-29", "2026-11-05T00:15:00+08:00"]) {
      stop.mockClear();
      const response = await fetch(`${await app.getUrl()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, [field]: value }) });
      expect({ path, value, status: response.status, body: await response.text() }).toMatchObject({ path, value, status: 403, body: expect.stringContaining("合成边界停止") });
      expect(stop).toHaveBeenCalledTimes(1);
    }
  });
  it.each(cases)("rejects future/invalid dates before all adapters at $path", async ({ path, field, body }) => {
    for (const value of ["2026-11-06", "2026-11-05T00:31:00+08:00", "2026-02-30"]) {
      stop.mockClear();
      const response = await fetch(`${await app.getUrl()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, [field]: value }) });
      expect({ path, value, status: response.status }).toEqual({ path, value, status: 400 });
      expect(await response.text()).toMatch(/日期|时间/u);
      expect(stop).not.toHaveBeenCalled();
    }
  });
});
