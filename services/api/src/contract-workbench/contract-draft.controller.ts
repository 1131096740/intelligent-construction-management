import { Controller, Get, Param } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ContractDraftAggregateService } from "./contract-draft-aggregate.service";

@Controller("contract-drafts")
export class ContractDraftController {
  constructor(private readonly aggregate: ContractDraftAggregateService) {}

  @Get(":contractVersionId/workbench")
  workbench(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.aggregate.getWorkbench(contractVersionId, user.id);
  }
}
