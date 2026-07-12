import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
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

  @Post("contract-versions/:contractVersionId/preview")
  @RequireProjectRole("settlement.create")
  preview(
    @Param("contractVersionId") contractVersionId: string,
    @Body() input: PreviewSettlementLinesDto
  ) {
    return this.settlements.previewLines(contractVersionId, input);
  }
}
