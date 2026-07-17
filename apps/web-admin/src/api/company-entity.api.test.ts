import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCompanyEntity,
  fetchCompanyEntityHistory,
  fetchCompanyEntityManagement,
  updateCompanyEntity,
  updateCompanyEntityStatus
} from "./company-entity.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("company entity management API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
  });

  it("encodes management filters and history identifiers", async () => {
    await fetchCompanyEntityManagement({ keyword: "厦门/建工 & 管理", status: "inactive" });
    await fetchCompanyEntityHistory("entity/1 ?");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/company-entities/management?keyword=%E5%8E%A6%E9%97%A8%2F%E5%BB%BA%E5%B7%A5+%26+%E7%AE%A1%E7%90%86&status=inactive",
      "/company-entities/entity%2F1%20%3F/history"
    ]);
  });

  it("uses the exact create, update and status contracts", async () => {
    const facts = {
      name: "厦门建工集团有限公司",
      unifiedSocialCreditCode: "91350211M000100Y46",
      registeredAddress: "厦门市思明区"
    };

    await createCompanyEntity(facts);
    await updateCompanyEntity("entity/1", facts);
    await updateCompanyEntityStatus("entity/1", false);

    expect(mockApiFetch.mock.calls.map(([path, init]) => [path, init?.method, init?.body])).toEqual([
      ["/company-entities", "POST", JSON.stringify(facts)],
      ["/company-entities/entity%2F1", "PATCH", JSON.stringify(facts)],
      ["/company-entities/entity%2F1/status", "POST", JSON.stringify({ isActive: false })]
    ]);
  });

  it("returns the management, history, warning and unchanged response shapes", async () => {
    const entity = {
      id: "entity-1",
      name: "厦门建工集团有限公司",
      unifiedSocialCreditCode: "91350211M000100Y46",
      registeredAddress: null,
      dataStatus: "complete",
      isActive: true,
      createdAt: "2026-07-17T01:00:00.000Z",
      updatedAt: "2026-07-17T02:00:00.000Z"
    } as const;
    mockApiFetch
      .mockResolvedValueOnce(Response.json([entity]))
      .mockResolvedValueOnce(Response.json({ entity, versions: [] }))
      .mockResolvedValueOnce(Response.json({ entity, warning: "存在同名主体" }))
      .mockResolvedValueOnce(Response.json({ entity, warning: null }))
      .mockResolvedValueOnce(Response.json({ entity, unchanged: true }));

    await expect(fetchCompanyEntityManagement()).resolves.toEqual([entity]);
    await expect(fetchCompanyEntityHistory(entity.id)).resolves.toEqual({ entity, versions: [] });
    await expect(createCompanyEntity({
      name: entity.name,
      unifiedSocialCreditCode: entity.unifiedSocialCreditCode,
      registeredAddress: null
    })).resolves.toEqual({ entity, warning: "存在同名主体" });
    await expect(updateCompanyEntity(entity.id, {
      name: entity.name,
      unifiedSocialCreditCode: entity.unifiedSocialCreditCode,
      registeredAddress: null
    })).resolves.toEqual({ entity, warning: null });
    await expect(updateCompanyEntityStatus(entity.id, true)).resolves.toEqual({ entity, unchanged: true });
  });

  it("preserves Chinese backend errors and joins validation messages", async () => {
    mockApiFetch
      .mockResolvedValueOnce(Response.json({ message: "统一社会信用代码已被其他主体使用" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ message: ["请填写公司主体名称", "请填写统一社会信用代码"] }, { status: 400 }));

    await expect(createCompanyEntity({
      name: "厦门建工",
      unifiedSocialCreditCode: "91350211M000100Y46",
      registeredAddress: null
    })).rejects.toThrow("统一社会信用代码已被其他主体使用");
    await expect(updateCompanyEntity("entity-1", {
      name: "",
      unifiedSocialCreditCode: "",
      registeredAddress: null
    })).rejects.toThrow("请填写公司主体名称；请填写统一社会信用代码");
  });
});
