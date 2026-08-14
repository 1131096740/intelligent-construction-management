import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { OperatingLedgerService } from "./operating-ledger.service";

describe("OperatingLedgerService", () => {
  it("requires project finance permission before appending a formal fact", async () => {
    const prisma = createPrismaMock({
      user: { id: "actor-1", isActive: true },
      projectMembers: [{ positionKey: "project_manager" }],
      project: projectRecord()
    });
    const service = new OperatingLedgerService(prisma as never);

    await expect(service.appendFromSource(baseInput(), "actor-1"))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.operatingFact.create).not.toHaveBeenCalled();
  });

  it("writes one fact with multiple impact keys and replays the same source idempotently", async () => {
    const prisma = createPrismaMock({
      user: { id: "actor-1", isActive: true },
      projectMembers: [{ positionKey: "finance_staff" }],
      project: projectRecord(),
      assignment: assignmentRecord(),
      existingFact: null
    });
    const service = new OperatingLedgerService(prisma as never);

    const first = await service.appendFromSource(baseInput(), "actor-1");
    const replay = await service.appendFromSource(
      {
        ...baseInput(),
        idempotencyKey: "replay-request",
        impacts: [
          ...baseInput().impacts,
          {
            idempotencyKey: "impact-payable",
            sourceImpactKey: "payable",
            impactKind: "payable_increase",
            amountCents: 1000n,
            direction: "increase",
            subjectRole: "debtor",
            subject: { kind: "construction_enterprise", id: "affiliate-version-1" }
          }
        ]
      },
      "actor-1"
    );

    expect(first.id).toBe(replay.id);
    expect(prisma.operatingFact.create).toHaveBeenCalledTimes(1);
    expect(prisma.operatingImpactEntry.create).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("keeps the original fact and rejects a correction that crosses projects", async () => {
    const prisma = createPrismaMock({
      user: { id: "actor-1", isActive: true },
      projectMembers: [{ positionKey: "finance_staff" }],
      project: projectRecord("project-2"),
      originalFact: { id: "fact-1", projectId: "project-1" }
    });
    const service = new OperatingLedgerService(prisma as never);

    await expect(
      service.appendCorrection(
        { ...baseInput("project-2"), adjustsFactId: "fact-1" },
        "actor-1"
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.operatingFact.update).not.toHaveBeenCalled();
    expect(prisma.operatingFact.delete).not.toHaveBeenCalled();
  });

  it("binds the confirmed user to the authorized finance actor", async () => {
    const prisma = createPrismaMock({
      user: { id: "actor-1", isActive: true },
      projectMembers: [{ positionKey: "finance_staff" }],
      project: projectRecord(),
      assignment: assignmentRecord()
    });
    const service = new OperatingLedgerService(prisma as never);

    await expect(
      service.appendFromSource({ ...baseInput(), confirmedByUserId: "other-user" }, "actor-1")
    ).rejects.toThrow("正式确认人必须是当前财务操作人");
    expect(prisma.operatingFact.create).not.toHaveBeenCalled();
  });

  it("does not let a C-level fact create formal impacts", async () => {
    const prisma = createPrismaMock({
      user: { id: "actor-1", isActive: true },
      projectMembers: [{ positionKey: "finance_staff" }],
      project: projectRecord(),
      assignment: assignmentRecord()
    });
    const service = new OperatingLedgerService(prisma as never);

    await expect(
      service.appendFromSource(
        {
          ...baseInput(),
          factKind: "historical_gap",
          evidenceLevel: "C",
          impacts: [{ ...baseInput().impacts[0]!, impactKind: "confirmed_cost" }]
        },
        "actor-1"
      )
    ).rejects.toThrow("C级证据只能登记缺口提示");
    expect(prisma.operatingFact.create).not.toHaveBeenCalled();
  });

  it("fails closed for subject kinds without a project validator", async () => {
    const prisma = createPrismaMock({
      user: { id: "actor-1", isActive: true },
      projectMembers: [{ positionKey: "finance_staff" }],
      project: projectRecord(),
      assignment: assignmentRecord()
    });
    const service = new OperatingLedgerService(prisma as never);

    await expect(
      service.appendFromSource(
        {
          ...baseInput(),
          subjects: { payee: { kind: "employee", id: "employee-1" } }
        },
        "actor-1"
      )
    ).rejects.toThrow("尚未接入该主体种类");
    expect(prisma.operatingFact.create).not.toHaveBeenCalled();
  });
});

function baseInput(projectId = "project-1") {
  return {
    projectId,
    sourceType: "expense_claim",
    sourceBusinessId: "expense-1",
    sourceBusinessCode: "BX-001",
    sourceVersion: 1,
    idempotencyKey: "expense-1-request",
    occurredAt: new Date("2026-08-14T00:00:00.000Z"),
    confirmedAt: new Date("2026-08-14T01:00:00.000Z"),
    confirmedByUserId: "actor-1",
    factKind: "expense" as const,
    operatingLevel: "project" as const,
    evidenceLevel: "A" as const,
    amountCents: 1000n,
    currencyCode: "CNY",
    direction: "outflow" as const,
    isBeforeOperatingLedgerEffectiveDate: false,
    sourceSnapshot: { businessCode: "BX-001", reason: "项目日常费用" },
    affiliateAssignmentId: "assignment-1",
    affiliateBusinessPartyVersionId: "affiliate-version-1",
    affiliateNameSnapshot: "施工企业",
    affiliateCreditCodeSnapshot: "91110000000000000A",
    subjects: {
      costBearingCompany: { kind: "participating_company" as const, id: "company-1" }
    },
    impacts: [
      {
        idempotencyKey: "impact-cost",
        sourceImpactKey: "cost",
        impactKind: "confirmed_cost" as const,
        amountCents: 1000n,
        direction: "increase" as const,
        subjectRole: "cost_bearing_company" as const,
        subject: { kind: "participating_company" as const, id: "company-1" },
        costCategoryCode: "project_daily_expense" as const
      }
    ]
  };
}

function projectRecord(id = "project-1") {
  return {
    id,
    isActive: true,
    operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z"),
    constructionEnterpriseLockedAt: null
  };
}

function assignmentRecord() {
  return {
    id: "assignment-1",
    projectId: "project-1",
    businessPartyId: "affiliate-1",
    businessPartyVersionId: "affiliate-version-1",
    affiliateNameSnapshot: "施工企业",
    affiliateCreditCodeSnapshot: "91110000000000000A",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    endedAt: null
  };
}

function createPrismaMock(options: {
  user?: { id: string; isActive: boolean } | null;
  projectMembers?: Array<{ positionKey: string }>;
  project?: ReturnType<typeof projectRecord> | null;
  assignment?: ReturnType<typeof assignmentRecord> | null;
  existingFact?: unknown;
  originalFact?: unknown;
}) {
  let storedFact = (options.existingFact as Record<string, unknown> | null) ?? null;
  const storedImpacts: Array<Record<string, unknown>> = [];
  const tx = {
    $executeRaw: jest.fn(),
    user: { findUnique: jest.fn().mockResolvedValue(options.user ?? null) },
    projectMember: { findMany: jest.fn().mockResolvedValue(options.projectMembers ?? []) },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    project: { findUnique: jest.fn().mockResolvedValue(options.project ?? null) },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue(options.assignment ?? null)
    },
    projectParticipatingCompany: {
      findFirst: jest.fn().mockResolvedValue({
        id: "participant-1",
        companyEntityId: "company-1",
        companyEntityVersionId: "company-version-1",
        companyNameSnapshot: "我方公司",
        companyCreditCodeSnapshot: "91110000000000000B"
      })
    },
    operatingFact: {
      findUnique: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id) return options.originalFact ?? null;
        return storedFact;
      }),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        storedFact = {
          ...data,
          id: "fact-1",
          projectId: data.projectId,
          sourceType: data.sourceType,
          sourceBusinessId: data.sourceBusinessId,
          impacts: storedImpacts
        };
        return storedFact;
      }),
      update: jest.fn(),
      delete: jest.fn()
    },
    operatingImpactEntry: {
      findUnique: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        const key = where.sourceType_sourceBusinessId_sourceImpactKey as Record<string, string> | undefined;
        return storedImpacts.find((impact) => impact.sourceImpactKey === key?.sourceImpactKey) ?? null;
      }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { ...data, id: `impact-${storedImpacts.length + 1}` };
        storedImpacts.push(created);
        if (storedFact) storedFact.impacts = storedImpacts;
        return created;
      })
    }
  };

  return {
    ...tx,
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
  };
}
