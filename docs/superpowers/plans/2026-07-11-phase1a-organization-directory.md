# 组织目录后端读模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立阶段 B 的第一个可验收基础：让 `super_admin` 通过一个后端读接口看到部门树、人员状态、固定岗位、全局岗位和项目岗位事实。

**Architecture:** 复用现有 `User`、`Department`、`Position`、`UserPosition`、`ProjectMember` 和 `Project`，只给部门增加父级/启停、给人员增加部门归属。`OrganizationService` 负责聚合只读账本，`OrganizationController` 只暴露受 `super_admin` 岗位守卫保护的 `GET /organization/directory`；本切片不开放任何写操作。

**Tech Stack:** NestJS, Prisma, PostgreSQL, Jest, TypeScript.

## Global Constraints

- `PROGRESS.md` 是当前进度唯一真相，每个完成切片必须与代码一起提交。
- 使用固定业务角色，不建设通用权限平台。
- `super_admin` 是技术管理身份，不自动获得任何业务审批权限。
- 普通账号不得读取完整组织权限目录；未授权调用统一返回 403。
- 前端不得直接访问 PostgreSQL；后端是组织、岗位和项目范围事实来源。
- 不引入新依赖、第二套权限模型、低代码、BPMN 或第二套 UI 库。
- 数据库迁移只新增可空字段或带安全默认值字段，不回填、删除或改写现有真实数据。

---

### Task 1: 组织目录只读账本

**Files:**
- Create: `services/api/prisma/migrations/20260711130000_organization_directory_foundation/migration.sql`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/database/organization-schema-verification.spec.ts`
- Create: `services/api/src/organization/organization.service.ts`
- Create: `services/api/src/organization/organization.service.spec.ts`
- Create: `services/api/src/organization/organization.controller.ts`
- Create: `services/api/src/organization/organization.controller.spec.ts`
- Modify: `services/api/src/organization/organization.module.ts`
- Modify: `services/api/src/auth/guards/permission.guard.ts`
- Modify: `services/api/src/auth/guards/permission.guard.spec.ts`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: `PrismaService`, `@jiangkong/shared-domain` 的 `RoleKey`, `RequirePositions("super_admin")` 和全局 `PermissionGuard`。
- Produces: `OrganizationService.getDirectory(): Promise<OrganizationDirectoryReadModel>`；HTTP `GET /organization/directory`。
- `OrganizationDirectoryReadModel` 固定包含 `summary`、`departments`、`users`、`positions`；项目岗位同时合并 `UserPosition.projectId != null` 与现有 `ProjectMember.positionKey`，相同用户/项目/岗位去重。

- [x] **Step 1: 写数据库契约失败测试**

在 `organization-schema-verification.spec.ts` 读取 `schema.prisma` 和目标迁移，断言以下契约：

```ts
expect(schema).toContain("departmentId         String?");
expect(schema).toContain("parentId  String?");
expect(schema).toContain("isActive  Boolean  @default(true)");
expect(migration).toContain('ALTER TABLE "Department"');
expect(migration).toContain('ADD COLUMN "parentId" TEXT');
expect(migration).toContain('ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true');
expect(migration).toContain('ALTER TABLE "User" ADD COLUMN "departmentId" TEXT');
```

- [x] **Step 2: 运行数据库契约测试并确认 RED**

Run: `pnpm --filter @jiangkong/api test -- organization-schema-verification.spec.ts --runInBand`

Expected: FAIL，因为组织目录字段和迁移尚不存在；失败不能来自路径或语法错误。

- [x] **Step 3: 添加向后兼容 schema 与迁移**

`User` 墂加 `departmentId String?` 和 `@@index([departmentId])`。`Department` 改为：

```prisma
model Department {
  id        String   @id @default(uuid())
  name      String   @unique
  parentId  String?
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([parentId])
}
```

迁移只新增两个可空字段/安全默认字段和索引：

```sql
ALTER TABLE "Department"
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;

CREATE INDEX "Department_parentId_idx" ON "Department"("parentId");
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");
```

不要添加需要清洗现有数据的非空外键，不执行数据库迁移。

- [x] **Step 4: 运行数据库契约测试并确认 GREEN**

Run: `pnpm --filter @jiangkong/api test -- organization-schema-verification.spec.ts --runInBand`

Expected: 目标测试 PASS。

- [x] **Step 5: 写服务失败测试**

`organization.service.spec.ts` 使用真实 `OrganizationService` 和 Prisma mock，覆盖以下行为：

```ts
it("返回部门树、人员状态、全局岗位和去重后的项目岗位", async () => {
  const result = await service.getDirectory();
  expect(result.departments[0].children[0].name).toBe("合同部");
  expect(result.users[0]).toMatchObject({
    name: "张三",
    departmentName: "合同部",
    status: "active",
    globalPositions: [{ key: "contract_director", name: "合同部主管" }]
  });
  expect(result.users[0].projectPositions).toEqual([
    expect.objectContaining({ projectId: "project-1", keys: ["contract_staff"] })
  ]);
});

it("把父级缺失或循环部门安全放在根层且每个部门只出现一次", async () => {
  const result = await service.getDirectory();
  const ids = flattenDepartmentIds(result.departments);
  expect(ids.sort()).toEqual(["cycle-a", "cycle-b", "orphan"].sort());
  expect(new Set(ids).size).toBe(ids.length);
});

it("保留停用人员和停用部门供管理员治理", async () => {
  const result = await service.getDirectory();
  expect(result.summary.inactiveUsers).toBe(1);
  expect(result.users).toContainEqual(expect.objectContaining({ status: "inactive" }));
});
```

Prisma mock 必须覆盖 `department.findMany`、`user.findMany`、`position.findMany`、`userPosition.findMany`、`projectMember.findMany` 和 `project.findMany`；测试去重同一项目岗位同时来自两张表的情况。

- [x] **Step 6: 运行服务测试并确认 RED**

Run: `pnpm --filter @jiangkong/api test -- organization.service.spec.ts --runInBand`

Expected: FAIL，因为 `OrganizationService` 尚不存在。

- [x] **Step 7: 实现最小组织目录服务**

定义稳定读模型：

```ts
export interface OrganizationDirectoryReadModel {
  summary: { departments: number; activeUsers: number; inactiveUsers: number; positions: number };
  departments: DepartmentTreeNode[];
  users: Array<{
    id: string;
    name: string;
    phone: string;
    departmentId: string | null;
    departmentName: string;
    status: "active" | "inactive";
    mustChangePassword: boolean;
    globalPositions: Array<{ key: RoleKey; name: string }>;
    projectPositions: Array<{
      projectId: string;
      projectCode: string;
      projectName: string;
      keys: RoleKey[];
      names: string[];
    }>;
  }>;
  positions: Array<{ id: string; key: RoleKey; name: string }>;
}
```

`getDirectory()` 一次并行读取六类表，使用数据库 `Position.name` 作为中文岗位名；全局岗位只读取 `UserPosition.projectId = null`，项目岗位合并 `UserPosition.projectId != null` 和 `ProjectMember`。部门树构建必须对父级缺失和环路失败关闭：无法安全挂到父节点的部门作为根节点输出，所有部门恰好输出一次。用户按姓名、部门按名称、项目按编号排序。

- [x] **Step 8: 运行服务测试并确认 GREEN**

Run: `pnpm --filter @jiangkong/api test -- organization.service.spec.ts --runInBand`

Expected: 全部 PASS，输出无 warning/error。

- [x] **Step 9: 写控制器守卫失败测试**

`organization.controller.spec.ts` 断言：

```ts
expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, OrganizationController)).toEqual(["super_admin"]);
expect(await controller.directory()).toBe(directoryReadModel);
expect(service.getDirectory).toHaveBeenCalledTimes(1);
```

- [x] **Step 10: 运行控制器测试并确认 RED**

Run: `pnpm --filter @jiangkong/api test -- organization.controller.spec.ts --runInBand`

Expected: FAIL，因为控制器和模块接线尚不存在。

- [x] **Step 11: 实现控制器和模块接线**

控制器只提供一个 GET：

```ts
@Controller("organization")
@RequirePositions("super_admin")
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get("directory")
  directory() {
    return this.organization.getDirectory();
  }
}
```

`OrganizationModule` 导入 `DatabaseModule`，注册 `OrganizationController` 和 `OrganizationService`。不要新增写端点或让 `super_admin` 获得业务动作。

安全复核确认全局 `PermissionGuard` 会解析请求携带的 `projectId`，因此补一条最小规则：`RequirePositions` 中的 `super_admin` 只能由全局岗位满足，其他岗位的既有全局/项目生效行为不变。

- [x] **Step 12: 运行目标测试和结构校验**

Run:

```bash
pnpm --filter @jiangkong/api prisma generate
pnpm --filter @jiangkong/api test -- organization-schema-verification.spec.ts organization.service.spec.ts organization.controller.spec.ts --runInBand
pnpm --filter @jiangkong/api prisma validate
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git diff --check
```

Expected: 全部退出 0；不连接生产数据库，不执行 `prisma migrate deploy`。

- [x] **Step 13: 更新进度并提交**

在 `PROGRESS.md` 的“当前下一步”和“最近变更”记录：组织目录只读账本已完成、仅 `super_admin` 可读、数据库只是新增兼容字段、尚未执行生产迁移、组织写 API 与 Web UI 仍待后续。

```bash
git add PROGRESS.md docs/superpowers/plans/2026-07-11-post-phase0-continuation.md docs/superpowers/plans/2026-07-11-phase1a-organization-directory.md services/api/prisma/schema.prisma services/api/prisma/migrations/20260711130000_organization_directory_foundation/migration.sql services/api/src/database/organization-schema-verification.spec.ts services/api/src/organization
git commit -m "feat: 建立组织目录只读账本"
```
