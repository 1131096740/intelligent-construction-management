import { ProjectService } from "./project.service";

const affiliate = {
  id: "assignment-1",
  businessPartyId: "party-1",
  businessPartyVersionId: "party-version-1",
  affiliateNameSnapshot: "挂靠建设集团",
  affiliateCreditCodeSnapshot: "91310000AFFILIATE",
  effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
};

function transactionPrisma(tx: object) {
  return {
    $transaction: jest.fn(async (callback: (client: object) => unknown) => callback(tx))
  };
}

describe("ProjectService upstream settlement external facts", () => {
  it("records a pending external fact with a frozen file digest and no approval instance", async () => {
    const createdAt = new Date("2026-07-28T01:00:00.000Z");
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([affiliate]) },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "file-1",
          uploadedByUserId: "budget-1",
          storageStatus: "active",
          contentSha256: "a".repeat(64)
        })
      },
      projectUpstreamSettlement: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: "upstream-1",
          ...data,
          confirmedByUserId: null,
          confirmedAt: null,
          confirmationSignatureVersionId: null,
          confirmationSignatureFileId: null,
          confirmationSignatureSha256: null,
          voidedAt: null,
          createdAt
        }))
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const auth = { confirmPassword: jest.fn() };
    const service = new ProjectService(
      transactionPrisma(tx) as never,
      undefined,
      auth as never
    );

    const result = await service.recordUpstreamSettlement(
      "project-1",
      "budget-1",
      {
        settledAt: "2026-07-28T00:00:00.000Z",
        reportedAmountCents: "10000",
        approvedAmountCents: "9000",
        approvingPartyName: "建设单位",
        periodLabel: "2026-07",
        voucherFileId: "file-1"
      } as never
    );

    expect(result).toMatchObject({
      id: "upstream-1",
      status: "pending_confirm",
      documentVersion: 1,
      fileContentSha256Snapshot: "a".repeat(64),
      confirmedByUserId: null,
      confirmedAt: null
    });
    expect(auth.confirmPassword).not.toHaveBeenCalled();
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "budget-1",
        action: "project.upstream_settlement.record",
        businessType: "project_upstream_settlement",
        businessId: "upstream-1",
        metadata: expect.objectContaining({
          documentVersion: 1,
          fileContentSha256Snapshot: "a".repeat(64),
          status: "pending_confirm"
        })
      })
    });
  });

  it("independently confirms with password and a frozen handwritten signature without approval", async () => {
    const confirmedAt = new Date("2026-07-28T02:00:00.000Z");
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "upstream-1" }])
        .mockResolvedValueOnce([{ id: "signature-user", isActive: true }])
        .mockResolvedValueOnce([
          {
            id: "signature-version-1",
            fileId: "signature-file-1",
            contentSha256: "b".repeat(64)
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "signature-file-1",
            contentSha256: "b".repeat(64),
            storageStatus: "active"
          }
        ]),
      projectUpstreamSettlement: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: "upstream-1",
          projectId: "project-1",
          settledAt: new Date("2026-07-28T00:00:00.000Z"),
          reportedAmountCents: 10000n,
          approvedAmountCents: 9000n,
          approvingPartyName: "建设单位",
          periodLabel: "2026-07",
          isFinal: false,
          status: "confirmed",
          documentVersion: 1,
          fileContentSha256Snapshot: "a".repeat(64),
          affiliateAssignmentId: "assignment-1",
          affiliateBusinessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          description: null,
          voucherFileId: "file-1",
          recordedByUserId: "budget-1",
          confirmedByUserId: "budget-1",
          confirmedAt,
          confirmationSignatureVersionId: "signature-version-1",
          confirmationSignatureFileId: "signature-file-1",
          confirmationSignatureSha256: "b".repeat(64),
          voidedAt: null,
          createdAt: new Date("2026-07-28T01:00:00.000Z")
        })
      },
      approvalInstance: { create: jest.fn() },
      auditLog: { create: jest.fn() }
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      transactionPrisma(tx) as never,
      undefined,
      auth as never
    ) as ProjectService & {
      confirmUpstreamSettlement(
        projectId: string,
        upstreamSettlementId: string,
        actorUserId: string,
        input: { confirmationPassword: string },
        now?: Date
      ): Promise<unknown>;
    };

    const result = await service.confirmUpstreamSettlement(
      "project-1",
      "upstream-1",
      "budget-1",
      { confirmationPassword: "current-password" },
      confirmedAt
    );

    expect(result).toMatchObject({
      status: "confirmed",
      confirmedByUserId: "budget-1",
      confirmationSignatureVersionId: "signature-version-1"
    });
    expect(auth.confirmPassword).toHaveBeenCalledWith("budget-1", "current-password");
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.projectUpstreamSettlement.updateMany).toHaveBeenCalledWith({
      where: {
        id: "upstream-1",
        projectId: "project-1",
        status: "pending_confirm",
        voidedAt: null
      },
      data: {
        status: "confirmed",
        confirmedByUserId: "budget-1",
        confirmedAt,
        confirmationSignatureVersionId: "signature-version-1",
        confirmationSignatureFileId: "signature-file-1",
        confirmationSignatureSha256: "b".repeat(64)
      }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "budget-1",
        action: "project.upstream_settlement.confirm",
        businessType: "project_upstream_settlement",
        businessId: "upstream-1",
        metadata: expect.objectContaining({
          documentVersion: 1,
          fileContentSha256Snapshot: "a".repeat(64),
          confirmationSignatureVersionId: "signature-version-1"
        })
      })
    });
  });
});
