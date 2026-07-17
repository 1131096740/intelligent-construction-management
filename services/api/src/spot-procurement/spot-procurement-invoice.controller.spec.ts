import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { SpotProcurementInvoiceController } from "./spot-procurement-invoice.controller";

describe("SpotProcurementInvoiceController", () => {
  it("exposes payment-level append and pre-closure invalidation with the invoice append permission", () => {
    const expectations = [
      ["append", ":paymentId/invoices"],
      ["invalidate", ":paymentId/invoices/:invoiceId/invalidation"]
    ] as const;
    for (const [method, path] of expectations) {
      const target = SpotProcurementInvoiceController.prototype[method];
      expect(Reflect.getMetadata(METHOD_METADATA, target)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(PATH_METADATA, target)).toBe(path);
      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, target)).toBe(
        "spot_procurement.invoice.append"
      );
    }
  });
});
