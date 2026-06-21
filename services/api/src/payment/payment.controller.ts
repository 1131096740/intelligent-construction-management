import { Controller, Get, Param } from "@nestjs/common";
import { PaymentReadService } from "./payment-read.service";

@Controller("payments")
export class PaymentController {
  constructor(private readonly paymentRead: PaymentReadService) {}

  @Get(":paymentId")
  detail(@Param("paymentId") paymentId: string) {
    return this.paymentRead.getDetail(paymentId);
  }
}
