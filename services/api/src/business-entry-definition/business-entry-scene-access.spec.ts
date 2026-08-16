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

describe("BusinessEntrySceneAccessRegistry", () => {
  it("binds every production scene to its backend target and domain action", () => {
    for (const definition of BUSINESS_ENTRY_SCENE_DEFINITIONS) {
      const access = BUSINESS_ENTRY_ACCESS_REGISTRY.get(definition.key);

      expect(access.target).toEqual({
        scope: "project",
        entityType: definition.entityType
      });
      expect(access.permission).toEqual(
        definition.key === "project_operating_profile"
          ? {
              kind: "business_action",
              action: "project.operating_profile.manage",
              roleScope: "project"
            }
          : {
              kind: "business_action",
              action: "operating_takeover.manage",
              roleScope: "effective"
            }
      );
    }
  });

  it("registers production access only from the explicit profile and takeover scene families", () => {
    expect(BUSINESS_ENTRY_SCENE_ACCESS_POLICIES.map((policy) => policy.sceneKey)).toEqual([
      "project_operating_profile",
      ...OPERATING_TAKEOVER_SCENE_DEFINITIONS.map((definition) => definition.key)
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
