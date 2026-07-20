import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  prepareSpotExecutionWithUploads,
  prepareSpotPaymentDraftWithUploads,
  prepareSpotRefundWithUpload,
  type SpotPaymentDraftPreparationInput
} from "./spot-procurement-write-validation";

function pageSource(name: string) {
  return readFileSync(
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    "utf8"
  );
}

function validPaymentDraft(
  overrides: Partial<SpotPaymentDraftPreparationInput> = {}
): SpotPaymentDraftPreparationInput {
  return {
    paymentType: "company_direct",
    merchantName: "昆明建材商行",
    payeeName: "昆明建材商行",
    merchantPayeeMismatchNote: null,
    paymentLines: [
      {
        procurementLineId: "line-1",
        paymentQuantity: "1.00",
        unitPrice: "3.50",
        expectedInvoiceCondition: "no_invoice"
      }
    ],
    paymentMethods: ["bank_transfer"],
    channels: [
      {
        channelType: "bank_transfer",
        accountName: "昆明建材商行",
        accountNumber: "622200001",
        bankName: "建设银行",
        isPrimary: true
      }
    ],
    ...overrides
  };
}

const validExecution = {
  amountYuan: "1.00",
  paidAt: "2020-01-01T00:00:00.000Z",
  paymentMethod: "bank_transfer",
  paymentChannelId: "channel-1",
  randomUUID: () => "uuid-1"
};

const validRefund = {
  amountYuan: "1.00",
  receivedAt: "2020-01-01",
  refundMethod: "bank_transfer",
  randomUUID: () => "uuid-1"
};

const postgresBigIntMaxYuan = "92233720368547758.07";
const postgresBigIntOverflowYuan = "92233720368547758.08";

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

  it("reorganizes payment detail into six routed fact tabs and a server-driven current task", () => {
    const detail = pageSource("SpotProcurementPaymentDetailPage.vue");
    const panel = pageSource("components/PaymentCurrentTaskPanel.vue");

    expect(detail).toContain("spotPaymentDetailTabs");
    expect(detail).toContain("resolveSpotPaymentDetailTab(route.query.tab)");
    expect(detail).toContain("router.replace({ query: { ...route.query, tab } })");
    for (const tab of ["current", "application", "approval", "executions", "fulfillment", "archives"]) {
      expect(detail).toContain(`activeTab === '${tab}'`);
    }
    expect(detail).not.toMatch(/label="(?:付款事实|审批与办理|审批原件与归档)"/u);
    expect(detail.match(/<PaymentCurrentTaskPanel/gu)).toHaveLength(1);
    expect(detail.match(/<PaymentCompositionCard/gu)).toHaveLength(1);
    expect(detail.match(/<ApprovalTimeline/gu)).toHaveLength(1);
    expect(detail.match(/<EvidenceFileCards/gu)).toHaveLength(1);
    expect(detail).not.toContain("<BusinessDetailHeader");
    expect(detail).not.toContain("<t-tag");
    expect(detail).toContain(':text="payment.statusLabel"');
    expect(detail).toContain(':data="detail.procurementMaterials"');
    expect(detail).toContain("关联采购原单");
    expect(detail).toContain("row.approvedQuantity");
    expect(detail).toContain("router.push(`/零星采购/${payment.procurement.id}`)");
    expect(detail).toContain("colKey:'trigger'");
    expect(detail).not.toContain("colKey:'archiveTrigger'");
    expect(detail).toContain("查看当前采购单、审批与 PDF 可用性");
    expect(detail).toContain("spotPaymentApprovalStatusSemantic(detail.approval.status)");
    expect(detail).toContain("router.push(`/零星采购收货/${procurementId}`)");

    expect(panel).toContain("currentTask: SpotPaymentCurrentTask");
    expect(panel).toContain("availableActions: DetailActionReadModel[]");
    expect(panel).toContain("summary: SpotPaymentCurrentTaskSummary");
    expect(panel).toContain("spotPaymentCurrentTaskPresentation");
    expect(panel).toContain("spotPaymentStatusSemantic(summary.status)");
    expect(panel).toContain("<BusinessStatusText");
    expect(panel).toContain("<t-button");
    expect(panel).not.toMatch(/fetchSpot|useRoute|useRouter|roleKeys|material_director/u);
    expect(panel).not.toContain(":disabled=");
  });

  it("uses an inline four-step A5 application instead of a full-form dialog", () => {
    const detail = pageSource("SpotProcurementPaymentDetailPage.vue");
    const stepper = pageSource("components/PaymentApplicationStepper.vue");
    const panel = pageSource("components/PaymentCurrentTaskPanel.vue");
    const localDraft = pageSource("spot-payment-local-draft.ts");

    expect(detail).toContain("<PaymentApplicationStepper");
    expect(detail).toContain("updateSpotProcurementPaymentDraft");
    expect(detail).toContain("const saveResult = await saveApplicationDraft(false, draftSnapshot)");
    expect(detail).toContain("await loadDetail();\n    if (paymentId.value !== current.payment.id)");
    expect(detail).toContain("页面已切换到另一张付款申请，原操作已停止，请在当前单据重新办理。");
    expect(detail).toContain("await submitSpotProcurementPayment");
    expect(detail).not.toContain('header="编辑项目零星付款申请单"');
    expect(stepper).toContain("1. 付款与商户");
    expect(stepper).toContain("2. 付款材料");
    expect(stepper).toContain("3. 收款渠道与依据");
    expect(stepper).toContain("4. 核对并提交");
    expect(stepper).toContain("保存并退出");
    expect(stepper).toContain("继续填写");
    expect(stepper).toContain("上一步");
    expect(stepper).toContain("下一步");
    expect(stepper).toContain("提交付款审批");
    expect(stepper).not.toMatch(/预计\s*3\s*[–—-]\s*5\s*分钟/u);
    expect(stepper).not.toMatch(/updateSpotProcurementPaymentDraft|submitSpotProcurementPayment|fetch\(/u);
    expect(stepper).not.toContain('?? "bank_transfer"');
    expect(stepper).toContain("请先在第 1 步选择拟付款方式");
    expect(detail).toContain("readSpotPaymentLocalDraft");
    expect(detail).toContain("clearLocalApplicationDraft");
    expect(detail).toContain("trigger?.isConnected");
    expect(detail).toContain("resetApplicationEditorState()");
    expect(detail).toContain(':key="detail.payment.id"');
    expect(detail).toContain("requestId !== historicalMerchantRequestId");
    expect(detail).toContain("requestId !== vatOptionsRequestId");
    expect(panel).toContain("event.currentTarget instanceof HTMLElement");
    expect(localDraft).toContain("SPOT_PAYMENT_LOCAL_DRAFT_TTL_MS");
    expect(localDraft).not.toMatch(/accountNumber|bankName|attachmentFiles|password/u);
    expect(stepper).toContain("paymentMethodSelectionOptions");
    expect(stepper).toContain("已有渠道的付款方式不可直接取消");
  });

  it("uses one controlled A5 approval drawer with explicit confirmation facts", () => {
    const detail = pageSource("SpotProcurementPaymentDetailPage.vue");
    const drawer = pageSource("components/PaymentApprovalDrawer.vue");

    expect(detail).toContain("<PaymentApprovalDrawer");
    expect(detail).toContain("办理审批");
    expect(detail).toContain("reviewSpotProcurementA5Payment");
    expect(detail).toContain("approvalTriggerElement");
    expect(drawer).toContain('type A5ApprovalResult = "approve" | "return_to_applicant"');
    expect(drawer).toContain("通过");
    expect(drawer).toContain("退回申请人修改");
    expect(drawer).not.toContain("拒绝");
    expect(drawer).not.toContain("驳回");
    expect(drawer).toContain("审批结果");
    expect(drawer).toContain("审批金额");
    expect(drawer).toContain("付款主体");
    expect(drawer).toContain("收款对象");
    expect(drawer).toContain("下一去向");
    expect(drawer).toContain("退回原因不能为空");
    expect(drawer).toContain("<ApprovalSelfReviewFields");
    expect(drawer).not.toMatch(/reviewSpotProcurement|fetch\(|apiFetch|useRoute|useRouter/u);
    expect(drawer).toContain('size="min(560px, 100vw)"');
  });

  it("refreshes payer facts after a shared-role conflict instead of retrying the stale write", () => {
    const detail = pageSource("SpotProcurementPaymentDetailPage.vue");

    expect(detail).toContain("付款主体任务已由其他岗位完成");
    expect(detail).toContain("任务已由其他岗位完成，已刷新最新付款事实。");
    expect(detail).toContain("const operationPaymentId = current.payment.id");
    expect(detail).toContain("paymentId.value !== operationPaymentId");
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
    expect(detail).toContain("prepareSpotExecutionWithUploads(");
    expect(detail).toContain("prepareSpotPaymentDraftWithUploads(");
  });

  it.each([
    ["付款数量", { paymentQuantity: "1.001", unitPrice: "3.50" }],
    ["含税或无票单价", { paymentQuantity: "1.00", unitPrice: "3.333" }]
  ])("does not upload A5 attachments when %s has three decimal places", async (_label, line) => {
    const upload = vi.fn(async () => ({ id: "uploaded-file" }));
    const draft = validPaymentDraft();

    await expect(
      prepareSpotPaymentDraftWithUploads(
        {
          ...draft,
          paymentLines: [{ ...draft.paymentLines[0]!, ...line }]
        },
        [],
        [{ name: "付款依据.pdf" }],
        "merchant_quote",
        upload
      )
    ).rejects.toThrow("最多 2 位小数");
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not upload A5 attachments when a merchant/payee mismatch note is blank", async () => {
    const upload = vi.fn(async () => ({ id: "uploaded-file" }));

    await expect(
      prepareSpotPaymentDraftWithUploads(
        validPaymentDraft({
          payeeName: "张三",
          merchantPayeeMismatchNote: "   "
        }),
        [],
        [{ name: "付款依据.pdf" }],
        "merchant_quote",
        upload
      )
    ).rejects.toThrow("商户与收款对象不一致说明不能为空");
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    ["zero total", [{ paymentQuantity: "1.00", unitPrice: "0.00" }]],
    [
      "single-line BIGINT overflow",
      [{ paymentQuantity: "1.00", unitPrice: postgresBigIntOverflowYuan }]
    ],
    [
      "incremental total BIGINT overflow",
      [
        { paymentQuantity: "1.00", unitPrice: postgresBigIntMaxYuan },
        { paymentQuantity: "1.00", unitPrice: "0.01" }
      ]
    ]
  ])("does not upload A5 attachments for %s", async (_label, amounts) => {
    const upload = vi.fn(async () => ({ id: "uploaded-file" }));
    const draft = validPaymentDraft();

    await expect(
      prepareSpotPaymentDraftWithUploads(
        {
          ...draft,
          paymentLines: amounts.map((amount, index) => ({
            ...draft.paymentLines[0]!,
            procurementLineId: `line-${index + 1}`,
            ...amount
          }))
        },
        [],
        [{ name: "付款依据.pdf" }],
        "merchant_quote",
        upload
      )
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(["1.001", "0", "0.00", "invalid"])(
    "does not upload an execution voucher for invalid or zero yuan input %s",
    async (amountYuan) => {
      const upload = vi.fn(async () => ({ id: "voucher-file" }));

      await expect(
        prepareSpotExecutionWithUploads(
          { ...validExecution, amountYuan },
          [{ name: "付款凭证.png" }],
          upload
        )
      ).rejects.toThrow("本次实际付款金额必须是大于 0、最多 2 位小数的金额");
      expect(upload).not.toHaveBeenCalled();
    }
  );

  it("does not upload an execution voucher above the BIGINT cents range", async () => {
    const upload = vi.fn(async () => ({ id: "voucher-file" }));

    await expect(
      prepareSpotExecutionWithUploads(
        { ...validExecution, amountYuan: postgresBigIntOverflowYuan },
        [{ name: "付款凭证.png" }],
        upload
      )
    ).rejects.toThrow("本次实际付款金额超出系统可保存范围");
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid paidAt", { paidAt: "invalid" }],
    ["future paidAt", { paidAt: "2999-01-01T00:00:00.000Z" }],
    ["invalid method", { paymentMethod: "wire" }],
    ["missing channel", { paymentChannelId: "   " }],
    ["missing UUID", { randomUUID: null }]
  ])("does not upload an execution voucher for %s", async (_label, override) => {
    const upload = vi.fn(async () => ({ id: "voucher-file" }));

    await expect(
      prepareSpotExecutionWithUploads(
        { ...validExecution, ...override },
        [{ name: "付款凭证.png" }],
        upload
      )
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });

  it.each(["3.333", "0", "0.00", "invalid"])(
    "does not upload a refund voucher for invalid or zero yuan input %s",
    async (amountYuan) => {
      const upload = vi.fn(async () => ({ id: "refund-file" }));

      await expect(
        prepareSpotRefundWithUpload(
          { ...validRefund, amountYuan },
          { name: "退款凭证.png" },
          upload
        )
      ).rejects.toThrow("退款到账金额必须是大于 0、最多 2 位小数的金额");
      expect(upload).not.toHaveBeenCalled();
    }
  );

  it("does not upload a refund voucher above the BIGINT cents range", async () => {
    const upload = vi.fn(async () => ({ id: "refund-file" }));

    await expect(
      prepareSpotRefundWithUpload(
        { ...validRefund, amountYuan: postgresBigIntOverflowYuan },
        { name: "退款凭证.png" },
        upload
      )
    ).rejects.toThrow("退款到账金额超出系统可保存范围");
    expect(upload).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid receivedAt", { receivedAt: "invalid" }],
    ["future receivedAt", { receivedAt: "2999-01-01" }],
    ["invalid method", { refundMethod: "wire" }],
    ["missing UUID", { randomUUID: null }]
  ])("does not upload a refund voucher for %s", async (_label, override) => {
    const upload = vi.fn(async () => ({ id: "refund-file" }));

    await expect(
      prepareSpotRefundWithUpload(
        { ...validRefund, ...override },
        { name: "退款凭证.png" },
        upload
      )
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads once for each fully prepared valid payload", async () => {
    const draftUpload = vi.fn(async () => ({ id: "draft-file" }));
    const executionUpload = vi.fn(async () => ({ id: "voucher-file" }));
    const refundUpload = vi.fn(async () => ({ id: "refund-file" }));

    await expect(
      prepareSpotPaymentDraftWithUploads(
        validPaymentDraft({
          paymentLines: [
            {
              procurementLineId: "line-max",
              paymentQuantity: "1.00",
              unitPrice: postgresBigIntMaxYuan,
              expectedInvoiceCondition: "no_invoice"
            }
          ]
        }),
        [],
        [{ name: "付款依据.pdf" }],
        "merchant_quote",
        draftUpload
      )
    ).resolves.toMatchObject({
      paymentType: "company_direct",
      attachments: [{ fileId: "draft-file", category: "merchant_quote" }]
    });
    await expect(
      prepareSpotExecutionWithUploads(
        { ...validExecution, amountYuan: postgresBigIntMaxYuan },
        [{ name: "付款凭证.png" }],
        executionUpload
      )
    ).resolves.toMatchObject({
      amountCents: "9223372036854775807",
      idempotencyKey: "spot-payment-uuid-1",
      voucherFileIds: ["voucher-file"]
    });
    await expect(
      prepareSpotRefundWithUpload(
        { ...validRefund, amountYuan: postgresBigIntMaxYuan },
        { name: "退款凭证.png" },
        refundUpload
      )
    ).resolves.toMatchObject({
      amountCents: "9223372036854775807",
      idempotencyKey: "spot-refund-uuid-1",
      voucherFileId: "refund-file"
    });
    expect(draftUpload).toHaveBeenCalledTimes(1);
    expect(executionUpload).toHaveBeenCalledTimes(1);
    expect(refundUpload).toHaveBeenCalledTimes(1);
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
    expect(payment).toContain('title: "付款申请"');
    expect(payment).toContain('title: "项目 / 商户"');
    expect(payment).toContain('title: "金额"');
    expect(payment).toContain('title: "当前状态"');
    expect(payment).toContain('title: "当前任务"');
    expect(payment).toContain('title: "操作"');
    expect(payment).not.toMatch(/title: "(?:付款主体|收款渠道|累计实付|收货|发票)/u);
  });

  it("links an approved procurement only to the server-selected payment task", () => {
    const workbench = pageSource("SpotProcurementWorkbenchPage.vue");
    const detail = pageSource("SpotProcurementDetailPage.vue");

    expect(workbench).toContain("填写付款申请");
    expect(workbench).toContain("payment.paymentId");
    expect(detail).toContain("填写付款申请");
    expect(detail).toContain("处理付款");
    expect(detail).toContain("查看付款申请");
    expect(`${workbench}\n${detail}`).toContain("?tab=current");
    expect(`${workbench}\n${detail}`).toContain("采购审批完成后将自动生成付款草稿");
    expect(`${workbench}\n${detail}`).not.toContain("createSpotProcurementPaymentDraft");
    expect(`${workbench}\n${detail}`).not.toContain("新建第二张付款申请");
  });

  it("builds the payment workbench around server tasks and server summaries", () => {
    const payment = pageSource("SpotProcurementPaymentWorkbenchPage.vue");
    const queue = pageSource("components/PaymentTaskQueue.vue");
    const status = readFileSync(
      fileURLToPath(new URL("../../components/BusinessStatusText.vue", import.meta.url)),
      "utf8"
    );

    expect(payment).toContain('ref<SpotPaymentWorkbenchView>("mine")');
    expect(payment).toContain("view: activeView.value");
    expect(payment).toContain("result.amountSummary");
    expect(payment).toContain("result.viewCounts");
    expect(payment).toContain("latestPaymentRequestId");
    expect(payment).toContain("requestId !== latestPaymentRequestId");
    expect(payment).toContain("rows.value = []");
    expect(payment).toContain("<PaymentTaskQueue");
    expect(payment).toContain("<BusinessStatusText");
    expect(payment).not.toContain("sumCents");
    expect(queue).toContain("selectSpotPaymentTaskCards");
    expect(queue).toContain("spotPaymentTaskPresentation");
    expect(queue).toContain(':aria-pressed="activeView === view.value"');
    expect(queue).not.toContain("fetchSpotProcurementPayments");
    expect(status).toContain('aria-hidden="true"');
    expect(status).not.toMatch(/<t-tag|<t-button|<button/u);
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
    expect(receipt).toContain("prepareSpotRefundWithUpload(");
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
