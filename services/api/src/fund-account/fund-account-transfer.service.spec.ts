import { Prisma } from "@prisma/client";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import { FundAccountTransferService } from "./fund-account-transfer.service";

const registration = {
  sourceScopeKey: "public_cash",
  destinationScopeKey: "company:company-a",
  expectedRegistrationId: "10561000-0000-4000-8000-000000000001",
  idempotencyKey: "10561000-0000-4000-8000-000000000002",
  transferredOn: "2026-11-01",
  evidenceReference: "虚构现金转款依据",
  lines: [{ sourceBatchId: "10561000-0000-4000-8000-000000000003", amountYuan: "30.0001" }]
};

function transferService(role: string, firstConflict = false, activeCompany = false, originalRegistrationExists = false) {
  const receipt = jest.fn();
  const transferUpdate = jest.fn();
  const createAction = jest.fn();
  const checkConstraints = jest.fn();
  const recordAudit = jest.fn();
  const tx = {
    user: { findUnique: async () => ({ isActive: !firstConflict }) },
    userPosition: { findMany: async () => [{ positionId: role }] },
    position: { findMany: async () => [{ id: role, key: role }] },
    registeredFundAccount: { findUnique: async ({ where }: { where: { scopeKey: string } }) =>
      where.scopeKey === "public_cash" ? { id: "cash", kind: "public_cash", companyEntityId: null } : { id: "company", kind: "company", companyEntityId: "company-a" },
      update: jest.fn() },
    publicCashCustody: { findUnique: async () => null },
    companyEntity: { findUnique: async () => ({ isActive: activeCompany }) },
    fundAccountBalanceRegistration: { findFirst: async ({ select }: { select?: { id: true } }) => select
      ? (originalRegistrationExists ? { id: registration.expectedRegistrationId } : null)
      : { id: "new-current", version: 2, balanceYuan: new Prisma.Decimal(100) } },
    $queryRaw: async () => [{ id: "cash" }, { id: "company" }],
    $executeRaw: checkConstraints,
    registeredFundTransferAction: { findUnique: receipt, create: createAction },
    registeredFundTransfer: {
      findUnique: async () => ({ id: "transfer", revision: 2, status: "pending_receipt", sourceAccountId: "cash", destinationAccountId: "company", createdByUserId: "origin", sourceAccount: { kind: "public_cash" }, destinationAccount: { kind: "company" } }),
      updateMany: transferUpdate
    }
  };
  let calls = 0;
  const prisma = { $transaction: async <T>(run: (client: typeof tx) => Promise<T>) => {
    calls++;
    if (firstConflict && calls === 1) throw new Prisma.PrismaClientKnownRequestError("synthetic conflict", { code: "P2034", clientVersion: "test" });
    return run(tx);
  } };
  const service = new FundAccountTransferService(prisma as unknown as PrismaService, { record: recordAudit } as unknown as AuditService);
  return { service, receipt, transferUpdate, createAction, checkConstraints, recordAudit, transactionCount: () => calls };
}

it("does not expose a committed registration receipt after the original actor loses the company role", async () => {
  const { service, receipt, transactionCount } = transferService("comprehensive_director", true);
  await expect(service.register("origin", registration)).rejects.toHaveProperty("status", 403);
  expect(transactionCount()).toBe(2);
  expect(receipt).not.toHaveBeenCalled();
});

it("rechecks the recipient role in a fresh confirmation replay transaction", async () => {
  const { service, receipt, transferUpdate, transactionCount } = transferService("finance_staff", true);
  await expect(service.act("recipient", "transfer", {
    idempotencyKey: registration.idempotencyKey, expectedRevision: 1, action: "confirm", evidenceReference: "独立实收"
  })).rejects.toHaveProperty("status", 403);
  expect(transactionCount()).toBe(2);
  expect(receipt).not.toHaveBeenCalled();
  expect(transferUpdate).not.toHaveBeenCalled();
});

it("rejects a new transfer into an inactive company", async () => {
  const { service, receipt } = transferService("comprehensive_director");
  await expect(service.register("origin", registration)).rejects.toThrow("所选公司已停用");
  expect(receipt).toHaveBeenCalledTimes(1);
});

it("does not mark an unrecognized source registration as superseded", async () => {
  const { service, receipt } = transferService("comprehensive_director", false, true);
  await expect(service.register("origin", registration)).rejects.toMatchObject({
    response: { statusCode: 409, code: "FUND_ACCOUNT_TRANSFER_REJECTED_NO_WRITE" }
  });
  expect(receipt).toHaveBeenCalledTimes(1);
});

it("proves an older confirmed source registration is superseded", async () => {
  const { service, receipt } = transferService("comprehensive_director", false, true, true);
  await expect(service.register("origin", registration)).rejects.toMatchObject({
    response: { statusCode: 409, code: "FUND_ACCOUNT_TRANSFER_COMMAND_SUPERSEDED" }
  });
  expect(receipt).toHaveBeenCalledTimes(1);
});

it("proves a stale receipt decision is superseded", async () => {
  const { service, receipt, transferUpdate } = transferService("finance_staff");
  await expect(service.act("recipient", "transfer", {
    idempotencyKey: registration.idempotencyKey, expectedRevision: 1, action: "confirm", evidenceReference: "独立实收"
  })).rejects.toMatchObject({
    response: { statusCode: 409, code: "FUND_ACCOUNT_TRANSFER_COMMAND_SUPERSEDED" }
  });
  expect(receipt).toHaveBeenCalledTimes(1);
  expect(transferUpdate).not.toHaveBeenCalled();
});

it("does not mark a key collision with an existing receipt as a definite rejection", async () => {
  const { service, receipt } = transferService("comprehensive_director", false, true);
  receipt.mockResolvedValue({ actorUserId: "origin", payloadFingerprint: "0".repeat(64) });
  await expect(service.register("origin", registration)).rejects.toMatchObject({
    response: { statusCode: 409, error: "Conflict" }
  });
});

it("rejects the command before returning a receipt if deferred transfer consistency fails", async () => {
  const { service, transferUpdate, checkConstraints, recordAudit } = transferService("finance_staff");
  transferUpdate.mockResolvedValueOnce({ count: 1 });
  const failure = new Prisma.PrismaClientKnownRequestError("synthetic consistency failure", {
    code: "P2010", clientVersion: "test", meta: { code: "42501" }
  });
  checkConstraints.mockRejectedValueOnce(failure);

  await expect(service.act("recipient", "transfer", {
    idempotencyKey: registration.idempotencyKey, expectedRevision: 2, action: "reject", evidenceReference: "独立驳回"
  })).rejects.toBe(failure);
  expect(checkConstraints).toHaveBeenCalledTimes(1);
  expect(recordAudit.mock.invocationCallOrder[0]).toBeLessThan(checkConstraints.mock.invocationCallOrder[0]!);
});

it("returns the recorded rejection after checking the named transfer consistency constraints", async () => {
  const { service, transferUpdate, createAction, checkConstraints } = transferService("finance_staff");
  transferUpdate.mockResolvedValueOnce({ count: 1 });

  await expect(service.act("recipient", "transfer", {
    idempotencyKey: registration.idempotencyKey, expectedRevision: 2, action: "reject", evidenceReference: "独立驳回"
  })).resolves.toEqual({ id: "transfer", revision: 3, status: "rejected_held" });
  expect(checkConstraints.mock.calls[0]?.[0].join("").replace(/\s+/gu, " ")).toBe(
    'SET CONSTRAINTS public."RegisteredFundTransfer_consistency", public."RegisteredFundTransferAction_consistency", public."FundAccountBalanceRegistration_transfer_consistency" IMMEDIATE'
  );
  expect(createAction.mock.invocationCallOrder[0]).toBeLessThan(checkConstraints.mock.invocationCallOrder[0]!);
});

it("资金转款短信沿台账的公司级岗位授权，只转发已登录的原收件人坐标", async () => {
  const { FundAccountTransferController }=await import("./fund-account-transfer.controller");
  const { REQUIRED_POSITIONS_KEY }=await import("../auth/decorators/require-positions.decorator");
  const { PATH_METADATA }=await import("@nestjs/common/constants");
  const { RetryDutyNotificationDto }=await import("../approval/retry-duty-notification.dto");
  const { createApiValidationPipe }=await import("../validation/api-validation");
  expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY,FundAccountTransferController))
    .toEqual(["finance_staff","finance_director","comprehensive_director"]);
  expect(Reflect.getMetadata(PATH_METADATA,FundAccountTransferController.prototype.dutySmsStatus)).toBe(":id/duty-sms");
  expect(Reflect.getMetadata(PATH_METADATA,FundAccountTransferController.prototype.retryDutySms)).toBe(":id/duty-sms/retry");
  const notifications={notificationStatus:jest.fn().mockResolvedValue({status:"failed"}),retry:jest.fn().mockResolvedValue({status:"queued"})};
  const controller=new FundAccountTransferController({} as never,notifications as never);
  const actor={id:"keeper"} as never,attemptId="a".repeat(64);
  await expect(controller.dutySmsStatus(actor,"transfer")).resolves.toEqual({notice:{status:"failed"}});
  await expect(controller.retryDutySms(actor,"transfer",{attemptId})).resolves.toEqual({status:"queued"});
  expect(notifications.notificationStatus).toHaveBeenCalledWith("transfer","keeper");
  expect(notifications.retry).toHaveBeenCalledWith("transfer","keeper",attemptId);
  await expect(createApiValidationPipe().transform({attemptId:"invalid"},
    {type:"body",metatype:RetryDutyNotificationDto})).rejects.toMatchObject({status:400});
});
