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
});
