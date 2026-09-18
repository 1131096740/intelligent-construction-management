import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { calculateDistributionSettlement } from "../project-close-profit/project-close-profit.service";

const describePg = process.env.RUN_POL109_PROJECT_CLOSE_PG16 === "1" ? describe : describe.skip;

describePg("POL-109 project close PostgreSQL 16 hard gates", () => {
  const prisma = new PrismaClient();
  let projectId = "";
  let participant: {
    id: string;
    companyEntityId: string;
    companyEntityVersionId: string;
    companyNameSnapshot: string;
    companyCreditCodeSnapshot: string | null;
  };

  beforeAll(async () => {
    const row = await prisma.projectParticipatingCompany.findFirst({
      where: {
        endedAt: null,
        effectiveFrom: { lte: new Date("2026-09-18T00:00:00.000Z") }
      },
      orderBy: { effectiveFrom: "asc" },
      select: {
        id: true,
        projectId: true,
        companyEntityId: true,
        companyEntityVersionId: true,
        companyNameSnapshot: true,
        companyCreditCodeSnapshot: true
      }
    });
    if (!row) throw new Error("POL-109 PG16 fixture missing participating company");
    const project = await prisma.project.create({
      data: {
        code: `POL109-PG-${randomUUID().slice(0, 8)}`,
        name: "POL-109 PostgreSQL 硬门隔离项目"
      }
    });
    projectId = project.id;
    participant = await prisma.projectParticipatingCompany.create({
      data: {
        projectId,
        companyEntityId: row.companyEntityId,
        companyEntityVersionId: row.companyEntityVersionId,
        companyNameSnapshot: row.companyNameSnapshot,
        companyCreditCodeSnapshot: row.companyCreditCodeSnapshot,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        changeReason: "POL-109 PostgreSQL 硬门隔离 fixture",
        addedByUserId: "seed-user-finance-director"
      },
      select: {
        id: true,
        companyEntityId: true,
        companyEntityVersionId: true,
        companyNameSnapshot: true,
        companyCreditCodeSnapshot: true
      }
    });
    await prisma.projectCloseAggregate.upsert({
      where: { projectId },
      create: { projectId },
      update: {}
    });
  });

  afterAll(async () => prisma.$disconnect());

  it.each([
    ["盈利", 10_000n, 4_000n, { toReceiveCents: 6_000n, toReturnCents: 0n, additionalBearingCents: 0n }],
    ["亏损", -10_000n, 4_000n, { toReceiveCents: 0n, toReturnCents: 4_000n, additionalBearingCents: 10_000n }],
    ["零盈亏", 0n, 0n, { toReceiveCents: 0n, toReturnCents: 0n, additionalBearingCents: 0n }]
  ])("settles %s with signed exact amounts", (_label, share, transferred, expected) => {
    expect(calculateDistributionSettlement(share, transferred)).toEqual(expected);
  });

  it("rejects a non-contiguous stage lineage at commit", async () => {
    const idempotencyKey = randomUUID();
    await expect(prisma.$transaction(async (tx) => {
      await tx.projectCloseStageVersion.create({
        data: stageData({
          projectId,
          stageKey: "owner_settlement_completed",
          revision: 2,
          previousVersionId: null,
          idempotencyKey
        })
      });
    })).rejects.toThrow(/first stage revision|lineage|prerequisite/u);
  });

  it("serializes concurrent temporary distributions so their cumulative ceiling cannot be overspent", async () => {
    const before = await prisma.projectTemporaryProfitDistribution.aggregate({
      where: { projectId },
      _sum: { amountCents: true },
      _max: { revision: true }
    });
    const priorTotal = before._sum.amountCents ?? 0n;
    const revision = (before._max.revision ?? 0) + 1;
    const create = (suffix: string) => prisma.$transaction((tx) =>
      tx.projectTemporaryProfitDistribution.create({
        data: {
          projectId,
          revision,
          projectParticipatingCompanyId: participant.id,
          companyEntityId: participant.companyEntityId,
          companyEntityVersionId: participant.companyEntityVersionId,
          companyNameSnapshot: participant.companyNameSnapshot,
          companyCreditCodeSnapshot: participant.companyCreditCodeSnapshot,
          amountCents: 60n,
          authorizationCeilingCents: priorTotal + 100n,
          temporaryDistributedBeforeCents: priorTotal,
          authorizedCumulativeCents: priorTotal + 60n,
          projectionReadAt: new Date("2026-09-18T10:00:00.000Z"),
          projectionCutoffAt: new Date("2026-09-18T10:00:00.000Z"),
          projectionFingerprint: `pg16-${suffix}`,
          basisSnapshot: { summary: "PG16 concurrent ceiling" },
          authorizedByUserId: "pg16-actor",
          authorizedAt: new Date("2026-09-18T10:00:00.000Z"),
          idempotencyKey: randomUUID(),
          payloadFingerprint: `payload-${suffix}`
        }
      }));
    const results = await Promise.allSettled([create("a"), create("b")]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    if (fulfilled.length !== 1) {
      throw new Error(results.map((result) =>
        result.status === "rejected" ? String(result.reason) : "fulfilled"
      ).join(" | "));
    }
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("keeps completed stage history immutable", async () => {
    const existing = await prisma.projectCloseStageVersion.findFirst({
      where: { projectId, stageKey: "construction_completed" },
      orderBy: { revision: "desc" }
    });
    const row = existing ?? await prisma.projectCloseStageVersion.create({
      data: stageData({
        projectId,
        stageKey: "construction_completed",
        revision: 1,
        previousVersionId: null,
        idempotencyKey: randomUUID()
      })
    });
    await expect(prisma.$executeRawUnsafe(
      'UPDATE "ProjectCloseStageVersion" SET "payloadFingerprint" = $1 WHERE "id" = $2',
      "tampered",
      row.id
    )).rejects.toThrow(/immutable history/u);
  });

  it("rejects cross-project immutable decision lineage", async () => {
    const createProject = async (label: string) => {
      const project = await prisma.project.create({
        data: { code: `POL109-LINEAGE-${label}-${randomUUID().slice(0, 8)}`, name: `谱系项目${label}` }
      });
      await prisma.projectCloseAggregate.create({ data: { projectId: project.id } });
      return project.id;
    };
    const projectA = await createProject("A");
    const projectB = await createProject("B");
    const first = await prisma.projectCloseDecisionSubmission.create({
      data: decisionSubmissionData(projectA, 1, null)
    });
    await prisma.projectCloseDecisionSubmission.create({
      data: decisionSubmissionData(projectB, 1, null)
    });

    await expect(prisma.projectCloseDecisionSubmission.create({
      data: decisionSubmissionData(projectB, 2, first.id)
    })).rejects.toThrow(/lineage|foreign key|previous_project_fkey/u);
  });

});

function decisionSubmissionData(
  projectId: string,
  revision: number,
  previousSubmissionId: string | null
) {
  const now = new Date("2026-09-18T09:00:00.000Z");
  return {
    projectId,
    decisionKind: "final_profit",
    revision,
    previousSubmissionId,
    projectionReadAt: now,
    projectionCutoffAt: now,
    projectionFingerprint: `submission-${projectId}-${revision}`,
    amountSnapshot: {},
    stateSnapshot: {},
    participantsSnapshot: [],
    proposalSnapshot: {},
    basisSnapshot: {},
    preparedByUserId: "pg16-finance",
    preparedAt: now,
    submittedByUserId: "pg16-finance",
    submittedAt: now,
    idempotencyKey: randomUUID(),
    payloadFingerprint: randomUUID()
  };
}

function stageData(input: {
  projectId: string;
  stageKey: string;
  revision: number;
  previousVersionId: string | null;
  idempotencyKey: string;
}) {
  const now = new Date("2026-09-18T09:00:00.000Z");
  return {
    ...input,
    status: "completed",
    projectionReadAt: now,
    projectionCutoffAt: now,
    projectionFingerprint: `pg16-${input.stageKey}-${input.revision}`,
    amountSnapshot: {},
    stateSnapshot: {},
    basisSnapshot: { summary: "PG16" },
    confirmedByUserId: "pg16-actor",
    confirmedAt: now,
    payloadFingerprint: `payload-${input.idempotencyKey}`
  };
}
