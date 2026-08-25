import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import * as ExcelJS from "exceljs";
import {
  COMPANY_ENTITY_MAINTAINER_ROLES,
  createBusinessEntryDefinitionRegistry,
  type BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import { createBusinessEntrySceneAccessRegistry } from "./business-entry-scene-access";
import { BusinessEntryDefinitionService } from "./business-entry-definition.service";
import {
  BUSINESS_ENTRY_ACCESS_REGISTRY as registeredAccess,
  BUSINESS_ENTRY_DEFINITION_REGISTRY as registeredDefinitions
} from "./business-entry-definition.scene-registry";
import {
  BUSINESS_ENTRY_XLSX_MIME,
  BusinessEntryExcelService
} from "./business-entry-excel.service";
import { BusinessEntryCreateTargetService } from "./business-entry-create-target.service";

const definition: BusinessEntrySceneDefinition = {
  key: "project_operating_profile",
  entityType: "project",
  name: "项目经营档案",
  description: "维护项目经营账和历史接管的受控字段。",
  version: 3,
  fields: [
    {
      key: "takeoverStatus",
      label: "经营接管状态",
      description: "项目历史经营资料的接管状态。",
      example: "正在接管",
      type: "single_select",
      scope: "header",
      unit: "",
      precision: 0,
      required: true,
      options: [{ value: "operating_with_takeover", label: "正式使用、历史接管中" }],
      permissions: { view: ["finance_staff"], edit: ["finance_staff"] },
      display: {
        formHint: "选择经营接管状态",
        gridColumn: "经营接管状态",
        mobilePriority: 1,
        readonlyText: "提交后按冻结快照展示"
      },
      excel: { column: "经营接管状态", paste: "single", errorLocation: "cell" },
      bulk: { enabled: true, maxRows: 1, strategy: "replace" }
    }
  ],
  rules: []
};

const companyDefinition: BusinessEntrySceneDefinition = {
  ...definition,
  key: "company_profile",
  entityType: "company_entity",
  name: "我方公司资料",
  description: "维护我方公司受控基础资料。",
  version: 1,
  fields: definition.fields.map((field) => ({
    ...field,
    key: "name",
    label: "公司名称",
    description: "我方公司的正式中文名称。",
    example: "上海示例建设有限公司",
    type: "text",
    options: undefined,
    permissions: {
      view: COMPANY_ENTITY_MAINTAINER_ROLES,
      edit: COMPANY_ENTITY_MAINTAINER_ROLES,
      import: COMPANY_ENTITY_MAINTAINER_ROLES,
      export: COMPANY_ENTITY_MAINTAINER_ROLES
    }
  }))
};

function accessRegistry(
  definitions: readonly BusinessEntrySceneDefinition[],
  resolveGlobalTarget = jest.fn().mockResolvedValue(true)
) {
  return createBusinessEntrySceneAccessRegistry(definitions, definitions.map((item) =>
    item.key === "company_profile"
      ? {
          sceneKey: item.key,
          target: {
            scope: "global",
            entityType: "company_entity",
            resolve: resolveGlobalTarget
          },
          permission: {
            kind: "role_keys",
            roleKeys: COMPANY_ENTITY_MAINTAINER_ROLES,
            roleScope: "global"
          }
        }
      : {
          sceneKey: item.key,
          target: { scope: "project", entityType: "project" },
          permission: {
            kind: "business_action",
            action: "project.operating_profile.manage",
            roleScope: "project"
          }
        }
  ) as never);
}

function projectPrisma() {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: "project-1" })
    },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

function projectVisibility(roleKeys: readonly string[]) {
  return {
    effectiveRoleScopes: jest.fn().mockResolvedValue({
      globalRoleKeys: [],
      projectRoleKeys: roleKeys
    })
  };
}

function snapshotStoreMock(saveStandalone = jest.fn()) {
  return {
    saveStandalone,
    saveInTransaction: jest.fn()
  };
}

function authorizationMock() {
  return { assertAuthorized: jest.fn() } as never;
}

const projectTarget = { entityType: "project", entityId: "project-1" } as const;
const ownerSettlementTarget = {
  entityType: "operating_takeover_row",
  entityId: "project-1"
} as const;
const companyTarget = { entityType: "company_entity", entityId: "company-1" } as const;

describe("BusinessEntryDefinitionService", () => {
  it("uses the canonical company-role resolver for business-party scenes", async () => {
    const partyDefinition = {
      ...definition,
      key: "business_party",
      entityType: "business_party",
      fields: definition.fields.map((field) => ({
        ...field,
        permissions: {
          view: ["contract_staff"] as const,
          edit: ["contract_staff"] as const,
          import: ["contract_staff"] as const
        }
      }))
    };
    const resolver = {
      resolveActiveRoleScopes: jest.fn().mockResolvedValue(["contract_staff"])
    };
    const targetResolver = jest.fn().mockResolvedValue(true);
    const service = new BusinessEntryDefinitionService(
      createBusinessEntryDefinitionRegistry([partyDefinition]),
      createBusinessEntrySceneAccessRegistry([partyDefinition], [{
        sceneKey: "business_party",
        target: {
          scope: "global",
          entityType: "business_party",
          resolve: targetResolver
        },
        permission: {
          kind: "role_keys",
          roleKeys: ["contract_staff"],
          roleScope: "global"
        }
      }]),
      { effectiveRoleScopes: jest.fn() },
      snapshotStoreMock(),
      { project: { findUnique: jest.fn() } } as never,
      authorizationMock(),
      undefined,
      resolver as never
    );

    await expect(service.getSceneDefinition(
      "business_party",
      undefined,
      "user-1",
      { entityType: "business_party", entityId: "party-1" }
    )).resolves.toMatchObject({ key: "business_party" });
    expect(resolver.resolveActiveRoleScopes).toHaveBeenCalledWith("user-1");
    expect(targetResolver).toHaveBeenCalled();
  });

  it("issues an independent submission target after a fresh probe and capability check", async () => {
    const partyDefinition = {
      ...definition,
      key: "business_party",
      entityType: "business_party",
      fields: definition.fields.map((field) => ({
        ...field,
        permissions: {
          view: ["contract_staff"] as const,
          edit: ["contract_staff"] as const,
          import: ["contract_staff"] as const
        }
      }))
    };
    const resolver = {
      resolveActiveRoleScopes: jest.fn().mockResolvedValue(["contract_staff"])
    };
    const authorization = { assertAuthorized: jest.fn() };
    const createTargets = new BusinessEntryCreateTargetService();
    const service = new BusinessEntryDefinitionService(
      createBusinessEntryDefinitionRegistry([partyDefinition]),
      createBusinessEntrySceneAccessRegistry([partyDefinition], [{
        sceneKey: "business_party",
        target: {
          scope: "global",
          entityType: "business_party",
          resolve: jest.fn().mockResolvedValue(true)
        },
        permission: {
          kind: "business_action",
          action: "business_party.create",
          roleScope: "global"
        }
      }]),
      { effectiveRoleScopes: jest.fn() },
      snapshotStoreMock(),
      {
        project: { findUnique: jest.fn() }
      } as never,
      authorization as never,
      createTargets,
      resolver as never,
      { assertCanWrite: jest.fn() } as never
    );
    const intent = {
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      fingerprint: "a".repeat(64),
      definitionKey: "business_party",
      definitionVersion: partyDefinition.version
    };
    const probe = createTargets.issue({
      actorUserId: "user-1",
      scene: "business_party",
      entityType: "business_party",
      scope: "global",
      action: "business_party.create",
      ...intent,
      purpose: "definition_probe"
    });

    const submission = await service.issueSubmissionTarget(
      "business_party",
      undefined,
      "user-1",
      { entityType: "business_party", probe: probe.createTarget, ...intent }
    );

    expect(submission.target.createTarget).not.toBe(probe.createTarget);
    expect(createTargets.verify(submission.target.createTarget, {
      actorUserId: "user-1",
      scene: "business_party",
      entityType: "business_party",
      scope: "global",
      action: "business_party.create",
      ...intent,
      purpose: "submission"
    })).toMatchObject({ purpose: "submission" });
    expect(authorization.assertAuthorized).toHaveBeenCalledWith(expect.objectContaining({
      sceneKey: "business_party",
      actorUserId: "user-1",
      operation: "edit",
      target: { entityType: "business_party", createTarget: probe.createTarget }
    }));
  });

  it("rejects a submission target for definition reads and a probe for validation", async () => {
    const partyDefinition = {
      ...definition,
      key: "business_party",
      entityType: "business_party",
      fields: definition.fields.map((field) => ({
        ...field,
        permissions: {
          view: ["contract_staff"] as const,
          edit: ["contract_staff"] as const,
          import: ["contract_staff"] as const
        }
      }))
    };
    const resolver = { resolveActiveRoleScopes: jest.fn().mockResolvedValue(["contract_staff"]) };
    const createTargets = new BusinessEntryCreateTargetService();
    const writeFreeze = { assertCanWrite: jest.fn() };
    const service = new BusinessEntryDefinitionService(
      createBusinessEntryDefinitionRegistry([partyDefinition]),
      createBusinessEntrySceneAccessRegistry([partyDefinition], [{
        sceneKey: "business_party",
        target: {
          scope: "global",
          entityType: "business_party",
          resolve: jest.fn().mockResolvedValue(true)
        },
        permission: {
          kind: "business_action",
          action: "business_party.create",
          roleScope: "global"
        }
      }]),
      { effectiveRoleScopes: jest.fn() },
      snapshotStoreMock(),
      { project: { findUnique: jest.fn() } } as never,
      { assertAuthorized: jest.fn() } as never,
      createTargets,
      resolver as never,
      writeFreeze as never
    );
    const intent = {
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      fingerprint: "b".repeat(64),
      definitionKey: "business_party",
      definitionVersion: partyDefinition.version
    };
    const probe = createTargets.issue({
      actorUserId: "user-1",
      scene: "business_party",
      entityType: "business_party",
      scope: "global",
      action: "business_party.create",
      ...intent,
      purpose: "definition_probe"
    });
    const submission = createTargets.issue({
      actorUserId: "user-1",
      scene: "business_party",
      entityType: "business_party",
      scope: "global",
      action: "business_party.create",
      ...intent,
      purpose: "submission"
    });

    await expect(service.getSceneDefinitionForOperation(
      "business_party",
      undefined,
      "user-1",
      "edit",
      { entityType: "business_party", createTarget: submission.createTarget }
    )).rejects.toThrow("新建目标令牌无效");
    await expect(service.validateDraft(
      "business_party",
      undefined,
      "user-1",
      {
        definitionVersion: partyDefinition.version,
        target: { entityType: "business_party", createTarget: probe.createTarget },
        values: { takeoverStatus: "operating_with_takeover" }
      }
    )).rejects.toThrow("新建目标令牌无效");
    await expect(service.freezeSubmissionSnapshot(
      "business_party",
      undefined,
      "user-1",
      {
        definitionVersion: partyDefinition.version,
        target: { entityType: "business_party", createTarget: probe.createTarget },
        values: { takeoverStatus: "operating_with_takeover" }
      }
    )).rejects.toThrow("新建目标令牌无效");
    await expect(service.freezeSubmissionSnapshot(
      "business_party",
      undefined,
      "user-1",
      {
        definitionVersion: partyDefinition.version,
        target: { entityType: "business_party", createTarget: submission.createTarget },
        values: { takeoverStatus: "operating_with_takeover" }
      }
    )).resolves.toMatchObject({
      sceneKey: "business_party",
      target: { createTarget: submission.createTarget },
      values: { takeoverStatus: "operating_with_takeover" }
    });

    writeFreeze.assertCanWrite.mockImplementation(() => {
      throw new Error("master-data-frozen");
    });
    await expect(service.getSceneDefinitionForOperation(
      "business_party",
      undefined,
      "user-1",
      "edit",
      { entityType: "business_party", createTarget: probe.createTarget }
    )).rejects.toThrow("master-data-frozen");
  });

  it("fails closed across create-target, validation, and freeze when domain authorization is missing", async () => {
    const snapshots = snapshotStoreMock(
      jest.fn().mockImplementation(async (_projectId, _userId, snapshot) => snapshot)
    );
    const createTargets = {
      issue: jest.fn().mockReturnValue({ createTarget: "signed-create-target" })
    };
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ id: "project-1" }) },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
      },
      position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) }
    };
    const service = new BusinessEntryDefinitionService(
      createBusinessEntryDefinitionRegistry([definition, companyDefinition]),
      accessRegistry([definition, companyDefinition]),
      projectVisibility(["finance_staff"]),
      snapshots,
      prisma as never,
      undefined as never,
      createTargets as never
    );
    const input = {
      definitionVersion: 3,
      target: projectTarget,
      values: { takeoverStatus: "operating_with_takeover" }
    };

    await expect(service.issueCreateTarget(
      "company_profile",
      undefined,
      "user-1",
      "company_entity"
    )).rejects.toThrow("业务场景缺少领域授权服务");
    await expect(service.validateDraft(
      "project_operating_profile",
      "project-1",
      "user-1",
      input
    )).rejects.toThrow("业务场景缺少领域授权服务");
    await expect(service.freezeSubmissionSnapshot(
      "project_operating_profile",
      "project-1",
      "user-1",
      input
    )).rejects.toThrow("业务场景缺少领域授权服务");

    expect(createTargets.issue).not.toHaveBeenCalled();
    expect(snapshots.saveStandalone).not.toHaveBeenCalled();
  });

  it("fails closed in role-based validation when domain authorization is missing", async () => {
    const service = new BusinessEntryDefinitionService(
      createBusinessEntryDefinitionRegistry([companyDefinition]),
      accessRegistry([companyDefinition]),
      { effectiveRoleScopes: jest.fn() },
      snapshotStoreMock(),
      projectPrisma() as never,
      undefined as never
    );

    await expect(service.validateDraftWithRoles(
      "company_profile",
      undefined,
      [],
      {
        definitionVersion: 1,
        target: companyTarget,
        values: { name: "上海示例建设有限公司" }
      }
    )).rejects.toThrow("业务场景缺少领域授权服务");
  });

  it("fails closed in batch validation when domain authorization is missing", async () => {
    const service = new BusinessEntryDefinitionService(
      createBusinessEntryDefinitionRegistry([definition]),
      accessRegistry([definition]),
      projectVisibility(["finance_staff"]),
      snapshotStoreMock(),
      projectPrisma() as never,
      undefined as never
    );

    await expect(service.validateDraftBatch(
      "project_operating_profile",
      "project-1",
      "user-1",
      [{
        definitionVersion: 3,
        target: projectTarget,
        values: { takeoverStatus: "operating_with_takeover" },
        operation: "import"
      }]
    )).rejects.toThrow("业务场景缺少领域授权服务");
  });

  it("fails closed in transaction freeze when domain authorization is missing", async () => {
    const snapshots = snapshotStoreMock();
    const service = new BusinessEntryDefinitionService(
      createBusinessEntryDefinitionRegistry([definition]),
      accessRegistry([definition]),
      projectVisibility(["finance_staff"]),
      snapshots,
      projectPrisma() as never,
      undefined as never
    );

    await expect(service.freezeSubmissionSnapshotInTransaction(
      {} as Prisma.TransactionClient,
      "project_operating_profile",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: projectTarget,
        values: { takeoverStatus: "operating_with_takeover" }
      }
    )).rejects.toThrow("业务场景缺少领域授权服务");
    expect(snapshots.saveInTransaction).not.toHaveBeenCalled();
  });

  it("freezes and persists through the caller's existing Prisma transaction client", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const tx = {} as Prisma.TransactionClient;
    const snapshots = {
      saveStandalone: jest.fn(),
      saveInTransaction: jest.fn().mockImplementation(
        async (_tx, _projectId, _userId, snapshot) => snapshot
      )
    };
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([definition]),
      projectVisibility(["finance_staff"]),
      snapshots,
      projectPrisma() as never,
      authorizationMock()
    );

    await expect(service.freezeSubmissionSnapshotInTransaction(
      tx,
      "project_operating_profile",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "project", entityId: "project-1" },
        values: { takeoverStatus: "operating_with_takeover" }
      },
      "2026-08-17T10:00:00.000Z"
    )).resolves.toMatchObject({
      sceneKey: "project_operating_profile",
      frozenAt: "2026-08-17T10:00:00.000Z"
    });

    expect(snapshots.saveInTransaction).toHaveBeenCalledWith(
      tx,
      "project-1",
      "user-1",
      expect.objectContaining({
        target: { entityType: "project", entityId: "project-1" }
      }),
      undefined
    );
    expect(snapshots.saveStandalone).not.toHaveBeenCalled();
  });

  it("fails closed when the joined-transaction API is used for a global scene", async () => {
    const registry = createBusinessEntryDefinitionRegistry([companyDefinition]);
    const snapshots = snapshotStoreMock();
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([companyDefinition]),
      { effectiveRoleScopes: jest.fn() },
      snapshots,
      {
        project: { findUnique: jest.fn() },
        userPosition: {
          findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
        },
        position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) }
      } as never,
      authorizationMock()
    );

    await expect(service.freezeSubmissionSnapshotInTransaction(
      {} as Prisma.TransactionClient,
      "company_profile",
      undefined,
      "user-1",
      {
        definitionVersion: 1,
        target: { entityType: "company_entity", entityId: "company-1" },
        values: { name: "上海示例建设有限公司" }
      },
      "2026-08-17T10:00:00.000Z"
    )).rejects.toThrow("全局业务场景须由所属领域在同一事务中持久化正式快照");

    expect(snapshots.saveInTransaction).not.toHaveBeenCalled();
    expect(snapshots.saveStandalone).not.toHaveBeenCalled();
  });

  it("uses server-resolved project roles for validation and freezes the accepted version", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = projectVisibility(["finance_staff"]);
    const snapshots = snapshotStoreMock(
      jest.fn().mockImplementation(async (_projectId, _userId, snapshot) => snapshot)
    );
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([definition]),
      visibility,
      snapshots,
      projectPrisma() as never,
      authorizationMock()
    );

    const result = await service.validateDraft(
      "project_operating_profile",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "project", entityId: "project-1" },
        values: { takeoverStatus: "operating_with_takeover" }
      }
    );

    expect(result.valid).toBe(true);
    expect(visibility.effectiveRoleScopes).toHaveBeenCalledWith("user-1", "project-1");

    const snapshot = await service.freezeSubmissionSnapshot(
      "project_operating_profile",
      "project-1",
      "user-1",
      {
        definitionVersion: 3,
        target: { entityType: "project", entityId: "project-1" },
        values: { takeoverStatus: "operating_with_takeover" }
      },
      "2026-08-16T10:00:00.000Z"
    );

    expect(snapshot.definitionVersion).toBe(3);
    expect(snapshot.frozenAt).toBe("2026-08-16T10:00:00.000Z");
    expect(snapshots.saveStandalone).toHaveBeenCalledWith(
      "project-1",
      "user-1",
      expect.objectContaining({ target: { entityType: "project", entityId: "project-1" } }),
      undefined
    );
  });

  it("does not trust caller-supplied roles and maps invalid drafts to a bad request", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = projectVisibility(["project_manager"]);
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([definition]),
      visibility,
      snapshotStoreMock(),
      projectPrisma() as never,
      authorizationMock()
    );

    await expect(
      service.freezeSubmissionSnapshot(
        "project_operating_profile",
        "project-1",
        "user-1",
        {
          definitionVersion: 3,
          target: { entityType: "project", entityId: "project-1" },
          values: { takeoverStatus: "operating_with_takeover" },
          effectiveRoleKeys: ["finance_staff"]
        } as never,
        "2026-08-16T10:00:00.000Z"
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects wrong-domain and cross-project targets before validation or freeze", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = projectVisibility(["finance_staff"]);
    const snapshots = snapshotStoreMock();
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([definition]),
      visibility,
      snapshots,
      projectPrisma() as never,
      authorizationMock()
    );

    const wrongDomainInput = {
      definitionVersion: 3,
      target: { entityType: "company_entity", entityId: "project-1" },
      values: { takeoverStatus: "operating_with_takeover" }
    };
    const crossProjectInput = {
      definitionVersion: 3,
      target: { entityType: "project", entityId: "project-2" },
      values: { takeoverStatus: "operating_with_takeover" }
    };

    await expect(
      service.validateDraft("project_operating_profile", "project-1", "user-1", wrongDomainInput)
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.freezeSubmissionSnapshot(
        "project_operating_profile",
        "project-1",
        "user-1",
        wrongDomainInput
      )
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.validateDraft("project_operating_profile", "project-1", "user-1", crossProjectInput)
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.freezeSubmissionSnapshot(
        "project_operating_profile",
        "project-1",
        "user-1",
        crossProjectInput
      )
    ).rejects.toThrow(BadRequestException);
    expect(snapshots.saveStandalone).not.toHaveBeenCalled();
  });

  it("does not expose a definition to a project role without any visible fields", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = projectVisibility(["project_manager"]);
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([definition]),
      visibility,
      snapshotStoreMock(),
      projectPrisma() as never,
      authorizationMock()
    );

    await expect(
      service.getSceneDefinition("project_operating_profile", "project-1", "user-1", projectTarget)
    ).rejects.toThrow(ForbiddenException);
  });

  it("preserves project-only role semantics for the operating profile scene", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = {
      effectiveRoleScopes: jest.fn().mockResolvedValue({
        globalRoleKeys: ["finance_staff"],
        projectRoleKeys: []
      })
    };
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([definition]),
      visibility,
      snapshotStoreMock(),
      projectPrisma() as never,
      authorizationMock()
    );

    await expect(service.getSceneDefinition(
      "project_operating_profile",
      "project-1",
      "user-1",
      projectTarget
    )).rejects.toThrow(ForbiddenException);
  });

  it("rejects a global-only contract staff role for project operating takeover", async () => {
    const service = new BusinessEntryDefinitionService(
      registeredDefinitions,
      registeredAccess,
      {
        effectiveRoleScopes: jest.fn().mockResolvedValue({
          globalRoleKeys: ["contract_staff"],
          projectRoleKeys: []
        })
      },
      snapshotStoreMock(),
      projectPrisma() as never,
      authorizationMock()
    );

    await expect(service.getSceneDefinitionForOperation(
      "owner_settlement",
      "project-1",
      "user-1",
      "import",
      ownerSettlementTarget
    )).rejects.toThrow(ForbiddenException);
  });

  it("allows project contract staff and canonical global contract director for takeover", async () => {
    for (const scopes of [
      { globalRoleKeys: [], projectRoleKeys: ["contract_staff"] },
      { globalRoleKeys: ["contract_director"], projectRoleKeys: [] }
    ]) {
      const service = new BusinessEntryDefinitionService(
        registeredDefinitions,
        registeredAccess,
        { effectiveRoleScopes: jest.fn().mockResolvedValue(scopes) },
        snapshotStoreMock(),
        projectPrisma() as never,
        authorizationMock()
      );

      await expect(service.getSceneDefinitionForOperation(
        "owner_settlement",
        "project-1",
        "user-1",
        "import",
        ownerSettlementTarget
      )).resolves.toMatchObject({ key: "owner_settlement" });
    }
  });

  it("serves only the code-registered project operating profile scene", () => {
    const scene = registeredDefinitions.getSceneDefinition("project_operating_profile");

    expect(scene.version).toBe(1);
    expect(scene.fields.map((field) => field.key)).toEqual([
      "operatingLedgerEffectiveDate",
      "takeoverCompletedDate",
      "takeoverStatus"
    ]);
  });

  it("resolves import fields and validates an Excel batch with one authoritative role lookup", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = projectVisibility(["finance_staff"]);
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([definition]),
      visibility,
      snapshotStoreMock(),
      projectPrisma() as never,
      authorizationMock()
    );

    await expect(service.getSceneDefinitionForOperation(
      "project_operating_profile",
      "project-1",
      "user-1",
      "import",
      projectTarget
    )).resolves.toMatchObject({ key: "project_operating_profile", version: 3 });

    const results = await service.validateDraftBatch(
      "project_operating_profile",
      "project-1",
      "user-1",
      [
        {
          definitionVersion: 3,
          target: { entityType: "project", entityId: "project-1" },
          values: { takeoverStatus: "operating_with_takeover" },
          operation: "import"
        },
        {
          definitionVersion: 3,
          target: { entityType: "project", entityId: "project-1" },
          values: { takeoverStatus: "not_registered" },
          operation: "import"
        }
      ]
    );

    expect(results.map((result) => result.valid)).toEqual([true, false]);
    expect(visibility.effectiveRoleScopes).toHaveBeenCalledTimes(2);
  });

  it("fails closed instead of returning an unpersisted global freeze snapshot", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition, companyDefinition]);
    const visibility = { effectiveRoleScopes: jest.fn() };
    const snapshots = snapshotStoreMock();
    const prisma = {
      project: { findUnique: jest.fn() },
      userPosition: {
        findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
      },
      position: {
        findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }])
      }
    };
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([definition, companyDefinition]),
      visibility,
      snapshots,
      prisma as never,
      authorizationMock()
    );
    const input = {
      definitionVersion: 1,
      target: { entityType: "company_entity", entityId: "company-1" },
      values: { name: "上海示例建设有限公司" }
    };

    await expect(service.getSceneDefinitionForOperation(
      "company_profile",
      undefined,
      "user-1",
      "import",
      companyTarget
    )).resolves.toMatchObject({ key: "company_profile" });
    await expect(service.validateDraft(
      "company_profile",
      undefined,
      "user-1",
      input
    )).resolves.toMatchObject({ valid: true });
    await expect(service.freezeSubmissionSnapshot(
      "company_profile",
      undefined,
      "user-1",
      input,
      "2026-08-16T10:00:00.000Z"
    )).rejects.toThrow("全局业务场景须由所属领域在同一事务中持久化正式快照");

    expect(prisma.project.findUnique).not.toHaveBeenCalled();
    expect(prisma.userPosition.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", projectId: null },
      select: { positionId: true }
    });
    expect(visibility.effectiveRoleScopes).not.toHaveBeenCalled();
    expect(snapshots.saveStandalone).not.toHaveBeenCalled();
  });

  it("fails closed when a global target resolver rejects a missing or foreign same-type id", async () => {
    const resolveGlobalTarget = jest.fn().mockResolvedValue(false);
    const service = new BusinessEntryDefinitionService(
      createBusinessEntryDefinitionRegistry([companyDefinition]),
      accessRegistry([companyDefinition], resolveGlobalTarget),
      { effectiveRoleScopes: jest.fn() },
      snapshotStoreMock(),
      {
        project: { findUnique: jest.fn() },
        userPosition: {
          findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
        },
        position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) }
      } as never,
      authorizationMock()
    );
    const input = {
      definitionVersion: 1,
      target: { entityType: "company_entity", entityId: "company-missing" },
      values: { name: "不存在的公司" }
    };

    await expect(service.validateDraft(
      "company_profile",
      undefined,
      "user-1",
      input
    )).rejects.toThrow(BadRequestException);
    await expect(service.freezeSubmissionSnapshot(
      "company_profile",
      undefined,
      "user-1",
      input
    )).rejects.toThrow(BadRequestException);
    expect(resolveGlobalTarget).toHaveBeenCalledTimes(2);
  });

  it("routes an empty Excel batch through the target contract", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("我方公司资料").addRow(["经营接管状态"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
    const validateDraftBatch = jest.fn().mockImplementation(async (
      _sceneKey: string,
      _projectId: string | undefined,
      _actorUserId: string,
      inputs: readonly unknown[]
    ) => {
      if (inputs.length === 0) return [];
      throw new BadRequestException("提交对象不存在或不属于当前业务范围");
    });
    const excel = new BusinessEntryExcelService({
      getSceneDefinitionForOperation: jest.fn().mockResolvedValue(companyDefinition),
      validateDraftBatch
    } as never);

    await expect(excel.preview(
      "company_profile",
      undefined,
      "user-1",
      {
        definitionVersion: 1,
        target: { entityType: "company_entity", entityId: "company-missing" }
      },
      {
        originalname: "我方公司资料.xlsx",
        mimetype: BUSINESS_ENTRY_XLSX_MIME,
        size: buffer.length,
        buffer
      }
    )).rejects.toThrow(BadRequestException);
    expect(validateDraftBatch).toHaveBeenCalledWith(
      "company_profile",
      undefined,
      "user-1",
      [expect.objectContaining({
        target: { entityType: "company_entity", entityId: "company-missing" },
        values: {},
        operation: "import"
      })]
    );
  });

  it("fails closed for a global role without the registered domain permission", async () => {
    const registry = createBusinessEntryDefinitionRegistry([companyDefinition]);
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([companyDefinition]),
      { effectiveRoleScopes: jest.fn() },
      snapshotStoreMock(),
      {
        project: { findUnique: jest.fn() },
        userPosition: { findMany: jest.fn().mockResolvedValue([{ positionId: "finance" }]) },
        position: { findMany: jest.fn().mockResolvedValue([{ key: "finance_staff" }]) }
      } as never,
      authorizationMock()
    );

    await expect(service.getSceneDefinition(
      "company_profile",
      undefined,
      "user-1",
      companyTarget
    )).rejects.toThrow(ForbiddenException);
  });

  it("rejects project context and cross-domain targets for a global scene", async () => {
    const registry = createBusinessEntryDefinitionRegistry([companyDefinition]);
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([companyDefinition]),
      { effectiveRoleScopes: jest.fn() },
      snapshotStoreMock(),
      {
        project: { findUnique: jest.fn() },
        userPosition: {
          findMany: jest.fn().mockResolvedValue([{ positionId: "position-contract-staff" }])
        },
        position: { findMany: jest.fn().mockResolvedValue([{ key: "contract_staff" }]) }
      } as never,
      authorizationMock()
    );
    const input = {
      definitionVersion: 1,
      target: { entityType: "project", entityId: "company-1" },
      values: { name: "上海示例建设有限公司" }
    };

    await expect(service.validateDraft(
      "company_profile",
      "project-1",
      "user-1",
      { ...input, target: { entityType: "company_entity", entityId: "company-1" } }
    )).rejects.toThrow(BadRequestException);
    await expect(service.validateDraft(
      "company_profile",
      "",
      "user-1",
      { ...input, target: { entityType: "company_entity", entityId: "company-1" } }
    )).rejects.toThrow(BadRequestException);
    await expect(service.validateDraft(
      "company_profile",
      undefined,
      "user-1",
      input
    )).rejects.toThrow(BadRequestException);
    await expect(service.validateDraftWithRoles(
      "company_profile",
      "project-1",
      ["contract_staff"],
      { ...input, target: { entityType: "company_entity", entityId: "company-1" } }
    )).rejects.toThrow(BadRequestException);
  });

  it("fails closed before role lookup for an unknown scene", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = { effectiveRoleScopes: jest.fn() };
    const service = new BusinessEntryDefinitionService(
      registry,
      accessRegistry([definition]),
      visibility,
      snapshotStoreMock(),
      projectPrisma() as never,
      authorizationMock()
    );

    await expect(service.getSceneDefinition(
      "not_registered",
      "project-1",
      "user-1",
      projectTarget
    )).rejects.toThrow(NotFoundException);
    expect(visibility.effectiveRoleScopes).not.toHaveBeenCalled();
  });
});
