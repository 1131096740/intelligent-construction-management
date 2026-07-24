# 合同清单多维表格与整表事务保存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将合同工作台清单迁移到现有 `JgBusinessGrid`，支持全宽专注编辑、100 行以上连续录入、标准 Excel 预检整体替换，并通过一次原子事务保存完整候选清单。

**Architecture:** 保持 `JgBusinessGrid` 为无合同知识的通用网格，在合同工作台内新增纯函数适配层、桌面网格/移动卡片编辑器和专注模式容器。Web 只维护完整本地候选，Excel 预检也只替换候选；服务端新增 `PUT /contract-bills/:billId/rows`，在现有所有人、状态、清单修订号、金额重算、文档失效和审计能力上完成一次整表事务。

**Tech Stack:** Vue 3、TypeScript、TDesign Vue Next、RevoGrid/JgBusinessGrid、Vitest、Playwright、NestJS、Prisma、PostgreSQL、Jest

---

## 实施边界与文件职责

本计划只处理合同清单，不处理合同条款、顶部导航，也不迁移其他业务明细页。实施前后都不得修改 Prisma Schema 或创建迁移；如果现有审计表无法安全承载幂等回执，停止实施并重新确认，不得自行新建表。

### 新建文件

- `apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.ts`：唯一的清单候选模型、服务端/网格映射、连续行操作、前端校验、汇总和 Excel 候选替换。
- `apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.test.ts`：纯函数 TDD。
- `apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.vue`：桌面 `JgBusinessGrid` 与移动卡片共享同一候选模型，负责编辑和错误定位，不请求 API。
- `apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.test.ts`：组件交互测试。
- `apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue`：专注模式工具栏、Excel 预检、替换确认、保存全部和离开状态。
- `apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.test.ts`：专注模式组件测试。
- `docs/product/editable-detail-grid-gap-inventory.md`：整站填写型明细迁移差距清单，只盘点，不顺手迁移。
- `apps/web-admin/e2e/contract-bill-focus-editor.e2e.ts`：Chromium/WebKit 真实交互。
- `apps/web-admin/playwright.contract-bill-focus.config.ts`：合同清单专用双浏览器配置。

### 修改文件

- `services/api/src/contract-bill/dto/contract-bill.dto.ts`：新增整表请求 DTO 类型。
- `services/api/src/contract-bill/contract-bill.controller.ts`：新增 `PUT :billId/rows`。
- `services/api/src/contract-bill/contract-bill.service.ts`：整表解析、锁、幂等回执、差异写入、一次修订/重算/审计。
- `services/api/src/contract-bill/contract-bill.service.spec.ts`：事务、回滚、并发、幂等、100+ 行、审计测试。
- `services/api/src/contract-bill/contract-bill.controller.spec.ts`：路由和用户透传测试。
- `services/api/src/contract-bill/contract-bill-excel.service.ts`：预检返回可直接装载的完整候选行。
- `services/api/src/contract-bill/contract-bill-excel.service.spec.ts`：Excel 候选行和错误测试。
- `apps/web-admin/src/api/contract-workbench.api.ts`：整表请求/响应/结构化错误类型和 API。
- `apps/web-admin/src/api/contract-workbench.api.test.ts`：请求、响应和错误解析测试。
- `apps/web-admin/src/pages/contracts/workbench/ContractBillsSection.vue`：窄栏只显示摘要和入口。
- `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`：专注模式切换、工作台回读和双层离开保护。
- `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.ts`：只保留仍被条款/文档或兼容代码使用的既有类型与辅助函数；重复的清单候选逻辑迁入新文件。
- `apps/web-admin/src/pages/contracts/workbench/ContractBillEditor.vue`：迁移完成后删除，确保不存在并行手写编辑入口。
- `PROGRESS.md`：登记实现、验证、浏览器证据和剩余真实业务验收。

## Task 1: 冻结整表 API 契约和结构化错误

**Files:**
- Modify: `services/api/src/contract-bill/dto/contract-bill.dto.ts`
- Modify: `services/api/src/contract-bill/contract-bill.controller.ts`
- Test: `services/api/src/contract-bill/contract-bill.controller.spec.ts`

- [ ] **Step 1: 写控制器失败测试**

在控制器测试中增加一例，明确 `PUT /contract-bills/:billId/rows` 只把当前登录用户和原始请求体交给 service：

```ts
it("replaces the complete bill row set for the current user", async () => {
  const user = { id: "user-1" } as AuthenticatedUser;
  const input = {
    expectedBillRevision: 7,
    idempotencyKey: "save-20260724-001",
    rows: [{
      clientRowKey: "local-1",
      sortOrder: 0,
      itemName: "混凝土",
      unit: "m³",
      quantity: "12.50",
      unitPrice: "480.00",
      taxRateSource: "version_default",
      customData: {}
    }]
  };
  service.replaceRows.mockResolvedValue({ bill: { revision: 8 }, rows: [] });

  await expect(controller.replaceRows("bill-1", user, input)).resolves.toEqual({
    bill: { revision: 8 },
    rows: []
  });
  expect(service.replaceRows).toHaveBeenCalledWith("bill-1", user.id, input);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand services/api/src/contract-bill/contract-bill.controller.spec.ts
```

Expected: FAIL，提示 `replaceRows` 不存在。

- [ ] **Step 3: 新增 DTO 和控制器路由**

在 DTO 文件中加入完整类型；字段名称必须与设计文档一致，`sortOrder` 由服务端按数组顺序重新规范化，客户端值只用于结构校验：

```ts
export interface ReplaceBillRowDto {
  clientRowKey: string;
  rowKey?: string;
  sortOrder: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
  isProvisional?: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}

export interface ReplaceBillRowsDto {
  expectedBillRevision: number;
  idempotencyKey: string;
  rows: ReplaceBillRowDto[];
}
```

在 controller 中加入：

```ts
@Put(":billId/rows")
replaceRows(
  @Param("billId") billId: string,
  @CurrentUser() user: AuthenticatedUser,
  @Body() body: ReplaceBillRowsDto
) {
  return this.bills.replaceRows(billId, user.id, body);
}
```

同时把 Nest 的 `Put` 和 DTO 的 `ReplaceBillRowsDto` 导入加入现有导入列表。

- [ ] **Step 4: 运行控制器测试**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand services/api/src/contract-bill/contract-bill.controller.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 提交 API 契约**

```bash
git add services/api/src/contract-bill/dto/contract-bill.dto.ts services/api/src/contract-bill/contract-bill.controller.ts services/api/src/contract-bill/contract-bill.controller.spec.ts
git commit -m "feat: add contract bill batch replace endpoint"
```

## Task 2: 用失败测试锁定整表事务、不变量和幂等语义

**Files:**
- Modify: `services/api/src/contract-bill/contract-bill.service.spec.ts`
- Modify: `services/api/src/contract-bill/contract-bill.service.ts`

- [ ] **Step 1: 扩充事务 mock**

为事务 client 增加本任务实际调用的方法：

```ts
const tx = {
  $queryRaw: jest.fn(),
  contract: { updateMany: jest.fn() },
  contractBill: { updateMany: jest.fn(), findUnique: jest.fn() },
  contractBillRow: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn()
  },
  auditLog: {
    findFirst: jest.fn(),
    create: jest.fn()
  },
  contractDocument: { updateMany: jest.fn() },
  contractVersion: { updateMany: jest.fn() }
};
```

保留原有测试依赖的方法；不要为了本任务删除单行接口测试。

- [ ] **Step 2: 写 101 行和混合差异失败测试**

构造 101 行请求，其中 40 行保留、30 行更新、31 行新增，服务端原有但请求中缺失的行应删除。断言：

```ts
expect(tx.contractBill.updateMany).toHaveBeenCalledTimes(1);
expect(tx.contractBill.updateMany).toHaveBeenCalledWith(expect.objectContaining({
  where: expect.objectContaining({ revision: 7 }),
  data: { revision: { increment: 1 } }
}));
expect(tx.contractBillRow.deleteMany).toHaveBeenCalledWith({
  where: {
    contractBillId: "bill-1",
    rowKey: { in: deletedRowKeys }
  }
});
expect(audit.record).toHaveBeenCalledTimes(1);
expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
  action: "contract.bill.rows.replace",
  businessId: "bill-1",
  metadata: expect.objectContaining({
    createdCount: 31,
    updatedCount: 30,
    deletedCount: deletedRowKeys.length,
    previousBillRevision: 7,
    nextBillRevision: 8
  })
}));
```

- [ ] **Step 3: 写校验失败零写入测试**

第二行给出非法数量，断言异常体为结构化错误且所有写方法均未调用：

```ts
await expect(service.replaceRows("bill-1", "user-1", {
  expectedBillRevision: 7,
  idempotencyKey: "invalid-save",
  rows: [
    validInputRow("local-1"),
    { ...validInputRow("local-2"), quantity: "12.345" }
  ]
})).rejects.toMatchObject({
  response: {
    code: "CONTRACT_BILL_VALIDATION_FAILED",
    rowErrors: [{
      clientRowKey: "local-2",
      field: "quantity",
      message: expect.any(String)
    }]
  }
});
expect(tx.contractBillRow.create).not.toHaveBeenCalled();
expect(tx.contractBillRow.update).not.toHaveBeenCalled();
expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
```

- [ ] **Step 4: 写并发和幂等失败测试**

覆盖四个互斥场景：

```ts
it.each([
  ["revision mismatch", { billGateCount: 0 }, "合同清单已变化"],
  ["same key different digest", { receiptDigest: "other-digest" }, "幂等键已被另一份清单使用"]
])("%s rejects without row writes", async (_label, setup, message) => {
  configureBatchMocks(setup);
  await expect(replace()).rejects.toThrow(message);
  expect(tx.contractBillRow.create).not.toHaveBeenCalled();
});

it("returns the authoritative saved result for the same key and digest", async () => {
  configureBatchMocks({ matchingReceipt: true });
  await expect(replace()).resolves.toEqual(authoritativeReadModel);
  expect(tx.contractBill.updateMany).not.toHaveBeenCalled();
  expect(audit.record).not.toHaveBeenCalled();
});
```

另加一例：模拟 `recalculateBillAndContractAmount` 或 audit 抛错，确认 `$transaction` promise 拒绝，且测试不能接受部分成功结果。

- [ ] **Step 5: 运行 service 测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand services/api/src/contract-bill/contract-bill.service.spec.ts
```

Expected: FAIL，最先出现 `service.replaceRows is not a function`。

## Task 3: 实现整表解析、锁、幂等回执和一次性落库

**Files:**
- Modify: `services/api/src/contract-bill/contract-bill.service.ts`
- Modify: `services/api/src/contract-bill/contract-bill.service.spec.ts`

- [ ] **Step 1: 增加稳定摘要和结构化错误类型**

把 crypto 导入改为：

```ts
import { createHash, randomUUID } from "node:crypto";
```

在 service 文件顶部加入：

```ts
type BatchRowError = {
  clientRowKey: string;
  field: string;
  message: string;
};

type ParsedBatchRow = ReplaceBillRowDto & {
  facts: ReturnType<typeof resolveContractBillRowFacts>;
  clientRowKey: string;
  rowKey?: string;
  sortOrder: number;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
```

同时把 `ReplaceBillRowDto` 加入 DTO type import。不要把整表明文写入日志或审计。

- [ ] **Step 2: 实现批量输入解析**

新增私有方法，先完整解析所有行，再允许任何写操作：

```ts
private parseReplaceInput(
  rawInput: unknown,
  bill: Parameters<ContractBillService["parseRowInput"]>[1],
  version: Parameters<ContractBillService["parseRowInput"]>[2]
) {
  const input = this.requireObject(rawInput, "合同清单整表提交内容");
  this.assertExpectedRevision(input.expectedBillRevision);
  if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9:_-]{8,128}$/.test(input.idempotencyKey)) {
    throw new BadRequestException("清单保存标识格式无效");
  }
  if (!Array.isArray(input.rows) || input.rows.length > 5000) {
    throw new BadRequestException("合同清单行数必须在 0 到 5000 行之间");
  }

  const clientKeys = new Set<string>();
  const serverKeys = new Set<string>();
  const rowErrors: BatchRowError[] = [];
  const rows: ParsedBatchRow[] = [];

  input.rows.forEach((rawRow, index) => {
    const row = this.requireObject(rawRow, `合同清单第 ${index + 1} 行`);
    const clientRowKey = typeof row.clientRowKey === "string" ? row.clientRowKey.trim() : "";
    if (!clientRowKey || clientKeys.has(clientRowKey)) {
      rowErrors.push({
        clientRowKey: clientRowKey || `row-${index + 1}`,
        field: "clientRowKey",
        message: clientRowKey ? "客户端行标识重复" : "客户端行标识不能为空"
      });
      return;
    }
    clientKeys.add(clientRowKey);
    const rowKey = typeof row.rowKey === "string" && row.rowKey.trim() ? row.rowKey.trim() : undefined;
    if (rowKey && serverKeys.has(rowKey)) {
      rowErrors.push({ clientRowKey, field: "rowKey", message: "服务端行标识重复" });
      return;
    }
    if (rowKey) serverKeys.add(rowKey);
    try {
      rows.push({
        ...this.parseRowInput({
          ...row,
          expectedBillRevision: input.expectedBillRevision
        }, bill, version),
        clientRowKey,
        ...(rowKey ? { rowKey } : {}),
        sortOrder: index
      });
    } catch (error) {
      rowErrors.push(this.batchRowError(clientRowKey, error));
    }
  });

  if (rowErrors.length) {
    throw new BadRequestException({
      code: "CONTRACT_BILL_VALIDATION_FAILED",
      message: `清单有 ${rowErrors.length} 处需要修改`,
      rowErrors
    });
  }
  return {
    expectedBillRevision: input.expectedBillRevision as number,
    idempotencyKey: input.idempotencyKey,
    rows
  };
}
```

`batchRowError` 必须把现有中文校验消息映射到稳定字段：

```ts
private batchRowError(clientRowKey: string, error: unknown): BatchRowError {
  const message = error instanceof BadRequestException
    ? String(error.getResponse() instanceof Object
      ? (error.getResponse() as { message?: unknown }).message ?? error.message
      : error.getResponse())
    : "该行内容无法保存";
  const field = message.includes("数量") ? "quantity"
    : message.includes("单价") ? "unitPrice"
    : message.includes("税率") ? "taxRatePercent"
    : message.includes("项目名称") ? "itemName"
    : message.includes("单位") ? "unit"
    : message.includes("自定义字段") ? "customData"
    : "row";
  return { clientRowKey, field, message };
}
```

- [ ] **Step 3: 实现串行锁、幂等查询和差异写入**

新增 public 方法；必须先 `FOR UPDATE` 锁定清单，再在同一事务内查幂等审计、校验修订、写差异、重算和审计：

```ts
replaceRows(billId: string, actorUserId: string, rawInput: unknown) {
  return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "ContractBill"
      WHERE "id" = ${billId}
      FOR UPDATE
    `);
    const { bill, version } = await loadOwnedEditableBill(tx, billId, actorUserId);
    const input = this.parseReplaceInput(rawInput, bill, version);
    const idempotencyKeyDigest = sha256(input.idempotencyKey);
    const requestDigest = sha256(stableJson({
      expectedBillRevision: input.expectedBillRevision,
      rows: input.rows.map((row) => Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== "facts")
      ))
    }));
    const receipt = await tx.auditLog.findFirst({
      where: {
        actorUserId,
        action: "contract.bill.rows.replace",
        businessType: "contract_bill",
        businessId: bill.id,
        metadata: {
          path: ["idempotencyKeyDigest"],
          equals: idempotencyKeyDigest
        }
      },
      orderBy: { createdAt: "desc" }
    });
    if (receipt) {
      const metadata = this.isPlainObject(receipt.metadata) ? receipt.metadata : {};
      if (metadata.requestDigest !== requestDigest) {
        throw new BadRequestException("幂等键已被另一份清单使用，请重新保存");
      }
      return this.readBill(tx, bill.id);
    }

    const existingRows = await tx.contractBillRow.findMany({
      where: { contractBillId: bill.id },
      orderBy: { sortOrder: "asc" }
    });
    const existingByKey = new Map(existingRows.map((row) => [row.rowKey, row]));
    const requestedKeys = new Set(input.rows.flatMap((row) => row.rowKey ? [row.rowKey] : []));
    const missingKeys = [...requestedKeys].filter((rowKey) => !existingByKey.has(rowKey));
    if (missingKeys.length) {
      throw new BadRequestException("清单已有行已变化，请刷新后重试");
    }

    const renderRevision = await this.lockMutation(
      tx,
      bill,
      version,
      actorUserId,
      input.expectedBillRevision
    );
    const deletedKeys = existingRows
      .map((row) => row.rowKey)
      .filter((rowKey) => !requestedKeys.has(rowKey));
    if (deletedKeys.length) {
      await tx.contractBillRow.deleteMany({
        where: { contractBillId: bill.id, rowKey: { in: deletedKeys } }
      });
    }

    let createdCount = 0;
    let updatedCount = 0;
    for (const row of input.rows) {
      const data = this.batchRowData(row);
      if (row.rowKey) {
        const existing = existingByKey.get(row.rowKey)!;
        if (this.batchRowChanged(existing, data)) {
          await tx.contractBillRow.update({
            where: { id: existing.id },
            data
          });
          updatedCount += 1;
        }
      } else {
        await tx.contractBillRow.create({
          data: {
            contractBillId: bill.id,
            rowKey: randomUUID(),
            ...data
          }
        });
        createdCount += 1;
      }
    }

    const rows = await recalculateBillAndContractAmount(tx, bill, version);
    await this.audit.record(tx, {
      actorUserId,
      action: "contract.bill.rows.replace",
      businessType: "contract_bill",
      businessId: bill.id,
      metadata: {
        idempotencyKeyDigest,
        requestDigest,
        createdCount,
        updatedCount,
        deletedCount: deletedKeys.length,
        previousBillRevision: input.expectedBillRevision,
        nextBillRevision: input.expectedBillRevision + 1,
        renderRevision
      }
    });
    const updatedBill = await tx.contractBill.findUnique({ where: { id: bill.id } });
    return this.toReadModel({ bill: updatedBill, rows });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
```

实现被上面调用的两个私有方法；`batchRowData` 必须复用 `parseRowInput` 生成的 facts，不重新计算第二遍：

```ts
private batchRowData(row: ParsedBatchRow) {
  return {
    sortOrder: row.sortOrder,
    itemCode: row.itemCode?.trim() || null,
    itemName: row.itemName.trim(),
    specification: row.specification?.trim() || null,
    unit: row.unit.trim(),
    quantity: row.facts.quantity,
    unitPrice: row.facts.unitPrice,
    taxRate: row.facts.taxRatePercent,
    taxRateSource: row.facts.taxRateSource,
    pricingFactStatus: row.facts.pricingFactStatus,
    precisionPolicy: row.facts.precisionPolicy,
    taxInclusiveAmountCents: row.facts.taxInclusiveAmountCents,
    taxExclusiveAmountCents: row.facts.taxExclusiveAmountCents,
    taxAmountCents: row.facts.taxAmountCents,
    isProvisional: row.isProvisional ?? false,
    settlementBasis: row.settlementBasis?.trim() || null,
    customData: this.toJson(row.customData)
  };
}

private async readBill(tx: Prisma.TransactionClient, billId: string) {
  const [bill, rows] = await Promise.all([
    tx.contractBill.findUnique({ where: { id: billId } }),
    tx.contractBillRow.findMany({
      where: { contractBillId: billId },
      orderBy: { sortOrder: "asc" }
    })
  ]);
  return this.toReadModel({ bill, rows });
}

private batchRowChanged(
  existing: {
    sortOrder: number;
    itemCode: string | null;
    itemName: string;
    specification: string | null;
    unit: string;
    quantity: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal | null;
    taxRate: Prisma.Decimal | null;
    taxRateSource: string;
    pricingFactStatus: string;
    precisionPolicy: string;
    taxInclusiveAmountCents: bigint | null;
    taxExclusiveAmountCents: bigint | null;
    taxAmountCents: bigint | null;
    isProvisional: boolean;
    settlementBasis: string | null;
    customData: Prisma.JsonValue;
  },
  data: ReturnType<ContractBillService["batchRowData"]>
) {
  const decimal = (value: Prisma.Decimal | null) => value?.toString() ?? null;
  return existing.sortOrder !== data.sortOrder ||
    existing.itemCode !== data.itemCode ||
    existing.itemName !== data.itemName ||
    existing.specification !== data.specification ||
    existing.unit !== data.unit ||
    decimal(existing.quantity) !== decimal(data.quantity) ||
    decimal(existing.unitPrice) !== decimal(data.unitPrice) ||
    decimal(existing.taxRate) !== decimal(data.taxRate) ||
    existing.taxRateSource !== data.taxRateSource ||
    existing.pricingFactStatus !== data.pricingFactStatus ||
    existing.precisionPolicy !== data.precisionPolicy ||
    existing.taxInclusiveAmountCents !== data.taxInclusiveAmountCents ||
    existing.taxExclusiveAmountCents !== data.taxExclusiveAmountCents ||
    existing.taxAmountCents !== data.taxAmountCents ||
    existing.isProvisional !== data.isProvisional ||
    existing.settlementBasis !== data.settlementBasis ||
    stableJson(existing.customData) !== stableJson(data.customData);
}
```

- [ ] **Step 4: 运行事务测试并修正 mock，不放宽断言**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand services/api/src/contract-bill/contract-bill.service.spec.ts
```

Expected: PASS，并明确看到 100+ 行、混合差异、结构化错误、冲突、相同幂等请求和不同摘要拒绝全部通过。

- [ ] **Step 5: 提交整表事务**

```bash
git add services/api/src/contract-bill/contract-bill.service.ts services/api/src/contract-bill/contract-bill.service.spec.ts
git commit -m "feat: replace contract bill rows atomically"
```

## Task 4: 让 Excel 预检返回完整本地候选而不写业务事实

**Files:**
- Modify: `services/api/src/contract-bill/contract-bill-excel.service.ts`
- Modify: `services/api/src/contract-bill/contract-bill-excel.service.spec.ts`

- [ ] **Step 1: 写预检候选失败测试**

在 replace 模式预检测试中断言：

```ts
expect(result.candidateRows).toEqual([
  expect.objectContaining({
    clientRowKey: expect.stringMatching(/^import-/),
    rowKey: undefined,
    sortOrder: 0,
    itemName: "混凝土",
    unit: "m³",
    quantity: "12.5",
    unitPrice: "480",
    taxRateSource: "version_default",
    customData: {}
  })
]);
expect(tx.contractBillRow.create).not.toHaveBeenCalled();
expect(tx.contractBillRow.deleteMany).not.toHaveBeenCalled();
```

再加一例模板列错误，断言 `candidateRows` 为空且当前数据库行不受影响。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand services/api/src/contract-bill/contract-bill-excel.service.spec.ts
```

Expected: FAIL，结果中不存在 `candidateRows`。

- [ ] **Step 3: 扩充预检读模型**

新增类型：

```ts
type BillImportCandidateRow = {
  clientRowKey: string;
  rowKey?: string;
  sortOrder: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource: "version_default" | "row_override";
  isProvisional: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
};
```

把 `BillImportPreview` 增加 `candidateRows: BillImportCandidateRow[]`。在所有解析和业务校验完成后，从 replace plan 的 resolved rows 生成候选：

```ts
const candidateRows = plan.errors.length
  ? []
  : plan.adds.map((row, index) => ({
      clientRowKey: `import-${importId}-${index + 1}`,
      sortOrder: index,
      ...(row.itemCode ? { itemCode: row.itemCode } : {}),
      itemName: row.itemName,
      ...(row.specification ? { specification: row.specification } : {}),
      unit: row.unit,
      ...(row.quantity === null ? {} : { quantity: row.quantity.toString() }),
      unitPrice: row.unitPrice.toString(),
      ...(row.taxRatePercent === null
        ? {}
        : { taxRatePercent: row.taxRatePercent.toString() }),
      taxRateSource: row.taxRateSource,
      isProvisional: row.isProvisional,
      ...(row.settlementBasis ? { settlementBasis: row.settlementBasis } : {}),
      customData: row.customData as Record<string, unknown>
    }));
```

现有“应用导入”接口暂时保留作兼容，但新 Web 流程不得调用它。不要在预检中创建、更新或删除清单行。

- [ ] **Step 4: 运行 Excel 测试**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand services/api/src/contract-bill/contract-bill-excel.service.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 提交 Excel 候选**

```bash
git add services/api/src/contract-bill/contract-bill-excel.service.ts services/api/src/contract-bill/contract-bill-excel.service.spec.ts
git commit -m "feat: return contract bill import candidates"
```

## Task 5: 建立 Web 整表 API 和结构化错误边界

**Files:**
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it("puts the complete bill candidate and preserves structured row errors", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({
    code: "CONTRACT_BILL_VALIDATION_FAILED",
    message: "清单有 1 处需要修改",
    rowErrors: [{ clientRowKey: "local-1", field: "quantity", message: "数量格式无效" }]
  }, 400));

  await expect(replaceContractBillRows("bill-1", {
    expectedBillRevision: 7,
    idempotencyKey: "save-20260724-001",
    rows: [candidate]
  })).rejects.toMatchObject({
    code: "CONTRACT_BILL_VALIDATION_FAILED",
    rowErrors: [{ clientRowKey: "local-1", field: "quantity" }]
  });
  expect(fetchMock).toHaveBeenCalledWith("/api/contract-bills/bill-1/rows", expect.objectContaining({
    method: "PUT"
  }));
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/api/contract-workbench.api.test.ts
```

Expected: FAIL，提示导出函数不存在。

- [ ] **Step 3: 增加类型、`putJson` 和 API 函数**

```ts
export type ContractBillRowValidationError = {
  clientRowKey: string;
  field: string;
  message: string;
};

export type ContractBillValidationError = Error & {
  code: "CONTRACT_BILL_VALIDATION_FAILED";
  rowErrors: ContractBillRowValidationError[];
};

export type ReplaceContractBillRowsInput = {
  expectedBillRevision: number;
  idempotencyKey: string;
  rows: ContractBillCandidateRowInput[];
};

export function replaceContractBillRows(
  billId: string,
  input: ReplaceContractBillRowsInput
) {
  return putJson<ContractBillReplaceReadModel>(
    `/contract-bills/${encodeURIComponent(billId)}/rows`,
    input,
    parseContractBillValidationError
  );
}
```

`parseContractBillValidationError` 只在 code 和 rowErrors 结构合法时附加字段，其他错误继续走现有中文错误转换，不能把任意响应强制伪装成单元格错误。

- [ ] **Step 4: 运行 API 单测**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/api/contract-workbench.api.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交 Web API**

```bash
git add apps/web-admin/src/api/contract-workbench.api.ts apps/web-admin/src/api/contract-workbench.api.test.ts
git commit -m "feat: add contract bill batch save client"
```

## Task 6: 用纯函数实现同一份清单候选

**Files:**
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.ts`

- [ ] **Step 1: 写连续新增、复制、删除、排序和服务端映射失败测试**

测试必须覆盖：

```ts
const initial = fromWorkbenchBill(billFixture);
const withTwenty = Array.from({ length: 20 }).reduce(
  (rows) => addBillCandidateRow(rows),
  initial
);
expect(withTwenty).toHaveLength(initial.length + 20);
expect(new Set(withTwenty.map((row) => row.clientRowKey)).size).toBe(withTwenty.length);

const copied = copyBillCandidateRow(withTwenty, withTwenty[0].clientRowKey);
expect(copied.at(-1)).toMatchObject({
  rowKey: undefined,
  itemName: withTwenty[0].itemName
});

expect(removeBillCandidateRow(copied, copied[0].clientRowKey)).toHaveLength(copied.length - 1);
expect(moveBillCandidateRow(copied, copied[1].clientRowKey, -1)[0].clientRowKey)
  .toBe(copied[1].clientRowKey);
```

另测：服务端结构化错误按 `clientRowKey + field` 映射；Excel 替换返回全新候选但取消路径保留原数组；成功响应重新生成带服务端 `rowKey` 的权威候选。

- [ ] **Step 2: 写校验和汇总失败测试**

至少覆盖项目名称、单位、数量两位小数、单价、税率和自定义必填列。金额测试使用与后端相同的半入规则：

```ts
expect(candidateTotals([{
  ...validCandidate,
  quantity: "3",
  unitPrice: "10.01",
  taxRatePercent: "13",
  taxRateSource: "row_override"
}])).toEqual({
  taxInclusiveAmountCents: "3003",
  taxExclusiveAmountCents: "2658",
  taxAmountCents: "345"
});
```

- [ ] **Step 3: 运行测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.test.ts
```

Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现候选模型和纯函数**

文件必须导出明确接口：

```ts
export type ContractBillCandidateRow = {
  clientRowKey: string;
  rowKey?: string;
  itemCode: string;
  itemName: string;
  specification: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  taxRatePercent: string;
  taxRateSource: "version_default" | "row_override";
  isProvisional: boolean;
  settlementBasis: string;
  customData: Record<string, string>;
};

export type ContractBillCellError = {
  clientRowKey: string;
  field: string;
  message: string;
};

export function addBillCandidateRow(rows: ContractBillCandidateRow[]) {
  return [...rows, emptyBillCandidateRow()];
}

export function copyBillCandidateRow(rows: ContractBillCandidateRow[], clientRowKey: string) {
  const source = rows.find((row) => row.clientRowKey === clientRowKey);
  if (!source) return rows;
  return [...rows, {
    ...source,
    clientRowKey: crypto.randomUUID(),
    rowKey: undefined,
    customData: { ...source.customData }
  }];
}

export function removeBillCandidateRow(rows: ContractBillCandidateRow[], clientRowKey: string) {
  return rows.filter((row) => row.clientRowKey !== clientRowKey);
}

export function moveBillCandidateRow(
  rows: ContractBillCandidateRow[],
  clientRowKey: string,
  offset: -1 | 1
) {
  const from = rows.findIndex((row) => row.clientRowKey === clientRowKey);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= rows.length) return rows;
  const next = rows.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
```

金额计算不得用浮点数直接乘；在本文件实现 decimal string 到整数分子/scale、`roundHalfUp` 和税额拆分，返回字符串 cents。输入非法时 totals 标记为不可计算，最终服务端仍重新校验。

- [ ] **Step 5: 运行纯函数测试**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交候选模型**

```bash
git add apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.ts apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.test.ts apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.ts
git commit -m "feat: model contract bill grid candidates"
```

## Task 7: 构建桌面网格和移动卡片编辑器

**Files:**
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.test.ts`
- Reuse: `apps/web-admin/src/components/JgBusinessGrid.vue`

- [ ] **Step 1: 写组件失败测试**

挂载时注入 20 行候选，断言桌面只渲染一个 `JgBusinessGrid`；触发 `update:source` 后 emit 完整候选；移动宽度时渲染行卡但仍 emit 同一类型：

```ts
expect(wrapper.findAllComponents(JgBusinessGrid)).toHaveLength(1);
await wrapper.getComponent(JgBusinessGrid).vm.$emit("update:source", editedGridRows);
expect(wrapper.emitted("update:rows")?.at(-1)?.[0]).toEqual(expectedCandidates);
expect(wrapper.text()).toContain("第 1 行");
```

加入结构化错误后，断言错误摘要、首个错误单元格标识和“下一处错误”事件可用。

- [ ] **Step 2: 运行组件测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.test.ts
```

Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现组件公开接口**

```ts
const props = defineProps<{
  bill: WorkbenchBill;
  rows: ContractBillCandidateRow[];
  errors: ContractBillCellError[];
  readonly: boolean;
}>();

const emit = defineEmits<{
  "update:rows": [rows: ContractBillCandidateRow[]];
  "select-row": [clientRowKey: string];
}>();
```

桌面模板必须只有一个编辑网格：

```vue
<JgBusinessGrid
  v-if="!isMobile"
  :source="gridRows"
  :columns="columns"
  :readonly="readonly"
  :min-height="520"
  @update:source="onGridRowsChanged"
/>
<div v-else class="bill-card-list">
  <t-card v-for="(row, index) in rows" :key="row.clientRowKey">
    <template #title>第 {{ index + 1 }} 行</template>
    <t-input
      :model-value="row.itemName"
      :disabled="readonly"
      @update:model-value="updateMobileCell(row.clientRowKey, 'itemName', String($event))"
    />
  </t-card>
</div>
```

移动卡片须覆盖所有可编辑核心字段和模板自定义字段，不得只实现项目名称。所有尺寸、间距和颜色使用 `--jg-*` 或 TDesign 变量。

- [ ] **Step 4: 运行组件测试和 UI 规则**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.test.ts
pnpm --filter @jiangkong/web-admin check:ui
```

Expected: 两条命令 PASS。

- [ ] **Step 5: 提交编辑器**

```bash
git add apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.vue apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.test.ts
git commit -m "feat: add responsive contract bill grid"
```

## Task 8: 构建专注模式、Excel 候选替换和保存全部

**Files:**
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractBillsSection.vue`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Delete: `apps/web-admin/src/pages/contracts/workbench/ContractBillEditor.vue`

- [ ] **Step 1: 写摘要与专注模式失败测试**

摘要测试断言窄栏不再出现输入控件/宽表，只显示行数、三项合计、状态、下载、导入和“放大编辑”。专注模式测试覆盖：

```ts
await wrapper.get("[data-testid='bill-add-row']").trigger("click");
await wrapper.get("[data-testid='bill-add-row']").trigger("click");
expect(wrapper.getComponent(ContractBillGrid).props("rows")).toHaveLength(savedRows.length + 2);
expect(saveButton.attributes("disabled")).toBeUndefined();

excelApi.preview.mockResolvedValue({ candidateRows: importedRows, errors: [] });
await applyPreview();
expect(confirmDialog.text()).toContain(`将替换当前 ${savedRows.length + 2} 行未保存清单`);
await cancelReplace();
expect(wrapper.getComponent(ContractBillGrid).props("rows")).toEqual(manualRows);
await confirmReplace();
expect(wrapper.getComponent(ContractBillGrid).props("rows")).toEqual(importedRows);
expect(batchApi.replaceContractBillRows).not.toHaveBeenCalled();
```

保存测试断言：点击“保存全部”才调用整表 API；失败保留候选和临时键；成功以后端返回整体替换候选并清除 dirty。

另加普通草稿 dirty 前置测试：

```ts
await wrapper.setProps({ ordinaryDraftDirty: true });
await wrapper.get("[data-testid='bill-save-all']").trigger("click");
expect(wrapper.text()).toContain("请先使用右上角保存当前合同基础信息");
expect(batchApi.replaceContractBillRows).not.toHaveBeenCalled();
expect(saveContractDraft).not.toHaveBeenCalled();
```

- [ ] **Step 2: 运行组件测试并确认失败**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.test.ts
```

Expected: FAIL，专注模式组件不存在。

- [ ] **Step 3: 实现专注模式状态机**

组件公开接口固定为：

```ts
const props = defineProps<{
  bill: WorkbenchBill;
  disabled: boolean;
  ordinaryDraftDirty: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [readModel: ContractBillReplaceReadModel];
  "dirty-change": [dirty: boolean];
}>();
```

状态：

```ts
const rows = ref(fromWorkbenchBill(props.bill));
const baselineDigest = ref(candidateDigest(rows.value));
const errors = ref<ContractBillCellError[]>([]);
const saving = ref(false);
const saveMessage = ref("");
const preview = ref<BillImportPreview | null>(null);
const replaceConfirmVisible = ref(false);
const pendingImportRows = ref<ContractBillCandidateRow[] | null>(null);
const selectedClientRowKey = ref("");
const saveKey = ref(crypto.randomUUID());
const dirty = computed(() => candidateDigest(rows.value) !== baselineDigest.value);
```

工具栏动作必须直接操作同一候选：

```ts
function addRow() {
  rows.value = addBillCandidateRow(rows.value);
  selectedClientRowKey.value = rows.value.at(-1)?.clientRowKey ?? "";
}

function copySelectedRow() {
  rows.value = copyBillCandidateRow(rows.value, selectedClientRowKey.value);
  selectedClientRowKey.value = rows.value.at(-1)?.clientRowKey ?? "";
}

function deleteSelectedRow() {
  rows.value = removeBillCandidateRow(rows.value, selectedClientRowKey.value);
  selectedClientRowKey.value = rows.value[0]?.clientRowKey ?? "";
}

function moveSelectedRow(offset: -1 | 1) {
  rows.value = moveBillCandidateRow(rows.value, selectedClientRowKey.value, offset);
}
```

下载按钮复用现有标准模板下载 API；Excel input 只接受 `.xlsx`。如果普通合同草稿仍 dirty，预检和“保存全部”显示“请先使用右上角保存当前合同基础信息”，不得偷偷调用普通草稿保存，也不得分配正式编号。候选编辑、复制、删除和排序仍可继续。

保存成功时：

```ts
const saved = await replaceContractBillRows(props.bill.id, {
  expectedBillRevision: props.bill.revision,
  idempotencyKey: saveKey.value,
  rows: toReplaceRowsInput(rows.value)
});
rows.value = fromReplaceReadModel(saved);
baselineDigest.value = candidateDigest(rows.value);
saveKey.value = crypto.randomUUID();
errors.value = [];
saveMessage.value = "清单已全部保存";
emit("dirty-change", false);
emit("saved", saved);
```

捕获 `ContractBillValidationError` 时只更新 errors；冲突/权限/状态错误显示在顶部。失败不得清空 rows、baseline 或 saveKey，同一网络重试继续使用原 key。

- [ ] **Step 4: 把正常工作台收敛为摘要入口**

`ContractBillsSection.vue` 移除 `ContractBillEditor`，emit 改为：

```ts
const emit = defineEmits<{
  edit: [billKey: string];
  import: [billKey: string];
}>();
```

每个清单只显示摘要与入口。`ContractWorkbenchPage.vue` 增加：

```ts
const focusedBillKey = ref("");
const billEditorDirty = ref(false);
const focusedBill = computed(() =>
  (billWorkbench.value?.bills ?? []).find((bill) => bill.billKey === focusedBillKey.value) ?? null
);
```

专注模式必须替换工作台普通双栏区域，而不是打开新 route 或浏览器页。关闭、切分区和路由离开时，将 `billEditorDirty` 纳入现有 `useUnsavedChangesGuard`；选择“继续编辑”不改变候选，选择“放弃”恢复 baseline 后关闭。

挂载专注模式时传入 `:ordinary-draft-dirty="isDirty"`；该值只用于阻止依赖服务端合同税务/模板事实的预检和保存，不得把普通草稿自动并入清单批量 API。

- [ ] **Step 5: 删除并行手写编辑入口**

删除 `ContractBillEditor.vue`，然后运行：

```bash
rg -n "ContractBillEditor|hasUnsavedRow|applyBillExcelImport" apps/web-admin/src/pages/contracts apps/web-admin/src/api
```

Expected: 不再有组件引用；新合同清单页面不再调用 `applyBillExcelImport`。API 兼容导出如果仍被其他位置使用可以保留。

- [ ] **Step 6: 运行工作台定向测试**

Run:

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.test.ts apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.test.ts apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交工作台集成**

```bash
git add apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue apps/web-admin/src/pages/contracts/workbench/ContractBillsSection.vue apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.test.ts apps/web-admin/src/pages/contracts/workbench/ContractBillEditor.vue
git commit -m "feat: add contract bill focus editing"
```

## Task 9: 浏览器验收 100+ 行、Excel 替换和双尺寸交互

**Files:**
- Create: `apps/web-admin/e2e/contract-bill-focus-editor.e2e.ts`
- Create: `apps/web-admin/playwright.contract-bill-focus.config.ts`

- [ ] **Step 1: 建立双浏览器配置**

复用项目现有 preview server，配置 Chromium 和 WebKit，并使用独立端口避免与其他 E2E 冲突：

```ts
export default defineConfig({
  testDir: "./e2e",
  testMatch: "contract-bill-focus-editor.e2e.ts",
  use: { baseURL: "http://127.0.0.1:4188", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "webkit", use: devices["Desktop Safari"] }
  ],
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1 --port 4188",
    port: 4188,
    reuseExistingServer: false
  }
});
```

- [ ] **Step 2: 写桌面和移动失败场景**

用 route mocks 提供合同工作台、Excel 上传/预检和整表保存响应。测试必须实际：

- 进入清单分区，确认窄栏无可编辑宽表；
- 点击“放大编辑”；
- 连续新增到至少 20 行；
- 一次粘贴多行；
- 选择一行后复制、删除、上移和下移；
- 点击下载标准模板并断言调用当前 bill 的模板下载 API；
- 模拟 101 行 Excel 预检；
- 取消替换后手工候选不变；
- 确认替换后未立即 PUT；
- 点击“保存全部”只发一次 PUT，并以后端行键替换本地候选；
- 375px 手机视口使用卡片编辑，候选和错误计数一致。

- [ ] **Step 3: 运行 E2E 并保留失败证据**

Run:

```bash
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.contract-bill-focus.config.ts
```

Expected: Chromium 和 WebKit 全部 PASS；失败时保留 trace，不以截图代替断言。

- [ ] **Step 4: 提交浏览器验收**

```bash
git add apps/web-admin/e2e/contract-bill-focus-editor.e2e.ts apps/web-admin/playwright.contract-bill-focus.config.ts
git commit -m "test: cover contract bill focus editing"
```

## Task 10: 产出整站填写型明细差距清单并完成门禁

**Files:**
- Create: `docs/product/editable-detail-grid-gap-inventory.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 只读盘点其他填写型明细**

文档必须按以下表头登记，不把只读台账误列为迁移对象：

```md
| 领域 | 页面/组件 | 当前编辑方式 | 是否多行填写 | 是否需要计算/粘贴 | 建议底座 | 本次处理 |
| --- | --- | --- | --- | --- | --- | --- |
| 合同 | 合同清单 | JgBusinessGrid 领域适配 | 是 | 是 | JgBusinessGrid | 已完成 |
| 合同 | 付款条款 | 结构化表单 | 是 | 是 | 后续独立切片评估 | 不处理 |
```

每一行必须指向当前真实文件；只记录事实、风险和建议优先级，不承诺本计划未实现的迁移。

- [ ] **Step 2: 运行 API 门禁**

```bash
pnpm --filter @jiangkong/api test -- --runInBand services/api/src/contract-bill/contract-bill.controller.spec.ts services/api/src/contract-bill/contract-bill.service.spec.ts services/api/src/contract-bill/contract-bill-excel.service.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api build
```

Expected: 全部 PASS。

- [ ] **Step 3: 运行 Web 门禁**

```bash
pnpm --filter @jiangkong/web-admin test -- apps/web-admin/src/api/contract-workbench.api.test.ts apps/web-admin/src/pages/contracts/workbench/contract-bill-grid.test.ts apps/web-admin/src/pages/contracts/workbench/ContractBillGrid.test.ts apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.contract-bill-focus.config.ts
git diff --check
```

Expected: 全部 PASS。

- [ ] **Step 4: 检查实现边界**

```bash
git diff --name-only -- prisma services/api/prisma
git status --short
```

Expected: 没有 Prisma Schema 或 migration 变更；只出现本计划文件和用户已有改动。若出现迁移，停止并向用户重新确认。

- [ ] **Step 5: 更新进度并提交**

`PROGRESS.md` 记录：

- 完成的 API/组件/E2E；
- 通过的精确命令；
- Chromium/WebKit 结果；
- 当前 Git SHA；
- 尚缺真实合同员对 100+ 行录入效率、标准 Excel 模板和手机卡片的业务验收；
- 明确未推送、未部署、未写生产数据。

```bash
git add docs/product/editable-detail-grid-gap-inventory.md PROGRESS.md
git commit -m "docs: record contract bill grid verification"
```

## 完成定义

只有同时满足以下条件，才能把本计划标记为“本地实现完成”：

- 手写 `ContractBillEditor` 不再是任何合同清单编辑入口；
- 20 行连续新增和 100+ 行虚拟滚动/Excel 候选均有自动化证据；
- Excel 应用只改本地候选，保存全部才 PUT；
- 任一行失败时整表零落库；
- 相同幂等请求不重复递增修订或审计；
- 成功后以前端收到的权威清单整体替换候选；
- 清单 dirty 与普通草稿 dirty 分开显示、分开保存、共同参与离开保护；
- API/Web 门禁和 Chromium/WebKit E2E 通过；
- 没有 Schema、migration、生产发布或生产数据动作；
- `PROGRESS.md` 已随实现提交更新。
