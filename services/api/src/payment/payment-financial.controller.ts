import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ConfirmPaymentCorrectionDto, RequestPaymentCorrectionDto } from "./dto/request-payment-correction.dto";
import { RecordPaymentRefundDto } from "./dto/record-payment-refund.dto";
import { PaymentCorrectionService } from "./payment-correction.service";
import { PaymentRefundService } from "./payment-refund.service";
import { FinancialCorrectionEntryService } from "./financial-correction-entry.service";

@Controller("payment-financial")
export class PaymentFinancialController {
  constructor(
    private readonly refunds: PaymentRefundService,
    private readonly corrections: PaymentCorrectionService,
    private readonly entry: FinancialCorrectionEntryService
  ) {}

  @Get("payments/:paymentId/refunds/capability")
  refundCapability(@CurrentUser() actor: AuthenticatedUser, @Param("paymentId") paymentId: string) {
    return this.refunds.capability(paymentId, actor.id);
  }

  @Post("payments/:paymentId/executions/:executionId/refunds")
  recordRefund(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("paymentId") paymentId: string,
    @Param("executionId", new ParseUUIDPipe({ version: "4" })) executionId: string,
    @Body() input: RecordPaymentRefundDto
  ) {
    return this.refunds.recordRefund(paymentId, executionId, actor.id, input);
  }

  @Get("payments/:paymentId/corrections")
  listCorrections(@CurrentUser() actor: AuthenticatedUser, @Param("paymentId") paymentId: string) {
    return this.corrections.listForPayment(paymentId, actor.id);
  }

  @Post("payments/:paymentId/executions/:executionId/corrections")
  requestCorrection(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("paymentId") paymentId: string,
    @Param("executionId", new ParseUUIDPipe({ version: "4" })) executionId: string,
    @Body() input: RequestPaymentCorrectionDto
  ) {
    return this.corrections.request(paymentId, executionId, actor.id, input);
  }

  @Post("corrections/:correctionId/confirmation")
  confirmCorrection(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("correctionId", new ParseUUIDPipe({ version: "4" })) correctionId: string,
    @Body() input: ConfirmPaymentCorrectionDto
  ) {
    return this.corrections.confirm(correctionId, actor.id, input);
  }

  @Get("entry/capability")
  entryCapability(
    @CurrentUser() actor: AuthenticatedUser,
    @Query("type") type: string,
    @Query("id") id: string
  ) {
    return this.entry.capability(type, id, actor.id);
  }
}
