import { Prisma } from "@prisma/client";

import { ClearingReconciliationReaderService } from "./clearing-reconciliation-reader.service";

describe("ClearingReconciliationReaderService", () => {
  it("participates in the caller transaction and returns coverage-incomplete instead of zero", async () => {
    const tx = {
      clearingEventVersion: {
        findMany: jest.fn().mockResolvedValue([])
      },
      clearingReconciliationRevision: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "revision-1",
            itemId: "item-1",
            decisionEventVersionId: "pending-v1",
            adoptsLegacyPendingEventVersionId: null,
            revisionNo: 1,
            kind: "open",
            amountCents: 100n,
            replacesRevisionId: null,
            confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
            effectiveCaseRevision: 1
          }
        ])
      },
      clearingReconciliationCoverage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "coverage-1",
            reconciliationRevisionId: "revision-1",
            withheldEventVersionId: "withheld-v1",
            amountCents: 40n,
            confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
            effectiveCaseRevision: 1
          }
        ])
      },
      clearingReconciliationResolution: {
        findMany: jest.fn().mockResolvedValue([])
      },
      clearingReconciliationResolutionLine: {
        findMany: jest.fn().mockResolvedValue([])
      },
      clearingReconciliationDefinitionReversal: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const prisma = { $transaction: jest.fn() };
    const roles = { resolveActiveRoleScopesInTransaction: jest.fn() };
    const service = new ClearingReconciliationReaderService(
      prisma as never,
      roles as never
    );

    await expect(service.readClearingReconciliationRiskInTransaction(
      tx as never,
      {
        projectId: "project-1",
        asOf: new Date("2026-09-02T00:00:00.000Z")
      }
    )).resolves.toEqual(expect.objectContaining({
      projectId: "project-1",
      relationshipCompleteness: "coverage_incomplete",
      openPendingGrossCents: 100n,
      openCoveredCents: 40n,
      openUncoveredCents: 60n
    }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("opens one repeatable-read read-only transaction for the actor-facing reader", async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      clearingEventVersion: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationRevision: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationCoverage: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationResolution: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationResolutionLine: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationDefinitionReversal: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const prisma = {
      $transaction: jest.fn(async (work, options) => {
        expect(options).toEqual({
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead
        });
        return work(tx);
      })
    };
    const roles = {
      resolveActiveRoleScopesInTransaction: jest.fn().mockResolvedValue([
        "finance_staff"
      ])
    };
    const service = new ClearingReconciliationReaderService(
      prisma as never,
      roles as never
    );

    await service.readClearingReconciliationRiskForActor("finance-1", {
      projectId: "project-1",
      asOf: new Date("2026-09-02T00:00:00.000Z")
    });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(roles.resolveActiveRoleScopesInTransaction).toHaveBeenCalledWith(
      tx,
      "finance-1"
    );
  });

  it("fails closed when a confirmed new reconciliation kind lacks V1 intent or DecisionSeal", async () => {
    const tx = {
      clearingEventVersion: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{
            payloadSnapshot: {},
            reconciliationDecisionSeal: null
          }])
      },
      clearingReconciliationRevision: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationCoverage: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationResolution: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationResolutionLine: { findMany: jest.fn().mockResolvedValue([]) },
      clearingReconciliationDefinitionReversal: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new ClearingReconciliationReaderService(
      {} as never,
      {} as never
    );

    await expect(service.readClearingReconciliationRiskInTransaction(
      tx as never,
      {
        projectId: "project-1",
        asOf: new Date("2026-09-02T00:00:00.000Z")
      }
    )).resolves.toEqual({
      projectId: "project-1",
      asOf: "2026-09-02T00:00:00.000Z",
      relationshipCompleteness: "integrity_conflict",
      openPendingGrossCents: null,
      openCoveredCents: null,
      openUncoveredCents: null,
      continuedWithheldRetainedCents: null,
      coveredWithheldSources: [],
      items: []
    });
  });

  it("finds an active formal #275 duplicate by governed subject and canonical risk", async () => {
    const tx = {
      clearingCase: {
        findMany: jest.fn().mockResolvedValue([{
          id: "case-1",
          governedSubjectKey: "formal-basis-1",
          authorityVersionId: null,
          authoritySnapshotRef: null,
          sourceDiscriminator: null,
          events: []
        }])
      },
      affiliateClearingAuthorityVersion: { findMany: jest.fn() }
    };
    const service = new ClearingReconciliationReaderService(
      {} as never,
      {} as never
    );
    jest.spyOn(service, "readClearingReconciliationRiskInTransaction")
      .mockResolvedValueOnce({
        projectId: "project-1",
        asOf: "2026-09-11T00:00:00.000Z",
        relationshipCompleteness: "coverage_incomplete",
        openPendingGrossCents: 100n,
        openCoveredCents: 0n,
        openUncoveredCents: 100n,
        continuedWithheldRetainedCents: 0n,
        coveredWithheldSources: [],
        items: [{
          itemId: "item-1",
          currentRevisionId: "revision-1",
          openAmountCents: 100n,
          openCoveredCents: 0n,
          openUncoveredCents: 100n,
          status: "open"
        }]
      });

    await expect(service.readProjectFundDisputeDuplicateInTransaction(
      tx as never,
      {
        projectId: "project-1",
        constructionEnterpriseAssignmentId: "assignment-1",
        basisBusinessIdOrEvidenceSha256: "formal-basis-1",
        evidenceSha256: "a".repeat(64)
      }
    )).resolves.toBe("active");
    expect(service.readClearingReconciliationRiskInTransaction)
      .toHaveBeenCalledWith(tx, {
        projectId: "project-1",
        clearingCaseIds: ["case-1"]
      });
  });
});
