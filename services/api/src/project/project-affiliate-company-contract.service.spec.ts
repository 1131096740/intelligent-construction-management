import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { ProjectAffiliateCompanyContractService } from "./project-affiliate-company-contract.service";

const SHA256 = "a".repeat(64);
const CONFIRMATION_ACTION_ID = "6dfbdece-803c-44c5-bf68-edbcf1529ce5";
const RECORD_INPUT = {
  contractReference: "GL-2026-001",
  contractName: "项目挂靠管理协议",
  signedAt: "2026-07-20",
  rightsObligationsSummary: "挂靠企业负责上游收款，我方按约承担项目管理义务。",
  companyEntityId: "company-1",
  fileId: "offline-contract-file-1",
  idempotencyKey: "a43073f9-9731-4d71-9498-b9727344dbd4"
};

function recordRequestFingerprint(
  projectId = "project-1",
  actorUserId = "contract-staff-1"
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        projectId,
        actorUserId,
        contractReference: RECORD_INPUT.contractReference,
        contractName: RECORD_INPUT.contractName,
        signedAt: "2026-07-20T00:00:00.000Z",
        rightsObligationsSummary: RECORD_INPUT.rightsObligationsSummary,
        companyEntityId: RECORD_INPUT.companyEntityId,
        fileId: RECORD_INPUT.fileId
      })
    )
    .digest("hex");
}

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

function roleTables(roleKey: string | readonly string[]) {
  const roleKeys = Array.isArray(roleKey) ? roleKey : [roleKey];
  return {
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest
        .fn()
        .mockResolvedValue(roleKeys.map((positionKey) => ({ positionKey })))
    },
    position: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

function recordHarness(
  roleKey: string | readonly string[] = "contract_staff",
  options: {
    replayAfterLock?: Record<string, unknown> | null;
    createError?: unknown;
    uniqueReplay?: Record<string, unknown> | null;
    lockedFile?: Record<string, unknown> | null;
  } = {}
) {
  const lockedFile =
    options.lockedFile === undefined
      ? {
          id: "offline-contract-file-1",
          uploadedByUserId: "contract-staff-1",
          storageStatus: "active",
          contentSha256: SHA256
        }
      : options.lockedFile;
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
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(options.replayAfterLock ?? null)
        .mockResolvedValue(null),
      create: options.createError
        ? jest.fn().mockRejectedValue(options.createError)
        : jest.fn().mockImplementation(async ({ data }) => pendingContract(data))
    },
    approvalInstance: { create: jest.fn() },
    contract: { create: jest.fn() },
    projectOwnerContract: { create: jest.fn() },
    projectUpstreamFundFact: { create: jest.fn() },
    paymentRequest: { create: jest.fn() },
    $queryRaw: jest.fn().mockImplementation(async (query: unknown) => {
      const text =
        typeof query === "object" &&
        query !== null &&
        "strings" in query &&
        Array.isArray(query.strings)
          ? query.strings.join(" ")
          : String(query);
      return text.includes('FROM "FileObject"') && text.includes("FOR UPDATE")
        ? lockedFile
          ? [lockedFile]
          : []
        : [];
    })
  };
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    ...roleTables(roleKey),
    projectAffiliateCompanyContract: {
      findUnique: jest.fn().mockResolvedValue(options.uniqueReplay ?? null)
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
    prisma,
    tx,
    audit,
    auth
  };
}

function rawQueryText(query: unknown) {
  return typeof query === "object" &&
    query !== null &&
    "strings" in query &&
    Array.isArray(query.strings)
    ? query.strings.join(" ")
    : String(query);
}

function confirmedContract(overrides: Record<string, unknown> = {}) {
  return pendingContract({
    status: "confirmed",
    confirmedByUserId: "contract-director-1",
    confirmedAt: new Date("2026-07-29T12:00:00.000Z"),
    confirmationActionId: CONFIRMATION_ACTION_ID,
    confirmationSignatureVersionId: "signature-version-1",
    confirmationSignatureFileId: "signature-file-1",
    confirmationSignatureSha256: "c".repeat(64),
    ...overrides
  });
}

function confirmHarness(
  options: {
    roleKey?: string;
    initialReplay?: Record<string, unknown> | null;
    replayAfterLock?: Record<string, unknown> | null;
    contract?: Record<string, unknown>;
    finalConfirmed?: Record<string, unknown>;
    updateCount?: number;
    updateError?: unknown;
    uniqueReplay?: Record<string, unknown> | null;
    passwordError?: Error;
    signatureRows?: Array<Record<string, unknown>>;
  } = {}
) {
  const contract = options.contract ?? pendingContract();
  const finalConfirmed = options.finalConfirmed ?? confirmedContract();
  const signatureRows = options.signatureRows ?? [
    {
      id: "signature-version-1",
      fileId: "signature-file-1",
      contentSha256: "c".repeat(64)
    }
  ];
  const tx = {
    project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
    ...roleTables(options.roleKey ?? "contract_director"),
    projectAffiliateCompanyContract: {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(options.initialReplay ?? null)
        .mockResolvedValueOnce(options.replayAfterLock ?? null)
        .mockResolvedValueOnce(finalConfirmed),
      findFirst: jest.fn().mockResolvedValue(contract),
      updateMany: options.updateError
        ? jest.fn().mockRejectedValue(options.updateError)
        : jest.fn().mockResolvedValue({ count: options.updateCount ?? 1 })
    },
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: contract.id }])
      .mockResolvedValueOnce([{ id: "contract-director-1", isActive: true }])
      .mockResolvedValueOnce(signatureRows)
      .mockResolvedValueOnce([
        {
          id: "signature-file-1",
          contentSha256: "c".repeat(64),
          storageStatus: "active"
        }
      ])
  };
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    projectAffiliateCompanyContract: {
      findUnique: jest.fn().mockResolvedValue(options.uniqueReplay ?? null)
    }
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  const auth = {
    confirmPassword: options.passwordError
      ? jest.fn().mockRejectedValue(options.passwordError)
      : jest.fn().mockResolvedValue(undefined)
  };
  return {
    service: new ProjectAffiliateCompanyContractService(
      prisma as never,
      audit as never,
      auth as never
    ),
    prisma,
    tx,
    audit,
    auth
  };
}

describe("ProjectAffiliateCompanyContractService", () => {
  it.each([
    [
      "contract_director",
      [],
      [["confirm"], []]
    ],
    [
      "contract_staff",
      ["record_affiliate_company_contract"],
      [[], []]
    ]
  ])(
    "derives list capabilities from role and pending status for %s",
    async (roleKey, expectedRootActions, expectedContractActions) => {
      const tx = {
        project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }) },
        ...roleTables(roleKey),
        projectAffiliateCompanyContract: {
          findMany: jest.fn().mockResolvedValue([
            pendingContract(),
            confirmedContract({
              id: "affiliate-company-contract-2",
              confirmationActionId:
                "f87f5eed-771e-44e1-9463-2612944fc2d1"
            })
          ])
        }
      };
      const prisma = {
        $transaction: jest.fn(
          async (work: (client: typeof tx) => unknown) => work(tx)
        )
      };
      const service = new ProjectAffiliateCompanyContractService(
        prisma as never
      );

      const result = await service.list("project-1", "actor-1");

      expect(result.availableActions).toEqual(expectedRootActions);
      expect(
        result.contracts.map((contract) => contract.availableActions)
      ).toEqual(expectedContractActions);
    }
  );

  it("records the already-signed contract with both subject snapshots and no company workflow", async () => {
    const { service, tx, audit } = recordHarness();

    const result = await service.record(
      "project-1",
      "contract-staff-1",
      RECORD_INPUT
    );

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

  it("takes the file-binding advisory lock before the company row and locked FileObject row", async () => {
    const { service, tx } = recordHarness();

    await service.record("project-1", "contract-staff-1", RECORD_INPUT);

    const queryTexts = tx.$queryRaw.mock.calls.map(([query]) =>
      rawQueryText(query)
    );
    expect(queryTexts[0]).toContain("pg_advisory_xact_lock");
    expect(queryTexts[1]).toContain('FROM "CompanyEntity"');
    expect(queryTexts[1]).toContain("FOR UPDATE");
    expect(queryTexts[2]).toContain('FROM "FileObject"');
    expect(queryTexts[2]).toContain("FOR UPDATE");
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(
      tx.projectAffiliateCompanyContract.findUnique.mock.invocationCallOrder[1]
    ).toBeLessThan(tx.companyEntity.findUnique.mock.invocationCallOrder[0]!);
  });

  it("validates active storage state and hash from the locked FileObject row", async () => {
    const { service, tx } = recordHarness("contract_staff", {
      lockedFile: {
        id: "offline-contract-file-1",
        uploadedByUserId: "contract-staff-1",
        storageStatus: "discarded",
        contentSha256: SHA256
      }
    });

    await expect(
      service.record("project-1", "contract-staff-1", RECORD_INPUT)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      tx.$queryRaw.mock.calls
        .map(([query]) => rawQueryText(query))
        .some(
          (text) =>
            text.includes('FROM "FileObject"') && text.includes("FOR UPDATE")
        )
    ).toBe(true);
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.projectAffiliateCompanyContract.create).not.toHaveBeenCalled();
  });

  it("replays a same-coordinate record immediately after waiting for the file-binding lock", async () => {
    const winner = pendingContract({
      requestFingerprint: recordRequestFingerprint()
    });
    const { service, tx, audit } = recordHarness("contract_staff", {
      replayAfterLock: winner
    });

    await expect(
      service.record("project-1", "contract-staff-1", RECORD_INPUT)
    ).resolves.toMatchObject({
      id: winner.id,
      projectId: "project-1",
      recordedByUserId: "contract-staff-1",
      requestFingerprint: winner.requestFingerprint
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(rawQueryText(tx.$queryRaw.mock.calls[0]?.[0])).toContain(
      "pg_advisory_xact_lock"
    );
    expect(tx.projectAffiliateCompanyContract.findUnique).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectAffiliateCompanyContract.findUnique.mock.invocationCallOrder[1]!
    );
    expect(tx.companyEntity.findUnique).not.toHaveBeenCalled();
    expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
    expect(tx.projectAffiliateCompanyContract.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["project", { projectId: "project-2" }],
    ["actor", { recordedByUserId: "contract-staff-2" }],
    ["fingerprint", { requestFingerprint: "c".repeat(64) }]
  ])(
    "rejects a same-key post-file-lock record replay for a different %s coordinate",
    async (_coordinate, winnerOverrides) => {
      const { service, tx, audit } = recordHarness("contract_staff", {
        replayAfterLock: pendingContract({
          requestFingerprint: recordRequestFingerprint(),
          ...winnerOverrides
        })
      });

      await expect(
        service.record("project-1", "contract-staff-1", RECORD_INPUT)
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(rawQueryText(tx.$queryRaw.mock.calls[0]?.[0])).toContain(
        "pg_advisory_xact_lock"
      );
      expect(tx.companyEntity.findUnique).not.toHaveBeenCalled();
      expect(tx.fileObject.findUnique).not.toHaveBeenCalled();
      expect(tx.projectAffiliateCompanyContract.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("replays the same-coordinate committed winner after a record unique race", async () => {
    const winner = pendingContract({
      requestFingerprint: recordRequestFingerprint()
    });
    const { service, prisma, tx, audit } = recordHarness("contract_staff", {
      createError: { code: "P2002" },
      uniqueReplay: winner
    });

    await expect(
      service.record("project-1", "contract-staff-1", RECORD_INPUT)
    ).resolves.toMatchObject({
      id: winner.id,
      projectId: "project-1",
      recordedByUserId: "contract-staff-1",
      requestFingerprint: winner.requestFingerprint
    });
    expect(prisma.projectAffiliateCompanyContract.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: RECORD_INPUT.idempotencyKey }
    });
    expect(tx.projectAffiliateCompanyContract.create).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("reloads actor roles for a record unique-race replay so dual-role capabilities stay identical", async () => {
    const winner = pendingContract({
      requestFingerprint: recordRequestFingerprint()
    });
    const { service, prisma } = recordHarness(
      ["contract_staff", "contract_director"],
      {
        createError: { code: "P2002" },
        uniqueReplay: winner
      }
    );

    await expect(
      service.record("project-1", "contract-staff-1", RECORD_INPUT)
    ).resolves.toMatchObject({
      id: winner.id,
      status: "pending_confirm",
      availableActions: ["confirm"]
    });
    expect(prisma.projectMember.findMany).toHaveBeenCalledWith({
      where: { userId: "contract-staff-1", projectId: "project-1" }
    });
  });

  it.each([
    ["project", { projectId: "project-2" }],
    ["actor", { recordedByUserId: "contract-staff-2" }],
    ["fingerprint", { requestFingerprint: "c".repeat(64) }]
  ])(
    "rejects a record unique-race winner with a different %s coordinate",
    async (_coordinate, winnerOverrides) => {
      const { service, tx, audit } = recordHarness("contract_staff", {
        createError: { code: "P2002" },
        uniqueReplay: pendingContract({
          requestFingerprint: recordRequestFingerprint(),
          ...winnerOverrides
        })
      });

      await expect(
        service.record("project-1", "contract-staff-1", RECORD_INPUT)
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.projectAffiliateCompanyContract.create).toHaveBeenCalledTimes(1);
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

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

  it("replays the committed result after a same-key retry waited for the target lock", async () => {
    const confirmedAt = new Date("2026-07-29T12:00:00.000Z");
    const confirmed = confirmedContract({ confirmedAt });
    const { service, tx, audit } = confirmHarness({
      replayAfterLock: confirmed,
      contract: confirmed
    });

    await expect(
      service.confirm(
        "project-1",
        confirmed.id,
        "contract-director-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: CONFIRMATION_ACTION_ID
        },
        confirmedAt
      )
    ).resolves.toMatchObject({
      id: confirmed.id,
      status: "confirmed",
      confirmedByUserId: "contract-director-1",
      confirmationActionId: CONFIRMATION_ACTION_ID
    });
    expect(tx.projectAffiliateCompanyContract.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.projectAffiliateCompanyContract.findUnique.mock
        .invocationCallOrder[1]!
    );
  });

  it("replays an already committed same-key confirmation before taking the target lock", async () => {
    const replay = confirmedContract();
    const { service, tx, audit, auth } = confirmHarness({
      initialReplay: replay
    });

    await expect(
      service.confirm(
        "project-1",
        "affiliate-company-contract-1",
        "contract-director-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: CONFIRMATION_ACTION_ID
        }
      )
    ).resolves.toMatchObject({
      id: "affiliate-company-contract-1",
      status: "confirmed",
      confirmationActionId: CONFIRMATION_ACTION_ID
    });
    expect(auth.confirmPassword).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.projectAffiliateCompanyContract.findFirst).not.toHaveBeenCalled();
    expect(tx.projectAffiliateCompanyContract.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["contract", { id: "affiliate-company-contract-2" }],
    ["project", { projectId: "project-2" }],
    ["actor", { confirmedByUserId: "contract-director-2" }]
  ])(
    "rejects a same-key post-lock replay for a different %s coordinate",
    async (_coordinate, replayOverrides) => {
      const { service, tx, audit } = confirmHarness({
        replayAfterLock: confirmedContract(replayOverrides)
      });

      await expect(
        service.confirm(
          "project-1",
          "affiliate-company-contract-1",
          "contract-director-1",
          {
            confirmationPassword: "current-password",
            confirmationActionId: CONFIRMATION_ACTION_ID
          }
        )
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.projectAffiliateCompanyContract.findFirst).not.toHaveBeenCalled();
      expect(tx.projectAffiliateCompanyContract.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("stops before the confirmation transaction when the current password is wrong", async () => {
    const { service, prisma, tx, audit } = confirmHarness({
      passwordError: new UnauthorizedException("当前登录密码不正确")
    });

    await expect(
      service.confirm(
        "project-1",
        "affiliate-company-contract-1",
        "contract-director-1",
        {
          confirmationPassword: "wrong-password",
          confirmationActionId: CONFIRMATION_ACTION_ID
        }
      )
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.projectAffiliateCompanyContract.findUnique).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.projectAffiliateCompanyContract.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("requires a frozen signature before changing a pending confirmation", async () => {
    const { service, tx, audit } = confirmHarness({ signatureRows: [] });

    await expect(
      service.confirm(
        "project-1",
        "affiliate-company-contract-1",
        "contract-director-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: CONFIRMATION_ACTION_ID
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.projectAffiliateCompanyContract.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a non-pending target when the action key is not a replay", async () => {
    const { service, tx, audit } = confirmHarness({
      contract: confirmedContract({
        confirmationActionId: "f87f5eed-771e-44e1-9463-2612944fc2d1"
      })
    });

    await expect(
      service.confirm(
        "project-1",
        "affiliate-company-contract-1",
        "contract-director-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: CONFIRMATION_ACTION_ID
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.projectAffiliateCompanyContract.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("fails closed when the pending-to-confirmed CAS loses the race", async () => {
    const { service, tx, audit } = confirmHarness({ updateCount: 0 });

    await expect(
      service.confirm(
        "project-1",
        "affiliate-company-contract-1",
        "contract-director-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: CONFIRMATION_ACTION_ID
        }
      )
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectAffiliateCompanyContract.updateMany).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("replays the committed winner after a confirmation-key unique race", async () => {
    const winner = confirmedContract();
    const { service, prisma, tx, audit } = confirmHarness({
      updateError: { code: "P2002" },
      uniqueReplay: winner
    });

    await expect(
      service.confirm(
        "project-1",
        "affiliate-company-contract-1",
        "contract-director-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: CONFIRMATION_ACTION_ID
        }
      )
    ).resolves.toMatchObject({
      id: "affiliate-company-contract-1",
      status: "confirmed",
      confirmationActionId: CONFIRMATION_ACTION_ID
    });
    expect(
      prisma.projectAffiliateCompanyContract.findUnique
    ).toHaveBeenCalledWith({
      where: { confirmationActionId: CONFIRMATION_ACTION_ID }
    });
    expect(tx.projectAffiliateCompanyContract.updateMany).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns a stable conflict when another contract wins the same confirmation key", async () => {
    const { service, tx, audit } = confirmHarness({
      updateError: { code: "P2002" },
      uniqueReplay: confirmedContract({
        id: "affiliate-company-contract-2"
      })
    });

    await expect(
      service.confirm(
        "project-1",
        "affiliate-company-contract-1",
        "contract-director-1",
        {
          confirmationPassword: "current-password",
          confirmationActionId: CONFIRMATION_ACTION_ID
        }
      )
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectAffiliateCompanyContract.updateMany).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalled();
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
