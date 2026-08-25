import { PrismaService } from "../database/prisma.service";
import { BusinessPartyService } from "./business-party.service";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { BusinessEntryCreateTargetService } from "../business-entry-definition/business-entry-create-target.service";

describe("BusinessPartyService", () => {
  const audit = { record: jest.fn() };

  beforeEach(() => {
    audit.record.mockReset();
  });

  function globalRole(roleKey: "contract_staff" | "contract_director" = "contract_staff") {
    return {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ id: "position-1", key: roleKey }])
      }
    };
  }

  function contractPartyBoundaryQuery(
    hardFormal: Partial<Record<
      | "hasSignedFormalFile"
      | "hasActiveSealTask"
      | "hasArchiveFile"
      | "hasSettlement"
      | "hasPaymentRequest",
      boolean
    >> = {},
    hasHistoricalTakeoverRelation = false
  ) {
    return jest.fn().mockImplementation(async (query: { strings?: string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes('FROM "Contract" c')) {
        return [{ id: "contract-1", contractId: "contract-1" }];
      }
      if (sql.includes("FOR UPDATE OF cv")) {
        return [{
          id: "contract-version-1",
          contractId: "contract-1",
          hasHistoricalTakeoverRelation
        }];
      }
      return [{
        hasSignedFormalFile: false,
        hasActiveSealTask: false,
        hasArchiveFile: false,
        hasSettlement: false,
        hasPaymentRequest: false,
        ...hardFormal
      }];
    });
  }

  function expectContractPartyBoundaryLockOrder(query: jest.Mock) {
    const statements = query.mock.calls
      .slice(0, 3)
      .map(([sql]) => (sql?.strings as string[] | undefined)?.join(" ") ?? "");
    expect(statements[0]).toContain('FROM "Contract" c');
    expect(statements[0]).toContain("FOR UPDATE OF c");
    expect(statements[1]).toContain('FROM "ContractVersion" cv');
    expect(statements[1]).toContain("FOR UPDATE OF cv");
    expect(statements[2]).toContain('FROM "ContractFormalFile"');
  }

  function prismaWithTransaction<T extends object>(tx: T) {
    const client = tx as T & {
      $queryRaw?: jest.Mock;
      userPosition?: { findMany: jest.Mock };
      position?: { findMany: jest.Mock };
      businessPartyCreateIdempotency?: {
        findUnique: jest.Mock;
        create: jest.Mock;
      };
      contractVersion?: { updateMany?: jest.Mock };
      contract?: { updateMany?: jest.Mock };
      contractGeneratedDocument?: { updateMany: jest.Mock };
    };
    if (client.contractVersion && !client.$queryRaw) {
      client.$queryRaw = contractPartyBoundaryQuery();
    }
    if (client.contractVersion && !client.contractVersion.updateMany) {
      client.contractVersion.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    }
    if (client.contract && !client.contract.updateMany) {
      client.contract.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    }
    client.contractGeneratedDocument ??= {
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    };
    return {
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      userPosition: client.userPosition,
      position: client.position,
      businessPartyCreateIdempotency: client.businessPartyCreateIdempotency,
      $transaction: jest.fn(async (callback: (client: T) => unknown) => callback(tx))
    } as unknown as PrismaService;
  }

  function guardedContractPartyTx(
    changeType: string,
    hardFormal: Parameters<typeof contractPartyBoundaryQuery>[0] = {},
    hasHistoricalTakeoverRelation = false
  ) {
    return {
      $queryRaw: contractPartyBoundaryQuery(
        hardFormal,
        hasHistoricalTakeoverRelation
      ),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft",
          changeType,
          draftRevision: 4
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractPartySnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: "snapshot-1",
          roleKey: "party_b",
          displayOrder: 1
        }),
        create: jest.fn().mockResolvedValue({ id: "snapshot-new" }),
        update: jest.fn().mockResolvedValue({ id: "snapshot-1" }),
        delete: jest.fn().mockResolvedValue({ id: "snapshot-1" })
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
  }

  function mutateContractParty(
    service: BusinessPartyService,
    action: "add" | "updateRole" | "remove"
  ) {
    if (action === "add") {
      return service.addContractParty("contract-version-1", "owner-1", {
        roleKey: "other",
        snapshot: { name: "临时单位", attachments: [] }
      });
    }
    if (action === "updateRole") {
      return service.updateContractPartyRole(
        "contract-version-1",
        "snapshot-1",
        "owner-1",
        "party_b"
      );
    }
    return service.removeContractParty(
      "contract-version-1",
      "snapshot-1",
      "owner-1"
    );
  }

  const snapshot = {
    name: "  华东建设有限公司  ",
    unifiedSocialCreditCode: " 91350211m000100y46 ",
    legalRepresentative: "张三",
    address: "上海市",
    contactName: "李四",
    contactPhone: "13800000000",
    attachments: [
      {
        category: "qualification" as const,
        fileId: "file-qualification-1",
        name: "建筑业企业资质证书",
        validUntil: "2027-12-31"
      }
    ]
  };

  it("creates version 1 and normalizes unified social credit code", async () => {
    const tx = {
      ...globalRole(),
      businessParty: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "party-1",
          name: "华东建设有限公司",
          unifiedSocialCreditCode: "91350211M000100Y46"
        })
      },
      businessPartyVersion: {
        create: jest.fn().mockResolvedValue({ id: "party-version-1", versionNo: 1 })
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    const result = await service.createParty("staff-1", snapshot);

    expect(result.version.versionNo).toBe(1);
    expect(tx.businessParty.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "华东建设有限公司",
        unifiedSocialCreditCode: "91350211M000100Y46",
        createdByUserId: "staff-1"
      })
    });
    expect(tx.businessPartyVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessPartyId: "party-1",
        versionNo: 1,
        snapshot: expect.objectContaining({
          unifiedSocialCreditCode: "91350211M000100Y46"
        })
      })
    });
  });

  it("requires a bound create intent and records the idempotent creation fact atomically", async () => {
    const idempotencyKey = "11111111-1111-4111-8111-111111111111";
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({
        attachments: [],
        name: "受控单位",
        type: "organization",
        unifiedSocialCreditCode: "91350211M000100Y46"
      }))
      .digest("hex");
    const tx = {
      ...globalRole(),
      businessParty: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "party-intent-1",
          name: "受控单位",
          normalizedName: "受控单位",
          unifiedSocialCreditCode: "91350211M000100Y46"
        })
      },
      businessPartyVersion: {
        create: jest.fn().mockResolvedValue({ id: "party-intent-version-1", versionNo: 1 })
      },
      businessPartyCreateIdempotency: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ idempotencyKey })
      }
    };
    const prisma = prismaWithTransaction(tx);
    const service = new BusinessPartyService(prisma, audit as never);
    const targetService = new BusinessEntryCreateTargetService();
    const target = targetService.issue({
      actorUserId: "staff-1",
      action: "business_party.create",
      scene: "business_party",
      entityType: "business_party",
      scope: "global",
      definitionKey: "business_party",
      definitionVersion: 1,
      idempotencyKey,
      fingerprint,
      purpose: "submission"
    });

    const result = await service.createPartyWithIntent("staff-1", {
      target: { entityType: "business_party", createTarget: target.createTarget },
      definitionKey: "business_party",
      definitionVersion: 1,
      idempotencyKey,
      values: {
        name: "受控单位",
        unifiedSocialCreditCode: "91350211m000100y46",
        attachments: []
      }
    });

    expect(result).toMatchObject({ party: { id: "party-intent-1" }, version: { versionNo: 1 } });
    expect(tx.businessPartyCreateIdempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey,
        action: "business_party.create",
        fingerprint,
        businessPartyId: "party-intent-1"
      })
    });
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "business_party.create",
      metadata: expect.objectContaining({ idempotencyKey, fingerprint })
    }));
  });

  it("rejects a definition probe when the request reaches the create write seam", async () => {
    const idempotencyKey = "22222222-2222-4222-8222-222222222222";
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({
        attachments: [],
        name: "探针单位",
        type: "organization",
        unifiedSocialCreditCode: "91350211M000100Y46"
      }))
      .digest("hex");
    const tx = {
      ...globalRole(),
      businessParty: { findUnique: jest.fn(), create: jest.fn() },
      businessPartyVersion: { create: jest.fn() },
      businessPartyCreateIdempotency: { findUnique: jest.fn(), create: jest.fn() }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);
    const targetService = new BusinessEntryCreateTargetService();
    const probe = targetService.issue({
      actorUserId: "staff-1",
      action: "business_party.create",
      scene: "business_party",
      entityType: "business_party",
      scope: "global",
      definitionKey: "business_party",
      definitionVersion: 1,
      idempotencyKey,
      fingerprint,
      purpose: "definition_probe"
    });

    await expect(service.createPartyWithIntent("staff-1", {
      target: { entityType: "business_party", createTarget: probe.createTarget },
      definitionKey: "business_party",
      definitionVersion: 1,
      idempotencyKey,
      values: {
        name: "探针单位",
        unifiedSocialCreditCode: "91350211M000100Y46",
        attachments: []
      }
    })).rejects.toThrow("新建目标令牌无效");
    expect(tx.businessParty.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate unified social credit code", async () => {
    const tx = {
      ...globalRole("contract_director"),
      businessParty: {
        findUnique: jest.fn().mockResolvedValue({ id: "party-existing" }),
        create: jest.fn()
      },
      businessPartyVersion: { create: jest.fn() }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await expect(service.createParty("director-1", snapshot)).rejects.toThrow(
      "统一社会信用代码已存在"
    );
    expect(tx.businessParty.create).not.toHaveBeenCalled();
  });

  it("creates a new immutable version instead of overwriting history", async () => {
    const tx = {
      ...globalRole(),
      businessParty: {
        findUnique: jest.fn().mockResolvedValue({
          id: "party-1",
          unifiedSocialCreditCode: "91350211M000100Y46"
        }),
        update: jest.fn().mockResolvedValue({ id: "party-1", name: "华东建设集团有限公司" })
      },
      businessPartyVersion: {
        findFirst: jest.fn().mockResolvedValue({ versionNo: 1 }),
        create: jest.fn().mockResolvedValue({ id: "party-version-2", versionNo: 2 }),
        update: jest.fn()
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    const result = await service.createVersion("party-1", "staff-1", {
      ...snapshot,
      name: "华东建设集团有限公司"
    });

    expect(result.versionNo).toBe(2);
    expect(tx.businessPartyVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessPartyId: "party-1",
        versionNo: 2
      })
    });
    expect(tx.businessPartyVersion.update).not.toHaveBeenCalled();
    expect(
      (tx as typeof tx & {
        contractGeneratedDocument: { updateMany: jest.Mock };
      }).contractGeneratedDocument.updateMany
    ).not.toHaveBeenCalled();
  });

  it.each(
    ([
      "hasSignedFormalFile",
      "hasActiveSealTask",
      "hasArchiveFile",
      "hasSettlement",
      "hasPaymentRequest"
    ] as const).flatMap((formalFlag) =>
      (["add", "updateRole", "remove"] as const).map((action) => [
        action,
        formalFlag
      ] as const)
    )
  )(
    "fails closed before contract party %s when %s is already present",
    async (action, formalFlag) => {
      const tx = guardedContractPartyTx("original", {
        [formalFlag]: true
      });
      const service = new BusinessPartyService(
        prismaWithTransaction(tx),
        audit as never
      );

      await expect(mutateContractParty(service, action)).rejects.toThrow(
        "合同已存在正式业务事实，不能变更合作单位"
      );

      expectContractPartyBoundaryLockOrder(tx.$queryRaw);
      expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
      expect(tx.contractPartySnapshot.create).not.toHaveBeenCalled();
      expect(tx.contractPartySnapshot.update).not.toHaveBeenCalled();
      expect(tx.contractPartySnapshot.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it.each(["add", "updateRole", "remove"] as const)(
    "routes contract party %s for a historical takeover draft to its dedicated workbench",
    async (action) => {
      const tx = guardedContractPartyTx("historical_takeover");
      const service = new BusinessPartyService(
        prismaWithTransaction(tx),
        audit as never
      );

      await expect(mutateContractParty(service, action)).rejects.toThrow(
        "历史接管草稿必须在历史接管工作台办理"
      );

      expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
      expect(tx.contractPartySnapshot.create).not.toHaveBeenCalled();
      expect(tx.contractPartySnapshot.update).not.toHaveBeenCalled();
      expect(tx.contractPartySnapshot.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it.each(["add", "updateRole", "remove"] as const)(
    "blocks relation-only takeover before contract party %s writes",
    async (action) => {
      const tx = guardedContractPartyTx("original", {}, true);
      const service = new BusinessPartyService(
        prismaWithTransaction(tx),
        audit as never
      );

      await expect(mutateContractParty(service, action)).rejects.toMatchObject({
        response: {
          code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
          projectId: null,
          takeoverId: null
        }
      });

      expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
      expect(tx.contractPartySnapshot.create).not.toHaveBeenCalled();
      expect(tx.contractPartySnapshot.update).not.toHaveBeenCalled();
      expect(tx.contractPartySnapshot.delete).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("rejects adding a new party_a snapshot to a governed draft", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 1
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null
        })
      },
      contractPartySnapshot: { create: jest.fn() }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await expect(service.addContractParty("version-1", "owner-1", {
      roleKey: "party_a",
      snapshot: { name: "伪造我方主体", attachments: [] }
    })).rejects.toThrow("我方签约主体请回到基本信息从我方公司主体中选择");
    expect(tx.contractPartySnapshot.create).not.toHaveBeenCalled();
  });

  it("derives empty attachments for a newly created business-party version", async () => {
    const tx = {
      ...globalRole(),
      businessParty: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "party-1" })
      },
      businessPartyVersion: {
        create: jest.fn().mockResolvedValue({ id: "party-version-1", versionNo: 1 })
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await service.createParty("staff-1", snapshot);

    expect(tx.businessPartyVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshot: expect.objectContaining({
          attachments: []
        })
      })
    });
  });

  it("keeps an identical aggregate party snapshot stable", async () => {
    const currentSnapshot = { name: "乙方", attachments: [] };
    const tx = {
      businessPartyVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: "party-version-b", snapshot: currentSnapshot }
        ])
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contract-party-b",
            roleKey: "party_b",
            displayOrder: 1,
            businessPartyVersionId: "party-version-b",
            snapshot: currentSnapshot
          }
        ]),
        deleteMany: jest.fn(),
        update: jest.fn(),
        createMany: jest.fn()
      }
    };
    const service = new BusinessPartyService({} as PrismaService, audit as never);

    await expect(
      service.replaceContractPartiesInTransaction(
        tx as never,
        "contract-version-1",
        [
          {
            roleKey: "party_b",
            displayOrder: 1,
            businessPartyVersionId: "party-version-b",
            snapshot: {}
          }
        ]
      )
    ).resolves.toEqual({ changed: false });
    expect(tx.contractPartySnapshot.deleteMany).not.toHaveBeenCalled();
    expect(tx.contractPartySnapshot.update).not.toHaveBeenCalled();
    expect(tx.contractPartySnapshot.createMany).not.toHaveBeenCalled();
  });

  it("uses the authoritative party version snapshot during aggregate replacement", async () => {
    const tx = {
      businessPartyVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "party-version-b",
            snapshot: { name: "数据库权威乙方", attachments: [] }
          }
        ])
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        update: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const service = new BusinessPartyService({} as PrismaService, audit as never);

    await expect(
      service.replaceContractPartiesInTransaction(
        tx as never,
        "contract-version-1",
        [
          {
            roleKey: "party_b",
            displayOrder: 1,
            businessPartyVersionId: "party-version-b",
            snapshot: { name: "客户端伪造乙方" }
          }
        ]
      )
    ).resolves.toEqual({ changed: true });
    expect(tx.contractPartySnapshot.createMany).toHaveBeenCalledWith({
      data: [
        {
          contractVersionId: "contract-version-1",
          roleKey: "party_b",
          displayOrder: 1,
          businessPartyVersionId: "party-version-b",
          snapshot: { name: "数据库权威乙方", attachments: [] }
        }
      ]
    });
  });

  it("adds multiple role snapshots to one draft contract", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 4
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-1", ownerUserId: "owner-1" })
      },
      businessPartyVersion: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: "party-version-c",
            snapshot: { name: "丙方", attachments: [] }
          })
          .mockResolvedValueOnce({
            id: "party-version-b",
            snapshot: { name: "乙方", attachments: [] }
          })
      },
      contractPartySnapshot: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: "snapshot-1", roleKey: "party_c", displayOrder: 1 })
          .mockResolvedValueOnce({ id: "snapshot-2", roleKey: "party_b", displayOrder: 1 })
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await service.addContractParty("contract-version-1", "owner-1", {
      roleKey: "party_c",
      businessPartyVersionId: "party-version-c"
    });
    await service.addContractParty("contract-version-1", "owner-1", {
      roleKey: "party_b",
      businessPartyVersionId: "party-version-b"
    });

    expect(tx.contractPartySnapshot.findFirst).toHaveBeenNthCalledWith(1, {
      where: { contractVersionId: "contract-version-1", roleKey: "party_c" },
      orderBy: { displayOrder: "desc" }
    });
    expect(tx.contractPartySnapshot.findFirst).toHaveBeenNthCalledWith(2, {
      where: { contractVersionId: "contract-version-1", roleKey: "party_b" },
      orderBy: { displayOrder: "desc" }
    });
    expect(tx.contractPartySnapshot.create).toHaveBeenNthCalledWith(
      1,
      { data: expect.objectContaining({ roleKey: "party_c", displayOrder: 1 }) }
    );
    expect(tx.contractPartySnapshot.create).toHaveBeenNthCalledWith(
      2,
      { data: expect.objectContaining({ roleKey: "party_b", displayOrder: 1 }) }
    );
    expect(tx.contractVersion.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "contract-version-1",
        draftRevision: 4,
        status: { in: ["draft"] }
      },
      data: {
        draftRevision: { increment: 1 },
        readinessSnapshot: Prisma.DbNull
      }
    });
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
  });

  it("does not change existing contract snapshot when party record changes", async () => {
    const sourceSnapshot = {
      name: "原合作单位",
      attachments: [{ category: "qualification", fileId: "file-old", name: "旧资质" }]
    };
    let attachedSnapshot: unknown;
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-1", ownerUserId: "owner-1" })
      },
      businessPartyVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "party-version-1",
          snapshot: sourceSnapshot
        })
      },
      contractPartySnapshot: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => {
          attachedSnapshot = data.snapshot;
          return { id: "snapshot-1", ...data };
        })
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await service.addContractParty("contract-version-1", "owner-1", {
      roleKey: "party_b",
      businessPartyVersionId: "party-version-1"
    });
    sourceSnapshot.name = "变更后的合作单位";
    sourceSnapshot.attachments[0].fileId = "file-new";

    expect(attachedSnapshot).toEqual({
      name: "原合作单位",
      attachments: [{ category: "qualification", fileId: "file-old", name: "旧资质" }]
    });
    expect(attachedSnapshot).not.toBe(sourceSnapshot);
  });

  it("requires exactly one snapshot source and the draft owner", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-1", ownerUserId: "owner-1" })
      },
      contractPartySnapshot: { create: jest.fn() }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await expect(
      service.addContractParty("contract-version-1", "other-user", {
        roleKey: "other",
        snapshot: { name: "临时单位", attachments: [] }
      })
    ).rejects.toThrow("只有合同草稿经办人可以变更合同合作单位");
    await expect(
      service.addContractParty("contract-version-1", "owner-1", {
        roleKey: "other",
        businessPartyVersionId: "party-version-1",
        snapshot: { name: "临时单位", attachments: [] }
      })
    ).rejects.toThrow("合作单位版本和临时快照必须且只能选择一项");
    expect(tx.contractPartySnapshot.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      input: { ...snapshot, name: "" },
      message: "请填写合作单位名称"
    },
    {
      input: { ...snapshot, attachments: null },
      message: "合作单位附件必须是数组"
    },
    {
      input: {
        ...snapshot,
        attachments: [{ category: "invalid", fileId: "file-1", name: "附件" }]
      },
      message: "合作单位附件信息不正确"
    }
  ])("合作单位资料无效时返回中文错误", async ({ input, message }) => {
    const tx = {
      ...globalRole(),
      businessParty: { findUnique: jest.fn(), create: jest.fn() },
      businessPartyVersion: { create: jest.fn() }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await expect(service.createParty("staff-1", input as never)).rejects.toThrow(message);
    expect(tx.businessParty.create).not.toHaveBeenCalled();
  });

  it("非公司级合同人员不能维护合作单位档案", async () => {
    const tx = {
      userPosition: { findMany: jest.fn().mockResolvedValue([]) },
      position: { findMany: jest.fn() },
      businessParty: { create: jest.fn() },
      businessPartyVersion: { create: jest.fn() }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await expect(service.createParty("employee-1", snapshot)).rejects.toThrow(
      "当前账号不可用或岗位数据异常"
    );
    expect(tx.businessParty.create).not.toHaveBeenCalled();
  });

  it("rejects a party mutation when the contract draft revision CAS is stale", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 4
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractPartySnapshot: {
        create: jest.fn()
      },
      contractGeneratedDocument: {
        updateMany: jest.fn()
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await expect(
      service.addContractParty("contract-version-1", "owner-1", {
        roleKey: "other",
        snapshot: { name: "临时单位", attachments: [] }
      })
    ).rejects.toThrow("合同草稿已变化，请刷新后重试");
    expect(tx.contractPartySnapshot.create).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
  });

  it("allows removing a party snapshot from a withdrawn draft (approval history does not block)", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-1", ownerUserId: "owner-1" })
      },
      contractPartySnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: "snapshot-1",
          roleKey: "party_b"
        }),
        delete: jest.fn().mockResolvedValue({ id: "snapshot-1" })
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await expect(
      service.removeContractParty("contract-version-1", "snapshot-1", "owner-1")
    ).resolves.toEqual({ id: "snapshot-1" });
    expect(tx.contractPartySnapshot.delete).toHaveBeenCalledWith({
      where: { id: "snapshot-1" }
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "contract_party.remove_role" })
    );
  });

  it("allows removing a party snapshot from a draft never submitted for approval", async () => {
    const tx = {
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-version-1",
          contractId: "contract-1",
          status: "draft"
        })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: "contract-1", ownerUserId: "owner-1" })
      },
      contractPartySnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: "snapshot-1",
          roleKey: "party_b"
        }),
        delete: jest.fn().mockResolvedValue({ id: "snapshot-1" })
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await expect(
      service.removeContractParty("contract-version-1", "snapshot-1", "owner-1")
    ).resolves.toEqual({ id: "snapshot-1" });
    expect(tx.contractPartySnapshot.delete).toHaveBeenCalledWith({
      where: { id: "snapshot-1" }
    });
  });
});
