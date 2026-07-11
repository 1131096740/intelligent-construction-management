# 普通角色禁止自审 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在合同、结算、付款、报销/零星采购四个共享审批入口中，阻止除董事长和总经理外的申请人审批自己发起的业务。

**Architecture:** 新增一个无数据库依赖的共享审批策略函数，在四个 `reviewApproval` 已完成实例、当前节点、直接岗位和当前节点审批资格解析之后、任何状态/日志/审计写入之前调用。董事长/总经理仅作为下一切片的兼容出口保留，当前切片不实现其自审原因、密码二次确认和 `selfReview` 审计标记，因此不得宣称完整自审规则已经完成。

**Tech Stack:** NestJS, TypeScript, Jest, Prisma transactions.

## Global Constraints

- 除董事长/总经理外，申请人或经办人不得审批本人业务。
- `super_admin` 是技术身份，不得因为技术管理身份绕过业务自审规则。
- 董事长/总经理的例外资格来自其直接业务岗位，不得由审批委托或 `super_admin` 推导。
- 拒绝必须发生在任何业务状态、审批实例、动作日志、额度、PDF 或审计写入之前。
- 合同、结算、付款、报销和零星采购共用同一策略，不复制四份判断。
- 本切片不改变审批节点、OR 签、转交、委托、退回、金额或归档规则。
- 所有用户可见错误使用中文业务表达，不回显内部 ID、岗位 key 或技术异常。
- 按 TDD 先看到四个业务域的缺口测试正确失败，再写最小实现。

---

### Task 1: 四类审批入口普通角色禁止自审

**Files:**
- Create: `services/api/src/approval/approval-self-review.ts`
- Create: `services/api/src/approval/approval-self-review.spec.ts`
- Modify: `services/api/src/contract/contract.service.ts`
- Modify: `services/api/src/contract/contract.service.spec.ts`
- Modify: `services/api/src/settlement/settlement.service.ts`
- Modify: `services/api/src/settlement/settlement.service.spec.ts`
- Modify: `services/api/src/payment/payment-request.service.ts`
- Modify: `services/api/src/payment/payment-request.service.spec.ts`
- Modify: `services/api/src/project-expense/project-expense.service.ts`
- Modify: `services/api/src/project-expense/project-expense.service.spec.ts`
- Modify: `PROGRESS.md`

**Interfaces:**
- Produces: `assertOrdinaryApplicantCannotReview(input: ApprovalSelfReviewInput): void`。
- Consumes: `ApprovalInstance.applicantUserId`、当前 `actorUserId` 和四个服务已经读取的直接 `actorRoleKeys`。
- `ApprovalSelfReviewInput`：`applicantUserId: string`、`actorUserId: string`、`actorRoleKeys: readonly RoleKey[]`。

- [ ] **Step 1: 写共享策略失败测试**

在 `approval-self-review.spec.ts` 写三个纯函数测试：

```ts
it("拒绝普通岗位申请人审批自己发起的业务", () => {
  expect(() => assertOrdinaryApplicantCannotReview({
    applicantUserId: "user-1",
    actorUserId: "user-1",
    actorRoleKeys: ["project_manager", "super_admin"]
  })).toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
});

it.each(["chairman", "general_manager"] as const)("暂保留 %s 自审兼容出口", (role) => {
  expect(() => assertOrdinaryApplicantCannotReview({
    applicantUserId: "leader-1",
    actorUserId: "leader-1",
    actorRoleKeys: [role]
  })).not.toThrow();
});

it("非申请人不受自审规则影响", () => {
  expect(() => assertOrdinaryApplicantCannotReview({
    applicantUserId: "applicant-1",
    actorUserId: "approver-1",
    actorRoleKeys: ["finance_director"]
  })).not.toThrow();
});
```

- [ ] **Step 2: 写四个真实审批入口 RED 回归**

在四个现有 service spec 中各增加一个用既有 fixture 的测试。每个测试都让审批实例 `applicantUserId` 与 `actorUserId` 相同，同时给当前用户直接配置当前节点普通岗位，调用 `reviewApproval(..., { decision: "approve" })` 后断言：

```ts
await expect(review()).rejects.toThrow(
  "申请人不能审批自己发起的业务，请由其他有权限的审批人处理"
);
expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
expect(tx.auditLog.create).not.toHaveBeenCalled();
```

并按领域断言业务表和审批实例零写入：

```ts
expect(tx.contractVersion.update).not.toHaveBeenCalled();
expect(tx.settlement.update).not.toHaveBeenCalled();
expect(tx.paymentRequest.update).not.toHaveBeenCalled();
expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
expect(tx.approvalInstance.update).not.toHaveBeenCalled();
```

合同使用非终审普通岗位 fixture（如合同主管），结算使用预算主管，付款使用综合部主管或项目经理，项目支出使用综合部主管/项目经理；不要把董事长/总经理当 RED 对象。

- [ ] **Step 3: 运行目标测试并确认 RED**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/approval/approval-self-review.spec.ts \
  src/contract/contract.service.spec.ts \
  src/settlement/settlement.service.spec.ts \
  src/payment/payment-request.service.spec.ts \
  src/project-expense/project-expense.service.spec.ts
```

Expected: 新纯函数测试因模块不存在而失败；四个服务回归因当前实现允许写入而失败。必须记录相关失败输出，不能来自 fixture 拼错、类型错误或 Prisma mock 缺失。

- [ ] **Step 4: 实现最小共享策略**

`approval-self-review.ts` 只包含以下策略，不读取数据库、不处理密码、不写审计：

```ts
import { ForbiddenException } from "@nestjs/common";
import type { RoleKey } from "@jiangkong/shared-domain";

const SELF_REVIEW_BUSINESS_ROLES = new Set<RoleKey>(["chairman", "general_manager"]);

export interface ApprovalSelfReviewInput {
  applicantUserId: string;
  actorUserId: string;
  actorRoleKeys: readonly RoleKey[];
}

export function assertOrdinaryApplicantCannotReview(input: ApprovalSelfReviewInput) {
  if (input.applicantUserId !== input.actorUserId) return;
  if (input.actorRoleKeys.some((role) => SELF_REVIEW_BUSINESS_ROLES.has(role))) return;
  throw new ForbiddenException("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
}
```

- [ ] **Step 5: 在四个服务的共同安全点接入**

四个 `reviewApproval` 都在读取 `ApprovalInstance`、当前节点和直接 `actorRoleKeys`，并确认 `approvedRoleKey` 存在之后调用：

```ts
assertOrdinaryApplicantCannotReview({
  applicantUserId: instance.applicantUserId,
  actorUserId,
  actorRoleKeys
});
```

先保留原有“无当前节点审批资格”错误，再执行自审检查，避免无权用户通过错误差异探测申请人信息。调用必须位于任何业务表 `update`、`approvalInstance.update`、`approvalActionLog.create`、额度释放/收缩和 `audit.record` 之前。不要使用 `approvedRoleKey` 判定例外，因为委托得到的来源岗位不代表申请人本人直接拥有董事长/总经理岗位。

- [ ] **Step 6: 运行目标测试并确认 GREEN**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/approval/approval-self-review.spec.ts \
  src/contract/contract.service.spec.ts \
  src/settlement/settlement.service.spec.ts \
  src/payment/payment-request.service.spec.ts \
  src/project-expense/project-expense.service.spec.ts
```

Expected: 五个目标套件全部 PASS，输出无 warning/error。

- [ ] **Step 7: 运行 API 风险门禁**

Run:

```bash
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git diff --check
```

Expected: 全部退出 0。若共享策略改变既有董事长/总经理审批、委托、退回或金额测试，必须修实现而不是放宽测试。

- [ ] **Step 8: 更新进度并提交**

在 `PROGRESS.md` 记录：四类审批普通申请人自审已由共享后端策略硬拦且零写入；董事长/总经理自审原因、当前密码二次确认和 `selfReview` 审计标记仍是下一切片，不能把阶段 B 自审规则标为全部完成。

```bash
git add PROGRESS.md docs/superpowers/plans/2026-07-11-post-phase0-continuation.md docs/superpowers/plans/2026-07-11-phase1a-organization-directory.md docs/superpowers/plans/2026-07-11-phase1b-ordinary-self-review-guard.md services/api/src/approval/approval-self-review.ts services/api/src/approval/approval-self-review.spec.ts services/api/src/contract/contract.service.ts services/api/src/contract/contract.service.spec.ts services/api/src/settlement/settlement.service.ts services/api/src/settlement/settlement.service.spec.ts services/api/src/payment/payment-request.service.ts services/api/src/payment/payment-request.service.spec.ts services/api/src/project-expense/project-expense.service.ts services/api/src/project-expense/project-expense.service.spec.ts
git commit -m "fix: 阻止普通申请人自审"
```
