import { describe, expect, it } from "vitest";

import type { NecessaryExpenseReserveEntryReadModel } from "../../api/necessary-expense-reserve.api";
import { necessaryExpenseReserveActions } from "./necessary-expense-reserve.state";

const entry = (status: NecessaryExpenseReserveEntryReadModel["status"]) => ({
  status
}) as NecessaryExpenseReserveEntryReadModel;
const all = { read: true, prepare: true, submit: true, attest: true, confirm: true, return: true };

describe("necessary expense reserve workbench state", () => {
  it("requires project-manager attestation before finance confirmation", () => {
    expect(necessaryExpenseReserveActions(entry("submitted"), all)).toEqual(
      expect.objectContaining({ attest: true, confirm: false, return: true })
    );
    expect(necessaryExpenseReserveActions(entry("attested"), all)).toEqual(
      expect.objectContaining({ attest: false, confirm: true, return: true })
    );
  });
});
