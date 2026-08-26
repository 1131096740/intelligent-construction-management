import { describe, expect, it } from "vitest";

import type { ClearingCapabilities, ClearingCaseReadModel } from "../../api/clearing.api";
import { clearingEventActions, clearingTimeline } from "./clearing-workbench.state";

const allCapabilities: ClearingCapabilities = {
  availableActions: [
    "clearing.read",
    "clearing.prepare",
    "clearing.submit",
    "clearing.attest",
    "clearing.confirm",
    "clearing.return",
    "clearing.reopen"
  ],
  read: true,
  prepare: true,
  submit: true,
  attest: true,
  confirm: true,
  return: true,
  reopen: true
};

function event(status: string) {
  return {
    id: "event-1",
    kind: "withheld" as const,
    workflowStatus: status,
    revision: 2,
    currentVersionNo: 2,
    createdAt: "2026-08-26T00:00:00.000Z",
    versions: []
  };
}

describe("clearing workbench state", () => {
  it("derives every write button from server capability plus workflow status", () => {
    expect(clearingEventActions(event("submitted"), allCapabilities)).toEqual({
      edit: false,
      submit: false,
      attest: false,
      confirm: true,
      return: true,
      reopen: false
    });
    expect(
      clearingEventActions(event("submitted"), {
        ...allCapabilities,
        confirm: false,
        return: false
      })
    ).toEqual(expect.objectContaining({ confirm: false, return: false }));

    expect(clearingEventActions(event("returned"), allCapabilities)).toEqual({
      edit: false,
      submit: false,
      attest: false,
      confirm: false,
      return: false,
      reopen: true
    });
  });

  it("requires a named attest before offering B-level confirmation", () => {
    let submitted: ClearingCaseReadModel["events"][number] = {
      ...event("submitted"),
      currentVersionNo: 1,
      versions: [
        {
          id: "version-1",
          versionNo: 1,
          workflowStatus: "submitted",
          amountCents: "100",
          evidenceLevel: "B" as const,
          payableRef: null,
          payloadSnapshot: {},
          createdAt: "2026-08-26T01:00:00.000Z"
        }
      ]
    };

    expect(clearingEventActions(submitted, allCapabilities)).toEqual(
      expect.objectContaining({ attest: true, confirm: false })
    );
    submitted = {
      ...submitted,
      versions: submitted.versions.map((version) => ({
        ...version,
        attestation: {
          attestedAt: "2026-08-26T01:30:00.000Z",
          attestedByUserId: "finance-2"
        }
      }))
    };
    expect(clearingEventActions(submitted, allCapabilities)).toEqual(
      expect.objectContaining({ attest: false, confirm: true })
    );
  });

  it("shows immutable versions in chronological order without collapsing history", () => {
    const clearingCase = {
      events: [
        {
          ...event("confirmed"),
          versions: [
            {
              id: "v2",
              versionNo: 2,
              workflowStatus: "submitted",
              amountCents: "100",
              evidenceLevel: "A",
              payableRef: null,
              payloadSnapshot: {},
              createdAt: "2026-08-26T02:00:00.000Z",
              confirmation: { confirmedAt: "2026-08-26T03:00:00.000Z", confirmedByUserId: "d1" }
            },
            {
              id: "v1",
              versionNo: 1,
              workflowStatus: "draft",
              amountCents: "100",
              evidenceLevel: "A",
              payableRef: null,
              payloadSnapshot: {},
              createdAt: "2026-08-26T01:00:00.000Z"
            }
          ]
        }
      ]
    } as ClearingCaseReadModel;

    expect(clearingTimeline(clearingCase).map((row) => row.key)).toEqual([
      "event-1:v1",
      "event-1:v2"
    ]);
    expect(clearingTimeline(clearingCase)[1]?.workflowStatus).toBe("confirmed");
  });
});
