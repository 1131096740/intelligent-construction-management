import {
  assertOrdinaryApplicantCannotReview,
  confirmApprovalSelfReview
} from "./approval-self-review";

describe("assertOrdinaryApplicantCannotReview", () => {
  it("拒绝普通岗位申请人审批自己发起的业务", () => {
    expect(() =>
      assertOrdinaryApplicantCannotReview({
        applicantUserId: "user-1",
        actorUserId: "user-1",
        actorRoleKeys: ["project_manager", "super_admin"]
      })
    ).toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
  });

  it.each(["chairman", "general_manager"] as const)("暂保留 %s 自审兼容出口", (role) => {
    expect(() =>
      assertOrdinaryApplicantCannotReview({
        applicantUserId: "leader-1",
        actorUserId: "leader-1",
        actorRoleKeys: [role]
      })
    ).not.toThrow();
  });

  it("非申请人不受自审规则影响", () => {
    expect(() =>
      assertOrdinaryApplicantCannotReview({
        applicantUserId: "applicant-1",
        actorUserId: "approver-1",
        actorRoleKeys: ["finance_director"]
      })
    ).not.toThrow();
  });
});

describe("confirmApprovalSelfReview", () => {
  it("董事长自审缺少原因时拒绝且不校验密码", async () => {
    const confirmPassword = jest.fn();

    await expect(
      confirmApprovalSelfReview({
        applicantUserId: "leader-1",
        actorUserId: "leader-1",
        actorRoleKeys: ["chairman"],
        selfReviewReason: "   ",
        confirmationPassword: "secret",
        confirmPassword
      })
    ).rejects.toThrow("董事长或总经理审批自己发起的业务时，请填写自审原因");
    expect(confirmPassword).not.toHaveBeenCalled();
  });

  it("总经理自审缺少当前密码时拒绝", async () => {
    await expect(
      confirmApprovalSelfReview({
        applicantUserId: "leader-1",
        actorUserId: "leader-1",
        actorRoleKeys: ["general_manager"],
        selfReviewReason: "项目紧急且由本人发起",
        confirmationPassword: "",
        confirmPassword: jest.fn()
      })
    ).rejects.toThrow("董事长或总经理自审前，请输入当前密码完成二次确认");
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

  it("非自审不调用密码回调并返回空 metadata", async () => {
    const confirmPassword = jest.fn();

    await expect(
      confirmApprovalSelfReview({
        applicantUserId: "applicant-1",
        actorUserId: "leader-1",
        actorRoleKeys: ["chairman"],
        confirmPassword
      })
    ).resolves.toEqual({ isSelfReview: false, metadata: {} });
    expect(confirmPassword).not.toHaveBeenCalled();
  });

  it("普通角色同人自审仍优先返回禁止自审", async () => {
    const confirmPassword = jest.fn();

    await expect(
      confirmApprovalSelfReview({
        applicantUserId: "user-1",
        actorUserId: "user-1",
        actorRoleKeys: ["project_manager"],
        selfReviewReason: "业务紧急",
        confirmationPassword: "top-secret",
        confirmPassword
      })
    ).rejects.toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
    expect(confirmPassword).not.toHaveBeenCalled();
  });

  it("领导自审缺少密码服务时返回服务不可用", async () => {
    await expect(
      confirmApprovalSelfReview({
        applicantUserId: "leader-1",
        actorUserId: "leader-1",
        actorRoleKeys: ["chairman"],
        selfReviewReason: "业务紧急",
        confirmationPassword: "top-secret"
      })
    ).rejects.toThrow("审批身份确认服务暂不可用，请稍后重试");
  });
});
