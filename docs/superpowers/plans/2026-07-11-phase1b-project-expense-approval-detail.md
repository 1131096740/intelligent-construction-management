# 项目支出独立审批详情与自审交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` and `superpowers:test-driven-development`. Implement as one focused task and request independent review before completion.

**Goal:** 为报销、零星采购及其他项目支出提供真实可授权的独立审批详情页，准确展示当前节点、审批动作和历史；普通申请人不能自审，董事长/总经理仅在自己直接持有的领导终审节点填写原因和当前密码后自审。

**Architecture:** 新增 `GET /projects/:projectId/expense-requests/:expenseRequestId/approval-detail` 聚合支出摘要、当前审批节点、单个 `reviewAction: DetailActionReadModel` 与共享审批时间线。服务按项目和单据校验可见性，申请人本人可读；其他用户必须具备 `project_expense.approve` 有效岗位。项目支出写侧不支持 assignment、转交或委托，读侧也只按冻结节点岗位顺序解析当前用户第一个直接有效岗位，不能复用允许 assignment/delegation 的通用 `canAct`。Web 新增独立 TDesign 详情页并复用 Task 3 的 `ApprovalSelfReviewFields`、payload helper、`BusinessActionPanel` 和 `ApprovalTimeline`。审批中心将项目支出目标路由改到独立详情；旧项目经营页不再直接提交审批，只跳转到该详情，避免 `status === approval_pending` 误显示可审批。

**Tech Stack:** NestJS, Prisma, shared-domain, Vue 3, TDesign Vue Next, Jest, Vitest.

## Global Constraints

- 不改变项目支出冻结节点、金额、资金池、实付、入账、PDF、附件、收货或现有写侧审批事务。
- 项目支出不支持 assignment/standing delegation；读侧不得虚构这些能力。
- 普通申请人本人节点：详情可读，review action 禁用并显示固定原因。
- 领导本人终审：只有按节点顺序解析出的实际直接岗位为 `chairman`/`general_manager` 时启用 review 并标记 `requiresSelfReviewConfirmation`。
- 非本人且直接拥有当前节点岗位：普通审批启用，不发送自审字段。
- 密码只随审批请求传输；成功清空，失败保留，不进入 read model、URL、timeline 或本地持久化。
- 旧项目经营页保留实付、采购执行、入账、附件等动作，但移除直接 approve/reject 表单和调用，审批中支出只提供独立详情入口。
- 不扩大项目经营资金总览的可见岗位；独立详情避免把现金池/经营数据暴露给仅需审批的部门主管。

---

### Task 1: 后端审批详情聚合与精确动作

**Files:**
- Modify: `packages/shared-domain/src/core-flow-read-model.ts`
- Modify: `services/api/src/project-expense/project-expense.controller.ts`
- Modify: `services/api/src/project-expense/project-expense.controller.spec.ts`
- Modify: `services/api/src/project-expense/project-expense.service.ts`
- Modify: `services/api/src/project-expense/project-expense.service.spec.ts`
- Reuse: `services/api/src/core-flow/approval-timeline-read.ts`
- Reuse: `services/api/src/core-flow/detail-actions.ts`
- Reuse: `services/api/src/approval/approval-self-review.ts`

- [x] **Step 1: 写服务与控制器 RED**

`project-expense.service.spec.ts` 覆盖：

1. 非申请人直接持有当前节点岗位，详情可读且 `reviewAction.enabled === true`，无自审 flag。
2. 普通申请人本人直接持有当前普通岗位，详情可读但 review 禁用，原因是“申请人不能审批自己发起的业务”。
3. 领导申请人本人在领导终审，review 启用且自审 flag 为 true。
4. mixed `[budget_director, chairman]` 且本人持有两岗，按顺序解析普通岗位并禁用。
5. 无当前节点岗位的非申请人固定 403，不泄露单据；申请人本人即使无审批岗位仍可读自己的详情但不能 review。
6. 非审批中状态返回可读详情和禁用 action，不查询不存在的当前实例时安全降级。
7. 时间线调用 `project_expense_request`，返回现有自审标记、节点和岗位。

`project-expense.controller.spec.ts` 断言 GET 路由把 projectId、expenseRequestId、user.id 原样转发，且 GET 不要求粗粒度岗位装饰器；最终授权由 service 的单据/项目/申请人/有效岗位共同决定。

- [x] **Step 2: 运行 RED**

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/project-expense/project-expense.service.spec.ts \
  src/project-expense/project-expense.controller.spec.ts
```

- [x] **Step 3: 实现最小聚合详情**

在 shared-domain 增加 `ProjectExpenseApprovalDetailReadModel`，至少包含：

```ts
{
  id: string;
  projectId: string;
  code: string;
  title: string;
  status: string;
  statusLabel: string;
  expenseTypeLabel: string;
  expenseSubtypeLabel: string;
  paymentSubject: string;
  reason: string;
  requestedAmountCents: MoneyCents;
  approvedAmountCents: MoneyCents | null;
  currentNodeName: string | null;
  reviewAction: DetailActionReadModel;
  approvalTimeline: ApprovalTimelineItemReadModel[];
}
```

服务先查 `projectId + expenseRequestId`，再加载 actor 针对项目的有效岗位；申请人本人或 `canPerform("project_expense.approve", roleKeys)` 才可读。审批中实例按最新 `in_progress` 读取 frozenNodes/current index/applicant；实际岗位严格使用当前节点 roleKeys 顺序 `.find`。action 使用共享 `detailAction`，但 `skipRoleCheck: true`，enabled 完全由当前节点与自审规则决定。

---

### Task 2: API、审批中心路由与独立 Web 详情

**Files:**
- Modify: `apps/web-admin/src/api/core-flow-read.api.ts`
- Modify: `apps/web-admin/src/api/core-flow-read.api.test.ts`
- Modify: `apps/web-admin/src/routes/route-records.ts`
- Modify: `apps/web-admin/src/routes/index.test.ts`
- Add: `apps/web-admin/src/pages/projects/ProjectExpenseApprovalDetailPage.vue`
- Modify: `apps/web-admin/src/pages/projects/ProjectOperatingOverviewPage.vue`
- Modify: `services/api/src/me/me.service.ts`
- Modify: `services/api/src/me/me.service.spec.ts`
- Modify: `PROGRESS.md`

- [x] **Step 4: 写 API 和路由 RED**

- API client 测试详情 GET 路径和返回类型；项目支出 review payload 继续验证密码原样。
- route 测试存在 `/项目支出/:projectId/:expenseRequestId`，不使用资金总览岗位 meta 限制。
- MeService 测试项目支出待办/已办 targetPath 精确为 `/项目支出/{projectId}/{expenseRequestId}`。
- 项目支出 config 纯测试覆盖从旧项目经营列表构造独立审批详情路径。

- [x] **Step 5: 实现独立详情页和旧入口收口**

独立页加载聚合详情，使用 TDesign summary/card/alert/input/button 与项目 token；显示金额、原因、状态、当前节点、`BusinessActionPanel` 和 `ApprovalTimeline`。review action 启用时展示审批意见、批准金额和共享自审字段；reject 必须有审批意见，approve 金额使用现有纯字符串元分 helper。请求成功刷新详情并清空自审字段，失败保留。

旧 `ProjectOperatingOverviewPage.vue` 删除直接 review API import、审批意见/批准金额表单字段和 `submitExpenseReview`；审批中行的处理面板只提供“打开审批详情”，跳到独立路由。其他采购执行、实付、入账、收货和下载动作保持不变。

- [x] **Step 6: GREEN 与门禁**

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/project-expense/project-expense.service.spec.ts \
  src/project-expense/project-expense.controller.spec.ts \
  src/me/me.service.spec.ts \
  src/core-flow/approval-timeline-read.spec.ts \
  src/approval/approval-self-review.spec.ts
pnpm --filter @jiangkong/web-admin test -- \
  core-flow-read.api.test.ts \
  project-expense.config.test.ts \
  routes/index.test.ts \
  approval-self-review.config.test.ts
pnpm --filter @jiangkong/shared-domain typecheck
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
git diff --check
```

- [x] **Step 7: 更新进度并提交**

`PROGRESS.md` 记录四类 Web 自审入口全部完成，但仍不得宣称组织权限管理 UI、真实账号链路或真实试运行整体完成。

```bash
git add PROGRESS.md docs/superpowers/plans/2026-07-11-phase1b-project-expense-approval-detail.md packages/shared-domain/src services/api/src apps/web-admin/src
git commit -m "feat: 完成项目支出审批详情"
```

---

### Independent Review Fixes

- [x] approve/reject 完成全部字段校验后、请求前复用 `confirmSensitiveAction`；取消确认零请求。
- [x] 新增注入式 review helper，测试取消不提交、确认只提交一次。
- [x] 两个审批按钮共享 busy 禁用状态，入口 guard 阻止程序化并发。
- [x] 详情读模型仅在冻结流程最终节点标记可填写批准金额；非终审不展示、不发送。
- [x] 终审批准金额恢复正数元输入规则，`0`、负数、非法格式固定拒绝。
- [x] 删除详情新增的重复标签 map，复用项目支出既有标签 helper，并只新增单一状态 helper。
