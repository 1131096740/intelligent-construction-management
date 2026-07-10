# Phase 0B Money BigInt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 32 位分值溢出和 JavaScript `number` 精度风险，使单笔合同、结算、付款、报销和累计金额安全支持超过 2100 万元。

**Architecture:** PostgreSQL 金额列统一改为 `BIGINT`；NestJS/Prisma 内部计算使用 `bigint`，API 以十进制字符串承载分值；Web 只把金额字符串转换为显示用元文本，不把大额分值转成 `number`。

**修正后的切片顺序：** 先完成不改数据库和外部契约的“内部 bigint 兼容准备”；再把数据库 BIGINT、API 字符串、共享读模型和 Web 适配放进同一个全仓通过的原子切换；最后执行数据库与全链路验收。前两个切片均不得单独发布。

**Tech Stack:** PostgreSQL BIGINT, Prisma BigInt, TypeScript bigint/string, Jest, Vitest.

---

## 金额契约

- 数据库：按分保存为 `BIGINT`。
- 写 API：金额字段为只含十进制数字的字符串，例如 `"2100000001"`。
- 读 API：金额字段为十进制字符串。通用 `apiJsonReplacer` 只作为兜底序列化保护；付款申请/实付/财务入账、结算创建、项目支出申请/实付/财务入账等 POST 业务响应必须在服务边界按明确金额字段白名单转换，嵌套分摊金额也不得依赖隐式 replacer。
- 后端：写入边界解析后、数据库读出后、金额计算和服务内部接口一律使用 `bigint`；数据库金额若不是 `bigint` 必须立即拒绝，不保留 `number | bigint`、`LegacyMoneyRequestValue` 或静默 `BigInt(number)` 兼容分支，也不得用 `Number()` 参与金额、额度、余额、累计或比较。
- 前端：录入单位为元；用字符串小数转换为分字符串，显示时用字符串分组和两位小数。
- 测试边界：`21000000.01` 元 = `"2100000001"` 分；另覆盖超过 `Number.MAX_SAFE_INTEGER` 的累计值拒绝进入任何 `number` 路径。

### 有符号金额唯一例外

- 只有结算明细 `sourceType === "manual_adjustment"` 可以接收规范有符号十进制分值字符串，用于扣款或冲减；金额不得为 0，且必须同时填写非空的调整名称和原因。
- `contract_bill_row` 结算明细及合同、付款、项目支出、额度、历史余额等其他金额继续使用非负契约；负数必须在写入前拒绝，不能借由通用有符号解析绕过。
- 验收测试必须同时覆盖：负数手工调整且原因完整时成功；负数手工调整缺原因时拒绝；负数合同清单行时拒绝；其他金额 DTO 的负数输入拒绝。

### Task 1: 固化共享金额字符串契约

**Files:**

- Modify: `packages/shared-domain/src/money.ts`
- Modify: `packages/shared-domain/src/money.test.ts`
- Modify as required by compiler: `packages/shared-domain/src/core-flow-read-model.ts`
- Modify as required by compiler: `packages/shared-domain/src/contract-workbench.ts`

- [ ] **Step 1: 先写失败测试**

为以下行为添加测试：

```ts
expect(assertNonNegativeMoneyCentsText("2100000001", "合同金额")).toBe("2100000001");
expect(assertPositiveMoneyCentsText("9007199254740993", "累计金额")).toBe("9007199254740993");
expect(() => assertNonNegativeMoneyCentsText("1.5", "金额")).toThrow();
expect(() => assertPositiveMoneyCentsText("0", "金额")).toThrow();
```

Run:

```bash
pnpm --filter @jiangkong/shared-domain test
```

Expected: 当前 `MoneyCents = number` 导致编译或断言失败。

- [ ] **Step 2: 实现金额字符串类型**

`packages/shared-domain/src/money.ts` 先增加不破坏现有消费者的过渡类型和函数：

```ts
export type MoneyCentsText = string;

const NON_NEGATIVE_CENTS = /^(0|[1-9]\d*)$/;
const POSITIVE_CENTS = /^[1-9]\d*$/;

export function assertNonNegativeMoneyCentsText(
  value: string,
  fieldName: string
): MoneyCentsText {
  if (!NON_NEGATIVE_CENTS.test(value)) {
    throw new Error(`${fieldName}必须填写 0 或更大的金额`);
  }
  return value;
}

export function assertPositiveMoneyCentsText(
  value: string,
  fieldName: string
): MoneyCentsText {
  if (!POSITIVE_CENTS.test(value)) {
    throw new Error(`${fieldName}必须填写大于 0 的金额`);
  }
  return value;
}
```

本任务暂不删除旧的 number helper，也不修改共享读模型；这样本次提交保持全仓可编译。最终切换在 Task 4 与 API/Web 消费者一次完成，结束时不保留 number 金额契约。

- [ ] **Step 3: 跑共享包测试和类型检查**

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/shared-domain typecheck
```

Expected: 全部退出 0。

- [ ] **Step 4: 提交共享契约**

```bash
git add packages/shared-domain/src
git commit -m "refactor: 固化金额字符串契约"
```

### Task 2: 把剩余 Prisma 金额列迁移为 BigInt

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260710153000_money_bigint/migration.sql`
- Test: `services/api/src/database/core-flow-api-verification.spec.ts`

- [ ] **Step 1: 写 schema 断言测试**

在数据库结构验证测试中读取 `schema.prisma`，断言所有以 `Cents` 结尾的金额列和审批金额阈值均不再为 `Int`。

```bash
pnpm --filter @jiangkong/api test -- src/database/core-flow-api-verification.spec.ts --runInBand
```

Expected: 测试列出当前 21 个 `Int`/`Int?` 金额列并失败。

- [ ] **Step 2: 修改 Prisma schema**

将以下字段从 `Int`/`Int?` 改为 `BigInt`/`BigInt?`：

- `PaymentTermsStage.fixedAmountCents`
- `Settlement.amountCents`
- `Settlement.finalCumulativeAmountCents`
- `Settlement.payableAmountCents`
- `Settlement.paidAmountCents`
- `SettlementLine.unitPriceCents`
- `SettlementLine.amountCents`
- `PaymentRequest.requestedAmountCents`
- `PaymentRequest.approvedAmountCents`
- `PaymentRequest.paidAmountCents`
- `PaymentExecution.amountCents`
- `PaymentExecutionAllocation.fixedAmountCents`
- `PaymentExecutionAllocation.sourcePayableAmountCents`
- `PaymentExecutionAllocation.amountCents`
- `FinanceRecord.amountCents`
- `ProjectExpenseRequest.requestedAmountCents`
- `ProjectExpenseRequest.approvedAmountCents`
- `ProjectExpenseRequest.paidAmountCents`
- `ProjectExpenseExecution.amountCents`
- `ApprovalFlowNode.minAmountCents`
- `ApprovalFlowNode.maxAmountCents`

- [ ] **Step 3: 创建可逆的类型扩容 SQL**

迁移只做 `INTEGER -> BIGINT` 扩容，不重算、不舍入数据。使用以下明确 SQL：

```sql
ALTER TABLE "PaymentTermsStage" ALTER COLUMN "fixedAmountCents" TYPE BIGINT USING "fixedAmountCents"::BIGINT;
ALTER TABLE "Settlement" ALTER COLUMN "amountCents" TYPE BIGINT USING "amountCents"::BIGINT;
ALTER TABLE "Settlement" ALTER COLUMN "finalCumulativeAmountCents" TYPE BIGINT USING "finalCumulativeAmountCents"::BIGINT;
ALTER TABLE "Settlement" ALTER COLUMN "payableAmountCents" TYPE BIGINT USING "payableAmountCents"::BIGINT;
ALTER TABLE "Settlement" ALTER COLUMN "paidAmountCents" TYPE BIGINT USING "paidAmountCents"::BIGINT;
ALTER TABLE "SettlementLine" ALTER COLUMN "unitPriceCents" TYPE BIGINT USING "unitPriceCents"::BIGINT;
ALTER TABLE "SettlementLine" ALTER COLUMN "amountCents" TYPE BIGINT USING "amountCents"::BIGINT;
ALTER TABLE "PaymentRequest" ALTER COLUMN "requestedAmountCents" TYPE BIGINT USING "requestedAmountCents"::BIGINT;
ALTER TABLE "PaymentRequest" ALTER COLUMN "approvedAmountCents" TYPE BIGINT USING "approvedAmountCents"::BIGINT;
ALTER TABLE "PaymentRequest" ALTER COLUMN "paidAmountCents" TYPE BIGINT USING "paidAmountCents"::BIGINT;
ALTER TABLE "PaymentExecution" ALTER COLUMN "amountCents" TYPE BIGINT USING "amountCents"::BIGINT;
ALTER TABLE "PaymentExecutionAllocation" ALTER COLUMN "fixedAmountCents" TYPE BIGINT USING "fixedAmountCents"::BIGINT;
ALTER TABLE "PaymentExecutionAllocation" ALTER COLUMN "sourcePayableAmountCents" TYPE BIGINT USING "sourcePayableAmountCents"::BIGINT;
ALTER TABLE "PaymentExecutionAllocation" ALTER COLUMN "amountCents" TYPE BIGINT USING "amountCents"::BIGINT;
ALTER TABLE "FinanceRecord" ALTER COLUMN "amountCents" TYPE BIGINT USING "amountCents"::BIGINT;
ALTER TABLE "ProjectExpenseRequest" ALTER COLUMN "requestedAmountCents" TYPE BIGINT USING "requestedAmountCents"::BIGINT;
ALTER TABLE "ProjectExpenseRequest" ALTER COLUMN "approvedAmountCents" TYPE BIGINT USING "approvedAmountCents"::BIGINT;
ALTER TABLE "ProjectExpenseRequest" ALTER COLUMN "paidAmountCents" TYPE BIGINT USING "paidAmountCents"::BIGINT;
ALTER TABLE "ProjectExpenseExecution" ALTER COLUMN "amountCents" TYPE BIGINT USING "amountCents"::BIGINT;
ALTER TABLE "ApprovalFlowNode" ALTER COLUMN "minAmountCents" TYPE BIGINT USING "minAmountCents"::BIGINT;
ALTER TABLE "ApprovalFlowNode" ALTER COLUMN "maxAmountCents" TYPE BIGINT USING "maxAmountCents"::BIGINT;
```

对上一步 21 个字段全部覆盖；保留原 nullability 和 default。`paidAmountCents` 的默认值必须保持 0。

- [ ] **Step 4: 生成客户端并验证 schema**

```bash
pnpm --filter @jiangkong/api exec prisma format
pnpm --filter @jiangkong/api exec prisma validate
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api test -- src/database/core-flow-api-verification.spec.ts --runInBand
```

Expected: 全部退出 0，schema 中 `rg -n 'Cents\s+Int'` 无金额结果。

- [ ] **Step 5: 保留迁移与后端改造在同一原子提交**

此时 Prisma 客户端类型已变化，现有服务仍可能编译失败。不要提交一个破坏全仓构建的中间状态；继续执行 Task 3，待后端适配完成后一起提交。

### Task 3: 收口后端金额解析、计算与响应

**Files:**

- Modify: `services/api/src/money/decimal-money.ts`
- Modify: `services/api/src/money/decimal-money.spec.ts`
- Modify: `services/api/src/payment/payment-amount.service.ts`
- Modify: `services/api/src/payment/payment-amount.service.spec.ts`
- Modify: `services/api/src/payment/settlement-payment-capacity.ts`
- Modify: `services/api/src/payment/settlement-payment-capacity.spec.ts`
- Modify: `services/api/src/payment/payment-request.service.ts`
- Modify: `services/api/src/payment/payment-request.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/project-expense/project-expense.service.ts`
- Modify: `services/api/src/project-expense/project-expense.service.spec.ts`
- Modify: `services/api/src/project/project.service.ts`
- Modify: `services/api/src/project/project.service.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/approval/approval-form.service.ts`
- Modify DTOs under `services/api/src/{contract,settlement,payment,project-expense,project}/dto/`

- [ ] **Step 1: 为 BigInt 边界写失败测试**

至少覆盖：

- `parseMoneyCents("2100000001") === 2100000001n`。
- 负数、小数、指数形式、空白和非数字被中文错误拒绝。
- 付款容量、结算累计、项目现金和费用累计使用 `bigint` 加减比较。
- API 返回值为字符串 `"2100000001"`。
- `9007199254740993n` 不经过 `centsToSafeNumber`。

先运行对应 Jest，确认当前 number 路径失败。

- [ ] **Step 2: 增加唯一金额转换函数**

在 `decimal-money.ts` 提供并测试：

```ts
export function parseMoneyCents(value: string, fieldName: string): bigint;
export function moneyCentsToApi(value: bigint): string;
export function yuanTextToCents(value: string, fieldName: string): bigint;
```

`centsToSafeNumber` 只可用于明确非金额的兼容显示；金额服务、读模型和 DTO 不得继续调用。

- [ ] **Step 3: 修改写入边界**

所有 `*Cents` DTO 改为字符串；服务入口立即用 `parseMoneyCents` 转为 bigint。Prisma create/update、事务累计、上限和余额比较均使用 bigint 常量，例如 `0n`、`100n`。

- [ ] **Step 4: 修改读取边界**

合同、结算、付款、费用、项目、接管和审批 PDF 读模型中的金额统一调用 `moneyCentsToApi`。PDF 格式化使用 bigint 的字符串算法或 Decimal，不先 `Number()`。

- [ ] **Step 5: 跑关键后端测试**

```bash
pnpm --filter @jiangkong/api test -- \
  src/money/decimal-money.spec.ts \
  src/payment/payment-amount.service.spec.ts \
  src/payment/settlement-payment-capacity.spec.ts \
  src/payment/payment-request.service.spec.ts \
  src/settlement/settlement.service.spec.ts \
  src/project-expense/project-expense.service.spec.ts \
  src/project/project.service.spec.ts \
  --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

Expected: 全部退出 0。

- [ ] **Step 6: 完成 API 检查但暂不提交破坏 Web 的中间契约**

API 输出改成字符串后，Web 尚未适配。确认 API 针对性测试、typecheck 和 lint 已通过，然后继续 Task 4；数据库、后端、共享读模型和 Web 在 Task 4 一起形成全仓通过的原子提交。

### Task 4: 更新 Web 金额录入与显示

**Files:**

- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Create: `apps/web-admin/src/lib/money.ts`
- Create: `apps/web-admin/src/lib/money.test.ts`
- Modify money formatters/config under:
  - `apps/web-admin/src/pages/contracts/`
  - `apps/web-admin/src/pages/settlements/`
  - `apps/web-admin/src/pages/payments/`
  - `apps/web-admin/src/pages/projects/`

- [ ] **Step 1: 写字符串金额前端测试**

覆盖：

```ts
expect(yuanTextToCentsText("21000000.01")).toBe("2100000001");
expect(centsTextToYuanText("2100000001")).toBe("21,000,000.01");
expect(centsTextToYuanText("9007199254740993")).toBe("90,071,992,547,409.93");
```

同时覆盖负数、三位小数、空值和非法字符。

- [ ] **Step 2: 实现纯字符串格式化**

`apps/web-admin/src/lib/money.ts` 不得对完整分值调用 `Number()` 或 `parseInt()`；用字符串拆分整数分和小数分、补零和分组。

- [ ] **Step 3: 更新 API 类型与页面表单**

将共享包最终收口为 `export type MoneyCents = string`，删除 Task 1 保留的 number 金额 helper，并把读写模型的 `*Cents` 改为 `MoneyCents`。页面保持“按元录入”，提交前调用 `yuanTextToCentsText`；展示调用 `centsTextToYuanText`。

- [ ] **Step 4: 验证 Web**

```bash
pnpm --filter @jiangkong/web-admin test
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
```

Expected: 全部退出 0。

- [ ] **Step 5: 提交 Web 金额治理**

```bash
git add services/api/prisma services/api/src apps/web-admin/src packages/shared-domain/src PROGRESS.md
git commit -m "refactor: 统一大额金额 bigint 与字符串契约"
```

### Task 5: 数据库与全链路验收

**Files:**

- Modify: `services/api/prisma/verify-core-flow.cjs`
- Modify: `services/api/prisma/verify-trial-run.cjs`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 在临时数据库应用迁移**

```bash
pnpm --filter @jiangkong/api exec prisma migrate deploy
pnpm --filter @jiangkong/api exec prisma migrate status
```

Expected: `20260710153000_money_bigint` 已应用，无 pending/failed migration。

- [ ] **Step 2: 增加 live 验证**

验证脚本创建并清理超过 2100 万元的合同/结算/付款测试数据，断言：

- 数据库存值正确。
- API 返回十进制字符串。
- 付款容量、累计和余额正确。
- 任何失败都在事务内回滚。

- [ ] **Step 3: 全量验证**

```bash
pnpm --filter @jiangkong/api verify:core-flow
pnpm --filter @jiangkong/api verify:trial-run:preflight
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin build
git diff --check
```

Expected: 全部退出 0。

- [ ] **Step 4: 更新进度并提交**

```bash
git add services/api/prisma/verify-core-flow.cjs services/api/prisma/verify-trial-run.cjs PROGRESS.md
git commit -m "test: 验证大额金额全链路"
```

## 迁移安全

- `INTEGER -> BIGINT` 是扩容迁移，不允许在同一迁移中改值、改币种或做元/分换算。
- 生产应用迁移前按阶段 0A 生成数据库备份。
- 数据库迁移与新代码必须在同一发布窗口完成；旧代码读取 BIGINT 可能得到 bigint，不能长时间混跑。
- 若全量类型修改过大，按“数据库/后端写入 -> 后端读取 -> Web”提交，但只能在完整阶段通过后发布，不发布半完成契约。
