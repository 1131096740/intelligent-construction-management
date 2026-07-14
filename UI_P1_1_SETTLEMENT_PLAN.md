# 建工智管 UI P1.1 结算管理样板迁移实施计划

> 版本：P1.1  
> 日期：2026-07-14  
> 状态：已按计划实施并验收
> 适用范围：结算台账、结算详情及其直接测试与 UI 治理规则

## 1. 实施目标与边界

本轮不是结算模块重做，也不处理结算工作台。目标是把已经在首页、付款台账、付款工作台和付款详情验证通过的企业级 UI 结构迁移到结算管理的两个只读/办理页面，同时保持现有业务契约不变。

必须保持：

- Vue 3 + TypeScript + TDesign Vue Next，TDesign 仍是唯一基础组件库。
- 现有 `/结算管理`、`/settlements/:settlementId` 和 `/结算工作台` 路由及跳转关系。
- `GET /settlements` 与 `GET /settlements/:settlementId` 的调用方式和返回事实。
- 服务端对可见项目、岗位权限、审批节点、归档角色、付款准入和可付金额的判断。
- 结算金额、可付金额、已申请、已实付、剩余可申请均直接展示后端读模型，不在前端重算。
- 现有审批、撤回、催办、转审、委托、归档上传/确认、文件下载和 PDF 生成接口及请求负载。
- 归档后生效、未生效不得付款、历史结算绑定原付款条款版本等规则。

明确不做：

- 不修改 `SettlementWorkbenchPage.vue`，不调整结算创建、清单选行、Excel 导入和计价逻辑。
- 不修改合同、付款、历史接管、项目经营或范围外页面。
- 不增加后端分页，不用前端切片伪装服务端分页。
- 不增加图表、经营大屏、动画、渐变、玻璃拟态或装饰性阴影。
- 不修改后端 API、数据库、路由、角色、权限、业务状态和审批规则。

## 2. 当前页面结构与主要问题

### 2.1 结算台账 `SettlementListPage.vue`

当前结构：

1. 自定义 `page-head`：标题、说明和“新建结算”。
2. 自定义 `summary-strip`：全部、审批中、待归档确认、已生效、可申请付款。
3. 常驻 `rule-strip`：四条结算规则。
4. 自定义 `filter-bar`：五个字段均使用文本输入，另有查询、重置。
5. 自定义成功/失败消息条。
6. 原生复选框组成的列设置条。
7. 标题区 + `t-card` + `t-table`。

主要问题：

- 页头、统计、筛选、消息和表格分别自建样式，与付款台账的公共结构重复。
- `#151922`、`#dce1e8`、`#0052cc` 等硬编码颜色，3px 圆角和 11/12/13px 字号没有使用已固化 token。
- 所有筛选项都用 `t-input`，项目、合同、状态和归档状态没有从当前已加载记录生成可选择项。
- “查询”实际只重新拉取同一完整列表，与本地筛选混在一起；用户难以区分“刷新数据”和“筛选当前数据”。
- 加载失败后统计仍显示 0，容易被误解为没有结算记录；错误文案缺少“是否影响判断”和下一步。
- 列设置使用原生 checkbox，且整条常驻占据纵向空间。
- 表格空态仅为一句文本，没有明确的下一步入口；加载、错误、空态没有互斥分层。
- 规则条常驻形成第三层边框，信息密度与 P0.5 收口后的付款台账不一致。

### 2.2 结算详情 `SettlementDetailPage.vue`

当前结构：

1. 自定义页头，主色“刷新”与次级“查看审批记录”。
2. 自定义错误条。
3. 六列元信息面板。
4. 五列流程摘要，再次重复状态、金额、责任部门和下一步。
5. 业务链路条。
6. 一个大“流程动作”卡片，内部继续嵌套多个有边框动作组。
7. 归档资料卡、审批历史卡。
8. 基础信息、生效流程、职责规则、可付金额、结算明细、付款规则和付款申请连续平铺。

主要问题：

- 当前状态、下一步、责任部门和结算金额在页头下方多次重复，关键事实层级不清。
- 刷新被设为页头主动作，但真正由权限和当前节点决定的主业务动作没有进入页头。
- 页面没有页签，所有内容与办理动作无限平铺，流程、凭证、金额与审计互相争夺注意力。
- 读取期间没有与真实结构一致的静态骨架；加载中会先显示大量 `-` 和空容器。
- 错误、成功和权限反馈是自建色块，失败文案未统一说明影响和下一步。
- 归档上传仍使用浏览器原生文件控件；敏感动作仍调用浏览器原生 `confirm`/`prompt`。
- 动作区的主次关系由局部按钮颜色决定，没有复用后端 `primaryAction`。
- 可付金额、结算明细、付款规则全部以卡片连续堆叠，外层边框过多。
- CSS 存在大量硬编码颜色、间距、圆角和字号，且关键标签使用 11px。

## 3. 本轮准确文件清单

### 3.1 新增

- `UI_P1_1_SETTLEMENT_PLAN.md`：本实施计划。
- `UI_P1_1_SETTLEMENT_REPORT.md`：实施结果、差异、测试、截图和遗留问题。
- `apps/web-admin/e2e/ui-p1-settlement-visual.e2e.ts`：结算台账与详情的稳定视觉/状态回归。

### 3.2 修改

- `apps/web-admin/src/pages/settlements/SettlementListPage.vue`
- `apps/web-admin/src/pages/settlements/settlement-list.config.ts`
- `apps/web-admin/src/pages/settlements/settlement-list.config.test.ts`
- `apps/web-admin/src/pages/settlements/SettlementDetailPage.vue`
- `apps/web-admin/src/pages/settlements/settlement-detail.config.ts`
- `apps/web-admin/src/pages/settlements/settlement-detail.config.test.ts`
- `apps/web-admin/src/components/BusinessDetailHeader.vue`：为不同业务单据提供可配置的金额字段名称，默认仍为“申请金额”。
- `apps/web-admin/scripts/check-ui-rules.mjs`
- `apps/web-admin/e2e/p0-browser-smoke.e2e.ts`：将结算详情旧结构断言同步为新页头和页签结构，保留原业务事实验证。
- `PROGRESS.md`

### 3.3 原则上不修改

- `apps/web-admin/src/api/core-flow-read.api.ts`：现有接口已经满足本轮展示和操作。
- `apps/web-admin/src/app/design-tokens.css`：现有 P0 token 已覆盖颜色、字号、间距、圆角和布局；只有发现真实缺口并有两处以上复用时才允许补 token。
- `apps/web-admin/src/components/`：优先直接复用现有公共业务组件，不新增无业务意义的包装组件。

## 4. 复用组件与职责映射

| 组件 | 结算台账 | 结算详情 | 职责 |
| --- | --- | --- | --- |
| `BusinessPageHeader` | 使用 | - | 标准页面标题、说明和唯一主入口 |
| `BusinessStatusSummary` | 使用，`metrics` | - | 白底统计单元格与分隔线 |
| `BusinessTableToolbar` | 使用，`plain` | - | 本地筛选、刷新、列设置入口 |
| `BusinessFeedback` | 使用 | 使用 | 加载失败、权限、动作成功/失败的完整语义 |
| `EmptyBusinessState` | 使用 | 按数据区使用 | 空态及单一下一步入口 |
| `BusinessDetailHeader` | - | 使用 | 编号、标题、状态、金额、责任部门、当前节点、下一步和主动作 |
| `BusinessActionPanel` | - | 使用 | 展示后端返回的动作权限与禁用原因 |
| `EvidenceFileCards` | - | 使用 | 归档资料和下载能力 |
| `ApprovalTimeline` | - | 使用 | 审批/审计时间线 |
| `SensitiveActionDialog` | - | 使用 | 审批、确认归档、撤回、转审、委托和敏感下载的二次确认 |

不新增 Button、Input、Select、Card、Table 包装组件。结算详情的页签、页头投影和敏感动作配置优先放入现有 `settlement-detail.config.ts` 形成纯函数并测试。

## 5. Design Token 新旧映射

本轮以删除页面硬编码为主，不改变已经固化的品牌方向。

| 当前写法 | 目标 token/组件语义 |
| --- | --- |
| `#fff` | `--jg-color-bg-panel` |
| `#151922` | `--jg-color-text-primary` |
| `#424955` | `--jg-color-text-secondary` |
| `#767f8d` | `--jg-color-text-tertiary` |
| `#dce1e8` | `--jg-color-border` |
| `#f6f8fb` | `--jg-color-bg-muted` |
| `#0052cc` | `--jg-color-brand` / TDesign primary |
| `#1b6b3a` | `--jg-color-success` |
| `#9f4f06` | `--jg-color-warning` |
| `#b51d2a` | `--jg-color-danger` |
| 3px 页面/面板圆角 | 控件 `--jg-radius-control`，面板 `--jg-radius-panel` |
| 11px 关键标签 | `--jg-font-size-meta` 或 `--jg-font-size-summary-label` |
| 12px 普通说明 | 辅助信息 `--jg-font-size-meta`，正文改为 `--jg-font-size-body` |
| 16/20/24px 页面间距 | `--jg-space-lg` / `--jg-space-section` / `--jg-space-xl` |
| 自定义统计条 | `BusinessStatusSummary appearance="metrics"` |
| 自定义错误色块 | `BusinessFeedback` |

## 6. 不得改变的业务逻辑与风险点

### 6.1 台账

- `fetchSettlementLedger()` 仍只调用 `GET /settlements`，不增加参数、不猜测分页能力。
- 统计值仍直接使用响应 `summary`，筛选只作用于当前已加载记录。
- 项目 query 参数预填、本机按用户保存列偏好和进入详情的路由保持不变。
- 失败时不可把统计显示为 0，也不可清空后宣称没有记录。

### 6.2 详情

- `availableActions`、`primaryAction` 和 `disabledReasons` 是唯一动作权限事实；页面不得自行按角色或状态推断权限。
- `settlementId` 与业务编号不能混用；所有原操作函数继续使用现有 ID 选择逻辑。
- 审批自审确认、归档当前密码、文件下载原因/密码、上传格式和大小限制必须完整保留。
- 文件上传仍先调用 `uploadPrivateFile`，再调用原 `uploadSettlementArchiveFile`，不改变上传 API。
- 可付金额关系只整理信息层级，不在前端用结算金额重新计算。
- “发起付款申请”只在后端动作启用时提供入口；结算未生效时继续显示后端阻断说明。
- 接口失败必须保留当前输入；只有操作成功后才清理相应字段。

主要风险：详情页动作较多，视觉整理可能误伤行为入口。控制方法是先为页头投影、页签和敏感动作配置补纯函数测试，再移动模板；每个原操作函数保留原 API 调用和 payload，并用结构测试禁止原生 `confirm`、`prompt` 和文件输入回归。

## 7. 页面修改前后结构

### 7.1 结算台账

修改前：

```text
自定义页头
  -> 自定义统计条
  -> 常驻规则条
  -> 自定义筛选条
  -> 自定义消息条
  -> 常驻原生列设置
  -> 标题 + 卡片 + 表格
```

修改后：

```text
BusinessPageHeader（唯一主动作：进入结算工作台）
  -> BusinessStatusSummary（白底、细分隔线；失败显示 —）
  -> 可展开业务规则提示（默认紧凑）
  -> BusinessTableToolbar（结构化筛选、刷新、列设置）
  -> 台账数据区
       -> 数据范围说明
       -> 数据区内错误 + 重试 / 静态加载 / 表格 / EmptyBusinessState
```

筛选项由当前已加载记录生成项目、合同、结算节点和归档状态选项；关键词保留输入。查询按钮改为“刷新数据”，本地筛选即时生效。列设置改为 TDesign Popup + CheckboxGroup，默认不占据整行。

### 7.2 结算详情

修改前：

```text
自定义页头
  -> 元信息面板
  -> 重复流程摘要
  -> 业务链路
  -> 所有动作
  -> 归档资料
  -> 审批时间线
  -> 基础信息 / 生效步骤 / 职责 / 金额 / 明细 / 付款规则 / 付款申请连续平铺
```

修改后：

```text
BusinessDetailHeader
  编号 + 标题 + 状态 Tag
  结算金额 + 责任部门 + 当前节点 + 下一步
  当前用户可执行的后端 primaryAction（如存在）
  次级：刷新、审计
  -> 业务链路
  -> tabs
       概览：基础信息、生效步骤、可付金额关系、付款阻断/入口
       流程：动作权限摘要、按权限显示的办理表单
       结算明细：后端事实明细表
       凭证资料：归档上传、确认、下载、附件模板、文件卡
       关联与审计：付款规则、业务链路、审批时间线
  -> SensitiveActionDialog
```

页头主动作只用于定位到对应办理区，不绕过对话框和权限；无可执行主动作时只显示后端下一步事实。加载状态使用与页头、页签和主要内容区相同的静态骨架，不使用动画。

## 8. 反馈与状态语义

- 台账失败：统计为“—”；数据区说明“读取失败不代表没有结算记录”；保留重试。
- 详情失败：区分无权限与普通读取失败；说明当前数据不可用于判断，并提供返回台账/重新加载。
- 加载：按钮禁用，显示静态占位，不闪烁、不旋转。
- 空态：台账提供一个“进入结算工作台”主入口；详情各数据区只给中性事实，不虚构业务记录。
- 动作失败：说明发生了什么、当前输入已保留、用户下一步；不关闭敏感操作对话框。
- 动作成功：关闭对应对话框、刷新详情、给出统一成功反馈。
- 状态不只依赖颜色，始终保留明确中文文字或 Tag。

## 9. 验收标准

### 9.1 结构与视觉

- 两页不再包含硬编码颜色、装饰阴影、渐变、动画或过渡。
- 页面标题不使用卡片；统计为白底单元格与细分隔线。
- 普通正文 14px，辅助信息不低于 12px，关键业务标签不再使用 11px。
- 金额列右对齐，操作列固定右侧，行内只有一个“查看详情”动作。
- 详情每项关键事实原则上只出现一次，业务必要重复必须处于不同任务语境。
- 详情不再无限平铺，正常视口能通过页签进入流程、明细、凭证和审计。
- 所有原生文件上传、`confirm`、`prompt` 从结算详情移除。

### 9.2 行为与业务

- 台账统计口径、当前记录筛选、列偏好和路由预填不变。
- 详情所有后端动作仍按 `availableActions` 控制，禁用原因可见。
- 归档文件类型、大小、权限、提交逻辑和 API 不变。
- 失败不清除用户输入；成功后刷新事实并清理对应敏感字段。
- 未生效结算不能从前端伪造付款入口；金额不在前端重算。

### 9.3 自动化与截图

完成后必须通过：

- 结算定向 Vitest。
- Web 全量 Vitest。
- `pnpm typecheck`。
- `pnpm lint`。
- `pnpm check:ui`，且两页移出迁移 allowlist、纳入样板视觉和业务文案治理。
- 现有 P0 E2E。
- 新增结算 P1.1 Playwright：正常、加载、空态、失败、禁用/无可执行动作中可稳定复现的状态。

截图输出到仓库外：

- 1440×900：结算台账正常、失败、空态；结算详情概览、流程、凭证、加载。
- 1280×800：结算台账、结算详情。
- 1024×768：结算台账、结算详情。

## 10. 回滚方案

1. P0/P0.5 样板基线已独立固化为提交 `e74444f8`，不与本轮结算改造混合。
2. 本轮结算计划与实现形成独立提交，不推送、不部署，先保留完整本地验证证据。
3. 回滚时只反向应用本轮结算提交；不回退 P0/P0.5 公共组件和 token。
4. 若仅视觉门禁导致阻断，修正迁移页本身，不把结算页重新加入宽泛 allowlist。
5. 若动作回归，优先恢复原模板动作入口并保留已验证的页头、台账和 token 迁移；禁止通过修改 API、权限或业务状态规避前端问题。
