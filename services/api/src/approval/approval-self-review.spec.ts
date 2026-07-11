import { assertOrdinaryApplicantCannotReview } from "./approval-self-review";

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
