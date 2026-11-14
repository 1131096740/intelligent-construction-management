import { SpotProcurementApprovalNotificationService } from "./spot-procurement-approval-notification.service";

function fixture() {
  const round = {id: "round-1", businessId: "version-1", businessType: "spot_procurement_version", status: "approval_pending", currentNodeIndex: 0, applicantUserId: "applicant-1", frozenNodes: [
    {name: "物资主管", mode: "any", roleKeys: ["material_director"], protocolVersion: 1, executionMode: "parallel", approvedRoleKeys: [] as string[]},
    {name: "项目经理", mode: "any", roleKeys: ["project_manager"], protocolVersion: 1, executionMode: "parallel", approvedRoleKeys: [] as string[]}
  ]};
  let mandateActive = false;
  let assignments = [{projectId: "project-1", userId: "materials-1", roleKey: "material_director", userIsActive: true}];
  const notices = new Map<string, {id: string; actorUserId: string; approvalInstanceId: string; action: string; metadata: Record<string, unknown>}>();
  const db = {
    approvalInstance: {findMany: async () => [round], findUnique: async () => round},
    spotProcurementVersion: {findUnique: async () => ({id: "version-1", procurementId: "procurement-1", requestProtocolVersion: 2})},
    spotProcurement: {findUnique: async () => ({id: "procurement-1", currentVersionId: "version-1", projectId: "project-1", code: "LXCG-001", status: round.status === "approved" ? "approved_in_progress" : "approval_pending"})},
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
      if (sql.includes("SELECT queued.*")) return [...notices.values()].filter(row => row.metadata.event === "queued" && ![...notices.values()].some(receipt => receipt.metadata.intentId === row.id));
      return [];
    }
  };
  const prisma = {...db, $transaction: async <T>(operation: (tx: typeof db) => Promise<T>) => operation(db)};
  const sent: string[] = [];
  const sms = {available: () => true, send: async (_phone: string, _label: string, duty: string) => {sent.push(duty); return {status: "accepted", message: "已提交"};}};
  const service = new SpotProcurementApprovalNotificationService(prisma as never, sms as never);
  return {enableMandate: () => {mandateActive = true;}, revokeMandate: () => {mandateActive = false;}, service, round, sent, notices, sms, db, removeMaterials: () => {assignments = [];}, replaceMaterials: () => {assignments = [{projectId: "project-1", userId: "materials-new", roleKey: "material_director", userIsActive: true}];}, addPurchaser: () => {assignments = [...assignments, {projectId: "project-1", userId: "purchaser-1", roleKey: "material_staff", userIsActive: true}];}, addManager: () => {assignments = [...assignments, {projectId: "project-1", userId: "manager-1", roleKey: "project_manager", userIsActive: true}];}};
}

it("自动消费已配职责，缺岗补齐后只发新职责新收件人一次", async () => {
  const {service, sent, addManager} = fixture();
  await service.reconcilePending();
  expect(sent).toEqual(["物资主管"]);
  addManager();
  await service.reconcilePending();
  await service.reconcilePending();
  expect(sent).toEqual(["物资主管", "项目经理"]);
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
  const {service, round, db, sent, addPurchaser, notices} = fixture();
  round.status = "approved";
  addPurchaser();
  await service.queuePurchaseInTransaction(db as never, round as never, "project-1", "LXCG-001");
  await service.dispatchQueued();
  await service.reconcilePending();
  expect(sent).toEqual(["项目物资采购"]);
  expect([...notices.values()].filter(row => row.metadata.event === "accepted")).toHaveLength(1);
});
