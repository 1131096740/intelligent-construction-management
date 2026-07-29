import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ProjectAffiliateCompanyContractService } from "./project-affiliate-company-contract.service";

const SHA256 = "a".repeat(64);

function pendingContract(overrides: Record<string, unknown> = {}) {
  return {
    id: "affiliate-company-contract-1",
    projectId: "project-1",
    contractReference: "GL-2026-001",
    contractName: "项目挂靠管理协议",
    signedAt: new Date("2026-07-20T00:00:00.000Z"),
    rightsObligationsSummary: "挂靠企业负责上游收款，我方按约承担项目管理义务。",
    affiliateAssignmentId: "assignment-1",
    affiliateBusinessPartyVersionId: "party-version-1",
    affiliateNameSnapshot: "挂靠建设集团",
    affiliateCreditCodeSnapshot: "91310000AFFILIATE",
    companyEntityId: "company-1",
    companyEntityVersionId: "company-version-2",
    companyEntityNameSnapshot: "我方建设有限公司",
    companyEntityCreditCodeSnapshot: "91350211M000100Y46",
    fileId: "offline-contract-file-1",
    documentVersion: 1,
    fileContentSha256Snapshot: SHA256,
    idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4",
    requestFingerprint: "b".repeat(64),
    recordedByUserId: "contract-staff-1",
    recordedByRoleKey: "contract_staff",
    status: "pending_confirm",
    confirmedByUserId: null,
    confirmedAt: null,
    confirmationActionId: null,
    confirmationSignatureVersionId: null,
    confirmationSignatureFileId: null,
    confirmationSignatureSha256: null,
    createdAt: new Date("2026-07-29T10:00:00.000Z"),
    updatedAt: new Date("2026-07-29T10:00:00.000Z"),
    ...overrides
  };
}

function roleTables(roleKey: string) {
  return {
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([{ positionKey: roleKey }])
    },
    position: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

function recordHarness(roleKey = "contract_staff") {
  const tx = {
    project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
    ...roleTables(roleKey),
    projectAffiliateAssignment: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "assignment-1",
          businessPartyId: "party-1",
          businessPartyVersionId: "party-version-1",
          affiliateNameSnapshot: "挂靠建设集团",
          affiliateCreditCodeSnapshot: "91310000AFFILIATE"
        }
      ])
    },
    companyEntity: {
      findUnique: jest.fn().mockResolvedValue({
        id: "company-1",
        currentVersionNo: 2,
        isActive: true,
        dataStatus: "complete"
      })
    },
    companyEntityVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "company-version-2",
        companyEntityId: "company-1",
        versionNo: 2,
        name: "我方建设有限公司",
        unifiedSocialCreditCode: "91350211M000100Y46",
        registeredAddress: "厦门市"
      })
    },
    fileObject: {
      findUnique: jest.fn().mockResolvedValue({
        id: "offline-contract-file-1",
        uploadedByUserId: "contract-staff-1",
        storageStatus: "active",
        contentSha256: SHA256
      })
    },
    projectAffiliateCompanyContract: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => pendingContract(data))
    },
    approvalInstance: { create: jest.fn() },
    contract: { create: jest.fn() },
    projectOwnerContract: { create: jest.fn() },
    projectUpstreamFundFact: { create: jest.fn() },
    paymentRequest: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([])
  };
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    projectAffiliateCompanyContract: {
      findUnique: jest.fn().mockResolvedValue(null)
    }
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  const auth = { confirmPassword: jest.fn() };
  return {
    service: new ProjectAffiliateCompanyContractService(
      prisma as never,
      audit as never,
      auth as never
    ),
    tx,
    audit,
    auth
  };
}

describe("ProjectAffiliateCompanyContractService", () => {
  it("records the already-signed contract with both subject snapshots and no company workflow", async () => {
    const { service, tx, audit } = recordHarness();

    const result = await service.record("project-1", "contract-staff-1", {
      contractReference: "GL-2026-001",
      contractName: "项目挂靠管理协议",
      signedAt: "2026-07-20",
      rightsObligationsSummary: "挂靠企业负责上游收款，我方按约承担项目管理义务。",
      companyEntityId: "company-1",
      fileId: "offline-contract-file-1",
      idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4"
    });

    expect(result).toMatchObject({
      status: "pending_confirm",
      affiliateNameSnapshot: "挂靠建设集团",
      companyEntityNameSnapshot: "我方建设有限公司",
      fileContentSha256Snapshot: SHA256,
      availableActions: []
    });
    expect(tx.approvalInstance.create).not.toHaveBeenCalled();
    expect(tx.contract.create).not.toHaveBeenCalled();
    expect(tx.projectOwnerContract.create).not.toHaveBeenCalled();
    expect(tx.projectUpstreamFundFact.create).not.toHaveBeenCalled();
    expect(tx.paymentRequest.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "project.affiliate_company_contract.record",
        metadata: expect.objectContaining({
          companyApprovalCreated: false,
          ownerReceiptCreated: false
        })
      })
    );
  });

  it("requires the signed contract file before opening a transaction", async () => {
    const { service } = recordHarness();

    await expect(
      service.record("project-1", "contract-staff-1", {
        contractReference: "GL-2026-001",
        contractName: "项目挂靠管理协议",
        signedAt: "2026-07-20",
        rightsObligationsSummary: "双方权利义务摘要",
        companyEntityId: "company-1",
        fileId: "",
        idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows only a contract director to confirm with password and frozen signature", async () => {
    const confirmedAt = new Date("2026-07-29T12:00:00.000Z");
    const fact = pendingContract();
    const tx = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
      ...roleTables("contract_director"),
      projectAffiliateCompanyContract: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(
            pendingContract({
              status: "confirmed",
              confirmedByUserId: "contract-director-1",
              confirmedAt,
              confirmationActionId: "6dfbdece-803c-44c5-bf68-edbcf1529ce5",
              confirmationSignatureVersionId: "signature-version-1",
              confirmationSignatureFileId: "signature-file-1",
              confirmationSignatureSha256: "c".repeat(64)
            })
          ),
        findFirst: jest.fn().mockResolvedValue(fact),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: fact.id }])
        .mockResolvedValueOnce([{ id: "contract-director-1", isActive: true }])
        .mockResolvedValueOnce([
          {
            id: "signature-version-1",
            fileId: "signature-file-1",
            contentSha256: "c".repeat(64)
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "signature-file-1",
            contentSha256: "c".repeat(64),
            storageStatus: "active"
          }
        ])
    };
    const prisma = {
      $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx))
    };
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new ProjectAffiliateCompanyContractService(
      prisma as never,
      audit as never,
      auth as never
    );

    await service.confirm(
      "project-1",
      fact.id,
      "contract-director-1",
      {
        confirmationPassword: "current-password",
        confirmationActionId: "6dfbdece-803c-44c5-bf68-edbcf1529ce5"
      },
      confirmedAt
    );

    expect(auth.confirmPassword).toHaveBeenCalledWith(
      "contract-director-1",
      "current-password"
    );
    expect(tx.projectAffiliateCompanyContract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "confirmed",
          confirmationSignatureVersionId: "signature-version-1",
          confirmationSignatureFileId: "signature-file-1"
        })
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "project.affiliate_company_contract.confirm",
        metadata: expect.objectContaining({
          companyApprovalCreated: false,
          ownerReceiptCreated: false
        })
      })
    );
  });

  it("rejects confirmation by contract staff", async () => {
    const { service } = recordHarness("contract_staff");

    await expect(
      service.confirm(
        "project-1",
        "affiliate-company-contract-1",
        "contract-staff-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: "6dfbdece-803c-44c5-bf68-edbcf1529ce5"
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
