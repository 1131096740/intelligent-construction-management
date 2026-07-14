# 建工智管 Web Admin 响应式治理 R2 合同专业工作区报告

> 完成日期：2026-07-14  
> 分支：`codex/ui-responsive-governance`  
> 范围：阶段 3 合同工作台与历史接管

## 1. 本阶段结果

合同工作台和历史接管已采用“复合专业工作区”的滚动所有权：顶层页面不滚，当前可见的清单、文档画布或 TDesign 台账承担局部滚动。

- 合同工作台在可用内容宽度大于 1080px 时保留画布/业务侧栏双栏；不足时改为上下结构。
- 合同主体、条款、文档、文档画布和磋商画布按各自实际容器宽度重排。
- 合同清单沿用既有原生表格编辑与保存逻辑，仅把 `.table-wrap` 明确为专业滚动所有者。
- 文档画布沿用既有安全打开入口，仅把 `.canvas-stage` 明确为画布滚动所有者。
- 历史接管的页头、摘要、进度、表单和详情不横向滚动。
- 导入预检、接管准备和合同台账三张 TDesign 表格分别拥有局部滚动，通用 TCard body 不再滚动。
- 历史接管台账/详情在宽内容区并排，在不足 1120px 的内容区上下排列。

## 2. 滚动所有权

| 页面/模块 | 唯一横向滚动所有者 | 页面外保留内容 |
| --- | --- | --- |
| 合同工作台·清单 | `ContractBillEditor .table-wrap` | 状态头、摘要、页签、保存与就绪检查 |
| 合同工作台·文档 | `ContractDocumentCanvas .canvas-stage` | 文档工具栏、页签、业务侧栏 |
| 合同工作台·其他页签 | 无主动横向滚动 | 全部信息按容器重排 |
| 历史接管·导入预检 | 对应 `.t-table__content` | 预检表单、按钮、摘要 |
| 历史接管·接管批次 | 对应 `.t-table__content` | 区块标题与空态 |
| 历史接管·接管台账 | 对应 `.t-table__content` | 页头、进度、详情和证据动作 |

`check:ui` 新增复合工作区委托标记 `data-jg-scroll-owner="child"`。只有顶层页面不直接滚动、且滚动明确由活动子工作区承担时才能使用该标记；普通 Workspace 仍必须声明本级 `jg-workspace-scroll`。

## 3. 实际修改文件

- `apps/web-admin/scripts/check-ui-rules.mjs`
- `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- `apps/web-admin/src/pages/contracts/workbench/ContractBillEditor.vue`
- `apps/web-admin/src/pages/contracts/workbench/ContractPartySection.vue`
- `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue`
- `apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue`
- `apps/web-admin/src/pages/contracts/workbench/ContractDocumentCanvas.vue`
- `apps/web-admin/src/pages/contracts/workbench/ContractNegotiationCanvas.vue`
- `apps/web-admin/src/pages/contracts/contract-workspace-responsive.structure.test.ts`
- `apps/web-admin/e2e/contract-workbench-canvas.e2e.ts`
- `apps/web-admin/e2e/contract-takeover-responsive.e2e.ts`
- `UI_RESPONSIVE_GOVERNANCE_MASTER_PLAN.md`
- `UI_RESPONSIVE_R2_CONTRACT_WORKSPACE_REPORT.md`
- `PROGRESS.md`

## 4. 验证结果

| 检查 | 结果 |
| --- | --- |
| 定向 Vitest | 7 个文件，63/63 通过 |
| `typecheck` | 通过 |
| `lint` | 通过 |
| E2E 文件 lint | 通过 |
| `check:ui` | 通过 |
| 工作台/接管/磋商/变更 Playwright | 9/9 通过 |
| 六档文档横向溢出 | 均为 0 |
| 六档父子嵌套横向滚动 | 均为 0 |
| `git diff --check` | 通过 |
| 受保护目录差异 | 空 |

既有 390px 历史接管用例原先要求文档绝不横向溢出，与 R0 明确的“小于 720px 主内容整体滚动作为最后兜底”冲突。本阶段没有删除或跳过用例，而是将其改为验证 720px 兜底确实启用、上传操作仍位于兜底内容范围且可见；900px 及以上六档桌面验证仍严格要求文档无横向溢出。

## 5. 截图

目录：`/Users/leoyang/.codex/visualizations/2026/07/14/ui-responsive-governance/r2-contract-workspace`

- `contract-workbench-<宽度>x<高度>.png`：6 张。
- `contract-takeover-<宽度>x<高度>.png`：6 张。

覆盖 1512×982、1440×900、1280×800、1180×820、1024×768、900×768。

## 6. 未改变事项

未修改后端或 Web API、路由、权限、合同状态、审批/用章/归档/变更逻辑、手工金额与元分转换、可付/可结算事实、清单新增与保存接口、文件上传 API/类型/大小/权限、历史接管状态或证据规则。未连接生产、未推送、未部署。
