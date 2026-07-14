# 建工智管 UI P0.5 视觉收口报告

> 完成日期：2026-07-14  
> 范围：AdminLayout、HomePage、PaymentListPage、PaymentWorkbenchPage、PaymentDetailPage、P0 公共业务组件、Design Token 与对应测试  
> 约束：未修改后端 API、数据库、路由、权限、业务状态、审批逻辑或金额计算逻辑；未引入第二套组件库、动画、渐变、玻璃拟态或装饰性阴影。

## 1. 完成结论

本轮已完成 P0 样板的视觉收口。P0.5 没有重新设计业务流程，而是在 P0 已有结构上完成以下收敛：

- 首页与付款台账统计由整块浅色状态条改为白底统计单元格，状态色只用于数字。
- 首页页签移除重复数量，只承担队列切换；统计数量只在顶部摘要出现。
- 付款台账把规则提示压缩为默认收起的业务提示；失败反馈进入台账数据区。
- 台账读取失败时统计显示 `—`，记录数显示“暂不可用”，并明确“读取失败不代表没有付款记录”。
- 付款工作台把累计应付、已实付、最多可申请合并为一条金额关系，移除重复金额卡片。
- 付款确认摘要统一汇总缺失字段，普通缺失值使用 `—`，不再重复显示橙色“当前系统未提供”。
- 合同未选择时不展示确认摘要；额度未校验、金额未输入时显示明确引导文案。
- 付款详情移除重复状态摘要，将实付状态收为标题旁 Tag；当前用户可办理动作显示为页头主按钮。
- 付款详情概览移除页头已展示的付款编号、实付状态、责任部门和下一步动作；基础信息与追溯规则合并为一个双栏容器。
- 付款详情加载态改为静态、同构骨架，刷新和审计操作在详情未就绪时禁用。

## 2. 实际修改文件

### 页面与 Token

- `apps/web-admin/src/app/design-tokens.css`
- `apps/web-admin/src/pages/home/HomePage.vue`
- `apps/web-admin/src/pages/payments/PaymentListPage.vue`
- `apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue`
- `apps/web-admin/src/pages/payments/PaymentDetailPage.vue`
- `apps/web-admin/src/pages/payments/payment-list.config.ts`

`AdminLayout.vue` 已复核 P0 现状，当前白底、边框分区、Token 尺寸和无动画实现满足 P0.5，未追加本轮视觉修改。

### 公共组件

- `apps/web-admin/src/components/BusinessStatusSummary.vue`
- `apps/web-admin/src/components/BusinessTableToolbar.vue`
- `apps/web-admin/src/components/BusinessDetailHeader.vue`
- `apps/web-admin/src/components/PaymentConfirmationSummary.vue`
- `apps/web-admin/src/components/payment-confirmation-summary.config.ts`
- `apps/web-admin/src/components/EmptyBusinessState.vue`
- `apps/web-admin/src/components/empty-business-state.config.ts`

### 检查与测试

- `apps/web-admin/scripts/check-ui-rules.mjs`
- `apps/web-admin/src/components/payment-confirmation-summary.config.test.ts`
- `apps/web-admin/src/components/ui-p0-components.structure.test.ts`
- `apps/web-admin/src/pages/payments/payment-list.config.test.ts`
- `apps/web-admin/src/pages/payments/payment-workbench.structure.test.ts`
- `apps/web-admin/e2e/p0-browser-smoke.e2e.ts`
- `apps/web-admin/e2e/payment-workbench.e2e.ts`
- `apps/web-admin/e2e/ui-p0-visual.e2e.ts`

说明：工作区中仍包含上一轮 P0 的未提交改动。本节列出的是本次 P0.5 实际触达范围，不代表相对 `main` 的全部差异。

## 3. Token 变化

| Token | 值 | 用途 |
| --- | ---: | --- |
| `--jg-font-size-summary-value` | `20px` | 统计值，满足 18–20px 要求 |
| `--jg-font-size-summary-label` | `13px` | 统计标签 |
| `--jg-layout-summary-metric-min-width` | `120px` | 保证付款 5 项统计在 1024 桌面宽度保持单行 |

其余颜色、圆角、间距、边框和浮层阴影继续沿用 P0 Token。没有新增颜色、阴影、动画或渐变 Token。

## 4. 删除的重复信息

| 页面 | P0 重复 | P0.5 处理 |
| --- | --- | --- |
| 首页 | 摘要数量与页签数量重复 | 页签只保留“待我处理、阻塞事项、我发起的进行中”名称，数量只在摘要出现 |
| 付款工作台 | 预览条、预付款条、3 个金额卡重复展示累计与可申请额度 | 预览条只保留合同与纳入结算数；金额统一为“累计应付 - 已实付 = 最多可申请”关系 |
| 付款详情 | 页头、状态摘要、核心状态重复实付状态、责任部门、下一步 | 删除状态摘要；实付状态只在标题 Tag，责任部门和下一步只在页头 |
| 付款详情 | 页头编号与基础信息重复付款编号 | 基础信息不再重复付款编号 |
| 付款详情 | 当前节点与实付状态内容相同 | 详情头自动去除与状态相同或事实值相同的字段 |

必要重复说明：详情页头“登记实付”主按钮用于立即进入当前办理区；流程页内同名按钮用于真正提交敏感动作，两者分别承担导航和提交职责。实际提交仍经过 `SensitiveActionDialog`，没有绕过确认或权限判断。

## 5. 异常与缺失语义修正

### 付款台账

- 失败时统计值由 `0` 改为 `—`。
- “当前显示 0 条”改为“当前记录暂不可用”。
- 错误文案明确三件事：付款记录读取失败；失败不代表没有记录；当前统计和列表不能用于判断，并提供重试入口。
- 错误反馈位于台账数据区域内部，不再与业务规则提示形成蓝色、红色大色块连续堆叠。
- 分页阻塞说明改为业务语言，不再向员工展示 `limit`、`offset`、`total` 或 API 约束。

### 付款工作台

- “读取付款预览”改为“校验可付款额度”。
- 校验失败明确说明当前无法确认可申请金额，并提示核对合同状态、权限后重试。
- 银行账号、开户行、附件或发票要求统一在摘要顶部汇总为缺失清单；单元格使用 `—`。
- 额度未校验时显示“请先校验可付款额度”，申请金额为空时显示“请输入申请金额”，不显示看似有效的禁用数字。
- 仅真正阻塞提交的缺失项支持“缺失”紧凑标签；当前读模型未提供的银行字段不会被前端伪造成业务阻断。

### 付款详情

- 加载状态使用固定结构骨架，不使用旋转、闪烁、呼吸或位移动效。
- 详情加载期间禁用刷新和审计记录操作。
- 无可执行权限时不生成页头主按钮，只保留下一步事实信息。

## 6. 容器层级收口

| 区域 | 收口前 | 收口后 |
| --- | --- | --- |
| 首页筛选 | 独立 Card 包裹 | 无外框工具栏，以标题、间距和表格边界分层 |
| 付款规则 | 大面积信息 Alert | 默认收起的单行业务提示，展开后显示规则列表 |
| 付款台账筛选 | 独立 Card 包裹 | 无外框工具栏 |
| 付款工作台金额 | 预付款边框条 + 多个独立金额卡 | 一条无外框扣回说明 + 一个金额关系容器 |
| 付款工作台提交区 | 独立有圆角边框容器 | 仅保留顶部分隔线 |
| 付款详情顶部 | 状态摘要 Card + 有框 Tabs | 删除状态摘要，Tabs 只保留下边界 |
| 付款详情概览 | 核心状态、基础信息、追溯规则三个独立容器 | 状态区无外框；基础信息与追溯规则合并为一个双栏容器 |
| 付款详情边界提示 | 大面积 warning Alert | 小圆点 + 标题 + 规则文本的紧凑行 |

表格、创建表单、确认摘要、流程动作组和上传等需要明确业务边界的区域继续保留边框。整体外层容器与嵌套边框减少已达到本轮约 20%–30% 的目标区间；金额关系和详情概览局部的减少幅度更高，但没有移除必要的业务边界。

## 7. UI 检查规则

`check:ui` 新增仅针对 P0 样板文件的约束：

- 禁止 `animation`、`transition` 和渐变。
- 禁止用户文案出现“读取付款预览”“当前系统未提供”。
- 禁止用户文案暴露“后端、前端、读模型、API 约束、limit、offset、total”等实现术语。

规则只覆盖本轮样板文件，未机械扩张到历史页面。

## 8. 测试结果

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @jiangkong/web-admin typecheck` | 通过 |
| `pnpm --filter @jiangkong/web-admin lint` | 通过，0 error / 0 warning |
| `pnpm --filter @jiangkong/web-admin check:ui` | 通过，规则自检与全量扫描均通过 |
| `pnpm --filter @jiangkong/web-admin test` | 78 个文件通过，582/582 测试通过 |
| `pnpm test:e2e:p0` | 21 通过，2 个条件型场景因未配置专用账号而跳过 |
| `ui-p0-visual.e2e.ts` | 1/1 通过，生成 16 张指定截图 |

两项条件型跳过场景为：受限账号详情权限检查、临时密码强制改密。它们依赖 `E2E_LIMITED_PHONE`、`E2E_LIMITED_PASSWORD` 等外部环境配置，不是本轮失败。

浏览器验证说明：应用内浏览器客户端在当前运行时初始化时发生 `Cannot redefine property: process`，因此没有使用真实会话凭据继续操作。所有稳定状态截图均使用仓库现有 Playwright 隔离浏览器与受控 API 路由完成；未读取或注入真实账号存储。

## 9. 截图清单

截图目录：`/Users/leoyang/.codex/visualizations/2026/07/14/ui-p0-5-polish`

### 1440 × 900

- `home-normal-1440x900.png`
- `payment-ledger-normal-1440x900.png`
- `payment-ledger-failure-1440x900.png`
- `payment-workbench-normal-1440x900.png`
- `payment-workbench-missing-data-1440x900.png`
- `payment-detail-overview-1440x900.png`
- `payment-detail-process-1440x900.png`
- `payment-detail-loading-1440x900.png`

### 1280 × 800

- `home-1280x800.png`
- `payment-ledger-1280x800.png`
- `payment-workbench-1280x800.png`
- `payment-detail-1280x800.png`

### 1024 × 768

- `home-1024x768.png`
- `payment-ledger-1024x768.png`
- `payment-workbench-1024x768.png`
- `payment-detail-1024x768.png`

## 10. 未解决问题与后续建议

1. 付款台账仍没有真实服务端分页能力。现有读取接口不提供完整分页事实；本轮按约束没有修改 API，也没有伪造前端分页。
2. 当前付款创建读模型没有银行账号、开户行和独立附件要求。P0.5 只修正展示语义，没有伪造字段，也没有改变提交阻断规则。
3. 两个依赖专用账号的 E2E 条件场景未执行。进入真实试运行前，应在受控环境补齐账号变量后重跑。
4. P0.5 样板验证通过后，可把 `metrics` 摘要、`plain` 工具栏和详情头去重规则逐页迁移；不得对范围外页面做机械颜色或容器替换。

## 11. 范围确认

- 未修改后端、数据库、路由地址、权限、业务状态和审批逻辑。
- 未改变合同、结算、付款金额计算和事实来源。
- 未修改合同、结算、项目经营等范围外页面。
- 未新增 UI 组件库、动画、渐变、玻璃拟态、装饰性阴影或经营图表。
- 未更新 `PROGRESS.md`：本轮没有改变项目阶段或生产试运行状态，且用户明确限定了允许修改范围。
