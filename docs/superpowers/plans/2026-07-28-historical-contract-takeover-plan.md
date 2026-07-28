# 历史合同双部门接管实施计划

> **执行要求：** 按任务顺序实施；历史金额、凭证和激活任务先锁定失败用例，完成前运行计划列出的全部验证命令。

**目标：** 把现有单人一次确认的历史接管改为合同部与财务部独立录入、独立修订、独立主管确认；双确认后生成生效合同版本、唯一历史期初结算和逐笔历史实付。

**核心架构：** 保留 `ContractTakeover` 作为接管主记录；新增合同侧事实、财务侧事实、逐笔历史实付和凭证表。合同侧和财务侧各自 CAS。新的激活服务只在两侧“当前修订已确认”时执行一次串行化事务。

**依赖：** 现有 `ContractTakeoverService`、`ContractVersionActivationService`、`PaymentRequestService`、`settlement-payment-capacity.ts`、FileService 和 AuditService。

---

## Task 1：增加双侧事实和逐笔历史实付结构

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260728120000_contract_takeover_department_confirmation/migration.sql`
- Create: `services/api/src/database/contract-takeover-department-schema.spec.ts`

### Step 1：先写 schema RED

建议模型：

```prisma
model ContractTakeoverContractFacts {
  takeoverId                 String    @id
  revision                   Int       @default(1)
  historicalSettledCents     BigInt    @default(0)
  settlementEvidenceSummary String?
  confirmedRevision          Int?
  confirmedByUserId          String?
  confirmedAt                DateTime?
  updatedByUserId            String
  updatedAt                  DateTime  @updatedAt
}

model ContractTakeoverFinanceFacts {
  takeoverId            String    @id
  revision              Int       @default(1)
  zeroPaymentDeclared   Boolean   @default(false)
  excessTreatment       String?
  excessReason          String?
  confirmedRevision     Int?
  confirmedByUserId     String?
  confirmedAt           DateTime?
  updatedByUserId       String
  updatedAt             DateTime  @updatedAt
}

model ContractTakeoverHistoricalPayment {
  id                           String    @id @default(uuid())
  takeoverId                   String
  rowKey                       String
  sequenceNo                   Int
  amountCents                  BigInt
  paidAt                       DateTime
  payerName                    String?
  payeeName                    String?
  bankReference                String?
  paymentMethod                String?
  note                         String?
  settlementAllocatedCents     BigInt    @default(0)
  advanceAllocatedCents        BigInt    @default(0)
  abnormalOverpayCents         BigInt    @default(0)
  materializedPaymentRequestId String?
  materializedExecutionId      String?
  createdAt                    DateTime  @default(now())
  updatedAt                    DateTime  @updatedAt

  @@unique([takeoverId, rowKey])
  @@unique([takeoverId, sequenceNo])
  @@index([materializedExecutionId])
}

model ContractTakeoverHistoricalPaymentVoucher {
  id                  String   @id @default(uuid())
  historicalPaymentId String
  fileId              String   @unique
  displayOrder        Int
  uploadedByUserId    String
  createdAt           DateTime @default(now())

  @@unique([historicalPaymentId, displayOrder])
}

model ContractTakeoverConfirmationEvent {
  id               String   @id @default(uuid())
  takeoverId       String
  side             String
  action           String
  revision         Int
  reason           String?
  actorUserId      String
  createdAt        DateTime @default(now())

  @@index([takeoverId, side, createdAt])
}
```

同时给 `ContractTakeover` 增加：

```prisma
activatedAt                  DateTime?
activatedByUserId            String?
historicalInitialSettlementId String? @unique
```

数据库约束至少保证：

- `side IN ('contract', 'finance')`。
- `action IN ('confirm', 'withdraw')`。
- `revision > 0`、`confirmedRevision > 0`。
- 历史实付金额必须大于 0。
- 三种分配金额均非负且合计等于 `amountCents`。
- `excessTreatment` 只能是 `historical_advance` 或 `abnormal_overpay`，无超额时为空。
- 同一 fileId 只能属于一笔历史实付。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-takeover-department-schema.spec.ts
```

### Step 3：实现增量迁移

迁移不自动把现有 `confirmedByUserId` 猜成合同侧或财务侧确认。既有接管记录进入后续迁移预检，由切换计划处理。

保留父表已有累计字段，激活时将新事实汇总写回这些兼容字段，避免付款容量和只读台账在同一版本中断。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-takeover-department-schema.spec.ts
pnpm --filter @jiangkong/api exec prisma validate
pnpm --filter @jiangkong/api exec prisma generate
```

### Step 5：提交

```bash
git add services/api/prisma services/api/src/database/contract-takeover-department-schema.spec.ts
git commit -m "feat: add historical takeover department facts"
```

---

## Task 2：拆分权限动作

**Files:**

- Modify: `packages/shared-domain/src/permissions.ts`
- Modify: `packages/shared-domain/src/permissions.test.ts`
- Modify: `apps/web-admin/src/pages/business-readonly-access.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`

### Step 1：先写权限 RED

新增领域动作：

```ts
"contract.takeover.contract_facts.edit"
"contract.takeover.contract_facts.confirm"
"contract.takeover.finance_facts.edit"
"contract.takeover.finance_facts.confirm"
"contract.takeover.confirmation.withdraw"
```

岗位：

- 合同侧编辑：`contract_staff`、`contract_director`
- 合同侧确认：`contract_director`
- 财务侧编辑：`finance_staff`、`finance_director`
- 财务侧确认：`finance_director`
- 撤回：只能撤回自己负责侧，且仍需对应主管岗位

`super_admin` 不能代替业务主管确认。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/shared-domain test -- permissions.test.ts
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.controller.spec.ts
```

### Step 3：实现并运行 GREEN

```bash
pnpm --filter @jiangkong/shared-domain test -- permissions.test.ts
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.controller.spec.ts
```

### Step 4：提交

```bash
git add packages/shared-domain/src/permissions.ts packages/shared-domain/src/permissions.test.ts apps/web-admin/src/pages/business-readonly-access.ts services/api/src/contract-takeover/contract-takeover.controller.spec.ts
git commit -m "feat: split historical takeover permissions"
```

---

## Task 3：实现合同侧独立保存

**Files:**

- Create: `services/api/src/contract-takeover/dto/save-contract-takeover-contract-facts.dto.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`

### Step 1：先写合同侧 CAS RED

路由：

```http
PUT /contract-takeovers/:takeoverId/contract-side
```

请求只允许合同侧事实：

```ts
{
  expectedRevision: number;
  signedAt: string;
  lifecycleStatus: "performing" | "ended";
  historicalSettledCents: string;
  settlementEvidenceSummary: string;
  settlementEvidenceFileIds: string[];
  paymentTerms: HistoricalPaymentTermsInput;
  contractFacts: HistoricalContractFactsInput;
}
```

测试：

- 合同员可保存，合同侧 revision `3 -> 4`。
- 财务侧 revision 和确认不变化。
- 合同侧已经确认后再修改，只清空合同侧 `confirmedRevision/by/at`，并写失效审计。
- 旧 revision 返回冲突，零业务写。
- 合同侧请求不能写历史实付或财务超额分类。
- `historicalSettledCents` 可为 0，但必须有“无历史结算”的说明或证据。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.service.spec.ts src/contract-takeover/contract-takeover.controller.spec.ts
```

### Step 3：实现固定锁序和审计

锁定 `ContractTakeover -> ContractTakeoverContractFacts -> FileObject`，保存证据关联和事实后只增加合同侧 revision。

审计：

```text
contract.takeover.contract_facts.save
contract.takeover.contract_confirmation.invalidate
```

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.service.spec.ts src/contract-takeover/contract-takeover.controller.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-takeover
git commit -m "feat: save historical takeover contract facts"
```

---

## Task 4：实现财务侧逐笔实付和凭证保存

**Files:**

- Create: `services/api/src/contract-takeover/dto/save-contract-takeover-finance-facts.dto.ts`
- Modify: `services/api/src/contract-takeover/dto/attach-contract-takeover-evidence.dto.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`

### Step 1：先写财务侧 RED

路由：

```http
PUT /contract-takeovers/:takeoverId/finance-side
```

请求：

```ts
{
  expectedRevision: number;
  zeroPaymentDeclared: boolean;
  excessTreatment?: "historical_advance" | "abnormal_overpay";
  excessReason?: string;
  payments: Array<{
    rowKey: string;
    amountCents: string;
    paidAt: string;
    payerName?: string;
    payeeName?: string;
    bankReference?: string;
    paymentMethod?: string;
    note?: string;
    voucherFileIds: string[];
  }>;
}
```

测试：

- 非零历史实付时 `zeroPaymentDeclared` 必须 false。
- 零笔实付时必须显式 `zeroPaymentDeclared=true`。
- 每笔非零实付至少一份 active 私有凭证。
- 同一凭证不能出现在两笔实付或其他业务绑定中。
- 实付合计小于等于累计结算时，超额分类必须为空。
- 实付合计大于累计结算时，必须选择 `historical_advance` 或 `abnormal_overpay` 并提供原因/证据。
- 合同侧 revision 和确认不变化。
- 已确认财务侧被修改时，只使财务侧确认失效。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.service.spec.ts src/file/file.service.spec.ts
```

### Step 3：实现逐笔替换和分配预览

保存阶段按 `paidAt, sequenceNo` 排序，计算但不生成正式付款：

```text
先分配到历史累计结算
-> 超出部分按财务侧选择分配到历史预付款或异常超付
```

每笔：

```ts
settlementAllocatedCents +
advanceAllocatedCents +
abnormalOverpayCents === amountCents
```

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.service.spec.ts src/contract-takeover/contract-takeover.controller.spec.ts src/file/file.service.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-takeover services/api/src/file
git commit -m "feat: record historical takeover payments by item"
```

---

## Task 5：实现两侧确认和激活前撤回

**Files:**

- Create: `services/api/src/contract-takeover/dto/confirm-contract-takeover-side.dto.ts`
- Create: `services/api/src/contract-takeover/dto/withdraw-contract-takeover-side-confirmation.dto.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`

### Step 1：先写确认 RED

路由：

```http
POST /contract-takeovers/:takeoverId/contract-side/confirmation
POST /contract-takeovers/:takeoverId/finance-side/confirmation
POST /contract-takeovers/:takeoverId/contract-side/confirmation/withdrawal
POST /contract-takeovers/:takeoverId/finance-side/confirmation/withdrawal
```

确认请求带 `expectedRevision` 和二次确认密码。

测试：

- 合同部主管只能确认合同侧当前 revision。
- 财务主管只能确认财务侧当前 revision。
- 第一侧确认后状态为 `awaiting_other_side`，合同版本仍不能 effective。
- 撤回必须在 `activatedAt IS NULL`，必须填写原因。
- 撤回只清当前侧确认并追加事件，不删除旧确认事件。
- 双侧已确认但并发一侧撤回时，激活和撤回只有一个成功。
- 激活后任何撤回返回“已激活，请发起更正”。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.service.spec.ts src/contract-takeover/contract-takeover.controller.spec.ts
```

### Step 3：实现确认事件

每次确认/撤回都写 `ContractTakeoverConfirmationEvent` 和 AuditLog。当前状态来自 facts 表，不从最后一条 AuditLog 反推。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.service.spec.ts src/contract-takeover/contract-takeover.controller.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-takeover
git commit -m "feat: confirm historical takeover by department"
```

---

## Task 6：双确认后原子激活和物化历史付款

**Files:**

- Create: `services/api/src/contract-takeover/contract-takeover-activation.service.ts`
- Create: `services/api/src/contract-takeover/contract-takeover-activation.service.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.module.ts`
- Modify: `services/api/src/payment/settlement-payment-capacity.ts`
- Modify: `services/api/src/payment/settlement-payment-capacity.spec.ts`
- Modify: `services/api/src/payment/payment-read.service.ts`
- Modify: `services/api/src/payment/payment-read.service.spec.ts`

### Step 1：先写激活事务 RED

激活必须一次性完成：

1. 锁定 takeover、两侧 facts、历史实付、凭证、Contract、ContractVersion、PaymentTermsVersion。
2. 验证两侧 `confirmedRevision === revision`。
3. 合同版本进入 effective；台账履约状态根据合同侧事实显示“履约中”或“已结束”。
4. 始终创建唯一 `sourceType=historical_takeover` 的历史期初结算，即使累计结算为 0。
5. 每笔历史实付创建一条 `PaymentRequest` 和一条 `PaymentExecution`。
6. 第一份凭证写 `PaymentExecution.voucherFileId`，全部凭证继续通过历史凭证表关联同一 execution。
7. 创建 `PaymentExecutionAllocation`，区分：
   - `historical_settlement`
   - `historical_advance`
   - `historical_abnormal_overpay`
8. 父 takeover 兼容累计字段写回权威汇总。
9. 写入 `historicalInitialSettlementId` 和 `activatedAt`，重复调用幂等，不重复创建任何结算或付款。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover-activation.service.spec.ts src/payment/settlement-payment-capacity.spec.ts
```

### Step 3：实现标准付款物化

每笔历史实付：

```ts
PaymentRequest {
  sourceType: "historical_takeover",
  status: "paid",
  requestedAmountCents: payment.amountCents,
  approvedAmountCents: payment.amountCents,
  paidAmountCents: payment.amountCents
}

PaymentExecution {
  amountCents: payment.amountCents,
  paidAt: payment.paidAt,
  executedByUserId: financeFacts.confirmedByUserId,
  voucherFileId: primaryVoucher.fileId
}
```

历史期初结算：

```ts
paidAmountCents = min(historicalSettledCents, historicalPaidCents)
payableAmountCents = historicalSettledCents
```

未付差额：

```text
max(historicalSettledCents - historicalPaidCents, 0)
```

只作为容量事实，不创建 pending/approved payment request。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-takeover/contract-takeover-activation.service.spec.ts \
  src/contract-takeover/contract-takeover.service.spec.ts \
  src/payment/settlement-payment-capacity.spec.ts \
  src/payment/payment-read.service.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-takeover services/api/src/payment
git commit -m "feat: activate historical takeover with payment facts"
```

---

## Task 7：处理历史预付款和异常超付

**Files:**

- Modify: `services/api/src/payment/settlement-payment-capacity.ts`
- Modify: `services/api/src/payment/settlement-payment-capacity.spec.ts`
- Modify: `services/api/src/payment/payment-request.service.ts`
- Modify: `services/api/src/payment/payment-request.service.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`

### Step 1：先写容量和阻断 RED

历史预付款：

- 后续新结算生效时先抵扣可用历史预付款。
- 同一分金额只能抵扣一次。
- `historicalAdvanceDeductedCents <= historicalAdvancePaidCents`。

异常超付：

- `abnormalOverpayCents > 0` 时，任何新付款申请由后端拒绝。
- 已存在但未执行的新付款也不能借旧页面执行。
- 更正记录把异常转为合法预付款或冲回后，才解除阻断。
- 解除必须由财务主管并带证据，写完整 audit。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/payment/settlement-payment-capacity.spec.ts src/payment/payment-request.service.spec.ts src/contract-takeover/contract-takeover.service.spec.ts
```

### Step 3：实现

复用父 takeover 的兼容累计字段作为激活后的下游稳定读模型；逐笔付款和 allocation 是审计来源。

不要允许前端传入“解除阻断”布尔值。阻断状态必须由未更正的异常 allocation 汇总得出。

激活后合同侧/财务侧 PUT 均返回只读错误。合同事实、历史结算或历史实付需要修正时，复用并收紧现有 `recordCorrection`：

- `contract_facts`、`historical_settlement` 由合同部主管确认；
- `historical_payment`、`historical_advance`、`abnormal_overpay` 由财务主管确认；
- 更正必须带 before/after、原因、责任人和附件；
- 原历史 PaymentExecution 与凭证不删除，通过确认后的更正记录和调整 allocation 修正容量；
- 更正事务重算父 takeover 累计、期初结算 paidAmount 和付款阻断，但不重写旧审计。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/payment/settlement-payment-capacity.spec.ts src/payment/payment-request.service.spec.ts src/contract-takeover/contract-takeover.service.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/payment services/api/src/contract-takeover
git commit -m "feat: govern historical advance and overpayment"
```

---

## Task 8：改造同一详情页的合同侧和财务侧面板

**Files:**

- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- Create: `apps/web-admin/src/pages/contracts/components/ContractTakeoverContractSidePanel.vue`
- Create: `apps/web-admin/src/pages/contracts/components/ContractTakeoverFinanceSidePanel.vue`
- Create: `apps/web-admin/src/pages/contracts/components/ContractTakeoverDualConfirmationCard.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.structure.test.ts`
- Modify: `apps/web-admin/e2e/contract-takeover-responsive.e2e.ts`

### Step 1：先写 UI RED

同一详情页显示：

- 合同部资料：合同事实、累计历史结算、统一结算资料、合同侧 revision/确认人。
- 财务部资料：逐笔实付表、每笔凭证、零付款声明、超额分类、财务侧 revision/确认人。
- 双确认状态卡：合同侧、财务侧、当前是否可激活。

角色行为：

- 合同岗位编辑合同侧，财务侧只读。
- 财务岗位编辑财务侧，合同侧只读。
- 两类主管各自看到本侧确认/撤回。
- 激活后两侧全部只读，只显示“发起更正”。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-takeover.config.test.ts src/pages/contracts/contract-takeover.structure.test.ts
```

### Step 3：实现 API 和面板

按钮文案：

```text
保存合同资料
确认合同资料
撤回合同确认
保存财务资料
确认财务资料
撤回财务确认
```

每笔历史实付行必须显示凭证数量；没有凭证时财务确认按钮禁用，但后端仍重复校验。

激活后显示普通后续入口：

```text
发起结算
发起付款申请
```

入口仍由后端 `availableActions` 决定；不能只按页面状态猜测。

### Step 4：运行 GREEN 和 E2E

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-takeover.config.test.ts src/pages/contracts/contract-takeover.structure.test.ts
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.config.ts e2e/contract-takeover-responsive.e2e.ts
```

E2E 至少覆盖合同员、合同主管、财务人员、财务主管和 `375px` 视口。

### Step 5：提交

```bash
git add apps/web-admin/src/api/core-flow-read.api.ts apps/web-admin/src/pages/contracts apps/web-admin/e2e/contract-takeover-responsive.e2e.ts
git commit -m "feat: split historical takeover department workspace"
```

---

## Task 9：激活后的正常结算和付款回归

**Files:**

- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/payment/payment-request.service.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover-activation.service.spec.ts`
- Modify: `services/api/prisma/verify-trial-run.cjs`

### Step 1：先写端到端服务 RED

场景：

1. 双确认激活历史合同。
2. 在结算工作台创建新的普通结算。
3. 结算归档生效。
4. 从新结算发起付款申请。
5. 历史预付款正确抵扣，未付历史差额不自动变成新付款。
6. 异常超付场景在第 4 步失败关闭。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover-activation.service.spec.ts src/settlement/settlement.service.spec.ts src/payment/payment-request.service.spec.ts
```

### Step 3：做最小兼容修复并运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover-activation.service.spec.ts src/settlement/settlement.service.spec.ts src/payment/payment-request.service.spec.ts
```

更新 `verify-trial-run.cjs` 时保留只读/受控写入边界，不让脚本自动确认真实生产接管。

### Step 4：提交

```bash
git add services/api/src/contract-takeover services/api/src/settlement services/api/src/payment services/api/prisma/verify-trial-run.cjs
git commit -m "test: verify post takeover settlement and payment"
```

---

## Task 10：总门禁

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-takeover/contract-takeover.controller.spec.ts \
  src/contract-takeover/contract-takeover.service.spec.ts \
  src/contract-takeover/contract-takeover-activation.service.spec.ts \
  src/payment/settlement-payment-capacity.spec.ts \
  src/payment/payment-request.service.spec.ts \
  src/database/contract-takeover-department-schema.spec.ts
pnpm --filter @jiangkong/web-admin test -- \
  src/pages/contracts/contract-takeover.config.test.ts \
  src/pages/contracts/contract-takeover.structure.test.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/api exec prisma validate
git diff --check
```

预期：全部退出码 `0`。在 `PROGRESS.md` 明确记录迁移尚未应用生产、未确认任何真实历史合同、未改写生产付款数据。
