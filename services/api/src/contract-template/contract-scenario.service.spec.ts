import { Prisma } from "@prisma/client";
import { ContractScenarioService } from "./contract-scenario.service";

describe("ContractScenarioService", () => {
  const audit = { record: jest.fn() };
  const templates = {
    publishedUsagePreview: jest.fn().mockReturnValue({
      fields: [{ label: "项目名称", type: "text", required: true }],
      bills: [],
      clauses: [],
      attachments: [],
      validations: []
    })
  };

  beforeEach(() => jest.clearAllMocks());

  function recommendationPrisma(mappingCount: number) {
    const mappings = Array.from({ length: mappingCount }, (_, index) => ({
      id: `mapping-${index + 1}`,
      businessTemplateVersionId: `version-${index + 1}`,
      reason: `配置理由-${index + 1}`,
      priority: 100 - index,
      createdByUserId: "secret-actor"
    }));
    const tx = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ id: "project-1", isActive: true })
      },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([
          { positionId: "position-1", projectId: "project-1" }
        ])
      },
      projectMember: { findMany: jest.fn().mockResolvedValue([]) },
      position: {
        findMany: jest.fn().mockResolvedValue([
          { id: "position-1", key: "contract_staff" }
        ])
      },
      contractBusinessScenario: {
        findFirst: jest.fn().mockResolvedValue({
          id: "scenario-1",
          code: "materials",
          name: "材料采购"
        })
      },
      contractScenarioTemplateMapping: {
        findMany: jest.fn().mockResolvedValue(mappings)
      },
      contractBusinessTemplateVersion: {
        findMany: jest.fn().mockResolvedValue(
          mappings.map((mapping, index) => ({
            id: mapping.businessTemplateVersionId,
            templateId: `template-${index + 1}`,
            versionNo: index + 1,
            status: "published",
            fieldSchema: [],
            billSchema: [],
            clauseSchema: [],
            attachmentSchema: [],
            validationSchema: [],
            schemaSecret: "secret-schema"
          }))
        )
      },
      contractBusinessTemplate: {
        findMany: jest.fn().mockResolvedValue(
          mappings.map((_mapping, index) => ({
            id: `template-${index + 1}`,
            code: `T-${index + 1}`,
            name: `模板${index + 1}`,
            contractTypeKey: "material_purchase",
            fileId: "secret-file"
          }))
        )
      }
    };
    return {
      tx,
      $transaction: jest.fn(async (callback) => callback(tx))
    };
  }

  it.each([
    [0, "unavailable"],
    [1, "automatic"],
    [2, "choice_required"]
  ])("returns exact %i-match recommendation state with only configured reasons", async (count, state) => {
    const prisma = recommendationPrisma(count);
    const service = new ContractScenarioService(prisma as never, audit as never, templates as never);

    const result = await service.recommend(
      "project-1",
      "contract-user",
      "scenario-1",
      "material_purchase"
    );
    const serialized = JSON.stringify(result);

    expect(result.selectionMode).toBe(state);
    expect(result.recommendations).toHaveLength(count);
    expect(result.recommendations.map((item) => item.reason)).toEqual(
      Array.from({ length: count }, (_, index) => `配置理由-${index + 1}`)
    );
    expect(serialized).not.toContain("priority");
    expect(serialized).not.toContain("secret-schema");
    expect(serialized).not.toContain("secret-file");
    expect(serialized).not.toContain("secret-actor");
  });

  function governanceTx(roleKey = "contract_director") {
    return {
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-1" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([{ key: roleKey }]) },
      contractBusinessScenario: {
        create: jest.fn().mockImplementation(({ data }) => ({ id: "scenario-1", ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: "scenario-1", revision: 2 })
      }
    };
  }

  it.each(["contract_director", "super_admin"])(
    "accepts global %s at the service governance layer without auditing free text",
    async (roleKey) => {
      const tx = governanceTx(roleKey);
      const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
      const service = new ContractScenarioService(prisma as never, audit as never, templates as never);

      await service.createScenario("governor-1", {
        code: "materials",
        name: "敏感场景名称",
        description: "敏感场景说明"
      });

      const metadata = audit.record.mock.calls[0][1].metadata;
      expect(JSON.stringify(metadata)).not.toContain("敏感");
    }
  );

  it("rejects project-only or unrelated roles at the service governance layer", async () => {
    const tx = governanceTx("contract_staff");
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractScenarioService(prisma as never, audit as never, templates as never);

    await expect(
      service.createScenario("staff-1", { code: "materials", name: "材料采购" })
    ).rejects.toThrow("只有全局合同主管或超级管理员");
    expect(tx.contractBusinessScenario.create).not.toHaveBeenCalled();
  });

  it("uses revision CAS and does not audit when a scenario changed concurrently", async () => {
    const tx = governanceTx();
    tx.contractBusinessScenario.updateMany.mockResolvedValue({ count: 0 });
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractScenarioService(prisma as never, audit as never, templates as never);

    await expect(
      service.updateScenario("scenario-1", "governor-1", {
        expectedRevision: 3,
        active: false
      })
    ).rejects.toThrow("业务场景已被修改");
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("fails closed for an active mapping whose exact template is missing", async () => {
    const prisma = recommendationPrisma(1);
    prisma.tx.contractBusinessTemplateVersion.findMany.mockResolvedValue([]);
    const service = new ContractScenarioService(prisma as never, audit as never, templates as never);

    await expect(
      service.recommend("project-1", "contract-user", "scenario-1", "material_purchase")
    ).rejects.toThrow("启用的业务场景映射缺少模板版本");
  });

  it("rejects ordinary reads when project is inactive or actor lacks contract.create", async () => {
    const prisma = recommendationPrisma(0);
    prisma.tx.project.findUnique.mockResolvedValue({ id: "project-1", isActive: false });
    const service = new ContractScenarioService(prisma as never, audit as never, templates as never);

    await expect(
      service.recommend("project-1", "contract-user", "scenario-1", "material_purchase")
    ).rejects.toThrow("项目不存在或已停用");

    prisma.tx.project.findUnique.mockResolvedValue({ id: "project-1", isActive: true });
    prisma.tx.position.findMany.mockResolvedValue([
      { id: "position-1", key: "employee" }
    ]);
    await expect(
      service.recommend("project-1", "contract-user", "scenario-1", "material_purchase")
    ).rejects.toThrow("缺少在该项目创建合同的权限");
  });

  it("derives mapping contract type from the exact published template and omits reason from audit", async () => {
    const tx = {
      ...governanceTx(),
      contractBusinessScenario: {
        ...governanceTx().contractBusinessScenario,
        findUnique: jest.fn().mockResolvedValue({ id: "scenario-1" })
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          status: "published"
        })
      },
      contractBusinessTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-1",
          contractTypeKey: "material_purchase"
        })
      },
      contractScenarioTemplateMapping: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "mapping-1",
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        }))
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "template-1", contractTypeKey: "material_purchase" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status: "published"
        }])
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractScenarioService(prisma as never, audit as never, templates as never);

    await service.createMapping("scenario-1", "governor-1", {
      expectedScenarioRevision: 1,
      businessTemplateVersionId: "version-1",
      reason: "敏感配置理由",
      priority: 10
    });

    expect(tx.contractScenarioTemplateMapping.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contractTypeKey: "material_purchase", priority: 10 })
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.contractBusinessScenario.updateMany.mock.invocationCallOrder[0]
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );
    expect(JSON.stringify(audit.record.mock.calls[0][1].metadata)).not.toContain("敏感配置理由");
  });

  it("does not reactivate a mapping whose exact template is no longer published", async () => {
    const tx = {
      ...governanceTx(),
      contractScenarioTemplateMapping: {
        findUnique: jest.fn().mockResolvedValue({
          id: "mapping-1",
          businessTemplateVersionId: "version-1",
          contractTypeKey: "material_purchase"
        }),
        updateMany: jest.fn()
      },
      contractBusinessTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          templateId: "template-1",
          status: "stopped"
        })
      },
      contractBusinessTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "template-1",
          contractTypeKey: "material_purchase"
        })
      },
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ id: "template-1", contractTypeKey: "material_purchase" }])
        .mockResolvedValueOnce([{
          id: "version-1",
          templateId: "template-1",
          status: "stopped"
        }])
        .mockResolvedValueOnce([{ id: "scenario-1" }])
        .mockResolvedValueOnce([{
          id: "mapping-1",
          businessScenarioId: "scenario-1",
          businessTemplateVersionId: "version-1",
          contractTypeKey: "material_purchase"
        }])
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    const service = new ContractScenarioService(prisma as never, audit as never, templates as never);

    await expect(
      service.updateMapping("mapping-1", "governor-1", {
        expectedRevision: 2,
        active: true
      })
    ).rejects.toThrow("精确模板版本仍已发布且合同类型一致");
    expect(tx.contractScenarioTemplateMapping.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );
  });
});
