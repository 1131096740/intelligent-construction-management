# 历史合同双部门接管实施计划

> **执行要求：** 按任务顺序实施；历史金额、凭证、跨部门确认、余额流水和
> 更正任务先锁定失败用例，任何完成声明前运行本计划列出的全部验证命令。

**目标：** 把现有单人一次确认的历史接管改为合同部与财务部独立录入、
独立修订、独立主管确认；双确认基于同一合同财务口径时，生成生效合同版本、
唯一历史期初结算和逐笔历史实付事实。

**核心架构：**

- 保留 `ContractTakeover` 作为接管主记录。
- 合同侧和财务侧各自 CAS；合同侧另有只在财务依赖字段变化时递增的
  `financeBasisRevision`。
- 财务保存和确认同时记录 `basedOnContractRevision` 与
  `basedOnFinanceBasisRevision`。
- 激活比较 `financeBasisRevision`；完整合同 revision 用于追溯，不让纯展示
  字段变化无谓作废财务确认。
- 历史实付是已发生事实，不创建普通付款审批实例，也不伪造成普通
  `PaymentRequest`。
- 历史预付款和异常超付通过不可变 ledger 的 opening、deduction、correction、
  reversal 保持守恒。
- 激活后的更正是带主管复核和 delta/reversal 的业务动作，不能只记录说明。

**依赖：** 实施包 1 的版本级契约和审计边界、实施包 2 的 Decimal/分值金额
工具、现有 `ContractTakeoverService`、`ContractVersionActivationService`、
结算生效服务、付款容量服务、FileService 和 AuditService。

---

## Task 1：锁定共享词汇、双侧事实和不可变余额结构

**Files:**

- Modify: `packages/shared-domain/src/contract-takeover.ts`
- Modify: `packages/shared-domain/src/contract-takeover.test.ts`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260728120000_contract_takeover_department_confirmation/migration.sql`
- Create: `services/api/src/database/contract-takeover-department-schema.spec.ts`

### Step 1：先写共享词汇 RED

历史接管履约状态只使用：

```text
not_started
performing
suspended
completed
terminated
```

不再新增含义不明的 `ended`。兼容父表如仍需旧 `lifecycleStatus`，只允许在
read model 或迁移适配器中把 `completed/terminated` 映射为旧值，不能反向
猜测两者。

余额类型和流水类型固定为：

```text
balanceType: historical_advance | abnormal_overpay
entryKind: opening | deduction | correction | reversal | reclassification
```

### Step 2：先写 schema RED

建议核心模型：

```prisma
model ContractTakeoverContractFacts {
  takeoverId                   String    @id
  revision                     Int       @default(1)
  financeBasisRevision         Int       @default(1)
  historicalSettledCents       BigInt    @default(0)
  performanceStatus            String
  settlementEvidenceSummary    String?
  confirmedRevision            Int?
  confirmedByUserId            String?
  confirmedAt                  DateTime?
  updatedByUserId              String
  updatedAt                    DateTime  @updatedAt
}

model ContractTakeoverFinanceFacts {
  takeoverId                     String    @id
  revision                       Int       @default(1)
  basedOnContractRevision        Int
  basedOnFinanceBasisRevision    Int
  zeroPaymentDeclared            Boolean   @default(false)
  excessTreatment                String?
  excessReason                   String?
  confirmedRevision              Int?
  confirmedContractRevision      Int?
  confirmedFinanceBasisRevision  Int?
  confirmedByUserId              String?
  confirmedAt                    DateTime?
  updatedByUserId                String
  updatedAt                      DateTime  @updatedAt
}

model ContractTakeoverHistoricalPayment {
  id               String    @id @default(uuid())
  takeoverId       String
  rowKey           String
  sequenceNo       Int
  amountCents      BigInt
  paidAt           DateTime
  payerName        String?
  payeeName        String?
  bankReference    String?
  paymentMethod    String?
  note             String?
  status           String    @default("draft")
  activatedAt      DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@unique([takeoverId, rowKey])
  @@unique([takeoverId, sequenceNo])
}

model ContractTakeoverHistoricalPaymentAllocation {
  id                  String   @id @default(uuid())
  historicalPaymentId String
  allocationType      String
  amountCents         BigInt
  allocationOrder     Int
  createdAt           DateTime @default(now())

  @@unique([historicalPaymentId, allocationOrder])
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

model ContractTakeoverSideSaveRequest {
  idempotencyKey   String   @id
  takeoverId       String
  side             String
  expectedRevision Int
  resultRevision   Int
  requestSha256    String
  responseSnapshot Json
  createdByUserId  String
  createdAt        DateTime @default(now())
  expiresAt        DateTime

  @@index([takeoverId, side, createdAt])
  @@index([expiresAt])
}

model ContractTakeoverBalanceAccount {
  id              String   @id @default(uuid())
  takeoverId      String
  balanceType     String
  openingCents    BigInt
  balanceCents    BigInt
  revision        Int      @default(1)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([takeoverId, balanceType])
}

model ContractTakeoverBalanceEntry {
  id                String   @id @default(uuid())
  accountId         String
  entryKind         String
  amountCents       BigInt
  settlementId      String?
  historicalPaymentId String?
  correctionId      String?
  reversesEntryId   String?  @unique
  idempotencyKey    String   @unique
  createdByUserId   String
  createdAt         DateTime @default(now())

  @@index([accountId, createdAt])
}

model ContractTakeoverConfirmationEvent {
  id                           String   @id @default(uuid())
  idempotencyKey               String   @unique
  takeoverId                   String
  side                         String
  action                       String
  revision                     Int
  observedOtherSideRevision    Int?
  observedFinanceBasisRevision Int?
  reason                       String?
  actorUserId                  String
  responseSnapshot             Json?
  createdAt                    DateTime @default(now())

  @@index([takeoverId, side, createdAt])
}
```

另建合同侧结算依据关联、异常分类依据关联；二者都使用独占 `fileId`，不能只把
文件 ID 塞进 JSON。历史付款凭证表是历史实付的唯一权威文件绑定，统一付款
台账只引用历史实付或凭证记录 ID，不再把同一 `fileId` 写进
`PaymentExecution.voucherFileId`。

给 `ContractTakeover` 增加：

```prisma
activationIdempotencyKey      String?   @unique
activatedAt                   DateTime?
activatedByUserId             String?
historicalInitialSettlementId String?   @unique
```

数据库约束至少保证：

- 两侧 revision 和 basis revision 都大于 0。
- 实付金额、allocation 金额、opening 和 ledger 金额都大于 0。
- 每笔实付 allocation 合计等于实付金额。
- `excessTreatment` 只能为 `historical_advance` 或 `abnormal_overpay`。
- balance 不能小于 0；deduction 不能超过锁定后的当前余额。
- reversal 必须精确引用一条未反向的原 entry。
- 同一 `fileId` 只能有一个权威业务绑定。
- 双侧保存技术收据 7 天后可清理；确认事件、激活、更正和余额流水不得按该
  TTL 清理。

### Step 3：运行 RED

```bash
pnpm --filter @jiangkong/shared-domain test -- contract-takeover.test.ts
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-takeover-department-schema.spec.ts
```

### Step 4：实现增量迁移并运行 GREEN

迁移不猜测既有单确认属于哪一侧，不把累计实付拆成逐笔实付，不改写已生效
合同、付款或凭证。旧 `ContractTakeoverCorrection` 先保留兼容，新的可执行
更正在 Task 8 增量扩展。

```bash
pnpm --filter @jiangkong/shared-domain test -- contract-takeover.test.ts
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-takeover-department-schema.spec.ts
pnpm --filter @jiangkong/api exec prisma validate
pnpm --filter @jiangkong/api exec prisma generate
```

### Step 5：提交

```bash
git add packages/shared-domain/src services/api/prisma services/api/src/database
git commit -m "feat: add historical takeover department facts"
```

---

## Task 2：拆分权限动作

**Files:**

- Modify: `packages/shared-domain/src/permissions.ts`
- Modify: `packages/shared-domain/src/permissions.test.ts`
- Modify: `apps/web-admin/src/pages/business-readonly-access.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`

新增：

```text
contract.takeover.contract_facts.edit
contract.takeover.contract_facts.confirm
contract.takeover.finance_facts.edit
contract.takeover.finance_facts.confirm
contract.takeover.confirmation.withdraw
contract.takeover.correction.submit
contract.takeover.correction.review
```

- 合同侧编辑：`contract_staff`、`contract_director`
- 合同侧确认和合同类更正复核：`contract_director`
- 财务侧编辑：`finance_staff`、`finance_director`
- 财务侧确认和财务类更正复核：`finance_director`
- 撤回只能由本侧主管执行
- `super_admin` 不能代替业务主管确认或复核

先写权限和 `super_admin` 负向测试，再实现并提交：

```bash
pnpm --filter @jiangkong/shared-domain test -- permissions.test.ts
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.controller.spec.ts
git commit -m "feat: split historical takeover permissions"
```

---

## Task 3：实现合同侧独立保存和财务基线修订

**Files:**

- Create: `services/api/src/contract-takeover/dto/save-contract-takeover-contract-facts.dto.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`

路由：

```http
PUT /contract-takeovers/:takeoverId/contract-side
```

请求只允许合同侧事实，包含：

```ts
{
  idempotencyKey: string;
  expectedRevision: number;
  signedAt: string;
  performanceStatus:
    | "not_started"
    | "performing"
    | "suspended"
    | "completed"
    | "terminated";
  historicalSettledCents: string;
  settlementEvidenceSummary: string;
  settlementEvidenceFileIds: string[];
  paymentTerms: HistoricalPaymentTermsInput;
  contractFacts: HistoricalContractFactsInput;
}
```

RED 必须覆盖：

- 合同侧 `revision` 只增加一次，财务事实不被覆盖。
- 任意合同侧修改都使合同侧确认失效。
- `historicalSettledCents`、付款条款、结算截止事实等财务依赖变化时，
  `financeBasisRevision` 增加并使财务确认失效。
- 只修改不影响财务分类的展示字段时，finance basis 不变，可保留财务确认。
- 结算额为 0 时必须明确声明和依据。
- 证据文件必须 active、可访问且没有其他业务绑定。
- 旧 revision、已激活接管和非合同岗位均零写入。
- 相同幂等键和相同请求重试返回第一次结果；同键不同请求失败关闭。自动保存
  只写 7 天技术收据和最后保存信息，不逐次追加永久业务审计。

固定锁序：

```text
ContractTakeover
-> ContractTakeoverContractFacts
-> ContractTakeoverFinanceFacts
-> settlement evidence FileObject（按 id）
```

运行：

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-takeover/contract-takeover.service.spec.ts \
  src/contract-takeover/contract-takeover.controller.spec.ts
git commit -m "feat: save historical takeover contract facts"
```

---

## Task 4：实现财务侧逐笔实付、凭证和依赖基线

**Files:**

- Create: `services/api/src/contract-takeover/dto/save-contract-takeover-finance-facts.dto.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`

路由：

```http
PUT /contract-takeovers/:takeoverId/finance-side
```

请求：

```ts
{
  idempotencyKey: string;
  expectedRevision: number;
  basedOnContractRevision: number;
  basedOnFinanceBasisRevision: number;
  zeroPaymentDeclared: boolean;
  excessTreatment?: "historical_advance" | "abnormal_overpay";
  excessReason?: string;
  excessEvidenceFileIds?: string[];
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

RED 必须覆盖：

- 锁定合同侧 facts 后校验两个 basis revision；不一致时零写并要求刷新。
- 零笔实付必须显式声明，非零实付不能声明为零。
- 每笔实付至少一份 active 私有凭证，同一凭证不能重复或跨业务绑定。
- 超额必须分类、填写原因并上传独立依据；分类依据不能用付款凭证是否存在代替。
- 财务保存根据锁定后的合同累计结算计算 allocation 预览。
- 财务修改只使财务确认失效；合同侧确认不变化。
- sequenceNo 由服务端按 `paidAt, rowKey` 稳定生成，不信任客户端顺序号。
- 相同幂等键和相同请求重试返回第一次结果；同键不同请求失败关闭。自动保存
  不逐次追加永久业务审计。

保存只生成草稿历史实付及 allocation 预览，不创建 Settlement、PaymentRequest、
PaymentExecution 或余额账户。

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-takeover/contract-takeover.service.spec.ts \
  src/contract-takeover/contract-takeover.controller.spec.ts \
  src/file/file.service.spec.ts
git commit -m "feat: record historical takeover payments by item"
```

---

## Task 5：实现两侧确认、撤回和同事务激活协调

**Files:**

- Create: `services/api/src/contract-takeover/dto/confirm-contract-takeover-side.dto.ts`
- Create: `services/api/src/contract-takeover/dto/withdraw-contract-takeover-side-confirmation.dto.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- Create: `services/api/src/database/contract-takeover-confirmation-concurrency.spec.ts`

确认和撤回请求都带本侧 `expectedRevision`、当前密码和动作幂等键；撤回还
必须带原因。财务确认还必须带当前
`basedOnContractRevision/basedOnFinanceBasisRevision`。

RED 必须覆盖：

- 两侧主管只能确认本侧当前 revision。
- 财务保存时两个 observed revision 都必须是锁定后的当前值；确认和激活时
  `financeBasisRevision` 过期则拒绝。仅完整合同 revision 变化但 finance
  basis 未变时，保留追溯值和财务确认。
- 第一侧确认后仍不生效。
- 第二侧确认在同一个 Serializable 事务内调用
  `tryActivateInTransaction`；不能先提交“双确认”再依赖无人触发的后续命令。
- 确认、撤回和合同侧 basis 修改并发时只有一个满足锁后事实。
- 激活后撤回稳定拒绝；网络重试返回第一次确认/激活结果。
- 任何 token、密码、凭证 objectKey 不进入审计。

固定锁序：

```text
ContractTakeover
-> ContractTakeoverContractFacts
-> ContractTakeoverFinanceFacts
-> historical payments / vouchers（按 id）
-> Contract / ContractVersion / PaymentTermsVersion
```

运行单测和真实 PostgreSQL 双连接并发测试后提交：

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-takeover/contract-takeover.service.spec.ts \
  src/database/contract-takeover-confirmation-concurrency.spec.ts
git commit -m "feat: confirm historical takeover by department"
```

---

## Task 6：原子激活历史期初结算和历史实付事实

**Files:**

- Create: `services/api/src/contract-takeover/contract-takeover-activation.service.ts`
- Create: `services/api/src/contract-takeover/contract-takeover-activation.service.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.module.ts`
- Modify: `services/api/src/payment/settlement-payment-capacity.ts`
- Modify: `services/api/src/payment/payment-read.service.ts`
- Modify: `services/api/src/payment/payment-read.service.spec.ts`

激活事务：

1. 重读并锁定 Task 5 的全部行。
2. 验证两侧当前 revision 已确认。
3. 验证财务确认 basis 与合同侧当前 basis 完全相等。
4. 使合同版本和付款条款生效。
5. 始终创建唯一 `sourceType=historical_takeover` 的历史期初结算，即使金额为 0。
6. 把历史实付和 allocation 从 draft 改为 activated，凭证绑定不移动、不复制。
7. 创建历史预付款或异常超付 balance account 及唯一 opening entry。
8. 将期初结算的历史已付缓存设置为正常结算 allocation 合计。
9. 回写父 takeover 兼容累计字段、激活幂等键、期初结算 ID 和时间。
10. 写一条激活审计；重复调用返回第一次结果，零重复记录。

历史实付不创建普通 `PaymentRequest`、`PaymentExecution` 或 `ApprovalInstance`。
`PaymentReadService` 通过 union read model 显示：

```text
来源：历史接管
性质：已发生实付，不重新审批
凭证：读取 ContractTakeoverHistoricalPaymentVoucher
```

RED 必须覆盖零结算、零付款、多付款、多凭证、预付款、异常超付、重复激活、
文件独占绑定和期初结算金额守恒。

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-takeover/contract-takeover-activation.service.spec.ts \
  src/payment/settlement-payment-capacity.spec.ts \
  src/payment/payment-read.service.spec.ts
git commit -m "feat: activate historical takeover payment facts"
```

---

## Task 7：实现预付款抵扣与异常超付余额流水

**Files:**

- Create: `services/api/src/contract-takeover/contract-takeover-balance.service.ts`
- Create: `services/api/src/contract-takeover/contract-takeover-balance.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-signed-document.service.ts`
- Modify: `services/api/src/settlement/settlement-signed-document.service.spec.ts`
- Modify: `services/api/src/payment/payment-request.service.ts`
- Modify: `services/api/src/payment/payment-request.service.spec.ts`
- Create: `services/api/src/database/contract-takeover-balance-concurrency.spec.ts`

历史预付款：

- 后续新结算生效时，在同一事务锁定 advance account。
- 以 `min(结算本期应付, 当前预付款余额)` 创建唯一 deduction entry。
- deduction 关联 settlementId 和幂等键；重复归档不能重复抵扣。
- 结算 read model 显示期初应付、预付款抵扣和抵扣后可申请金额。
- reversal 只追加反向 entry，并恢复锁定后的余额。

异常超付：

- abnormal account `balanceCents > 0` 时，新付款申请和已有待执行付款的实际执行
  都由后端失败关闭。
- 门禁必须同时进入 `PaymentRequestService.create` 和同一服务的
  `recordExecution` 锁内路径；只在创建申请时检查，不能阻止已批准待支付记录
  绕过风险门禁。
- 前端布尔值不能解除阻断。
- 只有 Task 8 已确认并应用的 correction/reclassification/reversal 才改变余额。

真实 PostgreSQL 并发必须覆盖：

- 同一余额同时抵扣两份结算不超额。
- 同一结算同一幂等键只抵扣一次。
- 抵扣与更正并发后余额仍守恒。
- 异常解除与付款创建并发时只有锁后合法路径成功。

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-takeover/contract-takeover-balance.service.spec.ts \
  src/settlement/settlement-signed-document.service.spec.ts \
  src/payment/payment-request.service.spec.ts \
  src/database/contract-takeover-balance-concurrency.spec.ts
git commit -m "feat: govern historical takeover balances"
```

---

## Task 8：把历史更正升级为可复核、可应用的 delta/reversal

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260728130000_contract_takeover_correction_ledger/migration.sql`
- Create: `services/api/src/contract-takeover/dto/submit-contract-takeover-correction.dto.ts`
- Create: `services/api/src/contract-takeover/dto/review-contract-takeover-correction.dto.ts`
- Create: `services/api/src/contract-takeover/contract-takeover-correction.service.ts`
- Create: `services/api/src/contract-takeover/contract-takeover-correction.service.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`

现有 `recordCorrection` 只记录说明，不能直接拿来修改金额。迁移保留旧记录为
`schemaVersion=1/informational`；新更正使用 `schemaVersion=2`：

```text
draft -> submitted -> applied
                  \-> rejected
```

`applied` 同时保存主管确认人、确认时间和复核意见；本方案不持久化一个已经
确认却尚未应用的中间状态，避免金额事实与更正状态短暂不一致。

新更正必须保存：

- 目标事实和目标 revision/balance revision。
- 结构化 before、结构化 delta/after。
- 原因、责任人和独占依据文件。
- 提交人、对应业务主管、复核意见和应用幂等键。
- reclassification、correction 或 reversal 对原 payment/allocation/ledger entry 的引用。

合同事实、历史结算由合同部主管复核；历史实付、预付款和异常超付由财务主管
复核。确认和应用在同一 Serializable 事务完成，重算父 takeover 兼容累计和
期初结算缓存，但不删除原实付、凭证、allocation、ledger 或审计。

RED 覆盖权限、旧 revision、重复应用、一分差额、超余额、凭证独占、并发复核
和应用后付款门禁。

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-takeover/contract-takeover-correction.service.spec.ts \
  src/contract-takeover/contract-takeover.service.spec.ts \
  src/contract-takeover/contract-takeover.controller.spec.ts \
  src/payment/payment-request.service.spec.ts
pnpm --filter @jiangkong/api exec prisma validate
git commit -m "feat: apply historical takeover corrections safely"
```

---

## Task 9：改造同一详情页的双侧面板和更正入口

**Files:**

- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- Create: `apps/web-admin/src/pages/contracts/contract-takeover-side-save.state.ts`
- Create: `apps/web-admin/src/pages/contracts/contract-takeover-side-save.state.test.ts`
- Create: `apps/web-admin/src/pages/contracts/components/ContractTakeoverContractSidePanel.vue`
- Create: `apps/web-admin/src/pages/contracts/components/ContractTakeoverFinanceSidePanel.vue`
- Create: `apps/web-admin/src/pages/contracts/components/ContractTakeoverDualConfirmationCard.vue`
- Create: `apps/web-admin/src/pages/contracts/components/ContractTakeoverCorrectionPanel.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.structure.test.ts`
- Modify: `apps/web-admin/e2e/contract-takeover-responsive.e2e.ts`

页面必须显示：

- 两侧当前 revision、确认 revision 和确认人。
- 财务侧所依据的合同 revision/basis revision；完整 revision 变化但 basis
  未变时标记为“非财务字段已更新、确认仍有效”，basis 过期时才要求重新保存
  确认。
- 逐笔实付、唯一凭证绑定、allocation、预付款和异常余额。
- 激活后的 correction 状态、before/delta/after 和主管复核结果。

合同侧和财务侧各自使用独立 model、revision、幂等键和单飞保存状态；首次
变脏后约 2 秒自动保存，网络重试复用原幂等键。一侧请求或响应不得读写另一侧
model，离开页面只 flush 当前岗位可编辑且 dirty 的区域。basis 冲突保留本地
输入并要求重新读取，不能用错误响应覆盖。

角色只能编辑本侧；激活后两侧只读，只能发起有权限的更正。普通后续入口仍由
后端 `availableActions` 决定。

E2E 至少覆盖合同员、合同主管、财务人员、财务主管、两侧交错保存互不覆盖、
basis 失效、双确认、更正和 `375px` 视口。

```bash
pnpm --filter @jiangkong/web-admin test -- \
  src/api/core-flow-read.api.test.ts \
  src/pages/contracts/contract-takeover-side-save.state.test.ts \
  src/pages/contracts/contract-takeover.config.test.ts \
  src/pages/contracts/contract-takeover.structure.test.ts
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.config.ts \
  e2e/contract-takeover-responsive.e2e.ts
git commit -m "feat: split historical takeover department workspace"
```

---

## Task 10：激活后的正常结算和付款回归

场景：

1. 双侧基于同一 basis 确认并激活历史合同。
2. 创建并生效一笔新的普通结算。
3. 历史预付款只抵扣一次并生成 ledger。
4. 从历史期初结算未付差额和新结算分别发起正常付款申请。
5. 历史实付只作为历史事实显示，不出现伪造审批。
6. 异常超付场景在付款创建和付款执行两处都失败关闭。
7. 主管更正确认后，余额、期初结算缓存和付款门禁一致恢复。

更新 `verify-trial-run.cjs` 时保持默认只读，不自动确认、激活、更正或写真实
生产接管。

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test -- --runInBand \
  src/contract-takeover/contract-takeover.controller.spec.ts \
  src/contract-takeover/contract-takeover.service.spec.ts \
  src/contract-takeover/contract-takeover-activation.service.spec.ts \
  src/contract-takeover/contract-takeover-balance.service.spec.ts \
  src/contract-takeover/contract-takeover-correction.service.spec.ts \
  src/payment/settlement-payment-capacity.spec.ts \
  src/payment/payment-request.service.spec.ts \
  src/payment/payment-read.service.spec.ts \
  src/database/contract-takeover-department-schema.spec.ts \
  src/database/contract-takeover-confirmation-concurrency.spec.ts \
  src/database/contract-takeover-balance-concurrency.spec.ts
pnpm --filter @jiangkong/web-admin test -- \
  src/api/core-flow-read.api.test.ts \
  src/pages/contracts/contract-takeover-side-save.state.test.ts \
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

`PROGRESS.md` 必须明确：仅本地实现与验证；迁移未应用生产，未确认或激活真实
历史合同，未改写生产结算、付款、余额或凭证。
