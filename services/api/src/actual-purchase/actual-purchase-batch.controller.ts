import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ActualPurchaseBatchService } from "./actual-purchase-batch.service";
import {
  ConfirmActualPurchaseBatchCorrectionDto,
  CreateActualPurchaseBatchDto,
  CreateBatchSpotPaymentDto,
  RecordActualPurchaseBatchRefundDto,
  RequestActualPurchaseBatchCorrectionDto,
  UpdateActualPurchaseBatchDto
} from "./actual-purchase-batch.dto";

@Controller("actual-purchase-batches")
export class ActualPurchaseBatchController {
  constructor(private readonly batches: ActualPurchaseBatchService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateActualPurchaseBatchDto) {
    return this.batches.create(user.id, body);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("procurementId") procurementId?: string,
    @Query("kind") kind?: string
  ) {
    return this.batches.list(user.id, { procurementId, kind });
  }

  @Get(":batchId")
  detail(@CurrentUser() user: AuthenticatedUser, @Param("batchId") batchId: string) {
    return this.batches.detail(user.id, batchId);
  }

  @Patch(":batchId")
  update(@CurrentUser() user: AuthenticatedUser, @Param("batchId") batchId: string, @Body() body: UpdateActualPurchaseBatchDto) {
    return this.batches.update(user.id, batchId, body);
  }

  @Post(":batchId/spot-payments")
  createSpotPayment(@CurrentUser() user: AuthenticatedUser, @Param("batchId") batchId: string, @Body() body: CreateBatchSpotPaymentDto) {
    return this.batches.createSpotPayment(user.id, batchId, body);
  }

  @Post(":batchId/corrections")
  requestCorrection(@CurrentUser() user: AuthenticatedUser, @Param("batchId") batchId: string, @Body() body: RequestActualPurchaseBatchCorrectionDto) {
    return this.batches.requestCorrection(user.id, batchId, body);
  }

  @Post(":batchId/corrections/:correctionId/confirmation")
  confirmCorrection(
    @CurrentUser() user: AuthenticatedUser,
    @Param("batchId") batchId: string,
    @Param("correctionId") correctionId: string,
    @Body() body: ConfirmActualPurchaseBatchCorrectionDto
  ) {
    return this.batches.confirmCorrection(user.id, batchId, correctionId, body);
  }

  @Post(":batchId/refunds")
  recordRefund(@CurrentUser() user: AuthenticatedUser, @Param("batchId") batchId: string, @Body() body: RecordActualPurchaseBatchRefundDto) {
    return this.batches.recordRefund(user.id, batchId, body);
  }
}
