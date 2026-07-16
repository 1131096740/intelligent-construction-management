import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePositions } from "../auth/decorators/require-positions.decorator";
import { CreateVatRateOptionDto } from "./dto/create-vat-rate-option.dto";
import { UpdateVatRateOptionDto } from "./dto/update-vat-rate-option.dto";
import { VatRateOptionService } from "./vat-rate-option.service";

@Controller("vat-rate-options")
export class VatRateOptionController {
  constructor(private readonly vatRateOptions: VatRateOptionService) {}

  @Get()
  listEnabled() {
    return this.vatRateOptions.listEnabled();
  }

  @Post()
  @RequirePositions("finance_director")
  create(
    @Body() input: CreateVatRateOptionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.vatRateOptions.create(user.id, input);
  }

  @Patch(":optionId")
  @RequirePositions("finance_director")
  update(
    @Param("optionId") optionId: string,
    @Body() input: UpdateVatRateOptionDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.vatRateOptions.update(optionId, user.id, input);
  }
}
