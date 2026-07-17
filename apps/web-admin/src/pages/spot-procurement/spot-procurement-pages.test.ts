import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function pageSource(name: string) {
  return readFileSync(
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    "utf8"
  );
}

describe("spot procurement web pages", () => {
  it("connects both workbenches to real list endpoints without sample fallback", () => {
    const procurement = pageSource("SpotProcurementWorkbenchPage.vue");
    const payment = pageSource("SpotProcurementPaymentWorkbenchPage.vue");

    expect(procurement).toContain("fetchSpotProcurements");
    expect(procurement).toContain("fetchSpotProcurementCapabilities");
    expect(procurement).toContain("createSpotProcurementDraft");
    expect(procurement).toContain("handlerOptions");
    expect(payment).toContain("fetchSpotProcurementPayments");
    expect(`${procurement}\n${payment}`).not.toMatch(
      /sample|mockRows|fakeData/iu
    );
  });

  it("shows controlled VAT and exact server-backed material amounts", () => {
    const workbench = pageSource("SpotProcurementWorkbenchPage.vue");
    const detail = pageSource("SpotProcurementDetailPage.vue");
    const editor = pageSource(
      "components/ProcurementLineEditor.vue"
    );

    expect(workbench).toContain("fetchVatRateOptions");
    expect(workbench).toContain("calculateSpotProcurementLineAmountCents");
    expect(editor).toContain("invoiceMode === 'no_invoice'");
    expect(editor).toContain("vatRateOptionId: null");
    expect(detail).toContain("row.amountCents");
    expect(detail).toContain(
      "采购草稿已保存，金额已按系统重算结果刷新"
    );
    expect(`${workbench}\n${editor}`).not.toMatch(
      /parseFloat|Number\s*\(/u
    );
  });

  it("keeps balance deduction separate from company actual payment", () => {
    const component = pageSource(
      "components/PaymentCompositionCard.vue"
    );
    const detail = pageSource(
      "SpotProcurementPaymentDetailPage.vue"
    );

    expect(component).toContain(
      "内部余额执行，不属于银行实付"
    );
    expect(component).toContain("公司实际付款");
    expect(detail).toContain("paymentFactConsistent");
    expect(detail).toContain("未作废的实际付款记录");
  });

  it("reuses one locked idempotency payload across execution retries", () => {
    const detail = pageSource(
      "SpotProcurementPaymentDetailPage.vue"
    );

    expect(detail).toContain(
      "executionAttempt.value ?? (await prepareExecutionAttempt())"
    );
    expect(detail).toContain("executionAttemptLocked");
    expect(detail).toContain("本次重试参数已锁定");
    expect(detail).toContain("resetExecutionAttempt()");
    expect(detail).toContain(
      "本次付款登记参数已安全保留"
    );
    expect(detail).toContain("await loadDetail()");
    expect(detail.indexOf("yuanTextToCentsText(executionForm.amountYuan)"))
      .toBeLessThan(detail.indexOf("uploadPrivateFile(file, file.name)"));
    expect(detail.indexOf("toIsoDateTime(executionForm.paidAt)"))
      .toBeLessThan(detail.indexOf("uploadPrivateFile(file, file.name)"));
  });

  it("exposes the existing return and procurement revision workflows", () => {
    const procurement = pageSource(
      "SpotProcurementDetailPage.vue"
    );
    const payment = pageSource(
      "SpotProcurementPaymentDetailPage.vue"
    );

    expect(procurement).toContain('decision: "return_to_applicant"');
    expect(procurement).toContain("createSpotProcurementVersion");
    expect(procurement).toContain("create_version");
    expect(procurement).toContain(
      'key === "create_version"'
    );
    expect(procurement).toContain("editQuotationFiles");
    expect(procurement).toContain(
      "spotProcurementQuotationFileError"
    );
    expect(procurement).toContain(
      "retainedSpotProcurementAttachments"
    );
    expect(procurement).toContain(
      "file.status !== 'active'"
    );
    expect(procurement).toContain(
      "spotProcurementReferencePhotoFileError"
    );
    expect(procurement).toContain(
      "supplierName === current.currentVersion.supplierName"
    );
    expect(payment).toContain('decision: "return_to_applicant"');
    expect(payment).toContain(
      "adjustedSupplierBalanceAmountCents"
    );
    expect(payment).toContain(
      "requiresBalanceAdjustmentOnReturn"
    );
    expect(payment).toContain(
      "财务主管退回付款申请时必须填写"
    );
    expect(payment).toContain("result.newDraftPaymentId");
  });

  it("connects final receipt, watermark evidence, review and ticket facts without location or batches", () => {
    const workbench = pageSource("SpotProcurementReceiptWorkbenchPage.vue");
    const receipt = pageSource("SpotProcurementReceiptPage.vue");
    const uploader = pageSource("components/ReceiptPhotoUploader.vue");
    const settlement = pageSource("components/ProcurementSettlementSummary.vue");
    const coverage = pageSource("components/InvoiceCoveragePanel.vue");

    expect(workbench).toContain("fetchSpotProcurements");
    expect(receipt).toContain("fetchSpotProcurementReceipt");
    expect(receipt).toContain("reviewSpotProcurementReceipt");
    expect(receipt).toContain("revokeSpotProcurementReceiptReview");
    expect(receipt).toContain("委托");
    expect(uploader).toContain("系统拍照");
    expect(uploader).toContain("相册上传");
    expect(uploader).toContain("送货单可选");
    expect(uploader).toContain("watermarkedFileId");
    expect(uploader).toContain("已提交照片不可删除或替换");
    expect(settlement).toContain("采购审批金额");
    expect(settlement).toContain("公司实际付款");
    expect(coverage).toContain("已确认无票");
    expect(coverage).toContain("票据异常");
    expect(`${workbench}\n${receipt}\n${uploader}`).not.toMatch(/navigator\.geolocation/iu);
    expect(`${workbench}\n${receipt}`).not.toMatch(/createReceiptBatch|fetchReceiptBatches/iu);
    expect(receipt).toContain("办结后收货、差异、供应商余额和票据事实全部只读");
  });

  it("uses the approved shared business components instead of a second UI system", () => {
    const sources = [
      "SpotProcurementWorkbenchPage.vue",
      "SpotProcurementDetailPage.vue",
      "SpotProcurementPaymentWorkbenchPage.vue",
      "SpotProcurementPaymentDetailPage.vue",
      "SpotProcurementReceiptWorkbenchPage.vue",
      "SpotProcurementReceiptPage.vue"
    ].map(pageSource);
    const combined = sources.join("\n");

    expect(combined).toContain("BusinessPageHeader");
    expect(combined).toContain("BusinessDetailHeader");
    expect(combined).toContain("BusinessTableToolbar");
    expect(combined).toContain("BusinessActionPanel");
    expect(combined).toContain("EvidenceFileCards");
    expect(combined).toContain("SensitiveActionDialog");
    expect(combined).not.toMatch(/element-plus|ant-design-vue|naive-ui/iu);
  });
});
