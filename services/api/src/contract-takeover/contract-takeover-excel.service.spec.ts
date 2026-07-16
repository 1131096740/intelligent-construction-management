import * as ExcelJS from "exceljs";
import { ContractTakeoverExcelService } from "./contract-takeover-excel.service";

async function takeoverWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const main = workbook.addWorksheet("合同主表");
  main.addRow([
    "合同编号",
    "合同名称",
    "相对方",
    "合同类型",
    "签约主体编号",
    "签约主体名称",
    "合同金额(元)",
    "签订日期",
    "接管等级",
    "履约状态",
    "付款条款",
    "发票类型",
    "计税模式",
    "默认税率(%)",
    "税务事实来源",
    "确认说明"
  ]);
  main.addRow([
    "HT-HIS-001",
    "历史材料合同",
    "供应商甲",
    "material_purchase",
    "",
    "甲公司",
    "10000.00",
    "2026-01-10",
    "B",
    "in_progress",
    "按月结算",
    "增值税专用发票",
    "单一税率",
    "13",
    "合同文件明确",
    ""
  ]);
  const pricing = workbook.addWorksheet("计价清单");
  pricing.addRow([
    "合同编号",
    "清单标识",
    "清单名称",
    "项目标识",
    "项目编号",
    "名称",
    "规格型号",
    "单位",
    "预计数量",
    "含税单价(元)",
    "例外税率(%)",
    "是否暂定",
    "结算依据"
  ]);
  pricing.addRow([
    "HT-HIS-001",
    "main",
    "材料清单",
    "row-1",
    "CL-001",
    "钢材",
    "HRB400",
    "吨",
    "2",
    "100",
    "",
    "否",
    "现场核量"
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("ContractTakeoverExcelService", () => {
  it("exports a two-sheet Chinese workbook template", async () => {
    const service = new ContractTakeoverExcelService({} as never, {} as never);
    const result = await service.exportTemplate();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);

    expect(result.fileName).toBe("历史合同接管导入模板.xlsx");
    expect(workbook.getWorksheet("合同主表")?.getRow(1).getCell(1).value).toBe("合同编号");
    expect(workbook.getWorksheet("计价清单")?.getRow(1).getCell(10).value).toBe(
      "含税单价(元)"
    );
  });

  it("re-reads the same private file and applies only the prechecked workbook facts", async () => {
    const buffer = await takeoverWorkbook();
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: {
          id: "file-1",
          originalName: "历史合同.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: buffer.length,
          uploadedByUserId: "contract-user",
          storageStatus: "active"
        },
        buffer
      })
    };
    const takeovers = {
      precheckImport: jest.fn().mockResolvedValue({
        projectId: "project-1",
        totalRows: 1,
        readyRows: 1,
        blockedRows: 0,
        warningRows: 0,
        existingCodes: [],
        duplicatedCodes: [],
        rows: []
      }),
      createDraftsFromImport: jest.fn().mockResolvedValue({ createdCount: 1 })
    };
    const service = new ContractTakeoverExcelService(files as never, takeovers as never);

    const preview = await service.preview("project-1", "contract-user", { fileId: "file-1" });
    expect(preview.errors).toEqual([]);
    expect(takeovers.precheckImport).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            code: "HT-HIS-001",
            amountCents: "1000000",
            invoiceType: "vat_special",
            defaultTaxRatePercent: "13",
            pricingItems: [
              expect.objectContaining({
                rowKey: "row-1",
                estimatedQuantity: "2",
                taxInclusiveUnitPrice: "100"
              })
            ]
          })
        ]
      })
    );

    await service.apply("project-1", "contract-user", {
      fileId: "file-1",
      fileSha256: preview.fileSha256,
      importFingerprint: preview.importFingerprint,
      takeoverCutoffDate: "2026-06-30",
      responsibleUserId: "contract-director-1",
      reviewComment: "已完成批次复核",
      acceptanceConclusion: "允许生成接管草稿"
    });

    expect(files.getFileBuffer).toHaveBeenCalledTimes(2);
    expect(takeovers.createDraftsFromImport).toHaveBeenCalledWith(
      "project-1",
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            code: "HT-HIS-001",
            pricingItems: [expect.objectContaining({ itemName: "钢材" })]
          })
        ]
      }),
      "contract-user"
    );
  });

  it("rejects an apply request when the private file changed after preview", async () => {
    const buffer = await takeoverWorkbook();
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: {
          originalName: "历史合同.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: buffer.length,
          uploadedByUserId: "contract-user",
          storageStatus: "active"
        },
        buffer
      })
    };
    const service = new ContractTakeoverExcelService(files as never, {} as never);

    await expect(
      service.apply("project-1", "contract-user", {
        fileId: "file-1",
        fileSha256: "different",
        importFingerprint: "fingerprint",
        takeoverCutoffDate: "2026-06-30",
        responsibleUserId: "contract-director-1",
        reviewComment: "已复核",
        acceptanceConclusion: "允许生成"
      })
    ).rejects.toThrow("导入文件已发生变化，请重新预检后再生成接管草稿");
  });
});
