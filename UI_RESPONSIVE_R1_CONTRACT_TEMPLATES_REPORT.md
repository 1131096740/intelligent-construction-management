# 建工智管 Web Admin 响应式治理 R1 合同模板试点报告

> 完成日期：2026-07-14  
> 分支：`codex/ui-responsive-governance`  
> 范围：阶段 2 合同模板管理试点

## 1. 本阶段结果

合同模板管理的六个顶层页面已采用 R0 的 Ledger/Workspace 模式，未重新设计页面，也未改变模板治理流程。

- 合同模板库、标准条款库、合同编号规则和合同业务场景归入 Ledger。
- 业务模板编辑器和版式模板治理归入 Workspace。
- 页头、治理操作、反馈和新建表单保持在正常页面流中。
- 台账只由 `.t-table__content` 产生横向滚动；表格外层不滚动。
- 业务模板字段/清单/条款/附件/校验五个页签各自只有一个专业编辑区滚动所有者。
- 版式检查与预览使用紧凑专业区边界；普通表单仍按内容容器重排。
- 模板结构预览抽屉由自身宽度触发重排，不依赖浏览器总宽度。

## 2. 关键问题与处理

### 十列模板编辑器

旧实现用浏览器 `max-width: 1100px` 将十列编辑行整体改为单列。这在后台侧栏占用宽度后会过早触发，字段与操作的横向对应关系丢失，页面变成极长表单。

现实现保持十列网格及 1040px 标准专业区宽度，由当前页签的编辑区内部横向滚动。页头、版本状态、保存/提交/发布和页签不进入滚动区。

### TDesign 表格

试点确认最小宽度必须设置到 `.t-table__content > table`，不能设置到 TDesign 表格根节点；否则根节点本身变宽后会被外层裁切，真正的内容容器不会成为滚动所有者。R0 公共样式已在本阶段修正并由浏览器断言覆盖。

### 配置与治理页面

模板配置、条款、编号和场景表格使用标准/宽台账 Token，操作列固定右侧并启用底部横向滚动条吸附。表单和页头按 `jg-page` 容器宽度重排，不再按完整视口宽度猜测。

## 3. 实际修改文件

- `apps/web-admin/src/app/responsive-layout.css`
- `apps/web-admin/scripts/check-ui-rules.mjs`
- `apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue`
- `apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue`
- `apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue`
- `apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue`
- `apps/web-admin/src/pages/contract-templates/ContractNumberRulePage.vue`
- `apps/web-admin/src/pages/contract-templates/ContractScenarioGovernancePage.vue`
- `apps/web-admin/src/components/ContractTemplateUsagePreviewDrawer.vue`
- `apps/web-admin/src/pages/contract-templates/contract-template-responsive.structure.test.ts`
- `apps/web-admin/e2e/contract-template-responsive.e2e.ts`
- `UI_RESPONSIVE_GOVERNANCE_MASTER_PLAN.md`
- `UI_RESPONSIVE_R1_CONTRACT_TEMPLATES_REPORT.md`
- `PROGRESS.md`

`ContractTemplateEditorPage.vue`、`ContractScenarioGovernancePage.vue` 和 `LayoutTemplateEditorPage.vue` 的较多行差异来自现有 ESLint 对新增嵌套容器执行的模板缩进格式化，业务表达式、请求与事件处理未改变。

## 4. 自动治理

六个顶层页面已加入 `responsiveGovernedFiles`：

- Ledger 页面必须包含 `jg-responsive-ledger` 与 `jg-table-region`。
- Workspace 页面必须包含 `jg-responsive-workspace` 与 `jg-workspace-scroll`。
- 所有页面继续禁止页面根横向滚动、`100vw` 和大像素裸 `min-width`。

## 5. 验证结果

| 检查 | 结果 |
| --- | --- |
| 定向 Vitest | 7 个文件，45/45 通过 |
| `typecheck` | 通过 |
| `lint` | 通过，无告警 |
| `check:ui` | 通过 |
| 合同模板/场景 Playwright | 4/4 通过 |
| 六档文档横向溢出 | 均为 0 |
| 六档父子嵌套横向滚动 | 均为 0 |
| `git diff --check` | 通过 |
| 受保护目录差异 | 空 |

浏览器验证使用仓库现有登录与业务接口 mock；所有模板写请求均被阻断，未为截图修改真实数据。应用内浏览器的本地会话仍停留在强制修改初始密码页，为避免触碰真实凭据，继续使用仓库 Playwright 隔离验证。

## 6. 截图

目录：`/Users/leoyang/.codex/visualizations/2026/07/14/ui-responsive-governance/r1-contract-templates`

- `contract-template-list-<宽度>x<高度>.png`：6 张。
- `contract-template-editor-<宽度>x<高度>.png`：6 张。

覆盖 1512×982、1440×900、1280×800、1180×820、1024×768、900×768。

## 7. 未改变事项

本阶段没有修改后端或 Web API、数据库、路由、角色权限、模板状态机、发布/停用/克隆规则、合同创建规则、文件上传 API/类型/大小/权限，也没有执行生产写入、推送或部署。
