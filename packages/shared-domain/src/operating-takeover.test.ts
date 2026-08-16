import { describe, expect, it } from "vitest";
import {
  OPERATING_TAKEOVER_SCENE_DEFINITIONS,
  OPERATING_TAKEOVER_SCENE_KEYS
} from "./operating-takeover";

describe("operating takeover scene catalog", () => {
  it("freezes the twelve business templates and the combined workbook contract", () => {
    expect(OPERATING_TAKEOVER_SCENE_DEFINITIONS).toHaveLength(12);
    expect(OPERATING_TAKEOVER_SCENE_KEYS).toHaveLength(12);

    for (const scene of OPERATING_TAKEOVER_SCENE_DEFINITIONS) {
      expect(scene.entityType).toBe("operating_takeover_row");
      expect(scene.name).not.toMatch(/ID|id|键|JSON|版本/u);
      expect(scene.fields.length).toBeGreaterThan(0);
      expect(scene.fields.every((field) => field.excel.column === field.label)).toBe(true);
      expect(scene.fields.some((field) => /附件|file|File|ID|id|键/u.test(field.label))).toBe(false);
      expect(scene.fields.some((field) => field.key === "attachmentFileName")).toBe(false);
    }
  });

  it("keeps finance-only facts separate from contract-side confirmations", () => {
    const expense = OPERATING_TAKEOVER_SCENE_DEFINITIONS.find(
      (scene) => scene.key === "historical_expense"
    );
    const downstreamPayment = OPERATING_TAKEOVER_SCENE_DEFINITIONS.find(
      (scene) => scene.key === "construction_enterprise_downstream_payment"
    );

    expect(expense?.requiredProfessions).toEqual(["finance"]);
    expect(downstreamPayment?.requiredProfessions).toEqual(["contract", "finance"]);
  });
});
