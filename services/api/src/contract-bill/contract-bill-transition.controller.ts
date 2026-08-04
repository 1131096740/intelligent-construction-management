import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { RequireProjectRole } from "../auth/decorators/require-project-role.decorator";
import { ContractCutoverSurface } from "../contract-cutover/contract-cutover.decorators";
import { ContractBillTransitionService } from "./contract-bill-transition.service";
import type {
  ConfirmContractBillTransitionsDto,
  DiscardContractBillTransitionsDto,
  SaveContractBillTransitionDto
} from "./dto/contract-bill-transition.dto";

@ContractCutoverSurface()
@Controller("contract-versions/:toContractVersionId/bill-transitions")
export class ContractBillTransitionController {
  constructor(private readonly transitions: ContractBillTransitionService) {}

  @Get()
  list(@Param("toContractVersionId") toContractVersionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transitions.listMappings(toContractVersionId, user.id);
  }

  @Get("options")
  options(@Param("toContractVersionId") toContractVersionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transitions.listOptions(toContractVersionId, user.id);
  }

  @Put()
  @RequireProjectRole("contract.create")
  save(
    @Param("toContractVersionId") toContractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveContractBillTransitionDto
  ) {
    return this.transitions.saveDraftMappings(toContractVersionId, user.id, body);
  }

  @Post("confirm")
  @RequireProjectRole("contract.create")
  confirm(
    @Param("toContractVersionId") toContractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmContractBillTransitionsDto
  ) {
    return this.transitions.confirmDraftMappings(toContractVersionId, user.id, body);
  }

  @Delete()
  @RequireProjectRole("contract.create")
  discard(
    @Param("toContractVersionId") toContractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DiscardContractBillTransitionsDto
  ) {
    return this.transitions.discardDraftMappings(toContractVersionId, user.id, body);
  }
}
