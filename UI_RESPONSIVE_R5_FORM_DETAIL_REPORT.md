# 建工智管 Web Admin 响应式治理 R5 表单与详情报告

> 更新日期：2026-07-14
>
> 分支：`codex/ui-responsive-governance`
>
> 状态：阶段 6 已完成

## 1. 治理结果

本阶段将合作单位档案编辑、项目支出审批详情、项目经营和系统设置接入已有 Flow/Detail 响应式语义。

- 合作单位表单按实际内容宽度从三列降为两列、单列；附件行在中等宽度重排，不改上传控件、文件类型和提交逻辑。
- 合作单位版本历史只由 TDesign 表格内容区横向滚动，页头、表单、附件和主操作不参与滚动。
- 项目支出审批的两列事实区在窄容器中降为单列，页头和审批按钮可重排，不隐藏金额、节点或审批事实。
- 项目经营摘要、业务入口、经营口径和资金办理表单按内容宽度渐进降列；项目选择、页签、提示和办理操作始终在页面流中。
- 跨项目经营表和支出明细表分别使用共享滚动边界，宽度改用响应式 Design Token，页面不再声明自有 `overflow-x` 或裸像素大宽度。
- 系统设置的账号、审批规则、业务字典和治理配置网格改为内容容器断点，在中等桌面宽度稳定降为单列。

## 2. 滚动所有权

| 页面/区域 | 横向滚动所有者 | 滚动区外内容 |
| --- | --- | --- |
| 合作单位编辑 | 版本历史 `.t-table__content` | 页头、档案表单、附件、反馈和主操作 |
| 项目支出详情 | 无，事实和动作自然重排 | 全部业务内容 |
| 项目经营概览 | 跨项目表 `.jg-workspace-scroll` | 页头、项目选择、摘要、业务入口、口径和数据缺口 |
| 项目资金办理 | 支出明细表 `.jg-workspace-scroll` | 页签、收款/代付/支出表单、操作和反馈 |
| 系统设置 | 无，配置网格自然重排 | 全部账号与配置内容 |

项目经营的两张宽表位于不同页签，不会同时构成两个可见横向滚动条。

## 3. 实际修改文件

- `apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue`
- `apps/web-admin/src/pages/projects/ProjectExpenseApprovalDetailPage.vue`
- `apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue`
- `apps/web-admin/src/pages/settings/SettingsPage.vue`
- `apps/web-admin/src/pages/flow-detail-responsive.structure.test.ts`
- `apps/web-admin/e2e/flow-detail-responsive.e2e.ts`
- `apps/web-admin/scripts/check-ui-rules.mjs`
- `UI_RESPONSIVE_GOVERNANCE_MASTER_PLAN.md`
- `UI_RESPONSIVE_R5_FORM_DETAIL_REPORT.md`
- `PROGRESS.md`

## 4. 验证

| 检查 | 结果 |
| --- | --- |
| 定向 Vitest | 8 个文件，39/39 通过 |
| `typecheck` | 通过 |
| `lint` / E2E lint | 通过 |
| `check:ui` | 通过 |
| 六档 Playwright | 1/1 通过，覆盖 4 页及项目概览/资金办理两个页签 |
| 截图 | 30 张 |
| 六档文档横向溢出 | 均为 0 |
| 六档父子嵌套横向滚动 | 均为 0 |
| 页面运行错误 | 0 |
| 1512px → 900px 表单值保持 | 通过 |
| `git diff --check` | 通过 |
| 受保护目录差异 | 空 |

截图目录：`/Users/leoyang/.codex/visualizations/2026/07/14/ui-responsive-governance/r5-form-detail`。

## 5. 未改变事项

未修改任何 API、路由、角色权限、项目可见性、金额计算、元分转换、合作单位版本规则、收款/代付/支出办理、审批、文件上传或设置保存逻辑。未读写生产，未推送，未部署。
