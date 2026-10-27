const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { Test } = require("@nestjs/testing");
const { ValidationPipe } = require("@nestjs/common");
const { IndependentApprovalProgressService } = require("../dist/approval/independent-approval-progress.service");
const { ApprovalProgressService } = require("../dist/approval/approval-progress.service");
const { ApprovalProgressController } = require("../dist/approval/approval-progress.controller");
const { ExpenseClaimService } = require("../dist/expense-claim/expense-claim.service");
const { ExpenseClaimController } = require("../dist/expense-claim/expense-claim.controller");

const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/jiangkong_approval_progress_verify");
assert.equal(process.env.NODE_ENV, "test");
const db = new PrismaClient();
const sent = [];
let outcome = "accepted";
const sms = { available: () => true, send: async (phone) => { sent.push(phone); return { status: outcome, message: outcome === "accepted" ? "短信已提交发送" : "发送结果待确认" }; } };
const independent = new IndependentApprovalProgressService(db, sms);
const progress = new ApprovalProgressService(db, sms, independent);
const claims = new ExpenseClaimService(db, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, progress);
const nodes = [
  { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIdsByRole: { comprehensive_director: ["first"] } },
  { name: "项目经理", mode: "any", roleKeys: ["project_manager"], candidateUserIdsByRole: { project_manager: ["later"] } }
];
let app;

async function fixture(id) {
  const claim = await db.expenseClaim.create({ data: {
    id, code: `BX-${id}`, claimType: "reimbursement", status: "approval_pending", projectId: "project",
    companyEntityId: "company", companyEntityNameSnapshot: "虚构公司", applicantUserId: "owner", applicantNameSnapshot: "申请人",
    handledByUserId: "owner", handledByNameSnapshot: "申请人", reason: "本地合成验收", requestedAmountCents: 15200n
  } });
  await db.approvalInstance.create({ data: { id: `flow-${id}`, flowType: "expense_claim.approve", businessType: "expense_claim", businessId: claim.id, applicantUserId: "owner", status: "in_progress", currentNodeIndex: 0, frozenNodes: nodes } });
  return `flow-${id}`;
}

async function main() {
  await db.project.create({ data: { id: "project", code: "LOCAL-SMS", name: "本地虚构项目" } });
  await db.companyEntity.create({ data: { id: "company", name: "虚构公司" } });
  await db.user.createMany({ data: ["owner", "first", "later", "stranger"].map((id, i) => ({ id, name: id, phone: `1380000000${i}`, isActive: true, mustChangePassword: false })) });
  await db.projectAffiliateAssignment.create({data:{id:'local-construction-enterprise',projectId:'project',businessPartyId:'local-party',businessPartyVersionId:'local-party-version',affiliateNameSnapshot:'本地合成施工企业',effectiveFrom:new Date('2020-01-01T00:00:00.000Z'),changeReason:'数据库测试夹具',assignedByUserId:'owner'}});
  await db.position.createMany({ data: [{ id: "p1", key: "comprehensive_director", name: "综合部主管" }, { id: "p2", key: "project_manager", name: "项目经理" }] });
  await db.userPosition.createMany({ data: [{ userId: "first", positionId: "p1", projectId: null }, { userId: "later", positionId: "p2", projectId: "project" }] });
  const module = await Test.createTestingModule({ controllers: [ApprovalProgressController, ExpenseClaimController], providers: [{ provide: ApprovalProgressService, useValue: progress }, { provide: ExpenseClaimService, useValue: claims }] }).compile();
  app = module.createNestApplication({ logger: false });
  // Test-only identity injection, confined to this loopback test server; production uses the existing JWT guard.
  app.use((req, res, next) => {
    const id = req.headers["x-test-user"];
    if (!["owner", "first", "later", "stranger", "finance-same", "finance-other", "contract-global", "contract-project", "technical", "material", "comprehensive-project"].includes(id)) return res.status(401).json({ message: "未登录" });
    req.user = { id }; next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(path, actor = "later", body) {
    if (body && path.endsWith('/remind') && !body.reminderToken) {
      const current = await request(path.slice(0, -'/remind'.length), actor === 'stranger' ? 'owner' : actor);
      body = { ...body, reminderToken: current.body.reminderToken };
    }
    const response = await fetch(`${base}${path}`, { method: body ? "POST" : "GET", headers: { "x-test-user": actor, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const flow = await fixture("main");
  let result = await request(`/approval-progress/${flow}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.nodes.map(n => n.name), ["综合部主管", "项目经理"]);
  assert.deepEqual(result.body.pendingRecipients.map(p => p.id), ["first"]);
  assert.equal((await request(`/approval-progress/${flow}`, "stranger")).status, 404);
  assert.equal((await request(`/approval-progress/${flow}/remind`, "stranger", { requestId: randomUUID() })).status, 404);
  assert.equal((await request(`/approval-progress/${flow}/remind`, "later", { requestId: "bad" })).status, 400);
  assert.equal(sent.length, 0);
  const list = await request("/expense-claims");
  assert.equal(list.status, 200);
  assert.ok(list.body.some(item => item.id === "main"));
  assert.equal((await request("/expense-claims/main")).status, 200);
  assert.equal((await request("/expense-claims/main", "stranger")).status, 404);
  console.log("PASS HTTP：未轮到者完整进度、费用列表/详情、无关人员拒绝、请求校验");

  const staleFlow = await fixture('stale-recipient');
  const shown = await request(`/approval-progress/${staleFlow}`);
  await db.approvalInstance.update({ where: { id: staleFlow }, data: { currentNodeIndex: 1 } });
  assert.equal((await request(`/approval-progress/${staleFlow}/remind`, 'later', { requestId: randomUUID(), reminderToken: shown.body.reminderToken })).status, 409);
  assert.equal(await db.approvalActionLog.count({ where: { approvalInstanceId: staleFlow } }), 0);
  assert.equal(sent.length, 0);
  console.log('PASS HTTP：确认后节点改变返回冲突，不发送给未确认的新接收人');


  const key = randomUUID();
  const race = await Promise.all([request(`/approval-progress/${flow}/remind`, "later", { requestId: key }), request(`/approval-progress/${flow}/remind`, "later", { requestId: key })]);
  assert.ok(race.every(r => r.status === 201));
  assert.equal(sent.length, 1);
  result = await request(`/approval-progress/${flow}`);
  assert.equal(result.body.reminders[0].results[0].status, "accepted");
  assert.equal((await request(`/approval-progress/${flow}/remind`, "owner", { requestId: randomUUID() })).status, 409);
  assert.equal(sent.length, 1);
  console.log("PASS PostgreSQL：并发同键仅发送一次，其他参与人冷却共享，刷新回读结果");

  const second = await fixture("two-requests");
  const competing = await Promise.all([request(`/approval-progress/${second}/remind`, "later", { requestId: randomUUID() }), request(`/approval-progress/${second}/remind`, "owner", { requestId: randomUUID() })]);
  assert.deepEqual(competing.map(r => r.status).sort(), [201, 409]);
  assert.equal(sent.length, 2);
  console.log("PASS PostgreSQL：不同参与人并发不同键仅一人发送");

  const uncertain = await fixture("uncertain");
  outcome = "unknown";
  const unknownKey = randomUUID();
  await request(`/approval-progress/${uncertain}/remind`, "later", { requestId: unknownKey });
  result = await request(`/approval-progress/${uncertain}/remind`, "later", { requestId: unknownKey });
  assert.equal(result.body.reminders[0].results[0].status, "unknown");
  assert.equal(sent.length, 3);
  console.log("PASS PostgreSQL：发送未知持久化，重试不重发");

  await db.approvalInstance.update({ where: { id: flow }, data: { currentNodeIndex: 1 } });
  result = await request(`/approval-progress/${flow}`, "first");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.pendingRecipients.map(p => p.id), ["later"]);
  await db.approvalInstance.update({ where: { id: flow }, data: { status: "approved", currentNodeIndex: 2 } });
  result = await request(`/approval-progress/${flow}`, "first");
  assert.equal(result.body.canRemind, false);
  assert.equal((await request(`/approval-progress/${flow}/remind`, "first", { requestId: randomUUID() })).status, 409);
  console.log("PASS HTTP：已审批人后续可见、结束回看与催办关闭");
  await verifyIndependent(request);
}

async function verifyIndependent(request) {
  outcome = 'accepted';
  const actors = ['finance-same', 'finance-other', 'contract-global', 'contract-project', 'technical', 'material', 'comprehensive-project'];
  await db.project.create({ data: { id: 'other-project', code: 'OTHER', name: '其他项目' } });
  await db.user.createMany({ data: actors.map((id, i) => ({ id, name: id, phone: `1390000000${i}`, isActive: true, mustChangePassword: false })) });
  await db.position.createMany({ data: [ ['pf','finance_director'],['pc','contract_director'],['pt','super_admin'],['pm','material_director'] ].map(([id,key])=>({id,key,name:key})) });
  await db.userPosition.createMany({ data: [
    {userId:'finance-same',positionId:'pf',projectId:'project'}, {userId:'finance-other',positionId:'pf',projectId:'other-project'},
    {userId:'contract-global',positionId:'pc',projectId:null}, {userId:'contract-project',positionId:'pc',projectId:'project'},
    {userId:'technical',positionId:'pt',projectId:null}, {userId:'material',positionId:'pm',projectId:'project'},
    {userId:'comprehensive-project',positionId:'p1',projectId:'project'}
  ] });
  const id = (kind, raw) => `independent:${kind}:${raw}`;
  const detail = (kind, raw) => `/approval-progress/${encodeURIComponent(id(kind,raw))}`;
  await db.contract.create({ data: {id:'ind-contract', projectId:'project', code:'HT-INDEPENDENT', name:'本地合同', counterparty:'虚构相对方', ownerUserId:'owner'} });
  await db.contractVersion.create({ data: {id:'ind-version',contractId:'ind-contract',versionNo:1,changeType:'original',status:'approved_pending_seal',amountCents:100n,contractGovernanceVersion:1,draftData:{},templateSnapshot:{},clauseSnapshot:{}} });
  await db.approvalInstance.create({ data: {id:'ind-approved-flow',businessType:'contract_version',businessId:'ind-version',flowType:'contract.approve',applicantUserId:'owner',frozenNodes:[],status:'approved',currentNodeIndex:0} });
  await db.contractSealTask.create({ data:{id:'ind-seal-task',contractVersionId:'ind-version',approvalInstanceId:'ind-approved-flow',handlerUserId:'owner',status:'pending_approval'} });
  const seal = await request(detail('contract_seal','ind-version'),'first');
  assert.equal(seal.status,200,JSON.stringify(seal.body));
  assert.deepEqual(seal.body.pendingRecipients.map(p=>p.id),['first']);
  assert.equal((await request(detail('contract_seal','ind-version'),'comprehensive-project')).status,404);
  assert.equal((await request(detail('contract_seal','ind-version'),'technical')).status,404);
  console.log('PASS 独立审核：用章只认公司岗位，项目同名岗位与技术管理员无权');
  await db.contractVersion.create({data:{id:'legacy-sealed',contractId:'ind-contract',versionNo:2,changeType:'original',status:'in_seal',amountCents:100n,draftData:{},templateSnapshot:{},clauseSnapshot:{}}});
  await db.auditLog.createMany({data:[
    {businessType:'contract_version',businessId:'legacy-sealed',action:'contract.seal.approve',actorUserId:'stranger'},
    {businessType:'contract_version',businessId:'legacy-sealed',action:'file.download',actorUserId:'material'}
  ]});
  const historic=await request(detail('contract_seal','legacy-sealed'),'stranger');
  assert.equal(historic.status,200);assert.ok(historic.body.history.some(row=>row.actor.id==='stranger'&&row.action==='同意用章'));
  assert.equal((await request(detail('contract_seal','legacy-sealed'),'material')).status,404);
  console.log('PASS 独立审核：精确历史审核日志恢复离任人员回看，文件访问日志不授予权限');


  await db.employeeProjectLoanAccount.create({data:{id:'ind-account',userId:'owner',projectId:'project',companyEntityId:'company',scopeKey:'project:project',fundedAmountCents:900n,balanceAmountCents:900n}});
  await db.employeeLoanRepayment.create({data:{id:'ind-repayment',loanAccountId:'ind-account',amountCents:20n,repaidAt:new Date(),paymentMethod:'现金',status:'recorded',recordedByUserId:'owner'}});
  const repaymentPath=detail('loan_repayment','ind-repayment');
  const repayment=await request(repaymentPath,'finance-same');
  assert.equal(repayment.status,200,JSON.stringify(repayment.body));
  assert.deepEqual(repayment.body.pendingRecipients.map(p=>p.id),['finance-same']);
  assert.equal((await request(repaymentPath,'finance-other')).status,404);
  assert.equal((await request(repaymentPath,'technical')).status,404);
  const before=sent.length;const key=randomUUID();
  const race=await Promise.all([request(`${repaymentPath}/remind`,'owner',{requestId:key,reminderToken:repayment.body.reminderToken}),request(`${repaymentPath}/remind`,'owner',{requestId:key,reminderToken:repayment.body.reminderToken})]);
  assert.ok(race.every(r=>r.status===201),JSON.stringify(race));assert.equal(sent.length,before+1);
  assert.equal(await db.auditLog.count({where:{id:key,businessType:'approval_progress_reminder',businessId:id('loan_repayment','ind-repayment')}}),1);
  await db.employeeLoanRepayment.update({where:{id:'ind-repayment'},data:{status:'confirmed',confirmedByUserId:'finance-same',confirmedAt:new Date()}});
  assert.equal((await request(`${repaymentPath}/remind`,'owner',{requestId:randomUUID(),reminderToken:repayment.body.reminderToken})).status,409);
  assert.equal(sent.length,before+1);
  console.log('PASS 独立审核：还款项目隔离、审计持久化、并发同键一次发送、终态关闭');

  await db.standardClause.create({data:{id:'ind-clause',code:'LOCAL-CLAUSE',category:'general',name:'本地条款',createdByUserId:'owner'}});
  await db.standardClauseVersion.create({data:{id:'ind-clause-v',clauseId:'ind-clause',versionNo:1,status:'submitted',title:'本地条款',content:{},submittedByUserId:'owner'}});
  assert.equal((await request(detail('standard_clause','ind-clause-v'),'contract-global')).status,200);
  assert.equal((await request(detail('standard_clause','ind-clause-v'),'contract-project')).status,404);
  await db.settlementTemplate.create({data:{id:'ind-st',name:'本地结算模板',code:'LOCAL-ST',createdByUserId:'owner'}});
  await db.fileObject.create({data:{id:'fixture-file',bucket:'local-fixture',objectKey:'template.xlsx',originalName:'本地模板.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',sizeBytes:1,uploadedByUserId:'owner'}});
  await db.settlementTemplateVersion.create({data:{id:'ind-st-v',settlementTemplateId:'ind-st',versionNo:1,status:'submitted',xlsxFileId:'fixture-file',columnSchema:{},printRules:{},evidenceRules:{},anomalyRules:{},submittedByUserId:'owner'}});
  assert.equal((await request(detail('settlement_template','ind-st-v'),'technical')).status,200);
  assert.equal((await request(repaymentPath,'technical')).status,404);
  console.log('PASS 独立审核：技术模板原发布权限有效，不扩成业务审核权限');

  await db.contractTaxFactRevision.create({data:{id:'ind-tax',projectId:'project',contractId:'ind-contract',contractVersionId:'ind-version',revisionNo:1,kind:'supplement',status:'pending_finance_review',rowFacts:[],beforeSnapshot:{},createdByUserId:'owner',submittedByUserId:'owner',submittedAt:new Date()}});
  const taxPath=detail('tax_fact_review','ind-tax');
  const tax=await request(taxPath,'contract-global');
  assert.equal(tax.status,200,JSON.stringify(tax.body));assert.equal(tax.body.nodes.length,2);
  assert.deepEqual(tax.body.pendingRecipients.map(p=>p.id),['finance-same']);
  await db.contractTaxFactRevision.update({where:{id:'ind-tax'},data:{status:'pending_contract_confirmation',financeReviewedByUserId:'finance-same',financeReviewedAt:new Date()}});
  assert.equal((await request(`${taxPath}/remind`,'contract-global',{requestId:randomUUID(),reminderToken:tax.body.reminderToken})).status,409);
  await db.userPosition.deleteMany({where:{userId:'finance-same'}});
  const past=await request(taxPath,'finance-same');assert.equal(past.status,200);
  assert.deepEqual(past.body.pendingRecipients.map(p=>p.id).sort(),['contract-global','contract-project']);
  console.log('PASS 独立审核：未来节点全程可见、角色离任后的处理人回看、节点变化拒绝旧确认');

  await db.expenseClaim.create({data:{id:'ind-loan-a',code:'LOAN-A',claimType:'loan',status:'disbursed',projectId:'project',companyEntityId:'company',companyEntityNameSnapshot:'虚构公司',applicantUserId:'owner',applicantNameSnapshot:'申请人',handledByUserId:'owner',handledByNameSnapshot:'申请人',reason:'本地借款',requestedAmountCents:100n,fundedAmountCents:100n}});
  await db.approvalInstance.create({data:{id:'ind-loan-flow',businessType:'expense_claim',businessId:'ind-loan-a',flowType:'expense_claim.approve',status:'approved',applicantUserId:'owner',currentNodeIndex:1,frozenNodes:[{name:'历史审核',mode:'any',roleKeys:['project_manager'],candidateUserIdsByRole:{project_manager:['later']}}]}});
  await db.employeeProjectLoanEntry.create({data:{loanAccountId:'ind-account',sequenceNo:1n,entryType:'disbursement',amountCents:100n,balanceDeltaCents:100n,sourceExpenseClaimId:'ind-loan-a',voucherFileId:'fixture-file',paymentMethod:'现金',occurredAt:new Date(),createdByUserId:'owner'}});
  const privateDetail=await request('/expense-claims/ind-loan-a','later');assert.equal(privateDetail.status,200);
  assert.equal(privateDetail.body.loanAccount,null);assert.deepEqual(privateDetail.body.loanRepayments,[]);assert.equal(privateDetail.body.loanDisbursements.length,1);
  console.log('PASS HTTP：历史审批资格不会暴露同员工其他借款账户与还款');

  await db.generalProcurement.create({data:{id:'general-main',code:'CG-LOCAL',requestKey:'general-local',creationFingerprint:'synthetic',projectId:'project',companyEntityId:'company',companyNameSnapshot:'虚构公司',applicantUserId:'first',applicantNameSnapshot:'综合主管',category:'office_supplies',reason:'本地综合采购',requestedAmountCents:100n,status:'approval_pending',approvalInstanceId:'general-flow'}});
  await db.approvalInstance.create({data:{id:'general-flow',businessType:'general_procurement',businessId:'general-main',flowType:'general_procurement.approve',applicantUserId:'first',status:'in_progress',currentNodeIndex:0,frozenNodes:nodes}});
  const general=await request('/approval-progress/general-flow','later');
  assert.equal(general.status,200,JSON.stringify(general.body));
  assert.deepEqual(general.body.pendingRecipients.map(p=>p.id),['first']);
  assert.equal((await request('/approval-progress/general-flow','stranger')).status,404);
  await db.generalProcurement.update({where:{id:'general-main'},data:{status:'returned'}});
  assert.equal((await request('/approval-progress/general-flow/remind','later',{requestId:randomUUID(),reminderToken:general.body.reminderToken})).status,409);
  console.log('PASS HTTP：综合采购合法岗位自审可催办，业务状态改变关闭旧审批实例催办');

  await db.position.create({data:{id:'chairman-role',key:'chairman',name:'董事长'}});
  await db.userPosition.create({data:{userId:'contract-global',positionId:'chairman-role',projectId:null}});
  await db.employeeRegistration.create({data:{id:'registration-local',phone:'13700000000',name:'合成申请人',passwordHash:'synthetic-unused',status:'pending'}});
  await db.auditLog.create({data:{businessType:'employee_registration',businessId:'registration-local',action:'employee.registration.refer',actorUserId:'first'}});
  const registrationPath=detail('employee_registration','registration-local');
  const registration=await request(registrationPath,'first');
  assert.equal(registration.status,200,JSON.stringify(registration.body));
  assert.deepEqual(registration.body.pendingRecipients.map(p=>p.id).sort(),['contract-global','first']);
  assert.equal((await request(registrationPath,'comprehensive-project')).status,404);
  assert.equal((await request(registrationPath,'technical')).status,404);
  await db.employeeRegistration.update({where:{id:'registration-local'},data:{status:'chairman_review',reviewedBy:'first'}});
  assert.equal((await request(`${registrationPath}/remind`,'first',{requestId:randomUUID(),reminderToken:registration.body.reminderToken})).status,409);
  const chairmanReview=await request(registrationPath,'first');
  assert.deepEqual(chairmanReview.body.pendingRecipients.map(p=>p.id),['contract-global']);
  console.log('PASS HTTP：入职重新提交恢复初审、公司岗位隔离、转交后仅当前董事长可接收催办');

  let cursor;const all=[];let pages=0;
  do { const page=await request(`/approval-progress${cursor?'?cursor='+encodeURIComponent(cursor):''}`,'owner');assert.equal(page.status,200,JSON.stringify(page.body));all.push(...page.body.items);cursor=page.body.nextCursor;assert.ok(++pages<50); } while(cursor);
  for(const kind of ['contract_seal','loan_repayment','standard_clause','settlement_template','tax_fact_review'])assert.ok(all.some(row=>row.businessType===kind),kind);
  console.log('PASS HTTP：统一列表分页覆盖审批实例与独立审核，所有数据源真实查询可执行');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { if (app) await app.close(); await db.$disconnect(); });
