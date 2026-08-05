import {
  classifyContractDraftLifecycle,
  lockContractDraftMutationBoundary,
  loadContractDraftLifecycle,
  projectContractDraftLifecycleViews,
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
  activeSignedFormalFileCount: 0,
  authorizationCount: 0,
  authorizationLinkCount: 0,
  sealTaskCount: 0,
  activeSealTaskCount: 0,
  archiveFileCount: 0,
  settlementCount: 0,
  paymentRequestCount: 0
};

describe("contract draft lifecycle classification", () => {
  it("classifies a never-submitted draft and projects every lifecycle capability", () => {
    expect(classifyContractDraftLifecycle(pristineFacts)).toMatchObject({
      contractLifecycleStage: "unsubmitted_draft",
      lifecycleKind: "pristine_draft",
      blockers: [],
      expectedAction: "delete_pristine_draft",
      capabilities: {
        canView: true,
        canEdit: true,
        canSubmit: true,
        canAbandon: false,
        canPhysicallyDelete: true,
        canDownload: true,
        historyRetention: "none"
      }
    });
  });

  it.each([
    ["formalFileCount"],
    ["signedFormalFileCount"],
    ["authorizationCount"],
    ["authorizationLinkCount"],
    ["sealTaskCount"]
  ] as const)(
    "does not invent a physical-deletion blocker from unsubmitted draft content in %s",
    (field) => {
      expect(classifyContractDraftLifecycle({
        ...pristineFacts,
        [field]: 1
      })).toMatchObject({
        contractLifecycleStage: "unsubmitted_draft",
        lifecycleKind: "pristine_draft",
        blockers: [],
        expectedAction: "delete_pristine_draft",
        capabilities: expect.objectContaining({
          canEdit: true,
          canPhysicallyDelete: true
        })
      });
    }
  );

  it.each([
    ["activeSignedFormalFileCount", "存在正式合同文件"],
    ["activeSealTaskCount", "存在用印记录"],
    ["archiveFileCount", "存在归档记录"],
    ["settlementCount", "存在关联结算"],
    ["paymentRequestCount", "存在关联付款"]
  ] as const)(
    "permanently protects a version when %s proves formal business use",
    (field, blocker) => {
      expect(classifyContractDraftLifecycle({
        ...pristineFacts,
        [field]: 1
      })).toMatchObject({
        contractLifecycleStage: "protected_formal",
        lifecycleKind: "formal_record",
        blockers: [blocker],
        expectedAction: null,
        capabilities: expect.objectContaining({
          canEdit: false,
          canPhysicallyDelete: false,
          historyRetention: "permanent"
        })
      });
    }
  );

  it.each([
    { firstSubmittedAt: new Date("2026-07-30T01:00:00.000Z") },
    { approvalInstanceCount: 1 },
    { approvalActionCount: 1 },
  ] as const)("classifies returned or withdrawn applications as editable", (overrides) => {
    expect(classifyContractDraftLifecycle({
      ...pristineFacts,
      ...overrides
    })).toMatchObject({
      contractLifecycleStage: "returned_editable",
      lifecycleKind: "approval_draft",
      expectedAction: "abandon_application",
      capabilities: {
        canView: true,
        canEdit: true,
        canSubmit: true,
        canAbandon: true,
        canPhysicallyDelete: false,
        canDownload: true,
        historyRetention: "none"
      }
    });
  });

  it("classifies a final approval rejection as an ended retained record", () => {
    expect(classifyContractDraftLifecycle({
      ...pristineFacts,
      status: "approval_rejected",
      firstSubmittedAt: new Date("2026-07-30T01:00:00.000Z")
    })).toMatchObject({
      contractLifecycleStage: "ended_retained",
      lifecycleKind: "approval_draft",
      expectedAction: null,
      capabilities: {
        canView: true,
        canEdit: false,
        canSubmit: false,
        canAbandon: false,
        canPhysicallyDelete: false,
        canDownload: true,
        historyRetention: "three_calendar_months"
      }
    });
  });

  it.each(["approval_rejected", "abandoned"] as const)(
    "fails closed when %s has no approval evidence",
    (status) => {
      expect(() => classifyContractDraftLifecycle({
        ...pristineFacts,
        status
      })).toThrow(expect.objectContaining({
        response: expect.objectContaining({
          statusCode: 409,
          code: "CONTRACT_LIFECYCLE_INVARIANT_VIOLATION"
        })
      }));
    }
  );

  it.each(["abandoned"] as const)(
    "classifies %s as an ended record retained for three calendar months",
    (status) => {
      expect(classifyContractDraftLifecycle({
        ...pristineFacts,
        status,
        firstSubmittedAt: new Date("2026-07-30T01:00:00.000Z")
      })).toMatchObject({
        contractLifecycleStage: "ended_retained",
        lifecycleKind: "approval_draft",
        expectedAction: null,
        capabilities: {
          canView: true,
          canEdit: false,
          canSubmit: false,
          canAbandon: false,
          canPhysicallyDelete: false,
          canDownload: true,
          historyRetention: "three_calendar_months"
        }
      });
    }
  );

  it("classifies an eligible cleanup transition as deleting and locks every action", () => {
    expect(classifyContractDraftLifecycle({
      ...pristineFacts,
      status: "deleting"
    })).toMatchObject({
      contractLifecycleStage: "deleting",
      lifecycleKind: "pristine_draft",
      expectedAction: null,
      capabilities: {
        canView: false,
        canEdit: false,
        canSubmit: false,
        canAbandon: false,
        canPhysicallyDelete: false,
        canDownload: false,
        historyRetention: "none"
      }
    });
  });

  it("projects an abandoned version into the retained-ended ledger view", () => {
    const classification = classifyContractDraftLifecycle({
      ...pristineFacts,
      status: "abandoned",
      firstSubmittedAt: new Date("2026-07-30T01:00:00.000Z")
    });
    const version = {
      id: "version-abandoned",
      status: "abandoned",
      changeType: "original"
    };

    const views = projectContractDraftLifecycleViews(
      { ownerUserId: "owner-1", voidedAt: null },
      [version],
      new Map([[version.id, classification]]),
      "owner-1"
    );

    expect(views.matches).toMatchObject({
      formal_ledger: false,
      my_drafts: false,
      returned_for_revision: false,
      ended: true
    });
    expect(views.versionByView.ended).toBe(version);
  });

  it("keeps a voided contract root in only the ended view", () => {
    const classification = classifyContractDraftLifecycle(pristineFacts);
    const version = {
      id: "version-voided-root",
      status: "draft",
      changeType: "original"
    };

    const views = projectContractDraftLifecycleViews(
      { ownerUserId: "owner-1", voidedAt: new Date("2026-07-30T01:00:00.000Z") },
      [version],
      new Map([[version.id, classification]]),
      "owner-1"
    );

    expect(views.matches).toEqual({
      formal_ledger: false,
      my_drafts: false,
      returned_for_revision: false,
      ended: true
    });
    expect(views.versionByView.ended).toBe(version);
  });

  it("recognizes a legacy never-submitted delete as an isolated cleanup candidate", () => {
    expect(classifyContractDraftLifecycle({
      ...pristineFacts,
      status: "abandoned",
      abandonedAt: new Date("2026-07-30T01:00:00.000Z"),
      abandonedByUserId: "owner-1",
      abandonReason: null
    })).toMatchObject({
      contractLifecycleStage: "deleting",
      lifecycleKind: "pristine_draft",
      expectedAction: null,
      capabilities: expect.objectContaining({
        canView: false,
        canEdit: false,
        canPhysicallyDelete: false
      })
    });
  });

  it.each([
    { firstSubmittedAt: new Date("2026-07-30T01:00:00.000Z") },
    { approvalInstanceCount: 1 },
    { activeSignedFormalFileCount: 1 },
    { archiveFileCount: 1 },
    { changeType: "change", versionNo: 2 }
  ])("fails every ineligible deleting combination with one stable conflict code", (overrides) => {
    expect(() => classifyContractDraftLifecycle({
      ...pristineFacts,
      status: "deleting",
      ...overrides
    })).toThrow(expect.objectContaining({
      response: expect.objectContaining({
        statusCode: 409,
        code: "CONTRACT_LIFECYCLE_INVARIANT_VIOLATION"
      })
    }));
  });

  it("keeps historical takeover records on their dedicated protected workflow", () => {
    expect(classifyContractDraftLifecycle({
      ...pristineFacts,
      changeType: "historical_takeover"
    })).toMatchObject({
      contractLifecycleStage: "protected_formal",
      lifecycleKind: "formal_record",
      blockers: ["历史接管须使用专用关闭流程"],
      expectedAction: null,
      capabilities: expect.objectContaining({
        canEdit: false,
        canPhysicallyDelete: false
      })
    });
  });

  it.each(["in_approval", "approved_pending_seal", "pending_archive_confirm"] as const)(
    "protects active formal-process status %s without claiming permanent retention",
    (status) => {
      expect(classifyContractDraftLifecycle({
        ...pristineFacts,
        status,
        firstSubmittedAt: new Date("2026-07-30T01:00:00.000Z")
      })).toMatchObject({
        contractLifecycleStage: "protected_formal",
        expectedAction: null,
        capabilities: expect.objectContaining({
          canEdit: false,
          canPhysicallyDelete: false,
          historyRetention: "active_process"
        })
      });
    }
  );

  it("permanently protects an effective version", () => {
    expect(classifyContractDraftLifecycle({
      ...pristineFacts,
      status: "effective"
    })).toMatchObject({
      contractLifecycleStage: "protected_formal",
      lifecycleKind: "formal_record",
      blockers: ["合同曾进入审批"],
      expectedAction: null,
      capabilities: expect.objectContaining({
        historyRetention: "permanent",
        canDownload: true
      })
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
          { purpose: "mutually_signed_final", status: "active" }
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
      select: { purpose: true, status: true }
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
        activeSignedFormalFileCount: 1,
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

  it("keeps invalidated files as facts without blocking an unsubmitted draft", async () => {
    const client = lifecycleClient();
    client.approvalInstance.findMany.mockResolvedValue([]);
    client.contractFormalFile.findMany.mockResolvedValue([
      { purpose: "mutually_signed_final", status: "invalidated" }
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
      activeSignedFormalFileCount: 0,
      sealTaskCount: 1,
      activeSealTaskCount: 0
    });
    expect(result).toMatchObject({
      contractLifecycleStage: "unsubmitted_draft",
      lifecycleKind: "pristine_draft",
      blockers: [],
      expectedAction: "delete_pristine_draft"
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
    expect(queries[2]).toContain(`f."status" = 'active'`);
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
