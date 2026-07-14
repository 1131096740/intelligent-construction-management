# 建工智管企业级 UI P0 样板改造完成报告

> 完成日期：2026-07-14
>
> 实施依据：`UI_P0_IMPLEMENTATION_PLAN.md`
>
> 技术栈：Vue 3 + TypeScript + TDesign Vue Next
>
> 结论：P0 样板已在限定范围内落地，静态检查、全量 Vitest、P0 E2E 与三档桌面截图验收均已完成。

---

## 1. 实施结论与范围边界

本轮建立了一套可验证、可复用、可逐页迁移的企业级 UI 样板，实施面包括：

1. Design Token 基线。
2. `AdminLayout` 全局壳层。
3. `HomePage` 工作台。
4. `PaymentListPage` 付款台账。
5. `PaymentWorkbenchPage` 付款申请工作台。
6. `PaymentDetailPage` 付款详情。

范围审计结果：

- 未修改后端 API、数据库、路由地址、角色权限、业务状态或审批逻辑。
- 未改变合同、结算、付款的金额计算及后端事实来源。
- 未修改合同、结算、项目经营等范围外页面实现。
- 未引入第二套 UI 库，未新增渐变、玻璃拟态、彩色大阴影、装饰动画或经营大屏。
- 未对全站做机械式颜色替换；仅调整全局 token 的基础语义并保留旧别名。
- `UI_DESIGN_SYSTEM_AUDIT.md` 仅用于读取审计事实，未被修改。
- `PROGRESS.md` 未修改：用户本轮明确限定了可修改文件范围，该文件不在授权列表中；合入时需由项目负责人补录，或另行授权更新。

---

## 2. 实际修改文件

### 2.1 文档

- `UI_P0_IMPLEMENTATION_PLAN.md`
- `UI_P0_IMPLEMENTATION_REPORT.md`

### 2.2 Token 与全局壳层

- `apps/web-admin/src/app/design-tokens.css`
- `apps/web-admin/src/app/AdminLayout.vue`
- `apps/web-admin/src/app/admin-layout.structure.test.ts`

### 2.3 首页工作台

- `apps/web-admin/src/pages/home/HomePage.vue`
- `apps/web-admin/src/pages/home/home.config.ts`
- `apps/web-admin/src/pages/home/home.config.test.ts`

### 2.4 付款业务页

- `apps/web-admin/src/pages/payments/PaymentListPage.vue`
- `apps/web-admin/src/pages/payments/payment-list.config.ts`
- `apps/web-admin/src/pages/payments/payment-list.config.test.ts`
- `apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue`
- `apps/web-admin/src/pages/payments/payment-workbench.structure.test.ts`
- `apps/web-admin/src/pages/payments/PaymentDetailPage.vue`
- `apps/web-admin/src/pages/payments/payment-detail.config.ts`
- `apps/web-admin/src/pages/payments/payment-detail.config.test.ts`

### 2.5 新增公共业务组件与测试

- `apps/web-admin/src/components/BusinessPageHeader.vue`
- `apps/web-admin/src/components/BusinessDetailHeader.vue`
- `apps/web-admin/src/components/BusinessFeedback.vue`
- `apps/web-admin/src/components/MoneyInput.vue`
- `apps/web-admin/src/components/money-input.config.ts`
- `apps/web-admin/src/components/money-input.config.test.ts`
- `apps/web-admin/src/components/SensitiveActionDialog.vue`
- `apps/web-admin/src/components/sensitive-action-dialog.config.ts`
- `apps/web-admin/src/components/sensitive-action-dialog.config.test.ts`
- `apps/web-admin/src/components/PaymentConfirmationSummary.vue`
- `apps/web-admin/src/components/payment-confirmation-summary.config.ts`
- `apps/web-admin/src/components/payment-confirmation-summary.config.test.ts`
- `apps/web-admin/src/components/ui-p0-components.structure.test.ts`

### 2.6 UI 检查与 E2E

- `apps/web-admin/scripts/check-ui-rules.mjs`
- `apps/web-admin/e2e/admin-navigation-visual.e2e.ts`
- `apps/web-admin/e2e/payment-workbench.e2e.ts`
- `apps/web-admin/e2e/p0-browser-smoke.e2e.ts`
- `apps/web-admin/e2e/ui-p0-visual.e2e.ts`
- `apps/web-admin/e2e/organization-user-creation.e2e.ts`：仅对齐当前已存在的“待本人确认 + 初始岗位”读模型和测试 fixture，未修改组织权限页或业务逻辑。

`check:ui` 已移除 `AdminLayout.vue`、`HomePage.vue`、`PaymentListPage.vue`、`PaymentDetailPage.vue` 的整文件迁移豁免；目标页现在真正受规则约束。原生文件输入仅作为现有上传链路的就近注释例外保留。

---

## 3. 新增公共组件

| 组件 | 职责 | 不承担的职责 |
| --- | --- | --- |
| `BusinessPageHeader` | 统一列表/工作台页标题、说明、辅助动作和唯一主动作 | 不判断路由、权限或业务状态 |
| `BusinessDetailHeader` | 统一详情编号、标题、状态、责任人、当前节点、下一步 | 不推断审批人或可执行动作 |
| `BusinessFeedback` | 统一 loading、error、success、info、permission 反馈和可选重试 | 不吞掉业务错误，不修改请求状态 |
| `MoneyInput` | 统一“用户输入元”、必填标识和就近错误位置 | 不另造金额算法；仍调用现有 money helper |
| `SensitiveActionDialog` | 收集敏感操作的影响确认、原因和当前密码，提供 loading/error/cancel | 不调 API，不判断 `availableActions` |
| `PaymentConfirmationSummary` | 提交前不可编辑的财务复核摘要，显示缺失字段 | 不重新计算可付额度，不伪造银行信息 |

现有 `BusinessStatusSummary`、`BusinessTableToolbar`、`EmptyBusinessState`、`BusinessActionPanel`、`EvidenceFileCards`、`ApprovalTimeline`、`ApprovalSelfReviewFields` 均直接复用，没有包装无业务意义的 TDesign Button、Input、Select、Card 或 Table。

---

## 4. Design Token 变化

| 类别 | 新基线 | 实际影响 |
| --- | --- | --- |
| 页面/面板 | `#ffffff` | 页面和主要内容区以白色为主 |
| 局部浅灰 | `#f5f7fa` / `#f3f6fb` | 仅用于 hover、禁用、表头和局部分区 |
| 品牌色 | `#0052d9` | 对齐 TDesign 主操作蓝，不建立第二品牌色 |
| 语义色 | success `#2ba471`、warning `#d9822b`、danger `#c9353f` | 只表示明确业务状态，同时配文字 |
| 字号 | 24 / 16 / 14 / 13 / 12px | 页标题、区块标题、正文/表单、表格次要、辅助文字 |
| 字重 | 400 / 500 / 600 / 700 | 统一正文、重点数据、区块标题和页标题 |
| 圆角 | control 4px / panel 6px / overlay 8px | 保留旧 `sm/md/lg` 作为兼容别名 |
| 阴影 | panel `none` / overlay `0 8px 24px rgba(...)` | 普通面板只用边框，阴影仅供浮层 |
| 布局 | sidebar 208px / header 48px / content 24px / compact 16px | 壳层尺寸由 token 统一控制 |
| 表格 | row 44px | 目标页中金额/数量右对齐，操作列固定右侧 |
| focus | 3px 品牌蓝 outline | 键盘 `focus-visible` 可见 |
| 图标 | 16 / 18 / 20px | 建立小/中/大语义尺寸，本轮未新增装饰图标 |

---

## 5. 页面前后差异

### 5.1 AdminLayout

| 改造前 | 改造后 |
| --- | --- |
| 尺寸局部硬编码 | 侧栏、顶栏、内容边距全部由 token 控制 |
| 最近访问使用原生按钮 | 使用 TDesign Button |
| 选中态使用内阴影 | 品牌浅蓝底 + 3px 左边框，无阴影 |
| hover/focus/disabled 分散 | 统一为 token 化状态 |

### 5.2 HomePage

| 改造前 | 改造后 |
| --- | --- |
| 三列大卡片队列 | 紧凑摘要 + 三业务语义页签 + 44px 工作项表格 |
| 无筛选 | 项目、业务类型、状态、关键词筛选 |
| 无排序 | 按阻塞、超时、金额风险、停留时间排序 |
| 整卡点击、hover 阴影 | 每行一个明确主办理动作，普通容器无阴影 |
| 反馈风格不一 | 统一加载、失败、空态、筛选无结果和刷新成功反馈 |

保留了“待我处理、阻塞事项、我发起的进行中”三种业务语义，未新增经营图表或 KPI 大卡。

### 5.3 PaymentListPage

| 改造前 | 改造后 |
| --- | --- |
| 页面内自建头部、摘要、工具栏 | 标准页面头 + 紧凑摘要 + `BusinessTableToolbar` |
| 原生 checkbox 列设置 | TDesign Checkbox，保留按用户隔离的本地列偏好 |
| 数据范围不明确 | 明确标注当前 API 仅有 `limit`，无 `offset/page/total` |
| 空态与失败弱 | 统一错误反馈、重试、空态和筛选无结果 |

本轮没有渲染伪分页；金额保持右对齐，操作列保持固定右侧，行内动作未超过三个。

### 5.4 PaymentWorkbenchPage

| 改造前 | 改造后 |
| --- | --- |
| 表单与后端预览分散 | 标准页面头 + 统一表单 + 后端额度解释 + 只读确认摘要 |
| 金额普通输入 | `MoneyInput` 明确用户输入“元”、两位小数和错误位置 |
| 无提交前财务复核面 | 确认摘要展示收款方、项目、来源、阶段、额度、已付、待付、本次金额、发票/附件和用途 |
| 无未保存离开提醒 | 站内路由使用 TDesign 敏感操作对话框，关闭/刷新使用标准 `beforeunload` |
| 失败信息不说明恢复方式 | 说明发生事项、原因与下一步，失败后保留已填内容 |

付款来源、合同/结算选择、`buildPaymentCreatePayload`、`yuanTextToCentsText` 和后端额度预览保持不变。可申请额度只展示后端 `preview.capacity.maxRequestableCents`，前端未另行重算。

### 5.5 PaymentDetailPage

| 改造前 | 改造后 |
| --- | --- |
| 所有内容长页平铺 | 标准详情头 + 紧凑状态摘要 + 6 个业务页签 |
| 编号、责任人、节点与下一步分散 | 详情头首屏统一展示 |
| 原生 `confirm/prompt` | 审批、实付、入账、归档、撤回、转审/委托、审批单和文件下载均通过 `SensitiveActionDialog` |
| 原生 `datetime-local` | TDesign DatePicker，时间 payload 仍使用原有 ISO 转换 |
| 加载/失败/空态分散 | `BusinessFeedback` + 页签内明确空态 |
| 多个动作同时视觉突出 | 仅后端 `primaryAction` 对应动作使用主按钮，其余使用次级/文字/危险层级 |

六个页签为：概览、流程、凭证资料、实付与入账、关联记录、审计。`availableActions`、`primaryAction`、文件权限、金额转换和所有 API payload 仍是原业务事实。

---

## 6. 测试与验收结果

| 验收项 | 结果 | 说明 |
| --- | --- | --- |
| `typecheck` | 通过 | `vue-tsc --noEmit` |
| `lint` | 通过 | ESLint 无 error/无 warning |
| `check:ui` | 通过 | 目标页整文件豁免已收紧 |
| Web 全量 Vitest | 通过 | 78 个测试文件，582/582 测试通过 |
| P0 Playwright E2E | 通过 | 21 通过，2 按现有条件跳过，0 失败 |
| UI P0 视觉 E2E | 通过 | 4 页、3 尺寸、17 张截图，含稳定状态 |
| `git diff --check` | 通过 | 无空白错误 |

P0 E2E 的 2 个条件跳过项为：

1. 受限账号的结算/付款详情权限验证，需 `E2E_LIMITED_PHONE` 和 `E2E_LIMITED_PASSWORD`。
2. 真实临时密码账号强制改密，需 `E2E_TEMP_PHONE`、`E2E_TEMP_PASSWORD` 和 `E2E_NEW_PASSWORD`。

这两项为仓库原有的环境条件用例，不是本轮回归失败；本轮没有伪造真实账号或绕过首次改密门禁。

---

## 7. 截图位置与状态覆盖

截图根目录：

`/Users/leoyang/.codex/visualizations/2026/07/14/ui-p0-samples`

### 7.1 正常态（每页三档）

- `home-normal-1440x900.png`
- `home-normal-1280x800.png`
- `home-normal-1024x768.png`
- `payment-ledger-normal-1440x900.png`
- `payment-ledger-normal-1280x800.png`
- `payment-ledger-normal-1024x768.png`
- `payment-workbench-normal-1440x900.png`
- `payment-workbench-normal-1280x800.png`
- `payment-workbench-normal-1024x768.png`
- `payment-detail-normal-1440x900.png`
- `payment-detail-normal-1280x800.png`
- `payment-detail-normal-1024x768.png`

### 7.2 稳定可复现状态

- `home-empty-1440x900.png`：首页空态。
- `payment-ledger-failure-1440x900.png`：付款台账失败 + 重试反馈。
- `payment-workbench-disabled-1440x900.png`：付款工作台禁用与阻断说明。
- `payment-detail-disabled-1440x900.png`：付款详情禁用动作与原因。
- `payment-detail-loading-1440x900.png`：付款详情加载态。

所有正常态文件已校验为精确的 1440×900、1280×800、1024×768。截图使用 Playwright 隔离 mock 数据生成，不读取或写入真实业务数据。

---

## 8. 未解决问题与明确阻塞

### 8.1 付款台账服务端分页

现有 `GET /payments` 只接收 `limit`，返回只有 `rows + summary`，没有 `offset/page/total/hasMore`。后端 API 不在本轮范围内，因此：

- 本轮没有伪分页。
- 页面已明确显示当前数据范围和阻塞原因。
- 后续需先定义服务端查询契约，再接 TDesign Pagination。

### 8.2 收款银行与付款用途字段

当前付款创建读模型不提供收款银行账号、开户行，也没有独立付款用途字段。本轮按财务复核要求保留展示位，并明确显示“当前系统未提供”：

- 未伪造银行信息。
- 未从其他跨权限页面偷取数据。
- 未扩展创建 payload。

后续应由产品、合同、财务共同确认账户版本化、脱敏、变更审计和付款时快照规则，不应只增一个前端输入框。

### 8.3 实际登录环境

本地真实应用在登录后命中“首次修改密码”门禁。验收未读取凭据、未检查存储、未绕过门禁；因此三档截图使用隔离 Playwright 读模型。正式 UAT 仍需已完成改密且具有对应角色的验收账号。

### 8.4 上传控件

付款详情仍保留原生 `input[type=file]`，因为现有上传策略、文件对象和 API 链路直接依赖该输入。该例外已有就近 checker 注释，本轮没有为视觉一致性重写文件业务链路。

---

## 9. 后续迁移建议

### P1：先补关键数据契约

1. 为付款台账设计真实服务端分页契约：`page/pageSize/total` 或 `cursor/hasMore`，并保证摘要统计不被当前页切片污染。
2. 设计收款账户主数据与付款申请快照：版本、脱敏、修改权限、确认人、生效时点和审计。
3. 用真实角色账号完成一轮首页→付款台账→付款工作台→审批→实付→入账 UAT。

### P1：样板小步推广

1. 等本轮财务/合同/项目业务代表签字后，先将 `BusinessPageHeader`、`BusinessFeedback`、表格工具栏规范迁移到一个低风险列表页。
2. 每次只迁移 1–2 个页面，同步移除对应 checker 豁免并增加视觉 E2E。
3. 合同和结算详情不做机械复制，先核对它们的生效、归档、版本和阻断语义。

### P2：形成可持续 Design System 治理

1. 为 token 增加文档化分组、废弃别名清单和迁移截止日，不在 P0 直接删除旧 token。
2. 将重复超过两次的真实业务结构提取为组件，不增加通用 Button/Input/Card 薄包装。
3. 持续缩小 `check:ui` 迁移白名单，将“改完一页、治理一页、验收一页”作为固定门禁。

---

## 10. 回滚与交付建议

本轮不含数据库迁移、后端发布或真实数据写入，可按前端聚焦变更回滚：

1. Token、公共组件和四个目标页应作为同一个 P0 样板版本验收，避免仅回滚一半导致双重视觉系统。
2. 如敏感操作回归，同时回滚 `PaymentDetailPage` 和 `SensitiveActionDialog`，不保留半套对话框链路。
3. 如财务认为确认摘要字段不足，先回滚/调整展示组件，不修改金额 helper 和后端额度逻辑。
4. 正式合入前建议由合同、财务、项目管理三方代表使用真实验收账号快速复核一次主链，并将结论补入 `PROGRESS.md`。
