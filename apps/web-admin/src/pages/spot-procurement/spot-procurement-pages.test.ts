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
    expect(procurement).toContain("applicationDepartment");
    expect(procurement).toContain("requestedArrivalAt");
    expect(payment).toContain("fetchSpotProcurementPayments");
    expect(`${procurement}\n${payment}`).not.toMatch(
      /sample|mockRows|fakeData/iu
    );
  });

  it("keeps the procurement application free of supplier, price and tax fields", () => {
    const workbench = pageSource("SpotProcurementWorkbenchPage.vue");
    const detail = pageSource("SpotProcurementDetailPage.vue");
    const editor = pageSource(
      "components/ProcurementLineEditor.vue"
    );

    expect(workbench).toContain("物资用途及采购原因");
    expect(workbench).toContain("要求采购到位日期");
    expect(editor).toContain("采购申请只确认材料范围和数量");
    expect(detail).toContain("价格在付款申请中确定");
    expect(detail).toContain("系统申请单编号");
    expect(`${workbench}\n${editor}`).not.toMatch(
      /fetchVatRateOptions|unitPrice|invoiceMode|vatRateOptionId|supplierName/u
    );
  });

  it("presents the A5 payment fact separately from the earlier A4 procurement request", () => {
    const component = pageSource(
      "components/PaymentCompositionCard.vue"
    );
    const detail = pageSource(
      "SpotProcurementPaymentDetailPage.vue"
    );

    expect(component).toContain("付款事实汇总");
    expect(component).toContain("累计实付");
    expect(component).toContain("累计退款");
    expect(detail).toContain("merchantPayeeMismatchNote");
    expect(detail).toContain("payerManagement");
    expect(detail).toContain("paymentChannelId");
    expect(`${component}\n${detail}`).not.toContain("supplierBalanceAmountCents");
    expect(`${component}\n${detail}`).not.toMatch(/转商户余额/u);
  });

  it("reuses one locked idempotency payload across execution retries", () => {
    const detail = pageSource(
      "SpotProcurementPaymentDetailPage.vue"
    );

    expect(detail).toContain(
      "executionAttempt.value ?? (await prepareExecutionAttempt())"
    );
    expect(detail).toContain("本次重试参数已锁定");
    expect(detail).toContain("resetExecutionAttempt()");
    expect(detail).toContain(
      "本次付款登记参数已安全保留"
    );
    expect(detail).toContain("await loadDetail()");
    expect(detail.indexOf("yuanTextToCentsText(executionForm.amountYuan)"))
      .toBeLessThan(detail.lastIndexOf("uploadPrivateFile(file, file.name)"));
    expect(detail.indexOf("toIsoDateTime(executionForm.paidAt)"))
      .toBeLessThan(detail.lastIndexOf("uploadPrivateFile(file, file.name)"));
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
    expect(procurement).toContain("applicationDepartment");
    expect(procurement).toContain("requestedArrivalAt");
    expect(procurement).not.toMatch(/supplierName|unitPrice|invoiceMode/u);
    expect(payment).toContain('decision: "return_to_applicant"');
    expect(payment).toContain("merchantPayeeMismatchNote");
    expect(payment).toContain("付款主体已调整");
    expect(payment).toContain("从综合部节点重新审批");
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
    expect(receipt).toContain("办结后收货、差异、退款和票据事实全部只读");
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
