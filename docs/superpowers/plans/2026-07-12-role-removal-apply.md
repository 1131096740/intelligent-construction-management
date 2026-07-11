# Role Removal Apply Implementation Plan

**Goal:** 在现有只读撤岗影响预览之后，开放一个仅全局 `super_admin` 可调用的撤岗落地端点；必须用当前密码和未过期的服务端快照，在 Serializable 事务内重算影响后只删除一条规范岗位事实。

**Architecture:** 新增独立 `OrganizationRoleService`，不继续扩张 `OrganizationService`。`PermissionImpactService` 保留公共只读预览，同时抽出可接收 Prisma transaction client 的内部评估入口，向写服务返回公开预览和服务端重新解析的唯一 assignment ID。apply 不信任客户端 assignment ID，不支持新增岗位，不修改审批写服务。

## 1. 端点与 DTO

新增：

```http
POST /organization/role-changes/apply
```

请求：

```ts
class ApplyRoleRemovalDto {
  operation: "remove";
  userId: string;
  scope: "global" | "project";
  projectId?: string | null;
  roleKey: RoleKey;
  snapshotHash: string;
  confirmationPassword: string;
}
```

- `userId` / `projectId` 沿用 128 Unicode code points 边界。
- `snapshotHash` 必须严格匹配 `sha256:` 加 64 位小写十六进制。
- 密码最多 256 Unicode code points，空白仍由 AuthService 判断，不 trim 后提交。
- 全局 Pipe 拒绝 `actorUserId`、`assignmentId`、审计字段和其他未知字段。
- Controller 只从登录态传 `actor.id`，继续继承类级全局 `super_admin`。

## 2. 事务内重算

重构 `PermissionImpactService`：

- `previewRoleRemoval(body)` 行为和响应保持不变，仍是纯读取。
- 新增供组织域内部调用的 transaction-aware 评估入口。
- 评估结果除公开 preview 外，只在服务端返回唯一规范目标的 ID 与来源。
- 所有用户、岗位、项目、在途审批、业务项目映射、冻结节点、有效委托和 hash 都使用传入 client 读取。

apply 顺序：

1. 规范化请求并在事务外确认当前密码；失败时零事务、零写入、零审计。
2. 进入 Serializable 事务。
3. 再确认 actor 仍为启用用户，且仍持有至少一条规范全局 `super_admin`。
4. 用 transaction client 和当前时点完整重算撤岗预览。
5. 最新 hash 与请求不一致时返回 409，提示重新预览。
6. 最新 `canApply=false` 或唯一目标未解析时 fail closed，零删除。
7. 只按服务端重新解析的唯一 ID 删除：全局删 `UserPosition(projectId=null)`，项目删 `ProjectMember`。
8. 撤销目标用户全部未撤销 refresh token。
9. 同事务写 `permission.role.remove` 审计；审计失败整体回滚。

## 3. 不变量与错误

- 不接受客户端 assignment ID，不使用请求坐标直接 `deleteMany`。
- 项目撤岗不得删除 legacy `UserPosition(projectId!=null)`；存在 shadow 时沿用预览阻断。
- 最后一个启用全局管理员、多岗位 `all` 执行语义不安全、目标缺失/重复、审批数据异常全部沿用预览 fail closed。
- actor 权限在 Guard 后仍做事务内复核，关闭并发撤权 TOCTOU。
- P2034 映射为“组织或审批数据已变化，请重新预览后再试”。
- P2025 映射为“岗位事实已变化，请重新预览后再试”。
- 不新增 schema/migration，不连接数据库，不写生产。

## 4. 审计与响应

审计：

```ts
{
  action: "permission.role.remove",
  businessType: "role_assignment",
  businessId: assignmentId,
  metadata: {
    userId,
    scope,
    projectId,
    roleKey,
    source,
    snapshotHash,
    affectedInstances,
    revokedRefreshTokens
  }
}
```

不得记录密码、原始请求、整份预览或 token 值。

成功响应只返回规范化 change、assignment ID/source、受影响实例数和撤销 refresh token 数，不回显密码。

## 5. TDD 验收

先写 RED：

- DTO 运行时 class、hash 格式、未知字段、登录态 actor。
- 密码失败零事务。
- 事务内 actor 已停用或失去规范全局管理员时拒绝。
- 同 hash + `canApply=true` 时分别删除唯一全局/项目规范事实。
- hash 不一致返回 409，`canApply=false`、目标缺失/重复、shadow、最后管理员、多岗位 `all` 均零删除。
- 删除 ID 必须来自事务内评估，不来自请求坐标。
- add/remove 之外 operation 拒绝；本端点不具备新增能力。
- 成功撤销目标 refresh token；无关用户不动。
- 审计与删除使用同一 tx，metadata 不含密码；审计失败回滚。
- P2025/P2034 中文化。
- 公共 preview 继续零事务、零写入且响应结构不变。

聚焦验证：

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/organization/organization-role.service.spec.ts \
  src/organization/permission-impact.service.spec.ts \
  src/organization/organization.controller.spec.ts \
  src/auth/guards/permission.guard.spec.ts
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api build
git diff --check
```

完成后更新 `PROGRESS.md`，明确只开放撤岗 apply；新增岗位、Web 岗位管理、部分唯一索引、真实数据和生产仍未执行，并请求独立安全复审。
