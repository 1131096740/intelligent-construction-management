import { BadRequestException } from "@nestjs/common";
import { PermissionImpactService } from "./permission-impact.service";

const EVALUATED_AT = new Date("2026-07-12T02:00:00.000Z");

interface Fixture {
  users: Array<{ id: string; isActive: boolean }>;
  positions: Array<{ id: string; key: string }>;
  userPositions: Array<{ id: string; userId: string; positionId: string; projectId: string | null }>;
  projectMembers: Array<{ id: string; userId: string; projectId: string; positionKey: string }>;
  projects: Array<{ id: string }>;
  instances: Array<{
    id: string;
    businessType: string;
    businessId: string;
    applicantUserId: string;
    currentNodeIndex: number;
    frozenNodes: unknown;
  }>;
  delegations: Array<{
    id: string;
    fromUserId: string;
    toUserId: string;
    startsAt: Date;
    endsAt: Date;
    enabled: boolean;
  }>;
  contractVersions: Array<{ id: string; contractId: string }>;
  contracts: Array<{ id: string; projectId: string }>;
  settlements: Array<{ id: string; projectId: string }>;
  payments: Array<{ id: string; projectId: string }>;
  expenses: Array<{ id: string; projectId: string }>;
}

interface PreviewResult {
  snapshotHash: string;
  canApply: boolean;
  summary: { affectedInstances: number; blockingInstances: number };
  blockingIssues: Array<{ code: string }>;
  impacts: Array<{
    approvalInstanceId: string;
    projectId: string | null;
    pendingRoleKeys: string[];
    blocking: boolean;
    reasonCode: string | null;
    roleCoverage: Array<Record<string, unknown>>;
  }>;
}

function baseFixture(): Fixture {
  return {
    users: [
      { id: "target", isActive: true },
      { id: "other-admin", isActive: true },
      { id: "approver", isActive: true },
      { id: "inactive", isActive: false },
      { id: "applicant", isActive: true }
    ],
    positions: [
      { id: "position-admin", key: "super_admin" },
      { id: "position-manager", key: "project_manager" },
      { id: "position-finance", key: "finance_director" },
      { id: "position-chairman", key: "chairman" }
    ],
    userPositions: [
      { id: "global-target", userId: "target", positionId: "position-admin", projectId: null },
      { id: "global-other", userId: "other-admin", positionId: "position-admin", projectId: null }
    ],
    projectMembers: [
      { id: "member-target", userId: "target", projectId: "project-1", positionKey: "project_manager" }
    ],
    projects: [{ id: "project-1" }, { id: "project-2" }],
    instances: [],
    delegations: [],
    contractVersions: [],
    contracts: [],
    settlements: [],
    payments: [],
    expenses: []
  };
}

function createPrisma(fixture: Fixture) {
  return {
    user: { findMany: jest.fn().mockResolvedValue(fixture.users) },
    position: { findMany: jest.fn().mockResolvedValue(fixture.positions) },
    userPosition: { findMany: jest.fn().mockResolvedValue(fixture.userPositions) },
    projectMember: { findMany: jest.fn().mockResolvedValue(fixture.projectMembers) },
    project: { findMany: jest.fn().mockResolvedValue(fixture.projects) },
    approvalInstance: { findMany: jest.fn().mockResolvedValue(fixture.instances) },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue(fixture.delegations) },
    contractVersion: { findMany: jest.fn().mockResolvedValue(fixture.contractVersions) },
    contract: { findMany: jest.fn().mockResolvedValue(fixture.contracts) },
    settlement: { findMany: jest.fn().mockResolvedValue(fixture.settlements) },
    paymentRequest: { findMany: jest.fn().mockResolvedValue(fixture.payments) },
    projectExpenseRequest: { findMany: jest.fn().mockResolvedValue(fixture.expenses) }
  };
}

async function preview(
  fixture: Fixture,
  input: {
    operation: "remove";
    userId: string;
    scope: "global" | "project";
    projectId?: string | null;
    roleKey:
      | "super_admin"
      | "project_manager"
      | "finance_director"
      | "budget_director"
      | "chairman";
  }
) {
  const prisma = createPrisma(fixture);
  const service = new PermissionImpactService(prisma as never);
  const previewAt = service.previewRoleRemoval as unknown as (
    request: typeof input,
    evaluatedAt: Date
  ) => Promise<PreviewResult>;
  const result = await previewAt.call(service, input, EVALUATED_AT);
  return { prisma, result };
}

describe("PermissionImpactService target resolution", () => {
  it("规范化全局岗位撤销并解析唯一 UserPosition 目标", async () => {
    const { result } = await preview(baseFixture(), {
      operation: "remove",
      userId: " target ",
      scope: "global",
      projectId: null,
      roleKey: "super_admin"
    });

    expect(result).toMatchObject({
      change: { operation: "remove", userId: "target", scope: "global", projectId: null, roleKey: "super_admin" },
      evaluatedAt: EVALUATED_AT.toISOString(),
      canApply: true,
      blockingIssues: [],
      summary: { affectedInstances: 0, blockingInstances: 0 },
      impacts: []
    });
    expect(result.snapshotHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("规范化项目岗位撤销并解析唯一 ProjectMember 目标", async () => {
    const { result } = await preview(baseFixture(), {
      operation: "remove",
      userId: "target",
      scope: "project",
      projectId: " project-1 ",
      roleKey: "project_manager"
    });

    expect(result).toMatchObject({
      change: { operation: "remove", userId: "target", scope: "project", projectId: "project-1", roleKey: "project_manager" },
      canApply: true,
      blockingIssues: []
    });
  });

  it.each([
    ["target_user_missing", (fixture: Fixture) => (fixture.users = fixture.users.filter((row) => row.id !== "target"))],
    ["target_position_missing", (fixture: Fixture) => (fixture.positions = fixture.positions.filter((row) => row.key !== "super_admin"))],
    ["target_assignment_missing", (fixture: Fixture) => (fixture.userPositions = fixture.userPositions.filter((row) => row.id !== "global-target"))]
  ] as const)("目标解析异常 %s 时 fail closed", async (code, mutate) => {
    const fixture = baseFixture();
    mutate(fixture);
    const { result } = await preview(fixture, {
      operation: "remove",
      userId: "target",
      scope: "global",
      roleKey: "super_admin"
    });

    expect(result.canApply).toBe(false);
    expect(result.blockingIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it("项目不存在时 fail closed", async () => {
    const fixture = baseFixture();
    fixture.projects = [];
    const { result } = await preview(fixture, {
      operation: "remove",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });

    expect(result.canApply).toBe(false);
    expect(result.blockingIssues).toContainEqual(expect.objectContaining({ code: "target_project_missing" }));
  });

  it("目标岗位事实重复时拒绝猜测具体记录", async () => {
    const fixture = baseFixture();
    fixture.userPositions.push({ ...fixture.userPositions[0], id: "global-target-duplicate" });
    const { result } = await preview(fixture, {
      operation: "remove",
      userId: "target",
      scope: "global",
      roleKey: "super_admin"
    });

    expect(result.canApply).toBe(false);
    expect(result.blockingIssues).toContainEqual(expect.objectContaining({ code: "target_assignment_ambiguous" }));
  });

  it("拒绝在项目范围撤销 super_admin", async () => {
    const fixture = baseFixture();
    fixture.projectMembers.push({ id: "bad-admin", userId: "target", projectId: "project-1", positionKey: "super_admin" });
    const { result } = await preview(fixture, {
      operation: "remove",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "super_admin"
    });

    expect(result.canApply).toBe(false);
    expect(result.blockingIssues).toContainEqual(expect.objectContaining({ code: "project_super_admin_forbidden" }));
  });

  it("识别项目规范目标的 legacy shadow 且仍保留审批影响计算", async () => {
    const fixture = baseFixture();
    fixture.userPositions.push({ id: "legacy-shadow", userId: "target", positionId: "position-manager", projectId: "project-1" });
    fixture.instances.push({
      id: "approval-1",
      businessType: "settlement",
      businessId: "settlement-1",
      applicantUserId: "applicant",
      currentNodeIndex: 0,
      frozenNodes: [{ name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] }]
    });
    fixture.settlements.push({ id: "settlement-1", projectId: "project-1" });
    const { result } = await preview(fixture, {
      operation: "remove",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });

    expect(result.canApply).toBe(false);
    expect(result.blockingIssues).toContainEqual(expect.objectContaining({ code: "legacy_shadow_assignment" }));
    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0].roleCoverage[0]).toMatchObject({
      targetStillDirectAfter: true,
      directApproverUserIdsAfter: ["target"],
      executable: true
    });
  });

  it("阻止撤销最后一个启用的全局超级管理员", async () => {
    const fixture = baseFixture();
    fixture.users = fixture.users.filter((row) => row.id !== "other-admin");
    fixture.userPositions = fixture.userPositions.filter((row) => row.id !== "global-other");
    const { result } = await preview(fixture, {
      operation: "remove",
      userId: "target",
      scope: "global",
      roleKey: "super_admin"
    });

    expect(result.canApply).toBe(false);
    expect(result.blockingIssues).toContainEqual(expect.objectContaining({ code: "last_active_global_super_admin" }));
  });

  it("全流程只执行批量读取，不使用事务、密码、审计或写方法", async () => {
    const { prisma } = await preview(baseFixture(), {
      operation: "remove",
      userId: "target",
      scope: "global",
      roleKey: "super_admin"
    });

    expect((prisma as Record<string, unknown>).$transaction).toBeUndefined();
    for (const delegate of Object.values(prisma)) {
      expect(Object.keys(delegate)).toEqual(["findMany"]);
    }
  });
});

describe("PermissionImpactService approval impacts", () => {
  function pendingManagerNode(extra: Record<string, unknown> = {}) {
    return {
      name: "项目经理审批",
      mode: "any",
      roleKeys: ["project_manager"],
      ...extra
    };
  }

  function addProjectInstance(
    fixture: Fixture,
    input: {
      id: string;
      businessType: "contract_version" | "settlement" | "payment_request" | "project_expense_request";
      businessId: string;
      projectId?: string;
      applicantUserId?: string;
      node?: unknown;
      currentNodeIndex?: number;
      frozenNodes?: unknown;
    }
  ) {
    const projectId = input.projectId ?? "project-1";
    fixture.instances.push({
      id: input.id,
      businessType: input.businessType,
      businessId: input.businessId,
      applicantUserId: input.applicantUserId ?? "applicant",
      currentNodeIndex: input.currentNodeIndex ?? 0,
      frozenNodes: input.frozenNodes ?? [input.node ?? pendingManagerNode()]
    });
    if (input.businessType === "contract_version") {
      fixture.contractVersions.push({ id: input.businessId, contractId: `contract-${input.id}` });
      fixture.contracts.push({ id: `contract-${input.id}`, projectId });
    } else if (input.businessType === "settlement") {
      fixture.settlements.push({ id: input.businessId, projectId });
    } else if (input.businessType === "payment_request") {
      fixture.payments.push({ id: input.businessId, projectId });
    } else {
      fixture.expenses.push({ id: input.businessId, projectId });
    }
  }

  const projectManagerRemoval = {
    operation: "remove" as const,
    userId: "target",
    scope: "project" as const,
    projectId: "project-1",
    roleKey: "project_manager" as const
  };

  it("批量映射四类审批的 projectId 且不逐实例查询", async () => {
    const fixture = baseFixture();
    addProjectInstance(fixture, { id: "approval-contract", businessType: "contract_version", businessId: "version-1" });
    addProjectInstance(fixture, { id: "approval-settlement", businessType: "settlement", businessId: "settlement-1" });
    addProjectInstance(fixture, { id: "approval-payment", businessType: "payment_request", businessId: "payment-1" });
    addProjectInstance(fixture, { id: "approval-expense", businessType: "project_expense_request", businessId: "expense-1" });

    const { prisma, result } = await preview(fixture, projectManagerRemoval);

    expect(result.impacts.map((impact) => impact.approvalInstanceId)).toEqual([
      "approval-contract",
      "approval-expense",
      "approval-payment",
      "approval-settlement"
    ]);
    expect(result.impacts.every((impact) => impact.projectId === "project-1")).toBe(true);
    expect(prisma.contractVersion.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.settlement.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.paymentRequest.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.projectExpenseRequest.findMany).toHaveBeenCalledTimes(1);
  });

  it("业务记录缺失时返回 fail-closed 阻断 impact", async () => {
    const fixture = baseFixture();
    fixture.instances.push({
      id: "approval-missing-business",
      businessType: "settlement",
      businessId: "missing-settlement",
      applicantUserId: "applicant",
      currentNodeIndex: 0,
      frozenNodes: [pendingManagerNode()]
    });

    const { result } = await preview(fixture, projectManagerRemoval);

    expect(result.impacts).toContainEqual(
      expect.objectContaining({
        approvalInstanceId: "approval-missing-business",
        blocking: true,
        reasonCode: "invalid_approval_instance_data"
      })
    );
    expect(result.canApply).toBe(false);
  });

  it("目标缺失或歧义时不继续伪造审批影响结果", async () => {
    const missing = baseFixture();
    missing.projectMembers = [];
    addProjectInstance(missing, { id: "approval-missing-target", businessType: "settlement", businessId: "settlement-missing-target" });
    expect((await preview(missing, projectManagerRemoval)).result.impacts).toEqual([]);

    const ambiguous = baseFixture();
    ambiguous.projectMembers.push({ ...ambiguous.projectMembers[0], id: "member-target-duplicate" });
    addProjectInstance(ambiguous, { id: "approval-ambiguous-target", businessType: "settlement", businessId: "settlement-ambiguous-target" });
    expect((await preview(ambiguous, projectManagerRemoval)).result.impacts).toEqual([]);
  });

  it("项目撤岗只返回目标项目，全局撤岗可影响多项目", async () => {
    const projectFixture = baseFixture();
    addProjectInstance(projectFixture, { id: "approval-p1", businessType: "settlement", businessId: "settlement-p1", projectId: "project-1" });
    addProjectInstance(projectFixture, { id: "approval-p2", businessType: "settlement", businessId: "settlement-p2", projectId: "project-2" });
    const projectResult = (await preview(projectFixture, projectManagerRemoval)).result;
    expect(projectResult.impacts.map((impact) => impact.approvalInstanceId)).toEqual(["approval-p1"]);

    const globalFixture = baseFixture();
    globalFixture.userPositions.push({ id: "global-manager-target", userId: "target", positionId: "position-manager", projectId: null });
    globalFixture.projectMembers = [];
    addProjectInstance(globalFixture, { id: "approval-global-p1", businessType: "settlement", businessId: "settlement-global-p1", projectId: "project-1" });
    addProjectInstance(globalFixture, { id: "approval-global-p2", businessType: "settlement", businessId: "settlement-global-p2", projectId: "project-2" });
    const globalResult = (
      await preview(globalFixture, {
        operation: "remove",
        userId: "target",
        scope: "global",
        roleKey: "project_manager"
      })
    ).result;
    expect(globalResult.impacts.map((impact) => impact.approvalInstanceId)).toEqual([
      "approval-global-p1",
      "approval-global-p2"
    ]);
  });

  it("其他启用直接审批人可保活，停用人员不计入", async () => {
    const fixture = baseFixture();
    fixture.projectMembers.push(
      { id: "member-approver", userId: "approver", projectId: "project-1", positionKey: "project_manager" },
      { id: "member-inactive", userId: "inactive", projectId: "project-1", positionKey: "project_manager" }
    );
    addProjectInstance(fixture, { id: "approval-1", businessType: "settlement", businessId: "settlement-1" });

    const { result } = await preview(fixture, projectManagerRemoval);
    expect(result.impacts[0]?.roleCoverage[0]).toMatchObject({
      targetStillDirectAfter: false,
      otherDirectApproverUserIds: ["approver"],
      directApproverUserIdsAfter: ["approver"],
      executable: true
    });
    expect(result.summary).toEqual({ affectedInstances: 1, blockingInstances: 0 });
  });

  it("any/all 按 pendingRoleKeys 计算，已审岗位不得再推动流程", async () => {
    const fixture = baseFixture();
    fixture.projectMembers.push({ id: "finance-approver", userId: "approver", projectId: "project-1", positionKey: "finance_director" });
    addProjectInstance(fixture, {
      id: "approval-any",
      businessType: "settlement",
      businessId: "settlement-any",
      node: { name: "任一审批", mode: "any", roleKeys: ["project_manager", "finance_director"] }
    });
    addProjectInstance(fixture, {
      id: "approval-all",
      businessType: "payment_request",
      businessId: "payment-all",
      node: { name: "全部审批", mode: "all", roleKeys: ["project_manager", "finance_director"] }
    });
    addProjectInstance(fixture, {
      id: "approval-approved-target",
      businessType: "contract_version",
      businessId: "version-approved",
      node: {
        name: "已完成项目经理",
        mode: "all",
        roleKeys: ["project_manager", "finance_director"],
        approvedRoleKeys: ["project_manager"]
      }
    });

    const { result } = await preview(fixture, projectManagerRemoval);

    expect(result.impacts.map((impact) => impact.approvalInstanceId)).toEqual([
      "approval-all",
      "approval-any"
    ]);
    expect(result.impacts.find((impact) => impact.approvalInstanceId === "approval-any")).toMatchObject({ blocking: false, reasonCode: null });
    expect(result.impacts.find((impact) => impact.approvalInstanceId === "approval-all")).toMatchObject({
      blocking: true,
      reasonCode: "approval_execution_semantics_not_safe"
    });
  });

  it("多岗位 all 节点无论初始或已有 approvedRoleKeys 均以执行语义不安全阻断", async () => {
    const fixture = baseFixture();
    addProjectInstance(fixture, {
      id: "approval-all-initial",
      businessType: "settlement",
      businessId: "settlement-all-initial",
      node: { name: "多岗位全签", mode: "all", roleKeys: ["project_manager", "finance_director"] }
    });
    addProjectInstance(fixture, {
      id: "approval-all-partial",
      businessType: "payment_request",
      businessId: "payment-all-partial",
      node: {
        name: "多岗位全签已部分审批",
        mode: "all",
        roleKeys: ["project_manager", "finance_director"],
        approvedRoleKeys: ["finance_director"]
      }
    });
    const { result } = await preview(fixture, projectManagerRemoval);
    expect(result.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          approvalInstanceId: "approval-all-initial",
          blocking: true,
          reasonCode: "approval_execution_semantics_not_safe"
        }),
        expect.objectContaining({
          approvalInstanceId: "approval-all-partial",
          blocking: true,
          reasonCode: "approval_execution_semantics_not_safe"
        })
      ])
    );
    expect(result.summary.blockingInstances).toBe(2);
  });

  it("单岗位 all 节点仍按真实可执行人计算", async () => {
    const fixture = baseFixture();
    fixture.projectMembers.push({
      id: "member-approver",
      userId: "approver",
      projectId: "project-1",
      positionKey: "project_manager"
    });
    addProjectInstance(fixture, {
      id: "approval-all-single",
      businessType: "settlement",
      businessId: "settlement-all-single",
      node: pendingManagerNode({ mode: "all" })
    });
    const { result } = await preview(fixture, projectManagerRemoval);
    expect(result.impacts[0]).toMatchObject({ blocking: false, reasonCode: null });
  });

  it.each([
    [
      "普通岗位在前且申请人同时持有领导岗位",
      ["budget_director", "chairman"],
      ["budget_director", "chairman"],
      true,
      []
    ],
    ["申请人仅持有领导岗位", ["budget_director", "chairman"], ["chairman"], false, ["applicant"]],
    ["领导岗位排在前且申请人同时持有两岗", ["chairman", "budget_director"], ["budget_director", "chairman"], false, ["applicant"]]
  ] as const)(
    "%s 时严格按节点顺序选择第一个直接岗位",
    async (_label, roleKeys, applicantRoles, blocking, chairmanUsers) => {
      const fixture = baseFixture();
      fixture.positions.push({ id: "position-budget", key: "budget_director" });
      fixture.projectMembers = [
        { id: "member-target-budget", userId: "target", projectId: "project-1", positionKey: "budget_director" },
        ...applicantRoles.map((positionKey) => ({
          id: `member-applicant-${positionKey}`,
          userId: "applicant",
          projectId: "project-1",
          positionKey
        }))
      ];
      addProjectInstance(fixture, {
        id: "approval-mixed-self-review",
        businessType: "contract_version",
        businessId: "version-mixed-self-review",
        applicantUserId: "applicant",
        node: { name: "混合岗位审批", mode: "any", roleKeys: [...roleKeys] }
      });
      const { result } = await preview(fixture, {
        operation: "remove",
        userId: "target",
        scope: "project",
        projectId: "project-1",
        roleKey: "budget_director"
      });
      expect(result.impacts[0]).toMatchObject({ blocking });
      const chairmanCoverage = result.impacts[0]?.roleCoverage.find(
        (coverage) => coverage.roleKey === "chairman"
      );
      expect(chairmanCoverage).toMatchObject({
        directApproverUserIdsAfter: [...chairmanUsers],
        requiresSelfReviewConfirmation: chairmanUsers.length > 0,
        executable: chairmanUsers.length > 0
      });
    }
  );

  it("用户已有任一直接节点岗位时 assignment 不能覆盖真实 first-role 选择", async () => {
    const fixture = baseFixture();
    fixture.positions.push({ id: "position-budget", key: "budget_director" });
    fixture.projectMembers = [
      { id: "member-target-budget", userId: "target", projectId: "project-1", positionKey: "budget_director" },
      { id: "member-approver-budget", userId: "approver", projectId: "project-1", positionKey: "budget_director" }
    ];
    addProjectInstance(fixture, {
      id: "approval-assignment-priority",
      businessType: "settlement",
      businessId: "settlement-assignment-priority",
      node: {
        name: "直接岗位优先",
        mode: "any",
        roleKeys: ["budget_director", "chairman"],
        assignments: [{ toUserId: "approver", fromRoleKey: "chairman" }]
      }
    });
    const { result } = await preview(fixture, {
      operation: "remove",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "budget_director"
    });
    expect(result.impacts[0]?.roleCoverage.find((coverage) => coverage.roleKey === "budget_director")).toMatchObject({
      directApproverUserIdsAfter: ["approver"],
      executable: true
    });
    expect(result.impacts[0]?.roleCoverage.find((coverage) => coverage.roleKey === "chairman")).toMatchObject({
      assignmentApproverUserIds: [],
      executable: false
    });
  });

  it("申请人不能通过 assignment 或 delegation 形成普通自审通道", async () => {
    const fixture = baseFixture();
    fixture.positions.push({ id: "position-budget", key: "budget_director" });
    fixture.projectMembers = [
      { id: "member-target-budget", userId: "target", projectId: "project-1", positionKey: "budget_director" },
      { id: "member-delegator-budget", userId: "approver", projectId: "project-1", positionKey: "budget_director" }
    ];
    fixture.delegations.push({
      id: "delegation-to-applicant",
      fromUserId: "approver",
      toUserId: "applicant",
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-31T00:00:00.000Z"),
      enabled: true
    });
    addProjectInstance(fixture, {
      id: "approval-indirect-applicant",
      businessType: "payment_request",
      businessId: "payment-indirect-applicant",
      applicantUserId: "applicant",
      node: {
        name: "普通岗位间接自审",
        mode: "any",
        roleKeys: ["budget_director"],
        assignments: [{ toUserId: "applicant", fromRoleKey: "budget_director" }]
      }
    });
    const { result } = await preview(fixture, {
      operation: "remove",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "budget_director"
    });
    expect(result.impacts[0]?.roleCoverage[0]).toMatchObject({
      assignmentApproverUserIds: [],
      delegationApproverUserIds: [],
      executable: true
    });
    expect(result.impacts[0]?.roleCoverage[0]).toMatchObject({
      directApproverUserIdsAfter: ["approver"]
    });
  });

  it("冻结 assignment 独立于撤岗后委托人岗位，但项目支出必须忽略", async () => {
    const fixture = baseFixture();
    const node = pendingManagerNode({ assignments: [{ fromRoleKey: "project_manager", toUserId: "approver" }] });
    addProjectInstance(fixture, { id: "approval-contract", businessType: "contract_version", businessId: "version-1", node });
    addProjectInstance(fixture, { id: "approval-expense", businessType: "project_expense_request", businessId: "expense-1", node });

    const { result } = await preview(fixture, projectManagerRemoval);
    expect(result.impacts.find((impact) => impact.approvalInstanceId === "approval-contract")?.roleCoverage[0]).toMatchObject({
      assignmentApproverUserIds: ["approver"],
      executable: true
    });
    expect(result.impacts.find((impact) => impact.approvalInstanceId === "approval-expense")?.roleCoverage[0]).toMatchObject({
      assignmentApproverUserIds: [],
      executable: false
    });
  });

  it("项目支出对 assignments 字段完全忽略，不因遗留脏数据误判实例无效", async () => {
    const fixture = baseFixture();
    addProjectInstance(fixture, {
      id: "approval-expense-dirty-assignment",
      businessType: "project_expense_request",
      businessId: "expense-dirty-assignment",
      node: pendingManagerNode({ assignments: "legacy-dirty-value" })
    });
    const { result } = await preview(fixture, projectManagerRemoval);
    expect(result.impacts[0]).toMatchObject({
      blocking: true,
      reasonCode: "no_executable_current_approver",
      pendingRoleKeys: ["project_manager"]
    });
    expect(result.impacts[0]?.roleCoverage).toHaveLength(1);
  });

  it("常驻委托随 fromUser 撤岗失效，仍有直接岗位事实时保留", async () => {
    const fixture = baseFixture();
    fixture.delegations.push({
      id: "delegation-target",
      fromUserId: "target",
      toUserId: "approver",
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-31T00:00:00.000Z"),
      enabled: true
    });
    addProjectInstance(fixture, { id: "approval-1", businessType: "payment_request", businessId: "payment-1" });
    let result = (await preview(fixture, projectManagerRemoval)).result;
    expect(result.impacts[0]?.roleCoverage[0]).toMatchObject({ delegationApproverUserIds: [], executable: false });

    fixture.userPositions.push({ id: "global-manager-target", userId: "target", positionId: "position-manager", projectId: null });
    result = (await preview(fixture, projectManagerRemoval)).result;
    expect(result.impacts[0]?.roleCoverage[0]).toMatchObject({ delegationApproverUserIds: ["approver"], executable: true });
  });

  it("委托只批量读取 evaluatedAt 有效集合，项目支出不使用委托", async () => {
    const fixture = baseFixture();
    addProjectInstance(fixture, { id: "approval-expense", businessType: "project_expense_request", businessId: "expense-1" });
    const { prisma, result } = await preview(fixture, projectManagerRemoval);
    expect(prisma.approvalDelegation.findMany).toHaveBeenCalledWith({
      where: { enabled: true, startsAt: { lte: EVALUATED_AT }, endsAt: { gte: EVALUATED_AT } },
      select: expect.any(Object)
    });
    expect(result.impacts[0]?.roleCoverage[0]).toMatchObject({ delegationApproverUserIds: [] });
  });

  it("普通申请人不计可执行人，领导本人直接岗位为条件可执行", async () => {
    const ordinary = baseFixture();
    ordinary.projectMembers[0] = { id: "member-target", userId: "applicant", projectId: "project-1", positionKey: "project_manager" };
    ordinary.userPositions.push({ id: "global-manager-applicant", userId: "applicant", positionId: "position-manager", projectId: null });
    addProjectInstance(ordinary, { id: "approval-ordinary", businessType: "settlement", businessId: "settlement-ordinary", applicantUserId: "applicant" });
    const ordinaryResult = (
      await preview(ordinary, { ...projectManagerRemoval, userId: "applicant" })
    ).result;
    expect(ordinaryResult.impacts[0]?.roleCoverage[0]).toMatchObject({
      targetStillDirectAfter: true,
      directApproverUserIdsAfter: [],
      executable: false
    });

    const leader = baseFixture();
    leader.projectMembers[0] = { id: "member-chairman", userId: "applicant", projectId: "project-1", positionKey: "chairman" };
    leader.userPositions.push({ id: "global-chairman-applicant", userId: "applicant", positionId: "position-chairman", projectId: null });
    addProjectInstance(leader, {
      id: "approval-leader",
      businessType: "contract_version",
      businessId: "version-leader",
      applicantUserId: "applicant",
      node: { name: "领导终审", mode: "any", roleKeys: ["chairman"] }
    });
    const leaderResult = (
      await preview(leader, {
        operation: "remove",
        userId: "applicant",
        scope: "project",
        projectId: "project-1",
        roleKey: "chairman"
      })
    ).result;
    expect(leaderResult.impacts[0]?.roleCoverage[0]).toMatchObject({
      directApproverUserIdsAfter: ["applicant"],
      requiresSelfReviewConfirmation: true,
      executable: true
    });
  });

  it.each([
    ["frozenNodes 非数组", { frozenNodes: {} }],
    ["当前节点越界", { currentNodeIndex: 2 }],
    ["节点名称空白", { node: pendingManagerNode({ name: "   " }) }],
    ["节点 mode 非法", { node: pendingManagerNode({ mode: "some" }) }],
    ["节点岗位非法", { node: pendingManagerNode({ roleKeys: ["root"] }) }],
    ["已审岗位不是当前节点子集", { node: pendingManagerNode({ approvedRoleKeys: ["finance_director"] }) }],
    ["pendingRoleKeys 为空", { node: pendingManagerNode({ approvedRoleKeys: ["project_manager"] }) }],
    ["assignments 字段非法", { node: pendingManagerNode({ assignments: [{ fromRoleKey: "root", toUserId: "approver" }] }) }]
  ] as const)("%s 时 fail closed", async (_label, overrides) => {
    const fixture = baseFixture();
    addProjectInstance(fixture, {
      id: "approval-invalid",
      businessType: "settlement",
      businessId: "settlement-invalid",
      ...overrides
    });
    const { result } = await preview(fixture, projectManagerRemoval);
    expect(result.impacts).toContainEqual(
      expect.objectContaining({
        approvalInstanceId: "approval-invalid",
        blocking: true,
        reasonCode: "invalid_approval_instance_data"
      })
    );
  });
});

describe("PermissionImpactService service-level request constraints", () => {
  it.each([
    [{ operation: "remove", userId: "target", scope: "global", projectId: "project-1", roleKey: "super_admin" }, "全局岗位不得提交项目标识"],
    [{ operation: "remove", userId: "target", scope: "project", roleKey: "project_manager" }, "项目岗位必须提交项目标识"],
    [{ operation: "add", userId: "target", scope: "global", roleKey: "super_admin" }, "只支持预览撤销岗位"]
  ] as const)("%s", async (input, message) => {
    const service = new PermissionImpactService(createPrisma(baseFixture()) as never);
    await expect(service.previewRoleRemoval(input as never, EVALUATED_AT)).rejects.toEqual(
      new BadRequestException(message)
    );
  });
});

describe("PermissionImpactService snapshot hash", () => {
  const input = {
    operation: "remove" as const,
    userId: "target",
    scope: "project" as const,
    projectId: "project-1",
    roleKey: "project_manager" as const
  };

  function hashFixture() {
    const fixture = baseFixture();
    fixture.instances.push({
      id: "approval-1",
      businessType: "settlement",
      businessId: "settlement-1",
      applicantUserId: "applicant",
      currentNodeIndex: 0,
      frozenNodes: [{ name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] }]
    });
    fixture.settlements.push({ id: "settlement-1", projectId: "project-1" });
    fixture.delegations.push({
      id: "delegation-1",
      fromUserId: "target",
      toUserId: "approver",
      startsAt: new Date("2026-07-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-31T00:00:00.000Z"),
      enabled: true
    });
    return fixture;
  }

  it("查询数组顺序不影响 hash，evaluatedAt 本身不进入 hash", async () => {
    const fixture = hashFixture();
    const reversed = hashFixture();
    reversed.users.reverse();
    reversed.positions.reverse();
    reversed.userPositions.reverse();
    reversed.projectMembers.reverse();
    reversed.instances.reverse();
    reversed.delegations.reverse();
    const first = (await preview(fixture, input)).result.snapshotHash;
    const second = (await preview(reversed, input)).result.snapshotHash;
    expect(second).toBe(first);

    const prisma = createPrisma(hashFixture());
    const service = new PermissionImpactService(prisma as never);
    const later = await service.previewRoleRemoval(input, new Date("2026-07-12T03:00:00.000Z"));
    expect(later.snapshotHash).toBe(first);
  });

  it("冻结 roleKeys 顺序变化会改变 hash", async () => {
    const firstFixture = hashFixture();
    const secondFixture = hashFixture();
    firstFixture.instances[0].frozenNodes = [
      { name: "混合岗位", mode: "any", roleKeys: ["project_manager", "finance_director"] }
    ];
    secondFixture.instances[0].frozenNodes = [
      { name: "混合岗位", mode: "any", roleKeys: ["finance_director", "project_manager"] }
    ];
    const first = (await preview(firstFixture, input)).result.snapshotHash;
    const second = (await preview(secondFixture, input)).result.snapshotHash;
    expect(second).not.toBe(first);
  });

  it("同一接收人的冻结 assignments 顺序变化会改变 hash", async () => {
    const firstFixture = hashFixture();
    const secondFixture = hashFixture();
    const firstAssignments = [
      { toUserId: "approver", fromRoleKey: "project_manager" },
      { toUserId: "approver", fromRoleKey: "finance_director" }
    ];
    const secondAssignments = [...firstAssignments].reverse();
    firstFixture.instances[0].frozenNodes = [
      {
        name: "混合指派",
        mode: "any",
        roleKeys: ["project_manager", "finance_director"],
        assignments: firstAssignments
      }
    ];
    secondFixture.instances[0].frozenNodes = [
      {
        name: "混合指派",
        mode: "any",
        roleKeys: ["project_manager", "finance_director"],
        assignments: secondAssignments
      }
    ];
    const first = (await preview(firstFixture, input)).result.snapshotHash;
    const second = (await preview(secondFixture, input)).result.snapshotHash;
    expect(second).not.toBe(first);
  });

  it("目标项目存在性变化会改变 hash，即使当前没有在途实例", async () => {
    const existing = baseFixture();
    const missing = baseFixture();
    missing.projects = missing.projects.filter((project) => project.id !== "project-1");
    const existingHash = (await preview(existing, input)).result.snapshotHash;
    const missingHash = (await preview(missing, input)).result.snapshotHash;
    expect(missingHash).not.toBe(existingHash);
  });

  it.each([
    ["用户启停", (fixture: Fixture) => (fixture.users[2] = { ...fixture.users[2], isActive: false })],
    ["岗位事实", (fixture: Fixture) => fixture.projectMembers.push({ id: "member-extra", userId: "approver", projectId: "project-1", positionKey: "project_manager" })],
    ["固定岗位", (fixture: Fixture) => fixture.positions.push({ id: "position-extra", key: "budget_director" })],
    ["当前节点", (fixture: Fixture) => (fixture.instances[0].frozenNodes = [{ name: "项目经理复核", mode: "any", roleKeys: ["project_manager"] }])],
    ["有效委托", (fixture: Fixture) => (fixture.delegations[0] = { ...fixture.delegations[0], toUserId: "other-admin" })]
  ] as const)("%s 事实变化会改变 hash", async (_label, mutate) => {
    const beforeFixture = hashFixture();
    const afterFixture = hashFixture();
    mutate(afterFixture);
    const before = (await preview(beforeFixture, input)).result.snapshotHash;
    const after = (await preview(afterFixture, input)).result.snapshotHash;
    expect(after).not.toBe(before);
  });
});
