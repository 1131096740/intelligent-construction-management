# 建工智管企业级 UI P0 样板改造实施计划

> 编制日期：2026-07-14
>
> 依据：`PROGRESS.md`、`AGENTS.md`、`UI_DESIGN_SYSTEM_AUDIT.md` 与当前代码事实
>
> 目标：不改变任何业务逻辑、后端事实和路由契约，建立一套可验证、可复用、可逐页推广的企业级 UI 样板

---

## 1. 范围结论

本轮不是全站换肤，也不是历史债务清零。六个目标面为：

1. Design Token 基线。
2. `AdminLayout` 全局壳层。
3. `HomePage` 工作台。
4. `PaymentListPage` 付款台账。
5. `PaymentWorkbenchPage` 付款申请工作台。
6. `PaymentDetailPage` 付款详情。

本轮只在这些目标面及其直接依赖的公共业务组件、配置、测试和 UI 检查规则内形成样板。合同、结算、项目经营、组织、资料库、审批中心等页面不改模板、不改逻辑、不做机械式颜色替换。

### 1.1 不采用 Image Gen 的原因

本轮是在已有 Vue 3 + TDesign Design System 内进行的受限样板改造，视觉方向、颜色、密度、圆角、间距、页面结构和禁止项已经由用户与审计报告明确，不需要生成装饰性视觉资产或另起一套概念设计。实现以本计划和用户给定规范为唯一视觉规格。

---

## 2. 当前六个目标面的结构与主要问题

### 2.1 Design Token

当前结构：`design-tokens.css` 已提供 95 个 `--jg-*` token，并保留 `--jg-bg-*`、`--jg-text-*` 等兼容别名。

主要问题：

- 页面背景为大面积浅灰，不符合本轮“白色为主”的要求。
- 品牌蓝为 `#0052cc`，与当前 TDesign 主色存在细微分叉。
- 控件/面板/浮层圆角仍以 `sm/md/lg` 命名，缺少业务语义。
- 普通面板阴影仍不是 `none`。
- 侧栏、顶栏、表格行高分别定义为 240/56/46px，与真实 208/48px 和目标 44px 不一致。
- 缺少字体族、字重、内容区边距、focus ring、禁用文本、图标尺寸等基础语义。

### 2.2 AdminLayout

当前结构：固定侧栏 + 顶栏 + 最近访问条 + 内容区 + 备案页脚；导航按角色过滤。

主要问题：

- `t-aside width="208px"`、顶栏 48px、内容区 24px仍为局部硬编码，未由 token 控制。
- 最近访问使用原生 `button`。
- 侧栏大面积浅灰，普通结构仍依赖多组硬编码颜色。
- hover、active、focus 的视觉规则不完全统一；focus 主要靠局部覆盖。
- 响应式尺寸与桌面尺寸各自维护，缺少紧凑内容边距 token。

保持不变：导航分组、角色过滤、最近访问存储、路由地址、当前用户显示和备案信息。

### 2.3 HomePage

当前结构：页面头 + 错误/加载/空态 + 三列队列 + 每项 142px 大卡片。

主要问题：

- 三种业务语义正确，但卡片模式在真实待办增长后密度过低。
- 缺少项目、业务类型、状态、关键词筛选。
- 缺少阻塞、超时、金额风险和停留时间排序。
- 使用原生 `button`、卡片 hover 阴影和多组硬编码状态色。
- 加载、失败、空态和“筛选无结果”没有统一反馈组件。
- 整卡点击使主动作语义不够明确。

保持不变：`/me/work-items` 数据源、三队列语义、权限范围、工作项目标路由。

### 2.4 PaymentListPage

当前结构：页面头 + 摘要条 + 四条规则 + 筛选条 + 列设置 + TDesign 表格。

主要问题：

- 页面头、摘要、筛选、消息和表格容器均为页面内实现。
- 列设置使用原生 checkbox。
- “查询”实际重新拉取同一批数据，筛选仍在前端，按钮语义容易误导。
- 无统一空态、失败反馈和数据范围说明。
- 虽然操作列已固定右侧、金额已右对齐，但没有服务端分页。

已确认分页阻塞：

- 现有 `GET /payments` 只接收 `limit`。
- 返回结构只有 `rows + summary`，没有 `offset/page/total/hasMore`。
- 后端 API 不在本轮允许修改范围内。
- 因此本轮明确展示“分页暂不可用”的数据范围说明，不新增 `t-pagination`，不切片当前数组伪装成服务端分页。

保持不变：付款行数据、汇总口径、筛选语义、个人列偏好、详情路由和新建工作台路由。

### 2.5 PaymentWorkbenchPage

当前结构：页面头 + 新建卡片 + 项目/合同/来源/结算/编号/金额 + 合同累计付款预览 + 创建动作。

主要问题：

- 缺少提交前不可编辑的付款确认摘要。
- 金额虽以元输入并由现有 helper 转分，但没有统一 MoneyInput 的错误位置和输入语义。
- 失败反馈只有单条 Alert，未明确“发生了什么/为什么/下一步”。
- 没有未保存更改的站内离开提醒。
- 表单与后端预览的关系正确，但财务复核信息分散。

已确认数据边界：

- `ContractBusinessOptionReadModel` 提供相对方、合同、金额、版本和结算列表。
- `ContractPaymentApplicationPreviewReadModel` 提供后端可申请额度、已实付、审批中、已批待付、发票要求和到账期明细。
- 当前付款创建读模型不提供收款银行账号、开户行，也不存储独立付款用途字段。
- 本轮不得改后端，因此确认摘要必须显示这些字段，但对缺失字段明确显示“当前系统未提供”，不得编造、不得跨权限请求合同工作台内部数据。

保持不变：三种付款来源、合同/结算选择、后端付款预览、创建 payload、元转分 helper、后台额度复核和创建成功路由。

### 2.6 PaymentDetailPage

当前结构：页面头 + 两层摘要 + 业务链路 + 流程动作 + 证据 + 时间线 + 基础信息 + 规则 + 实付覆盖 + 分摊 + 两条流程 + 阻断说明。

主要问题：

- 所有内容纵向平铺，文件超过 1,300 行，首屏和长页主次不清。
- 页面头没有统一显示编号、状态、责任人、当前节点和下一步。
- 审批、实付、入账、审批单下载、文件下载使用浏览器原生 `confirm/prompt`。
- 实付和入账时间使用原生 `datetime-local`，普通表单与 TDesign 不统一。
- 加载、失败、成功、无权限和空态存在多种页面内样式。
- 大量硬编码颜色、圆角、间距使该页被 `check:ui` 整文件豁免。

保持不变：所有 `availableActions` 判断、审批/实付/入账/归档/下载 API、金额转换、文件策略、审批自审、实付覆盖、分摊、审计和业务链路数据。

---

## 3. 准备修改的准确文件列表

### 3.1 根目录文档

- `UI_P0_IMPLEMENTATION_PLAN.md`：本计划。
- `UI_P0_IMPLEMENTATION_REPORT.md`：完成后的真实差异、测试、截图和阻塞记录。

### 3.2 现有实现文件

- `apps/web-admin/src/app/design-tokens.css`
- `apps/web-admin/src/app/AdminLayout.vue`
- `apps/web-admin/src/pages/home/HomePage.vue`
- `apps/web-admin/src/pages/home/home.config.ts`
- `apps/web-admin/src/pages/payments/PaymentListPage.vue`
- `apps/web-admin/src/pages/payments/payment-list.config.ts`
- `apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue`
- `apps/web-admin/src/pages/payments/PaymentDetailPage.vue`
- `apps/web-admin/src/pages/payments/payment-detail.config.ts`
- `apps/web-admin/scripts/check-ui-rules.mjs`

### 3.3 计划新增的公共业务组件

- `apps/web-admin/src/components/BusinessPageHeader.vue`
- `apps/web-admin/src/components/BusinessDetailHeader.vue`
- `apps/web-admin/src/components/BusinessFeedback.vue`
- `apps/web-admin/src/components/MoneyInput.vue`
- `apps/web-admin/src/components/SensitiveActionDialog.vue`
- `apps/web-admin/src/components/PaymentConfirmationSummary.vue`
- 上述组件必要的 `*.config.ts`（仅在需要纯函数和独立测试时新增）。

### 3.4 对应测试

- `apps/web-admin/src/pages/home/home.config.test.ts`
- `apps/web-admin/src/pages/payments/payment-list.config.test.ts`
- `apps/web-admin/src/pages/payments/payment-detail.config.test.ts`
- `apps/web-admin/src/pages/payments/payment-workbench.structure.test.ts`
- `apps/web-admin/src/components/ui-p0-components.structure.test.ts`（新增）
- `apps/web-admin/e2e/p0-browser-smoke.e2e.ts`（仅做兼容性调整时修改）
- `apps/web-admin/e2e/payment-workbench.e2e.ts`
- `apps/web-admin/e2e/ui-p0-visual.e2e.ts`（新增，用于四页面、多尺寸与稳定状态截图）

若实施中发现某文件不需要修改，将在完成报告中从“实际修改文件”移除；不得为了与计划一致而制造无意义改动。

---

## 4. 可复用的现有组件

| 组件 | 本轮用途 | 处理原则 |
| --- | --- | --- |
| `BusinessStatusSummary` | 首页和付款台账紧凑摘要、付款详情状态摘要 | 直接复用，不改变默认行为以免影响合同页 |
| `BusinessTableToolbar` | 首页和付款台账筛选工具区 | 直接复用；页面通过 slot 组合 TDesign 控件 |
| `EmptyBusinessState` | 首页筛选无结果、付款台账空态 | 直接复用，不另造空态 |
| `BusinessActionPanel` | 付款详情后端动作说明 | 保持后端 `availableActions` 为真相 |
| `EvidenceFileCards` | 付款凭证和归档资料 | 不改变文件权限、状态和下载事实 |
| `ApprovalTimeline` | 付款审计/审批记录 | 继续作为唯一审批时间线 |
| `ApprovalSelfReviewFields` | 付款审批自审要求 | 保持现有 payload 与必填校验 |

不新增 `Button/Input/Select/Card/Table` 薄包装层。

---

## 5. 新增公共组件及职责

### 5.1 BusinessPageHeader

- 承载页面标题、说明、返回/辅助动作和唯一主动作。
- 只负责布局与可访问语义，不决定路由、权限或业务状态。
- 用于 Home、PaymentList、PaymentWorkbench。

### 5.2 BusinessDetailHeader

- 展示编号/标题、状态、责任人、当前节点、下一步。
- 接收页面提供的只读字段，不推断权限，不创建动作。
- 用于 PaymentDetail。

### 5.3 BusinessFeedback

- 统一 loading/error/success/info/permission 五类反馈。
- 错误文案结构为“发生了什么 + 原因 + 下一步”。
- 可选重试动作；不吞掉原始业务错误。

### 5.4 MoneyInput

- 用户始终输入“元”，最多两位小数。
- 使用现有 `yuanTextToCentsText` 验证，不复制金额算法。
- 统一必填标识、字段错误、inputmode、disabled/loading 语义。
- 对外仍保持元字符串；API payload 继续由现有 builder 安全转分。

### 5.5 SensitiveActionDialog

- 统一影响说明、原因、当前密码、确认按钮、loading、错误和取消。
- 不执行任何 API，也不判断动作权限；只收集确认信息并 emit。
- 用于付款审批、实付、入账、审批单下载、文件下载及其他高风险动作。
- 替代 PaymentDetail 中所有浏览器 `confirm/prompt`。

### 5.6 PaymentConfirmationSummary

- 展示不可编辑的财务复核摘要。
- 展示收款方、银行账号、开户行、项目、合同/结算来源、付款阶段、可申请额度、已付、待付、本次金额、附件/发票要求和付款用途。
- 每个值必须来自当前选择或后端预览；缺失字段显示明确缺口，不伪造。
- 不重新计算后端可申请额度。

---

## 6. Design Token 新旧映射

| 旧 token/事实 | 新语义 token | 新值/规则 | 兼容策略 |
| --- | --- | --- | --- |
| `--jg-color-bg-page: #f4f6f9` | `--jg-color-bg-page` | `#ffffff` | 原名保留，目标面改为白底 |
| `--jg-color-bg-panel` | `--jg-color-bg-surface` | `#ffffff` | `bg-panel` 作为兼容别名 |
| `--jg-color-bg-muted` | `--jg-color-bg-subtle` | 极浅灰，仅 hover/禁用/表头/分区 | `bg-muted` 作为兼容别名 |
| `--jg-color-brand: #0052cc` | `--jg-color-brand` | `#0052d9` | 对齐 TDesign 主色 |
| 无 focus token | `--jg-color-focus-ring` | 品牌蓝外环 | 仅键盘 `:focus-visible` |
| `--jg-radius-sm` | `--jg-radius-control` | 4px | 旧名映射到 control |
| `--jg-radius-md` | `--jg-radius-panel` | 6px | 旧名映射到 panel |
| `--jg-radius-lg` | `--jg-radius-overlay` | 8px | 旧名映射到 overlay |
| `--jg-shadow-panel` | `--jg-shadow-panel` | `none` | 普通面板只用边框 |
| `--jg-shadow-overlay` | 同名 | 仅 Dialog/Drawer/Dropdown | 页面和卡片不得使用 |
| `--jg-layout-sidebar-width: 240px` | 同名 | 208px | 与真实桌面壳层一致 |
| `--jg-layout-header-height: 56px` | 同名 | 48px | 与真实桌面壳层一致 |
| 无内容边距 token | `--jg-layout-content-padding` | 24px | 桌面页面外边距 |
| 无紧凑边距 token | `--jg-layout-content-padding-compact` | 16px | 1024/紧凑场景 |
| `--jg-layout-table-row-height: 46px` | 同名 | 44px | 目标表格统一 |
| 无字体族/字重 | `--jg-font-family-sans`、`--jg-font-weight-*` | 系统中文字体栈、400/500/600/700 | 不引入 Webfont |
| `--jg-font-size-body: 13px` | `--jg-font-size-body` | 14px | 普通正文/表单 14px |
| `--jg-font-size-meta: 12px` | 同名 | 12px | 辅助文字 |
| 无表格次要字号 | `--jg-font-size-table-secondary` | 13px | 表格次要内容 |

旧别名本轮不删除，以免影响范围外页面；目标文件不得新增旧式硬编码颜色、圆角或阴影。

---

## 7. 不得改变的业务逻辑与风险点

### 7.1 硬边界

- 不改变 API 路径、请求方法、payload 和响应结构。
- 不改变任何路由地址或兼容重定向。
- 不改变角色可见性、`availableActions`、按钮权限和禁用原因。
- 不改变付款来源：`contract_due`、`settlement`、`contract_advance`。
- 不改变 `buildPaymentCreatePayload` 和 `yuanTextToCentsText` 的金额规则。
- 不在前端计算或覆盖 `maxRequestableCents`。
- 不改变审批、实付、入账、归档、下载、审计的调用顺序与字段。
- 不改变文件上传策略、MIME/大小限制和私有下载票据。

### 7.2 主要风险

| 风险 | 控制措施 |
| --- | --- |
| 标签/页签重组导致动作不可见 | 所有启用动作仍集中在“流程”页签，详情头显示下一步，E2E 验证动作入口 |
| Dialog 重构丢失密码/原因 | 组件 emit 明确 payload；定向测试校验必填与取消不提交 |
| 表单提交失败清空内容 | 只在成功后清理；失败保留表单和文件选择状态 |
| 元/分错误 | MoneyInput 只验证元字符串，最终转换仍调用现有 builder/helper |
| 前端伪造额度 | 所有额度直接展示后端 preview 字段；未读预览显示“待后端预览” |
| 伪分页 | 明确显示后端分页阻塞，不渲染分页器 |
| 银行信息被编造 | 缺失字段显示“当前系统未提供”，在报告列为后端只读字段待办 |
| Token 改动影响范围外页面 | 保留旧 token 名和别名；只调整全局基础值中符合已确认方向的项目，定向及全量 Web 校验 |
| 长页重组造成 DOM/E2E 回退 | 保留业务文案与 API 函数名，更新结构测试和浏览器冒烟 |

---

## 8. 页面修改前后结构

### 8.1 AdminLayout

修改前：硬编码尺寸的侧栏/顶栏 + 原生最近访问按钮 + 浅灰侧栏/内容区。

修改后：

```text
白色侧栏（208 token）│ 白色顶栏（48 token）
角色导航              │ 最近访问 TDesign 文字按钮
边框分区              │ 白色内容区（24/16 token）
                      │ router-view + 备案
```

### 8.2 HomePage

修改前：三列队列，每项大卡片。

修改后：

```text
BusinessPageHeader + 刷新
BusinessFeedback
BusinessStatusSummary（三队列数量 + 可见项目）
Tabs：待我处理 / 阻塞事项 / 我发起的进行中
BusinessTableToolbar
  项目 / 业务类型 / 状态 / 关键词 / 排序 / 重置
TDesign 工作项表格（44px）
  状态 | 单据 | 项目 | 金额/数量 | 当前节点 | 停留 | 下一步 | 办理
EmptyBusinessState
```

排序只使用后端已返回字段：队列、tone、标题/节点中的超时语义、`amountText` 和 `stayedText`；不创建新的业务状态。

### 8.3 PaymentListPage

修改前：页面内头部/摘要/规则/筛选/原生列设置/TCard 表格。

修改后：

```text
BusinessPageHeader（唯一主操作：新建付款申请；辅助刷新）
BusinessStatusSummary
紧凑业务规则条
BusinessTableToolbar
  项目 / 来源 / 审批状态 / 实付状态 / 关键词 / 列设置 / 重置
BusinessFeedback
边框表格容器 + TDesign Table（金额右对齐、操作固定右侧）
EmptyBusinessState
数据范围说明：后端缺少 offset/total，本轮不做伪分页
```

### 8.4 PaymentWorkbenchPage

修改前：创建表单 -> 可选后端预览 -> 创建按钮。

修改后：

```text
BusinessPageHeader（返回台账）
BusinessFeedback
创建表单（项目/合同/来源/结算/编号/MoneyInput）
后端付款预览与额度解释（原逻辑）
PaymentConfirmationSummary（只读）
  收款/银行/项目/来源/阶段/额度/已付/待付/本次金额/要求/用途
底部动作（一个主操作 + 取消）
SensitiveActionDialog（仅用于未保存离开提醒）
```

### 8.5 PaymentDetailPage

修改前：所有区块纵向平铺，敏感操作使用浏览器弹窗。

修改后：

```text
BusinessDetailHeader（编号/状态/责任人/当前节点/下一步）
BusinessFeedback
BusinessStatusSummary
Tabs
  概览：基础信息、追溯规则、阻断说明
  流程：availableActions、审批/实付/入账/辅助动作、流程步骤
  凭证资料：EvidenceFileCards
  实付与入账：覆盖表、分摊表
  关联记录：业务链路
  审计：ApprovalTimeline + 全局审计入口
SensitiveActionDialog
  审批 / 实付 / 入账 / 下载 / 归档等敏感确认
```

---

## 9. 验收标准

### 9.1 业务不回退

- 所有 API 路径、payload、路由、权限、状态和金额 helper 保持不变。
- 三种付款来源仍可选择。
- 合同累计付款仍必须先读取后端预览。
- 申请金额、审批金额、实付金额、入账金额均以元输入并安全转分。
- 付款审批通过仍只进入已批待付；实付、入账仍分开。

### 9.2 视觉与组件

- 目标页面只使用 TDesign + `--jg-*` token。
- 普通原生 button/select/table/text input 为 0；原生 file input 仅保留带就近注释的必要例外。
- PaymentDetail 不含 `confirm(`、`prompt(` 或旧 helper import。
- 普通面板无阴影；圆角为控件 4px、面板 6px、浮层 8px。
- 目标表格行高 44px，金额/数量右对齐，操作列固定右侧。
- 页面仅一个主操作；颜色不作为状态唯一表达。
- 键盘 focus 可见。

### 9.3 体验状态

- 加载、失败、空态、无权限、成功、禁用至少有统一呈现。
- 提交失败保留付款工作台和付款详情已填写内容。
- 付款工作台站内离开有 TDesign 明确提醒；关闭/刷新由标准 `beforeunload` 提醒。
- 按钮具有 loading/disabled 状态，成功后有明确反馈。
- 错误说明发生事项、原因和可执行下一步。

### 9.4 自动化与浏览器

必须通过：

- `pnpm --filter @jiangkong/web-admin typecheck`
- `pnpm --filter @jiangkong/web-admin lint`
- `pnpm --filter @jiangkong/web-admin check:ui`
- 相关 Vitest，随后 Web 全量 Vitest
- 现有 P0 E2E 冒烟
- 付款工作台 E2E
- 新增 UI P0 视觉 E2E
- `git diff --check`

截图尺寸：1440×900、1280×800、1024×768。

截图页面：首页、付款台账、付款工作台、付款详情。稳定状态覆盖正常、加载、空态、失败、禁用中可自动复现的部分。截图写入外部 QA 目录，不把二进制产物混入源码提交；最终报告记录绝对路径。

---

## 10. 回滚方案

1. 本轮不含数据库迁移、后端 API、生产数据或路由变化，因此无需数据库回滚。
2. 所有新增 token 保留旧别名；若视觉回归，可只回滚目标 Vue/组件与 token 提交，不影响业务事实。
3. 若 SensitiveActionDialog 出现问题，回滚 PaymentDetail 与组件的同一聚焦提交；不单独保留半套动作入口。
4. 若付款确认摘要数据口径不满足财务验收，只回滚展示组件；`buildPaymentCreatePayload` 和后端核算不受影响。
5. 若浏览器验收发现目标页面回退，停止合入/发布，保留测试证据，按失败页面逐项修复；不得通过扩大 checker 白名单绕过。
6. 在已有脏工作区中只提交本轮明确文件，不还原或覆盖用户其他变更。

---

## 11. 实施顺序

1. 先以测试固定 Home 过滤/排序、付款摘要映射和敏感确认结构。
2. 更新 Design Token，并新增六个公共业务组件。
3. 改造 AdminLayout、HomePage、PaymentListPage。
4. 改造 PaymentWorkbenchPage，加入只读确认摘要和未保存提醒。
5. 改造 PaymentDetailPage，完成详情头、页签和 SensitiveActionDialog。
6. 收紧 `check:ui`：移除本轮目标文件的整文件白名单，只保留原生文件输入的就近注释例外。
7. 执行定向测试、全量静态检查和全量 Vitest。
8. 使用 Browser 插件先走核心交互，再使用现有 Playwright 批量完成三尺寸与多状态截图。
9. 逐张 `view_image` 复核密度、对齐、溢出、白底、边框、圆角、状态和主操作层级。
10. 输出 `UI_P0_IMPLEMENTATION_REPORT.md`，记录真实通过项、分页/银行字段阻塞和后续迁移建议。
