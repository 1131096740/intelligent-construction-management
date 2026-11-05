import { ApprovalDelegationService } from "./approval-delegation.service";
import { AuditService } from "../audit/audit.service";
import {SPOT_APPROVAL_DUTY_RESOURCE} from "./spot-approval-duty-access";

function fixture(eligible = true) {
  const round = {id: "round-1", businessType: "spot_procurement_version", status: "approval_pending", currentNodeIndex: 0, businessId: "version-1", applicantUserId: "applicant", frozenNodes: [
    {name: "物资主管", mode: "any", roleKeys: ["material_director"], protocolVersion: 1, executionMode: "parallel"},
    {name: "项目经理", mode: "any", roleKeys: ["project_manager"], protocolVersion: 1, executionMode: "parallel"}
  ]};
  const grants = new Map<string, Record<string, unknown>>();
  const db = {
    approvalInstance: {findUnique: async () => round, findMany: async () => [round]},
    spotProcurementVersion: {findUnique: async () => ({id: "version-1", procurementId: "application-1"})},
    spotProcurement: {findUnique: async () => ({id: "application-1", projectId: "project-1", currentVersionId: "version-1", status: "approval_pending", code: "LXCG-001"})},
    project: {findUnique: async () => ({name: "一号项目"})},
    approvalDelegation: {
      create: async ({data}: {data: Record<string, unknown>}) => { const row={id:"mandate-1",enabled:true,...data};grants.set("mandate-1",row);return row; },
      findUnique: async ({where}: {where:{id:string}}) => grants.get(where.id),
      update: async ({where,data}: {where:{id:string};data:Record<string,unknown>}) => {const row={...grants.get(where.id),...data};grants.set(where.id,row);return row;}
    },
    user: {findUnique: async ({where}: {where: {id: string}}) => ({id: where.id, name: "受托人", isActive: true}), findFirst: async () => ({id: "delegate"})},
    userPosition: {findMany: async () => [{userId: "delegate"}]}, projectMember: {findMany: async () => []},
    auditLog: {create: async () => ({})},
    $queryRaw: async (query: {strings: string[]}) => query.strings.join("").includes("WITH members") && eligible ? [{projectId: "project-1", userId: "manager", roleKey: "project_manager", userIsActive: true}] : []
  };
  const prisma = {...db, $transaction: async <T>(work: (tx: typeof db) => Promise<T>) => work(db)};
  return {grants, service: new ApprovalDelegationService(prisma as never, new AuditService(), {visibleProjectIds: async () => ["project-1"]} as never), round};
}
const input = () => ({toUserId: "delegate", startsAt: new Date(Date.now()-1000).toISOString(), endsAt: new Date(Date.now()+3600000).toISOString(), actionKey: "spot_procurement.approve" as const, resourceType: SPOT_APPROVAL_DUTY_RESOURCE, resourceId: "round-1:1"});
it("没有本职责的当前权限不能创建精确委托", async () => {
  const {service} = fixture(false);
  await expect(service.create("manager", input())).rejects.toThrow("当前账号不是该职责的有效审批人");
});
it("未迁入的任意资源作用域不能伪装成新并联委托", async () => {
  const {service}=fixture();
  await expect(service.create("manager", {...input(), resourceType:"unmigrated_business"})).rejects.toThrow("当前不支持该委托作用域");
});
it("仅列出本人仍未办理的具体职责，已办职责不再可委托", async () => {
  const {service,round}=fixture();
  await expect(service.listDutyOptions("manager")).resolves.toEqual([{value:"round-1:1",label:"一号项目 · LXCG-001 · 项目经理"}]);
  Object.assign(round.frozenNodes[1], {approvedRoleKeys:["project_manager"]});
  await expect(service.listDutyOptions("manager")).resolves.toEqual([]);
  await expect(service.create("manager",input())).rejects.toThrow("该审批职责已结束");
});
it("有效原岗位可创建具体职责委托，起止期限必须尚未结束", async () => {
  const {service}=fixture();
  await expect(service.create("manager",input())).resolves.toMatchObject({fromUserId:"manager",toUserId:"delegate",resourceId:"round-1:1"});
  await expect(service.create("manager", {...input(),endsAt:new Date(Date.now()-2000).toISOString()})).rejects.toThrow("委托有效期不正确");
});

it("只有原发起人可撤销精确委托，撤销事实保留并拒绝重复撤销", async () => {
  const {service, grants}=fixture();
  await service.create("manager",input());
  await expect(service.revoke("mandate-1","other-user")).rejects.toThrow("只有委托发起人");
  expect(grants.get("mandate-1")?.enabled).toBe(true);
  await expect(service.revoke("mandate-1","manager")).resolves.toMatchObject({enabled:false});
  await expect(service.revoke("mandate-1","manager")).rejects.toThrow("已撤销");
  expect(grants.size).toBe(1);
});
