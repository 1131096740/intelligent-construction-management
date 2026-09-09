import { freezeClearingReconciliationIntent } from "./clearing-reconciliation-intent";

describe("freezeClearingReconciliationIntent", () => {
  it("does not release reversed coverage into a corrected replacement", async () => {
    const targetRevisionId = "revision-original";
    const tx = {
      clearingReconciliationRevision: {
        findUnique: jest.fn().mockResolvedValue({
          id: targetRevisionId,
          clearingCaseId: "case-1",
          itemId: "item-1",
          revisionNo: 1,
          amountCents: 100n,
          item: { lineageRootItemId: "item-1" }
        }),
        findFirst: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ revisionNo: 1 })
      },
      clearingReconciliationDefinitionReversal: {
        findUnique: jest.fn().mockResolvedValue({ id: "definition-reversal-1" })
      },
      clearingEventVersion: {
        findMany: jest.fn().mockResolvedValue([{
          id: "withheld-version-1",
          clearingCaseId: "case-1",
          amountCents: 100n,
          fingerprint: "a".repeat(64),
          confirmation: { id: "confirmation-1" },
          clearingEvent: { kind: "withheld", workflowStatus: "confirmed" }
        }])
      },
      $queryRaw: jest.fn().mockImplementation((query: { values?: unknown[] }) => {
        if (query.values?.includes(targetRevisionId) && query.values.length === 1) {
          return Promise.resolve([{ openAmountCents: 100n }]);
        }
        return Promise.resolve([{
          remaining: query.values?.includes(targetRevisionId) ? 100n : 0n
        }]);
      })
    };

    await expect(freezeClearingReconciliationIntent({
      tx: tx as never,
      clearingCase: {
        id: "case-1",
        revision: 7,
        authorityVersionId: "authority-1",
        authoritySnapshotRef: "authority-fingerprint"
      } as never,
      eventKind: "pending_reconciliation",
      eventAmountCents: 100n,
      actorUserId: "finance-1",
      selectionRefs: { matches: jest.fn().mockReturnValue(true) } as never,
      draft: {
        operation: "replace_item",
        itemDefinition: {
          mode: "replacement",
          replacesRevisionId: targetRevisionId,
          correctsDefinitionReversalId: "definition-reversal-1",
          amountCents: "100"
        },
        coverages: [{
          sourceSelectionRef: "selection-1",
          amountCents: "100"
        }]
      }
    })).rejects.toThrow("暂扣覆盖来源容量已漂移");
  });

  it("tracks planned prior-economic return capacity by exact allocation", async () => {
    const sourceVersion = {
      id: "source-version-1",
      fingerprint: "b".repeat(64),
      confirmation: { id: "source-confirmation-1" },
      clearingEvent: { kind: "final_confirmed", workflowStatus: "confirmed" },
      impactLinks: [
        {
          id: "impact-confirmed-cost",
          sourceImpactKey: "original:confirmed-cost",
          operatingFactId: "fact-1"
        },
        {
          id: "impact-funds-decrease",
          sourceImpactKey: "original:construction-enterprise-funds-decrease",
          operatingFactId: "fact-1"
        }
      ]
    };
    const tx = {
      clearingReconciliationCoverage: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationRevision: {
        findUnique: jest.fn().mockResolvedValue({
          id: "revision-1",
          clearingCaseId: "case-1",
          itemId: "item-1",
          revisionNo: 1,
          amountCents: 40n
        }),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      clearingReconciliationDefinitionReversal: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      clearingAllocation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "allocation-40", eventVersionId: sourceVersion.id, eventVersion: sourceVersion },
          { id: "allocation-60", eventVersionId: sourceVersion.id, eventVersion: sourceVersion }
        ])
      },
      clearingEventVersion: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockImplementation((query: { values?: unknown[] }) =>
        Promise.resolve([{
          remaining: query.values?.includes("allocation-40") ? 40n : 60n
        }])
      )
    };

    const frozen = await freezeClearingReconciliationIntent({
      tx: tx as never,
      clearingCase: {
        id: "case-1",
        revision: 3,
        authorityVersionId: "authority-1",
        authoritySnapshotRef: "authority-fingerprint"
      } as never,
      eventKind: "returned",
      eventAmountCents: 100n,
      actorUserId: "finance-1",
      selectionRefs: {
        matches: jest.fn((selectionRef: string, target: { selectedKey: string }) =>
          selectionRef === target.selectedKey
        )
      } as never,
      draft: {
        operation: "resolve",
        resolutions: [{
          reconciliationRevisionId: "revision-1",
          amountCents: "40",
          lines: [{
            sourceKind: "prior_economic_event",
            sourceSelectionRef: "allocation-40",
            amountCents: "40"
          }]
        }],
        ordinaryAllocations: [{
          sourceKind: "final_confirmed",
          sourceSelectionRef: "allocation-60",
          amountCents: "60"
        }]
      }
    });

    expect(frozen.eventAllocations).toEqual([
      expect.objectContaining({
        amountCents: "40",
        frozenSource: expect.objectContaining({
          sourceClearingAllocationId: "allocation-40",
          sourceImpactIds: ["impact-confirmed-cost", "impact-funds-decrease"]
        })
      }),
      expect.objectContaining({
        amountCents: "60",
        frozenSource: expect.objectContaining({
          sourceClearingAllocationId: "allocation-60",
          sourceImpactIds: ["impact-confirmed-cost", "impact-funds-decrease"]
        })
      })
    ]);
  });

  it("rejects cumulative planned returns that overdraw one exact allocation", async () => {
    const tx = {
      clearingReconciliationCoverage: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationRevision: {
        findUnique: jest.fn().mockResolvedValue({
          id: "revision-1",
          clearingCaseId: "case-1",
          itemId: "item-1",
          revisionNo: 1,
          amountCents: 120n
        }),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      clearingReconciliationDefinitionReversal: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      clearingAllocation: {
        findMany: jest.fn().mockResolvedValue([{
          id: "allocation-100",
          eventVersionId: "source-version-1",
          eventVersion: {
            id: "source-version-1",
            fingerprint: "c".repeat(64),
            confirmation: { id: "source-confirmation-1" },
            clearingEvent: { kind: "final_confirmed", workflowStatus: "confirmed" },
            impactLinks: [
              {
                id: "impact-confirmed-cost",
                sourceImpactKey: "original:confirmed-cost",
                operatingFactId: "fact-1"
              },
              {
                id: "impact-funds-decrease",
                sourceImpactKey: "original:construction-enterprise-funds-decrease",
                operatingFactId: "fact-1"
              }
            ]
          }
        }])
      },
      clearingEventVersion: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ remaining: 100n }])
    };

    await expect(freezeClearingReconciliationIntent({
      tx: tx as never,
      clearingCase: {
        id: "case-1",
        revision: 3,
        authorityVersionId: "authority-1",
        authoritySnapshotRef: "authority-fingerprint"
      } as never,
      eventKind: "returned",
      eventAmountCents: 120n,
      actorUserId: "finance-1",
      selectionRefs: { matches: jest.fn().mockReturnValue(true) } as never,
      draft: {
        operation: "resolve",
        resolutions: [{
          reconciliationRevisionId: "revision-1",
          amountCents: "120",
          lines: [
            {
              sourceKind: "prior_economic_event",
              sourceSelectionRef: "allocation-100",
              amountCents: "60"
            },
            {
              sourceKind: "prior_economic_event",
              sourceSelectionRef: "allocation-100",
              amountCents: "60"
            }
          ]
        }],
        ordinaryAllocations: []
      }
    })).rejects.toThrow("既有经济事件可退回金额已漂移");
  });

  it("rejects a V1 exact return when the source event already has a legacy return", async () => {
    const tx = {
      clearingReconciliationCoverage: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationRevision: {
        findUnique: jest.fn().mockResolvedValue({
          id: "revision-1",
          clearingCaseId: "case-1",
          itemId: "item-1",
          revisionNo: 1,
          amountCents: 60n
        }),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      clearingReconciliationDefinitionReversal: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      clearingAllocation: {
        findMany: jest.fn().mockResolvedValue([{
          id: "allocation-100",
          eventVersionId: "source-version-1",
          eventVersion: {
            fingerprint: "d".repeat(64),
            confirmation: { id: "source-confirmation-1" },
            clearingEvent: { kind: "final_confirmed", workflowStatus: "confirmed" },
            impactLinks: [
              {
                id: "impact-confirmed-cost",
                sourceImpactKey: "original:confirmed-cost",
                operatingFactId: "fact-1"
              },
              {
                id: "impact-funds-decrease",
                sourceImpactKey: "original:construction-enterprise-funds-decrease",
                operatingFactId: "fact-1"
              }
            ]
          }
        }])
      },
      clearingEventVersion: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ hasLegacyReturn: true }])
    };

    await expect(freezeClearingReconciliationIntent({
      tx: tx as never,
      clearingCase: {
        id: "case-1",
        revision: 3,
        authorityVersionId: "authority-1",
        authoritySnapshotRef: "authority-fingerprint"
      } as never,
      eventKind: "returned",
      eventAmountCents: 60n,
      actorUserId: "finance-1",
      selectionRefs: { matches: jest.fn().mockReturnValue(true) } as never,
      draft: {
        operation: "resolve",
        resolutions: [{
          reconciliationRevisionId: "revision-1",
          amountCents: "60",
          lines: [{
            sourceKind: "prior_economic_event",
            sourceSelectionRef: "allocation-100",
            amountCents: "60"
          }]
        }],
        ordinaryAllocations: []
      }
    })).rejects.toThrow("无法精确映射 allocation 的旧退回");
  });
});
