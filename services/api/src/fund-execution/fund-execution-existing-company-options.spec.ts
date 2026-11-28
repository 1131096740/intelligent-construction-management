import { FundExecutionSelectionOptionsService } from "./fund-execution-selection-options.service";
import { FundExecutionSelectionRefService } from "./fund-execution-selection-ref.service";

function existingDebtFixture() {
  const tx = {
    fundExecutionCase: { findFirst: jest.fn().mockResolvedValue({
      id: "case", caseKey: "case-key", status: "draft", revision: 1, fundExecutionId: "execution"
    }) },
    fundExecution: { findUnique: jest.fn().mockResolvedValue({
      id: "execution", executionKind: "bank_transaction", direction: "outflow"
    }) },
    bankTransactionClaim: { findUnique: jest.fn().mockResolvedValue({ observationId: "observation" }) },
    verifiedBankTransactionObservation: { findUnique: jest.fn().mockResolvedValue({ id: "observation" }) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: "finance" }])
  };
  const db = { ...tx, $transaction: async (run: (client: typeof tx) => unknown) => run(tx) };
  const refs = new FundExecutionSelectionRefService();
  const issue = jest.spyOn(refs, "issueAxisBusinessOption");
  const service = new FundExecutionSelectionOptionsService(db as never, refs);
  return { service, tx, issue };
}

it("已确认的历史工资债务不再发出新分类候选，先前候选也不能换成新分类", async () => {
  const f = existingDebtFixture();
  const now = new Date("2026-11-05T10:00:00Z");
  await expect(f.service.listCasePlans("case-key", "finance", now)).resolves.toEqual([]);
  await expect(f.service.resolveCasePlanInTransaction(f.tx as never, {
    caseKey: "case-key", actorUserId: "finance", expectedRevision: 1,
    selectionRefs: ["prior-payable", "prior-funding", "prior-relationship", "prior-operating"], now
  })).rejects.toMatchObject({ status: 410 });
  expect(f.issue).not.toHaveBeenCalled();
});

it("旧出款案件的存在和版本校验仍先于分类退役", async () => {
  const f = existingDebtFixture();
  await expect(f.service.resolveCasePlanInTransaction(f.tx as never, {
    caseKey: "case-key", actorUserId: "finance", expectedRevision: 2, selectionRefs: ["prior-reference"]
  })).rejects.toMatchObject({ status: 409 });
  f.tx.fundExecutionCase.findFirst.mockResolvedValue(null);
  await expect(f.service.listCasePlans("unknown", "finance")).rejects.toMatchObject({ status: 404 });
  expect(f.issue).not.toHaveBeenCalled();
});
