import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import {
  createBusinessEntryTransactionSceneRegistry,
  type BusinessEntryTransactionScenePolicy
} from "./business-entry-transaction-scene-registry";

const definition = {
  key: "contract_formal_entry",
  entityType: "contract_version"
} as BusinessEntrySceneDefinition;

function policy(
  overrides: Partial<BusinessEntryTransactionScenePolicy> = {}
): BusinessEntryTransactionScenePolicy {
  return {
    sceneKey: definition.key,
    targetKind: "project_owned_entity",
    entityType: definition.entityType,
    action: "contract.submit",
    resolveOwnership: jest.fn().mockResolvedValue([{ projectId: "project-1" }]),
    resolveAuthorization: jest.fn().mockResolvedValue(["contract_staff"]),
    ...overrides
  };
}

describe("BusinessEntryTransactionSceneRegistry", () => {
  it("freezes an explicit formal-object scene contract", () => {
    const registry = createBusinessEntryTransactionSceneRegistry([policy()]);
    const registered = registry.get(definition.key);

    expect(registered).toMatchObject({
      sceneKey: definition.key,
      targetKind: "project_owned_entity",
      entityType: "contract_version",
      action: "contract.submit"
    });
    expect(Object.isFrozen(registered)).toBe(true);
  });

  it.each([
    [{ targetKind: "tenant_entity" }, "事务业务场景目标种类未登记"],
    [{ entityType: "" }, "事务业务场景目标类型未登记"],
    [{ action: "contract.unknown" }, "事务业务场景动作权限未登记"],
    [{ resolveOwnership: undefined }, "事务业务场景缺少归属解析器"],
    [{ resolveAuthorization: undefined }, "事务业务场景缺少领域授权解析器"]
  ])("rejects an incomplete formal scene contract", (overrides, message) => {
    expect(() => createBusinessEntryTransactionSceneRegistry([
      policy(overrides as never)
    ])).toThrow(message);
  });

  it("rejects duplicate and unregistered scenes", () => {
    expect(() => createBusinessEntryTransactionSceneRegistry([
      policy(),
      policy()
    ])).toThrow("事务业务场景授权契约重复");

    expect(() => createBusinessEntryTransactionSceneRegistry([]).get(definition.key))
      .toThrow("事务业务场景未登记");
  });
});
