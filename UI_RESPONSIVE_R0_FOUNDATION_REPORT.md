# 建工智管 Web Admin 响应式治理 R0 基础报告

> 完成日期：2026-07-14
>
> 分支：`codex/ui-responsive-governance`
> 范围：阶段 1 响应式公共基础

## 1. 本阶段结果

R0 已在现有 TDesign 与 `--jg-*` 设计系统内建立响应式治理底座，不改变页面业务结构和业务逻辑。页面以后按主内容区的真实可用宽度响应，而不是只按浏览器视口判断。

- Flow/Detail 页面默认重排，不主动产生页面横向滚动。
- Ledger 只允许表格数据区横向滚动。
- Workspace 只允许专业工作区内部横向滚动。
- AdminLayout 默认裁切意外横向溢出；仅小于 720px 的极小窗口启用 720px 主内容兜底。
- 900px 目标尺寸继续使用桌面侧栏，避免完整导航置顶后占满首屏。
- 共享页头、详情头、状态摘要与台账工具栏使用容器查询完成操作区和信息区重排。

## 2. 实际修改文件

- `apps/web-admin/src/app/design-tokens.css`
- `apps/web-admin/src/app/responsive-layout.css`
- `apps/web-admin/src/app/AdminLayout.vue`
- `apps/web-admin/src/main.ts`
- `apps/web-admin/src/components/BusinessPageHeader.vue`
- `apps/web-admin/src/components/BusinessDetailHeader.vue`
- `apps/web-admin/src/components/BusinessStatusSummary.vue`
- `apps/web-admin/src/components/BusinessTableToolbar.vue`
- `apps/web-admin/scripts/check-ui-rules.mjs`
- `apps/web-admin/src/app/admin-layout.structure.test.ts`
- `apps/web-admin/src/app/responsive-layout.structure.test.ts`
- `apps/web-admin/e2e/helpers/responsive-assertions.ts`
- `apps/web-admin/e2e/responsive-layout-foundation.e2e.ts`
- `PROGRESS.md`
- `UI_RESPONSIVE_GOVERNANCE_MASTER_PLAN.md`
- `UI_RESPONSIVE_R0_FOUNDATION_REPORT.md`

## 3. Token 与公共语义

新增的尺寸 Token 只描述布局能力，不建立第二套视觉系统：

| Token | 用途 |
| --- | --- |
| `--jg-layout-page-min-width-fallback` | 极小窗口主内容最终兜底宽度 |
| `--jg-layout-form-max-width` | 普通表单可读最大宽度 |
| `--jg-layout-ledger-table-min-width` | 标准台账表格最小宽度 |
| `--jg-layout-ledger-table-wide-min-width` | 宽台账表格最小宽度 |
| `--jg-layout-workspace-min-width-compact` | 紧凑专业区最小宽度 |
| `--jg-layout-workspace-min-width-standard` | 标准专业区最小宽度 |
| `--jg-layout-workspace-min-width-wide` | 文档/复杂专业区最小宽度 |
| `--jg-layout-workspace-sidebar-width` | 专业工作区侧栏基准宽度 |

新增公共语义类：`jg-responsive-flow`、`jg-responsive-ledger`、`jg-responsive-workspace`、`jg-responsive-detail`、`jg-table-region` 与 `jg-workspace-scroll`。这些类只负责滚动所有权与重排边界，不包装 TDesign 基础组件。

## 4. 检查规则

`check:ui` 新增响应式治理检查能力，迁移页面可逐阶段加入清单，并检查：

- 是否声明正确的页面模式根类；
- Ledger 是否声明局部表格区；
- Workspace 是否声明专业滚动区；
- 是否出现 `100vw`；
- 是否在页面根或普通容器上启用横向滚动；
- 是否重新写入大于等于 800px 的裸 `min-width`。

原视觉迁移豁免与响应式治理清单相互独立，因此历史视觉债务不会阻止页面进入本轮响应式规则。

## 5. 验证结果

| 检查 | 结果 |
| --- | --- |
| 定向 Vitest | 5 个文件，13/13 通过 |
| `typecheck` | 通过 |
| `lint` | 通过 |
| `check:ui` | 通过，含规则自检 |
| Playwright | 2/2 通过 |
| `git diff --check` | 通过 |
| 受保护目录差异 | 空 |

Playwright 对 1512×982、1440×900、1280×800、1180×820、1024×768、900×768 六档尺寸逐一验证：文档无横向溢出、无父子嵌套横向滚动、页头和主操作可见。应用内浏览器可连接，但现有本地会话停留在强制修改初始密码页面；为避免触碰真实凭据，页面级验证使用仓库现有稳定 mock 的 Playwright 能力。

## 6. 截图位置

`/Users/leoyang/.codex/visualizations/2026/07/14/ui-responsive-governance/r0-foundation`

共生成 6 张首页截图，文件名为 `foundation-home-<宽度>x<高度>.png`。

## 7. 边界与下一阶段

本阶段没有修改业务 API、路由、权限、状态、金额、文件上传规则或生产数据；没有引入依赖、动画、渐变或阴影。专业页面尚未套用滚动语义，阶段 2 将只处理合同模板管理试点并把对应页面加入强制检查清单。
