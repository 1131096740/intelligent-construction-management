import "reflect-metadata";
import { PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { SpotProcurementPaymentController } from "./spot-procurement-payment.controller";
import { SpotProcurementReceiptController } from "./spot-procurement-receipt.controller";
import { SpotProcurementController } from "./spot-procurement.controller";

const file = {
  originalname: "付款凭证.png",
  mimetype: "image/png",
  size: 3,
  buffer: Buffer.from("png")
};
const actor = { id: "user-1" } as never;

describe("spot procurement business file upload controllers", () => {
  it("checks project create capability before storing a create attachment", async () => {
    const order: string[] = [];
    const reads = {
      assertCreateActionAvailable: jest.fn(async () => order.push("capability"))
    };
    const files = {
      uploadPrivateFile: jest.fn(async () => {
        order.push("storage");
        return { id: "file-1" };
      })
    };
    const controller = new SpotProcurementController(
      {} as never,
      reads as never,
      {} as never,
      {} as never,
      files as never
    );

    await expect(
      controller.uploadCreateDraftFile("project-1", file, actor, "key-1")
    ).resolves.toEqual({ id: "file-1" });
    expect(order).toEqual(["capability", "storage"]);
    expect(reads.assertCreateActionAvailable).toHaveBeenCalledWith(
      "user-1",
      "project-1"
    );
  });

  it("checks exact procurement edit capability before storing a draft attachment", async () => {
    const order: string[] = [];
    const reads = {
      assertProcurementActionAvailable: jest.fn(async () =>
        order.push("capability")
      )
    };
    const files = {
      uploadPrivateFile: jest.fn(async () => {
        order.push("storage");
        return { id: "file-2" };
      })
    };
    const controller = new SpotProcurementController(
      {} as never,
      reads as never,
      {} as never,
      {} as never,
      files as never
    );

    await controller.uploadDraftFile("procurement-1", file, actor);
    expect(order).toEqual(["capability", "storage"]);
    expect(reads.assertProcurementActionAvailable).toHaveBeenCalledWith(
      "procurement-1",
      "user-1",
      "edit_draft"
    );
  });

  it.each([
    ["uploadDraftFile", "edit_draft"],
    ["uploadExecutionVoucherFile", "record_execution"]
  ] as const)("checks exact payment capability before %s storage", async (method, action) => {
    const order: string[] = [];
    const reads = {
      assertPaymentActionAvailable: jest.fn(async () => order.push("capability"))
    };
    const files = {
      uploadPrivateFile: jest.fn(async () => {
        order.push("storage");
        return { id: "file-payment" };
      })
    };
    const controller = new SpotProcurementPaymentController(
      {} as never,
      reads as never,
      {} as never,
      files as never
    );

    await controller[method]("payment-1", file, actor);
    expect(order).toEqual(["capability", "storage"]);
    expect(reads.assertPaymentActionAvailable).toHaveBeenCalledWith(
      "payment-1",
      "user-1",
      action
    );
  });

  it.each([
    ["uploadReceiptPhotoFile", "append_receipt_photo"],
    ["uploadRefundVoucherFile", "record_refund"],
    ["uploadInvoiceFile", "append_invoice"]
  ] as const)("checks exact receipt capability before %s storage", async (method, action) => {
    const order: string[] = [];
    const receipts = {
      assertActionAvailable: jest.fn(async () => order.push("capability"))
    };
    const files = {
      uploadPrivateFile: jest.fn(async () => {
        order.push("storage");
        return { id: "file-receipt" };
      })
    };
    const controller = new SpotProcurementReceiptController(
      receipts as never,
      files as never
    );

    await controller[method]("procurement-1", file, actor);
    expect(order).toEqual(["capability", "storage"]);
    expect(receipts.assertActionAvailable).toHaveBeenCalledWith(
      "procurement-1",
      "user-1",
      action
    );
  });

  it("keeps every upload route under its business permission", () => {
    const routes = [
      [SpotProcurementController.prototype.uploadCreateDraftFile, "projects/:projectId/draft-file-uploads", "spot_procurement.create"],
      [SpotProcurementController.prototype.uploadDraftFile, ":procurementId/draft-file-uploads", "spot_procurement.create"],
      [SpotProcurementPaymentController.prototype.uploadDraftFile, ":paymentId/draft-file-uploads", "spot_procurement.payment.submit"],
      [SpotProcurementPaymentController.prototype.uploadExecutionVoucherFile, ":paymentId/execution-voucher-file-uploads", "spot_procurement.payment.execute"],
      [SpotProcurementReceiptController.prototype.uploadReceiptPhotoFile, ":procurementId/receipt-photo-file-uploads", "spot_procurement.receipt.confirm"],
      [SpotProcurementReceiptController.prototype.uploadRefundVoucherFile, ":procurementId/refund-voucher-file-uploads", "spot_procurement.refund.record"],
      [SpotProcurementReceiptController.prototype.uploadInvoiceFile, ":procurementId/invoice-file-uploads", "spot_procurement.invoice.append"]
    ] as const;

    for (const [target, path, permission] of routes) {
      expect(Reflect.getMetadata(PATH_METADATA, target)).toBe(path);
      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, target)).toBe(
        permission
      );
    }
  });
});
