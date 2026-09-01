import { AuditService } from "../audit/audit.service";
import { FundExecutionCanonicalAdapterService } from "./fund-execution-canonical-adapter.service";
import { FundExecutionSelectionOptionsService } from "./fund-execution-selection-options.service";
import { FundExecutionService } from "./fund-execution.service";

describe("FundExecutionService read model", () => {
  it("详情读取不受列表前 100 条展示上限影响", async () => {
    const occurredAt = new Date("2026-09-01T01:00:00.000Z");
    const createdAt = new Date("2026-09-01T02:00:00.000Z");
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ key: "finance_director" }])
      .mockResolvedValueOnce([{ key: "finance_director" }])
      .mockResolvedValueOnce([
        {
          internalCaseId: "internal-case-101",
          caseId: "case-101",
          status: "draft",
          auditAction: "create_case",
          revision: 1,
          reason: "第 101 条案件",
          executionKind: "bank_transaction",
          direction: "inflow",
          amountCents: 10_000n,
          currencyCode: "CNY",
          occurredAt,
          approvalStatus: null,
          approvalCurrentNodeIndex: null,
          approvalFrozenNodes: null,
          lastApprovalActorUserId: null,
          classificationLineCount: 0,
          returnReason: null,
          createdAt
        }
      ]);
    const tx = {
      $queryRaw: queryRaw,
      user: {
        findUnique: jest.fn().mockResolvedValue({ isActive: true })
      },
      approvalDelegation: {
        findMany: jest.fn().mockResolvedValue([])
      },
      fundExecutionCaseAxisSelection: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const prisma = {
      $transaction: jest.fn(
        (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)
      )
    };
    const service = new FundExecutionService(
      prisma as never,
      {} as AuditService,
      {} as FundExecutionSelectionOptionsService,
      {} as FundExecutionCanonicalAdapterService
    );
    const listSpy = jest.spyOn(service, "listCases").mockResolvedValue([]);

    await expect(service.getCase("finance-director", "case-101")).resolves.toMatchObject({
      caseId: "case-101",
      status: "draft",
      revision: 1,
      amountCents: "10000",
      actions: expect.arrayContaining([
        expect.objectContaining({ key: "update_case", enabled: true })
      ])
    });
    expect(listSpy).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(3);
  });
});
