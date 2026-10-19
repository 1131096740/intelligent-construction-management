import { beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "./api-fetch";
import { fetchCompanyTransferCapabilities } from "./company-transfer.api";
vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
beforeEach(() => { vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockResolvedValue(new Response("{}", { status: 200 })); });
it("办理前能力复核沿用项目、公司、基准日及页码，空基准日不发送", async () => {
  await fetchCompanyTransferCapabilities("project-a", 2, "company-b", "2026-10-01");
  const url = new URL(String(vi.mocked(apiFetch).mock.calls[0][0]), "http://localhost");
  expect(Object.fromEntries(url.searchParams)).toEqual({ projectId: "project-a", page: "2", companyId: "company-b", asOf: "2026-10-01" });
  vi.mocked(apiFetch).mockResolvedValue(new Response("{}", { status: 200 }));
  await fetchCompanyTransferCapabilities("", 1, "", "");
  expect(vi.mocked(apiFetch).mock.calls[1][0]).toBe("/company-transfers?page=1");
});
