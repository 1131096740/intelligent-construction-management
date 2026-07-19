import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post
} from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { AttachReceiptPhotoDto } from "./dto/attach-receipt-photo.dto";
import { CreateReceiptDelegationDto } from "./dto/create-receipt-delegation.dto";
import { ReviewReceiptDto } from "./dto/review-receipt.dto";
import { RevokeReceiptReviewDto } from "./dto/revoke-receipt-review.dto";
import { ResetSpotProcurementReceiptDto } from "./dto/reset-spot-procurement-receipt.dto";
import { UpdateReceiptDraftDto } from "./dto/update-receipt-draft.dto";
import { SpotProcurementReceiptService } from "./spot-procurement-receipt.service";

@Controller("spot-procurements")
export class SpotProcurementReceiptController {
  constructor(
    private readonly receipts: SpotProcurementReceiptService
  ) {}

  @Get(":procurementId/receipt")
  detail(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.receipts.getReceipt(procurementId, user.id);
  }

  @Post(":procurementId/receipt/delegations")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  createDelegation(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateReceiptDelegationDto
  ) {
    return this.receipts.createDelegation(
      procurementId,
      user.id,
      body
    );
  }

  @Patch(":procurementId/receipt/draft")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  updateDraft(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateReceiptDraftDto
  ) {
    return this.receipts.updateDraft(procurementId, user.id, body);
  }

  @Post(":procurementId/receipt/draft-reset")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  resetDraft(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ResetSpotProcurementReceiptDto
  ) {
    return this.receipts.resetDraft(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/receipt/photos")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  attachPhoto(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AttachReceiptPhotoDto
  ) {
    return this.receipts.attachPhoto(procurementId, user.id, body);
  }

  @Delete(":procurementId/receipt/photos/:photoId")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  deleteDraftPhoto(
    @Param("procurementId") procurementId: string,
    @Param("photoId") photoId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.receipts.deleteDraftPhoto(
      procurementId,
      photoId,
      user.id
    );
  }

  @Post(":procurementId/receipt/submission")
  @RequireProjectRole("spot_procurement.receipt.confirm")
  submit(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.receipts.submit(procurementId, user.id);
  }

  @Post(":procurementId/receipt/review")
  @RequireProjectRole("spot_procurement.receipt.review")
  review(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewReceiptDto
  ) {
    return this.receipts.review(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/receipt/review-revocation")
  @RequireProjectRole(
    "spot_procurement.receipt.review_revoke"
  )
  revokeReview(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RevokeReceiptReviewDto
  ) {
    return this.receipts.revokeReview(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/receipt/pdf-refresh")
  @RequireProjectRole("spot_procurement.receipt.review")
  retryFormalPdf(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.receipts.retryFormalPdf(
      procurementId,
      user.id
    );
  }
}
