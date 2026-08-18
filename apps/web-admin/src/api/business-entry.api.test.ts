import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessEntryDraftPayload } from "@jiangkong/shared-domain";
import {
  downloadBusinessEntryExcelTemplate,
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

    await fetchBusinessEntryDefinition("expense/line", "project/1");
    await validateBusinessEntryDraft("project/1", payload, "edit");

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/business-entry-definitions/expense%2Fline?projectId=project%2F1&operation=edit"
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

  it("uploads Excel as a zero-write preview using the same target and definition version", async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ zeroWrites: true, rows: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    const file = new File(["xlsx"], "费用.xlsx", { type: "application/octet-stream" });

    await expect(previewBusinessEntryExcel("project/1", payload, file)).resolves.toMatchObject({
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

    await expect(downloadBusinessEntryExcelTemplate(payload.sceneKey, "project/1"))
      .resolves.toBeInstanceOf(Blob);
    await freezeBusinessEntrySnapshot("project/1", payload, "import");

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/business-entry-definitions/expense%2Fline/excel-template?projectId=project%2F1"
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

    await fetchBusinessEntryDefinition("company_entity", undefined);
    await previewBusinessEntryExcel(undefined, globalPayload, file);

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/business-entry-definitions/company_entity?operation=edit"
    );
    const [requestPath, init] = mockApiFetch.mock.calls[1]!;
    expect(requestPath).toBe("/business-entry-definitions/company_entity/excel-preview");
    expect((init?.body as FormData).get("targetCreateTarget")).toBe("signed-create-target");
    expect((init?.body as FormData).get("targetEntityId")).toBeNull();
  });
});
