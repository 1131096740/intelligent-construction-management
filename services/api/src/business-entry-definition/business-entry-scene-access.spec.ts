import {
  COMPANY_ENTITY_MAINTAINER_ROLES,
  OPERATING_TAKEOVER_SCENE_DEFINITIONS,
  type BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import {
  BUSINESS_ENTRY_ACCESS_REGISTRY,
  BUSINESS_ENTRY_SCENE_ACCESS_POLICIES,
  BUSINESS_ENTRY_SCENE_DEFINITIONS
} from "./business-entry-definition.scene-registry";
import { createBusinessEntrySceneAccessRegistry } from "./business-entry-scene-access";

const globalDefinition: BusinessEntrySceneDefinition = {
  ...BUSINESS_ENTRY_SCENE_DEFINITIONS[0]!,
  key: "company_profile",
  entityType: "company_entity",
  name: "我方公司资料"
};

const POL19P3_SCENE_KEYS = [
  "department",
  "organization_user",
  "user_role_assignment_command",
  "company_entity",
  "business_party",
  "contract_business_template",
  "contract_layout_template_version",
  "standard_clause_version",
  "settlement_template_version",
  "user_self_profile"
] as const;

describe("BusinessEntrySceneAccessRegistry", () => {
  it("binds every production scene to its backend target and domain action", () => {
    for (const definition of BUSINESS_ENTRY_SCENE_DEFINITIONS) {
      const access = BUSINESS_ENTRY_ACCESS_REGISTRY.get(definition.key);

      expect(access.target.scope).toBe(
        POL19P3_SCENE_KEYS.includes(definition.key as typeof POL19P3_SCENE_KEYS[number])
          ? "global"
          : "project"
      );
      expect(access.target.entityType).toBe(definition.entityType);
      if (access.target.scope === "global") {
        expect(access.target.resolve).toEqual(expect.any(Function));
      }
      expect(access.permission).toEqual(
        definition.key === "project_operating_profile"
          ? {
              kind: "business_action",
              action: "project.operating_profile.manage",
              roleScope: "project"
            }
          : OPERATING_TAKEOVER_SCENE_DEFINITIONS.some((item) => item.key === definition.key)
            ? {
              kind: "business_action",
              action: "operating_takeover.manage",
              roleScope: "effective"
            }
            : definition.key === "user_self_profile"
              ? { kind: "authenticated_self", roleScope: "global" }
              : definition.key === "business_party"
                ? {
                    kind: "business_action",
                    action: "business_party.create",
                    roleScope: "global"
                  }
              : expect.objectContaining({ kind: "role_keys", roleScope: "global" })
      );
    }
  });

  it("registers production access only from the explicit profile and takeover scene families", () => {
    expect(BUSINESS_ENTRY_SCENE_ACCESS_POLICIES.map((policy) => policy.sceneKey)).toEqual([
      "project_operating_profile",
      ...OPERATING_TAKEOVER_SCENE_DEFINITIONS.map((definition) => definition.key),
      ...POL19P3_SCENE_KEYS
    ]);

    expect(() => createBusinessEntrySceneAccessRegistry(
      [...BUSINESS_ENTRY_SCENE_DEFINITIONS, globalDefinition],
      BUSINESS_ENTRY_SCENE_ACCESS_POLICIES
    )).toThrow("业务场景缺少授权契约：company_profile");
  });

  it("freezes the registered backend access contract", () => {
    const access = BUSINESS_ENTRY_ACCESS_REGISTRY.get("project_operating_profile");

    expect(Object.isFrozen(access)).toBe(true);
    expect(Object.isFrozen(access.target)).toBe(true);
    expect(Object.isFrozen(access.permission)).toBe(true);
  });

  it("passes the actor-aware resolver context instead of a static target only", async () => {
    const resolver = jest.fn().mockResolvedValue(true);
    const definition = BUSINESS_ENTRY_SCENE_DEFINITIONS[0]!;
    const registry = createBusinessEntrySceneAccessRegistry(
      [{ ...definition, key: "resolver_context", entityType: "company_entity" }],
      [{
        sceneKey: "resolver_context",
        target: { scope: "global", entityType: "company_entity", resolve: resolver },
        permission: {
          kind: "role_keys",
          roleKeys: COMPANY_ENTITY_MAINTAINER_ROLES,
          roleScope: "global"
        }
      }]
    );

    await registry.get("resolver_context").target.resolve!({
      target: { entityType: "company_entity", entityId: "company-1" },
      actorUserId: "actor-1",
      operation: "edit",
      scene: "resolver_context",
      scope: "global",
      prisma: {} as never
    });

    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "actor-1",
      operation: "edit",
      scene: "resolver_context",
      scope: "global"
    }));
  });

  it("fails closed when a registered scene has no access policy", () => {
    expect(() => createBusinessEntrySceneAccessRegistry(
      [BUSINESS_ENTRY_SCENE_DEFINITIONS[0]!],
      []
    )).toThrow("业务场景缺少授权契约");
  });

  it("fails closed when a policy targets another domain", () => {
    const definition = BUSINESS_ENTRY_SCENE_DEFINITIONS[0]!;

    expect(() => createBusinessEntrySceneAccessRegistry(
      [definition],
      [{
        sceneKey: definition.key,
        target: { scope: "global", entityType: "company_entity" },
        permission: {
          kind: "role_keys",
          roleKeys: COMPANY_ENTITY_MAINTAINER_ROLES,
          roleScope: "global"
        }
      }] as never
    )).toThrow("业务场景目标类型与定义不一致");
  });

  it("fails closed when a global target has no domain resolver", () => {
    expect(() => createBusinessEntrySceneAccessRegistry(
      [globalDefinition],
      [{
        sceneKey: globalDefinition.key,
        target: { scope: "global", entityType: globalDefinition.entityType },
        permission: {
          kind: "role_keys",
          roleKeys: COMPANY_ENTITY_MAINTAINER_ROLES,
          roleScope: "global"
        }
      }] as never
    )).toThrow("全局业务场景缺少目标解析器：company_profile");
  });

  it("rejects incompatible global target and project role scope at registration", () => {
    expect(() => createBusinessEntrySceneAccessRegistry(
      [globalDefinition],
      [{
        sceneKey: globalDefinition.key,
        target: {
          scope: "global",
          entityType: globalDefinition.entityType,
          resolve: jest.fn().mockResolvedValue(true)
        },
        permission: {
          kind: "business_action",
          action: "contract.create",
          roleScope: "project"
        }
      }] as never
    )).toThrow("业务场景目标范围与岗位范围不兼容：company_profile");
  });

  it("rejects an unknown target scope at registration", () => {
    const definition = BUSINESS_ENTRY_SCENE_DEFINITIONS[0]!;

    expect(() => createBusinessEntrySceneAccessRegistry(
      [definition],
      [{
        sceneKey: definition.key,
        target: { scope: "tenant", entityType: definition.entityType },
        permission: {
          kind: "role_keys",
          roleKeys: COMPANY_ENTITY_MAINTAINER_ROLES,
          roleScope: "global"
        }
      }] as never
    )).toThrow("业务场景目标范围未登记：project_operating_profile");
  });

  it("rejects an unknown permission kind at registration", () => {
    const definition = BUSINESS_ENTRY_SCENE_DEFINITIONS[0]!;

    expect(() => createBusinessEntrySceneAccessRegistry(
      [definition],
      [{
        sceneKey: definition.key,
        target: { scope: "project", entityType: definition.entityType },
        permission: {
          kind: "custom",
          roleScope: "project"
        }
      }] as never
    )).toThrow("业务场景权限类型未登记：project_operating_profile");
  });

  it("fails closed when a policy references an unknown scene", () => {
    expect(() => createBusinessEntrySceneAccessRegistry(
      [],
      [{
        sceneKey: "not_registered",
        target: { scope: "global", entityType: "company_entity" },
        permission: {
          kind: "role_keys",
          roleKeys: COMPANY_ENTITY_MAINTAINER_ROLES,
          roleScope: "global"
        }
      }] as never
    )).toThrow("业务场景授权契约引用未注册场景");
  });
});
