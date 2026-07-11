# 董事长与总经理自审确认 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让董事长/总经理在合同、结算、付款、报销/零星采购中审批自己发起的业务时，必须填写独立自审原因、验证当前密码，并在审批动作日志和审计日志中留下明确且不含密码的自审标记。

**Architecture:** 扩展现有 `approval-self-review.ts` 为共享异步确认策略，复用四个服务已经注入的 `AuthService.confirmPassword`。四个 `reviewApproval` 在节点资格确认后、任何写入前取得 `selfReview` 结果，并把 `{ selfReview: true, selfReviewReason }` 合并到审批动作日志和审计 metadata；非自审行为保持原契约。

**Tech Stack:** NestJS, TypeScript, class-validator, Jest, Prisma transactions.

## Global Constraints

- 除董事长/总经理外的普通申请人自审仍按上一切片统一返回 403。
- 董事长/总经理自审必须同时具备直接业务岗位、自审原因和当前密码确认。
- `super_admin` 或审批委托不得产生董事长/总经理自审例外。
- 当前密码只传给 `AuthService.confirmPassword`，不得进入审批日志、审计 metadata、错误消息或测试快照。
- 自审确认失败必须发生在业务状态、审批实例、动作日志、额度、PDF 和审计写入之前。
- 合同、结算、付款、报销和零星采购使用同一共享确认策略。
- 本切片不改变审批节点、OR 签、转交、委托、退回、金额、归档或普通非自审审批。
- 用户可见错误必须是固定中文业务表达。
- 按 TDD 先验证缺少原因/密码、错误密码和四域日志缺标记的 RED，再写最小实现。

---

### Task 1: 四类审批的领导自审二次确认与审计

**Files:**
- Modify: `services/api/src/approval/approval-self-review.ts`
- Modify: `services/api/src/approval/approval-self-review.spec.ts`
- Modify: `services/api/src/contract/dto/review-contract-approval.dto.ts`
- Modify: `services/api/src/settlement/dto/review-settlement-approval.dto.ts`
- Modify: `services/api/src/payment/dto/review-payment-approval.dto.ts`
- Modify: `services/api/src/project-expense/dto/review-project-expense-approval.dto.ts`
- Modify: `services/api/src/contract/contract.controller.spec.ts`
- Modify: `services/api/src/settlement/settlement.controller.spec.ts`
- Modify: `services/api/src/payment/payment.controller.spec.ts`
- Modify: `services/api/src/project-expense/project-expense.controller.spec.ts`
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
- Preserve: `assertOrdinaryApplicantCannotReview(input): void`。
- Add: `confirmApprovalSelfReview(input): Promise<ApprovalSelfReviewResult>`。
- DTO add: `selfReviewReason?: string`、`confirmationPassword?: string`；两字段只在后端识别为真实领导自审时强制必填。
- `ApprovalSelfReviewResult.metadata` 只允许 `{}` 或 `{ selfReview: true; selfReviewReason: string }`。

- [ ] **Step 1: 写共享确认策略 RED 测试**

扩展 `approval-self-review.spec.ts`：

```ts
it("董事长自审缺少原因时拒绝且不校验密码", async () => {
  const confirmPassword = jest.fn();
  await expect(confirmApprovalSelfReview({
    applicantUserId: "leader-1",
    actorUserId: "leader-1",
    actorRoleKeys: ["chairman"],
    selfReviewReason: "   ",
    confirmationPassword: "secret",
    confirmPassword
  })).rejects.toThrow("董事长或总经理审批自己发起的业务时，请填写自审原因");
  expect(confirmPassword).not.toHaveBeenCalled();
});

it("总经理自审缺少当前密码时拒绝", async () => {
  await expect(confirmApprovalSelfReview({
    applicantUserId: "leader-1",
    actorUserId: "leader-1",
    actorRoleKeys: ["general_manager"],
    selfReviewReason: "项目紧急且由本人发起",
    confirmationPassword: "",
    confirmPassword: jest.fn()
  })).rejects.toThrow("董事长或总经理自审前，请输入当前密码完成二次确认");
});

it("正确密码确认后只返回自审标记和修剪后的原因", async () => {
  const confirmPassword = jest.fn().mockResolvedValue({ ok: true });
  const input = {
    applicantUserId: "leader-1",
    actorUserId: "leader-1",
    actorRoleKeys: ["chairman"] as const,
    selfReviewReason: "  项目紧急且由本人发起  ",
    confirmationPassword: "top-secret",
    confirmPassword
  };
  await expect(confirmApprovalSelfReview(input)).resolves.toEqual({
    isSelfReview: true,
    metadata: { selfReview: true, selfReviewReason: "项目紧急且由本人发起" }
  });
  expect(confirmPassword).toHaveBeenCalledWith("top-secret");
  expect(JSON.stringify(await confirmApprovalSelfReview(input))).not.toContain("top-secret");
});
```

另覆盖：非自审不调用密码回调并返回 `{ isSelfReview: false, metadata: {} }`；普通角色同人自审仍优先返回上一切片 403；缺少密码服务时返回“审批身份确认服务暂不可用，请稍后重试”。

- [ ] **Step 2: 写 DTO 运行时验证 RED**

在四个 controller spec 的既有 `reviewApproval` ValidationPipe 测试中增加：

```ts
const body = {
  decision: "approve",
  selfReviewReason: "项目紧急且由本人发起",
  confirmationPassword: "current-password"
};
```

断言合法字符串被保留，`null`、数组、对象和数字分别返回固定中文 400；未知字段仍被白名单拒绝/剥离，密码值不得出现在错误响应。DTO 使用 `@ValidateIf` + `@IsString`，并以 `@MaxLength(500)` 限制原因、`@MaxLength(256)` 限制密码，服务层负责自审条件必填。

- [ ] **Step 3: 写四域服务 RED 回归**

每个 service spec 使用申请人与审批人相同、直接岗位为 `chairman` 或 `general_manager` 的 fixture，新增三类断言：

1. 缺少 `selfReviewReason` 或 `confirmationPassword` 时拒绝且业务表、审批实例、动作日志、审计零写入。
2. `AuthService.confirmPassword` 拒绝时原样返回“当前密码不正确，请重新输入”，且零写入。
3. 正确密码时允许既有审批继续；`approvalActionLog.create.data.metadata` 与 `auditLog.create.data.metadata` 都包含 `selfReview: true` 和修剪后的 `selfReviewReason`，同时 `JSON.stringify` 两份 metadata 均不含 `confirmationPassword` 或密码原文。

至少覆盖合同、结算、付款、项目支出四个真实 `reviewApproval`；报销和零星采购通过项目支出共享入口覆盖。

- [ ] **Step 4: 运行 RED 并记录正确失败**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/approval/approval-self-review.spec.ts \
  src/contract/contract.controller.spec.ts \
  src/settlement/settlement.controller.spec.ts \
  src/payment/payment.controller.spec.ts \
  src/project-expense/project-expense.controller.spec.ts \
  src/contract/contract.service.spec.ts \
  src/settlement/settlement.service.spec.ts \
  src/payment/payment-request.service.spec.ts \
  src/project-expense/project-expense.service.spec.ts
```

Expected: 新策略、DTO 字段、自审必填、密码回调和 metadata 断言因能力缺失而失败；既有普通自审 403 测试保持通过。修正所有 fixture/type 错误后，才能把剩余失败作为有效 RED。

- [ ] **Step 5: 实现共享异步确认策略**

在保留 `assertOrdinaryApplicantCannotReview` 的基础上新增：

```ts
export interface ConfirmApprovalSelfReviewInput extends ApprovalSelfReviewInput {
  selfReviewReason?: string;
  confirmationPassword?: string;
  confirmPassword?: (password: string) => Promise<unknown>;
}

export type ApprovalSelfReviewResult =
  | { isSelfReview: false; metadata: Record<string, never> }
  | { isSelfReview: true; metadata: { selfReview: true; selfReviewReason: string } };

export async function confirmApprovalSelfReview(
  input: ConfirmApprovalSelfReviewInput
): Promise<ApprovalSelfReviewResult> {
  assertOrdinaryApplicantCannotReview(input);
  if (input.applicantUserId !== input.actorUserId) {
    return { isSelfReview: false, metadata: {} };
  }
  const selfReviewReason = input.selfReviewReason?.trim();
  if (!selfReviewReason) {
    throw new BadRequestException("董事长或总经理审批自己发起的业务时，请填写自审原因");
  }
  const confirmationPassword = input.confirmationPassword?.trim();
  if (!confirmationPassword) {
    throw new BadRequestException("董事长或总经理自审前，请输入当前密码完成二次确认");
  }
  if (!input.confirmPassword) {
    throw new ServiceUnavailableException("审批身份确认服务暂不可用，请稍后重试");
  }
  await input.confirmPassword(confirmationPassword);
  return { isSelfReview: true, metadata: { selfReview: true, selfReviewReason } };
}
```

- [ ] **Step 6: 扩展四个 DTO**

四个 `Review*ApprovalDto` 使用同名字段和一致验证：

```ts
@ValidateIf((_object, value) => value !== undefined)
@IsString({ message: "自审原因必须是文字" })
@MaxLength(500, { message: "自审原因不能超过 500 个字符" })
selfReviewReason?: string;

@ValidateIf((_object, value) => value !== undefined)
@IsString({ message: "当前密码必须是文字" })
@MaxLength(256, { message: "当前密码格式不正确" })
confirmationPassword?: string;
```

- [ ] **Step 7: 在四个服务接入密码确认与 metadata**

在上一切片调用点把同步断言替换为：

```ts
const selfReview = await confirmApprovalSelfReview({
  applicantUserId: instance.applicantUserId,
  actorUserId,
  actorRoleKeys,
  selfReviewReason: input.selfReviewReason,
  confirmationPassword: input.confirmationPassword,
  confirmPassword: this.auth
    ? (password) => this.auth!.confirmPassword(actorUserId, password)
    : undefined
});
```

所有 `approve`、`reject`、`reject_previous`、`return_to_applicant` 分支的 `approvalActionLog.create.data.metadata` 与 `audit.record(...).metadata` 都合并 `...selfReview.metadata`。原有 nodeName、approvedRoleKey、金额、状态和额度 metadata 不得丢失。项目支出只存在 approve/reject，同样覆盖两分支。密码字段和原文不得进入任何 metadata。

- [ ] **Step 8: 运行 GREEN 与 API 门禁**

Run:

```bash
pnpm --filter @jiangkong/api test -- --runInBand \
  src/approval/approval-self-review.spec.ts \
  src/contract/contract.controller.spec.ts \
  src/settlement/settlement.controller.spec.ts \
  src/payment/payment.controller.spec.ts \
  src/project-expense/project-expense.controller.spec.ts \
  src/contract/contract.service.spec.ts \
  src/settlement/settlement.service.spec.ts \
  src/payment/payment-request.service.spec.ts \
  src/project-expense/project-expense.service.spec.ts
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git diff --check
```

Expected: 九个目标套件及全部门禁退出 0，输出无新增 warning/error。

- [ ] **Step 9: 更新进度并提交**

`PROGRESS.md` 把阶段 B 自审治理更新为后端完整：普通角色禁止自审；董事长/总经理自审必须独立原因和当前密码；审批动作日志与审计 metadata 标记自审且不含密码。明确 Web 自审表单体验仍待下一切片。

```bash
git add PROGRESS.md docs/superpowers/plans/2026-07-11-phase1b-leader-self-review-confirmation.md services/api/src/approval/approval-self-review.ts services/api/src/approval/approval-self-review.spec.ts services/api/src/contract services/api/src/settlement services/api/src/payment services/api/src/project-expense
git commit -m "feat: 完成领导自审二次确认"
```
