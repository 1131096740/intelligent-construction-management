import { BadRequestException } from "@nestjs/common";
import {
  createBusinessEntryDefinitionRegistry,
  type BusinessEntrySceneDefinition
} from "@jiangkong/shared-domain";
import { BusinessEntryDefinitionService } from "./business-entry-definition.service";
import { BUSINESS_ENTRY_DEFINITION_REGISTRY as registeredDefinitions } from "./business-entry-definition.scene-registry";

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

function projectPrisma() {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: "project-1" })
    }
  } as never;
}

describe("BusinessEntryDefinitionService", () => {
  it("uses server-resolved project roles for validation and freezes the accepted version", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"])
    };
    const snapshots = { save: jest.fn().mockImplementation(async (_projectId, _userId, snapshot) => snapshot) };
    const service = new BusinessEntryDefinitionService(
      registry,
      visibility,
      snapshots,
      projectPrisma()
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
    expect(visibility.effectiveRoleKeys).toHaveBeenCalledWith("user-1", "project-1");

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
    expect(snapshots.save).toHaveBeenCalledWith(
      "project-1",
      "user-1",
      expect.objectContaining({ target: { entityType: "project", entityId: "project-1" } }),
      undefined
    );
  });

  it("does not trust caller-supplied roles and maps invalid drafts to a bad request", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["project_manager"])
    };
    const service = new BusinessEntryDefinitionService(
      registry,
      visibility,
      { save: jest.fn() },
      projectPrisma()
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
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects a formal target outside the authorized project scope", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["finance_staff"])
    };
    const service = new BusinessEntryDefinitionService(
      registry,
      visibility,
      { save: jest.fn() },
      projectPrisma()
    );

    await expect(
      service.validateDraft("project_operating_profile", "project-1", "user-1", {
        definitionVersion: 3,
        target: { entityType: "project", entityId: "project-2" },
        values: { takeoverStatus: "operating_with_takeover" }
      })
    ).rejects.toThrow(BadRequestException);
  });

  it("does not expose a definition to a project role without any visible fields", async () => {
    const registry = createBusinessEntryDefinitionRegistry([definition]);
    const visibility = {
      effectiveRoleKeys: jest.fn().mockResolvedValue(["project_manager"])
    };
    const service = new BusinessEntryDefinitionService(
      registry,
      visibility,
      { save: jest.fn() },
      projectPrisma()
    );

    await expect(
      service.getSceneDefinition("project_operating_profile", "project-1", "user-1")
    ).rejects.toThrow(BadRequestException);
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
});
