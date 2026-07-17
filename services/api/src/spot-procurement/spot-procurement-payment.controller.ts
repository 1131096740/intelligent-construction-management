import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ExecuteSupplierBalanceDto } from "./dto/execute-supplier-balance.dto";
import { RecordSpotProcurementPaymentDto } from "./dto/record-spot-procurement-payment.dto";
import { ReviewSpotProcurementPaymentDto } from "./dto/review-spot-procurement-payment.dto";
import { UpdateSpotProcurementPaymentDraftDto } from "./dto/update-spot-procurement-payment-draft.dto";
import { VoidSpotProcurementDto } from "./dto/void-spot-procurement.dto";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";
import { SpotProcurementReadService } from "./spot-procurement-read.service";
import { SpotProcurementSettlementService } from "./spot-procurement-settlement.service";

@Controller("spot-procurement-payments")
export class SpotProcurementPaymentController {
  constructor(
    private readonly payments: SpotProcurementPaymentService,
    private readonly reads: SpotProcurementReadService,
    private readonly settlements: SpotProcurementSettlementService
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId?: string,
    @Query("status") status?: string,
    @Query("keyword") keyword?: string
  ) {
    return this.reads.listPayments(user.id, {
      projectId,
      status,
      keyword
    });
  }

  @Get(":paymentId")
  detail(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.reads.getPayment(paymentId, user.id);
  }

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

  @Post(":paymentId/executions")
  @RequireProjectRole("spot_procurement.payment.execute")
  recordExecution(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordSpotProcurementPaymentDto
  ) {
    return this.payments.recordExecution(paymentId, user.id, body);
  }

  @Post(":paymentId/balance-execution")
  @RequireProjectRole("spot_procurement.balance.execute")
  executeSupplierBalance(
    @Param("paymentId") paymentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ExecuteSupplierBalanceDto
  ) {
    return this.settlements.executeSupplierBalance(
      paymentId,
      user.id,
      body
    );
  }
}
