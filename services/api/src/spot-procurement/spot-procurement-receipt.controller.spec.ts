import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { RetryDutyNotificationDto } from "../approval/retry-duty-notification.dto";
import { createApiValidationPipe } from "../validation/api-validation";
import { ResetSpotProcurementReceiptDto } from "./dto/reset-spot-procurement-receipt.dto";
import { SpotProcurementReceiptController } from "./spot-procurement-receipt.controller";

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
