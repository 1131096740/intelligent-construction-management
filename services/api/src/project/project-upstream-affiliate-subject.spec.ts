import { ProjectService } from "./project.service";

const affiliate = {
  id: "assignment-1",
  businessPartyId: "party-1",
  businessPartyVersionId: "party-version-5",
  affiliateNameSnapshot: "挂靠建设集团",
  affiliateCreditCodeSnapshot: "91310000AFFILIATE",
  effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
};

function projectTransaction(tx: object) {
  return {
    $transaction: jest.fn(async (callback: (client: object) => unknown) => callback(tx))
  };
}

describe("ProjectService upstream affiliate snapshots", () => {
  it("fails an upstream settlement before file or business writes when the mapping is missing", async () => {
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      fileObject: { findUnique: jest.fn() },
      projectUpstreamSettlement: { create: jest.fn() }
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      projectTransaction(tx) as never,
      undefined,
      auth as never
    );

    await expect(
      service.recordUpstreamSettlement("project-1", "budget-1", {
        settledAt: "2026-07-28T00:00:00.000Z",
        reportedAmountCents: "10000",
        approvedAmountCents: "9000",
        approvingPartyName: "建设单位",
        periodLabel: "2026-07",
        isFinal: false,
        voucherFileId: "file-1"
      })
    ).rejects.toThrow("项目尚未明确配置唯一挂靠企业");
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.projectUpstreamSettlement.create).not.toHaveBeenCalled();
  });

  it("freezes the current affiliate version into receipt and upstream-settlement facts", async () => {
    const createdAt = new Date("2026-07-28T01:00:00.000Z");
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      projectAffiliateAssignment: { findMany: jest.fn().mockResolvedValue([affiliate]) },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "finance-1" })
      },
      projectReceipt: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: "receipt-1",
          ...data,
          createdAt
        }))
      },
      auditLog: { create: jest.fn() }
    };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectService(
      projectTransaction(tx) as never,
      undefined,
      auth as never
    );

    await service.recordReceipt("project-1", "finance-1", {
      receivedAt: "2026-07-28T00:00:00.000Z",
      amountCents: "10000",
      payerName: "挂靠建设集团",
      sourceType: "general_contractor_payment",
      voucherFileId: "file-1",
      confirmationPassword: "current-password"
    });

    expect(tx.projectReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affiliateAssignmentId: "assignment-1",
        affiliateBusinessPartyVersionId: "party-version-5",
        affiliateNameSnapshot: "挂靠建设集团"
      })
    });
  });
});
