import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { effectScope, nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import SpotProcurementDetailPage from "./SpotProcurementDetailPage.vue";
import SpotProcurementReceiptPage from "./SpotProcurementReceiptPage.vue";
import {
  prepareSpotExecutionWithUploads,
  prepareSpotPaymentDraftWithUploads,
  prepareSpotRefundWithUpload,
  type SpotPaymentDraftPreparationInput
} from "./spot-procurement-write-validation";

const spotPageRuntime = vi.hoisted(() => ({
  route: { params: { procurementId: "procurement-a" } },
  confirmAbnormalTermination: vi.fn(),
  fetchDetail: vi.fn(),
  fetchPaymentDetail: vi.fn(),
  fetchReceipt: vi.fn(),
  invalidateInvoice: vi.fn(),
  refreshReceiptPdf: vi.fn(),
  requestAbnormalTermination: vi.fn(),
  submitProcurement: vi.fn()
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onBeforeUnmount: () => undefined,
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue-router")>();
  return {
    ...original,
    useRoute: () => spotPageRuntime.route,
    useRouter: () => ({
      push: vi.fn()
    })
  };
});

vi.mock("../../api/spot-procurement.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/spot-procurement.api")
  >();
  return {
    ...original,
    confirmSpotProcurementAbnormalTermination:
      spotPageRuntime.confirmAbnormalTermination,
    fetchSpotProcurementDetail: spotPageRuntime.fetchDetail,
    fetchSpotProcurementPaymentDetail: spotPageRuntime.fetchPaymentDetail,
    fetchSpotProcurementReceipt: spotPageRuntime.fetchReceipt,
    invalidateSpotProcurementPaymentInvoice:
      spotPageRuntime.invalidateInvoice,
    refreshSpotProcurementReceiptPdf: spotPageRuntime.refreshReceiptPdf,
    requestSpotProcurementAbnormalTermination:
      spotPageRuntime.requestAbnormalTermination,
    submitSpotProcurement: spotPageRuntime.submitProcurement
  };
});

spotPageRuntime.route = reactive(spotPageRuntime.route);

function pageSource(name: string) {
  return readFileSync(
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    "utf8"
  );
}

const pageActionRegistry = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../docs/product/manifests/web-page-actions.registry.json",
        import.meta.url
      )
    ),
    "utf8"
  )
) as {
  actions: Array<{
    id: string;
    capability: { source: string; key: string };
    trigger: { element: string; event: string; handler: string };
    wrappers: Array<{
      apiFile: string;
      name: string;
      variant?: string;
    }>;
  }>;
};

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

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolvePromise = accept;
    reject = decline;
  });
  const resolve = (value?: T | PromiseLike<T>) => {
    resolvePromise(value as T | PromiseLike<T>);
  };
  return { promise, reject, resolve };
}

type MutableValue<T> = { value: T };
type ReceiptPageBindings = {
  busy: MutableValue<boolean>;
  error: MutableValue<string>;
  invoiceInvalidationError: MutableValue<string>;
  invoiceInvalidationVisible: MutableValue<boolean>;
  invalidateInvoice: (values: { reason: string }) => Promise<unknown>;
  message: MutableValue<string>;
  openInvoiceInvalidation: (invoice: unknown) => void;
  paymentDetail: MutableValue<{ payment: { id: string } } | null>;
  paymentNotice: MutableValue<string>;
  prepareReceiptPdfRefresh: () => void;
  receiptPdfRefreshGeneration: MutableValue<number>;
  receiptPdfRefreshProcurementId: MutableValue<string>;
  refreshReceiptPdf: () => Promise<unknown>;
  routeSafetyNotice: MutableValue<string>;
  selectedInvoiceGeneration: MutableValue<number>;
  selectedInvoiceId: MutableValue<string>;
  selectedInvoicePaymentId: MutableValue<string>;
  selectedInvoiceProcurementId: MutableValue<string>;
  spotPaymentCapability: MutableValue<unknown>;
  spotReceiptCapability: MutableValue<unknown>;
};
type ProcurementDetailPageBindings = {
  abnormalTerminationConfirmProcurementId: MutableValue<string>;
  abnormalTerminationConfirmVisible: MutableValue<boolean>;
  abnormalTerminationRequestProcurementId: MutableValue<string>;
  abnormalTerminationRequestVisible: MutableValue<boolean>;
  actionBusy: MutableValue<boolean>;
  actionMessage: MutableValue<string>;
  confirmAbnormalTerminationAction: () => Promise<unknown>;
  detail: MutableValue<unknown>;
  openAbnormalTerminationConfirm: () => void;
  openAbnormalTerminationRequest: () => void;
  requestAbnormalTerminationAction: (values: {
    reason: string;
  }) => Promise<unknown>;
  runSubmit: () => Promise<unknown>;
  spotProcurementCapability: MutableValue<unknown>;
};

function setupPage<T extends object>(component: unknown) {
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      component as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => T;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("spot procurement page setup failed");
  return { bindings, scope };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function receiptReadModel() {
  return {
    lines: [],
    discrepancy: {
      status: "none",
      refundExpectedAmountCents: null
    }
  };
}

function paymentDetailReadModel(id: string) {
  return {
    payment: {
      id,
      procurement: { id: "procurement-a" }
    },
    executions: [],
    invoice: { invoices: [] }
  };
}

function invoiceCapability(
  procurementId: string,
  paymentId: string,
  invoiceId: string
) {
  return {
    payment: {
      id: paymentId,
      procurement: { id: procurementId }
    },
    executions: [],
    invoice: {
      invoices: [
        {
          id: invoiceId,
          fileId: `${invoiceId}-file`,
          file: null,
          availableActions: [
            {
              key: "invalidate_invoice",
              label: "作废发票附件",
              enabled: true,
              disabledReason: null
            }
          ]
        }
      ]
    }
  };
}

function receiptPdfCapability(procurementId: string) {
  return {
    receipt: { procurementId },
    lines: [],
    discrepancy: {
      status: "none",
      refundExpectedAmountCents: null
    },
    availableActions: [
      {
        key: "refresh_receipt_pdf",
        label: "重新生成收货确认 PDF",
        enabled: true,
        disabledReason: null
      }
    ]
  };
}

function prepareReceiptRuntime() {
  spotPageRuntime.route.params.procurementId = "procurement-a";
  spotPageRuntime.fetchReceipt.mockReset();
  spotPageRuntime.fetchReceipt.mockImplementation(async () =>
    receiptReadModel()
  );
  spotPageRuntime.fetchDetail.mockReset();
  spotPageRuntime.fetchDetail.mockImplementation(
    async (procurementId: string) => ({
      procurement: {
        id: procurementId,
        payment: { paymentId: null }
      },
      payments: []
    })
  );
  spotPageRuntime.fetchPaymentDetail.mockReset();
  spotPageRuntime.invalidateInvoice.mockReset();
  spotPageRuntime.refreshReceiptPdf.mockReset();
}

function terminationDetail() {
  return {
    procurement: { id: "procurement-a" },
    availableActions: [
      {
        key: "request_abnormal_termination",
        label: "发起异常终止",
        enabled: true,
        disabledReason: null
      },
      {
        key: "confirm_abnormal_termination",
        label: "确认异常终止",
        enabled: true,
        disabledReason: null
      }
    ]
  };
}

function submissionDetail(procurementId: string) {
  return {
    procurement: { id: procurementId },
    availableActions: [
      {
        key: "submit_approval",
        label: "提交审批",
        enabled: true,
        disabledReason: null
      }
    ]
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

  it("uses server pagination, lifecycle views and full-set statistics on all three ledgers", () => {
    const procurement = pageSource("SpotProcurementWorkbenchPage.vue");
    const payment = pageSource("SpotProcurementPaymentWorkbenchPage.vue");
    const receipt = pageSource("SpotProcurementReceiptWorkbenchPage.vue");

    for (const source of [procurement, receipt]) {
      expect(source).toContain("<t-pagination");
      expect(source).toContain("result.pagination");
    }
    expect(procurement).toContain("result.statistics");
    expect(procurement).toContain("changeLifecycleView");
    expect(payment).toContain("result.viewCounts");
    expect(payment).toContain("result.amountSummary");
    expect(payment).toContain("changeView");
    expect(receipt).toMatch(/surface:\s*"receipt"/u);
    expect(`${procurement}\n${payment}\n${receipt}`).not.toContain("limit: 200");
  });

  it("shows the required arrival date in the procurement ledger without inventing it for legacy records", () => {
    const procurement = pageSource("SpotProcurementWorkbenchPage.vue");

    expect(procurement).toContain('colKey: "arrival", title: "到位日期"');
    expect(procurement).toContain("function arrivalDateText");
    expect(procurement).toContain("历史单据，未按新流程采集");
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
    expect(component).not.toContain("supplierBalanceAmountCents");
    expect(detail).toContain(
      "requiresLegacySupplierBalanceAdjustment"
    );
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
    expect(detail).toContain("await loadDetail();\n    assertCurrentApplicationOperation(operationToken, operationPaymentId)");
    expect(detail).toContain("页面已切换到另一张付款申请，原操作已停止，请在当前单据重新办理。");
    expect(detail).toContain("applicationOpenedPaymentId");
    expect(detail).toContain("applicationOperationToken");
    expect(detail).toContain("const operationDraft = clonePaymentApplicationDraft");
    expect(detail).toContain("const uploaded = await uploadPrivateFile(file, fileName);\n        assertCurrentApplicationOperation(operationToken, operationPaymentId)");
    expect(detail).toContain("assertCurrentApplicationOperation(operationToken, operationPaymentId);\n    await updateSpotProcurementPaymentDraft(operationPaymentId, payload)");
    expect(detail).toContain("if (isCurrentApplicationOperation(operationToken, operationPaymentId)) actionBusy.value = false");
    expect(detail).toContain("persistLocalApplicationDraft(operationPaymentId, currentStep, operationDraft, false)");
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
    expect(detail).not.toContain("fetchVatRateOptions");
    expect(detail).not.toContain("vatOptionsRequestId");
    expect(stepper).toContain("vatRatePercent");
    expect(stepper).toContain("免税填 0");
    expect(panel).toContain("event.currentTarget instanceof HTMLElement");
    expect(localDraft).toContain("SPOT_PAYMENT_LOCAL_DRAFT_TTL_MS");
    expect(localDraft).not.toMatch(/accountNumber|bankName|attachmentFiles|password/u);
    expect(stepper).toContain("paymentMethodSelectionOptions");
    expect(stepper).toContain("已有渠道的付款方式不可直接取消");
  });

  it("uses one controlled A5 approval drawer with explicit confirmation facts", () => {
    const detail = pageSource("SpotProcurementPaymentDetailPage.vue");
    const drawer = pageSource("components/PaymentApprovalDrawer.vue");
    const registrations = pageActionRegistry.actions.filter((action) =>
      action.id.startsWith("spot-procurement-payment.") &&
      action.id.includes("review")
    );

    expect(detail).toContain("<PaymentApprovalDrawer");
    expect(detail).toContain(
      "v-if=\"isRealPayment && paymentReviewActionEnabled('review_approval')\""
    );
    expect(detail).toContain("办理审批");
    expect(detail).toContain(
      "const spotProcurementPaymentCapability = ref<SpotProcurementPaymentDetailReadModel | null>(null)"
    );
    expect(detail).toContain(
      "spotProcurementPaymentCapability.value = serverDetail"
    );
    expect(detail).toContain("const viewDetail = structuredClone(serverDetail)");
    expect(detail).toContain("executeSpotProcurementPaymentReviewAction");
    expect(detail).toContain("prepareSpotProcurementPaymentReviewAction");
    expect(detail).toContain("function confirmA5PaymentApprove");
    expect(detail).toContain("function confirmA5PaymentReturn");
    expect(detail).toContain("function confirmLegacyPaymentApprove");
    expect(detail).toContain("function confirmLegacyPaymentReturn");
    expect(detail).toContain('@approve="confirmA5PaymentApprove"');
    expect(detail).toContain(
      '@return-to-applicant="confirmA5PaymentReturn"'
    );
    expect(detail).toContain('@confirm="confirmLegacyPaymentApprove"');
    expect(detail).toContain('@confirm="confirmLegacyPaymentReturn"');
    expect(detail).toContain("legacySelfReviewReason");
    expect(detail).toContain("自审原因（不作为审批意见）");
    expect(detail).toContain("!selfReviewReason || !confirmationPassword");
    expect(detail).toContain("legacyAdjustedSupplierBalanceAmountYuan");
    expect(detail).toContain("调整后供应商余额抵扣金额");
    expect(detail).toContain('currentRoleKeys[0] === "finance_director"');
    expect(detail).not.toContain("selfReviewReason: values.reason");
    expect(detail).not.toContain("reviewSpotProcurementA5Payment");
    expect(detail).not.toContain("reviewSpotProcurementPayment");
    expect(detail).not.toContain("review_reject");
    expect(detail).toContain("approvalTriggerElement");
    expect(drawer).toContain('type A5ApprovalResult = "approve" | "return_to_applicant"');
    expect(drawer).toContain('emit("approve", payload)');
    expect(drawer).toContain('emit("return-to-applicant", payload)');
    expect(drawer).not.toContain('emit("submit"');
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
    expect(drawer).toContain("focusTitle()");
    expect(drawer).toContain(':on-before-open="focusTitle"');
    expect(drawer).toContain("nextTick");
    expect(drawer).toContain('tabindex="-1"');
    expect(drawer).toContain("MutationObserver");

    expect(registrations).toHaveLength(4);
    expect(
      registrations.map((action) => ({
        id: action.id,
        source: action.capability.source,
        event: action.trigger.event,
        handler: action.trigger.handler,
        wrapper: action.wrappers[0]?.name,
        variant: action.wrappers[0]?.variant
      }))
    ).toEqual([
      {
        id: "spot-procurement-payment.review-approve",
        source: "spotProcurementPaymentCapability.availableActions",
        event: "approve",
        handler: "confirmA5PaymentApprove",
        wrapper: "executeSpotProcurementPaymentReviewAction",
        variant: "approve"
      },
      {
        id: "spot-procurement-payment.review-return-to-applicant",
        source: "spotProcurementPaymentCapability.availableActions",
        event: "return-to-applicant",
        handler: "confirmA5PaymentReturn",
        wrapper: "executeSpotProcurementPaymentReviewAction",
        variant: "return_to_applicant"
      },
      {
        id: "spot-procurement-payment.legacy-review-approve",
        source: "spotProcurementPaymentCapability.availableActions",
        event: "confirm",
        handler: "confirmLegacyPaymentApprove",
        wrapper: "executeSpotProcurementPaymentReviewAction",
        variant: "approve"
      },
      {
        id: "spot-procurement-payment.legacy-review-return-to-applicant",
        source: "spotProcurementPaymentCapability.availableActions",
        event: "confirm",
        handler: "confirmLegacyPaymentReturn",
        wrapper: "executeSpotProcurementPaymentReviewAction",
        variant: "return_to_applicant"
      }
    ]);
  });

  it("refreshes payer facts after a shared-role conflict instead of retrying the stale write", () => {
    const detail = pageSource("SpotProcurementPaymentDetailPage.vue");

    expect(detail).toContain("SPOT_PAYMENT_PAYER_TASK_COMPLETED");
    expect(detail).toContain("error instanceof SpotProcurementApiError");
    expect(detail).toContain("任务已由其他岗位完成，已刷新最新付款事实。");
    expect(detail).toContain("const operationPaymentId = payerOpenedPaymentId");
    expect(detail).toContain("paymentId.value !== payerOpenedPaymentId");
    expect(detail).toContain("context.paymentId === paymentId.value");
    expect(detail).toContain("paymentReviewBusyOwnerId === context.operationId");
    expect(detail).toContain("resetPayerEditorState();");
    expect(detail).toContain("resetApprovalEditorState();");
    expect(detail).toContain("paymentId.value !== operationPaymentId");
  });

  it("reuses one locked idempotency payload across execution retries", () => {
    const detail = pageSource(
      "SpotProcurementPaymentDetailPage.vue"
    );
    const drawer = pageSource(
      "components/PaymentExecutionDrawer.vue"
    );

    expect(detail).toContain(
      "executionAttempt.value ?? (await prepareExecutionAttempt(payload))"
    );
    expect(detail).toContain("executionOpenedPaymentId");
    expect(detail).toContain("operationPaymentId");
    expect(detail).toContain("paymentId.value !== operationPaymentId");
    expect(detail).toContain("selectPaymentTab(\"executions\")");
    expect(detail).toContain("resetExecutionAttempt()");
    expect(detail).toContain("await loadDetail()");
    expect(detail).toContain("prepareSpotExecutionWithUploads(");
    expect(detail).toContain("prepareSpotPaymentDraftWithUploads(");
    expect(drawer).toContain("本次重试参数已锁定");
    expect(drawer).toContain("修改本次付款");
    expect(drawer).toContain("spotPaymentExecutionVoucherLabel");
    expect(drawer).toContain("existingExecutions");
    expect(drawer).toContain(':upload-button="null"');
    expect(drawer).toContain(':cancel-upload-button="null"');
    expect(drawer).toContain("凭证将在确认登记时上传并与本次实付一并登记。");
    const submitSource = drawer.slice(
      drawer.indexOf("function submit()"),
      drawer.indexOf("function resetAttempt()")
    );
    expect(submitSource.indexOf("const confirmationPassword = form.confirmationPassword")).toBeLessThan(
      submitSource.indexOf('form.confirmationPassword = ""')
    );
    expect(submitSource.indexOf('form.confirmationPassword = ""')).toBeLessThan(
      submitSource.indexOf('emit("submit"')
    );
    expect(detail).toContain("executionFocusObserver = new MutationObserver");
    expect(detail).toContain(".payment-execution-drawer.t-drawer--open");
    expect(drawer).not.toMatch(/recordSpotProcurement|uploadPrivateFile|fetch\(|apiFetch|useRoute|useRouter/u);
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

  it("uses server-owned lifecycle actions for procurement, A5 payment and receipt drafts", () => {
    const procurement = pageSource("SpotProcurementDetailPage.vue");
    const payment = pageSource("SpotProcurementPaymentDetailPage.vue");
    const paymentWorkbench = pageSource("SpotProcurementPaymentWorkbenchPage.vue");
    const receipt = pageSource("SpotProcurementReceiptPage.vue");

    expect(procurement).toContain("<BusinessDraftAction");
    expect(procurement).toContain("abandonSpotProcurementDraft");
    expect(procurement).toContain('"delete_pristine_draft"');
    expect(procurement).toContain('"abandon_application"');
    expect(procurement).toContain("recreateSpotProcurementPaymentDraft");
    expect(procurement).toContain('actionEnabled("create_payment_draft")');
    expect(payment).toContain("abandonSpotProcurementPaymentDraft");
    expect(payment).toContain("expectedUpdatedAt: current.payment.updatedAt");
    expect(payment).toContain("放弃付款草稿");
    expect(paymentWorkbench).toContain('view: activeView.value');
    expect(paymentWorkbench).toContain('result.viewCounts');
    expect(paymentWorkbench).toContain('result.amountSummary');
    expect(receipt).toContain("resetSpotProcurementReceiptDraft");
    expect(receipt).toContain("receiptResetAction");
    expect(receipt).toContain("expectedRevision");
    expect(receipt).toContain("不删除收货单、旧修订、锁定照片");
    expect(receipt).not.toContain("删除收货单按钮");
  });

  it("keeps both workbench ledgers inside their own horizontal scroll regions", () => {
    const procurement = pageSource("SpotProcurementWorkbenchPage.vue");
    const payment = pageSource("SpotProcurementPaymentWorkbenchPage.vue");

    for (const source of [procurement, payment]) {
      expect(source).toContain("jg-responsive-ledger");
      expect(source).toContain("jg-table-region jg-table-region--wide");
      expect(source).toContain("horizontal-scroll-affixed-bottom");
    }
    expect(procurement).toContain('title: "采购编号"');
    expect(procurement).toContain('title: "申请人 / 采购人"');
    expect(procurement).toContain('title: "材料与原因摘要"');
    expect(procurement).toContain('title: "关联付款 / 收货"');
    expect(procurement).toContain('title: "状态 / 当前办理"');
    expect(procurement).toContain('title: "更新时间"');
    expect(procurement).toContain("row.receiptWorkbench.materialSummary");
    expect(payment).toContain('title: "付款编号"');
    expect(payment).toContain('title: "采购编号"');
    expect(payment).toContain('title: "商户 / 收款对象"');
    expect(payment).toContain('title: "审批金额"');
    expect(payment).toContain('title: "实付 / 退款 / 剩余"');
    expect(payment).toContain('title: "收货 / 发票"');
    expect(payment).toContain('title: "状态 / 当前办理人"');
    expect(payment).toContain('title: "更新时间"');
    expect(payment).toContain('title: "操作"');
    expect(payment).toContain("paymentProgress(row)");
    expect(payment).toContain("receiptInvoice(row)");
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
    expect(`${workbench}\n${detail}`).not.toMatch(/\bcreateSpotProcurementPaymentDraft/u);
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
    expect(workbench).toContain("materialSummary");
    expect(workbench).toContain("approvedQuantitySummary");
    expect(workbench).toContain("actualPaidAmountCents");
    expect(workbench).toContain("receiptDelegate");
    expect(workbench).toContain("采购/付款编号");
    expect(workbench).toContain("收货责任人/受托人");
    expect(receipt).toContain("fetchSpotProcurementReceipt");
    expect(receipt).toContain("fetchSpotProcurementPaymentDetail");
    expect(receipt).toContain("reviewSpotProcurementReceipt");
    expect(receipt).toContain("revokeSpotProcurementReceiptReview");
    expect(receipt).toContain("createSpotProcurementDiscrepancy");
    expect(receipt).toContain("recordSpotProcurementRefund");
    expect(receipt).toContain("prepareSpotRefundWithUpload(");
    expect(receipt).toContain("appendSpotProcurementPaymentInvoice");
    expect(receipt).toContain("invalidateSpotProcurementPaymentInvoice");
    expect(receipt).toContain("refreshSpotProcurementReceiptPdf");
    expect(receipt).toContain("const spotPaymentCapability = ref<SpotProcurementPaymentDetailReadModel | null>(null)");
    expect(receipt).toContain("const spotReceiptCapability = ref<SpotProcurementReceiptDetailReadModel | null>(null)");
    expect(receipt).toContain("const receiptRequest = fetchSpotProcurementReceipt(context.procurementId)");
    expect(receipt).toContain(
      "void procurementDetailRequest.catch(() => undefined)"
    );
    expect(receipt).toContain("const receiptResult = await receiptRequest");
    expect(receipt).toContain(
      "const procurementDetail = await procurementDetailRequest"
    );
    expect(receipt).toContain(
      "procurementDetail.procurement.payment?.paymentId ?? null"
    );
    expect(receipt).toContain("item.id === currentPaymentId");
    expect(receipt).not.toContain(
      'payments.find((item) => item.form === "real_payment")'
    );
    expect(receipt).not.toContain(
      "await Promise.all([receiptRequest, procurementDetailRequest])"
    );
    expect(receipt).toContain("spotReceiptCapability.value = receiptResult");
    expect(receipt).toContain("const paymentRequest = fetchSpotProcurementPaymentDetail(payment.id)");
    expect(receipt).toContain("const paymentResult = await paymentRequest");
    expect(receipt).toContain("spotPaymentCapability.value = paymentResult");
    expect(receipt).toContain("spotPaymentCapability.value?.invoice?.invoices");
    expect(receipt).toContain("invoice.id === selectedInvoiceId.value");
    expect(receipt).toContain("spotReceiptCapability.value?.availableActions?.find");
    expect(receipt).toContain("receiptPdfRefreshAction?.enabled");
    expect(receipt).toContain('v-if="selectedInvoiceInvalidationAction?.enabled"');
    expect(receipt).toContain("selectedInvoicePaymentId.value = spotPaymentCapability.value.payment.id");
    expect(receipt).toContain("assertInvoiceInvalidationContext(context)");
    expect(receipt).toContain("assertReceiptPdfRefreshContext(context)");
    expect(receipt).toContain(
      "capability.payment.procurement.id === context.procurementId"
    );
    expect(receipt).toContain(
      "spotReceiptCapability.value?.receipt.procurementId ==="
    );
    expect(receipt).toContain(
      ".then(() => completeInvoiceInvalidation(context))"
    );
    expect(receipt).toContain("prepareReceiptPdfRefresh");
    expect(receipt).toContain(
      ".then(() => completeReceiptPdfRefresh(context))"
    );
    expect(receipt).toContain("receipt.value?.availableActions?.find");
    expect(receipt).toContain("actionEnabled('review_receipt')");
    expect(receipt).toContain("actionEnabled('record_refund')");
    expect(receipt).toContain('actionEnabled("append_receipt_photo")');
    expect(receipt).toContain("requestId !== loadRequestId || !contextIsCurrent(context)");
    expect(receipt).toContain("assertCurrentContext(context)");
    expect(receipt).toContain("ROUTE_CHANGED_MESSAGE");
    expect(receipt).toContain("委托");
    expect(receipt).toContain("待财务登记首笔实际付款后开放收货");
    expect(receipt).toContain("商户继续补货");
    expect(receipt).toContain("商户退回差额");
    expect(receipt).toContain("发票仍可在付款申请中补充归档");
    expect(uploader).toContain("系统拍照");
    expect(uploader).toContain("相册上传");
    expect(uploader).toContain("送货单可选");
    expect(uploader).toContain("watermarkedFileId");
    expect(uploader).toContain("function select(files: File[])");
    expect(uploader).toContain("selectedFile = files[0] ?? null");
    expect(uploader).toContain("已提交照片不可删除或替换");
    expect(`${workbench}\n${receipt}\n${uploader}`).not.toMatch(/navigator\.geolocation/iu);
    expect(`${workbench}\n${receipt}`).not.toMatch(/createReceiptBatch|fetchReceiptBatches/iu);
    expect(`${workbench}\n${receipt}`).not.toMatch(/supplierBalance|转商户余额/iu);
    expect(receipt).not.toMatch(/invoice\.status\s*===/u);
    expect(
      [...receipt.matchAll(/spotPaymentCapability\.value\s*=\s*([^;\n]+)/gu)]
        .map((match) => match[1]?.trim())
        .filter(Boolean)
    ).toEqual(["null", "null", "paymentResult"]);
    expect(
      [...receipt.matchAll(/spotReceiptCapability\.value\s*=\s*([^;\n]+)/gu)]
        .map((match) => match[1]?.trim())
        .filter(Boolean)
    ).toEqual(["null", "null", "receiptResult"]);
  });

  it("loads invoice capabilities from the server-selected current payment, not retained history", async () => {
    spotPageRuntime.route.params.procurementId = "procurement-a";
    spotPageRuntime.fetchReceipt.mockReset();
    spotPageRuntime.fetchReceipt.mockResolvedValue(receiptReadModel());
    spotPageRuntime.fetchDetail.mockReset();
    spotPageRuntime.fetchDetail.mockResolvedValue({
      procurement: {
        id: "procurement-a",
        payment: { paymentId: "payment-current" }
      },
      payments: [
        { id: "payment-invalidated", form: "real_payment", status: "invalidated" },
        { id: "payment-current", form: "real_payment", status: "draft" }
      ]
    });
    spotPageRuntime.fetchPaymentDetail.mockReset();
    spotPageRuntime.fetchPaymentDetail.mockResolvedValue(
      paymentDetailReadModel("payment-current")
    );
    const { bindings, scope } = setupPage<ReceiptPageBindings>(
      SpotProcurementReceiptPage
    );

    try {
      await flushPromises();

      expect(spotPageRuntime.fetchPaymentDetail).toHaveBeenCalledTimes(1);
      expect(spotPageRuntime.fetchPaymentDetail).toHaveBeenCalledWith(
        "payment-current"
      );
      expect(bindings.paymentDetail.value?.payment.id).toBe("payment-current");
    } finally {
      scope.stop();
    }
  });

  it.each([
    ["missing", null],
    ["not visible", "payment-hidden"]
  ])(
    "fails closed when the server-selected current payment is %s",
    async (_label, currentPaymentId) => {
      spotPageRuntime.route.params.procurementId = "procurement-a";
      spotPageRuntime.fetchReceipt.mockReset();
      spotPageRuntime.fetchReceipt.mockResolvedValue(receiptReadModel());
      spotPageRuntime.fetchDetail.mockReset();
      spotPageRuntime.fetchDetail.mockResolvedValue({
        procurement: {
          id: "procurement-a",
          payment: { paymentId: currentPaymentId }
        },
        payments: [
          {
            id: "payment-invalidated",
            form: "real_payment",
            status: "invalidated"
          }
        ]
      });
      spotPageRuntime.fetchPaymentDetail.mockReset();
      const { bindings, scope } = setupPage<ReceiptPageBindings>(
        SpotProcurementReceiptPage
      );

      try {
        await flushPromises();

        expect(spotPageRuntime.fetchPaymentDetail).not.toHaveBeenCalled();
        expect(bindings.paymentDetail.value).toBeNull();
        expect(bindings.paymentNotice.value).not.toBe("");
      } finally {
        scope.stop();
      }
    }
  );

  it("fails closed when the server-selected payment id only matches a non-real-payment row", async () => {
    spotPageRuntime.route.params.procurementId = "procurement-a";
    spotPageRuntime.fetchReceipt.mockReset();
    spotPageRuntime.fetchReceipt.mockResolvedValue(receiptReadModel());
    spotPageRuntime.fetchDetail.mockReset();
    spotPageRuntime.fetchDetail.mockResolvedValue({
      procurement: {
        id: "procurement-a",
        payment: { paymentId: "payment-current" }
      },
      payments: [
        {
          id: "payment-current",
          form: "prepayment",
          status: "draft"
        }
      ]
    });
    spotPageRuntime.fetchPaymentDetail.mockReset();
    const { bindings, scope } = setupPage<ReceiptPageBindings>(
      SpotProcurementReceiptPage
    );

    try {
      await flushPromises();

      expect(spotPageRuntime.fetchPaymentDetail).not.toHaveBeenCalled();
      expect(bindings.paymentDetail.value).toBeNull();
      expect(bindings.spotPaymentCapability.value).toBeNull();
      expect(bindings.paymentNotice.value).not.toBe("");
    } finally {
      scope.stop();
    }
  });

  it.each([
    ["payment id", "payment-other", "procurement-a"],
    ["procurement id", "payment-current", "procurement-other"]
  ])(
    "fails closed when the payment detail response has a mismatched %s",
    async (_coordinate, responsePaymentId, responseProcurementId) => {
      spotPageRuntime.route.params.procurementId = "procurement-a";
      spotPageRuntime.fetchReceipt.mockReset();
      spotPageRuntime.fetchReceipt.mockResolvedValue(receiptReadModel());
      spotPageRuntime.fetchDetail.mockReset();
      spotPageRuntime.fetchDetail.mockResolvedValue({
        procurement: {
          id: "procurement-a",
          payment: { paymentId: "payment-current" }
        },
        payments: [
          {
            id: "payment-current",
            form: "real_payment",
            status: "draft"
          }
        ]
      });
      spotPageRuntime.fetchPaymentDetail.mockReset();
      const paymentResponse = paymentDetailReadModel(responsePaymentId);
      paymentResponse.payment.procurement.id = responseProcurementId;
      spotPageRuntime.fetchPaymentDetail.mockResolvedValue(paymentResponse);
      const { bindings, scope } = setupPage<ReceiptPageBindings>(
        SpotProcurementReceiptPage
      );

      try {
        await flushPromises();

        expect(spotPageRuntime.fetchPaymentDetail).toHaveBeenCalledWith(
          "payment-current"
        );
        expect(bindings.paymentDetail.value).toBeNull();
        expect(bindings.spotPaymentCapability.value).toBeNull();
        expect(bindings.paymentNotice.value).not.toBe("");
      } finally {
        scope.stop();
      }
    }
  );

  it.each(["resolve", "reject"] as const)(
    "does not let an invoice invalidation %s from procurement A mutate procurement B",
    async (settlement) => {
      prepareReceiptRuntime();
      const pending = deferred();
      spotPageRuntime.invalidateInvoice.mockReturnValue(pending.promise);
      const { bindings, scope } = setupPage<ReceiptPageBindings>(
        SpotProcurementReceiptPage
      );

      try {
        await flushPromises();
        const capabilityA = invoiceCapability(
          "procurement-a",
          "payment-a",
          "invoice-a"
        );
        bindings.spotPaymentCapability.value = capabilityA;
        bindings.openInvoiceInvalidation(
          capabilityA.invoice.invoices[0]!
        );
        const action = bindings.invalidateInvoice({ reason: "A 发票错误" });

        expect(spotPageRuntime.invalidateInvoice).toHaveBeenCalledWith(
          "payment-a",
          "invoice-a",
          { reason: "A 发票错误" }
        );

        spotPageRuntime.route.params.procurementId = "procurement-b";
        await nextTick();
        await flushPromises();
        const capabilityB = invoiceCapability(
          "procurement-b",
          "payment-b",
          "invoice-b"
        );
        bindings.spotPaymentCapability.value = capabilityB;
        bindings.openInvoiceInvalidation(
          capabilityB.invoice.invoices[0]!
        );
        bindings.message.value = "采购 B 已准备";
        bindings.error.value = "采购 B 页面提示";
        bindings.invoiceInvalidationError.value = "采购 B 表单提示";
        bindings.busy.value = true;
        const generationB = bindings.selectedInvoiceGeneration.value;
        const loadCountBeforeSettlement =
          spotPageRuntime.fetchReceipt.mock.calls.length;

        if (settlement === "resolve") {
          pending.resolve();
        } else {
          pending.reject(new Error("采购 A 作废失败"));
        }
        await action;
        await flushPromises();

        expect(spotPageRuntime.fetchReceipt).toHaveBeenCalledTimes(
          loadCountBeforeSettlement
        );
        expect(bindings.message.value).toBe("采购 B 已准备");
        expect(bindings.error.value).toBe("采购 B 页面提示");
        expect(bindings.invoiceInvalidationError.value).toBe(
          "采购 B 表单提示"
        );
        expect(bindings.busy.value).toBe(true);
        expect(bindings.invoiceInvalidationVisible.value).toBe(true);
        expect(bindings.selectedInvoiceId.value).toBe("invoice-b");
        expect(bindings.selectedInvoicePaymentId.value).toBe("payment-b");
        expect(bindings.selectedInvoiceProcurementId.value).toBe(
          "procurement-b"
        );
        expect(bindings.selectedInvoiceGeneration.value).toBe(generationB);
        expect(bindings.routeSafetyNotice.value).toBe("");
      } finally {
        scope.stop();
      }
    }
  );

  it.each(["resolve", "reject"] as const)(
    "does not let a receipt PDF refresh %s from procurement A mutate procurement B",
    async (settlement) => {
      prepareReceiptRuntime();
      const pending = deferred();
      spotPageRuntime.refreshReceiptPdf.mockReturnValue(pending.promise);
      const { bindings, scope } = setupPage<ReceiptPageBindings>(
        SpotProcurementReceiptPage
      );

      try {
        await flushPromises();
        bindings.spotReceiptCapability.value =
          receiptPdfCapability("procurement-a");
        bindings.prepareReceiptPdfRefresh();
        const action = bindings.refreshReceiptPdf();

        expect(spotPageRuntime.refreshReceiptPdf).toHaveBeenCalledWith(
          "procurement-a"
        );

        spotPageRuntime.route.params.procurementId = "procurement-b";
        await nextTick();
        await flushPromises();
        bindings.spotReceiptCapability.value =
          receiptPdfCapability("procurement-b");
        bindings.prepareReceiptPdfRefresh();
        bindings.message.value = "采购 B 已准备";
        bindings.error.value = "采购 B 页面提示";
        bindings.busy.value = true;
        const generationB = bindings.receiptPdfRefreshGeneration.value;
        const loadCountBeforeSettlement =
          spotPageRuntime.fetchReceipt.mock.calls.length;

        if (settlement === "resolve") {
          pending.resolve();
        } else {
          pending.reject(new Error("采购 A PDF 生成失败"));
        }
        await action;
        await flushPromises();

        expect(spotPageRuntime.fetchReceipt).toHaveBeenCalledTimes(
          loadCountBeforeSettlement
        );
        expect(bindings.message.value).toBe("采购 B 已准备");
        expect(bindings.error.value).toBe("采购 B 页面提示");
        expect(bindings.busy.value).toBe(true);
        expect(bindings.receiptPdfRefreshProcurementId.value).toBe(
          "procurement-b"
        );
        expect(bindings.receiptPdfRefreshGeneration.value).toBe(generationB);
        expect(bindings.routeSafetyNotice.value).toBe("");
      } finally {
        scope.stop();
      }
    }
  );

  it("keeps busy false and skips the invoice wrapper when preflight coordinates are stale", async () => {
    prepareReceiptRuntime();
    const { bindings, scope } = setupPage<ReceiptPageBindings>(
      SpotProcurementReceiptPage
    );

    try {
      await flushPromises();
      const capability = invoiceCapability(
        "procurement-a",
        "payment-a",
        "invoice-a"
      );
      bindings.spotPaymentCapability.value = capability;
      bindings.openInvoiceInvalidation(capability.invoice.invoices[0]!);
      bindings.selectedInvoiceProcurementId.value = "procurement-stale";

      expect(() =>
        bindings.invalidateInvoice({ reason: "坐标失效" })
      ).toThrow();
      expect(spotPageRuntime.invalidateInvoice).not.toHaveBeenCalled();
      expect(bindings.busy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("keeps busy false and skips the receipt PDF wrapper when preflight coordinates are stale", async () => {
    prepareReceiptRuntime();
    const { bindings, scope } = setupPage<ReceiptPageBindings>(
      SpotProcurementReceiptPage
    );

    try {
      await flushPromises();
      bindings.spotReceiptCapability.value =
        receiptPdfCapability("procurement-a");
      bindings.prepareReceiptPdfRefresh();
      bindings.receiptPdfRefreshProcurementId.value = "procurement-stale";

      expect(() => bindings.refreshReceiptPdf()).toThrow();
      expect(spotPageRuntime.refreshReceiptPdf).not.toHaveBeenCalled();
      expect(bindings.busy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it.each(["invoice", "receipt PDF"] as const)(
    "keeps busy false when the %s wrapper throws before returning a promise",
    async (actionType) => {
      prepareReceiptRuntime();
      const { bindings, scope } = setupPage<ReceiptPageBindings>(
        SpotProcurementReceiptPage
      );

      try {
        await flushPromises();
        if (actionType === "invoice") {
          const capability = invoiceCapability(
            "procurement-a",
            "payment-a",
            "invoice-a"
          );
          bindings.spotPaymentCapability.value = capability;
          bindings.openInvoiceInvalidation(
            capability.invoice.invoices[0]!
          );
          spotPageRuntime.invalidateInvoice.mockImplementationOnce(() => {
            throw new Error("同步创建请求失败");
          });

          expect(() =>
            bindings.invalidateInvoice({ reason: "附件错误" })
          ).toThrow("同步创建请求失败");
        } else {
          bindings.spotReceiptCapability.value =
            receiptPdfCapability("procurement-a");
          bindings.prepareReceiptPdfRefresh();
          spotPageRuntime.refreshReceiptPdf.mockImplementationOnce(() => {
            throw new Error("同步创建请求失败");
          });

          expect(() => bindings.refreshReceiptPdf()).toThrow(
            "同步创建请求失败"
          );
        }
        expect(bindings.busy.value).toBe(false);
      } finally {
        scope.stop();
      }
    }
  );

  it("lets an old invoice operation release its busy ownership after a same-route selection change without polluting the new selection", async () => {
    prepareReceiptRuntime();
    const pending = deferred();
    spotPageRuntime.invalidateInvoice.mockReturnValue(pending.promise);
    const { bindings, scope } = setupPage<ReceiptPageBindings>(
      SpotProcurementReceiptPage
    );

    try {
      await flushPromises();
      const capability = invoiceCapability(
        "procurement-a",
        "payment-a",
        "invoice-a"
      );
      const invoiceB = {
        ...capability.invoice.invoices[0]!,
        id: "invoice-b",
        fileId: "invoice-b-file"
      };
      capability.invoice.invoices.push(invoiceB);
      bindings.spotPaymentCapability.value = capability;
      bindings.openInvoiceInvalidation(capability.invoice.invoices[0]!);
      const action = bindings.invalidateInvoice({ reason: "A 发票错误" });

      bindings.openInvoiceInvalidation(invoiceB);
      bindings.message.value = "发票 B 已准备";
      const generation = bindings.selectedInvoiceGeneration.value;
      const loadCountBeforeSettlement =
        spotPageRuntime.fetchReceipt.mock.calls.length;
      pending.resolve();
      await action;
      await flushPromises();

      expect(bindings.busy.value).toBe(false);
      expect(bindings.message.value).toBe("发票 B 已准备");
      expect(bindings.invoiceInvalidationVisible.value).toBe(true);
      expect(bindings.selectedInvoiceId.value).toBe("invoice-b");
      expect(bindings.selectedInvoicePaymentId.value).toBe("payment-a");
      expect(bindings.selectedInvoiceProcurementId.value).toBe(
        "procurement-a"
      );
      expect(bindings.selectedInvoiceGeneration.value).toBe(generation);
      expect(spotPageRuntime.fetchReceipt).toHaveBeenCalledTimes(
        loadCountBeforeSettlement
      );
    } finally {
      scope.stop();
    }
  });

  it("binds procurement submission to the immutable server capability and direct causal wrapper chain", () => {
    const detail = pageSource("SpotProcurementDetailPage.vue");
    const registration = pageActionRegistry.actions.find(
      (action) => action.id === "spot-procurement.submit"
    );

    expect(registration?.capability).toMatchObject({
      source: "spotProcurementCapability.availableActions",
      key: "submit_approval"
    });
    expect(detail).toContain(
      "const submitApprovalAction = computed(() =>"
    );
    expect(detail).toContain(
      "spotProcurementCapability.value.availableActions.find("
    );
    expect(detail).toContain(
      "const request = submitSpotProcurement("
    );
    expect(detail).toContain(
      "requireCurrentSubmitProcurementId(context)"
    );
    expect(detail).toContain(
      ".then(() => completeSubmit(context))"
    );
    expect(detail).toContain(
      'v-if="submitApprovalAction?.enabled"'
    );
    expect(detail).toContain("{{ submitApprovalAction.label }}");
    expect(detail).not.toContain(
      'v-if="actionEnabled(\'submit_approval\')"'
    );
  });

  it("rejects a forged submit gate before calling the wrapper or setting busy", () => {
    spotPageRuntime.route.params.procurementId = "procurement-a";
    spotPageRuntime.submitProcurement.mockReset();
    const { bindings, scope } = setupPage<ProcurementDetailPageBindings>(
      SpotProcurementDetailPage
    );
    bindings.detail.value = submissionDetail("procurement-a");
    bindings.spotProcurementCapability.value =
      submissionDetail("procurement-stale");
    bindings.actionBusy.value = false;

    try {
      expect(() => bindings.runSubmit()).toThrow(
        "采购提交操作上下文已失效"
      );
      expect(spotPageRuntime.submitProcurement).not.toHaveBeenCalled();
      expect(bindings.actionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("does not let a completed procurement submission refresh, message or clear busy on a later route", async () => {
    const pending = deferred();
    spotPageRuntime.route.params.procurementId = "procurement-a";
    spotPageRuntime.fetchDetail.mockReset();
    spotPageRuntime.fetchDetail
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockRejectedValue(new Error("stale refresh must not run"));
    spotPageRuntime.submitProcurement.mockReset();
    spotPageRuntime.submitProcurement.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupPage<ProcurementDetailPageBindings>(
      SpotProcurementDetailPage
    );
    const detailA = submissionDetail("procurement-a");
    bindings.detail.value = detailA;
    bindings.spotProcurementCapability.value = detailA;

    const action = bindings.runSubmit();
    spotPageRuntime.route.params.procurementId = "procurement-b";
    await nextTick();
    expect(spotPageRuntime.fetchDetail).toHaveBeenCalledTimes(1);
    bindings.detail.value = submissionDetail("procurement-b");
    bindings.spotProcurementCapability.value =
      submissionDetail("procurement-b");
    bindings.actionMessage.value = "采购 B 已加载";
    bindings.actionBusy.value = true;

    try {
      pending.resolve();
      await action;

      expect(spotPageRuntime.submitProcurement).toHaveBeenCalledTimes(1);
      expect(spotPageRuntime.submitProcurement).toHaveBeenCalledWith(
        "procurement-a"
      );
      expect(spotPageRuntime.fetchDetail).toHaveBeenCalledTimes(1);
      expect(bindings.actionMessage.value).toBe("采购 B 已加载");
      expect(bindings.actionBusy.value).toBe(true);
    } finally {
      scope.stop();
    }
  });

  it("keeps busy false when the procurement submission wrapper throws before returning a promise", () => {
    spotPageRuntime.route.params.procurementId = "procurement-a";
    spotPageRuntime.submitProcurement.mockReset();
    spotPageRuntime.submitProcurement.mockImplementationOnce(() => {
      throw new Error("同步创建请求失败");
    });
    const { bindings, scope } = setupPage<ProcurementDetailPageBindings>(
      SpotProcurementDetailPage
    );
    const detail = submissionDetail("procurement-a");
    bindings.detail.value = detail;
    bindings.spotProcurementCapability.value = detail;
    bindings.actionBusy.value = false;

    try {
      expect(() => bindings.runSubmit()).toThrow("同步创建请求失败");
      expect(bindings.actionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("does not let an older same-procurement submission overwrite the latest result", async () => {
    const older = deferred();
    const latest = deferred();
    spotPageRuntime.route.params.procurementId = "procurement-a";
    spotPageRuntime.fetchDetail.mockReset();
    spotPageRuntime.fetchDetail.mockRejectedValue(
      new Error("旧请求不应刷新")
    );
    spotPageRuntime.submitProcurement.mockReset();
    spotPageRuntime.submitProcurement
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);
    const { bindings, scope } = setupPage<ProcurementDetailPageBindings>(
      SpotProcurementDetailPage
    );
    const detail = submissionDetail("procurement-a");
    bindings.detail.value = detail;
    bindings.spotProcurementCapability.value = detail;

    const olderAction = bindings.runSubmit();
    const latestAction = bindings.runSubmit();

    try {
      latest.reject(new Error("最新请求失败"));
      await latestAction;
      expect(bindings.actionMessage.value).toBe("最新请求失败");

      older.resolve();
      await olderAction;

      expect(spotPageRuntime.fetchDetail).not.toHaveBeenCalled();
      expect(bindings.actionMessage.value).toBe("最新请求失败");
      expect(bindings.actionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("drives abnormal termination only from server action keys and existing confirmation UI", () => {
    const detail = pageSource("SpotProcurementDetailPage.vue");

    expect(detail).toContain("requestSpotProcurementAbnormalTermination");
    expect(detail).toContain("confirmSpotProcurementAbnormalTermination");
    expect(detail).toContain(
      "const spotProcurementCapability = ref<SpotProcurementDetailReadModel | null>(null)"
    );
    expect(detail).toContain(
      'action.key === "request_abnormal_termination"'
    );
    expect(detail).toContain(
      'action.key === "confirm_abnormal_termination"'
    );
    expect(detail).toContain(
      'v-if="abnormalTerminationRequestAction?.enabled"'
    );
    expect(detail).toContain(
      'v-if="abnormalTerminationConfirmAction?.enabled"'
    );
    expect(detail).toContain("let detailRouteGeneration = 0");
    expect(detail).toContain("let detailLoadRequestId = 0");
    expect(detail).toContain("requestId !== detailLoadRequestId");
    expect(detail).toContain("generation !== detailRouteGeneration");
    expect(detail).toContain("procurementId.value !== expectedProcurementId");
    expect(detail).toContain("function clearDetailRouteContext()");
    expect(detail).toContain(
      "context.routeGeneration === detailRouteGeneration"
    );
    expect(detail).toContain(
      "function requireCurrentAbnormalTerminationRequestProcurementId("
    );
    expect(detail).toContain(
      "function requireCurrentAbnormalTerminationConfirmProcurementId("
    );
    expect(detail).toContain(
      "const request = requestSpotProcurementAbnormalTermination("
    );
    expect(detail).toContain(
      "requireCurrentAbnormalTerminationRequestProcurementId(context)"
    );
    expect(detail).toContain(
      "const request = confirmSpotProcurementAbnormalTermination("
    );
    expect(detail).toContain(
      "requireCurrentAbnormalTerminationConfirmProcurementId(context)"
    );
    expect(detail).toContain("<SensitiveActionDialog");
    expect(detail).toContain("abnormalTerminationRequestProcurementId.value = current.procurement.id");
    expect(detail).toContain("abnormalTerminationConfirmProcurementId.value = current.procurement.id");
    expect(detail).toContain("confirmation.procurementId = \"\"");
    expect(detail).toContain("@confirm=\"requestAbnormalTerminationAction\"");
    expect(detail).toContain("@confirm=\"confirmAbnormalTerminationAction\"");
    expect(detail).toContain(
      ".then(() => completeAbnormalTerminationRequest(context))"
    );
    expect(detail).toContain(
      ".then(() => completeAbnormalTerminationConfirm(context))"
    );
    expect(detail).not.toContain("openConfirmation('abnormal_termination_request')");
    expect(detail).not.toContain("openConfirmation('abnormal_termination_confirm')");
    expect(detail).not.toMatch(/roleKeys|finance_staff|finance_director/u);
  });

  it.each(["request", "confirm"] as const)(
    "does not let a completed abnormal-termination %s refresh, clear or message a later route",
    async (kind) => {
      const pending = deferred();
      spotPageRuntime.route.params.procurementId = "procurement-a";
      spotPageRuntime.fetchDetail.mockReset();
      spotPageRuntime.fetchDetail
        .mockReturnValueOnce(new Promise(() => undefined))
        .mockRejectedValue(new Error("stale refresh must not run"));
      spotPageRuntime.requestAbnormalTermination.mockReset();
      spotPageRuntime.confirmAbnormalTermination.mockReset();
      const mutation =
        kind === "request"
          ? spotPageRuntime.requestAbnormalTermination
          : spotPageRuntime.confirmAbnormalTermination;
      mutation.mockReturnValueOnce(pending.promise);
      const { bindings, scope } = setupPage<ProcurementDetailPageBindings>(
        SpotProcurementDetailPage
      );
      const detail = terminationDetail();
      bindings.spotProcurementCapability.value = detail;
      bindings.detail.value = detail;

      try {
        let action: Promise<unknown>;
        if (kind === "request") {
          bindings.openAbnormalTerminationRequest();
          action = bindings.requestAbnormalTerminationAction({
            reason: "付款后发现供应商无法履约"
          });
        } else {
          bindings.openAbnormalTerminationConfirm();
          action = bindings.confirmAbnormalTerminationAction();
        }

        spotPageRuntime.route.params.procurementId = "procurement-b";
        await nextTick();
        expect(spotPageRuntime.fetchDetail).toHaveBeenCalledTimes(1);
        bindings.actionMessage.value = "采购 B 已加载";
        bindings.actionBusy.value = true;
        if (kind === "request") {
          bindings.abnormalTerminationRequestVisible.value = true;
          bindings.abnormalTerminationRequestProcurementId.value =
            "procurement-b";
        } else {
          bindings.abnormalTerminationConfirmVisible.value = true;
          bindings.abnormalTerminationConfirmProcurementId.value =
            "procurement-b";
        }

        pending.resolve();
        await action;

        expect(mutation).toHaveBeenCalledWith(
          "procurement-a",
          ...(kind === "request"
            ? [{ reason: "付款后发现供应商无法履约" }]
            : [])
        );
        expect(spotPageRuntime.fetchDetail).toHaveBeenCalledTimes(1);
        expect(bindings.actionMessage.value).toBe("采购 B 已加载");
        expect(bindings.actionBusy.value).toBe(true);
        if (kind === "request") {
          expect(bindings.abnormalTerminationRequestVisible.value).toBe(true);
          expect(
            bindings.abnormalTerminationRequestProcurementId.value
          ).toBe("procurement-b");
        } else {
          expect(bindings.abnormalTerminationConfirmVisible.value).toBe(true);
          expect(
            bindings.abnormalTerminationConfirmProcurementId.value
          ).toBe("procurement-b");
        }
      } finally {
        scope.stop();
      }
    }
  );

  it.each(["request", "confirm"] as const)(
    "rejects a stale abnormal-termination %s preflight before calling the wrapper or setting busy",
    (kind) => {
      spotPageRuntime.route.params.procurementId = "procurement-a";
      spotPageRuntime.requestAbnormalTermination.mockReset();
      spotPageRuntime.confirmAbnormalTermination.mockReset();
      const mutation =
        kind === "request"
          ? spotPageRuntime.requestAbnormalTermination
          : spotPageRuntime.confirmAbnormalTermination;
      const { bindings, scope } = setupPage<ProcurementDetailPageBindings>(
        SpotProcurementDetailPage
      );
      bindings.actionBusy.value = false;
      if (kind === "request") {
        bindings.abnormalTerminationRequestProcurementId.value =
          "procurement-stale";
      } else {
        bindings.abnormalTerminationConfirmProcurementId.value =
          "procurement-stale";
      }

      try {
        expect(() =>
          kind === "request"
            ? bindings.requestAbnormalTerminationAction({
                reason: "付款后发现供应商无法履约"
              })
            : bindings.confirmAbnormalTerminationAction()
        ).toThrow("异常终止操作上下文已失效");
        expect(mutation).not.toHaveBeenCalled();
        expect(bindings.actionBusy.value).toBe(false);
      } finally {
        scope.stop();
      }
    }
  );

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
