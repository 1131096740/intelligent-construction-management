import {
  ProjectCloseProfitService,
  calculateExistingFundsApplied,
  calculateDistributionSettlement
} from "./project-close-profit.service";
import { resolveProjectCloseImpactPolicy } from "./project-close-impact-policy";
import { OPERATING_IMPACT_KINDS } from "@jiangkong/shared-domain";

describe("ProjectCloseProfitService", () => {
  it("returns the first ready stage and only the current role's server action", async () => {
    const tx = {
      projectCloseStageVersion: {
        findMany: jest.fn().mockResolvedValue([])
      },
      projectCloseProfessionalAttestation: { findMany: jest.fn().mockResolvedValue([]) },
      projectCloseProfitConfirmation: { findMany: jest.fn().mockResolvedValue([]) },
      projectCloseDistribution: { findMany: jest.fn().mockResolvedValue([]) },
      projectCloseDecisionSubmission: { findMany: jest.fn().mockResolvedValue([
        {
          id: "stale-final-profit-submission",
          projectId: "project-1",
          decisionKind: "final_profit",
          revision: 1,
          previousSubmissionId: null,
          projectionFingerprint: "projection-fingerprint",
          prerequisiteStageVersionIds: ["stale-stage-1"],
          profitConfirmationId: null,
          profitStageVersionId: null,
          projectionReadAt: new Date("2026-09-18T08:00:00.000Z"),
          projectionCutoffAt: new Date("2026-09-17T16:00:00.000Z"),
          amountSnapshot: {},
          stateSnapshot: {},
          participantsSnapshot: [],
          proposalSnapshot: {},
          basisSnapshot: {},
          preparedByUserId: "finance-user",
          preparedAt: new Date("2026-09-18T08:00:00.000Z"),
          submittedByUserId: "finance-user",
          submittedAt: new Date("2026-09-18T08:00:00.000Z")
        },
        {
          id: "stale-distribution-submission",
          projectId: "project-1",
          decisionKind: "distribution",
          revision: 1,
          previousSubmissionId: null,
          projectionFingerprint: "projection-fingerprint",
          prerequisiteStageVersionIds: [],
          profitConfirmationId: "stale-profit-confirmation",
          profitStageVersionId: "stale-stage-5",
          projectionReadAt: new Date("2026-09-18T08:00:00.000Z"),
          projectionCutoffAt: new Date("2026-09-17T16:00:00.000Z"),
          amountSnapshot: {},
          stateSnapshot: {},
          participantsSnapshot: [],
          proposalSnapshot: {},
          basisSnapshot: {},
          preparedByUserId: "finance-user",
          preparedAt: new Date("2026-09-18T08:00:00.000Z"),
          submittedByUserId: "finance-user",
          submittedAt: new Date("2026-09-18T08:00:00.000Z")
        }
      ]) },
      projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([]) },
      projectTemporaryProfitDistribution: { findMany: jest.fn().mockResolvedValue([]) },
      projectCloseImpact: { findMany: jest.fn().mockResolvedValue([]) },
      operatingFact: {
        findMany: jest.fn().mockResolvedValue([{
          id: "downstream-settlement-fact-1",
          sourceSnapshot: { contractVersionId: "contract-version-1" }
        }])
      },
      $queryRaw: jest.fn().mockResolvedValue([{
        contractVersionId: "contract-version-1",
        contractId: "contract-1",
        ownerUserId: "contract-owner-1",
        isActive: true
      }])
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const projections = {
      readProjectInTransaction: jest.fn().mockResolvedValue({
        projection: {
          details: [{
            factId: "downstream-settlement-fact-1",
            factKind: "downstream_settlement"
          }]
        },
        aggregate: { profitAndLoss: {}, distribution: {} },
        readAt: new Date("2026-09-18T08:00:00.000Z"),
        cutoffAt: new Date("2026-09-17T16:00:00.000Z"),
        fingerprint: "projection-fingerprint"
      })
    };
    const visibility = {
      effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["project_manager"]]])
      )
    };
    const audit = { record: jest.fn() };

    const service = new ProjectCloseProfitService(
      prisma as never,
      projections as never,
      visibility as never,
      audit as never
    );

    const result = await service.getWorkbench("user-1", "project-1");
    expect(result).toMatchObject({
      schema: "project_close_profit/V1",
      projectId: "project-1",
      projection: {
        readAt: "2026-09-18T08:00:00.000Z",
        cutoffAt: "2026-09-17T16:00:00.000Z",
        fingerprint: "projection-fingerprint"
      }
    });
    expect(result.canReconcileImpacts).toBe(false);
    expect(result.stages[0]).toMatchObject({
      key: "construction_completed",
      label: "工程完工",
      status: "ready",
      availableActions: ["complete"]
    });
    expect(result.stages[1]).toMatchObject({
      key: "owner_settlement_completed",
      status: "pending",
      availableActions: []
    });
    expect(result.stages.slice(1).every((stage) => stage.availableActions.length === 0)).toBe(true);
    expect(result.currentDecisionSubmissions).toEqual({
      finalProfit: null,
      distribution: null
    });
    expect(projections.readProjectInTransaction).toHaveBeenCalledWith(
      tx,
      "user-1",
      { projectId: "project-1" }
    );
  });

  it("completes the first stage in the same projection transaction and stores an immutable receipt", async () => {
    const stageVersion = {
      id: "stage-version-1",
      stageKey: "construction_completed",
      revision: 1,
      status: "completed",
      confirmedAt: new Date("2026-09-18T08:10:00.000Z")
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ projectId: "project-1" }]),
      projectCloseAggregate: {
        upsert: jest.fn().mockResolvedValue({ projectId: "project-1", revision: 0 }),
        update: jest.fn().mockResolvedValue({ projectId: "project-1", revision: 1 })
      },
      projectCloseCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-1" })
      },
      projectCloseStageVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(stageVersion)
      }
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const projections = {
      readProjectInTransaction: jest.fn().mockResolvedValue({
        projection: {
          operating: { confirmedIncomeCents: "10000", confirmedCostCents: "4000" },
          actualFunds: { nonNegativeUsableCashStartCents: "6000" },
          restrictions: {},
          profitAndLoss: { currentOperatingProfitCents: "6000" },
          distribution: {}
        },
        aggregate: {},
        readAt: new Date("2026-09-18T08:00:00.000Z"),
        cutoffAt: new Date("2026-09-17T16:00:00.000Z"),
        fingerprint: "projection-fingerprint"
      })
    };
    const visibility = {
      effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["project_manager"]]])
      )
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectCloseProfitService(
      prisma as never,
      projections as never,
      visibility as never,
      audit as never
    );

    await expect(service.completeStage("user-1", "project-1", {
      stageKey: "construction_completed",
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "2a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
      basis: { summary: "工程已按合同范围完成", evidenceFileIds: [] }
    })).resolves.toEqual({
      stageVersionId: "stage-version-1",
      stageKey: "construction_completed",
      revision: 1,
      status: "completed",
      confirmedAt: "2026-09-18T08:10:00.000Z"
    });
    expect(projections.readProjectInTransaction).toHaveBeenCalledWith(
      tx,
      "user-1",
      { projectId: "project-1" }
    );
    expect(tx.projectCloseStageVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: "project-1",
        stageKey: "construction_completed",
        projectionFingerprint: "projection-fingerprint",
        confirmedByUserId: "user-1"
      })
    }));
    expect(tx.projectCloseCommandReceipt.create).toHaveBeenCalled();
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectCloseAggregate.upsert.mock.invocationCallOrder[0]
    );
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "project_close.stage.complete",
      businessType: "project_close_stage",
      businessId: "stage-version-1"
    }));
  });

  it("does not expose the generic completion action for stages with dedicated business contracts", async () => {
    const completedAt = new Date("2026-09-18T08:00:00.000Z");
    const tx = {
      projectCloseStageVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "stage-version-2",
            stageKey: "owner_settlement_completed",
            revision: 1,
            status: "completed",
            projectionReadAt: completedAt,
            projectionCutoffAt: completedAt,
            projectionFingerprint: "projection-fingerprint",
            amountSnapshot: {},
            stateSnapshot: {},
            basisSnapshot: {},
            confirmedByUserId: "user-2",
            confirmedAt: completedAt
          },
          {
            id: "stage-version-1",
            stageKey: "construction_completed",
            revision: 1,
            status: "completed",
            projectionReadAt: completedAt,
            projectionCutoffAt: completedAt,
            projectionFingerprint: "projection-fingerprint",
            amountSnapshot: {},
            stateSnapshot: {},
            basisSnapshot: {},
            confirmedByUserId: "user-1",
            confirmedAt: completedAt
          }
        ])
      },
      projectCloseProfessionalAttestation: { findMany: jest.fn().mockResolvedValue([]) },
      projectCloseProfitConfirmation: { findMany: jest.fn().mockResolvedValue([]) },
      projectCloseDistribution: { findMany: jest.fn().mockResolvedValue([]) },
      projectCloseDecisionSubmission: { findMany: jest.fn().mockResolvedValue([]) },
      projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([]) },
      projectTemporaryProfitDistribution: { findMany: jest.fn().mockResolvedValue([]) },
      projectCloseImpact: { findMany: jest.fn().mockResolvedValue([]) },
      operatingFact: {
        findMany: jest.fn().mockResolvedValue([{
          id: "downstream-settlement-fact-1",
          sourceSnapshot: { contractVersionId: "contract-version-1" }
        }])
      },
      $queryRaw: jest.fn().mockResolvedValue([{
        contractVersionId: "contract-version-1",
        contractId: "contract-1",
        ownerUserId: "contract-owner-1",
        isActive: true
      }])
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const projections = {
      readProjectInTransaction: jest.fn().mockResolvedValue({
        projection: {
          details: [{
            factId: "downstream-settlement-fact-1",
            factKind: "downstream_settlement"
          }]
        },
        aggregate: {},
        readAt: completedAt,
        cutoffAt: completedAt,
        fingerprint: "projection-fingerprint"
      })
    };
    const visibility = {
      effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["contract_director"]]])
      )
    };
    const service = new ProjectCloseProfitService(
      prisma as never,
      projections as never,
      visibility as never,
      { record: jest.fn() } as never
    );

    const result = await service.getWorkbench("user-3", "project-1");

    expect(result.stages[2]).toMatchObject({
      key: "downstream_cost_confirmed",
      status: "ready",
      availableActions: ["attest_contract_cost"]
    });

    visibility.effectiveRoleKeysByProjectInTransaction.mockResolvedValue(
      new Map([["project-1", ["contract_staff"]]])
    );
    const contractStaffView = await service.getWorkbench("contract-owner-1", "project-1");
    expect(contractStaffView.stages[2]).toMatchObject({
      key: "downstream_cost_confirmed",
      status: "ready",
      availableActions: ["attest_contract_cost"]
    });

    tx.$queryRaw.mockResolvedValueOnce([{
      contractVersionId: "contract-version-1",
      contractId: "contract-1",
      ownerUserId: "another-contract-owner",
      isActive: true
    }]);
    const unrelatedContractStaffView = await service.getWorkbench(
      "contract-owner-1",
      "project-1"
    );
    expect(unrelatedContractStaffView.stages[2]).toMatchObject({
      key: "downstream_cost_confirmed",
      status: "ready",
      availableActions: []
    });
  });

  it.each([
    "downstream_cost_confirmed",
    "final_profit_confirmed",
    "profit_distribution_completed"
  ])("fails closed when %s is sent through the generic completion command", async (stageKey) => {
    const prisma = { $transaction: jest.fn() };
    const service = new ProjectCloseProfitService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(service.completeStage("user-1", "project-1", {
      stageKey,
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "2a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
      basis: { summary: "不应通过通用命令", evidenceFileIds: [] }
    })).rejects.toThrow("该项目收口阶段必须使用专用确认操作");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("freezes the second downstream-cost specialty attestation and completes stage 3", async () => {
    const readAt = new Date("2026-09-18T09:00:00.000Z");
    const precedingVersions = [
      { stageKey: "construction_completed", revision: 1, status: "completed" },
      { stageKey: "owner_settlement_completed", revision: 1, status: "completed" }
    ];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ projectId: "project-1" }]),
      projectCloseAggregate: {
        upsert: jest.fn().mockResolvedValue({ projectId: "project-1" }),
        update: jest.fn().mockResolvedValue({ projectId: "project-1", revision: 1 })
      },
      projectCloseCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-3" })
      },
      projectCloseStageVersion: {
        findMany: jest.fn().mockResolvedValue(precedingVersions),
        create: jest.fn().mockResolvedValue({
          id: "stage-version-3",
          stageKey: "downstream_cost_confirmed",
          revision: 1,
          status: "completed",
          confirmedAt: readAt
        })
      },
      projectCloseProfessionalAttestation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "attestation-contract",
            specialty: "contract",
            revision: 1,
            projectionFingerprint: "projection-fingerprint"
          }
        ]),
        create: jest.fn().mockResolvedValue({
          id: "attestation-finance",
          specialty: "finance",
          revision: 1,
          attestedAt: readAt
        })
      },
      projectCloseStageAttestationLink: {
        findUnique: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 2 })
      }
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const projections = {
      readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt))
    };
    const visibility = {
      effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["finance_director"]]])
      )
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectCloseProfitService(
      prisma as never,
      projections as never,
      visibility as never,
      audit as never
    );

    await expect(service.attestDownstreamCost("finance-user", "project-1", {
      specialty: "finance",
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "6b2568f2-d303-4708-9ca0-04b3e594225f",
      basis: { summary: "工资、费用、扣费和应付款已核清", evidenceFileIds: [] }
    })).resolves.toMatchObject({
      attestationId: "attestation-finance",
      specialty: "finance",
      stageCompleted: true,
      stageVersionId: "stage-version-3"
    });
    expect(tx.projectCloseStageAttestationLink.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ specialty: "contract", attestationId: "attestation-contract" }),
        expect.objectContaining({ specialty: "finance", attestationId: "attestation-finance" })
      ])
    });
  });

  it("allows the active owner of every exact referenced contract to attest contract costs", async () => {
    const readAt = new Date("2026-09-18T09:05:00.000Z");
    const projection = completeProjection(readAt);
    projection.projection.details = [{
      factId: "downstream-settlement-fact-1",
      factKind: "downstream_settlement"
    } as never];
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ locked: "1" }])
        .mockResolvedValueOnce([{ projectId: "project-1" }])
        .mockResolvedValueOnce([{
          contractVersionId: "contract-version-1",
          contractId: "contract-1",
          ownerUserId: "contract-owner-1",
          isActive: true
        }]),
      projectCloseAggregate: {
        upsert: jest.fn().mockResolvedValue({ projectId: "project-1" }),
        update: jest.fn()
      },
      projectCloseCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      projectCloseStageVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "stage-1", stageKey: "construction_completed", revision: 1, status: "completed" },
          { id: "stage-2", stageKey: "owner_settlement_completed", revision: 1, status: "completed" }
        ]),
        create: jest.fn()
      },
      projectCloseProfessionalAttestation: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({
          id: "attestation-contract-owner",
          specialty: "contract",
          revision: 1,
          attestedAt: readAt
        })
      },
      projectCloseStageAttestationLink: {
        findUnique: jest.fn(),
        createMany: jest.fn()
      },
      operatingFact: {
        findMany: jest.fn().mockResolvedValue([{
          id: "downstream-settlement-fact-1",
          sourceSnapshot: { contractVersionId: "contract-version-1" }
        }])
      }
    };
    const audit = { record: jest.fn() };
    const service = new ProjectCloseProfitService(
      { $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) } as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(projection) } as never,
      { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["contract_staff"]]])
      ) } as never,
      audit as never
    );

    await expect(service.attestDownstreamCost("contract-owner-1", "project-1", {
      specialty: "contract",
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "7b2568f2-d303-4708-9ca0-04b3e594225f",
      basis: { summary: "本人负责合同结算已逐项核清", evidenceFileIds: [] }
    })).resolves.toMatchObject({
      attestationId: "attestation-contract-owner",
      specialty: "contract",
      stageCompleted: false
    });
    expect(tx.operatingFact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["downstream-settlement-fact-1"] },
        projectId: "project-1",
        status: "confirmed"
      })
    }));
    expect(tx.projectCloseProfessionalAttestation.create).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "project_close.downstream_cost.attest"
    }));
  });

  it("does not reuse a specialty attestation already frozen into an earlier stage version", async () => {
    const readAt = new Date("2026-09-18T09:10:00.000Z");
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ projectId: "project-1" }]),
      projectCloseAggregate: {
        upsert: jest.fn().mockResolvedValue({ projectId: "project-1" }),
        update: jest.fn()
      },
      projectCloseCommandReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "receipt-4" })
      },
      projectCloseStageVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "stage-1", stageKey: "construction_completed", revision: 1, status: "completed" },
          { id: "stage-2", stageKey: "owner_settlement_completed", revision: 1, status: "completed" },
          {
            id: "stage-3-reopen",
            stageKey: "downstream_cost_confirmed",
            revision: 2,
            status: "needs_reconfirmation"
          }
        ]),
        create: jest.fn()
      },
      projectCloseProfessionalAttestation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "attestation-finance-old",
            specialty: "finance",
            revision: 1,
            projectionFingerprint: "projection-fingerprint"
          }
        ]),
        create: jest.fn().mockResolvedValue({
          id: "attestation-contract-new",
          specialty: "contract",
          revision: 1,
          attestedAt: readAt
        })
      },
      projectCloseStageAttestationLink: {
        findUnique: jest.fn().mockResolvedValue({
          stageVersionId: "stage-3-old",
          attestationId: "attestation-finance-old"
        }),
        createMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const service = new ProjectCloseProfitService(
      prisma as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
      {
        effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
          new Map([["project-1", ["contract_director"]]])
        )
      } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never
    );

    await expect(service.attestDownstreamCost("contract-user", "project-1", {
      specialty: "contract",
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "8b2568f2-d303-4708-9ca0-04b3e594225f",
      basis: { summary: "合同专业重新确认成本", evidenceFileIds: [] }
    })).resolves.toMatchObject({
      attestationId: "attestation-contract-new",
      specialty: "contract",
      stageCompleted: false,
      stageVersionId: null
    });
    expect(tx.projectCloseStageVersion.create).not.toHaveBeenCalled();
    expect(tx.projectCloseStageAttestationLink.createMany).not.toHaveBeenCalled();
  });

  it("fails closed when final profit is confirmed from an incomplete money projection", async () => {
    const readAt = new Date("2026-09-18T09:30:00.000Z");
    const tx = finalConfirmationTx(readAt);
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const projection = completeProjection(readAt);
    projection.projection.integrity.moneyComplete = false;
    const service = new ProjectCloseProfitService(
      prisma as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(projection) } as never,
      {
        effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
          new Map([["project-1", ["finance_director"]]])
        )
      } as never,
      { record: jest.fn() } as never
    );

    await expect(service.submitFinalProfit("finance-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "99aa72f6-e48c-4907-ae1b-5cd85c734a78",
      basis: { summary: "确认最终盈亏", evidenceFileIds: [] }
    })).rejects.toThrow("经营金额或来源仍不完整");
    expect(tx.projectCloseProfitConfirmation.create).not.toHaveBeenCalled();
  });

  it("freezes the finance submission before a chairman confirms the exact version", async () => {
    const readAt = new Date("2026-09-18T09:40:00.000Z");
    const tx = finalConfirmationTx(readAt);
    const submission = {
      id: "3a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
      projectId: "project-1",
      decisionKind: "final_profit",
      revision: 1,
      previousSubmissionId: null,
      projectionReadAt: readAt,
      projectionCutoffAt: readAt,
      projectionFingerprint: "projection-fingerprint",
      prerequisiteStageVersionIds: ["stage-1", "stage-2", "stage-3", "stage-4"],
      profitConfirmationId: null,
      profitStageVersionId: null,
      amountSnapshot: {},
      stateSnapshot: {},
      participantsSnapshot: [],
      proposalSnapshot: { finalProfitCents: "6000" },
      basisSnapshot: { summary: "财务复核完成", evidenceFileIds: [] },
      preparedByUserId: "finance-user",
      preparedAt: readAt,
      submittedByUserId: "finance-user",
      submittedAt: readAt
    };
    tx.projectCloseDecisionSubmission.create.mockResolvedValue(submission);
    tx.projectCloseDecisionSubmission.findUnique.mockResolvedValue(submission);
    tx.projectCloseStageVersion.create.mockResolvedValue({
      id: "stage-5",
      stageKey: "final_profit_confirmed",
      revision: 1,
      status: "completed",
      confirmedAt: readAt
    });
    tx.projectCloseProfitConfirmation.create.mockResolvedValue({
      id: "confirmation-1",
      revision: 1,
      finalProfitCents: 6000n,
      confirmedAt: readAt
    });
    const service = new ProjectCloseProfitService(
      { $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) } as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
      {
        effectiveRoleKeysByProjectInTransaction: jest.fn()
          .mockResolvedValueOnce(new Map([["project-1", ["finance_director"]]]))
          .mockResolvedValueOnce(new Map([["project-1", ["chairman"]]]))
      } as never,
      { record: jest.fn() } as never
    );

    await expect(service.submitFinalProfit("finance-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "4a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
      basis: submission.basisSnapshot
    })).resolves.toMatchObject({
      id: submission.id,
      decisionKind: "final_profit",
      submittedByUserId: "finance-user"
    });
    await expect(service.confirmFinalProfit("chairman-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "5a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
      submissionId: submission.id
    })).resolves.toMatchObject({
      confirmationId: "confirmation-1",
      stageVersionId: "stage-5",
      finalProfitCents: "6000"
    });
    expect(tx.projectCloseDecisionSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        preparedByUserId: "finance-user",
        submittedByUserId: "finance-user",
        proposalSnapshot: { finalProfitCents: "6000" },
        prerequisiteStageVersionIds: ["stage-1", "stage-2", "stage-3", "stage-4"],
        basisSnapshot: submission.basisSnapshot
      })
    });
    expect(tx.projectCloseProfitConfirmation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        submissionId: submission.id,
        confirmedByUserId: "chairman-user",
        basisSnapshot: submission.basisSnapshot
      }),
      select: expect.any(Object)
    });
  });

  it("rejects a company distribution whose signed lines do not conserve final profit", async () => {
    const readAt = new Date("2026-09-18T10:00:00.000Z");
    const tx = distributionTx(readAt);
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const service = new ProjectCloseProfitService(
      prisma as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
      {
        effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
          new Map([["project-1", ["finance_director"]]])
        )
      } as never,
      { record: jest.fn() } as never
    );

    await expect(service.submitDistribution("finance-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "8a4526fd-d5a1-423e-b417-784759d2a7f2",
      basis: { summary: "确认公司分配", evidenceFileIds: [] },
      lines: [
        { projectParticipatingCompanyId: "participant-1", finalShareCents: "5999" }
      ]
    })).rejects.toThrow("公司分配合计必须精确等于最终盈亏");
    expect(tx.projectCloseDistribution.create).not.toHaveBeenCalled();
  });

  it.each([
    ["9223372036854775808", "-9223372036854769808"],
    ["-9223372036854775809", "9223372036854781809"]
  ])(
    "rejects an out-of-range company share before a conserving proposal can write (%s)",
    async (outOfRangeShare, balancingShare) => {
      const readAt = new Date("2026-09-18T10:01:00.000Z");
      const tx = distributionTx(readAt);
      const prisma = {
        $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
      };
      const audit = { record: jest.fn() };
      const service = new ProjectCloseProfitService(
        prisma as never,
        { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
        { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
          new Map([["project-1", ["finance_director"]]])
        ) } as never,
        audit as never
      );

      await expect(service.submitDistribution("finance-user", "project-1", {
        expectedProjectionFingerprint: "projection-fingerprint",
        idempotencyKey: "884526fd-d5a1-423e-b417-784759d2a7f2",
        basis: { summary: "确认公司分配", evidenceFileIds: [] },
        lines: [
          { projectParticipatingCompanyId: "participant-1", finalShareCents: outOfRangeShare },
          { projectParticipatingCompanyId: "participant-2", finalShareCents: balancingShare }
        ]
      })).rejects.toThrow("公司分配金额超出系统可保存范围");
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.projectCloseDecisionSubmission.create).not.toHaveBeenCalled();
      expect(tx.projectCloseCommandReceipt.create).not.toHaveBeenCalled();
      expect(tx.projectCloseStageVersion.create).not.toHaveBeenCalled();
      expect(tx.projectCloseDistribution.create).not.toHaveBeenCalled();
      expect(tx.projectCloseDistributionLine.createMany).not.toHaveBeenCalled();
      expect(tx.projectProfitDistributionAuthorization.createMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("rejects a final-profit submission bound to stale prerequisite stages", async () => {
    const readAt = new Date("2026-09-18T09:50:00.000Z");
    const tx = finalConfirmationTx(readAt);
    tx.projectCloseDecisionSubmission.findUnique.mockResolvedValue({
      id: "3a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
      projectId: "project-1",
      decisionKind: "final_profit",
      revision: 1,
      previousSubmissionId: null,
      prerequisiteStageVersionIds: ["stage-1", "stage-2", "stage-3", "stale-stage-4"],
      profitConfirmationId: null,
      profitStageVersionId: null,
      projectionReadAt: readAt,
      projectionCutoffAt: readAt,
      projectionFingerprint: "projection-fingerprint",
      amountSnapshot: {},
      stateSnapshot: {},
      participantsSnapshot: [],
      proposalSnapshot: { finalProfitCents: "6000" },
      basisSnapshot: { summary: "财务复核完成" },
      preparedByUserId: "finance-user",
      preparedAt: readAt,
      submittedByUserId: "finance-user",
      submittedAt: readAt
    });
    const service = new ProjectCloseProfitService(
      { $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) } as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
      { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["chairman"]]])
      ) } as never,
      { record: jest.fn() } as never
    );

    await expect(service.confirmFinalProfit("chairman-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "6a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
      submissionId: "3a648f91-5085-4dad-b6fb-d5b9aac5d9f7"
    })).rejects.toThrow("财务提交绑定的前置收口版本已过期");
    expect(tx.projectCloseProfitConfirmation.create).not.toHaveBeenCalled();
  });

  it("requires distribution lines for every company effective at the projection cutoff", async () => {
    const readAt = new Date("2026-09-18T10:05:00.000Z");
    const tx = distributionTx(readAt);
    tx.projectParticipatingCompany.findMany.mockResolvedValue([
      ...(await tx.projectParticipatingCompany.findMany()),
      {
        id: "participant-2",
        projectId: "project-1",
        companyEntityId: "company-2",
        companyEntityVersionId: "company-version-2",
        companyNameSnapshot: "乙公司",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        endedAt: null
      }
    ]);
    const service = new ProjectCloseProfitService(
      { $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) } as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
      { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["finance_director"]]])
      ) } as never,
      { record: jest.fn() } as never
    );

    await expect(service.submitDistribution("finance-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "9a4526fd-d5a1-423e-b417-784759d2a7f2",
      basis: { summary: "确认公司分配", evidenceFileIds: [] },
      lines: [{ projectParticipatingCompanyId: "participant-1", finalShareCents: "6000" }]
    })).rejects.toThrow("公司分配必须覆盖投影截止日全部有效参与公司");
    expect(tx.projectCloseDistribution.create).not.toHaveBeenCalled();
  });

  it("freezes pre-existing company funds separately from confirmed profit transfers", async () => {
    const readAt = new Date("2026-09-18T10:10:00.000Z");
    const tx = distributionTx(readAt);
    tx.projectCloseStageVersion.create.mockResolvedValue({
      id: "stage-6",
      stageKey: "profit_distribution_completed",
      revision: 1,
      status: "completed",
      confirmedAt: readAt
    });
    tx.projectCloseDistribution.create.mockResolvedValue({
      id: "distribution-1",
      revision: 1,
      confirmedAt: readAt
    });
    tx.projectProfitDistributionAuthorization.findMany.mockResolvedValue([{
      companyEntityId: "company-1",
      movements: [{ paymentAmountCents: 1000n }]
    }]);
    const lockedProjection = completeProjection(readAt);
    lockedProjection.projection.details = [{
      subjectKind: "participating_company",
      subjectId: "company-1",
      impactKind: "company_project_funds_increase",
      signedImpactCents: "2500"
    }];
    const service = new ProjectCloseProfitService(
      { $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) } as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(lockedProjection) } as never,
      { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["general_manager"]]])
      ) } as never,
      { record: jest.fn() } as never
    );

    await service.confirmDistribution("gm-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "0aa4526f-d5a1-423e-b417-784759d2a7f2",
      submissionId: "5a648f91-5085-4dad-b6fb-d5b9aac5d9f7"
    });

    expect(tx.projectCloseDistributionLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        existingFundsAppliedCents: 2500n,
        actualTransferCents: 1000n,
        toReceiveCents: 2500n,
        toReturnCents: 0n
      })]
    });
    expect(tx.projectProfitDistributionAuthorization.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ authorizedAmountCents: 2500n })]
    });
  });

  it("rejects a distribution submission bound to a stale profit confirmation", async () => {
    const readAt = new Date("2026-09-18T10:15:00.000Z");
    const tx = distributionTx(readAt);
    const submission = await tx.projectCloseDecisionSubmission.findUnique();
    tx.projectCloseDecisionSubmission.findUnique.mockResolvedValue({
      ...submission,
      profitConfirmationId: "stale-profit-confirmation"
    });
    const service = new ProjectCloseProfitService(
      { $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) } as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
      { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["general_manager"]]])
      ) } as never,
      { record: jest.fn() } as never
    );

    await expect(service.confirmDistribution("gm-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "1aa4526f-d5a1-423e-b417-784759d2a7f2",
      submissionId: "5a648f91-5085-4dad-b6fb-d5b9aac5d9f7"
    })).rejects.toThrow("财务提交绑定的最终盈亏版本已过期");
    expect(tx.projectCloseDistribution.create).not.toHaveBeenCalled();
  });

  it("calculates receive, return and loss bearing from confirmed transfers only", () => {
    expect(calculateDistributionSettlement(6000n, 1000n)).toEqual({
      toReceiveCents: 5000n,
      toReturnCents: 0n,
      additionalBearingCents: 0n
    });
    expect(calculateDistributionSettlement(6000n, 7000n)).toEqual({
      toReceiveCents: 0n,
      toReturnCents: 1000n,
      additionalBearingCents: 0n
    });
    expect(calculateDistributionSettlement(-5000n, 1000n)).toEqual({
      toReceiveCents: 0n,
      toReturnCents: 1000n,
      additionalBearingCents: 5000n
    });
  });

  it("applies only pre-existing positive company funds that are not already confirmed transfers", () => {
    expect(calculateExistingFundsApplied(6000n, 2500n, 1000n)).toBe(2500n);
    expect(calculateExistingFundsApplied(6000n, 500n, 1000n)).toBe(500n);
    expect(calculateExistingFundsApplied(6000n, 9000n, 7000n)).toBe(0n);
    expect(calculateExistingFundsApplied(-5000n, 3000n, 0n)).toBe(0n);
    expect(() => calculateExistingFundsApplied(6000n, 2500n, -1n))
      .toThrow("已确认实际资金转移金额无效");
  });

  it("fails closed on unknown impact kinds while allowing explicit notice-only kinds", () => {
    for (const kind of OPERATING_IMPACT_KINDS) {
      expect(() => resolveProjectCloseImpactPolicy(kind)).not.toThrow();
    }
    expect(
      resolveProjectCloseImpactPolicy("construction_enterprise_funds_freeze").affectedStages
    ).toEqual([
      "final_profit_confirmed",
      "profit_distribution_completed",
      "project_funds_cleared"
    ]);
    expect(
      resolveProjectCloseImpactPolicy("final_profit_distribution").affectedStages
    ).toEqual(["profit_distribution_completed", "project_funds_cleared"]);
    expect(resolveProjectCloseImpactPolicy("invoice_reference").affectedStages).toEqual([]);
    expect(() => resolveProjectCloseImpactPolicy("unknown_future_impact"))
      .toThrow("发现未知经营影响类型");
  });

  it("creates a temporary profit authorization from the locked distributable ceiling", async () => {
    const readAt = new Date("2026-09-18T10:30:00.000Z");
    const tx = temporaryDistributionTx(readAt);
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const ledger = { appendConfirmedSourceInTransaction: jest.fn().mockResolvedValue({}) };
    const service = new ProjectCloseProfitService(
      prisma as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
      { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["finance_director"]]])
      ) } as never,
      { record: jest.fn() } as never,
      ledger as never
    );

    await expect(service.createTemporaryDistribution("finance-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "16a4526f-d5a1-423e-b417-784759d2a7f2",
      basis: { summary: "经营现金允许暂分", evidenceFileIds: [] },
      projectParticipatingCompanyId: "participant-1",
      amountCents: "1000"
    })).resolves.toMatchObject({
      temporaryDistributionId: "temporary-1",
      profitAuthorizationId: "authorization-1",
      amountCents: "1000"
    });
    expect(tx.projectTemporaryProfitDistribution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountCents: 1000n,
        authorizationCeilingCents: 6000n,
        authorizedCumulativeCents: 1000n
      })
    });
    expect(ledger.appendConfirmedSourceInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        factKind: "profit_distribution",
        impacts: [expect.objectContaining({ impactKind: "temporary_profit_distribution" })]
      }),
      "finance-user"
    );
  });

  it("rejects a temporary distribution above the current projection ceiling", async () => {
    const readAt = new Date("2026-09-18T10:40:00.000Z");
    const tx = temporaryDistributionTx(readAt);
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const service = new ProjectCloseProfitService(
      prisma as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
      { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["finance_director"]]])
      ) } as never,
      { record: jest.fn() } as never,
      { appendConfirmedSourceInTransaction: jest.fn() } as never
    );
    await expect(service.createTemporaryDistribution("finance-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "26a4526f-d5a1-423e-b417-784759d2a7f2",
      basis: { summary: "超限暂分", evidenceFileIds: [] },
      projectParticipatingCompanyId: "participant-1",
      amountCents: "6001"
    })).rejects.toThrow("暂分金额超过当前可分配利润");
    expect(tx.projectTemporaryProfitDistribution.create).not.toHaveBeenCalled();
  });

  it("rejects a temporary distribution outside the PostgreSQL bigint range before any write", async () => {
    const readAt = new Date("2026-09-18T10:41:00.000Z");
    const tx = temporaryDistributionTx(readAt);
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx))
    };
    const audit = { record: jest.fn() };
    const ledger = { appendConfirmedSourceInTransaction: jest.fn() };
    const service = new ProjectCloseProfitService(
      prisma as never,
      { readProjectInTransaction: jest.fn().mockResolvedValue(completeProjection(readAt)) } as never,
      { effectiveRoleKeysByProjectInTransaction: jest.fn().mockResolvedValue(
        new Map([["project-1", ["finance_director"]]])
      ) } as never,
      audit as never,
      ledger as never
    );

    await expect(service.createTemporaryDistribution("finance-user", "project-1", {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "36a4526f-d5a1-423e-b417-784759d2a7f2",
      basis: { summary: "超范围暂分", evidenceFileIds: [] },
      projectParticipatingCompanyId: "participant-1",
      amountCents: "9223372036854775808"
    })).rejects.toThrow("暂分金额超出系统可保存范围");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.projectTemporaryProfitDistribution.create).not.toHaveBeenCalled();
    expect(tx.projectProfitDistributionAuthorization.create).not.toHaveBeenCalled();
    expect(tx.projectCloseCommandReceipt.create).not.toHaveBeenCalled();
    expect(tx.projectCloseStageVersion.create).not.toHaveBeenCalled();
    expect(ledger.appendConfirmedSourceInTransaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

function completeProjection(readAt: Date) {
  return {
    projection: {
      schema: "operating_projection/V1",
      integrity: { moneyComplete: true, notices: [] },
      commitments: {},
      operating: {
        confirmedIncomeCents: "10000",
        confirmedCostCents: "4000",
        payableCents: "0"
      },
      actualFunds: {
        nonNegativeUsableCashStartCents: "6000",
        companyAdvanceForProjectCents: "0"
      },
      restrictions: {
        estimatedClearingExpenseCents: "0",
        necessaryExpenseReserveCents: "0",
        projectDisputedFundsCents: "0",
        constructionEnterpriseFrozenFundsCents: "0",
        openUncoveredReconciliationCents: "0",
        relationshipCompleteness: "complete",
        temporaryProfitDistributionCents: "0"
      },
      profitAndLoss: {
        currentOperatingProfitCents: "6000",
        currentEstimatedProfitCents: "6000"
      },
      distribution: {
        cashCeilingCents: "6000",
        projectedProfitCeilingCents: "6000",
        currentDistributableProfitCents: "6000"
      },
      evidence: { C: { factCount: 0, amountCents: "0" }, gapFactCount: 0, gapAmountCents: "0" },
      sourceReferenceTotals: [],
      details: [] as Array<{
        subjectKind: string | null;
        subjectId: string | null;
        impactKind: string;
        signedImpactCents: string | null;
      }>
    },
    aggregate: {},
    readAt,
    cutoffAt: readAt,
    fingerprint: "projection-fingerprint"
  };
}

function finalConfirmationTx(_readAt: Date) {
  void _readAt;
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ projectId: "project-1" }]),
    projectCloseAggregate: {
      upsert: jest.fn(),
      update: jest.fn()
    },
    projectCloseCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn()
    },
    projectCloseStageVersion: {
      findMany: jest.fn().mockResolvedValue([
        "construction_completed",
        "owner_settlement_completed",
        "downstream_cost_confirmed",
        "tax_and_enterprise_clearing_completed"
      ].map((stageKey, index) => ({
        id: `stage-${index + 1}`,
        stageKey,
        revision: 1,
        status: "completed"
      }))),
      create: jest.fn()
    },
    projectParticipatingCompany: { findMany: jest.fn().mockResolvedValue([]) },
    projectCloseDecisionSubmission: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      create: jest.fn()
    },
    projectCloseProfitConfirmation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn()
    }
  };
}

function distributionTx(readAt: Date) {
  return {
    ...finalConfirmationTx(readAt),
    projectCloseStageVersion: {
      findMany: jest.fn().mockResolvedValue([
        "construction_completed",
        "owner_settlement_completed",
        "downstream_cost_confirmed",
        "tax_and_enterprise_clearing_completed",
        "final_profit_confirmed"
      ].map((stageKey, index) => ({
        id: `stage-${index + 1}`,
        stageKey,
        revision: 1,
        status: "completed"
      }))),
      create: jest.fn()
    },
    projectCloseProfitConfirmation: {
      findFirst: jest.fn().mockResolvedValue({
        id: "profit-confirmation-1",
        stageVersionId: "stage-5",
        revision: 1,
        finalProfitCents: 6000n,
        projectionFingerprint: "projection-fingerprint"
      })
    },
    projectCloseDecisionSubmission: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({
        id: "5a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
        projectId: "project-1",
        decisionKind: "distribution",
        revision: 1,
        previousSubmissionId: null,
        projectionReadAt: readAt,
        projectionCutoffAt: readAt,
        projectionFingerprint: "projection-fingerprint",
        prerequisiteStageVersionIds: [],
        profitConfirmationId: "profit-confirmation-1",
        profitStageVersionId: "stage-5",
        amountSnapshot: {},
        stateSnapshot: {},
        participantsSnapshot: [],
        proposalSnapshot: {
          totalProfitCents: "6000",
          lines: [{
            projectParticipatingCompanyId: "participant-1",
            finalShareCents: "6000"
          }]
        },
        basisSnapshot: { summary: "财务已提交", evidenceFileIds: [] },
        preparedByUserId: "finance-user",
        preparedAt: readAt,
        submittedByUserId: "finance-user",
        submittedAt: readAt
      }),
      create: jest.fn()
    },
    projectParticipatingCompany: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "participant-1",
          projectId: "project-1",
          companyEntityId: "company-1",
          companyEntityVersionId: "company-version-1",
          companyNameSnapshot: "甲公司",
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          endedAt: null
        }
      ])
    },
    projectCloseDistribution: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn()
    },
    projectCloseDistributionLine: { createMany: jest.fn() },
    projectProfitDistributionAuthorization: {
      createMany: jest.fn(),
      findMany: jest.fn().mockResolvedValue([])
    },
    projectTemporaryProfitDistribution: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

function temporaryDistributionTx(readAt: Date) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ projectId: "project-1" }]),
    projectCloseAggregate: { upsert: jest.fn(), update: jest.fn() },
    projectCloseCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn()
    },
    projectCloseStageVersion: {
      findMany: jest.fn().mockResolvedValue([
        "construction_completed",
        "owner_settlement_completed",
        "downstream_cost_confirmed",
        "tax_and_enterprise_clearing_completed"
      ].map((stageKey, index) => ({
        id: `stage-${index + 1}`,
        stageKey,
        revision: 1,
        status: "completed",
        projectionReadAt: readAt,
        projectionCutoffAt: readAt,
        projectionFingerprint: "projection-fingerprint",
        amountSnapshot: {},
        stateSnapshot: {},
        basisSnapshot: {},
        confirmedByUserId: "actor",
        confirmedAt: readAt
      }))),
      create: jest.fn()
    },
    projectParticipatingCompany: {
      findUnique: jest.fn().mockResolvedValue({
        id: "participant-1",
        projectId: "project-1",
        companyEntityId: "company-1",
        companyEntityVersionId: "company-version-1",
        companyNameSnapshot: "甲公司",
        companyCreditCodeSnapshot: "91310000TEST",
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        endedAt: null
      })
    },
    projectTemporaryProfitDistribution: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { amountCents: 0n },
        _max: { revision: null }
      }),
      create: jest.fn().mockResolvedValue({ id: "temporary-1" })
    },
    projectProfitDistributionAuthorization: {
      create: jest.fn().mockResolvedValue({ id: "authorization-1" })
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({
        isActive: true,
        operatingLedgerEffectiveDate: new Date("2026-01-01T00:00:00.000Z")
      })
    },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "affiliate-1",
        businessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业",
        affiliateCreditCodeSnapshot: "91310000AFFILIATE"
      })
    }
  };
}
