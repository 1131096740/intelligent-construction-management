import { Controller, Get, Param } from "@nestjs/common";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { SettlementWorkbenchService } from "./settlement-workbench.service";

@Controller("settlement-workbench")
export class SettlementWorkbenchController {
  constructor(private readonly workbench: SettlementWorkbenchService) {}

  @Get("contract-versions/:contractVersionId/source-lines")
  @RequireProjectRole("settlement.create")
  sourceLines(@Param("contractVersionId") contractVersionId: string) {
    return this.workbench.sourceLines(contractVersionId);
  }
}
