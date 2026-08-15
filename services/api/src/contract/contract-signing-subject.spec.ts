import { ContractService } from "./contract.service";

function draftHarness(assignments: object[]) {
  const tx = {
    $queryRaw: jest.fn(async (query: { strings?: string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes('FROM "Project"')) {
        return [{ id: "project-1", isActive: true }];
      }
      if (sql.includes('FROM "ContractBusinessTemplateVersion"')) {
        return [{
          id: "template-version-1",
          templateId: "template-1",
          status: "published",
          fieldSchema: [],
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: [],
          supplementChangePolicy: null
        }];
      }
      if (sql.includes('FROM "ContractBusinessTemplate"')) {
        return [{ id: "template-1", contractTypeKey: "material_purchase" }];
      }
      return [];
    }),
    contractBusinessTemplateVersion: {
      findUnique: jest.fn().mockResolvedValue({ templateId: "template-1" })
    },
    projectAffiliateAssignment: {
      findMany: jest.fn().mockResolvedValue(assignments)
    },
    contract: {
      create: jest.fn().mockResolvedValue({ id: "contract-1" })
    },
    contractVersion: {
      create: jest.fn().mockResolvedValue({
        id: "version-1",
        status: "draft",
        amountCents: 0n
      })
    },
    contractBill: { createMany: jest.fn() },
    paymentTermsVersion: {
      create: jest.fn().mockResolvedValue({ id: "terms-1" })
    },
    paymentTermsStage: { createMany: jest.fn() },
    auditLog: { create: jest.fn() }
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
  };
  return { tx, service: new ContractService(prisma as never) };
}

describe("ContractService signing subject snapshots", () => {
  it("freezes the current affiliate assignment into an affiliate-signed draft", async () => {
    const { tx, service } = draftHarness([
      {
        id: "assignment-1",
        businessPartyId: "party-1",
        businessPartyVersionId: "party-version-2",
        affiliateNameSnapshot: "挂靠建设集团",
        affiliateCreditCodeSnapshot: "91310000AFFILIATE",
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
      }
    ]);

    await service.createDraft({
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      businessTemplateVersionId: "template-version-1",
      signingSubjectType: "affiliate"
    } as never, "contract-staff-1");

    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signingSubjectType: "affiliate",
        affiliateAssignmentId: "assignment-1",
        affiliateBusinessPartyVersionId: "party-version-2",
        affiliateNameSnapshot: "挂靠建设集团",
        affiliateCreditCodeSnapshot: "91310000AFFILIATE"
      })
    });
  });

  it("fails before creating an affiliate-signed draft when no mapping exists", async () => {
    const { tx, service } = draftHarness([]);

    await expect(
      service.createDraft({
        projectId: "project-1",
        contractTypeKey: "material_purchase",
        businessTemplateVersionId: "template-version-1",
        signingSubjectType: "affiliate"
      } as never, "contract-staff-1")
    ).rejects.toThrow("项目尚未明确配置唯一施工企业");
    expect(tx.contract.create).not.toHaveBeenCalled();
    expect(tx.contractVersion.create).not.toHaveBeenCalled();
  });

  it("freezes the normal workbench default as our-company without reading a name-based mapping", async () => {
    const { tx, service } = draftHarness([]);

    await service.createDraft({
      projectId: "project-1",
      contractTypeKey: "material_purchase",
      businessTemplateVersionId: "template-version-1"
    }, "contract-staff-1");

    expect(tx.projectAffiliateAssignment.findMany).not.toHaveBeenCalled();
    expect(tx.contractVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        signingSubjectType: "our_company",
        affiliateAssignmentId: null,
        affiliateBusinessPartyVersionId: null,
        affiliateNameSnapshot: null,
        affiliateCreditCodeSnapshot: null
      })
    });
  });
});
