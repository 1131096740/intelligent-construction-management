import {
  FundExecutionSelectionRefService,
  fundExecutionSelectionRefFingerprint,
  type AxisBusinessSelectionBinding,
  type BankObservationSelectionBinding,
  fundExecutionSelectionExpiresAt
} from "./fund-execution-selection-ref.service";

describe("资金执行服务端业务 selectionRef", () => {
  const service = new FundExecutionSelectionRefService({
    bankObservationSecret: "bank-observation-secret-for-test-123456",
    axisBusinessSecret: "axis-business-secret-for-test-12345678"
  });
  const now = new Date("2026-08-31T04:00:00.000Z");

  it("为已消费候选冻结可跨过短效过期时间的不可逆引用指纹", () => {
    const selectionRef = "fobs1.example.signed-value";

    expect(fundExecutionSelectionRefFingerprint(selectionRef)).toMatch(
      /^[0-9a-f]{64}$/
    );
    expect(fundExecutionSelectionRefFingerprint(` ${selectionRef} `)).toBe(
      fundExecutionSelectionRefFingerprint(selectionRef)
    );
    expect(fundExecutionSelectionRefFingerprint(`${selectionRef}-other`)).not.toBe(
      fundExecutionSelectionRefFingerprint(selectionRef)
    );
  });

  it("银行流水候选只签发不暴露技术 ID 的短效 selectionRef", () => {
    const binding: BankObservationSelectionBinding = {
      actorUserId: "user-finance-director",
      observationId: "observation-technical-id",
      observationFingerprint: "observation-fingerprint",
      payerVerificationId: "payer-verification-technical-id",
      payerVerificationFingerprint: "payer-verification-fingerprint",
      direction: "outflow",
      amountCents: 12_345n,
      currency: "CNY"
    };

    const selectionRef = service.issueBankObservation(binding, now);

    expect(selectionRef).toMatch(/^fobs1\.[^.]+\.[A-Za-z0-9_-]+$/);
    expect(selectionRef).not.toContain(binding.observationId);
    expect(selectionRef).not.toContain(binding.payerVerificationId);
    expect(service.matchesBankObservation(selectionRef, binding, now)).toBe(true);
    expect(
      service.matchesBankObservation(
        selectionRef,
        { ...binding, amountCents: binding.amountCents + 1n },
        now
      )
    ).toBe(false);
    expect(
      service.matchesBankObservation(
        selectionRef,
        binding,
        new Date("2026-08-31T04:05:00.001Z")
      )
    ).toBe(false);
  });

  it("逐轴分类只接受绑定案件、执行、轴和 canonical 选项的 selectionRef", () => {
    const binding: AxisBusinessSelectionBinding = {
      actorUserId: "user-case-creator",
      caseId: "case-technical-id",
      caseRevision: 3,
      executionId: "fund-execution-technical-id",
      allocationLineId: "allocation-line-technical-id",
      axis: "payable",
      optionFingerprint: "canonical-payable-option-fingerprint",
      amountCents: 12_345n
    };

    const selectionRef = service.issueAxisBusinessOption(binding, now);

    expect(selectionRef).toMatch(/^faxis1\.[^.]+\.[A-Za-z0-9_-]+$/);
    expect(selectionRef).not.toContain(binding.caseId);
    expect(selectionRef).not.toContain(binding.optionFingerprint);
    expect(service.matchesAxisBusinessOption(selectionRef, binding, now)).toBe(true);
    expect(
      service.matchesAxisBusinessOption(
        selectionRef,
        { ...binding, axis: "operating" },
        now
      )
    ).toBe(false);
    expect(
      service.matchesAxisBusinessOption(
        selectionRef,
        { ...binding, caseRevision: binding.caseRevision + 1 },
        now
      )
    ).toBe(false);
  });

  it("反向目标使用不暴露执行 ID 的短效业务引用", () => {
    const binding = {
      actorUserId: "user-finance-staff",
      targetType: "payment_execution" as const,
      targetExecutionId: "payment-execution-technical-id",
      targetFingerprint: "target-fingerprint"
    };
    const selectionRef = service.issueReversalTarget(binding, now);

    expect(selectionRef).toMatch(/^frev1\.[^.]+\.[A-Za-z0-9_-]+$/);
    expect(selectionRef).not.toContain(binding.targetExecutionId);
    expect(service.matchesReversalTarget(selectionRef, binding, now)).toBe(true);
    expect(
      service.matchesReversalTarget(
        selectionRef,
        { ...binding, targetExecutionId: "other-execution" },
        now
      )
    ).toBe(false);
    expect(fundExecutionSelectionExpiresAt(now).toISOString()).toBe(
      "2026-08-31T04:05:00.000Z"
    );
  });

  it("生产环境拒绝缺失、过短或跨用途复用的签名密钥", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(
        () =>
          new FundExecutionSelectionRefService({
            bankObservationSecret: "short",
            axisBusinessSecret: "axis-business-secret-for-test-12345678"
          })
      ).toThrow("生产环境必须配置独立的银行流水候选 selectionRef签名密钥");
      const shared = "shared-selection-secret-for-test-123456789";
      expect(
        () =>
          new FundExecutionSelectionRefService({
            bankObservationSecret: shared,
            axisBusinessSecret: shared
          })
      ).toThrow("生产环境资金执行 selectionRef 签名密钥必须按用途分离");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
