import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchWageStatementImportPreview,
  fetchWageStatementSummary,
  fetchWageStatementWorkbench,
  WageStatementApiError
} from "./wage-statement.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("wage statement workbench API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses only the aggregate read endpoints and URL-encodes the selected aggregate", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    await fetchWageStatementWorkbench();
    await fetchWageStatementSummary("statement / 1");
    await fetchWageStatementImportPreview("statement / 1");

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/wage-statements/workbench?page=1&pageSize=20");
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/wage-statements/statement%20%2F%201/summary"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/wage-statements/statement%20%2F%201/import-preview"
    );
  });

  it("propagates a historical read rejection with a user-facing message and status", async () => {
    mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: "当前账号无权查看工资汇总" }), { status: 403 }));

    const rejection = fetchWageStatementSummary("statement-1");
    await expect(rejection).rejects.toMatchObject({
      name: "WageStatementApiError",
      status: 403,
      message: "当前账号无权查看工资汇总"
    });
    await expect(rejection).rejects.toBeInstanceOf(WageStatementApiError);
  });
});
