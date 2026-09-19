import { describe, expect, it } from "vitest";

import {
  CLEARING_AUTHORITY_EVENT_ENTRY_DEFINITION,
  CLEARING_CASE_ENTRY_DEFINITION,
  CLEARING_CONFIRMATION_ENTRY_DEFINITION,
  CLEARING_EVENT_ENTRY_DEFINITION
} from "../clearing/clearing-entry-definitions";
import {
  PROJECT_CLOSE_BASIS_ENTRY_DEFINITION,
  PROJECT_PROFIT_DISTRIBUTION_ENTRY_DEFINITION,
  PROJECT_TEMPORARY_PROFIT_DISTRIBUTION_ENTRY_DEFINITION
} from "./components/project-close-entry-definitions";

describe("POL-19D presentation-only entry definitions", () => {
  it("does not declare an authorization role and keeps original server capabilities authoritative", () => {
    for (const definition of [
      CLEARING_CASE_ENTRY_DEFINITION,
      CLEARING_EVENT_ENTRY_DEFINITION,
      CLEARING_AUTHORITY_EVENT_ENTRY_DEFINITION,
      CLEARING_CONFIRMATION_ENTRY_DEFINITION,
      PROJECT_CLOSE_BASIS_ENTRY_DEFINITION,
      PROJECT_PROFIT_DISTRIBUTION_ENTRY_DEFINITION,
      PROJECT_TEMPORARY_PROFIT_DISTRIBUTION_ENTRY_DEFINITION
    ]) {
      for (const field of definition.fields) {
        expect(field.permissions.view).toEqual([]);
        expect(field.permissions.edit).toEqual([]);
      }
    }
  });

  it("uses yuan-facing exact fields for clearing while preserving A/B evidence choices", () => {
    expect(CLEARING_CASE_ENTRY_DEFINITION.fields.find(
      (field) => field.key === "authoritativeGrossCapYuan"
    )).toMatchObject({ type: "money", unit: "元", precision: 2, required: true });
    expect(CLEARING_EVENT_ENTRY_DEFINITION.fields.find(
      (field) => field.key === "amountYuan"
    )).toMatchObject({ type: "money", unit: "元", precision: 2, required: true });
    expect(CLEARING_EVENT_ENTRY_DEFINITION.fields.find(
      (field) => field.key === "evidenceLevel"
    )?.options).toEqual([
      { value: "A", label: "A 级" },
      { value: "B", label: "B 级" }
    ]);
    expect(CLEARING_EVENT_ENTRY_DEFINITION.fields.map((field) => field.key)).toEqual([
      "kind",
      "amountYuan",
      "evidenceLevel",
      "businessReason",
      "evidenceRef"
    ]);
    expect(CLEARING_CONFIRMATION_ENTRY_DEFINITION.fields.find(
      (field) => field.key === "amountYuan"
    )).toMatchObject({ type: "money", unit: "元", precision: 2, required: true });
    expect(CLEARING_CONFIRMATION_ENTRY_DEFINITION.fields.find(
      (field) => field.key === "sourceEventVersionId"
    )).toMatchObject({ type: "single_select" });
  });

  it("locks participating company identity and permits signed two-decimal distribution values", () => {
    expect(PROJECT_PROFIT_DISTRIBUTION_ENTRY_DEFINITION.fields.find(
      (field) => field.key === "companyEntityId"
    )).toMatchObject({ type: "company", readOnly: true });
    expect(PROJECT_PROFIT_DISTRIBUTION_ENTRY_DEFINITION.fields.find(
      (field) => field.key === "finalShareYuan"
    )).toMatchObject({
      type: "money",
      unit: "元",
      precision: 2,
      exactDecimalString: { sign: "signed" }
    });
    expect(PROJECT_TEMPORARY_PROFIT_DISTRIBUTION_ENTRY_DEFINITION.fields.map(
      (field) => field.key
    )).toEqual(["companyEntityId", "amountYuan"]);
  });
});
