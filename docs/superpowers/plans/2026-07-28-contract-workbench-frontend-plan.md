# 合同工作台前端重构实施计划

> **执行要求：** 按任务顺序实施；先锁定保存、离开和定位行为的失败用例，完成前运行计划列出的全部验证命令。

**目标：** 保留桌面端“左边看文档、右边填资料”，把右侧改为十个竖向章节；顶部唯一“保存草稿”统一保存全部资料，自动保存不生成预览，问题项可直接定位到字段或清单行。

**核心架构：** `use-contract-draft.ts` 持有唯一聚合 model 和保存调度；子组件只编辑 model 或发出领域命令，不再自行持久化草稿。`ContractWorkbenchPage.vue` 负责布局和治理动作，不直接拼 API 请求。

**依赖：** Vue 3、TDesign Vue Next、现有工作台子组件、实施包 1 的聚合 API、实施包 2 的清单 read model。

---

## Task 1：把前端 API 客户端切到版本级聚合契约

**Files:**

- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`

### Step 1：先写客户端 RED

锁定以下调用：

```ts
fetchContractDraftWorkbench(contractVersionId)
acquireContractDraftEditLease(contractVersionId)
heartbeatContractDraftEditLease(contractVersionId, leaseToken)
takeOverContractDraftEditLease(contractVersionId, confirmation)
saveContractDraftAggregate(contractVersionId, leaseToken, payload)
queueContractDraftPreview(contractVersionId, sourceRevision)
submitContractDraft(contractVersionId)
deletePristineContractDraft(contractVersionId, expectedRevision, confirmation)
```

测试必须断言：

- GET URL 为 `/contract-drafts/:versionId/workbench`。
- PUT URL 为 `/contract-drafts/:versionId`。
- 写请求携带 `X-Contract-Draft-Lease`，但错误日志不会打印 token。
- 不再根据 `contractId` 请求最新草稿。
- 不再消费 `checkpoints`。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts
```

### Step 3：实现类型和 API

把 `ContractDraftModel` 扩展为聚合 model：

```ts
interface ContractDraftAggregateModel {
  draft: ContractDraftFieldsModel;
  parties: ContractDraftPartyModel[];
  bills: ContractDraftBillModel[];
  paymentTerms: ContractDraftPaymentTermsModel | null;
  attachments: ContractDraftAttachmentModel[];
}
```

删除 `expectedContractVersionId !== response.version.id` 后整页锁死的前端补丁逻辑；版本一致性由 URL 和后端精确查询保证，若后端真返回错误 ID，则作为协议错误显示，不清空用户 model。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/web-admin test -- src/api/contract-workbench.api.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts
```

### Step 5：提交

```bash
git add apps/web-admin/src/api/contract-workbench.api.ts apps/web-admin/src/api/contract-workbench.api.test.ts apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts
git commit -m "feat: adopt version scoped contract draft api"
```

---

## Task 2：建立唯一保存状态机

**Files:**

- Create: `apps/web-admin/src/pages/contracts/workbench/contract-workbench-save.state.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-workbench-save.state.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.test.ts`

### Step 1：先写调度 RED

自动保存规则是“首次变脏后约 2 秒”，不是不断延后的 debounce：

1. `t=0` 首次编辑，计划 `t=2000` 保存。
2. `t=1500` 再次编辑，仍在 `t≈2000` 保存最新快照。
3. 保存进行中再编辑，当前请求完成后启动下一轮 2 秒窗口。
4. 手动保存立即 flush 当前输入，包括仍聚焦输入框的末字符。
5. 相同 revision 只允许一个在途 PUT。
6. 每次逻辑保存生成一个 UUID idempotency key；网络重试复用原 key，新一轮编辑使用新 key。
7. payload 带本轮 `changedSections`，但仍从当前聚合 model 构造完整权威快照。
8. 409 冲突保留本地 model，不用后端响应覆盖。
9. `EDIT_LEASE_LOST` 转为只读并保留未提交内容供用户复制。
10. clean 状态手动保存不发 PUT，但仍可在已有保存 revision 上手动刷新预览。

建议状态：

```ts
type AggregateSaveState =
  | { kind: "clean"; revision: number }
  | { kind: "dirty"; revision: number; deadlineAt: number }
  | { kind: "saving"; revision: number; requestGeneration: number }
  | { kind: "failed"; revision: number; message: string }
  | { kind: "conflict"; revision: number }
  | { kind: "readonly"; revision: number; reason: string };
```

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-workbench-save.state.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts
```

### Step 3：实现单飞保存

`useContractDraft` 只暴露：

```ts
{
  model,
  markEdited,
  saveNow,
  flushBeforeLeave,
  saveState,
  savedAt,
  revision,
  leaseState
}
```

子域不得再暴露独立 `billSaving`、`billDirty` 或 `saveBillRows` 给页面导航。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-workbench-save.state.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts src/pages/contracts/workbench/contract-draft-save-status.test.ts
```

### Step 5：提交

```bash
git add apps/web-admin/src/pages/contracts/workbench
git commit -m "feat: unify contract workbench save state"
```

---

## Task 3：取消清单和其他章节的独立保存

**Files:**

- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractBillFocusEditor.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-bill-editor.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractPartySection.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractPaymentTermsSection.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractClausesSection.test.ts`

### Step 1：先写子组件 RED

断言：

- 清单编辑器不再出现“保存清单”按钮。
- 条款、付款条款、主体区不出现“保存本区”。
- 行编辑只 emit 完整 rows 和 dirty 事件，不调用 API。
- Excel“预检并导入”只更新聚合 model；最终落库等顶部保存。
- 文件上传仍是独立二进制上传命令，但附件关联进入聚合 model。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- \
  src/pages/contracts/workbench/ContractBillFocusEditor.test.ts \
  src/pages/contracts/workbench/contract-bill-editor.test.ts \
  src/pages/contracts/workbench/ContractClausesSection.test.ts
```

### Step 3：改为受控组件

清单组件契约：

```ts
defineProps<{
  bill: ContractDraftBillModel;
  readonly: boolean;
}>();

const emit = defineEmits<{
  "update:rows": [rows: ContractBillRowModel[]];
  edited: [];
}>();
```

保留模板下载、Excel 预检、行新增删除、网格复制粘贴；只移除本区持久化。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/web-admin test -- \
  src/pages/contracts/workbench/ContractBillFocusEditor.test.ts \
  src/pages/contracts/workbench/contract-bill-editor.test.ts \
  src/pages/contracts/workbench/ContractClausesSection.test.ts
```

### Step 5：提交

```bash
git add apps/web-admin/src/pages/contracts/workbench
git commit -m "refactor: route contract section edits through global save"
```

---

## Task 4：简化离开页面保护

**Files:**

- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-workbench-navigation.state.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-workbench-navigation.state.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`

### Step 1：先写离开行为 RED

删除“放弃并离开”分支，覆盖：

- clean：直接离开。
- dirty：调用一次 `flushBeforeLeave()`，成功后离开。
- saving：等待当前保存及其后的最新编辑收敛，再离开。
- failed/conflict/lease lost：阻止离开并显示准确原因。
- 用户再次点击导航不会并发触发两次保存。
- 浏览器刷新/关闭时 dirty 或 saving 注册 `beforeunload` 原生提示。

明确边界：浏览器进程被强制结束时无法保证异步请求完成；依靠 2 秒自动保存和本地备份降低损失，不能在文案中承诺“强制关闭也一定保存”。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-workbench-navigation.state.test.ts
```

### Step 3：实现单一导航状态

删除：

```ts
billDirty
billBatchSaving
discardChanges
discardAndLeave
```

只接受聚合 `saveState` 和 `flushBeforeLeave`。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-workbench-navigation.state.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts
```

### Step 5：提交

```bash
git add apps/web-admin/src/pages/contracts/workbench/contract-workbench-navigation.state.ts apps/web-admin/src/pages/contracts/workbench/contract-workbench-navigation.state.test.ts apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue
git commit -m "fix: save contract draft before leaving workbench"
```

---

## Task 5：定义十个竖向章节和稳定锚点

**Files:**

- Create: `apps/web-admin/src/pages/contracts/workbench/contract-workbench-sections.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-workbench-sections.test.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractWorkbenchSectionNav.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractWorkbenchSectionNav.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-workbench-canvas.structure.test.ts`

### Step 1：先写章节 RED

固定顺序：

```ts
export const CONTRACT_WORKBENCH_SECTIONS = [
  { id: "inspection", label: "资料检查" },
  { id: "basic", label: "基础信息" },
  { id: "parties", label: "合同主体" },
  { id: "professional", label: "专业信息" },
  { id: "bill_tax", label: "清单与税务" },
  { id: "settlement_payment", label: "结算与付款" },
  { id: "clauses", label: "合同条款" },
  { id: "attachments", label: "附件资料" },
  { id: "negotiation_documents", label: "协商与文档" },
  { id: "flow_history", label: "流程记录" }
] as const;
```

测试 DOM：

- 不再使用主资料 `t-tabs` 横向切换。
- 十个章节均有稳定 `data-section-id`。
- 右侧内部导航 sticky，但不遮挡顶部全局状态栏。
- 激活项跟随点击和滚动。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-workbench-sections.test.ts src/pages/contracts/workbench/ContractWorkbenchSectionNav.test.ts src/pages/contracts/contract-workbench-canvas.structure.test.ts
```

### Step 3：重组现有组件

不要复制表单。按以下映射复用：

| 章节 | 现有组件 |
| --- | --- |
| 资料检查 | `ContractReadinessPanel` |
| 基础信息 | `ContractOverviewSection`、`ContractBasicSection` |
| 合同主体 | `ContractPartySection` |
| 专业信息 | `ContractProfessionalFieldsSection` |
| 清单与税务 | `ContractTaxFactsSection`、`ContractPricingSection`、`ContractBillsSection` |
| 结算与付款 | 结算方式区、`ContractPaymentTermsSection` |
| 合同条款 | `ContractClausesSection` |
| 附件资料 | `ContractFormalDocumentSection`、`ContractAuthorizationSection`、附件 schema |
| 协商与文档 | `ContractNegotiationSection`、文档版本操作 |
| 流程记录 | 现有审批/操作记录只读区 |

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-workbench-sections.test.ts src/pages/contracts/workbench/ContractWorkbenchSectionNav.test.ts src/pages/contracts/contract-workbench-canvas.structure.test.ts
```

### Step 5：提交

```bash
git add apps/web-admin/src/pages/contracts
git commit -m "feat: add vertical contract workbench sections"
```

---

## Task 6：让资料问题可以定位到字段或清单行

**Files:**

- Modify: `services/api/src/contract-workbench/contract-readiness.service.ts`
- Modify: `services/api/src/contract-workbench/contract-readiness.service.spec.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-workbench-issue-location.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/contract-workbench-issue-location.test.ts`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractWorkbenchIssueList.vue`
- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/e2e/contract-workbench-canvas.e2e.ts`

### Step 1：先写结构化 location RED

readiness issue 增加可选定位：

```ts
interface ContractReadinessLocation {
  sectionId: ContractWorkbenchSectionId;
  fieldKey?: string;
  billKey?: string;
  rowKey?: string;
}
```

测试示例：

- 缺税率 -> `bill_tax/defaultTaxRatePercent`
- 缺乙方名称 -> `parties/counterparty`
- 清单第 23 行缺数量 -> `bill_tax/{billKey}/{rowKey}`
- 缺付款条款 -> `settlement_payment/paymentTerms`

未知历史 issue 只定位章节，不伪造字段。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-readiness.service.spec.ts
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-workbench-issue-location.test.ts
```

### Step 3：实现滚动和聚焦

点击问题：

1. 激活目标章节。
2. `scrollIntoView({ block: "start" })`。
3. 字段存在时调用组件暴露的 `focusField(fieldKey)`。
4. 清单行存在时调用网格 `scrollToRow`，再选中错误单元格。
5. 聚焦失败仍停留在章节，并提示“已定位到相关章节”。

### Step 4：运行 GREEN 和 E2E

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/contract-workbench/contract-readiness.service.spec.ts
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-workbench-issue-location.test.ts
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.config.ts e2e/contract-workbench-canvas.e2e.ts
```

### Step 5：提交

```bash
git add services/api/src/contract-workbench apps/web-admin/src/pages/contracts apps/web-admin/e2e/contract-workbench-canvas.e2e.ts
git commit -m "feat: locate contract readiness issues in workbench"
```

---

## Task 7：补齐主体编辑和删除

**Files:**

- Modify: `apps/web-admin/src/pages/contracts/workbench/ContractPartySection.vue`
- Create: `apps/web-admin/src/pages/contracts/workbench/ContractPartySection.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/use-contract-draft.test.ts`

### Step 1：先写权限和交互 RED

覆盖：

- 草稿且持有租约：可新增、编辑、删除主体。
- 提交后：全部主体只读。
- 删除使用 `SensitiveActionDialog`，确认后只改本地聚合 model，等待全局保存。
- 删除公司治理主体或必填唯一乙方时，页面先提示，但后端仍是最终校验。
- 取消删除不修改 model。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/ContractPartySection.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts
```

### Step 3：实现并运行 GREEN

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/ContractPartySection.test.ts src/pages/contracts/workbench/use-contract-draft.test.ts
```

### Step 4：提交

```bash
git add apps/web-admin/src/pages/contracts/workbench
git commit -m "feat: edit contract parties before submission"
```

---

## Task 8：实现顶部手动保存与独立预览反馈

**Files:**

- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.ts`
- Modify: `apps/web-admin/src/pages/contracts/workbench/contract-draft-save-status.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/contract-workbench-canvas.structure.test.ts`
- Modify: `apps/web-admin/e2e/contract-clause-save-lifecycle.e2e.ts`

### Step 1：先写行为 RED

顶部只保留一个资料保存按钮：

```text
保存草稿
```

手动点击顺序：

```text
flush 全部资料
-> PUT 成功
-> 显示“资料已保存，修订号 N”
-> POST preview-generation
-> 显示“文档预览生成中”
```

预览失败：

```text
资料已保存
文档预览生成失败，可稍后重试；左侧继续显示上一版
```

不得把整个状态显示为“保存失败”。

自动保存只执行 PUT，不调用 preview-generation。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-draft-save-status.test.ts src/pages/contracts/contract-workbench-canvas.structure.test.ts
```

### Step 3：实现

按钮禁用条件仅包括：

- 只读或租约丢失。
- 正在取得租约。
- 当前有不可重入的敏感治理动作。

保存中再次点击复用同一个 flush promise，不发重复 PUT。

### Step 4：运行 GREEN 和条款 E2E

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/workbench/contract-draft-save-status.test.ts src/pages/contracts/contract-workbench-canvas.structure.test.ts
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.contract-clause-save.config.ts
```

### Step 5：提交

```bash
git add apps/web-admin/src/pages/contracts apps/web-admin/e2e/contract-clause-save-lifecycle.e2e.ts
git commit -m "feat: save full contract draft from top action"
```

---

## Task 9：实现移动端文档/资料切换

**Files:**

- Modify: `apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue`
- Modify: `apps/web-admin/src/pages/contracts/contract-workbench-canvas.structure.test.ts`
- Modify: `apps/web-admin/e2e/contract-workbench-canvas.e2e.ts`

### Step 1：先写响应式 RED

桌面宽度：

- 左文档、右资料同时存在。
- 各自独立滚动。
- 顶部状态栏始终可见。

移动宽度：

- 使用 TDesign `t-radio-group` 或 `t-segmented` 在“文档”“资料”间切换。
- 同时只渲染一个主面板，避免窄屏双栏。
- 切换不卸载聚合 model、不丢输入焦点前的值。
- 资料内部仍使用竖向章节导航。
- 全页无横向溢出。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/web-admin test -- src/pages/contracts/contract-workbench-canvas.structure.test.ts
```

### Step 3：实现并运行 E2E

```bash
pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.config.ts e2e/contract-workbench-canvas.e2e.ts
```

至少覆盖 `1440x900`、`960x900`、`375x812`。

### Step 4：提交

```bash
git add apps/web-admin/src/pages/contracts/ContractWorkbenchPage.vue apps/web-admin/src/pages/contracts/contract-workbench-canvas.structure.test.ts apps/web-admin/e2e/contract-workbench-canvas.e2e.ts
git commit -m "feat: add responsive contract document data switch"
```

---

## Task 10：前端总门禁

```bash
pnpm --filter @jiangkong/web-admin test -- \
  src/api/contract-workbench.api.test.ts \
  src/pages/contracts/workbench/use-contract-draft.test.ts \
  src/pages/contracts/workbench/contract-workbench-save.state.test.ts \
  src/pages/contracts/workbench/contract-workbench-navigation.state.test.ts \
  src/pages/contracts/workbench/contract-workbench-sections.test.ts \
  src/pages/contracts/workbench/contract-workbench-issue-location.test.ts \
  src/pages/contracts/workbench/ContractPartySection.test.ts \
  src/pages/contracts/workbench/ContractBillFocusEditor.test.ts \
  src/pages/contracts/contract-workbench-canvas.structure.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin typecheck:e2e
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/web-admin build
git diff --check
```

预期：全部退出码 `0`；页面不再存在“保存清单”“保存本区”“放弃并离开”和主资料横向 tabs。

在 `PROGRESS.md` 记录本地验证证据，并明确尚未取得真实 Excel、未连接生产、未部署。
