# 建工智管 Web Admin 响应式治理 R3 结算专业工作区报告

> 完成日期：2026-07-14
>
> 分支：`codex/ui-responsive-governance`
>
> 范围：阶段 4 结算工作台与结算模板

## 1. 本阶段结果

结算工作台、结算模板台账和模板治理已接入响应式治理，不改变任何结算事实或动作。

- 工作台基本信息按内容容器宽度从四列降为两列、单列。
- 1680px 结算选行专业表保留全部业务列、固定列与后端核算金额，仅由 TDesign 表格内容区横向滚动。
- Excel 错误表、选行表和人工调整表分别拥有自己的表格内容滚动边界，外层面板不再滚动。
- 原按侧栏宽度计算的视口级固定合计条改为页面流内 sticky，不再与实际内容宽度脱节。
- 模板推荐面板按自身宽度重排，不再依赖浏览器 viewport。
- 模板台账仅由 TDesign 表格内容区滚动，操作列继续固定右侧。
- 模板检查与脱敏预览作为 720px 紧凑专业工作区局部滚动；页头、规则、上传和版本动作不参与横向滚动。

## 2. 滚动所有权

| 页面/模块 | 唯一横向滚动所有者 | 滚动区外保留内容 |
| --- | --- | --- |
| 工作台·Excel 错误 | 错误表 `.t-table__content` | 下载、上传、预检摘要和应用动作 |
| 工作台·合同清单 | 选行表 `.t-table__content` | 页头、基本信息、模板推荐、工具栏和合计 |
| 工作台·人工调整 | 调整表 `.t-table__content` | 区块标题和合计提交 |
| 结算模板库 | 台账 `.t-table__content` | 页头、创建入口和错误反馈 |
| 结算模板治理 | `.inspection-workspace` | 页头、模板表单、上传、规则和版本动作 |

## 3. 实际修改文件

- `apps/web-admin/src/app/responsive-layout.css`
- `apps/web-admin/scripts/check-ui-rules.mjs`
- `apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue`
- `apps/web-admin/src/pages/settlements/components/SettlementTemplateRecommendationPanel.vue`
- `apps/web-admin/src/pages/settlement-templates/SettlementTemplateListPage.vue`
- `apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue`
- `apps/web-admin/src/pages/settlements/settlement-workbench.structure.test.ts`
- `apps/web-admin/src/pages/settlement-templates/settlement-template.structure.test.ts`
- `apps/web-admin/e2e/settlement-workbench.e2e.ts`
- `apps/web-admin/e2e/settlement-template-governance.e2e.ts`
- `UI_RESPONSIVE_GOVERNANCE_MASTER_PLAN.md`
- `UI_RESPONSIVE_R3_SETTLEMENT_WORKSPACE_REPORT.md`
- `PROGRESS.md`

## 4. 验证结果

| 检查 | 结果 |
| --- | --- |
| 结算定向 Vitest | 4 个文件，26/26 通过 |
| `typecheck` | 通过 |
| `lint` / E2E lint | 通过 |
| `check:ui` | 通过 |
| 工作台/模板 Playwright | 2/2 通过 |
| 六档文档横向溢出 | 均为 0 |
| 六档父子嵌套横向滚动 | 均为 0 |
| `git diff --check` | 通过 |
| 受保护目录差异 | 空 |

内置浏览器会话停在强制修改初始密码页，为避免触碰真实凭据未继续操作。按降级策略使用仓库 Playwright 和稳定 Mock 验证，未读写生产数据。

## 5. 截图

目录：`/Users/leoyang/.codex/visualizations/2026/07/14/ui-responsive-governance/r3-settlement-workspace`

- `settlement-workbench-<宽度>x<高度>.png`：6 张。
- `settlement-template-editor-<宽度>x<高度>.png`：6 张。
- `settlement-template-list-<宽度>x<高度>.png`：6 张。

覆盖 1512×982、1440×900、1280×800、1180×820、1024×768、900×768。

## 6. 未改变事项

未修改后端或 Web API、路由、权限、模板发布/停用门禁、选行与人工调整规则、后端金额核算、元分转换、Excel 预检/应用、文件上传 API/类型/大小/权限或生产。未推送、未部署。
