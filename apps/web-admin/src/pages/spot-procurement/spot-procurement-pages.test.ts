import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  requiredPositiveYuanCents,
  validateSpotPaymentLines,
  validateThenUpload
} from "./spot-procurement-write-validation";

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
    expect(procurement).toContain("fetchSpotProcurementCreateProjectOptions");
    expect(procurement).toContain("createSpotProcurementDraft");
    expect(procurement).toContain("applicationDepartment");
    expect(procurement).toContain("requestedArrivalAt");
    expect(procurement).toContain("采购申请单号会在保存草稿时由系统自动生成");
    expect(procurement).not.toContain("createForm.code");
    expect(procurement).not.toContain("系统申请单编号 <b");
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
    expect(`${workbench}\n${detail}\n${editor}`).toContain("最多 2 位小数");
    expect(`${workbench}\n${detail}\n${editor}`).not.toMatch(/最多\s*6\s*位小数/u);
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
    expect(detail).toContain(
      "requiredPositiveYuanCents(executionForm.amountYuan"
    );
    expect(detail).toContain("validateThenUpload(");
    expect(detail).toContain("toIsoDateTime(executionForm.paidAt)");
  });

  it.each([
    ["付款数量", { paymentQuantity: "1.001", unitPrice: "3.50" }],
    ["含税或无票单价", { paymentQuantity: "1.00", unitPrice: "3.333" }]
  ])("does not upload A5 attachments when %s has three decimal places", async (_label, line) => {
    const upload = vi.fn(async () => ({ id: "uploaded-file" }));

    await expect(
      validateThenUpload(
        () => validateSpotPaymentLines([line]),
        [{ name: "付款依据.pdf" }],
        upload
      )
    ).rejects.toThrow("最多 2 位小数");
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(["1.001", "0", "0.00", "invalid"])(
    "does not upload an execution voucher for invalid or zero yuan input %s",
    async (amountYuan) => {
      const upload = vi.fn(async () => ({ id: "voucher-file" }));

      await expect(
        validateThenUpload(
          () => requiredPositiveYuanCents(amountYuan, "本次实际付款金额"),
          [{ name: "付款凭证.png" }],
          upload
        )
      ).rejects.toThrow("本次实际付款金额必须是大于 0、最多 2 位小数的金额");
      expect(upload).not.toHaveBeenCalled();
    }
  );

  it.each(["3.333", "0", "0.00", "invalid"])(
    "does not upload a refund voucher for invalid or zero yuan input %s",
    async (amountYuan) => {
      const upload = vi.fn(async () => ({ id: "refund-file" }));

      await expect(
        validateThenUpload(
          () => requiredPositiveYuanCents(amountYuan, "退款到账金额"),
          [{ name: "退款凭证.png" }],
          upload
        )
      ).rejects.toThrow("退款到账金额必须是大于 0、最多 2 位小数的金额");
      expect(upload).not.toHaveBeenCalled();
    }
  );

  it("uploads only after a valid positive yuan amount becomes integer cents", async () => {
    const upload = vi.fn(async () => ({ id: "voucher-file" }));

    await expect(
      validateThenUpload(
        () => requiredPositiveYuanCents("1.00", "本次实际付款金额"),
        [{ name: "付款凭证.png" }],
        upload
      )
    ).resolves.toEqual({
      validatedValue: "100",
      uploads: [{ id: "voucher-file" }]
    });
    expect(upload).toHaveBeenCalledTimes(1);
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
    expect(payment).toContain("router.push('/零星材料付款工作台')");
    expect(payment).not.toContain("router.push('/零星材料付款')");
  });

  it("keeps both workbench ledgers inside their own horizontal scroll regions", () => {
    const procurement = pageSource("SpotProcurementWorkbenchPage.vue");
    const payment = pageSource("SpotProcurementPaymentWorkbenchPage.vue");

    for (const source of [procurement, payment]) {
      expect(source).toContain("jg-responsive-ledger");
      expect(source).toContain("jg-table-region jg-table-region--wide");
      expect(source).toContain("horizontal-scroll-affixed-bottom");
    }
    expect(procurement).toContain('title: "申请 / 采购"');
    expect(procurement).toContain('title: "付款与收货"');
    expect(payment).toContain('title: "付款 / 采购单"');
    expect(payment).toContain('title: "商户 / 收款对象"');
    expect(payment).toContain('return row.status === "draft" ? "填写付款申请" : "查看详情"');
  });

  it("connects final receipt, shortage handling, invoice append and archive facts without location or batches", () => {
    const workbench = pageSource("SpotProcurementReceiptWorkbenchPage.vue");
    const receipt = pageSource("SpotProcurementReceiptPage.vue");
    const uploader = pageSource("components/ReceiptPhotoUploader.vue");

    expect(workbench).toContain("fetchSpotProcurements");
    expect(workbench).toContain("待实际付款");
    expect(receipt).toContain("fetchSpotProcurementReceipt");
    expect(receipt).toContain("fetchSpotProcurementPaymentDetail");
    expect(receipt).toContain("reviewSpotProcurementReceipt");
    expect(receipt).toContain("revokeSpotProcurementReceiptReview");
    expect(receipt).toContain("createSpotProcurementDiscrepancy");
    expect(receipt).toContain("recordSpotProcurementRefund");
    expect(receipt).toContain(
      "requiredPositiveYuanCents(refundForm.amountYuan"
    );
    expect(receipt).toContain("validateThenUpload(");
    expect(receipt).toContain("appendSpotProcurementPaymentInvoice");
    expect(receipt).toContain("委托");
    expect(receipt).toContain("待财务登记首笔实际付款后开放收货");
    expect(receipt).toContain("商户继续补货");
    expect(receipt).toContain("商户退回差额");
    expect(receipt).toContain("发票仍可在付款申请中补充归档");
    expect(uploader).toContain("系统拍照");
    expect(uploader).toContain("相册上传");
    expect(uploader).toContain("送货单可选");
    expect(uploader).toContain("watermarkedFileId");
    expect(uploader).toContain("已提交照片不可删除或替换");
    expect(`${workbench}\n${receipt}\n${uploader}`).not.toMatch(/navigator\.geolocation/iu);
    expect(`${workbench}\n${receipt}`).not.toMatch(/createReceiptBatch|fetchReceiptBatches/iu);
    expect(`${workbench}\n${receipt}`).not.toMatch(/supplierBalance|转商户余额/iu);
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
