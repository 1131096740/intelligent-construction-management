import {
  classifyContractDraftLifecycle,
  lockContractDraftMutationBoundary,
  loadContractDraftLifecycle,
  type ContractDraftLifecycleFacts
} from "./contract-draft-lifecycle";

const pristineFacts: ContractDraftLifecycleFacts = {
  changeType: "original",
  versionNo: 1,
  status: "draft",
  firstSubmittedAt: null,
  approvalInstanceCount: 0,
  approvalActionCount: 0,
  formalFileCount: 0,
  signedFormalFileCount: 0,
  authorizationCount: 0,
  authorizationLinkCount: 0,
  sealTaskCount: 0,
  activeSealTaskCount: 0,
  archiveFileCount: 0,
  settlementCount: 0,
  paymentRequestCount: 0
};

describe("contract draft lifecycle classification", () => {
  it("offers physical draft deletion only when no permanent business evidence exists", () => {
    expect(classifyContractDraftLifecycle(pristineFacts)).toEqual({
      lifecycleKind: "pristine_draft",
      blockers: [],
      expectedAction: "delete_pristine_draft"
    });
  });

  it.each([
    ["approvalInstanceCount", "存在审批记录"],
    ["approvalActionCount", "存在审批记录"],
    ["formalFileCount", "存在正式合同文件"],
    ["authorizationCount", "存在授权委托书"],
    ["authorizationLinkCount", "存在授权委托书"],
    ["sealTaskCount", "存在用印记录"]
  ] as const)(
    "requires application abandonment when %s records business evidence",
    (field, blocker) => {
      expect(classifyContractDraftLifecycle({
        ...pristineFacts,
        [field]: 1
      })).toEqual({
        lifecycleKind: "approval_draft",
        blockers: [blocker],
        expectedAction: "abandon_application"
      });
    }
  );

  it.each([
    ["signedFormalFileCount", "存在正式合同文件"],
    ["activeSealTaskCount", "存在用印记录"],
    ["archiveFileCount", "存在归档记录"],
    ["settlementCount", "存在关联结算"],
    ["paymentRequestCount", "存在关联付款"]
  ] as const)(
    "exposes no draft-ending action when %s proves a formal business record",
    (field, blocker) => {
      expect(classifyContractDraftLifecycle({
        ...pristineFacts,
        [field]: 1
      })).toEqual({
        lifecycleKind: "formal_record",
        blockers: [blocker],
        expectedAction: null
      });
    }
  );

  it("never reclassifies a successfully submitted version as a pristine draft", () => {
    expect(classifyContractDraftLifecycle({
      ...pristineFacts,
      firstSubmittedAt: new Date("2026-07-30T01:00:00.000Z")
    })).toEqual({
      lifecycleKind: "approval_draft",
      blockers: ["合同曾进入审批"],
      expectedAction: "abandon_application"
    });
  });

  it("routes a historical takeover draft to its dedicated closure workflow", () => {
    expect(classifyContractDraftLifecycle({
      ...pristineFacts,
      changeType: "historical_takeover"
    })).toEqual({
      lifecycleKind: "approval_draft",
      blockers: ["历史接管须使用专用关闭流程"],
      expectedAction: null
    });
  });

  it.each([
    [{ changeType: "change", versionNo: 2 }, "合同变更或派生版本"],
    [{ status: "approval_rejected" }, "合同曾进入审批"]
  ])(
    "requires application abandonment for editable non-pristine version facts",
    (overrides, blocker) => {
      expect(classifyContractDraftLifecycle({
        ...pristineFacts,
        ...overrides
      })).toEqual({
        lifecycleKind: "approval_draft",
        blockers: [blocker],
        expectedAction: "abandon_application"
      });
    }
  );

  it("never exposes a draft-ending action for a formal status", () => {
    expect(classifyContractDraftLifecycle({
      ...pristineFacts,
      status: "effective"
    })).toEqual({
      lifecycleKind: "formal_record",
      blockers: ["合同曾进入审批"],
      expectedAction: null
    });
  });
});

describe("contract draft lifecycle fact loading", () => {
  function lifecycleClient() {
    return {
      approvalInstance: {
        findMany: jest.fn().mockResolvedValue([{ id: "approval-1" }])
      },
      approvalActionLog: {
        count: jest.fn().mockResolvedValue(1)
      },
      contractFormalFile: {
        findMany: jest.fn().mockResolvedValue([
          { purpose: "mutually_signed_final" }
        ])
      },
      contractAuthorization: {
        count: jest.fn().mockResolvedValue(1)
      },
      contractVersionAuthorizationLink: {
        count: jest.fn().mockResolvedValue(1)
      },
      contractSealTask: {
        findMany: jest.fn().mockResolvedValue([
          { status: "in_seal" }
        ])
      },
      contractArchiveFile: {
        count: jest.fn().mockResolvedValue(1)
      },
      settlement: {
        count: jest.fn().mockResolvedValue(1)
      },
      paymentRequest: {
        count: jest.fn().mockResolvedValue(1)
      }
    };
  }

  it("loads every permanent evidence source for the exact version in one fixed order", async () => {
    const client = lifecycleClient();

    const result = await loadContractDraftLifecycle(client as never, {
      id: "version-1",
      changeType: "original",
      versionNo: 1,
      status: "draft",
      firstSubmittedAt: null
    });

    expect(client.approvalInstance.findMany).toHaveBeenCalledWith({
      where: {
        businessType: "contract_version",
        businessId: "version-1"
      },
      orderBy: { createdAt: "asc" },
      select: { id: true }
    });
    expect(client.approvalActionLog.count).toHaveBeenCalledWith({
      where: { approvalInstanceId: { in: ["approval-1"] } }
    });
    expect(client.contractFormalFile.findMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1" },
      orderBy: { createdAt: "asc" },
      select: { purpose: true }
    });
    expect(client.contractAuthorization.count).toHaveBeenCalledWith({
      where: { originContractVersionId: "version-1" }
    });
    expect(client.contractVersionAuthorizationLink.count).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        authorizationId: { not: null }
      }
    });
    expect(client.contractSealTask.findMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1" },
      orderBy: { createdAt: "asc" },
      select: { status: true }
    });
    for (const model of [
      client.contractArchiveFile,
      client.settlement,
      client.paymentRequest
    ]) {
      expect(model.count).toHaveBeenCalledWith({
        where: { contractVersionId: "version-1" }
      });
    }
    const invocationOrder = [
      client.approvalInstance.findMany,
      client.approvalActionLog.count,
      client.contractFormalFile.findMany,
      client.contractAuthorization.count,
      client.contractVersionAuthorizationLink.count,
      client.contractSealTask.findMany,
      client.contractArchiveFile.count,
      client.settlement.count,
      client.paymentRequest.count
    ].map((mock) => mock.mock.invocationCallOrder[0]);
    expect(invocationOrder).toEqual([...invocationOrder].sort((a, b) => a - b));
    expect(result).toMatchObject({
      lifecycleKind: "formal_record",
      expectedAction: null,
      facts: {
        approvalInstanceCount: 1,
        approvalActionCount: 1,
        formalFileCount: 1,
        signedFormalFileCount: 1,
        authorizationCount: 1,
        authorizationLinkCount: 1,
        sealTaskCount: 1,
        activeSealTaskCount: 1,
        archiveFileCount: 1,
        settlementCount: 1,
        paymentRequestCount: 1
      }
    });
  });

  it("does not query approval action rows when no approval instance belongs to the version", async () => {
    const client = lifecycleClient();
    client.approvalInstance.findMany.mockResolvedValue([]);

    const result = await loadContractDraftLifecycle(client as never, {
      id: "version-1",
      changeType: "original",
      versionNo: 1,
      status: "draft",
      firstSubmittedAt: null
    });

    expect(client.approvalActionLog.count).not.toHaveBeenCalled();
    expect(result.facts.approvalActionCount).toBe(0);
  });

  it("treats cancelled seal history as soft evidence but every signed final as hard evidence", async () => {
    const client = lifecycleClient();
    client.approvalInstance.findMany.mockResolvedValue([]);
    client.contractFormalFile.findMany.mockResolvedValue([
      // Status is intentionally absent from the lifecycle projection: an
      // invalidated/superseded signed final remains irreversible evidence.
      { purpose: "mutually_signed_final" }
    ]);
    client.contractAuthorization.count.mockResolvedValue(0);
    client.contractVersionAuthorizationLink.count.mockResolvedValue(0);
    client.contractSealTask.findMany.mockResolvedValue([
      { status: "cancelled" }
    ]);
    client.contractArchiveFile.count.mockResolvedValue(0);
    client.settlement.count.mockResolvedValue(0);
    client.paymentRequest.count.mockResolvedValue(0);

    const result = await loadContractDraftLifecycle(client as never, {
      id: "version-1",
      changeType: "original",
      versionNo: 1,
      status: "draft",
      firstSubmittedAt: null
    });

    expect(result.facts).toMatchObject({
      signedFormalFileCount: 1,
      sealTaskCount: 1,
      activeSealTaskCount: 0
    });
    expect(result).toMatchObject({
      lifecycleKind: "formal_record",
      expectedAction: null
    });
  });
});

describe("contract draft mutation boundary", () => {
  it("rejects an exact historical takeover relation even when the version marker drifted", async () => {
    const client = {
      $queryRaw: jest.fn(async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            changeType: "original",
            hasHistoricalTakeoverRelation: true
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1" }];
        }
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      })
    };

    await expect(
      lockContractDraftMutationBoundary(client as never, "version-1")
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
        projectId: null,
        takeoverId: null
      }
    });
    expect(client.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("locks parent then version and returns every hard formal blocker", async () => {
    const queries: string[] = [];
    const client = {
      $queryRaw: jest.fn(async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        queries.push(sql);
        if (
          sql.includes('"ContractFormalFile"') &&
          !sql.includes("FOR UPDATE OF cv")
        ) {
          return [{
            hasSignedFormalFile: true,
            hasActiveSealTask: true,
            hasArchiveFile: true,
            hasSettlement: true,
            hasPaymentRequest: true
          }];
        }
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1"
          }];
        }
        return [{ id: "contract-1", contractId: "contract-1" }];
      })
    };

    await expect(
      lockContractDraftMutationBoundary(client as never, "version-1")
    ).resolves.toEqual({
      contractId: "contract-1",
      contract: expect.objectContaining({
        id: "contract-1"
      }),
      version: expect.objectContaining({
        id: "version-1",
        contractId: "contract-1"
      }),
      formalBlockers: [
        "存在双方签署正式文件",
        "存在有效用印任务",
        "存在归档记录",
        "存在关联结算",
        "存在关联付款"
      ]
    });
    expect(queries[0]).toContain("FOR UPDATE OF c");
    expect(queries[1]).toContain("FOR UPDATE OF cv");
    expect(queries[1]).toContain('FROM "ContractTakeover" takeover');
    expect(queries[1]).toContain(
      'takeover."contractVersionId" = cv."id"'
    );
    expect(queries[1]).not.toContain('"ContractFormalFile"');
    expect(queries[2]).toContain(`f."purpose" = 'mutually_signed_final'`);
    expect(queries[2]).not.toMatch(/ContractFormalFile[^]*f\."status"/u);
    expect(queries[2]).toContain(`s."status" <> 'cancelled'`);
  });

  it("returns null when the exact parent/version coordinate no longer exists", async () => {
    const client = { $queryRaw: jest.fn().mockResolvedValue([]) };

    await expect(
      lockContractDraftMutationBoundary(client as never, "missing")
    ).resolves.toBeNull();
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
