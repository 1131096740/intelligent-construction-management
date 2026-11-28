import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FileService } from "../file/file.service";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { SpotProcurementReceiptService } from "./spot-procurement-receipt.service";
import { SpotProcurementReceiptReviewNotificationService } from "./spot-procurement-receipt-review-notification.service";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import { createApiValidationPipe } from "../validation/api-validation";
import { ResetSpotProcurementReceiptDto } from "./dto/reset-spot-procurement-receipt.dto";
import { SpotProcurementReceiptController } from "./spot-procurement-receipt.controller";
import { SpotProcurementController } from "./spot-procurement.controller";
import { SpotProcurementSettlementService } from "./spot-procurement-settlement.service";

describe("SpotProcurementReceiptController", () => {
  it("exposes receipt SMS status and retry only under the receipt review role",async()=>{
    const status=SpotProcurementReceiptController.prototype.dutySmsStatus;
    const retry=SpotProcurementReceiptController.prototype.retryDutySms;
    expect(Reflect.getMetadata(PATH_METADATA,status)).toBe(":procurementId/receipt/duty-sms");
    expect(Reflect.getMetadata(METHOD_METADATA,status)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA,retry)).toBe(":procurementId/receipt/duty-sms/retry");
    expect(Reflect.getMetadata(METHOD_METADATA,retry)).toBe(RequestMethod.POST);
    for(const method of [status,retry])expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY,method)).toBe("spot_procurement.receipt.review");
    await expect(createApiValidationPipe().transform({attemptId:"unrecognized"},
      {type:"body",metatype:RetryDutyNotificationDto})).rejects.toMatchObject({status:400});
  });
  it("forwards the authenticated actor and exact revision CAS to receipt reset", async () => {
    const receipts = {
      resetDraft: jest.fn().mockResolvedValue({
        receiptId: "receipt-1",
        currentRevisionNo: 4,
        reset: true
      })
    };
    const controller = new SpotProcurementReceiptController(
      receipts as never
    );

    await expect(
      controller.resetDraft(
        "procurement-1",
        { id: "handler-1" } as never,
        { expectedRevision: 3 }
      )
    ).resolves.toMatchObject({
      currentRevisionNo: 4,
      reset: true
    });
    expect(receipts.resetDraft).toHaveBeenCalledWith(
      "procurement-1",
      "handler-1",
      { expectedRevision: 3 }
    );
  });

  it("rejects missing, stale-shaped, or unknown receipt reset fields", async () => {
    const pipe = createApiValidationPipe();

    await expect(
      pipe.transform(
        { expectedRevision: 0, status: "draft" },
        {
          type: "body",
          metatype: ResetSpotProcurementReceiptDto,
          data: ""
        }
      )
    ).rejects.toMatchObject({
      response: {
        errors: expect.arrayContaining([
          "收货修订号不正确，请刷新后重试",
          "status 不是允许提交的字段"
        ])
      }
    });
  });
});

describe("retired spot procurement receipt HTTP", () => {
  const receipts = {
    getReceipt: jest.fn().mockResolvedValue({ receipt: { id: "historical-receipt" }, photos: [], reviews: [] }),
    createDelegation: jest.fn(),
    assertActionAvailable: jest.fn(),
    updateDraft: jest.fn(),
    resetDraft: jest.fn(),
    attachPhoto: jest.fn(),
    deleteDraftPhoto: jest.fn(),
    submit: jest.fn(),
    review: jest.fn(),
    revokeReview: jest.fn(),
    retryFormalPdf: jest.fn().mockResolvedValue({ fileId: "historical-pdf" })
  };
  const notifications = { retry: jest.fn() };
  const settlements = { createOrConfirmDiscrepancy: jest.fn().mockResolvedValue({ status: "awaiting_refund" }) };
  const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "private-file" }) };
  let app: INestApplication;
  let baseUrl: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SpotProcurementReceiptController, SpotProcurementController],
      providers: [
        { provide: SpotProcurementReceiptService, useValue: receipts },
        { provide: SpotProcurementReceiptReviewNotificationService, useValue: notifications },
        { provide: FileService, useValue: files },
        { provide: SpotProcurementSettlementService, useValue: settlements }
      ]
    }).useMocker(() => ({})).compile();
    app = module.createNestApplication();
    app.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => {
      request.user = { id: "historical-actor" };
      next();
    });
    app.useGlobalGuards(new RetiredWriteEntryGuard());
    await app.listen(0, "127.0.0.1");
    baseUrl = `${await app.getUrl()}/spot-procurements/historical-procurement`;
  });

  afterAll(async () => { await app?.close(); });

  it.each([
    ["POST", "/receipt/delegations", receipts.createDelegation],
    ["POST", "/receipt-photo-file-uploads", receipts.assertActionAvailable],
    ["PATCH", "/receipt/draft", receipts.updateDraft],
    ["POST", "/receipt/draft-reset", receipts.resetDraft],
    ["POST", "/receipt/photos", receipts.attachPhoto],
    ["DELETE", "/receipt/photos/historical-photo", receipts.deleteDraftPhoto],
    ["POST", "/receipt/submission", receipts.submit],
    ["POST", "/receipt/review", receipts.review],
    ["POST", "/receipt/review-revocation", receipts.revokeReview],
    ["POST", "/receipt/duty-sms/retry", notifications.retry]
  ])("returns 410 for %s %s before executing the retired write", async (method, path, handler) => {
    handler.mockClear();
    const response = await fetch(`${baseUrl}${path}`, { method });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "OLD_WRITE_ENTRY_RETIRED" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("retires new discrepancies and keeps confirmation of an existing historical discrepancy", async () => {
    const writeDiscrepancy = (operation: string) => fetch(`${baseUrl}/discrepancy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation })
    });
    const retired = await writeDiscrepancy("initiate");
    expect(retired.status).toBe(410);
    expect(await retired.json()).toMatchObject({ code: "OLD_WRITE_ENTRY_RETIRED" });
    expect(settlements.createOrConfirmDiscrepancy).not.toHaveBeenCalled();

    const retained = await writeDiscrepancy("confirm");
    expect(retained.status).toBe(201);
    expect(await retained.json()).toEqual({ status: "awaiting_refund" });
    expect(settlements.createOrConfirmDiscrepancy).toHaveBeenCalledWith(
      "historical-procurement", "historical-actor", { operation: "confirm" }
    );
  });

  it("preserves historical reads and recovery of an approved historical PDF", async () => {
    const detail = await fetch(`${baseUrl}/receipt`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ receipt: { id: "historical-receipt" } });

    const refresh = await fetch(`${baseUrl}/receipt/pdf-refresh`, { method: "POST" });
    expect(refresh.status).toBe(201);
    expect(await refresh.json()).toEqual({ fileId: "historical-pdf" });
  });

  it.each([
    ["/refund-voucher-file-uploads", "record_refund"],
    ["/invoice-file-uploads", "append_invoice"]
  ])("preserves shared private upload %s", async (path, action) => {
    const form = new FormData();
    form.append("file", new Blob(["synthetic"], { type: "application/pdf" }), "fixture.pdf");
    const response = await fetch(`${baseUrl}${path}`, { method: "POST", body: form });
    expect(response.status).toBe(201);
    expect(receipts.assertActionAvailable).toHaveBeenCalledWith("historical-procurement", "historical-actor", action);
    expect(await response.json()).toEqual({ id: "private-file" });
  });
});
