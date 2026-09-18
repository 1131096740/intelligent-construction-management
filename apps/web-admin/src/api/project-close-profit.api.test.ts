import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";
import {
  attestProjectDownstreamFinanceCost,
  completeProjectCloseStage,
  confirmProjectFinalProfit,
  confirmProjectProfitDistribution,
  postTemporaryProfitDistribution,
  fetchProjectCloseProfitWorkbench
} from "./project-close-profit.api";

const mockApiFetch = vi.mocked(apiFetch);

describe("project close profit API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({
        schema: "project_close_profit/V1",
        stages: [],
        canReconcileImpacts: true,
        availableActions: [],
        projection: { fingerprint: "projection-fingerprint" }
      }), { status: 200 })
    );
  });

  it("keeps reads and all commands inside the selected project resource", async () => {
    const body = {
      expectedProjectionFingerprint: "projection-fingerprint",
      idempotencyKey: "2a648f91-5085-4dad-b6fb-d5b9aac5d9f7",
      basis: { summary: "确认依据", evidenceFileIds: [] }
    };

    await fetchProjectCloseProfitWorkbench("project / 1");
    await completeProjectCloseStage("project / 1", "construction_completed", body);
    await attestProjectDownstreamFinanceCost("project / 1", body);
    await confirmProjectFinalProfit("project / 1", body);
    await postTemporaryProfitDistribution("project / 1", {
      ...body,
      projectParticipatingCompanyId: "participant-1",
      amountCents: "1200"
    });
    await confirmProjectProfitDistribution("project / 1", {
      ...body,
      lines: [{ projectParticipatingCompanyId: "participant-1", finalShareCents: "6000" }]
    });

    expect(mockApiFetch.mock.calls.map(([requestPath]) => requestPath)).toEqual([
      "/projects/project%20%2F%201/close-profit",
      "/projects/project%20%2F%201/close-profit/stages/construction_completed/complete",
      "/projects/project%20%2F%201/close-profit/downstream-cost/attestations/finance",
      "/projects/project%20%2F%201/close-profit/final-profit/confirm",
      "/projects/project%20%2F%201/close-profit/temporary-distributions",
      "/projects/project%20%2F%201/close-profit/distributions/confirm"
    ]);
    for (const [, request] of mockApiFetch.mock.calls.slice(1)) {
      expect(request).toEqual(expect.objectContaining({ method: "POST" }));
      expect(JSON.stringify(request)).not.toContain("actorUserId");
      expect(JSON.stringify(request)).not.toContain("roleKey");
    }
  });
});
