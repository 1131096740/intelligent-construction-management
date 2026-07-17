import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  RequestMethod
} from "@nestjs/common";
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { validate } from "class-validator";
import { AuditModule } from "../audit/audit.module";
import { DatabaseModule } from "../database/database.module";
import { CompanyEntityAccess } from "./company-entity-access";
import { CompanyEntityController } from "./company-entity.controller";
import {
  CompanyEntityManagementQueryDto,
  CreateCompanyEntityDto,
  UpdateCompanyEntityDto,
  UpdateCompanyEntityStatusDto
} from "./dto/company-entity.dto";
import { CompanyEntityModule } from "./company-entity.module";
import { CompanyEntityService } from "./company-entity.service";

const VALID_CODE = "91350211M000100Y46";
const OTHER_VALID_CODE = "91440300708461136T";
const DUPLICATE_NAME_WARNING =
  "存在同名我方公司主体，请按统一社会信用代码判断是否为同一主体";
const CONCURRENT_CHANGE_MESSAGE =
  "我方公司主体资料已发生变化，请刷新列表后重试";

function entityFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "entity-1",
    name: "云南某建设有限公司",
    unifiedSocialCreditCode: VALID_CODE,
    registeredAddress: "昆明市",
    dataStatus: "complete",
    currentVersionNo: 1,
    isActive: true,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
    ...overrides
  };
}

function versionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    companyEntityId: "entity-1",
    versionNo: 1,
    name: "云南某建设有限公司",
    unifiedSocialCreditCode: VALID_CODE,
    registeredAddress: "昆明市",
    isActive: true,
    action: "create",
    actorUserId: "contract-user",
    actorRoleKey: "contract_staff",
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    ...overrides
  };
}

type ServiceConstructor = new (
  prisma: never,
  access: never,
  audit: never
) => CompanyEntityService;

function buildHarness() {
  const tx = {
    userPosition: { findMany: jest.fn() },
    position: { findMany: jest.fn() },
    companyEntity: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(entityFixture()),
      create: jest.fn().mockResolvedValue(entityFixture()),
      update: jest.fn().mockResolvedValue(entityFixture({ currentVersionNo: 2 }))
    },
    companyEntityVersion: {
      create: jest.fn().mockResolvedValue(versionFixture()),
      findMany: jest.fn().mockResolvedValue([])
    },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ id: "entity-1" }])
  };
  const prisma = {
    companyEntity: {
      findMany: jest.fn().mockResolvedValue([entityFixture()]),
      findUnique: jest.fn().mockResolvedValue(entityFixture())
    },
    companyEntityVersion: {
      findMany: jest.fn().mockResolvedValue([])
    },
    $transaction: jest.fn(
      async (work: (client: typeof tx) => Promise<unknown>) => work(tx)
    )
  };
  const access = {
    assertCanMaintain: jest.fn().mockResolvedValue("contract_staff"),
    assertCanRead: jest.fn().mockResolvedValue("finance_staff"),
    assertCanSelect: jest.fn().mockResolvedValue("contract_staff")
  };
  const audit = {
    record: jest.fn().mockResolvedValue({ id: "audit-1" })
  };
  const Constructor = CompanyEntityService as unknown as ServiceConstructor;
  const service = new Constructor(prisma as never, access as never, audit as never);
  return { service, prisma, tx, access, audit };
}

describe("CompanyEntityService reads", () => {
  it("keeps the candidate response as an array after authorization", async () => {
    const { service, prisma, access } = buildHarness();

    await expect(service.listActive("contract-user")).resolves.toEqual([
      entityFixture()
    ]);
    expect(access.assertCanSelect).toHaveBeenCalledWith("contract-user");
    expect(prisma.companyEntity.findMany).toHaveBeenCalledWith({
      where: { isActive: true, dataStatus: "complete" },
      select: {
        id: true,
        name: true,
        unifiedSocialCreditCode: true,
        registeredAddress: true,
        dataStatus: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: "asc" }
    });
  });

  it("does not query candidate data when selection authorization fails", async () => {
    const { service, prisma, access } = buildHarness();
    access.assertCanSelect.mockRejectedValue(
      new ForbiddenException("当前账号没有选择我方公司主体所需的岗位权限")
    );

    await expect(service.listActive("employee-user")).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(prisma.companyEntity.findMany).not.toHaveBeenCalled();
  });

  it("searches current and historical facts with an inactive management filter", async () => {
    const { service, prisma, access } = buildHarness();
    prisma.companyEntityVersion.findMany.mockResolvedValue([
      { companyEntityId: "entity-from-history" }
    ]);
    prisma.companyEntity.findMany.mockResolvedValue([
      entityFixture({ id: "entity-from-history", isActive: false })
    ]);

    await service.listForManagement("finance-user", {
      keyword: "  历史名称  ",
      status: "inactive"
    });

    expect(access.assertCanRead).toHaveBeenCalledWith("finance-user");
    expect(prisma.companyEntityVersion.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: "历史名称", mode: "insensitive" } },
          {
            unifiedSocialCreditCode: {
              contains: "历史名称",
              mode: "insensitive"
            }
          }
        ]
      },
      select: { companyEntityId: true },
      distinct: ["companyEntityId"]
    });
    expect(prisma.companyEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: false,
          OR: [
            { name: { contains: "历史名称", mode: "insensitive" } },
            {
              unifiedSocialCreditCode: {
                contains: "历史名称",
                mode: "insensitive"
              }
            },
            { id: { in: ["entity-from-history"] } }
          ]
        }
      })
    );
  });

  it("rejects an unsupported management status with a Chinese 400", async () => {
    const { service } = buildHarness();

    await expect(
      service.listForManagement("finance-user", { status: "deleted" } as never)
    ).rejects.toMatchObject({
      status: 400,
      message: "公司主体状态筛选不正确，请选择全部、启用或停用"
    });
  });

  it("returns immutable history in descending version order", async () => {
    const { service, prisma, access } = buildHarness();
    const versions = [
      versionFixture({ versionNo: 2, action: "update" }),
      versionFixture({ versionNo: 1 })
    ];
    prisma.companyEntityVersion.findMany.mockResolvedValue(versions);

    await expect(service.history("entity-1", "chairman-user")).resolves.toEqual({
      entity: entityFixture(),
      versions
    });
    expect(access.assertCanRead).toHaveBeenCalledWith("chairman-user");
    expect(prisma.companyEntityVersion.findMany).toHaveBeenCalledWith({
      where: { companyEntityId: "entity-1" },
      select: {
        id: true,
        companyEntityId: true,
        versionNo: true,
        name: true,
        unifiedSocialCreditCode: true,
        registeredAddress: true,
        isActive: true,
        action: true,
        actorUserId: true,
        actorRoleKey: true,
        createdAt: true
      },
      orderBy: { versionNo: "desc" }
    });
  });

  it("returns a Chinese next-step error when history target is missing", async () => {
    const { service, prisma } = buildHarness();
    prisma.companyEntity.findUnique.mockResolvedValue(null);

    await expect(service.history("missing", "finance-user")).rejects.toMatchObject({
      status: 404,
      message: "未找到我方公司主体，请刷新列表后重试"
    });
  });

  it("does not query management data when read authorization fails", async () => {
    const { service, prisma, access } = buildHarness();
    access.assertCanRead.mockRejectedValue(
      new ForbiddenException("当前账号没有公司级全局岗位，不能查看我方公司主体管理信息")
    );

    await expect(
      service.listForManagement("project-only-user", { status: "all" })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.companyEntity.findMany).not.toHaveBeenCalled();
    expect(prisma.companyEntityVersion.findMany).not.toHaveBeenCalled();
  });
});

describe("CompanyEntityService create", () => {
  it("normalizes required facts and writes entity, version and audit in one transaction", async () => {
    const { service, prisma, tx, access, audit } = buildHarness();

    await service.create("contract-user", {
      name: "  云南某建设有限公司  ",
      unifiedSocialCreditCode: " 91350211m000100y46 ",
      registeredAddress: "  昆明市  "
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(access.assertCanMaintain).toHaveBeenCalledWith("contract-user", tx);
    expect(tx.companyEntity.create).toHaveBeenCalledWith({
      data: {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE,
        registeredAddress: "昆明市",
        dataStatus: "complete",
        currentVersionNo: 1,
        isActive: true
      }
    });
    expect(tx.companyEntityVersion.create).toHaveBeenCalledWith({
      data: {
        companyEntityId: "entity-1",
        versionNo: 1,
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE,
        registeredAddress: "昆明市",
        isActive: true,
        action: "create",
        actorUserId: "contract-user",
        actorRoleKey: "contract_staff"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(tx, {
      actorUserId: "contract-user",
      action: "company_entity.create",
      businessType: "company_entity",
      businessId: "entity-1",
      metadata: { versionNo: 1, actorRoleKey: "contract_staff" }
    });
  });

  it("converts a blank registered address to null", async () => {
    const { service, tx } = buildHarness();

    await service.create("contract-user", {
      name: "云南某建设有限公司",
      unifiedSocialCreditCode: VALID_CODE,
      registeredAddress: "   "
    });

    expect(tx.companyEntity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ registeredAddress: null })
    });
  });

  it("returns a compact non-blocking warning for a duplicate name", async () => {
    const { service, tx } = buildHarness();
    tx.companyEntity.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          "name" in where
            ? entityFixture({ id: "same-name-other", unifiedSocialCreditCode: OTHER_VALID_CODE })
            : null
        )
    );

    await expect(
      service.create("contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE
      })
    ).resolves.toMatchObject({ warning: DUPLICATE_NAME_WARNING });
    expect(tx.companyEntity.create).toHaveBeenCalled();
  });

  it("rejects a normalized credit-code conflict with a guided 409", async () => {
    const { service, tx } = buildHarness();
    tx.companyEntity.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve("unifiedSocialCreditCode" in where ? entityFixture() : null)
    );

    await expect(
      service.create("contract-user", {
        name: "另一主体",
        unifiedSocialCreditCode: " 91350211m000100y46 "
      })
    ).rejects.toMatchObject({
      status: 409,
      message:
        "统一社会信用代码已被其他我方公司主体使用，请核对是否应修改现有主体或改用另一真实主体"
    });
    expect(tx.companyEntity.create).not.toHaveBeenCalled();
  });

  it("maps a concurrent P2002 conflict without leaking Prisma details", async () => {
    const { service, tx } = buildHarness();
    tx.companyEntity.create.mockRejectedValue({
      code: "P2002",
      message: "TOP-SECRET Prisma normalized index detail"
    });

    let thrown: unknown;
    try {
      await service.create("contract-user", {
        name: "另一主体",
        unifiedSocialCreditCode: OTHER_VALID_CODE
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown).toMatchObject({
      message:
        "统一社会信用代码已被其他我方公司主体使用，请核对是否应修改现有主体或改用另一真实主体"
    });
    expect(String(thrown)).not.toContain("TOP-SECRET");
  });

  it("maps a version P2002 to a generic actionable conflict", async () => {
    const { service, tx } = buildHarness();
    tx.companyEntityVersion.create.mockRejectedValue({
      code: "P2002",
      message: "TOP-SECRET CompanyEntityVersion unique detail"
    });

    let thrown: unknown;
    try {
      await service.create("contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown).toMatchObject({ message: CONCURRENT_CHANGE_MESSAGE });
    expect(String(thrown)).not.toContain("TOP-SECRET");
    expect(String(thrown)).not.toContain("统一社会信用代码已被");
  });

  it("rejects the whole transaction when audit persistence fails", async () => {
    const { service, audit } = buildHarness();
    audit.record.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.create("contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE
      })
    ).rejects.toThrow("audit unavailable");
  });
});

describe("CompanyEntityService update", () => {
  it("locks before reading and creates the next immutable update version", async () => {
    const { service, tx, access, audit } = buildHarness();

    await service.update("entity-1", "contract-user", {
      name: "云南某建设有限公司",
      unifiedSocialCreditCode: VALID_CODE,
      registeredAddress: "昆明市"
    });

    expect(access.assertCanMaintain).toHaveBeenCalledWith("contract-user", tx);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.companyEntity.findUnique.mock.invocationCallOrder[0]
    );
    expect(tx.companyEntity.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.companyEntity.update.mock.invocationCallOrder[0]
    );
    expect(tx.companyEntity.update).toHaveBeenCalledWith({
      where: { id: "entity-1" },
      data: {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE,
        registeredAddress: "昆明市",
        dataStatus: "complete",
        currentVersionNo: 2
      }
    });
    expect(tx.companyEntityVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyEntityId: "entity-1",
          versionNo: 2,
          action: "update",
          actorUserId: "contract-user",
          actorRoleKey: "contract_staff"
        })
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "company_entity.update",
        businessId: "entity-1",
        metadata: { versionNo: 2, actorRoleKey: "contract_staff" }
      })
    );
  });

  it("excludes the current entity from the duplicate-name warning check", async () => {
    const { service, tx } = buildHarness();

    await service.update("entity-1", "contract-user", {
      name: "云南某建设有限公司",
      unifiedSocialCreditCode: VALID_CODE
    });

    expect(tx.companyEntity.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: "entity-1" },
        name: { equals: "云南某建设有限公司", mode: "insensitive" }
      },
      select: { id: true }
    });
  });

  it("returns a warning but still updates when another entity has the same name", async () => {
    const { service, tx } = buildHarness();
    tx.companyEntity.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve("name" in where ? entityFixture({ id: "other" }) : null)
    );

    await expect(
      service.update("entity-1", "contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE
      })
    ).resolves.toMatchObject({ warning: DUPLICATE_NAME_WARNING });
    expect(tx.companyEntity.update).toHaveBeenCalled();
  });

  it("rejects a credit code used by another entity", async () => {
    const { service, tx } = buildHarness();
    tx.companyEntity.findFirst.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          "unifiedSocialCreditCode" in where ? entityFixture({ id: "other" }) : null
        )
    );

    await expect(
      service.update("entity-1", "contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: OTHER_VALID_CODE
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.companyEntity.update).not.toHaveBeenCalled();
  });

  it("maps a main entity update P2002 to the guided credit-code conflict", async () => {
    const { service, tx } = buildHarness();
    tx.companyEntity.update.mockRejectedValue({
      code: "P2002",
      message: "TOP-SECRET CompanyEntity normalized credit index detail"
    });

    let thrown: unknown;
    try {
      await service.update("entity-1", "contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: OTHER_VALID_CODE
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown).toMatchObject({
      message:
        "统一社会信用代码已被其他我方公司主体使用，请核对是否应修改现有主体或改用另一真实主体"
    });
    expect(String(thrown)).not.toContain("TOP-SECRET");
  });

  it("maps an update-version P2002 to a generic actionable conflict", async () => {
    const { service, tx } = buildHarness();
    tx.companyEntityVersion.create.mockRejectedValue({
      code: "P2002",
      message: "TOP-SECRET CompanyEntityVersion update detail"
    });

    let thrown: unknown;
    try {
      await service.update("entity-1", "contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown).toMatchObject({ message: CONCURRENT_CHANGE_MESSAGE });
    expect(String(thrown)).not.toContain("TOP-SECRET");
    expect(String(thrown)).not.toContain("统一社会信用代码已被");
  });

  it("returns a Chinese next-step 404 when the locked target does not exist", async () => {
    const { service, tx } = buildHarness();
    tx.$queryRaw.mockResolvedValue([]);

    await expect(
      service.update("missing", "contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.update("missing", "contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE
      })
    ).rejects.toThrow("请刷新列表后重试");
    expect(tx.companyEntity.update).not.toHaveBeenCalled();
  });

  it("rejects update when its audit write fails", async () => {
    const { service, audit } = buildHarness();
    audit.record.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.update("entity-1", "contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE
      })
    ).rejects.toThrow("audit unavailable");
  });
});

describe("CompanyEntityService status", () => {
  it.each([
    [false, "disable", "company_entity.disable"],
    [true, "enable", "company_entity.enable"]
  ] as const)(
    "writes an immutable %s status version and audit action",
    async (isActive, versionAction, auditAction) => {
      const { service, tx, audit } = buildHarness();
      tx.companyEntity.findUnique.mockResolvedValue(
        entityFixture({ isActive: !isActive, currentVersionNo: 4 })
      );
      tx.companyEntity.update.mockResolvedValue(
        entityFixture({ isActive, currentVersionNo: 5 })
      );

      await service.updateStatus("entity-1", "contract-user", { isActive });

      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.companyEntity.update.mock.invocationCallOrder[0]
      );
      expect(tx.companyEntity.update).toHaveBeenCalledWith({
        where: { id: "entity-1" },
        data: { isActive, currentVersionNo: 5 }
      });
      expect(tx.companyEntityVersion.create).toHaveBeenCalledWith({
        data: {
          companyEntityId: "entity-1",
          versionNo: 5,
          name: "云南某建设有限公司",
          unifiedSocialCreditCode: VALID_CODE,
          registeredAddress: "昆明市",
          isActive,
          action: versionAction,
          actorUserId: "contract-user",
          actorRoleKey: "contract_staff"
        }
      });
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: auditAction,
          metadata: { versionNo: 5, actorRoleKey: "contract_staff" }
        })
      );
    }
  );

  it("returns an explicit unchanged no-op without fake history or audit", async () => {
    const { service, tx, audit } = buildHarness();

    await expect(
      service.updateStatus("entity-1", "contract-user", { isActive: true })
    ).resolves.toMatchObject({ unchanged: true, entity: entityFixture() });
    expect(tx.companyEntity.update).not.toHaveBeenCalled();
    expect(tx.companyEntityVersion.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("blocks enabling an incomplete subject before writing history or audit", async () => {
    const { service, tx, audit } = buildHarness();
    tx.companyEntity.findUnique.mockResolvedValue(
      entityFixture({ isActive: false, dataStatus: "legacy_incomplete" })
    );

    await expect(
      service.updateStatus("entity-1", "contract-user", { isActive: true })
    ).rejects.toMatchObject({
      status: 400,
      message:
        "我方公司主体资料尚未完善，请先补全统一社会信用代码和主体资料后再启用"
    });
    expect(tx.companyEntity.update).not.toHaveBeenCalled();
    expect(tx.companyEntityVersion.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("still allows an incomplete active subject to be disabled", async () => {
    const { service, tx, audit } = buildHarness();
    tx.companyEntity.findUnique.mockResolvedValue(
      entityFixture({ isActive: true, dataStatus: "legacy_incomplete" })
    );

    await service.updateStatus("entity-1", "contract-user", {
      isActive: false
    });

    expect(tx.companyEntity.update).toHaveBeenCalledWith({
      where: { id: "entity-1" },
      data: { isActive: false, currentVersionNo: 2 }
    });
    expect(tx.companyEntityVersion.create).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalled();
  });

  it("rejects a non-boolean status with a Chinese 400", async () => {
    const { service, prisma } = buildHarness();

    await expect(
      service.updateStatus("entity-1", "contract-user", { isActive: "false" } as never)
    ).rejects.toMatchObject({
      status: 400,
      message: "公司主体状态必须是布尔值，请重新选择"
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects status change when audit persistence fails", async () => {
    const { service, tx, audit } = buildHarness();
    tx.companyEntity.findUnique.mockResolvedValue(entityFixture({ isActive: false }));
    audit.record.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.updateStatus("entity-1", "contract-user", { isActive: true })
    ).rejects.toThrow("audit unavailable");
  });

  it("maps a status-version P2002 to a generic actionable conflict", async () => {
    const { service, tx } = buildHarness();
    tx.companyEntity.findUnique.mockResolvedValue(entityFixture({ isActive: false }));
    tx.companyEntityVersion.create.mockRejectedValue({
      code: "P2002",
      message: "TOP-SECRET CompanyEntityVersion status detail"
    });

    let thrown: unknown;
    try {
      await service.updateStatus("entity-1", "contract-user", {
        isActive: true
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictException);
    expect(thrown).toMatchObject({ message: CONCURRENT_CHANGE_MESSAGE });
    expect(String(thrown)).not.toContain("TOP-SECRET");
    expect(String(thrown)).not.toContain("统一社会信用代码已被");
  });
});

describe("CompanyEntityService input safety", () => {
  it.each([undefined, "", "   "])("requires a company entity name: %p", async (name) => {
    const { service, prisma } = buildHarness();

    await expect(
      service.create("contract-user", { name, unifiedSocialCreditCode: VALID_CODE } as never)
    ).rejects.toMatchObject({ status: 400, message: "请填写公司主体名称" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([123, {}, []])("rejects a non-text company entity name: %p", async (name) => {
    const { service } = buildHarness();

    await expect(
      service.create("contract-user", { name, unifiedSocialCreditCode: VALID_CODE } as never)
    ).rejects.toMatchObject({ status: 400, message: "公司主体名称必须是文字" });
  });

  it.each([undefined, "", "   "])("requires a unified social credit code: %p", async (code) => {
    const { service } = buildHarness();

    await expect(
      service.create("contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: code
      } as never)
    ).rejects.toMatchObject({ status: 400, message: "请填写统一社会信用代码" });
  });

  it.each([123, {}, []])("rejects a non-text credit code: %p", async (code) => {
    const { service } = buildHarness();

    await expect(
      service.create("contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: code
      } as never)
    ).rejects.toMatchObject({ status: 400, message: "统一社会信用代码必须是文字" });
  });

  it("rejects the old Y43 fixture because its checksum is invalid", async () => {
    const { service } = buildHarness();

    await expect(
      service.create("contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: "91350211M000100Y43"
      })
    ).rejects.toMatchObject({
      status: 400,
      message: "统一社会信用代码校验位不正确"
    });
  });

  it.each([123, {}, []])("rejects a non-text registered address: %p", async (address) => {
    const { service } = buildHarness();

    await expect(
      service.create("contract-user", {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE,
        registeredAddress: address
      } as never)
    ).rejects.toMatchObject({ status: 400, message: "注册地址必须是文字" });
  });

  it.each([
    [
      "name getter",
      () =>
        Object.defineProperty({ unifiedSocialCreditCode: VALID_CODE }, "name", {
          get() {
            throw new Error("TOP-SECRET name getter");
          }
        })
    ],
    [
      "credit-code getter",
      () =>
        Object.defineProperty({ name: "测试主体" }, "unifiedSocialCreditCode", {
          get() {
            throw new Error("TOP-SECRET credit getter");
          }
        })
    ],
    [
      "revoked Proxy",
      () => {
        const proxy = Proxy.revocable(
          { name: "测试主体", unifiedSocialCreditCode: VALID_CODE },
          {}
        );
        proxy.revoke();
        return proxy.proxy;
      }
    ]
  ])("sanitizes unreadable input from a %s", async (_case, input) => {
    const { service, prisma } = buildHarness();

    let thrown: unknown;
    try {
      await service.create("contract-user", input() as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect(thrown).toMatchObject({
      status: 400,
      message: "公司主体信息格式不正确"
    });
    expect(String(thrown)).not.toContain("TOP-SECRET");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("company entity DTOs", () => {
  it.each([CreateCompanyEntityDto, UpdateCompanyEntityDto])(
    "accepts only the required maintained facts through %p",
    async (Dto) => {
      const input = Object.assign(new Dto(), {
        name: "云南某建设有限公司",
        unifiedSocialCreditCode: VALID_CODE,
        registeredAddress: "昆明市"
      });

      await expect(validate(input)).resolves.toEqual([]);
    }
  );

  it("requires the unified social credit code", async () => {
    const input = Object.assign(new CreateCompanyEntityDto(), {
      name: "云南某建设有限公司"
    });

    const errors = await validate(input);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "unifiedSocialCreditCode" })
      ])
    );
  });

  it("rejects a non-text registered address", async () => {
    const input = Object.assign(new UpdateCompanyEntityDto(), {
      name: "云南某建设有限公司",
      unifiedSocialCreditCode: VALID_CODE,
      registeredAddress: 123
    });

    const errors = await validate(input);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: "registeredAddress" })
      ])
    );
  });

  it("accepts only a boolean status", async () => {
    const valid = Object.assign(new UpdateCompanyEntityStatusDto(), {
      isActive: false
    });
    const invalid = Object.assign(new UpdateCompanyEntityStatusDto(), {
      isActive: "false"
    });

    await expect(validate(valid)).resolves.toEqual([]);
    const errors = await validate(invalid);
    expect(errors[0]?.constraints).toEqual(
      expect.objectContaining({ isBoolean: "公司主体状态必须是布尔值" })
    );
  });

  it("validates management status without exposing export parameters", async () => {
    const valid = Object.assign(new CompanyEntityManagementQueryDto(), {
      keyword: "云南",
      status: "inactive"
    });
    const invalid = Object.assign(new CompanyEntityManagementQueryDto(), {
      status: "deleted"
    });

    await expect(validate(valid)).resolves.toEqual([]);
    const errors = await validate(invalid);
    expect(errors[0]?.constraints).toEqual(
      expect.objectContaining({
        isIn: "公司主体状态筛选不正确，请选择全部、启用或停用"
      })
    );
    expect(new CompanyEntityManagementQueryDto()).not.toHaveProperty("export");
  });
});

describe("CompanyEntityController", () => {
  function buildController() {
    const service = {
      listActive: jest.fn().mockResolvedValue([]),
      listForManagement: jest.fn().mockResolvedValue([]),
      history: jest.fn().mockResolvedValue({ entity: entityFixture(), versions: [] }),
      create: jest.fn().mockResolvedValue({ entity: entityFixture(), warning: null }),
      update: jest.fn().mockResolvedValue({ entity: entityFixture(), warning: null }),
      updateStatus: jest.fn().mockResolvedValue({ entity: entityFixture(), unchanged: false })
    };
    return {
      service,
      controller: new CompanyEntityController(service as never)
    };
  }

  it("exposes the six required routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, CompanyEntityController)).toBe(
      "company-entities"
    );
    const routes = [
      ["listActive", "/", RequestMethod.GET],
      ["listForManagement", "management", RequestMethod.GET],
      ["history", ":id/history", RequestMethod.GET],
      ["create", "/", RequestMethod.POST],
      ["update", ":id", RequestMethod.PATCH],
      ["updateStatus", ":id/status", RequestMethod.POST]
    ] as const;

    for (const [methodName, path, method] of routes) {
      const handler = CompanyEntityController.prototype[methodName];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
    }
  });

  it("passes the authenticated actor to management, history and every write", async () => {
    const { controller, service } = buildController();
    const user = {
      id: "contract-user",
      name: "合同员",
      phone: "13800000000"
    };
    const facts = {
      name: "云南某建设有限公司",
      unifiedSocialCreditCode: VALID_CODE,
      registeredAddress: "昆明市"
    };

    await controller.listActive(user);
    await controller.listForManagement(user, { status: "all" });
    await controller.history("entity-1", user);
    await controller.create(facts, user);
    await controller.update("entity-1", facts, user);
    await controller.updateStatus("entity-1", { isActive: false }, user);

    expect(service.listActive).toHaveBeenCalledWith("contract-user");
    expect(service.listForManagement).toHaveBeenCalledWith("contract-user", {
      status: "all"
    });
    expect(service.history).toHaveBeenCalledWith("entity-1", "contract-user");
    expect(service.create).toHaveBeenCalledWith("contract-user", facts);
    expect(service.update).toHaveBeenCalledWith(
      "entity-1",
      "contract-user",
      facts
    );
    expect(service.updateStatus).toHaveBeenCalledWith(
      "entity-1",
      "contract-user",
      { isActive: false }
    );
  });
});

describe("CompanyEntityModule", () => {
  it("registers audit, access, service and controller without unrelated exports", () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, CompanyEntityModule)).toEqual([
      DatabaseModule,
      AuditModule
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CompanyEntityModule)).toEqual([
      CompanyEntityAccess,
      CompanyEntityService
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CompanyEntityModule)).toEqual([
      CompanyEntityController
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, CompanyEntityModule)).toEqual([
      CompanyEntityService,
      CompanyEntityAccess
    ]);
  });
});
