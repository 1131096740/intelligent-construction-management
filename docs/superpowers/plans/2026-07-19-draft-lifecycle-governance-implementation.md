# 建工智管全系统草稿生命周期治理 Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD. A worker must own explicit files, must not revert concurrent edits, and must stop when the reconciled main branch already contains an equivalent capability. The primary agent reviews every diff and runs the final gates.

**Goal:** 在不改变审批、金额、权限、上传、归档、生效和实付逻辑的前提下，为全系统建立可审计的草稿终止能力，分离正式台账、我的草稿、退回待修改和已结束，并安全释放金额、额度、余额、唯一性和父子流程占用。

**Architecture:** 继续使用 Vue 3 + TypeScript + TDesign Vue Next、NestJS + Prisma + PostgreSQL 单体架构。共享域只定义用户可见生命周期语义和读取契约，能否放弃由各领域服务依据审批、文件、金额和下游事实决定；业务记录只做前向状态转换，不物理删除。技术临时数据的保留策略与业务草稿治理分开实施。

**Tech Stack:** Vue 3、TypeScript、TDesign Vue Next、Vite、NestJS、Prisma 5、PostgreSQL 16、Jest、Vitest、Playwright、腾讯 COS 私有文件链路和既有统一审计。

---

## 0. 执行基线、授权边界和成功标准

本计划依据已批准规格：

- `docs/superpowers/specs/2026-07-19-draft-lifecycle-governance-design.md`

计划编写时事实：

- 文档分支：`codex/contract-tax-facts-pricing`
- 文档分支 HEAD：`6afed8eae6198dbcc88914effaaa0812bc08c187`
- 本地 `main` / `origin/main`：`c72c312978ddf77feff657a315a70cd1dd8cc882`
- 当前文档分支相对 `origin/main` 为主线领先 3 个提交、文档分支领先 2 个提交，不能在当前分叉状态直接开始编码。
- 主线新增的 `797a8920b1ee67e13493edf15b4b008e820a83d9` 已恢复现有 A5 付款草稿填写入口；本计划必须复用，不得重复实现或回退。
- 当前生产运行时为 `797a8920b1ee67e13493edf15b4b008e820a83d9`，数据库为 69 个已完成迁移；`c72c3129` 只记录后续 UAT 发布事实。
- 本地及生产当前均为 69 个迁移；草稿治理新增迁移从 M70 开始。
- 本计划的批准只授权生成计划文档；不授权业务代码、Schema、迁移执行、生产只读盘点、推送、部署或生产数据修改。

### 不可变边界

1. 不编辑或重命名现有 69 个迁移；所有变化使用前向迁移。
2. 不改变任何审批节点、审批人解析、自审、委托、转交、OR 签和归档生效规则。
3. 不改变合同上限、结算占额、付款额度、供应商余额、项目资金池和元分转换算法。
4. 不通过前端重算或释放金额；所有释放与状态转换在同一后端事务完成。
5. 不物理删除合同、结算、付款、采购、收货、模板版本、审批、附件、签署、归档、实付、退款和审计记录。
6. 不直接删除 COS 业务对象，不改变上传 API、类型、大小、私有读写、下载授权和短时 URL。
7. 不新增第二套 UI 库、通用工作流引擎、通用软删除框架或跨领域万能 Controller。
8. 不自动删除长期未处理业务草稿；生产存量只能先只读盘点，再单独授权治理。
9. `super_admin` 不因本计划获得业务删除、放弃、审批或作废权限。
10. 每个 Task 更新 `PROGRESS.md` 并形成独立 Conventional Commit；不得用删除或弱化测试换取通过。

### 最终成功标准

1. 系统能区分本地未保存、纯净持久化草稿、审批型草稿、正式业务记录和技术临时数据。
2. 新合同、接管、税务修订、结算、普通付款退回、零星采购/付款/收货和模板版本均使用正确终止语义。
3. 正式台账、我的草稿、退回待修改和已结束的服务端分页、统计和页面展示一致。
4. 放弃操作不会抹除审批、签署、用印、归档、实付、收货、退款或文件下载证据。
5. 金额、额度、余额和唯一性占用恰好释放一次；并发提交与放弃只能成功一个。
6. 自动生成的零星采购付款草稿放弃后可以安全重新创建，且保留来源链路。
7. 空库、最新主线数据库、生产备份隔离恢复库和真实岗位 UAT 均通过后，才可形成发布候选。

## 1. 文件责任图

### 1.1 计划新增文件

**共享域与基础测试**

- `packages/shared-domain/src/draft-lifecycle.ts`
- `packages/shared-domain/src/draft-lifecycle.test.ts`
- `services/api/scripts/inspect-draft-lifecycle-readiness.cjs`
- `services/api/src/database/draft-lifecycle-readiness-script.spec.ts`
- `services/api/src/database/draft-lifecycle-core-schema-verification.spec.ts`
- `services/api/src/database/draft-lifecycle-spot-schema-verification.spec.ts`
- `services/api/src/database/draft-lifecycle-template-schema-verification.spec.ts`
- `services/api/src/database/draft-lifecycle-business-record-preservation.spec.ts`
- `services/api/prisma/verify-draft-lifecycle.cjs`
- `services/api/src/database/draft-lifecycle-live-verification.spec.ts`

**领域 DTO**

- `services/api/src/contract/dto/abandon-contract-draft.dto.ts`
- `services/api/src/contract-takeover/dto/abandon-contract-takeover.dto.ts`
- `services/api/src/contract-takeover/dto/abandon-contract-takeover-batch.dto.ts`
- `services/api/src/contract-tax-facts/dto/abandon-contract-tax-fact-revision.dto.ts`
- `services/api/src/settlement/dto/abandon-settlement-draft.dto.ts`
- `services/api/src/payment/dto/abandon-payment-request.dto.ts`
- `services/api/src/spot-procurement/dto/abandon-spot-procurement-draft.dto.ts`
- `services/api/src/spot-procurement/dto/abandon-spot-procurement-payment-draft.dto.ts`
- `services/api/src/spot-procurement/dto/reset-spot-procurement-receipt.dto.ts`
- `services/api/src/contract-template/dto/discard-template-version.dto.ts`
- `services/api/src/settlement/dto/discard-settlement-template-version.dto.ts`

**Web 公共能力**

- `apps/web-admin/src/components/BusinessDraftAction.vue`
- `apps/web-admin/src/components/business-draft-action.config.ts`
- `apps/web-admin/src/components/business-draft-action.config.test.ts`
- `apps/web-admin/src/lib/use-unsaved-changes-guard.ts`
- `apps/web-admin/src/lib/use-unsaved-changes-guard.test.ts`
- `apps/web-admin/e2e/draft-lifecycle-governance.e2e.ts`

**交付文档**

- `DRAFT_LIFECYCLE_IMPLEMENTATION_REPORT.md`
- `DRAFT_LIFECYCLE_RELEASE_READINESS.md`
- `docs/progress/2026-07-19-draft-lifecycle-governance.md`

### 1.2 主要修改文件

**Schema、共享域和包脚本**

- `services/api/prisma/schema.prisma`
- `services/api/package.json`
- `packages/shared-domain/src/index.ts`

**合同、接管和税务修订**

- `services/api/src/contract/contract.controller.ts`
- `services/api/src/contract/contract.controller.spec.ts`
- `services/api/src/contract/contract.service.ts`
- `services/api/src/contract/contract.service.spec.ts`
- `services/api/src/contract/contract-read.service.ts`
- `services/api/src/contract/contract-read.service.spec.ts`
- `services/api/src/contract-workbench/contract-workbench.service.ts`
- `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- `services/api/src/contract-takeover/contract-takeover.controller.ts`
- `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`
- `services/api/src/contract-takeover/contract-takeover.service.ts`
- `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- `services/api/src/contract-tax-facts/contract-tax-facts.service.ts`
- `services/api/src/contract-tax-facts/contract-tax-facts.service.spec.ts`

**结算、付款和项目支出**

- `services/api/src/settlement/settlement-draft.controller.ts`
- `services/api/src/settlement/settlement-draft.service.ts`
- `services/api/src/settlement/settlement-draft.service.spec.ts`
- `services/api/src/settlement/settlement-submission.service.ts`
- `services/api/src/settlement/settlement-submission.service.spec.ts`
- `services/api/src/settlement/settlement.service.ts`
- `services/api/src/settlement/settlement.service.spec.ts`
- `services/api/src/settlement/settlement-read.service.ts`
- `services/api/src/settlement/settlement-read.service.spec.ts`
- `services/api/src/payment/payment.controller.ts`
- `services/api/src/payment/payment-request.service.ts`
- `services/api/src/payment/payment-request.service.spec.ts`
- `services/api/src/payment/payment-read.service.ts`
- `services/api/src/payment/payment-read.service.spec.ts`
- `services/api/src/project-expense/project-expense.service.spec.ts`

**零星采购**

- `services/api/src/spot-procurement/spot-procurement.controller.ts`
- `services/api/src/spot-procurement/spot-procurement.controller.spec.ts`
- `services/api/src/spot-procurement/spot-procurement-application.service.ts`
- `services/api/src/spot-procurement/spot-procurement-application.service.spec.ts`
- `services/api/src/spot-procurement/spot-procurement-payment.controller.ts`
- `services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- `services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts`
- `services/api/src/spot-procurement/spot-procurement-receipt.controller.ts`
- `services/api/src/spot-procurement/spot-procurement-receipt.service.ts`
- `services/api/src/spot-procurement/spot-procurement-receipt.service.spec.ts`
- `services/api/src/spot-procurement/spot-procurement-read.service.ts`
- `services/api/src/spot-procurement/spot-procurement-read.service.spec.ts`
- `services/api/src/spot-procurement/spot-procurement-closure.service.ts`
- `services/api/src/spot-procurement/spot-procurement-closure.service.spec.ts`

**模板**

- `services/api/src/contract-template/contract-template.controller.ts`
- `services/api/src/contract-template/contract-template.controller.spec.ts`
- `services/api/src/contract-template/contract-template.service.ts`
- `services/api/src/contract-template/contract-template.service.spec.ts`
- `services/api/src/contract-template/layout-template.service.ts`
- `services/api/src/contract-template/layout-template.service.spec.ts`
- `services/api/src/settlement/settlement-template.controller.ts`
- `services/api/src/settlement/settlement-template.controller.spec.ts`
- `services/api/src/settlement/settlement-template.service.ts`
- `services/api/src/settlement/settlement-template.service.spec.ts`

**Web API 与页面**

- `apps/web-admin/src/api/contract-workbench.api.ts`
- `apps/web-admin/src/api/contract-workbench.api.test.ts`
- `apps/web-admin/src/api/contract-tax-facts.api.ts`
- `apps/web-admin/src/api/contract-tax-facts.api.test.ts`
- `apps/web-admin/src/api/settlement-drafts.api.ts`
- `apps/web-admin/src/api/settlement-drafts.api.test.ts`
- `apps/web-admin/src/api/core-flow-read.api.ts`
- `apps/web-admin/src/api/core-flow-read.api.test.ts`
- `apps/web-admin/src/api/spot-procurement.api.ts`
- `apps/web-admin/src/api/spot-procurement.api.test.ts`
- `apps/web-admin/src/api/settlement-template.api.ts`
- `apps/web-admin/src/api/settlement-template.api.test.ts`
- `apps/web-admin/src/pages/home/HomePage.vue`
- `apps/web-admin/src/pages/contracts/ContractListPage.vue`
- `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`
- `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- `apps/web-admin/src/pages/contracts/contract-takeover.config.ts`
- `apps/web-admin/src/pages/contracts/contract-takeover.config.test.ts`
- `apps/web-admin/src/pages/contracts/contract-tax-fact-review.state.ts`
- `apps/web-admin/src/pages/contracts/contract-tax-fact-review.state.test.ts`
- `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`
- `apps/web-admin/src/pages/settlements/SettlementListPage.vue`
- `apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue`
- `apps/web-admin/src/pages/settlements/SettlementDetailPage.vue`
- `apps/web-admin/src/pages/payments/PaymentListPage.vue`
- `apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue`
- `apps/web-admin/src/pages/payments/PaymentDetailPage.vue`
- `apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue`
- `apps/web-admin/src/pages/projects/ProjectExpenseApprovalDetailPage.vue`
- `apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue`
- `apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue`
- `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentWorkbenchPage.vue`
- `apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue`
- `apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptWorkbenchPage.vue`
- `apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue`
- `apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- `apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue`
- `apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue`
- `apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue`
- `apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue`
- `apps/web-admin/src/pages/settlement-templates/SettlementTemplateListPage.vue`
- `apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue`
- `apps/web-admin/scripts/check-ui-rules.mjs`

执行时如果最新主线已经存在同名或等价能力，只修改现有文件，不创建重复实现。任何计划外业务文件都必须先说明原因并更新本计划或 `PROGRESS.md`。

## 2. 提交顺序与文件所有权

```text
Task 0  主线基线合并与零回归
Task 1  共享语义和只读盘点
Task 2  M70 合同/接管/税务/结算生命周期
Task 3  新合同与合同变更放弃
Task 4  历史接管与税务修订放弃
Task 5  结算草稿放弃和唯一性释放
Task 6  M71 普通付款与零星采购生命周期
Task 7  普通付款、报销和旧项目支出语义
Task 8  零星采购父流程放弃与安全级联
Task 9  零星采购付款放弃与重新创建
Task 10 收货草稿重置与关闭
Task 11 M72 模板草稿版本生命周期
Task 12 模板废弃 API 与服务
Task 13 Web 公共草稿动作与未保存保护
Task 14 合同/接管/税务/结算 Web
Task 15 普通付款/报销 Web
Task 16 零星采购/模板/首页/台账 Web
Task 17 全量回归、隔离迁移、只读盘点与 UAT
Task 18 发布候选与生产授权门禁
```

同一时刻只能有一个执行者修改 `schema.prisma`、`contract.service.ts`、`settlement.service.ts`、`payment-request.service.ts`、`spot-procurement-payment.service.ts`、`core-flow-read.api.ts`、`PROGRESS.md` 或迁移目录。主执行者必须亲自阅读关键代码、审查全部 diff、验证提交边界并运行最终门禁。

## 3. 逐任务实施计划

### Task 0：建立最新主线实施基线

**目标：** 在不丢失已批准规格和计划的前提下，把 `c72c3129` 主线新增的 A5 草稿入口与 UI 修复纳入唯一实施分支。

**文件：**

- 修改：`PROGRESS.md`
- 不修改业务代码；只允许 Git 合并冲突的忠实整合

**步骤：**

1. 重新读取 `PROGRESS.md`、`AGENTS.md`、本规格、本计划和最新主线发布记录。
2. 核对 `git status`、活跃 worktree、HEAD、`origin/main` 以及左右提交数；工作区不洁净则停止。
3. 从当前文档 HEAD 创建 `codex/draft-lifecycle-governance`，再合并 `origin/main`；`PROGRESS.md` 冲突必须同时保留主线 UAT 事实与草稿治理设计/计划记录。
4. 明确验证 `797a8920` 的 A5 草稿填写入口仍存在，不重复增加同一逻辑。
5. 运行未改业务基线：

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test
pnpm --filter @jiangkong/web-admin test
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git diff --check
```

6. 更新 `PROGRESS.md`，记录实施基线、生产运行 SHA、69 个迁移和基线测试。
7. 提交：

```text
chore: establish draft lifecycle governance baseline
```

### Task 1：共享生命周期语义与只读存量盘点

**目标：** 先建立不会写生产的分类契约和盘点能力，禁止后续页面自行猜测生命周期。

**文件：**

- 新增：`packages/shared-domain/src/draft-lifecycle.ts`
- 新增：`packages/shared-domain/src/draft-lifecycle.test.ts`
- 修改：`packages/shared-domain/src/index.ts`
- 新增：`services/api/scripts/inspect-draft-lifecycle-readiness.cjs`
- 新增：`services/api/src/database/draft-lifecycle-readiness-script.spec.ts`
- 修改：`services/api/package.json`
- 修改：`PROGRESS.md`

**步骤：**

1. 先写失败测试，固定五类生命周期、四类台账视图和动作 key：`discard_local`、`delete_pristine_draft`、`abandon_application`、`withdraw`、`void`、`terminate`、`discard_version`。
2. 共享域只导出展示契约和稳定标签，不导出“只看 status 即可删除”的通用判定函数。
3. 盘点脚本使用显式只读事务，按领域统计状态、责任人是否启用、审批历史、文件证据、金额占用和下游事实；默认只输出聚合与脱敏 ID，不输出文件对象键、银行账号、密钥或正文。
4. 脚本输出 A/B/C/D 分类候选和阻断原因，但不执行 INSERT、UPDATE、DELETE、ALTER、DROP 或 TRUNCATE。
5. 增加 `inspect:draft-lifecycle-readiness` package 命令；本 Task 不连接生产执行。
6. 运行：

```bash
pnpm --filter @jiangkong/shared-domain test -- draft-lifecycle.test.ts
node --check services/api/scripts/inspect-draft-lifecycle-readiness.cjs
pnpm --filter @jiangkong/api test -- --runInBand src/database/draft-lifecycle-readiness-script.spec.ts
pnpm --filter @jiangkong/shared-domain typecheck
git diff --check
```

7. 更新 `PROGRESS.md` 并提交：

```text
feat: add draft lifecycle audit baseline
```

### Task 2：M70 合同、接管、税务修订和结算草稿状态

**目标：** 增加前向、可审计且不改写历史的核心草稿终止事实。

**文件：**

- 修改：`services/api/prisma/schema.prisma`
- 新增：`services/api/prisma/migrations/20260719210000_contract_settlement_draft_lifecycle/migration.sql`
- 新增：`services/api/src/database/draft-lifecycle-core-schema-verification.spec.ts`
- 新增：`services/api/src/database/draft-lifecycle-business-record-preservation.spec.ts`
- 修改：`PROGRESS.md`

**Schema 变化：**

- `ContractVersion`、`ContractTakeover`、`ContractTaxFactRevision`、`SettlementDraft` 增加 `abandonedAt`、`abandonedByUserId`、`abandonReason`。
- 四类状态允许 `abandoned`，并增加按状态和更新时间读取所需索引。
- 不回填现有记录为 `abandoned`，不改变原 `draft`、提交、退回和确认状态。
- 前向迁移更新 M69 之后的有效状态约束；不编辑 M69 SQL，不放宽其他非法状态。

**步骤：**

1. 先写 Schema/SQL 失败测试，要求新增列可空、迁移无业务 DML、正式外键保持 `RESTRICT` 或领域原行为。
2. 增加 Prisma 字段和手写迁移；迁移前检查现有约束名和索引，禁止猜测后直接 DROP。
3. 增加静态保护测试：目标放弃服务不得调用 Prisma `delete`/`deleteMany` 删除业务根、版本、审批和文件对象。
4. 运行：

```bash
DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder pnpm --filter @jiangkong/api prisma format
DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder pnpm --filter @jiangkong/api prisma validate
pnpm --filter @jiangkong/api prisma generate
pnpm --filter @jiangkong/api test -- --runInBand src/database/draft-lifecycle-core-schema-verification.spec.ts src/database/draft-lifecycle-business-record-preservation.spec.ts
git diff --check
```

5. 更新 `PROGRESS.md` 并提交：

```text
feat: add contract settlement draft lifecycle schema
```

### Task 3：新合同与合同变更放弃

**目标：** 让纯净新合同可以删除，让派生变更和曾提交合同只能放弃，并保持正式合同不变。

**文件：**

- 新增：`services/api/src/contract/dto/abandon-contract-draft.dto.ts`
- 修改：`services/api/src/contract/contract.controller.ts`
- 修改：`services/api/src/contract/contract.controller.spec.ts`
- 修改：`services/api/src/contract/contract.service.ts`
- 修改：`services/api/src/contract/contract.service.spec.ts`
- 修改：`services/api/src/contract/contract-read.service.ts`
- 修改：`services/api/src/contract/contract-read.service.spec.ts`
- 修改：`services/api/src/contract-workbench/contract-workbench.service.ts`
- 修改：`services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 先写测试：原始版本从未提交时返回 `delete_pristine_draft`；存在任何审批实例/动作、变更来源、正式文件、授权书、用章、归档或下游结算/付款时不得返回纯净删除。
2. 新增语义化 `POST` 动作，不新增业务 `DELETE`；DTO 接受期望修订号、动作类型和按规格要求的原因。
3. 事务按合同根、目标版本、审批、正式文件/授权/用章和下游事实固定顺序锁定；状态或修订变化时返回中文 409。
4. 纯净原始草稿将版本标记 `abandoned`；合同变更或曾提交版本执行“放弃合同申请/变更”，原有效版本、付款条款和累计变更事实不变。
5. 关闭草稿检查点、待生成预览和未提交文件绑定；已经进入审批或签署的文件只失效绑定并保留证据。
6. 合同列表默认排除 `abandoned`，详情读取返回 `lifecycleKind`、`availableActions` 和阻断原因；正式编号不复用。
7. 覆盖责任人转交、非责任人、主管、`super_admin`、重复请求和提交/放弃并发测试。
8. 运行：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract.controller.spec.ts src/contract/contract.service.spec.ts src/contract/contract-read.service.spec.ts src/contract-workbench/contract-workbench.service.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api check:business-errors
git diff --check
```

9. 更新 `PROGRESS.md` 并提交：

```text
feat: govern contract draft abandonment
```

### Task 4：历史接管和税务修订放弃

**目标：** 安全处理批量接管产生的草稿，并区分税务纯净草稿和已经复核的修订。

**文件：**

- 新增：`services/api/src/contract-takeover/dto/abandon-contract-takeover.dto.ts`
- 新增：`services/api/src/contract-takeover/dto/abandon-contract-takeover-batch.dto.ts`
- 修改：`services/api/src/contract-takeover/contract-takeover.controller.ts`
- 修改：`services/api/src/contract-takeover/contract-takeover.controller.spec.ts`
- 修改：`services/api/src/contract-takeover/contract-takeover.service.ts`
- 修改：`services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- 新增：`services/api/src/contract-tax-facts/dto/abandon-contract-tax-fact-revision.dto.ts`
- 修改：`services/api/src/contract-tax-facts/contract-tax-facts.service.ts`
- 修改：`services/api/src/contract-tax-facts/contract-tax-facts.service.spec.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 单条接管先按 `takeover + generated contract + contract version + payment terms + approval + evidence` 形成锁定快照。
2. 从未提交单条可标记 `abandoned`，并同步关闭仅由该接管生成的草稿合同版本和条款；发现正式引用即失败关闭。
3. 批次先提供 preview，返回每行分类、阻断原因、稳定 hash 和计数；apply 必须带原 hash，在 Serializable 事务中逐行重算，任何差异停止整个批次，不做部分静默成功。
4. 接管批次本身保留为导入收据，不删除 fingerprint、行数和结果。
5. 税务修订从未送财务时可以放弃；已送财务或合同确认时保留完整复核历史，确认完成后禁止放弃。
6. 放弃税务修订不得更新 `ContractVersion` 当前税务事实、清单行或冻结税率。
7. 覆盖重复批次、已确认接管、待补充、有附件、责任人停用、税务复核并发和非授权岗位测试。
8. 运行：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.controller.spec.ts src/contract-takeover/contract-takeover.service.spec.ts src/contract-tax-facts/contract-tax-facts.service.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api check:business-errors
git diff --check
```

9. 更新 `PROGRESS.md` 并提交：

```text
feat: govern takeover and tax revision drafts
```

### Task 5：结算草稿放弃与唯一性释放

**目标：** 让无效结算草稿退出活跃业务判断，同时永久保留乙方签署和已发生审批证据。

**文件：**

- 新增：`services/api/src/settlement/dto/abandon-settlement-draft.dto.ts`
- 修改：`services/api/src/settlement/settlement-draft.controller.ts`
- 修改：`services/api/src/settlement/settlement-draft.service.ts`
- 修改：`services/api/src/settlement/settlement-draft.service.spec.ts`
- 修改：`services/api/src/settlement/settlement-submission.service.ts`
- 修改：`services/api/src/settlement/settlement-submission.service.spec.ts`
- 修改：`services/api/src/settlement/settlement.service.ts`
- 修改：`services/api/src/settlement/settlement.service.spec.ts`
- 修改：`services/api/src/settlement/settlement-read.service.ts`
- 修改：`services/api/src/settlement/settlement-read.service.spec.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 先写测试区分无签署纯净草稿、已经生成冻结完整结算单、上传乙方签字 PDF、已经提交为正式 `Settlement` 四种情况。
2. 纯净草稿由当前 owner 标记 `abandoned`；有签署或提交事实时使用审批型放弃并要求原因，文件记录保留。
3. 终止未完成的 `SettlementSignedDocumentGenerationClaim`，活动文件绑定标记失效，不删除文件对象。
4. 所有最终结算和提交准备查询只统计活跃 `draft`，显式排除 `abandoned` 与已提交草稿。
5. 已创建 `Settlement` 的草稿只读保留 `submittedSettlementId`，正式结算继续使用原撤回/作废状态机。
6. 覆盖同一最终结算重新创建、提交/放弃并发、签署文件页数、责任人和非授权访问测试。
7. 运行：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/settlement/settlement-draft.service.spec.ts src/settlement/settlement-submission.service.spec.ts src/settlement/settlement.service.spec.ts src/settlement/settlement-read.service.spec.ts src/settlement/settlement-draft-document-facts.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api check:business-errors
git diff --check
```

8. 更新 `PROGRESS.md` 并提交：

```text
feat: govern settlement draft abandonment
```

### Task 6：M71 普通付款与零星采购生命周期

**目标：** 为付款退回草稿、零星采购父流程、自动付款草稿和收货草稿增加可追溯终止事实及来源链。

**文件：**

- 修改：`services/api/prisma/schema.prisma`
- 新增：`services/api/prisma/migrations/20260719211000_payment_spot_draft_lifecycle/migration.sql`
- 新增：`services/api/src/database/draft-lifecycle-spot-schema-verification.spec.ts`
- 修改：`PROGRESS.md`

**Schema 变化：**

- `PaymentRequest` 增加 `abandonedAt`、`abandonedByUserId`、`abandonReason`，状态允许 `abandoned`。
- `SpotProcurement` 和 `SpotProcurementVersion` 增加放弃时间、操作者和原因，状态允许领域 `abandoned`。
- `SpotProcurementPayment` 保留现有 `invalidated*` 字段，新增可空 `draftOrigin` 和可空自引用 `sourcePaymentId`，索引来源链；既有数据不伪造来源。
- `SpotProcurementReceipt` 增加 `invalidatedAt`、`invalidatedByUserId`、`invalidationReason`，状态允许 `invalidated`。
- 不修改实际付款、退款、余额、凭证和资金账本结构。

**步骤：**

1. 先写迁移和 Prisma 失败测试，固定可空历史兼容、来源外键 `ON DELETE RESTRICT`、状态约束和必要索引。
2. 手写前向迁移，不回填虚假的 `draftOrigin`；旧记录在读取模型中显示 `legacy_unknown`，但不能据此获得删除权限。
3. 确认迁移不触碰 `PaymentExecution`、供应商余额流水、项目资金使用和文件对象表。
4. 运行 Prisma format/validate/generate、Schema 定向测试和 `git diff --check`。
5. 更新 `PROGRESS.md` 并提交：

```text
feat: add payment and spot draft lifecycle schema
```

### Task 7：普通付款、报销和旧项目支出语义

**目标：** 普通付款只允许放弃审批型退回草稿；项目支出保持“提交即审批”，不伪造后端草稿。

**文件：**

- 新增：`services/api/src/payment/dto/abandon-payment-request.dto.ts`
- 修改：`services/api/src/payment/payment.controller.ts`
- 修改：`services/api/src/payment/payment-request.service.ts`
- 修改：`services/api/src/payment/payment-request.service.spec.ts`
- 修改：`services/api/src/payment/payment-read.service.ts`
- 修改：`services/api/src/payment/payment-read.service.spec.ts`
- 修改：`services/api/src/project-expense/project-expense.service.spec.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 测试固定普通付款创建仍直接进入审批，不新增普通付款持久化草稿创建 API。
2. 只有当前为退回待修改、存在审批历史且由当前申请人负责的付款，才允许“放弃付款申请”。
3. 放弃时锁定付款、审批实例、额度使用和执行事实；再次确认没有实付、凭证、入账或待执行正式事实。
4. 若退回时已释放额度，放弃只验证为已释放，不能再次扣减；若领域存在合法残余占用，在同一事务恰好释放一次。
5. 付款读取把 `draft` 且有退回历史投影为 `returned_for_revision`，不计入审批中；`abandoned` 进入已结束。
6. 项目支出保持现有撤回、驳回、作废和实付阻断；本 Task 只增加回归测试，不修改其生产服务，也不新增删除接口。
7. 覆盖已批待付、部分实付、已实付、已入账、非申请人和重复放弃测试。
8. 运行：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/payment/payment-request.service.spec.ts src/payment/payment-read.service.spec.ts src/project-expense/project-expense.service.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api check:business-errors
git diff --check
```

9. 更新 `PROGRESS.md` 并提交：

```text
feat: govern payment and expense termination semantics
```

### Task 8：零星采购父流程放弃与安全级联

**目标：** 允许清理纯净采购草稿，并阻止父记录越过正式付款、收货、退款或差异事实。

**文件：**

- 新增：`services/api/src/spot-procurement/dto/abandon-spot-procurement-draft.dto.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement.controller.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement.controller.spec.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-application.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-application.service.spec.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-closure.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-closure.service.spec.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-read.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-read.service.spec.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 先写纯净草稿、曾提交采购、已审批、付款审批中、已实付、收货已提交、退款/差异中和已办结测试。
2. 当前经办人可标记从未提交的采购根和版本 `abandoned`；曾提交记录必须走放弃申请或既有作废/异常终止。
3. 父流程只级联关闭 `draft` 的付款和从未提交的收货；存在审批、实付、有效收货、退款、差异或归档即失败关闭。
4. 级联时释放子付款预留，失效子草稿文件绑定，关闭待办/提醒，但不删除审批、文件或流水。
5. 把现有 `voidProcurement` 补齐对子付款和收货事实的检查；不能因本计划放宽现有作废角色。
6. 读取模型返回准确动作、阻断原因和下游摘要；正式采购台账默认排除 `abandoned`。
7. 覆盖提交/放弃、付款创建/父放弃、收货提交/父放弃三组并发测试。
8. 运行定向零星采购 Jest、API typecheck/lint/business-errors 和 `git diff --check`。
9. 更新 `PROGRESS.md` 并提交：

```text
feat: govern spot procurement abandonment
```

### Task 9：零星采购付款放弃与重新创建

**目标：** 自动 A5 草稿可以结束且不堵塞采购，经办人能够创建新的有效付款草稿，原来源链永久可查。

**文件：**

- 新增：`services/api/src/spot-procurement/dto/abandon-spot-procurement-payment-draft.dto.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement.controller.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-payment.controller.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-payment.service.spec.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-read.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-read.service.spec.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 保留并回归 `797a8920` 对现有自动 A5 草稿的识别和“填写付款申请”入口。
2. 当前经办人可以放弃尚未提交的付款草稿；服务把草稿标记 `invalidated`，写入原因和来源，不物理删除。
3. 同事务释放供应商余额预留和公司付款占用；不存在预留时保持幂等，不创建负数或重复释放。
4. 在采购 Controller 接入既有 `createNextDraft` 能力，只有采购已审批、当前版本有效且不存在活跃付款草稿/申请时才能重新创建。
5. 新草稿设置 `draftOrigin=manual_recreate` 和 `sourcePaymentId`；撤回/退回复制分别保存对应来源类型。
6. 读取模型只有在确实不存在活跃付款、采购仍允许付款时返回 `create_payment_draft`，不能继续硬编码 `canCreatePayment=false`。
7. 覆盖并发重复创建、放弃/提交并发、放弃/实付并发、来源链、附件绑定和非经办人测试。
8. 运行定向付款服务、读取服务、Controller、零星采购并发测试和 API 门禁。
9. 更新 `PROGRESS.md` 并提交：

```text
feat: allow safe recreation of spot payment drafts
```

### Task 10：收货草稿重置与父流程关闭

**目标：** 保持收货是采购子流程，不制造可随意删除的独立业务记录，同时允许经办人清理未提交填写。

**文件：**

- 新增：`services/api/src/spot-procurement/dto/reset-spot-procurement-receipt.dto.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-receipt.controller.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-receipt.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-receipt.service.spec.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-read.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-read.service.spec.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 先写测试：从未提交收货可以重置；已提交、已复核、已退回形成新修订、存在差异、补货、退款或办结时不能重置。
2. “重置收货草稿”只创建或回到干净的当前内部修订，旧修订和历史照片绑定按既有证据规则保留或失效，不删除根收货单。
3. 单张未提交照片继续使用现有删除绑定能力；已锁定、水印、提交或被 PDF 引用的照片不能删除。
4. 父采购安全放弃时，未提交收货标记 `invalidated` 并关闭委托和待办；已提交收货阻断父放弃。
5. 读取模型明确区分“填写收货”“重置未提交收货”“等待付款”“待主管复核”和只读历史。
6. 覆盖委托人、原经办人、当前经办人、物资主管、照片竞争和提交/重置并发测试。
7. 运行：

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/spot-procurement/spot-procurement-receipt.service.spec.ts src/spot-procurement/spot-procurement-read.service.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api check:business-errors
git diff --check
```

8. 更新 `PROGRESS.md` 并提交：

```text
feat: govern spot receipt draft reset
```

### Task 11：M72 模板草稿版本生命周期

**目标：** 为合同业务模板、版式、标准条款和结算模板增加废弃草稿版本事实，不影响发布快照。

**文件：**

- 修改：`services/api/prisma/schema.prisma`
- 新增：`services/api/prisma/migrations/20260719212000_template_draft_lifecycle/migration.sql`
- 新增：`services/api/src/database/draft-lifecycle-template-schema-verification.spec.ts`
- 修改：`PROGRESS.md`

**Schema 变化：**

- `ContractBusinessTemplateVersion`、`ContractLayoutTemplateVersion`、`StandardClauseVersion`、`SettlementTemplateVersion` 增加 `discardedAt`、`discardedByUserId`、`discardReason`。
- 四类版本状态允许 `discarded`，增加状态与更新时间索引。
- `ContractBusinessTemplate` 可使用现有 `status=discarded` 表示从未发布的根模板被废弃；其他三类根记录不新增通用状态，是否出现在列表由活跃版本存在性决定。
- 不回填、不改变任何 `submitted`、`published`、`stopped`、`revoked` 或正式引用版本。

**步骤：**

1. 先写 Schema 和迁移测试，固定可空历史兼容、状态约束、索引和零业务 DML。
2. 对照最新主线检查各模板根/版本关系和正式引用表，禁止把根记录物理删除。
3. 运行 Prisma format/validate/generate、定向数据库测试和 `git diff --check`。
4. 更新 `PROGRESS.md` 并提交：

```text
feat: add template draft lifecycle schema
```

### Task 12：模板草稿版本废弃 API 与服务

**目标：** 模板维护人可以清理从未提交版本，已提交、发布和引用版本永久受保护。

**文件：**

- 新增：`services/api/src/contract-template/dto/discard-template-version.dto.ts`
- 修改：`services/api/src/contract-template/contract-template.controller.ts`
- 修改：`services/api/src/contract-template/contract-template.controller.spec.ts`
- 修改：`services/api/src/contract-template/contract-template.service.ts`
- 修改：`services/api/src/contract-template/contract-template.service.spec.ts`
- 修改：`services/api/src/contract-template/layout-template.service.ts`
- 修改：`services/api/src/contract-template/layout-template.service.spec.ts`
- 新增：`services/api/src/settlement/dto/discard-settlement-template-version.dto.ts`
- 修改：`services/api/src/settlement/settlement-template.controller.ts`
- 修改：`services/api/src/settlement/settlement-template.controller.spec.ts`
- 修改：`services/api/src/settlement/settlement-template.service.ts`
- 修改：`services/api/src/settlement/settlement-template.service.spec.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 为业务模板、版式、条款和结算模板分别写纯净版本、已提交、已发布、已停用、已撤销和已引用测试。
2. 只允许既有模板维护角色废弃 `draft` 且从未提交的版本；当前密码要求保持领域原规则，不额外扩大。
3. 废弃前锁定版本、根模板、场景映射、合同/结算引用、预览任务和文件绑定；任何正式引用失败关闭。
4. 预览任务标记取消或过期，草稿预览文件绑定失效；源 DOCX/XLSX 已进入发布或下载证据时保留。
5. 只有根模板从未有提交/发布版本且没有映射时，才把业务模板根标记 `discarded`；其他根根据剩余版本继续展示。
6. 列表默认不显示已废弃版本，历史筛选可读；克隆不得选择 `discarded` 为生产来源。
7. 覆盖提交/废弃、发布/废弃、预览完成/废弃并发和重复请求测试。
8. 运行合同模板、版式和结算模板定向 Jest、API typecheck/lint/business-errors 和 `git diff --check`。
9. 更新 `PROGRESS.md` 并提交：

```text
feat: govern template draft version disposal
```

### Task 13：Web 公共草稿动作与未保存保护

**目标：** 统一用户动作、二次确认和离开保护，但不把领域判定搬到前端。

**文件：**

- 新增：`apps/web-admin/src/components/BusinessDraftAction.vue`
- 新增：`apps/web-admin/src/components/business-draft-action.config.ts`
- 新增：`apps/web-admin/src/components/business-draft-action.config.test.ts`
- 新增：`apps/web-admin/src/lib/use-unsaved-changes-guard.ts`
- 新增：`apps/web-admin/src/lib/use-unsaved-changes-guard.test.ts`
- 修改：`apps/web-admin/src/components/SensitiveActionDialog.vue`，仅在现有能力确有缺口时做兼容扩展
- 修改：`apps/web-admin/src/components/sensitive-action-dialog.config.ts`
- 修改：`apps/web-admin/src/components/sensitive-action-dialog.config.test.ts`
- 修改：`apps/web-admin/scripts/check-ui-rules.mjs`
- 修改：`PROGRESS.md`

**步骤：**

1. 先写配置测试，固定“放弃填写、删除草稿、放弃申请、撤回、作废、异常终止、废弃版本”的中文文案、危险级别和原因要求。
2. `BusinessDraftAction` 只消费服务端 `availableActions` 和 `blockedReason`，不根据状态自行创造权限或动作。
3. 删除纯净草稿显示业务编号、名称、最后保存时间和影响范围；放弃审批型申请强制原因并说明历史仍保留。
4. 未保存 guard 同时覆盖 Vue Router 离开、浏览器刷新/关闭和组件内 Drawer/Dialog 关闭；保存成功后才清除 dirty 状态。
5. 禁止原生 `confirm`/`prompt`，新增 UI 检查规则覆盖本轮页面；不添加动画、渐变或装饰性阴影。
6. 运行：

```bash
pnpm --filter @jiangkong/web-admin test -- src/components/business-draft-action.config.test.ts src/components/sensitive-action-dialog.config.test.ts src/lib/use-unsaved-changes-guard.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git diff --check
```

7. 更新 `PROGRESS.md` 并提交：

```text
feat(web): add governed draft actions
```

### Task 14：合同、接管、税务修订和结算 Web 闭环

**目标：** 在核心工作台呈现服务端真实生命周期，清理草稿但不改变合同和结算业务编辑方式。

**文件：**

- 修改：`apps/web-admin/src/api/contract-workbench.api.ts`
- 修改：`apps/web-admin/src/api/contract-workbench.api.test.ts`
- 修改：`apps/web-admin/src/api/contract-tax-facts.api.ts`
- 修改：`apps/web-admin/src/api/contract-tax-facts.api.test.ts`
- 修改：`apps/web-admin/src/api/settlement-drafts.api.ts`
- 修改：`apps/web-admin/src/api/settlement-drafts.api.test.ts`
- 修改：`apps/web-admin/src/pages/contracts/ContractListPage.vue`
- 修改：`apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- 修改：`apps/web-admin/src/pages/contracts/ContractDetailPage.vue`
- 修改：`apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- 修改：`apps/web-admin/src/pages/contracts/contract-takeover.config.ts`
- 修改：`apps/web-admin/src/pages/contracts/contract-takeover.config.test.ts`
- 修改：`apps/web-admin/src/pages/contracts/contract-tax-fact-review.state.ts`
- 修改：`apps/web-admin/src/pages/contracts/contract-tax-fact-review.state.test.ts`
- 修改：`apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- 修改：`apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`
- 修改：`apps/web-admin/src/pages/settlements/SettlementListPage.vue`
- 修改：`apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue`
- 修改：`apps/web-admin/src/pages/settlements/SettlementDetailPage.vue`
- 修改：`PROGRESS.md`

**步骤：**

1. API 客户端显式调用各领域动作接口，保留服务端错误，不把失败转换成前端成功。
2. 合同和结算台账增加“正式台账、我的草稿、退回待修改、已结束”视图，使用服务端分页和统计。
3. 合同工作台未保存离开使用共享 guard；服务端返回纯净动作时显示“删除草稿”，变更或审批型草稿显示“放弃合同申请/变更”。
4. 接管页面支持单条安全放弃和批次 preview/apply；apply 前展示分类数量、阻断行和稳定 hash，禁止直接全选删除。
5. 税务修订草稿在财务复核前可删除，送审后只显示放弃；已确认只读。
6. 结算工作台区分无签署纯净草稿和已有乙方签字证据的审批型草稿，后者明确说明文件仍保留。
7. 删除或放弃成功后分别刷新列表、统计、当前详情和首页工作项；提交失败保留输入。
8. 运行所有涉及的 API Vitest、页面状态测试、Web typecheck/lint/check:ui 和 `git diff --check`。
9. 更新 `PROGRESS.md` 并提交：

```text
feat(web): complete contract settlement draft governance
```

### Task 15：普通付款、报销和项目支出 Web 语义

**目标：** 普通付款和项目支出不伪造持久化草稿，员工能够放弃填写或结束退回申请。

**文件：**

- 修改：`apps/web-admin/src/api/core-flow-read.api.ts`
- 修改：`apps/web-admin/src/api/core-flow-read.api.test.ts`
- 修改：`apps/web-admin/src/pages/payments/PaymentListPage.vue`
- 修改：`apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue`
- 修改：`apps/web-admin/src/pages/payments/PaymentDetailPage.vue`
- 修改：`apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue`
- 修改：`apps/web-admin/src/pages/projects/ProjectExpenseApprovalDetailPage.vue`
- 修改：`apps/web-admin/src/pages/projects/project-expense.config.ts`
- 修改：`apps/web-admin/src/pages/projects/project-expense.config.test.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 付款工作台未提交内容使用“放弃填写”和未保存 guard，不调用新增后端草稿接口。
2. 付款详情只有服务端返回审批型退回动作时显示“放弃付款申请”；审批中仍显示撤回，正式付款仍使用既有敏感动作。
3. 付款列表和摘要把退回待修改、已放弃、审批中、已批待付和已实付分开，不以 `0` 或通用草稿掩盖状态。
4. 项目经营页的报销和旧项目支出表单关闭时保留明确提醒；提交成功即进入审批，不出现“删除草稿”。
5. 已撤回、驳回和作废项目支出进入已结束筛选，已实付不显示任何删除/普通作废按钮。
6. 覆盖提交失败保留输入、无权限、loading、disabled、返回导航和窄窗口测试。
7. 运行付款 API/Web 定向测试、项目支出配置测试、Web typecheck/lint/check:ui 和 `git diff --check`。
8. 更新 `PROGRESS.md` 并提交：

```text
feat(web): align payment and expense draft semantics
```

### Task 16：零星采购、模板、首页和台账收口

**目标：** 完成自动子草稿、模板版本和全局工作项的展示闭环，并保持主线最新 UI 紧凑布局。

**文件：**

- 修改：`apps/web-admin/src/api/spot-procurement.api.ts`
- 修改：`apps/web-admin/src/api/spot-procurement.api.test.ts`
- 修改：`apps/web-admin/src/api/settlement-template.api.ts`
- 修改：`apps/web-admin/src/api/settlement-template.api.test.ts`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentWorkbenchPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptWorkbenchPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- 修改：`apps/web-admin/src/pages/contract-templates/ContractTemplateListPage.vue`
- 修改：`apps/web-admin/src/pages/contract-templates/ContractTemplateEditorPage.vue`
- 修改：`apps/web-admin/src/pages/contract-templates/LayoutTemplateEditorPage.vue`
- 修改：`apps/web-admin/src/pages/contract-templates/StandardClauseLibraryPage.vue`
- 修改：`apps/web-admin/src/pages/settlement-templates/SettlementTemplateListPage.vue`
- 修改：`apps/web-admin/src/pages/settlement-templates/SettlementTemplateEditorPage.vue`
- 修改：`apps/web-admin/src/pages/home/HomePage.vue`
- 修改：`apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 在 `f7415a89` 的紧凑台账布局上增量修改，不恢复旧宽表和卡片堆叠。
2. 采购纯净草稿显示删除；曾提交显示放弃；有实付或收货事实只显示异常终止等服务端合法动作。
3. 自动 A5 草稿显示“放弃付款草稿”；放弃后采购详情显示唯一“重新创建付款申请”，创建后回到现有“填写付款申请”。
4. 收货页面只显示“重置未提交收货”，不显示删除收货单；已提交后只显示现有复核和修订动作。
5. 四类模板页面显示“废弃草稿版本”，已提交、发布、停用、撤销或引用版本不显示按钮并说明原因。
6. 首页保留“待我处理、阻塞事项、我发起的进行中”；草稿作为独立筛选，不计入待审批，已放弃不进入活动工作项。
7. 确保各页面只有一个主动作，操作列不超过三个，更多动作进入菜单；金额仍右对齐，窄窗口只由表格区域滚动。
8. 运行 Web API、页面、结构、响应式和 E2E 定向测试，以及 typecheck/lint/check:ui。
9. 更新 `PROGRESS.md` 并提交：

```text
feat(web): complete draft lifecycle workbenches
```

### Task 17：全量回归、隔离迁移、只读盘点和真实 UAT

**目标：** 证明新生命周期不会改写正式事实，并形成只待发布批准的证据包。

**文件：**

- 新增：`services/api/prisma/verify-draft-lifecycle.cjs`
- 新增：`services/api/src/database/draft-lifecycle-live-verification.spec.ts`
- 新增：`apps/web-admin/e2e/draft-lifecycle-governance.e2e.ts`
- 新增：`DRAFT_LIFECYCLE_IMPLEMENTATION_REPORT.md`
- 新增：`docs/progress/2026-07-19-draft-lifecycle-governance.md`
- 修改：`PROGRESS.md`

**自动场景至少覆盖：**

1. 新合同纯净草稿删除，正式台账和统计不再显示。
2. 合同提交后撤回只能放弃申请，审批和文件历史仍可读。
3. 合同变更放弃不影响原有效合同和累计金额。
4. 接管批次 preview/apply 不产生幽灵合同，批次收据保留。
5. 税务修订放弃不改变生效税务事实。
6. 结算草稿放弃释放最终结算阻断；乙方签署 PDF 仍可审计。
7. 普通付款退回后放弃，额度不重复释放。
8. 报销关闭未提交表单不产生记录；正式项目支出只能撤回或作废。
9. 零星采购纯净草稿安全级联未提交付款和收货。
10. 父采购存在审批付款、实付、有效收货、退款或差异时删除失败关闭。
11. A5 草稿放弃后重新创建，来源链正确且只有一个活跃草稿。
12. 收货重置不删除根单、旧修订和锁定照片证据。
13. 模板草稿版本可废弃，已发布和已引用版本拒绝。
14. 并发提交/放弃、创建/放弃和发布/废弃只能有一个成功。
15. 已放弃记录只在已结束筛选可见，正式统计、待审批和首页工作项口径一致。

**迁移和数据验证：**

1. 从空 PostgreSQL 16 顺序应用全部 72 个迁移，运行 Prisma migrate status 和约束验证。
2. 使用本地合成数据覆盖 A/B/C/D 四类，不连接生产。
3. 获得生产只读授权后运行 `inspect:draft-lifecycle-readiness`，只生成聚合清单，不执行治理。
4. 获得生产备份使用授权后，在隔离恢复库从 69 迁移到 72，运行 `verify-draft-lifecycle.cjs`；不得连接生产业务库执行写验证。
5. 核对正式合同、结算、付款、实付、收货、退款、文件和审计计数前后一致。

**完整门禁：**

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test
pnpm --filter @jiangkong/web-admin test
pnpm --filter @jiangkong/shared-domain typecheck
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/shared-domain lint
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin build
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin typecheck:e2e
pnpm --filter @jiangkong/web-admin test:e2e:p0
git diff --check
```

浏览器至少验证 1512×982、1440×900、1280×800、1180×820、1024×768、900×768；截图覆盖合同、结算、付款、零星采购/付款/收货和模板的纯净草稿、审批型草稿、阻断、已结束、加载、失败与禁用状态中可稳定复现的部分。

由真实岗位人员本人完成核心 UAT，不代登录、不伪造审批、不直接写库。更新实施报告、进度文档和 `PROGRESS.md`，提交：

```text
test: verify draft lifecycle governance
```

### Task 18：发布候选与生产授权门禁

**目标：** 完成发布候选审计并停止；只有用户批准精确 SHA 后才能推送、迁移和部署。

**文件：**

- 新增：`DRAFT_LIFECYCLE_RELEASE_READINESS.md`
- 修改：`DRAFT_LIFECYCLE_IMPLEMENTATION_REPORT.md`
- 修改：`docs/progress/2026-07-19-draft-lifecycle-governance.md`
- 修改：`PROGRESS.md`
- 必要时修改现有生产就绪验证脚本，但不得弱化任何门禁

**阶段 A：候选审计，不触碰生产**

1. 核对分支、HEAD、相对 `main` 提交、迁移列表、工作区、worktree 和计划外文件。
2. 审查所有 diff，确认没有 HTTP `DELETE` 业务根接口、硬删除、审批/金额/权限漂移和文件对象删除。
3. 汇总全部测试、72 个迁移、空库/隔离库、浏览器和 UAT 证据。
4. 输出精确目标 SHA、数据库变化、存量盘点摘要、回滚原则、未解决问题和受保护业务事实检查。
5. 停止并等待用户明确批准目标 SHA；不得自行推送、部署或执行生产迁移。

**阶段 B：只有获授权后才能执行**

1. 推送候选分支并按仓库主线策略快进或合并 `main`。
2. 执行发布前本地和异机数据库备份，验证 checksum、COS 收据和可恢复性。
3. 在生产备份隔离库精确应用 M70–M72，重复运行全部不变量验证。
4. 再次输出生产只读草稿盘点；不自动放弃任何现有草稿。
5. 部署 Web/API，执行生产迁移，核对运行 SHA、72 个迁移、API/Nginx/PostgreSQL/Cron、内外健康检查、COS 私有下载和审计。
6. 用真实账号验证新建纯净草稿、删除草稿和已提交阻断的最小链路；不批量清理历史。

**回滚原则：**

- M70–M72 只增加可空列、状态和索引，不使用破坏性 down migration。
- 应用回滚到旧 SHA 前必须确认旧代码遇到新状态时不会错误开放动作；若不兼容，先保持新代码并关闭新动作入口。
- 已产生的 `abandoned`、`invalidated`、`discarded` 和审计事实保留，不回写为原状态。
- 生产存量批量治理是独立授权动作，不与代码发布捆绑。

最终提交：

```text
docs: prepare draft lifecycle release candidate
```

---

## 4. 计划自检矩阵

| 已批准规格 | 落地 Task |
| --- | --- |
| 五级生命周期与四类台账视图 | 1、13–17 |
| 新合同纯净草稿删除、审批型放弃 | 2、3、14、17 |
| 合同变更只放弃派生版本 | 2、3、14、17 |
| 接管单条/批次安全放弃、保留导入收据 | 2、4、14、17 |
| 税务修订不改生效税务事实 | 2、4、14、17 |
| 结算放弃释放最终结算阻断并保留签署证据 | 2、5、14、17 |
| 普通付款没有新持久化草稿、退回后可放弃 | 6、7、15、17 |
| 报销和旧项目支出只放弃填写/撤回/作废 | 7、15、17 |
| 零星采购父子安全级联 | 6、8、10、16、17 |
| 自动 A5 草稿放弃和重新创建 | 6、9、16、17 |
| 收货只重置，不删除根单 | 6、10、16、17 |
| 模板草稿版本废弃、正式引用保护 | 11、12、16、17 |
| 用印、归档、授权书和附件不物理删除 | 3–5、8–12、17 |
| 当前责任人、转交、主管和 super_admin 边界 | 3–5、7–10、12、17 |
| 额度、余额和唯一性恰好释放一次 | 5、7–10、17 |
| 长期草稿不自动删除、存量先只读盘点 | 1、17、18 |
| 主线 A5 入口和紧凑 UI 不回退 | 0、9、16、17 |
| 精确 SHA、备份、迁移、部署授权门禁 | 18 |

## 5. 完成定义

只有以下条件全部满足，才能宣称草稿生命周期治理完成：

- Task 0–17 的代码、三次前向迁移、定向测试、全量测试、并发、迁移、浏览器和真实岗位 UAT 全部完成。
- 正式台账、我的草稿、退回待修改和已结束在 API、页面、分页、统计和首页工作项中口径一致。
- 所有目标业务记录均通过状态转换终止，没有物理删除审批、文件、金额、归档或执行事实。
- 普通付款、项目支出和零星采购的额度、资金池、余额预留和唯一性占用恰好释放一次。
- 自动生成的付款草稿可重建，收货草稿可重置，且父子流程不会产生孤立记录。
- 空库 72 个迁移通过；获授权后生产备份隔离恢复 69→72 通过且正式事实计数一致。
- 实施报告、发布准备、`PROGRESS.md`、目标 SHA、测试数字和生产证据一致。
- 用户明确批准精确候选 SHA 后完成推送、部署和生产验证；生产存量草稿仍须单独授权治理。

只完成按钮、只隐藏列表、只增加状态、只完成本地测试、只部署但未 UAT，或没有证明金额/文件/审批事实不受损，均不能把本计划标记完成。
