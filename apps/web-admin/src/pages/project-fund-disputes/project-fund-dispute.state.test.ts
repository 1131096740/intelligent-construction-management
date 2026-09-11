import { describe, expect, it } from "vitest";

import type { ProjectFundDisputeEntryReadModel } from "../../api/project-fund-dispute.api";
import { projectFundDisputeActions } from "./project-fund-dispute.state";

const entry = (status: ProjectFundDisputeEntryReadModel["status"]) => ({
  status
}) as ProjectFundDisputeEntryReadModel;
const all = { read: true, prepare: true, submit: true, attest: true, confirm: true, return: true };

describe("project fund dispute workbench state", () => {
  it("requires independent attestation before finance confirmation", () => {
    expect(projectFundDisputeActions(entry("submitted"), all)).toEqual(
      expect.objectContaining({ attest: true, confirm: false, return: true })
    );
    expect(projectFundDisputeActions(entry("attested"), all)).toEqual(
      expect.objectContaining({ attest: false, confirm: true, return: true })
    );
  });
});
