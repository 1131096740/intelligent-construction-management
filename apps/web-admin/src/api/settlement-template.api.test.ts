import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadSettlementTemplatePreview,
  fetchSettlementTemplateRecommendations,
  listSettlementTemplates,
  publishSettlementTemplateVersion,
  updateSettlementTemplateVersion
} from "./settlement-template.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("settlement template API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses governance and recommendation resource endpoints", async () => {
    mockApiFetch
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "version-1", draftRevision: 4 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "version-1", status: "published" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ selectionMode: "choice_required", selected: null, choices: [] }),
          { status: 200 }
        )
      );

    await listSettlementTemplates();
    await updateSettlementTemplateVersion("version/1", {
      expectedRevision: 3,
      compatibleContractTypeKeys: ["labor_subcontract"]
    });
    await publishSettlementTemplateVersion("version/1", "完成打印核对");
    await fetchSettlementTemplateRecommendations("project/1", "contract/1");

    expect(mockApiFetch).toHaveBeenNthCalledWith(1, "/settlement-templates");
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/settlement-template-versions/version%2F1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/settlement-template-versions/version%2F1/publication",
      expect.objectContaining({ body: JSON.stringify({ changeSummary: "完成打印核对" }) })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      4,
      "/settlement-workbench/projects/project%2F1/contract-versions/contract%2F1/template-recommendations"
    );
  });

  it("keeps the short-lived preview URL inside the authenticated download helper", async () => {
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild: vi.fn() }
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:preview"),
      revokeObjectURL: vi.fn()
    });
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ downloadUrl: "/files/download-tickets/ticket-1", fileName: "结算模板脱敏预览.pdf" }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(new Blob(["pdf"]), { status: 200 }));

    await downloadSettlementTemplatePreview("version-1", "pdf", "发布前核对");

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/settlement-template-versions/version-1/preview-pdf/download-ticket",
      expect.objectContaining({ body: JSON.stringify({ downloadReason: "发布前核对" }) })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(2, "/files/download-tickets/ticket-1");
    expect(anchor.download).toBe("结算模板脱敏预览.pdf");
    expect(anchor.click).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
