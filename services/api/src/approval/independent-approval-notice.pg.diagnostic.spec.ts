import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../database/prisma.service";
import type { ApprovalSmsService } from "./approval-sms.service";
import { IndependentApprovalProgressService } from "./independent-approval-progress.service";

const databaseUrl = process.env.INDEPENDENT_APPROVAL_NOTICE_DATABASE_URL;
const pgCase = databaseUrl ? test : test.skip;

pgCase("独立用章催办当前选人可见，真实数据库角色变化和办结后消失", async () => {
  const url = new URL(databaseUrl!);
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname).toBe("/jiangkong_contract_bill_batch_test");
  url.searchParams.set("connection_limit", "1");
  const client = () => new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const writer = client(), observer = client();
  try {
    const pids = await Promise.all([writer, observer].map(async session =>
      (await session.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid));
    expect(pids[0]).not.toBe(pids[1]);
    const project = await writer.project.create({ data: { code: "INDEPENDENT-NOTICE-PG", name: "合成项目" } });
    const applicant = await writer.user.create({ data: { name: "合成经办人" } });
    const chosen = await writer.user.create({ data: { name: "所选主管", phone: "13800000023" } });
    const other = await writer.user.create({ data: { name: "未选主管", phone: "13800000024" } });
    const role = await writer.position.upsert({ where: { key: "comprehensive_director" }, update: {},
      create: { key: "comprehensive_director", name: "综合部主管" } });
    const assign = (userId: string) => writer.userPosition.create({ data: { userId, positionId: role.id } });
    await assign(chosen.id); await assign(other.id);
    const contract = await writer.contract.create({ data: { projectId: project.id, ownerUserId: applicant.id,
      code: "HT-APPROVAL-NOTICE", name: "合成合同", counterparty: "合成相对方" } });
    const version = await writer.contractVersion.create({ data: { contractId: contract.id, versionNo: 1,
      changeType: "original", status: "approved_pending_seal", amountCents: 100n,
      draftData: {}, templateSnapshot: {}, clauseSnapshot: [] } });
    const id = `independent:contract_seal:${version.id}`;
    const send = jest.fn(async () => { throw new Error("simulated timeout"); });
    const sms = { available: () => true, send } as unknown as ApprovalSmsService;
    const sender = new IndependentApprovalProgressService(writer as PrismaService, sms);
    const receiver = new IndependentApprovalProgressService(observer as PrismaService, sms);
    const key = randomUUID();
    const token = (await sender.detail(id, applicant.id)).reminderToken;
    const full = await sender.remind(id, applicant.id, key, token, [chosen.id]);
    expect(full.reminders[0].results[0].status).toBe("unknown");
    const reservation = await observer.auditLog.findUniqueOrThrow({ where: { id: key } });
    expect(Date.parse(full.nextRemindAt!) - reservation.createdAt.getTime()).toBe(60_000);
    await expect(sender.remind(id, other.id, randomUUID(), token, [chosen.id])).rejects.toThrow("刚刚已催办");
    await sender.remind(id, applicant.id, key, token, [chosen.id]);
    const received = (actorId: string) => receiver.recentPendingReminders(actorId, new Date());
    expect(await received(chosen.id)).toEqual([expect.objectContaining({ id, reminderId: key, businessCode: contract.code })]);
    expect(await received(other.id)).toEqual([]);
    await writer.userPosition.deleteMany({ where: { userId: chosen.id, positionId: role.id, projectId: null } });
    expect(await received(chosen.id)).toEqual([]);
    await assign(chosen.id);
    await writer.contractVersion.update({ where: { id: version.id }, data: { status: "seal_approved_pending_archive" } });
    expect(await received(chosen.id)).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    process.stdout.write(JSON.stringify({ phase: "independent_notice_readback", sessions: 2, cooldownMs: 60000,
      selectedCount: 1, otherRecipientCount: 0, revokedCount: 0, completedCount: 0, mockSends: 1, replayMockSends: 0 }) + "\n");
  } finally {
    await Promise.all([writer.$disconnect(), observer.$disconnect()]);
  }
}, 30_000);
