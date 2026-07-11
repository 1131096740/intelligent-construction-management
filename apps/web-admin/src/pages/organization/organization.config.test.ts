import { describe, expect, it } from "vitest";
import type {
  OrganizationDirectory,
  OrganizationDepartmentNode,
  OrganizationDirectoryUser,
  PermissionIntegrityIssue,
  PermissionIntegrityReadModel,
  RoleAdditionImpactPreview,
  RoleRemovalImpactPreview
} from "../../api/organization.api";
import {
  activeOrganizationProjectOptions,
  buildOrganizationRoleAdditionTarget,
  buildRoleAdditionApplyPayload,
  buildOrganizationRoleRemovalTargets,
  buildProjectSuperAdminRemediationTarget,
  isProjectSuperAdminRemediationIssue,
  mergeOrganizationRoleRemovalTargets,
  buildRoleRemovalApplyPayload,
  buildCreateDepartmentPayload,
  buildDepartmentParentOptions,
  buildDepartmentPatch,
  buildUserPatch,
  departmentStatusText,
  filterOrganizationUsers,
  flattenDepartmentTree,
  globalPositionsText,
  mustChangePasswordText,
  organizationActionConsequence,
  permissionIntegrityIssueLabel,
  permissionIntegrityPolicyText,
  permissionIntegrityReadinessTag,
  permissionIntegritySourceLabel,
  permissionIntegritySummaryItems,
  permissionIntegrityIssueRows,
  roleRemovalBusinessTypeLabel,
  roleRemovalImpactRows,
  roleRemovalReasonLabel,
  roleRemovalTargetMatchesPreview,
  canConfirmRoleRemoval,
  canConfirmRoleAddition,
  projectPositionsText,
  organizationRoleAdditionOptions,
  roleAdditionImpactRows,
  roleAdditionTargetMatchesPreview,
  userStatusText
} from "./organization.config";

const departments: OrganizationDepartmentNode[] = [
  {
    id: "root",
    name: "总部",
    parentId: null,
    isActive: true,
    children: [
      {
        id: "contract",
        name: "合同部",
        parentId: "root",
        isActive: true,
        children: [
          {
            id: "contract-a",
            name: "合同一组",
            parentId: "contract",
            isActive: true,
            children: []
          }
        ]
      },
      {
        id: "closed",
        name: "停用部门",
        parentId: "root",
        isActive: false,
        children: []
      }
    ]
  }
];

const users: OrganizationDirectoryUser[] = [
  {
    id: "user-1",
    name: "张三",
    phone: "13800000001",
    departmentId: "contract",
    departmentName: "合同部",
    status: "active",
    mustChangePassword: false,
    globalPositions: [{ key: "contract_director", name: "合同总监" }],
    projectPositions: [
      {
        projectId: "project-1",
        projectCode: "XM-001",
        projectName: "科技园项目",
        keys: ["project_manager"],
        names: ["项目经理"]
      }
    ]
  },
  {
    id: "user-2",
    name: "李四",
    phone: "13800000002",
    departmentId: null,
    departmentName: "未分配部门",
    status: "inactive",
    mustChangePassword: true,
    globalPositions: [],
    projectPositions: []
  }
];

const permissionIntegrity: PermissionIntegrityReadModel = {
  policy: {
    globalWriteSource: "UserPosition(projectId=null)",
    projectWriteSource: "ProjectMember",
    legacyProjectUserPositionReadCompatibility: true,
    projectSuperAdminAllowed: false
  },
  readiness: {
    canonicalRoleWritesReady: false,
    legacyMigrationReady: true
  },
  summary: {
    globalAssignments: 2,
    canonicalProjectAssignments: 3,
    legacyProjectAssignments: 4,
    duplicateGlobalGroups: 1,
    dualSourceOverlaps: 2,
    invalidRoleAssignments: 0,
    orphanAssignments: 0,
    blockingIssues: 3,
    warningIssues: 4
  },
  issues: [
    {
      code: "dual_source_project_role",
      severity: "blocking",
      source: "user_position",
      assignmentIds: ["legacy-1", "member-1"],
      userId: "user-1",
      projectId: "project-1",
      roleKey: "project_manager",
      message: "同一项目岗位同时存在于 UserPosition 和 ProjectMember"
    },
    {
      code: "legacy_project_user_position",
      severity: "warning",
      source: "user_position",
      assignmentIds: [],
      message: "检测到项目级 UserPosition 遗留岗位事实"
    }
  ]
};

const removalPreview: RoleRemovalImpactPreview = {
  change: {
    operation: "remove",
    userId: "user-1",
    scope: "project",
    projectId: "project-1",
    roleKey: "project_manager"
  },
  evaluatedAt: "2026-07-12T08:00:00.000Z",
  snapshotHash: `sha256:${"a".repeat(64)}`,
  canApply: true,
  summary: { affectedInstances: 1, blockingInstances: 0 },
  blockingIssues: [],
  impacts: [
    {
      approvalInstanceId: "approval-1",
      businessType: "payment_request",
      businessId: "payment-1",
      projectId: "project-1",
      currentNodeIndex: 1,
      currentNodeName: "项目经理审批",
      mode: "any",
      pendingRoleKeys: ["project_manager"],
      blocking: false,
      reasonCode: null,
      roleCoverage: []
    }
  ]
};

const additionDirectory: OrganizationDirectory = {
  summary: { departments: 1, activeUsers: 1, inactiveUsers: 1, positions: 5 },
  departments,
  users,
  projects: [
    { id: "project-2", code: "XM-002", name: "商务中心", isActive: true },
    { id: "project-3", code: "XM-003", name: "停用项目", isActive: false },
    { id: "project-1", code: "XM-001", name: "科技园项目", isActive: true }
  ],
  positions: [
    { id: "position-1", key: "contract_director", name: "合同部主管" },
    { id: "position-2", key: "project_manager", name: "项目经理" },
    { id: "position-3", key: "budget_director", name: "预算部主管" },
    { id: "position-4", key: "finance_director", name: "财务主管" },
    { id: "position-5", key: "super_admin", name: "系统管理员" }
  ]
};

const additionPreview: RoleAdditionImpactPreview = {
  change: {
    operation: "add",
    userId: "user-1",
    scope: "project",
    projectId: "project-2",
    roleKey: "project_manager"
  },
  evaluatedAt: "2026-07-12T08:00:00.000Z",
  snapshotHash: `sha256:${"b".repeat(64)}`,
  canApply: true,
  summary: { affectedNodes: 1, blockingNodes: 0 },
  blockingIssues: [],
  impacts: [
    {
      approvalInstanceId: "approval-1",
      businessType: "payment_request",
      businessId: "payment-1",
      projectId: "project-2",
      nodeIndex: 1,
      nodeName: "项目经理审批",
      mode: "any",
      roleKeys: ["project_manager"],
      pendingRoleKeys: ["project_manager"],
      blocking: false,
      reasonCode: null,
      targetBefore: {
        channel: null,
        roleKey: null,
        canReview: false,
        requiresSelfReviewConfirmation: false
      },
      targetAfter: {
        channel: "direct",
        roleKey: "project_manager",
        canReview: true,
        requiresSelfReviewConfirmation: true
      },
      roleCoverage: []
    }
  ]
};

describe("organization config", () => {
  it("flattens the department tree with depth, parent and full path", () => {
    expect(flattenDepartmentTree(departments)).toEqual([
      expect.objectContaining({ id: "root", depth: 0, parentName: "—", path: "总部" }),
      expect.objectContaining({ id: "contract", depth: 1, parentName: "总部", path: "总部 / 合同部" }),
      expect.objectContaining({
        id: "contract-a",
        depth: 2,
        parentName: "合同部",
        path: "总部 / 合同部 / 合同一组"
      }),
      expect.objectContaining({ id: "closed", depth: 1, parentName: "总部", path: "总部 / 停用部门" })
    ]);
  });

  it("outputs a malformed duplicate department only once", () => {
    const duplicate = departments[0].children[0];
    expect(flattenDepartmentTree([departments[0], duplicate]).filter((item) => item.id === "contract")).toHaveLength(1);
  });

  it("builds enabled parent options and excludes the edited department and every descendant", () => {
    expect(buildDepartmentParentOptions(departments, "contract")).toEqual([
      { label: "总部", value: "root" }
    ]);
    expect(buildDepartmentParentOptions(departments).map((option) => option.value)).toEqual([
      "root",
      "contract",
      "contract-a"
    ]);
  });

  it.each([
    [{ keyword: "张三" }, ["user-1"]],
    [{ keyword: "13800000002" }, ["user-2"]],
    [{ departmentId: "contract" }, ["user-1"]],
    [{ status: "inactive" }, ["user-2"]],
    [{ keyword: "合同总监" }, ["user-1"]],
    [{ keyword: "科技园" }, ["user-1"]],
    [{ keyword: "项目经理" }, ["user-1"]]
  ] as const)("filters organization users with %o", (filters, expectedIds) => {
    expect(filterOrganizationUsers(users, filters).map((user) => user.id)).toEqual(expectedIds);
  });

  it("formats status, password and read-only position labels", () => {
    expect(departmentStatusText(true)).toBe("启用");
    expect(departmentStatusText(false)).toBe("停用");
    expect(userStatusText("active")).toBe("启用");
    expect(userStatusText("inactive")).toBe("停用");
    expect(mustChangePasswordText(true)).toBe("待首次改密");
    expect(mustChangePasswordText(false)).toBe("已完成");
    expect(globalPositionsText(users[0])).toBe("合同总监");
    expect(globalPositionsText(users[1])).toBe("无");
    expect(projectPositionsText(users[0])).toBe("科技园项目：项目经理");
    expect(projectPositionsText(users[1])).toBe("无");
  });

  it("builds a trimmed create payload while preserving password whitespace", () => {
    expect(
      buildCreateDepartmentPayload({
        name: "  合同部  ",
        parentId: null,
        confirmationPassword: "  current password  "
      })
    ).toEqual({
      name: "合同部",
      parentId: null,
      confirmationPassword: "  current password  "
    });
  });

  it("enforces Unicode code-point limits for department name and password", () => {
    expect(
      buildCreateDepartmentPayload({
        name: "❤️".repeat(50),
        parentId: null,
        confirmationPassword: "secret"
      }).name
    ).toBe("❤️".repeat(50));
    expect(() =>
      buildCreateDepartmentPayload({
        name: `${"❤️".repeat(50)}门`,
        parentId: null,
        confirmationPassword: "secret"
      })
    ).toThrow("部门名称不能超过 100 个字符");
    expect(() =>
      buildCreateDepartmentPayload({
        name: "合同部",
        parentId: null,
        confirmationPassword: `${"❤️".repeat(128)}密`
      })
    ).toThrow("当前登录密码不能超过 256 个字符");
  });

  it("turns a clearable department parent into an explicit null patch", () => {
    expect(
      buildDepartmentPatch(
        { name: "合同部", parentId: "root", isActive: true },
        { name: "  合同管理部 ", parentId: null, isActive: true },
        " secret "
      )
    ).toEqual({ name: "合同管理部", parentId: null, confirmationPassword: " secret " });
    expect(() =>
      buildDepartmentPatch(
        { name: "合同部", parentId: null, isActive: true },
        { name: " 合同部 ", parentId: undefined, isActive: true },
        "secret"
      )
    ).toThrow("没有可保存的部门变更");
  });

  it("turns a clearable user department into null while keeping undefined as no change", () => {
    expect(
      buildUserPatch(
        { departmentId: "contract", isActive: true },
        { departmentId: null, isActive: false },
        " secret "
      )
    ).toEqual({ departmentId: null, isActive: false, confirmationPassword: " secret " });
    expect(() =>
      buildUserPatch(
        { departmentId: null, isActive: true },
        { departmentId: undefined, isActive: true },
        "secret"
      )
    ).toThrow("没有可保存的人员变更");
  });

  it("provides explicit consequences without adding another confirmation layer", () => {
    expect(organizationActionConsequence("create_department")).toContain("创建部门");
    expect(organizationActionConsequence("update_department", false)).toContain("启用人员");
    expect(organizationActionConsequence("update_user", false)).toContain("立即阻止登录");
    expect(organizationActionConsequence("update_user", false)).toContain("保留历史记录和岗位信息");
  });

  it("maps integrity issue and source codes to stable Chinese labels with safe fallbacks", () => {
    expect(permissionIntegrityIssueLabel("duplicate_global_assignment")).toBe("全局岗位重复分配");
    expect(permissionIntegrityIssueLabel("orphan_project")).toBe("项目记录缺失");
    expect(permissionIntegrityIssueLabel("future_issue")).toBe("未知问题（future_issue）");
    expect(permissionIntegritySourceLabel("user_position")).toBe("用户岗位（UserPosition）");
    expect(permissionIntegritySourceLabel("project_member")).toBe("项目成员（ProjectMember）");
    expect(permissionIntegritySourceLabel("future_source")).toBe("未知来源（future_source）");
  });

  it("formats server policy and readiness without deriving either from issue counts", () => {
    expect(permissionIntegrityPolicyText(permissionIntegrity.policy)).toBe(
      "全局规范源：UserPosition(projectId=null)；项目规范源：ProjectMember；项目级 UserPosition 仅兼容读取；项目范围不允许 super_admin。"
    );
    expect(permissionIntegrityReadinessTag("canonical", permissionIntegrity.readiness)).toEqual({
      label: "规范岗位写入未就绪",
      tone: "danger"
    });
    expect(permissionIntegrityReadinessTag("migration", permissionIntegrity.readiness)).toEqual({
      label: "遗留迁移已就绪",
      tone: "success"
    });

    const contradictoryReadiness = {
      ...permissionIntegrity,
      readiness: { canonicalRoleWritesReady: true, legacyMigrationReady: false },
      summary: { ...permissionIntegrity.summary, blockingIssues: 99, warningIssues: 0 }
    };
    expect(permissionIntegrityReadinessTag("canonical", contradictoryReadiness.readiness).label).toBe(
      "规范岗位写入已就绪"
    );
    expect(permissionIntegrityReadinessTag("migration", contradictoryReadiness.readiness).label).toBe(
      "遗留迁移未就绪"
    );
  });

  it("builds the four requested summary items directly from the server summary", () => {
    expect(permissionIntegritySummaryItems(permissionIntegrity.summary)).toEqual([
      { label: "阻断项", value: "3", tone: "danger" },
      { label: "警告项", value: "4", tone: "warning" },
      { label: "遗留项目岗位", value: "4", tone: "warning" },
      { label: "双源重叠", value: "2", tone: "danger" }
    ]);
  });

  it("turns server issues into stable display rows and fills missing identifiers", () => {
    expect(permissionIntegrityIssueRows(permissionIntegrity.issues)).toEqual([
      {
        key: "dual_source_project_role:user_position:legacy-1,member-1",
        severityLabel: "阻断",
        severityTone: "danger",
        issueLabel: "项目岗位双源重叠",
        message: "同一项目岗位同时存在于 UserPosition 和 ProjectMember",
        sourceLabel: "用户岗位（UserPosition）",
        userId: "user-1",
        projectId: "project-1",
        roleKey: "project_manager",
        assignmentIds: "legacy-1、member-1"
      },
      {
        key: "legacy_project_user_position:user_position:—",
        severityLabel: "警告",
        severityTone: "warning",
        issueLabel: "项目级 UserPosition 遗留",
        message: "检测到项目级 UserPosition 遗留岗位事实",
        sourceLabel: "用户岗位（UserPosition）",
        userId: "—",
        projectId: "—",
        roleKey: "—",
        assignmentIds: "—"
      }
    ]);
  });

  it("builds one stable removal target per global and project role without merging project roles", () => {
    const user = {
      ...users[0],
      projectPositions: [
        {
          projectId: "project-1",
          projectCode: "XM-001",
          projectName: "科技园项目",
          keys: ["project_manager", "budget_director"],
          names: ["项目经理", "预算部主管"]
        }
      ]
    } satisfies OrganizationDirectoryUser;

    const targets = buildOrganizationRoleRemovalTargets(user, [
        { id: "position-1", key: "contract_director", name: "合同部主管" },
        { id: "position-2", key: "project_manager", name: "项目经理" },
        { id: "position-3", key: "budget_director", name: "预算部主管" }
      ]);
    expect(targets).toEqual([
      expect.objectContaining({
        key: "global:user-1:contract_director",
        scope: "global",
        roleKey: "contract_director"
      }),
      expect.objectContaining({
        key: "project:user-1:project-1:budget_director",
        scope: "project",
        projectId: "project-1",
        roleKey: "budget_director"
      }),
      expect.objectContaining({
        key: "project:user-1:project-1:project_manager",
        scope: "project",
        projectId: "project-1",
        roleKey: "project_manager"
      })
    ]);
    expect(targets[0]).not.toHaveProperty("projectId");
  });

  it("builds one canonical project super-admin remediation target from the integrity issue", () => {
    const issue: PermissionIntegrityIssue = {
      code: "project_super_admin",
      severity: "blocking",
      source: "project_member",
      assignmentIds: ["member-super-admin"],
      userId: "user-1",
      projectId: "project-1",
      roleKey: "super_admin",
      message: "项目范围不允许超级管理员"
    };
    const target = buildProjectSuperAdminRemediationTarget(issue, users[0], [
      { id: "position-super-admin", key: "super_admin", name: "系统管理员" }
    ]);

    expect(isProjectSuperAdminRemediationIssue(issue)).toBe(true);
    expect(target).toEqual({
      key: "project:user-1:project-1:super_admin",
      operation: "remove",
      userId: "user-1",
      scope: "project",
      projectId: "project-1",
      roleKey: "super_admin",
      scopeLabel: "项目岗位",
      projectLabel: "科技园项目（XM-001）",
      roleName: "系统管理员"
    });
  });

  it("shows the project id explicitly when the directory user has no matching project group", () => {
    const issue: PermissionIntegrityIssue = {
      code: "project_super_admin",
      severity: "blocking",
      source: "project_member",
      assignmentIds: ["member-super-admin"],
      userId: "user-1",
      projectId: "project-9",
      roleKey: "super_admin",
      message: "项目范围不允许超级管理员"
    };
    expect(
      buildProjectSuperAdminRemediationTarget(
        issue,
        { ...users[0], projectPositions: [] },
        [{ id: "position-super-admin", key: "super_admin", name: "系统管理员" }]
      )?.projectLabel
    ).toBe("项目ID：project-9");
  });

  it.each([
    { source: "user_position" },
    { code: "invalid_role" },
    { userId: undefined },
    { projectId: undefined },
    { roleKey: undefined },
    { roleKey: "project_manager" }
  ] as const)("rejects non-canonical remediation input: %#", (patch) => {
    const issue = {
      code: "project_super_admin",
      severity: "blocking",
      source: "project_member",
      assignmentIds: ["member-super-admin"],
      userId: "user-1",
      projectId: "project-1",
      roleKey: "super_admin",
      message: "项目范围不允许超级管理员",
      ...patch
    } as PermissionIntegrityIssue;
    expect(isProjectSuperAdminRemediationIssue(issue)).toBe(false);
    expect(buildProjectSuperAdminRemediationTarget(issue, users[0], [])).toBeNull();
  });

  it("rejects a missing or mismatched directory user and deduplicates an injected target", () => {
    const issue: PermissionIntegrityIssue = {
      code: "project_super_admin",
      severity: "blocking",
      source: "project_member",
      assignmentIds: ["member-super-admin"],
      userId: "user-1",
      projectId: "project-1",
      roleKey: "super_admin",
      message: "项目范围不允许超级管理员"
    };
    expect(buildProjectSuperAdminRemediationTarget(issue, null, [])).toBeNull();
    expect(buildProjectSuperAdminRemediationTarget(issue, users[1], [])).toBeNull();

    const target = buildProjectSuperAdminRemediationTarget(issue, users[0], []);
    expect(target).not.toBeNull();
    expect(mergeOrganizationRoleRemovalTargets(target ? [target] : [], target)).toEqual([target]);
  });

  it("trusts server canApply only while also requiring the selected target to match", () => {
    const target = {
      operation: "remove" as const,
      userId: "user-1",
      scope: "project" as const,
      projectId: "project-1",
      roleKey: "project_manager" as const
    };
    expect(canConfirmRoleRemoval(target, { ...removalPreview, canApply: false }, false)).toBe(false);
    expect(
      canConfirmRoleRemoval(
        target,
        {
          ...removalPreview,
          canApply: true,
          blockingIssues: [{ code: "target_assignment_missing", message: "矛盾数据" }],
          summary: { affectedInstances: 99, blockingInstances: 99 }
        },
        false
      )
    ).toBe(true);
    expect(canConfirmRoleRemoval(target, removalPreview, true)).toBe(false);
    expect(
      roleRemovalTargetMatchesPreview(
        { ...target, roleKey: "budget_director" },
        removalPreview
      )
    ).toBe(false);
  });

  it("builds an apply payload from the matching preview without changing hash or password", () => {
    const target = {
      operation: "remove" as const,
      userId: "user-1",
      scope: "project" as const,
      projectId: "project-1",
      roleKey: "project_manager" as const
    };
    expect(buildRoleRemovalApplyPayload(target, removalPreview, "  current password  ")).toEqual({
      ...target,
      snapshotHash: removalPreview.snapshotHash,
      confirmationPassword: "  current password  "
    });
    expect(() =>
      buildRoleRemovalApplyPayload({ ...target, projectId: "project-2" }, removalPreview, "secret")
    ).toThrow("岗位目标与影响预览不一致");
    expect(() => buildRoleRemovalApplyPayload(target, removalPreview, "   ")).toThrow(
      "请输入当前登录密码"
    );
    expect(() =>
      buildRoleRemovalApplyPayload(target, removalPreview, `${"❤️".repeat(128)}密`)
    ).toThrow("当前登录密码不能超过 256 个字符");
  });

  it("rejects project targets without a project and omits projectId for global apply", () => {
    expect(() =>
      buildRoleRemovalApplyPayload(
        {
          operation: "remove",
          userId: "user-1",
          scope: "project",
          roleKey: "project_manager"
        },
        removalPreview,
        "secret"
      )
    ).toThrow("项目岗位缺少项目标识");

    const globalPreview = {
      ...removalPreview,
      change: {
        operation: "remove" as const,
        userId: "user-1",
        scope: "global" as const,
        projectId: null,
        roleKey: "contract_director" as const
      }
    };
    expect(
      buildRoleRemovalApplyPayload(
        {
          operation: "remove",
          userId: "user-1",
          scope: "global",
          roleKey: "contract_director"
        },
        globalPreview,
        "secret"
      )
    ).not.toHaveProperty("projectId");
    expect(() =>
      buildRoleRemovalApplyPayload(
        {
          operation: "remove",
          userId: "user-1",
          scope: "global",
          projectId: "project-1",
          roleKey: "contract_director"
        },
        globalPreview,
        "secret"
      )
    ).toThrow("全局岗位不得提交项目标识");
  });

  it("rejects unsupported role operations and scopes before building apply payloads", () => {
    expect(() =>
      buildRoleRemovalApplyPayload(
        {
          operation: "add",
          userId: "user-1",
          scope: "project",
          projectId: "project-1",
          roleKey: "project_manager"
        } as never,
        removalPreview,
        "secret"
      )
    ).toThrow("岗位变更操作不正确");
    expect(() =>
      buildRoleRemovalApplyPayload(
        {
          operation: "remove",
          userId: "user-1",
          scope: "tenant",
          projectId: "project-1",
          roleKey: "project_manager"
        } as never,
        removalPreview,
        "secret"
      )
    ).toThrow("岗位范围不正确");
  });

  it("maps impact business and blocking reasons to Chinese with safe unknown fallbacks", () => {
    expect(roleRemovalBusinessTypeLabel("payment_request")).toBe("付款申请");
    expect(roleRemovalBusinessTypeLabel("future_type")).toBe("业务类型未读取");
    expect(roleRemovalReasonLabel("approval_execution_semantics_not_safe")).toContain("当前审批执行规则");
    expect(roleRemovalReasonLabel("future_reason")).toBe("阻断原因未读取");
    expect(roleRemovalImpactRows(removalPreview.impacts, [])).toEqual([
      expect.objectContaining({
        key: "approval-1",
        businessTypeLabel: "付款申请",
        modeLabel: "任一人通过",
        statusLabel: "可继续执行",
        pendingRoleNames: "岗位名称未读取"
      })
    ]);
  });

  it("uses the active governance project directory instead of current user memberships", () => {
    expect(activeOrganizationProjectOptions(additionDirectory.projects)).toEqual([
      { label: "科技园项目（XM-001）", value: "project-1" },
      { label: "商务中心（XM-002）", value: "project-2" }
    ]);
    expect(activeOrganizationProjectOptions(additionDirectory.projects)).not.toContainEqual(
      expect.objectContaining({ value: "project-3" })
    );
  });

  it("filters addition roles by exact scope and current assignments", () => {
    expect(
      organizationRoleAdditionOptions(users[0], "global", null, additionDirectory.positions).map(
        (option) => option.value
      )
    ).toEqual(["budget_director", "finance_director", "project_manager", "super_admin"]);
    expect(
      organizationRoleAdditionOptions(
        users[0],
        "project",
        "project-1",
        additionDirectory.positions
      ).map((option) => option.value)
    ).toEqual(["budget_director", "contract_director", "finance_director"]);
    expect(
      organizationRoleAdditionOptions(
        users[0],
        "project",
        "project-2",
        additionDirectory.positions
      ).map((option) => option.value)
    ).toContain("project_manager");
  });

  it("builds additions only from an active user, active project and latest position directory", () => {
    expect(
      buildOrganizationRoleAdditionTarget(users[0], {
        scope: "project",
        projectId: "project-2",
        roleKey: "project_manager"
      }, additionDirectory)
    ).toEqual(additionPreview.change);
    expect(() =>
      buildOrganizationRoleAdditionTarget(users[1], {
        scope: "global",
        roleKey: "project_manager"
      }, additionDirectory)
    ).toThrow("人员已停用，不能新增岗位");
    expect(() =>
      buildOrganizationRoleAdditionTarget(users[0], {
        scope: "project",
        projectId: "project-3",
        roleKey: "project_manager"
      }, additionDirectory)
    ).toThrow("项目已停用，不能新增岗位");
    expect(() =>
      buildOrganizationRoleAdditionTarget(users[0], {
        scope: "project",
        projectId: "project-2",
        roleKey: "super_admin"
      }, additionDirectory)
    ).toThrow("项目岗位不得新增系统管理员");
  });

  it("requires exact addition change, server canApply, valid hash and current password", () => {
    const target = additionPreview.change;
    expect(roleAdditionTargetMatchesPreview(target, additionPreview)).toBe(true);
    expect(canConfirmRoleAddition(target, additionPreview, false)).toBe(true);
    expect(canConfirmRoleAddition(target, { ...additionPreview, canApply: false }, false)).toBe(false);
    expect(canConfirmRoleAddition(target, additionPreview, true)).toBe(false);
    expect(
      buildRoleAdditionApplyPayload(target, additionPreview, "  current password  ")
    ).toEqual({
      ...target,
      snapshotHash: additionPreview.snapshotHash,
      confirmationPassword: "  current password  "
    });
    expect(() =>
      buildRoleAdditionApplyPayload(
        { ...target, projectId: "project-1" },
        additionPreview,
        "secret"
      )
    ).toThrow("岗位目标与影响预览不一致");
    expect(() => buildRoleAdditionApplyPayload(target, additionPreview, "   ")).toThrow(
      "请输入当前登录密码"
    );
  });

  it("rejects forged or empty addition role keys before matching or applying", () => {
    const forgedTarget = {
      ...additionPreview.change,
      roleKey: "root"
    } as never;
    const forgedPreview = {
      ...additionPreview,
      change: { ...additionPreview.change, roleKey: "root" }
    } as never;
    const emptyTarget = {
      ...additionPreview.change,
      roleKey: ""
    } as never;

    expect(roleAdditionTargetMatchesPreview(forgedTarget, forgedPreview)).toBe(false);
    expect(canConfirmRoleAddition(forgedTarget, forgedPreview, false)).toBe(false);
    expect(roleAdditionTargetMatchesPreview(emptyTarget, forgedPreview)).toBe(false);
    expect(() => buildRoleAdditionApplyPayload(forgedTarget, forgedPreview, "secret")).toThrow(
      "岗位键不正确"
    );
    expect(() => buildRoleAdditionApplyPayload(emptyTarget, additionPreview, "secret")).toThrow(
      "岗位键不正确"
    );
  });

  it("maps addition before and after resolution including self-review", () => {
    expect(roleAdditionImpactRows(additionPreview.impacts, additionDirectory.positions)).toEqual([
      expect.objectContaining({
        key: "approval-1:1",
        businessTypeLabel: "付款申请",
        beforeText: "不可办理",
        afterText: "直接岗位 · 项目经理 · 可办理 · 需自审确认",
        statusLabel: "新增后可继续执行",
        reasonLabel: "无阻断"
      })
    ]);
  });

  it("keeps issue row keys unique when two sources reuse the same assignment id", () => {
    const rows = permissionIntegrityIssueRows([
      {
        code: "invalid_role",
        severity: "blocking",
        source: "user_position",
        assignmentIds: ["shared-1"],
        message: "岗位键不在系统固定岗位范围内"
      },
      {
        code: "invalid_role",
        severity: "blocking",
        source: "project_member",
        assignmentIds: ["shared-1"],
        message: "岗位键不在系统固定岗位范围内"
      }
    ]);

    expect(rows.map((row) => row.key)).toEqual([
      "invalid_role:user_position:shared-1",
      "invalid_role:project_member:shared-1"
    ]);
  });
});
