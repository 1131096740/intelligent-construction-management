import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Public } from "../auth/decorators/public.decorator";
import { CreatePaymentRequestDto } from "./dto/create-payment-request.dto";
import { RecordFinanceRecordDto } from "./dto/record-finance-record.dto";
import { RecordPaymentPdfArchiveDto } from "./dto/record-payment-pdf-archive.dto";
import { RecordPaymentExecutionDto } from "./dto/record-payment-execution.dto";
import { ReviewPaymentApprovalDto } from "./dto/review-payment-approval.dto";
import { PaymentReadService } from "./payment-read.service";
import { PaymentRequestService } from "./payment-request.service";

@Controller("payments")
@Public()
export class PaymentController {
  constructor(
    private readonly paymentRead: PaymentReadService,
    private readonly payments: PaymentRequestService
  ) {}

  @Post()
  create(@Body() body: CreatePaymentRequestDto) {
    return this.payments.create(body);
  }

  @Post(":paymentId/approval")
  reviewApproval(
    @Param("paymentId") paymentId: string,
    @Body() body: ReviewPaymentApprovalDto
  ) {
    return this.payments.reviewApproval(paymentId, body);
  }

  @Post(":paymentId/executions")
  recordExecution(
    @Param("paymentId") paymentId: string,
    @Body() body: RecordPaymentExecutionDto
  ) {
    return this.payments.recordExecution(paymentId, body);
  }

  @Post(":paymentId/finance-records")
  recordFinance(
    @Param("paymentId") paymentId: string,
    @Body() body: RecordFinanceRecordDto
  ) {
    return this.payments.recordFinance(paymentId, body);
  }

  @Post(":paymentId/pdf-archive")
  recordPdfArchive(
    @Param("paymentId") paymentId: string,
    @Body() body: RecordPaymentPdfArchiveDto
  ) {
    return this.payments.recordPdfArchive(paymentId, body);
  }

  @Get(":paymentId")
  detail(@Param("paymentId") paymentId: string) {
    return this.paymentRead.getDetail(paymentId);
  }
}
