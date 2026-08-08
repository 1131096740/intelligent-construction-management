import {
  assertOrdinaryApplicantCannotReview,
  confirmApprovalSelfReview,
  requiresApprovalSelfReviewConfirmation
} from "./approval-self-review";

describe("requiresApprovalSelfReviewConfirmation", () => {
  it.each(["chairman", "general_manager"] as const)(
    "requires confirmation when the applicant directly holds the pending %s role",
    (role) => {
      expect(
        requiresApprovalSelfReviewConfirmation({
          applicantUserId: "leader-1",
          actorUserId: "leader-1",
          actorRoleKeys: [role],
          nodeRoleKeys: [role]
        })
      ).toBe(true);
    }
  );

  it("requires confirmation for the scoped contract-director handler self-review", () => {
    expect(requiresApprovalSelfReviewConfirmation({
      applicantUserId: "contract-director-1",
      actorUserId: "contract-director-1",
      actorRoleKeys: ["contract_director"],
      nodeRoleKeys: ["contract_director"],
      allowContractDirectorSelfReview: true
    })).toBe(true);
  });

  it.each([
    {
      name: "mixed leader and ordinary roles at an ordinary node",
      applicantUserId: "leader-1",
      actorUserId: "leader-1",
      actorRoleKeys: ["chairman", "budget_director"],
      nodeRoleKeys: ["budget_director"]
    },
    {
      name: "ordinary delegate at a leader node",
      applicantUserId: "delegate-1",
      actorUserId: "delegate-1",
      actorRoleKeys: ["budget_director"],
      nodeRoleKeys: ["chairman"]
    },
    {
      name: "another user's business",
      applicantUserId: "applicant-1",
      actorUserId: "chairman-1",
      actorRoleKeys: ["chairman"],
      nodeRoleKeys: ["chairman"]
    }
  ] as const)("does not require confirmation for $name", (input) => {
    expect(requiresApprovalSelfReviewConfirmation(input)).toBe(false);
  });
});

describe("assertOrdinaryApplicantCannotReview", () => {
  it("拒绝普通岗位申请人审批自己发起的业务", () => {
    expect(() =>
      assertOrdinaryApplicantCannotReview({
        applicantUserId: "user-1",
        actorUserId: "user-1",
        actorRoleKeys: ["project_manager", "super_admin"],
        approvedRoleKey: "project_manager"
      })
    ).toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
  });

  it.each(["chairman", "general_manager"] as const)("仅允许 %s 以同一领导岗位终审自审", (role) => {
    expect(() =>
      assertOrdinaryApplicantCannotReview({
        applicantUserId: "leader-1",
        actorUserId: "leader-1",
        actorRoleKeys: [role],
        approvedRoleKey: role
      })
    ).not.toThrow();
  });

  it("非申请人不受自审规则影响", () => {
    expect(() =>
      assertOrdinaryApplicantCannotReview({
        applicantUserId: "applicant-1",
        actorUserId: "approver-1",
        actorRoleKeys: ["finance_director"],
        approvedRoleKey: "finance_director"
      })
    ).not.toThrow();
  });

  it("冻结领导候选调岗后拒绝自审", () => {
    expect(() => assertOrdinaryApplicantCannotReview({
      applicantUserId: "leader-1",
      actorUserId: "leader-1",
      actorRoleKeys: [],
      approvedRoleKey: "chairman",
      representedUserId: "leader-1"
    })).toThrow("申请人不能审批自己发起的业务");
  });

  it("节点指派不能制造领导自审例外", () => {
    expect(() => assertOrdinaryApplicantCannotReview({
      applicantUserId: "delegate-1",
      actorUserId: "delegate-1",
      actorRoleKeys: [],
      approvedRoleKey: "chairman",
      representedUserId: "leader-1",
      viaAssignment: true
    })).toThrow("申请人不能审批自己发起的业务");
  });
});

describe("confirmApprovalSelfReview", () => {
  it("allows the scoped current contract-director handler self-review", async () => {
    const confirmPassword = jest.fn().mockResolvedValue({ ok: true });

    await expect(confirmApprovalSelfReview({
      applicantUserId: "contract-director-1",
      actorUserId: "contract-director-1",
      actorRoleKeys: ["contract_director"],
      approvedRoleKey: "contract_director",
      selfReviewReason: "  当前项目由本人兼任合同经办与合同部主管  ",
      confirmationPassword: "current-password",
      confirmPassword,
      allowContractDirectorSelfReview: true
    })).resolves.toEqual({
      isSelfReview: true,
      metadata: {
        selfReview: true,
        selfReviewReason: "当前项目由本人兼任合同经办与合同部主管"
      }
    });
    expect(confirmPassword).toHaveBeenCalledWith("current-password");
  });

  it("does not expand the contract-director self-review exception to other flows", () => {
    expect(() => assertOrdinaryApplicantCannotReview({
      applicantUserId: "contract-director-1",
      actorUserId: "contract-director-1",
      actorRoleKeys: ["contract_director"],
      approvedRoleKey: "contract_director"
    })).toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
  });

  it("董事长自审缺少原因时拒绝且不校验密码", async () => {
    const confirmPassword = jest.fn();

    await expect(
      confirmApprovalSelfReview({
        applicantUserId: "leader-1",
        actorUserId: "leader-1",
        actorRoleKeys: ["chairman"],
        approvedRoleKey: "chairman",
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
        approvedRoleKey: "general_manager",
        selfReviewReason: "项目紧急且由本人发起",
        confirmationPassword: "",
        confirmPassword: jest.fn()
      })
    ).rejects.toThrow("董事长或总经理自审前，请输入当前密码完成二次确认");
  });

  it.each([
    [
      { confirmationPassword: "current-password" },
      "合同部主管审批自己发起的业务时，请填写自审原因"
    ],
    [
      { selfReviewReason: "合同经办与合同部主管兼任" },
      "合同部主管自审前，请输入当前密码完成二次确认"
    ]
  ] as const)("合同部主管自审缺少确认事实时保留岗位语义", async (input, message) => {
    await expect(confirmApprovalSelfReview({
      applicantUserId: "contract-director-1",
      actorUserId: "contract-director-1",
      actorRoleKeys: ["contract_director"],
      approvedRoleKey: "contract_director",
      allowContractDirectorSelfReview: true,
      confirmPassword: jest.fn(),
      ...input
    })).rejects.toThrow(message);
  });

  it("正确密码确认后只返回自审标记和修剪后的原因", async () => {
    const confirmPassword = jest.fn().mockResolvedValue({ ok: true });
    const input = {
      applicantUserId: "leader-1",
      actorUserId: "leader-1",
      actorRoleKeys: ["chairman"] as const,
      approvedRoleKey: "chairman" as const,
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
        approvedRoleKey: "chairman",
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
        approvedRoleKey: "project_manager",
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
        approvedRoleKey: "chairman",
        selfReviewReason: "业务紧急",
        confirmationPassword: "top-secret"
      })
    ).rejects.toThrow("审批身份确认服务暂不可用，请稍后重试");
  });

  it("混合岗位领导在普通节点审批本人业务时仍返回禁止自审", async () => {
    const confirmPassword = jest.fn();

    await expect(
      confirmApprovalSelfReview({
        applicantUserId: "leader-1",
        actorUserId: "leader-1",
        actorRoleKeys: ["chairman", "budget_director"],
        approvedRoleKey: "budget_director",
        selfReviewReason: "业务紧急",
        confirmationPassword: "top-secret",
        confirmPassword
      })
    ).rejects.toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
    expect(confirmPassword).not.toHaveBeenCalled();
  });

  it("普通受托人在领导节点审批本人业务时仍返回禁止自审", async () => {
    const confirmPassword = jest.fn();

    await expect(
      confirmApprovalSelfReview({
        applicantUserId: "delegate-1",
        actorUserId: "delegate-1",
        actorRoleKeys: ["budget_director"],
        approvedRoleKey: "chairman",
        selfReviewReason: "受托处理",
        confirmationPassword: "top-secret",
        confirmPassword
      })
    ).rejects.toThrow("申请人不能审批自己发起的业务，请由其他有权限的审批人处理");
    expect(confirmPassword).not.toHaveBeenCalled();
  });

  it("当前密码只用 trim 判断空白并把原始值传给密码服务", async () => {
    const confirmPassword = jest.fn().mockResolvedValue({ ok: true });

    await confirmApprovalSelfReview({
      applicantUserId: "leader-1",
      actorUserId: "leader-1",
      actorRoleKeys: ["chairman"],
      approvedRoleKey: "chairman",
      selfReviewReason: "业务紧急",
      confirmationPassword: " top-secret ",
      confirmPassword
    });

    expect(confirmPassword).toHaveBeenCalledWith(" top-secret ");
  });
});
