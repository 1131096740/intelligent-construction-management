import {
  executionOperatingPayee,
  stableExecutionIdentity
} from "./fund-execution-canonical-identity";

describe("资金执行共享 canonical identity", () => {
  it("PaymentExecution 与 FundExecution 对相同业务值生成同一稳定身份", () => {
    expect(
      stableExecutionIdentity("allocation", {
        amountCents: 100n,
        occurredAt: new Date("2026-09-01T00:00:00.000Z"),
        subject: { id: "subject-1", kind: "employee" }
      })
    ).toBe(
      stableExecutionIdentity("allocation", {
        subject: { kind: "employee", id: "subject-1" },
        occurredAt: new Date("2026-09-01T00:00:00.000Z"),
        amountCents: 100n
      })
    );
  });

  it("统一解析带类型前缀的经营收款主体", () => {
    expect(
      executionOperatingPayee({
        payeeSubjectType: "employee_user",
        payeeSubjectId: "employee_user:user-1"
      })
    ).toEqual({ kind: "employee", id: "user-1" });
    expect(
      executionOperatingPayee({
        payeeSubjectType: "supplier",
        payeeSubjectId: "supplier:supplier-1"
      })
    ).toEqual({ kind: "downstream_counterparty", id: "supplier-1" });
  });
});
