import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { PreviewSettlementLinesDto } from "./dto/preview-settlement-lines.dto";
import { SettlementService } from "./settlement.service";
import { SettlementWorkbenchService } from "./settlement-workbench.service";

@Controller("settlement-workbench")
export class SettlementWorkbenchController {
  constructor(
    private readonly workbench: SettlementWorkbenchService,
    private readonly settlements: SettlementService
  ) {}

  @Get("contract-versions/:contractVersionId/source-lines")
  @RequireProjectRole("settlement.create")
  sourceLines(@Param("contractVersionId") contractVersionId: string) {
    return this.workbench.sourceLines(contractVersionId);
  }

  @Get("contract-versions/:contractVersionId/participant-options")
  @RequireProjectRole("settlement.create")
  participantOptions(
    @Param("contractVersionId") contractVersionId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.workbench.participantOptions(contractVersionId, user.id);
  }

  @Post("contract-versions/:contractVersionId/preview")
  @RequireProjectRole("settlement.create")
  preview(
    @Param("contractVersionId") contractVersionId: string,
    @Body() input: PreviewSettlementLinesDto
  ) {
    return this.settlements.previewLines(contractVersionId, input);
  }
}
