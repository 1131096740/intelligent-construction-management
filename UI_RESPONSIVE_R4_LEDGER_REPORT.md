# 建工智管 Web Admin 响应式治理 R4 台账与主数据报告

> 更新日期：2026-07-14
>
> 分支：`codex/ui-responsive-governance`
>
> 状态：阶段 5A 已完成；阶段 5B 待执行

## 1. 阶段 5A 结果

审批中心、资料库、审计日志、审批委托台账和全局搜索已纳入 Ledger 响应式治理。

- 审批中心不是宽表，不伪造横向滚动区；五列任务行按实际内容宽度重排为单列卡片。
- 资料库台账、委托台账、全局搜索和审计台账均只由 TDesign `.t-table__content` 横向滚动，操作列继续固定右侧。
- 审计日志的文件下载审计和通用审计分别拥有局部表格滚动边界，整张 TCard body 不再滚动。
- 资料、审计筛选器和委托新增表单按内容容器宽度降列，页头和主动作始终在表格滚动区外。
- `check:ui` 对已登记 Ledger 的 TDesign 表格强制要求 `jg-table-region`；对无表格的审批卡片列表允许纯响应式重排。

## 2. 滚动所有权

| 页面 | 横向滚动所有者 | 滚动区外内容 |
| --- | --- | --- |
| 审批中心 | 无，任务行自然重排 | 页头、页签、错误和空态 |
| 资料库 | 资料表 `.t-table__content` | 页头、摘要、规则、筛选、反馈和下载对话框 |
| 审计日志 | 两张表各自的 `.t-table__content` | 页头、摘要、规则、筛选和反馈 |
| 委托台账 | 委托表 `.t-table__content` | 页头、新增委托表单和提交反馈 |
| 全局搜索 | 结果表 `.t-table__content` | 页头、搜索、列设置、摘要和反馈 |

## 3. 阶段 5A 修改文件

- `apps/web-admin/src/pages/approval-center/ApprovalCenterPage.vue`
- `apps/web-admin/src/pages/archives/ArchiveListPage.vue`
- `apps/web-admin/src/pages/audit/AuditLogPage.vue`
- `apps/web-admin/src/pages/delegations/DelegationListPage.vue`
- `apps/web-admin/src/pages/search/GlobalSearchPage.vue`
- `apps/web-admin/src/pages/ledger-responsive.structure.test.ts`
- `apps/web-admin/e2e/ledger-responsive.e2e.ts`
- `apps/web-admin/scripts/check-ui-rules.mjs`
- `UI_RESPONSIVE_GOVERNANCE_MASTER_PLAN.md`
- `UI_RESPONSIVE_R4_LEDGER_REPORT.md`
- `PROGRESS.md`

## 4. 阶段 5A 验证

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

## 5. 未改变事项

未修改 API、路由、权限、审批动作、资料下载鉴权/密码/原因/审计、委托创建或撤销逻辑、搜索数据源或个人列偏好。未读写生产，未推送，未部署。

## 6. 阶段 5B 待补充

往来单位台账、项目花名册和组织权限治理完成后，在本报告追加主数据滚动所有权、测试、截图与未改变边界。
