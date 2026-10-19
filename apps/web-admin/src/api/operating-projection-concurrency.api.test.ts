import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "../auth/auth.store";
import {
  downloadOperatingProjectionExport,
  fetchContractFinancialBalances,
  fetchProjectOperatingOverview,
  fetchProjectUpstreamFundFacts,
  fetchProjectSetOperatingProjection
} from "./core-flow-read.api";

import { fetchFundsWorkbench } from "./funds-workbench.api";
import { fetchProjectCloseProfitWorkbench, submitProjectFinalProfit } from "./project-close-profit.api";

const response = (status = 200) => new Response(JSON.stringify(
  status === 200 ? { marker: "fresh" } : { message: "经营投影读取过于频繁，请稍后重试" }
), { status, headers: { "content-type": "application/json" } });

describe("operating projection page request concurrency", () => {
  beforeEach(() => { setActivePinia(createPinia()); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("keeps overview, executive and classification reads within the real two-read actor limit", async () => {
    let active = 0;
    let maximum = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      if (active > 2) { active -= 1; return response(429); }
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return response();
    });
    const results = await Promise.allSettled([
      fetchProjectSetOperatingProjection(),
      fetchContractFinancialBalances({}),
      fetchContractFinancialBalances({ projectId: "project-a" }),
      fetchProjectOperatingOverview("project-a"),
      fetchProjectUpstreamFundFacts("project-a"),
      fetchFundsWorkbench()
    ]);
    expect(results.map((result) => result.status)).toEqual(Array(6).fill("fulfilled"));
    expect(maximum).toBeLessThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("shares the budget with close-profit reads, commands and exports", async () => {
    vi.stubGlobal("document", {
      createElement: () => ({ click: vi.fn(), remove: vi.fn() }),
      body: { appendChild: vi.fn() }
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-export");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let active = 0;
    let maximum = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      if (active > 2) { active -= 1; return response(429); }
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return response();
    });
    const results = await Promise.allSettled([
      fetchContractFinancialBalances({ projectId: "project-a" }),
      fetchContractFinancialBalances({ companyEntityId: "company-a" }),
      fetchProjectCloseProfitWorkbench("project-a"),
      submitProjectFinalProfit("project-a", {
        expectedProjectionFingerprint: "synthetic-fingerprint", idempotencyKey: "synthetic-key",
        basis: { summary: "合成依据", evidenceFileIds: [] }
      }),
      downloadOperatingProjectionExport({
        scopeKind: "project", projectId: "project-a", exportKind: "project_operating_ledger_detail",
        confirmationPassword: "synthetic-password"
      })
    ]);
    expect(results.map((result) => result.status)).toEqual(Array(5).fill("fulfilled"));
    expect(maximum).toBeLessThanOrEqual(2);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("releases a failed read without retrying it or blocking subsequent reads", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementation(async () => response())
      .mockImplementationOnce(async () => response(429));
    const results = await Promise.allSettled([
      fetchProjectOperatingOverview("project-a"),
      fetchContractFinancialBalances({ projectId: "project-a" }),
      fetchProjectSetOperatingProjection()
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it.each([false, true])("protects queued session ownership (same actor refresh: %s)", async (sameActor) => {
    const auth = useAuthStore();
    auth.accessToken = "synthetic-session-a";
    auth.user = { id: "actor-a", name: "合成用户", phone: null, mustChangePassword: false, roleKeys: [], globalRoleKeys: [] };
    const release: Array<() => void> = [];
    const heldResponse = () => new Promise<Response>((resolve) => {
      release.push(() => resolve(response()));
    });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementation(async () => response())
      .mockImplementationOnce(heldResponse);
    const settled = Promise.allSettled([
      fetchProjectOperatingOverview("project-a"),
      fetchContractFinancialBalances({ projectId: "project-a" }),
      fetchProjectSetOperatingProjection()
    ]);
    try { await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); }
    catch (error) { release.forEach((complete) => complete()); await settled; throw error; }
    auth.accessToken = "synthetic-session-b";
    if (!sameActor) auth.user = { ...auth.user, id: "actor-b" };
    release.forEach((complete) => complete());
    const results = await settled;
    expect(results.map((result) => result.status)).toEqual(["fulfilled", sameActor ? "fulfilled" : "rejected", sameActor ? "fulfilled" : "rejected"]);
    expect(fetchMock).toHaveBeenCalledTimes(sameActor ? 3 : 1);
  });
});
