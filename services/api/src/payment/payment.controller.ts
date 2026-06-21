import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import { PaymentReadService } from "./payment-read.service";
import { PaymentRequestService } from "./payment-request.service";

@Controller("payments")
export class PaymentController {
  constructor(
    private readonly paymentRead: PaymentReadService,
    private readonly payments: PaymentRequestService
  ) {}

  @Post()
  create(@Body() body: CreatePaymentRequestDto) {
    return this.payments.create(body);
  }

  @Get(":paymentId")
  detail(@Param("paymentId") paymentId: string) {
    return this.paymentRead.getDetail(paymentId);
  }
}
