import type { BusinessEntrySceneDefinition } from "@jiangkong/shared-domain";
import {
  createBusinessEntryTransactionSceneRegistry,
  type BusinessEntryTransactionScenePolicy
} from "./business-entry-transaction-scene-registry";
import { SETTLEMENT_LINE_ATTACHMENT_PURPOSE_ENTRY_POLICY } from "../settlement/settlement-line-attachment-business-entry-policy";

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
    {
      name: "a target project different from the formal settlement",
      targetProjectId: "project-2",
      actorUserId: "owner-1",
      attachment: { settlementLineId: "line-1" },
      line: { settlementId: "settlement-1" },
      settlement: { id: "settlement-1", projectId: "project-1", preparedByUserId: "owner-1" }
    },
    {
      name: "an actor other than the settlement preparer",
      targetProjectId: "project-1",
      actorUserId: "other-actor",
      attachment: { settlementLineId: "line-1" },
      line: { settlementId: "settlement-1" },
      settlement: { id: "settlement-1", projectId: "project-1", preparedByUserId: "owner-1" }
    },
    {
      name: "a draft attachment without a formal settlement line",
      targetProjectId: "project-1",
      actorUserId: "owner-1",
      attachment: { settlementLineId: null },
      line: null,
      settlement: null
    }
  ])("fails the settlement attachment purpose policy closed for $name", async (fixture) => {
    const tx = {
      settlementLineAttachment: { findUnique: jest.fn().mockResolvedValue(fixture.attachment) },
      settlementLine: { findUnique: jest.fn().mockResolvedValue(fixture.line) },
      settlement: {
        findMany: jest.fn().mockResolvedValue(
          fixture.settlement ? [{ projectId: fixture.settlement.projectId }] : []
        ),
        findUnique: jest.fn().mockResolvedValue(fixture.settlement)
      }
    };
    const context = {
      tx,
      sceneKey: "settlement_line_attachment_purpose",
      target: {
        projectId: fixture.targetProjectId,
        entityType: "settlement_line_attachment",
        entityId: "attachment-1"
      },
      actorUserId: fixture.actorUserId,
      operation: "edit" as const,
      action: "settlement.create",
      values: { purpose: "现场签证单" }
    };

    const ownership = await SETTLEMENT_LINE_ATTACHMENT_PURPOSE_ENTRY_POLICY.resolveOwnership(context as never);
    const roles = await SETTLEMENT_LINE_ATTACHMENT_PURPOSE_ENTRY_POLICY.resolveAuthorization(context as never);

    if (fixture.attachment.settlementLineId === null) {
      expect(ownership).toEqual([]);
    }
    expect(roles).toEqual([]);
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
