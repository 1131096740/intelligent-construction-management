import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";

import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import type {
  AttestClearingEventDto,
  ConfirmClearingEventDto,
  CreateClearingCaseDto,
  CreateClearingEventDto,
  ReopenClearingEventDto,
  ReturnClearingEventDto,
  SubmitClearingEventDto
} from "./clearing.dto";
import { ClearingService } from "./clearing.service";

@Controller("clearing-cases")
export class ClearingController {
  constructor(private readonly clearing: ClearingService) {}

  @Get("capabilities")
  capabilities(@CurrentUser() user: AuthenticatedUser) {
    return this.clearing.capabilities(user.id);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId?: string
  ) {
    return this.clearing.list(user.id, projectId);
  }

  @Get(":caseId")
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string
  ) {
    return this.clearing.detail(user.id, caseId);
  }

  @Post()
  @RequireProjectRole("clearing.prepare")
  createCase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateClearingCaseDto
  ) {
    return this.clearing.createCase(user.id, input);
  }

  @Post(":caseId/events")
  @RequireProjectRole("clearing.prepare")
  createEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("caseId") caseId: string,
    @Body() input: CreateClearingEventDto
  ) {
    return this.clearing.createEvent(user.id, caseId, input);
  }

  @Post("events/:eventId/submit")
  @RequireProjectRole("clearing.submit")
  submitEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId") eventId: string,
    @Body() input: SubmitClearingEventDto
  ) {
    return this.clearing.submitEvent(user.id, eventId, input);
  }

  @Post("events/:eventId/attest")
  @RequireProjectRole("clearing.attest")
  attestEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId") eventId: string,
    @Body() input: AttestClearingEventDto
  ) {
    return this.clearing.attestEvent(user.id, eventId, input);
  }

  @Patch("events/:eventId/draft")
  @RequireProjectRole("clearing.prepare")
  reviseEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId") eventId: string,
    @Body() input: CreateClearingEventDto
  ) {
    return this.clearing.reviseEvent(user.id, eventId, input);
  }

  @Post("events/:eventId/confirm")
  @RequireProjectRole("clearing.confirm")
  confirmEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId") eventId: string,
    @Body() input: ConfirmClearingEventDto
  ) {
    return this.clearing.confirmEvent(user.id, eventId, input);
  }

  @Post("events/:eventId/return")
  @RequireProjectRole("clearing.return")
  returnEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId") eventId: string,
    @Body() input: ReturnClearingEventDto
  ) {
    return this.clearing.returnEvent(user.id, eventId, input);
  }

  @Post("events/:eventId/reopen")
  @RequireProjectRole("clearing.reopen")
  reopenEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("eventId") eventId: string,
    @Body() input: ReopenClearingEventDto
  ) {
    return this.clearing.reopenEvent(user.id, eventId, input);
  }
}
