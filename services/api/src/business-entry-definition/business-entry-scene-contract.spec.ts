import { BUSINESS_ENTRY_SCENE_ACCESS_POLICIES, BUSINESS_ENTRY_SCENE_DEFINITIONS } from "./business-entry-definition.scene-registry";
import { BUSINESS_ENTRY_ACCESS_REGISTRY } from "./business-entry-definition.scene-registry";
import { BUSINESS_ENTRY_TRANSACTION_SCENE_POLICIES } from "./business-entry-transaction-scene-registry";

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
  it("discovers project creation and participant deactivation with explicit project policies", () => {
    for (const [sceneKey, entityType, keys] of [
      ["project_create", "project", ["code", "name"]],
      ["project_participating_company_deactivate", "project_participating_company", ["endedOn", "changeReason"]]
    ] as const) {
      const definition = BUSINESS_ENTRY_SCENE_DEFINITIONS.find((scene) => scene.key === sceneKey);
      expect(definition?.entityType).toBe(entityType);
      expect(definition?.fields.map((field) => field.key)).toEqual(keys);
      expect(BUSINESS_ENTRY_ACCESS_REGISTRY.get(sceneKey).target).toMatchObject({ scope: "project", entityType });
    }
  });

  it("registers the two zero-purchase application scenes with exact quantity and project create authority", () => {
    const application = BUSINESS_ENTRY_SCENE_DEFINITIONS.find((item) => item.key === "spot_procurement.application");
    const line = BUSINESS_ENTRY_SCENE_DEFINITIONS.find((item) => item.key === "spot_procurement.application_line");

    expect(application).toMatchObject({ entityType: "spot_procurement_version", version: 1 });
    expect(application?.fields.map((field) => field.key)).toEqual([
      "applicationDepartment", "applicationName", "requestedArrivalAt", "reason", "note"
    ]);
    expect(line).toMatchObject({ entityType: "spot_procurement_line", version: 1 });
    expect(line?.fields.map((field) => field.key)).toEqual([
      "materialName", "specification", "unit", "quantity", "note"
    ]);
    expect(line?.fields.find((field) => field.key === "quantity")).toMatchObject({
      type: "number",
      precision: 2,
      exactDecimalString: {
        sign: "nonnegative",
        minimumExclusive: "0",
        maximumExclusive: "1000000000000000000"
      }
    });
    for (const sceneKey of ["spot_procurement.application", "spot_procurement.application_line"]) {
      expect(BUSINESS_ENTRY_SCENE_ACCESS_POLICIES.find((item) => item.sceneKey === sceneKey)).toMatchObject({
        target: { scope: "project" },
        permission: { kind: "business_action", action: "spot_procurement.create", roleScope: "project" }
      });
      expect(BUSINESS_ENTRY_TRANSACTION_SCENE_POLICIES.find((item) => item.sceneKey === sceneKey)).toMatchObject({
        targetKind: "project_owned_entity",
        action: "spot_procurement.create"
      });
    }
  });

  it("allows historical spot procurement views but fails closed for stale or foreign edits", async () => {
    const application = BUSINESS_ENTRY_ACCESS_REGISTRY.get("spot_procurement.application");
    const line = BUSINESS_ENTRY_ACCESS_REGISTRY.get("spot_procurement.application_line");
    const prisma = {
      spotProcurementVersion: {
        findUnique: jest.fn().mockImplementation(({ where: { id } }) => Promise.resolve({
          status: id === "old-version" ? "approved" : "draft",
          procurementId: "procurement-1"
        }))
      },
      spotProcurement: {
        findUnique: jest.fn().mockResolvedValue({
          projectId: "project-1",
          currentVersionId: "current-version",
          applicantUserId: "applicant-1",
          handlerUserId: "handler-1",
          status: "draft"
        })
      },
      spotProcurementLine: {
        findUnique: jest.fn().mockImplementation(({ where: { id } }) => Promise.resolve({
          versionId: id === "foreign-line" ? "foreign-version" : "current-version"
        }))
      }
    };
    const resolve = (
      policy: typeof application,
      entityId: string,
      operation: "view" | "edit",
      projectId = "project-1",
      actorUserId = "applicant-1"
    ) => policy.target.resolve!({
      target: { entityType: policy.target.entityType, entityId },
      projectId,
      actorUserId,
      operation,
      scene: policy.sceneKey,
      scope: "project",
      prisma: prisma as never
    });

    await expect(resolve(application, "old-version", "view")).resolves.toBe(true);
    await expect(resolve(application, "old-version", "edit")).resolves.toBe(false);
    await expect(resolve(application, "current-version", "edit", "project-2")).resolves.toBe(false);
    await expect(resolve(application, "current-version", "edit", "project-1", "other-1")).resolves.toBe(false);
    await expect(resolve(line, "line-1", "edit")).resolves.toBe(true);
    prisma.spotProcurement.findUnique.mockResolvedValueOnce({
      projectId: "project-2",
      currentVersionId: "foreign-version",
      applicantUserId: "applicant-1",
      handlerUserId: "handler-1",
      status: "draft"
    });
    await expect(resolve(line, "foreign-line", "edit")).resolves.toBe(false);
  });

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
