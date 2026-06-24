import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { BusinessPartyService } from "./business-party.service";

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
        findMany: jest.fn().mockResolvedValue([{ key: roleKey }])
      }
    };
  }

  function prismaWithTransaction<T extends object>(tx: T) {
    return {
      $transaction: jest.fn(async (callback: (client: T) => unknown) => callback(tx))
    } as unknown as PrismaService;
  }

  const snapshot = {
    name: "  华东建设有限公司  ",
    unifiedSocialCreditCode: " 91310000abc123 ",
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
          unifiedSocialCreditCode: "91310000ABC123"
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
        unifiedSocialCreditCode: "91310000ABC123",
        createdByUserId: "staff-1"
      })
    });
    expect(tx.businessPartyVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessPartyId: "party-1",
        versionNo: 1,
        snapshot: expect.objectContaining({
          unifiedSocialCreditCode: "91310000ABC123"
        })
      })
    });
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

    await expect(service.createParty("director-1", snapshot)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(tx.businessParty.create).not.toHaveBeenCalled();
  });

  it("creates a new immutable version instead of overwriting history", async () => {
    const tx = {
      ...globalRole(),
      businessParty: {
        findUnique: jest.fn().mockResolvedValue({
          id: "party-1",
          unifiedSocialCreditCode: "91310000ABC123"
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
  });

  it("keeps qualification attachment file ids in version snapshot", async () => {
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
          attachments: [
            expect.objectContaining({
              category: "qualification",
              fileId: "file-qualification-1"
            })
          ]
        })
      })
    });
  });

  it("adds multiple role snapshots to one draft contract", async () => {
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
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: "party-version-a",
            snapshot: { name: "甲方", attachments: [] }
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
          .mockResolvedValueOnce({ id: "snapshot-1", roleKey: "party_a", displayOrder: 1 })
          .mockResolvedValueOnce({ id: "snapshot-2", roleKey: "party_b", displayOrder: 1 })
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await service.addContractParty("contract-version-1", "owner-1", {
      roleKey: "party_a",
      businessPartyVersionId: "party-version-a"
    });
    await service.addContractParty("contract-version-1", "owner-1", {
      roleKey: "party_b",
      businessPartyVersionId: "party-version-b"
    });

    expect(tx.contractPartySnapshot.findFirst).toHaveBeenNthCalledWith(1, {
      where: { contractVersionId: "contract-version-1", roleKey: "party_a" },
      orderBy: { displayOrder: "desc" }
    });
    expect(tx.contractPartySnapshot.findFirst).toHaveBeenNthCalledWith(2, {
      where: { contractVersionId: "contract-version-1", roleKey: "party_b" },
      orderBy: { displayOrder: "desc" }
    });
    expect(tx.contractPartySnapshot.create).toHaveBeenNthCalledWith(
      1,
      { data: expect.objectContaining({ roleKey: "party_a", displayOrder: 1 }) }
    );
    expect(tx.contractPartySnapshot.create).toHaveBeenNthCalledWith(
      2,
      { data: expect.objectContaining({ roleKey: "party_b", displayOrder: 1 }) }
    );
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
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.addContractParty("contract-version-1", "owner-1", {
        roleKey: "other",
        businessPartyVersionId: "party-version-1",
        snapshot: { name: "临时单位", attachments: [] }
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.contractPartySnapshot.create).not.toHaveBeenCalled();
  });

  it("rejects removing a draft party snapshot after approval was withdrawn", async () => {
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
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue({ id: "approval-1", status: "withdrawn" })
      },
      contractPartySnapshot: {
        findFirst: jest.fn(),
        delete: jest.fn()
      }
    };
    const service = new BusinessPartyService(prismaWithTransaction(tx), audit as never);

    await expect(
      service.removeContractParty("contract-version-1", "snapshot-1", "owner-1")
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.approvalInstance.findFirst).toHaveBeenCalledWith({
      where: {
        businessType: "contract_version",
        businessId: "contract-version-1"
      }
    });
    expect(tx.contractPartySnapshot.delete).not.toHaveBeenCalled();
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
      approvalInstance: {
        findFirst: jest.fn().mockResolvedValue(null)
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
