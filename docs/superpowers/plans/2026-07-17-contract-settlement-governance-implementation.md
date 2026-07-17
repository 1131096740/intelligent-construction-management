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
  unifiedSocialCreditCode: "91350211M000100Y43",
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

**Files:**
- Create: `apps/web-admin/src/api/company-entity.api.ts`
- Create: `apps/web-admin/src/api/company-entity.api.test.ts`
- Create: `apps/web-admin/src/pages/company-entities/CompanyEntityListPage.vue`
- Create: `apps/web-admin/src/pages/company-entities/company-entity.config.ts`
- Create: `apps/web-admin/src/pages/company-entities/company-entity.config.test.ts`
- Create: `apps/web-admin/src/pages/company-entities/components/CompanyEntityFormDrawer.vue`
- Create: `apps/web-admin/src/pages/company-entities/components/CompanyEntityHistoryDrawer.vue`
- Modify: `apps/web-admin/src/routes/route-records.ts`
- Modify: `apps/web-admin/src/routes/index.test.ts`
- Modify: `apps/web-admin/src/pages/settings/SettingsPage.vue`
- Modify: `apps/web-admin/scripts/check-ui-rules.mjs`

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

使用 `BusinessPageHeader`、`BusinessTableToolbar`、`BusinessFeedback`、`t-table`、`t-drawer` 和 `SensitiveActionDialog`。页面显示启用/停用、资料待补全、当前与历史搜索，不提供删除、回滚或导出。将 `SettingsPage.vue` 的旧公司主体维护区删除，避免双入口。

- [ ] **Step 5: 登记响应式治理并运行检查**

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/company-entity.api.test.ts src/pages/company-entities/company-entity.config.test.ts src/routes/index.test.ts && pnpm --filter @jiangkong/web-admin typecheck && pnpm --filter @jiangkong/web-admin lint && pnpm --filter @jiangkong/web-admin check:ui`

Expected: PASS；新页是 ledger，只有表格区域横向滚动。

- [ ] **Step 6: 提交**

```bash
git add apps/web-admin/src/api/company-entity.api* apps/web-admin/src/pages/company-entities apps/web-admin/src/routes apps/web-admin/src/pages/settings/SettingsPage.vue apps/web-admin/scripts/check-ui-rules.mjs
git commit -m "feat: 增加我方公司主体独立台账"
```

### Task 6: 合同草稿选择主体并在提交时冻结 M53 快照

**Files:**
- Modify: `services/api/src/contract/dto/create-contract.dto.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.spec.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractBasicSection.vue`
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
    companyEntityCreditCodeSnapshot: "91350211M000100Y43"
  })
}));
expect(componentSource).not.toContain('v-model="draft.myCompanyEntity"');
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract.service.spec.ts src/contract-workbench/contract-readiness.service.spec.ts src/contract-workbench/contract-workbench.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts`

Expected: FAIL。

- [ ] **Step 3: 保存稳定 ID，提交时锁定当前主体版本**

```ts
const entity = await tx.companyEntity.findUnique({ where: { id: contract.companyEntityId! } });
if (!entity?.isActive) throw new BadRequestException("所选我方公司主体已停用，请回到基本信息重新选择");
if (entity.dataStatus !== "complete") throw new BadRequestException("所选我方公司主体资料待补全，请先到我方公司主体页面完善信用代码");
const entityVersion = await tx.companyEntityVersion.findFirst({
  where: { companyEntityId: entity.id, versionNo: entity.currentVersionNo }
});
if (!entityVersion) throw new BadRequestException("我方公司主体版本缺失，请联系合同部核对后重试");
```

把快照列写入同一 `contractVersion.updateMany` 提交事务；变更草稿继承原版本快照并禁止换主体。

- [ ] **Step 4: 将基本信息改为启用主体选择器**

组件保存 `companyEntityId`，显示名称、信用代码、注册地址；保留旧 `myCompanyEntity` 只读兼容映射，不能继续作为新合同输入事实。主体停用或更新时显示同步提示，重新选择会使旧预览失效。

主体候选只按“已启用且资料完整”筛选，不按项目绑定公司；同一项目必须能够为不同合同选择不同的已启用主体。增加回归测试，防止未来引入项目到主体的一对一限制。

- [ ] **Step 5: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract.service.spec.ts src/contract-workbench/contract-readiness.service.spec.ts src/contract-workbench/contract-workbench.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add services/api/src/contract services/api/src/contract-workbench apps/web-admin/src/api/contract-workbench.api* apps/web-admin/src/pages/contracts/workbench
git commit -m "feat: 冻结合同我方主体版本"
```

### Task 7: M54 冻结审批候选人员和动作签名

**Files:**
- Create: `services/api/prisma/migrations/20260717120000_approval_assignee_and_signature_snapshots/migration.sql`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/database/approval-signature-snapshot-schema-verification.spec.ts`
- Create: `services/api/src/approval/approval-signature-snapshot.ts`
- Create: `services/api/src/approval/approval-signature-snapshot.spec.ts`
- Modify: `services/api/src/approval/approval-node-access.ts`
- Modify: `services/api/src/approval/approval-node-access.spec.ts`
- Modify: `services/api/src/approval/approval-form.service.ts`
- Modify: `services/api/src/approval/approval-form.service.spec.ts`

- [ ] **Step 1: 写候选人员和签名漂移失败测试**

```ts
expect(canActOnFrozenApprovalNode(
  [{ roleKeys: ["finance_director"], candidateUserIds: ["finance-1"] }],
  0, ["finance_director"], "finance-2"
)).toBe(false);
expect(renderedSignatureFileIds).toEqual(["signature-at-approval"]);
expect(renderedSignatureFileIds).not.toContain("current-signature");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/approval/approval-node-access.spec.ts src/approval/approval-signature-snapshot.spec.ts src/approval/approval-form.service.spec.ts src/database/approval-signature-snapshot-schema-verification.spec.ts`

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
  selectedUserId?: string;
  approvedRoleKeys?: RoleKey[];
  assignments?: ApprovalAssignment[];
}
```

- [ ] **Step 4: 审批动作写入签名快照，审批单优先读快照**

```ts
const signature = await snapshotApprovalSignature(tx, actorUserId, approvedRoleKey);
await tx.approvalActionLog.create({
  data: {
    approvalInstanceId: instance.id,
    action: "approve",
    actorUserId,
    approvedRoleKey,
    signatureFileIdSnapshot: signature.fileId,
    signatureSha256Snapshot: signature.sha256,
    metadata: actionMetadata
  }
});
```

旧日志无快照时只显示“历史签名未冻结”，不得读取当前签名伪造历史。

- [ ] **Step 5: 运行定向测试和 Prisma 验证**

Run: `pnpm --filter @jiangkong/api prisma validate && pnpm --filter @jiangkong/api test -- --runInBand src/approval/approval-node-access.spec.ts src/approval/approval-signature-snapshot.spec.ts src/approval/approval-form.service.spec.ts src/database/approval-signature-snapshot-schema-verification.spec.ts`

Expected: PASS；旧 role-only `frozenNodes` 仍能读取。

- [ ] **Step 6: 提交**

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations/20260717120000_approval_assignee_and_signature_snapshots services/api/src/approval services/api/src/database/approval-signature-snapshot-schema-verification.spec.ts
git commit -m "feat: 冻结审批人员与签名事实"
```

### Task 8: 五类新合同审批路线和人员冻结

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
expect(await routes.freezeNewContractRoute(materialContract, "staff-1")).toMatchObject([
  { roleKeys: ["contract_director"] },
  { roleKeys: ["material_director"] },
  { roleKeys: ["project_manager"] },
  { roleKeys: ["finance_director"] },
  { roleKeys: ["chairman", "general_manager"] }
]);
expect((await routes.freezeNewContractRoute(genericContract, "director-1"))[0].roleKeys)
  .toEqual(["comprehensive_director"]);
await expect(routes.freezeNewContractRoute(laborContract, "staff-1"))
  .rejects.toThrow("所属项目的项目总工配置缺失或冲突");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/permissions.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-approval-route.service.spec.ts src/contract/contract.service.spec.ts`

Expected: FAIL。

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

解析候选时排除申请人；主管发起时删除第一个主管节点。节点缺候选时阻止提交。审批 review 对新节点强制 candidate/selected user；转交和委托保持既有审计，历史 role-only 节点兼容。

- [ ] **Step 4: 补粗粒度入口岗位但不扩大其他写权限**

`contract.approve` 只增加 `material_director`、`comprehensive_director`、`engineering_director`，具体节点仍由冻结人员校验；不把这些岗位加入 create、submit、archive 或 tax confirm。

- [ ] **Step 5: 运行定向测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/permissions.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-approval-route.service.spec.ts src/contract/contract.service.spec.ts src/approval/approval-node-access.spec.ts src/approval/approval-self-review.spec.ts`

Expected: PASS；付款和项目支出既有领导自审测试不变。

- [ ] **Step 6: 提交**

```bash
git add packages/shared-domain/src/permissions* services/api/src/contract apps/web-admin/src/pages/settings/approval-flow-readonly.config*
git commit -m "feat: 按合同类型冻结审批路线"
```

### Task 9: M55 合同正式文件、双方授权书和用章任务

**Files:**
- Create: `services/api/prisma/migrations/20260717130000_contract_formal_documents_authorizations_and_seal_tasks/migration.sql`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/database/contract-governance-files-schema-verification.spec.ts`
- Create: `services/api/src/contract/contract-formal-pdf-inspector.ts`
- Create: `services/api/src/contract/contract-formal-pdf-inspector.spec.ts`

- [ ] **Step 1: 写模型和原字节失败测试**

```ts
expect(schema).toContain("model ContractFormalFile");
expect(schema).toContain("model ContractAuthorization");
expect(schema).toContain("model ContractVersionAuthorizationLink");
expect(schema).toContain("model ContractSealTask");
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
  createdAt         DateTime  @default(now())
  @@index([contractVersionId, purpose, status])
}

model ContractAuthorization {
  id                String   @id @default(uuid())
  side              String
  grantorName       String
  agentName         String
  scopeSummary      String
  fileId            String
  contentSha256     String
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
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}
```

保留 `ContractArchiveFile` 作为旧历史兼容，不迁移猜测旧文件用途。

- [ ] **Step 4: 只读检查 PDF**

`contract-formal-pdf-inspector.ts` 使用 `pdf-lib` 加载原 buffer，仅返回 SHA、页数、页面尺寸/旋转；不保存 `PDFDocument.save()` 输出。

- [ ] **Step 5: 运行 Prisma 和定向测试**

Run: `pnpm --filter @jiangkong/api prisma validate && pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-formal-pdf-inspector.spec.ts src/database/contract-governance-files-schema-verification.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations/20260717130000_contract_formal_documents_authorizations_and_seal_tasks services/api/src/contract/contract-formal-pdf-inspector* services/api/src/database/contract-governance-files-schema-verification.spec.ts
git commit -m "feat: 增加合同签署与授权证据结构"
```

### Task 10: 合同审批前正式 PDF、双方授权和就绪门禁

**Files:**
- Create: `services/api/src/contract/contract-formal-file.service.ts`
- Create: `services/api/src/contract/contract-formal-file.service.spec.ts`
- Create: `services/api/src/contract/contract-authorization.service.ts`
- Create: `services/api/src/contract/contract-authorization.service.spec.ts`
- Modify: `services/api/src/contract/contract.module.ts`
- Modify: `services/api/src/contract/contract.controller.ts`
- Modify: `services/api/src/contract/contract.controller.spec.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`

- [ ] **Step 1: 写四种授权组合和修订一致性失败测试**

```ts
await expect(readiness.check(tx, version, contract, true)).resolves.toMatchObject({
  blocking: expect.arrayContaining([expect.objectContaining({ code: "counterparty_signed_pdf_missing" })])
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

- [ ] **Step 4: 实现授权选择与复用**

我方和乙方各保存一条 link；`required=false` 时 authorization 必须为空，`required=true` 时必须关联新上传或可复用授权。复用校验同一合同、代理人相同且范围摘要明确包含签署/履行/变更及补充协议。

- [ ] **Step 5: 合并到提交事务**

`submitApproval()` 在改变状态和创建实例前依次验证主体快照、正式文件、授权和审批人员。任何失败保持草稿及已填内容。

- [ ] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-formal-file.service.spec.ts src/contract/contract-authorization.service.spec.ts src/contract-workbench/contract-readiness.service.spec.ts src/contract/contract.service.spec.ts src/file/file.service.spec.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add services/api/src/contract services/api/src/contract-workbench
git commit -m "feat: 增加合同签前文件与授权门禁"
```

### Task 11: 合同工作台正式文件和授权 UI

**Files:**
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractFormalDocumentSection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractAuthorizationSection.vue`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractDocumentsSection.vue`
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

- [ ] **Step 3: 实现两块域组件**

顺序固定为“合同文档预览 → 乙方签章正式 PDF → 双方授权书 → 提交就绪”。页面只保留“提交审批”为主操作，生成/下载/上传为次级；上传失败不清空主体、税务、清单和授权选择。

- [ ] **Step 4: 运行 Web 定向测试和 UI 检查**

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts src/pages/contracts/contract-workbench-canvas.structure.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts && pnpm --filter @jiangkong/web-admin typecheck && pnpm --filter @jiangkong/web-admin lint && pnpm --filter @jiangkong/web-admin check:ui`

Expected: PASS；不扩大原生文件控件 allowlist。

- [ ] **Step 5: 提交**

```bash
git add apps/web-admin/src/api/contract-workbench.api* apps/web-admin/src/pages/contracts apps/web-admin/e2e/contract-workbench-canvas.e2e.ts
git commit -m "feat: 完善合同签前文件工作台"
```

### Task 12: 同意用章、线下盖章、最终文件与归档职责分离

**Files:**
- Create: `services/api/src/contract/contract-seal.service.ts`
- Create: `services/api/src/contract/contract-seal.service.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract-status.service.ts`
- Modify: `services/api/src/contract/contract-status.service.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`
- Modify: `services/api/src/approval/approval-form.service.ts`
- Modify: `services/api/src/approval/approval-form.service.spec.ts`

- [ ] **Step 1: 写状态和职责分离失败测试**

```ts
expect(await service.reviewApproval(versionId, finalApprover, { decision: "approve" }))
  .toMatchObject({ status: "approved_pending_seal" });
expect(await seal.approve(versionId, comprehensiveDirector)).toMatchObject({ status: "in_seal" });
expect(await seal.complete(versionId, handler)).toMatchObject({ status: "seal_approved_pending_archive" });
await expect(service.confirmArchiveFile(versionId, uploader, input)).rejects.toThrow("上传人与归档确认人不能是同一人");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-seal.service.spec.ts src/contract/contract-status.service.spec.ts src/contract/contract.service.spec.ts src/approval/approval-form.service.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 修正状态机和用章任务**

最终审批事务创建 `ContractSealTask(status='pending_approval')`；综合部主管“同意用章”后版本进入 `in_seal`，经办人确认线下签字盖章完成后进入 `seal_approved_pending_archive`。动作分别审计为 `contract.seal.approve` 和 `contract.seal.complete`。

- [ ] **Step 4: 最终签署版与审批版差异边界**

最终上传使用 `ContractFormalFile(purpose='mutually_signed_final')`；服务至少校验 PDF、版本、页数和原审批版存在。系统不机械判断文件内容差异，由上传人明确声明最终版相对审批版只新增我方签名、公司印章和日期；合同部主管确认时再次确认该声明，强制 uploader != confirmer，并生成生效事实。上传、确认、退回和声明内容均写审计。

- [ ] **Step 5: 合同审批单使用冻结签名并加固下载授权**

审批单只读 M54 快照；允许规格列明的经办人、合同部、实际审批人、项目经理、财务、综合部和领导下载，仍要求密码、用途、水印和审计。

- [ ] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-seal.service.spec.ts src/contract/contract-status.service.spec.ts src/contract/contract.service.spec.ts src/contract/contract-read.service.spec.ts src/approval/approval-form.service.spec.ts src/file/file.service.spec.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add services/api/src/contract services/api/src/approval/approval-form.service* services/api/src/file/file.service.spec.ts
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

**Files:**
- Create: `services/api/src/contract/contract-change-limit-policy.ts`
- Create: `services/api/src/contract/contract-change-limit-policy.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/contract/contract-change-read-model.ts`
- Modify: `services/api/src/contract/contract-change-read-model.spec.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-change.state.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-change.state.test.ts`
- Modify: `apps/web-admin/e2e/contract-change.e2e.ts`

- [ ] **Step 1: 写边界和历史兼容失败测试**

```ts
expect(evaluateContractIncreaseLimit({ originalAmountCents: 1_000_00n, historicalPositiveIncreaseCents: 100_00n, proposedChangeCents: 0n }).allowed).toBe(true);
expect(evaluateContractIncreaseLimit({ originalAmountCents: 1_000_00n, historicalPositiveIncreaseCents: 100_00n, proposedChangeCents: 1n }).allowed).toBe(false);
expect(evaluateContractIncreaseLimit({ originalAmountCents: 1_000_00n, historicalPositiveIncreaseCents: 100_00n, proposedChangeCents: -50_00n }).positiveIncreaseAfterChangeCents).toBe(100_00n);
expect(readHistoricalChangeLabel("major")).toBe("重大合同变更（历史）");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-change-limit-policy.spec.ts src/contract/contract-change-read-model.spec.ts src/contract/contract.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-change.state.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现整数门禁和事务重算**

```ts
export function exceedsTenPercent(original: bigint, historicalPositive: bigint, proposed: bigint) {
  if (original <= 0n) return false;
  return (historicalPositive + proposed) * 10n > original;
}
```

提交变更时锁 `Contract`，从该合同所有 `effective`/`superseded` 且曾生效的正向变更汇总，不信任沿版本复制的累计字段；减项不抵扣历史正增项。草稿超过上限仍可保存，但提交返回“累计增项已超过原合同 10%，必须新签合同”。无总价框架跳过金额比例。金额门禁阻断和旧流程实例因规则升级终止都必须写审计。

- [ ] **Step 4: 统一新路线、保留历史实例**

新变更固定“合同部主管（主管发起跳过）→ 项目经理 → 财务主管 → 董事长/总经理或签”。读模型对历史实例读取 frozenNodes，不按新策略重算旧名称或路线。

- [ ] **Step 5: Web 删除新流程增强文案**

新建只有“合同变更”；历史记录仍显示原标签。公司主体字段在变更草稿中只读，换主体提示新签合同。

- [ ] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/contract/contract-change-limit-policy.spec.ts src/contract/contract-change-policy.spec.ts src/contract/contract-change-read-model.spec.ts src/contract/contract.service.spec.ts && pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-change.state.test.ts src/pages/contracts/contract-change.structure.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add services/api/src/contract apps/web-admin/src/pages/contracts/contract-change* apps/web-admin/e2e/contract-change.e2e.ts
git commit -m "feat: 统一合同变更与增项硬门禁"
```

### Task 15: 合同金额优先的结算占额门禁和通用合同禁建结算

**Files:**
- Create: `services/api/src/settlement/contract-settlement-capacity.ts`
- Create: `services/api/src/settlement/contract-settlement-capacity.spec.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-submission.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-draft.service.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`

- [ ] **Step 1: 写顺序、状态和通用合同失败测试**

```ts
await expect(service.submitInTransaction(tx, prepared, applicant)).rejects.toThrow("通用合同不办理结算");
expect(occupiedSettlementStatuses).toEqual([
  "approval_pending", "approved_pending_archive", "pending_archive_confirm", "effective", "partially_paid", "paid"
]);
await expect(overOriginalWithoutChange).rejects.toThrow("请先完成合同变更");
await expect(overAlreadyIncreasedVersion).rejects.toThrow("必须新签合同");
expect(reserveExceptionQuota).not.toHaveBeenCalled();
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/settlement/contract-settlement-capacity.spec.ts src/settlement/settlement.service.spec.ts src/settlement/settlement-submission.service.spec.ts src/settlement/settlement-draft.service.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 在唯一提交共享点加事务门禁**

在 `SettlementService.submitInTransaction()` 中使用固定锁顺序：`Contract` → 当前有效 `ContractVersion` → 相关占额 `Settlement` → 项目例外额度。先计算合同上限，再调用既有 `reserveSettlementQuota()`；草稿不占额，退回/驳回/撤回/作废不计。框架无上限跳过总额 cap，仍执行行级范围、单价和税校验。所有超额阻断、占用和占用释放都写审计，且项目例外额度不得覆盖合同上限拒绝结果。

- [ ] **Step 4: 读模型禁止通用合同作为结算选项**

`canCreateSettlement=false`，原因“通用合同直接按冻结付款条款申请付款，不办理结算”。付款选项保持。

- [ ] **Step 5: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/settlement/contract-settlement-capacity.spec.ts src/settlement/settlement.service.spec.ts src/settlement/settlement-submission.service.spec.ts src/settlement/settlement-draft.service.spec.ts src/contract/contract-read.service.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add services/api/src/settlement services/api/src/contract/contract-read.service*
git commit -m "feat: 增加合同结算金额硬上限"
```

### Task 16: M56 结算参与人和签章证据结构

**Files:**
- Create: `services/api/prisma/migrations/20260717140000_settlement_participants_and_signed_documents/migration.sql`
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/database/settlement-signature-governance-schema-verification.spec.ts`
- Create: `services/api/src/settlement/settlement-participant-freeze.ts`
- Create: `services/api/src/settlement/settlement-participant-freeze.spec.ts`

- [ ] **Step 1: 写结构和项目人员失败测试**

```ts
expect(schema).toContain("fieldReviewerUserId");
expect(schema).toContain("compilerSignatureFileIdSnapshot");
expect(schema).toContain("model SettlementSignedDocument");
await expect(freeze({ selectedUserId: "other-project-user", projectId: "p1" }))
  .rejects.toThrow("只能选择所属项目当前有效人员");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/database/settlement-signature-governance-schema-verification.spec.ts src/settlement/settlement-participant-freeze.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 增加最小增量字段和文档表**

`SettlementDraft` 和 `Settlement` 增加 `fieldReviewerUserId/fieldReviewerRoleKey`；`Settlement` 增加编制人和提交时签名文件/摘要；新表保存 `frozen_counterparty_copy`、`counterparty_signed_original`、`final_internal_signed_copy` 三种用途、fileId、hash、pageCount、sourceRevision、状态、上传/生成者和替代关系。

- [ ] **Step 4: 参与人冻结规则**

材料/机械只接受所属项目 `material_staff`；劳务/专业只接受所属项目 `engineering_foreman` 或经既有角色定义确认的施工员岗位；项目总工必须唯一。公司工程技术部部长不再出现在新结算路线。

- [ ] **Step 5: 运行 Prisma 和定向测试**

Run: `pnpm --filter @jiangkong/api prisma validate && pnpm --filter @jiangkong/api test -- --runInBand src/database/settlement-signature-governance-schema-verification.spec.ts src/settlement/settlement-participant-freeze.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add services/api/prisma/schema.prisma services/api/prisma/migrations/20260717140000_settlement_participants_and_signed_documents services/api/src/database/settlement-signature-governance-schema-verification.spec.ts services/api/src/settlement/settlement-participant-freeze*
git commit -m "feat: 增加结算参与人与签章证据结构"
```

### Task 17: 两类结算路线和乙方扫描件前置门禁

**Files:**
- Modify: `packages/shared-domain/src/permissions.ts`
- Modify: `packages/shared-domain/src/permissions.test.ts`
- Modify: `services/api/src/settlement/dto/create-settlement.dto.ts`
- Modify: `services/api/src/settlement/dto/settlement-draft.dto.ts`
- Modify: `services/api/src/settlement/settlement-draft.service.ts`
- Modify: `services/api/src/settlement/settlement-draft.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-submission.service.spec.ts`

- [ ] **Step 1: 写路线、现场人员和扫描件失败测试**

```ts
expect(materialNodes.map(n => n.roleKeys[0])).toEqual([
  "material_staff", "material_director", "contract_director", "project_manager", "finance_director"
]);
expect(laborNodes.map(n => n.roleKeys[0])).toEqual([
  "engineering_foreman", "engineering_director", "contract_director", "project_manager", "finance_director"
]);
expect(laborNodes.flatMap(n => n.roleKeys)).not.toContain("engineering_department_director");
await expect(submit(draftWithoutSignedPdf)).rejects.toThrow("请先上传乙方完整签章扫描件");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/permissions.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/settlement/settlement-participant-freeze.spec.ts src/settlement/settlement-draft.service.spec.ts src/settlement/settlement-submission.service.spec.ts src/settlement/settlement.service.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 冻结具体人员和编制人签名**

提交时验证所选人员仍属于项目，把 selected user 写入第一个冻结节点；项目总工节点冻结唯一用户；其他节点冻结提交时公司级/项目级候选。编制人不是审批节点，但提交时冻结本人签名 fileId/SHA 和提交日期。

- [ ] **Step 4: 前置扫描件声明**

提交必须具备与草稿 revision 匹配的原始扫描 PDF，并确认：乙方每页签名和日期、每页盖章、多页骑缝章。系统校验 PDF、页数、顺序/尺寸可叠加性，不做 OCR。

- [ ] **Step 5: 过程/最终路线一致**

最终结算不增加审批岗位，只在同一提交事务中增加五项完结性校验：合同范围内应结事项已完成；历史过程结算已完整纳入累计数据；不存在尚未处理的结算草稿或审批中结算；本次累计结算符合当前有效合同金额上限；合同员已明确选择“最终结算”并确认后续不再发起普通过程结算。任一失败均保留草稿、上传件和已选人员，返回可操作提示并写门禁审计。

- [ ] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/shared-domain test -- src/permissions.test.ts && pnpm --filter @jiangkong/api test -- --runInBand src/settlement/settlement-participant-freeze.spec.ts src/settlement/settlement-draft.service.spec.ts src/settlement/settlement-submission.service.spec.ts src/settlement/settlement.service.spec.ts src/approval/approval-node-access.spec.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/shared-domain/src/permissions* services/api/src/settlement
git commit -m "feat: 冻结结算审批参与人与签前文件"
```

### Task 18: A4 横向冻结版、逐页签名区和最终合成件

**Files:**
- Create: `services/api/src/settlement/settlement-signed-document.service.ts`
- Create: `services/api/src/settlement/settlement-signed-document.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-document-renderer.ts`
- Modify: `services/api/src/settlement/settlement-document-renderer.spec.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-read.service.ts`
- Modify: `services/api/src/settlement/settlement-read.service.spec.ts`

- [ ] **Step 1: 写一页/多页、重复表头和签名漂移失败测试**

```ts
expect(await pageCount(renderSettlementDraftPdf(onePage))).toBe(1);
expect(await extractPageMarkers(multiPage)).toEqual(["第 1/3 页", "第 2/3 页", "第 3/3 页"]);
expect(await eachPageHasHeader(multiPage, "含税单价")).toBe(true);
expect(await signatureIds(finalPdf)).toContain("signature-at-approval");
expect(await signatureIds(finalPdf)).not.toContain("signature-after-profile-update");
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/settlement/settlement-document-renderer.spec.ts src/settlement/settlement-signed-document.service.spec.ts src/settlement/settlement.service.spec.ts`

Expected: FAIL。

- [ ] **Step 3: 冻结版每页固定结构**

PDF 使用 A4 横向，每页显示编号、文件 revision、页码/总页数；表头重复；底部预印一行 7 格签名区。材料路线为乙方/编制人/物资员/物资主管/合同部主管/项目经理/财务主管；劳务路线对应工长/项目总工。

- [ ] **Step 4: 在乙方原始扫描件上叠加冻结签名**

使用 `pdf-lib` 加载原始扫描件，按页面尺寸映射固定签名格；嵌入编制人提交时签名和 M54 审批动作签名，日期使用审批发生日期。原始扫描 fileId、最终 fileId 和 hash 均永久保留。

- [ ] **Step 5: 最终审批后自动生成，合同部主管确认生效**

全部节点通过后生成 `final_internal_signed_copy` 并进入 `pending_archive_confirm`，正常流程不再要求合同员审批后手工上传普通归档件。只允许渲染问题且原始 hash、业务 snapshot token、审批动作集合都不变时重新生成。

- [ ] **Step 6: 运行定向测试**

Run: `pnpm --filter @jiangkong/api test -- --runInBand src/settlement/settlement-document-renderer.spec.ts src/settlement/settlement-signed-document.service.spec.ts src/settlement/settlement.service.spec.ts src/settlement/settlement-read.service.spec.ts src/approval/approval-signature-snapshot.spec.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add services/api/src/settlement
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

Run: `pnpm --filter @jiangkong/web-admin test -- src/api/settlement-drafts.api.test.ts src/api/settlement-workbench.api.test.ts src/pages/settlements/settlement-workbench.state.test.ts src/pages/settlements/settlement-workbench.structure.test.ts src/pages/settlements/settlement-detail.config.test.ts && pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.config.ts e2e/settlement-signature-governance.e2e.ts e2e/settlement-workbench.e2e.ts e2e/ui-p1-settlement-visual.e2e.ts`

Expected: PASS；无文档级横向溢出和嵌套横滚。

- [ ] **Step 6: 提交**

```bash
git add apps/web-admin/src/api/settlement-* apps/web-admin/src/pages/settlements apps/web-admin/e2e/settlement-signature-governance.e2e.ts apps/web-admin/e2e/settlement-workbench.e2e.ts apps/web-admin/e2e/ui-p1-settlement-visual.e2e.ts
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

**Files:**
- Modify: `services/api/prisma/verify-trial-run.cjs`
- Create: `docs/progress/2026-07-17-contract-settlement-governance-release-candidate.md`
- Create: `docs/superpowers/runbooks/2026-07-17-contract-settlement-governance-release.md`
- Modify: `GO_LIVE_P0_RELEASE_CANDIDATE_REPORT.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 扩展隔离 UAT 覆盖**

`verify-trial-run.cjs` 使用隔离测试数据覆盖：五类合同、主管发起跳过、最终或签、双方授权四组合、用章/最终归档、增项 9.99%/10%/10.01%、材料和劳务结算、一页/多页签名、通用合同直接付款、跨域只读负向权限。不得连接生产业务库执行写入。

- [ ] **Step 2: 运行所有定向测试**

Run:

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test -- --runInBand \
  src/company-entity src/approval src/contract src/contract-workbench \
  src/contract-takeover src/settlement src/payment src/file
pnpm --filter @jiangkong/web-admin test -- \
  src/api src/pages/company-entities src/pages/contracts src/pages/settlements \
  src/pages/payments src/pages/business-readonly-access.test.ts src/routes/index.test.ts
```

Expected: PASS。

- [ ] **Step 3: 运行工程质量全量门禁**

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

- [ ] **Step 4: 浏览器验证**

使用稳定 mock/隔离数据验证 1512×982、1440×900、1280×800、1180×820、1024×768、900×768：公司主体、五类合同、合同详情、变更、材料/劳务结算、结算详情、付款工作台和只读台账。根文档横向溢出、嵌套横滚和 pageerror 必须为 0。

- [ ] **Step 5: 隔离库迁移演练**

从生产备份恢复到 `jiangkong_restore_*`，使用精确候选 SHA 依次应用 M52-M56；核对迁移数、表/索引、旧 51 迁移事实、存量空信用代码、历史审批 JSON、金额计数和只读查询。不得连接或修改生产业务库。

- [ ] **Step 6: 生成发布候选报告和 runbook**

报告必须记录：40 位 SHA、相对生产和 main 提交、实际文件、4 个新增迁移、隔离演练、测试、截图、旧未生效实例清单、未解决项、应用回滚和数据库前向修复方案。

- [ ] **Step 7: 最终提交并停止在发布候选**

```bash
git add services/api/prisma/verify-trial-run.cjs docs/progress/2026-07-17-contract-settlement-governance-release-candidate.md docs/superpowers/runbooks/2026-07-17-contract-settlement-governance-release.md GO_LIVE_P0_RELEASE_CANDIDATE_REPORT.md PROGRESS.md
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
