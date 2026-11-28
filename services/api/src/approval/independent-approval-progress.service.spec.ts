import { IndependentApprovalProgressService } from './independent-approval-progress.service';
import { SOURCES, type IndependentReviewSubject } from './independent-approval-progress.sources';
import type { PrismaService } from '../database/prisma.service';
import type { ApprovalSmsService } from './approval-sms.service';
import type { AuditLog } from '@prisma/client';

jest.mock('./independent-approval-progress.sources', () => ({
  SOURCES: [{ kind: 'seal_test', title: '用章审批', listIds: jest.fn(), load: jest.fn() }],
  INDEPENDENT_REVIEW_LOCK_TABLES: ['ContractVersion']
}));
const source = SOURCES[0] as jest.Mocked<(typeof SOURCES)[number]>;
const id = 'independent:seal_test:business-1';
const requestId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
function fixture() {
  source.kind = 'seal_test';
  const users = ['owner', 'first', 'later', 'stranger', 'foreign', 'technical', 'global-manager'].map((id, index) => ({ id, name: `人员${index}`, isActive: true, phone: `1380000000${index}` }));
  const subject: IndependentReviewSubject = {
    id: 'business-1', kind: 'seal_test', title: '用章审批', businessCode: 'HT-LOCAL', projectId: 'project-1', applicantUserId: 'owner', participantIds: [], createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01'), status: 'in_progress', currentNodeIndex: 0,
    nodes: [{ name: '综合部主管', roleKeys: ['comprehensive_director'], scope: 'global', status: '处理中' }, { name: '项目经理', roleKeys: ['project_manager'], scope: 'project', status: '未开始' }], history: [], lockTargets: [{ table: 'ContractVersion', id: 'business-1' }]
  };
  const logs: AuditLog[] = [];
  const project = { name: '本地项目', isActive: true };
  const db = {
    user: { findMany: jest.fn(async () => users),findUnique:jest.fn(async ({where}:{where:{id:string}})=>users.find(user=>user.id===where.id)) },
    settlement:{findUnique:jest.fn(async()=>({id:"business-1",code:"JS-TEST",projectId:"project-1",contractId:"c-1",status:"pending_archive_confirm",
      governanceVersion:1,preparedByUserId:"owner",amountCents:12345n}))},
    contract:{findUnique:jest.fn(async()=>({name:"合成合同",companyEntityName:"合成甲方",counterparty:"合成乙方",projectId:"project-1",code:"HT-TEST"}))},
    position: { findMany: jest.fn(async () => [{ id: 'p1', key: 'comprehensive_director' }, { id: 'p2', key: 'project_manager' }, { id: 'p3', key: 'super_admin' }]) },
    userPosition: { findMany: jest.fn(async () => [{ userId: 'first', positionId: 'p1', projectId: null }, { userId: 'later', positionId: 'p2', projectId: 'project-1' }, { userId: 'foreign', positionId: 'p2', projectId: 'project-2' }, { userId: 'technical', positionId: 'p3', projectId: null }, { userId: 'global-manager', positionId: 'p2', projectId: null }]) },
    projectMember: { findMany: jest.fn(async (): Promise<Array<{ userId: string; projectId: string; positionKey: string }>> => []) },
    project: { findUnique: jest.fn(async () => project) },
    auditLog: {
      findMany: jest.fn(async ({ where }: { where: { businessId?: string; action?: string; metadata?: { array_contains: string[] } } }) =>
        where.businessId ? logs.filter(log => log.businessId === where.businessId) :
          logs.filter(log => log.action === where.action && (log.metadata as { recipientIds?: string[] }).recipientIds?.includes(where.metadata!.array_contains[0]))),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => logs.find(log => log.id === where.id) ?? null),
      create: jest.fn(async ({ data }: { data: Partial<AuditLog> }) => { const log = { id: data.id ?? `log-${logs.length}`, createdAt: new Date(), ...data } as AuditLog; logs.push(log); return log; })
    },
    $queryRaw: jest.fn(async () => [{ id: subject.id }])
  };
  let insideTransaction = false;
  const client = Object.assign(db, { $transaction: async (run: (tx: typeof db) => Promise<unknown>) => {
    insideTransaction = true;
    try { return await run(db); } finally { insideTransaction = false; }
  } });
  const outcome = {status:"accepted",message:"短信已提交发送"};
  const sms = {available:jest.fn(()=>true),send:jest.fn(async()=>outcome),sendDutyIntent:jest.fn(async()=>outcome)};
  source.load.mockReset().mockImplementation(async (_db, key) => key === subject.id ? subject : null);
  source.listIds.mockReset().mockImplementation(async (_db, cursor) => cursor ? [] : [subject.id]);
  return { subject, users, db, sms, logs, project, insideTransaction: () => insideTransaction, service: new IndependentApprovalProgressService(client as unknown as PrismaService, sms as unknown as ApprovalSmsService) };
}
async function send(service: IndependentApprovalProgressService, actor = 'owner', key = requestId) {
  const detail = await service.detail(id, actor);
  return service.remind(id, actor, key, detail.reminderToken);
}

it("独立结算归档手动催办使用当前领取职责和业务摘要，重复请求不再发",async()=>{
  const {service,subject,sms,insideTransaction} = fixture();
  source.kind="settlement_archive";
  subject.kind="settlement_archive";
  subject.title="结算归档确认";
  subject.businessCode="JS-TEST";
  const id="independent:settlement_archive:business-1";
  const view=await service.detail(id,"owner");
  const before=process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
  process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED="true";
  sms.sendDutyIntent.mockImplementation(async()=>{
    expect(insideTransaction()).toBe(false);
    return {status:"accepted",message:"短信已提交发送"};
  });
  try {
    await service.remind(id,"owner",requestId,view.reminderToken,["first"]);
    await service.remind(id,"owner",requestId,view.reminderToken,["first"]);
  } finally {
    if (before===undefined) delete process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
    else process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED=before;
  }
  expect(sms.send).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
  expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000001",expect.objectContaining({
    businessLabel:"结算归档确认",dutyName:"综合部主管",scopeName:"本地项目",initiatorName:"人员0",
    subject:"合成合同结算",participants:["合成甲方","合成乙方"],amountText:"123.45 元",targetPath:"/结算管理/JS-TEST",
  }));
});

it.each(["contract_seal","contract_archive"])("独立 %s 只通知当前获准岗位并沿原合同追溯",async kind=>{
  const {service,subject,sms,db}=fixture();
  source.kind=kind;
  subject.kind=kind;
  Object.assign(db,{contractVersion:{findUnique:async()=>({contractId:"contract-1",amountCents:50n,amountLimitType:"capped"})}});
  const id=`independent:${kind}:business-1`;
  const view=await service.detail(id,"owner");
  const prior=process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
  process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED="true";
  try { await service.remind(id,"owner",requestId,view.reminderToken,["first"]); }
  finally {
    if (prior===undefined) delete process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
    else process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED=prior;
  }
  expect(sms.send).not.toHaveBeenCalled();
  expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
  expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000001",expect.objectContaining({
    targetPath:"/合同管理/HT-TEST",amountText:"0.50 元",
  }));
});

it("银行核验催办引用授权的单条审批中心详情，失去职责后拒绝与原键不重发",async()=>{
  const {service,subject,sms,db,insideTransaction}=fixture();
  source.kind="contract_bank_verification";
  subject.kind="contract_bank_verification";
  subject.title="银行流水核验";
  subject.businessCode="银行流水核验";
  Object.assign(db,{contractBankVerificationRequest:{findUnique:async()=>({
    projectId:"project-1",status:"pending_confirm",direction:"outflow",companyName:"合成公司",amountCents:1001n,
  })}});
  const id="independent:contract_bank_verification:business-1";
  const initial=await service.detail(id,"owner");
  const before=process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
  process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED="true";
  sms.sendDutyIntent.mockImplementation(async()=>{
    expect(insideTransaction()).toBe(false);
    return {status:"accepted",message:"短信已提交发送"};
  });
  try {
    await service.remind(id,"owner",requestId,initial.reminderToken,["first"]);
    await service.remind(id,"owner",requestId,initial.reminderToken,["first"]);
    expect(sms.sendDutyIntent).toHaveBeenCalledTimes(1);
    expect(sms.sendDutyIntent).toHaveBeenCalledWith("13800000001",expect.objectContaining({
      subject:"银行出款核验",amountText:"10.01 元",participants:["合成公司"],
      targetPath:"/审批中心?review=independent%3Acontract_bank_verification%3Abusiness-1",
    }));
    db.userPosition.findMany.mockResolvedValue([]);
    await expect(service.detail(id,"first")).rejects.toThrow("无权查看");
    expect(sms.send).not.toHaveBeenCalled();
  } finally {
    if (before===undefined) delete process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED;
    else process.env.APPROVAL_SMS_RICH_TEMPLATE_ENABLED=before;
  }
});

describe('独立审核进度权限', () => {
  it('发起人及后续项目审批人可看全流程，当前仅综合主管接收短信', async () => {
    const { service } = fixture();
    const detail = await service.detail(id, 'later');
    expect(detail.nodes.map(node => node.name)).toEqual(['综合部主管', '项目经理']);
    expect(detail.pendingRecipients.map(person => person.id)).toEqual(['first']);
    expect(detail.canRemind).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('1380000000');
    expect(detail.businessId).toBe('business-1');
  });
  it.each(['stranger', 'foreign', 'technical', 'global-manager'])('%s 不凭无关身份、其他项目或技术管理员身份读取', async actor => {
    const { service, sms, logs } = fixture();
    await expect(service.detail(id, actor)).rejects.toThrow('无权查看');
    await expect(service.remind(id, actor, requestId, '0'.repeat(64))).rejects.toThrow('无权查看');
    expect(sms.send).not.toHaveBeenCalled(); expect(logs).toEqual([]);
  });
  it.each(['project_manager', 'budget_staff'] as const)('项目专属岗位%s被错误存为全局时不能跨项目获得查阅或短信资格', async role => {
    const { service, subject, db, sms, logs } = fixture();
    db.position.findMany.mockResolvedValue([{ id: 'p2', key: role }]);
    subject.nodes = [{ name: '项目审核', roleKeys: [role], scope: 'global_or_project', status: '处理中' }];
    expect((await service.detail(id, 'later')).pendingRecipients.map(p => p.id)).toEqual(['later']);
    await expect(service.detail(id, 'global-manager')).rejects.toThrow('无权查看');
    await expect(service.detail(id, 'foreign')).rejects.toThrow('无权查看');
    await expect(service.remind(id, 'global-manager', requestId, '0'.repeat(64))).rejects.toThrow('无权查看');
    expect(sms.send).not.toHaveBeenCalled(); expect(logs).toEqual([]);
  });
  it('有效全局财务岗位继续继承到项目，技术管理员不因此成为业务审批人', async () => {
    const { service, subject, db } = fixture();
    db.position.findMany.mockResolvedValue([{ id: 'p1', key: 'finance_staff' }, { id: 'p2', key: 'finance_staff' }, { id: 'p3', key: 'super_admin' }]);
    subject.nodes = [{ name: '财务审核', roleKeys: ['finance_staff', 'super_admin'], scope: 'global_or_project', status: '处理中' }];
    expect((await service.detail(id, 'owner')).pendingRecipients.map(p => p.id)).toEqual(['first', 'later', 'global-manager']);
    await expect(service.detail(id, 'technical')).rejects.toThrow('无权查看');
    await expect(service.detail(id, 'foreign')).rejects.toThrow('无权查看');
  });
  it('技术模板仅在源明确指定技术岗位时允许技术管理员', async () => {
    const { service, subject } = fixture();
    subject.nodes = [{ name: '技术模板发布', roleKeys: ['super_admin'], scope: 'global', status: '处理中' }];
    expect((await service.detail(id, 'technical')).pendingRecipients.map(p => p.id)).toEqual(['technical']);
  });
  it('指定审核人仍须具有源要求的有效岗位，空指定名单失败关闭', async () => {
    const { service, subject } = fixture();
    subject.nodes = [{ ...subject.nodes[0], selectedUserIds: ['stranger'] }];
    expect((await service.detail(id, 'stranger')).pendingRecipients).toEqual([]);
    subject.nodes[0].selectedUserIds = [];
    await expect(service.detail(id, 'stranger')).rejects.toThrow('无权查看');
    expect((await service.detail(id, 'owner')).pendingRecipients).toEqual([]);
  });
  it('无岗位要求的明确审核人与排除人员规则生效', async () => {
    const { service, subject } = fixture();
    subject.nodes = [{ name: '指定人员确认', roleKeys: [], selectedUserIds: ['first', 'stranger'], excludeUserIds: ['first'], scope: 'global', status: '处理中' }];
    expect((await service.detail(id, 'owner')).pendingRecipients.map(p => p.id)).toEqual(['stranger']);
  });
  it('历史实际处理人与显式参与人可回看已结束流程，不能再催办', async () => {
    const { service, subject } = fixture();
    subject.status = 'approved'; subject.currentNodeIndex = 2;
    subject.history = [{ actorUserId: 'stranger', action: '确认', comment: '同意', createdAt: new Date() }];
    const detail = await service.detail(id, 'stranger');
    expect(detail.history[0].action).toBe('确认'); expect(detail.pendingRecipients).toEqual([]); expect(detail.canRemind).toBe(false);
    subject.history = []; subject.participantIds = ['foreign'];
    await expect(service.detail(id, 'foreign')).resolves.toEqual(expect.objectContaining({ status: 'approved' }));
  });
  it('停用用户不能查看、接收人停用后不再发送', async () => {
    const { service, users } = fixture();
    users.find(user => user.id === 'first')!.isActive = false;
    await expect(service.detail(id, 'first')).rejects.toThrow('无权查看');
    expect((await service.detail(id, 'owner')).pendingRecipients).toEqual([]);
  });
  it('不存在和草稿源不暴露，未知类型及非法ID拒绝', async () => {
    const { service } = fixture(); source.load.mockResolvedValue(null);
    expect(service.supports('seal_test')).toBe(true); expect(service.supports('unknown')).toBe(false);
    expect(service.isIndependentId(id)).toBe(true);
    await expect(service.detail(id, 'owner')).rejects.toThrow('无权查看');
    await expect(service.detail('independent:unknown:x', 'owner')).rejects.toThrow('无权查看');
    expect((await service.list('owner', undefined, 'seal_test', 'business-1')).items).toEqual([]);
  });
});

describe('独立审核短信事务与幂等', () => {
  it('先持久化申请再发送，结果回读；相同请求不重发并共享冷却', async () => {
    const { service, sms, logs, insideTransaction } = fixture();
    let dispatch: { insideTransaction: boolean; reserved: boolean } | undefined;
    sms.send.mockImplementation(async () => {
      dispatch = { insideTransaction: insideTransaction(), reserved: logs.some(log => log.id === requestId) };
      return { status: 'accepted', message: '短信已提交发送' };
    });
    const first = await send(service, 'later');
    expect(dispatch).toEqual({ insideTransaction: false, reserved: true });
    expect(first.reminders[0].results[0].status).toBe('accepted');
    expect(Date.parse(first.nextRemindAt!) - logs[0].createdAt.getTime()).toBe(60_000);
    await service.remind(id, 'later', requestId, '0'.repeat(64));
    await expect(send(service, 'owner', secondId)).rejects.toThrow('刚刚已催办');
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(sms.send).toHaveBeenCalledWith('13800000001', '用章审批', '综合部主管', 'HT-LOCAL');
  });
  it('未知催办只提示被选的当前办理人，撤岗、办结和轮次变化立即清除', async () => {
    const { service, sms, db, subject } = fixture();
    sms.send.mockRejectedValue(new Error('合成超时'));
    const result = await send(service);
    expect(result.reminders[0].results[0].status).toBe('unknown');
    const read = (actor: string) => service.recentPendingReminders(actor, new Date());
    expect(await read('first')).toEqual([expect.objectContaining({
      id, reminderId: requestId, businessId: subject.id, currentNodeName: '综合部主管'
    })]);
    expect(await read('later')).toEqual([]);
    expect(await read('owner')).toEqual([]);
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ action: 'approval_progress.sms_request', metadata: { path: ['recipientIds'], array_contains: ['first'] } }),
      take: 60, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    }));
    subject.updatedAt = new Date(subject.updatedAt.getTime() + 1);
    expect(await read('first')).toEqual([]);
    subject.updatedAt = new Date('2026-10-01');
    const assignments = await db.userPosition.findMany();
    db.userPosition.findMany.mockResolvedValue(assignments.filter(row => row.userId !== 'first'));
    expect(await read('first')).toEqual([]);
    db.userPosition.findMany.mockResolvedValue(assignments);
    subject.status = 'approved';
    expect(await read('first')).toEqual([]);
    expect(sms.send).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'unknown'])('供应商%s留痕，同键重试不会自动重发', async status => {
    const { service, sms } = fixture(); sms.send.mockResolvedValue({ status, message: '发送结果待核查' });
    expect((await send(service)).reminders[0].results[0].status).toBe(status);
    await send(service); expect(sms.send).toHaveBeenCalledTimes(1);
  });
  it('确认后节点、人员变化时拒绝新请求且零写入', async () => {
    const { service, subject, sms, logs } = fixture();
    const snapshot = await service.detail(id, 'owner');
    subject.currentNodeIndex = 1; subject.nodes[0].status = '已通过'; subject.nodes[1].status = '处理中';
    await expect(service.remind(id, 'owner', requestId, snapshot.reminderToken)).rejects.toThrow('已变化');
    expect(sms.send).not.toHaveBeenCalled(); expect(logs).toEqual([]);
  });
  it('持久化后实际发送前节点变化时取消本次接收人', async () => {
    const { service, db, subject, sms } = fixture();
    db.$queryRaw.mockImplementationOnce(async () => [{ id: subject.id }]).mockImplementationOnce(async () => { subject.currentNodeIndex = 1; subject.nodes[0].status = '已通过'; subject.nodes[1].status = '处理中'; return [{ id: subject.id }]; });
    const result = await send(service);
    expect(result.reminders[0].results[0].status).toBe('cancelled'); expect(sms.send).not.toHaveBeenCalled();
  });
  it('请求标识不能跨审核对象或跨操作者复用', async () => {
    const { service, logs, sms } = fixture();
    logs.push({ id: requestId, actorUserId: 'owner', action: 'approval_progress.sms_request', businessType: 'approval_progress_reminder', businessId: 'independent:seal_test:other', createdAt: new Date() } as AuditLog);
    await expect(send(service)).rejects.toThrow('已被使用'); expect(sms.send).not.toHaveBeenCalled();
    logs[0].businessId = id; logs[0].actorUserId = 'later';
    await expect(send(service)).rejects.toThrow('已被使用');
  });
  it('锁表不来自用户输入，未列入可信清单时拒绝执行', async () => {
    const { service, subject, db, sms } = fixture();
    subject.lockTargets = [{ table: 'User; DROP TABLE User', id: 'business-1' }];
    await expect(send(service)).rejects.toThrow('锁定');
    expect(db.$queryRaw).not.toHaveBeenCalled(); expect(sms.send).not.toHaveBeenCalled();
  });
  it('未启用短信不写催办记录', async () => {
    const { service, sms, logs } = fixture(); sms.available.mockReturnValue(false);
    await expect(send(service)).rejects.toThrow('短信服务尚未启用'); expect(logs).toEqual([]);
  });
});

it('无权记录再多也只扫描限定批次，游标可继续读取而不跳过有权记录', async () => {
  const { service, subject } = fixture();
  const keys = Array.from({ length: 205 }, (_, index) => `item-${String(index).padStart(4, '0')}`);
  source.listIds.mockImplementation(async (_db, cursor, take = 100) => keys.slice(cursor ? keys.indexOf(cursor) + 1 : 0, (cursor ? keys.indexOf(cursor) + 1 : 0) + take));
  source.load.mockImplementation(async (_db, key) => ({ ...subject, id: key, applicantUserId: key === keys[204] ? 'stranger' : 'owner' }));
  const first = await service.list('stranger');
  expect(first.items).toEqual([]); expect(first.nextCursor).toMatch(/^independent-cursor:/);
  expect(source.load).toHaveBeenCalledTimes(200);
  const second = await service.list('stranger', first.nextCursor!);
  expect(second.items.map(item => item.businessId)).toEqual([keys[204]]); expect(second.nextCursor).toBeNull();
});


it('双部门并行显示状态时仅催办本审核对象的当前节点', async () => {
  const { service, subject } = fixture();
  subject.nodes[1].status = '处理中';
  const detail = await service.detail(id, 'owner');
  expect(detail.pendingRecipients.map(person => person.id)).toEqual(['first']);
  expect(detail.currentNodeName).toBe('综合部主管');
  expect(detail.nodes[1].status).toBe('处理中');
  expect(detail.nodes[1].pending).toEqual([]);
});

it('零采试点未启用时仍可看进度但不能发送催办', async () => {
  const { service, subject, sms, logs } = fixture();
  source.kind = 'receipt_review'; subject.kind = 'receipt_review';
  Object.assign(service, { pilot: { isEnabled: () => false } });
  const receiptId = 'independent:receipt_review:business-1';
  const detail = await service.detail(receiptId, 'owner');
  expect(detail.nodes).toHaveLength(2);
  expect(detail.canRemind).toBe(false);
  expect(detail.pendingRecipients).toEqual([]);
  await expect(service.remind(receiptId, 'owner', requestId, detail.reminderToken)).rejects.toThrow('未启用');
  expect(sms.send).not.toHaveBeenCalled(); expect(logs).toEqual([]);
});


describe('依赖活跃项目的审核资格', () => {
  it('项目停用撤销动态岗位查阅与短信资格，历史处理人仍可回看', async () => {
    const { service, subject, project, sms, logs } = fixture();
    Object.assign(subject, { requiresActiveProject: true });
    const active = await service.detail(id, 'owner');
    expect(active.canRemind).toBe(true);
    project.isActive = false;
    subject.history = [{ actorUserId: 'stranger', action: '退回', comment: null, createdAt: new Date() }];
    await expect(service.detail(id, 'first')).rejects.toThrow('无权查看');
    await expect(service.detail(id, 'later')).rejects.toThrow('无权查看');
    const historical = await service.detail(id, 'stranger');
    expect(historical.nodes).toHaveLength(2);
    expect(historical.pendingRecipients).toEqual([]);
    expect(historical.canRemind).toBe(false);
    expect(historical.reminderUnavailableReason).toContain('项目已停用');
    await expect(service.remind(id, 'owner', requestId, active.reminderToken)).rejects.toThrow('已变化');
    await expect(service.remind(id, 'owner', requestId, historical.reminderToken)).rejects.toThrow('项目已停用');
    expect(sms.send).not.toHaveBeenCalled(); expect(logs).toEqual([]);
  });
  it('停用项目中的冻结人员和明确参与人保留历史查阅，但不恢复接收短信', async () => {
    const { service, subject, project } = fixture();
    Object.assign(subject, { requiresActiveProject: true }); project.isActive = false;
    subject.nodes[0].selectedUserIds = ['first']; subject.participantIds = ['foreign'];
    expect((await service.detail(id, 'first')).pendingRecipients).toEqual([]);
    expect((await service.detail(id, 'foreign')).pendingRecipients).toEqual([]);
  });
  it('未声明活跃项目约束的既有来源保持原审核规则', async () => {
    const { service, project } = fixture(); project.isActive = false;
    expect((await service.detail(id, 'first')).canRemind).toBe(true);
  });
});


it('公司自有资金没有项目，不因活跃项目约束误阻断公司级审核', async () => {
  const { service, subject } = fixture(); subject.projectId = null;
  Object.assign(subject, { requiresActiveProject: true });
  expect((await service.detail(id, 'first')).canRemind).toBe(true);
});

it('未开通账号的入职申请使用业务名称展示，不伪造用户授权', async () => {
  const { service, subject } = fixture(); subject.applicantUserId = '';
  Object.assign(subject, { applicantName: '待入职人员' });
  expect((await service.detail(id, 'first')).applicant).toEqual({ id: '', name: '待入职人员' });
  await expect(service.detail(id, '待入职人员')).rejects.toThrow('无权查看');
});
