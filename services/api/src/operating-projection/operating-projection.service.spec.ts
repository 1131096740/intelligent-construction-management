import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  PayloadTooLargeException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  OperatingProjectionReadLimiter,
  OperatingProjectionService,
  projectionFactSubjectReferences
} from "./operating-projection.service";

function emptyProjectionTx(
  readAt: Date,
  projects: Array<{ id: string; code: string; name: string }>
) {
  return {
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }]),
    project: { findMany: jest.fn().mockResolvedValue(projects) },
    projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    interEntityRelationshipEntry:{findMany:jest.fn().mockResolvedValue([])},registeredOperationalPayment:{findMany:jest.fn().mockResolvedValue([])},companyTransfer:{findMany:jest.fn().mockResolvedValue([])},companyTransferEvent:{findMany:jest.fn().mockResolvedValue([])},
    projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([]) },
    companyEntityVersion: { findMany: jest.fn().mockResolvedValue([]) },
    clearingCase: { findMany: jest.fn().mockResolvedValue([]) },
    operatingFact: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([])
    },
    operatingImpactEntry: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([])
    }
  };
}

function zeroRiskReader() {
  return {
    readClearingReconciliationRiskInTransaction: jest.fn()
      .mockImplementation(async (
        _tx: unknown,
        input: { projectId: string; asOf: Date }
      ) => ({
        projectId: input.projectId,
        asOf: input.asOf.toISOString(),
        relationshipCompleteness: "complete",
        openPendingGrossCents: 0n,
        openCoveredCents: 0n,
        openUncoveredCents: 0n,
        continuedWithheldRetainedCents: 0n,
        coveredWithheldSources: [],
        items: []
      }))
  };
}

function overviewVisibility(projectIds: string[]) {
  return {
    visibleProjectIdsInTransaction: jest.fn().mockResolvedValue(projectIds),
    visibleProjectIdsWithinBudgetInTransaction: jest.fn().mockResolvedValue(projectIds),
    visibleRequestedProjectIdsInTransaction: jest.fn().mockImplementation(
      async (_tx: unknown, _userId: string, requestedProjectIds: string[]) =>
        requestedProjectIds.filter((projectId) => projectIds.includes(projectId))
    ),
    effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
      new Map(projectIds.map((projectId) => [projectId, ["project_manager"]]))
    )
  };
}

describe("OperatingProjectionService", () => {
  const project = { id: "project-1", code: "XM-001", name: "一号项目" };

  it("applies a linked cash slice to only its company and retains original cost and post-refund history", async () => {
    const readAt = new Date("2026-11-26T02:00:00Z");
    const occurredAt = new Date("2026-11-20T00:00:00Z");
    const costFact = {
      id: "approval-fact", projectId: project.id, sourceType: "expense_claim_approval",
      sourceBusinessId: "claim-1", sourceBusinessCode: "BX-0001", sourceVersion: 1,
      occurredAt, confirmedAt: occurredAt, affiliateBusinessPartyVersionId: "enterprise-v1",
      affiliateNameSnapshot: "施工单位", factKind: "expense", operatingLevel: "project", evidenceLevel: "A",
      amountCents: 800n, numericProtocolVersion: 1, direction: "outflow", sourceSnapshot: {},
      subjectSnapshot: {}, entryKind: "original", costBearingCompanySubjectKind: null, costBearingCompanySubjectId: null
    };
    const originalImpact = {
      id: "cost-1", factId: costFact.id, impactKind: "confirmed_cost", amountCents: 800n,
      direction: "increase", numericProtocolVersion: 1, subjectKind: null, subjectId: null,
      costCategoryCode: "project_daily_expense", fact: costFact
    };
    const link = {
      id: "link-1", amountCents: 300n, costImpact: { id: originalImpact.id, fact: { ...costFact, adjustments: [] } },
      operationalPayment: { amountCents: 300n, expensePublicCashCosts: [{ id: "link-1" }],
        expenseExecution: { expenseClaimId: "claim-1", refunds: [] as Array<{ amountCents: bigint; receivedAt: Date }> } },
      confirmations: [{ companyEntityVersionId: "bearing-v1", companyNameSnapshot: "承担公司", attributedAmountCents: 300n }]
    };
    const tx = {
      ...emptyProjectionTx(readAt, [project]),
      expensePublicCashCostLink: { findMany: jest.fn().mockResolvedValue([link]) }
    };
    tx.companyEntityVersion.findMany.mockResolvedValue([{ id: "bearing-v1", name: "承担公司" }]);
    const visibility = overviewVisibility([project.id]);
    visibility.effectiveRoleKeysByProjectInTransaction.mockResolvedValue(new Map([[project.id, ["finance_staff"]]]));
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never, visibility as never, zeroRiskReader() as never,
      { record: jest.fn() } as never, { confirmPassword: jest.fn() } as never
    );
    const prepareScan = () => {
      tx.operatingFact.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([costFact]);
      tx.operatingImpactEntry.findMany.mockResolvedValueOnce([originalImpact]);
    };
    prepareScan();
    const projectView = await service.getProjectView("finance", { projectId: project.id });
    expect(projectView.operating.confirmedCostCents).toBe("800");
    expect(projectView.costAttribution).toEqual({
      byBearingCompany: [{ kind: "participating_company", id: "bearing-v1", name: "承担公司", costCents: "300" }],
      unattributedCostCents: "500", publicCashCostCents: "300"
    });
    prepareScan();
    const bearingView = await service.getProjectView("finance", { projectId: project.id, companyEntityId: "bearing-company" });
    expect(bearingView.operating.confirmedCostCents).toBe("300");
    expect(bearingView.costAttribution.unattributedCostCents).toBe("0");

    link.operationalPayment.expenseExecution.refunds.push({ amountCents: 300n, receivedAt: new Date("2026-11-25") });
    prepareScan();
    const afterRefund = await service.getProjectView("finance", { projectId: project.id });
    expect(afterRefund.operating.confirmedCostCents).toBe("800");
    expect(afterRefund.costAttribution).toEqual({ ...projectView.costAttribution, publicCashCostCents: "0", needsReview: true });
    expect(afterRefund.integrity.notices).toContain("原公共现金费用已有归属确认，后续退款或更正影响承担关系的范围待核对。");
  });

  it("returns each exact reimbursement line and only the linked whole-cent cost in a company view", async () => {
    const readAt = new Date("2026-11-26T02:00:00Z");
    const occurredAt = new Date("2026-11-20T00:00:00Z");
    const exact = (amountYuan: string) => ({ numericProtocolVersion: 2, amountCents: null, amountYuan: new Prisma.Decimal(amountYuan) });
    const costFact = {
      ...exact("8.0051"), id: "approval-fact", projectId: project.id, sourceType: "expense_claim_approval",
      sourceBusinessId: "claim-1", sourceBusinessCode: "BX-0001", sourceVersion: 1,
      occurredAt, confirmedAt: occurredAt, affiliateBusinessPartyVersionId: "enterprise-v1", affiliateNameSnapshot: "施工单位",
      factKind: "expense", operatingLevel: "project", evidenceLevel: "A", direction: "outflow", entryKind: "original",
      costBearingCompanySubjectKind: null, costBearingCompanySubjectId: null, subjectSnapshot: {},
      sourceSnapshot: {
        formalStatus: "confirmed", claimType: "reimbursement", costBearingCompanyEntityId: null,
        requestedAmountYuan: "8.0051", requestedAmountCents: "801", companyPayableAmountCents: "801", actualPurchaseBatchId: null,
        numericFacts: { protocolVersion: 2, amountState: "known", amountYuan: "8.0051" },
        reimbursementLines: [{ id: "line-1", sortOrder: "1", amountYuan: "8.0050" }, { id: "line-2", sortOrder: "2", amountYuan: "0.0001" }]
      }
    };
    const impacts = [["8.0050", "1"], ["0.0001", "2"]].map(([amount, number]) => ({
      ...exact(amount), id: `cost-${number}`, factId: costFact.id, fact: costFact,
      sourceType: costFact.sourceType, sourceBusinessId: costFact.sourceBusinessId, sourceImpactKey: `confirmed_cost:${number}`,
      impactKind: "confirmed_cost", direction: "increase", subjectRole: null, subjectKind: null, subjectId: null,
      costCategoryCode: "project_daily_expense", fundPurpose: null,
      impactSnapshot: { lineId: `line-${number}`, numericFacts: { protocolVersion: 2, amountState: "known", amountYuan: amount } }
    }));
    const payable = {
      ...exact("8.0100"), id: "payable", factId: costFact.id, fact: costFact,
      sourceType: costFact.sourceType, sourceBusinessId: costFact.sourceBusinessId, sourceImpactKey: "payable_increase",
      impactKind: "payable_increase", direction: "increase", subjectRole: "payee", subjectKind: "employee", subjectId: "payee-1",
      costCategoryCode: null, fundPurpose: null, impactSnapshot: { numericFacts: { protocolVersion: 2, amountState: "known", amountYuan: "8.0100" } }
    };
    const link = {
      id: "link-1", amountCents: 300n, costImpact: { id: "cost-1", fact: { ...costFact, adjustments: [] } },
      operationalPayment: { amountCents: 801n, expensePublicCashCosts: [{ id: "link-1" }],
        expenseExecution: { expenseClaimId: "claim-1", refunds: [] } },
      confirmations: [{ companyEntityVersionId: "bearing-v1", companyNameSnapshot: "承担公司", attributedAmountCents: 300n }]
    };
    const tx = {
      ...emptyProjectionTx(readAt, [project]),
      expensePublicCashCostLink: { findMany: jest.fn().mockResolvedValue([link]) }
    };
    tx.companyEntityVersion.findMany.mockResolvedValue([{ id: "bearing-v1", name: "承担公司" }]);
    tx.operatingFact.findMany.mockImplementation(async (query) => query.where.sourceType ? [] : [costFact]);
    tx.operatingImpactEntry.findMany.mockResolvedValue([...impacts, payable]);
    const visibility = overviewVisibility([project.id]);
    visibility.effectiveRoleKeysByProjectInTransaction.mockResolvedValue(new Map([[project.id, ["finance_staff"]]]));
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never, visibility as never, zeroRiskReader() as never,
      { record: jest.fn() } as never, { confirmPassword: jest.fn() } as never
    );

    await expect(service.readProjectInTransaction(tx as never, "finance", { projectId: project.id }))
      .rejects.toThrow("报销成本含不足一分的金额");

    const request = { projectId: project.id, numericProtocolVersion: 2 as const };
    const overall = await service.getProjectDetailPage("finance", request);
    expect(overall.projection.operating).toMatchObject({ confirmedCostYuan: "8.0051", payableCents: "801" });
    expect(overall.items.map(item => item.signedImpactYuan)).toEqual(["8.0050", "0.0001", "8.0100"]);

    const companyRequest = { ...request, companyEntityId: "bearing-company" };
    const filtered = await service.getProjectDetailPage("finance", companyRequest);
    expect(filtered.projection.operating).toMatchObject({ confirmedCostYuan: "3.0000" });
    expect(filtered.items).toEqual([expect.objectContaining({ signedImpactYuan: "3.0000", signedImpactCents: null })]);

    const exported = await service.exportView("finance", { ...companyRequest, scopeKind: "project" },
      "current-password", "project_operating_ledger_detail");
    const csv = await readUtf8Stream(exported.stream);
    const rows = csv.split("\n").filter((row) => row.includes('"BX-0001"'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('"正式成本（四位元）"');
    expect(rows[0]).toContain('"3.0000"');

    link.amountCents = 801n;
    link.confirmations[0].attributedAmountCents = 801n;
    await expect(service.getProjectView("finance", request)).rejects.toThrow("公共现金归属金额超过原确认费用");
  });

  it("reads and exports the original signed settlement cost and the separate payable amount", async () => {
    const readAt = new Date("2026-11-26T02:00:00Z");
    const occurredAt = new Date("2026-11-20T00:00:00Z");
    const fact = {
      id: "settlement-fact", projectId: project.id, sourceType: "signed_contract_settlement",
      sourceBusinessId: "signed-1", sourceBusinessCode: "JS-0001", sourceVersion: 1,
      occurredAt, confirmedAt: occurredAt, affiliateBusinessPartyVersionId: "enterprise-v1", affiliateNameSnapshot: "施工单位",
      factKind: "downstream_settlement", operatingLevel: "project", evidenceLevel: "A", direction: "neutral", entryKind: "original",
      numericProtocolVersion: 2, amountCents: null, amountYuan: new Prisma.Decimal("0.0050"), subjectSnapshot: {},
      sourceSnapshot: {
        formalStatus: "confirmed", contractKind: "downstream", relationship: "inside", contractId: "contract-1",
        signedAmountYuan: "-0.0050", numericFacts: { protocolVersion: 2, amountState: "known", amountYuan: "0.0050" },
        operatingNumericFacts: { protocolVersion: 2, cumulativeBeforeYuan: "1.0050", cumulativeAfterYuan: "1.0000", payableDeltaCents: "-1" }
      }
    };
    const impacts = [["confirmed_cost", "0.0050"], ["payable_decrease", "0.0100"]].map(([impactKind, amount]) => ({
      id: impactKind, factId: fact.id, fact, sourceType: fact.sourceType, sourceBusinessId: fact.sourceBusinessId,
      sourceImpactKey: impactKind, impactKind, direction: "decrease", subjectRole: null, subjectKind: null,
      subjectId: null, costCategoryCode: impactKind === "confirmed_cost" ? "material" : null, fundPurpose: null,
      numericProtocolVersion: 2, amountCents: null, amountYuan: new Prisma.Decimal(amount), impactSnapshot: {}
    }));
    const tx = emptyProjectionTx(readAt, [project]);
    tx.operatingFact.findMany.mockResolvedValue([fact]);
    tx.operatingImpactEntry.findMany.mockResolvedValue(impacts);
    const visibility = overviewVisibility([project.id]);
    visibility.effectiveRoleKeysByProjectInTransaction.mockResolvedValue(new Map([[project.id, ["finance_staff"]]]));
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never, visibility as never, zeroRiskReader() as never,
      { record: jest.fn() } as never, { confirmPassword: jest.fn() } as never
    );
    await expect(service.readProjectInTransaction(tx as never, "finance", { projectId: project.id }))
      .rejects.toThrow("已签结算含不足一分的金额");
    const request = { projectId: project.id, numericProtocolVersion: 2 as const };
    const read = await service.getProjectDetailPage("finance", request);
    expect(read.projection.operating).toMatchObject({ confirmedCostYuan: "-0.0050", payableCents: "-1" });
    expect(read.projection.profitAndLoss).toMatchObject({ currentOperatingProfitYuan: "0.0050" });
    expect(read.items).toEqual([
      expect.objectContaining({ amountYuan: "0.0050", signedImpactYuan: "-0.0050", signedImpactCents: null }),
      expect.objectContaining({ amountYuan: "0.0100", signedImpactYuan: "-0.0100", signedImpactCents: null })
    ]);
    const exported = await service.exportView("finance", { ...request, scopeKind: "project" },
      "current-password", "project_operating_ledger_detail");
    const rows = (await readUtf8Stream(exported.stream)).split("\n").filter(row => row.includes('"JS-0001"'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('"正式成本（四位元）"');
    expect(rows[0]).toContain('"-0.0050"');
    expect(rows[1]).toContain('"-0.0100"');
  });

  it.each([
    [20_000n, 100_000n, 67_108_864n, false],
    [20_001n, 1n, 1n, true],
    [1n, 100_001n, 1n, true],
    [1n, 1n, 67_108_865n, true]
  ])("enforces request work boundaries through the public service for both accounts %s/%s/%s",
    async (workFactCount, workImpactCount, workBytes, rejected) => {
      for (const actor of ["finance-one", "finance-two"]) {
        const readAt = new Date("2026-09-11T01:02:03Z");
        const tx = emptyProjectionTx(readAt, [project]);
        tx.$queryRaw.mockResolvedValue([{ readAt, workFactCount, workImpactCount, workBytes, targetCount: 0n }]);
        const service = new OperatingProjectionService(
          { $transaction: jest.fn((work) => work(tx)) } as never,
          overviewVisibility([project.id]) as never, zeroRiskReader() as never,
          { record: jest.fn() } as never, { confirmPassword: jest.fn() } as never
        );
        const result = service.getProjectView(actor, { projectId: project.id });
        if (rejected) {
          await expect(result).rejects.toBeInstanceOf(PayloadTooLargeException);
          expect(tx.operatingFact.findMany).not.toHaveBeenCalled();
          expect(tx.operatingImpactEntry.findMany).not.toHaveBeenCalled();
          expect(tx.$queryRaw.mock.calls.some(([query]) =>
            (query as { strings: readonly string[] }).strings.join(" ").includes('AS "maxSnapshotBytes"')
          )).toBe(false);
        } else await expect(result).resolves.toBeDefined();
      }
    });

  it.each([
    ["finance_staff", true],
    ["finance_director", true],
    ["project_manager", false]
  ])("returns a server-derived detail export capability for %s", async (
    roleKey,
    expected
  ) => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    const visibility = overviewVisibility([project.id]);
    visibility.effectiveRoleKeysByProjectInTransaction.mockResolvedValue(
      new Map([[project.id, [roleKey]]])
    );
    const additional = jest.fn().mockResolvedValue({ marker: "same-snapshot" });
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      visibility as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.readProjectCompatibilitySnapshot(
      "user-1",
      { projectId: project.id },
      additional
    )).resolves.toEqual(expect.objectContaining({
      additional: { marker: "same-snapshot" },
      canExportDetail: expected
    }));
    expect(additional).toHaveBeenCalledWith(tx, [project.id], expect.objectContaining({ numericProtocolVersion: 2 }));
  });

  it("limits per-actor concurrent and minute-rate projection reads", () => {
    const limiter = new OperatingProjectionReadLimiter(2, 3);
    const releaseFirst = limiter.acquire("user-1", 60_000);
    const releaseSecond = limiter.acquire("user-1", 60_000);

    expect(() => limiter.acquire("user-1", 60_000)).toThrow(HttpException);
    releaseFirst();
    const releaseThird = limiter.acquire("user-1", 60_000);
    releaseSecond();
    releaseThird();
    expect(() => limiter.acquire("user-1", 60_000)).toThrow(HttpException);

    expect(() => limiter.acquire("user-1", 120_001)).not.toThrow();
  });

  it.each([
    ["malformed", "not-an-encrypted-cursor"],
    ["overlong", "x".repeat(2_049)]
  ])("acquires and releases one actor slot before rejecting a %s detail cursor", async (
    _label,
    cursor
  ) => {
    const prisma = { $transaction: jest.fn() };
    const release = jest.fn();
    const acquire = jest.fn().mockReturnValue(release);
    const service = new OperatingProjectionService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    (service as unknown as { readLimiter: { acquire: typeof acquire } }).readLimiter = { acquire };

    await expect(service.getProjectDetailPage("user-1", {
      projectId: "project-1",
      cursor
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("charges exactly one actor slot for both first and continuation detail entry paths", async () => {
    const service = new OperatingProjectionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const release = jest.fn();
    const acquire = jest.fn().mockReturnValue(release);
    const readDetail = jest.spyOn(
      service as unknown as {
        readDetailPageWithAcquiredSlot: (
          actorUserId: string,
          input: Record<string, unknown>
        ) => Promise<unknown>;
      },
      "readDetailPageWithAcquiredSlot"
    ).mockResolvedValue({ items: [] });
    (service as unknown as { readLimiter: { acquire: typeof acquire } }).readLimiter = { acquire };

    await service.getProjectDetailPage("user-1", { projectId: "project-1" });
    await service.getProjectDetailPage("user-1", {
      projectId: "project-1",
      cursor: "continuation-cursor"
    });

    expect(readDetail).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("uses a narrow detail select and omits fact snapshots when no subject filter needs them", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      {
        visibleRequestedProjectIdsInTransaction: jest.fn().mockResolvedValue([project.id]),
        effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
          new Map([[project.id, ["finance_staff"]]])
        )
      } as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await service.getProjectDetailPage("user-1", { projectId: project.id });

    const detailQuery = tx.operatingImpactEntry.findMany.mock.calls
      .map(([query]) => query)
      .find((query) => query.select?.fact?.select);
    expect(detailQuery?.select.fact.select).toEqual(expect.objectContaining({
      sourceBusinessCode: true,
      occurredAt: true,
      evidenceLevel: true
    }));
    expect(detailQuery?.select.fact.select).not.toHaveProperty("sourceSnapshot");
    expect(detailQuery?.select.fact.select).not.toHaveProperty("subjectSnapshot");
    expect(detailQuery?.select).not.toHaveProperty("impactSnapshot");
    expect(detailQuery?.select).not.toHaveProperty("description");
  });

  it.each([
    {
      scenario: "明确两来源匹配",
      mixedHistory: true,
      repeatSigned: false,
      expectedCodes: ["SETTLEMENT-B", "SETTLEMENT-A"],
      amount: "200",
      suppressed: 1
    },
    {
      scenario: "同一来源重复编号及负向冲减",
      mixedHistory: false,
      repeatSigned: true,
      expectedCodes: ["SIGNED-CORRECTION", "SIGNED-REPEAT", "SIGNED-DUPLICATE", "SETTLEMENT-B"],
      amount: "250",
      suppressed: 0
    },
    {
      scenario: "多来源且存在多笔同编号结算",
      mixedHistory: true,
      repeatSigned: true,
      expectedCodes: ["SIGNED-CORRECTION", "SIGNED-REPEAT", "SIGNED-DUPLICATE", "SETTLEMENT-B", "SETTLEMENT-A"],
      amount: null,
      suppressed: 0
    }
  ])("明细分页和导出保留经营结算记录：$scenario", async ({
    mixedHistory, repeatSigned, expectedCodes, amount, suppressed
  }) => {
    const tx = emptyProjectionTx(new Date("2026-09-11T01:02:03Z"), [project]);
    const settlement = {
      id: "fact-a", projectId: project.id, sourceType: "settlement",
      sourceBusinessId: "settlement-a", sourceBusinessCode: "SETTLEMENT-A", sourceVersion: 1,
      occurredAt: new Date("2026-09-01"), confirmedAt: new Date("2026-09-01"),
      factKind: "downstream_settlement", operatingLevel: "project", evidenceLevel: "A",
      amountCents: 100n, numericProtocolVersion: 1, direction: "neutral", entryKind: "original",
      sourceSnapshot: { contractVersionId: "contract-v1", periodLabel: "第1期" }, subjectSnapshot: {}
    };
    const otherPeriod = {
      ...settlement,
      id: "fact-b", sourceBusinessId: "settlement-b", sourceBusinessCode: "SETTLEMENT-B",
      occurredAt: new Date("2026-09-03"), confirmedAt: new Date("2026-09-03"),
      sourceSnapshot: { contractVersionId: "contract-v1", periodLabel: "第2期" }
    };
    const duplicate = {
      ...settlement,
      id: "fact-c", sourceType: "signed_contract_settlement",
      sourceBusinessId: "signed-settlement-c", sourceBusinessCode: "SIGNED-DUPLICATE",
      occurredAt: new Date("2026-09-05"), confirmedAt: new Date("2026-09-05"),
      sourceSnapshot: { contractVersionId: "contract-v1", contractKind: "downstream", settlementNumber: "第１期" }
    };
    const repeated = {
      ...duplicate, id: "fact-d", sourceBusinessId: "signed-settlement-d",
      sourceBusinessCode: "SIGNED-REPEAT",
      occurredAt: new Date("2026-09-06"), confirmedAt: new Date("2026-09-06")
    };
    const correction = {
      ...duplicate, id: "fact-e", sourceBusinessId: "signed-settlement-e",
      sourceBusinessCode: "SIGNED-CORRECTION", amountCents: 50n,
      occurredAt: new Date("2026-09-07"), confirmedAt: new Date("2026-09-07")
    };
    const facts = [
      ...(mixedHistory ? [settlement] : []), otherPeriod, duplicate,
      ...(repeatSigned ? [repeated, correction] : [])
    ];
    const ambiguous = mixedHistory && repeatSigned;
    // Fill the first fact page so its apparent match precedes the two later signed facts.
    const olderPageRows = ambiguous ? Array.from({ length: 497 }, (_, index) => ({
      ...duplicate,
      id: `fact-c-filler-${String(index).padStart(3, "0")}`,
      sourceBusinessId: `signed-settlement-filler-${index}`,
      sourceSnapshot: { ...duplicate.sourceSnapshot, settlementNumber: `其他期次-${index}` }
    })) : [];
    const aggregateRows = [...facts, ...olderPageRows].sort((left, right) => left.id.localeCompare(right.id));
    const impacts = facts.map((fact) => ({
      id: `impact-${fact.id}`, factId: fact.id, fact, impactKind: "confirmed_cost",
      amountCents: fact.amountCents, numericProtocolVersion: 1, direction: fact.id === correction.id ? "decrease" : "increase",
      subjectKind: null, subjectId: null, costCategoryCode: "material", fundPurpose: null
    }));
    tx.operatingFact.findMany.mockImplementation(async (query) => {
      const eligible = query.where.sourceType
        ? aggregateRows.filter((row) => query.where.sourceType.in.includes(row.sourceType))
        : aggregateRows;
      const first = eligible.findIndex(({ id }) => id === query.cursor?.id) + 1;
      return eligible.slice(first, first + query.take);
    });
    tx.operatingImpactEntry.findMany.mockImplementation(async (query) => {
      if (!query.select?.fact) return impacts.filter(({ factId }) => query.where.factId.in.includes(factId));
      const detailOrder = [...impacts].reverse();
      const cursorImpactId = query.where.OR?.[1].id.gt;
      return detailOrder.slice(detailOrder.findIndex(({ id }) => id === cursorImpactId) + 1);
    });
    const visibility = overviewVisibility([project.id]);
    visibility.effectiveRoleKeysByProjectInTransaction.mockResolvedValue(new Map([[project.id, ["finance_staff"]]]));
    const audit = { record: jest.fn() };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never, visibility as never,
      zeroRiskReader() as never, audit as never, { confirmPassword: jest.fn() } as never
    );

    const request = { projectId: project.id, pageSize: 1 };
    const first = await service.getProjectDetailPage("finance", request);
    expect(first.projection.operating.confirmedCostCents).toBe(amount);
    expect(first.projection.integrity.moneyComplete).toBe(!ambiguous);
    if (ambiguous) {
      expect(first.projection.integrity.notices).toEqual(expect.arrayContaining([
        expect.stringContaining("无法确定对应关系")
      ]));
      expect(first.projection.distribution.currentDistributableProfitCents).toBeNull();
    }
    expect(first.projection.asOf.crossSourceDedupedFactCount).toBe(suppressed);
    const pagedCodes = first.items.map((item) => item.sourceBusinessCode);
    if (repeatSigned) {
      expect(first.items[0]).toMatchObject({ sourceBusinessCode: "SIGNED-CORRECTION", signedImpactCents: "-50" });
    }
    let cursor = first.page.nextCursor;
    for (const expectedCode of expectedCodes.slice(1)) {
      expect(cursor).toEqual(expect.any(String));
      const page = await service.getProjectDetailPage("finance", { ...request, cursor: cursor! });
      expect(page.items.map((item) => item.sourceBusinessCode)).toEqual([expectedCode]);
      pagedCodes.push(...page.items.map((item) => item.sourceBusinessCode));
      cursor = page.page.nextCursor;
    }
    expect(pagedCodes).toEqual(expectedCodes);
    if (cursor) {
      const terminalPage = await service.getProjectDetailPage("finance", { ...request, cursor });
      expect(terminalPage.items).toEqual([]);
      expect(terminalPage.page.nextCursor).toBeNull();
    }

    const exported = await service.exportView("finance", { scopeKind: "project", projectId: project.id },
      "current-password", "project_operating_ledger_detail");
    const csv = await readUtf8Stream(exported.stream);
    for (const row of facts) {
      if (expectedCodes.includes(row.sourceBusinessCode)) expect(csv).toContain(`"${row.sourceBusinessCode}"`);
      else expect(csv).not.toContain(`"${row.sourceBusinessCode}"`);
    }
    if (repeatSigned) {
      const correctionRow = csv.split("\n").find((line) => line.includes('"SIGNED-CORRECTION"'));
      expect(correctionRow).toContain(`"'-0.50"`);
    }
    const pendingSettlementRows = csv.split("\n").filter(line => line.includes("同一期次多来源结算待核对"));
    expect(pendingSettlementRows).toHaveLength(ambiguous ? 4 : 0);
    expect(pendingSettlementRows.every(line => !line.includes('"SETTLEMENT-B"'))).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "operating_projection.export", metadata: expect.objectContaining({ rowCount: expectedCodes.length })
    }));
  });

  it("fails a subject-filtered detail page on snapshot bytes before ORM materialization", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    tx.$queryRaw.mockImplementation(async (query) => {
      const sql = (query as { strings?: readonly string[] }).strings?.join(" ") ?? "";
      if (sql.includes("CURRENT_TIMESTAMP")) return [{ readAt }];
      if (sql.includes('AS "workFactCount"')) return [{ workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }];
      if (sql.includes('SUM(candidate."snapshotBytes")')) {
        return [{ snapshotBytes: BigInt(8 * 1024 * 1024 + 1) }];
      }
      return [{ replacementCount: 0n, snapshotBytes: 0n, maxSnapshotBytes: 0n }];
    });
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      {
        visibleRequestedProjectIdsInTransaction: jest.fn().mockResolvedValue([project.id]),
        effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
          new Map([[project.id, ["finance_director"]]])
        )
      } as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getProjectDetailPage("user-1", {
      projectId: project.id,
      counterpartyId: "owner-1"
    })).rejects.toMatchObject({ status: 413,
      message: "经营投影完整性数据超出安全预算，请收窄项目或主体筛选" });
    expect(tx.$queryRaw.mock.calls.some(([query]) =>
      (query as { strings: readonly string[] }).strings.join(" ").includes('SUM(candidate."snapshotBytes")')
    )).toBe(true);
    expect(tx.operatingImpactEntry.findMany.mock.calls.some(
      ([query]) => Boolean(query.select?.fact?.select)
    )).toBe(false);
  });

  it("maps only a confirmed #280 frozen counterparty coordinate into projection subjects", () => {
    expect(projectionFactSubjectReferences({
      sourceType: "project_fund_dispute_entry",
      sourceSnapshot: {
        schema: "project_fund_dispute_entry/V1",
        entryId: "dispute-entry-1",
        counterpartyKind: "owner",
        counterpartyId: "owner-1",
        counterpartyNameSnapshot: "业主甲"
      },
      subjectSnapshot: {},
      debtorSubjectKind: null,
      debtorSubjectId: null,
      creditorSubjectKind: null,
      creditorSubjectId: null,
      approvedPayerSubjectKind: null,
      approvedPayerSubjectId: null,
      actualPayerSubjectKind: null,
      actualPayerSubjectId: null,
      payeeSubjectKind: null,
      payeeSubjectId: null,
      costBearingCompanySubjectKind: null,
      costBearingCompanySubjectId: null,
      sourceBusinessId: "dispute-entry-1",
    })).toContainEqual({ kind: "counterparty", id: "owner-1" });

    expect(projectionFactSubjectReferences({
      sourceType: "owner_settlement",
      sourceSnapshot: {
        schema: "project_fund_dispute_entry/V1",
        entryId: "dispute-entry-1",
        counterpartyKind: "owner",
        counterpartyId: "forged-owner"
      },
      subjectSnapshot: {},
      debtorSubjectKind: null,
      debtorSubjectId: null,
      creditorSubjectKind: null,
      creditorSubjectId: null,
      approvedPayerSubjectKind: null,
      approvedPayerSubjectId: null,
      actualPayerSubjectKind: null,
      actualPayerSubjectId: null,
      payeeSubjectKind: null,
      payeeSubjectId: null,
      costBearingCompanySubjectKind: null,
      costBearingCompanySubjectId: null,
      sourceBusinessId: "dispute-entry-1",
    })).not.toContainEqual({ kind: "counterparty", id: "forged-owner" });
  });

  it("uses one repeatable-read read-only snapshot and passes the historical cutoff to the public #275 reader", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const historicalCutoff = new Date("2026-09-05T15:59:59.999Z");
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }]),
      project: { findMany: jest.fn().mockResolvedValue([project]) },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      interEntityRelationshipEntry:{findMany:jest.fn().mockResolvedValue([])},registeredOperationalPayment:{findMany:jest.fn().mockResolvedValue([])},companyTransfer:{findMany:jest.fn().mockResolvedValue([])},companyTransferEvent:{findMany:jest.fn().mockResolvedValue([])},
    projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([]) },
      operatingFact: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([])
      },
      operatingImpactEntry: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([])
      },
      clearingCase: { findMany: jest.fn().mockResolvedValue([{ id: "case-1" }]) }
    };
    const prisma = {
      $transaction: jest.fn(async (work, options) => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 5_000,
          timeout: 30_000
        });
        return work(tx);
      })
    };
    const visibility = overviewVisibility(["project-1"]);
    const clearing = {
      readClearingReconciliationRiskInTransaction: jest.fn().mockResolvedValue({
        projectId: "project-1",
        asOf: readAt.toISOString(),
        relationshipCompleteness: "complete",
        openPendingGrossCents: 0n,
        openCoveredCents: 0n,
        openUncoveredCents: 0n,
        continuedWithheldRetainedCents: 0n,
        coveredWithheldSources: [],
        items: []
      })
    };
    const service = new OperatingProjectionService(
      prisma as never,
      visibility as never,
      clearing as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    const result = await service.getProjectView("user-1", {
      projectId: "project-1",
      asOf: "2026-09-05"
    });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(visibility.visibleRequestedProjectIdsInTransaction).toHaveBeenCalledWith(
      tx,
      "user-1",
      ["project-1"]
    );
    expect(clearing.readClearingReconciliationRiskInTransaction).toHaveBeenCalledWith(
      tx,
      {
        projectId: "project-1",
        asOf: historicalCutoff,
        readAt,
        clearingCaseIds: ["case-1"]
      }
    );
    expect(result.scope).toEqual({ label: "单项目口径", projectCount: 1 });
    expect(result).not.toHaveProperty("details");
    expect(result).not.toHaveProperty("sourceDrilldown");
  });

  it("rejects a multi-project overview unless the actor has an overview role in every project", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const projects = [
      project,
      { id: "project-2", code: "XM-002", name: "二号项目" }
    ];
    const tx = emptyProjectionTx(readAt, projects);
    const visibility = {
      visibleRequestedProjectIdsInTransaction: jest.fn().mockResolvedValue(projects.map((item) => item.id)),
      effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(new Map([
        ["project-1", ["project_manager"]],
        ["project-2", ["employee"]]
      ]))
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      visibility as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getAsOfView("user-1", {
      scopeKind: "projects",
      projectIds: projects.map((item) => item.id)
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.operatingFact.findMany).not.toHaveBeenCalled();
  });

  it("suppresses every #275 risk detail when any case makes the scope fail closed", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    tx.clearingCase.findMany.mockResolvedValue([{ id: "case-conflict" }]);
    const clearing = {
      readClearingReconciliationRiskInTransaction: jest.fn().mockResolvedValue({
        projectId: project.id,
        asOf: readAt.toISOString(),
        relationshipCompleteness: "integrity_conflict",
        openPendingGrossCents: null,
        openCoveredCents: null,
        openUncoveredCents: null,
        continuedWithheldRetainedCents: null,
        coveredWithheldSources: [],
        items: []
      })
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      {
        visibleRequestedProjectIdsInTransaction: jest.fn().mockResolvedValue([project.id]),
        effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
          new Map([[project.id, ["finance_director"]]])
        )
      } as never,
      clearing as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    const result = await service.getProjectDetailPage("user-1", {
      projectId: project.id,
      pageSize: 20
    });

    expect(result.items).toEqual([]);
    expect(result.page.nextCursor).toBeNull();
    expect(result.projection.restrictions.openPendingReconciliationGrossCents).toBeNull();
    expect(clearing.readClearingReconciliationRiskInTransaction).toHaveBeenCalledTimes(1);
  });

  it("maps #275 reconciliation risk into sanitized detail and source drilldown rows", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    tx.clearingCase.findMany.mockResolvedValue([{ id: "case-1" }]);
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      {
        visibleRequestedProjectIdsInTransaction: jest.fn().mockResolvedValue([project.id]),
        effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
          new Map([[project.id, ["finance_director"]]])
        )
      } as never,
      {
        readClearingReconciliationRiskInTransaction: jest.fn().mockResolvedValue({
          projectId: project.id,
          asOf: readAt.toISOString(),
          relationshipCompleteness: "coverage_incomplete",
          openPendingGrossCents: 60n,
          openCoveredCents: 20n,
          openUncoveredCents: 40n,
          continuedWithheldRetainedCents: 5n,
          coveredWithheldSources: [{
            withheldEventVersionId: "internal-withheld-version-id",
            openCoveredCents: 20n,
            continuedRetainedCents: 5n
          }],
          items: [{
            itemId: "internal-item-id",
            currentRevisionId: "internal-revision-id",
            openAmountCents: 60n,
            openCoveredCents: 20n,
            openUncoveredCents: 40n,
            status: "open"
          }]
        })
      } as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    const result = await service.getProjectDetailPage("user-1", {
      projectId: project.id,
      sourceType: "clearing_event_version",
      costCategoryCode: "construction_enterprise_deduction"
    });

    expect(result.projection.restrictions.openPendingReconciliationGrossCents).toBe("60");
    expect(result.projection.sources).toContainEqual({
      sourceTypeLabel: "施工企业清分",
      factCount: 0,
      impactCount: 0,
      riskItemCount: 1,
      signedImpactCents: "60"
    });
    expect(result.items).toContainEqual({
      projectCode: project.code,
      projectName: project.name,
      sourceTypeLabel: "施工企业清分",
      sourceBusinessCode: "待核对清分风险",
      factKindLabel: "待核对关系",
      evidenceLevel: null,
      occurredAt: null,
      confirmedAt: null,
      confirmedAfterAsOf: false,
      impactKindLabel: "待核对未结金额",
      directionLabel: "限制",
      signedImpactCents: "60",
      costCategoryCode: "construction_enterprise_deduction",
      fundPurpose: null,
      reconciliationRisk: {
        openPendingGrossCents: "60",
        openCoveredCents: "20",
        openUncoveredCents: "40",
        continuedWithheldRetainedCents: "0",
        statusLabel: "待核对"
      }
    });
    expect(result.items).toContainEqual({
      projectCode: project.code,
      projectName: project.name,
      sourceTypeLabel: "施工企业清分",
      sourceBusinessCode: "继续暂扣风险",
      factKindLabel: "待核对关系",
      evidenceLevel: null,
      occurredAt: null,
      confirmedAt: null,
      confirmedAfterAsOf: false,
      impactKindLabel: "继续暂扣保留金额",
      directionLabel: "限制",
      signedImpactCents: "5",
      costCategoryCode: "construction_enterprise_deduction",
      fundPurpose: null,
      reconciliationRisk: {
        openPendingGrossCents: null,
        openCoveredCents: "20",
        openUncoveredCents: null,
        continuedWithheldRetainedCents: "5",
        statusLabel: "继续暂扣"
      }
    });
    expect(JSON.stringify(result)).not.toContain("internal-item-id");
    expect(JSON.stringify(result)).not.toContain("internal-revision-id");
    expect(JSON.stringify(result)).not.toContain("internal-withheld-version-id");
    expect(JSON.stringify(result.items)).not.toContain(project.id);
  });

  it("rejects a project outside the actor's existing visibility scope", async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([{ readAt: new Date("2026-09-11T01:02:03.000Z") }])
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      { visibleRequestedProjectIdsInTransaction: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getProjectView("user-1", { projectId: "project-1" }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rechecks the finance-only detail permission on cursor pages and direct export calls", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    const visibility = {
      visibleRequestedProjectIdsInTransaction: jest.fn().mockResolvedValue([project.id]),
      effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([[project.id, ["super_admin"]]])
      )
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      visibility as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      auth as never
    );
    const scope = {
      kind: "project" as const,
      projectId: project.id,
      projectIds: [project.id],
      filters: {}
    };
    const cursor = (service as unknown as {
      detailCursor: { issue: (claims: Record<string, unknown>) => string };
    }).detailCursor.issue({
      actorUserId: "user-1",
      requestedAsOf: null,
      requestScope: scope,
      scope,
      projectionContextFingerprint: "a".repeat(64),
      readAt: readAt.toISOString(),
      cutoffAt: readAt.toISOString(),
      pageSize: 50,
      position: { phase: "done" }
    });

    await expect(service.getProjectDetailPage("user-1", {
      projectId: project.id,
      cursor
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.exportView("user-1", {
      scopeKind: "project",
      projectId: project.id
    }, "current-password", "project_operating_ledger_detail"))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.confirmPassword).toHaveBeenCalled();
  });

  it("resolves a company entity filter across its frozen company-version subjects", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const fact = {
      id: "fact-1",
      projectId: "project-1",
      sourceType: "payment_execution",
      sourceBusinessId: "payment-1",
      sourceVersion: 1,
      sourceBusinessCode: "FK-001",
      occurredAt: new Date("2026-09-10T01:00:00.000Z"),
      confirmedAt: new Date("2026-09-10T02:00:00.000Z"),
      affiliateBusinessPartyVersionId: null,
      affiliateNameSnapshot: null,
      factKind: "downstream_payment",
      operatingLevel: "project",
      evidenceLevel: "A",
      amountCents: 50n,
      direction: "outflow",
      sourceSnapshot: {},
      entryKind: "original",
      adjustsFactId: null,
      subjectSnapshot: {},
      debtorSubjectKind: null,
      debtorSubjectId: null,
      creditorSubjectKind: null,
      creditorSubjectId: null,
      approvedPayerSubjectKind: null,
      approvedPayerSubjectId: null,
      actualPayerSubjectKind: "participating_company",
      actualPayerSubjectId: "company-version-1",
      payeeSubjectKind: null,
      payeeSubjectId: null,
      costBearingCompanySubjectKind: null,
      costBearingCompanySubjectId: null,
      impacts: [{
        id: "impact-1",
        impactKind: "company_project_funds_decrease",
        amountCents: 50n,
        direction: "decrease",
        subjectRole: "actual_payer",
        subjectKind: "participating_company",
        subjectId: "company-version-1",
        costCategoryCode: null,
        fundPurpose: null,
        description: "公司项目资金减少"
      }]
    };
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }])
        .mockResolvedValueOnce([{ projectId: "project-1" }])
        .mockResolvedValueOnce([{ workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }])
        .mockResolvedValueOnce([{
          replacementCount: 0n,
          snapshotBytes: 0n,
          maxSnapshotBytes: 0n
        }]).mockResolvedValue([{ workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }]),
      interEntityRelationshipEntry:{findMany:jest.fn().mockResolvedValue([])},registeredOperationalPayment:{findMany:jest.fn().mockResolvedValue([])},companyTransfer:{findMany:jest.fn().mockResolvedValue([])},companyTransferEvent:{findMany:jest.fn().mockResolvedValue([])},
    projectParticipatingCompany: {
        findMany: jest.fn().mockResolvedValue([{
          projectId: "project-1",
          companyEntityId: "company-entity-1",
          companyEntityVersionId: "company-version-1"
        }])
      },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      companyEntityVersion: {
        findMany: jest.fn().mockResolvedValue([{ id: "company-version-1" }])
      },
      project: { findMany: jest.fn().mockResolvedValue([project]) },
      operatingFact: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([fact])
      },
      operatingImpactEntry: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{
          ...fact.impacts[0],
          factId: fact.id,
          projectId: fact.projectId,
          sourceType: fact.sourceType,
          sourceBusinessId: fact.sourceBusinessId,
          sourceImpactKey: "company-project-funds-decrease",
          idempotencyKey: "impact-1",
          impactSnapshot: {},
          paymentExecutionId: null,
          fundExecutionId: null,
          fundExecutionCaseId: null,
          executionAllocationLineId: null,
          createdAt: new Date("2026-09-10T02:00:00.000Z")
        }])
      },
      clearingCase: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility(["project-1"]) as never,
      {
        readClearingReconciliationRiskInTransaction: jest.fn().mockResolvedValue({
          projectId: "project-1",
          asOf: readAt.toISOString(),
          relationshipCompleteness: "complete",
          openPendingGrossCents: 0n,
          openCoveredCents: 0n,
          openUncoveredCents: 0n,
          continuedWithheldRetainedCents: 0n,
          coveredWithheldSources: [],
          items: []
        })
      } as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    const result = await service.getCompanyView("user-1", {
      companyEntityId: "company-entity-1"
    });

    expect(tx.companyEntityVersion.findMany).toHaveBeenCalledWith({
      where: {
        companyEntityId: "company-entity-1",
        createdAt: { lte: readAt }
      },
      select: {
        id: true,
        name: true,
        unifiedSocialCreditCode: true,
        isActive: true,
        action: true,
        createdAt: true
      },
      orderBy: { id: "asc" },
      take: 20_001
    });
    const historicalParticipantRead = tx.projectParticipatingCompany.findMany.mock.calls
      .map(([query]) => query)
      .find((query) => query.select?.id === true);
    expect(historicalParticipantRead?.where).toEqual({
      projectId: { in: ["project-1"] },
      createdAt: { lte: readAt }
    });
    expect(result.scope).toEqual({ label: "公司归属口径", projectCount: 1 });
    expect(result.sources).toEqual([
      expect.objectContaining({ sourceTypeLabel: "合同付款执行" })
    ]);
    expect(result).not.toHaveProperty("details");
    expect(result).not.toHaveProperty("sourceDrilldown");
  });

  it("reads more than one project batch without turning the batch size into a business cap", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const projectIds = Array.from({ length: 101 }, (_, index) => `project-${index + 1}`);
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }]),
      project: {
        findMany: jest.fn().mockImplementation(async ({ where }) =>
          (where.id.in as string[]).map((id) => ({ id, code: id, name: id }))
        )
      },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      interEntityRelationshipEntry:{findMany:jest.fn().mockResolvedValue([])},registeredOperationalPayment:{findMany:jest.fn().mockResolvedValue([])},companyTransfer:{findMany:jest.fn().mockResolvedValue([])},companyTransferEvent:{findMany:jest.fn().mockResolvedValue([])},
    projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([]) },
      operatingFact: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([])
      },
      operatingImpactEntry: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([])
      },
      clearingCase: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility(projectIds) as never,
      {
        readClearingReconciliationRiskInTransaction: jest.fn()
          .mockImplementation(async (_tx, input) => ({
            projectId: input.projectId,
            relationshipCompleteness: "complete",
            openPendingGrossCents: 0n,
            openCoveredCents: 0n,
            openUncoveredCents: 0n,
            continuedWithheldRetainedCents: 0n,
            items: []
          }))
      } as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getAsOfView("user-1", {
      scopeKind: "projects",
      projectIds
    })).resolves.toEqual(expect.objectContaining({
      scope: { label: "多项目汇总口径", projectCount: 101 }
    }));
    expect(tx.project.findMany).toHaveBeenCalledTimes(3); // Two scoped batches plus transfer project labels.
    expect(tx.operatingFact.findMany.mock.calls.filter(([query]) => !query.select)).toHaveLength(2);
  });

  it("resolves company membership across internal project batches", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const visibleProjectIds = Array.from(
      { length: 101 },
      (_, index) => `project-${index + 1}`
    );
    const projectParticipatingCompany = {
      findMany: jest.fn().mockResolvedValue([{
        projectId: "project-1",
        companyEntityId: "company-1",
        companyEntityVersionId: "company-v1"
      }])
    };
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }])
        .mockResolvedValueOnce([{ projectId: "project-1" }])
        .mockResolvedValueOnce([{ workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }])
        .mockResolvedValueOnce([{
          replacementCount: 0n,
          snapshotBytes: 0n,
          maxSnapshotBytes: 0n
        }]).mockResolvedValue([{ workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }]),
      interEntityRelationshipEntry:{findMany:jest.fn().mockResolvedValue([])},registeredOperationalPayment:{findMany:jest.fn().mockResolvedValue([])},companyTransfer:{findMany:jest.fn().mockResolvedValue([])},companyTransferEvent:{findMany:jest.fn().mockResolvedValue([])},
      projectParticipatingCompany,
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      companyEntityVersion: { findMany: jest.fn().mockResolvedValue([{ id: "company-v1" }]) },
      project: { findMany: jest.fn().mockResolvedValue([project]) },
      operatingFact: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([])
      },
      operatingImpactEntry: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([])
      },
      clearingCase: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const clearing = {
      readClearingReconciliationRiskInTransaction: jest.fn().mockResolvedValue({
        projectId: "project-1",
        relationshipCompleteness: "complete",
        openPendingGrossCents: 0n,
        openCoveredCents: 0n,
        openUncoveredCents: 0n,
        continuedWithheldRetainedCents: 0n,
        items: []
      })
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility(visibleProjectIds) as never,
      clearing as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getCompanyView("user-1", {
      companyEntityId: "company-1"
    })).resolves.toEqual(expect.objectContaining({
      scope: { label: "公司归属口径", projectCount: 1 }
    }));
    const companyScopeSql = (
      tx.$queryRaw.mock.calls[1]?.[0] as { strings?: readonly string[] }
    ).strings?.join(" ") ?? "";
    expect(companyScopeSql).toContain('INNER JOIN "Project" project');
    expect(companyScopeSql).toContain('project."isActive" = TRUE');
    expect(companyScopeSql).toContain('ORDER BY membership."projectId" ASC');
  });

  it("resolves a small company before applying the global project visibility budget", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    tx.$queryRaw
      .mockResolvedValueOnce([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }])
      .mockResolvedValueOnce([{ projectId: project.id }])
      .mockResolvedValueOnce([{ workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }])
      .mockResolvedValueOnce([{
        replacementCount: 0n,
        snapshotBytes: 0n,
        maxSnapshotBytes: 0n
      }]);
    const visibility = {
      visibleProjectIdsWithinBudgetInTransaction: jest.fn()
        .mockRejectedValue(new Error("global visibility must not be enumerated")),
      visibleRequestedProjectIdsInTransaction: jest.fn()
        .mockResolvedValue([project.id]),
      effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([[project.id, ["project_manager"]]])
      )
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      visibility as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getCompanyView("user-1", {
      companyEntityId: "company-1"
    })).resolves.toEqual(expect.objectContaining({
      scope: { label: "公司归属口径", projectCount: 1 }
    }));
    expect(visibility.visibleProjectIdsWithinBudgetInTransaction).not.toHaveBeenCalled();
    expect(visibility.visibleRequestedProjectIdsInTransaction).toHaveBeenCalledWith(
      tx,
      "user-1",
      [project.id]
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it("keeps company scope resolution constant-time with 500 active and many inactive projects", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const activeProjects = Array.from({ length: 500 }, (_, index) => ({
      projectId: `company-project-${String(index).padStart(3, "0")}`
    }));
    const tx = emptyProjectionTx(readAt, []);
    tx.$queryRaw
      .mockResolvedValueOnce([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }])
      .mockResolvedValueOnce(activeProjects);
    const visibility = overviewVisibility([]);
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      visibility as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getCompanyView("user-1", {
      companyEntityId: "company-1"
    })).resolves.toEqual(expect.objectContaining({
      scope: { label: "公司归属口径", projectCount: 0 }
    }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const companyScopeSql = (
      tx.$queryRaw.mock.calls[1]?.[0] as { strings?: readonly string[] }
    ).strings?.join(" ") ?? "";
    expect(companyScopeSql).toContain('INNER JOIN "Project" project');
    expect(companyScopeSql).toContain('project."isActive" = TRUE');
    expect(companyScopeSql).toContain('LIMIT');
  });

  it("fails closed when the target company itself exceeds the project budget", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const companyProjects = Array.from({ length: 501 }, (_, index) => ({
      id: `company-project-${index}`,
      projectId: `company-project-${index}`
    }));
    const tx = emptyProjectionTx(readAt, []);
    tx.$queryRaw
      .mockResolvedValueOnce([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }])
      .mockResolvedValueOnce(companyProjects.map(({ projectId }) => ({ projectId })));
    const visibility = overviewVisibility([]);
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      visibility as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getCompanyView("user-1", {
      companyEntityId: "company-1"
    })).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(visibility.visibleRequestedProjectIdsInTransaction).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.operatingFact.findMany).not.toHaveBeenCalled();
  });

  it("fails closed before an all-visible funds snapshot exceeds the project budget", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const visibleProjects = Array.from({ length: 1_001 }, (_, index) => ({
      id: `project-${index + 1}`,
      code: `XM-${index + 1}`,
      name: `项目${index + 1}`
    }));
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }]),
      project: {
        findMany: jest.fn().mockImplementation(async ({ where }) =>
          visibleProjects.filter((item) => (where.id.in as string[]).includes(item.id))
        )
      },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      interEntityRelationshipEntry:{findMany:jest.fn().mockResolvedValue([])},registeredOperationalPayment:{findMany:jest.fn().mockResolvedValue([])},companyTransfer:{findMany:jest.fn().mockResolvedValue([])},companyTransferEvent:{findMany:jest.fn().mockResolvedValue([])},
    projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([]) },
      operatingFact: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([])
      },
      operatingImpactEntry: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([])
      },
      clearingCase: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const clearing = {
      readClearingReconciliationRiskInTransaction: jest.fn().mockImplementation(
        async (_tx, input) => ({
          projectId: input.projectId,
          relationshipCompleteness: "complete",
          openPendingGrossCents: 0n,
          openCoveredCents: 0n,
          openUncoveredCents: 0n,
          continuedWithheldRetainedCents: 0n,
          items: []
        })
      )
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      {
        visibleProjectIdsWithinBudgetInTransaction: jest.fn().mockResolvedValue(
          visibleProjects.map((item) => item.id)
        )
      } as never,
      clearing as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.readFundsCompatibilitySnapshot(
      "user-1",
      {},
      async (_tx, projectIds) => projectIds.length
    )).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(tx.project.findMany).not.toHaveBeenCalled();
  });

  it("preflights the full subject-only restriction integrity set before loading facts", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    const queryOrder: string[] = [];
    tx.$queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      const sql = query.strings.join(" ");
      if (sql.includes("CURRENT_TIMESTAMP")) {
        queryOrder.push("clock");
        return [{ readAt }];
      }
      if (sql.includes('AS "workFactCount"')) {
        queryOrder.push("work");
        return [{ workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }];
      }
      if (!sql.includes('AS "maxSnapshotBytes"')) throw new Error("Unexpected preflight query");
      queryOrder.push("restriction");
      return [{
        replacementCount: 40_001n,
        snapshotBytes: 1n,
        maxSnapshotBytes: 1
      }];
    });
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility([project.id]) as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getProjectView("user-1", {
      projectId: project.id,
      sourceType: "owner_settlement",
      costCategoryCode: "other_project_cost"
    }))
      .rejects.toMatchObject({ status: 413, message: "经营投影完整性数据超出安全预算，请收窄项目或主体筛选" });
    expect(queryOrder).toEqual(["clock", "work", "restriction"]);
    expect(tx.operatingFact.findMany).not.toHaveBeenCalled();
    expect(tx.operatingImpactEntry.findMany).not.toHaveBeenCalled();
    const preflightSql = (
      tx.$queryRaw.mock.calls[2]?.[0] as { strings?: readonly string[] }
    ).strings?.join(" ") ?? "";
    expect(preflightSql).toContain('AS "maxSnapshotBytes"');
    expect(preflightSql).toContain('"ProjectNecessaryExpenseReserveReplacement"');
    expect(preflightSql).toContain('"ProjectFundDisputeReplacement"');
    expect(preflightSql).toContain("pg_column_size");
    expect(preflightSql).toContain("octet_length");
  });

  it("fails closed when selected restriction snapshots exceed the byte budget", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    const queryOrder: string[] = [];
    tx.$queryRaw.mockImplementation(async (query: Prisma.Sql) => {
      const sql = query.strings.join(" ");
      if (sql.includes("CURRENT_TIMESTAMP")) {
        queryOrder.push("clock");
        return [{ readAt }];
      }
      if (sql.includes('AS "workFactCount"')) {
        queryOrder.push("work");
        return [{ workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }];
      }
      if (!sql.includes('AS "maxSnapshotBytes"')) throw new Error("Unexpected preflight query");
      queryOrder.push("restriction");
      return [{
        replacementCount: 1n,
        snapshotBytes: BigInt(8 * 1024 * 1024 + 1),
        maxSnapshotBytes: 1024
      }];
    });
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility([project.id]) as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getProjectView("user-1", {
      projectId: project.id,
      counterpartyId: "counterparty-1"
    }))
      .rejects.toMatchObject({ status: 413, message: "经营投影完整性数据超出安全预算，请收窄项目或主体筛选" });
    expect(queryOrder).toEqual(["clock", "work", "restriction"]);
    expect(tx.operatingFact.findMany).not.toHaveBeenCalled();
    expect(tx.operatingImpactEntry.findMany).not.toHaveBeenCalled();
    const preflightSql = (
      tx.$queryRaw.mock.calls[2]?.[0] as { strings?: readonly string[] }
    ).strings?.join(" ") ?? "";
    expect(preflightSql).toContain('AS "maxSnapshotBytes"');
    expect(preflightSql).toContain('fact."debtorSubjectKind"');
    expect(preflightSql).toContain("OR EXISTS");
  });

  it("reads 10,001 facts across internal pages below the request work cap", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const storedFact = (index: number) => ({
      id: `fact-${String(index).padStart(5, "0")}`,
      projectId: "project-1",
      sourceType: "owner_settlement",
      sourceBusinessId: `source-${index}`,
      sourceVersion: 1,
      sourceBusinessCode: `YS-${index}`,
      occurredAt: new Date("2026-09-10T01:00:00.000Z"),
      confirmedAt: new Date("2026-09-10T02:00:00.000Z"),
      affiliateBusinessPartyVersionId: "enterprise-v1",
      affiliateNameSnapshot: "施工企业甲",
      factKind: "owner_settlement",
      operatingLevel: "project",
      evidenceLevel: "A",
      amountCents: 1n,
      direction: "neutral",
      sourceSnapshot: {},
      entryKind: "original",
      adjustsFactId: null,
      subjectSnapshot: {},
      debtorSubjectKind: null,
      debtorSubjectId: null,
      creditorSubjectKind: null,
      creditorSubjectId: null,
      approvedPayerSubjectKind: null,
      approvedPayerSubjectId: null,
      actualPayerSubjectKind: null,
      actualPayerSubjectId: null,
      payeeSubjectKind: null,
      payeeSubjectId: null,
      costBearingCompanySubjectKind: null,
      costBearingCompanySubjectId: null
    });
    const rows = Array.from({ length: 10_001 }, (_, index) => storedFact(index));
    const findMany = jest.fn().mockImplementation(async (query) => {
      if (query.where.sourceType) return [];
      const first = rows.findIndex(({ id }) => id === query.cursor?.id) + 1;
      return rows.slice(first, first + query.take);
    });
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }]),
      project: { findMany: jest.fn().mockResolvedValue([project]) },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      interEntityRelationshipEntry:{findMany:jest.fn().mockResolvedValue([])},registeredOperationalPayment:{findMany:jest.fn().mockResolvedValue([])},companyTransfer:{findMany:jest.fn().mockResolvedValue([])},companyTransferEvent:{findMany:jest.fn().mockResolvedValue([])},
    projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([]) },
      operatingFact: {
        count: jest.fn().mockResolvedValue(10_001),
        findMany
      },
      operatingImpactEntry: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([])
      },
      clearingCase: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility(["project-1"]) as never,
      {
        readClearingReconciliationRiskInTransaction: jest.fn().mockResolvedValue({
          projectId: "project-1",
          relationshipCompleteness: "complete",
          openPendingGrossCents: 0n,
          openCoveredCents: 0n,
          openUncoveredCents: 0n,
          continuedWithheldRetainedCents: 0n,
          items: []
        })
      } as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getProjectView("user-1", { projectId: "project-1" }))
      .resolves.toEqual(expect.objectContaining({
        evidence: expect.objectContaining({
          A: { factCount: 10_001, amountCents: "10001" }
        })
      }));
    expect(tx.operatingFact.count).not.toHaveBeenCalled();
    expect(tx.operatingImpactEntry.count).not.toHaveBeenCalled();
    expect(findMany.mock.calls.filter(([query]) => !query.select)).toHaveLength(21);
  });

  it("does not let a narrowed holder filter bypass the total aggregate work budget", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    tx.$queryRaw.mockResolvedValue([{ readAt, workFactCount: 20_001n,
      workImpactCount: 0n, workBytes: 0n, targetCount: 0n }]);
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility(["project-1"]) as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );
    await expect(service.getProjectView("user-1", {
      projectId: "project-1", constructionEnterpriseId: "enterprise-selected"
    })).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(tx.operatingFact.findMany).not.toHaveBeenCalled();
    expect(tx.operatingImpactEntry.findMany).not.toHaveBeenCalled();
  });

  it("reads 50,001 impacts across internal pages below the request work cap", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const fact = {
      id: "fact-impact-pages",
      projectId: "project-1",
      sourceType: "owner_settlement",
      sourceBusinessId: "source-impact-pages",
      sourceVersion: 1,
      sourceBusinessCode: "YS-IMPACT-PAGES",
      occurredAt: new Date("2026-09-10T01:00:00.000Z"),
      confirmedAt: new Date("2026-09-10T02:00:00.000Z"),
      affiliateBusinessPartyVersionId: "enterprise-v1",
      affiliateNameSnapshot: "施工企业甲",
      factKind: "owner_settlement",
      operatingLevel: "project",
      evidenceLevel: "A",
      amountCents: 1n,
      direction: "inflow",
      sourceSnapshot: {},
      entryKind: "original",
      adjustsFactId: null,
      subjectSnapshot: {},
      debtorSubjectKind: null,
      debtorSubjectId: null,
      creditorSubjectKind: null,
      creditorSubjectId: null,
      approvedPayerSubjectKind: null,
      approvedPayerSubjectId: null,
      actualPayerSubjectKind: null,
      actualPayerSubjectId: null,
      payeeSubjectKind: null,
      payeeSubjectId: null,
      costBearingCompanySubjectKind: null,
      costBearingCompanySubjectId: null
    };
    const impact = {
      id: "impact-shared",
      factId: fact.id,
      projectId: fact.projectId,
      sourceType: fact.sourceType,
      sourceBusinessId: fact.sourceBusinessId,
      sourceImpactKey: "income",
      idempotencyKey: "impact-shared",
      impactKind: "confirmed_income",
      amountCents: 1n,
      direction: "increase",
      subjectRole: null,
      subjectKind: null,
      subjectId: null,
      costCategoryCode: null,
      fundPurpose: null,
      description: "确认收入",
      impactSnapshot: {},
      paymentExecutionId: null,
      fundExecutionId: null,
      fundExecutionCaseId: null,
      executionAllocationLineId: null,
      createdAt: new Date("2026-09-10T02:00:00.000Z")
    };
    const finalImpact = { ...impact, id: "impact-final" };
    const impactFindMany = jest.fn()
      .mockResolvedValueOnce(Array(50_000).fill(impact))
      .mockResolvedValueOnce([finalImpact]);
    const tx = {
      ...emptyProjectionTx(readAt, [project]),
      operatingFact: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([fact])
      },
      operatingImpactEntry: {
        count: jest.fn(),
        findMany: impactFindMany
      }
    };
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility(["project-1"]) as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getProjectView("user-1", { projectId: "project-1" }))
      .resolves.toEqual(expect.objectContaining({
        operating: expect.objectContaining({ confirmedIncomeCents: "50001" })
      }));
    expect(impactFindMany).toHaveBeenCalledTimes(2);
    expect(impactFindMany.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      cursor: { id: impact.id },
      skip: 1,
      take: 2_000
    }));
  });

  it("clamps today's date-only cutoff to readAt instead of rejecting it", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    tx.clearingCase.findMany.mockResolvedValue([{ id: "case-1" }]);
    const clearing = zeroRiskReader();
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility(["project-1"]) as never,
      clearing as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getProjectView("user-1", {
      projectId: "project-1",
      asOf: "2026-09-11"
    })).resolves.toEqual(expect.objectContaining({
      asOf: expect.objectContaining({ businessDate: "2026-09-11" })
    }));
    expect(clearing.readClearingReconciliationRiskInTransaction)
      .toHaveBeenCalledWith(tx, {
        projectId: "project-1",
        asOf: readAt,
        readAt,
        clearingCaseIds: ["case-1"]
      });
  });

  it.each([
    "",
    "2026/09/05",
    "2026-09-05T00:00:00.000Z",
    "2026-02-30"
  ])("rejects non-canonical or nonexistent service-level asOf %s", async (asOf) => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility([project.id]) as never,
      zeroRiskReader() as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await expect(service.getProjectView("user-1", {
      projectId: project.id,
      asOf
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("scopes #275 risk by construction enterprise and suppresses unrelated sources", async () => {
    const readAt = new Date("2026-09-11T01:02:03.000Z");
    const tx = emptyProjectionTx(readAt, [project]);
    tx.projectAffiliateAssignment.findMany.mockResolvedValue([{
      id: "assignment-1",
      projectId: "project-1",
      businessPartyId: "enterprise-1",
      businessPartyVersionId: "enterprise-v1"
    }]);
    tx.clearingCase.findMany.mockResolvedValue([{ id: "case-1" }]);
    const clearing = zeroRiskReader();
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never,
      overviewVisibility(["project-1"]) as never,
      clearing as never,
      { record: jest.fn() } as never,
      { confirmPassword: jest.fn() } as never
    );

    await service.getProjectView("user-1", {
      projectId: "project-1",
      constructionEnterpriseId: "enterprise-1"
    });
    expect(clearing.readClearingReconciliationRiskInTransaction)
      .toHaveBeenLastCalledWith(tx, {
        projectId: "project-1",
        asOf: readAt,
        readAt,
        clearingCaseIds: ["case-1"]
      });

    clearing.readClearingReconciliationRiskInTransaction.mockClear();
    await service.getProjectView("user-1", {
      projectId: "project-1",
      sourceType: "owner_settlement"
    });
    expect(clearing.readClearingReconciliationRiskInTransaction).not.toHaveBeenCalled();

    for (const filters of [
      { companyEntityId: "company-1" },
      { counterpartyId: "counterparty-1" },
      { costCategoryCode: "materials" }
    ]) {
      await service.getProjectView("user-1", { projectId: "project-1", ...filters });
    }
    expect(clearing.readClearingReconciliationRiskInTransaction).not.toHaveBeenCalled();

    await service.getProjectView("user-1", {
      projectId: "project-1",
      sourceType: "clearing_event_version",
      costCategoryCode: "construction_enterprise_deduction"
    });
    expect(clearing.readClearingReconciliationRiskInTransaction).toHaveBeenCalledWith(
      tx,
      { projectId: "project-1", asOf: readAt, readAt, clearingCaseIds: ["case-1"] }
    );
  });

  it("exports a completed detailed CSV from a controlled file, protects cells, and records audit", async () => {
    const prisma = {};
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new OperatingProjectionService(
      prisma as never,
      {} as never,
      {} as never,
      audit as never,
      auth as never
    );
    (service as unknown as { readExportProjection: jest.Mock }).readExportProjection =
      jest.fn().mockImplementation(async (
        _actorUserId: string,
        _input: unknown,
        _exportKind: string,
        output: { writeRow: (row: string[]) => Promise<void> }
      ) => {
        await output.writeRow([
          "=2+2", "一号项目", "业主结算", "YS-001", "业主结算", "A",
          "正式事实", "已确认", "2026-09-10T00:00:00.000Z",
          "2026-09-11T00:00:00.000Z", "已确认收入", "增加", "10.00",
          "", "", "债务主体：业主", "", "否"
        ]);
        return {
        projectIds: ["project-1"],
        effectiveRoleKeysByProject: {
          "project-1": ["finance_director"]
        },
        businessDate: "2026-09-11",
        readAt: "2026-09-11T01:02:03.000Z",
        rowCount: 1
        };
      });

    const exported = await service.exportView("user-1", {
      scopeKind: "project",
      projectId: "project-1"
    }, "current-password", "project_operating_ledger_detail");

    expect(auth.confirmPassword).toHaveBeenCalledWith("user-1", "current-password");
    expect(exported).not.toHaveProperty("projection");
    const content = await readUtf8Stream(exported.stream);
    expect(content).toContain("\"'=2+2\"");
    expect(content).toContain("\"金额（元）\"");
    expect(content).toContain("\"YS-001\"");
    expect(audit.record).toHaveBeenCalledWith(prisma, expect.objectContaining({
      actorUserId: "user-1",
      action: "operating_projection.export",
      businessType: "operating_projection",
      metadata: expect.objectContaining({
        scope: {
          kind: "project",
          projectId: "project-1",
          projectIds: ["project-1"]
        },
        filters: {},
        exportKind: "project_operating_ledger_detail",
        rowCount: 1,
        effectiveRoleKeysByProject: {
          "project-1": ["finance_director"]
        }
      })
    }));
  });

  it.each([
    ["material", "材料成本"], ["crew_and_labor", "班组及人工成本"],
    ["professional_subcontract", "专业分包成本"], ["machinery_and_rental", "机械设备及租赁成本"],
    ["site_construction_and_measures", "现场施工及措施费用"], ["project_daily_expense", "项目日常费用"],
    ["construction_enterprise_deduction", "施工企业扣费"], ["other_project_cost", "其他项目成本"],
    [null, ""], ["", ""], ["unknown_cost", null], ["toString", null]
  ])("exports populated cost %s through the public CSV boundary", async (code, label) => {
    const readAt = new Date("2026-09-11T01:02:03Z");
    const tx = emptyProjectionTx(readAt, [project]);
    let emitted = false;
    tx.operatingImpactEntry.findMany.mockImplementation(async (query) => {
      if (!query.select?.fact?.select || emitted) return [];
      emitted = true;
      return [{ id: "impact-1", impactKind: "confirmed_cost", amountCents: 100n,
        direction: "increase", costCategoryCode: code, fundPurpose: "购买 A 型配件",
        subjectKind: null, subjectId: null,
        fact: { id: "fact-1", projectId: project.id, sourceType: "expense_claim",
          sourceBusinessId: "expense-1", sourceBusinessCode: "BX-001", sourceVersion: 1,
          factKind: "expense", operatingLevel: "project", evidenceLevel: "A",
          amountCents: 100n, direction: "outflow", occurredAt: readAt, confirmedAt: readAt,
          entryKind: "original", adjustsFactId: null, sourceSnapshot: {}, subjectSnapshot: {} }
      }];
    });
    const audit = { record: jest.fn() };
    const visibility = overviewVisibility([project.id]);
    visibility.effectiveRoleKeysByProjectInTransaction.mockResolvedValue(
      new Map([[project.id, ["finance_director"]]])
    );
    const service = new OperatingProjectionService(
      { $transaction: jest.fn((work) => work(tx)) } as never, visibility as never,
      zeroRiskReader() as never, audit as never, { confirmPassword: jest.fn() } as never
    );
    const result = service.exportView("user-1", { scopeKind: "project", projectId: project.id },
      "password", "project_operating_ledger_detail");
    if (label === null) {
      await expect(result).rejects.toMatchObject({ status: 409, message: "经营投影存在未识别的成本分类，已拒绝导出" });
      expect(audit.record).not.toHaveBeenCalled();
    } else {
      const content = await readUtf8Stream((await result).stream);
      expect(content).toContain(`"1.00","${label}","购买 A 型配件"`);
      if (code) expect(content).not.toContain(`"${code}"`);
    }
  });

  it("fails closed before reading data when export confirmation is absent", async () => {
    const auth = { confirmPassword: jest.fn() };
    const service = new OperatingProjectionService(
      {} as never,
      {} as never,
      {} as never,
      { record: jest.fn() } as never,
      auth as never
    );

    await expect(service.exportView("user-1", {
      scopeKind: "project",
      projectId: "project-1"
    }, " ", "project_operating_ledger_detail")).rejects.toBeInstanceOf(BadRequestException);
    expect(auth.confirmPassword).not.toHaveBeenCalled();
  });

  it("rejects an export above 8 MiB before streaming or audit and removes its temp file", async () => {
    const audit = { record: jest.fn() };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new OperatingProjectionService(
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      auth as never
    );
    const tempEntries = async () => new Set(
      (await readdir(tmpdir())).filter((name) => name.startsWith("jiangkong-pol108-export-"))
    );
    const before = await tempEntries();
    (service as unknown as { readExportProjection: jest.Mock }).readExportProjection =
      jest.fn().mockImplementation(async (
        _actorUserId: string,
        _input: unknown,
        _exportKind: string,
        output: { writeRow: (row: string[]) => Promise<void> }
      ) => output.writeRow(["X".repeat(8 * 1024 * 1024)]));

    await expect(service.exportView("user-1", {
      scopeKind: "project",
      projectId: "project-1"
    }, "current-password", "project_operating_ledger_detail"))
      .rejects.toBeInstanceOf(PayloadTooLargeException);

    expect(audit.record).not.toHaveBeenCalled();
    const after = await tempEntries();
    expect([...after].filter((name) => !before.has(name))).toEqual([]);
  });
});

async function readUtf8Stream(stream: AsyncIterable<unknown>): Promise<string> {
  let result = "";
  for await (const chunk of stream) result += String(chunk);
  return result;
}
