import { ROLE_KEYS, GLOBAL_USER_POSITION_ROLE_KEYS } from "@jiangkong/shared-domain";
import { randomUUID, createHash } from "node:crypto";
import { createGeneralRequestHarness } from "./general-procurement-request.test-support";

describe("任务20综合采购申请公开HTTP（合成持久层，无PG）", () => {
  let harness: Awaited<ReturnType<typeof createGeneralRequestHarness>>;
  const environment = { ...process.env };
  const draft = () => ({ requestKey: randomUUID(), requestProtocolVersion: 2, scope: "company_daily", projectId: null, companyEntityId: null, category: "other", reason: "", requestedAmountCents: null,
    lines: [{ id: randomUUID(), name: "软件服务", specification: null, unit: null, quantity: null, unitPrice: null, estimatedAmount: null, requiredOn: null, note: null }] });
  beforeEach(async () => { process.env.JWT_ACCESS_SECRET = randomUUID(); process.env.JWT_REFRESH_SECRET = randomUUID(); harness = await createGeneralRequestHarness(); });
  afterEach(async () => { await harness?.app.close(); process.env = { ...environment }; });
  it("员工可保存公司日常采购，仅清单名称已知，其余未知不补零且不虚选项目", async () => {
    const created = await harness.request("/general-procurements", draft());
    expect(created).toMatchObject({ status: 201, body: { id: expect.any(String) } });
  });
  it("公开详情保留公司日常无项目和逐格未知，不凭预计值产生付款容量", async () => {
    const input = draft(); const created = await harness.request("/general-procurements", input);
    expect(created.status).toBe(201);
    const detail = await harness.request(`/general-procurements/${created.body.id}`);
    expect(detail).toMatchObject({ status: 200, body: { scope: "company_daily", projectId: null, requestedAmountCents: null,
      lines: input.lines, canRequestPayment: false, paymentSummary: { availableAmountCents: null } } });
  });
  it("项目申请提交后两岗同时可办，项目经理可以先通过，综合主管通过才进入采购待办", async () => {
    const input = { ...draft(), scope: "project", projectId: harness.projectId };
    const created = await harness.request("/general-procurements", input);
    expect(created.status).toBe(201);
    const root = `/general-procurements/${created.body.id}`;
    const submitted = await harness.request(`${root}/submission`, { revision: 1 });
    expect(submitted).toMatchObject({ status: 201, body: { status: "approval_pending", revision: 2 } });
    const manager = await harness.request(root, undefined, harness.managerId);
    const director = await harness.request(root, undefined, harness.directorId);
    expect(manager.body).toMatchObject({ canReview: true, reviewDuties: [{ nodeIndex: 1, name: "项目经理" }] });
    expect(director.body).toMatchObject({ canReview: true, reviewDuties: [{ nodeIndex: 0, name: "综合部主管" }] });
    const first = await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 1, decision: "approve" }, harness.managerId);
    expect(first).toMatchObject({ status: 201, body: { status: "approval_pending", revision: 3 } });
    const final = await harness.request(`${root}/review`, { revision: 3, expectedNodeIndex: 0, decision: "approve" }, harness.directorId);
    expect(final).toMatchObject({ status: 201, body: { status: "approved_pending_procurement", revision: 4 } });
    const approved = await harness.request(root, undefined, harness.directorId);
    expect(approved.body).toMatchObject({ canArchive: false, canRequestPayment: false, canProcure: true, canReview: false });
  });

  it("退回后可修订清单，未知仍为空，过期保存和旧轮审批不能覆盖重提", async () => {
    const input = { ...draft(), scope: "project", projectId: harness.projectId };
    const created = await harness.request("/general-procurements", input); const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    const returned = await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 1, decision: "return", comment: "请补充规格" }, harness.managerId);
    expect(returned).toMatchObject({ status: 201, body: { status: "returned", revision: 3 } });
    const lines = [{ ...input.lines[0], specification: "年度办公软件", quantity: "10.0001", unitPrice: "100.1234", estimatedAmount: "1000.0000" }];
    const updated = await harness.request(`${root}/draft`, { ...input, requestKey: undefined, revision: 3, lines });
    expect(updated).toMatchObject({ status: 201, body: { revision: 4 } });
    expect((await harness.request(`${root}/draft`, { ...input, requestKey: undefined, revision: 3 })).status).toBe(409);
    expect((await harness.request(`${root}/submission`, { revision: 4 })).status).toBe(201);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 1, decision: "approve" }, harness.managerId)).status).toBe(409);
    const detail = await harness.request(root);
    expect(detail.body).toMatchObject({ revision: 5, lines, requestedAmountCents: null, canEdit: false });
    expect(detail.body.approvals[0].nodes).toEqual([{ name: "综合部主管", approved: false }, { name: "项目经理", approved: false }]);
  });

  it("无公司和项目资料仍可发起公司日常，项目经理不能代替公司综合主管审批", async () => {
    const options = await harness.request("/general-procurements/create-options");
    expect(options).toMatchObject({ status: 200, body: { canCreate: true, canCreateCompanyDaily: true } });
    const created = await harness.request("/general-procurements", draft()); const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    expect((await harness.request(root, undefined, harness.managerId)).status).toBe(403);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve" }, harness.managerId)).status).toBe(403);
    const director = await harness.request(root, undefined, harness.directorId);
    expect(director.body.reviewDuties).toEqual([{ nodeIndex: 0, name: "综合部主管" }]);
    expect(director.body.approvals[0].nodes).toHaveLength(1);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve" }, harness.directorId))).toMatchObject({ status: 201, body: { status: "approved_pending_procurement" } });
  });

  it("项目两项审批同时通知，全部通过后仅产生综合部采购待办且无收货前置", async () => {
    const created = await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId,reason:"项目需要办公软件" });
    const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    expect(harness.sent.map(item => item.duty).sort()).toEqual(["综合部主管", "项目经理"].sort());
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 1, decision: "approve" }, harness.managerId)).status).toBe(201);
    expect(harness.sent).toHaveLength(2);
    expect((await harness.request(`${root}/review`, { revision: 3, expectedNodeIndex: 0, decision: "approve" }, harness.directorId)).status).toBe(201);
    expect(harness.sent).toHaveLength(3);
    expect(harness.sent[2].duty).toBe("综合部采购");
    expect(harness.sent.map(item=>item.intent)).toEqual(Array(3).fill(expect.objectContaining({
      scopeName:"合成办公项目",initiatorName:"合成员工",subject:"项目需要办公软件",participants:[],
      amountText:"待确定",targetPath:`/综合采购申请/${created.body.id}`,
    })));
    const tasks = await harness.request("/general-procurements?status=approved_pending_procurement", undefined, harness.directorId);
    expect(tasks.status).toBe(200); expect(tasks.body.items.map((row: { id: string }) => row.id)).toContain(created.body.id);
    expect((await harness.request(`${root}/review`, { revision: 3, expectedNodeIndex: 0, decision: "approve" }, harness.directorId)).status).toBe(409);
    expect(harness.sent).toHaveLength(3);
  });

  it("富模板手动催办只发给所选当前综合采购职责，且使用原申请摘要",async()=>{
    const created = await harness.request("/general-procurements",{...draft(),scope:"project",projectId:harness.projectId,reason:"采购合成办公材料",estimatedAmount:"12.0001"});
    expect((await harness.request(`/general-procurements/${created.body.id}/submission`,{revision:1})).status).toBe(201);
    const round = harness.tables.approvalInstance.find(row=>row.businessId===created.body.id)!;
    const path = `/approval-progress/${round.id}`;
    const current = await harness.request(path);
    expect(current.status).toBe(200);
    process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED="true";
    const input = {requestId:randomUUID(),reminderToken:current.body.reminderToken,recipientIds:[harness.managerId]};
    expect((await harness.request(path+"/remind",input)).status).toBe(201);
    expect((await harness.request(path+"/remind",input)).status).toBe(201);
    expect(harness.sent).toHaveLength(3);
    expect(harness.sent[2]).toMatchObject({afterCommit:true,intent:{
      businessLabel:"综合采购审批",dutyName:"项目经理",scopeName:"合成办公项目",initiatorName:"合成员工",
      subject:"采购合成办公材料",amountText:"预计 12.0001 元",targetPath:`/综合采购申请/${created.body.id}`,
    }});
  });

  it("公司日常待办携带已录四位预计，未知相关方留空", async () => {
    const created = await harness.request("/general-procurements",{...draft(),estimatedAmount:"10.0001"});
    expect(created.status).toBe(201);
    expect((await harness.request(`/general-procurements/${created.body.id}/submission`,{revision:1})).status).toBe(201);
    expect(harness.sent).toEqual([expect.objectContaining({intent:expect.objectContaining({
      scopeName:"公司日常",amountText:"预计 10.0001 元",participants:[],
    })})]);
  });

  it("综合主管只能把本轮具体职责委托启用人员，受托人不获得其它申请列表读取权", async () => {
    const created = await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId });
    const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    const options = await harness.request("/approval-delegations/duty-options", undefined, harness.directorId);
    expect(options.status).toBe(200);
    expect(options.body).toHaveLength(1);
    expect(options.body[0]).toMatchObject({ actionKey: "general_procurement.approve", resourceType: "general_procurement_approval_duty" });
    const freshCapability = await harness.request(`/approval-delegations/duty-capability?dutyId=${encodeURIComponent(options.body[0].value)}`, undefined, harness.directorId);
    expect(freshCapability).toMatchObject({ status: 200, body: { canDelegate: true, actionKey: "general_procurement.approve", resourceType: "general_procurement_approval_duty", resourceId: options.body[0].value } });
    const delegated = await harness.request("/approval-delegations", { toUserId: harness.outsiderId, startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 60000).toISOString(),
      actionKey: options.body[0].actionKey, resourceType: options.body[0].resourceType, resourceId: options.body[0].value }, harness.directorId);
    expect(delegated.status).toBe(201);
    const detail = await harness.request(root, undefined, harness.outsiderId);
    expect(detail).toMatchObject({ status: 200, body: { canReview: true, canEdit: false, reviewDuties: [{ nodeIndex: 0 }] } });
    expect((await harness.request("/general-procurements", undefined, harness.outsiderId)).body.items).toEqual([]);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve" }, harness.outsiderId)).status).toBe(201);
    expect((await harness.request(`${root}/review`, { revision: 3, expectedNodeIndex: 0, decision: "approve" }, harness.directorId)).status).toBe(409);
  });

  it("同一申请在审批进度和我的待办按当前职责显示，批准后转综合部采购待办", async () => {
    const created = await harness.request("/general-procurements", draft()); const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    const detail = await harness.request(root);
    const roundId = detail.body.approvals[0].id;
    const progress = await harness.request(`/approval-progress/${roundId}`, undefined, harness.directorId);
    expect(progress).toMatchObject({ status: 200, body: { currentNodeName: "并联审批", pendingRecipients: [{ id: harness.directorId }] } });
    const before = await harness.request("/me/work-items", undefined, harness.directorId);
    expect(before.status).toBe(200);
    expect(before.body.queues.pending).toEqual(expect.arrayContaining([expect.objectContaining({ businessId: created.body.id, currentNode: "综合部主管", amountText: "预计金额待明确", projectName: "公司日常" })]));
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve" }, harness.directorId)).status).toBe(201);
    const after = await harness.request("/me/work-items", undefined, harness.directorId);
    expect(after.status).toBe(200);
    expect(after.body.queues.pending).toEqual(expect.arrayContaining([expect.objectContaining({ businessId: created.body.id, type: "procurement", currentNode: "综合部采购" })]));
    expect(after.body.queues.pending.filter((row: { businessId: string; type: string }) => row.businessId === created.body.id && row.type === "approval")).toEqual([]);
  });

  it("本人兼任职责须原因和当前密码，撤回清空本轮已同意状态并阻止迟到动作", async () => {
    const created = await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId }, harness.directorId);
    const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(`${root}/submission`, { revision: 1 }, harness.directorId)).status).toBe(201);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve" }, harness.directorId)).status).toBe(400);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve", selfReviewReason: "本人负责综合需求", confirmationPassword: "wrong-password" }, harness.directorId)).status).toBe(400);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve", selfReviewReason: "本人负责综合需求", confirmationPassword: "synthetic-current-password" }, harness.directorId)).status).toBe(201);
    const withdrawn = await harness.request(`${root}/withdrawal`, { revision: 3, reason: "调整需求" }, harness.directorId);
    expect(withdrawn).toMatchObject({ status: 201, body: { status: "returned", revision: 4 } });
    expect((await harness.request(`${root}/review`, { revision: 3, expectedNodeIndex: 1, decision: "approve" }, harness.managerId)).status).toBe(409);
    const detail = await harness.request(root, undefined, harness.directorId);
    expect(detail.body.approvals[0].nodes.every((node: { approved: boolean }) => !node.approved)).toBe(true);
    expect(detail.body.canEdit).toBe(true);
  });

  it("从未提交的公司日常草稿可删除，重试旧创建请求不能复活它", async () => {
    const input = draft(); const created = await harness.request("/general-procurements", input); const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(root)).body.canDeleteDraft).toBe(true);
    expect((await harness.request(`${root}/draft-deletion`, { revision: 1 }))).toMatchObject({ status: 201, body: { deleted: true } });
    expect((await harness.request(root)).status).toBe(404);
    expect((await harness.request("/general-procurements", input)).status).toBe(409);
  });

  it.each(ROLE_KEYS)("启用岗位 %s 可申请公司日常，技术岗位不额外获得审批权", async role => {
    harness.tables.position = ROLE_KEYS.map(key => ({ id: key, key }));
    harness.tables.userPosition = harness.tables.userPosition.filter(row => row.userId !== harness.userId);
    harness.tables.userPosition.push({ userId: harness.userId, positionId: role, projectId: GLOBAL_USER_POSITION_ROLE_KEYS.includes(role) ? null : harness.projectId });
    const created = await harness.request("/general-procurements", draft()); expect(created.status).toBe(201);
    expect((await harness.request(`/general-procurements/${created.body.id}`))).toMatchObject({ status: 200, body: { projectId: null, requestedAmountCents: null, canEdit: true, canReview: false } });
  });

  it("未登录、跨项目与调岗后的旧链接都拒绝，缺当前签名也不推进职责", async () => {
    const anonymous = await fetch(`${harness.base}/general-procurements`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft()) });
    expect(anonymous.status).toBe(401);
    expect((await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId }, harness.outsiderId)).status).toBe(403);
    const created = await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId }); const root = `/general-procurements/${created.body.id}`;
    await harness.request(`${root}/submission`, { revision: 1 });
    harness.tables.handwrittenSignatureVersion = harness.tables.handwrittenSignatureVersion.filter(row => row.userId !== harness.managerId);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 1, decision: "approve" }, harness.managerId)).status).toBe(400);
    expect((await harness.request(root)).body.revision).toBe(2);
    harness.tables.userPosition = harness.tables.userPosition.filter(row => row.userId !== harness.managerId);
    expect((await harness.request(root, undefined, harness.managerId)).status).toBe(403);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 1, decision: "approve" }, harness.managerId)).status).toBe(403);
  });

  it("已知零与未知分别保留，非法十进制、重复行和不存在日期不能保存", async () => {
    const input = draft(); const zero = { ...input, estimatedAmount: "0", lines: [{ ...input.lines[0], quantity: "0", unitPrice: "0", estimatedAmount: "0" }] };
    const created = await harness.request("/general-procurements", zero); expect(created.status).toBe(201);
    expect((await harness.request(`/general-procurements/${created.body.id}`)).body).toMatchObject({ requestedAmountCents: null, estimatedAmount: "0.0000", lines: [{ ...input.lines[0], quantity: "0.0000", unitPrice: "0.0000", estimatedAmount: "0.0000" }] });
    expect((await harness.request("/general-procurements", { ...draft(), lines: [{ ...input.lines[0], quantity: "1e3" }] })).status).toBe(400);
    expect((await harness.request("/general-procurements", { ...draft(), lines: [input.lines[0], input.lines[0]] })).status).toBe(400);
    expect((await harness.request("/general-procurements", { ...draft(), lines: [{ ...input.lines[0], requiredOn: "2026-02-31" }] })).status).toBe(400);
  });

  it("新预计元金额与清单保留四位，旧分字段不承接预估，超过四位拒绝而不截断", async () => {
    const input = draft(); const lines = [{ ...input.lines[0], quantity: "1.0001", unitPrice: "1.5340", estimatedAmount: "1.5342" }];
    const created = await harness.request("/general-procurements", { ...input, estimatedAmount: "1.5340", lines });
    expect(created.status).toBe(201);
    expect((await harness.request(`/general-procurements/${created.body.id}`)).body).toMatchObject({ estimatedAmount: "1.5340", requestedAmountCents: null, lines });
    expect((await harness.request("/general-procurements", { ...draft(), estimatedAmount: "1.53401" })).status).toBe(400);
    expect((await harness.request("/general-procurements", { ...draft(), lines: [{ ...input.lines[0], quantity: "1.00001" }] })).status).toBe(400);
  });

  it("旧定义指纹保持不变，新定义与四位清单在提交时冻结且未知小计不补零", async () => {
    const options = await harness.request("/general-procurements/create-options");
    expect(createHash("sha256").update(JSON.stringify(options.body.entryDefinition)).digest("hex")).toBe("8528562598760514ae93efc11ff51ec116c43a64975b1eec7c778b541e19f92b");
    expect(options.body.requestEntryDefinition).toMatchObject({ key: "general_procurement.request", version: 2 });
    const created = await harness.request("/general-procurements", { ...draft(), estimatedAmount: "1.5340" }); const root = `/general-procurements/${created.body.id}`;
    expect(created.status).toBe(201); expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    const detail = await harness.request(root);
    expect(detail.body).toMatchObject({ estimatedAmount: "1.5340", lineSummary: { knownLineEstimatedSubtotal: null, unknownLineCount: 1 },
      submissions: [{ definitionSnapshot: { key: "general_procurement.request", version: 2 }, estimatedAmount: "1.5340", requestedAmountCents: null }] });
  });

  it("公开保存将合法大写行UUID规范为小写，编辑与重读保持同一行身份", async () => {
    const input = draft(); input.lines[0].id = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const created = await harness.request("/general-procurements", input); expect(created.status).toBe(201);
    const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(root)).body.lines[0].id).toBe(input.lines[0].id.toLowerCase());
    expect((await harness.request(`${root}/draft`, { ...input, requestKey: undefined, revision: 1 })).status).toBe(201);
    expect((await harness.request(root)).body).toMatchObject({ revision: 2, lines: [{ id: input.lines[0].id.toLowerCase() }] });
  });

  it("大小写等价的重复行在公开创建和编辑写前拒绝，状态与审计不变化", async () => {
    const input = draft(); input.lines[0].id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const created = await harness.request("/general-procurements", input); expect(created.status).toBe(201);
    const rows = structuredClone(harness.tables.generalProcurement), audit = structuredClone(harness.tables.auditLog);
    const duplicate = { ...input, requestKey: randomUUID(), lines: [input.lines[0], { ...input.lines[0], id: input.lines[0].id.toUpperCase() }] };
    expect((await harness.request("/general-procurements", duplicate)).status).toBe(400);
    expect((await harness.request(`/general-procurements/${created.body.id}/draft`, { ...duplicate, requestKey: undefined, revision: 1 })).status).toBe(400);
    expect(harness.tables.generalProcurement).toEqual(rows); expect(harness.tables.auditLog).toEqual(audit);
  });

  async function populatedRequest(related: boolean, count: number) {
    const created = await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId });
    expect(created.status).toBe(201); expect((await harness.request(`/general-procurements/${created.body.id}/submission`, { revision: 1 })).status).toBe(201);
    const row = harness.tables.generalProcurement.find(item => item.id === created.body.id)!;
    const round = harness.tables.approvalInstance.find(item => item.id === row.approvalInstanceId)!;
    row.updatedAt = new Date("2025-01-01");
    for (let i = 0; i < count; i++) {
      const id = randomUUID(), roundId = randomUUID();
      harness.tables.generalProcurement.push({ ...structuredClone(row), id, approvalInstanceId: roundId, projectId: related ? harness.projectId : randomUUID(), updatedAt: new Date(2026, 0, 1, 0, 0, i) });
      harness.tables.approvalInstance.push({ ...structuredClone(round), id: roundId, businessId: id });
    }
    return created.body.id;
  }
  it("100条更新的无关申请不挤掉本人唯一较旧待办，公开列表及计数保持1", async () => {
    const id = await populatedRequest(false, 100);
    // The adapter must reproduce Prisma ordering and truncation before this is a useful public counterexample.
    const firstPage = await harness.db.generalProcurement.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
    expect(firstPage).toHaveLength(100); expect(firstPage.some((row: { id: string }) => row.id === id)).toBe(false);
    const ordered = await harness.db.generalProcurement.findMany({ orderBy: { id: "asc" }, take: 2 });
    expect(await harness.db.generalProcurement.findMany({ orderBy: { id: "asc" }, cursor: { id: ordered[0].id }, skip: 1, take: 1 })).toEqual([ordered[1]]);
    const todos = await harness.request("/me/work-items", undefined, harness.managerId);
    expect(todos.status).toBe(200); expect(todos.body.queues.pending).toEqual([expect.objectContaining({ businessId: id, currentNode: "项目经理" })]);
    const summary = await harness.request("/me/workbench-summary", undefined, harness.managerId);
    expect(summary.status).toBe(200); expect(summary.body.cards).toEqual(expect.arrayContaining([expect.objectContaining({ id: "approval_todo", count: 1 })]));
  });
  it("本人跨过100条分页后的全部当前职责都计数，展示页仍按既有容量返回", async () => {
    await populatedRequest(true, 101);
    const todos = await harness.request("/me/work-items", undefined, harness.managerId);
    expect(todos.status).toBe(200); expect(todos.body.queueMeta.pending.total).toBe(102);
    expect(todos.body.queues.pending).toHaveLength(30);
    expect(todos.body.queues.pending[0].businessId).toBe(harness.tables.generalProcurement.at(-1)!.id);
    const firstNotices = await harness.request("/me/work-items", undefined, harness.managerId, "GET", { "x-work-item-notices": "0" });
    const lastNotices = await harness.request("/me/work-items", undefined, harness.managerId, "GET", { "x-work-item-notices": "90" });
    expect(firstNotices.body.queueMeta.pending).toEqual({ total: 102, returned: 30, truncated: true });
    expect(firstNotices.body.noticePage).toEqual({ offset: 0, size: 30 });
    expect(lastNotices.body.queueMeta.pending).toEqual({ total: 102, returned: 12, truncated: true });
    expect(lastNotices.body.noticePage).toEqual({ offset: 90, size: 30 });
    expect(lastNotices.body.queues.pending).not.toContainEqual(firstNotices.body.queues.pending[0]);
    const version = firstNotices.body.noticeIndexVersion;
    const indexRoot = `/me/work-item-notice-keys?version=${version}`;
    const firstKeys = await harness.request(indexRoot, undefined, harness.managerId);
    expect(firstKeys.status).toBe(200);
    expect(firstKeys.body.keys).toHaveLength(100);
    const lastKeys = await harness.request(`${indexRoot}&after=${firstKeys.body.nextCursor}`, undefined, harness.managerId);
    expect(Object.keys(lastKeys.body).sort()).toEqual(["keys", "nextCursor", "version"]);
    expect(lastKeys.body.version).toBe(version);
    expect(lastKeys.body.nextCursor).toBeNull();
    expect(lastKeys.body.keys).toHaveLength(2);
    expect(new Set([...firstKeys.body.keys, ...lastKeys.body.keys]).size).toBe(102);
    const detailsPath = `/me/work-item-notice-details?version=${version}&keys=${firstNotices.body.recentNotices[0].noticeKey}`;
    expect((await harness.request(detailsPath, undefined, harness.managerId)).body.items).toEqual([firstNotices.body.recentNotices[0]]);
    const unrelatedDetails = await harness.request(detailsPath, undefined, harness.directorId);
    expect(unrelatedDetails.status).toBe(200);
    expect(unrelatedDetails.body.version).not.toBe(version);
    expect(unrelatedDetails.body.items).toEqual([]);
    const newlySubmitted = await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId });
    const newRoot = `/general-procurements/${newlySubmitted.body.id}`;
    expect((await harness.request(`${newRoot}/submission`, { revision: 1 })).status).toBe(201);
    const lastWithNew = await harness.request("/me/work-items", undefined, harness.managerId, "GET", { "x-work-item-notices": "90" });
    expect(lastWithNew.body.queues.pending).not.toContainEqual(expect.objectContaining({ businessId: newlySubmitted.body.id }));
    expect(lastWithNew.body.recentNotices).toContainEqual(expect.objectContaining({ businessId: newlySubmitted.body.id }));
    expect(lastWithNew.body.recentNotices).toHaveLength(10);
    expect((await harness.request(indexRoot, undefined, harness.managerId)).body).toEqual({
      version: lastWithNew.body.noticeIndexVersion, keys: [], nextCursor: null,
    });
    expect((await harness.request(detailsPath, undefined, harness.managerId)).body).toEqual({
      version: lastWithNew.body.noticeIndexVersion, items: [],
    });
    expect((await harness.request(`${newRoot}/review`, { revision: 2, expectedNodeIndex: 1, decision: "approve" }, harness.managerId)).status).toBe(201);
    const afterApproval = await harness.request("/me/work-items", undefined, harness.managerId, "GET", { "x-work-item-notices": "90" });
    expect(afterApproval.body.recentNotices).not.toContainEqual(expect.objectContaining({ businessId: newlySubmitted.body.id }));
    const summary = await harness.request("/me/workbench-summary", undefined, harness.managerId);
    expect(summary.status).toBe(200); expect(summary.body.cards).toEqual(expect.arrayContaining([expect.objectContaining({ id: "approval_todo", count: 102 })]));
    const currentDetail = afterApproval.body.recentNotices[0];
    harness.tables.userPosition = harness.tables.userPosition.filter(row => row.userId !== harness.managerId);
    const revokedPath = `/me/work-item-notice-details?version=${afterApproval.body.noticeIndexVersion}&keys=${currentDetail.noticeKey}`;
    const revokedDetails = await harness.request(revokedPath, undefined, harness.managerId);
    expect(revokedDetails.status).toBe(200);
    expect(revokedDetails.body.version).not.toBe(afterApproval.body.noticeIndexVersion);
    expect(revokedDetails.body.items).toEqual([]);
  });

  it("同一自然人兼综合主管和项目经理仍分别两次自审与当前签名，不按人合并职责", async () => {
    harness.tables.userPosition.push({ userId: harness.directorId, positionId: "project_manager", projectId: harness.projectId });
    const created = await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId }, harness.directorId);
    const root = `/general-procurements/${created.body.id}`; await harness.request(`${root}/submission`, { revision: 1 }, harness.directorId);
    const before = await harness.request(root, undefined, harness.directorId);
    expect(before.body.reviewDuties).toEqual([{ nodeIndex: 0, name: "综合部主管" }, { nodeIndex: 1, name: "项目经理" }]);
    const todos = await harness.request("/me/work-items", undefined, harness.directorId);
    expect(todos.body.queues.pending.filter((row: { businessId: string }) => row.businessId === created.body.id)).toHaveLength(2);
    const confirmation = { decision: "approve", selfReviewReason: "分别核对本人所任职责", confirmationPassword: "synthetic-current-password" };
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, ...confirmation }, harness.directorId))).toMatchObject({ status: 201, body: { status: "approval_pending", revision: 3 } });
    expect((await harness.request(root, undefined, harness.directorId)).body.reviewDuties).toEqual([{ nodeIndex: 1, name: "项目经理" }]);
    expect((await harness.request(`${root}/review`, { revision: 3, expectedNodeIndex: 1, decision: "approve" }, harness.directorId)).status).toBe(400);
    expect((await harness.request(`${root}/review`, { revision: 3, expectedNodeIndex: 1, ...confirmation }, harness.directorId))).toMatchObject({ status: 201, body: { status: "approved_pending_procurement", revision: 4 } });
    const after = await harness.request(root, undefined, harness.directorId);
    expect(after.body.approvals[0].actions.filter((action: { action: string; signed: boolean }) => action.action === "approve" && action.signed)).toHaveLength(2);
  });

  it.each(["failed", "unknown"] as const)("短信结果%s不阻止申请或审批，提交后发送且旧发送意图不自动重发", async outcome => {
    harness.smsMode.status = outcome;
    const created = await harness.request("/general-procurements", draft()); const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    expect(harness.sent).toHaveLength(1); expect(harness.sent[0].afterCommit).toBe(true);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve" }, harness.directorId)).status).toBe(201);
    expect(harness.sent).toHaveLength(2); expect(harness.sent.every(item => item.afterCommit)).toBe(true);
    expect(harness.sent.map(item => item.duty)).toEqual(["综合部主管", "综合部采购"]);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve" }, harness.directorId)).status).toBe(409);
    expect(harness.sent).toHaveLength(2);
  });

  it("综合采购的失败短信按原人、当前并联节点和原尝试重试，旧键并发只发一次", async () => {
    harness.smsMode.status = "failed";
    const created = await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId });
    const root = `/general-procurements/${created.body.id}`;
    expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    const path = `${root}/duty-sms`;
    const manager = await harness.request(path, undefined, harness.managerId);
    const director = await harness.request(path, undefined, harness.directorId);
    expect(manager).toMatchObject({ status: 200, body: { notices: [{ status: "failed", canRetry: true, dutyName: "项目经理" }] } });
    expect(director).toMatchObject({ status: 200, body: { notices: [{ status: "failed", canRetry: true, dutyName: "综合部主管" }] } });
    const { attemptId } = manager.body.notices[0];
    const retry = () => harness.request(`${path}/retry`, { attemptId }, harness.managerId);
    expect(await harness.request(path, undefined, harness.outsiderId)).toMatchObject({ status: 200, body: { notices: [] } });
    expect((await harness.request(`${path}/retry`, { attemptId }, harness.directorId)).status).toBe(409);
    const other = await harness.request("/general-procurements", draft());
    expect((await harness.request(`/general-procurements/${other.body.id}/duty-sms/retry`, { attemptId }, harness.managerId)).status).toBe(409);
    harness.smsMode.status = "accepted";
    expect((await Promise.all([retry(), retry()])).map(result => result.status)).toEqual([201, 201]);
    expect(await retry()).toMatchObject({ status: 201, body: { status: "accepted", canRetry: false, dutyName: "项目经理" } });
    expect(harness.sent.filter(item => item.duty === "项目经理").map(item => item.afterCommit)).toEqual([true, true]);
    expect(harness.sent.filter(item => item.duty === "综合部主管")).toHaveLength(1);
    expect((await harness.request(path, undefined, harness.directorId)).body).toEqual(director.body);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 1, decision: "approve" }, harness.managerId)).status).toBe(201);
    expect((await harness.request(path, undefined, harness.managerId)).body).toEqual({ notices: [] });
    expect((await retry()).status).toBe(409);
    expect(harness.sent).toHaveLength(3);
  });

  it.each(["approve", "return"] as const)("采购决定%s仅开放后续职责，未知结果和撤权禁止重试", async decision => {
    const created = await harness.request("/general-procurements", { ...draft(), scope: "project", projectId: harness.projectId });
    const root = `/general-procurements/${created.body.id}`;
    await harness.request(`${root}/submission`, { revision: 1 });
    if (decision === "approve") {
      expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 1, decision: "approve" }, harness.managerId)).status).toBe(201);
    }
    harness.smsMode.status = "failed";
    expect((await harness.request(`${root}/review`, { revision: decision === "approve" ? 3 : 2, expectedNodeIndex: 0, decision, comment: "补充采购规格" }, harness.directorId)).status).toBe(201);
    const actor = decision === "approve" ? harness.directorId : harness.userId;
    const dutyName = decision === "approve" ? "综合部采购" : "修改退回的申请";
    const path = `${root}/duty-sms`;
    const current = await harness.request(path, undefined, actor);
    expect(current).toMatchObject({ status: 200, body: { notices: [{ status: "failed", canRetry: true, dutyName }] } });
    const { attemptId } = current.body.notices[0];
    harness.smsMode.status = "unknown";
    const result = await harness.request(`${path}/retry`, { attemptId }, actor);
    expect(result).toMatchObject({ status: 201, body: { status: "unknown", canRetry: false, dutyName } });
    expect(await harness.request(`${path}/retry`, { attemptId }, actor)).toEqual(result);
    expect((await harness.request(`${path}/retry`, { attemptId: result.body.attemptId }, actor)).status).toBe(409);
    harness.tables.userPosition = harness.tables.userPosition.filter(row => row.userId !== actor);
    expect((await harness.request(path, undefined, actor)).body).toEqual({ notices: [] });
    expect((await harness.request(`${path}/retry`, { attemptId }, actor)).status).toBe(409);
    expect(harness.sent.filter(item => item.duty === dutyName).map(item => item.afterCommit)).toEqual([true, true]);
  });

  it("草稿不发短信，退回时仅给原申请人发送一次并保留待修改", async () => {
    const created = await harness.request("/general-procurements", draft());
    const root = `/general-procurements/${created.body.id}`;
    expect(harness.sent).toHaveLength(0);
    expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    const decision = { revision: 2, expectedNodeIndex: 0, decision: "return", comment: "请补充规格" };
    expect((await harness.request(`${root}/review`, decision, harness.directorId)).status).toBe(201);
    expect(harness.sent.map(item => [item.duty, item.afterCommit])).toEqual([["综合部主管", true], ["修改退回的申请", true]]);
    expect((await harness.request(`${root}/review`, decision, harness.directorId)).status).toBe(409);
    expect(harness.sent).toHaveLength(2);
    expect((await harness.request("/me/work-items")).body.queues.pending).toContainEqual(expect.objectContaining({
      businessId: created.body.id, currentNode: "修改退回的申请"
    }));
    expect((await harness.request("/me/work-items", undefined, harness.directorId)).body.queues.pending).not.toContainEqual(
      expect.objectContaining({ businessId: created.body.id }));
    expect((await harness.request(`${root}/submission`, { revision: 3 })).status).toBe(201);
    expect((await harness.request("/me/work-items")).body.queues.pending).not.toContainEqual(
      expect.objectContaining({ businessId: created.body.id }));
  });

  it("部分已知行小计与整单独立预计分开，不补未知行、不强制二者相等", async () => {
    const input = draft(); const lines = [{ ...input.lines[0], quantity: "1.0001", unitPrice: "1.5340" }, { ...input.lines[0], id: randomUUID(), name: "待明确设备" }];
    const created = await harness.request("/general-procurements", { ...input, estimatedAmount: "3.1400", lines }); expect(created.status).toBe(201);
    const root = `/general-procurements/${created.body.id}`; const detail = await harness.request(root);
    expect(detail.body).toMatchObject({ estimatedAmount: "3.1400", requestedAmountCents: null, lineSummary: { knownLineEstimatedSubtotal: "1.5342", unknownLineCount: 1 },
      lines: [{ estimatedAmount: null }, { estimatedAmount: null }] });
    expect((await harness.request(`${root}/submission`, { revision: 1 })).status).toBe(201);
    expect((await harness.request(`${root}/review`, { revision: 2, expectedNodeIndex: 0, decision: "approve" }, harness.directorId))).toMatchObject({ status: 201, body: { status: "approved_pending_procurement" } });
  });

});
