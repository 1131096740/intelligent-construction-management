import type { ApprovalActionLog } from '@prisma/client';
import { ApprovalProgressService } from './approval-progress.service';
import type { PrismaService } from '../database/prisma.service';
import type { FrozenApprovalNode } from './approval-review-identity';
import type { ApprovalSmsService } from './approval-sms.service';

const nodes = [
  { name: '综合部主管', mode: 'any', roleKeys: ['comprehensive_director'], candidateUserIdsByRole: { comprehensive_director: ['first'] } },
  { name: '项目经理', mode: 'any', roleKeys: ['project_manager'], candidateUserIdsByRole: { project_manager: ['later'] } }
];

function fixture(files?: unknown) {
  const users = [
    { id: 'owner', name: '张志娟', isActive: true, phone: '13800000001' },
    { id: 'first', name: '综合主管', isActive: true, phone: '13800000002' },
    { id: 'later', name: '项目经理', isActive: true, phone: '13800000003' },
    { id: 'stranger', name: '无关人员', isActive: true, phone: '13800000004' }
  ];
  const instance = { id: 'flow', businessType: 'expense_claim', businessId: 'claim', flowType: 'expense_claim.approve', status: 'in_progress', currentNodeIndex: 0, frozenNodes: nodes as FrozenApprovalNode[], applicantUserId: 'owner', createdAt: new Date(), updatedAt: new Date() };
  const logs: ApprovalActionLog[] = [];
  const db = {
    approvalInstance: { findUnique: jest.fn(async () => instance), findMany: jest.fn(async () => [instance]) },
    approvalActionLog: { findMany: jest.fn(async () => logs), create: jest.fn(async ({ data }) => { const log = { id: data.id ?? `event-${logs.length}`, createdAt: new Date(), ...data } as ApprovalActionLog; logs.push(log); return log; }) },
    $queryRaw: jest.fn(async () => []),
    user: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => users.find(u => u.id === where.id)), findMany: jest.fn(async () => users) },
    expenseClaim: { findUnique: jest.fn(async () => ({ projectId: 'project', code: 'BX-001', applicantUserId: 'owner', handledByUserId: 'owner' })) },
    project: { findUnique: jest.fn(async () => ({ name: '测试项目', isActive: true })) },
    userPosition: { findMany: jest.fn(async () => [{ userId: 'first', positionId: 'p1', projectId: null }, { userId: 'later', positionId: 'p2', projectId: 'project' }]) },
    position: { findMany: jest.fn(async () => [{ id: 'p1', key: 'comprehensive_director' }, { id: 'p2', key: 'project_manager' }]) },
    projectMember: { findMany: jest.fn(async () => []) },
    approvalDelegation: { findMany: jest.fn(async (): Promise<Array<{fromUserId: string; toUserId: string; actionKey?: string | null; resourceType?: string | null; resourceId?: string | null}>> => []) }
  };
  let insideTransaction = false;
  const client = Object.assign(db, { $transaction: async (run: (tx: typeof db) => Promise<unknown>) => {
    insideTransaction = true;
    try { return await run(db); } finally { insideTransaction = false; }
  } });
  const receipt = {status:"accepted",message:"短信已提交发送"};
  const sms = {available:()=>true,send:jest.fn(async()=>receipt),sendDutyIntent:jest.fn(async()=>receipt)};
  const pilot = { isEnabled: jest.fn(() => true) };
  return { users, insideTransaction: () => insideTransaction, service: new ApprovalProgressService(client as unknown as PrismaService, sms as unknown as ApprovalSmsService, undefined, pilot as never, files as never), db, instance, sms, logs, pilot };
}

describe('审批中心四视图可见性', () => {
  it('管理查看人可读取非本人参与的进度，但标记仅查看且无办理权', async () => {
    const files = { canViewApprovalFlow: jest.fn(async () => true) };
    const { service } = fixture(files);
    await expect(service.detail('flow', 'stranger')).rejects.toThrow('审批流程不存在或无权查看');
    const viewed = await service.detail('flow', 'stranger', true);
    expect(viewed.viewerOnly).toBe(true);
    expect(viewed.canHandle).toBe(false);
    expect(files.canViewApprovalFlow).toHaveBeenCalledWith('expense_claim', 'claim', 'stranger');
  });

  it('流程相关人保留办理权，我方可查看列表排除本人已参与的流程', async () => {
    const files = { canViewApprovalFlow: jest.fn(async () => true) };
    const { service } = fixture(files);
    const own = await service.detail('flow', 'first');
    expect(own.viewerOnly).toBe(false);
    expect(own.canHandle).toBe(true);

    const viewable = await service.list('stranger', undefined, undefined, undefined, 'viewable');
    expect(viewable.items.map(item => item.id)).toEqual(['flow']);
    expect(viewable.items[0].viewerOnly).toBe(true);
    const participant = await service.list('first', undefined, undefined, undefined, 'viewable');
    expect(participant.items).toEqual([]);
  });

  it('并联轮按职责展示已签人与未签留空，并给出并联完成数', async () => {
    const { service, instance, logs } = fixture();
    instance.frozenNodes = [
      { name: '合同部主管', mode: 'any', roleKeys: ['contract_director'], protocolVersion: 1, executionMode: 'parallel',
        approvedRoleKeys: ['contract_director'], candidateUserIdsByRole: { contract_director: ['first'] } },
      { name: '项目经理', mode: 'any', roleKeys: ['project_manager'], protocolVersion: 1, executionMode: 'parallel',
        approvedRoleKeys: [], candidateUserIdsByRole: { project_manager: ['later'] } }
    ] as never;
    logs.push({ id: 'approve-1', approvalInstanceId: 'flow', actorUserId: 'first', action: 'approve',
      approvedRoleKey: 'contract_director', createdAt: new Date(), metadata: { approverName: '主管甲' } } as unknown as ApprovalActionLog);
    const progress = await service.detail('flow', 'first');
    expect(progress.parallelCompletion).toEqual({ completed: 1, total: 2 });
    expect(progress.nodes[0].signatures).toEqual([expect.objectContaining({ name: '主管甲', role: 'contract_director' })]);
    expect(progress.nodes[1].signatures).toEqual([]);
  });
});

it('标记旧合同待办按创建来源校验自审，来源无法核实时关闭办理', async () => {
  const { service, instance, db } = fixture();
  Object.assign(db, {
    contractVersion: { findUnique: jest.fn().mockResolvedValue({ contractId: 'contract', status: 'in_approval', numericProtocolVersion: 1 }) },
    contract: { findUnique: jest.fn().mockResolvedValue({ projectId: 'project', code: 'HT-LEGACY' }) }
  });
  const marker = { protocolVersion: 1, executionMode: 'parallel', legacyContractCutover: true,
    approvedRoleKeys: [], originatorUserIds: ['later'] };
  Object.assign(instance, {
    businessType: 'contract_version', businessId: 'version', flowType: 'contract.approve',
    frozenNodes: [
      { ...marker, name: '项目经理', mode: 'any', roleKeys: ['project_manager'], candidateUserIdsByRole: { project_manager: ['later'] },
        roleScopesByRole: { project_manager: 'project' } },
      { ...marker, name: '董事长/总经理', mode: 'any', roleKeys: ['chairman', 'general_manager'],
        roleScopesByRole: { chairman: 'global', general_manager: 'global' },
        candidateUserIdsByRole: { chairman: ['first'], general_manager: [] } }
    ]
  });
  db.position.findMany.mockResolvedValue([{ id: 'p1', key: 'chairman' }, { id: 'p2', key: 'project_manager' }]);
  const progress = await service.detail('flow', 'later');
  expect(progress.canHandle).toBe(true);
  expect(progress.pendingRecipients.map(actor => actor.id)).toEqual(['first', 'later']);
  Object.assign(instance.frozenNodes[1], { originatorUserIds: ['owner'] });
  const missing = await service.detail('flow', 'first');
  expect(missing.canHandle).toBe(false);
  expect(missing.pendingRecipients).toEqual([]);
  expect(missing.canRemind).toBe(false);
});

describe('统一审批进度', () => {
  it('尚未轮到的审批人能读取全部节点、当前待办人及催办能力', async () => {
    const { service } = fixture();
    const progress = await service.detail('flow', 'later');
    expect(progress.nodes.map(n => n.name)).toEqual(['综合部主管', '项目经理']);
    expect(progress.pendingRecipients.map(u => u.name)).toEqual(['综合主管']);
    expect(progress.canRemind).toBe(true);
    expect(JSON.stringify(progress)).not.toContain('13800000002');
  });
});

describe('合同履约三职责与委托', () => {
  it('履约确认轮次可读，委托人及其被委托人同时是当前待办人，办结后待办关闭', async () => {
    const { service, db, instance, logs } = fixture();
    instance.businessType = 'contract_work_completion';
    instance.businessId = 'completion';
    instance.flowType = 'contract.work_completion.approve';
    instance.frozenNodes = [{ name: '合同部主管', mode: 'any', roleKeys: ['contract_director'], approvedRoleKeys: [],
      protocolVersion: 1, executionMode: 'parallel', candidateUserIdsByRole: { contract_director: ['first'] } }] as never;
    Object.assign(db, {
      contractWorkCompletion: { findUnique: jest.fn(async () => ({ contractVersionId: 'version' })) },
      contractVersion: { findUnique: jest.fn(async () => ({ contractId: 'contract' })) },
      contract: { findUnique: jest.fn(async () => ({ projectId: 'project', code: 'HT-09' })) }
    });
    db.position.findMany.mockResolvedValue([{ id: 'p1', key: 'comprehensive_director' }, { id: 'p2', key: 'project_manager' },
      { id: 'p3', key: 'contract_director' }]);
    db.userPosition.findMany.mockResolvedValue([{ userId: 'first', positionId: 'p1', projectId: null },
      { userId: 'first', positionId: 'p3', projectId: null }, { userId: 'later', positionId: 'p2', projectId: 'project' }]);
    db.approvalDelegation.findMany.mockResolvedValue([{ fromUserId: 'first', toUserId: 'stranger', actionKey: null,
      resourceType: null, resourceId: null }]);

    const delegate = await service.detail('flow', 'stranger');
    expect(delegate.title).toBe('履约确认审批');
    expect(delegate.businessCode).toBe('HT-09');
    expect(delegate.nodes[0].pending.map(user => user.id)).toEqual(['first', 'stranger']);
    expect(delegate.pendingRecipients.map(user => user.id)).toEqual(['first', 'stranger']);

    const direct = await service.detail('flow', 'first');
    expect(direct.pendingRecipients.map(user => user.id)).toEqual(['first', 'stranger']);

    // 被委托人代委托人办理：只记一条同意，实办人为被委托人，委托人仍可查看本轮结果。
    instance.frozenNodes = [{ ...instance.frozenNodes[0], approvedRoleKeys: ['contract_director'] }] as never;
    logs.push({ id: 'approve-by-delegate', approvalInstanceId: 'flow', actorUserId: 'stranger', action: 'approve',
      approvedRoleKey: 'contract_director', representedUserId: 'first', createdAt: new Date() } as ApprovalActionLog);
    const closed = await service.detail('flow', 'stranger');
    expect(closed.pendingRecipients).toEqual([]);
    expect(closed.nodes[0].status).toBe('已通过');
    expect((await service.detail('flow', 'first')).nodes[0].status).toBe('已通过');
  });
});

const requestId = '11111111-1111-4111-8111-111111111111';
async function sendReminder(service: ApprovalProgressService, actorId: string, key = requestId) {
  const snapshot = await service.detail('flow', actorId);
  return service.remind('flow', actorId, key, snapshot.reminderToken);
}

describe('短信催办', () => {
  it('向当前待办人发送并持久化结果，重复请求不重复发送', async () => {
    const { service, sms } = fixture();
    await sendReminder(service, 'later', requestId);
    const replay = await sendReminder(service, 'later', requestId);
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(sms.send).toHaveBeenCalledWith('13800000002', '费用审批', '综合部主管', 'BX-001');
    expect(replay.reminders[0].results).toEqual([{ userId: 'first', status: 'accepted', message: '短信已提交发送' }]);
  });
});

it.each(["expense_claim", "project_expense_request"])(
  "keeps the historic %s loan round readable and closes live reminder sends",
  async (businessType) => {
  const { service, db, sms, logs, instance } = fixture();
  instance.businessType = businessType;
  const claim = { projectId: "project", code: "JK-001", applicantUserId: "owner", handledByUserId: "owner", claimType: "loan" };
  if (businessType === "expense_claim") {
    db.expenseClaim.findUnique.mockResolvedValue(claim);
  } else {
    Object.assign(db, { projectExpenseRequest: { findUnique: jest.fn().mockResolvedValue({
      projectId: "project", code: "JK-001", expenseType: "loan_reserve", expenseSubtype: "employee_loan"
    }) } });
  }
  const previousRequest = "22222222-2222-4222-8222-222222222222";
  logs.push({
    id: previousRequest, approvalInstanceId: "flow", actorUserId: "owner", action: "remind", createdAt: new Date(),
    metadata: { kind: "sms_request", currentNodeIndex: 0, recipientIds: ["first"] },
    comment: null, approvedRoleKey: null, representedUserId: null, signatureFileIdSnapshot: null,
    signatureSha256Snapshot: null, signatureVersionIdSnapshot: null
  });
  const detail = await service.detail("flow", "first");
  expect(detail).toMatchObject({ businessCode: "JK-001", canHandle: false, canRemind: false, pendingRecipients: [] });
  await expect(service.remind("flow", "owner", requestId, detail.reminderToken)).rejects.toMatchObject({ status: 410 });
  await expect(service.remind("flow", "stranger", requestId, detail.reminderToken)).rejects.toMatchObject({ status: 404 });
  await expect(service.remind("flow", "owner", previousRequest, detail.reminderToken)).resolves
    .toMatchObject({ businessCode: "JK-001", reminders: [{ id: previousRequest }] });
  expect(db.approvalActionLog.create).not.toHaveBeenCalled();
  expect(sms.send).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
});

it.each([
  ["bank_transaction", "outflow", false],
  ["bank_transaction", "inflow", true],
  ["reversal", "outflow", true]
])("only stops fresh reminders for the historical initial wage outflow (%s, %s)", async (executionKind, direction, canRemind) => {
  const { service, db, sms, logs, instance } = fixture();
  Object.assign(instance, { businessType: "fund_execution_case", businessId: "case-key",
    flowType: "fund_execution_case.approve", frozenNodes: [
      { name: "财务主管", mode: "any", roleKeys: ["finance_director"], candidateUserIdsByRole: { finance_director: ["first"] } }
    ] });
  db.position.findMany.mockResolvedValue([{ id: "p1", key: "finance_director" }]);
  Object.assign(db, { fundExecutionCase: { findFirst: jest.fn().mockResolvedValue({
    status: "submitted", approvalInstanceId: "flow", fundExecutionId: "execution"
  }) }, fundExecution: { findUnique: jest.fn().mockResolvedValue({ executionKind, direction }) } });
  const detail = await service.detail("flow", "first");
  expect(detail).toMatchObject({ canHandle: true, canRemind, pendingRecipients: [{ id: "first" }] });
  if (canRemind) {
    await expect(service.remind("flow", "owner", requestId, detail.reminderToken)).resolves.toMatchObject({ id: "flow" });
    expect(sms.send).toHaveBeenCalledTimes(1);
    return;
  }

  const original = "22222222-2222-4222-8222-222222222222";
  logs.push({
    id: original, approvalInstanceId: "flow", actorUserId: "owner", action: "remind",
    createdAt: new Date(0), metadata: { kind: "sms_request", currentNodeIndex: 0, recipientIds: ["first"] },
    comment: null, approvedRoleKey: null, representedUserId: null, signatureFileIdSnapshot: null,
    signatureSha256Snapshot: null, signatureVersionIdSnapshot: null
  });
  expect(detail.remindableRecipients).toEqual([]);
  await expect(service.remind("flow", "owner", requestId, detail.reminderToken)).rejects.toMatchObject({ status: 410 });
  await expect(service.remind("flow", "stranger", original, detail.reminderToken)).rejects.toMatchObject({ status: 404 });
  await expect(service.remind("flow", "first", original, detail.reminderToken)).rejects.toMatchObject({ status: 409 });
  await expect(service.remind("flow", "owner", original, "original-token", ["later"])).rejects.toMatchObject({ status: 409 });
  await expect(service.remind("flow", "owner", original, "original-token", ["first"])).resolves
    .toMatchObject({ reminders: [{ id: original }] });
  expect(db.approvalActionLog.create).not.toHaveBeenCalled();
  expect(sms.send).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
});

it("retains historical settlement progress but retires live serial approval reminders", async () => {
  const { service, db, sms, instance } = fixture();
  Object.assign(instance, { businessType: "settlement", flowType: "settlement.approve", status: "in_progress" });
  Object.assign(db, { settlement: { findUnique: jest.fn().mockResolvedValue({ projectId: "project", code: "JS-001" }) } });

  const detail = await service.detail("flow", "owner");
  expect(detail).toMatchObject({ businessCode: "JS-001", canHandle: false, canRemind: false, pendingRecipients: [] });
  await expect(service.remind("flow", "owner", requestId, detail.reminderToken)).rejects.toMatchObject({ status: 410 });
  await expect(service.remind("flow", "stranger", requestId, detail.reminderToken)).rejects.toMatchObject({ status: 404 });
  expect(db.approvalActionLog.create).not.toHaveBeenCalled();
  expect(sms.send).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
});

it("费用催办富短信只发当前选定岗位，保持原键和登录后直达",async()=>{
  const {service,sms,db,insideTransaction}=fixture();
  const current={id:"claim",projectId:"project",code:"BX-001",applicantUserId:"owner",handledByUserId:"owner",
    applicantNameSnapshot:"原费用申请人",companyEntityNameSnapshot:"合成公司",claimType:"reimbursement",reason:"合成差旅费",requestedAmountCents:1245n};
  db.expenseClaim.findUnique.mockResolvedValue(current);
  Object.assign(db,{expenseClaimLine:{findMany:async()=>[{expenseCategory:"车费",amountCents:1245n}]}});
  sms.sendDutyIntent.mockImplementation(async()=>{
    expect(insideTransaction()).toBe(false);
    return {status:"accepted",message:"短信已提交发送"};
  });
  const prior=process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
  process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED="true";
  try {
    await sendReminder(service,"later",requestId);
    await sendReminder(service,"later",requestId);
  } finally {
    if (prior===undefined) delete process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
    else process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED=prior;
  }
  expect(sms.send).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
  expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000002",expect.objectContaining({
    scopeName:"测试项目",initiatorName:"原费用申请人",subject:"合成差旅费",amountText:"12.45 元",
    details:["车费 12.45 元"],targetPath:"/费用与报销/claim",
  }));
});

it.each([
  ["contract_version","合同审批","/合同管理/HT-001","25.00 元"],
  ["payment_request","付款审批","/付款管理/payment","7.50 元"],
])("%s 沿已授权审批源派发相应富摘要",async(businessType,businessLabel,targetPath,amountText)=>{
  const {service,sms,db,instance}=fixture();
  instance.businessType=businessType;
  instance.businessId=businessType==="contract_version" ? "version" : "payment";
  Object.assign(db,{
    contractVersion:{findUnique:async()=>({contractId:"contract",amountCents:2500n,amountLimitType:"capped",companyEntityNameSnapshot:"申请方"})},
    contract:{findUnique:async()=>({projectId:"project",code:"HT-001",name:"合成合同",counterparty:"合同对方"})},
    paymentRequest:{findUnique:async()=>({id:"payment",projectId:"project",code:"FK-001",contractId:"contract",contractVersionId:"version",
      settlementId:null,paymentMatter:"合成付款",requestedAmountCents:750n,paidAmountCents:100n})},
  });
  const prior=process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
  process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED="true";
  try { await sendReminder(service,"later",requestId); }
  finally {
    if (prior===undefined) delete process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
    else process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED=prior;
  }
  expect(sms.send).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000002",expect.objectContaining({
    businessLabel,targetPath,amountText,participants:["申请方","合同对方"],scopeName:"测试项目",
  }));
});

it.each([
  {businessType:"spot_procurement_version",flowType:"spot_procurement.approve",businessId:"version",
    targetPath:"/零星采购/procurement",amountText:"待确定",participants:["采购人"]},
  {businessType:"spot_procurement_payment",flowType:"spot_procurement.payment.approve",businessId:"payment",
    targetPath:"/零星材料付款/payment",amountText:"25.01 元",participants:["供货商","合成收款方"]},
])("$businessType 从当前业务单据构造富催办并保留原键", async ({businessType,flowType,businessId,targetPath,amountText,participants}) => {
  const {service,sms,db,instance,insideTransaction}=fixture();
  Object.assign(instance,{businessType,flowType,businessId,status:"approval_pending"});
  const status="approval_pending";
  Object.assign(db,{
    contract:{findUnique:async()=>({projectId:"project",name:"合成合同",companyEntityName:"合成公司",counterparty:"合同对方"})},
    spotProcurementVersion:{findUnique:async()=>({procurementId:"procurement",status,reason:"补充材料",purchaserNameSnapshot:"采购人",estimatedTotalAmount:null})},
    spotProcurement:{findUnique:async()=>({id:"procurement",projectId:"project",currentVersionId:"version",status,code:"LX-001"})},
    spotProcurementPayment:{findUnique:async()=>({projectId:"project",status,code:"LXF-001",submittedAt:new Date(),approvalAmountCents:2501n,
      merchantNameSnapshot:"供货商",payeeNameSnapshot:"合成收款方",payeeBankAccountSnapshot:"不能写入短信"})}
  });
  sms.sendDutyIntent.mockImplementation(async()=>{
    expect(insideTransaction()).toBe(false);
    return {status:"accepted",message:"短信已提交发送"};
  });
  const prior=process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
  process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED="true";
  try {
    await sendReminder(service,"later",requestId);
    await sendReminder(service,"later",requestId);
  } finally {
    if (prior===undefined) delete process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
    else process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED=prior;
  }
  expect(sms.send).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
  expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000002",expect.objectContaining({
    targetPath,amountText,participants,scopeName:"测试项目"
  }));
  expect(JSON.stringify(sms.sendDutyIntent.mock.calls)).not.toContain("不能写入短信");
});

it("公司互转催办使用冻结双方、原审批轮和已授权单据直达", async () => {
  const {service,sms,db,instance}=fixture();
  Object.assign(instance,{businessType:"company_transfer",flowType:"company_transfer.approve",businessId:"transfer-001"});
  db.position.findMany.mockResolvedValue([{id:"p1",key:"chairman"}]);
  instance.frozenNodes=[{name:"领导终审",mode:"any",roleKeys:["chairman"],candidateUserIdsByRole:{chairman:["first"]}}];
  const findUnique=jest.fn(async()=>({status:"submitted",approvalInstanceId:"flow",applicantUserId:"owner",
    sourceProjectId:"project",destinationProjectId:null,code:"HZ-001",amountCents:1200n,
    frozenParties:{source:{name:"转出公司",bankAccount:"保密账号"},destination:{name:"转入公司"}}}));
  Object.assign(db,{companyTransfer:{findUnique}});
  const prior=process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
  process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED="true";
  try {
    await sendReminder(service,"owner",requestId);
    await sendReminder(service,"owner",requestId);
  } finally {
    if (prior===undefined) delete process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
    else process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED=prior;
  }
  expect(sms.send).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
  expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000002",expect.objectContaining({
    targetPath:"/公司互转台账?transferId=transfer-001",amountText:"12.00 元",participants:["转出公司","转入公司"],scopeName:"项目资金"
  }));
  expect(JSON.stringify(sms.sendDutyIntent.mock.calls)).not.toContain("保密账号");
});

describe('参与范围与节点变化', () => {
  it('无关人员不能查看或催办，拒绝时无短信或日志写入', async () => {
    const { service, sms, logs } = fixture();
    await expect(service.detail('flow', 'stranger')).rejects.toThrow('无权查看');
    await expect(service.remind('flow', 'stranger', requestId, '0'.repeat(64))).rejects.toThrow('无权查看');
    expect(logs).toHaveLength(0);
    expect(sms.send).not.toHaveBeenCalled();
  });
  it('已经审批的人仍能查看后续进度，审批结束后可以回看但不能催办', async () => {
    const { service, instance, logs } = fixture();
    instance.currentNodeIndex = 1;
    expect((await service.detail('flow', 'first')).pendingRecipients.map(p => p.id)).toEqual(['later']);
    instance.status = 'approved';
    logs.push({ id: 'approve-node-1', approvalInstanceId: 'flow', actorUserId: 'first', action: 'approve',
      approvedRoleKey: 'comprehensive_director', createdAt: new Date() } as ApprovalActionLog);
    logs.push({ id: 'approve-node-2', approvalInstanceId: 'flow', actorUserId: 'later', action: 'approve',
      approvedRoleKey: 'project_manager', createdAt: new Date() } as ApprovalActionLog);
    const detail = await service.detail('flow', 'first');
    expect(detail.nodes.map(n => n.status)).toEqual(['已通过', '已通过']);
    expect(detail.canRemind).toBe(false);
    await expect(sendReminder(service, 'first', requestId)).rejects.toThrow('流程已结束');
  });
  it('只发送选中的待办人，先保留请求再调用供应商，超时同键不重发', async () => {
    const { service, instance, sms, logs, insideTransaction } = fixture();
    instance.frozenNodes = [{ name: '联合会签', mode: 'all', roleKeys: ['comprehensive_director', 'project_manager'], candidateUserIdsByRole: { comprehensive_director: ['first'], project_manager: ['later'] } }];
    const detail = await service.detail('flow', 'owner');
    await expect(service.remind('flow', 'owner', requestId, detail.reminderToken, ['stranger'])).rejects.toThrow('待审批人');
    expect(logs).toEqual([]);
    let dispatch: { insideTransaction: boolean; reservation?: ApprovalActionLog } | undefined;
    sms.send.mockImplementation(async () => {
      dispatch = { insideTransaction: insideTransaction(), reservation: logs[0] };
      throw new Error('simulated timeout');
    });
    const result = await service.remind('flow', 'owner', requestId, detail.reminderToken, ['later']);
    expect(dispatch).toMatchObject({ insideTransaction: false, reservation: { id: requestId, metadata: { recipientIds: ['later'] } } });
    expect(result.reminders[0].results).toMatchObject([{ userId: 'later', status: 'unknown' }]);
    await service.remind('flow', 'owner', requestId, detail.reminderToken, ['later']);
    expect(sms.send.mock.calls).toEqual([['13800000003', '费用审批', '联合会签', 'BX-001']]);
  });
  it('会签只催未签岗位的人，不给已经签过的人发送', async () => {
    const { service, instance, sms } = fixture();
    instance.frozenNodes = [{ name: '联合会签', mode: 'all', roleKeys: ['comprehensive_director', 'project_manager'], approvedRoleKeys: ['comprehensive_director'], candidateUserIdsByRole: { comprehensive_director: ['first'], project_manager: ['later'] } }];
    await sendReminder(service, 'first', requestId);
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(sms.send).toHaveBeenCalledWith('13800000003', '费用审批', '联合会签', 'BX-001');
  });
  it('发送失败保留失败记录，不能显示成功；不同请求也受共同冷却限制', async () => {
    const { service, sms } = fixture();
    sms.send.mockResolvedValue({ status: 'failed', message: '短信发送失败' });
    const result = await sendReminder(service, 'later', requestId);
    expect(result.reminders[0].results[0].status).toBe('failed');
    await expect(sendReminder(service, 'owner', '22222222-2222-4222-8222-222222222222')).rejects.toThrow('刚刚已催办');
    expect(sms.send).toHaveBeenCalledTimes(1);
  });
  it('发送结果不确定时重放请求不重发', async () => {
    const { service, sms } = fixture();
    sms.send.mockResolvedValue({ status: 'unknown', message: '发送结果待确认' });
    await sendReminder(service, 'later', requestId);
    expect((await sendReminder(service, 'later', requestId)).reminders[0].results[0].status).toBe('unknown');
    expect(sms.send).toHaveBeenCalledTimes(1);
  });
  it('账号停用后不再发送短信，停用账号也不能查看', async () => {
    const { service, users } = fixture();
    users.find(u => u.id === 'first')!.isActive = false;
    expect((await service.detail('flow', 'later')).pendingRecipients).toEqual([]);
    await expect(service.detail('flow', 'first')).rejects.toThrow('无权查看');
  });
  it('预约后节点推进，本次取消发送，不能催下一节点', async () => {
    const { service, db, instance, sms } = fixture();
    db.$queryRaw.mockImplementationOnce(async () => []).mockImplementationOnce(async () => { instance.currentNodeIndex = 1; return []; });
    const result = await sendReminder(service, 'later', requestId);
    expect(result.reminders[0].results[0].status).toBe('cancelled');
    expect(sms.send).not.toHaveBeenCalled();
  });
  it('未接通短信时禁止发送并给出明确原因', async () => {
    const { service, sms } = fixture();
    sms.available = () => false;
    expect((await service.detail('flow', 'later')).reminderUnavailableReason).toBe('短信服务尚未启用');
    await expect(sendReminder(service, 'later', requestId)).rejects.toThrow('短信服务尚未启用');
  });
});

it('费用流程不支持全局委托时，不向没有审批权的受托人泄露或发送', async () => {
  const { service, db } = fixture();
  db.approvalDelegation.findMany.mockResolvedValue([{ fromUserId: 'first', toUserId: 'stranger' }]);
  await expect(service.detail('flow', 'stranger')).rejects.toThrow('无权查看');
  expect((await service.detail('flow', 'later')).pendingRecipients.map(p => p.id)).toEqual(['first']);
});

it.each(['contract_version', 'settlement', 'payment_request', 'project_expense_request', 'expense_claim', 'spot_procurement_version', 'spot_procurement_payment', 'project_financing_quota', 'project_settlement_exception_quota'])('%s 使用同一参与人查看与催办规则', async businessType => {
  const { service, db, instance } = fixture();
  instance.businessType = businessType;
  const business = { findUnique: jest.fn(async () => ({ projectId: 'project', code: 'LOCAL-001' })) };
  Object.assign(db, {
    contractVersion: { findUnique: jest.fn(async () => ({ contractId: 'contract' })) }, contract: business,
    settlement: business, paymentRequest: business, projectExpenseRequest: business,
    spotProcurementVersion: { findUnique: jest.fn(async () => ({ procurementId: 'procurement' })) }, spotProcurement: business, spotProcurementPayment: business,
    projectFinancingQuota: business, projectSettlementExceptionQuota: business
  });
  const result = await service.detail('flow', 'later');
  expect(result.nodes).toHaveLength(2);
  expect(result.canRemind).toBe(true);
  await expect(service.detail('flow', 'stranger')).rejects.toThrow('无权查看');
});

describe('催办遵守各业务自审限制', () => {
  it('付款申请人具备当前直接审批岗位时按现行自审规则接收催办', async () => {
    const { service, db, instance } = fixture();
    instance.businessType = 'payment_request';
    instance.applicantUserId = 'first';
    Object.assign(db, { paymentRequest: { findUnique: async () => ({ projectId: 'project', code: 'FK-001' }) } });
    expect((await service.detail('flow', 'first')).pendingRecipients.map(p => p.id)).toEqual(['first']);
  });
  it('费用保留原直接自审规则，但不能通过转交自审', async () => {
    const { service, instance } = fixture();
    instance.applicantUserId = 'first';
    expect((await service.detail('flow', 'first')).pendingRecipients.map(p => p.id)).toEqual(['first']);
    instance.frozenNodes = [{ name: '项目经理', mode: 'any', roleKeys: ['project_manager'], candidateUserIdsByRole: { project_manager: ['later'] }, assignments: [{ fromUserId: 'later', toUserId: 'first', fromRoleKey: 'project_manager' }] }];
    expect((await service.detail('flow', 'first')).pendingRecipients.map(p => p.id)).not.toContain('first');
  });
  it('垫资额度仅保留以财务主管发起且正在财务节点的自审例外', async () => {
    const { service, db, instance } = fixture();
    instance.businessType = 'project_financing_quota';
    instance.applicantUserId = 'first';
    instance.frozenNodes = [{ name: '财务主管', mode: 'any', roleKeys: ['finance_director'] }];
    db.position.findMany.mockResolvedValue([{ id: 'p1', key: 'finance_director' }, { id: 'p2', key: 'project_manager' }]);
    const business = { projectId: 'project', requestedByRoleKey: 'project_manager' };
    Object.assign(db, { projectFinancingQuota: { findUnique: async () => business } });
    expect((await service.detail('flow', 'first')).pendingRecipients).toEqual([]);
    business.requestedByRoleKey = 'finance_director';
    expect((await service.detail('flow', 'first')).pendingRecipients.map(p => p.id)).toEqual(['first']);
  });
});

describe('委托与历史处理人员的可见性边界', () => {
  it.each(['contract_version', 'settlement', 'payment_request'])('%s 冻结节点的有效全局受托人能查看并收到当前节点催办', async businessType => {
    const { service, db, instance, sms } = fixture();
    instance.businessType = businessType;
    instance.frozenNodes = [{ ...nodes[0], roleScopesByRole: { comprehensive_director: 'global' } }];
    const business = { findUnique: async () => ({ projectId: 'project', code: 'LOCAL-001' }) };
    Object.assign(db, { contractVersion: { findUnique: async () => ({ contractId: 'contract' }) }, contract: business, settlement: business, paymentRequest: business });
    db.approvalDelegation.findMany.mockResolvedValue([{ fromUserId: 'first', toUserId: 'stranger' }]);
    expect((await service.detail('flow', 'stranger')).pendingRecipients.map(p => p.id)).toEqual(['first', 'stranger']);
    await sendReminder(service, 'stranger', requestId);
    expect(sms.send).toHaveBeenCalledTimes(2);
    expect(sms.send).toHaveBeenCalledWith('13800000004', expect.any(String), '综合部主管', 'LOCAL-001');
  });

  it('委托人的岗位作用域不匹配冻结节点时，受托人不能查看或收到催办', async () => {
    const { service, db, instance } = fixture();
    instance.businessType = 'payment_request';
    instance.frozenNodes = [{ ...nodes[0], roleScopesByRole: { comprehensive_director: 'project' } }];
    Object.assign(db, { paymentRequest: { findUnique: async () => ({ projectId: 'project', code: 'FK-1' }) } });
    db.approvalDelegation.findMany.mockResolvedValue([{ fromUserId: 'first', toUserId: 'stranger' }]);
    await expect(service.detail('flow', 'stranger')).rejects.toThrow('无权查看');
    expect((await service.detail('flow', 'owner')).pendingRecipients).toEqual([]);
  });

  it('无关岗位人员的委托不能借同岗位名称进入冻结人员名单', async () => {
    const { service, db, instance } = fixture();
    instance.businessType = 'payment_request';
    Object.assign(db, { paymentRequest: { findUnique: async () => ({ projectId: 'project', code: 'FK-1' }) } });
    db.userPosition.findMany.mockResolvedValue([{ userId: 'first', positionId: 'p1', projectId: null }, { userId: 'owner', positionId: 'p1', projectId: null }, { userId: 'later', positionId: 'p2', projectId: 'project' }]);
    db.approvalDelegation.findMany.mockResolvedValue([{ fromUserId: 'owner', toUserId: 'stranger' }]);
    await expect(service.detail('flow', 'stranger')).rejects.toThrow('无权查看');
    expect((await service.detail('flow', 'owner')).pendingRecipients.map(p => p.id)).toEqual(['first']);
  });

  it.each([['reject_previous', '退回上一节点'], ['return_to_applicant', '退回申请人']])('实际执行 %s 的历史处理人在岗位变动后仍可查看完整记录', async (action, label) => {
    const { service, logs } = fixture();
    logs.push({ id: 'historical', approvalInstanceId: 'flow', actorUserId: 'stranger', action, comment: '需补充依据', metadata: null, createdAt: new Date() } as ApprovalActionLog);
    const result = await service.detail('flow', 'stranger');
    expect(result.history[0]).toEqual(expect.objectContaining({ action: label, comment: '需补充依据' }));
    expect(result.pendingRecipients.map(p => p.id)).toEqual(['first']);
  });

  it('不把冻结名单外的伪造转交来源当作查看或催办授权', async () => {
    const { service, instance } = fixture();
    instance.frozenNodes = [{ ...nodes[0], assignments: [{ kind: 'transfer', fromUserId: 'owner', toUserId: 'stranger', fromRoleKey: 'comprehensive_director' }] }];
    await expect(service.detail('flow', 'stranger')).rejects.toThrow('无权查看');
    const result = await service.detail('flow', 'owner');
    expect(result.nodes[0].participants.map(p => p.id)).toEqual(['first']);
    expect(result.pendingRecipients.map(p => p.id)).toEqual(['first']);
  });

  it('有效冻结转交的双方保持可见，不要求受转人占有原岗位', async () => {
    const { service, instance } = fixture();
    instance.frozenNodes = [{ ...nodes[0], assignments: [{ kind: 'transfer', fromUserId: 'first', toUserId: 'stranger', fromRoleKey: 'comprehensive_director' }] }];
    const result = await service.detail('flow', 'stranger');
    expect(result.nodes[0].participants.map(p => p.id)).toEqual(['first', 'stranger']);
    expect(result.pendingRecipients.map(p => p.id)).toEqual(['first', 'stranger']);
  });
});


describe('催办确认坐标与请求重放', () => {
  it('确认页面后节点推进时不向未经确认的新节点发送', async () => {
    const { service, instance, sms, logs } = fixture();
    const snapshot = await service.detail('flow', 'owner');
    instance.currentNodeIndex = 1;
    await expect(service.remind('flow', 'owner', requestId, snapshot.reminderToken)).rejects.toThrow('审批进度或待审批人已变化');
    expect(sms.send).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });
  it('同一节点的接收人发生变化时要求重新确认', async () => {
    const { service, instance, sms, logs } = fixture();
    const snapshot = await service.detail('flow', 'owner');
    instance.frozenNodes = [{ ...nodes[0], assignments: [{ kind: 'transfer', fromUserId: 'first', toUserId: 'stranger', fromRoleKey: 'comprehensive_director' }] }];
    await expect(service.remind('flow', 'owner', requestId, snapshot.reminderToken)).rejects.toThrow('审批进度或待审批人已变化');
    expect(sms.send).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });
  it('实例更新即使节点与人员未变也使旧确认失效', async () => {
    const { service, instance, sms, logs } = fixture();
    const snapshot = await service.detail('flow', 'owner');
    instance.updatedAt = new Date(instance.updatedAt.getTime() + 1);
    await expect(service.remind('flow', 'owner', requestId, snapshot.reminderToken)).rejects.toThrow('审批进度或待审批人已变化');
    expect(sms.send).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });
  it('已持久化的同键请求即使确认坐标过期仍只回读不重发', async () => {
    const { service, instance, sms } = fixture();
    const snapshot = await service.detail('flow', 'owner');
    await service.remind('flow', 'owner', requestId, snapshot.reminderToken);
    instance.currentNodeIndex = 1;
    const replay = await service.remind('flow', 'owner', requestId, snapshot.reminderToken);
    expect(replay.pendingRecipients.map(p => p.id)).toEqual(['later']);
    expect(sms.send).toHaveBeenCalledTimes(1);
  });
});

it('历史有效转审接收人在后续被替换且未执行审批时仍可回看流程', async () => {
  const { service, logs } = fixture();
  logs.push({ id: 'historical-transfer', approvalInstanceId: 'flow', actorUserId: 'first', representedUserId: 'first', action: 'transfer', comment: null, approvedRoleKey: 'comprehensive_director', signatureFileIdSnapshot: null, signatureSha256Snapshot: null, signatureVersionIdSnapshot: null, metadata: { kind: 'transfer', fromUserId: 'first', toUserId: 'stranger', fromRoleKey: 'comprehensive_director' }, createdAt: new Date() } as ApprovalActionLog);
  const result = await service.detail('flow', 'stranger');
  expect(result.history[0].action).toBe('转审');
  expect(result.pendingRecipients.map(p => p.id)).toEqual(['first']);
});


describe('零采试点关闭后的催办边界', () => {
  it.each(['spot_procurement_version', 'spot_procurement_payment'])('%s 项目未启用时仍可回看，但禁止发短信及写催办记录', async businessType => {
    const { service, db, instance, sms, logs, pilot } = fixture();
    instance.businessType = businessType;
    const business = { findUnique: async () => ({ projectId: 'project', code: 'LOCAL-001' }) };
    Object.assign(db, {
      spotProcurementVersion: { findUnique: async () => ({ procurementId: 'procurement' }) },
      spotProcurement: business, spotProcurementPayment: business
    });
    const enabled = await service.detail('flow', 'later');
    expect(enabled.pendingRecipients.map(person => person.id)).toEqual(['first']);
    pilot.isEnabled.mockReturnValue(false);
    const disabled = await service.detail('flow', 'later');
    expect(disabled.nodes).toHaveLength(2);
    expect(disabled.pendingRecipients).toEqual([]);
    expect(disabled.canRemind).toBe(false);
    expect(disabled.reminderUnavailableReason).toContain('尚未启用');
    expect(pilot.isEnabled).toHaveBeenCalledWith('project');
    await expect(service.remind('flow', 'later', requestId, enabled.reminderToken)).rejects.toThrow('审批进度或待审批人已变化');
    await expect(service.remind('flow', 'later', requestId, disabled.reminderToken)).rejects.toThrow('尚未启用');
    expect(logs).toEqual([]);
    expect(sms.send).not.toHaveBeenCalled();
  });
});

describe('latest-main approval identity compatibility',()=>{
  it('general procurement permits direct-role applicant review but ignores unsupported assignment metadata',async()=>{
    const f=fixture();f.instance.businessType='general_procurement';f.instance.applicantUserId='first';
    Object.assign(f.db,{generalProcurement:{findUnique:jest.fn(async()=>({projectId:'project',code:'CG-001',status:'approval_pending',approvalInstanceId:'flow'}))}});
    f.instance.frozenNodes=[{...nodes[0],assignments:[{fromUserId:'first',toUserId:'stranger',fromRoleKey:'comprehensive_director'}]}];
    expect((await f.service.detail('flow','first')).pendingRecipients.map(p=>p.id)).toEqual(['first']);
    await expect(f.service.detail('flow','stranger')).rejects.toThrow('无权查看');
  });
  it('company transfer uses global roles and excludes the applicant even when frozen as a candidate',async()=>{
    const f=fixture();f.instance.businessType='company_transfer';f.instance.applicantUserId='first';
    Object.assign(f.db,{companyTransfer:{findUnique:jest.fn(async()=>({code:'HZ-001',status:'submitted',approvalInstanceId:'flow'}))}});
    f.db.position.findMany.mockResolvedValue([{id:'p1',key:'chairman'},{id:'p2',key:'general_manager'}]);
    f.instance.frozenNodes=[{name:'决策审批',mode:'any',roleKeys:['chairman','general_manager'],candidateUserIdsByRole:{chairman:['first'],general_manager:['later']},roleScopesByRole:{chairman:'global',general_manager:'global'}} as FrozenApprovalNode];
    expect((await f.service.detail('flow','first')).pendingRecipients).toEqual([]);
  });
  it('fund execution reads the latest case revision, keeps strict global scoped delegation and rejects obsolete approval bindings',async()=>{
    const f=fixture();f.instance.businessType='fund_execution_case';f.instance.businessId='case-key';f.instance.applicantUserId='first';
    const current={status:'submitted',approvalInstanceId:'flow'};const findFirst=jest.fn(async()=>current);
    Object.assign(f.db,{fundExecutionCase:{findFirst}});
    f.db.position.findMany.mockResolvedValue([{id:'p1',key:'finance_director'},{id:'p2',key:'project_manager'}]);
    f.instance.frozenNodes=[{name:'财务主管',mode:'any',roleKeys:['finance_director'],candidateUserIdsByRole:{finance_director:['first']}}];
    f.db.approvalDelegation.findMany.mockResolvedValue([{fromUserId:'first',toUserId:'stranger',actionKey:'fund_execution_case.approve',resourceType:'fund_execution_case',resourceId:'case-key'}]);
    expect((await f.service.detail('flow','stranger')).pendingRecipients.map(p=>p.id)).toEqual(['first','stranger']);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{caseKey:'case-key'},orderBy:{revision:'desc'}}));
    f.db.approvalDelegation.findMany.mockResolvedValue([{fromUserId:'first',toUserId:'stranger',actionKey:'fund_execution_case.approve',resourceType:'fund_execution_case',resourceId:'other-case'}]);
    await expect(f.service.detail('flow','stranger')).rejects.toThrow('无权查看');
    current.approvalInstanceId='new-flow';
    expect((await f.service.detail('flow','first')).pendingRecipients).toEqual([]);
  });
  it('project expense ignores unsupported assignments and ineffective global project-only positions',async()=>{
    const f=fixture();f.instance.businessType='project_expense_request';
    Object.assign(f.db,{projectExpenseRequest:{findUnique:jest.fn(async()=>({projectId:'project',code:'ZC-001'}))}});
    f.db.position.findMany.mockResolvedValue([{id:'p1',key:'project_manager'},{id:'p2',key:'project_manager'}]);
    f.instance.frozenNodes=[{name:'项目经理',mode:'any',roleKeys:['project_manager'],assignments:[{fromUserId:'later',toUserId:'stranger',fromRoleKey:'project_manager'}]}];
    expect((await f.service.detail('flow','owner')).pendingRecipients.map(p=>p.id)).toEqual(['later']);
    await expect(f.service.detail('flow','stranger')).rejects.toThrow('无权查看');
    await expect(f.service.detail('flow','first')).rejects.toThrow('无权查看');
  });
});

describe('formal evidence projects to its authoritative independent source',()=>{
  it('maps completed receipt evidence to the actual receipt and delegates participant authorization',async()=>{
    const f=fixture();f.instance.flowType='formal_approval_evidence';f.instance.businessType='spot_procurement_receipt';f.instance.businessId='review-id';
    Object.assign(f.db,{spotProcurementReceiptReview:{findUnique:jest.fn(async()=>({receiptId:'receipt-id'}))}});
    const independent={supports:jest.fn(()=>true),detail:jest.fn(async()=>({id:'independent:receipt_review:receipt-id'})),remind:jest.fn()};
    const service=new ApprovalProgressService(f.db as unknown as PrismaService,f.sms as unknown as ApprovalSmsService,independent as never);
    expect(await service.detail('flow','later')).toEqual({id:'independent:receipt_review:receipt-id'});
    expect(independent.detail).toHaveBeenCalledWith('independent:receipt_review:receipt-id','later');
  });
  it('excludes formal evidence from regular lists to prevent duplicate flows',async()=>{
    const f=fixture();f.db.approvalInstance.findMany.mockResolvedValue([]);
    await f.service.list('owner');
    expect(f.db.approvalInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{flowType:{not:'formal_approval_evidence'}}}));
  });
  it('suppresses financing reminders after project deactivation',async()=>{
    const f=fixture();f.instance.businessType='project_financing_quota';
    Object.assign(f.db,{projectFinancingQuota:{findUnique:jest.fn(async()=>({projectId:'project',requestedByRoleKey:'finance_director'}))}});
    f.db.project.findUnique.mockResolvedValue({name:'测试项目',isActive:false});
    const progress=await f.service.detail('flow','later');
    expect(progress.canRemind).toBe(false);expect(progress.pendingRecipients).toEqual([]);
  });
});

describe('spot procurement effective role scope',()=>{
  it.each(['spot_procurement_version','spot_procurement_payment'])('%s does not inherit an invalid global project-manager role',async businessType=>{
    const f=fixture();f.instance.businessType=businessType;
    Object.assign(f.db,{spotProcurementVersion:{findUnique:jest.fn(async()=>({procurementId:'procurement'}))},spotProcurement:{findUnique:jest.fn(async()=>({projectId:'project',code:'LC-001'}))},spotProcurementPayment:{findUnique:jest.fn(async()=>({projectId:'project',code:'LCFK-001'}))}});
    f.db.position.findMany.mockResolvedValue([{id:'p1',key:'project_manager'},{id:'p2',key:'project_manager'}]);
    f.instance.frozenNodes=[{name:'项目经理',mode:'any',roleKeys:['project_manager']}];
    const progress=await f.service.detail('flow','owner');
    expect(progress.pendingRecipients.map(p=>p.id)).toEqual(['later']);
    await expect(f.service.detail('flow','first')).rejects.toThrow('无权查看');
  });
});


it('60秒由待办职责共享，其他并联职责可独立催办', async () => {
  const { service, instance, logs, sms } = fixture();
  instance.frozenNodes = [
    { name: '综合部主管', mode: 'any', roleKeys: ['comprehensive_director'], protocolVersion: 1, executionMode: 'parallel' },
    { name: '项目经理', mode: 'any', roleKeys: ['project_manager'], protocolVersion: 1, executionMode: 'parallel' }
  ];
  const first = await service.detail('flow', 'owner');
  const receipt = await service.remind('flow', 'owner', requestId, first.reminderToken, ['first']);
  expect(receipt.remindableRecipients.map(user => user.id)).toEqual(['later']);
  expect(Date.parse(receipt.nextRemindAt!) - logs[0].createdAt.getTime()).toBe(60_000);
  const otherKey = '22222222-2222-4222-8222-222222222222';
  await expect(service.remind('flow', 'later', otherKey, receipt.reminderToken, ['first'])).rejects.toThrow('刚刚已催办');
  await service.remind('flow', 'later', otherKey, receipt.reminderToken, ['later']);
  expect(sms.send.mock.calls).toEqual([
    ['13800000002', '费用审批', '综合部主管', 'BX-001'],
    ['13800000003', '费用审批', '项目经理', 'BX-001']
  ]);
});

it('纯报销按每组职责催办，已失去的兼岗职责不再出现在待办人中', async () => {
  const { service, instance, db, sms } = fixture();
  db.expenseClaim.findUnique.mockResolvedValue({
    projectId: 'project', code: 'BX-001', applicantUserId: 'owner', handledByUserId: 'owner',
    claimType: 'reimbursement', generalProcurementId: null, actualPurchaseBatchId: null, status: 'approval_pending', approvalInstanceId: 'flow'
  } as never);
  instance.frozenNodes = [
    { name: '综合部主管', mode: 'any', roleKeys: ['comprehensive_director'], protocolVersion: 1, executionMode: 'parallel',
      candidateUserIdsByRole: { comprehensive_director: ['first'] } },
    { name: '项目经理', mode: 'any', roleKeys: ['project_manager'], protocolVersion: 1, executionMode: 'parallel',
      roleScopesByRole: { project_manager: 'project' }, candidateUserIdsByRole: { project_manager: ['first', 'later'] } }
  ];
  const commonAssignments = [{ userId: 'first', positionId: 'p1', projectId: null }, { userId: 'later', positionId: 'p2', projectId: 'project' }];
  db.userPosition.findMany.mockResolvedValue([...commonAssignments, { userId: 'first', positionId: 'p2', projectId: 'project' }]);
  const before = await service.detail('flow', 'owner');
  expect(before.nodes.map(node => node.pending.map(user => user.id))).toEqual([['first'], ['first', 'later']]);
  db.userPosition.findMany.mockResolvedValue([...commonAssignments, { userId: 'first', positionId: 'p2', projectId: null }]);
  const progress = await service.detail('flow', 'owner');
  expect(progress.pendingRecipients).toEqual(before.pendingRecipients);
  expect(progress.nodes.map(node => node.pending.map(user => user.id))).toEqual([['first'], ['later']]);
  await expect(service.remind('flow', 'owner', requestId, before.reminderToken, ['first'])).rejects.toThrow('待审批人已变化');
  expect(sms.send).not.toHaveBeenCalled();
  await service.remind('flow', 'owner', requestId, progress.reminderToken, ['first']);
  expect(sms.send.mock.calls).toEqual([['13800000002', '费用审批', '综合部主管', 'BX-001']]);
});

it('并联报销缺岗补齐后才给新职责人办理权，轮次失效后关闭办理及催办', async () => {
  const { service, instance, db } = fixture();
  const claim = {
    projectId: 'project', code: 'BX-001', applicantUserId: 'owner', handledByUserId: 'owner',
    claimType: 'reimbursement', generalProcurementId: null, actualPurchaseBatchId: null,
    status: 'approval_pending', approvalInstanceId: 'flow'
  };
  db.expenseClaim.findUnique.mockResolvedValue(claim as never);
  instance.frozenNodes = [
    { name: '项目经理', mode: 'any', roleKeys: ['project_manager'], protocolVersion: 1, executionMode: 'parallel',
      candidatePolicy: 'current_role_scope', roleScopesByRole: { project_manager: 'project' }, candidateUserIdsByRole: { project_manager: [] } } as FrozenApprovalNode
  ];
  db.userPosition.findMany.mockResolvedValue([]);
  expect((await service.detail('flow', 'owner')).nodes[0]).toMatchObject({ status: '待配置', pending: [] });
  await expect(service.detail('flow', 'later')).rejects.toThrow('无权查看');

  db.userPosition.findMany.mockResolvedValue([{ userId: 'later', positionId: 'p2', projectId: 'project' }]);
  const active = await service.detail('flow', 'later');
  expect(active.canHandle).toBe(true);
  expect(active.nodes[0].pending.map(user => user.id)).toEqual(['later']);
  claim.approvalInstanceId = 'new-round';
  expect(await service.detail('flow', 'owner')).toMatchObject({ canHandle: false, canRemind: false, pendingRecipients: [] });
  await expect(service.detail('flow', 'later')).rejects.toThrow('无权查看');
});

it('并联轮所有职责同时展示待办，缺岗补齐后只唤醒未办职责', async () => {
  const { service, instance } = fixture();
  instance.frozenNodes = [
    { name: '综合部主管', mode: 'any', roleKeys: ['comprehensive_director'], protocolVersion: 1, executionMode: 'parallel' },
    { name: '项目经理', mode: 'any', roleKeys: ['project_manager'], protocolVersion: 1, executionMode: 'parallel' }
  ] as FrozenApprovalNode[];
  const progress = await service.detail('flow', 'owner');
  expect(progress.pendingRecipients.map(user => user.id)).toEqual(['first', 'later']);
  expect(progress.nodes.map(node => node.status)).toEqual(['处理中', '处理中']);
});


it('已办职责保留当时办理人，调岗只改变未办职责', async () => {
  const { service, instance, db, logs, users } = fixture();
  users[1].name = '后来修改的姓名';
  instance.frozenNodes = [
    { name: '综合部主管', mode: 'any', roleKeys: ['comprehensive_director'], approvedRoleKeys: ['comprehensive_director'], protocolVersion: 1, executionMode: 'parallel' },
    { name: '项目经理', mode: 'any', roleKeys: ['project_manager'], protocolVersion: 1, executionMode: 'parallel' }
  ] as FrozenApprovalNode[];
  logs.push({id: 'approved-first', approvalInstanceId: 'flow', actorUserId: 'first', action: 'approve', approvedRoleKey: 'comprehensive_director', createdAt: new Date(), comment: null, signatureFileIdSnapshot: 'sig', signatureSha256Snapshot: 'a'.repeat(64), signatureVersionIdSnapshot: 'sigv', representedUserId: 'first', metadata: { approverName: '综合主管' }});
  db.userPosition.findMany.mockResolvedValue([{ userId: 'stranger', positionId: 'p1', projectId: null }, { userId: 'later', positionId: 'p2', projectId: 'project' }]);
  const progress = await service.detail('flow', 'owner');
  expect(progress.nodes[0].participants).toEqual([{id: 'first', name: '综合主管'}]);
  expect(progress.pendingRecipients.map(user => user.id)).toEqual(['later']);
});
