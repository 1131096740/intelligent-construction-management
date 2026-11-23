# PR #428 inspect/release manifest 收敛回执（线 M）

日期：2026-11-23
工作树：`/tmp/jgM`
分支：`line-m-inspect-manifests`
基线：`9a4f00be8`（迁移 323）
范围：只处理 inspect/release manifest 门禁；未 push，未改主仓库、`/tmp/jgL`、`/tmp/jg382-adopt`。

## 结论

- 基线 `pnpm run inspect:whole-site-page-actions:ready` 的 **37 个 blocker 已处理 21 个**，**仍剩 16 个**。
- 剩余 16 个全部是候选树（`e717ba4c6` 采纳的 #395/#396/#415 页面）新增写操作 wrapper：页面确实有动作并确实调用 wrapper，但当前 `inspect-whole-site-page-action-manifest` 的通用因果/能力证明无法为这些页面成立；**按约束没有把未证明的能力登记为已具备**，也没有改动 inspect 判定逻辑放行。
- route-usage 3 条未分类处理 2 条；`POST /contracts/:contractVersionId/change-drafts` 保留未分类并报告，原因是把它登记为 `exit_candidate` 会连带要求旧写入口返回 410，进而破坏既有企业验收 HTTP 用例。
- 五条验证命令：2 绿、1 绿（blocked 事实清单）、2 红；`@jiangkong/web-admin` typecheck 绿。

## Blocker 分组与处理（37 → 16）

| 组 | 基线数 | 处理 | 结果 |
| --- | ---: | --- | --- |
| `staleRegistryEntries` | 1 | 删除旧 `contract-change.create-draft` 条目 | 0 |
| `unresolvedWrappers` | 8 | 2 条随旧条目删除；6 条见签章/归档因果链重钉 | 0 |
| `writeWithoutServerCapability` | 7 | 5 条签章/归档随因果链重钉；2 条短信随后端 authority 重钉 | 0 |
| `uncoveredMutationWrappers` | 21 | 5 条为上述修复的连带覆盖；16 条仍红 | 16 |

### 1. 旧 change-draft 条目（1 + 2 连带）

- `apps/web-admin/src/pages/contracts/ContractDetailPage.vue` 已不再包含 `createContractChangeDraftWithCapability` / `submitChangeDraft`，旧“发起合同变更”对话框已由 `SignedContractChanges.vue`（双方已签补充协议）入口取代。
- `createContractChangeDraft` wrapper 的生产消费者为零（仅 `core-flow-read.api.ts` 定义与测试引用）。已从 `docs/product/manifests/web-page-actions.registry.json` 删除 `contract-change.create-draft`，未凭空保留。
- 同一提交 `e717ba4c6` 把变更资格读取从 `reloadContractDetail()` 中移除；签章/归档的父页面证明仍钉着旧 `reloadContractDetail` 与 `fetchContractChangeEligibility`/`normalizeChangeEligibility` 导入，导致 6 条 seal/archive `ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED`。已在 `scripts/lib/contract-seal-page-action-proof.mjs` 按当前页面把 witness 重钉到实际 `reloadContractDetail`，并移除已不存在的变更资格导入/请求检查；**未删除任何签章/归档守卫检查**。

### 2. 签章/归档 capability 门（5）

- `contract-generated-archive.confirm`、`contract-generated-archive.resume-original`、`contract-seal-v2.confirm`、`contract-seal-v2.lookup-original`、`contract-seal-v2.resume-original` 的 capability 仍分别为 `v2Lifecycle.archiveAction.eligible` / `v2Lifecycle.sealAction.eligible`，没有改成 `true`。
- 之前红的原因是父页面 witness 过期（见上）。重钉后 composable 的 `confirmSeal`/`continueSeal`/`confirmArchive`/`sendArchive`、section 的 dialog 终端 callback、API 的 `confirmContractSealV2`/`archiveSignedContractV2`/`uploadPrivateFile`、route 的 `contract.seal` project action 均由原证明继续逐项验证。

### 3. 短信重试 capability 门（2）

- `duty-sms.retry` 与 `multi-duty-sms.retry` 的页面/capability 没有变化（`notice.canRetry` 来自服务端状态读）。
- 红的原因是本轮 #415/#419 后端改动后，authority witness 过期：
  - `payment-approval-notification.service.ts` 的 `currentNotice` 已改为 `inProgressNotice` + `correctionNotice` 委派；
  - `contract.controller.ts` 的 `dutySmsStatus`/`retryDutySms` 已把 `ContractWorkCompletionNotificationService` 的履约待办并入同一 `/contracts/:version/duty-sms` 面；
  - `contract-duty-notification.service.ts` 的 `authorized` 新增 `correction` 阶段。
- 已在 `scripts/lib/whole-site-page-action-manifest.mjs` 重钉并**加强**证明：新增 `currentNotice` 委派、correction 通知的 `recipientId === actorId` 归属门、履约通知 `notificationStatusForVersion` 的 SQL `recipientId` 过滤、履约 `retry` 的 `contractVersionId`/`recipientId` 门、`authorized` 的 `correction` 仅原申请人分支。没有把任何短信能力写成无条件。

### 4. 新增写操作 wrapper（16 条未登记，不在本轮回执中假登记）

按页面分组（wrapper 均真实被页面调用，页面动作也确实存在）：

| 页面 | wrapper |
| --- | --- |
| `contracts/ContractWorkCompletionSection.vue` | `saveWorkCompletionDraft`、`reviseWorkCompletionDraft`、`submitWorkCompletion`、`reviewWorkCompletion` |
| `contracts/EffectiveContractTaxFacts.vue` | `submitContractTaxRevision`、`reviewContractTaxRevision` |
| `contracts/SignedContractChanges.vue` | `submitSignedContractChange`、`reviewSignedContractChange`、`uploadPrivateFile` |
| `settlements/SignedContractSettlementPage.vue` | `saveSignedSettlement`、`submitSignedSettlement`、`reviewSignedSettlement`、`uploadSignedSettlementFile`、`readSignedSettlementAttachment` |
| `payments/SignedSettlementPaymentBasisPanel.vue` | `readSignedSettlementAttachment`、`downloadPrivateFileByTicket` |

不登记的具体原因（实测，不是猜测）：

1. **通用因果证明失败关**：这些写动作的 handler 都经本地 `run(async () => …)` 包装并含运行时 `if/else`/`try-catch-finally` 分支；`wrapperCausalProof` 的 `directCallTargets` 不跟随高阶回调，且遇到未知分支即 `reliable=false`，因此全部得到 `ACTION_WRAPPER_CAUSAL_CHAIN_UNVERIFIED`。
2. **能力支配失败关**：上表动作的触发元素（dialog/form/按钮）多数没有可机器证明的服务端布尔祖先条件。已存在的服务端布尔只到 `detail.canSubmit`/`detail.canReview`/`selected.canUpdate`/`basis.canReadSignedAttachments` 等成员，而 revise/review/save/upload/attachment 的触发元素由 `reviewTarget`、`readOnly`、`dialogVisible` 等客户端状态控制；`ContractWorkCompletionSection` 的 `canRegister`、`entry.canRevise` 等还是裸 `ref`，通用证明不认。
3. **能力本身缺失而非仅不可证明**：
   - 履约三职责 review 没有 per-duty 布尔，服务端只返回“当前可办职责数组”（`duties`），页面无法用 `server_boolean` 表达；
   - 补充协议/已签结算附件的下载入口没有对应服务端下载能力布尔（`downloadPrivateFileByTicket` 只有票据 + 密码/原因门）；
   - 付款依据面板的 `canReadSignedAttachments` 只覆盖 `source=signed_registration` 的附件，不覆盖同页的历史/合同原件下载。

处理留痕：曾按最接近的 `server_boolean` 为上述 16 条写入 14 个候选 registry 条目做验证，blocker 反增至 **44**（每条同时新增未证明因果链 + 未支配能力 + 反向覆盖缺失），因此已回退，未提交任何登记。要转绿需要二选一：为这 5 个页面补专用 AST 证明（类似签章/归档的 `contract-*-page-action-proof.mjs`），或把写 handler 重构为可由通用证明直读的直线链并补显式服务端能力门；两者都需要产品/工程决策与页面行为验证。

## route-usage 3 条未分类

处理 2 条、保留 1 条：

1. `GET /contracts/:contractVersionId/change-eligibility` → `exit_candidate`（只读，旧合同变更草稿入口被已签补充协议取代，生产 Web 调用者为零；只读退出候选不触发 410，也不需要 retired-write 登记）。
2. `GET /projects/:projectId/signed-contract-settlements/:id/attachments/:fileId/download` → `page` + `consumerSurface=signed_ticket_delivery`，并登记 ticketFollowup `signed-contract-settlement.api.ts#readSignedSettlementAttachment`（`GET`、`downloadUrl`）。依据是该 wrapper 先取票据、再 `apiFetch(ticket.downloadUrl)`，由 `SignedContractSettlementPage.vue` 与 `SignedSettlementPaymentBasisPanel.vue` 两个生产页面消费。
3. `POST /contracts/:contractVersionId/change-drafts` **保留未分类**。依据：
   - 该路由没有生产 Web 消费者（wrapper `createContractChangeDraft` 调用者已清零）；
   - `consumerSurface=none` 时唯一不冲突的用法是 `exit_candidate`；
   - 但 `exit_candidate` 变更要求 `services/api/src/retired-write-entry/retired-write-entry.guard.ts` 登记 `ContractController.createChangeDraft` 并返回 410；而 `services/api/src/database/contract-business-entry-http.spec.ts:1220` 仍以该端点驱动企业验收的合同变更链，直接退休会破坏既有验收用例；
   - 同一分类还会让 `inspect-contract-mutation-authority-manifest` 产生 `routeAuthorityDrift`（authority 仍为 `governed_specialized_command`）。
   - 因此这条需要产品决定“旧合同变更草稿 HTTP 入口是否正式停止（并迁移企业验收用例）”，本轮不擅自制造 410。

## 五条验证命令结果

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm run inspect:whole-site-capabilities` | 0 | `WHOLE_SITE_ROUTE_MANIFEST_OK: 818 routes` |
| `pnpm run inspect:whole-site-web-api:ready` | 0 | `WHOLE_SITE_WEB_API_MANIFEST_READY: 737 wrappers, 811 bindings` |
| `pnpm run inspect:whole-site-page-actions:ready` | 1 | `WHOLE_SITE_PAGE_ACTION_MANIFEST_FAILED`（16 uncovered wrapper） |
| `pnpm run inspect:whole-site-route-usage` | 0 | `WHOLE_SITE_ROUTE_USAGE_MANIFEST_BLOCKED: 818 routes, 1 unclassified`（`--check` 字节一致；1 条未分类为上述 change-drafts） |
| `pnpm run inspect:release-manifests` | 1 | 停在 page-actions `--require-ready`（同 16 条） |

补充：`pnpm --filter @jiangkong/web-admin typecheck` 通过（exit 0）。

其他 release 子门（单独执行，便于后续收敛）：

- `contract-workbench-capability-matrix`：matched（exit candidates 53）。
- `inspect-user-fill-entry-inventory --check --require-ready`：blocked，仅 `web_page_actions:blocked` + `route_usage:blocked` 两项上游。
- `inspect-whole-site-capability-matrix --check --require-ready`：blocked 19 = 2 上游 + 1 route unclassified + 16 uncovered consumer。
- `inspect-contract-mutation-authority-manifest --check`：blocked 1，`POST /contracts/:param/change-drafts` usage 未分类与 authority 不一致（见上）。
- `inspect-pol21-cross-domain-acceptance --check --require-ready`、`inspect-pol23-release-candidate --check --require-ready`：通过。

单测：`scripts/inspect-whole-site-page-action-manifest.test.mjs` 393/394 通过；唯一失败 `review regression rejects selected target JSON custom response` 经 `git stash` 回退本轮 lib/registry 改动后仍同样失败，属基线既存（fixture 的 `assert.notEqual(changed, source)` 对当前 `contract-workbench.api.ts` 片段不成立），与本轮改动无关。本轮另为 multi-duty 契约测试 fixture 增补了 `contract-work-completion-notification.service.ts` 真实源码（否则新重钉的履约通知归属门在合成根中缺文件而失败）。`scripts/inspect-contract-seal-page-action.test.mjs` + `inspect-generated-archive-page-action.test.mjs` + `inspect-direct-registration-page-action.test.mjs` 共 50/50 通过；`scripts/inspect-release-manifests.test.mjs` 与 page-action CLI 测试 5/5 通过。

## 改动文件

- `scripts/lib/contract-seal-page-action-proof.mjs`：父页面 `reloadContractDetail` witness 重钉、移除已不存在的变更资格导入/请求检查。
- `scripts/lib/whole-site-page-action-manifest.mjs`：付款/合同短信 authority 重钉（含新增履约通知归属与 correction 阶段检查）。
- `scripts/inspect-whole-site-page-action-manifest.test.mjs`：multi-duty SMS 契约 fixture 增补履约通知服务源码。
- `docs/product/manifests/web-page-actions.registry.json`：删除 `contract-change.create-draft`。
- `docs/product/manifests/web-page-actions.json`、`whole-site-capability-matrix.json`/`.md`、`user-fill-entry-inventory.json`：按当前事实重生成（状态为 blocked 的生成事实）。
- `docs/product/manifests/route-usage.registry.json`/`route-usage.json`：2 条分类与 expectation/hash 更新。
- `docs/product/contract-workbench-capability-matrix.md`：按 route-usage 退出候选 53 重生成。

说明：本机沙箱拒绝 Prisma 用户缓存 `utime`，`pnpm run inspect:whole-site-capabilities` 的 API build 需显式 `PRISMA_SCHEMA_ENGINE_BINARY`/`PRISMA_QUERY_LIBRARY` 覆盖生成本地 client（未入库，属执行环境差异）。

## 仍未过项与需产品介入

1. **16 条新增写 wrapper**（上表）：门禁要求专用证明或页面重构；当前不能在不改变判定逻辑、不虚假登记的前提下转绿。需决定：补 5 个页面的专用 witness（推荐，保持现有页面行为）还是重构写 handler/能力门。
2. **`POST /contracts/:contractVersionId/change-drafts`**：需决定旧合同变更草稿 HTTP 入口是否正式停止（410）并同步迁移 `contract-business-entry-http.spec.ts` 的合同变更验收链；在此之前保留未分类，route-usage/capability-matrix/contract-mutation-authority 保持红。
3. 16 条里的能力缺口（履约 review 的 per-duty 布尔、附件下载能力布尔、付款依据附件覆盖范围）如要补，需后端 read model 增加显式布尔，不能由前端伪造。
