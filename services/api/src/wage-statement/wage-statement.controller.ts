import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { CreateApprovedWageSourceDto, CreateWageStatementDraftDto, CreateWageStatementRevisionDto, ReturnWageStatementDto, WageStatementCommandDto } from "./wage-statement.dto";
import { WageStatementService } from "./wage-statement.service";

@Controller("wage-statements")
export class WageStatementController {
  constructor(private readonly wages: WageStatementService) {}

  @Get("capabilities")
  @RequirePositions("finance_staff", "finance_director")
  capabilities(@CurrentUser() user: AuthenticatedUser) {
    return this.wages.capabilities(user.id);
  }

  @Get("workbench")
  @RequirePositions("finance_staff", "finance_director")
  workbench(@CurrentUser() user: AuthenticatedUser) {
    return this.wages.listWorkbench(user.id);
  }

  @Get(":statementId/summary")
  @RequirePositions("finance_staff", "finance_director")
  summary(@CurrentUser() user: AuthenticatedUser, @Param("statementId") statementId: string) {
    return this.wages.readSummary(user.id, statementId);
  }

  @Get(":statementId/import-preview")
  @RequirePositions("finance_staff", "finance_director")
  importPreview(@CurrentUser() user: AuthenticatedUser, @Param("statementId") statementId: string) {
    return this.wages.readImportPreview(user.id, statementId);
  }

  @Post("approved-sources")
  @RequirePositions("finance_staff", "finance_director")
  createApprovedSource(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateApprovedWageSourceDto
  ) {
    return this.wages.createApprovedSource(user.id, input);
  }

  @Post("drafts")
  @RequirePositions("finance_staff", "finance_director")
  createDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateWageStatementDraftDto
  ) {
    return this.wages.createDraft(user.id, input);
  }

  @Post(":statementId/revisions")
  @RequirePositions("finance_staff", "finance_director")
  createRevision(
    @CurrentUser() user: AuthenticatedUser,
    @Param("statementId") statementId: string,
    @Body() input: CreateWageStatementRevisionDto
  ) {
    return this.wages.createRevision(user.id, statementId, input);
  }

  @Post(":statementId/submit")
  @RequirePositions("finance_staff", "finance_director")
  submit(@CurrentUser() user: AuthenticatedUser, @Body() input: WageStatementCommandDto, @Param("statementId") statementId: string) {
    return this.wages.submit(user.id, statementId, input);
  }

  @Post(":statementId/return")
  @RequirePositions("finance_director")
  returnForReview(@CurrentUser() user: AuthenticatedUser, @Body() input: ReturnWageStatementDto, @Param("statementId") statementId: string) {
    return this.wages.returnForReview(user.id, statementId, input);
  }

  @Post(":statementId/confirm")
  @RequirePositions("finance_director")
  confirm(@CurrentUser() user: AuthenticatedUser, @Body() input: WageStatementCommandDto, @Param("statementId") statementId: string) {
    return this.wages.confirm(user.id, statementId, input);
  }
}
