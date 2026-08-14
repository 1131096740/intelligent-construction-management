import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { AppendOperatingFactInput } from "./operating-ledger.service";
import {
  OperatingSourceAdapterRegistry,
  type OperatingSourceAdapter,
  type OperatingSourceSnapshot
} from "./operating-source-adapter";
import { OperatingSourceReplayService } from "./operating-source-replay.service";

describe("OperatingSourceReplayService", () => {
  it("closes the adapter set and rejects duplicate or missing source types", () => {
    const adapter = createAdapter();

    expect(
      () => new OperatingSourceAdapterRegistry([adapter, adapter])
    ).toThrow("经营来源适配器重复");
    expect(() => new OperatingSourceAdapterRegistry([]).require("expense_claim"))
      .toThrow("缺少经营来源适配器");
    expect(() =>
      new OperatingSourceAdapterRegistry([], ["expense_claim"]).assertComplete()
    ).toThrow("缺少经营来源适配器");
    expect(() => new OperatingSourceAdapterRegistry([]).assertComplete()).toThrow(
      "经营来源类型目录尚未配置"
    );
  });

  it("replays a frozen formal source through the ledger transaction idempotently", async () => {
    const snapshot = sourceSnapshot();
    const adapter = createAdapter(snapshot);
    const harness = createHarness({ adapter });
    harness.ledger.replayFromSourceInTransaction
      .mockResolvedValueOnce(writeResult(true))
      .mockResolvedValueOnce(writeResult(false));

    const first = await harness.service.replaySource(
      sourceLocator(),
      "finance-user"
    );
    const repeated = await harness.service.replaySource(
      sourceLocator(),
      "finance-user"
    );

    expect(first).toEqual(writeResult(true));
    expect(repeated).toEqual(writeResult(false));
    expect(harness.ledger.assertProjectFinanceAccessInTransaction).toHaveBeenCalledTimes(2);
    expect(harness.ledger.replayFromSourceInTransaction).toHaveBeenCalledTimes(2);
    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("checks project finance permission before reading any source state", async () => {
    const adapter = createAdapter();
    const harness = createHarness({ adapter });
    harness.ledger.assertProjectFinanceAccessInTransaction.mockRejectedValue(
      new ForbiddenException("只有当前项目财务人员可以登记经营事实")
    );

    await expect(
      harness.service.replaySource(sourceLocator(), "project-manager")
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(adapter.readSourceSnapshot).not.toHaveBeenCalled();
    expect(harness.ledger.replayFromSourceInTransaction).not.toHaveBeenCalled();
  });

  it("fails before opening a transaction when the requested adapter is missing", async () => {
    const harness = createHarness();

    await expect(
      harness.service.replaySource(sourceLocator(), "finance-user")
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a non-formal snapshot or an adapter that changes source coordinates", async () => {
    const draft = {
      ...sourceSnapshot(),
      status: "draft"
    } as unknown as OperatingSourceSnapshot;
    const draftHarness = createHarness({ adapter: createAdapter(draft) });
    await expect(
      draftHarness.service.replaySource(sourceLocator(), "finance-user")
    ).rejects.toThrow("只有正式来源快照可以重放");

    const changedCoordinateAdapter = createAdapter(sourceSnapshot(), {
      ...factInput(),
      sourceBusinessId: "other-source"
    });
    const changedHarness = createHarness({ adapter: changedCoordinateAdapter });
    await expect(
      changedHarness.service.replaySource(sourceLocator(), "finance-user")
    ).rejects.toThrow("来源坐标不一致");
  });

  it("compares a project in a database read-only transaction without appending facts", async () => {
    const harness = createHarness({ adapter: createAdapter() });

    const report = await harness.service.compareProject(
      "project-1",
      "finance-user"
    );

    expect(harness.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(harness.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
    expect(harness.ledger.readFactsInTransaction).toHaveBeenCalledWith(
      harness.tx,
      "project-1",
      "finance-user"
    );
    expect(harness.ledger.replayFromSourceInTransaction).not.toHaveBeenCalled();
    expect(report.summary).toEqual({
      expectedFacts: 1,
      actualFacts: 0,
      expectedImpacts: 1,
      actualImpacts: 0,
      differenceCount: 1
    });
    expect(report.differences[0]).toEqual(
      expect.objectContaining({
        sourceType: "pol04_test_source",
        sourceBusinessId: "source-1",
        sourceBusinessCode: "来源业务一号",
        message: expect.stringContaining("缺少经营事实")
      })
    );
  });

  it("fails closed when stored facts contain a source type outside the registry", async () => {
    const harness = createHarness({
      requiredSourceTypes: ["pol04_test_source"],
      actualFacts: [
        {
          sourceType: "unregistered_source",
          sourceBusinessId: "unknown-1",
          sourceBusinessCode: "未知来源一号",
          impacts: []
        }
      ]
    });

    await expect(
      harness.service.compareProject("project-1", "finance-user")
    ).rejects.toThrow("缺少经营来源适配器");
  });

  it("fails closed before comparing when the required source catalog is absent", async () => {
    const harness = createHarness();

    await expect(
      harness.service.compareProject("project-1", "finance-user")
    ).rejects.toThrow("经营来源类型目录尚未配置");
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
  });
});

function createHarness(options: {
  adapter?: OperatingSourceAdapter;
  actualFacts?: unknown[];
  requiredSourceTypes?: string[];
} = {}) {
  const tx = { $executeRaw: jest.fn() };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx)
    )
  };
  const ledger = {
    assertProjectFinanceAccessInTransaction: jest.fn(),
    replayFromSourceInTransaction: jest.fn(),
    readFactsInTransaction: jest.fn().mockResolvedValue(options.actualFacts ?? []),
    materializeSourceForComparisonInTransaction: jest.fn().mockResolvedValue({
      input: factInput(),
      operatingLedgerEffectiveDateSnapshot: new Date("2026-08-01T00:00:00.000Z"),
      subjectSnapshot: {},
      impactSnapshots: new Map([["cost", {}]])
    })
  };
  const registry = new OperatingSourceAdapterRegistry(
    options.adapter ? [options.adapter] : [],
    options.requiredSourceTypes ??
      (options.adapter ? [options.adapter.sourceType] : undefined)
  );
  const service = new OperatingSourceReplayService(
    prisma as never,
    ledger as never,
    registry
  );
  return { service, prisma, ledger, tx };
}

function createAdapter(
  snapshot = sourceSnapshot(),
  mappedInput = factInput()
): OperatingSourceAdapter {
  return {
    sourceType: "pol04_test_source",
    readProjectSnapshots: jest.fn().mockResolvedValue([snapshot]),
    readSourceSnapshot: jest.fn().mockResolvedValue(snapshot),
    toOperatingFactInput: jest.fn().mockReturnValue(mappedInput)
  };
}

function sourceSnapshot(): OperatingSourceSnapshot {
  return {
    projectId: "project-1",
    sourceType: "pol04_test_source",
    sourceBusinessId: "source-1",
    sourceBusinessCode: "来源业务一号",
    sourceVersion: 1,
    status: "confirmed",
    sourceSnapshot: { businessCode: "来源业务一号", amountCents: "1000" }
  };
}

function sourceLocator() {
  return {
    projectId: "project-1",
    sourceType: "pol04_test_source",
    sourceBusinessId: "source-1"
  };
}

function factInput(): AppendOperatingFactInput {
  return {
    projectId: "project-1",
    sourceType: "pol04_test_source",
    sourceBusinessId: "source-1",
    sourceBusinessCode: "来源业务一号",
    sourceVersion: 1,
    idempotencyKey: "source-1",
    occurredAt: new Date("2026-08-14T00:00:00.000Z"),
    confirmedAt: new Date("2026-08-14T01:00:00.000Z"),
    confirmedByUserId: "finance-user",
    factKind: "expense",
    operatingLevel: "project",
    evidenceLevel: "A",
    amountCents: 1000n,
    currencyCode: "CNY",
    direction: "outflow",
    isBeforeOperatingLedgerEffectiveDate: false,
    affiliateAssignmentId: "assignment-1",
    affiliateBusinessPartyVersionId: "affiliate-version-1",
    affiliateNameSnapshot: "施工企业",
    sourceSnapshot: { businessCode: "来源业务一号", amountCents: "1000" },
    subjects: {
      costBearingCompany: { kind: "participating_company", id: "company-version-1" }
    },
    impacts: [
      {
        idempotencyKey: "source-1-cost",
        sourceImpactKey: "cost",
        impactKind: "confirmed_cost",
        amountCents: 1000n,
        direction: "increase",
        costCategoryCode: "project_daily_expense"
      }
    ]
  };
}

function writeResult(created: boolean) {
  return {
    id: "fact-1",
    projectId: "project-1",
    sourceType: "pol04_test_source",
    sourceBusinessId: "source-1",
    created,
    impactIds: ["impact-1"]
  };
}
