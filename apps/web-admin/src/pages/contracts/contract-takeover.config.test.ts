import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ContractTakeoverReadModel } from "../../api/core-flow-read.api";
import { describe, expect, it } from "vitest";
import {
  buildImportDraftsMessage,
  buildImportPrecheckMessage,
  buildTakeoverConfirmationSummary,
  buildTakeoverPostConfirmationChecklist,
  companyEntityMatchOptionLabel,
  companyEntityMatchStatus,
  canConfirmHistoricalChangeBaseline,
  canConfirmTakeover,
  canReturnTakeoverForSupplement,
  canEditTakeover,
  canSubmitTakeoverReview,
  centsToYuanText,
  contractTakeoverPerformanceStatus,
  contractTakeoverColumns,
  historicalChangeBaselineView,
  historicalPaymentVoucherUploadDisabledReason,
  invoiceTypeLabel,
  lifecycleStatusLabel,
  importPrecheckRowStatusLabel,
  normalizeHistoricalPricingItems,
  normalizeOptionalTaxRate,
  normalizeTakeoverDirectPaymentStages,
  parseContractTakeoverImportPrecheckRows,
  suggestTakeoverLevel,
  takeoverActionDisabledReason,
  takeoverBatchAbandonmentDisabledReason,
  takeoverConfirmDisabledReason,
  takeoverConfirmationEvidenceBlockReason,
  takeoverCorrectionDisabledReason,
  takeoverCorrectionRows,
  takeoverEvidenceDownloadDisabledReason,
  takeoverEvidenceUploadDisabledReason,
  takeoverLevelAdjustmentDisabledReason,
  takeoverResponsibleUserText,
  takeoverResponsibleUserOptions,
  takeoverLevelSelectionHint,
  takeoverLevelReviewText,
  takeoverOperationSections,
  takeoverSuggestionApplyDisabledReason,
  takeoverSuggestedLevelLabel,
  takeoverWorkbenchSteps,
  takeoverPostConfirmationVerificationView,
  takeoverDepartmentAccess,
  takeoverFinanceBasisStatus,
  takeoverLevelLabel,
  takeoverStatusLabel,
  takeoverStatusTone,
  taxFactSourceLabel,
  taxModeLabel,
  toContractTakeoverTableRow,
  yuanToCents
} from "./contract-takeover.config";

describe("contract takeover page configuration", () => {
  it("maps every legacy lifecycle status into the contract-side performance vocabulary", () => {
    expect(contractTakeoverPerformanceStatus("signed_not_started")).toBe("not_started");
    expect(contractTakeoverPerformanceStatus("in_progress")).toBe("performing");
    expect(contractTakeoverPerformanceStatus("disputed")).toBe("performing");
    expect(contractTakeoverPerformanceStatus("suspended")).toBe("suspended");
    expect(contractTakeoverPerformanceStatus("completed")).toBe("completed");
    expect(contractTakeoverPerformanceStatus("terminated")).toBe("terminated");
  });

  it("keeps each historical takeover role on its own side and removes editing after activation", () => {
    expect(takeoverDepartmentAccess(["contract_staff"], false)).toMatchObject({
      canEditContract: true,
      canEditFinance: false,
      canConfirmContract: false
    });
    expect(takeoverDepartmentAccess(["contract_director"], false)).toMatchObject({
      canEditContract: true,
      canConfirmContract: true,
      canEditFinance: false
    });
    expect(takeoverDepartmentAccess(["finance_staff"], false)).toMatchObject({
      canEditFinance: true,
      canEditContract: false,
      canConfirmFinance: false
    });
    expect(takeoverDepartmentAccess(["finance_director"], false)).toMatchObject({
      canEditFinance: true,
      canConfirmFinance: true,
      canEditContract: false
    });
    expect(takeoverDepartmentAccess(["super_admin"], false)).toEqual({
      canEditContract: false,
      canConfirmContract: false,
      canEditFinance: false,
      canConfirmFinance: false
    });
    expect(takeoverDepartmentAccess(["contract_director", "finance_director"], true)).toEqual({
      canEditContract: false,
      canConfirmContract: false,
      canEditFinance: false,
      canConfirmFinance: false
    });
  });

  it("distinguishes a harmless full revision advance from a stale finance basis", () => {
    expect(takeoverFinanceBasisStatus(5, 3, 4, 3)).toEqual({
      status: "contract_revision_advanced",
      label: "非财务字段已更新、确认仍有效"
    });
    expect(takeoverFinanceBasisStatus(5, 4, 4, 3)).toEqual({
      status: "stale",
      label: "财务依据已过期，请重新读取并核对"
    });
    expect(takeoverFinanceBasisStatus(5, 4, 5, 4)).toEqual({
      status: "current",
      label: "财务依据与合同侧当前口径一致"
    });
  });

  it("only enables finance payment-voucher supplementation after a supervisor return", () => {
    const base = {
      takeoverStatus: "needs_supplement" as const,
      evidenceChecklist: [{
        purpose: "historical_payment_voucher" as const,
        purposeLabel: "历史付款凭证",
        required: true,
        uploaded: false,
        statusLabel: "待补齐",
        riskText: "缺少历史付款凭证"
      }]
    };

    expect(historicalPaymentVoucherUploadDisabledReason(base, false)).toBe("请先选择历史付款凭证文件");
    expect(historicalPaymentVoucherUploadDisabledReason(base, true)).toBe("");
    expect(historicalPaymentVoucherUploadDisabledReason({ ...base, takeoverStatus: "pending_review" }, true)).toBe(
      "请等待合同部主管退回补充后，再由财务补充付款凭证"
    );
    expect(historicalPaymentVoucherUploadDisabledReason({
      ...base,
      evidenceChecklist: [{ ...base.evidenceChecklist[0], uploaded: true, statusLabel: "已上传" }]
    }, true)).toBe("历史付款凭证已补齐，请由合同岗核对并重新提交复核");
  });

  it("requires a server preview before atomically cleaning an import batch", () => {
    const source = readFileSync(resolve(__dirname, "ContractTakeoverPage.vue"), "utf8");

    expect(source).toContain("previewContractTakeoverBatchAbandonment");
    expect(source).toContain("applyContractTakeoverBatchAbandonment");
    expect(source).toContain("previewHash: preview.previewHash");
    expect(source).toContain('colKey: "contractNo"');
    expect(source).toContain('colKey: "contractName"');
    expect(source).toContain('colKey: "blockers"');
    expect(source).toContain("request.action !== \"delete_pristine_draft\"");
    expect(source).toContain("<BusinessDraftAction");
  });

  it("blocks a mixed batch because batch abandonment is all-or-nothing", () => {
    expect(takeoverBatchAbandonmentDisabledReason({ eligible: 2, blocked: 1 })).toBe(
      "批次清理采用全有或全无规则。当前仍有被阻断记录，请先逐条处理全部阻断，再重新预览。"
    );
    expect(takeoverBatchAbandonmentDisabledReason({ eligible: 0, blocked: 0 })).toBe(
      "本次预览没有可清理记录，系统不会改变任何接管记录。"
    );
    expect(takeoverBatchAbandonmentDisabledReason({ eligible: 3, blocked: 0 })).toBe("");
  });

  it("keeps the historical contract entity name separate from its system match", () => {
    const inactive = {
      id: "entity-1",
      name: "当前主体名称",
      unifiedSocialCreditCode: "91530100MA6K000001",
      dataStatus: "complete" as const,
      isActive: false
    };

    expect(companyEntityMatchOptionLabel(inactive)).toBe(
      "当前主体名称 · 91530100MA6K000001 · 已停用"
    );
    expect(companyEntityMatchStatus(inactive)).toEqual({
      label: "已停用（仅历史匹配）",
      tone: "warning"
    });
    expect(
      companyEntityMatchStatus({
        ...inactive,
        isActive: true,
        dataStatus: "legacy_incomplete"
      })
    ).toEqual({ label: "资料待补全（仅历史匹配）", tone: "warning" });
  });

  it("uses compact columns for historical contract takeover ledger", () => {
    expect(contractTakeoverColumns.map((column) => column.title)).toEqual([
      "合同编号",
      "合同名称",
      "接管批次",
      "相对方",
      "合同金额",
      "系统建议",
      "确认等级",
      "接管状态",
      "履约状态",
      "接管截止日",
      "历史已付",
      "在途/待付",
      "更新时间",
      "操作"
    ]);
  });

  it("converts yuan input to integer cents with BigInt-safe parsing", () => {
    expect(yuanToCents("0.01", "历史已付")).toBe("1");
    expect(yuanToCents("1234567.89", "合同金额")).toBe("123456789");
    expect(yuanToCents("", "历史总包代付", { allowZero: true })).toBe("0");
    expect(yuanToCents("0", "历史总包代付", { allowZero: true })).toBe("0");

    expect(() => yuanToCents("0", "合同金额")).toThrow("合同金额必须大于 0");
    expect(() => yuanToCents("-1", "历史已付")).toThrow("历史已付必须是非负数字");
    expect(() => yuanToCents("1.234", "历史已付")).toThrow("历史已付必须是非负数字");
    expect(() => yuanToCents("abc", "历史已付")).toThrow("历史已付必须是非负数字");
  });

  it("normalizes manually entered generic contract direct payment stages", () => {
    expect(
      normalizeTakeoverDirectPaymentStages([
        {
          rowKey: "stage-1",
          name: "首期合同款",
          amountMode: "ratio",
          ratioPercent: "30.5",
          fixedAmountYuan: "",
          dueDays: "7",
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: false
        },
        {
          rowKey: "stage-2",
          name: "验收尾款",
          amountMode: "fixed",
          ratioPercent: "",
          fixedAmountYuan: "7000.00",
          dueDays: "30",
          requiresInvoice: true,
          allowsEarlyPayment: false,
          allowsInstallments: true
        }
      ])
    ).toEqual([
      expect.objectContaining({ name: "首期合同款", ratioBps: 3050, dueDays: 7 }),
      expect.objectContaining({ name: "验收尾款", fixedAmountCents: "700000", dueDays: 30 })
    ]);
  });

  it("rejects missing or zero generic contract direct payment facts", () => {
    expect(() => normalizeTakeoverDirectPaymentStages([])).toThrow("至少一个");
    expect(() =>
      normalizeTakeoverDirectPaymentStages([
        {
          rowKey: "stage-1",
          name: "合同款",
          amountMode: "ratio",
          ratioPercent: "0",
          fixedAmountYuan: "",
          dueDays: "0",
          requiresInvoice: false,
          allowsEarlyPayment: false,
          allowsInstallments: true
        }
      ])
    ).toThrow("必须大于 0%");
  });

  it("keeps optional historical tax facts explicit and validates pricing and tax precision separately", () => {
    expect(invoiceTypeLabel(null)).toBe("原合同未明确");
    expect(invoiceTypeLabel("vat_special")).toBe("增值税专用发票");
    expect(taxModeLabel("single_rate")).toBe("单一税率");
    expect(taxFactSourceLabel(null)).toBe("—");
    expect(normalizeOptionalTaxRate("", "默认税率")).toBeUndefined();
    expect(normalizeOptionalTaxRate("13.00", "默认税率")).toBe("13");
    expect(normalizeOptionalTaxRate("13.01", "默认税率")).toBe("13.01");
    expect(normalizeOptionalTaxRate("0", "默认税率")).toBe("0");
    expect(normalizeOptionalTaxRate("13.001", "默认税率")).toBe("13.001");
    expect(() => normalizeOptionalTaxRate("13.0000001", "默认税率")).toThrow(
      "默认税率最多保留 6 位小数"
    );
    expect(() => normalizeOptionalTaxRate("100.01", "默认税率")).toThrow(
      "税率不能超过 100"
    );

    expect(
      normalizeHistoricalPricingItems([
        {
          billKey: "main",
          billName: "历史计价清单",
          rowKey: "row-1",
          itemCode: "CL-001",
          itemName: "钢材",
          specification: "HRB400",
          unit: "吨",
          estimatedQuantity: "10.50",
          taxInclusiveUnitPrice: "4000.00",
          taxRatePercentOverride: "",
          isProvisional: false,
          settlementBasis: "按实际验收量结算"
        }
      ])
    ).toEqual([
      {
        billKey: "main",
        billName: "历史计价清单",
        rowKey: "row-1",
        itemCode: "CL-001",
        itemName: "钢材",
        specification: "HRB400",
        unit: "吨",
        estimatedQuantity: "10.50",
        taxInclusiveUnitPrice: "4000.00",
        taxRatePercentOverride: undefined,
        isProvisional: false,
        settlementBasis: "按实际验收量结算"
      }
    ]);
    expect(() =>
      normalizeHistoricalPricingItems([
        {
          billKey: "main",
          billName: "历史计价清单",
          rowKey: "row-1",
          itemCode: "",
          itemName: "钢材",
          specification: "",
          unit: "吨",
          estimatedQuantity: "10.501",
          taxInclusiveUnitPrice: "",
          taxRatePercentOverride: "",
          isProvisional: false,
          settlementBasis: ""
        }
      ])
    ).toThrow("预计数量必须是非负数字且最多保留 2 位小数");

    expect(
      normalizeHistoricalPricingItems([
        {
          billKey: "main",
          billName: "历史计价清单",
          rowKey: "row-2",
          itemCode: "",
          itemName: "混凝土",
          specification: "C30",
          unit: "立方米",
          estimatedQuantity: "10.50",
          taxInclusiveUnitPrice: "360.00",
          taxRatePercentOverride: "9.01",
          isProvisional: false,
          settlementBasis: ""
        }
      ])[0]?.taxRatePercentOverride
    ).toBe("9.01");
    expect(() =>
      normalizeHistoricalPricingItems([
        {
          billKey: "main",
          billName: "历史计价清单",
          rowKey: "row-3",
          itemCode: "",
          itemName: "混凝土",
          specification: "C30",
          unit: "立方米",
          estimatedQuantity: "10.50",
          taxInclusiveUnitPrice: "360.001",
          taxRatePercentOverride: "9.01",
          isProvisional: false,
          settlementBasis: ""
        }
      ])
    ).toThrow("含税单价必须是非负数字且最多保留 2 位小数");
  });

  it("parses pasted takeover import rows without shifting blank leading TSV cells", () => {
    const rows = parseContractTakeoverImportPrecheckRows(
      [
        "合同编号\t合同名称\t相对方\t我方主体\t合同金额(元)\t签订日期\t接管等级\t履约状态",
        "\t缺编号合同\t历史供应商\t建工集团\t100.00\t2026-01-01\tB级\t履约中"
      ].join("\n")
    );

    expect(rows[0]).toMatchObject({
      rowNo: 2,
      code: "",
      name: "缺编号合同",
      counterparty: "历史供应商",
      amountCents: "10000",
      takeoverLevel: "B",
      lifecycleStatus: "in_progress"
    });
  });

  it("keeps invalid historical amount cells visible to backend precheck", () => {
    const rows = parseContractTakeoverImportPrecheckRows(
      [
        "code,name,counterparty,company,amount,signedAt,level,status,terms,settled",
        "HT-LS-001,历史合同,历史供应商,建工集团,100.00,2026-01-01,B,in_progress,按月付款,abc"
      ].join("\n")
    );

    expect(rows[0]).toMatchObject({
      code: "HT-LS-001",
      amountCents: "10000",
      historicalSettledCents: null
    });
  });

  it("parses evidence checklist and issue summary for takeover import precheck", () => {
    const rows = parseContractTakeoverImportPrecheckRows(
      [
        "合同编号\t合同名称\t相对方\t我方主体\t合同金额(元)\t签订日期\t接管等级\t履约状态\t付款条款\t历史累计结算(元)\t历史审批中付款(元)\t历史已批待付(元)\t历史累计已付(元)\t历史总包代付(元)\t历史预付款已付(元)\t历史预付款已扣回(元)\t历史质保金扣留(元)\t历史质保金释放(元)\t其他确认占用(元)\t余额来源\t证据说明\t资料清单\t问题清单",
        "HT-LS-002\t历史合同\t供应商\t建工集团\t100.00\t2026-01-01\tC\tin_progress\t按月付款\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t财务台账\t合同扫描件\t缺历史付款凭证\t财务本周补凭证"
      ].join("\n")
    );

    expect(rows[0]).toMatchObject({
      evidenceChecklist: "缺历史付款凭证",
      issueSummary: "财务本周补凭证"
    });
  });

  it("summarizes import precheck warnings before draft generation", () => {
    expect(
      buildImportPrecheckMessage({
        readyRows: 2,
        blockedRows: 0,
        warningRows: 1
      })
    ).toEqual({
      message: "导入预检完成：2 行可生成草稿，0 行需修改，1 行需要补充说明",
      tone: "default"
    });
  });

  it("labels ready precheck rows as draft generation instead of direct import", () => {
    expect(importPrecheckRowStatusLabel("ready")).toBe("可生成草稿");
    expect(importPrecheckRowStatusLabel("blocked")).toBe("需修正");
  });

  it("keeps import draft warning rows visible after drafts are generated", () => {
    expect(
      buildImportDraftsMessage({
        batchNo: "接管批次-20260710-TEST0001",
        createdCount: 3,
        skippedCount: 1,
        warningRows: 2
      })
    ).toBe(
      "接管批次-20260710-TEST0001 已生成 3 份接管草稿，含 2 行需要复核说明，已跳过重复行 1 行，请进入草稿核对后再提交复核。"
    );
  });

  it("formats cents from API string values for display", () => {
    expect(centsToYuanText("0")).toBe("¥0.00");
    expect(centsToYuanText("1")).toBe("¥0.01");
    expect(centsToYuanText("123456789")).toBe("¥1,234,567.89");
    expect(() => centsToYuanText("abc")).toThrow("金额数据格式不正确，请刷新后重试");
  });

  it("maps takeover status and lifecycle status to Chinese display", () => {
    expect(takeoverLevelLabel("A")).toBe("A级");
    expect(takeoverStatusLabel("pending_review")).toBe("待复核");
    expect(takeoverStatusTone("confirmed")).toBe("success");
    expect(lifecycleStatusLabel("signed_not_started")).toBe("已签未开工");
    expect(takeoverLevelLabel("internal_level")).toBe("等级未读取");
    expect(takeoverStatusLabel("internal_status")).toBe("接管状态未读取");
    expect(lifecycleStatusLabel("internal_lifecycle")).toBe("履约状态未读取");
  });

  it("shows takeover responsible user without exposing internal user ids", () => {
    expect(takeoverResponsibleUserText(takeover())).toBe("合同负责人");
    expect(takeoverResponsibleUserText({ ...takeover(), responsibleUserName: null })).toBe(
      "已指定责任人"
    );
    expect(
      takeoverResponsibleUserText({
        ...takeover(),
        responsibleUserId: null,
        responsibleUserName: null
      })
    ).toBe("未填写");
  });

  it("shows workflow actions only for allowed statuses", () => {
    expect(canSubmitTakeoverReview({ takeoverStatus: "draft" })).toBe(true);
    expect(canSubmitTakeoverReview({ takeoverStatus: "needs_supplement" })).toBe(true);
    expect(canSubmitTakeoverReview({ takeoverStatus: "pending_review" })).toBe(false);
    expect(canSubmitTakeoverReview({ takeoverStatus: "confirmed" })).toBe(false);

    expect(canConfirmTakeover({ takeoverStatus: "pending_review" })).toBe(true);
    expect(canConfirmTakeover({ takeoverStatus: "draft" })).toBe(false);
    expect(canConfirmTakeover({ takeoverStatus: "confirmed" })).toBe(false);

    expect(canEditTakeover({ takeoverStatus: "draft" })).toBe(true);
    expect(canEditTakeover({ takeoverStatus: "needs_supplement" })).toBe(true);
    expect(canEditTakeover({ takeoverStatus: "pending_review" })).toBe(false);
    expect(canReturnTakeoverForSupplement({ takeoverStatus: "pending_review" })).toBe(true);
    expect(canReturnTakeoverForSupplement({ takeoverStatus: "draft" })).toBe(false);
  });

  it("blocks confirmation before the required historical evidence is complete", () => {
    expect(takeoverConfirmationEvidenceBlockReason(takeover())).toBe(
      "缺少必需接管资料：历史付款凭证。请先退回补充，补齐后重新提交复核。"
    );
    expect(
      takeoverConfirmationEvidenceBlockReason({
        ...takeover(),
        evidenceChecklist: takeover().evidenceChecklist.map((item) => ({
          ...item,
          uploaded: true,
          statusLabel: "已上传"
        }))
      })
    ).toBe("");
  });

  it("keeps the initiator first and selectable as the default takeover owner", () => {
    expect(
      takeoverResponsibleUserOptions(
        [{ id: "duan", name: "段红霞" }],
        { id: "zhang", name: "张志娟" }
      )
    ).toEqual([
      { label: "张志娟（本人）", value: "zhang" },
      { label: "段红霞", value: "duan" }
    ]);
    expect(
      takeoverResponsibleUserOptions(
        [
          { id: "zhang", name: "张志娟" },
          { id: "duan", name: "段红霞" }
        ],
        { id: "zhang", name: "张志娟" }
      )
    ).toHaveLength(2);
  });

  it("explains disabled takeover actions in business Chinese", () => {
    expect(takeoverActionDisabledReason(takeover(), "edit")).toBe(
      "已提交复核，需退回补充后才能编辑"
    );
    expect(takeoverActionDisabledReason(takeover(), "submit_review")).toBe(
      "已在复核中，无需重复提交"
    );
    expect(
      takeoverActionDisabledReason({ ...takeover(), takeoverStatus: "draft" }, "confirm")
    ).toBe("请先补齐资料并提交复核后，再由主管确认");
    expect(
      takeoverActionDisabledReason({ ...takeover(), takeoverStatus: "confirmed" }, "confirm")
    ).toBe("已完成主管确认，无需重复确认");
  });

  it("explains why takeover evidence upload is disabled", () => {
    expect(
      takeoverEvidenceUploadDisabledReason({ ...takeover(), takeoverStatus: "draft" }, false)
    ).toBe("请先选择要上传的接管资料文件");
    expect(takeoverEvidenceUploadDisabledReason(takeover(), true)).toBe(
      "已提交复核，需退回补充后才能继续上传资料"
    );
    expect(
      takeoverEvidenceUploadDisabledReason({ ...takeover(), takeoverStatus: "confirmed" }, true)
    ).toBe("已完成主管确认，接管资料不能静默补充，请发起更正记录并保留原因、责任人和附件");
    expect(
      takeoverEvidenceUploadDisabledReason({ ...takeover(), takeoverStatus: "voided" }, true)
    ).toBe("接管记录已作废，不能上传资料");
  });

  it("explains why takeover evidence download is disabled", () => {
    expect(
      takeoverEvidenceDownloadDisabledReason({
        fileId: "",
        password: "",
        downloadReason: "",
        availableFileIds: [],
        hasFiles: false
      })
    ).toBe("暂无接管资料可下载");
    expect(
      takeoverEvidenceDownloadDisabledReason({
        fileId: "",
        password: "",
        downloadReason: "",
        availableFileIds: [],
        hasFiles: true
      })
    ).toBe("当前接管资料暂不可下载，请确认资料状态或权限");
    expect(
      takeoverEvidenceDownloadDisabledReason({
        fileId: "",
        password: "current-password",
        downloadReason: "复核历史付款凭证",
        availableFileIds: ["file-1"],
        hasFiles: true
      })
    ).toBe("请选择需要下载的接管资料");
    expect(
      takeoverEvidenceDownloadDisabledReason({
        fileId: "file-2",
        password: "current-password",
        downloadReason: "复核历史付款凭证",
        availableFileIds: ["file-1"],
        hasFiles: true
      })
    ).toBe("所选接管资料暂不可下载，请重新选择");
    expect(
      takeoverEvidenceDownloadDisabledReason({
        fileId: "file-1",
        password: "   ",
        downloadReason: "复核历史付款凭证",
        availableFileIds: ["file-1"],
        hasFiles: true
      })
    ).toBe("请填写当前登录密码后再下载资料");
    expect(
      takeoverEvidenceDownloadDisabledReason({
        fileId: "file-1",
        password: "current-password",
        downloadReason: "   ",
        availableFileIds: ["file-1"],
        hasFiles: true
      })
    ).toBe("请填写下载原因后再下载资料");
    expect(
      takeoverEvidenceDownloadDisabledReason({
        fileId: "file-1",
        password: "current-password",
        downloadReason: "复核历史付款凭证",
        availableFileIds: ["file-1"],
        hasFiles: true
      })
    ).toBe("");
  });

  it("requires current password before confirming takeover", () => {
    expect(takeoverConfirmDisabledReason("")).toBe("请填写当前登录密码后再确认接管");
    expect(takeoverConfirmDisabledReason("   ")).toBe("请填写当前登录密码后再确认接管");
    expect(takeoverConfirmDisabledReason("current-password")).toBe("");
  });

  it("explains when takeover correction records can be submitted", () => {
    const readyCorrection = {
      reason: "补充历史付款凭证复核说明",
      responsibleUserId: "contract-director-1",
      afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
      hasAttachment: true,
      currentPassword: "current-password"
    };

    expect(takeoverCorrectionDisabledReason(takeover(), readyCorrection)).toBe(
      "接管正在复核，请退回补充或完成主管确认后再发起更正"
    );
    expect(
      takeoverCorrectionDisabledReason(
        { ...takeover(), takeoverStatus: "confirmed" },
        { ...readyCorrection, reason: "" }
      )
    ).toBe("请填写更正原因");
    expect(
      takeoverCorrectionDisabledReason(
        { ...takeover(), takeoverStatus: "confirmed" },
        { ...readyCorrection, responsibleUserId: "" }
      )
    ).toBe("请填写更正责任人");
    expect(
      takeoverCorrectionDisabledReason(
        { ...takeover(), takeoverStatus: "confirmed" },
        { ...readyCorrection, afterSummary: "" }
      )
    ).toBe("请填写更正后的事实说明");
    expect(
      takeoverCorrectionDisabledReason(
        { ...takeover(), takeoverStatus: "confirmed" },
        { ...readyCorrection, hasAttachment: false }
      )
    ).toBe("请上传更正依据附件");
    expect(
      takeoverCorrectionDisabledReason(
        { ...takeover(), takeoverStatus: "confirmed" },
        { ...readyCorrection, currentPassword: "" }
      )
    ).toBe("请填写当前登录密码后再保存更正记录");
    expect(
      takeoverCorrectionDisabledReason(
        { ...takeover(), takeoverStatus: "confirmed" },
        readyCorrection
      )
    ).toBe("");
  });

  it("formats takeover correction records for business display", () => {
    expect(
      takeoverCorrectionRows({
        ...takeover(),
        corrections: [
          {
            id: "takeover-correction-1",
            correctionType: "evidence",
            correctionTypeLabel: "资料更正",
            status: "confirmed",
            statusLabel: "已确认",
            targetCompanyEntityId: null,
            reason: "补充历史付款凭证复核说明",
            beforeSummary:
              "改前：接管等级 B级；历史累计结算 ¥10,000.00；历史累计已付 ¥4,000.00",
            afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
            responsibleUserName: "合同负责人",
            createdByName: "合同经办",
            submittedByName: "合同经办",
            submittedAt: "2026-07-04T09:00:00.000Z",
            reviewedByName: "合同主管",
            reviewedAt: "2026-07-04T10:00:00.000Z",
            reviewComment: "已复核",
            attachmentFileId: "file-1",
            attachmentFileName: "付款凭证.pdf",
            createdAt: "2026-07-04T09:00:00.000Z"
          }
        ]
      })
    ).toEqual([
      {
        id: "takeover-correction-1",
        title: "资料更正 · 2026-07-04",
        reason: "补充历史付款凭证复核说明",
        beforeSummary:
          "改前：接管等级 B级；历史累计结算 ¥10,000.00；历史累计已付 ¥4,000.00",
        afterSummary: "补充历史付款凭证，确认历史已付金额不变。",
        responsibleText: "更正责任人：合同负责人",
        createdByText: "记录人：合同经办",
        attachmentText: "依据附件：付款凭证.pdf"
      }
    ]);
  });

  it("recommends takeover level and requires a reason when manually adjusted", () => {
    const baseDraft = {
      lifecycleStatus: "in_progress" as const,
      balanceSourceSummary: "财务台账已核对",
      evidenceSummary: "合同、结算、付款凭证齐全",
      historicalApprovalPendingPaymentYuan: "",
      historicalApprovedPendingPaymentYuan: "",
      historicalProxyPaidYuan: "",
      historicalRetentionWithheldYuan: "",
      otherConfirmedOccupancyYuan: ""
    };

    expect(suggestTakeoverLevel(baseDraft)).toMatchObject({ level: "A" });
    expect(
      suggestTakeoverLevel({
        ...baseDraft,
        historicalApprovedPendingPaymentYuan: "20000.00"
      })
    ).toMatchObject({ level: "B" });
    expect(
      suggestTakeoverLevel({
        ...baseDraft,
        evidenceSummary: "缺少付款凭证，存在争议说明"
      })
    ).toMatchObject({ level: "C" });

    const suggestion = suggestTakeoverLevel(baseDraft);
    expect(takeoverLevelAdjustmentDisabledReason("B", suggestion, "")).toBe(
      "确认等级与系统建议不一致，请在等级调整说明中说明调整原因"
    );
    expect(takeoverLevelAdjustmentDisabledReason("B", suggestion, "合同部确认按 B级跟踪")).toBe(
      ""
    );
    expect(takeoverLevelSelectionHint("A", suggestion)).toBe(
      "当前确认A级，与系统建议一致；复核时仍需核对资料清单、缺口说明和付款阻断提示。"
    );
    expect(takeoverLevelSelectionHint("B", suggestion)).toBe(
      "当前确认B级，与系统建议A级不一致；等级调整说明会进入复核记录和主管确认依据。"
    );
    const riskSuggestion = { level: "C" as const, reason: "存在争议资料，建议按 C级受限接管。" };
    expect(takeoverLevelAdjustmentDisabledReason("A", riskSuggestion, "")).toBe(
      "确认等级低于系统建议，请说明资料已核验、风险由谁确认，以及是否仍需限制付款"
    );
    expect(takeoverLevelSelectionHint("A", riskSuggestion)).toBe(
      "当前确认A级，低于系统建议C级；需说明资料已核验、风险责任和付款限制，主管确认前不会自动解除风险。"
    );
    expect(takeoverSuggestionApplyDisabledReason("A", suggestion)).toBe(
      "当前确认等级已采用系统建议"
    );
    expect(takeoverSuggestionApplyDisabledReason("B", suggestion)).toBe("");
  });

  it("describes the takeover workbench as a five-step office workflow", () => {
    expect(takeoverWorkbenchSteps(null).map((step) => step.label)).toEqual([
      "接管准备",
      "导入预检",
      "资料核验",
      "复核确认",
      "接管后核验"
    ]);

    expect(takeoverWorkbenchSteps(null).map((step) => step.description)).toEqual([
      "明确项目、接管日和责任人",
      "预检通过后生成草稿，避免逐份重复录入",
      "单合同补录并核对合同、结算、付款凭证",
      "主管先核对必需资料；缺资料点“退回补充”，齐全后输入当前密码确认",
      "用新结算和付款验证账本"
    ]);

    expect(takeoverWorkbenchSteps(takeover()).map((step) => step.status)).toEqual([
      "已完成",
      "已完成",
      "已完成",
      "处理中",
      "未开始"
    ]);

    expect(takeoverWorkbenchSteps({ ...takeover(), takeoverStatus: "confirmed" }).at(-1)).toMatchObject({
      label: "接管后核验",
      status: "待核验",
      tone: "warning"
    });
  });

  it("names the operation sections with the same five-step office workflow", () => {
    expect(takeoverOperationSections.map((section) => section.label)).toEqual([
      "接管准备",
      "导入预检",
      "资料核验",
      "复核确认",
      "接管后核验"
    ]);
    expect(takeoverOperationSections.map((section) => section.id)).toEqual([
      "takeover-step-ready",
      "takeover-step-precheck",
      "takeover-step-evidence",
      "takeover-step-review",
      "takeover-step-after"
    ]);
    expect(takeoverOperationSections.at(1)?.description).toContain("生成接管草稿");
    expect(takeoverOperationSections.at(4)?.description).toContain("唯一账本");
  });

  it("builds a confirmation summary with historical money and business consequence", () => {
    const summary = buildTakeoverConfirmationSummary(takeover());

    expect(summary.items).toEqual([
      { label: "接管截止日", value: "2026-06-30" },
      { label: "系统建议等级", value: "B级" },
      { label: "确认接管等级", value: "B级" },
      { label: "发票类型", value: "增值税专用发票" },
      { label: "计税模式", value: "单一税率" },
      { label: "默认税率", value: "13%" },
      { label: "历史计价项目", value: "1 项" },
      { label: "历史累计结算", value: "¥600,000.00" },
      { label: "历史累计已付", value: "¥300,000.00" },
      { label: "历史在途/待付", value: "¥30,000.00" },
      { label: "历史预付款已付/已扣回", value: "¥50,000.00 / ¥10,000.00" },
      { label: "历史质保金扣留/释放", value: "¥30,000.00 / ¥10,000.00" }
    ]);
    expect(summary.consequence).toContain("确认后会形成系统期初事实");
    expect(summary.consequence).toContain("接管截止日后的新结算、付款和资料补正必须从系统办理");
    expect(summary.consequence).toContain("已确认的金额和资料不能静默覆盖");
    expect(summary.levelReviewText).toContain("确认接管等级与系统建议一致：B级");
    expect(summary.riskText).toBe("B级资料仍需跟踪，付款前需确认影响金额的缺口已补齐。");
    expect(summary.paymentBlockingText).toBe("尚未完成主管确认，后续付款申请会被系统阻断。");
    expect(summary.taxGapText).toBe("清单项目“钢材”含税单价");
    expect(summary.taxImpactText).toContain("相关结算不能提交审批");
    expect(summary.evidenceGapText).toBe("缺少：历史付款凭证。补齐前会影响主管确认和后续付款核验。");
    expect(summary.evidenceText).toBe("合同与凭证");
    expect(summary.reviewText).toBe("预算已复核结算口径");
    expect(summary.acceptanceText).toBe("作为 A 级活跃合同继续办理");
    expect(summary.responsibleText).toBe("合同负责人");
  });

  it("describes missing historical tax facts without treating them as zero", () => {
    const summary = buildTakeoverConfirmationSummary({
      ...takeover(),
      invoiceType: null,
      defaultTaxRatePercent: null,
      taxFactSource: null,
      taxFactExplanation: null,
      taxFactMissingFields: ["发票类型", "默认税率"],
      pricingItems: []
    });

    expect(summary.items).toContainEqual({ label: "发票类型", value: "原合同未明确" });
    expect(summary.items).toContainEqual({ label: "默认税率", value: "原合同未明确" });
    expect(summary.items).toContainEqual({ label: "历史计价项目", value: "0 项" });
    expect(summary.taxGapText).toBe("发票类型、默认税率");
    expect(summary.taxImpactText).toContain("不会阻断本次历史合同接管");
    expect(summary.taxImpactText).toContain("相关结算不能提交审批");
  });

  it("explains takeover level adjustments with review comment", () => {
    expect(
      takeoverLevelReviewText({
        ...takeover(),
        takeoverLevel: "B",
        suggestedTakeoverLevel: null,
        historicalApprovalPendingPaymentCents: "0",
        historicalApprovedPendingPaymentCents: "0",
        historicalProxyPaidCents: "0",
        historicalRetentionWithheldCents: "0",
        otherConfirmedOccupancyCents: "0",
        reviewComment: "合同部按现场资料完整度降为 B级跟踪"
      })
    ).toBe(
      "确认接管等级由系统建议A级调整为B级，调整原因：合同部按现场资料完整度降为 B级跟踪"
    );
  });

  it("uses saved takeover level suggestion when reviewing confirmed facts", () => {
    expect(
      takeoverLevelReviewText({
        ...takeover(),
        takeoverLevel: "B",
        suggestedTakeoverLevel: "C",
        takeoverLevelAdjustmentReason: "主管按受限确认降为 B级",
        historicalApprovalPendingPaymentCents: "0",
        historicalApprovedPendingPaymentCents: "0",
        historicalProxyPaidCents: "0",
        historicalRetentionWithheldCents: "0",
        otherConfirmedOccupancyCents: "0",
        reviewComment: "页面重算会建议 A级"
      })
    ).toBe("确认接管等级由系统建议C级调整为B级，调整原因：主管按受限确认降为 B级");
  });

  it("keeps saved takeover level suggestion reason from drifting after data changes", () => {
    expect(
      takeoverLevelReviewText({
        ...takeover(),
        takeoverLevel: "B",
        suggestedTakeoverLevel: "B",
        historicalApprovalPendingPaymentCents: "0",
        historicalApprovedPendingPaymentCents: "0",
        historicalProxyPaidCents: "0",
        historicalRetentionWithheldCents: "0",
        otherConfirmedOccupancyCents: "0",
        balanceSourceSummary: "资料已补齐",
        evidenceSummary: "合同、结算和付款凭证已补齐"
      })
    ).toBe(
      "确认接管等级与系统建议一致：B级。系统建议按接管时保存的资料快照展示，后续资料补录不会改写已保存建议。"
    );
  });

  it("keeps takeover level review readable when summaries are missing", () => {
    expect(
      takeoverLevelReviewText({
        ...takeover(),
        balanceSourceSummary: null,
        evidenceSummary: null,
        historicalApprovalPendingPaymentCents: "0",
        historicalApprovedPendingPaymentCents: "0",
        historicalProxyPaidCents: "0",
        historicalRetentionWithheldCents: "0",
        otherConfirmedOccupancyCents: "0"
      })
    ).toContain("确认接管等级与系统建议一致：B级");
  });

  it("fails closed for partial historical change baselines and permits one confirmation only", () => {
    const confirmedTakeover = { ...takeover(), takeoverStatus: "confirmed" as const };
    expect(historicalChangeBaselineView(confirmedTakeover)).toMatchObject({
      status: "unconfirmed",
      statusLabel: "尚未确认"
    });
    expect(canConfirmHistoricalChangeBaseline(confirmedTakeover, true)).toBe(true);
    expect(canConfirmHistoricalChangeBaseline(confirmedTakeover, false)).toBe(false);

    const confirmedBaseline = {
      ...confirmedTakeover,
      changeBaselineConfirmed: true,
      originalBaseAmountCents: "100000000",
      preTakeoverPositiveIncreaseCents: "10000000"
    };
    expect(historicalChangeBaselineView(confirmedBaseline)).toEqual({
      status: "confirmed",
      statusLabel: "已一次性确认",
      originalSignedAmountText: "¥1,000,000.00",
      preTakeoverPositiveIncreaseText: "¥100,000.00"
    });
    expect(canConfirmHistoricalChangeBaseline(confirmedBaseline, true)).toBe(false);

    expect(historicalChangeBaselineView({
      ...confirmedTakeover,
      changeBaselineConfirmed: true,
      originalBaseAmountCents: "100000000",
      preTakeoverPositiveIncreaseCents: null
    }).status).toBe("invalid");
  });

  it("shows post-confirmation checks only after takeover confirmation", () => {
    expect(buildTakeoverPostConfirmationChecklist(takeover())).toBeNull();

    const checklist = buildTakeoverPostConfirmationChecklist({
      ...takeover(),
      takeoverStatus: "confirmed"
    });

    expect(checklist).toMatchObject({
      title: "接管后核验",
      description: expect.stringContaining("期初事实已进入系统")
    });
    expect(checklist?.items).toEqual([
      "发起一笔新结算，并确认结算金额由系统账本重算。",
      "从有效结算和合同付款条款发起付款申请，核对历史已付、已批待付和其他占用是否扣减。",
      "完成实付登记和凭证上传，确认资料下载仍要求当前密码、下载原因和审计留痕。",
      "财务入账后查看付款、凭证、PDF 归档和审计记录是否能串回这份接管合同。"
    ]);
  });

  it("formats post-confirmation verification facts for takeover detail", () => {
    expect(
      takeoverPostConfirmationVerificationView({
        ...takeover(),
        takeoverStatus: "confirmed",
        postConfirmationVerification: {
          statusLabel: "已形成闭环",
          summaryText: "已看到接管后的新结算、付款申请、实付凭证和财务入账。",
          newSettlementCount: 1,
          paymentRequestCount: 2,
          paymentExecutionCount: 1,
          financeRecordCount: 1
        }
      })
    ).toEqual({
      statusLabel: "已形成闭环",
      summaryText: "已看到接管后的新结算、付款申请、实付凭证和财务入账。",
      items: [
        { label: "接管后新结算", value: "1 单" },
        { label: "付款申请", value: "2 笔" },
        { label: "实付凭证", value: "1 笔" },
        { label: "财务入账", value: "1 笔" }
      ]
    });
  });

  it("keeps historical balances separated in table rows", () => {
    const row = toContractTakeoverTableRow(takeover());

    expect(row).toMatchObject({
      contractNo: "HT-LS-001",
      contractName: "历史材料采购合同",
      batchNo: "接管批次-20260710-TEST0001",
      importRowNo: "第 2 行",
      amount: "¥1,000,000.00",
      takeoverLevelLabel: "B级",
      suggestedTakeoverLevelLabel: "B级",
      takeoverStatusLabel: "待复核",
      lifecycleStatusLabel: "履约中",
      takeoverCutoffDate: "2026-06-30",
      historicalSettled: "¥600,000.00",
      historicalPaid: "¥300,000.00",
      historicalPending: "¥30,000.00",
      historicalProxyPaid: "¥40,000.00"
    });
  });

  it("keeps the system suggested level visible beside the selected level", () => {
    expect(takeoverSuggestedLevelLabel({ ...takeover(), suggestedTakeoverLevel: "C" })).toBe(
      "C级"
    );
    expect(
      toContractTakeoverTableRow({
        ...takeover(),
        takeoverLevel: "B",
        suggestedTakeoverLevel: "C"
      })
    ).toMatchObject({
      takeoverLevelLabel: "B级",
      suggestedTakeoverLevelLabel: "C级"
    });
  });
});

function takeover(): ContractTakeoverReadModel {
  return {
    id: "takeover-1",
    batchNo: "接管批次-20260710-TEST0001",
    importRowNo: 2,
    contractNo: "HT-LS-001",
    contractName: "历史材料采购合同",
    counterparty: "历史供应商",
    companyEntityId: "entity-1",
    companyEntityName: "建工智管公司",
    contractTypeKey: "material_purchase",
    amountCents: "100000000",
    paymentTermsOriginalText: "按月结算，归档后付款",
    paymentStages: [],
    invoiceType: "vat_special",
    taxMode: "single_rate",
    defaultTaxRatePercent: "13",
    taxFactStatus: "unconfirmed",
    taxFactSource: "contract_document",
    taxFactExplanation: "按原合同签署页核对",
    taxFactMissingFields: ["清单项目“钢材”含税单价"],
    pricingItems: [
      {
        billKey: "main",
        billName: "历史计价清单",
        rowKey: "row-1",
        itemCode: "CL-001",
        itemName: "钢材",
        specification: "HRB400",
        unit: "吨",
        estimatedQuantity: "10",
        taxInclusiveUnitPrice: null,
        taxRatePercent: "13",
        pricingFactStatus: "unconfirmed",
        isProvisional: false,
        settlementBasis: "按实际验收量结算"
      }
    ],
    takeoverLevel: "B",
    suggestedTakeoverLevel: "B",
    takeoverLevelAdjustmentReason: null,
    levelRiskText: "B级资料仍需跟踪，付款前需确认影响金额的缺口已补齐。",
    paymentBlockingHint: "尚未完成主管确认，后续付款申请会被系统阻断。",
    evidenceGapSummary: "缺少：历史付款凭证。补齐前会影响主管确认和后续付款核验。",
    takeoverStatus: "pending_review",
    lifecycleStatus: "in_progress",
    signedAt: "2026-01-01T00:00:00.000Z",
    historicalSettledCents: "60000000",
    historicalApprovalPendingPaymentCents: "1000000",
    historicalApprovedPendingPaymentCents: "2000000",
    historicalPaidCents: "30000000",
    historicalProxyPaidCents: "4000000",
    historicalAdvancePaidCents: "5000000",
    historicalAdvanceDeductedCents: "1000000",
    historicalRetentionWithheldCents: "3000000",
    historicalRetentionReleasedCents: "1000000",
    otherConfirmedOccupancyCents: "800000",
    balanceSourceSummary: "财务台账",
    evidenceSummary: "合同与凭证",
    takeoverCutoffDate: "2026-06-30T00:00:00.000Z",
    responsibleUserId: "contract-director-1",
    responsibleUserName: "合同负责人",
    reviewComment: "预算已复核结算口径",
    acceptanceConclusion: "作为 A 级活跃合同继续办理",
    submittedAt: "2026-07-03T10:00:00.000Z",
    confirmedAt: null,
    historicalBalanceConfirmedAt: null,
    changeBaselineConfirmed: false,
    originalBaseAmountCents: null,
    preTakeoverPositiveIncreaseCents: null,
    evidenceChecklist: [
      {
        purpose: "historical_contract_scan",
        purposeLabel: "历史合同扫描件",
        required: true,
        uploaded: true,
        statusLabel: "已上传",
        riskText: "已上传，可作为接管复核依据。"
      },
      {
        purpose: "historical_payment_voucher",
        purposeLabel: "历史付款凭证",
        required: true,
        uploaded: false,
        statusLabel: "待补齐",
        riskText: "缺少历史付款凭证，后续付款容量核对会受影响。"
      }
    ],
    evidenceFiles: [],
    corrections: [],
    contractSide: null,
    financeSide: null,
    appliedCorrections: [],
    postConfirmationVerification: {
      statusLabel: "未到核验",
      summaryText: "主管确认后，再用接管后的新结算、付款申请、实付凭证和财务入账核验期初账本。",
      newSettlementCount: 0,
      paymentRequestCount: 0,
      paymentExecutionCount: 0,
      financeRecordCount: 0
    },
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T10:00:00.000Z"
  };
}
