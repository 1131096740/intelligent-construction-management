import { ProjectService } from "./project.service";

describe("ProjectService affiliate payment subject", () => {
  it("rejects registering an affiliate payment against an our-company contract", async () => {
    const tx = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: "project-1" })
      },
      projectAffiliateAssignment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "assignment-1",
            businessPartyId: "party-1",
            businessPartyVersionId: "party-version-1",
            affiliateNameSnapshot: "挂靠建设集团",
            affiliateCreditCodeSnapshot: "91310000AFFILIATE",
            effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
          }
        ])
      },
      fileObject: {
        findUnique: jest.fn().mockResolvedValue({
          id: "voucher-1",
          uploadedByUserId: "finance-1"
        })
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue({ id: "contract-1" })
      },
      contractVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: "version-1",
          signingSubjectType: "our_company"
        })
      },
      projectProxyPayment: {
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const auth = {
      confirmPassword: jest.fn().mockResolvedValue(undefined)
    };
    const service = new ProjectService(prisma as never, undefined, auth as never);

    await expect(
      service.recordProxyPayment("project-1", "finance-1", {
        paidAt: "2026-07-28T00:00:00.000Z",
        amountCents: "10000",
        generalContractorName: "挂靠建设集团",
        paidTargetName: "供应商",
        paymentType: "material",
        voucherFileId: "voucher-1",
        confirmationPassword: "current-password",
        contractId: "contract-1"
      })
    ).rejects.toThrow("该合同冻结为我方签约，不能登记施工企业付款");

    expect(tx.projectProxyPayment.create).not.toHaveBeenCalled();
  });
});
