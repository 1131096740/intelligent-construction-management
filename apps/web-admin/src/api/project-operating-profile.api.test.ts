import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addProjectParticipatingCompany,
  assignProjectConstructionEnterprise,
  deactivateProjectParticipatingCompany,
  fetchProjectOperatingProfile,
  fetchProjectParticipatingCompanyOptions,
  fetchProjectConstructionEnterpriseOptions,
  removeProjectParticipatingCompany,
  updateProjectOperatingProfile
} from "./project-operating-profile.api";

const mockApiFetch = vi.fn();
vi.mock("./api-fetch", () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));

describe("project operating profile api", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
  });

  it("uses project-scoped profile and participant endpoints", async () => {
    await fetchProjectOperatingProfile("project/1");
    await fetchProjectParticipatingCompanyOptions("project/1");
    await fetchProjectConstructionEnterpriseOptions("project/1");
    await updateProjectOperatingProfile("project/1", { takeoverStatus: "balance_review" });
    await addProjectParticipatingCompany("project/1", {
      companyEntityId: "company-1",
      effectiveFrom: "2026-08-01",
      changeReason: "项目参与"
    });
    await assignProjectConstructionEnterprise("project/1", {
      businessPartyVersionId: "party-version-1",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      changeReason: "项目施工企业"
    });
    await deactivateProjectParticipatingCompany("project/1", "participant/1", {
      endedOn: "2026-08-14",
      changeReason: "停止新增业务"
    });
    await removeProjectParticipatingCompany("project/1", "participant/1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/projects/project%2F1/operating-profile",
      "/projects/project%2F1/participating-company-options",
      "/projects/project%2F1/construction-enterprise-options",
      "/projects/project%2F1/operating-profile",
      "/projects/project%2F1/participating-companies",
      "/projects/project%2F1/construction-enterprise",
      "/projects/project%2F1/participating-companies/participant%2F1/deactivation",
      "/projects/project%2F1/participating-companies/participant%2F1"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
      "GET", "GET", "GET", "PATCH", "POST", "POST", "PATCH", "DELETE"
    ]);
  });
});
