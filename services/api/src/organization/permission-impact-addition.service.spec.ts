import { PermissionImpactService } from "./permission-impact.service";

const EVALUATED_AT = new Date("2026-07-12T04:00:00.000Z");

interface Fixture {
  users: Array<{ id: string; isActive: boolean }>;
  positions: Array<{ id: string; key: string }>;
  userPositions: Array<{ id: string; userId: string; positionId: string; projectId: string | null }>;
  projectMembers: Array<{ id: string; userId: string; projectId: string; positionKey: string }>;
  projects: Array<{ id: string; isActive: boolean }>;
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

function fixture(): Fixture {
  return {
    users: [
      { id: "target", isActive: true },
      { id: "applicant", isActive: true },
      { id: "finance", isActive: true },
      { id: "inactive", isActive: false }
    ],
    positions: [
      { id: "position-admin", key: "super_admin" },
      { id: "position-manager", key: "project_manager" },
      { id: "position-budget", key: "budget_director" },
      { id: "position-finance", key: "finance_director" },
      { id: "position-engineering-member", key: "engineering_department_member" },
      { id: "position-engineering-director", key: "engineering_department_director" },
      { id: "position-chairman", key: "chairman" }
    ],
    userPositions: [],
    projectMembers: [],
    projects: [
      { id: "project-1", isActive: true },
      { id: "project-2", isActive: true }
    ],
    instances: [],
    delegations: [],
    contractVersions: [],
    contracts: [],
    settlements: [],
    payments: [],
    expenses: []
  };
}

function prisma(data: Fixture) {
  return {
    user: { findMany: jest.fn().mockResolvedValue(data.users) },
    position: { findMany: jest.fn().mockResolvedValue(data.positions) },
    userPosition: { findMany: jest.fn().mockResolvedValue(data.userPositions) },
    projectMember: { findMany: jest.fn().mockResolvedValue(data.projectMembers) },
    project: { findMany: jest.fn().mockResolvedValue(data.projects) },
    approvalInstance: { findMany: jest.fn().mockResolvedValue(data.instances) },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue(data.delegations) },
    contractVersion: { findMany: jest.fn().mockResolvedValue(data.contractVersions) },
    contract: { findMany: jest.fn().mockResolvedValue(data.contracts) },
    settlement: { findMany: jest.fn().mockResolvedValue(data.settlements) },
    paymentRequest: { findMany: jest.fn().mockResolvedValue(data.payments) },
    projectExpenseRequest: { findMany: jest.fn().mockResolvedValue(data.expenses) }
  };
}

function integrity(ready = true) {
  return {
    policy: {
      globalWriteSource: "UserPosition(projectId=null)",
      projectWriteSource: "ProjectMember",
      legacyProjectUserPositionReadCompatibility: true,
      projectSuperAdminAllowed: false
    },
    readiness: { canonicalRoleWritesReady: ready, legacyMigrationReady: ready },
    summary: {
      globalAssignments: 0,
      canonicalProjectAssignments: 0,
      legacyProjectAssignments: 0,
      duplicateGlobalGroups: 0,
      dualSourceOverlaps: 0,
      invalidRoleAssignments: 0,
      orphanAssignments: 0,
      blockingIssues: ready ? 0 : 1,
      warningIssues: 0
    },
    issues: ready
      ? []
      : [
          {
            code: "project_super_admin",
            severity: "blocking",
            source: "project_member",
            assignmentIds: ["bad"],
            message: "bad"
          }
        ]
  };
}

async function evaluate(
  data: Fixture,
  input: {
    operation: "add";
    userId: string;
    scope: "global" | "project";
    projectId?: string | null;
    roleKey:
      | "super_admin"
      | "project_manager"
      | "budget_director"
      | "finance_director"
      | "engineering_department_member"
      | "engineering_department_director"
      | "chairman";
  },
  ready = true
) {
  const client = prisma(data);
  const organization = {
    evaluatePermissionIntegrity: jest.fn().mockResolvedValue(integrity(ready))
  };
  const service = new PermissionImpactService(client as never, organization as never);
  const result = await service.evaluateRoleAddition(client as never, input, EVALUATED_AT);
  return { result, client, organization };
}

function addSettlement(
  data: Fixture,
  input: {
    id: string;
    projectId?: string;
    applicantUserId?: string;
    currentNodeIndex?: number;
    frozenNodes: unknown;
  }
) {
  data.instances.push({
    id: input.id,
    businessType: "settlement",
    businessId: `settlement-${input.id}`,
    applicantUserId: input.applicantUserId ?? "applicant",
    currentNodeIndex: input.currentNodeIndex ?? 0,
    frozenNodes: input.frozenNodes
  });
  data.settlements.push({
    id: `settlement-${input.id}`,
    projectId: input.projectId ?? "project-1"
  });
}

function addProjectExpense(
  data: Fixture,
  input: {
    id: string;
    projectId?: string;
    applicantUserId?: string;
    currentNodeIndex?: number;
    frozenNodes: unknown;
  }
) {
  data.instances.push({
    id: input.id,
    businessType: "project_expense_request",
    businessId: `expense-${input.id}`,
    applicantUserId: input.applicantUserId ?? "applicant",
    currentNodeIndex: input.currentNodeIndex ?? 0,
    frozenNodes: input.frozenNodes
  });
  data.expenses.push({
    id: `expense-${input.id}`,
    projectId: input.projectId ?? "project-1"
  });
}

describe("PermissionImpactService role addition", () => {
  it("合成全局/项目规范事实并返回服务端 create target", async () => {
    const global = await evaluate(fixture(), {
      operation: "add",
      userId: "target",
      scope: "global",
      roleKey: "finance_director"
    });
    expect(global.result.preview).toMatchObject({ canApply: true, blockingIssues: [] });
    expect(global.result.targetCreate).toEqual({
      source: "user_position",
      userId: "target",
      projectId: null,
      roleKey: "finance_director",
      positionId: "position-finance"
    });

    const project = await evaluate(fixture(), {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });
    expect(project.result.preview.canApply).toBe(true);
    expect(project.result.targetCreate).toEqual({
      source: "project_member",
      userId: "target",
      projectId: "project-1",
      roleKey: "project_manager"
    });
  });

  it.each([
    {
      operation: "add" as const,
      userId: "target",
      scope: "global" as const,
      projectId: "project-1",
      roleKey: "finance_director" as const
    },
    {
      operation: "add" as const,
      userId: "target",
      scope: "project" as const,
      roleKey: "project_manager" as const
    }
  ])("拒绝范围与 projectId 不一致的新增坐标", async (input) => {
    await expect(evaluate(fixture(), input)).rejects.toMatchObject({ status: 400 });
  });

  it("允许在干净事实上新增全局 super_admin，但绝不把它合成业务审批 direct fact", async () => {
    const clean = await evaluate(fixture(), {
      operation: "add",
      userId: "target",
      scope: "global",
      roleKey: "super_admin"
    });
    expect(clean.result.preview).toMatchObject({ canApply: true, impacts: [] });
    expect(clean.result.targetCreate).toMatchObject({
      source: "user_position",
      roleKey: "super_admin",
      positionId: "position-admin"
    });

    for (const node of [
      { name: "bad-role", mode: "any", roleKeys: ["super_admin"] },
      {
        name: "bad-approved",
        mode: "all",
        roleKeys: ["project_manager", "super_admin"],
        approvedRoleKeys: ["super_admin"]
      },
      {
        name: "bad-assignment",
        mode: "any",
        roleKeys: ["project_manager"],
        assignments: [{ toUserId: "target", fromRoleKey: "super_admin" }]
      }
    ]) {
      const data = fixture();
      addSettlement(data, { id: `invalid-${node.name}`, frozenNodes: [node] });
      const result = await evaluate(data, {
        operation: "add",
        userId: "target",
        scope: "global",
        roleKey: "super_admin"
      });
      expect(result.result.preview.canApply).toBe(false);
      expect(result.result.preview.impacts[0]).toMatchObject({
        blocking: true,
        reasonCode: "invalid_approval_instance_data",
        targetAfter: { channel: null, roleKey: null }
      });
    }
  });

  it.each([
    ["target_user_missing", (data: Fixture) => { data.users = data.users.filter((row) => row.id !== "target"); }],
    ["target_user_inactive", (data: Fixture) => { data.users.find((row) => row.id === "target")!.isActive = false; }],
    ["target_position_missing", (data: Fixture) => { data.positions = data.positions.filter((row) => row.key !== "project_manager"); }],
    ["target_project_missing", (data: Fixture) => { data.projects = data.projects.filter((row) => row.id !== "project-1"); }],
    ["target_project_inactive", (data: Fixture) => { data.projects.find((row) => row.id === "project-1")!.isActive = false; }],
    ["target_assignment_exists", (data: Fixture) => { data.projectMembers.push({ id: "existing", userId: "target", projectId: "project-1", positionKey: "project_manager" }); }],
    ["legacy_shadow_assignment", (data: Fixture) => { data.userPositions.push({ id: "legacy", userId: "target", positionId: "position-manager", projectId: "project-1" }); }]
  ] as const)("%s 时 fail closed", async (code, mutate) => {
    const data = fixture();
    mutate(data);
    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });
    expect(result.preview.canApply).toBe(false);
    expect(result.preview.blockingIssues).toContainEqual(expect.objectContaining({ code }));
  });

  it("目标重复、project super_admin 或完整性 readiness 未通过时 fail closed", async () => {
    const duplicate = fixture();
    duplicate.projectMembers.push(
      { id: "one", userId: "target", projectId: "project-1", positionKey: "project_manager" },
      { id: "two", userId: "target", projectId: "project-1", positionKey: "project_manager" }
    );
    expect(
      (await evaluate(duplicate, { operation: "add", userId: "target", scope: "project", projectId: "project-1", roleKey: "project_manager" })).result.preview.blockingIssues
    ).toContainEqual(expect.objectContaining({ code: "target_assignment_ambiguous" }));
    expect(
      (await evaluate(fixture(), { operation: "add", userId: "target", scope: "project", projectId: "project-1", roleKey: "super_admin" })).result.preview.blockingIssues
    ).toContainEqual(expect.objectContaining({ code: "project_super_admin_forbidden" }));
    const notReady = await evaluate(
      fixture(),
      { operation: "add", userId: "target", scope: "global", roleKey: "finance_director" },
      false
    );
    expect(notReady.result.preview).toMatchObject({ canApply: false });
    expect(notReady.result.preview.blockingIssues).toContainEqual(
      expect.objectContaining({ code: "canonical_role_writes_not_ready" })
    );
  });

  it("工程技术部成员必须按项目显式加入且已是同项目项目经理", async () => {
    const missingManager = await evaluate(fixture(), {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "engineering_department_member"
    });
    expect(missingManager.result.preview.blockingIssues).toContainEqual(
      expect.objectContaining({ code: "engineering_member_requires_project_manager" })
    );

    const eligible = fixture();
    eligible.projectMembers.push({
      id: "target-manager",
      userId: "target",
      projectId: "project-1",
      positionKey: "project_manager"
    });
    const result = await evaluate(eligible, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "engineering_department_member"
    });
    expect(result.result.preview).toMatchObject({ canApply: true, blockingIssues: [] });
  });

  it("公司工程技术部部长必须来自成员且全公司仅一名启用人员", async () => {
    const eligible = fixture();
    eligible.projectMembers.push(
      { id: "target-manager", userId: "target", projectId: "project-1", positionKey: "project_manager" },
      { id: "target-member", userId: "target", projectId: "project-1", positionKey: "engineering_department_member" }
    );
    expect(
      (await evaluate(eligible, {
        operation: "add",
        userId: "target",
        scope: "global",
        roleKey: "engineering_department_director"
      })).result.preview
    ).toMatchObject({ canApply: true, blockingIssues: [] });

    eligible.userPositions.push({
      id: "existing-director",
      userId: "finance",
      positionId: "position-engineering-director",
      projectId: null
    });
    expect(
      (await evaluate(eligible, {
        operation: "add",
        userId: "target",
        scope: "global",
        roleKey: "engineering_department_director"
      })).result.preview.blockingIssues
    ).toContainEqual(expect.objectContaining({ code: "engineering_director_already_active" }));
  });

  it("全局岗位和项目岗位不能写入错误范围", async () => {
    expect(
      (await evaluate(fixture(), {
        operation: "add",
        userId: "target",
        scope: "project",
        projectId: "project-1",
        roleKey: "finance_director"
      })).result.preview.blockingIssues
    ).toContainEqual(expect.objectContaining({ code: "global_role_scope_required" }));
    expect(
      (await evaluate(fixture(), {
        operation: "add",
        userId: "target",
        scope: "global",
        roleKey: "project_manager"
      })).result.preview.blockingIssues
    ).toContainEqual(expect.objectContaining({ code: "project_role_scope_required" }));
  });

  it("扫描当前到末尾的未完成节点，后续节点 first-role 自审反转也阻断", async () => {
    const data = fixture();
    data.userPositions.push({
      id: "target-chairman",
      userId: "target",
      positionId: "position-chairman",
      projectId: null
    });
    addProjectExpense(data, {
      id: "future-self-review",
      applicantUserId: "target",
      frozenNodes: [
        { name: "当前财务节点", mode: "any", roleKeys: ["finance_director"] },
        { name: "后续混合节点", mode: "any", roleKeys: ["budget_director", "chairman"] }
      ]
    });
    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "global",
      roleKey: "budget_director"
    });
    expect(result.preview.summary).toEqual({ affectedNodes: 1, blockingNodes: 1 });
    expect(result.preview.canApply).toBe(false);
    expect(result.preview.impacts[0]).toMatchObject({
      nodeIndex: 1,
      targetBefore: {
        channel: "direct",
        roleKey: "chairman",
        canReview: true,
        requiresSelfReviewConfirmation: true
      },
      targetAfter: {
        channel: "direct",
        roleKey: "budget_director",
        canReview: false,
        requiresSelfReviewConfirmation: false
      },
      blocking: true,
      reasonCode: "no_executable_current_approver"
    });
  });

  it("即使另有审批人，first-role 自审反转导致目标丧失审批能力仍阻断", async () => {
    const data = fixture();
    data.userPositions.push(
      {
        id: "target-chairman",
        userId: "target",
        positionId: "position-chairman",
        projectId: null
      },
      {
        id: "other-finance",
        userId: "finance",
        positionId: "position-finance",
        projectId: null
      }
    );
    addProjectExpense(data, {
      id: "self-review-capability-regression",
      applicantUserId: "target",
      frozenNodes: [
        {
          name: "混合审批节点",
          mode: "any",
          roleKeys: ["budget_director", "chairman", "finance_director"]
        }
      ]
    });

    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "global",
      roleKey: "budget_director"
    });

    expect(result.preview).toMatchObject({
      canApply: false,
      summary: { affectedNodes: 1, blockingNodes: 1 }
    });
    expect(result.preview.impacts[0]).toMatchObject({
      targetBefore: { roleKey: "chairman", canReview: true },
      targetAfter: { roleKey: "budget_director", canReview: false },
      blocking: true,
      reasonCode: "role_addition_revokes_target_review_capability"
    });
  });

  it("合同审批冻结节点包含非 contract.approve 岗位时失败关闭", async () => {
    const data = fixture();
    data.userPositions.push(
      {
        id: "target-chairman",
        userId: "target",
        positionId: "position-chairman",
        projectId: null
      },
      {
        id: "other-budget",
        userId: "finance",
        positionId: "position-budget",
        projectId: null
      }
    );
    data.instances.push({
      id: "dirty-contract-node",
      businessType: "contract_version",
      businessId: "contract-version-1",
      applicantUserId: "target",
      currentNodeIndex: 0,
      frozenNodes: [
        {
          name: "脏合同审批节点",
          mode: "any",
          roleKeys: ["budget_director", "finance_staff"]
        }
      ]
    });
    data.contractVersions.push({ id: "contract-version-1", contractId: "contract-1" });
    data.contracts.push({ id: "contract-1", projectId: "project-1" });

    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "global",
      roleKey: "budget_director"
    });

    expect(result.preview).toMatchObject({
      canApply: false,
      summary: { affectedNodes: 1, blockingNodes: 1 }
    });
    expect(result.preview.impacts[0]).toMatchObject({
      blocking: true,
      reasonCode: "invalid_approval_instance_data"
    });
  });

  it.each([
    {
      name: "approvedRoleKeys",
      node: {
        name: "脏已审批岗位",
        mode: "any",
        roleKeys: ["chairman"],
        approvedRoleKeys: ["budget_director"]
      }
    },
    {
      name: "assignment.fromRoleKey",
      node: {
        name: "脏转办岗位",
        mode: "any",
        roleKeys: ["chairman"],
        assignments: [{ toUserId: "finance", fromRoleKey: "budget_director" }]
      }
    }
  ])("合同审批冻结 $name 超出动作白名单时失败关闭", async ({ node }) => {
    const data = fixture();
    data.instances.push({
      id: "dirty-contract-detail",
      businessType: "contract_version",
      businessId: "contract-version-detail",
      applicantUserId: "applicant",
      currentNodeIndex: 0,
      frozenNodes: [node]
    });
    data.contractVersions.push({
      id: "contract-version-detail",
      contractId: "contract-detail"
    });
    data.contracts.push({ id: "contract-detail", projectId: "project-1" });

    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "global",
      roleKey: "chairman"
    });

    expect(result.preview).toMatchObject({ canApply: false });
    expect(result.preview.impacts[0]).toMatchObject({
      blocking: true,
      reasonCode: "invalid_approval_instance_data"
    });
  });

  it("无动作岗位且仅有冻结 assignment 的接收人不能兜底执行节点", async () => {
    const data = fixture();
    addSettlement(data, {
      id: "assignment-without-guard-role",
      applicantUserId: "target",
      frozenNodes: [
        {
          name: "无入口授权的转办",
          mode: "any",
          roleKeys: ["project_manager", "finance_director"],
          assignments: [{ toUserId: "finance", fromRoleKey: "finance_director" }]
        }
      ]
    });

    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });

    expect(result.preview).toMatchObject({
      canApply: false,
      summary: { affectedNodes: 1, blockingNodes: 1 }
    });
    expect(result.preview.impacts[0]).toMatchObject({
      blocking: true,
      reasonCode: "no_executable_current_approver"
    });
    expect(result.preview.impacts[0].roleCoverage).toContainEqual(
      expect.objectContaining({
        roleKey: "finance_director",
        assignmentApproverUserIds: [],
        executable: false
      })
    );
  });

  it("目标本人仅有冻结 assignment 且无 Guard 入口资格时 before 不可审批", async () => {
    const data = fixture();
    addSettlement(data, {
      id: "target-assignment-without-guard-role",
      frozenNodes: [
        {
          name: "目标无入口授权的转办",
          mode: "any",
          roleKeys: ["project_manager", "finance_director"],
          assignments: [{ toUserId: "target", fromRoleKey: "finance_director" }]
        }
      ]
    });

    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });

    expect(result.preview.impacts[0]).toMatchObject({
      targetBefore: { channel: null, roleKey: null, canReview: false },
      targetAfter: { channel: "direct", roleKey: "project_manager", canReview: true }
    });
  });

  it("新增节点外动作岗位会解锁目标已有 assignment 并纳入影响", async () => {
    const data = fixture();
    addSettlement(data, {
      id: "assignment-unlocked-by-action-role",
      frozenNodes: [
        {
          name: "财务审批",
          mode: "any",
          roleKeys: ["finance_director"],
          assignments: [{ toUserId: "target", fromRoleKey: "finance_director" }]
        }
      ]
    });

    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });

    expect(result.preview).toMatchObject({
      canApply: true,
      summary: { affectedNodes: 1, blockingNodes: 0 }
    });
    expect(result.preview.impacts[0]).toMatchObject({
      approvalInstanceId: "assignment-unlocked-by-action-role",
      targetBefore: { channel: null, roleKey: null, canReview: false },
      targetAfter: { channel: "assignment", roleKey: "finance_director", canReview: true },
      blocking: false,
      reasonCode: null
    });

    const changedAssignment = structuredClone(data);
    (
      (changedAssignment.instances[0].frozenNodes as Array<Record<string, unknown>>)[0]
        .assignments as Array<Record<string, unknown>>
    ).push({ toUserId: "finance", fromRoleKey: "finance_director" });
    const changed = await evaluate(changedAssignment, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });
    expect(changed.result.preview.snapshotHash).not.toBe(result.preview.snapshotHash);
  });

  it("新增 direct 优先于冻结 assignment 和有效 delegation", async () => {
    const data = fixture();
    data.userPositions.push({ id: "finance-role", userId: "finance", positionId: "position-finance", projectId: null });
    data.delegations.push({
      id: "delegation",
      fromUserId: "finance",
      toUserId: "target",
      startsAt: new Date("2026-07-12T00:00:00.000Z"),
      endsAt: new Date("2026-07-13T00:00:00.000Z"),
      enabled: true
    });
    addSettlement(data, {
      id: "assignment",
      frozenNodes: [
        {
          name: "assignment",
          mode: "any",
          roleKeys: ["project_manager", "finance_director"],
          assignments: [{ toUserId: "target", fromRoleKey: "finance_director" }]
        },
        {
          name: "delegation",
          mode: "any",
          roleKeys: ["project_manager", "finance_director"]
        }
      ]
    });
    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });
    expect(result.preview.canApply).toBe(true);
    expect(result.preview.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeIndex: 0,
          targetBefore: expect.objectContaining({ channel: "assignment", roleKey: "finance_director" }),
          targetAfter: expect.objectContaining({ channel: "direct", roleKey: "project_manager" })
        }),
        expect.objectContaining({
          nodeIndex: 1,
          targetBefore: expect.objectContaining({ channel: "delegation", roleKey: "finance_director" }),
          targetAfter: expect.objectContaining({ channel: "direct", roleKey: "project_manager" })
        })
      ])
    );
  });

  it("停用委托人不会让受托人在岗位新增前获得节点权限", async () => {
    const data = fixture();
    data.userPositions.push({
      id: "inactive-finance-role",
      userId: "inactive",
      positionId: "position-finance",
      projectId: null
    });
    data.delegations.push({
      id: "inactive-from-delegation",
      fromUserId: "inactive",
      toUserId: "target",
      startsAt: new Date("2026-07-12T00:00:00.000Z"),
      endsAt: new Date("2026-07-13T00:00:00.000Z"),
      enabled: true
    });
    addSettlement(data, {
      id: "inactive-from-delegation",
      frozenNodes: [
        {
          name: "停用委托人节点",
          mode: "any",
          roleKeys: ["project_manager", "finance_director"]
        }
      ]
    });

    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });

    expect(result.preview.impacts[0]).toMatchObject({
      targetBefore: { channel: null, roleKey: null, canReview: false },
      targetAfter: { channel: "direct", roleKey: "project_manager", canReview: true }
    });
  });

  it("停用受托人不进入岗位新增的节点解析", async () => {
    const data = fixture();
    data.users.find((user) => user.id === "target")!.isActive = false;
    data.userPositions.push({
      id: "finance-role",
      userId: "finance",
      positionId: "position-finance",
      projectId: null
    });
    data.delegations.push({
      id: "inactive-to-delegation",
      fromUserId: "finance",
      toUserId: "target",
      startsAt: new Date("2026-07-12T00:00:00.000Z"),
      endsAt: new Date("2026-07-13T00:00:00.000Z"),
      enabled: true
    });
    addSettlement(data, {
      id: "inactive-to-delegation",
      frozenNodes: [
        {
          name: "停用受托人节点",
          mode: "any",
          roleKeys: ["project_manager", "finance_director"]
        }
      ]
    });

    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });

    expect(result.targetCreate).toBeNull();
    expect(result.preview.blockingIssues).toContainEqual(
      expect.objectContaining({ code: "target_user_inactive" })
    );
    expect(result.preview.impacts).toEqual([]);
  });

  it("项目支出节点继续忽略 assignment/delegation，只计新增后 direct", async () => {
    const data = fixture();
    data.userPositions.push({ id: "finance-role", userId: "finance", positionId: "position-finance", projectId: null });
    data.delegations.push({
      id: "delegation",
      fromUserId: "finance",
      toUserId: "target",
      startsAt: new Date("2026-07-12T00:00:00.000Z"),
      endsAt: new Date("2026-07-13T00:00:00.000Z"),
      enabled: true
    });
    data.instances.push({
      id: "expense",
      businessType: "project_expense_request",
      businessId: "expense-1",
      applicantUserId: "applicant",
      currentNodeIndex: 0,
      frozenNodes: [
        {
          name: "expense",
          mode: "any",
          roleKeys: ["project_manager", "finance_director"],
          assignments: [{ toUserId: "target", fromRoleKey: "finance_director" }]
        }
      ]
    });
    data.expenses.push({ id: "expense-1", projectId: "project-1" });
    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });
    expect(result.preview.canApply).toBe(true);
    expect(result.preview.impacts[0]).toMatchObject({
      targetBefore: { channel: null, roleKey: null },
      targetAfter: { channel: "direct", roleKey: "project_manager" }
    });
  });

  it.each([
    ["malformed", { legacy: "not-an-array" }],
    [
      "非法岗位",
      [{ toUserId: "target", fromRoleKey: "super_admin" }]
    ]
  ])("项目支出无条件忽略 %s assignment", async (_label, assignments) => {
    const data = fixture();
    addProjectExpense(data, {
      id: `ignored-${_label}`,
      frozenNodes: [
        {
          name: "expense",
          mode: "any",
          roleKeys: ["project_manager", "finance_director"],
          assignments
        }
      ]
    });

    const { result } = await evaluate(data, {
      operation: "add",
      userId: "target",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    });

    expect(result.preview).toMatchObject({ canApply: true });
    expect(result.preview.impacts[0]).toMatchObject({
      blocking: false,
      targetAfter: { channel: "direct", roleKey: "project_manager" }
    });
  });

  it("多岗位 all、非法业务映射和 super_admin 冻结节点统一 fail closed", async () => {
    const all = fixture();
    addSettlement(all, {
      id: "all",
      frozenNodes: [{ name: "all", mode: "all", roleKeys: ["project_manager", "finance_director"] }]
    });
    const allResult = await evaluate(all, { operation: "add", userId: "target", scope: "project", projectId: "project-1", roleKey: "project_manager" });
    expect(allResult.result.preview).toMatchObject({ canApply: false });
    expect(allResult.result.preview.impacts[0]).toMatchObject({ reasonCode: "approval_execution_semantics_not_safe" });

    const missingBusiness = fixture();
    missingBusiness.instances.push({
      id: "missing",
      businessType: "settlement",
      businessId: "missing",
      applicantUserId: "applicant",
      currentNodeIndex: 0,
      frozenNodes: [{ name: "missing", mode: "any", roleKeys: ["project_manager"] }]
    });
    expect((await evaluate(missingBusiness, { operation: "add", userId: "target", scope: "global", roleKey: "project_manager" })).result.preview.canApply).toBe(false);

    const invalidAdminNode = fixture();
    addSettlement(invalidAdminNode, {
      id: "admin-node",
      frozenNodes: [{ name: "bad", mode: "any", roleKeys: ["super_admin"] }]
    });
    const adminResult = await evaluate(invalidAdminNode, { operation: "add", userId: "target", scope: "global", roleKey: "super_admin" });
    expect(adminResult.result.preview.canApply).toBe(false);
    expect(adminResult.result.preview.impacts[0]).toMatchObject({ reasonCode: "invalid_approval_instance_data" });
  });

  it("全局新增跨所有项目，项目新增只扫目标项目，且先并集再按冻结顺序选岗", async () => {
    const data = fixture();
    data.userPositions.push({ id: "chairman", userId: "target", positionId: "position-chairman", projectId: null });
    data.projectMembers.push({ id: "budget-p1", userId: "target", projectId: "project-1", positionKey: "budget_director" });
    addProjectExpense(data, { id: "p1", projectId: "project-1", frozenNodes: [{ name: "p1", mode: "any", roleKeys: ["budget_director", "chairman", "finance_director", "project_manager"] }] });
    addProjectExpense(data, { id: "p2", projectId: "project-2", frozenNodes: [{ name: "p2", mode: "any", roleKeys: ["chairman", "finance_director"] }] });

    const global = await evaluate(data, { operation: "add", userId: "target", scope: "global", roleKey: "finance_director" });
    expect(global.result.preview.impacts.map((row) => row.approvalInstanceId)).toEqual(["p1", "p2"]);
    expect(global.result.preview.impacts.find((row) => row.approvalInstanceId === "p1")?.targetBefore).toMatchObject({ roleKey: "budget_director" });

    const project = await evaluate(data, { operation: "add", userId: "target", scope: "project", projectId: "project-1", roleKey: "project_manager" });
    expect(project.result.preview.impacts.map((row) => row.approvalInstanceId)).toEqual(["p1"]);
  });

  it("查询返回顺序和 evaluatedAt 不改变 hash，后续冻结节点事实改变会改变 hash", async () => {
    const data = fixture();
    addSettlement(data, {
      id: "hash",
      frozenNodes: [
        { name: "current", mode: "any", roleKeys: ["finance_director"] },
        { name: "future", mode: "any", roleKeys: ["project_manager", "finance_director"] }
      ]
    });
    addSettlement(data, {
      id: "another-hash",
      frozenNodes: [
        { name: "another-current", mode: "any", roleKeys: ["project_manager", "finance_director"] }
      ]
    });
    const input = { operation: "add" as const, userId: "target", scope: "project" as const, projectId: "project-1", roleKey: "project_manager" as const };
    const first = await evaluate(data, input);
    const reversed = structuredClone(data);
    reversed.users.reverse();
    reversed.positions.reverse();
    reversed.projects.reverse();
    reversed.instances.reverse();
    reversed.settlements.reverse();
    const second = await evaluate(reversed, input);
    expect(second.result.preview.snapshotHash).toBe(first.result.preview.snapshotHash);

    const changed = structuredClone(data);
    (changed.instances[0].frozenNodes as Array<Record<string, unknown>>)[1].roleKeys = ["finance_director", "project_manager"];
    const third = await evaluate(changed, input);
    expect(third.result.preview.snapshotHash).not.toBe(first.result.preview.snapshotHash);
  });
});
