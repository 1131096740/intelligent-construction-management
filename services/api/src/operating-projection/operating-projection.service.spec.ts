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
    expect(additional).toHaveBeenCalledWith(tx, [project.id]);
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
    expect(tx.project.findMany).toHaveBeenCalledTimes(2);
    expect(tx.operatingFact.findMany).toHaveBeenCalledTimes(2);
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
    const firstPage = Array.from({ length: 10_000 }, (_, index) => storedFact(index));
    const finalPage = [storedFact(10_000)];
    const findMany = jest.fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(finalPage);
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([{ readAt, workFactCount: 0n, workImpactCount: 0n, workBytes: 0n, targetCount: 0n }]),
      project: { findMany: jest.fn().mockResolvedValue([project]) },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
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
    expect(findMany).toHaveBeenCalledTimes(2);
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
