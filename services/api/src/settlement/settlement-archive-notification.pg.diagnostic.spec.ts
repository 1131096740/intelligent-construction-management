import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { JwtTokenService } from "../auth/jwt-token.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { createApiValidationPipe } from "../validation/api-validation";
import { SettlementController } from "./settlement.controller";
import { SettlementReadService } from "./settlement-read.service";
import { SettlementAttachmentTemplateService } from "./settlement-attachment-template.service";
import { SettlementService } from "./settlement.service";
import { SettlementSubmissionService } from "./settlement-submission.service";
import { PrismaClient } from "@prisma/client";
import type { ApprovalSmsService, SmsOutcome } from "../approval/approval-sms.service";
import type { PrismaService } from "../database/prisma.service";
import { SettlementArchiveNotificationService } from "./settlement-archive-notification.service";

const databaseUrl = process.env.SETTLEMENT_ARCHIVE_NOTICE_DATABASE_URL;
const pgCase = databaseUrl ? test : test.skip;

pgCase("正式结算归档待办与状态同事务，派发前撤权取消，超时后不重发", async () => {
  const url = new URL(databaseUrl!);
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname).toBe("/jiangkong_contract_bill_batch_test");
  url.searchParams.set("connection_limit", "1");
  const client = () => new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const writer = client(), observer = client();
  let app: INestApplication | undefined;
  const env = { ...process.env };
  try {
    const pids = await Promise.all([writer, observer].map(async session =>
      (await session.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0].pid));
    expect(pids[0]).not.toBe(pids[1]);
    const project = await writer.project.create({ data: { name: "合成归档项目", code: "JS-OUTBOX-PG" } });
    const generator = await writer.user.create({ data: { name: "合成生成经办人" } });
    const reviewer = await writer.user.create({ data: { name: "现任合同主管", phone: "13800000011", mustChangePassword: false } });
    const revoked = await writer.user.create({ data: { name: "调岗合同主管", phone: "13800000012", mustChangePassword: false } });
    const otherProject = await writer.project.create({ data: { name: "其他合成项目", code: "JS-UNRELATED-PG" } });
    const unrelated = await writer.user.create({ data: { name: "外项目主管", phone: "13800000013", mustChangePassword: false } });
    await writer.projectMember.createMany({ data: [
      { projectId: project.id, userId: reviewer.id, positionKey: "contract_director" },
      { projectId: project.id, userId: revoked.id, positionKey: "contract_director" },
      { projectId: otherProject.id, userId: unrelated.id, positionKey: "contract_director" }
    ] });
    const contract = await writer.contract.create({ data: {
      projectId: project.id, code: "JS-INTERNAL-HT", name: "合成结算合同", counterparty: "合成相对方"
    } });
    const version = await writer.contractVersion.create({ data: {
      contractId: contract.id, versionNo: 1, changeType: "original", status: "draft", amountCents: 100n,
      draftData: {}, templateSnapshot: {}, clauseSnapshot: []
    } });
    const terms = await writer.paymentTermsVersion.create({ data: {
      contractId: contract.id, contractVersionId: version.id, versionNo: 1, status: "effective", originalText: "合成付款条款"
    } });
    const settlement = await writer.settlement.create({ data: { projectId: project.id, contractId: contract.id,
      contractVersionId: version.id, paymentTermsVersionId: terms.id,
      code: "JS-OUTBOX-001", periodLabel: "2026-11", governanceVersion: 1, status: "pending_generation",
      amountCents: 100n, payableAmountCents: 100n } });
    const send = jest.fn(async (): Promise<SmsOutcome> => { throw new Error("simulated provider timeout"); });
    const notification = new SettlementArchiveNotificationService(writer as PrismaService,
      { available: () => true, sendDutyIntent: send } as unknown as ApprovalSmsService);
    const where = { businessType: "settlement_signed_archive_duty_notification", businessId: settlement.id };
    const transition = (rollback = false) => writer.$transaction(async tx => {
      const pending = await tx.settlement.update({ where: { id: settlement.id }, data: { status: "pending_archive_confirm" } });
      await notification.queue(tx, pending, generator.id);
      await notification.queue(tx, pending, generator.id);
      expect(await tx.auditLog.count({ where })).toBe(2);
      if (rollback) throw new Error("synthetic rollback");
    });
    await expect(transition(true)).rejects.toThrow("synthetic rollback");
    expect(await observer.auditLog.count({ where })).toBe(0);
    expect((await observer.settlement.findUniqueOrThrow({ where: { id: settlement.id } })).status).toBe("pending_generation");
    await transition();
    expect((await observer.settlement.findUniqueOrThrow({ where: { id: settlement.id } })).status).toBe("pending_archive_confirm");
    expect(await observer.auditLog.count({ where })).toBe(2);

    await writer.projectMember.deleteMany({ where: { projectId: project.id, userId: revoked.id } });
    await notification.afterCommit();
    await notification.afterCommit();
    expect(send.mock.calls).toEqual([["13800000011", expect.objectContaining({
      businessLabel: "结算待办", dutyName: "确认最终结算文件", businessCode: "JS-OUTBOX-001", scopeName: project.name,
      subject: `${contract.name}结算`, amountText: "1.00 元", targetPath: "/结算管理/JS-OUTBOX-001"
    })]]);
    const events = (await observer.auditLog.findMany({ where, select: { action: true }, orderBy: { action: "asc" } })).map(row => row.action);
    expect(events).toEqual(["cancelled", "dispatch_claimed", "queued", "queued", "unknown"]);
    process.stdout.write(JSON.stringify({ phase: "settlement_outbox_readback", distinctSessions: 2, rollbackCount: 0,
      committedRecipientIntents: 2, unrelatedRecipientIntents: 0, revokedCancelled: 1, mockSends: 1, replayMockSends: 0, events }) + "\n");

    Object.assign(process.env, { JWT_ACCESS_SECRET: randomUUID(), JWT_REFRESH_SECRET: randomUUID() });
    const tokens = new JwtTokenService();
    const db = writer as PrismaService;
    const module = await Test.createTestingModule({ controllers: [SettlementController], providers: [
      { provide: SettlementReadService, useValue: {} }, { provide: SettlementAttachmentTemplateService, useValue: {} },
      { provide: SettlementService, useValue: {} }, { provide: SettlementSubmissionService, useValue: {} },
      { provide: ProjectVisibilityService, useValue: new ProjectVisibilityService(db) },
      { provide: SettlementArchiveNotificationService, useValue: notification }
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(createApiValidationPipe());
    const reflector = new Reflector();
    app.useGlobalGuards(new JwtAuthGuard(reflector, tokens, db), new PermissionGuard(reflector, db));
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const request = async (id: string, actor: typeof reviewer | null, attemptId?: string) => {
      const response = await fetch(`${base}/settlements/${id}/duty-sms${attemptId ? "/retry" : ""}`, {
        method: attemptId ? "POST" : "GET",
        headers: { "content-type": "application/json", ...(actor ? { authorization: `Bearer ${tokens.signAccessToken(actor)}` } : {}) },
        ...(attemptId ? { body: JSON.stringify({ attemptId }) } : {})
      });
      return { status: response.status, body: await response.json() };
    };
    expect((await request(settlement.id, null)).status).toBe(401);
    expect((await request(settlement.id, unrelated)).status).toBe(403);
    expect((await request(settlement.id, revoked)).status).toBe(403);
    const unknown = await request(settlement.id, reviewer);
    expect(unknown).toMatchObject({ status: 200, body: { notice: { status: "unknown", canRetry: false } } });
    expect((await request(settlement.id, reviewer, unknown.body.notice.attemptId)).status).toBe(409);

    const failed = await writer.settlement.create({ data: { projectId: project.id, contractId: contract.id,
      contractVersionId: version.id, paymentTermsVersionId: terms.id,
      code: "JS-OUTBOX-RETRY", periodLabel: "2026-12", governanceVersion: 1, status: "pending_archive_confirm",
      amountCents: 100n, payableAmountCents: 100n } });
    await writer.$transaction(tx => notification.queue(tx, failed, generator.id));
    send.mockResolvedValueOnce({ status: "failed", message: "合成确定失败" });
    await notification.afterCommit();
    const failedResponse = await request(failed.id, reviewer);
    expect(failedResponse).toMatchObject({ status: 200, body: { notice: { status: "failed", canRetry: true } } });
    const original = failedResponse.body.notice.attemptId;
    send.mockResolvedValueOnce({ status: "accepted", message: "合成受理" });
    const retries = await Promise.all([request(failed.id, reviewer, original), request(failed.id, reviewer, original)]);
    expect(retries.map(result => result.status)).toEqual([201, 201]);
    expect(retries[0].body.attemptId).toBe(retries[1].body.attemptId);
    let finalNotice: Awaited<ReturnType<typeof request>> | undefined;
    for (let iteration = 0; iteration < 20; iteration += 1) {
      finalNotice = await request(failed.id, reviewer);
      if (finalNotice.body.notice?.status === "accepted") break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(finalNotice).toMatchObject({ status: 200, body: { notice: { status: "accepted", canRetry: false } } });
    expect((await request(failed.id, reviewer, finalNotice!.body.notice.attemptId)).status).toBe(409);
    expect((await request(failed.id, reviewer, original)).status).toBe(201);
    expect(send).toHaveBeenCalledTimes(3);
    const retryRows = await observer.auditLog.count({ where: { ...where, businessId: failed.id,
      action: "queued", metadata: { path: ["retryOf"], equals: original } } });
    expect(retryRows).toBe(1);
    process.stdout.write(JSON.stringify({ phase: "manual_retry_readback", jwtRequired: true, crossProjectDenied: true,
      revokedDenied: true, unknownDenied: true, acceptedDenied: true, concurrentPosts: retries.length,
      successorIntents: retryRows, successorMockSends: 1, replayMockSends: 0 }) + "\n");
  } finally {
    await app?.close();
    process.env = env;
    await Promise.all([writer.$disconnect(), observer.$disconnect()]);
  }
}, 30_000);
