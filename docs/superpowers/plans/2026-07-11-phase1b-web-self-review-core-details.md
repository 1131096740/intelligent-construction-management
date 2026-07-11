# Web 核心详情自审确认与记录展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development`. Implement this plan in one focused task, then request independent spec and code-quality review.

**Goal:** 在合同、结算、付款三个真实详情审批入口中，仅当当前登录人正在处理自己发起的董事长/总经理终审节点时，明确展示自审警示并强制收集独立原因和当前密码；审批历史同时明确展示自审标记和原因。

**Architecture:** 后端详情读模型把当前审批访问判断从单一布尔值扩展为 `{ canAct, canReview, requiresSelfReviewConfirmation }`。`canAct` 保留直接岗位、节点 assignment 和有效委托对转审/委托的既有能力；普通申请人本人在普通节点只能继续转交/委托，`canReview` 必须为 false。只有申请人与处理人相同、实际解析岗位是 `chairman`/`general_manager`、处理人直接持有同一岗位时，`canReview` 和 `requiresSelfReviewConfirmation` 才同时为 true，不能因混合岗位、转交或委托误标。该字段仅挂在 `review_approval` 动作元数据上。Web 使用一个跨域 TDesign 组合组件和一个纯 payload helper，三个详情页复用；非自审不发送原因或密码。审批时间线从既有 action metadata 映射 `selfReview` 和 `selfReviewReason`，共享组件展示警示标签与原因。项目支出当前是列表式操作且没有同等详情动作/时间线契约，留到紧接的独立切片，不能据此宣称四类 Web 交互全部完成。

**Tech Stack:** NestJS, Prisma read services, shared-domain TypeScript contracts, Vue 3, TDesign Vue Next, Vitest, Jest.

## Global Constraints

- 只修改合同、结算、付款详情读模型及其 Web 审批表单；不改变审批写逻辑、OR 签、委托、转交或权限矩阵。
- `requiresSelfReviewConfirmation` 只能由后端真实审批实例和当前节点推导，前端不得凭用户岗位猜测。
- 现有 `canReviewApproval` 同时控制审批、转审和委托；实现时必须拆开 `canAct` 与 `canReview`，不得因普通申请人禁自审而误隐藏转审/委托。
- 非自审不得要求或发送当前密码；自审密码不得出现在响应、时间线、日志展示、错误快照或持久化字段。
- 自审原因最多 500 字、密码最多 256 字，与后端 DTO 契约一致；密码仅判空，不 trim 后发送。
- 相似结构超过两处必须使用共享组件；组件只组合 TDesign 与 `--jg-*` token。
- 项目支出 Web 自审操作和记录展示单列下一切片，`PROGRESS.md` 必须保留该剩余项。

---

### Task 1: 核心详情自审动作元数据、Web 表单与时间线

**Files:**
- Modify: `packages/shared-domain/src/core-flow-read-model.ts`
- Modify: `services/api/src/approval/approval-self-review.ts`
- Modify: `services/api/src/approval/approval-self-review.spec.ts`
- Modify: `services/api/src/approval/approval-node-access.ts`
- Modify: `services/api/src/approval/approval-node-access.spec.ts`
- Modify: `services/api/src/core-flow/detail-actions.ts`
- Modify: `services/api/src/core-flow/approval-timeline-read.ts`
- Modify: `services/api/src/core-flow/approval-timeline-read.spec.ts`
- Modify: `services/api/src/contract/contract-read.service.ts`
- Modify: `services/api/src/contract/contract-read.service.spec.ts`
- Modify: `services/api/src/settlement/settlement-read.service.ts`
- Modify: `services/api/src/settlement/settlement-read.service.spec.ts`
- Modify: `services/api/src/payment/payment-read.service.ts`
- Modify: `services/api/src/payment/payment-read.service.spec.ts`
- Add: `apps/web-admin/src/components/approval-self-review.config.ts`
- Add: `apps/web-admin/src/components/approval-self-review.config.test.ts`
- Add: `apps/web-admin/src/components/ApprovalSelfReviewFields.vue`
- Modify: `apps/web-admin/src/components/ApprovalTimeline.vue`
- Modify: `apps/web-admin/src/components/business-action-panel.config.ts`
- Modify: `apps/web-admin/src/components/business-action-panel.config.test.ts`
- Modify: `apps/web-admin/src/pages/contracts/ContractDetailPage.vue`
- Modify: `apps/web-admin/src/pages/settlements/SettlementDetailPage.vue`
- Modify: `apps/web-admin/src/pages/payments/PaymentDetailPage.vue`
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 写后端读契约和时间线 RED**

新增共享纯函数测试：仅 `applicantUserId === actorUserId`，且当前待处理岗位与处理人直接岗位交集包含 `chairman`/`general_manager` 时返回 true；mixed leader + ordinary node、普通受托 leader node、非申请人均为 false。

在 `approval-node-access.spec.ts` 和三个 read service spec 中增加真实详情断言：领导本人在领导终审节点得到启用的 `review_approval.requiresSelfReviewConfirmation === true`；普通申请人本人在普通节点的 `review_approval` 禁用但转审/委托仍按既有处理资格启用；委托处理和非本人业务为 false/undefined。结算不含领导终审节点，即使申请人兼任领导也绝不标记自审确认。审批实例查询必须选择 `applicantUserId`。

在 `approval-timeline-read.spec.ts` 中先断言 metadata `{ selfReview: true, selfReviewReason: "  紧急业务由本人发起  " }` 映射为 `selfReview: true` 和修剪后的原因；普通记录映射为 false/null；非布尔标记不得误显示。

- [ ] **Step 2: 运行后端 RED**

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/approval/approval-self-review.spec.ts \
  src/approval/approval-node-access.spec.ts \
  src/core-flow/approval-timeline-read.spec.ts \
  src/contract/contract-read.service.spec.ts \
  src/settlement/settlement-read.service.spec.ts \
  src/payment/payment-read.service.spec.ts
```

Expected: 新共享判断、动作字段和时间线字段因尚未实现而失败；先修正 fixture/type 错误，不能把编译错误冒充完整行为 RED。

- [ ] **Step 3: 实现最小后端详情契约**

在共享自审策略文件增加无数据库依赖的读侧判断函数，复用同一领导岗位集合。三个 read service 的当前审批访问结果改为：

```ts
interface ApprovalReviewAccess {
  canAct: boolean;
  canReview: boolean;
  requiresSelfReviewConfirmation: boolean;
}
```

读侧实际角色解析顺序必须与写侧保持一致：直接岗位 -> 节点 assignment -> 有效委托。前三者都可形成 `canAct`；普通同人自审把 `canReview` 收紧为 false，只有直接持有当前领导岗位的同人终审才同时允许 review 并标记自审确认。`DetailActionReadModel` 和 `detailAction` 增加可选 `requiresSelfReviewConfirmation`，只传给 `review_approval`；转审和委托继续使用 `canAct`。

`ApprovalTimelineItemReadModel` 增加 `selfReview: boolean`、`selfReviewReason: string | null`；读服务只接受 metadata 的严格布尔 `true`，原因使用现有字符串安全读取并 trim。

- [ ] **Step 4: 写 Web payload helper RED**

`approval-self-review.config.test.ts` 覆盖：

1. 非自审返回 `{}`，不携带表单中的原因和密码。
2. 自审缺少原因/密码分别抛固定中文错误。
3. 原因 trim 后发送；密码只判空、原样发送。
4. 原因超过 500 字、密码超过 256 字在客户端固定拒绝。

- [ ] **Step 5: 实现共享 Web 组件并接入三个详情页**

纯 helper 返回 `Pick<Review*ApprovalPayload, "selfReviewReason" | "confirmationPassword">` 兼容形状。共享组件在需要自审时展示 TDesign warning alert、原因输入和 `type="password"` 当前密码输入；通过 props/emits 双向绑定，不保存密码到 localStorage 或 URL。

三个详情页从 `review_approval` 动作读取标记，调用 helper 后把结果合并进既有审批 payload。操作成功后清空自审原因和密码；失败时保留供用户修正。`ApprovalTimeline.vue` 对自审记录展示“领导自审”警示标签和独立原因，普通记录布局保持不变。

`business-action-panel.config.ts` 对带 flag 的动作提示“需填写自审原因”和“需当前密码”；API payload 类型补齐两个可选字段，并由 `core-flow-read.api.test.ts` 验证三个请求原样发送且不改写密码。

- [ ] **Step 6: 运行 GREEN 与门禁**

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/approval/approval-self-review.spec.ts \
  src/approval/approval-node-access.spec.ts \
  src/core-flow/approval-timeline-read.spec.ts \
  src/contract/contract-read.service.spec.ts \
  src/settlement/settlement-read.service.spec.ts \
  src/payment/payment-read.service.spec.ts
pnpm --filter @jiangkong/web-admin test -- approval-self-review.config.test.ts core-flow-read.api.test.ts business-action-panel.config.test.ts
pnpm --filter @jiangkong/shared-domain typecheck
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git diff --check
```

- [ ] **Step 7: 更新进度并提交**

`PROGRESS.md` 记录合同/结算/付款 Web 自审确认和共享审批时间线展示完成，明确项目支出 Web 列表式入口仍待独立切片；不得把阶段 B 或真实试运行标记为整体完成。

```bash
git add PROGRESS.md docs/superpowers/plans/2026-07-11-phase1b-web-self-review-core-details.md packages/shared-domain/src/core-flow-read-model.ts services/api/src apps/web-admin/src
git commit -m "feat: 完成核心详情自审交互"
```

### 独立复审必修收口

- [x] 读侧不再对待处理岗位做“任一领导交集”，而是与写侧一致，按冻结节点 `roleKeys` 顺序选取当前人第一个直接持有的岗位作为实际 `approvedRoleKey`，再判断是否为董事长/总经理；`[budget_director, chairman]` 且申请人同时持有两岗时不得误放行。
- [x] Web 长度预检与 class-validator 对齐为 Unicode code point 计数；表单控件不再使用按 UTF-16 code unit 截断的 `maxlength`，后端仍作最终校验。
- [x] 两项修复均先新增边界回归并得到有效 RED，再最小修复转 GREEN；修复以独立 commit 提交，不 amend 原功能提交。
