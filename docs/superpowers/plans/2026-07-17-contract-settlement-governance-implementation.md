# 建工智管合同、结算与我方主体统一治理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留第 52 个税务计价迁移、既有付款实付与历史业务事实的前提下，落地我方公司主体版本、五类合同审批、签前 PDF 与授权书、同意用章和双文件归档、统一合同变更与 10% 硬门禁、两类结算审批及逐页冻结签名，并形成只待用户批准的发布候选。

**Architecture:** 继续使用现有 Vue 3 + TDesign Web、NestJS + Prisma + PostgreSQL 单体架构，不引入第二套 UI、通用工作流引擎或电子签章平台。主数据使用不可覆盖版本，合同/结算提交时冻结主体、审批人员、文件、税价和签名事实；新规则只作用于新提交实例，旧审批实例和历史增强变更保持只读兼容。

**Tech Stack:** Vue 3、TypeScript、TDesign Vue Next、Vite、NestJS、Prisma 5、PostgreSQL 16、PDFKit、pdf-lib、ExcelJS、Jest、Vitest、Playwright、腾讯 COS 私有文件链路。

---

## 0. 执行基线、边界和成功标准

本计划依据已批准规格：

- `docs/superpowers/specs/2026-07-17-contract-settlement-governance-design.md`
- `docs/superpowers/specs/2026-07-16-contract-tax-facts-and-pricing-design.md`

计划编写时事实：

- 分支：`codex/contract-tax-facts-pricing`
- HEAD：`9939251ae82ba9dc076b0ff4cd19d0a3248bdad1`
- `origin/main`：`48b5ec3fc91efd9f73cfa7a5eb6d4cde48e6c096`
- 当前分支相对 `origin/main` 领先 24 个提交，工作区洁净。
- 生产 Web/API 仍运行 `b857a4269aa907e0550470cece52c846bcbb7623`；生产数据库为 51 个完成迁移。
- 当前分支已有 52 个迁移，第 52 个是 `20260716160000_contract_tax_facts_and_settlement_drafts`，尚未部署生产。
- 本计划只授权本地实现、测试和形成发布候选；不授权推送 `main`、部署、生产迁移、终止生产实例或写生产业务数据。

### 不可变基线

1. 不得编辑第 52 个迁移 SQL；后续增量从 M53 开始。
2. 不重复创建 `ContractTaxFactRevision`、`SettlementDraft` 或税价快照字段。
3. 不改变付款审批、实付登记、凭证上传、财务入账、元分转换和后端额度事实。
4. 不追溯改写已生效合同、结算、付款、审批日志或历史增强变更。
5. 不使用 OCR、电子签章、通用流程设计器或第二套 UI 组件库。
6. 已签 PDF 保留原字节；只能只读检查页数和尺寸，不得通过 normalize 重写后再把重写文件冒充原件。

### 最终成功标准

1. 五类合同在提交时冻结正确路线和具体候选人员，发起人不能审批自己，合同部主管发起时跳过主管节点。
2. 合同提交前具备与草稿修订一致的乙方签章完整 PDF；双方授权书选择与文件形成版本级事实。
3. 内部审批完成后生成《合同审批单》，同意用章、线下盖章、最终文件上传和合同部确认四个事实分离。
4. 新合同变更只有一条路线；历史有效正增项累计正好 10% 可提交，严格大于 10% 阻断并要求新签。
5. 通用合同不能创建结算；其他四类合同的累计结算不能突破当前有效合同上限，项目例外额度不能绕过。
6. 两类结算均在乙方签章扫描件上传后提交，冻结具体现场复核人；最终合成件逐页使用提交人和审批发生时签名。
7. 公司主体维护只接受公司级全局岗位，严格校验信用代码，保留不可覆盖历史；合同提交冻结主体版本。
8. 财务、综合部跨域只读/导出保持当前范围，任何写动作、附件越权和公司主体导出均为负向拒绝。

## 1. 文件责任图

### 1.1 新增共享域与 API 文件

- `packages/shared-domain/src/company-entity.ts`：公司主体岗位常量、资料状态和前端共享类型。
- `packages/shared-domain/src/company-entity.test.ts`：角色集合和状态标签测试。
- `services/api/src/company-entity/unified-social-credit-code.ts`：18 位统一社会信用代码规范化和校验位算法。
- `services/api/src/company-entity/unified-social-credit-code.spec.ts`：格式、字符、校验位和大小写测试。
- `services/api/src/company-entity/company-entity-access.ts`：仅公司级全局岗位的读写判定。
- `services/api/src/company-entity/company-entity-access.spec.ts`：项目岗位、`super_admin` 和未授权岗位负向测试。
- `services/api/src/company-entity/dto/company-entity.dto.ts`：创建、修改和状态更新 DTO。
- `services/api/src/database/company-entity-governance-schema-verification.spec.ts`：M53 结构和历史兼容验证。
- `services/api/src/contract/contract-approval-route.service.ts`：五类新合同、统一变更的人员解析与冻结。
- `services/api/src/contract/contract-approval-route.service.spec.ts`：分类路线、主管跳过、项目总工冲突和发起人排除测试。
- `services/api/src/approval/approval-signature-snapshot.ts`：审批动作发生时冻结岗位、签名文件 ID 和 SHA-256。
- `services/api/src/approval/approval-signature-snapshot.spec.ts`：无签名、委托/转交和历史兼容测试。
- `services/api/src/database/approval-signature-snapshot-schema-verification.spec.ts`：M54 列和可空历史验证。
- `services/api/src/contract/contract-formal-pdf-inspector.ts`：只读检查 PDF 页数、页面方向和异常旋转。
- `services/api/src/contract/contract-formal-pdf-inspector.spec.ts`：原始 hash 不变、空文件和破损 PDF 测试。
- `services/api/src/contract/contract-formal-file.service.ts`：审批版、最终签署版上传、失效和证据读取。
- `services/api/src/contract/contract-formal-file.service.spec.ts`：修订一致性、双版本和职责分离测试。
- `services/api/src/contract/contract-authorization.service.ts`：双方授权选择、上传和复用链接。
- `services/api/src/contract/contract-authorization.service.spec.ts`：四种组合与复用边界测试。
- `services/api/src/contract/contract-seal.service.ts`：自动用章任务、“同意用章”和线下完成状态。
- `services/api/src/contract/contract-seal.service.spec.ts`：状态机和权限测试。
- `services/api/src/database/contract-governance-files-schema-verification.spec.ts`：M55 正式文件、授权和用章结构验证。
- `services/api/src/contract/contract-change-limit-policy.ts`：有效正增项汇总和 10% 整数门禁。
- `services/api/src/contract/contract-change-limit-policy.spec.ts`：小于、等于、大于 10%、减项和框架合同测试。
- `services/api/src/settlement/contract-settlement-capacity.ts`：结算占额状态与合同上限纯计算。
- `services/api/src/settlement/contract-settlement-capacity.spec.ts`：占额释放、变更前后提示和无上限测试。
- `services/api/src/settlement/settlement-participant-freeze.ts`：选定物资员/工长与项目总工的校验和冻结。
- `services/api/src/settlement/settlement-participant-freeze.spec.ts`：项目归属、唯一选择和冲突测试。
- `services/api/src/settlement/settlement-signed-document.service.ts`：冻结版生成、乙方原始扫描件和最终合成件。
- `services/api/src/settlement/settlement-signed-document.service.spec.ts`：一页/多页、页数匹配、签名快照和重新生成边界。
- `services/api/scripts/inspect-contract-settlement-governance-readiness.cjs`：只读盘点存量主体、旧流程和迁移前阻断。
- `services/api/src/database/contract-settlement-governance-readiness-script.spec.ts`：脚本静态安全测试。

### 1.2 新增 Web 文件

- `apps/web-admin/src/api/company-entity.api.ts` 与 `.test.ts`：主体列表、历史、新增、修改和状态 API。
- `apps/web-admin/src/pages/company-entities/CompanyEntityListPage.vue`：独立台账页面。
- `apps/web-admin/src/pages/company-entities/company-entity.config.ts` 与 `.test.ts`：权限、筛选和信用代码展示纯逻辑。
- `apps/web-admin/src/pages/company-entities/components/CompanyEntityFormDrawer.vue`：新增/修改抽屉。
- `apps/web-admin/src/pages/company-entities/components/CompanyEntityHistoryDrawer.vue`：不可覆盖历史抽屉。
- `apps/web-admin/src/pages/contracts/workbench/ContractFormalDocumentSection.vue`：审批前正式 PDF 和完整性声明。
- `apps/web-admin/src/pages/contracts/workbench/ContractAuthorizationSection.vue`：双方授权选择、文件和复用来源。
- `apps/web-admin/src/pages/contracts/components/HistoricalCompanyEntityMatchPanel.vue`：历史接管主体匹配和更正。
- `apps/web-admin/src/pages/settlements/components/SettlementApprovalParticipantSelect.vue`：项目现场复核人选择。
- `apps/web-admin/src/pages/settlements/components/SettlementCounterpartySignedPdfPanel.vue`：冻结版下载、乙方扫描件和声明。
- `apps/web-admin/src/pages/settlements/components/SettlementSignatureEvidencePanel.vue`：原始件和最终合成件展示。
- `apps/web-admin/e2e/company-entity-management.e2e.ts`：公司级权限、维护、历史和响应式。
- `apps/web-admin/e2e/contract-governance.e2e.ts`：五类路线、签前文件、授权、用章和归档。
- `apps/web-admin/e2e/settlement-signature-governance.e2e.ts`：两类结算、原始件和逐页合成件。

### 1.3 主要修改文件

- `services/api/prisma/schema.prisma`
- `packages/shared-domain/src/index.ts`
- `packages/shared-domain/src/permissions.ts`
- `packages/shared-domain/src/permissions.test.ts`
- `packages/shared-domain/src/roles.ts`
- `packages/shared-domain/src/roles.test.ts`
- `services/api/src/app.module.ts`
- `services/api/src/company-entity/company-entity.module.ts`
- `services/api/src/company-entity/company-entity.controller.ts`
- `services/api/src/company-entity/company-entity.service.ts`
- `services/api/src/company-entity/company-entity.service.spec.ts`
- `services/api/src/auth/guards/permission.guard.spec.ts`
- `services/api/src/approval/approval.module.ts`
- `services/api/src/approval/approval-node-access.ts`
- `services/api/src/approval/approval-node-access.spec.ts`
- `services/api/src/approval/approval-form.service.ts`
- `services/api/src/approval/approval-form.service.spec.ts`
- `services/api/src/core-flow/approval-timeline-read.ts`
- `services/api/src/contract/dto/create-contract.dto.ts`
- `services/api/src/contract/dto/submit-contract-approval.dto.ts`
- `services/api/src/contract/dto/upload-contract-archive-file.dto.ts`
- `services/api/src/contract/contract.module.ts`
- `services/api/src/contract/contract.controller.ts`
- `services/api/src/contract/contract.controller.spec.ts`
- `services/api/src/contract/contract.service.ts`
- `services/api/src/contract/contract.service.spec.ts`
- `services/api/src/contract/contract-read.service.ts`
- `services/api/src/contract/contract-read.service.spec.ts`
- `services/api/src/contract/contract-change-read-model.ts`
- `services/api/src/contract/contract-change-read-model.spec.ts`
- `services/api/src/contract-workbench/contract-workbench.service.ts`
- `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- `services/api/src/contract-workbench/contract-readiness.service.ts`
- `services/api/src/contract-workbench/contract-readiness.service.spec.ts`
- `services/api/src/contract-takeover/contract-takeover.service.ts`
- `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- `services/api/src/settlement/dto/create-settlement.dto.ts`
- `services/api/src/settlement/dto/settlement-draft.dto.ts`
- `services/api/src/settlement/settlement.module.ts`
- `services/api/src/settlement/settlement.controller.ts`
- `services/api/src/settlement/settlement.controller.spec.ts`
- `services/api/src/settlement/settlement-draft.service.ts`
- `services/api/src/settlement/settlement-draft.service.spec.ts`
- `services/api/src/settlement/settlement-submission.service.ts`
- `services/api/src/settlement/settlement-submission.service.spec.ts`
- `services/api/src/settlement/settlement.service.ts`
- `services/api/src/settlement/settlement.service.spec.ts`
- `services/api/src/settlement/settlement-document-renderer.ts`
- `services/api/src/settlement/settlement-document-renderer.spec.ts`
- `services/api/src/settlement/settlement-read.service.ts`
- `services/api/src/settlement/settlement-read.service.spec.ts`
- `services/api/src/payment/payment-read.service.ts`
- `services/api/src/payment/payment-read.service.spec.ts`
- `services/api/src/payment/payment-request.service.ts`
- `services/api/src/payment/payment-request.service.spec.ts`
- `apps/web-admin/src/routes/route-records.ts`
- `apps/web-admin/src/routes/index.test.ts`
- `apps/web-admin/scripts/check-ui-rules.mjs`
- `apps/web-admin/src/pages/settings/SettingsPage.vue`
- `apps/web-admin/src/api/contract-workbench.api.ts`
- `apps/web-admin/src/api/contract-workbench.api.test.ts`
- `apps/web-admin/src/api/settlement-drafts.api.ts`
- `apps/web-admin/src/api/settlement-drafts.api.test.ts`
- `apps/web-admin/src/api/settlement-workbench.api.ts`
- `apps/web-admin/src/api/settlement-workbench.api.test.ts`
- `apps/web-admin/src/api/core-flow-read.api.ts`
- `apps/web-admin/src/api/core-flow-read.api.test.ts`
- `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`
- `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- `apps/web-admin/src/pages/contracts/contract-change.state.ts`
- `apps/web-admin/src/pages/contracts/contract-change.state.test.ts`
- `apps/web-admin/src/pages/contracts/workbench/ContractBasicSection.vue`
- `apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue`
- `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`
- `apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue`
- `apps/web-admin/src/pages/settlements/SettlementDetailPage.vue`
- `apps/web-admin/src/pages/settlements/settlement-workbench.state.ts`
- `apps/web-admin/src/pages/settlements/settlement-workbench.state.test.ts`
- `apps/web-admin/src/pages/settlements/settlement-detail.config.ts`
- `apps/web-admin/src/pages/settlements/settlement-detail.config.test.ts`

## 2. 提交和代理边界

每个任务使用一个新 subagent 编码；同一时刻只能有一个代理修改 `schema.prisma`、`contract.service.ts`、`settlement.service.ts`、`core-flow-read.api.ts` 或 `route-records.ts`。主代理在每个任务后执行两阶段审查：先对照规格检查业务，再检查代码质量、测试和 diff。

提交顺序：

```text
M52 基线审计
→ M53 公司主体版本与合同主体快照
→ 公司主体 API/Web
→ M54 审批人员和签名快照
→ 五类合同审批
→ M55 合同正式文件、授权书和用章任务
→ 合同详情与归档
→ 统一变更与 10% 门禁
→ 结算上限
→ M56 结算参与人和签章证据
→ 结算逐页合成与 Web
→ 通用合同付款限制
→ 历史接管/只读加固
→ 全量回归、隔离迁移和发布候选
```

## 3. 任务清单

### Task 1: 固定 M52 基线并增加治理前只读盘点

**Files:**
- Create: `services/api/scripts/inspect-contract-settlement-governance-readiness.cjs`
- Create: `services/api/src/database/contract-settlement-governance-readiness-script.spec.ts`
- Modify: `services/api/package.json`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 写脚本静态安全失败测试**

```ts
it("keeps the governance audit read-only", () => {
  const source = readFileSync(scriptPath, "utf8");
  expect(source).toContain("SET default_transaction_read_only = on");
  expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
  expect(source).toContain("20260716160000_contract_tax_facts_and_settlement_drafts");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-settlement-governance-readiness-script.spec.ts`

Expected: FAIL，因为脚本尚不存在。

- [ ] **Step 3: 实现只读盘点脚本**

脚本只输出以下计数和明细摘要，不输出文件对象键或密钥：

```js
const checks = {
  migration52: `SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '20260716160000_contract_tax_facts_and_settlement_drafts' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  companyEntities: `SELECT "id", "name", "unifiedSocialCreditCode", "isActive" FROM "CompanyEntity" ORDER BY "createdAt"`,
  duplicateCreditCodes: `SELECT upper(trim("unifiedSocialCreditCode")) code, count(*) FROM "CompanyEntity" WHERE "unifiedSocialCreditCode" IS NOT NULL GROUP BY 1 HAVING count(*) > 1`,
  activeContracts: `SELECT "status", count(*) FROM "ContractVersion" WHERE "status" IN ('in_approval','approved_pending_seal','in_seal','seal_approved_pending_archive','pending_archive_confirm') GROUP BY "status"`,
  activeSettlements: `SELECT "status", count(*) FROM "Settlement" WHERE "status" IN ('approval_pending','approved_pending_archive','pending_archive_confirm') GROUP BY "status"`
};
```

- [ ] **Step 4: 运行定向测试和脚本语法检查**

Run: `node --check services/api/scripts/inspect-contract-settlement-governance-readiness.cjs && pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-settlement-governance-readiness-script.spec.ts`

Expected: PASS；脚本只有 SELECT/只读事务。

- [ ] **Step 5: 提交**

```bash
git add services/api/scripts/inspect-contract-settlement-governance-readiness.cjs services/api/src/database/contract-settlement-governance-readiness-script.spec.ts services/api/package.json PROGRESS.md
git commit -m "test: 增加合同结算治理只读预检"
```

### Task 2: 定义公司主体领域类型和统一信用代码算法

**Files:**
- Create: `packages/shared-domain/src/company-entity.ts`
- Create: `packages/shared-domain/src/company-entity.test.ts`
- Modify: `packages/shared-domain/src/index.ts`
- Create: `services/api/src/company-entity/unified-social-credit-code.ts`
- Create: `services/api/src/company-entity/unified-social-credit-code.spec.ts`

- [ ] **Step 1: 写角色集合与信用代码失败测试**

```ts
expect(COMPANY_ENTITY_MAINTAINER_ROLES).toEqual([
  "comprehensive_director", "contract_staff", "contract_director"
]);
expect(COMPANY_ENTITY_READER_ROLES).toEqual([
  "comprehensive_director", "contract_staff", "contract_director",
  "finance_staff", "finance_director", "chairman", "general_manager"
]);
// 这里只验证规范化，不代表 Y43 通过校验位检查；成功校验夹具统一使用 Y46。
expect(normalizeUnifiedSocialCreditCode(" 91350211M000100Y43 ")).toBe("91350211M000100Y43");
expect(() => assertValidUnifiedSocialCreditCode("91350211M000100Y44")).toThrow("校验位");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/company-entity.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/company-entity/unified-social-credit-code.spec.ts`

Expected: FAIL，因为常量和算法不存在。

- [ ] **Step 3: 实现稳定类型和 GB 32100 校验位算法**

```ts
const CHARSET = "0123456789ABCDEFGHJKLMNPQRTUWXY";
const WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

export function normalizeUnifiedSocialCreditCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function assertValidUnifiedSocialCreditCode(raw: string): string {
  const code = normalizeUnifiedSocialCreditCode(raw);
  if (!new RegExp(`^[${CHARSET}]{18}$`).test(code)) {
    throw new BadRequestException("统一社会信用代码必须为 18 位规范字符");
  }
  const sum = code.slice(0, 17).split("").reduce(
    (total, char, index) => total + CHARSET.indexOf(char) * WEIGHTS[index], 0
  );
  const check = CHARSET[(31 - (sum % 31)) % 31];
  if (code[17] !== check) throw new BadRequestException("统一社会信用代码校验位不正确");
  return code;
}
```

- [ ] **Step 4: 运行定向测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/company-entity.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/company-entity/unified-social-credit-code.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/shared-domain/src/company-entity.ts packages/shared-domain/src/company-entity.test.ts packages/shared-domain/src/index.ts services/api/src/company-entity/unified-social-credit-code.ts services/api/src/company-entity/unified-social-credit-code.spec.ts
git commit -m "feat: 定义我方公司主体领域规则"
```

### Task 3: M53 公司主体版本与合同主体快照

**Files:**
- Create: `services/api/prisma/migrations/20260717110000_company_entity_versions_and_contract_subject_snapshots/migration.sql`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/database/company-entity-governance-schema-verification.spec.ts`

- [ ] **Step 1: 写 schema 失败测试**

```ts
expect(schema).toContain("model CompanyEntityVersion");
expect(schema).toContain("registeredAddress");
expect(schema).toContain("companyEntityVersionId");
expect(schema).toContain("companyEntityCreditCodeSnapshot");
expect(migration).not.toContain("UPDATE \"CompanyEntity\" SET \"unifiedSocialCreditCode\"");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/database/company-entity-governance-schema-verification.spec.ts`

Expected: FAIL，因为 M53 尚不存在。

- [ ] **Step 3: 添加兼容存量空值的 Prisma 模型**

```prisma
model CompanyEntity {
  id                      String   @id @default(uuid())
  name                    String
  unifiedSocialCreditCode String?
  registeredAddress       String?
  dataStatus              String   @default("legacy_incomplete")
  currentVersionNo        Int      @default(0)
  isActive                Boolean  @default(true)
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
}

model CompanyEntityVersion {
  id                      String   @id @default(uuid())
  companyEntityId         String
  versionNo               Int
  name                    String
  unifiedSocialCreditCode String?
  registeredAddress       String?
  isActive                Boolean
  action                  String
  actorUserId             String?
  actorRoleKey            String?
  createdAt               DateTime @default(now())

  @@unique([companyEntityId, versionNo])
  @@index([name])
  @@index([unifiedSocialCreditCode])
}
```

在 `ContractVersion` 增加可空历史兼容列：

```prisma
companyEntityIdSnapshot           String?
companyEntityVersionId            String?
companyEntityNameSnapshot         String?
companyEntityCreditCodeSnapshot   String?
companyEntityRegisteredAddressSnapshot String?
```

M53 只回填可可靠推导的名称、ID 和版本链接；旧空/非法信用代码保持空并标记 `legacy_incomplete`。使用部分唯一索引保证非空规范代码唯一。

- [ ] **Step 4: 验证 Prisma 和迁移 SQL**

Run: `pnpm --filter @jiangkong/api prisma validate && pnpm --filter @jiangkong/api exec prisma format && pnpm --filter @jiangkong/api exec prisma generate && pnpm --filter @jiangkong/api test -- --runInBand src/database/company-entity-governance-schema-verification.spec.ts`

Expected: PASS；M52 diff 为空。

- [ ] **Step 5: 提交**

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations/20260717110000_company_entity_versions_and_contract_subject_snapshots/migration.sql services/api/src/database/company-entity-governance-schema-verification.spec.ts
git commit -m "feat: 增加公司主体版本与合同快照结构"
```

### Task 4: 公司主体公司级权限、历史和审计 API

**Files:**
- Create: `services/api/src/company-entity/company-entity-access.ts`
- Create: `services/api/src/company-entity/company-entity-access.spec.ts`
- Create: `services/api/src/company-entity/dto/company-entity.dto.ts`
- Modify: `services/api/src/company-entity/company-entity.service.ts`
- Modify: `services/api/src/company-entity/company-entity.service.spec.ts`
- Modify: `services/api/src/company-entity/company-entity.controller.ts`
- Modify: `services/api/src/company-entity/company-entity.module.ts`

- [ ] **Step 1: 写公司级权限和版本历史失败测试**

```ts
await expect(access.assertCanMaintain("project-contract-user")).rejects.toThrow("公司级全局岗位");
await service.update("entity-1", "contract-user", {
  name: "云南某建设有限公司",
  unifiedSocialCreditCode: "91350211M000100Y46",
  registeredAddress: "昆明市"
});
expect(tx.companyEntityVersion.create).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ versionNo: 2, action: "update", actorUserId: "contract-user" })
}));
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/company-entity/company-entity-access.spec.ts src/company-entity/company-entity.service.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 global-only 判定和事务版本写入**

```ts
const positions = await prisma.userPosition.findMany({
  where: { userId, projectId: null },
  select: { positionId: true }
});
const roles = await prisma.position.findMany({
  where: { id: { in: positions.map((row) => row.positionId) } },
  select: { key: true }
});
const roleKey = roles.map((row) => row.key as RoleKey).find((key) => allowed.includes(key));
if (!roleKey) throw new ForbiddenException("当前账号没有公司级全局岗位，不能维护我方公司主体");
```

新增、修改、启停都锁定主体行，递增 `currentVersionNo`，创建不可覆盖历史，写入 `company_entity.create/update/disable/enable` 审计。名称重复只返回 warning；信用代码冲突返回明确下一步。

- [ ] **Step 4: 添加兼容与管理路由**

```ts
@Get() listActive() { return this.companyEntities.listActive(); }
@Get("management") listForManagement(@CurrentUser() user: AuthenticatedUser, @Query() query: CompanyEntityQueryDto) {
  return this.companyEntities.listForManagement(user.id, query);
}
@Get(":id/history") history(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
  return this.companyEntities.history(id, user.id);
}
@Post() create(@Body() body: CreateCompanyEntityDto, @CurrentUser() user: AuthenticatedUser) {
  return this.companyEntities.create(body, user.id);
}
@Patch(":id") update(...) { return this.companyEntities.update(id, user.id, body); }
@Post(":id/status") updateStatus(...) { return this.companyEntities.updateStatus(id, user.id, body); }
```

- [ ] **Step 5: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/company-entity/company-entity-access.spec.ts src/company-entity/company-entity.service.spec.ts src/auth/guards/permission.guard.spec.ts`

Expected: PASS；项目级同名岗位和 `super_admin` 均不能维护。

- [ ] **Step 6: 提交**

```bash
git add services/api/src/company-entity
git commit -m "feat: 完善我方公司主体维护与历史"
```

### Task 5: 独立公司主体 Web 台账

> **执行校正（2026-07-17 实现审查）**：历史版本必须展示安全的操作人姓名与岗位，不能把“数据库已留 UUID”当作用户可追溯；Task 4 历史读模型批量解析 `actorName` 并从响应移除 `actorUserId`。列表、历史抽屉和保存动作还必须覆盖真实浏览器下的请求乱序、清空事件时序和重复提交，不能只用 Vue 源码字符串断言。

**Files:**
- Create: `apps/web-admin/src/api/company-entity.api.ts`
- Create: `apps/web-admin/src/api/company-entity.api.test.ts`
- Create: `apps/web-admin/src/pages/company-entities/CompanyEntityListPage.vue`
- Create: `apps/web-admin/src/pages/company-entities/company-entity.config.ts`
- Create: `apps/web-admin/src/pages/company-entities/company-entity.config.test.ts`
- Create: `apps/web-admin/src/pages/company-entities/components/CompanyEntityFormDrawer.vue`
- Create: `apps/web-admin/src/pages/company-entities/components/CompanyEntityHistoryDrawer.vue`
- Create: `apps/web-admin/e2e/company-entity-ledger.e2e.ts`
- Modify: `apps/web-admin/src/routes/route-records.ts`
- Modify: `apps/web-admin/src/routes/index.test.ts`
- Modify: `apps/web-admin/src/pages/settings/SettingsPage.vue`
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/scripts/check-ui-rules.mjs`
- Modify: `services/api/src/company-entity/company-entity.service.ts`
- Modify: `services/api/src/company-entity/company-entity.service.spec.ts`

- [ ] **Step 1: 写路由、权限、无导出和 API 失败测试**

```ts
expect(visibleAdminNavigationItems(["finance_staff"], ["finance_staff"]).map(i => i.path))
  .toContain("/我方公司主体");
expect(visibleAdminNavigationItems(["super_admin"], ["super_admin"]).map(i => i.path))
  .not.toContain("/我方公司主体");
expect(companyEntityCapabilities(["finance_director"])).toEqual({ canRead: true, canMaintain: false });
expect(pageSource).not.toMatch(/导出|exportCompany/);
expect(formSource).not.toMatch(/法定代表人|联系电话|银行账户|公章图片|营业执照附件|备注/);
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/company-entity.api.test.ts src/pages/company-entities/company-entity.config.test.ts src/routes/index.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现 API client 和纯权限配置**

```ts
export const companyEntityMaintainerRoleKeys = [
  "comprehensive_director", "contract_staff", "contract_director"
] as const;
export const companyEntityReaderRoleKeys = [
  ...companyEntityMaintainerRoleKeys,
  "finance_staff", "finance_director", "chairman", "general_manager"
] as const;

export function companyEntityCapabilities(globalRoleKeys: readonly RoleKey[]) {
  return {
    canRead: companyEntityReaderRoleKeys.some((role) => globalRoleKeys.includes(role)),
    canMaintain: companyEntityMaintainerRoleKeys.some((role) => globalRoleKeys.includes(role))
  };
}
```

- [ ] **Step 4: 实现台账、表单和历史抽屉**

使用 `BusinessPageHeader`、`BusinessTableToolbar`、`BusinessFeedback`、`t-table`、`t-drawer` 和 `SensitiveActionDialog`。页面显示启用/停用、资料待补全、当前与历史搜索，不提供删除、回滚或导出。历史显示“操作人姓名 · 公司级岗位 · 时间 · 动作 · 前后差异”，响应不返回原始操作人 UUID。将 `SettingsPage.vue` 的旧公司主体维护区和 `core-flow-read.api.ts` 旧双 API 删除，避免双入口。

列表和历史请求使用序号加查询/主体快照丢弃旧响应；筛选变化同步失效旧 token，确保 TDesign 清空事件随后启动的新查询不会被异步 watch 误杀。表单在函数入口阻断重复提交，失败后保持抽屉与三项输入。

- [ ] **Step 5: 登记响应式治理并运行检查**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/company-entity/company-entity.service.spec.ts src/company-entity/company-entity-access.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/api/company-entity.api.test.ts src/pages/company-entities/company-entity.config.test.ts src/routes/index.test.ts && pnpm --filter @jiangkong/web-admin typecheck && pnpm --filter @jiangkong/web-admin typecheck:e2e && pnpm --filter @jiangkong/web-admin lint && pnpm --filter @jiangkong/web-admin check:ui && pnpm --filter @jiangkong/web-admin build && CI=true pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.config.ts e2e/company-entity-ledger.e2e.ts`

Expected: PASS；新页是 ledger，只有表格区域横向滚动；清空查询采用最新响应、A 的延迟历史不能覆盖 B、双击保存只产生一次 POST。

- [ ] **Step 6: 提交**

```bash
git add services/api/src/company-entity/company-entity.service* apps/web-admin/src/api/company-entity.api* apps/web-admin/src/api/core-flow-read.api.ts apps/web-admin/src/pages/company-entities apps/web-admin/src/routes apps/web-admin/src/pages/settings/SettingsPage.vue apps/web-admin/scripts/check-ui-rules.mjs apps/web-admin/e2e/company-entity-ledger.e2e.ts
git commit -m "feat: 增加我方公司主体独立台账"
```

### Task 6: 合同草稿选择主体并在提交时冻结 M53 快照

> **执行校正（2026-07-17 代码审计）**：新建入口只创建空白工作台，不在 `CreateContractDraftDto` 强制主体；主体在工作台基本信息中选择。客户端只提交稳定 `companyEntityId`，服务端加载当前不可变主体版本并派生名称、信用代码、注册地址和旧 `myCompanyEntity` 兼容文本，禁止客户端同时维护两份主体事实。保存点恢复、合同类型切换和合同变更必须沿用同一结构化主体选择；不得仅改 JSON 而让父 `Contract` 留在旧主体。正式合同文档的我方主体只来自结构化选择或 M53 冻结快照；历史 `party_a` 仅作旧数据兜底，新草稿不得手工新增或改为 `party_a`，避免形成第二套主体真相。

**Files:**
- Modify: `packages/shared-domain/src/contract-workbench.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract-change-policy.ts`
- Modify: `services/api/src/contract/contract-change-policy.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- Modify: `services/api/src/contract-workbench/dto/contract-workbench.dto.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.spec.ts`
- Modify: `services/api/src/business-party/business-party.service.ts`
- Modify: `services/api/src/business-party/business-party.service.spec.ts`
- Modify: `services/api/src/contract-document/contract-document.service.ts`
- Modify: `services/api/src/contract-document/contract-document.service.spec.ts`
- Modify: `services/api/src/company-entity/company-entity.service.ts`
- Modify: `services/api/src/company-entity/company-entity.service.spec.ts`
- Modify: `apps/web-admin/src/api/company-entity.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractBasicSection.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractPartySection.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`

- [ ] **Step 1: 写停用、版本冻结和自由文本负向测试**

```ts
await expect(service.submitApproval("version-1", "owner-1", input)).rejects.toThrow(
  "所选我方公司主体已停用，请回到基本信息重新选择"
);
expect(tx.contractVersion.updateMany).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({
    companyEntityIdSnapshot: "entity-1",
    companyEntityVersionId: "entity-version-3",
    companyEntityNameSnapshot: "云南某建设有限公司",
    companyEntityCreditCodeSnapshot: "91350211M000100Y46"
  })
}));
expect(componentSource).toContain("<t-select");
expect(componentSource).toContain("companyEntityId");
expect(componentSource).not.toMatch(/emit\([^\n]*myCompanyEntity/u);
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract.service.spec.ts src/contract-workbench/contract-readiness.service.spec.ts src/contract-workbench/contract-workbench.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts`

Expected: FAIL。

- [ ] **Step 3: 服务端派生结构化主体事实，提交时锁定当前版本**

```ts
const entity = await tx.companyEntity.findUnique({
  where: { id: contract.companyEntityId! }
  // 实现时使用事务内行锁，防止校验后被并发停用或换版。
});
if (!entity?.isActive) throw new BadRequestException("所选我方公司主体已停用，请回到基本信息重新选择");
if (entity.dataStatus !== "complete") throw new BadRequestException("所选我方公司主体资料待补全，请先到我方公司主体页面完善信用代码");
const entityVersion = await tx.companyEntityVersion.findFirst({
  where: { companyEntityId: entity.id, versionNo: entity.currentVersionNo }
});
if (!entityVersion) throw new BadRequestException("我方公司主体版本缺失，请联系合同部核对后重试");
```

`SaveContractDraftDto` 顶层只接收 `companyEntityId`。保存时由服务端读取当前 `CompanyEntityVersion`，生成只读的 `draftData.companyEntitySelection`（`id/versionId/versionNo/name/code/address`）和旧字段 `myCompanyEntity` 兼容文本，并在同一个 revision/CAS 更新中同步父 `Contract.companyEntityId/companyEntityName`。保存点恢复、合同类型切换和合同变更都必须保留这组结构化事实。

提交审批前在同一事务中锁定 `CompanyEntity`，比较草稿记录的主体版本号与 `currentVersionNo`；主体停用、资料不完整、版本漂移或版本缺失时均阻断，并提示回到基本信息重新同步。原合同将 M53 五个快照字段从不可变版本写入同一次 `contractVersion.updateMany`；变更、补充协议继承原有效版本的冻结快照，绝不从当前主体档案刷新，历史空值也不得擅自补齐。

- [ ] **Step 4: 将基本信息改为启用主体选择器**

组件使用 TDesign Select 保存 `companyEntityId`，显示名称、信用代码、注册地址；候选读模型补充 `currentVersionNo` 供客户端识别已保存版本是否漂移。保留旧 `myCompanyEntity` 只读兼容映射，不能继续作为新合同输入事实。主体停用或更新时显示同步提示；重新选择或同步都递增 revision 并使旧预览失效，未计算内容不得伪装为有效结果。

主体候选只按“已启用且资料完整”筛选，不按项目绑定公司；同一项目必须能够为不同合同选择不同的已启用主体。增加回归测试，防止未来引入项目到主体的一对一限制。

`ContractPartySection` 对受治理的新草稿移除 `party_a` 选项，`BusinessPartyService` 同时在后端拒绝新增或改为 `party_a`；历史合同仍可读取已有记录。`ContractDocumentService` 在提交前优先读取草稿结构化主体、提交后只读取冻结快照；仅当历史版本两者都不存在时，才允许旧 `party_a` 兜底。

- [ ] **Step 5: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract.service.spec.ts src/contract/contract-change-policy.spec.ts src/contract-workbench/contract-readiness.service.spec.ts src/contract-workbench/contract-workbench.service.spec.ts src/business-party/business-party.service.spec.ts src/contract-document/contract-document.service.spec.ts src/company-entity/company-entity.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/shared-domain/src/contract-workbench.ts services/api/src/contract services/api/src/contract-workbench services/api/src/business-party services/api/src/contract-document services/api/src/company-entity apps/web-admin/src/api/company-entity.api.ts apps/web-admin/src/api/contract-workbench.api* apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue apps/web-admin/src/pages/contracts/workbench
git commit -m "feat: 冻结合同我方主体版本"
```

### Task 7: M54 冻结审批候选人员和动作签名

> **执行校正（2026-07-17 代码审计）**：候选人校验不能只改详情读侧。合同、结算、付款的真实审批写入口、三个详情读服务、`/me/work-items`、HTTP Guard 和自审保护当前各自重复按“现任岗位”判断，必须统一执行同一冻结语义，否则会出现页面显示、待办和直接审批互相矛盾。审批单和现有结算 PDF 当前也会回查用户最新签名，必须同时切断这两条漂移路径。三类 review 还必须锁定业务对象与 ApprovalInstance，避免并发批准重复推进。Task 7 只建立兼容基础和现有三类审批链路闭环，不提前实现 Task 8/11 的具体业务路线。

**Files:**
- Create: `services/api/prisma/migrations/20260717120000_approval_assignee_and_signature_snapshots/migration.sql`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/database/approval-signature-snapshot-schema-verification.spec.ts`
- Create: `services/api/src/approval/approval-signature-snapshot.ts`
- Create: `services/api/src/approval/approval-signature-snapshot.spec.ts`
- Create: `services/api/src/approval/approval-review-identity.ts`
- Create: `services/api/src/approval/approval-review-identity.spec.ts`
- Modify: `services/api/src/approval/approval-node-access.ts`
- Modify: `services/api/src/approval/approval-node-access.spec.ts`
- Modify: `services/api/src/approval/approval-self-review.ts`
- Modify: `services/api/src/approval/approval-self-review.spec.ts`
- Modify: `services/api/src/approval/approval-form.service.ts`
- Modify: `services/api/src/approval/approval-form.service.spec.ts`
- Modify: `services/api/src/core-flow/approval-timeline-read.ts`
- Modify: `services/api/src/core-flow/approval-timeline-read.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-read.service.ts`
- Modify: `services/api/src/settlement/settlement-read.service.spec.ts`
- Modify: `services/api/src/payment/payment-request.service.ts`
- Modify: `services/api/src/payment/payment-request.service.spec.ts`
- Modify: `services/api/src/payment/payment-read.service.ts`
- Modify: `services/api/src/payment/payment-read.service.spec.ts`
- Modify: `services/api/src/me/me.service.ts`
- Modify: `services/api/src/me/me.service.spec.ts`
- Modify: `services/api/src/auth/guards/permission.guard.ts`
- Modify: `services/api/src/auth/guards/permission.guard.spec.ts`
- Create: `services/api/src/database/approval-review-concurrency.spec.ts`

- [ ] **Step 1: 写候选人员和签名漂移失败测试**

```ts
expect(canActOnFrozenApprovalNode(
  [{ roleKeys: ["finance_director"], candidateUserIds: ["finance-1"] }],
  0, ["finance_director"], "finance-2"
)).toBe(false);
expect(files.getFileBuffer).toHaveBeenCalledWith("signature-at-approval");
expect(files.getFileBuffer).not.toHaveBeenCalledWith("current-signature");
```

还要先写三条端到端单元边界：非冻结同岗位人员不出现在待办且直接审批失败；换签后重新生成/下载审批单和刷新结算 PDF 仍读取审批当时文件；新受治理实例缺少有效签名或 64 位 SHA-256 时批准失败。再写跨入口一致性和并发边界：调岗后的冻结候选、合法 assignment 和常驻委托在详情、待办、Guard、POST 四处结果一致；空候选字段不能退回 legacy；多岗位节点只有兼容并集而无法唯一确定岗位时 fail closed；两个连接同时批准同一节点只能一次推进并只产生一条该节点 approve 日志。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/approval/approval-node-access.spec.ts src/approval/approval-review-identity.spec.ts src/approval/approval-signature-snapshot.spec.ts src/approval/approval-form.service.spec.ts src/core-flow/approval-timeline-read.spec.ts src/contract/contract.service.spec.ts src/settlement/settlement.service.spec.ts src/payment/payment-request.service.spec.ts src/me/me.service.spec.ts src/database/approval-signature-snapshot-schema-verification.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 增加可空历史快照列**

```prisma
model ApprovalActionLog {
  // existing fields
  approvedRoleKey             String?
  signatureFileIdSnapshot     String?
  signatureSha256Snapshot     String?
  representedUserId           String?
}
```

`frozenNodes` 使用向后兼容形态：

```ts
interface FrozenApprovalNode {
  name: string;
  mode: "any" | "all";
  roleKeys: RoleKey[];
  candidateUserIds?: string[];
  candidateUserIdsByRole?: Partial<Record<RoleKey, string[]>>;
  selectedUserId?: string;
  approvedRoleKeys?: RoleKey[];
  assignments?: ApprovalAssignment[];
}
```

M54 四列全部可空，无默认值、无历史回填、无 destructive DML。旧 role-only 节点与既有在途实例维持原资格，不补候选人；显式存在 `candidateUserIdsByRole`、`candidateUserIds` 或 `selectedUserId` 任一字段的新节点均启用人员冻结。迁移验证必须覆盖 M53→M54 顺序、事务边界、nullable、无默认值/回填，并包含删列、加默认值和注入回填 SQL 的变异测试。

- [ ] **Step 4: 统一候选人、指派和常驻委托的审批身份解析**

共享解析器返回 `{ approvedRoleKey, representedUserId }`，并同时服务于详情权限、待办、合同/结算/付款真实 review API：

- `candidateUserIdsByRole` 是新实例的权威“冻结岗位 → 具体人员”映射，`candidateUserIds` 为兼容并集；直接处理人只需命中待审批岗位对应的冻结人员，**不得再次要求其仍持有当前岗位**。`selectedUserId` 存在时只允许该冻结人员直接处理。提交后的调岗不自动改变资格，账号停用后通过转交/委托恢复，不重算路线。
- 节点 assignment 只允许从冻结候选人产生，使用既有 `fromUserId/fromRoleKey/toUserId` 填写 `representedUserId`。
- 常驻委托必须返回委托人 ID，且委托人必须是该节点冻结候选人，不能只凭委托人的当前岗位绕过冻结。
- 旧 role-only 节点继续按原岗位、assignment、常驻委托规则处理，避免改变既有在途实例。

三个详情读服务删除各自“委托人当前岗位”分支并复用解析器；`approval-self-review.ts` 对受治理节点使用已解析的冻结审批身份，不能因为候选人提交后调岗就拒绝，但旧 role-only 自审规则保持。`candidateUserIds` 在单岗位节点可作为兼容并集；多岗位节点没有 `candidateUserIdsByRole`/`selectedUserId` 时不能猜 `approvedRoleKey`。

`me.service.ts` 删除重复的候选人判断分支并复用同一纯函数语义；测试同时断言详情、待办和直接 POST 审批三处结果一致。

现有 `PermissionGuard` 是真实 review controller 之前的 HTTP 粗门禁，必须为合同、结算、付款审批动作增加“当前实例冻结候选/assignment/合法委托”的受控放行；否则调岗后的冻结人员和无当前岗位的转交接收人会在到达服务层前被 403。Guard 只解析目标业务当前进行中实例，不允许把冻结资格扩散到 create、submit、archive、税务或其他项目动作，并补直接候选、assignment、常驻委托、非候选和错误业务实例测试。

三类 review 在事务内使用固定锁序：`ContractVersion/Settlement/PaymentRequest → 对应 ApprovalInstance → User → FileObject`。锁后重新读当前节点再解析身份、冻结签名、推进实例并写日志；PDF 字节读取与渲染不放在审批锁事务内。转交/节点委托同样以冻结身份判断发起人，接收人必须为启用账号；受治理 assignment 的 `fromUserId/fromRoleKey` 必须对应冻结候选。

- [ ] **Step 5: 审批动作在事务内写入签名快照，所有 PDF 只读快照**

```ts
const identity = await resolveApprovalReviewIdentity(/* frozen node + actor + delegation */);
const signature = await snapshotApprovalSignature(tx, actorUserId, {
  required: isGovernedFrozenNode(currentNode) && input.decision === "approve"
});
await tx.approvalActionLog.create({
  data: {
    approvalInstanceId: instance.id,
    action: "approve",
    actorUserId,
    approvedRoleKey: identity.approvedRoleKey,
    signatureFileIdSnapshot: signature.fileId,
    signatureSha256Snapshot: signature.sha256,
    representedUserId: identity.representedUserId,
    metadata: existingMetadata
  }
});
```

四列在批准动作同一事务中写入；非批准动作至少记录 `approvedRoleKey/representedUserId`，签名列为空。签名摘要直接复制 `FileObject.contentSha256`，不另造哈希；新受治理节点批准时无签名、文件不存在或摘要不是 64 位 SHA-256 均阻断。历史 role-only 节点允许空签名快照继续处理。

`ApprovalFormService` 的归档生成和动态下载、以及现有 `SettlementService.buildSettlementApprovalRows()` 都只能读取日志的 `signatureFileIdSnapshot`，岗位优先读取 `approvedRoleKey`；旧日志无快照时固定显示“历史签名未冻结”，不得回查当前 `User.signatureFileId` 或当前岗位伪造历史。已存在的历史 `PdfDocument` 不覆盖、不重写。审批时间线同样优先读新列，旧日志才退回既有 metadata。

- [ ] **Step 6: 运行定向测试和 Prisma 验证**

Run: `pnpm --filter @jiangkong/api prisma generate && pnpm --filter @jiangkong/api prisma validate && pnpm --filter @jiangkong/api test -- --runInBand src/approval/approval-node-access.spec.ts src/approval/approval-review-identity.spec.ts src/approval/approval-signature-snapshot.spec.ts src/approval/approval-self-review.spec.ts src/approval/approval-form.service.spec.ts src/core-flow/approval-timeline-read.spec.ts src/contract/contract.service.spec.ts src/contract/contract-read.service.spec.ts src/settlement/settlement.service.spec.ts src/settlement/settlement-read.service.spec.ts src/payment/payment-request.service.spec.ts src/payment/payment-read.service.spec.ts src/me/me.service.spec.ts src/auth/guards/permission.guard.spec.ts src/database/approval-signature-snapshot-schema-verification.spec.ts src/database/approval-review-concurrency.spec.ts && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint && pnpm --filter @jiangkong/api check:business-errors`

Expected: PASS；非冻结同岗位人三处均无权，冻结候选人及合法指派/委托可处理；旧 role-only `frozenNodes` 仍能读取和处理但不会伪造历史签名。

- [ ] **Step 7: 提交**

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations/20260717120000_approval_assignee_and_signature_snapshots services/api/src/approval services/api/src/core-flow/approval-timeline-read* services/api/src/contract/contract.service* services/api/src/contract/contract-read.service* services/api/src/settlement/settlement.service* services/api/src/settlement/settlement-read.service* services/api/src/payment/payment-request.service* services/api/src/payment/payment-read.service* services/api/src/me/me.service* services/api/src/auth/guards/permission.guard* services/api/src/database/approval-signature-snapshot-schema-verification.spec.ts services/api/src/database/approval-review-concurrency.spec.ts
git commit -m "feat: 冻结审批人员与签名事实"
```

### Task 8: 五类新合同审批路线和人员冻结

> **执行校正（2026-07-17 代码审计）**：Task 8 依赖 Task 7 已完成“冻结人员不因调岗失权”的读、待办、HTTP Guard 和真实 review 闭环。这里只为尚未提交或重新提交的原合同生成新路线；既有在途实例不重算，合同变更继续使用现有路线直到后续 Task 14，历史接管也不套用新合同路线。项目岗位候选只认规范 `ProjectMember`，不把 legacy project-scoped `UserPosition` 混入新冻结事实；发现仅有遗留来源时提示先治理组织权限。提交事务必须使用统一锁序和 Serializable，避免组织岗位并发变更冻结出不存在的审批事实。

**Files:**
- Create: `services/api/src/contract/contract-approval-route.service.ts`
- Create: `services/api/src/contract/contract-approval-route.service.spec.ts`
- Modify: `services/api/src/contract/contract.module.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `packages/shared-domain/src/permissions.ts`
- Modify: `packages/shared-domain/src/permissions.test.ts`
- Modify: `apps/web-admin/src/pages/settings/approval-flow-readonly.config.ts`
- Modify: `apps/web-admin/src/pages/settings/approval-flow-readonly.config.test.ts`

- [ ] **Step 1: 写五类路线和主管发起失败测试**

```ts
expect(await routes.freezeNewContractRoute(tx, lockedMaterialContract, "staff-1")).toMatchObject([
  { roleKeys: ["contract_director"] },
  { roleKeys: ["material_director"] },
  { roleKeys: ["project_manager"] },
  { roleKeys: ["finance_director"] },
  { roleKeys: ["chairman", "general_manager"] }
]);
expect((await routes.freezeNewContractRoute(tx, lockedGenericContract, "director-1"))[0].roleKeys)
  .toEqual(["comprehensive_director"]);
await expect(routes.freezeNewContractRoute(tx, lockedLaborContract, "staff-1"))
  .rejects.toThrow("所属项目的项目总工配置缺失或冲突");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/permissions.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-approval-route.service.spec.ts src/contract/contract.service.spec.ts`

Expected: FAIL。

失败测试必须覆盖五类完整路线、合同部成员发起保留首节点、只有公司级合同主管发起才跳过、项目隔离、启用用户、未知/空合同类型 fail closed、项目总工 exactly one、其他单角色节点至少一名非申请人候选、领导或签节点至少一名非申请人候选、`candidateUserIdsByRole` 实际写入 ApprovalInstance。项目总工唯一性先对所属项目全部启用规范成员检查，再排除申请人；两人中含申请人仍是冲突，唯一总工就是申请人则因无合格审批人阻断。批准规格明确禁止申请人利用兼任岗位审批自己发起的新合同，因此所有后续节点都排除申请人；排除后为空即阻断，不使用领导自审例外绕过本流程。

集成测试还必须覆盖：申请人提交时仍是启用的项目合同员或公司级合同主管；项目存在且启用；原合同退回重提重新冻结；既有在途、变更、补充协议和历史接管不调用新路线；路线失败时状态、实例和审计零写入；组织岗位并发撤销/提交只能得到一致串行结果，P2034 返回固定中文重试提示。

同时修复已确认的无总价框架真实提交阻断：仅 `pricingNature=framework && amountLimitType=unlimited` 时跳过合同总金额和业主合同额度占用，仍强制清单范围、含税单价、税率、付款条款、签前文件和审批路线；其他 `amountCents<=0` 继续 fail closed。增加从工作台保存到提交审批完整测试，不能只测 readiness。

- [ ] **Step 3: 实现分类路线定义**

```ts
const NEW_CONTRACT_ROUTE: Record<ContractTypeKey, RouteNodeDefinition[]> = {
  material_purchase: [GLOBAL("contract_director"), GLOBAL("material_director"), PROJECT("project_manager"), GLOBAL("finance_director"), OR_GLOBAL("chairman", "general_manager")],
  equipment_rental: [GLOBAL("contract_director"), GLOBAL("material_director"), PROJECT("project_manager"), GLOBAL("finance_director"), OR_GLOBAL("chairman", "general_manager")],
  labor_subcontract: [GLOBAL("contract_director"), UNIQUE_PROJECT("engineering_director"), PROJECT("project_manager"), GLOBAL("finance_director"), OR_GLOBAL("chairman", "general_manager")],
  professional_subcontract: [GLOBAL("contract_director"), UNIQUE_PROJECT("engineering_director"), PROJECT("project_manager"), GLOBAL("finance_director"), OR_GLOBAL("chairman", "general_manager")],
  generic_contract: [GLOBAL("contract_director"), GLOBAL("comprehensive_director"), PROJECT("project_manager"), GLOBAL("finance_director"), OR_GLOBAL("chairman", "general_manager")]
};
```

路线解析接口固定为 `freezeNewContractRoute(tx, lockedContract, applicantUserId)`：`ContractService.submitApproval()` 先只读定位 contractId，再以 `Contract → ContractVersion → Project → CompanyEntity/候选事实` 固定锁序在 Serializable 事务中锁定并重读；把同一 `tx` 与锁定 Contract 传入路线服务，服务不得用注入的全局 Prisma 客户端旁路事务。锁后确认项目启用，服务层确认申请人仍是该项目启用的规范 `contract_staff` ProjectMember 或公司级 `contract_director`，不能依赖 Guard 或 legacy project-scoped UserPosition。测试断言候选查询全部走传入 tx。

公司级节点从 `UserPosition(projectId=null)` 加 `Position.key` 和启用用户解析；项目经理与项目总工仅从合同所属项目的 `ProjectMember` 解析。项目总工先在未排除申请人的完整启用集合上要求 exactly one，再执行申请人排除；其他节点直接冻结全部剩余启用候选且至少一人，董事长/总经理或签只要求两种岗位剩余候选合计至少一人。主管发起时仅当申请人持有公司级 `contract_director` 才删除首节点。未知或空 `contractTypeKey` 必须 fail closed。所有节点写显式 `candidateUserIdsByRole`（OR 节点保留两个岗位 key，即使某个为空）与去重稳定排序的并集，后续 review 不重查现任岗位。原合同缺路线依赖必须 fail closed，绝不回退“仅董事长/总经理”；`ContractModule` 显式注册 provider。

- [ ] **Step 4: 补粗粒度入口岗位但不扩大其他写权限**

`contract.approve` 只增加 `material_director`、`comprehensive_director`、`engineering_director`，具体节点仍由冻结人员校验；不把这些岗位加入 create、submit、archive 或 tax confirm。

- [ ] **Step 5: 运行定向测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/permissions.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-approval-route.service.spec.ts src/contract/contract.service.spec.ts src/approval/approval-node-access.spec.ts src/approval/approval-self-review.spec.ts src/me/me.service.spec.ts src/auth/guards/permission.guard.spec.ts src/payment/payment-request.service.spec.ts src/project-expense/project-expense.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/pages/settings/approval-flow-readonly.config.test.ts && pnpm --filter @jiangkong/shared-domain typecheck && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint && pnpm --filter @jiangkong/web-admin typecheck && pnpm --filter @jiangkong/web-admin lint && pnpm --filter @jiangkong/web-admin check:ui`

Expected: PASS；只读设置拆为五张新合同卡并完整展示各自路线，只有通用合同含综合部主管；合同变更规则保持到 Task 14 再改。付款和项目支出既有领导自审测试不变。

- [ ] **Step 6: 提交**

```bash
git add packages/shared-domain/src/permissions* services/api/src/contract apps/web-admin/src/pages/settings/approval-flow-readonly.config*
git commit -m "feat: 按合同类型冻结审批路线"
```

### Task 9: M55 合同正式文件、双方授权书和用章任务

> **执行校正（2026-07-17 代码审计）**：Task 9 只增加受约束的兼容数据结构与原字节 PDF 检查，不改写旧文件或旧状态。M55 给 `ContractVersion` 增加 nullable `contractGovernanceVersion`（仅允许 1、无默认、无回填），后续仅部署后新建的草稿写 1；null 的存量草稿、在途和已生效合同继续旧链。M55 的强度不得低于 M53：外键、枚举 CHECK、页数/SHA/revision CHECK、查询索引、同版本同 purpose 仅一个 active 文件，以及无回填/无 destructive DML 都必须由静态与变异测试验证，不能只断言 Prisma 模型名称存在。

**Files:**
- Create: `services/api/prisma/migrations/20260717130000_contract_formal_documents_authorizations_and_seal_tasks/migration.sql`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/database/contract-governance-files-schema-verification.spec.ts`
- Create: `services/api/src/contract/contract-formal-pdf-inspector.ts`
- Create: `services/api/src/contract/contract-formal-pdf-inspector.spec.ts`

- [ ] **Step 1: 写模型和原字节失败测试**

```ts
expect(migration).toContain('FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"');
expect(migration).toContain('FOREIGN KEY ("fileId") REFERENCES "FileObject"');
expect(migration).toContain('CREATE UNIQUE INDEX');
expect(migration).toMatch(/WHERE\s+"status"\s*=\s*'active'/u);
expect(migration).toMatch(/CHECK\s*\(\s*"pageCount"\s*>\s*0/u);
expect(migration).toMatch(/CHECK[\s\S]*"contentSha256"[\s\S]*64/u);
expect((await inspectSignedPdf(source)).sha256).toBe(createHash("sha256").update(source).digest("hex"));
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-formal-pdf-inspector.spec.ts src/database/contract-governance-files-schema-verification.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 建立增量模型**

```prisma
model ContractFormalFile {
  id                String    @id @default(uuid())
  contractVersionId String
  purpose           String
  fileId            String
  contentSha256     String
  pageCount         Int
  sourceRevision    Int
  status            String
  uploadedByUserId  String
  supersedesId      String?
  invalidatedAt     DateTime?
  invalidationReason String?
  declarationSnapshot Json
  declaredByUserId String
  declaredAt        DateTime
  confirmedByUserId String?
  confirmedAt        DateTime?
  confirmationSnapshot Json?
  createdAt         DateTime  @default(now())
  @@index([contractVersionId, purpose, status])
}

model ContractAuthorization {
  id                String   @id @default(uuid())
  originContractVersionId String
  side              String
  grantorName       String
  agentName         String
  scopeSummary      String
  fileId            String
  contentSha256     String
  pageCount         Int
  status            String
  supersedesId      String?
  invalidatedAt     DateTime?
  invalidationReason String?
  uploadedByUserId  String
  createdAt         DateTime @default(now())
}

model ContractVersionAuthorizationLink {
  id                       String   @id @default(uuid())
  contractVersionId        String
  side                     String
  required                 Boolean
  authorizationId          String?
  reusedFromContractVersionId String?
  createdAt                DateTime @default(now())
  @@unique([contractVersionId, side])
}

model ContractSealTask {
  id                  String    @id @default(uuid())
  contractVersionId   String    @unique
  handlerUserId       String
  status              String
  approvedByUserId    String?
  approvedAt          DateTime?
  completedByUserId   String?
  completedAt         DateTime?
  cancelledByUserId   String?
  cancelledAt         DateTime?
  cancellationReason  String?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}
```

保留 `ContractArchiveFile` 作为旧历史兼容，不迁移猜测旧文件用途。新链只认 `contractGovernanceVersion=1`；null 版本继续旧用章/归档语义，禁止升级时强迫存量在途补审批前文件或 SealTask。`PdfDocument` 增加可空 `approvalInstanceId` 与受约束唯一索引，新审批单按实例冻结；旧 PdfDocument 不回填、不覆盖。

迁移为四个新模型补齐到 `ContractVersion`、`FileObject`、`User`、授权来源版本、授权记录、复用来源版本和 self-supersedes 的外键（删除策略以保留业务证据为先）；`purpose/status/side/seal task status` 使用 CHECK，SealTask 支持 `cancelled` 并要求取消人/时间/原因成组存在；正式文件和授权文件都保存 `pageCount > 0`、64 位小写十六进制 SHA-256、active/invalidated/superseded 状态、失效原因和替代关系；正式文件另保存不可变声明与最终归档确认快照、双方操作人和时间。`sourceRevision >= 1`、`supersedesId != id`；required 与 authorizationId 必须成对一致；`ContractSealTask(status, handlerUserId)` 建索引；使用 partial unique index 保证每个合同版本、每种 purpose 最多一个 active 正式文件。授权关联保持每版本每 side 唯一，数据库约束与服务事务共同防止失配。

- [ ] **Step 4: 只读检查 PDF**

`contract-formal-pdf-inspector.ts` 使用 `pdf-lib` 加载原 buffer，仅返回 SHA、页数、页面尺寸/旋转；不保存 `PDFDocument.save()` 输出。

- [ ] **Step 5: 运行 Prisma 和定向测试**

Run: `pnpm --filter @jiangkong/api prisma generate && pnpm --filter @jiangkong/api prisma validate && pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-formal-pdf-inspector.spec.ts src/database/contract-governance-files-schema-verification.spec.ts && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint`

Expected: PASS；迁移顺序、事务、外键、CHECK、partial unique、无默认猜测/回填/删除以及删约束、删索引、注入 destructive DML 的变异测试均通过。

- [ ] **Step 6: 提交**

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations/20260717130000_contract_formal_documents_authorizations_and_seal_tasks services/api/src/contract/contract-formal-pdf-inspector* services/api/src/database/contract-governance-files-schema-verification.spec.ts
git commit -m "feat: 增加合同签署与授权证据结构"
```

### Task 10: 合同审批前正式 PDF、双方授权和就绪门禁

> **执行校正（2026-07-17 文件与授权审计）**：授权页属于正式审批 PDF 的组成部分，因此顺序固定为“先明确双方授权并关联有效授权文件 → 再上传完整合并审批 PDF”。部署后新建原合同/变更/补充草稿立即写 `contractGovernanceVersion=1`，存量 null 不升级。授权语义变化必须递增 `draftRevision` 并使旧正式 PDF/readiness 失效；普通草稿事实变化也必须清空旧 readiness。正式文件和授权服务的读取/写入/提交门禁必须接收同一个事务 `tx` 与已锁定版本，禁止各自开事务造成 TOCTOU。

**Files:**
- Create: `services/api/src/contract/contract-formal-file.service.ts`
- Create: `services/api/src/contract/contract-formal-file.service.spec.ts`
- Create: `services/api/src/contract/contract-authorization.service.ts`
- Create: `services/api/src/contract/contract-authorization.service.spec.ts`
- Create: `services/api/src/contract/dto/contract-formal-file.dto.ts`
- Create: `services/api/src/contract/dto/contract-authorization.dto.ts`
- Modify: `services/api/src/contract/contract.module.ts`
- Modify: `services/api/src/contract/contract.controller.ts`
- Modify: `services/api/src/contract/contract.controller.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `packages/shared-domain/src/contract-workbench.ts`

- [ ] **Step 1: 写四种授权组合和修订一致性失败测试**

```ts
await expect(readiness.check(tx, version, contract, true)).resolves.toMatchObject({
  blocking: expect.arrayContaining([expect.objectContaining({ key: "document.counterparty_signed_pdf_missing" })])
});
await expect(files.assertReadyForSubmission(version)).rejects.toThrow("正式审批文件已过期");
expect(await authorizations.ready(versionId)).toEqual({ companyRequired: false, counterpartyRequired: false, ready: true });
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-formal-file.service.spec.ts src/contract/contract-authorization.service.spec.ts src/contract-workbench/contract-readiness.service.spec.ts src/contract/contract.service.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 实现正式审批文件上传与声明**

```ts
await formalFiles.uploadApprovalVersion(versionId, actorUserId, {
  fileId,
  counterpartySigned: true,
  counterpartyStamped: true,
  crossPageSealCompleted: true,
  documentOrderConfirmed: true,
  authorizationsBeforeSignaturePageConfirmed: true,
  sourceRevision: version.draftRevision
});
```

服务验证私有文件归属、PDF、原始 SHA、页数和最新 `draftRevision`，并要求合同员声明完整文件顺序为“合同正文 → 全部附件和清单 → 所需授权委托书 → 最终签署页”。替换时把旧记录标记 superseded；草稿后续变化无需逐处删除文件，提交时以 `sourceRevision` 硬阻断。上传、替换、失效和门禁阻断均写审计；系统不使用 OCR 猜测签字或印章真伪。

业务关联服务复用现有 `/files`，但必须读取原始 buffer 后额外验证：`storageStatus=active`、文件由当前经办人上传、声明 MIME 为 PDF 且真实字节可由 `pdf-lib` 解析、记录大小等于 buffer 长度且未超限、已有 `contentSha256` 为合法 64 位并与原字节重算一致、页数大于 0；扩展名伪装、错误 MIME、破损/加密/零页、SHA 缺失或不符、非本人上传、失效文件都拒绝。检查只读原 buffer，不调用 `PDFDocument.save()` 重写原件。声明快照、声明人和时间写 M55。

- [ ] **Step 4: 实现授权选择与复用**

我方和乙方各保存一条明确 link；link 不存在表示“尚未选择”，绝不能解释为 `required=false`。写接口接收 `expectedRevision`，锁版本并校验经办人/可编辑状态；语义实际变化时原子递增 revision、清空 readiness，使旧正式 PDF 自动过期，相同请求重试幂等且不重复递增。`required=false` 时 authorization 必须为空，`required=true` 时必须关联新上传或可复用授权。复用只新增 link，不复制文件/授权记录；校验 `originContractVersionId` 与来源版本同属当前 Contract、side 和代理人一致、来源版本为 effective/superseded 且确有该 link、文件仍 active/SHA 可读，范围摘要明确覆盖签署、履行、变更及补充协议。来源 draft、跨合同、失效文件或只凭 authorizationId 均拒绝。

- [ ] **Step 5: 合并到提交事务**

`submitApproval()` 在改变状态和创建实例前依次验证主体快照、正式文件、授权和审批人员。`formalFiles.assertReadyForSubmission(tx, lockedVersion)` 与 `authorizations.assertReady(tx, lockedVersion)` 必须使用提交事务的同一 `tx`；文件/授权写入也锁同一版本或使用 revision/status CAS，覆盖并发上传、替换、授权修改、双击提交和网络重试。任何失败保持草稿及已填内容。若门禁阻断需要审计，不得在随后抛错回滚的同一事务中假记录；使用 tagged denial 让审计事务提交后再在外层抛出脱敏业务错误，或在回滚后单独记录并测试确实持久。

固定锁序为 `Contract → ContractVersion → Authorization/FormalFile → FileObject`。`freeze()` 保存正式文件 ID/SHA/revision 和双方授权快照；相同 fileId/revision/声明的关联重试返回原记录，并发上传只留下一个 active。`contractGovernanceVersion=null` 严格走旧提交链，`=1` 缺任何新事实均 fail closed，禁止旧接口或旧 `ContractArchiveFile` 冒充新正式文件。

- [ ] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/shared-domain test && pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-formal-file.service.spec.ts src/contract/contract-authorization.service.spec.ts src/contract/contract.controller.spec.ts src/contract-workbench/contract-readiness.service.spec.ts src/contract-workbench/contract-workbench.service.spec.ts src/contract/contract.service.spec.ts src/file/file.service.spec.ts && pnpm --filter @jiangkong/shared-domain typecheck && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint && pnpm --filter @jiangkong/api check:business-errors`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/shared-domain/src/contract-workbench.ts services/api/src/contract services/api/src/contract-workbench
git commit -m "feat: 增加合同签前文件与授权门禁"
```

### Task 11: 合同工作台正式文件和授权 UI

> **执行校正（2026-07-17 交互审计）**：工作台先完成双方授权选择，再上传包含授权页的完整审批 PDF。当前提交入口仍在合同详情，Task 11 将编号规则、保存完成确认、readiness 刷新和“提交审批”迁入工作台，并移除详情页重复主提交入口；提交前必须等待 `saveNow()` 成功。上传采用“先 `/files` 原字节、再业务关联 fileId”的显式两步，关联失败可复用同一 fileId 重试，不强迫重新上传。

**Files:**
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractFormalDocumentSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractAuthorizationSection.vue`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-workbench-canvas.structure.test.ts`
- Modify: `apps/web-admin/e2e/contract-workbench-canvas.e2e.ts`

- [ ] **Step 1: 写 API、TDesign Upload 和结构失败测试**

```ts
expect(apiRequest).toHaveBeenCalledWith(`/contracts/${versionId}/formal-files/approval`, expect.anything());
expect(formalSectionSource).toContain("<t-upload");
expect(formalSectionSource).not.toContain('type="file"');
expect(workbenchSource).toContain("ContractAuthorizationSection");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts src/pages/contracts/contract-workbench-canvas.structure.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现读模型、两块域组件和唯一提交闭环**

顺序固定为“合同文档预览 → 双方授权选择/授权文件 → 乙方签章完整审批 PDF → 提交就绪”。共享工作台读模型返回两侧授权选择、关联文件、正式文件、sourceRevision/声明和 readiness；缺任一 side link 显示“尚未选择”，不伪装为“不需要”。页面只保留“提交审批”为主操作，生成/下载/上传为次级；编号规则与提交确认迁入工作台，详情页不保留并列提交主动作。上传或关联失败不清空主体、税务、清单和授权选择。

TDesign Upload 使用自定义 request，禁止默认上传到未知地址；同一动作只调用一次 `/files`，成功后用返回 fileId 调业务关联路由。`/files` 失败保持所有本地输入；关联失败保留 fileId 和文件列表并提供重试；双击上传/提交被 loading guard 阻断；409/revision 冲突提示刷新但保留本地表单。

`saveNow()/flush()` 在 clean 状态必须 no-op，不能因为点击提交把已上传的 R 版正式 PDF 变成 R+1 过期；dirty 时返回明确成功/失败，失败或冲突必须阻断 readiness/submit。授权或正式文件 mutation 前先 flush 普通草稿并 reload revision，授权成功后重载工作台，避免 autosave 与授权 revision 互相制造 409。点击提交先等待 flush 成功，再刷新 readiness，最后提交冻结事实；详情旧主动作只导航到工作台，不保留死的第二提交入口。

- [ ] **Step 4: 运行 Web 定向测试和 UI 检查**

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts src/api/core-flow-read.api.test.ts src/pages/contracts/contract-workbench-canvas.structure.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts && pnpm --filter @jiangkong/web-admin typecheck && pnpm --filter @jiangkong/web-admin typecheck:e2e && pnpm --filter @jiangkong/web-admin lint && pnpm --filter @jiangkong/web-admin check:ui && pnpm --filter @jiangkong/web-admin build && CI=true pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.config.ts e2e/contract-workbench-canvas.e2e.ts`

Expected: PASS；不扩大原生文件控件 allowlist；浏览器覆盖授权四组合、清空/重选、文件上传两步、关联失败复用、双提交和提交前保存。

- [ ] **Step 5: 提交**

```bash
git add apps/web-admin/src/api/contract-workbench.api* apps/web-admin/src/api/core-flow-read.api* apps/web-admin/src/pages/contracts apps/web-admin/e2e/contract-workbench-canvas.e2e.ts
git commit -m "feat: 完善合同签前文件工作台"
```

### Task 12: 同意用章、线下盖章、最终文件与归档职责分离

> **执行校正（2026-07-17 代码审计）**：现有 `approveSeal()` 会直接跳到“待归档”，必须由新服务取代。最终审批只负责原子、幂等创建“待同意用章”任务并冻结经办人；综合部主管的“同意用章”只代表允许线下取章，版本进入 `in_seal`；只有冻结经办人确认完成我方签署与盖章后，才允许上传双方最终版。所有写动作必须锁版本/任务或使用带旧状态的 CAS，不能沿用 find 后无条件 update。`contractGovernanceVersion=1` 走新链，null 保留旧用章/`ContractArchiveFile` 兼容；旧接口对新链必须转发新服务或明确拒绝。

**Files:**
- Create: `services/api/src/contract/contract-seal.service.ts`
- Create: `services/api/src/contract/contract-seal.service.spec.ts`
- Create: `services/api/src/contract/dto/contract-seal.dto.ts`
- Modify: `services/api/src/contract/contract.module.ts`
- Modify: `services/api/src/contract/contract.controller.ts`
- Modify: `services/api/src/contract/contract.controller.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract-status.service.ts`
- Modify: `services/api/src/contract/contract-status.service.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`
- Modify: `services/api/src/approval/approval-form.service.ts`
- Modify: `services/api/src/approval/approval-form.service.spec.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`
- Modify: `services/api/src/me/me.service.ts`
- Modify: `services/api/src/me/me.service.spec.ts`
- Modify: `packages/shared-domain/src/core-flow-read-model.ts`
- Modify: `packages/shared-domain/src/permissions.ts`
- Modify: `packages/shared-domain/src/permissions.test.ts`

- [ ] **Step 1: 写状态和职责分离失败测试**

```ts
expect(await service.reviewApproval(versionId, finalApprover, { decision: "approve" }))
  .toMatchObject({ status: "approved_pending_seal" });
expect(await seal.approve(versionId, comprehensiveDirector)).toMatchObject({ status: "in_seal" });
expect(await seal.complete(versionId, handler)).toMatchObject({ status: "seal_approved_pending_archive" });
await expect(service.confirmArchiveFile(versionId, uploader, input)).rejects.toThrow("上传人与归档确认人不能是同一人");
expect(await finalApproval()).toMatchObject({ sealTask: { handlerUserId: applicant, status: "pending_approval" } });
await expect(Promise.all([seal.approve(versionId, director), seal.approve(versionId, director)]))
  .rejects.toThrow("用章任务已处理");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-seal.service.spec.ts src/contract/contract-status.service.spec.ts src/contract/contract.service.spec.ts src/approval/approval-form.service.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 修正状态机和用章任务**

最终审批事务按 `contractVersionId` 幂等创建 `ContractSealTask(status='pending_approval')`，`handlerUserId` 固定为该审批实例的申请人；重复最终回调不得创建第二任务或第二份审计。综合部主管“同意用章”后任务和版本原子进入 `in_seal`，经办人确认线下签字盖章完成后进入 `seal_approved_pending_archive`。动作分别审计为 `contract.seal.approve` 和 `contract.seal.complete`，系统不创建印章实体、编号或图片档案。

新增真实 controller/DTO/module 接线：`seal/approve`、`seal/complete`、双方最终版业务关联上传、退回资料补正和归档确认。文件字节仍经既有通用 `/files` 上传 API、类型/大小/私有存储/权限处理；合同业务服务只读取 `FileObject` 后强制正式件为 PDF 并建立 M55 关联。粗权限允许冻结经办人（包括合同部主管发起人）到达服务层，最终仍由 seal task handler 和状态硬校验，不能扩成任意合同写权限。

- [ ] **Step 4: 最终签署版与审批版差异边界**

最终上传使用 `ContractFormalFile(purpose='mutually_signed_final')`；通常只允许冻结经办人且任务已完成线下签署盖章时关联上传。唯一例外：冻结经办人是唯一启用公司级合同主管时，允许该合同所属项目的启用 `contract_staff` 替代上传，由该主管确认；有另一名公司级合同主管时仍由经办人上传、另一主管确认。确认人必须是启用公司级合同主管且 `uploader != confirmer`，不能通过扩大粗权限实现例外。

服务校验 PDF、版本、页数和原审批版存在，并锁版本确保同 purpose 只有一个 active 文件。系统不机械判断文件内容差异，由上传人明确声明最终版相对审批版只新增我方签字或签章、公司公章、骑缝章和签署日期；合同部主管确认时再次确认同一声明并把 confirmationSnapshot/人/时间写正式文件主事实。资料缺页/错页可退回最终文件补正；一旦主体、金额、税率、清单、付款条款、授权、范围或正文变化，旧正式文件失效、SealTask 持久改为 cancelled、readiness 清空并退回草稿重新审批。上传、替换、确认、退回、失效和声明内容均写审计。

- [ ] **Step 5: 合同审批单使用冻结签名并加固下载授权**

审批单只读 M54 快照，并按 ApprovalInstance 唯一生成/复用，不再只按 ContractVersion 查找，防止重审错误复用旧审批单；生成失败可重试、可观测，不能事务外吞错。允许规格列明的经办人、合同部、实际审批人、所属项目经理、财务人员/主管、综合部主管和领导下载，仍要求密码、用途、水印和审计。`download_approval_form` 的 availableAction 必须使用同一精确 ACL，不能向无权用户显示伪可用按钮；该 ACL 仅限合同审批单，不扩成任意归档附件读取。

`FileService` 必须在全局项目可见岗位快捷放行之前识别审批单、ContractFormalFile 和 ContractAuthorization 业务关联，执行精确 ACL；`super_admin`、非实际审批的预算/物资岗位不得通过通用 `/files/:id/download-ticket` 绕过。`MeService` 增加综合部主管“待同意用章”、冻结经办人“待完成我方签署盖章”、最终版上传（含唯一主管替代上传）和合同主管归档确认待办。

- [ ] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/permissions.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-seal.service.spec.ts src/contract/contract-status.service.spec.ts src/contract/contract.controller.spec.ts src/contract/contract.service.spec.ts src/contract/contract-read.service.spec.ts src/approval/approval-form.service.spec.ts src/file/file.service.spec.ts && pnpm --filter @jiangkong/shared-domain typecheck && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint && pnpm --filter @jiangkong/api check:business-errors`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/shared-domain/src/core-flow-read-model.ts packages/shared-domain/src/permissions* services/api/src/contract services/api/src/approval/approval-form.service* services/api/src/file/file.service* services/api/src/me/me.service*
git commit -m "feat: 分离合同同意用章与归档事实"
```

### Task 13: 合同详情展示双文件、用章动作和审批单

**Files:**
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-detail.config.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-detail.config.test.ts`
- Modify: `apps/web-admin/e2e/ui-p1-contract-visual.e2e.ts`
- Create: `apps/web-admin/e2e/contract-governance.e2e.ts`

- [ ] **Step 1: 写动作文案和只读岗位失败测试**

```ts
expect(contractActionLabel("seal_approve")).toBe("同意用章");
expect(contractActionLabel("seal_complete")).toBe("确认已完成我方签署与盖章");
expect(canRequestContractChangeEligibility(["finance_staff"])).toBe(false);
expect(detailEvidenceKinds).toEqual(expect.arrayContaining(["counterparty_signed_approval", "mutually_signed_final", "approval_form"]));
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/core-flow-read.api.test.ts src/pages/contracts/contract-detail.config.test.ts`

Expected: FAIL。

- [ ] **Step 3: 使用后端 availableActions 渲染敏感动作**

`ContractDetailPage.vue` 不复制状态机；“同意用章”“完成盖章”“上传最终版”“确认归档”均使用既有 `SensitiveActionDialog` 和 TDesign Upload。财务/综合只读用户不请求变更资格，不显示新建、上传、提交或确认按钮。

- [ ] **Step 4: 运行定向测试与 E2E**

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/core-flow-read.api.test.ts src/pages/contracts/contract-detail.config.test.ts src/pages/contracts/contract-change.structure.test.ts && pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.config.ts e2e/contract-governance.e2e.ts e2e/ui-p1-contract-visual.e2e.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web-admin/src/api/core-flow-read.api* apps/web-admin/src/pages/contracts/ContractDetailPage.vue apps/web-admin/src/pages/contracts/contract-detail.config* apps/web-admin/e2e/contract-governance.e2e.ts apps/web-admin/e2e/ui-p1-contract-visual.e2e.ts
git commit -m "feat: 完善合同签署归档详情"
```

### Task 14: 统一合同变更和累计增项 10% 硬门禁

> **执行校正（2026-07-18，用户已确认历史基线方案）**：Task 14 只约束新提交/重新提交，不终止旧在途实例；旧实例终止归 Task 22 manifest 工具。累计正增项必须从同一合同曾生效的 change/supplement 版本事实重算，减项永不返还额度。阻断审计不能写在随后抛错回滚的同一事务里。历史接管不得把接管时金额倒推为原始签约额：复用历史接管根 `ContractVersion.originalBaseAmountCents` 保存原始签约含税金额、`cumulativeIncreaseCents` 保存接管前累计正增项；两项由合同部主管在接管确认后通过密码敏感动作一次性同时确认，确认后 CAS 冻结并写 AuditLog。缺失基线只阻断未来合同变更，不阻断接管确认、既有结算或付款。该方案复用既有可空列，不新增迁移，Task 16 的 M56 编号保持不变。

**Files:**
- Create: `services/api/src/contract/contract-change-limit-policy.ts`
- Create: `services/api/src/contract/contract-change-limit-policy.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract-change-read-model.ts`
- Modify: `services/api/src/contract/contract-change-read-model.spec.ts`
- Modify: `services/api/src/contract/contract-approval-route.service.ts`
- Modify: `services/api/src/contract/contract-approval-route.service.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`
- Modify: `services/api/src/contract/dto/create-contract-change-draft.dto.ts`
- Modify: `services/api/src/contract/contract.controller.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`
- Create: `services/api/src/contract-takeover/dto/confirm-contract-change-baseline.dto.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-change.state.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-change.state.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-change.structure.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.test.ts`
- Modify: `apps/web-admin/src/pages/settings/approval-flow-readonly.config.ts`
- Modify: `apps/web-admin/src/pages/settings/approval-flow-readonly.config.test.ts`
- Modify: `apps/web-admin/e2e/contract-change.e2e.ts`

- [x] **Step 1: 写边界和历史兼容失败测试**

```ts
expect(evaluateContractIncreaseLimit({ originalAmountCents: 1_000_00n, historicalPositiveIncreaseCents: 100_00n, proposedChangeCents: 0n }).allowed).toBe(true);
expect(evaluateContractIncreaseLimit({ originalAmountCents: 1_000_00n, historicalPositiveIncreaseCents: 100_00n, proposedChangeCents: 1n }).allowed).toBe(false);
expect(evaluateContractIncreaseLimit({ originalAmountCents: 1_000_00n, historicalPositiveIncreaseCents: 100_00n, proposedChangeCents: -50_00n }).positiveIncreaseAfterChangeCents).toBe(100_00n);
expect(evaluateContractIncreaseLimit({ originalAmountCents: 1_000_00n, historicalPositiveIncreaseCents: 80_00n, proposedChangeCents: -50_00n }).positiveIncreaseAfterChangeCents).toBe(80_00n);
expect(readHistoricalChangeRoute(approvedLegacyInstance)).toEqual(approvedLegacyInstance.frozenNodes);
```

- [x] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-change-limit-policy.spec.ts src/contract/contract-change-read-model.spec.ts src/contract/contract.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-change.state.test.ts`

Expected: FAIL。

- [x] **Step 3: 实现整数门禁和事务重算**

```ts
export function exceedsTenPercent(original: bigint, historicalPositive: bigint, proposed: bigint) {
  if (original <= 0n) throw new Error("原合同金额事实异常，暂不能判断增项上限");
  const proposedPositive = proposed > 0n ? proposed : 0n;
  return (historicalPositive + proposedPositive) * 10n > original;
}
```

提交先只读定位 contractId，再按固定顺序锁 `Contract → target ContractVersion → root/已生效变更版本 → Project`。分母取该合同唯一、曾生效且无 base 的 original 根版本金额；正增项只汇总 `changeType in (change,supplement)`、`status in (effective,superseded)`、`effectiveAt != null`、`changeDirection=increase`、`changeAmountCents>0`，不信任沿版本复制的累计字段或相邻 amount 差。拟提交只加入正向金额，减项不抵扣。草稿超过上限仍可保存，但提交返回“累计增项已超过原合同 10%，必须新签合同”。仅 `pricingNature=framework && amountLimitType=unlimited` 同时满足时跳过比例；其他 original<=0 脏数据 fail closed。近 BIGINT、恰好 10%、多次增减和 1 分越界均用 bigint 交叉乘测试。

阻断结果使用 tagged denial：锁内重算后写脱敏 AuditLog 并正常提交审计事务，事务外再抛业务错误；测试必须重新查询证明审计持久，不能只断言回滚事务中的 mock 调用。Task 14 不终止旧实例、不失效旧文件；这些只由 Task 22 受控过渡工具处理。

历史接管根版本以 `originalBaseAmountCents !== null` 作为两项历史基线已经同时确认的完整标记。新增 `POST /projects/:projectId/contract-takeovers/:takeoverId/change-baseline-confirmation`：仅合同部主管可执行，DTO 接收两个规范分值和当前密码；事务按 `Contract → 历史根 ContractVersion → ContractTakeover` 锁定，只允许已确认的 `historical_takeover` 根版本且 `originalBaseAmountCents IS NULL`，使用 `updateMany` CAS 保证只能成功一次。除 `framework + unlimited` 可接受原始金额为 0 外，原始金额必须大于 0；累计正增项必须大于等于 0。成功写 `contract_takeover.change_baseline.confirm` 审计，重试或覆盖均拒绝。历史基线缺失时，接管确认、结算、付款保持不变；仅变更 eligibility/create fail closed 并提示先补录。

- [x] **Step 4: 统一新路线、保留历史实例**

新变更固定“合同部主管（主管发起跳过）→ 项目经理 → 财务主管 → 董事长/总经理或签”，复用 Task 8 的 transaction-bound 候选冻结服务，排除申请人并缺员 fail closed。提交前逐字段比较 candidate 与直接 base 的 M53 五主体快照，历史 null 保持 null。读模型一次批量读取 `flowType=contract.approve` 的 `approved/in_progress` ApprovalInstance：`in_approval` 版本只信当前 `in_progress` 的 frozenNodes，其他状态只信 `approved` 的历史冻结事实，按业务版本映射最新可用路线，不按新策略重算旧名称或路线；旧“增强”只在旧冻结实例可证明时显示“增强合同变更（历史）”，找不到冻结实例显示“历史路线未冻结”，不得伪造 schema 不存在的 `major` 类型或产生 N+1。

- [x] **Step 5: Web 删除新流程增强文案**

新建只有“合同变更”；后端 DTO/服务忽略或拒绝客户端创建 `supplement`，历史读取仍兼容既有 supplement。详情下拉、API 联合类型和工作台“补充协议/增强”新建文案一并移除；历史记录仍显示可证明的旧标签。公司主体字段在变更草稿中只读，换主体提示新签合同。

- [x] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-change-limit-policy.spec.ts src/contract/contract-change-policy.spec.ts src/contract/contract-change-read-model.spec.ts src/contract/contract-approval-route.service.spec.ts src/contract/contract.service.spec.ts src/contract/contract-read.service.spec.ts src/contract/contract.controller.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/api/core-flow-read.api.test.ts src/pages/contracts/contract-change.state.test.ts src/pages/contracts/contract-change.structure.test.ts && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint && pnpm --filter @jiangkong/api check:business-errors && pnpm --filter @jiangkong/web-admin typecheck && pnpm --filter @jiangkong/web-admin lint && pnpm --filter @jiangkong/web-admin check:ui`

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add services/api/src/contract apps/web-admin/src/api/core-flow-read.api* apps/web-admin/src/pages/contracts/ContractDetailPage.vue apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue apps/web-admin/src/pages/contracts/contract-change* apps/web-admin/e2e/contract-change.e2e.ts
git commit -m "feat: 统一合同变更与增项硬门禁"
```

> Task 14 已于 2026-07-18 按上述边界完成实现、验证与独立双复审；真实 PostgreSQL 条件测试已落库，但本机无 `DATABASE_URL` 未执行，不作伪通过记录。

### Task 15: 合同金额优先的结算占额门禁和通用合同禁建结算

> **执行校正（2026-07-17 结算额度审计）**：合同占额集合必须兼容存量 `in_approval/archive_pending`；通用合同在草稿创建/更新、直接提交、草稿提交和读模型四处 fail closed，不能只在最后提交拒绝。无总价框架不仅跳过合同总额 cap，也不把预计数量/预计行金额当硬上限。超额阻断审计使用 tagged denial，不能写在随后回滚的事务中。

**Files:**
- Create: `services/api/src/settlement/contract-settlement-capacity.ts`
- Create: `services/api/src/settlement/contract-settlement-capacity.spec.ts`
- Create: `services/api/src/database/settlement-contract-cap-concurrency.spec.ts`
- Modify: `packages/shared-domain/src/statuses.ts`
- Modify: `packages/shared-domain/src/statuses.test.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-submission.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-submission.service.ts`
- Modify: `services/api/src/settlement/settlement-draft.service.ts`
- Modify: `services/api/src/settlement/settlement-draft.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-line-occupancy.ts`
- Modify: `services/api/src/settlement/settlement-line-occupancy.spec.ts`
- Modify: `services/api/src/contract/contract-current-version-lock.ts`
- Modify: `services/api/src/contract/contract-current-version-lock.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`

- [x] **Step 1: 写顺序、状态和通用合同失败测试**

```ts
await expect(service.submitInTransaction(tx, prepared, applicant)).rejects.toThrow("通用合同不办理结算");
expect(occupiedSettlementStatuses).toEqual([
  "in_approval", "approval_pending", "approved_pending_archive", "archive_pending",
  "pending_archive_confirm", "effective", "partially_paid", "paid"
]);
await expect(overOriginalWithoutChange).rejects.toThrow("请先完成合同变更");
await expect(overAlreadyIncreasedVersion).rejects.toThrow("必须新签合同");
expect(reserveExceptionQuota).not.toHaveBeenCalled();
```

- [x] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/settlement/contract-settlement-capacity.spec.ts src/settlement/settlement.service.spec.ts src/settlement/settlement-submission.service.spec.ts src/settlement/settlement-draft.service.spec.ts`

Expected: FAIL。

同时先写：通用/空/未知合同类型在 draft create/update、direct submit、draft submit、lines preview/导入均失败且零写入；四类明确可结算合同放行。既有非法类型草稿允许只读查看但明确 blocking reason，不允许修改/提交。框架无限额合同即使预计数量非空且实际累计超过预计数量/预计行金额也可继续，但范围外清单、冻结单价或税率漂移仍拒绝。

- [x] **Step 3: 在唯一提交共享点加事务门禁**

在 `SettlementService.submitInTransaction()` 中使用固定锁顺序：先只读定位 contractId，再 `Contract → 当前有效 ContractVersion → 按 id 稳定排序的相关占额 Settlement → Project/项目例外额度`。修正 `contract-current-version-lock.ts`，不能普通读版本后只锁合同；双连接隔离库测试证明两个各自不超限但合计超限的并发提交只能一个成功且无死锁。先计算合同上限，再调用既有 `reserveSettlementQuota()`；项目例外额度即使足够也不能突破合同 cap，拒绝后 Settlement/usage/ApprovalInstance 都为零。

shared-domain 状态、项目额度、清单行占额和合同总额统一兼容 `in_approval/approval_pending/approved_pending_archive/archive_pending/pending_archive_confirm/effective/partially_paid/paid` 八种占额状态；`draft/approval_rejected/withdrawn` 不占额。仓库当前没有完整结算作废写入口，Task 15 不得仅通过排除 `voided` 宣称已实现释放；作废另需状态机、权限、确认和审计后才能计入。仅 `pricingNature=framework && amountLimitType=unlimited` 时跳过总额、预计数量和预计行金额硬上限，仍执行清单范围、冻结单价和税校验。

两种超限原因复用 Task 14 历史正增项事实：不存在曾生效正增项（包括只有减项）提示“请先完成合同变更”；存在正增项后仍超变更后上限提示“必须新签合同”。金额全程 bigint，覆盖恰好上限、超 1 分、近 PostgreSQL BIGINT、最终结算差额。

成功占额始终写合同额度占用审计，不只在使用项目例外额度时记录。阻断在业务事务内抛 typed denial，确保草稿 revision 抢占、Settlement、usage、ApprovalInstance 全部回滚；外层捕获后用独立事务持久化脱敏审计，再抛固定业务错误。直接提交和草稿提交都重新查询证明业务零写入、草稿 revision/status 不变且审计存在，禁止“正常提交拒绝事务”误保存 revision。

- [x] **Step 4: 读模型禁止通用合同作为结算选项**

`canCreateSettlement=false`，原因“通用合同直接按冻结付款条款申请付款，不办理结算”。付款选项保持。`contractTypeKey` 为空或未知同样 fail closed；只有材料、机械、劳务、专业分包四类进入结算候选。合同详情的 `availableActions/primaryAction/settlementBlockMessage` 使用相同规则：通用显示按冻结付款条款申请付款，空/未知不显示伪结算入口。

- [x] **Step 5: 运行定向测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/statuses.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/settlement/contract-settlement-capacity.spec.ts src/settlement/settlement-line-occupancy.spec.ts src/settlement/settlement.service.spec.ts src/settlement/settlement-submission.service.spec.ts src/settlement/settlement-draft.service.spec.ts src/contract/contract-current-version-lock.spec.ts src/contract/contract-read.service.spec.ts src/database/settlement-contract-cap-concurrency.spec.ts && pnpm --filter @jiangkong/shared-domain typecheck && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint && pnpm --filter @jiangkong/api check:business-errors`

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add packages/shared-domain/src/statuses* services/api/src/settlement services/api/src/contract/contract-current-version-lock* services/api/src/contract/contract-read.service* services/api/src/database/settlement-contract-cap-concurrency.spec.ts
git commit -m "feat: 增加合同结算金额硬上限"
```

> Task 15 已于 2026-07-18 完成实现并通过规格/质量双复审。真实 PostgreSQL 验收使用本机临时 `postgres:16-alpine`、随机隔离 schema 和两个独立 PrismaClient，显式设置 `RUN_SETTLEMENT_CONTRACT_CAP_CONCURRENCY=1` 后 1/1 通过：两个 600 分提交在合同上限 1000 分下仅一笔成功；直接提交和草稿提交超额后的 Settlement、项目例外额度、审批实例、草稿 revision/status 与独立拒绝审计均经数据库重新查询确认。临时容器和 schema 已清理，未连接或修改生产。

### Task 16: M56 结算参与人和签章证据结构

> **执行校正（2026-07-17 结算签章审计）**：M56 只增加兼容 schema、强约束和参与人纯冻结能力，不执行外部 PDF I/O。新增 nullable `governanceVersion` 区分旧 role-only/旧归档语义与新受治理实例，迁移不回填旧结算。工长/施工员明确映射为项目级 `engineering_foreman` 或 `engineering_tech` 中由合同员选定一人；所属项目总工为项目级唯一 `engineering_director`。Task 7/M54 和 Task 15 必须先绿。

**Files:**
- Create: `services/api/prisma/migrations/20260717140000_settlement_participants_and_signed_documents/migration.sql`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/database/settlement-signature-governance-schema-verification.spec.ts`
- Create: `services/api/src/settlement/settlement-participant-freeze.ts`
- Create: `services/api/src/settlement/settlement-participant-freeze.spec.ts`

- [x] **Step 1: 写结构和项目人员失败测试**

```ts
expect(migration).toContain('"governanceVersion"');
expect(migration).toContain('FOREIGN KEY ("fileId") REFERENCES "FileObject"');
expect(migration).toMatch(/CHECK[\s\S]*"contentSha256"[\s\S]*64/u);
expect(migration).toMatch(/WHERE[\s\S]*"status"[\s\S]*'active'/u);
await expect(freeze({ selectedUserId: "other-project-user", projectId: "p1" }))
  .rejects.toThrow("只能选择所属项目当前有效人员");
```

- [x] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/database/settlement-signature-governance-schema-verification.spec.ts src/settlement/settlement-participant-freeze.spec.ts`

Expected: FAIL。

- [x] **Step 3: 增加最小增量字段和文档表**

`SettlementDraft` 和 `Settlement` 增加 nullable `governanceVersion` 与 `fieldReviewerUserId/fieldReviewerRoleKey`；`Settlement` 增加编制人和提交时签名文件/摘要；新表保存 `frozen_counterparty_copy`、`counterparty_signed_original`、`final_internal_signed_copy` 三种用途、fileId、原字节 hash、pageCount、sourceRevision、业务 snapshot token、审批动作集合 hash、状态/生成状态、声明快照/声明人/时间、失效原因、上传/生成者和替代关系。

M56 增加到 Settlement/SettlementDraft/FileObject/User/替代记录的外键与保留证据的删除策略；purpose/status CHECK、pageCount>0、sourceRevision>=1、64 位小写 SHA、同 settlement/draft revision+purpose 最多一个 active/live 文档的 partial unique、查询索引。静态测试覆盖 M55→M56 顺序、事务、无历史回填/默认猜测/破坏性 DML，并包含删外键、删 CHECK、删 partial unique、注入 UPDATE/DELETE 的变异测试。

- [x] **Step 4: 参与人冻结规则**

材料/机械只接受所属项目启用的 `material_staff`；劳务/专业由合同员从所属项目启用的 `engineering_foreman` 或 `engineering_tech` 中选择一人，冻结 selectedUserId 与对应 roleKey；跨项目、停用、未选择均拒绝。项目总工必须为所属项目恰好一名启用 `engineering_director`。公司工程技术部部长不再出现在新结算路线。

- [x] **Step 5: 运行 Prisma 和定向测试**

Run: `pnpm --filter @jiangkong/api prisma generate && pnpm --filter @jiangkong/api prisma validate && pnpm --filter @jiangkong/api test -- --runInBand src/database/settlement-signature-governance-schema-verification.spec.ts src/settlement/settlement-participant-freeze.spec.ts && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint`

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations/20260717140000_settlement_participants_and_signed_documents services/api/src/database/settlement-signature-governance-schema-verification.spec.ts services/api/src/settlement/settlement-participant-freeze*
git commit -m "feat: 增加结算参与人与签章证据结构"
```

> Task 16 已于 2026-07-18 完成实现并通过规格/质量双复审。质量复审发现并关闭了单项字段合法但用途组合可污染的缺口：M56 现以数据库 CHECK 固定“冻结版=草稿/系统生成/已完成”“乙方签章原件=草稿/人工上传/完整声明”“最终内部签名件=正式结算/系统生成/审批动作集合摘要”，失效或替代不改写原始证据事实。全新 PostgreSQL 16 临时库已从 M1 连续执行到 M56，共 56 个迁移全部成功；真实非法组合 INSERT 精确命中组合约束。替代服务在 Task 17/18 仍须于锁内校验同父业务、同 purpose，并防一旧件多后继或替代环。临时数据库已清理，未执行生产迁移。

### Task 17: 两类结算路线和乙方扫描件前置门禁

> **执行校正（2026-07-17 提交入口审计）**：新受治理结算的固定顺序是“保存草稿事实/参与人 → 生成并冻结本 revision 结算单 → 乙方线下逐页签章盖章 → 上传整份原始扫描 PDF 并绑定同 revision → 提交”。新增专用业务关联 API/DTO；通用 `/files` 仍只负责私有原字节。直接 `POST /settlements` 也必须进入同一门禁或对新受治理合同明确拒绝，不能绕过草稿链路。

**Files:**
- Modify: `packages/shared-domain/src/permissions.ts`
- Modify: `packages/shared-domain/src/permissions.test.ts`
- Modify: `services/api/src/settlement/dto/create-settlement.dto.ts`
- Modify: `services/api/src/settlement/dto/settlement-draft.dto.ts`
- Create: `services/api/src/settlement/dto/settlement-signed-document.dto.ts`
- Create: `services/api/src/settlement/settlement-counterparty-document.service.ts`
- Create: `services/api/src/settlement/settlement-counterparty-document.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.module.ts`
- Modify: `services/api/src/settlement/settlement.controller.ts`
- Modify: `services/api/src/settlement/settlement.controller.spec.ts`
- Modify: `services/api/src/settlement/settlement-draft.controller.ts`
- Modify: `services/api/src/settlement/settlement-draft.controller.spec.ts`
- Modify: `services/api/src/settlement/settlement-draft.service.ts`
- Modify: `services/api/src/settlement/settlement-draft.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-submission.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-submission.service.ts`
- Modify: `apps/web-admin/src/pages/settings/approval-flow-readonly.config.ts`
- Modify: `apps/web-admin/src/pages/settings/approval-flow-readonly.config.test.ts`

- [x] **Step 1: 写路线、现场人员和扫描件失败测试**

```ts
expect(materialNodes.map(n => n.roleKeys[0])).toEqual([
  "material_staff", "material_director", "contract_director", "project_manager", "finance_director"
]);
expect(laborNodes.map(n => n.roleKeys[0])).toEqual([
  selectedFieldRole, "engineering_director", "contract_director", "project_manager", "finance_director"
]);
expect(laborNodes.flatMap(n => n.roleKeys)).not.toContain("engineering_department_director");
await expect(submit(draftWithoutSignedPdf)).rejects.toThrow("请先上传乙方完整签章扫描件");
```

- [x] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/permissions.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/settlement/settlement-participant-freeze.spec.ts src/settlement/settlement-draft.service.spec.ts src/settlement/settlement-submission.service.spec.ts src/settlement/settlement.service.spec.ts`

Expected: FAIL。

- [x] **Step 3: 冻结具体人员和编制人签名**

提交时验证所选人员仍属于项目，把 selected user 写入第一个冻结节点；劳务/专业 selected role 只能为 `engineering_foreman/engineering_tech`，材料/机械只能为 `material_staff`。项目总工节点冻结唯一用户；其他节点通过 Task 7 的 `candidateUserIdsByRole` 冻结提交时公司级/项目级候选并排除申请人，缺员 fail closed。编制人不是审批节点，但提交时冻结本人签名 fileId/SHA 和提交日期。四合同类型分别对过程/最终结算断言 frozenNodes 完全相同；设置只读页删除公司工程技术部部长旧节点并显示两类路线。

- [x] **Step 4: 前置扫描件声明**

业务关联接口接收 `expectedRevision + frozenDocumentId + uploadedFileId + declaration`，锁 SettlementDraft，验证经办人、revision、受治理 marker 和原冻结版 hash；读取 FileObject 原 buffer，强制 active/本人上传/PDF/size/SHA/可解析/页数一致，不 normalize/resave。人工声明：扫描件与该编号/revision 冻结版页序一致、乙方每个需要签字处已签名并填写日期、每页盖章、多页骑缝章。禁 OCR，因此页面顺序和签章真伪不得冒充系统自动识别；系统只核 revision/hash/页数/可叠加尺寸与声明审计。

- [x] **Step 5: 过程/最终路线一致**

最终结算不增加审批岗位，只在同一提交事务中增加五项结构化完结校验：合同范围内应结事项已完成；历史过程结算已完整纳入累计数据；不存在尚未处理的结算草稿或审批中结算；本次累计结算符合当前有效合同金额上限；合同员已明确选择“最终结算”并确认后续不再发起普通过程结算。五项分别持久化输入/快照并逐项测试，不能用一条总确认代替。任一失败均保留草稿、上传件和已选人员，使用可持久的 tagged denial 审计并返回可操作提示。

- [x] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/permissions.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/settlement/settlement-participant-freeze.spec.ts src/settlement/settlement-counterparty-document.service.spec.ts src/settlement/settlement-draft.controller.spec.ts src/settlement/settlement.controller.spec.ts src/settlement/settlement-draft.service.spec.ts src/settlement/settlement-submission.service.spec.ts src/settlement/settlement.service.spec.ts src/approval/approval-node-access.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/pages/settings/approval-flow-readonly.config.test.ts && pnpm --filter @jiangkong/shared-domain typecheck && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint && pnpm --filter @jiangkong/api check:business-errors`

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add packages/shared-domain/src/permissions* services/api/src/settlement apps/web-admin/src/pages/settings/approval-flow-readonly.config*
git commit -m "feat: 冻结结算审批参与人与签前文件"
```

> Task 17 已于 2026-07-18 完成实现并通过规格/质量双复审 READY。部署后新建或重新保存的结算草稿一律进入治理版本 1，历史有效合同的新结算也不能绕过；旧未提交草稿须先重新保存补齐现场复核人、冻结版和乙方签章原件，直接 `POST /settlements` 零业务写拒绝。材料/机械与劳务/专业分包按所属项目冻结具体现场人员、唯一项目总工及公司级审批候选，过程/最终路线一致，预算岗位只保留可选资格，公司工程技术部部长永久移除。专用关联接口绑定项目和 revision，按稳定顺序锁草稿、文档和文件，校验原字节、SHA、所有权、PDF 大小/页数/方向/尺寸和人工声明；替代图拒绝跨父业务、跨用途、多后继和循环，并把序列化/唯一冲突映射为稳定中文结果。五项最终结算事实分别持久化和逐项重验；合同锁同时阻断已有最终结算后的新草稿、重复最终结算和后续普通过程结算，路线冻结、最终事实与文件门禁拒绝均可追溯审计。两个真实 PrismaClient 并发关联同一 uploadedFileId 的结果为一笔成功、一笔稳定中文重试拒绝，数据库仅一条 committed binding；Contract 锁域探针中真实草稿创建等待约 718ms，最终结算事实提交后复读拒绝且未生成草稿。fresh PostgreSQL 16 已再次从 M1 连续执行到 M56，56/56 成功，五项字段两表共 10 列、三项关键约束核对通过；临时容器全部清理。未连接或修改生产。

### Task 18: A4 横向冻结版、逐页签名区和最终合成件

> **执行校正（2026-07-17 合成与归档审计）**：终审事务不能在外部 PDF I/O 成功前直接进入待归档。使用两阶段幂等生成：终审事务锁 Settlement/ApprovalInstance 并落 `pending_generation` 事实；外部读取乙方原始 buffer、合成并上传后，第二事务重新锁定并核对 governanceVersion、原始 hash、业务 snapshot token 和审批动作集合 hash，再激活唯一最终件并进入 `pending_archive_confirm`。失败保留可重试状态与审计，绝不直接 effective。

**Files:**
- Create: `services/api/src/settlement/settlement-signed-document.service.ts`
- Create: `services/api/src/settlement/settlement-signed-document.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-document-renderer.ts`
- Modify: `services/api/src/settlement/settlement-document-renderer.spec.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-read.service.ts`
- Modify: `services/api/src/settlement/settlement-read.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.controller.ts`
- Modify: `services/api/src/settlement/settlement.controller.spec.ts`
- Create: `services/api/src/settlement/dto/settlement-signed-document-action.dto.ts`
- Modify: `services/api/src/settlement/settlement.module.ts`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`
- Modify: `services/api/src/archive/archive.service.ts`
- Modify: `services/api/src/archive/archive.service.spec.ts`
- Modify: `services/api/src/me/me.service.ts`
- Modify: `services/api/src/me/me.service.spec.ts`
- Modify: `packages/shared-domain/src/core-flow-read-model.ts`

- [ ] **Step 1: 写一页/多页、重复表头和签名漂移失败测试**

```ts
expect(await pageCount(renderSettlementDraftPdf(onePage))).toBe(1);
expect(await extractPageMarkers(multiPage)).toEqual(["第 1/3 页", "第 2/3 页", "第 3/3 页"]);
expect(await eachPageHasHeaders(multiPage, [
  "序号", "名称", "规格型号", "单位", "数量", "不含税单价", "含税单价",
  "税率", "不含税金额", "税额", "含税金额", "备注"
])).toBe(true);
expect(await signatureIds(finalPdf)).toContain("signature-at-approval");
expect(await signatureIds(finalPdf)).not.toContain("signature-after-profile-update");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/settlement/settlement-document-renderer.spec.ts src/settlement/settlement-signed-document.service.spec.ts src/settlement/settlement.service.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 冻结版每页固定结构**

PDF 使用 A4 横向并逐页断言 MediaBox/CropBox/rotation；每页显示编号、文件 revision、页码/总页数，重复完整表头：序号、名称、规格型号、单位、数量、不含税/含税单价、税率、不含税金额、税额、含税金额、备注。每页底部预印单行最多 7 格“岗位—签名—日期”，字号可读、不裁切；材料/机械为乙方/编制人/物资员/物资主管/合同部主管/项目经理/财务主管，劳务/专业对应乙方/编制人/选定工长或施工员/项目总工/合同部主管/项目经理/财务主管。一页、边界换页、多页均逐页测试。

- [ ] **Step 4: 在乙方原始扫描件上叠加冻结签名**

使用 `pdf-lib` 只读加载乙方原始扫描 buffer，按页面尺寸/rotation/crop 映射固定签名格；嵌入编制人提交时签名和 M54 审批动作签名，日期使用审批发生日期，绝不回查 User 当前签名。原始扫描件永不 normalize/resave，原始 fileId/SHA 与最终新 FileObject/fileId/SHA 永久保留。数据库 SHA 为空/非法/与对象字节不符、替换后旧 original、尺寸不可叠加均阻断并审计。

- [ ] **Step 5: 最终审批后自动生成，合同部主管确认生效**

全部节点通过后仅进入 `pending_generation`；生成器以 M56 partial unique + CAS 防双终审/双任务/双 active final。上传成功但业务关联失败、进程崩溃和网络重试必须可复用/清理孤儿文件并幂等恢复；原始 hash、业务 snapshot token 或审批动作集合任一漂移即失败，不得激活。成功后进入 `pending_archive_confirm`，正常新流程禁用审批后手工上传普通 `SettlementArchiveFile`；旧 governanceVersion 为空的历史实例继续双读旧语义，直到 Task 22 受控终止重提。

合同部主管确认只接受 active `final_internal_signed_copy`，锁 Settlement/文档并复核原始 hash、snapshot token、审批动作集合后才 effective；旧 archiveFileId 不能确认新流程。read/file/archive/me 全部接入双证据：资料库和详情展示乙方原件/最终合成件，文件下载执行项目 ACL/用途/短票/审计；待办不再提示新流程“审批后上传归档件”。重新生成 endpoint 使用 DTO、权限和审计，只允许纯渲染问题且事实未变。

- [ ] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/settlement/settlement-document-renderer.spec.ts src/settlement/settlement-signed-document.service.spec.ts src/settlement/settlement.controller.spec.ts src/settlement/settlement.service.spec.ts src/settlement/settlement-read.service.spec.ts src/approval/approval-signature-snapshot.spec.ts src/file/file.service.spec.ts src/archive/archive.service.spec.ts src/me/me.service.spec.ts && pnpm --filter @jiangkong/shared-domain typecheck && pnpm --filter @jiangkong/api typecheck && pnpm --filter @jiangkong/api lint && pnpm --filter @jiangkong/api check:business-errors`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/shared-domain/src/core-flow-read-model.ts services/api/src/settlement services/api/src/file/file.service* services/api/src/archive/archive.service* services/api/src/me/me.service*
git commit -m "feat: 生成结算逐页冻结签名合成件"
```

### Task 19: 结算工作台和详情闭环

**Files:**
- Create: `apps/web-admin/src/pages/settlements/components/SettlementApprovalParticipantSelect.vue`
- Create: `apps/web-admin/src/pages/settlements/components/SettlementCounterpartySignedPdfPanel.vue`
- Create: `apps/web-admin/src/pages/settlements/components/SettlementSignatureEvidencePanel.vue`
- Modify: `apps/web-admin/src/api/settlement-drafts.api.ts`
- Modify: `apps/web-admin/src/api/settlement-drafts.api.test.ts`
- Modify: `apps/web-admin/src/api/settlement-workbench.api.ts`
- Modify: `apps/web-admin/src/api/settlement-workbench.api.test.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.test.ts`
- Modify: `apps/web-admin/src/pages/settlements/SettlementWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/settlements/SettlementDetailPage.vue`
- Modify: `apps/web-admin/src/pages/settlements/settlement-workbench.state.ts`
- Modify: `apps/web-admin/src/pages/settlements/settlement-workbench.state.test.ts`
- Modify: `apps/web-admin/src/pages/settlements/settlement-workbench.structure.test.ts`
- Modify: `apps/web-admin/src/pages/settlements/settlement-detail.config.ts`
- Modify: `apps/web-admin/src/pages/settlements/settlement-detail.config.test.ts`
- Create: `apps/web-admin/e2e/settlement-signature-governance.e2e.ts`

- [ ] **Step 1: 写步骤顺序、上传和详情失败测试**

```ts
expect(workbenchSteps).toEqual([
  "录入结算事实", "选择现场复核人", "生成冻结结算单", "上传乙方签章扫描件", "提交审批"
]);
expect(counterpartyPanelSource).toContain("<t-upload");
expect(detailEvidenceKinds).toEqual(["counterparty_signed_original", "final_internal_signed_copy"]);
expect(detailSource).not.toContain("审批通过后上传归档件");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/settlement-drafts.api.test.ts src/api/settlement-workbench.api.test.ts src/pages/settlements/settlement-workbench.state.test.ts src/pages/settlements/settlement-workbench.structure.test.ts src/pages/settlements/settlement-detail.config.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现工作台顺序和状态保持**

参与人选择、冻结 PDF 下载、扫描件上传和声明放在宽表格滚动区之外。申请金额或文件未就绪时主按钮说明下一步；接口失败保留草稿、选定人员和上传结果。

- [ ] **Step 4: 详情展示双证据和生成状态**

使用 `EvidenceFileCards` 展示乙方原始扫描件、最终合成件、审批时间线和合同部确认；重新生成使用 `SensitiveActionDialog`，加载中禁用依赖详情的动作。

- [ ] **Step 5: 运行 Web 定向测试与 E2E**

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/settlement-drafts.api.test.ts src/api/settlement-workbench.api.test.ts src/api/core-flow-read.api.test.ts src/pages/settlements/settlement-workbench.state.test.ts src/pages/settlements/settlement-workbench.structure.test.ts src/pages/settlements/settlement-detail.config.test.ts && pnpm --filter @jiangkong/web-admin typecheck && pnpm --filter @jiangkong/web-admin typecheck:e2e && pnpm --filter @jiangkong/web-admin lint && pnpm --filter @jiangkong/web-admin check:ui && pnpm --filter @jiangkong/web-admin build && CI=true pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.config.ts e2e/settlement-signature-governance.e2e.ts e2e/settlement-workbench.e2e.ts e2e/ui-p1-settlement-visual.e2e.ts`

Expected: PASS；无文档级横向溢出和嵌套横滚。

- [ ] **Step 6: 提交**

```bash
git add apps/web-admin/src/api/settlement-* apps/web-admin/src/api/core-flow-read.api* apps/web-admin/src/pages/settlements apps/web-admin/e2e/settlement-signature-governance.e2e.ts apps/web-admin/e2e/settlement-workbench.e2e.ts apps/web-admin/e2e/ui-p1-settlement-visual.e2e.ts
git commit -m "feat: 完善结算签章审批工作台"
```

### Task 20: 通用合同直接付款和其他合同付款来源负向约束

**Files:**
- Modify: `services/api/src/payment/payment-read.service.ts`
- Modify: `services/api/src/payment/payment-read.service.spec.ts`
- Modify: `services/api/src/payment/payment-request.service.ts`
- Modify: `services/api/src/payment/payment-request.service.spec.ts`
- Modify: `apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/payments/payment-workbench.structure.test.ts`

- [ ] **Step 1: 写通用合同与其他合同来源失败测试**

```ts
expect(genericApplication.availableStages).toEqual(frozenContractStages);
await expect(createContractDue({ contractTypeKey: "material_purchase", settlementId: null }))
  .rejects.toThrow("该合同类型应从生效结算发起付款");
await expect(createContractDue({ contractTypeKey: "generic_contract", stageId: "manual" }))
  .rejects.toThrow("请选择合同已冻结的付款阶段");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/payment/payment-read.service.spec.ts src/payment/payment-request.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/pages/payments/payment-workbench.structure.test.ts`

Expected: FAIL。

- [ ] **Step 3: 限定既有 contract_due 入口**

不新建付款流程；复用现有 `contract_due` 和后端额度核算。通用合同必须引用 effective contract version、effective payment terms version 和其中的 stage；材料/机械/劳务/专业的进度付款继续引用生效结算，合同预付款既有合法场景保持原逻辑。

- [ ] **Step 4: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/payment/payment-read.service.spec.ts src/payment/payment-request.service.spec.ts src/payment/settlement-payment-capacity.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/pages/payments/payment-workbench.structure.test.ts`

Expected: PASS；元分和可付额度测试无变化。

- [ ] **Step 5: 提交**

```bash
git add services/api/src/payment apps/web-admin/src/pages/payments/PaymentWorkbenchPage.vue apps/web-admin/src/pages/payments/payment-workbench.structure.test.ts
git commit -m "feat: 限定通用合同直接付款来源"
```

### Task 21: 历史主体匹配、跨域只读和文件 ACL 加固

**Files:**
- Create: `apps/web-admin/src/pages/contracts/components/HistoricalCompanyEntityMatchPanel.vue`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.service.spec.ts`
- Modify: `services/api/src/file/file.service.spec.ts`
- Modify: `services/api/src/approval/approval-form.service.spec.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractTakeoverPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-takeover.config.test.ts`
- Modify: `apps/web-admin/src/pages/business-readonly-access.test.ts`
- Modify: `apps/web-admin/src/routes/index.test.ts`

- [ ] **Step 1: 写停用主体匹配和负向权限测试**

```ts
expect(await takeoverOptions()).toContainEqual(expect.objectContaining({ id: "inactive-entity", isActive: false }));
await expect(financeUser.uploadContractFile()).rejects.toThrow();
await expect(comprehensiveUser.confirmContractArchive()).rejects.toThrow();
await expect(projectOnlyContractStaff.maintainCompanyEntity()).rejects.toThrow();
await expect(financeUser.downloadUnrelatedPrivateFile()).rejects.toThrow();
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.service.spec.ts src/file/file.service.spec.ts src/approval/approval-form.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-takeover.config.test.ts src/pages/business-readonly-access.test.ts src/routes/index.test.ts`

Expected: FAIL 或暴露缺少的负向断言。

- [ ] **Step 3: 实现历史匹配而不改原文文件**

历史接管可关联停用/待补全主体，并保留原合同主体名称。匹配错误走既有“合同员更正 → 合同部主管确认”账本；不修改扫描件，不把非法代码猜成合法值。

- [ ] **Step 4: 加固只读、导出和附件边界**

保持 `HISTORICAL_CONTRACT_TAKEOVER_READ_ROLE_KEYS` 与 `CONTRACT_SETTLEMENT_LEDGER_EXPORT_ROLE_KEYS`；写接口继续走原 `BUSINESS_ACTIONS`。公司主体无导出。文件下载仍需业务 ACL、密码/用途、短票和 `file.download.ticket/file.download` 审计。

- [ ] **Step 5: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract-takeover/contract-takeover.service.spec.ts src/contract-takeover/contract-takeover.controller.spec.ts src/file/file.service.spec.ts src/approval/approval-form.service.spec.ts src/auth/guards/permission.guard.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-takeover.config.test.ts src/pages/business-readonly-access.test.ts src/routes/index.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add services/api/src/contract-takeover services/api/src/file/file.service.spec.ts services/api/src/approval/approval-form.service.spec.ts apps/web-admin/src/pages/contracts apps/web-admin/src/pages/business-readonly-access.test.ts apps/web-admin/src/routes/index.test.ts
git commit -m "fix: 加固历史主体与跨域只读边界"
```

### Task 22: 全量回归、迁移演练、UAT 和发布候选

> **执行校正（2026-07-17 过渡审计）**：批准规格要求“历史不改、未生效重走”，不能只在报告里列清单。候选必须包含默认只读的预览/受控终止工具及测试，但本任务只生成预览清单并演练隔离库；未经用户对最终 40 位 SHA、精确实例 manifest 和生产写入再次批准，不得在生产运行 apply。M53-M56 迁移本身永不自动终止实例。

**Files:**
- Modify: `services/api/prisma/verify-trial-run.cjs`
- Create: `services/api/prisma/transition-contract-settlement-governance.cjs`
- Create: `services/api/src/database/contract-settlement-governance-transition.spec.ts`
- Create: `docs/progress/2026-07-17-contract-settlement-governance-release-candidate.md`
- Create: `docs/superpowers/runbooks/2026-07-17-contract-settlement-governance-release.md`
- Modify: `GO_LIVE_P0_RELEASE_CANDIDATE_REPORT.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 建立默认只读、manifest 驱动的旧实例过渡工具**

`transition-contract-settlement-governance.cjs` 默认在 `READ ONLY` 事务中输出正在审批、待用章、待归档的未生效合同/结算清单、当前状态、审批实例、关联正式文件和建议动作，且不输出文件对象键或敏感内容。`--apply` 必须同时提供：精确候选 SHA、显式 `ALLOW_GOVERNANCE_TRANSITION_APPLY` 确认串、操作者用户 ID、由预览生成且未被修改的实例 manifest；任一行状态、版本、审批实例或摘要漂移则整批回滚。

apply 在单事务按稳定顺序锁定 manifest 中的合同/结算版本和 ApprovalInstance，旧实例标记“因业务规则升级终止”，写 ApprovalActionLog 与 AuditLog；未生效单据回到可补资料并重新提交的状态，相关 active 正式文件按模型标记失效，不删除原文件或旧日志。已生效/归档/作废、付款/实付/入账、manifest 外记录一律不改。脚本幂等，重复执行只报告已处理，不重复审计。定向测试覆盖默认只读、缺门禁拒绝、manifest 漂移全回滚、精确状态迁移、历史日志保留和付款零改动。

- [ ] **Step 2: 扩展隔离 UAT 覆盖**

`verify-trial-run.cjs` 使用隔离测试数据覆盖：五类合同、主管发起跳过、最终或签、双方授权四组合、用章/最终归档、增项 9.99%/10%/10.01%、材料和劳务结算、一页/多页签名、通用合同直接付款、跨域只读负向权限。不得连接生产业务库执行写入。

- [ ] **Step 3: 运行所有定向测试**

Run:

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test -- --runInBand \
  src/company-entity src/approval src/contract src/contract-workbench \
  src/contract-takeover src/settlement src/payment src/file \
  src/database/contract-settlement-governance-transition.spec.ts
pnpm --filter @jiangkong/web-admin test -- \
  src/api src/pages/company-entities src/pages/contracts src/pages/settlements \
  src/pages/payments src/pages/business-readonly-access.test.ts src/routes/index.test.ts
```

Expected: PASS。

- [ ] **Step 4: 运行工程质量全量门禁**

```bash
pnpm --filter @jiangkong/shared-domain typecheck
pnpm --filter @jiangkong/shared-domain lint
pnpm --filter @jiangkong/api prisma validate
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api test
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin typecheck:e2e
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin test
pnpm --filter @jiangkong/web-admin build
pnpm --filter @jiangkong/web-admin test:e2e:p0
git diff --check
```

Expected: 全部 PASS；条件跳过项逐条记录原因。

- [ ] **Step 5: 浏览器验证**

使用稳定 mock/隔离数据验证 1512×982、1440×900、1280×800、1180×820、1024×768、900×768：公司主体、五类合同、合同详情、变更、材料/劳务结算、结算详情、付款工作台和只读台账。根文档横向溢出、嵌套横滚和 pageerror 必须为 0。

- [ ] **Step 6: 隔离库迁移与旧实例过渡演练**

从生产备份恢复到 `jiangkong_restore_*`，使用精确候选 SHA 依次应用 M52-M56；核对迁移数、表/索引、旧 51 迁移事实、存量空信用代码、历史审批 JSON、金额计数和只读查询。先运行 transition preview，再只在隔离库对复制的 manifest 执行 apply，验证终止审计、草稿恢复、正式文件失效、幂等和付款零变化；清理隔离库。不得连接或修改生产业务库。

- [ ] **Step 7: 生成发布候选报告和 runbook**

报告必须记录：40 位 SHA、相对生产和 main 提交、实际文件、4 个新增迁移、隔离演练、测试、截图、旧未生效实例预览 manifest 及摘要、未解决项、应用回滚和数据库前向修复方案。runbook 明确将“部署/迁移”和“按 manifest 终止旧实例”分成两次独立授权，禁止因批准部署而推定批准生产业务写入。

- [ ] **Step 8: 最终提交并停止在发布候选**

```bash
git add services/api/prisma/verify-trial-run.cjs services/api/prisma/transition-contract-settlement-governance.cjs services/api/src/database/contract-settlement-governance-transition.spec.ts docs/progress/2026-07-17-contract-settlement-governance-release-candidate.md docs/superpowers/runbooks/2026-07-17-contract-settlement-governance-release.md GO_LIVE_P0_RELEASE_CANDIDATE_REPORT.md PROGRESS.md
git commit -m "test: 收口合同结算治理发布候选"
```

提交后报告目标 SHA 并停止。未经用户针对该 SHA 明确批准，不得推送、部署、执行生产迁移或终止旧实例。

## 4. 每任务统一审查清单

每个 subagent 返回后，主代理必须逐项检查：

1. `git diff --check`。
2. 只修改任务文件；无用户未提交修改被覆盖。
3. M52 diff 始终为空。
4. 金额使用 `bigint`/Decimal/分，不使用浮点或前端作为事实源。
5. 新节点冻结具体人员；历史 role-only JSON 可读。
6. 新审批签名来自动作快照，不读用户当前签名冒充历史。
7. 上传原件 SHA 对应原字节，未被 PDF normalize 重写。
8. 公司主体权限只认 `UserPosition.projectId IS NULL`。
9. 读权限没有扩成 create/update/upload/confirm。
10. 新 Web 页面只用 TDesign 和 `--jg-*` token，不扩大原生控件/UI 例外。
11. 页面主操作唯一；文件/反馈/页头不进入宽表横向滚动区。
12. 更新 `PROGRESS.md` 并形成独立 Conventional Commit。

## 5. 发布与回滚边界

- 应用回滚：保留前一生产 SHA，候选失败时只允许按 runbook 回退 Web/API；不得对已产生新格式业务事实执行盲目代码回退。
- 数据库：M53-M56 采用向后兼容增量列/表；生产迁移前备份并验证异机恢复。迁移应用后不执行自动 down migration，失败按前向修复处理。
- 业务切换：上线前列出未生效旧合同/结算实例，由用户另行授权后才能终止并要求重提；迁移本身不得自动终止。
- 生产：只有用户明确批准最终 40 位 SHA 后，才可以进入 push、部署、迁移和生产只读/受控写验证。
