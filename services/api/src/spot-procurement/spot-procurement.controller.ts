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
import { AbandonSpotProcurementDraftDto } from "./dto/abandon-spot-procurement-draft.dto";
import { CreateProcurementDiscrepancyDto } from "./dto/create-procurement-discrepancy.dto";
import { ConfirmAbnormalTerminationDto } from "./dto/confirm-abnormal-termination.dto";
import { CreateSpotProcurementDto } from "./dto/create-spot-procurement.dto";
import { CreateSpotProcurementVersionDto } from "./dto/create-spot-procurement-version.dto";
import { ExecuteSupplierBalanceDto } from "./dto/execute-supplier-balance.dto";
import { RecordProcurementRefundDto } from "./dto/record-procurement-refund.dto";
import { RequestAbnormalTerminationDto } from "./dto/request-abnormal-termination.dto";
import { ReviewSpotProcurementDto } from "./dto/review-spot-procurement.dto";
import { UpdateSpotProcurementDraftDto } from "./dto/update-spot-procurement-draft.dto";
import { VoidSpotProcurementDto } from "./dto/void-spot-procurement.dto";
import { WithdrawSpotProcurementApprovalDto } from "./dto/withdraw-spot-procurement-approval.dto";
import { SpotProcurementApplicationService } from "./spot-procurement-application.service";
import { SpotProcurementPaymentService } from "./spot-procurement-payment.service";
import { SpotProcurementReadService } from "./spot-procurement-read.service";
import { SpotProcurementSettlementService } from "./spot-procurement-settlement.service";

@Controller("spot-procurements")
export class SpotProcurementController {
  constructor(
    private readonly applications: SpotProcurementApplicationService,
    private readonly reads: SpotProcurementReadService,
    private readonly settlements: SpotProcurementSettlementService,
    private readonly payments: SpotProcurementPaymentService
  ) {}

  @Get("capabilities")
  capabilities(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId: string
  ) {
    return this.reads.capabilities(user.id, projectId);
  }

  @Get("create-project-options")
  createProjectOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.reads.createProjectOptions(user.id);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId?: string,
    @Query("status") status?: string,
    @Query("keyword") keyword?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("view") view?: string,
    @Query("surface") surface?: string
  ) {
    return this.reads.listProcurements(user.id, {
      projectId,
      status,
      keyword,
      page,
      pageSize,
      view,
      surface
    });
  }

  @Get("application-text-suggestions")
  applicationTextSuggestions(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId: string,
    @Query("keyword") keyword?: string
  ) {
    return this.applications.applicationTextSuggestions(
      user.id,
      projectId,
      keyword
    );
  }

  @Get(":procurementId")
  detail(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.reads.getProcurement(procurementId, user.id);
  }

  @Post()
  @RequireProjectRole("spot_procurement.create")
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateSpotProcurementDto
  ) {
    return this.applications.createDraft(user.id, body);
  }

  @Patch(":procurementId/draft")
  @RequireProjectRole("spot_procurement.create")
  updateDraft(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateSpotProcurementDraftDto
  ) {
    return this.applications.updateDraft(procurementId, user.id, body);
  }

  @Post(":procurementId/versions")
  @RequireProjectRole("spot_procurement.create")
  createVersion(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateSpotProcurementVersionDto
  ) {
    return this.applications.createVersion(procurementId, user.id, body);
  }

  @Post(":procurementId/submission")
  @RequireProjectRole("spot_procurement.create")
  submit(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.applications.submit(procurementId, user.id);
  }

  @Post(":procurementId/payment-drafts")
  @RequireProjectRole("spot_procurement.payment.submit")
  recreatePaymentDraft(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.payments.recreateDraft(procurementId, user.id);
  }

  @Post(":procurementId/approval")
  @RequireProjectRole("spot_procurement.approve")
  review(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReviewSpotProcurementDto
  ) {
    return this.applications.review(procurementId, user.id, body);
  }

  @Post(":procurementId/approval-withdrawal")
  withdrawApproval(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: WithdrawSpotProcurementApprovalDto
  ) {
    return this.applications.withdrawApproval(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/voiding")
  @RequireProjectRole("spot_procurement.void")
  voidProcurement(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: VoidSpotProcurementDto
  ) {
    return this.applications.voidProcurement(
      procurementId,
      user.id,
      body.reason
    );
  }

  @Post(":procurementId/abandonment")
  @RequireProjectRole("spot_procurement.create")
  abandonDraft(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AbandonSpotProcurementDraftDto
  ) {
    return this.applications.abandonDraft(procurementId, user.id, body);
  }

  @Post(":procurementId/abnormal-termination")
  @RequireProjectRole("spot_procurement.abnormal_termination.request")
  requestAbnormalTermination(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RequestAbnormalTerminationDto
  ) {
    return this.applications.requestAbnormalTermination(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/abnormal-termination/confirmation")
  @RequireProjectRole("spot_procurement.abnormal_termination.confirm")
  confirmAbnormalTermination(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmAbnormalTerminationDto
  ) {
    return this.applications.confirmAbnormalTermination(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/discrepancy")
  @RequireProjectRole("spot_procurement.discrepancy.create")
  createOrConfirmDiscrepancy(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateProcurementDiscrepancyDto
  ) {
    return this.settlements.createOrConfirmDiscrepancy(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/refunds")
  @RequireProjectRole("spot_procurement.refund.record")
  recordRefund(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RecordProcurementRefundDto
  ) {
    return this.settlements.recordRefund(
      procurementId,
      user.id,
      body
    );
  }

  @Post(":procurementId/supplier-balance-credit")
  @RequireProjectRole("spot_procurement.balance.execute")
  creditSupplierBalance(
    @Param("procurementId") procurementId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ExecuteSupplierBalanceDto
  ) {
    return this.settlements.creditSupplierBalance(
      procurementId,
      user.id,
      body
    );
  }
}
