import {
  assertFundExecutionConfirmationSeparation,
  planReverseExecutionAxisEffects,
  type ExecutionAllocationAxisEffect
} from "./fund-execution.domain";

describe("资金执行四轴反向计划", () => {
  it("完整反向时只复制原四轴身份、canonical 后果和精确反向引用", () => {
    const original: readonly ExecutionAllocationAxisEffect[] = [
      {
        id: "axis-payable",
        axis: "payable",
        status: "applied",
        amountCents: 10_000n,
        consequences: [
          {
            id: "payable-consequence",
            sequence: 1,
            consequenceType: "payable_settlement_allocation",
            consequenceIdentity: "payable:wage-ref-202608",
            sliceIdentity: null,
            amountCents: 10_000n,
            consequenceFingerprint: "payable-fingerprint"
          }
        ]
      },
      {
        id: "axis-project-fund",
        axis: "project_fund",
        status: "applied",
        amountCents: 10_000n,
        consequences: [
          {
            id: "project-consequence-a",
            sequence: 1,
            consequenceType: "project_funding_allocation",
            consequenceIdentity: "project-fund:cash",
            sliceIdentity: "cash",
            amountCents: 6_000n,
            consequenceFingerprint: "project-fingerprint-a"
          },
          {
            id: "project-consequence-b",
            sequence: 2,
            consequenceType: "project_funding_allocation",
            consequenceIdentity: "project-fund:quota",
            sliceIdentity: "quota",
            amountCents: 4_000n,
            consequenceFingerprint: "project-fingerprint-b"
          }
        ]
      },
      {
        id: "axis-relationship",
        axis: "relationship",
        status: "not_applicable",
        amountCents: 0n,
        consequences: []
      },
      {
        id: "axis-operating",
        axis: "operating",
        status: "applied",
        amountCents: 10_000n,
        consequences: [
          {
            id: "operating-consequence",
            sequence: 1,
            consequenceType: "operating_impact_entry",
            consequenceIdentity: "operating:payment",
            sliceIdentity: null,
            amountCents: 10_000n,
            consequenceFingerprint: "operating-fingerprint"
          }
        ]
      }
    ];

    expect(planReverseExecutionAxisEffects(original, 10_000n)).toEqual([
      {
        originalAxisEffectId: "axis-payable",
        axis: "payable",
        status: "applied",
        amountCents: 10_000n,
        consequences: [
          {
            originalConsequenceId: "payable-consequence",
            sequence: 1,
            consequenceType: "payable_settlement_allocation",
            consequenceIdentity: "payable:wage-ref-202608",
            sliceIdentity: null,
            amountCents: 10_000n
          }
        ]
      },
      {
        originalAxisEffectId: "axis-project-fund",
        axis: "project_fund",
        status: "applied",
        amountCents: 10_000n,
        consequences: [
          {
            originalConsequenceId: "project-consequence-a",
            sequence: 1,
            consequenceType: "project_funding_allocation",
            consequenceIdentity: "project-fund:cash",
            sliceIdentity: "cash",
            amountCents: 6_000n
          },
          {
            originalConsequenceId: "project-consequence-b",
            sequence: 2,
            consequenceType: "project_funding_allocation",
            consequenceIdentity: "project-fund:quota",
            sliceIdentity: "quota",
            amountCents: 4_000n
          }
        ]
      },
      {
        originalAxisEffectId: "axis-relationship",
        axis: "relationship",
        status: "not_applicable",
        amountCents: 0n,
        consequences: []
      },
      {
        originalAxisEffectId: "axis-operating",
        axis: "operating",
        status: "applied",
        amountCents: 10_000n,
        consequences: [
          {
            originalConsequenceId: "operating-consequence",
            sequence: 1,
            consequenceType: "operating_impact_entry",
            consequenceIdentity: "operating:payment",
            sliceIdentity: null,
            amountCents: 10_000n
          }
        ]
      }
    ]);
  });
});

describe("资金执行确认职责分离", () => {
  const base = {
    confirmerUserId: "user-confirmer",
    handledByUserId: "user-handler",
    paymentExecutedByUserId: "user-payment-executor",
    finalApprovalActorUserId: "user-final-approver",
    finalApprovalRepresentedUserId: null,
    delegations: []
  } as const;

  it("确认人与经办人、付款执行人、最终审批自然人分离", () => {
    expect(() => assertFundExecutionConfirmationSeparation(base)).not.toThrow();

    expect(() =>
      assertFundExecutionConfirmationSeparation({
        ...base,
        confirmerUserId: base.handledByUserId
      })
    ).toThrow("资金执行确认人必须与经办、付款执行和最终审批自然人分离");

    expect(() =>
      assertFundExecutionConfirmationSeparation({
        ...base,
        confirmerUserId: base.paymentExecutedByUserId
      })
    ).toThrow("资金执行确认人必须与经办、付款执行和最终审批自然人分离");

    expect(() =>
      assertFundExecutionConfirmationSeparation({
        ...base,
        confirmerUserId: base.finalApprovalActorUserId
      })
    ).toThrow("资金执行确认人必须与经办、付款执行和最终审批自然人分离");
  });

  it("委托双方按自然人身份闭包参与职责分离", () => {
    expect(() =>
      assertFundExecutionConfirmationSeparation({
        ...base,
        delegations: [
          {
            fromUserId: base.finalApprovalActorUserId,
            toUserId: base.confirmerUserId
          }
        ]
      })
    ).toThrow("资金执行确认人必须与经办、付款执行和最终审批自然人分离");

    expect(() =>
      assertFundExecutionConfirmationSeparation({
        ...base,
        finalApprovalRepresentedUserId: "user-represented-approver",
        confirmerUserId: "user-delegate-peer",
        delegations: [
          {
            fromUserId: "user-represented-approver",
            toUserId: "user-delegate-peer"
          }
        ]
      })
    ).toThrow("资金执行确认人必须与经办、付款执行和最终审批自然人分离");
  });
});
