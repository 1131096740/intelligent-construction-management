import type { Prisma, ApprovalInstance, Contract, ContractVersion } from "@prisma/client";
import type { PrismaService } from "../database/prisma.service";
import type { ApprovalSmsService } from "../approval/approval-sms.service";
import { ContractDutyNotificationService } from "./contract-duty-notification.service";
import { contractParallelDutyIdentity, hasActiveContractGlobalRole, CONTRACT_PARALLEL_DUTY_RESOURCE, contractParallelDutyId } from "./contract-parallel-duty-access";

jest.mock("./contract-parallel-duty-access", () => ({
  ...jest.requireActual("./contract-parallel-duty-access"),
  contractParallelDutyIdentity: jest.fn(),
  hasActiveContractGlobalRole: jest.fn()
}));

it("同一人员承担两个并联职责分别入队，重复入队保持同一标识，不通知无权人员", async () => {
  jest.mocked(contractParallelDutyIdentity).mockImplementation(async (_tx, _round, _project, actor) =>
    actor === "reviewer" || actor === "delegate" || actor === "late-reviewer" ? { approvedRoleKey: "contract_director", representedUserId: actor, viaAssignment: false, delegationId: null } : null);
  const createMany = jest.fn();
  const groupBy = jest.fn().mockResolvedValue([{ toUserId: "delegate" }, { toUserId: "reviewer" }, { toUserId: "outsider" }]);
  const findMany = jest.fn().mockRejectedValue(new Error("42501 ApprovalDelegation.id"));
  const assignments = jest.fn().mockResolvedValue([{ userId: "reviewer" }, { userId: "outsider" }]);
  const tx = {
    project: { findUnique: jest.fn().mockResolvedValue({ isActive: true, name: "合同项目" }) },
    position: { findMany: jest.fn().mockResolvedValue([{ id: "contract-director" }]) },
    userPosition: { findMany: assignments },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    approvalDelegation: { findMany, groupBy },
    auditLog: { createMany }
  } as unknown as Prisma.TransactionClient;
  const round = { id: "round", status: "in_progress", businessType: "contract_version", businessId: "version", flowType: "contract.approve",
    applicantUserId: "handler", currentNodeIndex: 0, frozenNodes: ["合同主管", "并联合同复核"].map(name => ({
      name, executionMode: "parallel", protocolVersion: 1, mode: "any", roleKeys: ["contract_director"], approvedRoleKeys: []
    })) } as unknown as ApprovalInstance;
  const contract = { id: "contract", projectId: "project", ownerUserId: "handler", code: "HT-01", name: "设备采购合同", companyEntityName: "我方公司", counterparty: "相对方" } as Contract;
  const sms = { available: () => true, sendDutyIntent: jest.fn() } as unknown as ApprovalSmsService;
  const service = new ContractDutyNotificationService({} as PrismaService, sms);
  await service.queue(tx, contract, { id: "version", numericProtocolVersion: 2, signingSubjectType: "our_company", status: "in_approval" }, round, "HT-01");
  await service.queue(tx, contract, { id: "version", numericProtocolVersion: 2, signingSubjectType: "our_company", status: "in_approval" }, round, "HT-01");
  expect(findMany).not.toHaveBeenCalled();
  expect(groupBy).toHaveBeenCalledTimes(4);
  for (const [index, [{ where, by }]] of groupBy.mock.calls.entries()) {
    expect(by).toEqual(["toUserId"]);
    expect(where).toEqual({ enabled: true, actionKey: "contract.approve", resourceType: CONTRACT_PARALLEL_DUTY_RESOURCE,
      resourceId: contractParallelDutyId(round.id, index % 2), startsAt: { lte: expect.any(Date) }, endsAt: { gt: expect.any(Date) } });
    expect(where.startsAt.lte).toBe(where.endsAt.gt);
  }
  expect(createMany).toHaveBeenCalledTimes(2);
  const [first, replay] = createMany.mock.calls.map(([command]) => command);
  expect(first).toEqual(replay);
  expect(first.skipDuplicates).toBe(true);
  expect(first.data.map((row: Prisma.AuditLogCreateManyInput) => row.metadata)).toMatchObject([
    { recipientId: "reviewer", nodeIndex: 0, dutyName: "合同主管" },
    { recipientId: "delegate", nodeIndex: 0, dutyName: "合同主管" },
    { recipientId: "reviewer", nodeIndex: 1, dutyName: "并联合同复核" },
    { recipientId: "delegate", nodeIndex: 1, dutyName: "并联合同复核" }
  ]);
  expect(new Set(first.data.map((row: Prisma.AuditLogCreateManyInput) => row.id)).size).toBe(4);
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();

  const nodes = round.frozenNodes as Prisma.JsonObject[];
  nodes[1].approvedRoleKeys = ["contract_director"];
  assignments.mockResolvedValue([{ userId: "reviewer" }, { userId: "late-reviewer" }]);
  const scoped = {
    ...tx,
    approvalInstance: { findMany: jest.fn().mockResolvedValue([round]) },
    contractVersion: { findUnique: jest.fn().mockResolvedValue({
      id: "version", contractId: "contract", numericProtocolVersion: 2, signingSubjectType: "our_company", status: "in_approval"
    }) },
    contract: { findUnique: jest.fn().mockResolvedValue(contract) }
  } as unknown as Prisma.TransactionClient;
  await service.queueNewApprovalDuties(scoped, "late-reviewer", ["round"]);
  await service.queueNewApprovalDuties(scoped, "late-reviewer", ["round"]);
  const [[late], [lateReplay]] = createMany.mock.calls.slice(2);
  expect(late.skipDuplicates).toBe(true);
  expect(late.data).toHaveLength(1);
  expect(late.data[0]).toMatchObject({ metadata: { recipientId: "late-reviewer", nodeIndex: 0 } });
  expect(lateReplay).toEqual(late);
  expect(sms.sendDutyIntent).not.toHaveBeenCalled();
});

it("最后审批后的盖章和线下盖章后的上传分别入队，模拟供应商在提交后调用，结果未知同一职责不重发", async () => {
  jest.mocked(hasActiveContractGlobalRole).mockImplementation(async (_tx, userId) => userId === "director");
  const now = new Date();
  const round = {
    id: "round", status: "approved", businessType: "contract_version", businessId: "version", flowType: "contract.approve",
    applicantUserId: "handler", currentNodeIndex: 1, frozenNodes: [{
      name: "合同主管", executionMode: "parallel", protocolVersion: 1, mode: "any",
      roleKeys: ["contract_director"], approvedRoleKeys: ["contract_director"]
    }]
  } as unknown as ApprovalInstance;
  const contract = { id: "contract", projectId: "project", ownerUserId: "handler", code: "HT-01", name: "设备采购合同", companyEntityName: "我方公司", counterparty: "相对方" } as Contract;
  const version = { id: "version", contractId: "contract", numericProtocolVersion: 2, signingSubjectType: "our_company", status: "approved_pending_seal" };
  const task = { id: "task", approvalInstanceId: round.id, contractVersionId: version.id, status: "in_seal", handlerUserId: "handler" };
  const rows: Array<{ id: string; metadata: Record<string, string>; createdAt: Date }> = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    project: { findUnique: jest.fn().mockResolvedValue({ isActive: true, name: "合同项目" }) },
    position: { findMany: jest.fn().mockResolvedValue([{ id: "global-director" }]), findUnique: jest.fn().mockResolvedValue(null) },
    userPosition: { findMany: jest.fn().mockResolvedValue([{ userId: "director" }]) },
    projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "member" }) },
    contractVersion: { findUnique: jest.fn().mockImplementation(async () => version) },
    contract: { findUnique: jest.fn().mockResolvedValue(contract) },
    contractSealTask: { findUnique: jest.fn().mockResolvedValue(task) },
    approvalInstance: { findUnique: jest.fn().mockResolvedValue(round) },
    user: { findUnique: jest.fn().mockImplementation(async ({ where }) => ({ isActive: true, name: "经办人", phone: where.id === "handler" ? "13800000001" : "13800000002" })) },
    auditLog: {
      findMany: jest.fn().mockImplementation(async ({ where }) => rows.filter(row => where.id.in.includes(row.id))),
      createMany: jest.fn().mockImplementation(async ({ data }) => {
        const added = data.filter((entry: { id: string }) => !rows.some(row => row.id === entry.id));
        rows.push(...added.map((entry: object) => ({ ...entry, createdAt: now })));
        return { count: added.length };
      })
    }
  };
  let inTransaction = false;
  const prisma = { ...tx, $queryRaw: jest.fn(async () => rows.filter(row => row.metadata.event === "queued")),
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => {
      inTransaction = true;
      try { return await run(tx); } finally { inTransaction = false; }
    } };
  const transactionAtSend: boolean[] = [];
  const send = jest.fn(async () => { transactionAtSend.push(inTransaction); throw new Error("模拟供应商超时"); });
  const service = new ContractDutyNotificationService(prisma as unknown as PrismaService, { available: () => true, sendDutyIntent: send } as unknown as ApprovalSmsService);
  const queue = () => service.queue(tx as unknown as Prisma.TransactionClient, contract, version, round, "HT-01", task);
  await queue();
  expect(rows.map(row => row.metadata.event)).toEqual(["queued"]);
  await service.afterCommit();
  version.status = "seal_approved_pending_archive";
  task.status = "completed";
  await queue();
  await service.afterCommit();
  await service.afterCommit();
  expect(transactionAtSend).toEqual([false, false]);
  expect(send.mock.calls).toEqual([
    ["13800000002", expect.objectContaining({ businessLabel: "合同待办", dutyName: "确认已盖章", businessCode: "HT-01",
      scopeName: "合同项目", initiatorName: "经办人", subject: "设备采购合同", participants: ["我方公司", "相对方"],
      amountText: "金额待确定", targetPath: "/合同管理/HT-01" })],
    ["13800000001", expect.objectContaining({ dutyName: "上传双方签章原件归档", targetPath: "/合同管理/HT-01" })]
  ]);
  expect(rows.filter(row => row.metadata.event === "unknown")).toHaveLength(2);
});

it("真实盖章服务在业务事务中入队，提交后才唤醒派发；事务回滚时不唤醒", async () => {
  const { ContractV2SubmissionService } = await import("./contract-v2-submission.service");
  jest.mocked(hasActiveContractGlobalRole).mockResolvedValue(true);
  const fingerprint = "a".repeat(64);
  const version = {
    id: "version", contractId: "contract", numericProtocolVersion: 2, signingSubjectType: "our_company",
    status: "approved_pending_seal", documentContentRevision: 2, documentContentFingerprint: fingerprint
  };
  const round = {
    id: "round", businessType: "contract_version", businessId: version.id, flowType: "contract.approve",
    status: "approved", applicantUserId: "handler", frozenNodes: [{
      executionMode: "parallel", protocolVersion: 1, mode: "any", roleKeys: ["contract_director"],
      approvedRoleKeys: ["contract_director"], submissionSnapshot: { submissionProtocolVersion: 2,
        contractVersionId: version.id, documentContentRevision: 2, documentContentFingerprint: fingerprint }
    }]
  };
  const task = {
    id: "task", contractVersionId: version.id, approvalInstanceId: round.id, handlerUserId: "handler",
    status: "in_seal", approvedByUserId: "reviewer", approvedAt: new Date()
  };
  const contract = { id: "contract", ownerUserId: "handler", projectId: "project", code: "HT-01" };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    contractVersion: { findUnique: jest.fn().mockResolvedValue(version), update: jest.fn() },
    contract: { findUnique: jest.fn().mockResolvedValue(contract) },
    approvalInstance: { findUnique: jest.fn().mockResolvedValue(round) },
    contractSealTask: { findUnique: jest.fn().mockResolvedValue(task),
      update: jest.fn().mockResolvedValue({ ...task, status: "completed" }) }
  };
  let insideTransaction = false;
  const prisma = { $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => {
    insideTransaction = true;
    try { return await operation(tx); } finally { insideTransaction = false; }
  } };
  const observed: string[] = [];
  const notifications = {
    queue: jest.fn(async () => { observed.push(insideTransaction ? "queued-in-transaction" : "queued-outside"); }),
    afterCommit: jest.fn(async () => { observed.push(insideTransaction ? "dispatch-in-transaction" : "dispatch-after-commit"); })
  };
  const audit = { record: jest.fn() };
  const service = new ContractV2SubmissionService(prisma as never, {} as never, {} as never, {} as never, audit as never, {} as never, notifications as never);
  const confirm = () => service.confirmSeal(version.id, "director", {
    confirmed: true, expectedApprovalInstanceId: round.id, expectedSealTaskId: task.id,
    documentContentRevision: 2, documentContentFingerprint: fingerprint
  });
  await expect(confirm()).resolves.toMatchObject({ status: "seal_approved_pending_archive" });
  expect(observed).toEqual(["queued-in-transaction", "dispatch-after-commit"]);
  expect(notifications.queue).toHaveBeenCalledWith(tx, contract,
    expect.objectContaining({ status: "seal_approved_pending_archive" }), round, "HT-01", expect.objectContaining({ status: "completed" }));
  audit.record.mockRejectedValueOnce(new Error("模拟提交失败"));
  await expect(confirm()).rejects.toThrow("模拟提交失败");
  expect(notifications.afterCommit).toHaveBeenCalledTimes(1);
});

it.each(["approval","seal","archive"] as const)("只重试现阶段本人明确失败的合同短信 (%s)",async stage=>{
  const fingerprint="a".repeat(64);
  const now=new Date();
  const version={id:"version",contractId:"contract",numericProtocolVersion:2,signingSubjectType:"our_company",changeType:"original",
    documentContentRevision:2,documentContentFingerprint:fingerprint,
    status:stage==="approval"?"in_approval":stage==="seal"?"approved_pending_seal":"seal_approved_pending_archive"};
  const contract={id:"contract",projectId:"project",ownerUserId:"handler",code:"HT-02",name:"合成合同"} as Contract;
  const round={id:"round",businessType:"contract_version",businessId:version.id,flowType:"contract.approve",applicantUserId:"handler",
    status:stage==="approval"?"in_progress":"approved",currentNodeIndex:0,frozenNodes:["主职责","并联职责"].map((name,index)=>({
      name,executionMode:"parallel",protocolVersion:1,mode:"any",roleKeys:["contract_director"],
      approvedRoleKeys:stage==="approval"?[]:["contract_director"],
      ...(index===0?{submissionSnapshot:{submissionProtocolVersion:2,contractVersionId:version.id,documentContentRevision:2,
        documentContentFingerprint:fingerprint}}:{})
    }))} as unknown as ApprovalInstance;
  const task={id:"task",approvalInstanceId:round.id,contractVersionId:version.id,status:stage==="seal"?"in_seal":"completed",handlerUserId:"handler",
    approvedByUserId:"approver",approvedAt:now,completedByUserId:"director",completedAt:now};
  const actor=stage==="approval"?"reviewer":stage==="seal"?"director":"handler";
  let authorized=true;
  jest.mocked(contractParallelDutyIdentity).mockImplementation(async (_tx,_round,_project,id)=>
    authorized&&id===actor?{approvedRoleKey:"contract_director",representedUserId:id,viaAssignment:false,delegationId:null}:null);
  jest.mocked(hasActiveContractGlobalRole).mockImplementation(async (_tx,id)=>authorized&&id===actor);
  const archiveAccess=await import("./contract-final-archive-access");
  const archive=jest.spyOn(archiveAccess,"resolveGovernedFinalArchiveAccess")
    .mockImplementation(async()=>({canUpload:authorized} as never));
  type Log={id:string;action:string;businessId:string;metadata:Record<string,unknown>};
  const rows:Log[]=[];
  const tx={
    $queryRaw:jest.fn(async({strings,values}:{strings:string[];values:unknown[]})=>strings.join("").includes("SELECT queued.*")?
      rows.filter(row=>row.action==="queued"&&values.includes(row.metadata.recipientId)&&values.includes(row.metadata.contractVersionId)):[]),
    project:{findUnique:async()=>({isActive:true,name:"合成项目"})},position:{findMany:async()=>[{id:"role"}]},
    userPosition:{findMany:async()=>[{userId:actor}]},projectMember:{findMany:async()=>[]},approvalDelegation:{groupBy:async()=>[]},
    contractVersion:{findUnique:async()=>version},contract:{findUnique:async()=>contract},
    contractSealTask:{findUnique:async()=>task},approvalInstance:{findUnique:async()=>round,findMany:async()=>[{id:round.id}]},
    user:{findUnique:async()=>({isActive:true,name:"合成用户",phone:"13800000000"})},
    auditLog:{
      findMany:async({where}:{where:{id:{in:string[]}}})=>rows.filter(row=>where.id.in.includes(row.id)),
      findUnique:async({where}:{where:{id:string}})=>rows.find(row=>row.id===where.id),
      createMany:async({data}:{data:Log[]})=>{
        const fresh=data.filter(entry=>!rows.some(row=>row.id===entry.id));rows.push(...fresh);
        return {count:fresh.length};
      }
    }
  };
  let serialization:Promise<unknown>=Promise.resolve();
  const prisma={...tx,$queryRaw:async()=>rows.filter(row=>row.action==="queued"),
    $transaction:(run:(client:typeof tx)=>Promise<unknown>)=>{
      const next=serialization.then(()=>run(tx));serialization=next.catch(()=>undefined);return next;
    }};
  const send=jest.fn().mockResolvedValueOnce({status:"failed"}).mockResolvedValue({status:"accepted"});
  const service=new ContractDutyNotificationService(prisma as never,{available:()=>true,sendDutyIntent:send} as never);
  try{
    await service.queue(tx as never,contract,version,round,"HT-02",stage==="approval"?undefined:task);
    await service.afterCommit();
    const own=await service.notificationStatus(version.id,actor);
    expect(own).toHaveLength(stage==="approval"?2:1);
    const failed=own.find(notice=>notice.status==="failed")!;
    expect(failed.canRetry).toBe(true);
    const failedResult=rows.findIndex(row=>row.action==="failed"&&row.metadata.intentId===failed.attemptId);
    const [terminal]=rows.splice(failedResult,1);
    expect((await service.notificationStatus(version.id,actor)).find(notice=>notice.attemptId===failed.attemptId))
      .toMatchObject({status:"unknown",canRetry:false});
    await expect(service.retry(version.id,actor,failed.attemptId)).rejects.toThrow("仅确认发送失败");
    rows.push(terminal);
    if(stage==="approval"){
      const accepted=own.find(notice=>notice.status==="accepted")!;
      await expect(service.retry(version.id,actor,accepted.attemptId)).rejects.toThrow("仅确认发送失败");
    }
    expect(await service.notificationStatus(version.id,"other")).toEqual([]);
    await expect(service.retry(version.id,"other",failed.attemptId)).rejects.toThrow("当前待办");
    authorized=false;
    await expect(service.retry(version.id,actor,failed.attemptId)).rejects.toThrow("当前待办");
    authorized=true;
    version.documentContentFingerprint="b".repeat(64);
    await expect(service.retry(version.id,actor,failed.attemptId)).rejects.toThrow("当前待办");
    version.documentContentFingerprint=fingerprint;
    const wake=jest.spyOn(service,"afterCommit").mockResolvedValue(undefined);
    const [first,second]=await Promise.all([service.retry(version.id,actor,failed.attemptId),service.retry(version.id,actor,failed.attemptId)]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({status:"queued",canRetry:false,dutyName:failed.dutyName});
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith(first.attemptId);
    await expect(service.retry(version.id,actor,first.attemptId)).rejects.toThrow("仅确认发送失败");
    wake.mockRestore();
    await service.afterCommit();
    const replay=await service.retry(version.id,actor,failed.attemptId);
    expect(replay).toMatchObject({attemptId:first.attemptId,status:"accepted",canRetry:false});
    expect(send).toHaveBeenCalledTimes(stage==="approval"?3:2);
    expect(rows.filter(row=>row.metadata.retryOf===failed.attemptId)).toHaveLength(1);
  }finally {archive.mockRestore();}
});

it("合同最终驳回或退回经办人时入队一条修改提醒，重提后取消，失败可重试且不重复派发", async () => {
  const now = new Date();
  const frozenNodes = [{ name: "合同主管", executionMode: "parallel", protocolVersion: 1, mode: "any",
    roleKeys: ["contract_director"], approvedRoleKeys: [] }];
  const round = { id: "round-reject", status: "rejected", businessType: "contract_version", businessId: "version",
    flowType: "contract.approve", applicantUserId: "handler", currentNodeIndex: 0, createdAt: now, updatedAt: now,
    frozenNodes } as unknown as ApprovalInstance;
  const contract = { id: "contract", projectId: "project", ownerUserId: "handler", code: "HT-03",
    name: "设备采购合同", companyEntityName: "我方公司", counterparty: "相对方" } as Contract;
  const version = { id: "version", contractId: "contract", numericProtocolVersion: 2, signingSubjectType: "our_company",
    status: "draft", amountYuan: null, amountLimitType: "capped" } as unknown as ContractVersion & { status: string };
  type Log = { id: string; action: string; businessType?: string; businessId?: string; actorUserId?: string;
    metadata: Record<string, unknown>; createdAt?: Date };
  const rows: Log[] = [];
  const tx = {
    $queryRaw: async () => rows.filter(row => row.action === "queued"),
    project: { findUnique: async () => ({ isActive: true, name: "合同项目" }) },
    contractVersion: { findUnique: async () => version },
    contract: { findUnique: async () => contract },
    approvalInstance: { findUnique: async () => round, findFirst: async () => ({ id: round.id }) },
    user: { findUnique: async () => ({ isActive: true, name: "经办人", phone: "13800000009" }) },
    auditLog: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => rows.filter(row => where.id.in.includes(row.id)),
      findUnique: async ({ where }: { where: { id: string } }) => rows.find(row => row.id === where.id) ?? null,
      createMany: async ({ data }: { data: Log[] }) => {
        const fresh = data.filter(entry => !rows.some(row => row.id === entry.id));
        rows.push(...fresh); return { count: fresh.length };
      }
    }
  };
  let serialization: Promise<unknown> = Promise.resolve();
  const prisma = { ...tx, $queryRaw: async () => rows.filter(row => row.action === "queued"),
    $transaction: (run: (client: typeof tx) => Promise<unknown>) => {
      const next = serialization.then(() => run(tx)); serialization = next.catch(() => undefined); return next;
    } };
  const send = jest.fn().mockResolvedValue({ status: "failed" });
  const service = new ContractDutyNotificationService(prisma as never, { available: () => true, sendDutyIntent: send } as never);

  await service.queueCorrection(tx as never, contract, version, round, "HT-03");
  await service.queueCorrection(tx as never, contract, version, round, "HT-03");
  expect(rows.filter(row => row.action === "queued")).toHaveLength(1);
  expect(rows.find(row => row.action === "queued")?.metadata).toMatchObject({
    stage: "correction", recipientId: "handler", dutyName: "审批退回，请修改后重新提交", businessCode: "HT-03"
  });
  expect(send).not.toHaveBeenCalled();

  await service.afterCommit();
  expect(send).toHaveBeenCalledWith("13800000009", expect.objectContaining({
    businessLabel: "合同退回修改", dutyName: "审批退回，请修改后重新提交", businessCode: "HT-03",
    scopeName: "合同项目", subject: "设备采购合同", targetPath: "/合同管理/HT-03"
  }));
  const [failed] = await service.notificationStatus(version.id, "handler");
  expect(failed).toMatchObject({ status: "failed", canRetry: true });

  send.mockResolvedValue({ status: "accepted" });
  const retried = await service.retry(version.id, "handler", failed.attemptId);
  expect(retried).toMatchObject({ status: "queued", canRetry: false });
  await service.afterCommit(retried.attemptId);
  expect(await service.notificationStatus(version.id, "handler")).toEqual([
    expect.objectContaining({ attemptId: retried.attemptId, status: "accepted", canRetry: false })
  ]);
  expect(send).toHaveBeenCalledTimes(2);
  await expect(service.retry(version.id, "handler", retried.attemptId))
    .rejects.toThrow("仅确认发送失败");

  // 重提后（新轮进行中）已入队但未派发的提醒必须取消，不得再打扰申请人。
  rows.length = 0; send.mockClear();
  rows.push({ id: "queued-pending", action: "queued", businessType: "contract_duty_notification",
    businessId: round.id, actorUserId: "handler",
    metadata: { kind: "contract_v2_inside_duty_notification", event: "queued", stage: "correction", nodeIndex: -1,
      recipientId: "handler", dutyName: "审批退回，请修改后重新提交", businessCode: "HT-03",
      contractVersionId: version.id, sealTaskId: null } });
  version.status = "in_approval"; round.status = "in_progress";
  await service.afterCommit();
  expect(send).not.toHaveBeenCalled();
  expect(rows.some(row => row.action === "cancelled")).toBe(true);
});

it.each(["reject", "return_to_applicant"] as const)("真实合同审批服务在事务内为原申请人入队%s修改提醒，提交后才派发", async decision => {
  const { ContractV2SubmissionService } = await import("./contract-v2-submission.service");
  jest.mocked(contractParallelDutyIdentity).mockResolvedValue({
    approvedRoleKey: "contract_director", representedUserId: "reviewer", viaAssignment: false, delegationId: null
  } as never);
  const now = new Date("2026-11-22T12:00:00.000Z");
  const fingerprint = "b".repeat(64);
  const version = { id: "version", contractId: "contract", numericProtocolVersion: 2, signingSubjectType: "our_company",
    status: "in_approval", changeType: "original", documentContentRevision: 2, documentContentFingerprint: fingerprint,
    updatedAt: now };
  const round = { id: "round", businessType: "contract_version", businessId: version.id, flowType: "contract.approve",
    status: "in_progress", applicantUserId: "handler", currentNodeIndex: 0, updatedAt: now,
    frozenNodes: [{ name: "合同主管", executionMode: "parallel", protocolVersion: 1, mode: "any",
      roleKeys: ["contract_director"], approvedRoleKeys: [], originatorUserIds: ["handler"],
      submissionSnapshot: { submissionProtocolVersion: 2, contractVersionId: version.id,
        documentContentRevision: 2, documentContentFingerprint: fingerprint } }] };
  const contract = { id: "contract", ownerUserId: "handler", projectId: "project", code: "HT-09", voidedAt: null };
  const decisionRow = { id: "decision", action: decision, approvalInstanceId: round.id, actorUserId: "reviewer" };
  const updatedRound = { ...round, status: "rejected", currentNodeIndex: 1 };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    contractVersion: { findUnique: jest.fn().mockResolvedValue(version),
      update: jest.fn().mockResolvedValue({ ...version, status: "draft" }) },
    approvalInstance: { findUnique: jest.fn().mockResolvedValue(round), findMany: jest.fn().mockResolvedValue([round]),
      update: jest.fn().mockResolvedValue(updatedRound) },
    contract: { findUnique: jest.fn().mockResolvedValue(contract) },
    approvalActionLog: { create: jest.fn().mockResolvedValue(decisionRow), updateMany: jest.fn().mockResolvedValue({ count: 0 }) }
  };
  let insideTransaction = false;
  const prisma = { $transaction: async (operation: (client: typeof tx) => Promise<unknown>) => {
    insideTransaction = true;
    try { return await operation(tx); } finally { insideTransaction = false; }
  } };
  const observed: string[] = [];
  const notifications = {
    queueCorrection: jest.fn(async () => { observed.push(insideTransaction ? "queued-in-transaction" : "queued-outside"); }),
    afterCommit: jest.fn(async () => { observed.push(insideTransaction ? "dispatch-in-transaction" : "dispatch-after-commit"); })
  };
  const service = new ContractV2SubmissionService(prisma as never, {} as never, {} as never, {} as never,
    { record: jest.fn() } as never, { confirmPassword: jest.fn() } as never, notifications as never);
  await expect(service.reviewIfV2(version.id, "reviewer", { decision, comment: "请补充资料",
    expectedContractUpdatedAt: now.toISOString(), expectedApprovalInstanceId: round.id, expectedNodeIndex: 0,
    expectedApprovalUpdatedAt: now.toISOString() } as never)).resolves.toMatchObject({ status: "draft" });
  expect(observed).toEqual(["queued-in-transaction", "dispatch-after-commit"]);
  expect(notifications.queueCorrection).toHaveBeenCalledWith(tx, contract,
    expect.objectContaining({ status: "draft" }), expect.objectContaining({ id: round.id, status: "rejected" }), "HT-09");
});
