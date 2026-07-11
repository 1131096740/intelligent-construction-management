# Permission Integrity Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development and superpowers:test-driven-development. Implement this plan in one focused commit, then request an independent review.

**Goal:** 在现有“组织权限”页展示后端权限完整性预检，让全局超级管理员在岗位写入开放前清楚看到规范写源、阻断项、遗留项目岗位和双源影子授权。

**Architecture:** 扩展现有 `organization.api.ts` 读取 `GET /organization/permission-integrity`，在同域 config 中做固定中文标签和展示模型转换，在 `OrganizationManagementPage.vue` 增加只读预检卡。页面刷新同时读取组织目录与预检；部门/人员写成功后只需刷新目录，因为本切片写操作不修改岗位事实。预检不增加任何修复按钮或岗位写入口。

**Tech Stack:** Vue 3, TypeScript, TDesign Vue Next, Vitest.

---

## 1. 文件与范围

**Files:**

- Modify: `apps/web-admin/src/api/organization.api.ts`
- Modify: `apps/web-admin/src/api/organization.api.test.ts`
- Modify: `apps/web-admin/src/pages/organization/organization.config.ts`
- Modify: `apps/web-admin/src/pages/organization/organization.config.test.ts`
- Modify: `apps/web-admin/src/pages/organization/OrganizationManagementPage.vue`
- Modify: `PROGRESS.md`

不改路由权限、不改后端、不增加写操作、不修改岗位/项目成员、不连接数据库、不推送/合并/部署。

## 2. API 与展示模型

在 `organization.api.ts` 增加与后端一致的 PermissionIntegrity 类型和：

- `fetchPermissionIntegrity()` -> `GET /organization/permission-integrity`

API 测试精确断言路径、GET、中文错误回退。

在 `organization.config.ts` 增加纯 helper：

- issue code 中文标签；未知值安全回退。
- source 中文标签。
- severity 对应 TDesign tone 与“阻断/警告”。
- policy/readiness 中文摘要。
- issue 行转换，稳定输出 user/project/role/assignment IDs 的缺省占位。
- summary items：阻断项、警告项、遗留项目岗位、双源重叠。

不得重新实现后端分类或 readiness 判断；Web 只展示服务端事实。

## 3. 页面

在组织页顶部组织摘要之后增加“岗位数据预检”卡：

- `t-alert`：明确全局规范源 `UserPosition(projectId=null)`、项目规范源 `ProjectMember`，项目级 UserPosition 仅兼容读取。
- 两个 readiness tag：规范岗位写入是否就绪、遗留迁移是否就绪。
- `BusinessStatusSummary` 或同等 TDesign summary：阻断、警告、遗留项目岗位、双源重叠。
- `t-table`：严重级别、问题、来源、人员、项目、岗位、相关记录；空态“未发现权限数据问题”。
- 无任何“修复/迁移/删除/分配”按钮。

加载语义：

- 页面首次进入/点击刷新时并行读取 directory 和 integrity，各自保留独立错误文案。
- integrity 失败不能清空已成功的 directory；directory 失败不能伪造预检成功。
- 刷新 busy 防重复。
- 部门/人员 mutation 成功后沿用现有目录刷新，不宣称预检已刷新；岗位事实未变化。

样式全部使用 `--jg-*` token，控件全部 TDesign。

## 4. TDD 与验收

先补 API/config 测试并运行 RED，再实现。

```bash
pnpm --filter @jiangkong/web-admin test -- src/api/organization.api.test.ts src/pages/organization/organization.config.test.ts src/routes/index.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
git diff --check
```

完成后更新 `PROGRESS.md`，明确该页面只展示代码/数据预检，尚未对生产执行预检，也未开放影响预览、迁移或岗位写入。独立复审必须检查不重算后端事实、独立加载错误、只读边界和 UI 治理。
