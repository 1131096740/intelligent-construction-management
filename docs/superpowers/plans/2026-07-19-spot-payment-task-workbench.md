# Spot Payment Task Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有零星材料付款模块改造成“任务优先、资料顺序固定、岗位动作清楚”的工作台与统一详情体验，同时保持已经上线的 A4/A5 业务事实、审批链、逐笔实付、收货、退款、发票、PDF、私有文件和审计底座不变。

**Architecture:** 后端 `SpotProcurementReadService` 继续作为付款读取唯一事实源，在既有 `availableActions`、`primaryAction`、`payerManagement` 上增加当前任务投影和 `mine | all | closed` 服务端视图；付款写服务继续执行审批、付款主体和实付不变量。Web 页面只消费任务投影并注册固定动作，不根据角色名称自行放权。付款详情保留一个路由，局部拆成任务面板、四步申请、审批抽屉和实付抽屉；不新增任务表、步骤表、第二套审批引擎或数据库迁移。

**Tech Stack:** NestJS、TypeScript、Prisma 5、PostgreSQL 16、Jest、Vue 3、TDesign Vue Next、Vitest、Playwright、现有 `--jg-*` 设计令牌。

---

## 0. 执行边界、基线与文件职责

实施依据：`docs/superpowers/specs/2026-07-19-spot-payment-task-workbench-design.md`。

开始 Task 1 前必须确认：

- 当前分支为 `codex/spot-procurement`，且设计提交 `b05e02fc` 可达。
- `PROGRESS.md`、`AGENTS.md`、本计划和设计规格已完整读取。
- `.superpowers/` 视觉稿仍为本地草稿，不加入 Git。
- 本计划不修改 Prisma Schema，不新增迁移，不改变冻结的 A4/A5 PDF 版式。
- 每个 Task 独立采用 RED → GREEN → REFACTOR，完成后更新 `PROGRESS.md` 并提交。
- 任一 Task 失败时停在当前 Task 修复；不得跳过失败测试继续拼装页面。
- 完成本计划只形成候选，不自动授权推送、合并 `main`、生产备份、迁移、部署、白名单修改或真实业务写入。

文件职责固定如下，避免多个页面重复发明规则：

| 责任 | 唯一落点 |
| --- | --- |
| 三档视图、任务范围、优先级、稳定排序 | `services/api/src/spot-procurement/spot-procurement-read.service.ts` |
| 新版 A5 审批结果、默认意见、付款主体重审、逐笔实付不变量 | `services/api/src/spot-procurement/spot-procurement-payment.service.ts` |
| 新写入数量与单价格式 | `services/api/src/spot-procurement/spot-procurement-money.ts` 与相关 DTO |
| Web API 请求与响应类型 | `apps/web-admin/src/api/spot-procurement.api.ts` |
| Web 任务/步骤/状态纯映射 | `apps/web-admin/src/pages/spot-procurement/spot-payment-workbench.config.ts`、`spot-payment-detail.config.ts` |
| 跨业务非交互状态文字 | `apps/web-admin/src/components/BusinessStatusText.vue` |
| 页面数据加载、路由与写动作编排 | 两个付款页面及两个采购页面 |
| 表单、审批、实付局部交互 | `apps/web-admin/src/pages/spot-procurement/components/Payment*.vue` |

## Task 1: 建立服务端当前任务投影与三档工作台视图

**Files:**

- Modify: `services/api/src/spot-procurement/spot-procurement-read.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.controller.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-read.service.spec.ts`
- Modify: `apps/web-admin/src/api/spot-procurement.api.ts`
- Modify: `apps/web-admin/src/api/spot-procurement.api.test.ts`
- Modify: `PROGRESS.md`

**Contract to implement:**

```ts
export const SPOT_PAYMENT_WORKBENCH_VIEWS = ["mine", "all", "closed"] as const;
export type SpotPaymentWorkbenchView =
  (typeof SPOT_PAYMENT_WORKBENCH_VIEWS)[number];

export type SpotPaymentCurrentTask = {
  key: string;
  label: string;
  hint: string;
  priority: 400 | 300 | 200 | 0;
  scope: "personal" | "shared" | "none";
  enabled: boolean;
  disabledReason: string | null;
};

export type SpotPaymentListAmountSummary = {
  approvalAmountCents: string;
  actualPaidAmountCents: string;
  refundAmountCents: string;
  netPaidAmountCents: string;
  complete: boolean;
};
```

优先级固定为：阻断事项 `400`、个人办理 `300`、共享协作 `200`、无需办理 `0`。同优先级使用既有事实时间升序，再按付款 ID 升序，保证刷新后顺序稳定。

- [ ] 在 `spot-procurement-read.service.spec.ts` 写 RED 测试：物资员本人草稿返回 `complete_payment_draft / personal / 300`，其他物资员不返回该个人任务。
- [ ] 写 RED 测试：当前冻结审批节点处理人返回 `review_payment / personal / 300`；物资主管只有查看权，返回 `none / none / 0`。
- [ ] 写 RED 测试：付款主体缺失时，财务人员、综合部主管和财务主管在合法阶段得到 `complete_payer / shared / 200`；第一人保存后该任务消失。
- [ ] 写 RED 测试：项目财务人员对 `approved_pending_payment` 或 `partially_paid` 得到 `record_execution / personal / 300`；退款待登记、凭证异常分别以 `400` 置顶。
- [ ] 写 RED 测试：`getPayment()` 返回与列表同源的 `currentTask`，详情不得再按角色名和状态字符串另算一套任务。
- [ ] 写 RED 测试：`mine` 只返回 `currentTask.enabled === true && scope !== "none"`，`all` 返回全部可见付款，`closed` 只返回 `settled | voided | invalidated`。
- [ ] 写 RED 测试：非法 `view` 返回中文 `400`；默认未传 `view` 等价于 `mine`。
- [ ] 写 RED 测试：返回值包含 `viewCounts`，任务卡来源最多五条由客户端截取，但服务端完整返回当前视图列表；截断状态不得伪装为完整结果。
- [ ] 写 RED 测试：只有财务岗位的 `all` 视图返回 `amountSummary`；物资岗位或 `mine/closed` 返回 `null`。来源扫描被截断时 `complete` 必须为 `false`。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-read.service.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-procurement.api.test.ts
```

预期：测试因 `view`、`currentTask`、`viewCounts` 契约不存在而失败。

- [ ] 在读取服务新增纯函数 `deriveSpotPaymentCurrentTask(...)`，只接收付款、审批、收货/差异、退款、角色和既有 `availableActions` 事实；不得查询数据库、不得产生写入。
- [ ] 修改 `paymentListItems(...)`，批量读取当前账号各项目有效角色、差异和退款事实，并把 `currentTask` 加到每一行；避免逐行调用 `effectiveRoleKeys` 形成 N+1 查询。
- [ ] 让 `getPayment(...)` 调用同一任务推导函数，并把 `currentTask` 放到详情顶层；列表与详情不得复制两套任务优先级。
- [ ] 修改 `listPayments(...)`，在服务端完成三档视图过滤、任务排序和 `LIST_LIMIT` 截断；不得先截取 200 条再筛选“待我办理”。
- [ ] 在同一服务端投影中形成受控 `amountSummary`，Web 不读取登录角色自行决定是否展示，也不把截断列表的浏览器求和伪装成完整汇总。
- [ ] 在控制器接收 `@Query("view") view?: string` 并交给读取服务校验；不在控制器复制状态集合。
- [ ] 在 Web API 中增加 `SpotPaymentWorkbenchView`、`SpotPaymentCurrentTask`、`viewCounts`、`amountSummary` 和查询参数；保持旧调用省略 `view` 时可编译。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-read.service.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-procurement.api.test.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
```

- [ ] 检查 `mine` 的权限判断来自冻结节点与项目岗位，而不是 `statusLabel` 或中文角色名。
- [ ] 更新 `PROGRESS.md`，记录读取契约已完成且无 Schema/迁移。
- [ ] 提交：

```bash
git add services/api/src/spot-procurement/spot-procurement-read.service.ts services/api/src/spot-procurement/spot-procurement-payment.controller.ts services/api/src/spot-procurement/spot-procurement-read.service.spec.ts apps/web-admin/src/api/spot-procurement.api.ts apps/web-admin/src/api/spot-procurement.api.test.ts PROGRESS.md
git commit -m "feat: add spot payment task projections"
```

## Task 2: 收口新版 A5 审批为“通过 / 退回申请人修改”

**Files:**

- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- Modify: `services/api/src/spot-procurement/dto/review-spot-procurement-payment.dto.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment-real-form.spec.ts`
- Modify: `apps/web-admin/src/api/spot-procurement.api.ts`
- Modify: `PROGRESS.md`

兼容边界：传输 DTO 暂时保留 `reject` 以便历史 legacy 付款审批兼容读取/办理；`SpotProcurementPaymentService.review()` 在识别 `real_payment` 后必须拒绝 `reject`。Web 新版 A5 抽屉的本地类型只允许 `approve | return_to_applicant`。

- [ ] 写 RED 测试：新版 A5 提交 `reject` 返回 `400`，不写审批动作、不改付款状态、不释放其他业务事实。
- [ ] 写 RED 测试：新版 A5 `approve` 空意见时动作日志冻结 `comment: "同意"`。
- [ ] 写 RED 测试：新版 A5 `return_to_applicant` 空白原因失败；有原因时生成新草稿并从综合部主管重新开始。
- [ ] 写 RED 测试：legacy 付款现有 `reject` 行为保持不变，防止兼容收口误伤历史流程。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts spot-procurement-payment-real-form.spec.ts --runInBand
```

预期：新版 A5 仍接受 `reject`，空通过意见仍保存为 `null`。

- [ ] 在 `review()` 锁定付款和版本后，用现有 `isRealPaymentForm(payment, version)` 判断新版表单；新版遇到 `reject` 立即抛出 `BadRequestException("项目零星付款只允许通过或退回申请人修改")`。
- [ ] 将新版 A5 的审批意见归一化为：

```ts
const comment =
  input.decision === "approve"
    ? optionalText(input.comment) ?? "同意"
    : requiredText(input.comment, "退回付款申请时必须填写原因");
```

- [ ] 保留自审密码、OR 签、冻结节点、付款主体缺失闸门、财务主管重审和审计逻辑；只收口新版结果与意见。
- [ ] 在 Web API 新增 `SpotProcurementA5ReviewDecision = "approve" | "return_to_applicant"`，审批抽屉 payload 使用该窄类型；旧 `SpotProcurementReviewDecision` 继续供采购审批和历史兼容使用。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts spot-procurement-payment-real-form.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [ ] 更新 `PROGRESS.md` 并提交：

```bash
git add services/api/src/spot-procurement/spot-procurement-payment.service.ts services/api/src/spot-procurement/dto/review-spot-procurement-payment.dto.ts services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts services/api/src/spot-procurement/spot-procurement-payment-real-form.spec.ts apps/web-admin/src/api/spot-procurement.api.ts PROGRESS.md
git commit -m "fix: constrain A5 spot payment reviews"
```

## Task 3: 对本轮触及的零星采购新写入执行两位小数规则

**Files:**

- Modify: `services/api/src/spot-procurement/spot-procurement-money.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-money.spec.ts`
- Modify: `services/api/src/spot-procurement/dto/create-spot-procurement.dto.ts`
- Modify: `services/api/src/spot-procurement/dto/update-spot-procurement-payment-draft.dto.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment-real-form.spec.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/components/ProcurementLineEditor.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `PROGRESS.md`

本 Task 不缩小数据库 `Decimal(24,6)`，不改写历史值，不把历史三至六位小数静默四舍五入。读取模型继续原样输出历史十进制文本；只拒绝新的三位以上数量和单价写入。实付和退款仍以整数分接收，天然限定到分。

- [ ] 把 `spot-procurement-money.spec.ts` 的合法基线改为 `12.50`、`3.28`，新增 `1.001` 数量和 `0.005` 单价必须失败的 RED 测试。
- [ ] 写 RED 测试：历史读取 fixture 中 `3.335` 仍可通过读服务原样返回，不调用新写入校验器。
- [ ] 写 RED 测试：付款草稿 `paymentQuantity: "1.001"` 或 `unitPrice: "3.333"` 被后端拒绝；`1.00` 与 `3.50` 正常保存并由后端按分重算。
- [ ] 更新 Web 源码断言：所有本轮付款/采购输入提示为“最多 2 位小数”，不再出现“最多 6 位小数”。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-money.spec.ts spot-procurement-payment-real-form.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-procurement-pages.test.ts
```

- [ ] 将新写入规范十进制正则改为 `^(0|[1-9]\d*)(?:\.(\d{1,2}))?$`，保留整数位上限、普通十进制、非负/正数和 PostgreSQL BIGINT 金额边界校验。
- [ ] 将 DTO 和 Web 错误文案统一为“最多 2 位小数”；付款单价继续由 `calculateSpotProcurementLine()` 校验，客户端不得提交行金额。
- [ ] 继续用 `yuanTextToCentsText()` 生成实付/退款分值；增加 Web 测试确认三位小数元输入在上传凭证前失败。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-money.spec.ts spot-procurement-payment-real-form.spec.ts spot-procurement-read.service.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-procurement-pages.test.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
```

- [ ] 更新 `PROGRESS.md`，明确这里只完成零星采购相关新写入，合同模板等全系统精度任务仍保留独立待办。
- [ ] 提交：

```bash
git add services/api/src/spot-procurement/spot-procurement-money.ts services/api/src/spot-procurement/spot-procurement-money.spec.ts services/api/src/spot-procurement/dto/create-spot-procurement.dto.ts services/api/src/spot-procurement/dto/update-spot-procurement-payment-draft.dto.ts services/api/src/spot-procurement/spot-procurement-payment-real-form.spec.ts apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue apps/web-admin/src/pages/spot-procurement/components/ProcurementLineEditor.vue apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts PROGRESS.md
git commit -m "fix: limit spot payment decimals to two places"
```

## Task 4: 固化 Web 任务、步骤和页签纯映射

**Files:**

- Create: `apps/web-admin/src/pages/spot-procurement/spot-payment-workbench.config.ts`
- Create: `apps/web-admin/src/pages/spot-procurement/spot-payment-workbench.config.test.ts`
- Create: `apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.ts`
- Create: `apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.test.ts`
- Modify: `PROGRESS.md`

- [ ] 写 RED 测试，固定三档视图标签、六个台账信息组和前五张任务卡选择规则。
- [ ] 写 RED 测试，固定任务 key 到本地已注册动作：`complete_payment_draft`、`review_payment`、`complete_payer`、`record_execution`、`record_refund`、`view_only`；未知 key 只能回退只读，不能跳任意 URL。
- [ ] 写 RED 测试，固定六个详情页签顺序：`current → application → approval → executions → fulfillment → archives`。
- [ ] 写 RED 测试，四步恢复规则按已保存完整字段返回第一个未完成步骤；步骤状态不得写数据库。
- [ ] 写 RED 测试，商户/收款对象正常模式默认同名，开启例外后必须存在独立收款对象和说明，经办人垫付模式收款人取当前经办人冻结值。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/web-admin test -- spot-payment-workbench.config.test.ts spot-payment-detail.config.test.ts
```

- [ ] 实现纯函数，函数签名固定为：

```ts
export function paymentTaskRoute(taskKey: string):
  | "edit-draft"
  | "review"
  | "payer"
  | "execution"
  | "refund"
  | "readonly";

export function firstIncompletePaymentStep(
  detail: SpotProcurementPaymentDetailReadModel
): 0 | 1 | 2 | 3;
```

- [ ] 纯函数不得导入 Vue Router、API 方法或 Pinia；只对读取模型做展示映射。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/web-admin test -- spot-payment-workbench.config.test.ts spot-payment-detail.config.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
```

- [ ] 更新 `PROGRESS.md` 并提交：

```bash
git add apps/web-admin/src/pages/spot-procurement/spot-payment-workbench.config.ts apps/web-admin/src/pages/spot-procurement/spot-payment-workbench.config.test.ts apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.ts apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.test.ts PROGRESS.md
git commit -m "test: define spot payment UI mappings"
```

## Task 5: 建立圆点状态组件并重构任务优先付款工作台

**Files:**

- Create: `apps/web-admin/src/components/BusinessStatusText.vue`
- Create: `apps/web-admin/src/components/business-status-text.config.ts`
- Create: `apps/web-admin/src/components/business-status-text.config.test.ts`
- Create: `apps/web-admin/src/pages/spot-procurement/components/PaymentTaskQueue.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts`
- Modify: `PROGRESS.md`

- [ ] 写 RED 单测，固定五类状态语义：`neutral` 灰蓝、`progress` 橙、`required` 紫、`success` 绿、`danger` 红；每一类必须同时有文字。
- [ ] 写 RED 页面结构测试：默认请求 `view=mine`，存在三档视图、最多五张任务卡、六个表格信息组，不再以 `t-tag` 呈现付款状态。
- [ ] 写 RED E2E：1366 宽度直接读完六列，1024 宽度页面主体无横向溢出，任务卡在窄屏改为单列。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/web-admin test -- business-status-text.config.test.ts spot-procurement-pages.test.ts
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] `BusinessStatusText.vue` 只渲染 `aria-hidden` 圆点和可见文字，不绑定 click，不使用按钮样式：

```vue
<span class="jg-status-text">
  <span aria-hidden="true" class="jg-status-text__dot" />
  <span>{{ label }}</span>
</span>
```

- [ ] `PaymentTaskQueue.vue` 接收任务行和 counts，通过 emit 通知视图切换/打开详情；组件内不得请求 API。
- [ ] 工作台默认 `mine`，首屏顺序固定为页头、视图切换、最多五张任务卡、筛选、六列台账。
- [ ] 六列固定为：付款申请、项目/商户、金额、当前状态、当前任务、操作。删除原付款主体、收款渠道、累计实付、收货、发票等展开列。
- [ ] 只在响应 `amountSummary !== null` 时显示金额摘要；`complete === false` 时同时显示“汇总未覆盖全部可见记录”，不得在浏览器根据角色或当前表格行自行拼出全局汇总。
- [ ] 所有操作按钮使用 TDesign；非交互状态使用 `BusinessStatusText`，不再渲染类似按钮的矩形状态块。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/web-admin test -- business-status-text.config.test.ts spot-payment-workbench.config.test.ts spot-procurement-pages.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] 更新 `PROGRESS.md` 并提交：

```bash
git add apps/web-admin/src/components/BusinessStatusText.vue apps/web-admin/src/components/business-status-text.config.ts apps/web-admin/src/components/business-status-text.config.test.ts apps/web-admin/src/pages/spot-procurement/components/PaymentTaskQueue.vue apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentWorkbenchPage.vue apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts PROGRESS.md
git commit -m "feat: build task-first spot payment workbench"
```

## Task 6: 从已批准采购直接进入唯一付款任务

**Files:**

- Modify: `services/api/src/spot-procurement/spot-procurement-read.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-read.service.spec.ts`
- Modify: `apps/web-admin/src/api/spot-procurement.api.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts`
- Modify: `PROGRESS.md`

- [ ] 写 API RED 测试：真实采购列表和详情的付款摘要返回当前可见有效 `paymentId`；无权查看付款时不得泄露 ID。
- [ ] 写 RED 测试：采购工作台对已批准且已有唯一付款草稿的行显示“填写付款申请”，点击进入 `/零星材料付款/:paymentId?tab=current`。
- [ ] 写 RED 测试：采购详情关联付款区的主操作为“进入付款申请”，不再只显示含义弱的“查看”。
- [ ] 写 RED 测试：没有付款草稿时只显示“采购审批完成后将自动生成付款草稿”，不显示“新建第二张付款申请”。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-read.service.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-procurement-pages.test.ts
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] 在 `summarizeRealPaymentFacts(...)` 的调用方增加 `paymentId` 投影，只选择当前可见且未失效的唯一付款；legacy 汇总结构不变。
- [ ] 在 Web API 的 `SpotProcurementRealPaymentSummaryReadModel` 增加 `paymentId: string | null`。
- [ ] 采购工作台把付款摘要行变为明确主操作，路由只使用后端返回的付款 ID；不调用 `createSpotProcurementPaymentDraft()`。
- [ ] 采购详情关联付款表的操作文案按后端 `currentTask`/付款状态显示“填写付款申请 / 处理付款 / 查看付款申请”。
- [ ] 付款详情读取 `tab=current` 并保持默认当前办理；未知 tab 回退 current，不白屏。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-read.service.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-procurement-pages.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] 更新 `PROGRESS.md` 并提交：

```bash
git add services/api/src/spot-procurement/spot-procurement-read.service.ts services/api/src/spot-procurement/spot-procurement-read.service.spec.ts apps/web-admin/src/api/spot-procurement.api.ts apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts PROGRESS.md
git commit -m "feat: link approved procurement to payment task"
```

## Task 7: 重组付款详情六页签与动态当前办理

**Files:**

- Create: `apps/web-admin/src/pages/spot-procurement/components/PaymentCurrentTaskPanel.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.test.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `PROGRESS.md`

- [ ] 写 RED 测试：详情固定六页签且默认 current；旧“付款事实 / 审批与办理 / 审批原件与归档”三个抽象页签不存在。
- [ ] 写 RED 测试：`PaymentCurrentTaskPanel` 只根据服务端 `currentTask`、`availableActions` 和业务摘要渲染主任务；无权时不渲染禁用高风险按钮。
- [ ] 写 RED 映射测试，覆盖七类岗位场景：物资员、物资主管、综合部主管、项目经理、财务人员、财务主管、董事长/总经理。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/web-admin test -- spot-payment-detail.config.test.ts spot-procurement-pages.test.ts
```

- [ ] 页面只保留 `loadDetail()`、路由、上传和写动作编排；将首屏任务卡抽到 `PaymentCurrentTaskPanel.vue`。
- [ ] 六页签内容精确归位：申请冻结事实、审批时间线、实付/退款/净付、收货/发票、审批原件/归档包；同一事实不在三个页签重复展开。
- [ ] 物资主管 current 页只展示“当前无需办理付款”和后续收货复核责任，不显示付款主体、审批、实付按钮。
- [ ] 财务人员审批完成后 current 页直接突出剩余待付和“登记实际付款”；审批前仅显示共享付款主体任务。
- [ ] 所有状态使用 `BusinessStatusText`；真正的动作继续用按钮。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/web-admin test -- spot-payment-detail.config.test.ts spot-procurement-pages.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
```

- [ ] 更新 `PROGRESS.md` 并提交：

```bash
git add apps/web-admin/src/pages/spot-procurement/components/PaymentCurrentTaskPanel.vue apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.ts apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.test.ts apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts PROGRESS.md
git commit -m "feat: reorganize spot payment detail"
```

## Task 8: 把 A5 付款草稿改为同页四步办理

**Files:**

- Create: `apps/web-admin/src/pages/spot-procurement/components/PaymentApplicationStepper.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.test.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts`
- Modify: `PROGRESS.md`

- [ ] 写 RED 测试：点击“填写付款申请”进入同页 stepper，不出现承载完整表单的 `t-dialog`。
- [ ] 写 RED 测试：四步标题、保存退出、继续填写、上一步/下一步和最终提交都存在；不显示预计 3–5 分钟。
- [ ] 写 RED 测试：正常模式输入商户后，提交 payload 的 `payeeName` 默认同商户；只有例外开关开启才显示独立收款对象和说明。
- [ ] 写 RED 测试：保存完整当前草稿仍调用现有 `updateSpotProcurementPaymentDraft()`，不创建步骤写接口。
- [ ] 写 E2E RED：保存第二步后刷新，重新进入恢复到第一个未完成步骤；本地输入保存失败时仍保留。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/web-admin test -- spot-payment-detail.config.test.ts spot-procurement-pages.test.ts
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] `PaymentApplicationStepper.vue` 使用 props 接收 detail 和本地 draft，使用 emits 发出 `save`、`submit`、`cancel`；组件不得导入 API。
- [ ] 第一步实现付款类型、历史商户建议、默认同收款对象和例外开关；经办人垫付时锁定经办人收款事实。
- [ ] 第二步只允许选择采购批准材料，数量不超批准量，数量/单价最多两位小数，有票必须税率；合计只用于预览。
- [ ] 第三步实现一个收款对象多个渠道、唯一主渠道和可选付款依据；银行渠道填写账户名、账号、开户行。
- [ ] 第四步展示项目、采购、商户/收款对象、材料、金额、渠道、付款主体状态和首个审批节点。
- [ ] 每次保存发送完整草稿快照；最终提交先保存成功，再调用 `submitSpotProcurementPayment()`，任一步失败不得创建审批实例。
- [ ] 移动端步骤纵向排列，保存退出后焦点回到“填写付款申请”触发位置。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/web-admin test -- spot-payment-detail.config.test.ts spot-procurement-pages.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] 更新 `PROGRESS.md` 并提交：

```bash
git add apps/web-admin/src/pages/spot-procurement/components/PaymentApplicationStepper.vue apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.ts apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.test.ts apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts PROGRESS.md
git commit -m "feat: add four-step spot payment application"
```

## Task 9: 统一付款主体协作和审批抽屉

**Files:**

- Create: `apps/web-admin/src/pages/spot-procurement/components/PaymentApprovalDrawer.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/components/PaymentCurrentTaskPanel.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-read.service.spec.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts`
- Modify: `PROGRESS.md`

- [ ] 补后端 RED 测试：财务人员、综合部主管、财务主管共享付款主体任务；第一人保存后第二人使用旧页面提交得到稳定冲突并刷新新事实。
- [ ] 补后端 RED 测试：综合部主管通过前主体和至少一种方式齐全；财务主管本节点改主体必须填写原因，并清除综合部/项目经理本轮通过事实后回到综合部节点。
- [ ] 写 Web RED 测试：审批首屏只有一个“办理审批”主按钮；抽屉只出现“通过 / 退回申请人修改”，不存在新版“拒绝”。
- [ ] 写 Web RED 测试：二次确认复述结果、金额、付款主体、收款对象和下一去向；退回原因必填，通过空意见不在前端伪造其他文本。
- [ ] 写 E2E RED：桌面右侧抽屉、390 像素全屏；关闭后焦点回到触发按钮。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts spot-procurement-read.service.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-procurement-pages.test.ts
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] 在 `updatePayer()` 的序列化事务中锁定付款行；付款主体已由其他共享岗位确定时返回 `409`，只有财务主管到自身节点并满足重审条件时允许受控变更。相同旧请求不得重复写审计。
- [ ] 共享任务成功后 `loadDetail()`；`409` 时显示“任务已由其他岗位完成”并刷新，不重试写入。
- [ ] `PaymentApprovalDrawer.vue` 接收岗位核对摘要和冻结金额事实，只 emit 最终 payload；自审原因和当前密码继续复用 `ApprovalSelfReviewFields`。
- [ ] 抽屉结果本地类型固定为：

```ts
type A5ApprovalResult = "approve" | "return_to_applicant";
```

- [ ] 通过意见留空直接发送空值，由 Task 2 的服务端冻结“同意”；退回原因在前端和后端双重必填。
- [ ] 财务主管变更主体继续使用敏感二次确认，显示旧主体、新主体、原因和“从综合部主管重新审批”的后果。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts spot-procurement-read.service.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-procurement-pages.test.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] 更新 `PROGRESS.md` 并提交：

```bash
git add apps/web-admin/src/pages/spot-procurement/components/PaymentApprovalDrawer.vue apps/web-admin/src/pages/spot-procurement/components/PaymentCurrentTaskPanel.vue apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue services/api/src/spot-procurement/spot-procurement-payment.service.ts services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts services/api/src/spot-procurement/spot-procurement-read.service.spec.ts apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts PROGRESS.md
git commit -m "feat: unify spot payment approval handling"
```

## Task 10: 将逐笔实际付款改为受控实付抽屉

**Files:**

- Create: `apps/web-admin/src/pages/spot-procurement/components/PaymentExecutionDrawer.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/components/PaymentCurrentTaskPanel.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.test.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts`
- Modify: `PROGRESS.md`

- [ ] 补后端 RED 测试：本次金额必须大于零且不超过剩余待付，只能选择已冻结渠道；非现金缺付款成功凭证失败，现金缺商家收据失败。
- [ ] 保留并扩充已有幂等 RED 测试：同一 `idempotencyKey` 重试不生成第二笔实付，上传/绑定失败不增加累计已付。
- [ ] 写 Web RED 测试：打开抽屉默认金额为 `remainingAmountCents` 转元文本；金额三位小数在文件上传前失败。
- [ ] 写 Web RED 测试：现金文案和文件标签为“商家收据”，其他方式为“付款成功凭证”；每次只选择一个冻结渠道。
- [ ] 写 E2E RED：连续登记两笔，第一笔后显示部分付款并开放收货，第二笔后剩余为零并显示已付款。
- [ ] 运行 RED：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-payment-detail.config.test.ts spot-procurement-pages.test.ts
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] `PaymentExecutionDrawer.vue` 接收冻结渠道、剩余待付和已有执行记录，emit 已锁定的金额、时间、方式、渠道、文件与密码；组件不得请求 API。
- [ ] 父页面继续执行“校验金额/时间 → 上传私有文件 → 固定幂等 payload → record execution → 刷新详情”的现有安全顺序。
- [ ] 网络失败保留 `executionAttempt`，用户明确改变金额、日期、渠道或文件时才重置幂等尝试。
- [ ] 实付成功后切换到“实际付款与凭证”页签并刷新 currentTask；不直接在浏览器增加累计金额。
- [ ] 退款仍走现有收货差异入口和 `recordSpotProcurementRefund()`，currentTask 只负责把财务人员引到既有办理面板，不创建“转商户余额”。
- [ ] 运行 GREEN：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts spot-procurement-payment-status.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-payment-detail.config.test.ts spot-procurement-pages.test.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] 更新 `PROGRESS.md` 并提交：

```bash
git add apps/web-admin/src/pages/spot-procurement/components/PaymentExecutionDrawer.vue apps/web-admin/src/pages/spot-procurement/components/PaymentCurrentTaskPanel.vue apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue services/api/src/spot-procurement/spot-procurement-payment.service.ts services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.ts apps/web-admin/src/pages/spot-procurement/spot-payment-detail.config.test.ts apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts PROGRESS.md
git commit -m "feat: add controlled spot payment execution drawer"
```

## Task 11: 完成角色矩阵、响应式回归与候选发布证据

**Files:**

- Modify: `apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-read.service.spec.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts`
- Modify: `PROGRESS.md`

- [ ] 建立七类账号 mock 矩阵，逐一断言当前办理主任务、只读责任和不存在的越权按钮。
- [ ] 覆盖物资员从采购工作台直达草稿、从付款待办继续填写、退回后置顶重提三条路径。
- [ ] 覆盖共享付款主体由三类岗位任一完成、其他账号刷新后消失、财务主管改主体重审。
- [ ] 覆盖综合部主管 → 项目经理 → 财务主管 → 董事长/总经理 OR 签，四类审批摘要与结果均正确。
- [ ] 覆盖两笔实际付款、独立渠道/凭证、现金收据、首笔开放收货、最终已付款。
- [ ] 覆盖返回工作台、未知页签、读取失败重试、并发 `409`、上传失败和幂等重试不白屏、不重复写业务事实。
- [ ] 在 1366、1024、768、390 四个视口运行页面级无横向溢出、焦点返回、抽屉全屏和步骤纵向测试。
- [ ] 运行定向门禁：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-read.service.spec.ts spot-procurement-payment.service.spec.ts spot-procurement-payment-real-form.spec.ts spot-procurement-money.spec.ts --runInBand
pnpm --filter @jiangkong/web-admin test -- spot-procurement.api.test.ts spot-payment-workbench.config.test.ts spot-payment-detail.config.test.ts spot-procurement-pages.test.ts business-status-text.config.test.ts
pnpm --filter @jiangkong/web-admin test:e2e:p0 -- spot-procurement-workbenches.e2e.ts --project=chromium
```

- [ ] 运行全量工程门禁：

```bash
pnpm --filter @jiangkong/api test -- --runInBand
pnpm --filter @jiangkong/web-admin test
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin build
git diff --check
```

- [ ] 人工打开构建后的工作台和详情，按设计稿检查：状态圆点与文字协调、按钮尺寸一致、无预计时长、任务首屏清楚、A5 表单不再是超长弹窗。
- [ ] 确认 `git diff --stat` 只包含本计划文件范围，没有 `.superpowers/`、密钥、生产配置、迁移或 PDF 版式改动。
- [ ] 在 `PROGRESS.md` 记录精确测试数量、浏览器视口结果、候选 SHA、无迁移结论和仍需真实岗位 UAT 的事项。
- [ ] 提交最终回归：

```bash
git add apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts services/api/src/spot-procurement/spot-procurement-read.service.spec.ts services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts PROGRESS.md
git commit -m "test: verify spot payment task workbench"
```

- [ ] 输出候选证据：分支名、完整 SHA、提交列表、门禁结果、Schema/迁移影响、回滚方式和真实岗位 UAT 清单。
- [ ] 停止执行并等待独立发布授权；不得自动推送、合并 `main` 或部署生产。

## 12. 完成定义

只有同时满足以下条件，才能把本计划标记完成：

- 服务端 `mine | all | closed`、任务投影、权限和排序测试通过。
- 新版 A5 后端不接受终止性 `reject`，通过空意见冻结“同意”，退回空原因失败。
- 物资主管没有付款主体、付款审批或实际付款写动作。
- 新写入数量、单价、实付和退款精确到两位小数；历史三至六位小数只读不改写。
- 付款工作台首屏为任务优先，六列台账在目标视口不造成页面级横向溢出。
- 已批准采购可以直接进入唯一付款任务。
- 付款详情六页签顺序固定，当前办理按服务端任务动态变化。
- 四步 A5 表单支持保存退出、恢复、最终核对和提交。
- 付款主体共享协作、财务主管变更重审、审批抽屉和逐笔实付抽屉均通过后端与浏览器测试。
- A4/A5 PDF、私有文件、下载审计、收货、退款、发票和归档既有规则未回归。
- `PROGRESS.md` 与代码、测试、Git 候选事实一致。
- 未经额外授权没有任何生产写入或发布动作。
