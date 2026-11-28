import { PrismaClient } from "@prisma/client";
import type { ApprovalSmsService } from "../approval/approval-sms.service";
import type { PrismaService } from "../database/prisma.service";
import { MeService } from "../me/me.service";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SpotProcurementReceiptReviewNotificationService } from "./spot-procurement-receipt-review-notification.service";

const databaseUrl = process.env.SPOT_RECEIPT_REVIEW_NOTICE_DATABASE_URL;
const pgCase = databaseUrl ? test : test.skip;

pgCase("历史收货通知诊断保持原子证据，当前待办不再投影", async () => {
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
    const project = await writer.project.create({ data: { code: "LC-RECEIPT-PG", name: "合成采购项目" } });
    const other = await writer.project.create({ data: { code: "LC-RECEIPT-OTHER", name: "另一合成项目" } });
    const handler = await writer.user.create({ data: { name: "经办人" } });
    const reviewer = await writer.user.create({ data: { name: "物资主管", phone: "13800000041" } });
    const revoked = await writer.user.create({ data: { name: "调岗主管", phone: "13800000042" } });
    const outsider = await writer.user.create({ data: { name: "外项目主管", phone: "13800000043" } });
    await writer.projectMember.createMany({ data: [
      { projectId: project.id, userId: reviewer.id, positionKey: "material_director" },
      { projectId: project.id, userId: revoked.id, positionKey: "material_director" },
      { projectId: other.id, userId: outsider.id, positionKey: "material_director" }
    ] });
    const procurement = await writer.spotProcurement.create({ data: { projectId: project.id, code: "LC-RECEIPT-001",
      applicantUserId: handler.id, handlerUserId: handler.id, status: "approved_in_progress", actualCostCents: 0n } });
    const version = await writer.spotProcurementVersion.create({ data: { procurementId: procurement.id, versionNo: 1,
      status: "approved", handlerUserId: handler.id, reason: "合成采购事由", applicationDepartmentSnapshot: "项目部",
      applicationNameSnapshot: handler.name, purchaserNameSnapshot: handler.name, purchaserDepartmentNameSnapshot: "项目部",
      createdByUserId: handler.id } });
    await writer.spotProcurement.update({ where: { id: procurement.id }, data: { currentVersionId: version.id } });
    const { receipt, revision } = await writer.$transaction(async tx => {
      const root = await tx.spotProcurementReceipt.create({ data: { projectId: project.id,
        procurementId: procurement.id, procurementVersionId: version.id, handlerUserId: handler.id, createdByUserId: handler.id } });
      const initial = await tx.spotProcurementReceiptRevision.create({ data: { receiptId: root.id, revisionNo: 1,
        procurementId: procurement.id, procurementVersionId: version.id, handlerUserId: handler.id, createdByUserId: handler.id } });
      return { receipt: root, revision: initial };
    });

    const send = jest.fn().mockRejectedValue(new Error("simulated provider timeout"));
    const pilot = { isEnabled: () => true } as unknown as SpotProcurementPilotService;
    const notice = new SpotProcurementReceiptReviewNotificationService(writer as PrismaService,
      { available: () => true, sendDutyIntent: send } as unknown as ApprovalSmsService, pilot);
    const where = { businessType: "spot_receipt_review_duty_notification", businessId: procurement.id };
    const submitCoordinates = (rollback = false) => writer.$transaction(async tx => {
      const submittedAt = new Date();
      await tx.spotProcurementReceiptRevision.update({ where: { id: revision.id }, data: {
        submittedAt, submittedByUserId: handler.id, actualCostCents: 123n
      } });
      await tx.spotProcurementReceipt.update({ where: { id: receipt.id }, data: {
        status: "submitted", firstSubmittedAt: submittedAt, submittedAt, submittedByUserId: handler.id, actualCostCents: 123n
      } });
      await tx.spotProcurement.update({ where: { id: procurement.id }, data: { actualCostCents: 123n } });
      await expect(notice.queue(tx, procurement.id, handler.id)).resolves.toBe(true);
      await expect(notice.queue(tx, procurement.id, handler.id)).resolves.toBe(false);
      expect(await tx.auditLog.count({ where })).toBe(2);
      if (rollback) throw new Error("synthetic rollback");
    });
    await expect(submitCoordinates(true)).rejects.toThrow("synthetic rollback");
    expect(await observer.auditLog.count({ where })).toBe(0);
    expect((await observer.spotProcurementReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).status).toBe("draft");
    await submitCoordinates();

    const me = new MeService(observer as PrismaService, {} as never, undefined, undefined, pilot);
    const items = async (actor: string) => (await me.getWorkItems(actor)).queues.pending
      .filter((item) => item.businessType === "receipt_review");
    expect(await items(reviewer.id)).toEqual([]);
    expect(await items(outsider.id)).toEqual([]);
    await writer.projectMember.deleteMany({ where: { projectId: project.id, userId: revoked.id } });
    expect(await items(revoked.id)).toEqual([]);

    await notice.afterCommit();
    await notice.afterCommit();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("13800000041", expect.objectContaining({
      dutyName: "复核收货", businessCode: procurement.code, amountText: "1.23 元",
      targetPath: `/零星采购收货/${procurement.id}`
    }));
    const actions = (await observer.auditLog.findMany({ where, select: { action: true }, orderBy: { action: "asc" } })).map(event => event.action);
    expect(actions).toEqual(["cancelled", "dispatch_claimed", "queued", "queued", "unknown"]);
    await writer.spotProcurementReceipt.update({ where: { id: receipt.id }, data: { status: "reviewed" } });
    expect(await items(reviewer.id)).toEqual([]);
    process.stdout.write(JSON.stringify({ phase: "spot_receipt_notice_readback", observerSessions: 2,
      rollbackIntents: 0, committedIntents: 2, revokedCancelled: 1, mockSends: 1, replayMockSends: 0,
      currentMeCount: 0, revokedMeCount: 0, outsiderMeCount: 0, reviewedMeCount: 0 }) + "\n");
  } finally {
    await Promise.all([writer.$disconnect(), observer.$disconnect()]);
  }
}, 30_000);
