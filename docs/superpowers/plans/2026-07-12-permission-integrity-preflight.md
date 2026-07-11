# Permission Integrity Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development and superpowers:test-driven-development. Implement this plan in one focused commit, then request an independent review.

**Goal:** 在开放全局岗位和项目岗位写入前，提供只允许全局超级管理员读取的权限数据完整性预检，识别双事实源、重复、无效角色和孤儿记录，并明确规范写源是否具备迁移/写入条件。

**Architecture:** 继续使用现有 `organization` 模块，新增纯只读 `GET /organization/permission-integrity`。一次读取 User、Position、Project、UserPosition、ProjectMember 的最小字段，在内存中做稳定、可测试的分类；不写数据库、不改 schema/迁移、不自动修复。全局岗位规范源固定为 `UserPosition(projectId=null)`，项目岗位规范源固定为 `ProjectMember`，项目级 `UserPosition` 仅作为兼容期遗留事实报告。

**Tech Stack:** NestJS, TypeScript, Prisma read queries, Jest.

---

## 1. 固定范围与策略

**Files:**

- Modify: `services/api/src/organization/organization.controller.ts`
- Modify: `services/api/src/organization/organization.controller.spec.ts`
- Modify: `services/api/src/organization/organization.service.ts`
- Modify: `services/api/src/organization/organization.service.spec.ts`
- Modify: `PROGRESS.md`

新增：

- `GET /organization/permission-integrity`

类级 `@RequirePositions("super_admin")` 继续保证只有全局超级管理员可读。端点不接受 actor/body/query，不写审计（只读治理查询），不修改任何岗位事实。

固定策略写入返回契约：

- `globalWriteSource: "UserPosition(projectId=null)"`
- `projectWriteSource: "ProjectMember"`
- `legacyProjectUserPositionReadCompatibility: true`
- `projectSuperAdminAllowed: false`

## 2. 稳定读模型

返回：

```ts
interface PermissionIntegrityReadModel {
  policy: {
    globalWriteSource: "UserPosition(projectId=null)";
    projectWriteSource: "ProjectMember";
    legacyProjectUserPositionReadCompatibility: true;
    projectSuperAdminAllowed: false;
  };
  readiness: {
    canonicalRoleWritesReady: boolean;
    legacyMigrationReady: boolean;
  };
  summary: {
    globalAssignments: number;
    canonicalProjectAssignments: number;
    legacyProjectAssignments: number;
    duplicateGlobalGroups: number;
    dualSourceOverlaps: number;
    invalidRoleAssignments: number;
    orphanAssignments: number;
    blockingIssues: number;
    warningIssues: number;
  };
  issues: PermissionIntegrityIssue[];
}
```

Issue 最小字段：

- `code`: 固定枚举
- `severity`: `blocking | warning`
- `source`: `user_position | project_member`
- `assignmentIds`: 稳定排序后的相关行 ID
- `userId`, `projectId`, `positionId`, `roleKey` 仅在可确定时返回
- `message`: 固定中文，不拼接密码、token 或其他敏感值

issues 按 severity、code、userId、projectId、roleKey、assignmentIds 稳定排序，避免数据库返回顺序造成页面漂移。

## 3. 分类规则

读取最小字段：

- User: `id`
- Position: `id`, `key`
- Project: `id`
- UserPosition: `id`, `userId`, `positionId`, `projectId`
- ProjectMember: `id`, `userId`, `projectId`, `positionKey`

必须识别：

1. `duplicate_global_assignment`（blocking）：同一 `userId + positionId` 存在多条 `projectId === null`。
2. `legacy_project_user_position`（warning）：任意 `projectId !== null` 的 UserPosition，包括空字符串。
3. `dual_source_project_role`（blocking）：同一 user/project/合法 role 同时存在 legacy UserPosition 与 ProjectMember，撤掉单源会留下影子授权。
4. `invalid_role`（blocking）：Position.key 或 ProjectMember.positionKey 不属于 `ROLE_KEYS`。
5. `project_super_admin`（blocking）：任一项目范围来源出现 `super_admin`。
6. `orphan_user`（blocking）：assignment 的 userId 不存在。
7. `orphan_position`（blocking）：UserPosition 的 positionId 不存在。
8. `orphan_project`（blocking）：项目范围 assignment 的 projectId 不存在；空字符串也视为孤儿项目。

同一底层行可产生多个不同 code 的问题，但同一 code/同一事实不得重复。合法的纯 ProjectMember 不产生 issue。

## 4. readiness 语义

- `canonicalRoleWritesReady`：不存在 blocking issue，且不存在任何 legacy 项目级 UserPosition；否则 false。
- `legacyMigrationReady`：不存在 orphan、invalid role、project super_admin；重复/双源/legacy 本身不阻止生成迁移方案，否则 false。

该布尔值只是预检结论，不执行迁移或写入。

## 5. TDD 与验收

先补 controller/service 测试并运行 RED，覆盖：

- 端点继承全局 super_admin 并返回 service 读模型。
- 完全干净数据 ready=true、issues=[]。
- 全局 NULL 重复分组。
- 项目级 UserPosition 空字符串也归遗留且孤儿。
- 两源同角色 overlap。
- 无效 Position/ProjectMember 角色。
- 项目级 super_admin 两来源。
- orphan user/position/project。
- 同一行多问题不丢失、同一问题不重复。
- issue 和 assignmentIds 不受查询顺序影响。
- 不调用 create/update/delete/$transaction/audit。

RED / GREEN：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/organization/organization.controller.spec.ts src/organization/organization.service.spec.ts
```

完整门禁：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/organization/organization.controller.spec.ts src/organization/organization.service.spec.ts src/auth/guards/permission.guard.spec.ts
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api build
git diff --check
```

完成后更新 `PROGRESS.md`，明确该端点只提供代码级只读预检，尚未连接生产数据、未执行迁移、未开放岗位写入或影响预览。独立复审必须检查分类完整性、稳定排序、readiness 语义、全局权限边界和零写入。
