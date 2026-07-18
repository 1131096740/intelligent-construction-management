import { Body, Controller, Param, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { AttachSpotPaymentInvoiceDto } from "./dto/attach-spot-payment-invoice.dto";
import { InvalidateSpotPaymentInvoiceDto } from "./dto/invalidate-spot-payment-invoice.dto";
import { SpotProcurementInvoiceService } from "./spot-procurement-invoice.service";

@Controller("spot-procurement-payments")
export class SpotProcurementInvoiceController {
  constructor(private readonly invoices: SpotProcurementInvoiceService) {}

  @Post(":paymentId/invoices")
  @RequireProjectRole("spot_procurement.invoice.append")
  append(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AttachSpotPaymentInvoiceDto
  ) {
    return this.invoices.append(paymentId, user.id, body);
  }

  @Post(":paymentId/invoices/:invoiceId/invalidation")
  @RequireProjectRole("spot_procurement.invoice.append")
  invalidate(
    @Param("paymentId") paymentId: string,
    @Param("invoiceId") invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: InvalidateSpotPaymentInvoiceDto
  ) {
    return this.invoices.invalidate(paymentId, invoiceId, user.id, body);
  }
}
