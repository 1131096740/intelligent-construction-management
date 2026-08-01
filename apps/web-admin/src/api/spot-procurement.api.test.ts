import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { apiFetch } from "./api-fetch";
import {
  appendSpotProcurementPaymentInvoice,
  abandonSpotProcurementDraft,
  abandonSpotProcurementPaymentDraft,
  confirmSpotProcurementAbnormalTermination,
  createSpotProcurementDiscrepancy,
  createSpotProcurementDraft,
  fetchSpotProcurementCreateProjectOptions,
  fetchSpotProcurementApplicationTextSuggestions,
  createSpotProcurementPaymentDraft,
  createSpotProcurementVersion,
  executeSpotProcurementPaymentReviewAction,
  executeSpotProcurementReviewAction,
  prepareSpotProcurementPaymentReviewAction,
  prepareSpotProcurementReviewAction,
  fetchSpotProcurementCapabilities,
  fetchSpotProcurementDetail,
  fetchSpotProcurementPaymentDetail,
  fetchSpotProcurementReceipt,
  fetchSpotProcurementPayments,
  fetchSpotProcurements,
  fetchVatRateOptions,
  recordSpotProcurementPaymentExecution,
  recordSpotProcurementRefund,
  recreateSpotProcurementPaymentDraft,
  refreshSpotProcurementReceiptPdf,
  requestSpotProcurementAbnormalTermination,
  resetSpotProcurementReceiptDraft,
  submitSpotProcurementReceipt,
  submitSpotProcurement,
  submitSpotProcurementPayment,
  updateSpotProcurementDraft,
  updateSpotProcurementPaymentDraft,
  updateSpotProcurementPaymentPayer,
  invalidateSpotProcurementPaymentInvoice,
  voidSpotProcurement,
  voidSpotProcurementPayment,
  withdrawSpotProcurementPayment,
  type CreateSpotProcurementDraftPayload,
  type PrepareSpotProcurementPaymentReviewActionInput,
  type PrepareSpotProcurementReviewActionInput,
  type RecordSpotProcurementPaymentExecutionPayload,
  type ReviewSpotProcurementPaymentPayload
} from "./spot-procurement.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

const mockApiFetch = vi.mocked(apiFetch);

describe("spot procurement API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
    mockApiFetch.mockImplementation(async () => jsonResponse({ id: "ok" }));
  });

  it("reads capabilities and the controlled VAT-rate dictionary", async () => {
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse({ enabled: true }))
      .mockResolvedValueOnce(
        jsonResponse([
          { id: "vat-3", label: "3%", rateValue: "0.03", enabled: true }
        ])
      );

    await fetchSpotProcurementCapabilities("project/1");
    await expect(fetchVatRateOptions()).resolves.toEqual([
      { id: "vat-3", label: "3%", rateValue: "0.03", isEnabled: true }
    ]);

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/capabilities?projectId=project%2F1",
      "/vat-rate-options"
    ]);
  });

  it("reads only the current user's zero-procurement creation projects", async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse([{ id: "project-1", code: "XM-001", name: "一号项目" }])
    );

    await expect(fetchSpotProcurementCreateProjectOptions()).resolves.toEqual([
      { id: "project-1", code: "XM-001", name: "一号项目" }
    ]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/spot-procurements/create-project-options"
    );
  });

  it("reads the procurement list and detail with encoded query and resource ids", async () => {
    await fetchSpotProcurements({
      projectId: "project/1",
      status: "approval_pending",
      keyword: " 水泥/砖 ",
      view: "active",
      surface: "receipt",
      page: 2,
      pageSize: 20
    });
    await fetchSpotProcurementDetail("procurement/1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements?projectId=project%2F1&status=approval_pending&keyword=%E6%B0%B4%E6%B3%A5%2F%E7%A0%96&view=active&surface=receipt&page=2&pageSize=20",
      "/spot-procurements/procurement%2F1"
    ]);
  });

  it("reads the payment list and detail without adding empty filters", async () => {
    await fetchSpotProcurementPayments({
      projectId: "project/1",
      status: "approved_pending_payment",
      keyword: "  ",
      view: "closed"
    });
    await fetchSpotProcurementPaymentDetail("payment/1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurement-payments?projectId=project%2F1&status=approved_pending_payment&view=closed",
      "/spot-procurement-payments/payment%2F1"
    ]);
  });

  it("passes the server-owned payment workbench view while keeping omission compatible", async () => {
    await fetchSpotProcurementPayments({ view: "all" });
    await fetchSpotProcurementPayments();

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurement-payments?view=all",
      "/spot-procurement-payments"
    ]);
  });

  it("connects the final receipt read and submission routes", async () => {
    await fetchSpotProcurementReceipt("procurement/1");
    await submitSpotProcurementReceipt("procurement/1");
    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/procurement%2F1/receipt",
      "/spot-procurements/procurement%2F1/receipt/submission"
    ]);
  });

  it("connects semantic procurement, payment draft and receipt lifecycle routes with CAS", async () => {
    await abandonSpotProcurementDraft("procurement/1", {
      action: "abandon_application",
      reason: "现场需求取消"
    });
    await abandonSpotProcurementPaymentDraft("payment/1", {
      expectedUpdatedAt: "2026-07-19T10:00:00.000Z",
      reason: "付款对象需要重新确认"
    });
    await recreateSpotProcurementPaymentDraft("procurement/1");
    await resetSpotProcurementReceiptDraft("procurement/1", 3);

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/procurement%2F1/abandonment",
      "/spot-procurement-payments/payment%2F1/abandonment",
      "/spot-procurements/procurement%2F1/payment-drafts",
      "/spot-procurements/procurement%2F1/receipt/draft-reset"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ action: "abandon_application", reason: "现场需求取消" }),
      JSON.stringify({
        expectedUpdatedAt: "2026-07-19T10:00:00.000Z",
        reason: "付款对象需要重新确认"
      }),
      JSON.stringify({}),
      JSON.stringify({ expectedRevision: 3 })
    ]);
  });

  it("uses only replenishment or refund for real-form shortage handling and appends a payment-level invoice", async () => {
    const refund = {
      amountCents: "1200",
      receivedAt: "2026-07-18",
      refundMethod: "bank_transfer" as const,
      voucherFileId: "refund-voucher-1",
      idempotencyKey: "refund-1"
    };

    await createSpotProcurementDiscrepancy("procurement/1", {
      operation: "initiate",
      resolutionType: "replenishment",
      note: "商户承诺补货"
    });
    await recordSpotProcurementRefund("procurement/1", refund);
    await appendSpotProcurementPaymentInvoice("payment/1", "invoice-file-1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/procurement%2F1/discrepancy",
      "/spot-procurements/procurement%2F1/refunds",
      "/spot-procurement-payments/payment%2F1/invoices"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({
        operation: "initiate",
        resolutionType: "replenishment",
        note: "商户承诺补货"
      }),
      JSON.stringify(refund),
      JSON.stringify({ fileId: "invoice-file-1" })
    ]);
  });

  it("connects the four retained zero-procurement actions with encoded ids and exact confirmation bodies", async () => {
    await invalidateSpotProcurementPaymentInvoice(
      "payment/1",
      "invoice/1",
      { reason: "附件重复上传" }
    );
    await requestSpotProcurementAbnormalTermination("procurement/1", {
      reason: "已付款但商户无法继续履约"
    });
    await confirmSpotProcurementAbnormalTermination("procurement/1");
    await refreshSpotProcurementReceiptPdf("procurement/1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurement-payments/payment%2F1/invoices/invoice%2F1/invalidation",
      "/spot-procurements/procurement%2F1/abnormal-termination",
      "/spot-procurements/procurement%2F1/abnormal-termination/confirmation",
      "/spot-procurements/procurement%2F1/receipt/pdf-refresh"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ reason: "附件重复上传" }),
      JSON.stringify({ reason: "已付款但商户无法继续履约" }),
      JSON.stringify({ confirmTermination: true }),
      JSON.stringify({})
    ]);
  });

  it("reads bounded application text suggestions within a project", async () => {
    await fetchSpotProcurementApplicationTextSuggestions("project/1", "工程部");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements/application-text-suggestions?projectId=project%2F1&keyword=%E5%B7%A5%E7%A8%8B%E9%83%A8"
    ]);
  });

  it("connects every procurement write route and preserves the JSON body", async () => {
    const draft: CreateSpotProcurementDraftPayload = {
      projectId: "project-1",
      applicationDepartment: "工程部",
      applicationName: "杨帅",
      requestedArrivalAt: "2026-07-18",
      reason: "现场临时补料",
      note: "当日送达",
      lines: [
        {
          materialName: "免烧砖",
          specification: "240x115x53",
          unit: "块",
          quantity: "1000",
          note: "免烧砖"
        }
      ],
      attachments: [{ fileId: "quote-1", category: "merchant_quote" }],
    };

    await createSpotProcurementDraft(draft);
    await updateSpotProcurementDraft("procurement/1", draft);
    await createSpotProcurementVersion("procurement/1", {
      ...draft,
      changeReason: "修改使用部位"
    });
    await submitSpotProcurement("procurement/1");
    await voidSpotProcurement("procurement/1", { reason: "现场取消需求" });
    await createSpotProcurementPaymentDraft("procurement/1");

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurements",
      "/spot-procurements/procurement%2F1/draft",
      "/spot-procurements/procurement%2F1/versions",
      "/spot-procurements/procurement%2F1/submission",
      "/spot-procurements/procurement%2F1/voiding",
      "/spot-procurements/procurement%2F1/payments"
    ]);
    expect(mockApiFetch.mock.calls.map(([, init]) => init?.method)).toEqual([
      "POST",
      "PATCH",
      "POST",
      "POST",
      "POST",
      "POST"
    ]);
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/spot-procurements",
      expect.objectContaining({ body: JSON.stringify(draft) })
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      3,
      "/spot-procurements/procurement%2F1/versions",
      expect.objectContaining({
        body: JSON.stringify({ ...draft, changeReason: "修改使用部位" })
      })
    );
    expect(mockApiFetch.mock.calls[3]?.[1]?.body).toBe("{}");
    expect(mockApiFetch.mock.calls[5]?.[1]?.body).toBe("{}");
  });

  it.each([
    ["missing action", reviewDetail({ availableActions: [] })],
    [
      "disabled action",
      reviewDetail({
        availableActions: [
          {
            key: "review_approval",
            label: "审批",
            kind: "primary",
            enabled: false,
            disabledReason: "当前不可审批",
            requiredRoles: []
          }
        ]
      })
    ],
    [
      "missing approval coordinates",
      reviewDetail({ reviewApprovalContext: null })
    ],
    [
      "procurement drift",
      reviewDetail({ procurementId: "procurement-b" })
    ],
    [
      "version drift",
      reviewDetail({ expectedVersionId: "version-b" })
    ],
    [
      "approval drift",
      reviewDetail({ expectedApprovalInstanceId: "approval-b" })
    ],
    [
      "node drift",
      reviewDetail({ expectedNodeIndex: 2 })
    ]
  ])(
    "refuses a %s review preflight before the approval POST",
    async (_label, preflight) => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse(preflight));

      await expect(
        prepareSpotProcurementReviewAction(
          reviewActionInput({ decision: "approve" })
        )
      ).rejects.toThrow();

      expect(mockApiFetch).toHaveBeenCalledTimes(1);
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/spot-procurements/procurement-a"
      );
    }
  );

  it("freezes the trimmed reject comment while performing only the fresh GET", async () => {
    const preflight = deferred<Response>();
    mockApiFetch.mockReturnValueOnce(preflight.promise);
    const input = reviewActionInput({
      decision: "reject",
      comment: "  报价依据不足  "
    });

    const request = prepareSpotProcurementReviewAction(input);
    input.comment = "被调用方随后篡改";
    preflight.resolve(jsonResponse(reviewDetail()));
    await expect(request).resolves.toEqual(
      expect.objectContaining({
        status: "ready",
        context: expect.objectContaining({
          decision: "reject",
          comment: "报价依据不足",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        })
      })
    );

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/spot-procurements/procurement-a"
    );
  });

  it("freezes and submits return-to-applicant through the same fresh-preflight owner", async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(reviewDetail()));
    const input = reviewActionInput({
      decision: "return_to_applicant",
      comment: "  请补充报价依据  "
    });

    const prepared = await prepareSpotProcurementReviewAction(input);
    expect(prepared).toEqual(
      expect.objectContaining({
        status: "ready",
        context: expect.objectContaining({
          decision: "return_to_applicant",
          comment: "请补充报价依据",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        })
      })
    );

    if (prepared.status !== "ready") {
      throw new Error("return-to-applicant preflight did not become ready");
    }
    mockApiFetch.mockClear();
    await executeSpotProcurementReviewAction({
      decision: "return_to_applicant",
      capture: () => prepared.context,
      preflight: async () => prepared,
      current: () => true,
      complete: vi.fn(),
      fail: vi.fn(),
      finish: vi.fn()
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/spot-procurements/procurement-a/approval",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          decision: "return_to_applicant",
          comment: "请补充报价依据",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        })
      })
    );
  });

  it("prepares approve before the POST-only orchestration without borrowing a comment", async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(reviewDetail()));

    const prepared = await prepareSpotProcurementReviewAction(
      reviewActionInput({
        decision: "approve",
        comment: "该字段不得进入通过 DTO"
      })
    );
    expect(prepared).toEqual(
      expect.objectContaining({
        status: "ready",
        context: expect.not.objectContaining({
          comment: expect.anything()
        })
      })
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    if (prepared.status !== "ready") {
      throw new Error("approve preflight did not become ready");
    }
    mockApiFetch.mockClear();
    const complete = vi.fn();
    const fail = vi.fn();
    const finish = vi.fn();
    await expect(
      executeSpotProcurementReviewAction({
        decision: "approve",
        capture: () => prepared.context,
        preflight: async () => prepared,
        current: () => true,
        complete,
        fail,
        finish
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: "completed",
        context: prepared.context
      })
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/spot-procurements/procurement-a/approval",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          decision: "approve",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        })
      })
    );
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(prepared.context);
  });

  it("does not POST when the owning page becomes stale while fresh detail is loading", async () => {
    const preflight = deferred<Response>();
    let current = true;
    mockApiFetch.mockReturnValueOnce(preflight.promise);
    const input = reviewActionInput({
      decision: "approve",
      isCurrent: () => current
    });
    const complete = vi.fn();
    const fail = vi.fn();
    const finish = vi.fn();
    const request = executeSpotProcurementReviewAction({
      decision: "approve",
      capture: () => input,
      preflight: () => prepareSpotProcurementReviewAction(input),
      current: (_context, prepared) => prepared.status === "ready",
      complete,
      fail,
      finish
    });

    current = false;
    preflight.resolve(jsonResponse(reviewDetail()));

    await expect(request).resolves.toEqual(
      expect.objectContaining({ status: "stale" })
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(input);
  });

  it.each([
    ["real_payment", "approve", undefined],
    ["legacy", "return_to_applicant", "请补充付款依据"]
  ] as const)(
    "preflights and submits the %s payment %s action through one canonical executor",
    async (paymentForm, decision, comment) => {
      mockApiFetch
        .mockResolvedValueOnce(
          jsonResponse(paymentReviewDetail({ paymentForm }))
        )
        .mockResolvedValueOnce(
          jsonResponse({
            id: "payment-a",
            status: "approval_pending",
            ...(decision === "return_to_applicant"
              ? { newDraftPaymentId: "payment-draft-b" }
              : {})
          })
        );
      const input = paymentReviewActionInput({
        paymentForm,
        decision,
        ...(comment ? { comment } : {})
      });
      const complete = vi.fn();
      const fail = vi.fn();
      const finish = vi.fn();

      await expect(
        executeSpotProcurementPaymentReviewAction({
          decision,
          capture: () => input,
          preflight: (context) =>
            prepareSpotProcurementPaymentReviewAction({
              ...context,
              decision,
              isCurrent: () => true
            }),
          current: (_context, prepared) => prepared.status === "ready",
          complete,
          fail,
          finish
        })
      ).resolves.toEqual(
        expect.objectContaining({ status: "completed" })
      );

      expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
        "/spot-procurement-payments/payment-a",
        "/spot-procurement-payments/payment-a/approval"
      ]);
      expect(mockApiFetch.mock.calls[1]?.[1]).toEqual(
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            decision,
            ...(comment ? { comment } : {})
          })
        })
      );
      expect(complete).toHaveBeenCalledOnce();
      expect(fail).not.toHaveBeenCalled();
      expect(finish).toHaveBeenCalledOnce();
    }
  );

  it("preserves the finance-director legacy balance adjustment through preflight and POST", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        jsonResponse(
          paymentReviewDetail({
            paymentForm: "legacy",
            currentRoleKeys: ["finance_director"],
            supplierBalanceAmountCents: "3000"
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "payment-a",
          status: "returned",
          newDraftPaymentId: "payment-draft-b"
        })
      );
    const input = {
      ...paymentReviewActionInput({
        paymentForm: "legacy",
        decision: "return_to_applicant",
        comment: "余额改为 20 元"
      }),
      requiresLegacySupplierBalanceAdjustment: true,
      adjustedSupplierBalanceAmountCents: "2000"
    } as PrepareSpotProcurementPaymentReviewActionInput;

    const result = await executeSpotProcurementPaymentReviewAction({
      decision: "return_to_applicant",
      capture: () => input,
      preflight: (context) =>
        prepareSpotProcurementPaymentReviewAction({
          ...context,
          decision: "return_to_applicant",
          isCurrent: () => true
        }),
      current: (_context, prepared) => prepared.status === "ready",
      complete: vi.fn(),
      fail: vi.fn(),
      finish: vi.fn()
    });

    expect(result.status).toBe("completed");
    expect(mockApiFetch.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          decision: "return_to_applicant",
          comment: "余额改为 20 元",
          adjustedSupplierBalanceAmountCents: "2000"
        })
      })
    );
  });

  it("rejects a legacy balance-adjustment field on the real A5 form before any request", async () => {
    const input = {
      ...paymentReviewActionInput({
        paymentForm: "real_payment",
        decision: "return_to_applicant",
        comment: "退回补充"
      }),
      requiresLegacySupplierBalanceAdjustment: false,
      adjustedSupplierBalanceAmountCents: "0"
    } as PrepareSpotProcurementPaymentReviewActionInput;

    await expect(
      prepareSpotProcurementPaymentReviewAction(input)
    ).rejects.toThrow();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("refuses a stale legacy finance adjustment when the latest server node is not finance director", async () => {
    mockApiFetch.mockResolvedValueOnce(
      jsonResponse(
        paymentReviewDetail({
          paymentForm: "legacy",
          currentRoleKeys: ["project_manager"]
        })
      )
    );
    const input = {
      ...paymentReviewActionInput({
        paymentForm: "legacy",
        decision: "return_to_applicant",
        comment: "调整余额后退回"
      }),
      requiresLegacySupplierBalanceAdjustment: true,
      adjustedSupplierBalanceAmountCents: "2000"
    } as PrepareSpotProcurementPaymentReviewActionInput;

    await expect(
      prepareSpotProcurementPaymentReviewAction(input)
    ).rejects.toThrow();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("requires a distinct self-review reason for legacy approve before any request", async () => {
    const input = paymentReviewActionInput({
      paymentForm: "legacy",
      decision: "approve",
      requiresSelfReviewConfirmation: true,
      selfReviewReason: "",
      confirmationPassword: "correct-password"
    });

    await expect(
      prepareSpotProcurementPaymentReviewAction(input)
    ).rejects.toThrow();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("fails closed when a return response does not identify the new draft", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        jsonResponse(
          paymentReviewDetail({
            paymentForm: "legacy",
            currentRoleKeys: ["project_manager"]
          })
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "payment-a", status: "returned" })
      );
    const input = paymentReviewActionInput({
      paymentForm: "legacy",
      decision: "return_to_applicant",
      comment: "请补充依据"
    });
    const complete = vi.fn();
    const fail = vi.fn();

    const result = await executeSpotProcurementPaymentReviewAction({
      decision: "return_to_applicant",
      capture: () => input,
      preflight: (context) =>
        prepareSpotProcurementPaymentReviewAction({
          ...context,
          decision: "return_to_applicant",
          isCurrent: () => true
        }),
      current: (_context, prepared) => prepared.status === "ready",
      complete,
      fail,
      finish: vi.fn()
    });

    expect(result.status).toBe("failed");
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
  });

  it("does not POST a payment review after its current owner is invalidated during preflight", async () => {
    const preflight = deferred<Response>();
    let current = true;
    mockApiFetch.mockReturnValueOnce(preflight.promise);
    const input = paymentReviewActionInput({
      decision: "approve",
      isCurrent: () => current
    });

    const request = executeSpotProcurementPaymentReviewAction({
      decision: "approve",
      capture: () => input,
      preflight: (context) =>
        prepareSpotProcurementPaymentReviewAction({
          ...context,
          decision: "approve",
          isCurrent: () => current
        }),
      current: (_context, prepared) => prepared.status === "ready",
      complete: vi.fn(),
      fail: vi.fn(),
      finish: vi.fn()
    });

    current = false;
    preflight.resolve(jsonResponse(paymentReviewDetail()));

    await expect(request).resolves.toEqual(
      expect.objectContaining({ status: "stale" })
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/spot-procurement-payments/payment-a"
    );
  });

  it.each([
    ["missing action", paymentReviewDetail({ availableActions: [] })],
    [
      "disabled action",
      paymentReviewDetail({
        availableActions: [paymentReviewAction({ enabled: false })]
      })
    ],
    [
      "payment drift",
      paymentReviewDetail({ paymentId: "payment-b" })
    ],
    [
      "form drift",
      paymentReviewDetail({ paymentForm: "legacy" })
    ]
  ])(
    "refuses a %s payment review preflight before POST",
    async (_label, preflight) => {
      mockApiFetch.mockResolvedValueOnce(jsonResponse(preflight));

      await expect(
        prepareSpotProcurementPaymentReviewAction(
          paymentReviewActionInput({ paymentForm: "real_payment" })
        )
      ).rejects.toThrow();

      expect(mockApiFetch).toHaveBeenCalledTimes(1);
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/spot-procurement-payments/payment-a"
      );
    }
  );

  it("connects A5 payment facts, payer controls and review safeguards", async () => {
    const draft = {
      paymentType: "company_direct" as const,
      merchantName: "朝阳建材",
      payeeName: "朝阳建材",
      paymentLines: [{ procurementLineId: "line-1", paymentQuantity: "100", unitPrice: "4.00", expectedInvoiceCondition: "vat_general" as const, vatRatePercent: "13" }],
      channels: [{ channelType: "bank_transfer" as const, accountName: "朝阳建材", accountNumber: "6222000012345678", bankName: "建设银行", isPrimary: true }],
      paymentMethods: ["bank_transfer" as const],
      attachments: [{ fileId: "quote-1", category: "merchant_quote" as const }]
    };
    await updateSpotProcurementPaymentDraft("payment/1", draft);
    await updateSpotProcurementPaymentPayer("payment/1", {
      companyEntityId: "company-1",
      paymentMethods: ["bank_transfer"],
      changeReason: "付款主体调整"
    });
    await submitSpotProcurementPayment("payment/1");
    await withdrawSpotProcurementPayment("payment/1");
    await voidSpotProcurementPayment("payment/1", { reason: "重新发起" });

    expect(mockApiFetch.mock.calls.map(([path]) => path)).toEqual([
      "/spot-procurement-payments/payment%2F1/draft",
      "/spot-procurement-payments/payment%2F1/payer",
      "/spot-procurement-payments/payment%2F1/submission",
      "/spot-procurement-payments/payment%2F1/approval-withdrawal",
      "/spot-procurement-payments/payment%2F1/voiding"
    ]);
    expect(mockApiFetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(draft) })
    );
    expect(mockApiFetch.mock.calls[4]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ reason: "重新发起" })
      })
    );
  });

  it("exposes one neutral payment review action contract that excludes reject", async () => {
    const module = await import("./spot-procurement.api");
    expect(module).not.toHaveProperty("reviewSpotProcurementPayment");
    expect(module).not.toHaveProperty("reviewSpotProcurementA5Payment");
    expectTypeOf<
      ReviewSpotProcurementPaymentPayload["decision"]
    >().toEqualTypeOf<"approve" | "return_to_applicant">();
    expect(module).toHaveProperty(
      "executeSpotProcurementPaymentReviewAction"
    );
  });

  it("reuses the caller-provided execution idempotency key across retries", async () => {
    const execution: RecordSpotProcurementPaymentExecutionPayload = {
      amountCents: "50000",
      paidAt: "2026-07-17T08:00:00.000Z",
      paymentMethod: "bank_transfer",
      voucherFileId: "voucher-1",
      idempotencyKey: "payment-1:execution-attempt-1",
      confirmationPassword: "correct-password"
    };

    await recordSpotProcurementPaymentExecution("payment/1", execution);
    await recordSpotProcurementPaymentExecution("payment/1", execution);

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    for (const [, init] of mockApiFetch.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(execution)
        })
      );
    }
  });

  it("surfaces server validation messages and masks technical failures", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        jsonResponse({ message: ["请填写供应商名称", "请至少填写一条采购明细"] }, 400)
      )
      .mockResolvedValueOnce(
        jsonResponse({ message: "Internal server error" }, 500)
      );

    await expect(createSpotProcurementDraft({} as CreateSpotProcurementDraftPayload)).rejects.toThrow(
      "请填写供应商名称；请至少填写一条采购明细"
    );
    await expect(fetchSpotProcurementDetail("procurement-1")).rejects.toThrow(
      "系统暂时无法完成操作，请稍后重试或联系管理员。"
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function reviewDetail(
  overrides: {
    procurementId?: string;
    expectedVersionId?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    reviewApprovalContext?: null;
    availableActions?: Array<Record<string, unknown>>;
  } = {}
) {
  return {
    procurement: {
      id: overrides.procurementId ?? "procurement-a"
    },
    currentVersion: {
      id: overrides.expectedVersionId ?? "version-a"
    },
    reviewApprovalContext:
      overrides.reviewApprovalContext === null
        ? null
        : {
            expectedVersionId:
              overrides.expectedVersionId ?? "version-a",
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ?? "approval-a",
            expectedNodeIndex: overrides.expectedNodeIndex ?? 1
          },
    availableActions:
      overrides.availableActions ??
      [
        {
          key: "review_approval",
          label: "审批",
          kind: "primary",
          enabled: true,
          disabledReason: null,
          requiredRoles: []
        }
      ]
  };
}

function reviewActionInput(
  overrides: Partial<PrepareSpotProcurementReviewActionInput> = {}
): PrepareSpotProcurementReviewActionInput {
  return {
    ownerScope: "page-a",
    routeGeneration: 2,
    detailEpoch: 3,
    dialogGeneration: 4,
    operationId: 5,
    procurementId: "procurement-a",
    expectedVersionId: "version-a",
    expectedApprovalInstanceId: "approval-a",
    expectedNodeIndex: 1,
    decision: "approve",
    comment: "",
    isCurrent: () => true,
    ...overrides
  };
}

function paymentReviewAction(
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    key: "review_approval",
    label: "审批",
    kind: "primary",
    enabled: true,
    disabledReason: null,
    requiredRoles: [],
    requiresSelfReviewConfirmation: false,
    ...overrides
  };
}

function paymentReviewDetail(
  overrides: {
    paymentId?: string;
    paymentForm?: "real_payment" | "legacy";
    availableActions?: Array<Record<string, unknown>>;
    currentRoleKeys?: string[];
    supplierBalanceAmountCents?: string;
  } = {}
) {
  return {
    payment: {
      id: overrides.paymentId ?? "payment-a",
      form: overrides.paymentForm ?? "real_payment",
      supplierBalanceAmountCents:
        overrides.supplierBalanceAmountCents ?? "3000"
    },
    approval: {
      currentRoleKeys: overrides.currentRoleKeys ?? ["project_manager"]
    },
    availableActions:
      overrides.availableActions ?? [paymentReviewAction()]
  };
}

function paymentReviewActionInput(
  overrides: Partial<PrepareSpotProcurementPaymentReviewActionInput> = {}
): PrepareSpotProcurementPaymentReviewActionInput {
  return {
    ownerScope: "payment-page-a",
    routeGeneration: 2,
    detailEpoch: 3,
    dialogGeneration: 4,
    operationId: 5,
    paymentId: "payment-a",
    paymentForm: "real_payment",
    decision: "approve",
    comment: "",
    requiresSelfReviewConfirmation: false,
    requiresLegacySupplierBalanceAdjustment: false,
    isCurrent: () => true,
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}
