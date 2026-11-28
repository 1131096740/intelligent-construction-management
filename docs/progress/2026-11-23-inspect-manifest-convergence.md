# PR #428 inspect/release manifest 收敛回执（线 M）

日期：2026-11-23
工作树：`/tmp/jgM`
分支：`line-m-inspect-manifests`
基线：`9a4f00be8`（迁移 323）；已 `--no-ff` 合入 `adopt-395-396-415` 最新 `fda7f7dd8`
范围：A 类 16 个写 wrapper witness + B 类 `change-drafts` 保留分类；未 push，未改主仓库、`/tmp/jgL`、`/tmp/jg382-adopt`。

## 结论

- `pnpm run inspect:whole-site-page-actions:ready`：**37 → 16 → 0**（458 actions / 0 blockers）。
- `pnpm run inspect:whole-site-route-usage`（及 `--require-ready`）：**0 unclassified**（818 routes）。
- 五条验证命令全部退出码 0；`inspect:release-manifests` 全段通过。
- 未修改检查器的既有判定、未扩大任何既有白名单、未改 410、未改 `contract-business-entry-http.spec.ts`、未伪造零调用者。

## A 类：16 条写 wrapper（全部 16/16 清零）

### 采用方式

1. **显式 AST witness（首选）**：新增 `scripts/lib/contract-signed-pages-action-proof.mjs`，按既有 `contract-*-page-action-proof.mjs` 的写法，为 5 个页面逐动作固定：
   - 页面元素/事件/handler 与 registry 完全一致；
   - 触发元素的**自有或祖先 `v-if`** 能力表达式（或 handler 内的 fail-closed 守卫）逐字匹配；
   - 写调用语句逐字匹配（含共享 `run()` 回调；`run()` 本身也逐字固定）；
   - 能力读取函数逐字固定，并只接受**单 GET、`transparent_main_response`、已认证非公开**的读 wrapper；
   - 对每个 wrapper 验证在 handler 中**恰好被调用一次**。
   该 witness 在 `proveBusinessActionPipeline` 的既有专用证明分派链上新增一个分支；**没有改动任何既有判定、没有新增通配/默认放行**。
2. **显式服务端布尔（缺能力处）**：按下表补了 4 个由服务端权限计算出的布尔（均非写死 true）：
   - `WorkCompletionEntry.duties[].canReview`：仅在 `resolveApprovalReviewIdentity` 解析出可办职责时投影（TS 投影分支，非常量）；
   - `SignedContractChanges.canDownloadOriginals`：`access.canUpload || access.canConfirm`（与列表读取同一访问门）；
   - `SignedSettlementOverview.canRegister`：由 `authorize()` 的 `staff || director` 计算；
   - `SignedSettlementRow.canReadAttachments`：由 `authorize()` 与附件读取同一规则 `director || (staff && (owner || confirmed))` 计算。
3. **读 wrapper 透明化**：`signed-contract-settlement.api.ts` 的列表/概览/付款依据读改用本地 `readSettlementJson`（`apiFetch` → `ensureOk` → `return response.json()`，与 `core-flow-read` 同形），使能力来源成为检查器认可的 `transparent_main_response`；写路径仍用原 `request`，行为不变。
4. **页面门/守卫**：在写触发元素上补 `v-if` 服务端布尔，并在 handler 首部补 fail-closed 守卫（保存/提交/复核/上传/下载/附件访问），不改变正常流程。

### 逐条结果（before = 该 wrapper×consumer 的未覆盖 blocker）

| # | 页面 | wrapper | 采用的写路径/门 | 动作 id | before → after |
| ---: | --- | --- | --- | --- | ---: |
| 1 | `ContractWorkCompletionSection.vue` | `saveWorkCompletionDraft` | form submit `save`；`canRegister && showDraft`；`if (!canRegister.value) return;` | `contract-work-completion.save-draft` | 1 → 0 |
| 2 | 同上 | `reviseWorkCompletionDraft` | form submit `saveRevision`；`reviseTarget && reviseTarget.canRevise` | `contract-work-completion.revise-draft` | 1 → 0 |
| 3 | 同上 | `submitWorkCompletion` | 按钮 `submit(entry.id)`；`entry.canSubmit` | `contract-work-completion.submit` | 1 → 0 |
| 4 | 同上 | `reviewWorkCompletion` | form submit `review`；`duty.canReview`（新增服务端布尔） | `contract-work-completion.review` | 1 → 0 |
| 5 | `EffectiveContractTaxFacts.vue` | `submitContractTaxRevision` | t-form submit；祖先 `detail?.canSubmit && !pending`；handler 守卫 | `contract-tax-facts.submit` | 1 → 0 |
| 6 | 同上 | `reviewContractTaxRevision` | 按钮 `review`；祖先 `pending && detail?.canReview`；handler 守卫 | `contract-tax-facts.review` | 1 → 0 |
| 7 | `SignedContractChanges.vue` | `uploadPrivateFile` + `submitSignedContractChange` | form submit；`detail.canSubmit` 门；handler 守卫（同一 action 覆盖两个 wrapper） | `contract-signed-change.submit` | 1 + 1 → 0 |
| 8 | 同上 | `reviewSignedContractChange` | form submit；`reviewTarget && detail.canReview`；handler 守卫 | `contract-signed-change.review` | 1 → 0 |
| 9 | `SignedContractSettlementPage.vue` | `saveSignedSettlement` + `submitSignedSettlement` | 按钮组；`overview?.canRegister`（新增）；handler 守卫 | `signed-settlement.save` | 1 + 1 → 0 |
| 10 | 同上 | `reviewSignedSettlement` | 按钮组；`selected?.canReview`；handler 守卫 | `signed-settlement.review` | 1 → 0 |
| 11 | 同上 | `uploadSignedSettlementFile` | 原生 input；`v-if="overview?.canRegister"`；handler 守卫 | `signed-settlement.upload-file` | 1 → 0 |
| 12 | 同上 | `readSignedSettlementAttachment` | `SensitiveActionDialog` confirm；`selected.canReadAttachments`（新增）；handler 守卫 | `signed-settlement.attachment-access` | 1 → 0 |
| 13 | `SignedSettlementPaymentBasisPanel.vue` | `readSignedSettlementAttachment` + `downloadPrivateFileByTicket` | dialog confirm；`basis.canReadSignedAttachments`；handler 守卫（同一 action 覆盖两个 wrapper） | `payment-basis.download-signed-attachment` | 1 + 1 → 0 |

另登记 `contract-signed-change.download-original`（`SignedContractChanges.vue` 的下载签署原件，`detail.canDownloadOriginals`）：该 consumer 此前已被 `contract-file.download-private-file-by-ticket` 的依赖闭包覆盖、不在 16 条内，但页面确有该动作且调用 `downloadPrivateFileByTicket`，按“真实调用才登记”一并显式登记，未新增 blocker。

### 受影响后端/API 改动

- `services/api/src/contract/contract-work-completion-approval.service.ts`：职责投影增加 `canReview`；对应 `contract-work-completion-approval.service.spec.ts` 断言同步。
- `services/api/src/contract/contract-signed-change.service.ts`：列表读取增加 `canDownloadOriginals`。
- `services/api/src/settlement/signed-contract-settlement.service.ts`：`overview` 增加 `canRegister`；`list` 增加逐行 `canReadAttachments`；对应 spec 同步（并断言 `authorize` 被调用）。
- `apps/web-admin/src/api/core-flow-read.api.ts`、`signed-contract-settlement.api.ts`：新增类型字段与本地透明读 helper。

## B 类：`POST /contracts/:contractVersionId/change-drafts` 保留分类（#425）

- 机器真相：`docs/product/manifests/route-usage.registry.json` 增加
  - usage override：**`internal_task`**；
  - consumerSurface override：**`machine_probe`**；
  - reason 字段内写明：旧写入口已被“已签补充协议”页面入口取代；生产 Web 调用者为 0；仍有企业验收 HTTP 与 Playwright e2e 机器消费面；**连同 410 与调用者迁移归属 #425，本轮不改 410**。
- 脚本既有 schema 只有 `page / external_takeover / exit_candidate / internal_task / unclassified` 五个 usage，没有字面 “retained” 值；为避免 `exit_candidate` 连带要求 retired-write guard（410），按脚本允许的 `internal_task + machine_probe` 登记，产品语义“保留待 #425”完整写在 reason 中。
- 未做：未把接口改成 410；未改 `retired-write-entry.guard.ts`；未改 `contract-business-entry-http.spec.ts`；未在 manifest 声称零调用者。
- 结果：route-usage `unclassified` 3 → 0；该行可在 `route-usage.json` 中按 `#425`/`issue_425` 检索到；capability matrix、user-fill、contract-mutation-authority 均随之为 ready。

### #425 输入：当前调用者清单（仓库实际搜索结果）

| 调用点 | 位置 | 性质 |
| --- | --- | --- |
| 后端路由 | `services/api/src/contract/contract.controller.ts:202` `@Post(":contractVersionId/change-drafts")` | 路由定义 |
| 企业验收 HTTP 用例 | `services/api/src/database/contract-business-entry-http.spec.ts:1220` | 真实 HTTP 调用（direct 付款模式下的合同变更链） |
| Playwright e2e | `apps/web-admin/e2e/contract-change.e2e.ts:58,270` | 页面请求 mock（`page.route`），驱动旧变更 UI 断言 |
| Web API wrapper | `apps/web-admin/src/api/core-flow-read.api.ts:472` `createContractChangeDraft` | wrapper 定义，生产页面零调用 |
| wrapper 单测 | `apps/web-admin/src/api/core-flow-read.api.test.ts:433` | 单测消费 |

#425 需同时处理：上述 HTTP 验收链与 e2e 的迁移/删除、wrapper 与单测清理、`retired-write-entry.guard.ts` 登记 410、`contract-mutation-authority` 分类同步、route-usage 从 `internal_task` 改为 `exit_candidate`。

## 五条验证命令结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm run inspect:whole-site-capabilities` | 0 | `WHOLE_SITE_ROUTE_MANIFEST_OK: 818 routes` |
| `pnpm run inspect:whole-site-web-api:ready` | 0 | `WHOLE_SITE_WEB_API_MANIFEST_READY: 737 wrappers, 811 bindings` |
| `pnpm run inspect:whole-site-page-actions:ready` | 0 | `WHOLE_SITE_PAGE_ACTION_MANIFEST_READY: 458 actions, 0 blockers` |
| `pnpm run inspect:whole-site-route-usage` | 0 | `WHOLE_SITE_ROUTE_USAGE_MANIFEST_READY: 818 routes, 0 unclassified` |
| `pnpm run inspect:release-manifests` | 0 | 全段通过（contract matrix matched、page-actions ready、route-usage ready、user-fill ready、POL-21/23 ready、mutation authority ready、capability matrix ready） |

其他 release 子门（单独执行）：

- `inspect-contract-workbench-capabilities --check`：matched，exit_candidate 53。
- `inspect-user-fill-entry-inventory --check --require-ready`：ready，旧写入口 78，只读旧入口 13，阻塞 0。
- `inspect-whole-site-capability-matrix --check --require-ready`：ready，818 routes / 0 blockers。
- `inspect-contract-mutation-authority-manifest --check`：ready，84 routes / 22 advertised actions。
- `inspect-pol21-cross-domain-acceptance`、`inspect-pol23-release-candidate`：ready。

## 测试

- `pnpm --filter @jiangkong/web-admin typecheck`：通过。
- `pnpm --filter @jiangkong/web-admin test`（vitest 全量）：**257 files / 2415 tests 全通过**。
- 受影响 API spec：`contract-work-completion-approval.service.spec.ts`、`contract-signed-change.service.spec.ts`、`signed-contract-settlement.service.spec.ts`、`signed-settlement-payment-basis.spec.ts` 全通过（随新布尔同步断言）。
- `@jiangkong/api build` 通过。
- `scripts/inspect-whole-site-page-action-manifest.test.mjs`：393/394；唯一失败 `review regression rejects selected target JSON custom response` 与基线一致（该 fixture 的 `assert.notEqual(changed, source)` 对当前 `contract-workbench.api.ts` 片段不成立，`git stash` 回退本轮改动后同样失败），与本轮无关。
- `scripts/inspect-contract-seal-page-action.test.mjs` + `inspect-generated-archive-page-action.test.mjs` + `inspect-direct-registration-page-action.test.mjs`：50/50 通过。

## 改动文件

- 新增：`scripts/lib/contract-signed-pages-action-proof.mjs`
- 检查器分派：`scripts/lib/whole-site-page-action-manifest.mjs`（仅在既有专用证明分派链增加 `SIGNED_PAGE_ACTION_IDS` 分支）
- 页面：`ContractWorkCompletionSection.vue`、`EffectiveContractTaxFacts.vue`、`SignedContractChanges.vue`、`SignedContractSettlementPage.vue`、`SignedSettlementPaymentBasisPanel.vue`
- API：`core-flow-read.api.ts`、`signed-contract-settlement.api.ts`
- 后端：`contract-work-completion-approval.service.ts`（+spec）、`contract-signed-change.service.ts`、`signed-contract-settlement.service.ts`（+spec）
- manifests：`web-page-actions.registry.json`/`web-page-actions.json`、`route-usage.registry.json`/`route-usage.json`、`web-api-wrappers.json`、`whole-site-capability-matrix.json`/`.md`、`user-fill-entry-inventory.json`、`contract-mutation-authority.json`
- `PROGRESS.md` 本回执

## 仍需产品/评审介入

1. **#425**：旧 `change-drafts` 写入口的正式退出（410、调用者迁移、e2e/HTTP 验收改写、mutation authority/route-usage 分类切换）。本轮按用户 B 决定只做“保留 + 显式分类 + 理由入 manifest”。
2. **Witness 机制评审**：本轮按用户 A 决定在既有专用证明分派链新增显式 witness；未放宽既有判定，但这是检查器能力面的扩展（新增 14 个动作的证明），建议代码评审确认该 witness 与既有 `contract-*-page-action-proof` 同等强度。若不接受该扩展，替代方案是页面写路径重构，成本更高。
3. **新增服务端布尔语义评审**：`canDownloadOriginals`/`canRegister`/`canReadAttachments` 均按现有授权规则计算（非常量），但其中 `canDownloadOriginals` 与 `canRegister` 对通过读取门的调用者为真；建议在后端权限评审中确认这层“读取门即办理门”的语义。
