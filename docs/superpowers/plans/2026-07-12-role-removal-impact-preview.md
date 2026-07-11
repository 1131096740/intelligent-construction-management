# Role Removal Impact Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development and superpowers:test-driven-development. Implement this plan in focused commits, then request an independent review.

**Goal:** 在真正开放岗位撤销前，为全局超级管理员提供只读影响预览，模拟删除一条规范岗位事实后，识别四类在途审批当前节点是否失去可执行人，并生成未来 apply 可复核的稳定快照 hash。

**Architecture:** 在 `organization` 域新增独立 `PermissionImpactService`，不继续膨胀 `OrganizationService`。端点仅支持 `remove`，从规范源解析唯一目标记录：全局岗位为 `UserPosition(projectId=null)`，项目岗位为 `ProjectMember`。服务批量读取在途实例、业务项目映射、用户启停、双源岗位和有效委托；模拟移除具体记录后，按 direct / frozen assignment / standing delegation 三种通道和 any/all 模式计算当前节点覆盖。响应只读，不验密码、不删除、不审计。

**Tech Stack:** NestJS, TypeScript, Prisma read queries, Node crypto, Jest.

---

## 1. 文件与端点

**Files:**

- Create: `services/api/src/organization/dto/preview-role-removal.dto.ts`
- Create: `services/api/src/organization/permission-impact.service.ts`
- Create: `services/api/src/organization/permission-impact.service.spec.ts`
- Modify: `services/api/src/organization/organization.controller.ts`
- Modify: `services/api/src/organization/organization.controller.spec.ts`
- Modify: `services/api/src/organization/organization.module.ts`
- Modify: `PROGRESS.md`

新增：

```http
POST /organization/role-changes/preview
```

Controller 继续继承全局 `@RequirePositions("super_admin")`。本端点是复杂只读计算，使用 POST 但不得调用 create/update/delete/$transaction/audit/auth confirmPassword。

## 2. 请求 DTO

```ts
class PreviewRoleRemovalDto {
  operation: "remove";
  userId: string;
  scope: "global" | "project";
  projectId?: string | null;
  roleKey: RoleKey;
}
```

运行时校验：

- operation 只允许 remove。
- userId / projectId 为非空白文字，最多 128 Unicode code points；projectId 可为 null。
- roleKey 只允许 `ROLE_KEYS`。
- service 约束：global 必须无 projectId/null；project 必须有非空 projectId，且不得为 `super_admin`。
- 不接受 assignmentId、actor、密码、snapshotHash 或未知字段。

## 3. 规范目标解析与顶层阻断

服务先验证 user、Position、project（若需要）存在，再解析规范目标：

- global：同 user + position + `projectId=null` 的 UserPosition 必须恰好 1 条。
- project：同 user + project + roleKey 的 ProjectMember 必须恰好 1 条。

顶层 `blockingIssues` 固定 code：

- `target_user_missing`
- `target_position_missing`
- `target_project_missing`
- `target_assignment_missing`
- `target_assignment_ambiguous`
- `project_super_admin_forbidden`
- `legacy_shadow_assignment`：project 范围存在同 user/project/role 的 legacy UserPosition，删除 ProjectMember 后仍会授权。
- `last_active_global_super_admin`：撤销后将没有启用的全局 super_admin。

存在目标解析阻断时不得伪造安全预览；`canApply=false`。若目标唯一但有 last-admin/shadow 阻断，仍可计算审批影响供管理员理解。

## 4. 批量数据与项目映射

读取：

- 所有启停用户最小字段。
- Position `id/key`。
- UserPosition 与 ProjectMember 的完整最小岗位事实。
- 四类 `status=in_progress` ApprovalInstance：`contract_version`、`settlement`、`payment_request`、`project_expense_request`。
- 当前时点有效的 ApprovalDelegation（enabled、startsAt<=now、endsAt>=now）。

业务项目批量映射，不得逐实例 N+1：

- contract_version -> ContractVersion.contractId -> Contract.projectId
- settlement -> Settlement.projectId
- payment_request -> PaymentRequest.projectId
- project_expense_request -> ProjectExpenseRequest.projectId

业务记录缺失、frozenNodes 非数组、currentNodeIndex 越界、当前节点字段非法、pendingRoleKeys 为空都 fail closed，形成阻断 impact，而不是忽略或抛原始错误。

## 5. 当前节点解析

从冻结当前节点读取并严格白名单：

- `name`: 非空字符串
- `mode`: `any | all`
- `roleKeys`: 合法且去重后的 ROLE_KEYS
- `approvedRoleKeys`: 合法 ROLE_KEYS 子集
- `assignments`: 仅合同/结算/付款读取 `{ toUserId, fromRoleKey }`；项目支出忽略

`pendingRoleKeys = roleKeys - approvedRoleKeys`，复用或对齐 `pendingRoleKeysForFrozenApprovalNode` 语义。预览不得把已审批岗位作为可推动流程的通道。

只返回本次 roleKey 仍为 pending、且 scope 项目匹配的实例；数据完整性异常实例即使无法映射也应作为阻断 impact 返回。

## 6. 模拟撤岗后的岗位事实

只从规范源集合中移除解析出的唯一 target assignment ID；其他事实全部保留：

- 全局 UserPosition(null)
- 项目级 legacy UserPosition（兼容读）
- ProjectMember

岗位有效性只接受合法 ROLE_KEYS。用户必须 `isActive=true` 才能形成可执行通道。

对每个 project + pendingRoleKey 计算：

### 6.1 direct

- 直接有效岗位来自三源并集。
- 普通申请人本人不计可执行人。
- 申请人本人直接持有 chairman/general_manager 时计为条件可执行，并标记 `requiresSelfReviewConfirmation=true`。
- 返回 `targetStillDirectAfter`、`otherDirectApproverUserIds`、`directApproverUserIdsAfter`。

### 6.2 frozen assignment

仅合同/结算/付款：

- toUser 启用。
- fromRoleKey 属于 pendingRoleKeys。
- assignment 独立于委托人当前岗位；撤岗不得删除该冻结通道。
- 仍受申请人自审规则约束；assignment 不能凭空创造领导自审例外。

项目支出忽略 assignments。

### 6.3 standing delegation

仅合同/结算/付款：

- 使用预览 evaluatedAt 时有效的 delegation。
- fromUser 与 toUser 均启用。
- fromUser 在模拟撤岗后仍直接持有对应 pendingRoleKey。
- toUser 受申请人自审规则约束；委托不能创造领导自审例外。

项目支出忽略 delegation。

## 7. any/all 阻断

每个 pending role 返回 `roleCoverage`：direct/assignment/delegation 用户 ID（稳定去重排序）、是否存在自审条件通道、`executable`。

- mode=any：至少一个 pending role executable。
- mode=all：每个 pending role 都 executable。

无覆盖时：

- `blocking=true`
- `reasonCode="no_executable_current_approver"`

数据异常：

- `blocking=true`
- `reasonCode="invalid_approval_instance_data"`

## 8. 响应与快照

响应：

- 规范化 change
- `evaluatedAt` ISO 时间
- `snapshotHash`（`sha256:<hex>`）
- `canApply`
- summary: affectedInstances / blockingInstances
- blockingIssues
- impacts（按 approvalInstanceId 稳定排序）

快照 hash 使用稳定 JSON + SHA-256，包含：

- schemaVersion
- change
- target assignment ID
- 参与计算的实例当前节点事实与 projectId
- 用户启停、Position、UserPosition、ProjectMember
- evaluatedAt 时有效的 delegation 集合

所有数组按稳定键排序，对象 key 稳定；输入查询顺序不得改变 hash。`evaluatedAt` 原值不得进入 hash，避免无事实变化仍 hash 漂移；有效 delegation 集合进入 hash。密码/token 不存在于请求和 hash。

## 9. TDD 最小覆盖

先写测试 RED，再实现：

- DTO/controller 运行时 class、global super_admin、登录态/密码字段不存在、未知字段拒绝。
- global/project 目标唯一、缺失、重复、project super_admin、legacy shadow、最后管理员。
- 四类 projectId 映射与缺失 fail closed；批量查询无 N+1。
- global 撤岗影响多项目，project 仅目标项目。
- 双源保留使 targetStillDirectAfter=true。
- 其他启用 direct 保活，停用用户不计。
- any/all 与 approvedRoleKeys pending 语义。
- frozen assignment 保活且项目支出忽略。
- delegation 随 fromUser 失岗而失效，另一事实保留则有效；禁用/过期/未开始不计。
- 普通申请人自审不计，领导直接岗位自审条件可用。
- 非法 frozen/current index/空 pending fail closed。
- hash 查询顺序无关，岗位/用户/节点/有效委托任一事实变化会改变 hash。
- 全流程零写入、零事务、零审计、零密码。

RED/GREEN：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/organization/permission-impact.service.spec.ts src/organization/organization.controller.spec.ts
```

完整门禁：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/organization/permission-impact.service.spec.ts src/organization/organization.controller.spec.ts src/auth/guards/permission.guard.spec.ts
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api build
git diff --check
```

完成后更新 `PROGRESS.md`，明确只有只读 remove 预览，尚未开放 apply、岗位写入、Web 预览交互或生产数据验证。独立复审重点检查 fail-closed、pending role、自审、assignment/delegation、双源 shadow、last admin、hash 稳定性和零写入。
