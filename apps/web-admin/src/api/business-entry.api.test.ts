import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessEntryDraftPayload } from "@jiangkong/shared-domain";
import {
  downloadBusinessEntryExcelTemplate,
  fetchBusinessEntryCreateCapability,
  fetchBusinessEntryDefinition,
  freezeBusinessEntrySnapshot,
  previewBusinessEntryExcel,
  validateBusinessEntryDraft
} from "./business-entry.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);
const payload: BusinessEntryDraftPayload = {
  sceneKey: "expense/line",
  definitionVersion: 3,
  target: { entityType: "operating_takeover_row", entityId: "project/1" },
  values: { amountYuan: "10.00" }
};

describe("business entry API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the POL-17 definition and validation endpoints", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: "expense/line", fields: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ valid: true, errors: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));

    await fetchBusinessEntryDefinition(
      "expense/line",
      { scope: "project", projectId: "project/1" },
      payload.target!
    );
    await validateBusinessEntryDraft({ scope: "project", projectId: "project/1" }, payload, "edit");

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/business-entry-definitions/expense%2Fline?projectId=project%2F1&targetEntityType=operating_takeover_row&targetEntityId=project%2F1&operation=edit"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/business-entry-definitions/expense%2Fline/validate?projectId=project%2F1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          definitionVersion: 3,
          target: payload.target,
          values: payload.values,
          operation: "edit"
        })
      })
    );
  });

  it("reads global create capability without issuing a submission target", async () => {
    mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      key: "business_party",
      version: 1,
      fields: []
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    await expect(fetchBusinessEntryCreateCapability(
      "business_party",
      { scope: "global" },
      "edit"
    )).resolves.toMatchObject({ key: "business_party", version: 1 });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/business-entry-definitions/business_party/create-capability?operation=edit"
    );
  });

  it("uploads Excel as a zero-write preview using the same target and definition version", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ zeroWrites: true, rows: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    const file = new File(["xlsx"], "费用.xlsx", { type: "application/octet-stream" });

    await expect(previewBusinessEntryExcel({ scope: "project", projectId: "project/1" }, payload, file)).resolves.toMatchObject({
      zeroWrites: true
    });

    const [requestPath, init] = mockApiFetch.mock.calls[0]!;
    expect(requestPath).toBe(
      "/business-entry-definitions/expense%2Fline/excel-preview?projectId=project%2F1"
    );
    const formData = init?.body as FormData;
    expect(formData.get("definitionVersion")).toBe("3");
    expect(formData.get("targetEntityType")).toBe("operating_takeover_row");
    expect(formData.get("targetEntityId")).toBe("project/1");
    expect(formData.get("file")).toBe(file);
  });

  it("downloads the common Chinese template and freezes only through the POL-17 endpoint", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(new Blob(["xlsx"]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sceneKey: payload.sceneKey,
        definitionVersion: 3,
        values: payload.values
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));

    await expect(downloadBusinessEntryExcelTemplate(
      payload.sceneKey,
      { scope: "project", projectId: "project/1" },
      payload.target!
    ))
      .resolves.toBeInstanceOf(Blob);
    await freezeBusinessEntrySnapshot({ scope: "project", projectId: "project/1" }, payload, "import");

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/business-entry-definitions/expense%2Fline/excel-template?projectId=project%2F1&targetEntityType=operating_takeover_row&targetEntityId=project%2F1"
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/business-entry-definitions/expense%2Fline/freeze?projectId=project%2F1",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"operation":"import"')
      })
    );
  });

  it("omits projectId for global scenes and carries a signed create target through Excel", async () => {
    const globalPayload: BusinessEntryDraftPayload = {
      sceneKey: "company_entity",
      definitionVersion: 1,
      target: { entityType: "company_entity", createTarget: "signed-create-target" },
      values: { name: "测试公司" }
    };
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: "company_entity", fields: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ zeroWrites: true, rows: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    const file = new File(["xlsx"], "公司.xlsx", { type: "application/octet-stream" });

    await fetchBusinessEntryDefinition(
      "company_entity",
      { scope: "global" },
      globalPayload.target!
    );
    await previewBusinessEntryExcel({ scope: "global" }, globalPayload, file);

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/business-entry-definitions/company_entity?targetEntityType=company_entity&targetCreateTarget=signed-create-target&operation=edit"
    );
    const [requestPath, init] = mockApiFetch.mock.calls[1]!;
    expect(requestPath).toBe("/business-entry-definitions/company_entity/excel-preview");
    expect((init?.body as FormData).get("targetCreateTarget")).toBe("signed-create-target");
    expect((init?.body as FormData).get("targetEntityId")).toBeNull();
  });

  it("rejects blank project scopes and project context attached to global scopes", async () => {
    await expect(fetchBusinessEntryDefinition(
      "expense/line",
      { scope: "project", projectId: "" },
      payload.target!
    )).rejects.toThrow("项目业务场景必须绑定项目");
    await expect(fetchBusinessEntryDefinition(
      "company_entity",
      { scope: "global", projectId: "project/1" } as never,
      { entityType: "company_entity", entityId: "company-1" }
    )).rejects.toThrow("全局业务场景不得携带项目上下文");
  });
});
