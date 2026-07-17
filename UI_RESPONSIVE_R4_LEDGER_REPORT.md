# 建工智管 Web Admin 响应式治理 R4 台账与主数据报告

> 更新日期：2026-07-14
>
> 分支：`codex/ui-responsive-governance`
>
> 状态：阶段 5A–5B 已完成

## 1. 阶段 5A 结果

审批中心、资料库、审计日志、审批委托台账和全局搜索已纳入 Ledger 响应式治理。

- 审批中心不是宽表，不伪造横向滚动区；五列任务行按实际内容宽度重排为单列卡片。
- 资料库台账、委托台账、全局搜索和审计台账均只由 TDesign `.t-table__content` 横向滚动，操作列继续固定右侧。
- 审计日志的文件下载审计和通用审计分别拥有局部表格滚动边界，整张 TCard body 不再滚动。
- 资料、审计筛选器和委托新增表单按内容容器宽度降列，页头和主动作始终在表格滚动区外。
- `check:ui` 对已登记 Ledger 的 TDesign 表格强制要求 `jg-table-region`；对无表格的审批卡片列表允许纯响应式重排。

## 2. 阶段 5B 结果

往来单位、项目花名册和组织权限已纳入同一响应式治理体系。

- 往来单位的新增表单在容器窄化时从六列降为两列和单列，单位台账只由表格内容区滚动。
- 项目花名册的筛选器和页头在窄容器中自然换行，人员表保持完整字段并在表格内局部滚动。
- 组织权限的部门、人员与岗位数据区在中等桌面宽度改为上下结构；三张数据表各自由 TDesign 表格内容区承担滚动。
- 新增人员、岗位预览撤销、批量撤销和新增岗位 Drawer 按自身容器宽度重排；影响列表仅在 Drawer 内的表格区滚动。
- 组织权限页显式将专业宽数据滚动权委派给子表格，页头、完整性提示、摘要和主操作始终位于滚动区之外。

## 3. 完整滚动所有权

| 页面 | 横向滚动所有者 | 滚动区外内容 |
| --- | --- | --- |
| 审批中心 | 无，任务行自然重排 | 页头、页签、错误和空态 |
| 资料库 | 资料表 `.t-table__content` | 页头、摘要、规则、筛选、反馈和下载对话框 |
| 审计日志 | 两张表各自的 `.t-table__content` | 页头、摘要、规则、筛选和反馈 |
| 委托台账 | 委托表 `.t-table__content` | 页头、新增委托表单和提交反馈 |
| 全局搜索 | 结果表 `.t-table__content` | 页头、搜索、列设置、摘要和反馈 |
| 往来单位 | 单位表 `.t-table__content` | 页头、查询、新增表单和反馈 |
| 项目花名册 | 人员表 `.t-table__content` | 页头、项目语义和筛选 |
| 组织权限 | 完整性、部门和人员表各自的 `.t-table__content` | 页头、安全提示、摘要、部门树、筛选和主操作 |
| 组织权限 Drawer | Drawer 内影响表的 `.t-table__content` | Drawer 标题、规则、表单和提交操作 |

## 4. 实际修改文件

- `apps/web-admin/src/pages/approval-center/ApprovalCenterPage.vue`
- `apps/web-admin/src/pages/archives/ArchiveListPage.vue`
- `apps/web-admin/src/pages/audit/AuditLogPage.vue`
- `apps/web-admin/src/pages/delegations/DelegationListPage.vue`
- `apps/web-admin/src/pages/search/GlobalSearchPage.vue`
- `apps/web-admin/src/pages/ledger-responsive.structure.test.ts`
- `apps/web-admin/e2e/ledger-responsive.e2e.ts`
- `apps/web-admin/src/pages/business-parties/BusinessPartyListPage.vue`
- `apps/web-admin/src/pages/projects/ProjectRosterPage.vue`
- `apps/web-admin/src/pages/organization/OrganizationManagementPage.vue`
- `apps/web-admin/src/pages/organization/components/OrganizationBatchRoleRemovalDrawer.vue`
- `apps/web-admin/src/pages/organization/components/OrganizationRoleAdditionDrawer.vue`
- `apps/web-admin/src/pages/organization/components/OrganizationRoleRemovalDrawer.vue`
- `apps/web-admin/src/pages/organization/components/OrganizationUserCreationDrawer.vue`
- `apps/web-admin/src/pages/master-data-responsive.structure.test.ts`
- `apps/web-admin/e2e/master-data-responsive.e2e.ts`
- `apps/web-admin/scripts/check-ui-rules.mjs`
- `UI_RESPONSIVE_GOVERNANCE_MASTER_PLAN.md`
- `UI_RESPONSIVE_R4_LEDGER_REPORT.md`
- `PROGRESS.md`

## 5. 验证

| 检查 | 结果 |
| --- | --- |
| 定向 Vitest | 5 个文件，27/27 通过 |
| `typecheck` | 通过 |
| `lint` / E2E lint | 通过 |
| `check:ui` | 通过 |
| 六档 Playwright | 1/1 通过，覆盖 5 页×6 尺寸 |
| 六档文档横向溢出 | 均为 0 |
| 六档父子嵌套横向滚动 | 均为 0 |
| `git diff --check` | 通过 |
| 受保护目录差异 | 空 |

截图目录：`/Users/leoyang/.codex/visualizations/2026/07/14/ui-responsive-governance/r4-ledger-stage5a`，共 30 张，覆盖 1512×982、1440×900、1280×800、1180×820、1024×768和 900×768。

阶段 5B 验证：

| 检查 | 结果 |
| --- | --- |
| 定向 Vitest | 4 个文件，79/79 通过 |
| `typecheck` | 通过 |
| `lint` / E2E lint | 通过 |
| `check:ui` | 通过 |
| 六档 Playwright | 1/1 通过，覆盖 3 页×6 尺寸及 2 个 900px Drawer |
| 六档文档横向溢出 | 均为 0 |
| 六档父子嵌套横向滚动 | 均为 0 |
| `git diff --check` | 通过 |
| 受保护目录差异 | 空 |

截图目录：`/Users/leoyang/.codex/visualizations/2026/07/14/ui-responsive-governance/r4-ledger-stage5b`，共 20 张。

## 6. 未改变事项

未修改 API、路由、权限、审批动作、资料下载鉴权/密码/原因/审计、委托创建或撤销逻辑、搜索数据源、单位档案规则、组织岗位归属、岗位变更权限或个人列偏好。未读写生产，未推送，未部署。
