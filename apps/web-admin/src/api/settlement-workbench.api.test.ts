import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySettlementImport,
  downloadSettlementImportErrors,
  downloadSettlementImportResult,
  downloadSettlementImportTemplate,
  fetchSettlementSourceLines,
  previewSettlementImport,
  previewSettlementLines
} from "./settlement-workbench.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);

describe("settlement workbench API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads source lines from the contract-version resource endpoint", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ contractVersionId: "version/1", rows: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(fetchSettlementSourceLines("version/1")).resolves.toMatchObject({ rows: [] });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/settlement-workbench/contract-versions/version%2F1/source-lines",
      { method: "GET" }
    );
  });

  it("posts selected lines to the canonical preview resource", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          contractVersionId: "version-1",
          amountCents: null,
          lines: [
            {
              sourceType: "contract_bill_row",
              calculationMode: "normal_auto",
              contractBillRowId: "row-1",
              name: "钢筋",
              unit: "吨",
              quantity: "1",
              unitPrice: null,
              amountCents: null,
              reason: null,
              remark: null,
              sortOrder: 1
            }
          ],
          submissionBlockers: [
            {
              code: "missing_unit_price",
              contractBillRowId: "row-1",
              message: "合同清单项“钢筋”的含税单价尚未确认",
              remedyPath: "/合同工作台/contract-1"
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    const settlementLines = [
      { sourceType: "contract_bill_row" as const, contractBillRowId: "row-1", quantity: "1" }
    ];

    await expect(previewSettlementLines("version-1", { settlementLines })).resolves.toMatchObject({
      amountCents: null,
      lines: [expect.objectContaining({ amountCents: null })],
      submissionBlockers: [
        expect.objectContaining({
          code: "missing_unit_price",
          contractBillRowId: "row-1"
        })
      ]
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/settlement-workbench/contract-versions/version-1/preview",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ settlementLines }) })
    );
  });

  it("previews and applies an uploaded settlement workbook through scoped resources", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            importId: "import-1",
            sourceRevision: "revision-1",
            selectedCount: 1,
            settlementLines: [],
            canonical: null,
            errors: []
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ importId: "import-1", status: "applied", result: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );

    await previewSettlementImport("version/1", {
      fileId: "file-1",
      settlementTemplateVersionId: "template-version-1"
    });
    await applySettlementImport("project/1", "import/1");

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/settlement-workbench/contract-versions/version%2F1/imports/preview",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          fileId: "file-1",
          settlementTemplateVersionId: "template-version-1"
        })
      })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/settlement-workbench/projects/project%2F1/imports/import%2F1/apply",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("downloads template, error and result workbooks as authenticated blobs with Chinese names", async () => {
    const downloads: string[] = [];
    const anchor: {
      href: string;
      download: string;
      click: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
    } = {
      href: "",
      download: "",
      click: vi.fn(),
      remove: vi.fn()
    };
    anchor.click.mockImplementation(() => {
      downloads.push(anchor.download);
    });
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { appendChild: vi.fn() }
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:authenticated-download"),
      revokeObjectURL: vi.fn()
    });
    const blobResponse = (fileName: string) =>
      new Response(new Blob(["xlsx"]), {
        status: 200,
        headers: {
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
        }
      });
    mockApiFetch
      .mockResolvedValueOnce(blobResponse("本期结算导入模板.xlsx"))
      .mockResolvedValueOnce(blobResponse("结算导入错误.xlsx"))
      .mockResolvedValueOnce(blobResponse("结算导入结果.xlsx"));

    await downloadSettlementImportTemplate("version-1");
    await downloadSettlementImportErrors("project-1", "import-1");
    await downloadSettlementImportResult("project-1", "import-1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/settlement-workbench/contract-versions/version-1/import-template",
      "/settlement-workbench/projects/project-1/imports/import-1/errors.xlsx",
      "/settlement-workbench/projects/project-1/imports/import-1/result.xlsx"
    ]);
    expect(downloads).toEqual([
      "本期结算导入模板.xlsx",
      "结算导入错误.xlsx",
      "结算导入结果.xlsx"
    ]);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    vi.unstubAllGlobals();
  });
});
