# 建工智管 Web Admin 响应式与横向滚动治理主计划

> 创建日期：2026-07-14
>
> 基线分支：`codex/ui-responsive-governance`
>
> 基线提交：`87a5b582621e41baaf699d21009906be67c03907`
>
> 技术栈：Vue 3 + TypeScript + TDesign Vue Next
>
> 计划状态：阶段 0–2 已完成；阶段 3–8 待依次实施

## 1. 目标与范围

本计划在不改变业务逻辑、业务状态、权限、API、路由、金额和文件规则的前提下，建立成熟企业后台的三层响应式机制：

1. 普通页面、表单和详情按可用内容宽度重排。
2. 宽表格只在表格数据区域横向滚动。
3. 合同模板、合同清单、文档画布、历史接管、结算选行等专业工作区保留可读最小宽度，并在专业工作区内部滚动。
4. 页头、主操作、反馈和规则说明不进入横向滚动区。
5. 全局内容横向滚动只作为极小窗口和未迁移遗留页的最后兜底。
6. 任一页面同一方向只允许一个主动横向滚动所有者，禁止父子嵌套横向滚动条。

本轮不进行全站换肤、控件库迁移、业务重构、API 分页扩展或历史 CSS 机械替换。只有为建立明确滚动所有权和可用重排所必需的模板、类名、Token、样式、检查规则和测试可以修改。

## 2. 执行前事实核验

| 核验项 | 阶段 0 结果 |
| --- | --- |
| 原分支 | `main` |
| 原 HEAD | `87a5b582621e41baaf699d21009906be67c03907` |
| 相对 `origin/main` | behind 0 / ahead 5 |
| 工作区 | 干净，无用户未提交修改冲突 |
| 活跃 worktree | 当前仓库根工作树；本分支不操作其他 worktree |
| 当前项目阶段 | 生产等价验证、真实试运行准备、Web Admin UI 治理推广 |
| P0/P1 样板 | AdminLayout、首页、付款、结算台账/详情、合同台账/详情已本地验证 |
| 主计划文档 | 执行前不存在，由阶段 0 创建 |
| 受保护目录 | 阶段 0 无差异 |

现状与既有 UI 报告一致：P0/P1 样板已具备局部表格滚动和窄宽度重排；合同模板、合同工作台、历史接管、结算工作台、组织权限、项目经营及若干台账仍按浏览器视口断点判断，未统一按后台实际内容宽度治理。

## 3. 响应式模式与滚动所有权

### 3.1 Flow：普通表单/设置

- 根页面保持 `min-width: 0`，禁止主动整页横向滚动。
- 多列表单按页面内容容器宽度逐步从多列降为两列、单列。
- 主操作随表单流重排，但不得被裁切或移入局部横向滚动区。
- 文件、日期、权限和提交逻辑保持原样。

### 3.2 Ledger：台账/列表

- 页面头、统计、筛选、错误反馈和范围说明始终保持在页面流中。
- 仅表格数据区拥有横向滚动权；表格业务主键可固定左侧，操作列固定右侧。
- 外层 Card/Panel 不再通过 `overflow-x:auto` 让整块内容滚动。
- 表格最小宽度使用 Design Token 或 TDesign 列宽事实，不在页面重复写大像素值。

### 3.3 Workspace：专业工作区

- 页头、保存/提交、反馈和就绪检查在工作区外。
- 清单编辑、文档画布、结算选行、模板列编辑等专业区域拥有唯一横向滚动权。
- 专业工作区使用受控最小宽度，保证字段列、画布坐标和固定列含义不被破坏。
- 同一工作区不得再由 TDesign 内层内容生成第二条同向滚动条。

### 3.4 Detail：详情页

- 详情头和任务页签响应式重排；关键事实不得因窄屏隐藏。
- 关联明细宽表按 Ledger 规则局部滚动。
- 普通事实列表和动作表单按容器宽度重排，禁止整页主动横滚。

### 3.5 AdminLayout 最后兜底

- 主内容区默认不承担已治理页面的横向滚动。
- 仅极小窗口或尚未迁移的遗留页允许壳层兜底，不得与页面局部滚动同时形成可见双滚动条。
- 侧栏、顶栏、最近访问和页脚不参与业务工作区横向滚动。

## 4. 34 个顶层页面审计矩阵

| 页面 | 模式 | 风险 | 阶段 | 治理结论 |
| --- | --- | --- | --- | --- |
| `ApprovalCenterPage.vue` | Ledger | 高 | 5A | 五列工作项改为容器响应，必要宽度由数据区承担 |
| `ArchiveListPage.vue` | Ledger | 中 | 5A | 保留表格局部滚动，筛选按内容宽度重排 |
| `AuditLogPage.vue` | Ledger | 中 | 5A | 合并滚动所有权，修正两套宽筛选网格 |
| `BusinessPartyEditorPage.vue` | Flow | 高 | 6 | 三列表单和附件行按容器重排 |
| `BusinessPartyListPage.vue` | Ledger | 高 | 5B | 六列筛选重排，表格建立单一滚动边界 |
| `ContractNumberRulePage.vue` | Ledger | 中高 | 2 | 规则表建立局部滚动边界 |
| `ContractScenarioGovernancePage.vue` | Ledger | 高 | 2 | 两张宽表分别归属数据区滚动 |
| `ContractTemplateEditorPage.vue` | Workspace | 极高 | 2 | 十列编辑器保持字段对应关系并局部滚动，不再整体变单列 |
| `ContractTemplateListPage.vue` | Ledger | 中 | 2 | 配置态表格建立局部滚动边界 |
| `LayoutTemplateEditorPage.vue` | Workspace | 高 | 2 | 四列表单响应重排；版式工作区保留合理最小宽度 |
| `StandardClauseLibraryPage.vue` | Ledger | 极高 | 2 | 四列筛选/发布区重排，宽表局部滚动 |
| `ContractDetailPage.vue` | Detail | 低 | 7 | P1.2 样板，只做六档回归 |
| `ContractListPage.vue` | Ledger | 低 | 7 | P1.2 样板，只做六档回归 |
| `ContractTakeoverPage.vue` | Workspace | 极高 | 3 | 移除全 Card 滚动，分别治理主从区和宽表 |
| `ContractWorkbenchPage.vue` | Workspace | 极高 | 3 | 主区/侧区按内容宽度切换，画布/清单局部滚动 |
| `DelegationListPage.vue` | Ledger | 高 | 5A | 台账局部滚动，表单字段响应重排 |
| `HomePage.vue` | Ledger | 低 | 7 | P0 样板，只做六档回归 |
| `ChangePasswordPage.vue` | Flow | 低 | 7 | 认证页只做六档回归 |
| `LoginPage.vue` | Flow | 低 | 7 | 认证页只做六档回归 |
| `OrganizationManagementPage.vue` | Workspace | 极高 | 5B | 双栏与三张表按容器治理，Drawer 保持可用 |
| `PaymentDetailPage.vue` | Detail | 低 | 7 | P0 样板，只做六档回归 |
| `PaymentListPage.vue` | Ledger | 低 | 7 | P0 样板，只做六档回归 |
| `PaymentWorkbenchPage.vue` | Workspace | 中低 | 7 | P0 样板，只做六档回归 |
| `ProjectExpenseApprovalDetailPage.vue` | Detail | 低 | 6 | 两列事实区按容器重排 |
| `ProjectOperatingOverviewPage.vue` | Detail | 极高 | 6 | 1180/920 宽数据区拆分滚动所有权，不隐藏业务字段 |
| `ProjectRosterPage.vue` | Ledger | 高 | 5B | 筛选与表格建立响应式边界 |
| `RoutePlaceholderPage.vue` | Flow | 低 | 7 | 无宽内容，只做回归 |
| `GlobalSearchPage.vue` | Ledger | 中 | 5A | 搜索栏按容器重排，结果表保持局部滚动 |
| `SettingsPage.vue` | Flow | 中高 | 6 | 两列配置网格按容器降列 |
| `SettlementTemplateEditorPage.vue` | Workspace | 高 | 4 | 上传/检查/预览和规则编辑区按容器治理 |
| `SettlementTemplateListPage.vue` | Ledger | 高 | 4 | 模板表建立局部滚动边界 |
| `SettlementDetailPage.vue` | Detail | 低 | 7 | P1.1 样板，只做六档回归 |
| `SettlementListPage.vue` | Ledger | 低 | 7 | P1.1 样板，只做六档回归 |
| `SettlementWorkbenchPage.vue` | Workspace | 极高 | 4 | 保留 1680px 专业工作区，消除外层与 TDesign 双滚动 |

## 5. Design Token 计划

阶段 1 只新增响应式布局语义，不改变既有视觉方向：

| 新语义 | 用途 |
| --- | --- |
| 内容容器紧凑断点 | 替代仅按浏览器视口判断的页面死区 |
| 台账最小可读宽度 | 表格区域统一局部滚动 |
| 专业工作区窄/中/宽最小宽度 | 合同清单、模板列编辑、文档/结算工作区 |
| 工作区侧栏宽度 | 合同工作台右侧业务信息区 |
| 表单最大宽度 | 普通 Flow 页面避免无意义横向拉伸 |
| 极小窗口兜底宽度 | 仅供壳层最后兜底，不供普通页面使用 |

所有值进入 `design-tokens.css`；页面只引用语义 Token 或共享响应式类。禁止在已治理页面新增 `100vw` 或大于等于 840px 的裸 `min-width`。

## 6. 分阶段准确文件范围

### 阶段 0：审计与主计划

- `UI_RESPONSIVE_GOVERNANCE_MASTER_PLAN.md`
- `PROGRESS.md`

### 阶段 1：响应式治理基础

- `apps/web-admin/src/app/design-tokens.css`
- `apps/web-admin/src/app/AdminLayout.vue`
- `apps/web-admin/src/main.ts`
- `apps/web-admin/src/app/responsive-layout.css`（新增）
- `apps/web-admin/src/components/BusinessPageHeader.vue`
- `apps/web-admin/src/components/BusinessDetailHeader.vue`
- `apps/web-admin/src/components/BusinessStatusSummary.vue`
- `apps/web-admin/src/components/BusinessTableToolbar.vue`
- `apps/web-admin/scripts/check-ui-rules.mjs`
- `apps/web-admin/src/app/admin-layout.structure.test.ts`
- `apps/web-admin/src/app/responsive-layout.structure.test.ts`（新增）
- `apps/web-admin/e2e/helpers/responsive-assertions.ts`（新增）
- `apps/web-admin/e2e/responsive-layout-foundation.e2e.ts`（新增）
- `UI_RESPONSIVE_R0_FOUNDATION_REPORT.md`
- `PROGRESS.md`

### 阶段 2：合同模板管理试点

- `apps/web-admin/src/pages/contract-templates/` 下六个顶层页面
- `apps/web-admin/src/components/ContractTemplateUsagePreviewDrawer.vue`
- 直接结构测试、配置测试和 `contract-template-responsive.e2e.ts`（新增）
- `UI_RESPONSIVE_R1_CONTRACT_TEMPLATES_REPORT.md`
- `PROGRESS.md`

### 阶段 3：合同工作台与历史接管

- `ContractWorkbenchPage.vue`、`ContractTakeoverPage.vue`
- `ContractBillEditor.vue`、`ContractPartySection.vue`、`ContractClausesSection.vue`
- `ContractDocumentsSection.vue`、`ContractDocumentCanvas.vue`、`ContractNegotiationCanvas.vue`
- 直接 Vitest 与现有合同工作台/接管/磋商/变更 E2E
- `UI_RESPONSIVE_R2_CONTRACT_WORKSPACE_REPORT.md`
- `PROGRESS.md`

### 阶段 4：结算工作台与结算模板

- `SettlementWorkbenchPage.vue`
- `SettlementTemplateRecommendationPanel.vue`
- `SettlementTemplateListPage.vue`、`SettlementTemplateEditorPage.vue`
- 直接 Vitest 与现有结算工作台/模板 E2E
- `UI_RESPONSIVE_R3_SETTLEMENT_WORKSPACE_REPORT.md`
- `PROGRESS.md`

### 阶段 5A：审批、资料、审计、委托、搜索台账

- `ApprovalCenterPage.vue`
- `ArchiveListPage.vue`
- `AuditLogPage.vue`
- `DelegationListPage.vue`
- `GlobalSearchPage.vue`
- 直接配置/结构测试与 `ledger-responsive.e2e.ts`（新增）
- `UI_RESPONSIVE_R4_LEDGER_REPORT.md`
- `PROGRESS.md`

### 阶段 5B：往来单位、花名册、组织权限

- `BusinessPartyListPage.vue`
- `ProjectRosterPage.vue`
- `OrganizationManagementPage.vue`
- `organization/components/` 下四个 Drawer
- 直接配置/结构测试与 `master-data-responsive.e2e.ts`（新增）
- 继续更新 `UI_RESPONSIVE_R4_LEDGER_REPORT.md`
- `PROGRESS.md`

### 阶段 6：普通表单、费用详情、项目概览、设置

- `BusinessPartyEditorPage.vue`
- `ProjectExpenseApprovalDetailPage.vue`
- `ProjectOperatingOverviewPage.vue`
- `SettingsPage.vue`
- 直接配置/结构测试与 `flow-detail-responsive.e2e.ts`（新增）
- `UI_RESPONSIVE_R5_FORM_DETAIL_REPORT.md`
- `PROGRESS.md`

### 阶段 7：全站回归

- 原则上只修改阶段 1–6 已治理文件和响应式测试；仅在六档回归证明确有公共基础回归时触达 P0/P1 样板页。
- 生成 1512×982、1440×900、1280×800、1180×820、1024×768、900×768 截图。
- `UI_RESPONSIVE_GOVERNANCE_FINAL_REPORT.md`
- `PROGRESS.md`

### 阶段 8：发布候选审计

- `UI_RESPONSIVE_RELEASE_READINESS.md`
- 必要时补充最终报告和 `PROGRESS.md`
- 不推送 `main`、不部署、不写生产。

## 7. 不得改变的业务逻辑与风险点

1. `services/api`、`packages/shared-domain`、`apps/web-admin/src/api`、`apps/web-admin/src/routes` 为受保护范围。
2. 不修改数据库、Prisma、迁移、API 地址/参数、路由地址和角色权限。
3. 不改变合同、结算、付款金额事实、元分转换、审批、保存、发布、归档或上传逻辑。
4. 不因窄屏隐藏字段；响应式只改变排列与滚动边界。
5. 合同模板十列编辑器必须保持列与字段对应关系，禁止为适配改成语义混乱的整行单列。
6. 合同清单与结算选行必须保留业务列宽、固定列和合计关系。
7. 调整 viewport 后已填写表单值、已选择文件和当前业务状态不得丢失。
8. `check:ui` 的历史视觉 allowlist 不得为追求数字机械清空；响应式治理建立独立文件集和规则。

## 8. 检查与测试策略

每阶段顺序固定：

1. 定向 Vitest/结构测试。
2. 定向 Playwright，优先复用现有 E2E。
3. `pnpm --filter @jiangkong/web-admin typecheck`
4. `pnpm --filter @jiangkong/web-admin lint`
5. `pnpm --filter @jiangkong/web-admin check:ui`
6. 阶段要求时运行 Web 全量 Vitest。
7. `git diff --check`
8. 受保护目录 diff 必须为空。

最终阶段追加：

```bash
pnpm --filter @jiangkong/web-admin test
pnpm --filter @jiangkong/web-admin build
pnpm --filter @jiangkong/web-admin test:e2e:p0
```

说明：仓库中的 `test:e2e:p0` 实际匹配全部 `*.e2e.ts`；阶段定向执行必须显式指定 E2E 文件，最终才跑该全量命令。

## 9. 六档浏览器验收标准

每个目标页面在 1512×982、1440×900、1280×800、1180×820、1024×768、900×768 下至少满足：

- 文档根节点无意外横向溢出。
- 页头标题、主动作、反馈和返回/刷新入口可见。
- Ledger 的横向滚动只发生在数据表区域。
- Workspace 的横向滚动只发生在指定专业工作区。
- 横向滚动后固定操作列或关键固定列仍可用。
- 不存在父子两个可滚动且有溢出的横向容器。
- 普通 Flow/Detail 内容自然重排，不靠缩小关键文字或隐藏字段。
- 调整窗口前后的输入、选择和禁用状态保持不变。
- 页面无 `pageerror`，无新增相关控制台错误。

截图使用稳定 Mock 或隔离测试数据，统一输出到 `/Users/leoyang/.codex/visualizations/2026/07/14/ui-responsive-governance/`；不读取或写入生产数据。

## 10. Check UI 治理计划

新增独立响应式治理集合：

- `responsiveLedgerFiles`
- `responsiveWorkspaceFiles`
- `responsiveFlowFiles`
- `responsiveDetailFiles`

对已迁移文件约束：

- 必须接入对应页面根类和唯一滚动容器类。
- 页面不得自行新增 `overflow-x:auto|scroll`。
- 禁止 `100vw` 撑宽后台内容区。
- 大型工作区最小宽度必须来自 Token/共享类。
- 规则自测同时覆盖合规与违规样例。

嵌套滚动和固定列行为由 Playwright 断言，不使用脆弱正则替代浏览器事实。

## 11. 阶段门禁、提交与回滚

- 每阶段开始前重新读取 `PROGRESS.md` 和本计划。
- 每阶段只修改本节列出的文件；如浏览器证据要求增加直接关联文件，必须先在计划的实施记录中说明。
- 每阶段更新 `PROGRESS.md`，形成一个独立 Conventional Commit。
- 每阶段提交前运行：

```bash
git diff -- services/api packages/shared-domain apps/web-admin/src/api apps/web-admin/src/routes
```

结果必须为空。

回滚按阶段提交逆序执行 `git revert <sha>`；响应式治理不含数据库迁移、生产数据或 API 变更。若阶段 1 公共基础回滚，后续依赖阶段必须一并逆序回滚，禁止保留只剩页面类名或只剩共享 CSS 的半套状态。

## 12. 发布边界

阶段 8 只形成发布候选和目标 SHA。未获得用户对目标 SHA 的明确批准前：

- 不推送 `main`。
- 不部署生产。
- 不执行生产写入。
- 不执行数据库迁移。

发布候选报告必须列出分支、目标 SHA、相对 main 提交、实际修改文件、受保护目录、测试、截图、迁移、未解决问题和回滚方式。
