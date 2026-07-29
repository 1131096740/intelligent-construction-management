import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
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
  save(
    @Param("toContractVersionId") toContractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SaveContractBillTransitionDto
  ) {
    return this.transitions.saveDraftMappings(toContractVersionId, user.id, body);
  }

  @Post("confirm")
  confirm(
    @Param("toContractVersionId") toContractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ConfirmContractBillTransitionsDto
  ) {
    return this.transitions.confirmDraftMappings(toContractVersionId, user.id, body);
  }

  @Delete()
  discard(
    @Param("toContractVersionId") toContractVersionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DiscardContractBillTransitionsDto
  ) {
    return this.transitions.discardDraftMappings(toContractVersionId, user.id, body);
  }
}
