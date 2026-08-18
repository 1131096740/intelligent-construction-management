import { BUSINESS_ENTRY_SCENE_ACCESS_POLICIES, BUSINESS_ENTRY_SCENE_DEFINITIONS } from "./business-entry-definition.scene-registry";
import { BUSINESS_ENTRY_ACCESS_REGISTRY } from "./business-entry-definition.scene-registry";

const POL19P3_SCENES = [
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

describe("POL-19P3 explicit scene contract", () => {
  it("registers the approved scenes without a template wildcard", () => {
    const sceneKeys = BUSINESS_ENTRY_SCENE_DEFINITIONS.map((definition) => definition.key);

    expect(sceneKeys).toEqual(expect.arrayContaining(POL19P3_SCENES));
    expect(POL19P3_SCENES.every((sceneKey) => sceneKeys.includes(sceneKey))).toBe(true);
    expect(sceneKeys.some((sceneKey) => sceneKey === "template")).toBe(false);

    for (const sceneKey of POL19P3_SCENES) {
      const policy = BUSINESS_ENTRY_SCENE_ACCESS_POLICIES.find((item) => item.sceneKey === sceneKey);
      expect(policy?.target.scope).toBe("global");
      expect(policy?.target.entityType).toBe(
        BUSINESS_ENTRY_SCENE_DEFINITIONS.find((definition) => definition.key === sceneKey)?.entityType
      );
    }
  });

  it("uses authenticated_self for the user profile rather than a role wildcard", () => {
    const definition = BUSINESS_ENTRY_SCENE_DEFINITIONS.find(
      (item) => item.key === "user_self_profile"
    );
    expect(definition?.fields.map((field) => field.key)).toEqual(["name", "phone"]);
    expect(definition?.fields.every((field) =>
      field.permissions.view.includes("authenticated_self" as never) &&
      field.permissions.edit.includes("authenticated_self" as never)
    )).toBe(true);
    expect(BUSINESS_ENTRY_ACCESS_REGISTRY.get("user_self_profile").permission).toEqual({
      kind: "authenticated_self",
      roleScope: "global"
    });
  });

  it("rejects non-draft template targets for editable operations", async () => {
    const templateTargets = [
      ["contract_business_template", "contractBusinessTemplate"],
      ["contract_layout_template_version", "contractLayoutTemplateVersion"],
      ["standard_clause_version", "standardClauseVersion"],
      ["settlement_template_version", "settlementTemplateVersion"]
    ] as const;

    for (const [sceneKey, model] of templateTargets) {
      const policy = BUSINESS_ENTRY_SCENE_ACCESS_POLICIES.find((item) => item.sceneKey === sceneKey)!;
      const resolver = policy.target.resolve!;
      const findUnique = jest.fn().mockResolvedValue(null);
      const prisma = {
        [model]: {
          findUnique
        }
      };

      await expect(resolver({
        target: { entityType: policy.target.entityType, entityId: "target-1" },
        actorUserId: "actor-1",
        operation: "edit",
        scene: sceneKey,
        scope: "global",
        prisma: prisma as never
      })).resolves.toBe(false);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: "target-1", status: "draft" },
        select: { id: true }
      });
    }
  });
});
