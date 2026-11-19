import type { ApprovalDutySmsIntent } from "../approval/approval-duty-sms-intent";
import { SpotProcurementApprovalNotificationService } from "./spot-procurement-approval-notification.service";

function fixture() {
  const round = {id: "round-1", businessId: "version-1", businessType: "spot_procurement_version", flowType: "spot_procurement.approve", status: "approval_pending", currentNodeIndex: 0, applicantUserId: "applicant-1", frozenNodes: [
    {name: "物资主管", mode: "any", roleKeys: ["material_director"], protocolVersion: 1, executionMode: "parallel", approvedRoleKeys: [] as string[]},
    {name: "项目经理", mode: "any", roleKeys: ["project_manager"], protocolVersion: 1, executionMode: "parallel", approvedRoleKeys: [] as string[]}
  ]};
  let mandateActive = false;
  let correctionCurrent = true;
  let estimate: string | null = null;
  let assignments = [{projectId: "project-1", userId: "materials-1", roleKey: "material_director", userIsActive: true}];
  const notices = new Map<string, {id: string; actorUserId: string; approvalInstanceId: string; action: string; metadata: Record<string, unknown>}>();
  const db = {
    approvalInstance: {findMany: async () => [round], findFirst: async () => round, findUnique: async () => round},
    spotProcurementVersion: {findUnique: async ({where}: {where: {id?: string; procurementId_versionNo?: { versionNo: number }}}) => ({id: where.id ?? "version-1", status: where.id === "draft-2" ? "draft" : "returned", versionNo: where.id === "draft-2" ? 2 : 1, handlerUserId: "applicant-1", procurementId: "procurement-1", requestProtocolVersion: 2,reason:"现场补充护栏",applicationNameSnapshot:"合成申请人",
      purchaserNameSnapshot:"合成采购人",estimatedTotalAmount:estimate})},
    spotProcurement: {findUnique: async () => ({id: "procurement-1", currentVersionId: round.status === "returned_to_applicant" && correctionCurrent ? "draft-2" : "version-1", applicantUserId: "applicant-1", handlerUserId: "applicant-1", projectId: "project-1", code: "LXCG-001", status: round.status === "approved" ? "approved_in_progress" : round.status === "returned_to_applicant" ? "draft" : "approval_pending"})},
    project:{findUnique:async()=>({name:"合成施工项目"})},
    approvalActionLog: {
      createMany: async ({data}: {data: Array<NonNullable<ReturnType<typeof notices.get>>>}) => {let count = 0; for (const item of data) if (!notices.has(item.id)) {notices.set(item.id, item); count++;} return {count};},
      findMany: async () => [...notices.values()],
      findUnique: async ({where}: {where: {id: string}}) => notices.get(where.id) ?? null,
    },
    user: {findUnique: async ({where}: {where: {id: string}}) => ({id: where.id, isActive: true, phone: "13800000001"})},
    $queryRaw: async (query: {strings: string[]; values: unknown[]}) => {
      const sql = query.strings.join("");
      if (sql.includes("WITH members")) return assignments;
      if (sql.includes('FROM "ApprovalDelegation" d')) return mandateActive && query.values.includes("round-1:0") ? [{id:"mandate-1",fromUserId:"materials-1",toUserId:"delegate-1"}] : [];
      if (sql.includes("SELECT queued.*")) return [...notices.values()].filter(row => row.metadata.event === "queued" && (!sql.includes('AND queued."id" =') || row.id === query.values[1]) && ![...notices.values()].some(receipt => receipt.metadata.intentId === row.id));
      return [];
    }
  };
  let tail: Promise<unknown> = Promise.resolve();
  const prisma = {...db, $transaction: <T>(operation: (tx: typeof db) => Promise<T>) => {
    const result = tail.then(() => operation(db));
    tail = result.catch(() => undefined);
    return result;
  }};
  const sent: string[] = [];
  const intents: ApprovalDutySmsIntent[] = [];
  const sms = {available: () => true, send: async (_phone: string, _label: string, duty: string) => {sent.push(duty); return {status: "accepted", message: "已提交"};},
    sendDutyIntent: async (phone:string,intent:ApprovalDutySmsIntent)=>{
      intents.push(intent);
      return sms.send(phone,intent.businessLabel,intent.dutyName);
    }};
  const service = new SpotProcurementApprovalNotificationService(prisma as never, sms as never);
  return { replaceDraft: () => {correctionCurrent = false;}, addOwner: () => {assignments.push({projectId: "project-1", userId: "applicant-1", roleKey: "material_staff", userIsActive: true});}, enableMandate: () => {mandateActive = true;}, revokeMandate: () => {mandateActive = false;}, service, round, sent, intents, notices, sms, db, setEstimate:(value:string)=>{estimate=value;}, removeMaterials: () => {assignments = [];}, replaceMaterials: () => {assignments = [{projectId: "project-1", userId: "materials-new", roleKey: "material_director", userIsActive: true}];}, addPurchaser: () => {assignments = [...assignments, {projectId: "project-1", userId: "purchaser-1", roleKey: "material_staff", userIsActive: true}];}, addManager: () => {assignments = [...assignments, {projectId: "project-1", userId: "manager-1", roleKey: "project_manager", userIsActive: true}];}};
}

it("自动消费已配职责，缺岗补齐后只发新职责新收件人一次", async () => {
  const {service, sent, intents, addManager} = fixture();
  await service.reconcilePending();
  expect(sent).toEqual(["物资主管"]);
  addManager();
  await service.reconcilePending();
  await service.reconcilePending();
  expect(sent).toEqual(["物资主管", "项目经理"]);
  expect(intents).toEqual(Array(2).fill(expect.objectContaining({
    scopeName:"合成施工项目",initiatorName:"合成申请人",subject:"现场补充护栏",participants:["采购人：合成采购人"],
    amountText:"待确定",targetPath:"/零星采购/procurement-1",
  })));
});

it("发送结果不明永久保留待核对，不自动重发", async () => {
  const {service, sent, sms, notices} = fixture();
  sms.send = async (_phone, _label, duty) => { sent.push(duty); return {status: "unknown", message: "结果待确认"}; };
  await service.reconcilePending();
  await service.reconcilePending();
  expect(sent).toEqual(["物资主管"]);
  expect([...notices.values()].filter(row => row.metadata.event === "unknown")).toHaveLength(1);
});

it("已办职责补换人员不再产生新通知", async () => {
  const {service, sent, round, addManager} = fixture();
  await service.reconcilePending();
  round.frozenNodes[1].approvedRoleKeys = ["project_manager"];
  addManager();
  await service.reconcilePending();
  expect(sent).toEqual(["物资主管"]);
});

it("测试环境生命周期不启动自动查库和发送", async () => {
  const {service, sent, notices} = fixture();
  service.onModuleInit();
  await Promise.resolve();
  service.onModuleDestroy();
  expect(sent).toEqual([]);
  expect(notices.size).toBe(0);
});


it("发送前再次核验当前岗位，旧收件人取消，新收件人接未办通知", async () => {
  const {service, db, round, sent, notices, removeMaterials, replaceMaterials} = fixture();
  await service.queueInTransaction(db as never, round as never, "project-1", "LXCG-001");
  removeMaterials();
  await service.dispatchQueued();
  expect(sent).toEqual([]);
  expect([...notices.values()].filter(row => row.metadata.event === "cancelled")).toHaveLength(1);
  replaceMaterials();
  await service.reconcilePending();
  expect(sent).toEqual(["物资主管"]);
  expect([...notices.values()].filter(row => row.metadata.event === "accepted")).toHaveLength(1);
  expect([...notices.values()].filter(row => row.metadata.event === "queued")).toHaveLength(2);
});


it("本人有当前职责时收到待办并另行完成自审确认", async () => {
  const {service, round, sent} = fixture();
  round.applicantUserId = "materials-1";
  await service.reconcilePending();
  expect(sent).toEqual(["物资主管"]);
});

it("精确职责受托人自动收到一次通知，职责办结或重复扫描不会补发", async () => {
  const {service, enableMandate, sent, round, notices}=fixture();
  enableMandate();
  await service.reconcilePending();
  await service.reconcilePending();
  expect(sent).toEqual(["物资主管","物资主管"]);
  expect([...notices.values()].filter(row=>row.metadata.event==="accepted" && row.metadata.recipientId==="delegate-1")).toHaveLength(1);
  round.frozenNodes[0].approvedRoleKeys=["material_director"];
  await service.reconcilePending();
  expect(sent).toHaveLength(2);
});
it("委托撤销后尚未发送的受托通知取消，原岗位通知保留", async () => {
  const {service, enableMandate, revokeMandate, db, round, sent, notices}=fixture();
  enableMandate();
  await service.queueInTransaction(db as never,round as never,"project-1","LXCG-001");
  revokeMandate();
  await service.dispatchQueued();
  expect(sent).toEqual(["物资主管"]);
  expect([...notices.values()].filter(row=>row.metadata.event==="cancelled" && row.metadata.recipientId==="delegate-1")).toHaveLength(1);
});

it("PUR-01 approved purchase notifies current project materials staff once and survives repeated reconciliation", async () => {
  const {service, round, db, sent, intents, addPurchaser, notices, setEstimate} = fixture();
  round.status = "approved";
  setEstimate("12.0001");
  addPurchaser();
  await service.queuePurchaseInTransaction(db as never, round as never, "project-1", "LXCG-001");
  await service.dispatchQueued();
  await service.reconcilePending();
  expect(sent).toEqual(["项目物资采购"]);
  expect(intents).toEqual([expect.objectContaining({
    businessLabel:"零星材料待采购",dutyName:"项目物资采购",amountText:"预计 12.0001 元",targetPath:"/零星采购/procurement-1",
  })]);
  expect([...notices.values()].filter(row => row.metadata.event === "accepted")).toHaveLength(1);
});

it.each(["eligible", "revoked", "superseded", "unknown"])("零采退回修改仅通知仍可修改的原采购人 (%s)", async (state) => {
  const {service, round, db, sent, intents, notices, sms, addOwner, replaceDraft} = fixture();
  round.status = "returned_to_applicant";
  if (state !== "revoked") addOwner();
  await service.queueCorrectionInTransaction(db as never, round as never, "draft-2", 0);
  await service.queueCorrectionInTransaction(db as never, round as never, "draft-2", 0);
  if (state === "superseded") replaceDraft();
  if (state === "unknown") sms.send = async () => ({status: "unknown", message: "发送结果待确认"});
  expect(sent).toHaveLength(0);
  await service.dispatchQueued();
  await service.dispatchQueued();
  expect([...notices.values()].filter(row => row.metadata.event === "queued")).toHaveLength(1);
  if (state === "eligible" || state === "unknown") {
    expect(intents).toEqual([expect.objectContaining({
      businessLabel: "零采申请退回修改", dutyName: "原采购人修改并重新提交", targetPath: "/零星采购/procurement-1"
    })]);
    expect([...notices.values()].filter(row => row.metadata.event === (state === "unknown" ? "unknown" : "accepted"))).toHaveLength(1);
  } else {
    expect(sent).toHaveLength(0);
    expect([...notices.values()].filter(row => row.metadata.event === "cancelled")).toHaveLength(1);
  }
});

it("只重试本人当前审批职责，原尝试并发重放只派发一次", async () => {
  const {service, sms, round, addManager, sent} = fixture();
  addManager();
  const accepted = sms.send;
  sms.send = async (_phone, _label, duty) => {
    sent.push(duty);
    return {status: "failed", message: "明确失败"};
  };
  await service.reconcilePending();
  const {notices: [original]} = await service.status("procurement-1", "materials-1");
  expect(original).toMatchObject({status: "failed", canRetry: true, dutyName: "物资主管"});
  await expect(service.retry("wrong-procurement", "materials-1", original.attemptId)).rejects.toThrow("当前没有可重试");
  await expect(service.retry("procurement-1", "manager-1", original.attemptId)).rejects.toThrow("当前没有可重试");
  sms.send = accepted;
  const retry = () => service.retry("procurement-1", "materials-1", original.attemptId);
  await Promise.all([retry(), retry()]);
  expect(await retry()).toMatchObject({status: "accepted", canRetry: false});
  expect(sent).toEqual(["物资主管", "项目经理", "物资主管"]);
  round.frozenNodes[0].approvedRoleKeys = ["material_director"];
  expect(await service.status("procurement-1", "materials-1")).toEqual({notices: []});
  await expect(retry()).rejects.toThrow("当前没有可重试");
});

it.each(["purchase", "correction"])("零采 %s 失败可重试，结果未知和职责失效均不再发送", async phase => {
  const {service, round, db, sms, sent, addOwner, addPurchaser, replaceDraft, removeMaterials} = fixture();
  const isPurchase = phase === "purchase";
  const actor = isPurchase ? "purchaser-1" : "applicant-1";
  if (isPurchase) {
    round.status = "approved";
    addPurchaser();
    await service.queuePurchaseInTransaction(db as never, round as never, "project-1", "LXCG-001");
  } else {
    round.status = "returned_to_applicant";
    addOwner();
    await service.queueCorrectionInTransaction(db as never, round as never, "draft-2", 0);
  }
  sms.send = async (_phone, _label, duty) => {
    sent.push(duty);
    return {status: "failed", message: "明确失败"};
  };
  await service.dispatchQueued();
  const {notices: [original]} = await service.status("procurement-1", actor);
  expect(original).toMatchObject({status: "failed", canRetry: true});
  sms.send = async (_phone, _label, duty) => {
    sent.push(duty);
    throw new Error("合成响应丢失");
  };
  const retry = () => service.retry("procurement-1", actor, original.attemptId);
  const result = await retry();
  expect(result).toMatchObject({status: "unknown", canRetry: false});
  await expect(retry()).resolves.toEqual(result);
  await expect(service.retry("procurement-1", actor, result.attemptId)).rejects.toThrow("仅可重试明确发送失败");
  if (isPurchase) removeMaterials();
  else replaceDraft();
  expect(await service.status("procurement-1", actor)).toEqual({notices: []});
  await expect(retry()).rejects.toThrow("当前没有可重试");
  expect(sent).toHaveLength(2);
});
