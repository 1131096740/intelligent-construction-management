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
    "签约主体",
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
    "材料采购合同",
    "甲公司",
    "10000.00",
    "2026-01-10",
    "B级",
    "履约中",
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
    "清单名称",
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
    "材料清单",
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
    expect(workbook.getWorksheet("计价清单")?.getRow(1).getCell(8).value).toBe(
      "含税单价(元)"
    );
    const templateText = JSON.stringify(workbook.model);
    expect(templateText).not.toContain("签约主体编号");
    expect(templateText).not.toContain("清单标识");
    expect(templateText).not.toContain("项目标识");
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
            companyEntityName: "甲公司",
            amountCents: "1000000",
            invoiceType: "vat_special",
            defaultTaxRatePercent: "13",
            pricingItems: [
              expect.objectContaining({
                billKey: "HT-HIS-001-清单-1",
                rowKey: "项目-1",
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
            companyEntityName: "甲公司",
            pricingItems: [expect.objectContaining({ itemName: "钢材" })]
          })
        ]
      }),
      "contract-user"
    );
  });

  it("rejects technical enum values instead of passing them into the takeover precheck", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await takeoverWorkbook()) as unknown as ExcelJS.Buffer);
    workbook.getWorksheet("合同主表")!.getRow(2).getCell(4).value = "material_purchase";
    workbook.getWorksheet("计价清单")!.getRow(2).getCell(10).value = "true";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
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
    const takeovers = { precheckImport: jest.fn() };
    const service = new ContractTakeoverExcelService(files as never, takeovers as never);

    const preview = await service.preview("project-1", "contract-user", { fileId: "file-1" });

    expect(preview.errors).toContainEqual({
      sheet: "合同主表",
      row: 2,
      column: "合同类型",
      message: "合同类型必须填写中文业务名称"
    });
    expect(preview.errors).toContainEqual({
      sheet: "计价清单",
      row: 2,
      column: "是否暂定",
      message: "是否暂定必须填写“是”或“否”"
    });
    expect(takeovers.precheckImport).not.toHaveBeenCalled();
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

  it("exports the historical takeover ledger and records an audit without attachment bodies", async () => {
    const takeovers = {
      list: jest.fn().mockResolvedValue([takeoverReadModel()])
    };
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const service = new ContractTakeoverExcelService(
      {} as never,
      takeovers as never,
      undefined,
      audit as never,
      {} as never
    );

    const result = await service.exportLedger("project-1", "finance-user");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);

    expect(takeovers.list).toHaveBeenCalledWith("project-1");
    expect(result.fileName).toMatch(/^历史合同接管台账-\d{8}\.xlsx$/);
    expect(workbook.getWorksheet("接管台账")?.getRow(2).getCell(1).value).toBe(
      "HT-HIS-001"
    );
    expect(JSON.stringify(workbook.model)).not.toContain("objectKey");
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "finance-user",
        action: "contract.takeover.ledger.export",
        businessType: "contract_takeover_ledger",
        businessId: "project-1"
      })
    );
  });

  it("fails closed when historical takeover export auditing is unavailable", async () => {
    const takeovers = {
      list: jest.fn().mockResolvedValue([])
    };
    const service = new ContractTakeoverExcelService(
      {} as never,
      takeovers as never
    );

    await expect(
      service.exportLedger("project-1", "finance-user")
    ).rejects.toThrow("导出审计服务暂不可用");
  });

  it("exports one takeover detail with pricing, evidence metadata and tax revision history", async () => {
    const detail = takeoverReadModel();
    detail.pricingItems[0]!.pricingFactStatus = "pricing_fact_internal";
    const takeovers = {
      detail: jest.fn().mockResolvedValue(detail)
    };
    const taxFacts = {
      list: jest.fn().mockResolvedValue({
        contractId: "contract-1",
        current: {
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: "13",
          status: "confirmed",
          source: "contract_document",
          confirmationExplanation: "按原合同核对",
          evidenceFileId: "file-tax-1",
          revision: 1
        },
        rows: [
          {
            contractBillRowId: "bill-row-internal-1",
            billName: "材料清单",
            rowKey: "row-1",
            itemName: "钢材",
            specification: "HRB400",
            unit: "吨",
            taxInclusiveUnitPrice: "108.00",
            taxRatePercent: "13",
            taxRateSource: "default",
            pricingFactStatus: "confirmed"
          }
        ],
        revisions: [
          {
            id: "revision-1",
            revisionNo: 1,
            kind: "supplement",
            status: "confirmed",
            invoiceType: "vat_special",
            taxMode: "single_rate",
            defaultTaxRatePercent: "13",
            source: "contract_document",
            confirmationExplanation: "按原合同核对",
            evidenceFileId: "file-tax-1",
            rowFacts: [
              {
                contractBillRowId: "bill-row-internal-1",
                taxInclusiveUnitPrice: "108.00",
                taxRatePercentOverride: null
              }
            ],
            beforeSnapshot: {
              rows: [
                {
                  contractBillRowId: "bill-row-internal-1",
                  taxInclusiveUnitPrice: "100.00",
                  taxRatePercent: "13"
                }
              ]
            },
            createdByUserId: "contract-user",
            submittedByUserId: "contract-user",
            submittedAt: "2026-07-16T08:00:00.000Z",
            financeReviewedByUserId: "finance-director",
            financeReviewedAt: "2026-07-16T09:00:00.000Z",
            financeReviewComment: "财务核对通过",
            confirmedByUserId: "contract-director",
            confirmedAt: "2026-07-16T10:00:00.000Z",
            contractReviewComment: "合同部确认完成",
            createdAt: "2026-07-16T07:00:00.000Z",
            updatedAt: "2026-07-16T10:00:00.000Z"
          }
        ]
      })
    };
    const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
    const service = new ContractTakeoverExcelService(
      {} as never,
      takeovers as never,
      taxFacts as never,
      audit as never,
      {} as never
    );

    const result = await service.exportDetail(
      "project-1",
      "takeover-1",
      "comprehensive-user"
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer as unknown as ExcelJS.Buffer);

    expect(takeovers.detail).toHaveBeenCalledWith("project-1", "takeover-1");
    expect(taxFacts.list).toHaveBeenCalledWith("project-1", "takeover-1");
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "接管详情",
      "历史计价",
      "税务修订",
      "税务修订明细",
      "资料与更正"
    ]);
    expect(workbook.getWorksheet("税务修订")?.getRow(2).getCell(2).value).toBe("当前资料");
    expect(
      workbook.getWorksheet("税务修订明细")?.getRow(2).values
    ).toEqual(
      expect.arrayContaining(["材料清单", "钢材", "100.00", "108.00"])
    );
    expect(JSON.stringify(workbook.model)).not.toContain("file-tax-1");
    expect(JSON.stringify(workbook.model)).not.toContain("bill-row-internal-1");
    expect(JSON.stringify(workbook.model)).not.toContain("修订号");
    expect(JSON.stringify(workbook.model)).not.toContain("revisionNo");
    expect(JSON.stringify(workbook.model)).not.toContain("pricing_fact_internal");
    expect(JSON.stringify(workbook.model)).toContain("价格状态待确认");
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "comprehensive-user",
        action: "contract.takeover.detail.export",
        businessType: "contract_takeover",
        businessId: "takeover-1"
      })
    );
  });
});

function takeoverReadModel() {
  return {
    id: "takeover-1",
    batchNo: "BATCH-001",
    importRowNo: 1,
    contractNo: "HT-HIS-001",
    contractName: "历史材料合同",
    counterparty: "供应商甲",
    companyEntityName: "甲公司",
    amountCents: "1000000",
    paymentTermsOriginalText: "按月结算",
    invoiceType: "vat_special",
    taxMode: "single_rate",
    defaultTaxRatePercent: "13",
    taxFactStatus: "confirmed",
    taxFactSource: "contract_document",
    taxFactExplanation: "按原合同核对",
    taxFactMissingFields: [],
    pricingItems: [
      {
        billKey: "main",
        billName: "材料清单",
        rowKey: "row-1",
        itemCode: "CL-001",
        itemName: "钢材",
        specification: "HRB400",
        unit: "吨",
        estimatedQuantity: "2",
        taxInclusiveUnitPrice: "100.00",
        taxRatePercent: "13",
        pricingFactStatus: "confirmed",
        isProvisional: false,
        settlementBasis: "现场核量"
      }
    ],
    takeoverLevel: "B",
    suggestedTakeoverLevel: "B",
    takeoverLevelAdjustmentReason: null,
    levelRiskText: "资料完整",
    paymentBlockingHint: "可按规则办理",
    evidenceGapSummary: "资料已齐",
    takeoverStatus: "confirmed",
    lifecycleStatus: "in_progress",
    signedAt: "2026-01-10T00:00:00.000Z",
    historicalSettledCents: "600000",
    historicalApprovalPendingPaymentCents: "0",
    historicalApprovedPendingPaymentCents: "10000",
    historicalPaidCents: "300000",
    historicalProxyPaidCents: "0",
    historicalAdvancePaidCents: "0",
    historicalAdvanceDeductedCents: "0",
    historicalRetentionWithheldCents: "10000",
    historicalRetentionReleasedCents: "0",
    otherConfirmedOccupancyCents: "0",
    balanceSourceSummary: "财务台账",
    evidenceSummary: "合同扫描件和付款凭证",
    takeoverCutoffDate: "2026-06-30T00:00:00.000Z",
    responsibleUserId: "contract-user",
    responsibleUserName: "合同员",
    reviewComment: "已复核",
    acceptanceConclusion: "允许接管",
    submittedAt: "2026-07-15T08:00:00.000Z",
    confirmedAt: "2026-07-16T08:00:00.000Z",
    historicalBalanceConfirmedAt: "2026-07-16T08:00:00.000Z",
    evidenceChecklist: [
      {
        purpose: "historical_contract_scan",
        purposeLabel: "历史合同扫描件",
        required: true,
        uploaded: true,
        statusLabel: "已上传",
        riskText: "资料已齐"
      }
    ],
    evidenceFiles: [
      {
        recordId: "record-1",
        fileId: "file-1",
        fileName: "历史合同.pdf",
        purpose: "historical_contract_scan",
        purposeLabel: "历史合同扫描件",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        uploadedByName: "合同员",
        uploadedAt: "2026-07-15T07:00:00.000Z",
        canDownload: true,
        disabledReason: null
      }
    ],
    corrections: [
      {
        id: "correction-1",
        correctionType: "evidence",
        correctionTypeLabel: "资料更正",
        reason: "补齐付款凭证",
        beforeSummary: "缺少凭证",
        afterSummary: "已补齐",
        responsibleUserName: "合同员",
        createdByName: "合同部主管",
        attachmentFileId: "file-correction-1",
        attachmentFileName: "付款凭证.pdf",
        createdAt: "2026-07-16T07:00:00.000Z"
      }
    ],
    postConfirmationVerification: {
      statusLabel: "已核验",
      summaryText: "账本一致",
      newSettlementCount: 0,
      paymentRequestCount: 0,
      paymentExecutionCount: 0,
      financeRecordCount: 0
    },
    createdAt: "2026-07-15T07:00:00.000Z",
    updatedAt: "2026-07-16T08:00:00.000Z"
  };
}
