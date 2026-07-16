import {
  Body,
  Controller,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ReviewSpotProcurementPaymentDto } from "./dto/review-spot-procurement-payment.dto";
import { UpdateSpotProcurementPaymentDraftDto } from "./dto/update-spot-procurement-payment-draft.dto";
import { VoidSpotProcurementDto } from "./dto/void-spot-procurement.dto";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";

@Controller("spot-procurement-payments")
export class SpotProcurementPaymentController {
  constructor(
    private readonly payments: SpotProcurementPaymentService
  ) {}

  @Patch(":paymentId/draft")
  @RequireProjectRole("spot_procurement.payment.submit")
  updateDraft(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateSpotProcurementPaymentDraftDto
  ) {
    return this.payments.updateDraft(paymentId, user.id, body);
  }

  @Post(":paymentId/submission")
  @RequireProjectRole("spot_procurement.payment.submit")
  submit(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.payments.submit(paymentId, user.id);
  }

  @Post(":paymentId/approval")
  @RequireProjectRole("spot_procurement.payment.approve")
  review(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewSpotProcurementPaymentDto
  ) {
    return this.payments.review(paymentId, user.id, body);
  }

  @Post(":paymentId/approval-withdrawal")
  @RequireProjectRole("spot_procurement.payment.submit")
  withdrawApproval(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.payments.withdrawApproval(paymentId, user.id);
  }

  @Post(":paymentId/voiding")
  @RequireProjectRole("spot_procurement.void")
  voidPayment(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VoidSpotProcurementDto
  ) {
    return this.payments.voidPayment(
      paymentId,
      user.id,
      body.reason
    );
  }
}
