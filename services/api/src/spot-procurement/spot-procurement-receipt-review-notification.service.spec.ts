import type { Prisma } from "@prisma/client";
import type { ApprovalSmsService } from "../approval/approval-sms.service";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import type { PrismaService } from "../database/prisma.service";
import type { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { SpotProcurementReceiptReviewNotificationService } from "./spot-procurement-receipt-review-notification.service";

jest.mock("../approval/project-approval-assignments");

it.each(["unknown","failed"] as const)("当前收货修订短信回执及重试 (%s)", async outcome => {
  const at = new Date();
  const receipt = { id: "receipt", procurementId: "procurement", projectId: "project", procurementVersionId: "version",
    status: "submitted", handlerUserId: "handler", currentRevisionNo: 1, firstSubmittedAt: at, submittedAt: at,
    submittedByUserId: "handler", submissionDelegationId: null, actualCostCents: 123n };
  const version = { id: "version", procurementId: receipt.procurementId, handlerUserId: "handler", status: "approved", applicationNameSnapshot: "经办人" };
  const procurement = { id: receipt.procurementId, projectId: "project", code: "LC-01", currentVersionId: version.id,
    status: "approved_in_progress", handlerUserId: "handler", actualCostCents: 123n };
  const revision = { ...receipt };
  type Row = { id: string; action: string; businessId:string; metadata: { recipientId?: string; intentId?: string; retryOf?:string } };
  const logs: Row[] = [];
  const tx = {
    $queryRaw: jest.fn(async (query:{strings:string[];values:unknown[]})=>{
      if (!query.strings.join("").includes("retryOf")) return [];
      const queued=logs.filter(row=>row.action==="queued");
      return queued.filter(row=>query.values.includes(row.businessId)&&query.values.includes(row.metadata.recipientId)&&
        !queued.some(retry=>retry.metadata.retryOf===row.id)).slice(-1);
    }),
    spotProcurementReceipt: { findUnique: jest.fn().mockResolvedValue(receipt) },
    spotProcurementReceiptRevision: { findUnique: jest.fn().mockResolvedValue(revision) },
    spotProcurement: { findUnique: jest.fn().mockResolvedValue(procurement) },
    spotProcurementVersion: { findUnique: jest.fn().mockResolvedValue(version) },
    project: { findUnique: jest.fn().mockResolvedValue({ isActive: true, name: "合成项目" }) },
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true, phone: "13800000009" }) },
    auditLog: {
      createMany: jest.fn(async ({ data }: { data: Row[] }) => {
        const fresh = data.filter(row => !logs.some(existing => row.id === existing.id));
        logs.push(...fresh);
        return { count: fresh.length };
      }),
      findUnique: jest.fn(async ({where}:{where:{id:string}})=>logs.find(row=>row.id===where.id)),
      findMany: jest.fn(async ({where}:{where:{id:{in:string[]}}})=>logs.filter(row=>where.id.in.includes(row.id))),
      findFirst: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => logs.find(row => where.id.in.includes(row.id)))
    }
  };
  let serial:Promise<unknown>=Promise.resolve();
  const prisma = { ...tx, $queryRaw: jest.fn(async () => logs.filter(row => row.action === "queued")),
    $transaction: (run: (client: typeof tx) => Promise<unknown>) => {
      const next=serial.then(()=>run(tx));serial=next.catch(()=>undefined);return next;
    } };
  const assignment = (userId: string) => ({ projectId: "project", userId, roleKey: "material_director", userIsActive: true });
  let roleRevoked=false;
  jest.mocked(loadEffectiveProjectApprovalAssignments).mockImplementation(async (_tx, _project, _roles, actor) =>
    actor === "revoked" || roleRevoked ? [] : actor ? [assignment(actor)] : [assignment("current"), assignment("current"), assignment("revoked")]);
  const mockSms = jest.fn().mockResolvedValue({status:"accepted"});
  if (outcome==="unknown") mockSms.mockRejectedValueOnce(new Error("合成供应商超时"));
  else mockSms.mockResolvedValueOnce({status:"failed"});
  const service = new SpotProcurementReceiptReviewNotificationService(prisma as unknown as PrismaService,
    { available: () => true, sendDutyIntent: mockSms } as unknown as ApprovalSmsService,
    { isEnabled: () => true } as unknown as SpotProcurementPilotService);
  const queue = () => service.queue(tx as unknown as Prisma.TransactionClient, procurement.id, "handler");
  await expect(queue()).resolves.toBe(true);
  await expect(queue()).resolves.toBe(false);
  expect(logs).toHaveLength(2);
  await service.afterCommit();
  await service.afterCommit();
  expect(mockSms).toHaveBeenCalledTimes(1);
  expect(mockSms).toHaveBeenCalledWith("13800000009", expect.objectContaining({
    targetPath: "/零星采购收货/procurement", dutyName: "复核收货", amountText: "1.23 元"
  }));
  const current = logs.find(row => row.metadata.recipientId === "current");
  const revoked = logs.find(row => row.metadata.recipientId === "revoked");
  expect(logs.filter(row => row.metadata.intentId === current?.id).map(row => row.action)).toEqual(["dispatch_claimed", outcome]);
  expect(logs.filter(row => row.metadata.intentId === revoked?.id).map(row => row.action)).toEqual(["cancelled"]);
  const original=current!.id;
  if (outcome==="unknown") {
    expect(await service.notificationStatus(procurement.id,"current")).toMatchObject({status:"unknown",canRetry:false});
    await expect(service.retry(procurement.id,"current",original)).rejects.toThrow("仅确认发送失败");
  } else {
    expect(await service.notificationStatus(procurement.id,"current")).toMatchObject({status:"failed",canRetry:true});
    expect(await service.notificationStatus(procurement.id,"other")).toBeNull();
    await expect(service.retry(procurement.id,"other",original)).rejects.toThrow("当前待办");
    roleRevoked=true;
    await expect(service.retry(procurement.id,"current",original)).rejects.toThrow("当前待办");
    roleRevoked=false;
    receipt.currentRevisionNo=2;
    revision.currentRevisionNo=2;
    expect(await service.notificationStatus(procurement.id,"current")).toBeNull();
    await expect(service.retry(procurement.id,"current",original)).rejects.toThrow("当前待办");
    receipt.currentRevisionNo=1;
    revision.currentRevisionNo=1;
    const dispatch=jest.spyOn(service,"afterCommit").mockResolvedValue(undefined);
    const [first,concurrent]=await Promise.all([service.retry(procurement.id,"current",original),service.retry(procurement.id,"current",original)]);
    expect(first).toEqual(concurrent);
    expect(first).toMatchObject({status:"queued",canRetry:false});
    expect(dispatch).toHaveBeenCalledTimes(1);
    await expect(service.retry(procurement.id,"current",first.attemptId)).rejects.toThrow("仅确认发送失败");
    dispatch.mockRestore();
    await service.afterCommit();
    const replay=await service.retry(procurement.id,"current",original);
    expect(replay).toMatchObject({attemptId:first.attemptId,status:"accepted",canRetry:false});
    await expect(service.retry(procurement.id,"current",first.attemptId)).rejects.toThrow("仅确认发送失败");
    expect(mockSms).toHaveBeenCalledTimes(2);
    expect(logs.filter(row=>row.metadata.retryOf===original)).toHaveLength(1);
  }
  revision.procurementVersionId = "another";
  await expect(queue()).resolves.toBe(false);
});
