# Organization Core Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development and superpowers:test-driven-development. Implement this plan in one focused commit, then request an independent review.

**Goal:** 为全局超级管理员提供可实际使用的组织治理页，读取统一组织目录，并维护部门、人员归属和启停状态；固定岗位、全局岗位和项目岗位本切片只读。

**Architecture:** 新增独立 `organization.api.ts` 与 `/组织权限` 页面。页面只依赖后端组织读模型和三项安全写接口，路由与导航仅向 `super_admin` 开放。一个共享 TDesign 对话框承载新建部门、编辑部门、编辑人员三种动作的当前密码确认；不做乐观更新，成功后重新读取目录。纯转换、过滤和 patch 生成放入同域 config/helper 并单测。

**Tech Stack:** Vue 3, TypeScript, TDesign Vue Next, Pinia-authenticated API fetch, Vitest.

---

## 1. 固定范围

**Files:**

- Create: `apps/web-admin/src/api/organization.api.ts`
- Create: `apps/web-admin/src/api/organization.api.test.ts`
- Create: `apps/web-admin/src/pages/organization/OrganizationManagementPage.vue`
- Create: `apps/web-admin/src/pages/organization/organization.config.ts`
- Create: `apps/web-admin/src/pages/organization/organization.config.test.ts`
- Modify: `apps/web-admin/src/routes/route-records.ts`
- Modify: `apps/web-admin/src/routes/index.test.ts`
- Modify: `PROGRESS.md`

不改 SettingsPage，不写岗位或项目成员，不增加第二 UI 库，不增加低代码/权限引擎，不连接数据库，不推送、不合并、不部署。

## 2. API 契约

`organization.api.ts` 定义当前后端稳定读模型和最小写 payload，复用 `apiFetch` 与现有中文错误解析模式，暴露：

- `fetchOrganizationDirectory()` -> `GET /organization/directory`
- `createOrganizationDepartment(payload)` -> `POST /organization/departments`
- `updateOrganizationDepartment(departmentId, payload)` -> `PATCH /organization/departments/:departmentId`
- `updateOrganizationUser(userId, payload)` -> `PATCH /organization/users/:userId`

要求：

- path ID 必须 `encodeURIComponent`。
- JSON 只发送允许字段；密码只能在请求体中出现。
- `confirmationPassword` 保留原值，不 trim 后发送。
- API 测试精确断言 method/path/body，并覆盖中文后端错误。

## 3. 纯 helper

`organization.config.ts` 至少提供：

- 部门树扁平化，生成深度、上级名称和层级路径；对异常树输入安全去重。
- 可选父部门列表：只含启用部门，编辑时排除自身和全部后代。
- 人员本地过滤：姓名、电话、部门、状态、全局岗位、项目岗位关键词。
- 部门/人员状态和岗位展示文本。
- `buildCreateDepartmentPayload`、`buildDepartmentPatch`、`buildUserPatch`：
  - 名称 trim；密码原值保留。
  - `null` 明确清空，`undefined` 不写入。
  - patch 只包含真实变化；无变化固定中文拒绝。
  - 名称最多 100、密码最多 256 个 Unicode code point。
- 新建/编辑/停用动作的后果说明文案。

纯 helper 测试覆盖上述边界，特别覆盖 Unicode、密码首尾空格、后代排除、`null`/`undefined` 和岗位只读展示。

## 4. 路由与权限

在 `route-records.ts`：

- 新增 `organizationAdminRoleKeys = ["super_admin"]`。
- “资料与治理”增加“组织权限”导航 `/组织权限`，携带该角色要求。
- 新增子路由 `组织权限`，组件为 `OrganizationManagementPage.vue`，`meta.requiredRoleKeys` 使用同一常量。
- 新增兼容重定向 `organization -> /组织权限`。

路由测试证明：

- `super_admin` 可见且可访问。
- 非 `super_admin` 和无岗位用户看不到导航，直接访问会回首页。
- 中英文路由保持稳定。

后端类级 `@RequirePositions("super_admin")` 仍是最终安全边界，Web 不自行扩大权限。

## 5. 页面与交互

页面使用 TDesign 和 `--jg-*` token：

- 页头：标题“组织权限”、说明、刷新按钮、新建部门按钮。
- 顶部 `t-alert`：明确本切片只维护部门、人员归属和启停；岗位、项目岗位、项目成员只读。
- `BusinessStatusSummary`：部门数、启用人员、停用人员、岗位数。
- 左侧部门卡：`t-table` 展示层级部门、上级、状态、编辑；不提供删除。
- 右侧人员卡：本地筛选器与 `t-table`，展示姓名、电话、部门、状态、首次改密状态、全局岗位、项目岗位、编辑。
- 底部固定岗位字典卡：TDesign tags，只读且无编辑入口。

一个共享 `t-dialog` 根据 action kind 渲染三类表单：

1. 新建部门：名称、启用上级部门。
2. 编辑部门：名称、上级、启停；停用文案提示必须先处理启用人员/下级。
3. 编辑人员：部门归属、启停；停用文案提示立即阻止登录和办理业务，但保留历史/岗位。

交互要求：

- 当前密码字段 `type=password`、`autocomplete=current-password`。
- 密码只驻留页面内存；成功、失败、取消或关闭都清空。
- busy 时禁用重复提交和关闭。
- 不叠加 `window.confirm`，由同一对话框展示后果并完成确认。
- 不乐观更新；成功后重新 GET 目录。
- 失败保留业务表单值供修正，但清空密码并展示后端中文错误。
- 后端是部门环、停用约束、最后管理员保护和权限的权威来源。

## 6. TDD 与验收

先写 API/config/route 测试并运行 RED，证明失败来自文件、路由和 helper 缺失；再写实现。

RED / GREEN：

```bash
pnpm --filter @jiangkong/web-admin test -- src/api/organization.api.test.ts src/pages/organization/organization.config.test.ts src/routes/index.test.ts
```

完整门禁：

```bash
pnpm --filter @jiangkong/web-admin test -- src/api/organization.api.test.ts src/pages/organization/organization.config.test.ts src/routes/index.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
git diff --check
```

完成后更新 `PROGRESS.md`，明确部门/人员核心组织 UI 已完成，但全局岗位、项目岗位、项目成员写入、影响预览和真实数据初始化仍未完成。独立复审必须检查路由权限、密码生命周期、payload 最小化、失败处理、TDesign/token 治理和只读岗位边界。
