import { Prisma, type ApprovalInstance, type AuditLog, type RegisteredPrincipalReturnApplication } from "@prisma/client";
import { auditDutyNoticeId } from "../approval/audit-duty-notification-delivery";
import { principalReturnDuties } from "./fund-principal-return-state";
import { FundPrincipalReturnNotificationService } from "./fund-principal-return-notification.service";
import { principalReturnPayableScopeKeys, resolvePrincipalReturnReviewIdentity } from "./fund-principal-return.service";

jest.mock("./fund-principal-return.service", () => ({
  PRINCIPAL_RETURN_BUSINESS_TYPE: "registered_principal_return", PRINCIPAL_RETURN_REVIEW_ACTION: "fund_account.principal_return.review",
  resolvePrincipalReturnReviewIdentity: jest.fn(), principalReturnPayableScopeKeys: jest.fn(),
}));

const kind = "principal_return_duty_notification";
const row = {
  id: "return", projectId: "project", approvalInstanceId: "round", createdByUserId: "keeper", status: "pending",
  requestedYuan: new Prisma.Decimal("10.0001"), approvedYuan: new Prisma.Decimal("10.0001"), paidYuan: new Prisma.Decimal("2.0000"),
} as RegisteredPrincipalReturnApplication;
const round = {
  id: "round", businessId: "return", businessType: "registered_principal_return",
  status: "approval_pending", currentNodeIndex: 0, frozenNodes: principalReturnDuties("project"),
} as unknown as ApprovalInstance;
const mockReview = jest.mocked(resolvePrincipalReturnReviewIdentity);
const mockPayable = jest.mocked(principalReturnPayableScopeKeys);
const direct = {identity: {viaAssignment: false}} as Awaited<ReturnType<typeof resolvePrincipalReturnReviewIdentity>>;

function fixture() {
  const tx = {
    approvalInstance: {findUnique: jest.fn().mockResolvedValue(round)},
    registeredPrincipalReturnApplication: {findUnique: jest.fn().mockResolvedValue(row)},
    position: {findMany: jest.fn().mockResolvedValue([{id: "manager", key: "project_manager"}])},
    projectMember: {findMany: jest.fn().mockResolvedValue([{userId: "recipient"}])},
    userPosition: {findMany: jest.fn().mockResolvedValue([{userId: "recipient"}, {userId: "ineligible"}])},
    approvalDelegation: {findMany: jest.fn().mockResolvedValue([{toUserId: "recipient"}])},
    user: {findUnique: jest.fn().mockResolvedValue({phone: "synthetic-phone", isActive: true})},
    project: {findUnique: jest.fn().mockResolvedValue({name: "合成项目"})},
    auditLog: {findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({count: 1})},
    $queryRaw: jest.fn(),
  };
  const prisma = {$queryRaw: jest.fn(), $transaction: jest.fn(async fn => fn(tx)), auditLog: tx.auditLog};
  const sms = {available: () => true, sendDutyIntent: jest.fn().mockResolvedValue({status: "unknown"})};
  return {tx, prisma, sms, service: new FundPrincipalReturnNotificationService(prisma as never, sms as never)};
}

it("queues one intent per active duty and eligible recipient, including exact scoped delegates", async () => {
  const {tx, service} = fixture();
  mockReview.mockImplementation(async (_tx, user) => user === "recipient" ? direct : null);
  await service.queueReview(tx as never, row, "keeper");
  const notices = tx.auditLog.createMany.mock.calls.flatMap(([value]) => value.data);
  expect(notices).toHaveLength(4);
  expect(new Set(notices.map(item => item.id)).size).toBe(4);
  expect(notices.map(item => item.metadata)).toEqual([0, 1, 2, 3].map(nodeIndex => ({
    roundId: "round", recipientId: "recipient", kind: "review", nodeIndex,
  })));
  expect(tx.approvalDelegation.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({resourceId: "round:1", resourceType: "registered_principal_return", actionKey: "fund_account.principal_return.review"}),
  }));
});

it("cancels after recipient eligibility is revoked and records unknown once without repeating the provider request", async () => {
  const {tx, prisma, sms, service} = fixture();
  const intent = {
    id: auditDutyNoticeId(kind, "round", "review", "1", "recipient"), action: "queued",
    businessId: "return", businessType: kind, metadata: {roundId: "round", recipientId: "recipient", kind: "review", nodeIndex: 1},
  } as unknown as AuditLog;
  const expired = {...intent, id: auditDutyNoticeId(kind, "round", "review", "1", "revoked"),
    metadata: {...(intent.metadata as object), recipientId: "revoked"}};
  mockReview.mockImplementation(async (_tx, user) => user === "recipient" ? direct : null);
  prisma.$queryRaw.mockResolvedValue([intent, expired]);
  await service.afterCommit();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
  expect(tx.auditLog.createMany.mock.calls.flatMap(([value]) => value.data.map((event: {action: string}) => event.action)))
    .toEqual(["dispatch_claimed", "unknown", "cancelled"]);
  tx.auditLog.findFirst.mockResolvedValue({action: "dispatch_claimed"});
  await service.afterCommit();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
});

it("queues the approved outstanding payment duty only for a current payable actor and cancels on payment completion", async () => {
  const {tx, prisma, sms, service} = fixture();
  const approved = {...row, status: "approved"};
  tx.approvalInstance.findUnique.mockResolvedValue({...round, status: "approved"});
  mockPayable.mockImplementation(async (_tx, actor) => actor === "recipient" ? ["public_cash"] : []);
  await service.queuePayment(tx as never, approved, "keeper");
  expect(tx.auditLog.createMany).toHaveBeenCalledTimes(1);
  const intent = tx.auditLog.createMany.mock.calls[0]![0].data[0];
  expect(intent.metadata).toEqual({roundId: "round", recipientId: "recipient", kind: "pay"});
  prisma.$queryRaw.mockResolvedValue([intent]);
  tx.registeredPrincipalReturnApplication.findUnique.mockResolvedValue({...approved, status: "paid"});
  await service.afterCommit();
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
  expect(tx.auditLog.createMany.mock.calls.at(-1)![0].data[0].action).toBe("cancelled");
});

it.each(["unknown", "accepted"])("shows %s without offering a retry or enqueuing one", async status => {
  const {tx, sms, service} = fixture();
  const intent = {
    id: auditDutyNoticeId(kind, "round", "review", "1", "recipient"), action: "queued", businessId: "return",
    businessType: kind, metadata: {roundId: "round", recipientId: "recipient", kind: "review", nodeIndex: 1},
  };
  mockReview.mockResolvedValue(direct);
  tx.$queryRaw.mockResolvedValue([intent]);
  tx.auditLog.findMany.mockResolvedValue([{id: auditDutyNoticeId(kind, intent.id, "terminal"), action: status}]);
  await expect(service.status("return", "recipient", "review-1")).resolves.toEqual({
    notice: {attemptId: intent.id, status, canRetry: false},
  });
  expect(tx.$queryRaw.mock.calls[0]![0].values).toContain(JSON.stringify({kind: "review", nodeIndex: 1}));
  await expect(service.retry("return", "recipient", "review-1", intent.id)).rejects.toThrow("仅确认发送失败");
  expect(tx.auditLog.createMany).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
});

it("dispatches only a legitimate successor of a confirmed failure in the same original duty", async () => {
  const {tx, prisma, sms, service} = fixture();
  const original = {
    id: auditDutyNoticeId(kind, "round", "review", "1", "recipient"), action: "queued", businessId: "return",
    businessType: kind, metadata: {roundId: "round", recipientId: "recipient", kind: "review", nodeIndex: 1},
  };
  const retry = {...original, id: auditDutyNoticeId(kind, original.id, "retry"),
    metadata: {...original.metadata, retryOf: original.id}};
  const terminalId = auditDutyNoticeId(kind, original.id, "terminal");
  mockReview.mockResolvedValue(direct);
  tx.auditLog.findUnique.mockImplementation(async ({where: {id}}) => id === original.id ? original :
    id === terminalId ? {businessType: kind, businessId: "return", action: "failed", metadata: {intentId: original.id}} : null);
  prisma.$queryRaw.mockResolvedValue([retry, {...retry, metadata: {...retry.metadata, nodeIndex: 2}}]);
  await service.afterCommit();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
});
