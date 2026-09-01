import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";

import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import {
  CreateFundExecutionCaseDto,
  CreateFundExecutionReversalCaseDto,
  FundExecutionCaseCommandDto,
  ReturnFundExecutionCaseDto,
  ReviewFundExecutionApprovalDto,
  UpdateFundExecutionCaseDto,
  UpdateFundExecutionReversalCaseDto
} from "./fund-execution.dto";
import { FundExecutionSelectionOptionsService } from "./fund-execution-selection-options.service";
import { FundExecutionService } from "./fund-execution.service";

@Controller("fund-executions")
export class FundExecutionController {
  constructor(
    private readonly executions: FundExecutionService,
    private readonly options: FundExecutionSelectionOptionsService
  ) {}

  @Get("cases")
  // Exact direct/delegated read authority is evaluated against live global
  // roles and active approval delegations by FundExecutionService.
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.executions.listCases(user.id);
  }

  @Get("capabilities")
  @RequirePositions("finance_staff", "finance_director")
  capabilities(@CurrentUser() user: AuthenticatedUser) {
    return this.options.capabilities(user.id);
  }

  @Get("cases/:caseId")
  // Keep delegated readers on the same service-side authorization path as
  // the case list; a static role gate would reject a valid delegate early.
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string
  ) {
    return this.executions.getCase(user.id, caseId);
  }

  @Get("observation-options")
  @RequirePositions("finance_staff", "finance_director")
  observationOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query("purpose") purpose?: string
  ) {
    return this.options.listObservationCandidates(
      user.id,
      new Date(),
      purpose === "payment_execution" ? "payment_execution" : "fund_execution_case"
    );
  }

  @Get("cases/:caseId/classification-options")
  @RequirePositions("finance_staff", "finance_director")
  classificationOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string
  ) {
    return this.options.listCasePlans(caseId, user.id);
  }

  @Get("reversal-options")
  @RequirePositions("finance_staff", "finance_director")
  reversalOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.options.listReversalTargets(user.id);
  }

  @Post("cases")
  @RequirePositions("finance_staff", "finance_director")
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateFundExecutionCaseDto
  ) {
    return this.executions.createCase(user.id, input);
  }

  @Patch("cases/:caseId")
  @RequirePositions("finance_staff", "finance_director")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string,
    @Body() input: UpdateFundExecutionCaseDto
  ) {
    return this.executions.updateCase(user.id, {
      caseId,
      expectedRevision: input.expectedRevision,
      reason: input.reason,
      selectionRefs: input.selections.map(({ selectionRef }) => selectionRef),
      idempotencyKey: input.idempotencyKey
    });
  }

  @Patch("cases/:caseId/reversal")
  @RequirePositions("finance_staff", "finance_director")
  updateReversal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string,
    @Body() input: UpdateFundExecutionReversalCaseDto
  ) {
    return this.executions.updateReversalCase(user.id, { caseId, ...input });
  }

  @Post("cases/:caseId/submit")
  @RequirePositions("finance_staff", "finance_director")
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string,
    @Body() input: FundExecutionCaseCommandDto
  ) {
    return this.executions.submitCase(user.id, { caseId, ...input });
  }

  @Post("cases/:caseId/return")
  // Only the actor frozen on the returned ApprovalActionLog may execute this
  // command; FundExecutionService verifies that identity transactionally.
  returnCase(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string,
    @Body() input: ReturnFundExecutionCaseDto
  ) {
    return this.executions.returnCase(user.id, { caseId, ...input });
  }

  @Post("cases/:caseId/confirm")
  @RequirePositions("finance_director")
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string,
    @Body() input: FundExecutionCaseCommandDto
  ) {
    return this.executions.confirmCase(user.id, { caseId, ...input });
  }

  @Post("cases/:caseId/approval-actions")
  // The service resolves direct or delegated identity against the current
  // frozen approval node and records both actor and represented user.
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string,
    @Body() input: ReviewFundExecutionApprovalDto
  ) {
    return this.executions.reviewApproval(user.id, { caseId, ...input });
  }

  @Post("reversals")
  @RequirePositions("finance_staff", "finance_director")
  reverse(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateFundExecutionReversalCaseDto
  ) {
    return this.executions.createReversalCase(user.id, input);
  }
}
