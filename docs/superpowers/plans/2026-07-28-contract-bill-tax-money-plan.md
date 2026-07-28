# 合同清单、税率与金额精度实施计划

> **For Codex:** REQUIRED SUB-SKILL: 使用 executing-plans 逐任务实施；金额、税率和 Excel 任务必须使用 test-driven-development，完成前使用 verification-before-completion。

**目标：** 统一系统与 Excel 的税率表达和逐行金额算法，使不含税单价内部保留 6 位、页面默认显示 2 位，同时保证合同总额只由权威行总价汇总。

**核心架构：** `decimal-money.ts` 是唯一金额计算入口；`contract-bill-row-rules.ts` 负责领域校验；Excel 导入只负责把单元格归一化为同一领域输入。前端不得自行重算权威总额。

**依赖：** Prisma Decimal、ExcelJS、现有 `ContractBillService` 和 `JgBusinessGrid`。

---

## Task 1：锁定含税计价的权威公式

**Files:**

- Modify: `services/api/src/money/decimal-money.ts`
- Modify: `services/api/src/money/decimal-money.spec.ts`
- Modify: `services/api/src/contract-bill/contract-bill-row-rules.ts`
- Modify: `services/api/src/contract-bill/contract-bill.service.spec.ts`

### Step 1：先写 75 万元回归 RED

测试输入：

```ts
const result = calculateBillRow({
  quantity: "2000",
  unitPrice: "375",
  taxRatePercent: "9",
  pricingMode: "tax_inclusive"
});
```

权威结果：

```ts
expect(result.taxInclusiveAmountCents).toBe(75_000_000n);
expect(result.taxExclusiveAmountCents).toBe(68_807_339n);
expect(result.taxAmountCents).toBe(6_192_661n);
expect(result.taxExclusiveUnitPrice).toBe("344.036695");
```

说明：`68,807,339 ÷ 100 ÷ 2000 = 344.036695`。页面显示 `344.04`；若错误地用 `344.04 × 2000` 会得到 `688,080.00`，比权威不含税总价多 `6.61` 元。这一用例专门阻断“用展示单价反算总额”。

再覆盖：

- 含税行总价先四舍五入到分，再除税。
- 零数量时不生成派生不含税单价。
- 负数、超存储范围、非法税率失败关闭。
- 不含税计价模式仍以不含税总价为权威，再计算含税总价。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/money/decimal-money.spec.ts
```

预期：当前返回值没有 `taxExclusiveUnitPrice`，测试失败。

### Step 3：做最小实现

```ts
function sixDecimalUnitPrice(amountCents: bigint, quantity: Prisma.Decimal) {
  if (quantity.isZero()) return null;
  return new Prisma.Decimal(amountCents.toString())
    .div(100)
    .div(quantity)
    .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(6);
}
```

`calculateBillRow` 返回：

```ts
{
  taxInclusiveAmountCents,
  taxExclusiveAmountCents,
  taxAmountCents,
  taxExclusiveUnitPrice
}
```

任何调用方不得传入或覆盖派生值。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/money/decimal-money.spec.ts src/contract-bill/contract-bill.service.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/money services/api/src/contract-bill
git commit -m "test: lock contract bill money invariants"
```

---

## Task 2：持久化 6 位不含税单价

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260728110000_contract_bill_net_unit_price/migration.sql`
- Create: `services/api/src/database/contract-bill-net-unit-price-schema.spec.ts`
- Modify: `services/api/src/contract-bill/contract-bill.service.ts`
- Modify: `services/api/src/contract-bill/contract-bill.service.spec.ts`
- Modify: `services/api/src/contract-bill/contract-bill-totals.ts`

### Step 1：先写结构和服务 RED

新增字段：

```prisma
taxExclusiveUnitPrice Decimal? @db.Decimal(24, 6)
```

测试证明：

- 新保存或导入的含税行总会持久化 6 位派生值。
- 客户端伪造 `taxExclusiveUnitPrice` 被 DTO 丢弃或拒绝。
- 更新数量、含税单价或税率时重新派生。
- 汇总逻辑只使用三项 `...AmountCents`，不读取派生单价。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-bill-net-unit-price-schema.spec.ts src/contract-bill/contract-bill.service.spec.ts
```

### Step 3：添加迁移

迁移只新增 nullable 列，不对旧行猜测回填。旧草稿在下一次聚合保存或受控迁移时重算；已生效历史行保持原金额和空派生值。

### Step 4：写入和 read model

所有 `create`、`update`、`replaceRows`、Excel apply 路径都从 `resolveContractBillRowFacts` 取得派生值。

### Step 5：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-bill-net-unit-price-schema.spec.ts src/contract-bill/contract-bill.service.spec.ts
pnpm --filter @jiangkong/api exec prisma validate
pnpm --filter @jiangkong/api exec prisma generate
```

### Step 6：提交

```bash
git add services/api/prisma services/api/src/database/contract-bill-net-unit-price-schema.spec.ts services/api/src/contract-bill
git commit -m "fix: preserve six decimal net unit prices"
```

---

## Task 3：统一税率归一化规则

**Files:**

- Modify: `packages/shared-domain/src/contract-tax-facts.ts`
- Modify: `packages/shared-domain/src/contract-tax-facts.test.ts`
- Modify: `services/api/src/contract-bill/contract-bill-row-rules.ts`
- Modify: `services/api/src/contract-bill/contract-bill-guards.spec.ts`

### Step 1：先写领域归一化测试

领域层统一使用“百分数值”：

```text
9% -> "9"
13% -> "13"
0% -> "0"
```

数据库 `defaultTaxRatePercent` 仍保存 `9.000000`；只有 Excel 单元格可以把底层 `0.09` 转换为领域值 `9`。

测试：

```ts
expect(normalizeTaxRatePercent("9")).toBe("9");
expect(normalizeTaxRatePercent("9%")).toBe("9");
expect(normalizeTaxRatePercent("9.000000")).toBe("9");
```

领域函数不能把普通字符串 `"0.09"` 静默改成 `"9"`；这个判断必须依赖 Excel 单元格格式，留在 Excel adapter。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/shared-domain test -- contract-tax-facts.test.ts
pnpm --filter @jiangkong/api test -- --runInBand src/contract-bill/contract-bill-guards.spec.ts
```

### Step 3：实现并运行 GREEN

单一税率合同：

- 永远使用 `ContractVersion.defaultTaxRatePercent`。
- 行输入没有独立税率来源。
- 只要合同默认税率已确认，空 Excel 税率也合法。

多税率合同：

- 行税率非空且与默认值不同，标记 `row_override`。
- 空值或与默认值等价，标记 `version_default`。

```bash
pnpm --filter @jiangkong/shared-domain test -- contract-tax-facts.test.ts
pnpm --filter @jiangkong/api test -- --runInBand src/contract-bill/contract-bill-guards.spec.ts
```

### Step 4：提交

```bash
git add packages/shared-domain/src/contract-tax-facts.ts packages/shared-domain/src/contract-tax-facts.test.ts services/api/src/contract-bill
git commit -m "fix: centralize contract bill tax normalization"
```

---

## Task 4：修复 Excel 百分比读取

**Files:**

- Modify: `services/api/src/contract-bill/contract-bill-excel.service.ts`
- Modify: `services/api/src/contract-bill/contract-bill-excel.service.spec.ts`
- Create: `services/api/src/contract-bill/contract-draft-bill-excel.controller.ts`
- Create: `services/api/src/contract-bill/contract-draft-bill-excel.controller.spec.ts`
- Modify: `services/api/src/contract-bill/contract-bill.module.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`

### Step 1：先写四种单元格 RED

用 ExcelJS 在内存中生成：

| 单元格 value | numFmt | 领域结果 |
| --- | --- | --- |
| `9` | `0.######` | `"9"` |
| `"9%"` | `General` | `"9"` |
| `0.09` | `0%` | `"9"` |
| `0.09` | `0.######%` | `"9"` |

再覆盖：

- `0.13` + 百分比格式 -> `"13"`。
- 公式税率、NaN、负数、超过 100 拒绝。
- 单一税率合同的等价 Excel 值不再误报“不一致”。
- 多税率合同仍能识别真实例外。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-bill/contract-bill-excel.service.spec.ts
```

### Step 3：实现单元格适配器

不要继续只调用 `rawCellText`。新增：

```ts
private taxRatePercentFromCell(cell: Cell): string {
  const raw = cell.value;
  const hasPercentFormat = /%/.test(cell.numFmt ?? "");

  if (typeof raw === "number" && hasPercentFormat) {
    return normalizeTaxRatePercent(
      new Prisma.Decimal(raw).mul(100).toString()
    );
  }

  return normalizeTaxRatePercent(this.rawCellText(cell));
}
```

读取 worksheet 时，税率列保留 `Cell` 上下文；其他字段继续使用原始文本策略。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-bill/contract-bill-excel.service.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-bill/contract-bill-excel.service.ts services/api/src/contract-bill/contract-bill-excel.service.spec.ts
git commit -m "fix: normalize excel percentage tax cells"
```

---

## Task 5：让下载模板继承并锁定合同税率

**Files:**

- Modify: `services/api/src/contract-bill/contract-bill-excel.service.ts`
- Modify: `services/api/src/contract-bill/contract-bill-excel.service.spec.ts`

### Step 1：先写模板 RED

单一税率合同模板必须满足：

- 税率数据单元格 value 为 `0.09`。
- numFmt 为 `0.######%`。
- 税率列 locked。
- 数量、含税单价等输入列 unlocked。
- worksheet protection 已启用，不能直接改税率列。
- 说明文字明确“税率来自合同草稿，不需要填写”。

多税率合同：

- 默认值仍显示为合同税率。
- 税率列允许编辑例外。
- 说明文字明确留空继承。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-bill/contract-bill-excel.service.spec.ts
```

### Step 3：修改模板

单一税率写值：

```ts
const excelRate = new Prisma.Decimal(defaultRate).div(100).toNumber();
cell.value = excelRate;
cell.numFmt = "0.######%";
cell.protection = { locked: true };
```

启用保护前显式把可填写列设为 unlocked。不要把隐藏的字段代码行暴露给用户。

导入时：

- 单一税率只验证模板值是否与合同税率等价，随后丢弃行税率并继承合同版本。
- 锁定被人为解除且值真的不同，返回“模板税率已被修改，请重新下载当前合同模板”，不能报笼统的“不一致”。

同时增加精确版本和 billKey 路由：

```http
GET  /contract-drafts/:contractVersionId/bills/:billKey/template
POST /contract-drafts/:contractVersionId/bills/:billKey/import-preview
```

控制器先以 `(contractVersionId, billKey)` 找到清单，禁止前端只传全局 billId。导入预检返回规范化 rows 和目标 bill revision，由前端放入聚合 model；不再调用独立“应用导入并写库”，最终持久化仍由顶部全局保存完成。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-bill/contract-bill-excel.service.spec.ts src/contract-bill/contract-draft-bill-excel.controller.spec.ts
pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-bill apps/web-admin/src/api/contract-workbench.api.ts apps/web-admin/src/api/contract-workbench.api.test.ts
git commit -m "fix: inherit contract tax rate in bill templates"
```

---

## Task 6：前端只展示派生单价，不参与运算

**Files:**

- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue`
- Modify: `apps/web-admin/e2e/contract-bill-focus-editor.e2e.ts`

### Step 1：先写展示和提交 RED

断言：

- 表格默认显示 `344.04`。
- hover、详情或展开区显示完整 `344.036695`。
- 编辑 payload 不包含 `taxExclusiveUnitPrice`。
- 表尾不含税总价显示 `688,073.39`，不是 `688,080.00`。
- 用户复制展示值后不能导致后端总额被覆盖。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-bill-grid.test.ts src/pages/contracts/workbench/contract-bill-editor.test.ts
```

### Step 3：实现展示 helper

```ts
export function netUnitPriceDisplay(value: string | null) {
  return value === null ? "—" : decimalDisplay(value, 2);
}

export function netUnitPriceDetail(value: string | null) {
  return value === null ? "—" : decimalDisplay(value, 6);
}
```

总额直接渲染后端 `taxExclusiveAmountCents` 汇总。

### Step 4：运行 GREEN 和 E2E

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-bill-grid.test.ts src/pages/contracts/workbench/contract-bill-editor.test.ts
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.contract-bill-focus.config.ts
```

### Step 5：提交

```bash
git add apps/web-admin/src/pages/contracts/workbench apps/web-admin/e2e/contract-bill-focus-editor.e2e.ts
git commit -m "fix: display authoritative contract bill amounts"
```

---

## Task 7：取得真实 Excel 后建立发布硬回归

**Files:**

- Create after receiving source data: `services/api/src/contract-bill/fixtures/real-tax-rounding-regression.json`
- Create: `services/api/src/contract-bill/contract-bill-real-regression.spec.ts`
- Create: `services/api/scripts/inspect-contract-bill-regression.cjs`
- Modify: `PROGRESS.md`

### Step 1：只读保全原始证据

合同部提供文件后：

1. 不把含项目名、供应商、人员或合同编号的原始文件提交 Git。
2. 记录原始文件 SHA-256、sheet 名、Excel 单元格 value、numFmt 和公式类型。
3. 用只读脚本输出逐行对账，不修改原文件。
4. 把最小复现事实脱敏为 JSON：

```json
{
  "sourceSha256": "<sha256>",
  "taxMode": "single_rate",
  "defaultTaxRatePercent": "9",
  "rows": [
    {
      "quantityCell": { "value": 2000, "numFmt": "0.00" },
      "grossUnitPriceCell": { "value": 375, "numFmt": "0.00" },
      "taxRateCell": { "value": 0.09, "numFmt": "0%" }
    }
  ],
  "expected": {
    "taxInclusiveAmountCents": "75000000",
    "taxExclusiveAmountCents": "68807339"
  }
}
```

真实数字以拿到的文件为准，禁止用上述示例替代真实回归。

### Step 2：先证明旧行为可复现

测试必须能区分：

- 旧税率读取是否把 `0.09` 当成 `0.09%`。
- Excel 是否用 2 位展示单价乘数量，而系统用行总价除税。
- 是否存在 Excel 公式本身采用不同舍入顺序。

若原始 Excel 的公式规则与已确认系统规则不同，输出逐行差异，不擅自改变已确认系统公式。

### Step 3：运行回归

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-bill/contract-bill-real-regression.spec.ts
node services/api/scripts/inspect-contract-bill-regression.cjs --fixture services/api/src/contract-bill/fixtures/real-tax-rounding-regression.json
```

预期：测试通过；脚本输出含税、不含税、税额逐行和汇总均与已确认规则一致。

### Step 4：更新进度和提交

`PROGRESS.md` 必须记录：

- 原始文件 SHA-256，不记录原始文件路径和敏感内容。
- 差异根因。
- 回归测试结果。
- 原始 Excel 是否与系统规则一致。

```bash
git add services/api/src/contract-bill/fixtures/real-tax-rounding-regression.json services/api/src/contract-bill/contract-bill-real-regression.spec.ts services/api/scripts/inspect-contract-bill-regression.cjs PROGRESS.md
git commit -m "test: add real contract bill rounding regression"
```

如果尚未取得真实 Excel，本 Task 必须保持未完成，整个改造不得进入生产发布。

---

## Task 8：收口验证

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test -- --runInBand \
  src/money/decimal-money.spec.ts \
  src/contract-bill/contract-bill.service.spec.ts \
  src/contract-bill/contract-bill-excel.service.spec.ts \
  src/contract-bill/contract-bill-guards.spec.ts \
  src/database/contract-bill-net-unit-price-schema.spec.ts
pnpm --filter @jiangkong/web-admin test -- \
  src/pages/contracts/workbench/contract-bill-grid.test.ts \
  src/pages/contracts/workbench/contract-bill-editor.test.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git diff --check
```

预期：全部退出码 `0`，且 75 万元回归精确输出 `688,073.39` 元不含税总价。
