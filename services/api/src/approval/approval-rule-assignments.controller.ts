import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ApprovalRuleAssignmentsService } from "./approval-rule-assignments.service";

@Controller("approval-rule-assignments")
export class ApprovalRuleAssignmentsController {
  constructor(private readonly assignments: ApprovalRuleAssignmentsService) {}
  @Get()
  read(@CurrentUser() actor: AuthenticatedUser, @Query("projectId") projectId?: string) {
    return this.assignments.read(actor.id, projectId);
  }
}
