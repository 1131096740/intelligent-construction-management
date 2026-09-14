import { describe, expect, it, vi } from "vitest";

import { CoreFlowApiError } from "../../api/core-flow-read.api";
import { loadOptionalProjectUpstreamFundFacts } from "./project-operating-overview.loader";

describe("loadOptionalProjectUpstreamFundFacts", () => {
  it("keeps the legal overview path alive when a cross-project role hint receives a project-local 403", async () => {
    const load = vi.fn().mockRejectedValue(
      new CoreFlowApiError("无权读取该项目上游资金明细", 403, "FORBIDDEN")
    );

    await expect(loadOptionalProjectUpstreamFundFacts(
      "project-b",
      true,
      load
    )).resolves.toEqual({ facts: [], nextCursor: null, error: "" });
    expect(load).toHaveBeenCalledWith("project-b", { pageSize: 50 });
  });

  it("returns permitted project-local detail without changing it", async () => {
    const rows = [{ id: "fund-1" }] as never;
    const load = vi.fn().mockResolvedValue({
      items: rows,
      page: { pageSize: 50, readAt: "2026-09-12T01:00:00.000Z", nextCursor: "next-1" }
    });

    await expect(loadOptionalProjectUpstreamFundFacts(
      "project-a",
      true,
      load
    )).resolves.toEqual({ facts: rows, nextCursor: "next-1", error: "" });
  });

  it("does not request restricted detail without the role hint", async () => {
    const load = vi.fn();

    await expect(loadOptionalProjectUpstreamFundFacts(
      "project-b",
      false,
      load
    )).resolves.toEqual({ facts: [], nextCursor: null, error: "" });
    expect(load).not.toHaveBeenCalled();
  });
});
