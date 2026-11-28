import { PrismaClient } from "@prisma/client";
import type { ApprovalSmsService } from "../approval/approval-sms.service";
import type { PrismaService } from "../database/prisma.service";
import { ContractDutyNotificationService } from "./contract-duty-notification.service";

const diagnosticUrl = process.env.CONTRACT_DUTY_OUTBOX_DATABASE_URL;
const pgCase = diagnosticUrl ? test : test.skip;
const notificationType = "contract_v2_inside_duty_notification";

pgCase("真实 PG 的事务回滚与并发派发独占，未知结果不自动重发", async () => {
  const url = new URL(diagnosticUrl!);
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname).toBe("/jiangkong_contract_bill_batch_test");
  url.searchParams.set("connection_limit", "1");

  const client = () => new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const owner = client(), observer = client(), workerOne = client(), workerTwo = client(), blocker = client();
  const sessions = [owner, observer, workerOne, workerTwo, blocker];
  let releaseLock: (() => void) | undefined;
  try {
    const pids = await Promise.all(sessions.map(async session =>
      (await session.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid));
    expect(new Set(pids).size).toBe(sessions.length);

    const handler = await owner.user.create({ data: { name: "合成经办人" } });
    const reviewer = await owner.user.create({ data: { name: "合成合同主管", phone: "13800000019" } });
    const permission = await owner.position.upsert({
      where: { key: "contract_director" }, update: {}, create: { key: "contract_director", name: "合同主管" }
    });
    await owner.userPosition.create({ data: { userId: reviewer.id, positionId: permission.id } });
    const project = await owner.project.create({ data: { code: "OUTBOX-PG-001", name: "合同合成项目" } });
    const contract = await owner.contract.create({
      data: { code: "OUTBOX-HT-001", name: "合同合成待办", counterparty: "合成相对方", projectId: project.id, ownerUserId: handler.id }
    });
    const version = await owner.contractVersion.create({ data: {
      contractId: contract.id, versionNo: 1, changeType: "original", status: "draft", amountCents: 100n,
      amountYuan: "1.0000", numericProtocolVersion: 2, signingSubjectType: "our_company",
      draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    } });
    const round = await owner.approvalInstance.create({ data: {
      flowType: "contract.approve", businessType: "contract_version", businessId: version.id,
      status: "in_progress", applicantUserId: handler.id, currentNodeIndex: 0, frozenNodes: [{
        name: "合同主管", executionMode: "parallel", protocolVersion: 1, mode: "any",
        roleKeys: ["contract_director"], roleScopesByRole: { contract_director: "global" }, approvedRoleKeys: []
      }]
    } });
    const where = { businessType: notificationType, businessId: round.id };
    const sends = jest.fn(async () => { throw new Error("simulated gateway timeout"); });
    const sms = { available: () => true, sendDutyIntent: sends } as unknown as ApprovalSmsService;
    const writer = new ContractDutyNotificationService(owner as PrismaService, sms);
    const dispatchers = [workerOne, workerTwo].map(worker => new ContractDutyNotificationService(worker as PrismaService, sms));

    const rollback = new Error("synthetic rollback");
    await expect(owner.$transaction(async tx => {
      const next = await tx.contractVersion.update({ where: { id: version.id }, data: { status: "in_approval" } });
      await writer.queue(tx, contract, next, round, contract.code!);
      expect(await tx.auditLog.count({ where })).toBe(1);
      throw rollback;
    })).rejects.toThrow(rollback);
    expect(await observer.auditLog.count({ where })).toBe(0);
    expect((await observer.contractVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("draft");

    await owner.$transaction(async tx => {
      const next = await tx.contractVersion.update({ where: { id: version.id }, data: { status: "in_approval" } });
      await writer.queue(tx, contract, next, round, contract.code!);
      await writer.queue(tx, contract, next, round, contract.code!);
    });
    expect(await observer.auditLog.count({ where: { ...where, action: "queued" } })).toBe(1);
    expect((await observer.contractVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("in_approval");

    let notifyLocked!: () => void;
    const locked = new Promise<void>(resolve => { notifyLocked = resolve; });
    const gate = new Promise<void>(resolve => { releaseLock = resolve; });
    const lockHolding = blocker.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ContractVersion" WHERE "id" = ${version.id} FOR UPDATE`;
      notifyLocked();
      await gate;
    }, { timeout: 15_000 });
    await Promise.race([locked, lockHolding]);
    const dispatches = Promise.all(dispatchers.map(dispatcher => dispatcher.afterCommit()));
    let simultaneousWaiters = 0;
    try {
      for (let iteration = 0; iteration < 50; iteration += 1) {
        const rows = await observer.$queryRaw<Array<{ pid: number }>>`SELECT pid FROM pg_stat_activity
          WHERE pid IN (${pids[2]}, ${pids[3]}) AND wait_event_type = 'Lock'`;
        simultaneousWaiters = rows.length;
        if (simultaneousWaiters === 2) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      expect(simultaneousWaiters).toBe(2);
      expect(sends).not.toHaveBeenCalled();
    } finally {
      releaseLock!();
      await lockHolding;
      await dispatches;
    }
    expect(sends).toHaveBeenCalledTimes(1);
    expect(sends).toHaveBeenCalledWith("13800000019", expect.objectContaining({
      businessLabel: "合同待办", dutyName: "合同主管", businessCode: "OUTBOX-HT-001",
      scopeName: project.name, initiatorName: handler.name, subject: contract.name,
      participants: [contract.counterparty], amountText: "1.0000 元", targetPath: "/合同管理/OUTBOX-HT-001"
    }));
    const actions = (await observer.auditLog.findMany({ where, orderBy: { action: "asc" }, select: { action: true } })).map(row => row.action);
    expect(actions).toEqual(["dispatch_claimed", "queued", "unknown"]);
    await Promise.all(dispatchers.map(dispatcher => dispatcher.afterCommit()));
    expect(sends).toHaveBeenCalledTimes(1);
    process.stdout.write(JSON.stringify({ phase: "outbox_readback", distinctSessions: 5, simultaneousWaiters,
      rollbackOutboxRows: 0, rollbackVersionStatus: "draft", committedVersionStatus: "in_approval",
      persisted: actions, mockSends: 1, replayMockSends: 0 }) + "\n");
  } finally {
    releaseLock?.();
    await Promise.all(sessions.map(session => session.$disconnect()));
  }
}, 30_000);
