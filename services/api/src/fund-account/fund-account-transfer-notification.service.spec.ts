import { Prisma } from "@prisma/client";
import { FundAccountTransferNotificationService } from "./fund-account-transfer-notification.service";
import { fundTransferWorkItems } from "./fund-account-work-items";

it.each(["accepted", "advanced", "handover", "unknown", "unbound", "failed"] as const)("转款通知与待办共用当前授权 (%s)", async (state) => {
  let custodian: string | null = state === "unbound" ? null : "custodian";
  const row = {
    id: "transfer", revision: 1, status: "pending_receipt", amountYuan: new Prisma.Decimal("3.1251"),
    createdByUserId: "origin", createdAt: new Date("2026-11-18T03:00:00Z"), actions: [],
    sourceAccount: {id: "company", kind: "company", company: {name: "合成公司"}},
    destinationAccount: {id: "cash", kind: "public_cash", company: null}
  };
  const notices = new Map<string, {id: string; action: string; businessId:string; metadata: {recipientId?: string;retryOf?:string}}>();
  const db = {
    registeredFundTransfer: {findUnique: async () => row, findMany: async () => [row]},
    registeredFundAccount: {findUnique: async () => ({id: "cash"})},
    publicCashCustody: {findUnique: async () => ({currentCustodianId: custodian})},
    publicCashHandover: {findMany: async () => []},
    position: {findMany: async () => [{id: "position", key: "comprehensive_director"}]},
    userPosition: {findMany: async ({where}: {where: {userId?: string}}) => where.userId ?
      [{positionId: "position"}] : [{userId: "custodian"}, {userId: "another"}]},
    user: {findUnique: async ({where}: {where: {id: string}}) => ({
      phone: where.id === "custodian" ? "13800000000" : "13800000001",
      isActive: true, name: "合成发起人"
    })},
    auditLog: {
      createMany: async ({data}: {data: Array<NonNullable<ReturnType<typeof notices.get>>>}) => {
        let count = 0;
        for (const item of data) if (!notices.has(item.id)) {notices.set(item.id, item); count++;}
        return {count};
      },
      findUnique: async ({where}:{where:{id:string}}) => notices.get(where.id),
      findMany: async ({where}:{where:{id:{in:string[]}}}) => where.id.in.flatMap(id=>notices.has(id)?[notices.get(id)!]:[]),
      findFirst: async ({where}: {where: {id: {in: string[]}}}) => where.id.in.map(id => notices.get(id)).find(Boolean)
    },
    $queryRaw: async ({strings,values}: {strings: string[];values:unknown[]}) => {
      const sql=strings.join("");
      if (!sql.includes("SELECT queued.*")) return [];
      const queued=[...notices.values()].filter(item=>item.action==="queued");
      if (sql.includes("retryOf")) return queued.filter(item=>values.includes(item.businessId) && values.includes(item.metadata.recipientId) &&
        !queued.some(retry=>retry.metadata.retryOf===item.id)).slice(-1);
      return queued;
    }
  };
  let serial:Promise<unknown>=Promise.resolve();
  const prisma = {...db, $transaction: (run: (tx: typeof db) => unknown) => {
    const next=serial.then(()=>run(db));serial=next.catch(()=>undefined);return next;
  }};
  const sms = {available: () => true, sendDutyIntent: jest.fn().mockResolvedValue({status: state === "unknown" ? "unknown" : "accepted"})};
  if(state==="failed")sms.sendDutyIntent.mockResolvedValueOnce({status:"failed"});
  const notifications = new FundAccountTransferNotificationService(prisma as never, sms as never);
  await notifications.queue(db as never, row.id, "origin");
  await notifications.queue(db as never, row.id, "origin");
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
  expect([...notices.values()].map(item => item.metadata.recipientId)).toEqual(state === "unbound" ? ["custodian", "another"] : ["custodian"]);
  if (state === "advanced") {row.revision++; row.status = "received";}
  if (state === "handover") custodian = "another";

  const pending = await fundTransferWorkItems(prisma as never, "custodian");
  expect(pending).toHaveLength(state === "advanced" || state === "handover" ? 0 : 1);
  if (pending.length) expect(pending[0]).toMatchObject({id: "fund-transfer:transfer:1", targetPath: "/资金账户", amountText: "3.1251 元"});
  await notifications.afterCommit();
  await notifications.afterCommit();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(state === "advanced" || state === "handover" ? 0 : state === "unbound" ? 2 : 1);
  expect([...notices.values()].filter(item => item.action === (["advanced", "handover"].includes(state) ? "cancelled" :
    state === "unknown" || state === "failed" ? state : "accepted"))).toHaveLength(state === "unbound" ? 2 : 1);
  const initial=[...notices.values()].find(item=>item.action==="queued"&&item.metadata.recipientId==="custodian")!;
  if(state==="unknown"||state==="accepted"){
    expect(await notifications.notificationStatus(row.id,"custodian")).toMatchObject({status:state,canRetry:false});
    await expect(notifications.retry(row.id,"custodian",initial.id)).rejects.toThrow("仅确认发送失败");
  }
  if(state!=="failed")return;
  expect(await notifications.notificationStatus(row.id,"custodian")).toMatchObject({status:"failed",canRetry:true});
  expect(await notifications.notificationStatus(row.id,"another")).toBeNull();
  await expect(notifications.retry(row.id,"another",initial.id)).rejects.toThrow("当前待办");
  custodian="another";
  expect(await notifications.notificationStatus(row.id,"custodian")).toBeNull();
  await expect(notifications.retry(row.id,"custodian",initial.id)).rejects.toThrow("当前待办");
  custodian="custodian";
  const wake=jest.spyOn(notifications,"afterCommit").mockResolvedValue(undefined);
  const ids=await Promise.all([notifications.retry(row.id,"custodian",initial.id),notifications.retry(row.id,"custodian",initial.id)]);
  expect(ids[0]).toEqual(ids[1]);
  expect(ids[0]).toMatchObject({status:"queued",canRetry:false});
  expect(wake).toHaveBeenCalledTimes(1);
  await expect(notifications.retry(row.id,"custodian",ids[0].attemptId)).rejects.toThrow("仅确认发送失败");
  wake.mockRestore();
  await notifications.afterCommit();
  expect(await notifications.retry(row.id,"custodian",initial.id)).toMatchObject({attemptId:ids[0].attemptId,status:"accepted"});
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(2);
  row.revision++;
  await notifications.queue(db as never,row.id,"origin");
  expect(await notifications.notificationStatus(row.id,"custodian")).toMatchObject({status:"queued"});
  await expect(notifications.retry(row.id,"custodian",initial.id)).rejects.toThrow("当前待办");
});
