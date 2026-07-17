# 建工智管零星采购实施计划

> 2026-07-18 状态提示：本计划已按旧零星采购规则执行并形成生产运行代码，但真实入口现已关闭。本计划不能继续作为重构执行依据；待用户确认 `docs/superpowers/specs/2026-07-18-spot-procurement-real-form-redesign.md` 后另写变更实施计划。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不扩张旧 `ProjectExpenseRequest` 的前提下，新增可小项目试运行的零星采购独立模块，完整覆盖采购申请、独立付款、实际付款、最终收货、水印影像、差异结算、供应商余额、发票/无票、PDF、审计和自动办结。

**Architecture:** 采用“独立领域模型 + 复用共享基础设施 + 后端统一闭环计算”。采购根单和冻结版本承载审批事实；付款、实际付款、收货、差异、退款、供应商余额和票据分别保存不可混淆的事实；所有金额、占用、余额和办结条件均在 PostgreSQL 事务中由后端计算。旧项目支出链路只保留历史读取。新入口先由项目白名单控制，两个代码阶段都完成并通过验收后才允许试运行。

**Tech Stack:** NestJS、TypeScript、Prisma 5、PostgreSQL 16、Jest、Vue 3、TDesign Vue Next、Vite、Vitest、Playwright、PDFKit、`sharp`、腾讯 COS 私有对象存储。

---

## 0. 执行边界与当前基线

本计划依据已确认设计：

- `docs/superpowers/specs/2026-07-16-spot-procurement-expense-reimbursement-design.md`

计划编写时仓库基线：

- `HEAD`：`fc98e6b3`，当前工作树为 detached HEAD。
- 旧轻量零星采购位于 `ProjectExpenseRequest`，已有采购执行、实付、凭证、财务入账、收货确认、PDF 和审计。
- 通用审批、私有文件、归档、PDF、审计、整数分金额和项目资金池能力均已存在。
- 当前审批单固定格子签名改造位于其他任务分支；本计划只接入共享审批单能力，不新建第二套签名系统。
- 最终查看和下载范围尚未由用户确认；首期只实现业务办理必需的最小授权点，不扩大为“登录即可查看”。
- 当前仅授权编写并确认实施计划；本计划不授权连接或修改生产、不授权推送 `main`、生产迁移、真实业务写入或部署。

实施开始前必须：

1. 创建 `codex/spot-procurement` 候选分支或隔离工作树。
2. 重新读取 `PROGRESS.md`、`AGENTS.md`、设计文档和本计划。
3. 确认其他审批单分支是否已改动 `ApprovalFormService`；如已改动，先做接口对齐，不复制签名代码。
4. 每完成一个 Task，更新 `PROGRESS.md`，运行该 Task 的最小门禁并独立提交。
5. 任一代码阶段完成都不得单独开放真实入口；只有 Task 18 的总验收和用户授权通过后才能进入试运行发布。

## 1. 不可破坏的业务不变量

实施中必须由数据库约束、事务锁和服务测试共同保护：

1. 一张采购根单只对应一家冻结供应商。
2. 采购提交后冻结供应商、原因、经办人、明细、票据条件、税率快照、价格、合计和附件快照。
3. 客户端合计不作为账本依据；后端按定点数量和单价重新计算整数分。
4. 物资主管发起采购时跳过物资主管节点，但不得伪造一条审批通过记录。
5. 采购审批通过只自动创建付款草稿，不自动提交付款。
6. 付款草稿不占金额；提交付款时才同时占用采购可申请金额和供应商余额。
7. `本次结算申请金额 = 供应商余额抵扣金额 + 公司实际付款申请金额`。
8. 审批通过不等于实际付款；只有财务登记实付与有效凭证后才增加已付金额。
9. 供应商余额抵扣不是银行付款，不得生成假凭证或增加银行已付金额。
10. 项目现金在实际付款时检查和扣减，审批时只占用，不扣减。
11. 一张采购只有一张最终收货确认单，不建立批次。
12. 正式收货至少一张材料或卸货照片；乙方送货单可选，不能代替现场照片。
13. 系统拍照和相册上传都允许，不采集、不校验定位。
14. 服务端同时保存原图、水印图及哈希关联；首次提交后原照片不可删除、覆盖或替换，只能追加。
15. 实际采购成本只按合格实际收货数量乘冻结含税/无票单价计算；不合格和无偿附赠不计成本。
16. 合格收货不得超过审批数量；超出只能登记为无偿附赠，否则另行采购。
17. 少货未付部分取消；真实多付必须整笔退款或整笔转同项目同供应商余额，不可拆分。
18. 供应商余额只能同项目、同供应商使用，提交时预留，失败单据释放，财务主管验密后执行。
19. 有效发票覆盖与已确认无票只能覆盖实际采购成本，不能覆盖退款、转余额或取消额度。
20. 所有办结条件由后端统一计算；最后一个条件满足时立即办结，办结后不可撤销或更正。

## 2. 目标状态、业务类型和路由

### 2.1 审批与 PDF 业务类型

统一使用：

```ts
export const SPOT_PROCUREMENT_BUSINESS_TYPES = {
  application: "spot_procurement_version",
  payment: "spot_procurement_payment",
  receipt: "spot_procurement_receipt"
} as const;
```

- 采购申请审批实例的 `businessId` 指向冻结的 `SpotProcurementVersion.id`。
- 付款审批实例的 `businessId` 指向 `SpotProcurementPayment.id`。
- 收货确认不走审批引擎，但单独生成最新版 PDF。
- 采购申请和付款审批 PDF 接入共享 `ApprovalFormService`。
- 收货确认 PDF 使用独立生成器并复用 `PdfDocument`、私有文件和归档能力。

### 2.2 Web 路由

```text
/零星采购工作台
/零星采购/:procurementId
/零星材料付款工作台
/零星材料付款/:paymentId
/收货确认工作台
/零星采购/:procurementId/收货确认
```

兼容英文重定向：

```text
/spot-procurements
/spot-procurements/:procurementId
/spot-procurement-payments
/spot-procurement-payments/:paymentId
/spot-procurement-receipts
```

### 2.3 API 路由

```text
GET    /spot-procurements/capabilities?projectId=
GET    /spot-procurements?projectId=&status=&keyword=
POST   /spot-procurements
GET    /spot-procurements/:procurementId
PATCH  /spot-procurements/:procurementId/draft
POST   /spot-procurements/:procurementId/versions
POST   /spot-procurements/:procurementId/submission
POST   /spot-procurements/:procurementId/approval
POST   /spot-procurements/:procurementId/approval-withdrawal
POST   /spot-procurements/:procurementId/voiding

GET    /spot-procurement-payments?projectId=&status=&keyword=
POST   /spot-procurements/:procurementId/payments
GET    /spot-procurement-payments/:paymentId
PATCH  /spot-procurement-payments/:paymentId/draft
POST   /spot-procurement-payments/:paymentId/submission
POST   /spot-procurement-payments/:paymentId/approval
POST   /spot-procurement-payments/:paymentId/approval-withdrawal
POST   /spot-procurement-payments/:paymentId/voiding
POST   /spot-procurement-payments/:paymentId/executions
POST   /spot-procurement-payments/:paymentId/balance-execution

GET    /spot-procurement-receipts?projectId=&status=&keyword=
GET    /spot-procurements/:procurementId/receipt
POST   /spot-procurements/:procurementId/receipt/delegations
POST   /spot-procurements/:procurementId/receipt/photos
PATCH  /spot-procurements/:procurementId/receipt/draft
POST   /spot-procurements/:procurementId/receipt/submission
POST   /spot-procurements/:procurementId/receipt/review
POST   /spot-procurements/:procurementId/receipt/review-revocation

POST   /spot-procurements/:procurementId/discrepancy
POST   /spot-procurements/:procurementId/refunds
POST   /spot-procurements/:procurementId/supplier-balance-credit

GET    /vat-rate-options
POST   /vat-rate-options
PATCH  /vat-rate-options/:optionId
POST   /spot-procurements/:procurementId/invoices
POST   /invoice-allocations/:allocationId/reversal
POST   /spot-procurements/:procurementId/no-invoice-confirmations
POST   /spot-procurements/:procurementId/no-invoice-confirmations/:confirmationId/review
POST   /spot-procurements/:procurementId/invoice-exceptions
POST   /spot-procurements/:procurementId/invoice-exceptions/:exceptionId/review

POST   /spot-procurements/:procurementId/application-pdf-download-ticket
POST   /spot-procurement-payments/:paymentId/pdf-download-ticket
POST   /spot-procurements/:procurementId/receipt-pdf-download-ticket
```

控制器可以按 application/payment/receipt/invoice 拆分，但外部路径必须保持上面契约。

## 3. 分阶段交付策略

### 代码阶段 A：采购申请、付款和项目资金

完成 Task 1-8：

- 新领域基础表。
- 采购明细与版本审批。
- 自动付款草稿。
- 付款审批、供应商余额预留框架。
- 实际付款与项目资金池接入。
- 申请/付款 PDF、文件、归档、待办。
- Web 采购和付款工作台。

阶段 A 只供自动测试和开发环境验证，不允许试运行，因为收货、票据和自动办结尚未完成。

### 代码阶段 B：收货、结算、票据和自动办结

完成 Task 9-17：

- 最终收货、水印照片、委托和复核撤销。
- 实际成本、差异、退款、供应商余额形成和执行。
- 发票、无票、票据异常。
- 收货 PDF。
- 自动办结和 Web 全闭环。

### 试运行阶段

完成 Task 18：

- 十五个场景自动/受控 UAT。
- 小项目白名单。
- 备份、迁移、回滚和生产闸门。
- 用户再次授权后才允许发布。

## Task 1：建立共享业务契约、权限动作和试运行开关

**Files:**

- Create: `packages/shared-domain/src/spot-procurement.ts`
- Modify: `packages/shared-domain/src/index.ts`
- Modify: `packages/shared-domain/src/permissions.ts`
- Modify: `packages/shared-domain/src/permissions.test.ts`
- Create: `services/api/src/spot-procurement/spot-procurement.constants.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-pilot.service.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-pilot.service.spec.ts`
- Modify: `services/api/.env.example`
- Modify: `services/api/.env.production.example`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写共享状态和权限的失败测试**

在 `permissions.test.ts` 增加：

```ts
it("maps spot procurement write actions to the confirmed business roles", () => {
  expect(ACTION_REQUIRED_ROLES["spot_procurement.create"]).toEqual(
    expect.arrayContaining(["material_staff", "material_director"])
  );
  expect(ACTION_REQUIRED_ROLES["spot_procurement.payment.approve"]).toEqual(
    expect.arrayContaining([
      "comprehensive_director",
      "project_manager",
      "finance_director",
      "chairman",
      "general_manager"
    ])
  );
  expect(ACTION_REQUIRED_ROLES["spot_procurement.payment.execute"]).toContain("finance_staff");
  expect(ACTION_REQUIRED_ROLES["spot_procurement.receipt.review"]).toContain("material_director");
  expect(ACTION_REQUIRED_ROLES["spot_procurement.balance.execute"]).toContain("finance_director");
});
```

- [ ] **Step 2：运行共享测试并确认 RED**

```bash
pnpm --filter @jiangkong/shared-domain test -- permissions.test.ts
```

Expected: FAIL，动作尚不存在。

- [ ] **Step 3：增加共享状态、动作和最小角色映射**

`spot-procurement.ts` 至少导出：

```ts
export const SPOT_PROCUREMENT_STATUSES = [
  "draft",
  "approval_pending",
  "approved_in_progress",
  "closed",
  "voided"
] as const;

export const SPOT_PROCUREMENT_PAYMENT_STATUSES = [
  "draft",
  "approval_pending",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "settled",
  "returned",
  "rejected",
  "withdrawn",
  "voided",
  "invalidated"
] as const;

export const RECEIPT_STATUSES = [
  "draft",
  "submitted",
  "returned",
  "reviewed",
  "review_revoked",
  "locked"
] as const;

export const INVOICE_MODES = ["invoice", "no_invoice"] as const;
export const VAT_INVOICE_TYPES = ["vat_general", "vat_special"] as const;
export const PAYMENT_PATHS = ["supplier_direct", "handler_reimbursement"] as const;
export const RECEIPT_PHOTO_SOURCES = ["camera", "album"] as const;
```

新增动作：

```text
spot_procurement.create
spot_procurement.approve
spot_procurement.payment.submit
spot_procurement.payment.approve
spot_procurement.payment.execute
spot_procurement.receipt.confirm
spot_procurement.receipt.review
spot_procurement.receipt.review_revoke
spot_procurement.discrepancy.create
spot_procurement.refund.record
spot_procurement.balance.execute
spot_procurement.invoice.manage
spot_procurement.invoice_exception.confirm
spot_procurement.vat_rate.manage
spot_procurement.void
```

`PermissionGuard` 只做岗位粗筛；申请人、经办人、受托人、当前节点、项目范围和单据状态必须由领域服务精确校验。

- [ ] **Step 4：用测试驱动后端项目白名单**

`SpotProcurementPilotService` 读取：

```text
SPOT_PROCUREMENT_PILOT_PROJECT_IDS=project-id-1,project-id-2
```

规则：

- 空值表示全部项目关闭。
- 仅精确匹配非空项目 ID。
- 不支持生产环境通配符。
- 所有新建、提交、审批、实付、收货、票据和差异写操作都必须调用 `assertEnabled(projectId)`。
- 读取接口只返回已启用项目的新模块数据。

测试至少覆盖空值关闭、空格修剪、重复去重、精确匹配和 `*` 被拒绝。

- [ ] **Step 5：运行定向测试并确认 GREEN**

```bash
pnpm --filter @jiangkong/shared-domain test -- permissions.test.ts
pnpm --filter @jiangkong/api test -- spot-procurement/spot-procurement-pilot.service.spec.ts --runInBand
```

- [ ] **Step 6：更新进度并提交**

在 `PROGRESS.md` 记录 Task 1 只建立契约和默认关闭开关，未创建业务表、未开放入口。

```bash
git add packages/shared-domain services/api/.env.example services/api/.env.production.example \
  services/api/src/spot-procurement PROGRESS.md
git commit -m "feat: 建立零星采购共享契约"
```

## Task 2：创建采购、付款和供应商余额基础数据模型

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260716190000_spot_procurement_core/migration.sql`
- Create: `services/api/src/database/spot-procurement-core-schema.spec.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写静态 Schema 失败测试**

测试必须断言以下模型和关键唯一约束存在：

```text
SpotProcurement
SpotProcurementVersion
SpotProcurementLine
SpotProcurementAttachment
SpotProcurementPayment
SpotProcurementPaymentExecution
SupplierBalanceAccount
SupplierBalanceReservation
SupplierBalanceEntry
VatRateOption
```

同时断言没有给 `ProjectExpenseRequest` 新增采购明细、发票、收货照片或供应商余额字段。

- [ ] **Step 2：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- database/spot-procurement-core-schema.spec.ts --runInBand
```

- [ ] **Step 3：增加第一阶段模型**

Schema 至少包含以下字段和约束：

```prisma
model SpotProcurement {
  id                    String   @id @default(uuid())
  projectId             String
  code                  String   @unique
  supplierPartyId       String?
  supplierKey           String
  supplierNameSnapshot  String
  applicantUserId       String
  handlerUserId         String
  currentVersionId      String?
  status                String
  approvedAmountCents   BigInt   @default(0)
  actualCostCents       BigInt?
  closedAt              DateTime?
  voidedAt              DateTime?
  voidedByUserId        String?
  voidReason            String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([projectId, status])
  @@index([projectId, supplierKey])
}

model SpotProcurementVersion {
  id                   String   @id @default(uuid())
  procurementId        String
  versionNo            Int
  status               String
  reason               String
  note                 String?
  supplierPartyId      String?
  supplierKey          String
  supplierNameSnapshot String
  handlerUserId        String
  totalAmountCents     BigInt
  changeReason         String?
  changeSummary        Json?
  submittedAt          DateTime?
  approvedAt           DateTime?
  createdByUserId      String
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@unique([procurementId, versionNo])
  @@index([procurementId, status])
}

model SpotProcurementLine {
  id                      String   @id @default(uuid())
  versionId               String
  sortOrder               Int
  materialName            String
  specification           String?
  unit                    String
  quantity                Decimal  @db.Decimal(24, 6)
  invoiceMode             String
  invoiceType             String?
  vatRateOptionId         String?
  vatRateValueSnapshot    Decimal? @db.Decimal(9, 6)
  vatRateLabelSnapshot    String?
  unitPrice               Decimal  @db.Decimal(24, 6)
  amountCents             BigInt
  usageLocation           String?
  note                    String?
  createdAt               DateTime @default(now())

  @@unique([versionId, sortOrder])
  @@index([versionId])
}

model SpotProcurementAttachment {
  id              String   @id @default(uuid())
  versionId       String
  fileId          String
  category        String
  uploadedByUserId String
  createdAt       DateTime @default(now())

  @@unique([versionId, fileId])
  @@index([fileId])
}

model VatRateOption {
  id              String   @id @default(uuid())
  rateValue       Decimal  @db.Decimal(9, 6)
  label           String
  enabled         Boolean  @default(true)
  sortOrder       Int
  createdByUserId String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([rateValue, label])
  @@index([enabled, sortOrder])
}
```

付款表必须分别保存：

- `settlementAmountCents`
- `supplierBalanceAmountCents`
- `companyPaymentAmountCents`
- `paidAmountCents`
- `executedSupplierBalanceAmountCents`
- `canceledAmountCents`
- 支付路径、付款方式、收款方和账户快照
- 草稿/提交/审批/失效状态
- 唯一付款编号
- 实付记录唯一 `idempotencyKey`
- 有效实付凭证不得重复绑定

供应商余额账户必须使用：

```prisma
@@unique([projectId, supplierKey])
```

预留表必须使用：

```prisma
@@unique([paymentId])
```

余额分录只允许追加，不设计 update/delete 业务接口。

- [ ] **Step 4：手写迁移并加入数据库约束**

迁移 SQL 必须增加：

- 金额非负 CHECK。
- 三段金额等式 CHECK。
- 供应商余额账户金额非负 CHECK。
- 版本号和排序号正数 CHECK。
- 支付累计不得由数据库触发器推导，仍由锁行事务校验。
- 所有新表只新增，不修改或迁移旧项目支出数据。

- [ ] **Step 5：格式化、校验并确认 GREEN**

```bash
pnpm --filter @jiangkong/api prisma format
pnpm --filter @jiangkong/api prisma validate
pnpm --filter @jiangkong/api prisma generate
pnpm --filter @jiangkong/api test -- database/spot-procurement-core-schema.spec.ts --runInBand
```

- [ ] **Step 6：更新进度并提交**

```bash
git add services/api/prisma services/api/src/database/spot-procurement-core-schema.spec.ts PROGRESS.md
git commit -m "feat: 新增零星采购核心数据模型"
```

## Task 3：实现采购金额、供应商标识和输入校验基础

**Files:**

- Create: `services/api/src/spot-procurement/spot-procurement-money.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-money.spec.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-supplier.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-supplier.spec.ts`
- Create: `services/api/src/spot-procurement/dto/create-spot-procurement.dto.ts`
- Create: `services/api/src/spot-procurement/dto/update-spot-procurement-draft.dto.ts`
- Create: `services/api/src/invoice-ledger/invoice-ledger.module.ts`
- Create: `services/api/src/invoice-ledger/vat-rate-option.controller.ts`
- Create: `services/api/src/invoice-ledger/vat-rate-option.controller.spec.ts`
- Create: `services/api/src/invoice-ledger/vat-rate-option.service.ts`
- Create: `services/api/src/invoice-ledger/vat-rate-option.service.spec.ts`
- Create: `services/api/src/invoice-ledger/dto/create-vat-rate-option.dto.ts`
- Create: `services/api/src/invoice-ledger/dto/update-vat-rate-option.dto.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写金额 RED 测试**

至少覆盖：

```ts
expect(
  calculateSpotProcurementLine({
    quantity: "12.500000",
    unitPrice: "3.28"
  })
).toEqual({ amountCents: 4100n });
```

以及：

- 有票行缺发票类型、税率选项或含税单价时拒绝。
- 无票行填写发票类型或税率时拒绝。
- 无票行只使用无票单价。
- 数量最多 6 位小数，单价最多 6 位小数。
- 金额按 `ROUND_HALF_UP` 落为整数分。
- 合计由后端逐行重算。
- 空行、零数量、负数、超 PostgreSQL BIGINT 范围拒绝。

- [ ] **Step 2：先写供应商标识 RED 测试**

规则：

```ts
supplierKey({ supplierPartyId: "party-1", supplierName: " 甲方 " })
// => "party:party-1"

supplierKey({ supplierPartyId: null, supplierName: "  北京 某某商贸  " })
// => "name:北京 某某商贸"
```

只做 Unicode 空白修剪与连续空白折叠，不做模糊合并。使用自由名称时，同项目同规范化名称视为同一供应商余额范围；页面必须显示该规则。

- [ ] **Step 3：先写税率字典 RED 测试**

覆盖：

- 只有财务主管可新增、停用和调整税率选项。
- 查询接口只返回启用项给采购草稿使用。
- 税率使用 Decimal 规范字符串和 label，不接受自由文本或 JS number。
- 已被采购版本引用的选项不能删除；本期不提供删除路由。
- 停用只影响新草稿，已冻结版本继续显示快照。
- 仓库不内置永久税率数组，也不在迁移中偷偷 seed 具体税率。
- 所有新增和停用写审计。

- [ ] **Step 4：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-money.spec.ts \
  spot-procurement/spot-procurement-supplier.spec.ts \
  invoice-ledger/vat-rate-option.service.spec.ts \
  invoice-ledger/vat-rate-option.controller.spec.ts --runInBand
```

- [ ] **Step 5：实现受控税率字典**

只有财务主管可新增、停用和调整税率选项。已被采购版本引用的选项不能删除；停用只影响新草稿，已提交版本继续显示数值和 label 快照。

税率使用 Decimal 和规范十进制字符串 DTO，不在代码中写死具体税率。所有变更写 `invoice.vat_rate.*` 审计。

- [ ] **Step 6：实现定点计算和采购 DTO**

复用 `Prisma.Decimal`、`money-storage-range` 和现有金额字符串约束，禁止 `Number(quantity) * Number(unitPrice)`。

DTO 必须使用运行时 class-validator，拒绝未知字段，并把材料明细声明为嵌套数组。客户端可以发送展示合计，但 DTO 不把它作为必填账本字段。

- [ ] **Step 7：确认 GREEN 并运行类型检查**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-money.spec.ts \
  spot-procurement/spot-procurement-supplier.spec.ts \
  invoice-ledger/vat-rate-option.service.spec.ts \
  invoice-ledger/vat-rate-option.controller.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
```

- [ ] **Step 8：更新进度并提交**

```bash
git add services/api/src/spot-procurement services/api/src/invoice-ledger \
  services/api/src/app.module.ts PROGRESS.md
git commit -m "feat: 实现零星采购精确计价基础"
```

## Task 4：实现采购草稿、版本冻结和采购审批

**Files:**

- Create: `services/api/src/spot-procurement/spot-procurement.module.ts`
- Create: `services/api/src/spot-procurement/spot-procurement.controller.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-application.service.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-application.service.spec.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-approval-nodes.ts`
- Create: `services/api/src/spot-procurement/dto/review-spot-procurement.dto.ts`
- Modify: `services/api/src/app.module.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写采购状态机 RED 测试**

覆盖：

1. 物资员或物资主管可以创建草稿，其他岗位拒绝。
2. 一张单只接受一个冻结供应商。
3. 创建和更新都由后端重算明细与合计。
4. 附件为零到多个，现场参考照片不必填。
5. 物资主管发起时冻结节点只包含项目经理，并写一条 `node_skipped` 流程事实。
6. 物资员发起时冻结节点为物资主管、项目经理。
7. 审批人只能同意、驳回或退回，不能改明细。
8. 最终审批后版本状态变为 `approved`，根单状态变为 `approved_in_progress`。
9. 最终审批与第一张付款草稿在同一事务中创建。
10. 已真实付款时禁止创建普通新版本。
11. 已提交或批准付款未处理前禁止切换版本。
12. 只有采购正式办结前允许撤销；办结后拒绝。

- [ ] **Step 2：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-application.service.spec.ts --runInBand
```

- [ ] **Step 3：实现审批节点冻结**

```ts
export function procurementApprovalNodes(applicantRoleKeys: readonly string[]) {
  const nodes = [];
  if (!applicantRoleKeys.includes("material_director")) {
    nodes.push({ name: "物资主管审批", mode: "any", roleKeys: ["material_director"] });
  }
  nodes.push({ name: "项目经理审批", mode: "any", roleKeys: ["project_manager"] });
  return nodes;
}
```

不能仅凭客户端岗位决定跳过；必须从数据库中的申请人在该项目的有效岗位解析。

- [ ] **Step 4：实现草稿、附件快照、提交、审批和新版本**

事务中锁定根单和当前版本。新版本从上一版本复制，但必须：

- 写 `changeReason`。
- 生成逐字段 `changeSummary`。
- 使旧草稿付款失效。
- 对已提交/批准付款硬阻断。
- 对真实付款硬阻断。

收货模型在 Task 9 才创建；“原收货复核失效并要求新版本重新收货”的跨阶段接入由 Task 11 补充，Task 4 不创建临时收货字段。

- [ ] **Step 5：确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-application.service.spec.ts --runInBand
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
```

- [ ] **Step 6：更新进度并提交**

```bash
git add services/api/src/spot-procurement services/api/src/app.module.ts PROGRESS.md
git commit -m "feat: 实现零星采购申请与版本审批"
```

## Task 5：实现付款草稿、提交审批和供应商余额预留

**Files:**

- Create: `services/api/src/spot-procurement/spot-procurement-payment.controller.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-balance.service.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-balance.service.spec.ts`
- Create: `services/api/src/spot-procurement/dto/update-spot-procurement-payment-draft.dto.ts`
- Create: `services/api/src/spot-procurement/dto/review-spot-procurement-payment.dto.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement.module.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写付款提交 RED 测试**

覆盖：

- 采购最终审批后自动草稿归属采购经办人。
- 经办人可以把第一张草稿金额改小并创建后续草稿。
- 多张有效付款结算金额累计不得超过当前版本批准金额。
- 草稿不占采购金额和供应商余额。
- 提交时在 Serializable 事务中锁定采购版本、有效付款和余额账户。
- 提交时满足三段金额等式。
- 系统默认建议优先抵扣余额，但不替经办人自动提交。
- 财务主管减少或跳过建议抵扣时必须填写原因；该原因进入提交快照和审计。
- 财务直付收款方锁定为供应商。
- 经办人垫付报回收款人锁定为采购经办人，并要求商家付款证明。
- 全额余额抵扣时公司付款为 0，不要求银行账户，但供应商仍冻结。
- 并发提交时只有一个能成功占用剩余金额/余额。
- 退回、驳回、撤回、作废、版本失效释放预留。
- 付款审批节点固定为综合部主管、项目经理、财务主管、董事长/总经理 OR。

- [ ] **Step 2：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-payment.service.spec.ts \
  spot-procurement/spot-procurement-balance.service.spec.ts --runInBand
```

- [ ] **Step 3：实现付款组成与预留**

提交时执行：

```ts
if (settlement !== balance + companyPayment) {
  throw new BadRequestException("本次结算金额必须等于供应商余额抵扣金额与公司实际付款金额之和");
}
```

必须使用 bigint/Decimal 安全转换，不允许 JS 浮点。

余额账户锁行后校验：

```text
可预留余额 = availableAmountCents - reservedAmountCents
```

成功时同时：

- 增加账户 `reservedAmountCents`。
- 创建唯一 `SupplierBalanceReservation`。
- 追加 `reserve` 分录。
- 写付款状态 `approval_pending`。
- 冻结审批实例。

- [ ] **Step 4：实现审批动作和失败释放**

付款审批通过只写 `approved_pending_payment`，不执行余额抵扣、不增加已付。

所有终止路径复用单一：

```ts
releaseReservation(tx, paymentId, actorUserId, reason)
```

保证幂等，重复释放不重复扣减。

- [ ] **Step 5：确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-payment.service.spec.ts \
  spot-procurement/spot-procurement-balance.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [ ] **Step 6：更新进度并提交**

```bash
git add services/api/src/spot-procurement PROGRESS.md
git commit -m "feat: 实现零星采购付款审批与余额预留"
```

## Task 6：实现实际付款、凭证幂等和项目资金池接入

**Files:**

- Create: `services/api/src/spot-procurement/dto/record-spot-procurement-payment.dto.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts`
- Modify: `services/api/src/money/decimal-money.ts`
- Modify: `services/api/src/money/decimal-money.spec.ts`
- Modify: `services/api/src/payment/payment-request.service.ts`
- Modify: `services/api/src/payment/payment-request.service.spec.ts`
- Modify: `services/api/src/project-expense/project-expense.service.ts`
- Modify: `services/api/src/project-expense/project-expense.service.spec.ts`
- Modify: `services/api/src/project/project.service.ts`
- Modify: `services/api/src/project/project.service.spec.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先扩展资金池 RED 测试**

`calculateProjectCashPoolBigInt` 增加可选：

```ts
spotProcurementPayments?: readonly MoneyRequestValue[];
```

测试断言：

- 审批中和已批未付的零星采购公司付款部分占用现金。
- 实际付款增加项目实付。
- 供应商余额抵扣不计入项目银行实付。
- 草稿、退回、驳回、作废和已取消额度不占用。

- [ ] **Step 2：运行资金测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  money/decimal-money.spec.ts \
  payment/payment-request.service.spec.ts \
  project-expense/project-expense.service.spec.ts \
  project/project.service.spec.ts --runInBand
```

- [ ] **Step 3：扩展所有项目现金查询**

以下三处都必须查询新付款并传给共享 helper：

- 普通合同付款创建时的资金占用。
- 旧项目支出创建时的资金占用。
- 项目经营概览的已付、占用和可用现金。

不得只在零星采购自己的执行服务中校验，否则其他付款入口会高估可用现金。

- [ ] **Step 4：先写实际付款 RED 测试**

覆盖：

- 仅财务人员可登记。
- 当前密码二次确认。
- 付款状态必须为已批准待付或部分已付。
- 实付日期不能晚于服务器时间。
- 凭证必填，必须为登记人有权访问的私有文件。
- `idempotencyKey` 唯一，相同键重复请求返回原记录。
- 同一凭证不能绑定两笔有效实付。
- 累计实付不超公司付款批准金额。
- 项目现金不足时整个事务失败，不写实付、不改付款状态。
- 银行或现金都只由付款方式字段区分，无票状态不随付款方式推导。
- 成功后重新生成付款最新版 PDF 所需事实，但 PDF 失败不回滚实付。

- [ ] **Step 5：实现实付事务**

在一笔事务中：

1. 锁定付款。
2. 校验幂等键。
3. 校验凭证和剩余金额。
4. 按扩展后的项目现金池重新计算当前可用现金。
5. 创建 `SpotProcurementPaymentExecution`。
6. 更新 `paidAmountCents` 和付款状态。
7. 写审计。
8. 提交后异步/容错刷新 PDF。

- [ ] **Step 6：运行定向测试并确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  money/decimal-money.spec.ts \
  spot-procurement/spot-procurement-payment.service.spec.ts \
  payment/payment-request.service.spec.ts \
  project-expense/project-expense.service.spec.ts \
  project/project.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [ ] **Step 7：更新进度并提交**

```bash
git add services/api/src/money services/api/src/payment services/api/src/project-expense \
  services/api/src/project services/api/src/spot-procurement PROGRESS.md
git commit -m "feat: 接入零星采购实际付款资金口径"
```

## Task 7：接入审批单、待办、文件授权、归档和权限影响

**Files:**

- Modify: `services/api/src/approval/approval-form.service.ts`
- Modify: `services/api/src/approval/approval-form.service.spec.ts`
- Modify: `services/api/src/auth/guards/permission.guard.ts`
- Modify: `services/api/src/auth/guards/permission.guard.spec.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`
- Modify: `services/api/src/me/me.service.ts`
- Modify: `services/api/src/me/me.service.spec.ts`
- Modify: `services/api/src/archive/archive.service.ts`
- Modify: `services/api/src/archive/archive.service.spec.ts`
- Modify: `services/api/src/organization/permission-impact.service.ts`
- Modify: `services/api/src/organization/permission-impact.service.spec.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-access.service.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-access.service.spec.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写共享接入 RED 测试**

断言：

- `ApprovalFormService` 识别 `spot_procurement_version` 和 `spot_procurement_payment`。
- 采购申请 PDF 展示项目、采购编号、供应商、原因、明细、票据方式、发票类型、税率、含税/无票单价和审批轨迹。
- 付款 PDF 展示结算申请、余额抵扣、公司付款、实际付款和付款状态。
- 每次采购或付款审批动作成功后都刷新对应最新版 PDF；PDF 失败只记录重试状态，不回滚审批。
- `PermissionGuard` 能从 `procurementId`、`procurementPaymentId`、`receiptId` 解析项目。
- `/me/work-items` 能返回两类审批待办并生成中文详情路径。
- 岗位移除影响预览包含两类新审批实例。
- 文件服务能识别申请附件、商家付款证明、公司付款凭证和 PDF 的业务归属。

- [ ] **Step 2：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  approval/approval-form.service.spec.ts \
  auth/guards/permission.guard.spec.ts \
  file/file.service.spec.ts \
  me/me.service.spec.ts \
  archive/archive.service.spec.ts \
  organization/permission-impact.service.spec.ts \
  spot-procurement/spot-procurement-access.service.spec.ts --runInBand
```

- [ ] **Step 3：扩展共享审批单，不实现固定格子签名**

申请和付款沿用共享审批轨迹、姓名、岗位和时间渲染，并在每次审批动作提交后刷新最新版 PDF。若其他分支已合入固定格子签名，则只实现业务数据适配器：

```ts
resolveApprovalFormBusiness("spot_procurement_version", versionId)
resolveApprovalFormBusiness("spot_procurement_payment", paymentId)
```

严禁在 `spot-procurement` 目录内复制 PDF 签名布局。

- [ ] **Step 4：实现最小操作授权**

首期详情和下载只允许：

- 申请人。
- 采购经办人。
- 当前或历史审批实际参与人。
- 当前有效收货受托人。
- 执行实付/退款/余额的财务人员。
- 当前流程所需的项目级物资主管、项目经理、综合部主管、财务主管。

不得增加“所有登录用户”或未确认的全局只读岗位。后续查看/下载矩阵确认时只扩展 `SpotProcurementAccessService` 和 `FileService` 授权点。

- [ ] **Step 5：确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  approval/approval-form.service.spec.ts \
  auth/guards/permission.guard.spec.ts \
  file/file.service.spec.ts \
  me/me.service.spec.ts \
  archive/archive.service.spec.ts \
  organization/permission-impact.service.spec.ts \
  spot-procurement/spot-procurement-access.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [ ] **Step 6：更新进度并提交**

```bash
git add services/api/src/approval services/api/src/auth/guards services/api/src/file \
  services/api/src/me services/api/src/archive services/api/src/organization \
  services/api/src/spot-procurement PROGRESS.md
git commit -m "feat: 接入零星采购共享审批与归档"
```

## Task 8：完成采购和付款 Web 工作台

**Files:**

- Create: `apps/web-admin/src/api/spot-procurement.api.ts`
- Create: `apps/web-admin/src/api/spot-procurement.api.test.ts`
- Create: `apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentWorkbenchPage.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptWorkbenchPage.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/components/ProcurementLineEditor.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/components/ProcurementStatusSummary.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/components/PaymentCompositionCard.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `apps/web-admin/src/routes/route-records.ts`
- Modify: `apps/web-admin/src/routes/index.test.ts`
- Modify: `apps/web-admin/src/app/admin-layout.structure.test.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写路由和 API RED 测试**

断言左侧新增独立分组：

```text
零星采购
├─ 零星采购工作台
├─ 零星材料付款工作台
└─ 收货确认工作台
```

此 Task 创建收货工作台占位页并注册路由，页面显示“代码阶段 B 完成后开放”；后端白名单仍默认关闭。Task 16 在同一文件中替换为正式工作台。

- [ ] **Step 2：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/web-admin test -- \
  src/api/spot-procurement.api.test.ts \
  src/routes/index.test.ts \
  src/app/admin-layout.structure.test.ts \
  src/pages/spot-procurement/spot-procurement-pages.test.ts --run
```

- [ ] **Step 3：实现采购工作台和详情**

必须复用：

- `BusinessPageHeader`
- `StatusSummary`
- `TableToolbar`
- `DetailHeader`
- `ActionPanel`
- `EvidenceFileCards`
- `SensitiveActionDialog`
- TDesign Upload、Table、Form、Tag、Tabs

材料表格直接展示：

- 材料名称、规格、单位、数量。
- 有票/无票。
- 普票/专票。
- 税率。
- 含税单价或无票单价。
- 后端返回的明细金额和合计。

禁止页面使用浮点计算作为最终合计；前端预览只能调用共享十进制字符串 helper，提交后以后端结果覆盖。

- [ ] **Step 4：实现付款工作台和详情**

付款详情明确分区：

```text
结算申请金额
├─ 供应商余额抵扣
└─ 公司实际付款申请

公司实际付款
├─ 已批准待付
├─ 部分已付
└─ 已付
```

供应商余额抵扣不得显示为银行已付。实际付款操作复用敏感动作对话框和当前密码确认。

- [ ] **Step 5：运行 Web 门禁**

```bash
pnpm --filter @jiangkong/web-admin test -- \
  src/api/spot-procurement.api.test.ts \
  src/routes/index.test.ts \
  src/app/admin-layout.structure.test.ts \
  src/pages/spot-procurement/spot-procurement-pages.test.ts --run
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
```

- [ ] **Step 6：更新进度并提交**

```bash
git add apps/web-admin/src PROGRESS.md
git commit -m "feat: 新增零星采购与付款工作台"
```

## Task 9：创建收货、差异、退款和共享票据数据模型

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260716200000_spot_procurement_receipt_invoice/migration.sql`
- Create: `services/api/src/database/spot-procurement-receipt-schema.spec.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写第二阶段 Schema RED 测试**

必须断言存在：

```text
SpotProcurementReceipt
SpotProcurementReceiptLine
SpotProcurementReceiptPhoto
SpotProcurementReceiptDelegation
SpotProcurementReceiptReview
SpotProcurementDiscrepancy
SpotProcurementRefund
InvoiceRecord
InvoiceLine
InvoiceAllocation
NoInvoiceConfirmation
InvoiceExceptionConfirmation
```

- [ ] **Step 2：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  database/spot-procurement-receipt-schema.spec.ts --runInBand
```

- [ ] **Step 3：增加收货模型**

`SpotProcurementReceipt` 对 `procurementId` 使用唯一约束，确保一单一张最终收货单。

收货行必须保存：

- 冻结采购行 ID。
- 审批数量快照。
- 合格数量。
- 不合格数量、原因。
- 无偿附赠数量。
- 差异说明。
- 计算后的实际成本分值。

照片必须保存：

- `originalFileId`
- `watermarkedFileId`
- 原图 SHA-256
- 水印图 SHA-256
- `source`
- `category`
- 服务器时间
- 照片备注
- 上传人
- 是否首次提交前已锁定
- 追加原因

收货复核必须独立记录每次 `approved`、`returned`、`revoked`，不能用一组可覆盖字段丢失历史。

- [ ] **Step 4：增加票据模型**

继续复用 Task 2-3 已建立的 `VatRateOption`；本迁移不得重复创建税率表。采购行已经保存税率选项引用和提交时的数值/显示快照。

发票必须拆 `InvoiceRecord` 与 `InvoiceLine`，因为一张发票可能存在多税率明细。分摊引用具体发票行和采购行，金额非负且只能追加/失效。

- [ ] **Step 5：增加差异和退款模型**

同一已复核收货只允许一条当前有效差异处理。退款记录必须保存到账凭证，转供应商余额使用既有余额分录，不新增假付款表。

- [ ] **Step 6：校验并确认 GREEN**

```bash
pnpm --filter @jiangkong/api prisma format
pnpm --filter @jiangkong/api prisma validate
pnpm --filter @jiangkong/api prisma generate
pnpm --filter @jiangkong/api test -- \
  database/spot-procurement-receipt-schema.spec.ts --runInBand
```

- [ ] **Step 7：更新进度并提交**

```bash
git add services/api/prisma services/api/src/database/spot-procurement-receipt-schema.spec.ts PROGRESS.md
git commit -m "feat: 新增零星采购收货与票据模型"
```

## Task 10：使用 sharp 实现服务端收货水印

**Files:**

- Modify: `services/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `services/api/src/spot-procurement/receipt-watermark.service.ts`
- Create: `services/api/src/spot-procurement/receipt-watermark.service.spec.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement.module.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：安装成熟图像处理依赖**

```bash
pnpm --filter @jiangkong/api add sharp
```

不得手写 JPEG/PNG 编解码器，不引入第二套对象存储客户端。

技术依据：`sharp` 官方 API 已直接提供底部扩边 `extend()`、图层合成 `composite()`、输入元数据读取和 Buffer 输出能力，正好覆盖“保留原照片主体 + 下方生成信息卡”的实现，不需要自研图像编解码：

- https://sharp.pixelplumbing.com/api-resize/#extend
- https://sharp.pixelplumbing.com/api-composite/
- https://sharp.pixelplumbing.com/api-input/#metadata

- [ ] **Step 2：先写水印 RED 测试**

测试使用小型 PNG fixture，断言：

- 输出图宽度与原图一致。
- 输出高度大于原图。
- 水印是照片下方信息卡，不覆盖主体。
- 项目、采购编号、上传人、服务器时间、来源和备注进入 SVG 信息卡。
- `camera` 显示“系统拍照”，`album` 显示“相册上传”。
- 不接收经纬度字段。
- 原图和水印图哈希不同。
- 中文字体读取 `services/api/assets/fonts/NotoSansSC-Regular.otf`，不依赖宿主机字体。
- 非图片、损坏图片和生成失败抛出固定中文错误。

- [ ] **Step 3：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/receipt-watermark.service.spec.ts --runInBand
```

- [ ] **Step 4：实现水印服务**

服务输入固定为：

```ts
interface ReceiptWatermarkInput {
  originalBuffer: Buffer;
  mimeType: "image/jpeg" | "image/png";
  projectLabel: string;
  procurementCode: string;
  uploaderName: string;
  uploadedAt: Date;
  source: "camera" | "album";
  note?: string;
  category: "material_scene" | "delivery_note";
}
```

输出：

```ts
interface ReceiptWatermarkOutput {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png";
  originalSha256: string;
  watermarkedSha256: string;
  width: number;
  height: number;
}
```

备注必须转义后进入 SVG，禁止未转义用户文本注入 XML。

- [ ] **Step 5：确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/receipt-watermark.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [ ] **Step 6：更新进度并提交**

```bash
git add services/api/package.json pnpm-lock.yaml services/api/src/spot-procurement PROGRESS.md
git commit -m "feat: 生成零星采购收货照片水印"
```

## Task 11：实现收货委托、照片上传和最终收货提交

**Files:**

- Create: `services/api/src/spot-procurement/spot-procurement-receipt.controller.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-receipt.service.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-receipt.service.spec.ts`
- Create: `services/api/src/spot-procurement/dto/create-receipt-delegation.dto.ts`
- Create: `services/api/src/spot-procurement/dto/attach-receipt-photo.dto.ts`
- Create: `services/api/src/spot-procurement/dto/update-receipt-draft.dto.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-application.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-application.service.spec.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写委托和照片 RED 测试**

覆盖：

- 默认只有采购经办人可操作收货。
- 经办人可委托同项目启用人员，保存委托人、受托人、范围和时间。
- 受托人可上传并提交，但业务责任人仍显示经办人。
- 非同项目人员拒绝。
- 相册和系统拍照都接受，不接收定位。
- 每次附图都从私有原图生成水印图并保存双文件、双哈希。
- 送货单可选且分类独立。
- 至少一张材料/卸货照片才能提交。
- 只有送货单不能提交。
- 水印失败时不创建正式照片记录。
- 草稿阶段可删除未提交照片；首次提交后既有照片锁定，只能追加并填写原因。

- [ ] **Step 2：先写数量和实际成本 RED 测试**

覆盖：

- 合格数量不大于审批数量。
- 不合格数量必须有原因。
- 无偿附赠不增加实际成本。
- 实际成本按合格数量乘冻结单价。
- 供应商承诺补货时只能保留草稿。
- 提交后收货状态为 `submitted`，等待物资主管复核。
- 已存在复核收货且尚无真实付款时，新采购版本使旧复核失效并要求针对新版本重新确认；旧照片与历史保留。
- 已存在真实付款时继续由 Task 4 的版本变更硬阻断保护。

- [ ] **Step 3：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-receipt.service.spec.ts \
  file/file.service.spec.ts --runInBand
```

- [ ] **Step 4：实现原图绑定和水印派生**

照片接口只接受已由当前用户上传、仍为 active、mime 为 JPEG/PNG 的 `originalFileId`。服务读取原图 Buffer，调用水印服务，再用现有 `FileService.uploadPrivateFile` 保存派生图。

不得允许客户端直接上传一张自称“已加水印”的图片作为正式水印图。

- [ ] **Step 5：实现最终收货提交事务**

事务中：

1. 锁定采购和当前有效版本。
2. 校验操作者为经办人或有效受托人。
3. 校验所有采购行都有最终数量。
4. 校验至少一张材料现场照片已成功生成水印。
5. 后端重算各行和总实际成本。
6. 锁定首次提交照片。
7. 写审计并进入 `submitted`。

- [ ] **Step 6：确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-receipt.service.spec.ts \
  file/file.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [ ] **Step 7：更新进度并提交**

```bash
git add services/api/src/spot-procurement services/api/src/file PROGRESS.md
git commit -m "feat: 实现零星采购最终收货确认"
```

## Task 12：实现物资主管复核、撤销复核和收货确认单 PDF

**Files:**

- Modify: `services/api/src/spot-procurement/spot-procurement-receipt.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-receipt.service.spec.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-receipt-pdf.service.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-receipt-pdf.service.spec.ts`
- Create: `services/api/src/spot-procurement/dto/review-receipt.dto.ts`
- Create: `services/api/src/spot-procurement/dto/revoke-receipt-review.dto.ts`
- Modify: `services/api/src/archive/archive.service.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写复核 RED 测试**

覆盖：

- 只有项目物资主管可以复核。
- 可通过或退回，退回原因必填。
- 物资主管不能直接修改数量或照片。
- 退回后经办人/受托人可修改数量、说明并追加照片，已锁定照片不可变。
- 复核通过后保存独立复核事实并触发收货 PDF。
- 办结前可撤销复核，原因和明确二次确认必填，但不要求密码。
- 撤销后旧 PDF 不删除，只标记非最新版并生成新的状态事实。
- 办结后拒绝撤销、修改或追加。

- [ ] **Step 2：先写 PDF RED 测试**

PDF 至少包含：

- 项目、采购编号、供应商、经办人和委托关系。
- 每行审批数量、合格、不合格、附赠、差异和实际成本。
- 采购审批金额、实际采购成本、差异金额。
- 物资主管复核结论、姓名和时间。
- 所有正式水印现场照片。
- 已上传乙方送货单附页。

- [ ] **Step 3：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-receipt.service.spec.ts \
  spot-procurement/spot-procurement-receipt-pdf.service.spec.ts --runInBand
```

- [ ] **Step 4：实现最新版 PDF 策略**

使用 `PdfDocument`：

```text
businessType = spot_procurement_receipt
businessId   = receiptId
templateKey  = spot_procurement_receipt_v1
```

每次复核、撤销复核、重新复核或补充证据后生成新文件；详情只下载最新版，历史文件继续保留审计和归档引用。

- [ ] **Step 5：确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-receipt.service.spec.ts \
  spot-procurement/spot-procurement-receipt-pdf.service.spec.ts \
  archive/archive.service.spec.ts file/file.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [ ] **Step 6：更新进度并提交**

```bash
git add services/api/src/spot-procurement services/api/src/archive \
  services/api/src/file PROGRESS.md
git commit -m "feat: 实现零星采购收货复核与PDF"
```

## Task 13：实现少货差异、退款、余额转入和余额执行

**Files:**

- Create: `services/api/src/spot-procurement/spot-procurement-settlement.service.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-settlement.service.spec.ts`
- Create: `services/api/src/spot-procurement/dto/create-procurement-discrepancy.dto.ts`
- Create: `services/api/src/spot-procurement/dto/record-procurement-refund.dto.ts`
- Create: `services/api/src/spot-procurement/dto/execute-supplier-balance.dto.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-balance.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-balance.service.spec.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写差异结算 RED 测试**

覆盖：

- 只有复核有效的收货才能创建差异。
- 差异金额由系统按冻结单价计算，DTO 不接受手填金额。
- 少付只保留实际成本剩余可申请额。
- 已批但不再需要的未付额度自动标记取消，不改原批准金额。
- 真实多付只能选择 `full_refund` 或 `full_supplier_balance`。
- 多付处理不得拆分。
- 经办人发起，物资主管只确认收货差异事实，不再走项目经理审批。

- [ ] **Step 2：先写退款和余额 RED 测试**

退款：

- 只有财务人员登记。
- 实际到账日期、金额、凭证必填。
- 金额必须等于待退款整笔差额。
- 未到账承诺不能减少净支出。
- 幂等键和凭证重复绑定受控。

余额转入/执行：

- 只有财务主管。
- 当前密码必填并先验密。
- 同项目、同供应商账户。
- 转入和执行均形成不可变分录。
- 执行时把预留改为已使用，不生成银行凭证、不增加 `paidAmountCents`。
- 密码失败、余额不足、并发冲突均零写入。

- [ ] **Step 3：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-settlement.service.spec.ts \
  spot-procurement/spot-procurement-balance.service.spec.ts --runInBand
```

- [ ] **Step 4：实现统一资金结算快照**

服务返回并审计：

```text
公司实际付款累计
+ 已执行供应商余额抵扣
- 已确认到账退款
- 本单转出供应商余额
= 采购资金结算额
```

所有值由后端查询并计算，前端不提交汇总。

- [ ] **Step 5：确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-settlement.service.spec.ts \
  spot-procurement/spot-procurement-balance.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [ ] **Step 6：更新进度并提交**

```bash
git add services/api/src/spot-procurement PROGRESS.md
git commit -m "feat: 实现零星采购差异与供应商余额"
```

## Task 14：接入税率字典并实现发票分摊、无票和票据异常

**Files:**

- Create: `services/api/src/invoice-ledger/invoice-ledger.controller.ts`
- Create: `services/api/src/invoice-ledger/invoice-ledger.service.ts`
- Create: `services/api/src/invoice-ledger/invoice-ledger.service.spec.ts`
- Modify: `services/api/src/invoice-ledger/invoice-ledger.module.ts`
- Create: `services/api/src/invoice-ledger/dto/create-procurement-invoice.dto.ts`
- Create: `services/api/src/invoice-ledger/dto/create-no-invoice-confirmation.dto.ts`
- Create: `services/api/src/invoice-ledger/dto/create-invoice-exception-confirmation.dto.ts`
- Create: `services/api/src/invoice-ledger/dto/review-no-invoice-confirmation.dto.ts`
- Create: `services/api/src/invoice-ledger/dto/review-invoice-exception-confirmation.dto.ts`
- Create: `services/api/src/invoice-ledger/dto/reverse-invoice-allocation.dto.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/archive/archive.service.ts`
- Modify: `PROGRESS.md`

- [x] **Step 1：先写发票分摊 RED 测试**

覆盖：

- 发票类型只有增值税普通/专用。
- 一张发票可有多条不同税率的发票行。
- 发票分摊指向采购行和可选付款单。
- 付款关联不重复增加采购总覆盖。
- 发票行累计分摊不超发票行金额。
- 采购行累计正常发票覆盖不超该行实际成本。
- 发票类型、税率与冻结采购行不一致时进入异常，不计正常覆盖。
- 退款、转余额、取消额度不能分摊。
- 所有票据写入必须基于当前已复核收货，且采购已存在公司实付或已执行供应商余额抵扣。
- 关联付款单时，该付款单自身必须已有有效资金执行；付款归属不重复增加采购覆盖。
- 已发生任一有效资金执行只是票据登记启动条件；未关联付款单的票据可在当前收货实际成本内覆盖尚未支付完的金额，不得错误受当前已执行总额限制。
- 待复核无票和票据异常先占用采购行、付款单、发票行和采购根单额度，防止并发穿透。
- 采购详情返回当前坐标下可操作的发票、分摊、无票和异常标识及完整复核/冲销历史；付款详情只返回精确归属于本付款的事实，跨采购、版本或收货修订错绑时失败关闭。
- 发票身份键由服务端按稳定优先级生成：完整代码+号码优先，否则使用可识别票据编号；客户端不得提交身份键。
- 身份字段完成 NFKC、空白和大小写归一后按 Unicode 码点校验，拒绝控制字符和不可见格式字符，并使用无歧义版本化结构计算 SHA-256。
- 发票登记仅允许当前经办人、有效物资主管、当前项目财务人员或有效财务主管；普通物资员不得代办，普通财务人员不得跨项目。所有写入在事务内复核账号启用状态。

- [x] **Step 2：先写无票和票据异常 RED 测试**

覆盖：

- 原冻结无票行可申请无票确认。
- 无票原因和替代证明必填。
- 财务主管确认后才计入覆盖。
- 原冻结有票且未实付时必须新版本，不能直接无票。
- 原冻结有票且已实付时只能走票据异常确认。
- 票据异常由经办人申请、财务主管确认。
- 发票覆盖与无票覆盖不能重叠。
- 采购办结后禁止更正。
- 有效或待复核票据事实存在时，必须先解除、退回或冲销，才能撤销收货复核。

- [x] **Step 3：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  invoice-ledger/invoice-ledger.service.spec.ts \
  invoice-ledger/vat-rate-option.service.spec.ts --runInBand
```

- [x] **Step 4：实现共享票据账本**

本模块命名为 `invoice-ledger`，但本 Task 只允许零星采购接入。不要顺带接入合同、结算、普通付款或费用报销。

所有生效、失效、确认和退回使用追加事实或状态日志；不得直接覆盖已生效历史分摊。

- [x] **Step 5：确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  invoice-ledger/invoice-ledger.service.spec.ts \
  invoice-ledger/vat-rate-option.service.spec.ts \
  file/file.service.spec.ts archive/archive.service.spec.ts --runInBand
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [x] **Step 6：更新进度并提交**

```bash
git add services/api/src/invoice-ledger services/api/src/file \
  services/api/src/archive PROGRESS.md
git commit -m "feat: 建立零星采购票据覆盖账本"
```

## Task 15：实现统一自动办结评估器

**Files:**

- Create: `services/api/src/spot-procurement/spot-procurement-closure.service.ts`
- Create: `services/api/src/spot-procurement/spot-procurement-closure.service.spec.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-receipt.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-settlement.service.ts`
- Modify: `services/api/src/spot-procurement/spot-procurement-balance.service.ts`
- Modify: `services/api/src/invoice-ledger/invoice-ledger.service.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写逐条件 RED 测试**

为每个缺失条件单独写一例不能办结：

- 采购版本未批准。
- 收货未提交。
- 物资主管复核无效。
- 待补货/不合格未处理。
- 资金等式不成立。
- 发票+无票不等于实际成本。
- 存在待审批付款。
- 存在待执行公司付款。
- 存在未释放余额预留。
- 存在待到账退款。
- 存在待转入余额。
- 存在待执行余额抵扣。
- 存在重复票据覆盖。
- 存在票据异常待处理。
- 存在版本变更待处理。

最后一例断言最后条件满足后同事务立即写：

```text
SpotProcurement.status = closed
closedAt = server time
SpotProcurementReceipt.status = locked
```

- [ ] **Step 2：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-closure.service.spec.ts --runInBand
```

- [ ] **Step 3：实现纯评估快照和事务入口**

```ts
interface SpotProcurementClosureSnapshot {
  approved: boolean;
  receiptReviewed: boolean;
  receiptIssuesResolved: boolean;
  actualCostCents: bigint;
  fundsSettledCents: bigint;
  invoiceCoveredCents: bigint;
  noInvoiceCoveredCents: bigint;
  pendingPaymentCount: number;
  pendingBalanceReservationCount: number;
  pendingRefundCount: number;
  pendingInvoiceIssueCount: number;
  pendingVersionChangeCount: number;
}
```

`evaluate(snapshot)` 保持纯函数；`recalculateAndClose(tx, procurementId, trigger)` 负责锁行、加载快照和写办结。

- [ ] **Step 4：从所有最后事实入口调用**

必须在以下成功事务尾部调用：

- 实际付款。
- 余额抵扣执行。
- 收货复核/撤销。
- 差异处理。
- 退款到账。
- 余额转入。
- 发票分摊生效/失效。
- 无票确认。
- 票据异常确认。

不得由前端调用“设置办结”接口。

- [ ] **Step 5：确认 GREEN**

```bash
pnpm --filter @jiangkong/api test -- \
  spot-procurement/spot-procurement-closure.service.spec.ts \
  spot-procurement/spot-procurement-payment.service.spec.ts \
  spot-procurement/spot-procurement-receipt.service.spec.ts \
  spot-procurement/spot-procurement-settlement.service.spec.ts \
  invoice-ledger/invoice-ledger.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

- [ ] **Step 6：更新进度并提交**

```bash
git add services/api/src/spot-procurement services/api/src/invoice-ledger PROGRESS.md
git commit -m "feat: 实现零星采购自动办结"
```

## Task 16：完成收货、差异和票据 Web 闭环

**Files:**

- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptWorkbenchPage.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/components/ReceiptLineEditor.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/components/ReceiptPhotoUploader.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/components/ProcurementSettlementSummary.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/components/InvoiceCoveragePanel.vue`
- Create: `apps/web-admin/src/pages/spot-procurement/components/SupplierBalancePanel.vue`
- Modify: `apps/web-admin/src/api/spot-procurement.api.ts`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue`
- Modify: `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：先写 Web RED 测试**

覆盖：

- 相机和相册来源都能提交，页面不请求位置权限。
- 至少一张材料现场照片；送货单可选且不计入必填。
- 水印图优先展示，原图只在授权证据入口中访问。
- 委托人、受托人、实际操作人显示清晰。
- 已提交照片禁用删除/替换，补充照片要求原因。
- 物资主管复核、退回和办结前撤销复核。
- 审批金额、实际成本、差异、退款、余额和取消额度分开显示。
- 发票、无票和票据异常有独立状态。
- 办结后所有写按钮消失并显示不可更正说明。

- [ ] **Step 2：运行测试并确认 RED**

```bash
pnpm --filter @jiangkong/web-admin test -- \
  src/pages/spot-procurement/spot-procurement-pages.test.ts --run
```

- [ ] **Step 3：实现收货工作台**

状态列至少区分：

```text
待收货
收货草稿
待物资主管复核
已退回
复核已通过
复核已撤销
已办结
```

照片上传使用 TDesign Upload 选择文件，但正式水印生成和绑定由业务 API 完成。

- [ ] **Step 4：实现差异、余额和票据区域**

不得把所有金额合并为“已支付”。至少显示：

```text
采购审批金额
实际采购成本
公司实际付款
已执行余额抵扣
已到账退款
已转出供应商余额
未执行取消额度
发票覆盖
已确认无票
```

- [ ] **Step 5：运行 Web 门禁**

```bash
pnpm --filter @jiangkong/web-admin test -- \
  src/api/spot-procurement.api.test.ts \
  src/pages/spot-procurement/spot-procurement-pages.test.ts \
  src/routes/index.test.ts \
  src/app/admin-layout.structure.test.ts --run
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
```

- [ ] **Step 6：更新进度并提交**

```bash
git add apps/web-admin/src PROGRESS.md
git commit -m "feat: 完成零星采购收货票据闭环"
```

## Task 17：补齐端到端测试、旧入口隔离和全仓门禁

**Files:**

- Create: `services/api/src/spot-procurement/spot-procurement.e2e-spec.ts`
- Create: `apps/web-admin/e2e/spot-procurement.spec.ts`
- Modify: `services/api/src/project-expense/project-expense.service.spec.ts`
- Modify: `apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue`
- Modify: `apps/web-admin/src/pages/projects/project-expense.config.test.ts`
- Modify: `apps/web-admin/src/pages/projects/project-operating-overview.structure.test.ts`
- Modify: `apps/web-admin/src/routes/index.test.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1：锁定旧入口兼容**

测试断言：

- 旧 `ProjectExpenseRequest` 历史列表、详情、附件、PDF、实付和审计仍可读。
- 新零星采购不会写入旧表。
- 旧入口不展示新模型才有的收货批次、发票覆盖或供应商余额假数据。
- 新模块试运行项目启用后，旧页面的“新建零星采购”入口隐藏或引导到新工作台。
- 未启用项目仍保持旧入口当前行为，直到后续切换授权。

- [ ] **Step 2：编写 API 长链路 E2E**

至少自动覆盖：

1. 物资员申请 → 物资主管 → 项目经理 → 自动付款草稿。
2. 物资主管申请 → 跳过本级 → 项目经理。
3. 直付供应商 → 审批 → 多笔实付 → 凭证。
4. 经办人垫付报回。
5. 先收货后付款。
6. 先付款后收货并委托相册上传。
7. 少货未付满并取消额度。
8. 少货多付全额退款。
9. 少货多付转余额并在后单抵扣。
10. 全部无票、部分发票、票据异常。
11. 最后一项满足后自动办结。

- [ ] **Step 3：编写 Playwright 关键场景**

至少覆盖：

- 新建带多行材料的申请并验证动态有票/无票字段。
- 上传多附件。
- 付款三段金额。
- 收货照片来源、水印预览和送货单可选。
- 物资主管复核与撤销复核。
- 办结后只读锁定。

- [ ] **Step 4：运行全量门禁**

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api prisma validate
pnpm --filter @jiangkong/api prisma generate
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api test -- --runInBand
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin test -- --run
pnpm --filter @jiangkong/web-admin build
pnpm --filter @jiangkong/web-admin exec playwright test e2e/spot-procurement.spec.ts
git diff --check
```

- [ ] **Step 5：人工审查敏感边界**

逐项确认：

- 金额没有 Number/浮点账本计算。
- 所有写操作经过白名单、项目范围、岗位和本人关系校验。
- 文件均为私有，下载经后端授权和审计。
- 密码不进入日志、审计、错误或数据库业务字段。
- 水印备注已 XML 转义。
- 供应商余额没有跨项目/跨供应商查询。
- 自动办结只有后端入口。
- 旧历史数据未迁移、未删除、未伪造。

- [ ] **Step 6：更新进度并提交**

```bash
git add services/api apps/web-admin packages/shared-domain PROGRESS.md
git commit -m "test: 验证零星采购完整闭环"
```

## Task 18：小项目试运行、迁移和生产发布闸门

**Files:**

- Create: `docs/superpowers/runbooks/2026-07-16-spot-procurement-pilot.md`
- Create: `docs/progress/2026-07-16-spot-procurement-pilot-release.md`
- Modify: `PROGRESS.md`

本 Task 分为“候选验收”和“生产发布”两个授权点。没有用户明确授权，不执行生产部分。

- [ ] **Step 1：选择一个小项目并确认最小人员**

必须由用户确认：

- 试点项目 ID。
- 物资员、物资主管、项目经理。
- 综合部主管、财务人员、财务主管。
- 董事长/总经理至少一人。
- 一名可作为收货受托人的同项目人员。
- 更广泛查看与下载矩阵是否继续保持最小授权。

- [ ] **Step 2：用十五个受控场景完成 UAT**

逐项执行设计文档第 15.3 节的 15 个场景。零星采购部分至少完成前 13 个；借款/报销两个场景留到费用与报销计划。

每个场景记录：

- 单号和项目。
- 使用角色。
- 审批节点和跳过事实。
- 申请、付款、收货 PDF。
- 实际付款凭证。
- 水印照片和送货单情况。
- 实际成本、差异、退款/余额。
- 发票/无票。
- 自动办结结果。
- 审计与文件下载记录。

- [ ] **Step 3：生产发布前只读审计**

确认：

- 目标 SHA。
- 两条迁移在临时恢复库成功应用。
- 迁移只新增表/索引/约束，不修改旧项目支出表。
- `SPOT_PROCUREMENT_PILOT_PROJECT_IDS` 只包含用户确认项目。
- COS 私有文件链路、中文文件名、PDF 和水印图片可读。
- 回滚方案为应用回滚 + 保留新增表数据，不做破坏性 down migration。

- [ ] **Step 4：等待用户明确生产授权**

授权必须分别覆盖：

- 推送候选分支/合并 `main`。
- 生产备份。
- 应用两条迁移。
- 写入试点项目白名单。
- 部署。
- 允许受控真实业务写入。

- [ ] **Step 5：获授权后执行备份、迁移、部署和健康检查**

严格使用当前生产 runbook 和部署脚本，记录：

- 备份路径、大小、SHA-256、权限和 `pg_restore --list`。
- GitHub Actions run。
- 生产 HEAD。
- Prisma migration 状态。
- API、Nginx、PostgreSQL、HTTPS 和 `/api/health`。
- 试点项目 capability 返回 enabled，其他项目返回 disabled。

- [ ] **Step 6：完成一条真实最小链路**

仅在再次确认真实写入后，执行：

```text
采购草稿
→ 采购审批
→ 自动付款草稿
→ 付款审批
→ 实际付款凭证
→ 最终收货与水印
→ 物资主管复核
→ 发票或无票
→ 自动办结
```

- [ ] **Step 7：更新发布记录和进度并提交**

```bash
git add docs/superpowers/runbooks/2026-07-16-spot-procurement-pilot.md \
  docs/progress/2026-07-16-spot-procurement-pilot-release.md PROGRESS.md
git commit -m "docs: 记录零星采购试运行发布"
```

## 4. 计划完成定义

只有同时满足以下条件，零星采购实施才算完成：

- Task 1-17 全部提交并通过全量门禁。
- 采购、付款、收货、差异、余额、票据、PDF 和审计均使用独立新模型。
- 旧 `ProjectExpenseRequest` 历史可读且未被推断迁移。
- 项目资金池同时纳入新零星采购占用和实际付款。
- 十三个零星采购真实或等价场景通过。
- 试点项目之外的写入口保持关闭。
- 用户确认查看/下载范围或明确继续采用最小授权。
- 用户明确授权后完成生产备份、迁移、部署和最小真实链路。
- `PROGRESS.md` 和发布记录与实际 SHA、迁移、测试和生产事实一致。

## 5. 明确留给后续的事项

以下内容不应在执行本计划时顺带实现：

- 费用与报销、借款、员工项目往来台账。
- 完整供应商主数据、准入、评级、黑名单。
- 询比价、采购订单、仓库、入库、库存和领料。
- OCR、发票验真、税务抵扣。
- 全公司查看/下载矩阵。
- 审批单固定格子签名的独立渲染系统。
- 旧项目支出数据自动迁移或删除。
- 办结后的异常更正、退货和反向采购流水。
