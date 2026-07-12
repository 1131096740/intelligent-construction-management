import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createContractBusinessScenario,
  createContractScenarioMapping,
  listAvailableContractBusinessScenarios,
  listContractScenarioGovernance,
  recommendContractScenarioTemplates,
  updateContractBusinessScenario,
  updateContractScenarioMapping
} from "./contract-scenario.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("contract scenario API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
  });

  it("uses project-scoped ordinary read endpoints with encoded coordinates", async () => {
    await listAvailableContractBusinessScenarios("project/1");
    await recommendContractScenarioTemplates("project/1", "scenario/1", "material purchase");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/contract-business-scenarios/available?projectId=project%2F1",
      "/contract-business-scenarios/recommendations?projectId=project%2F1&scenarioId=scenario%2F1&contractTypeKey=material+purchase"
    ]);
  });

  it("keeps governance endpoints separate from ordinary reads", async () => {
    await listContractScenarioGovernance();
    await createContractBusinessScenario({ code: "materials", name: "材料采购" });
    await updateContractBusinessScenario("scenario/1", {
      expectedRevision: 2,
      active: false
    });
    await createContractScenarioMapping("scenario/1", {
      expectedScenarioRevision: 2,
      businessTemplateVersionId: "version-1",
      reason: "用于材料采购",
      priority: 10
    });
    await updateContractScenarioMapping("mapping/1", {
      expectedRevision: 3,
      reason: "更新理由"
    });

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/contract-business-scenarios",
      "/contract-business-scenarios",
      "/contract-business-scenarios/scenario%2F1",
      "/contract-business-scenarios/scenario%2F1/template-mappings",
      "/contract-scenario-template-mappings/mapping%2F1"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
      "GET",
      "POST",
      "PATCH",
      "POST",
      "PATCH"
    ]);
  });
});
