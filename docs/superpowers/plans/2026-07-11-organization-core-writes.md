# Organization Core Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development and superpowers:test-driven-development. Implement this plan in one focused commit, then request an independent review.

**Goal:** 为阶段 B 组织目录补齐部门维护和人员归属/启停写接口，并确保每次变更都经过全局管理员授权、当前密码二次确认、Serializable 事务校验和权限审计。

**Architecture:** 继续复用现有 `organization` 模块和 `Department` / `User` 事实，不改 Prisma schema，不连接数据库，不执行迁移。HTTP 层只接受运行时 class DTO，并从登录态获取操作人；服务层在密码确认后进入 Serializable 事务，完成组织约束、写入和同事务审计。岗位写入、项目成员和项目岗位双事实源不在本切片。

**Tech Stack:** NestJS, TypeScript, class-validator, Prisma, PostgreSQL, Jest.

---

## 1. 固定范围

新增且仅新增以下端点：

- `POST /organization/departments`
- `PATCH /organization/departments/:departmentId`
- `PATCH /organization/users/:userId`

不新增删除接口，不写 `Position`、`UserPosition`、`ProjectMember`，不改真实数据，不推送、不合并、不部署。

所有端点继续继承类级 `@RequirePositions("super_admin")`；现有 `PermissionGuard` 已保证只有全局 `super_admin` 可满足。操作人只从 `@CurrentUser()` 获取。

## 2. DTO 与契约

**Files:**

- Create: `services/api/src/organization/dto/create-department.dto.ts`
- Create: `services/api/src/organization/dto/update-department.dto.ts`
- Create: `services/api/src/organization/dto/update-organization-user.dto.ts`
- Modify: `services/api/src/organization/organization.controller.ts`
- Modify: `services/api/src/organization/organization.controller.spec.ts`

DTO 必须是运行时 class，字段为：

- `CreateDepartmentDto`: `name`, `parentId?: string | null`, `confirmationPassword`
- `UpdateDepartmentDto`: `name?`, `parentId?: string | null`, `isActive?`, `confirmationPassword`
- `UpdateOrganizationUserDto`: `departmentId?: string | null`, `isActive?`, `confirmationPassword`

规则：

- `null` 表示清空父级或人员部门，`undefined` 表示不修改。
- 名称 trim 后不能为空，最多 100 个 Unicode code point。
- 字符串 ID trim 后不能为空，最多 128 个 Unicode code point；不得强制 UUID。
- 密码不能为空白，最多 256 个 Unicode code point；服务必须把原值传给 `AuthService.confirmPassword`，不得 trim 后再校验密码。
- `isActive` 必须是布尔值。
- 全局 ValidationPipe 继续拒绝未知字段，错误不得回显密码。
- 更新 DTO 只有密码、没有业务字段时，由服务返回固定中文 400。

Controller 测试必须证明 DTO metatype 为真实 class、三个端点使用登录态 actor，并继续受类级全局 `super_admin` 限制。

## 3. 服务层安全规则

**Files:**

- Modify: `services/api/src/organization/organization.module.ts`
- Modify: `services/api/src/organization/organization.service.ts`
- Modify: `services/api/src/organization/organization.service.spec.ts`

模块导入 `AuthModule` 和 `AuditModule`，服务注入 `AuthService`、`AuditService`。

每个写方法顺序固定为：

1. 规范化非密码字段，并拒绝无业务字段请求。
2. `AuthService.confirmPassword(actorUserId, confirmationPassword)`。
3. 进入 `Prisma.TransactionIsolationLevel.Serializable` 事务。
4. 读取 before 和相关组织事实并完成约束校验。
5. 写业务事实。
6. `AuditService.record(tx, ...)`。
7. 返回不含密码的精简结果。

密码失败时不得启动事务，不得写业务数据或审计。

### 3.1 部门创建

- `name` 唯一；P2002 映射为“部门名称已存在”。
- `parentId` 非空时，父部门必须存在且启用。
- 创建和审计在同一事务。
- action 为 `permission.department.create`，businessType 为 `department`。

### 3.2 部门更新

- 目标部门必须存在。
- 新父级必须存在且启用，不能是自身或任一后代。
- 在事务内读取部门图并模拟新父级后检查环；并发冲突 P2034 映射为固定中文重试提示。
- 停用部门时，若仍有启用人员归属，或存在任一启用后代部门，则拒绝；不级联停用、不清理历史关联。
- action 为 `permission.department.update`；metadata 只包含 `{ before, after }` 的 `name/parentId/isActive`。

### 3.3 人员归属和状态

- 目标人员必须存在。
- 新部门非空时必须存在且启用。
- `departmentId: null` 允许清空归属。
- 停用人员不删除岗位和历史关系；认证 Guard 会立即拒绝停用账号的现有 access token。
- 不允许停用最后一个“启用且持有 `UserPosition.projectId === null` 的 `super_admin`”人员；项目级同名岗位不计入。
- 停用时同事务撤销该用户所有未撤销 refresh token。
- action 为 `permission.user.update`；metadata 只包含 `{ before, after }` 的 `departmentId/isActive`。

## 4. TDD 证据

先补测试并确认 RED 只来自缺少实现，再写生产代码。

目标测试至少覆盖：

- Controller/DTO：运行时 metatype、登录态 actor、未知字段、空白/超长文本、`null`/`undefined`、非布尔状态。
- 密码失败：零事务、零业务写入、零审计，密码不出现在 metadata。
- 部门创建：成功、父级不存在、父级停用、重名。
- 部门更新：目标不存在、自父级、后代成环、停用时有启用人员、停用时有启用后代、成功 before/after 审计。
- 人员更新：目标不存在、部门不存在/停用、清空部门、启停成功、最后一个全局管理员不可停用、项目级 `super_admin` 不计入全局管理员。
- Serializable 事务与失败回滚契约。

RED / GREEN 命令：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/organization/organization.controller.spec.ts src/organization/organization.service.spec.ts
```

## 5. 验收与进度

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/organization/organization.controller.spec.ts src/organization/organization.service.spec.ts src/auth/guards/permission.guard.spec.ts
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api build
git diff --check
```

完成后更新 `PROGRESS.md`，明确：

- 部门和人员核心写接口已完成；
- 岗位/项目成员写接口、影响预览和 Web 组织权限 UI 仍未完成；
- 未连接数据库、未迁移、未推送、未部署。

独立复审必须检查权限边界、密码零泄漏、Serializable 并发规则、部门环/停用约束、最后管理员保护、事务审计和未越过本切片范围。
