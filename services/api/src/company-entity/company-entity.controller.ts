import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query
} from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  CompanyEntityManagementQueryDto,
  CreateCompanyEntityDto,
  UpdateCompanyEntityDto,
  UpdateCompanyEntityStatusDto
} from "./dto/company-entity.dto";
import { CompanyEntityService } from "./company-entity.service";

@Controller("company-entities")
export class CompanyEntityController {
  constructor(private readonly companyEntities: CompanyEntityService) {}

  @Get()
  listActive() {
    return this.companyEntities.listActive();
  }

  @Get("management")
  listForManagement(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CompanyEntityManagementQueryDto
  ) {
    return this.companyEntities.listForManagement(user.id, query);
  }

  @Get(":id/history")
  history(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.companyEntities.history(id, user.id);
  }

  @Post()
  create(
    @Body() body: CreateCompanyEntityDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.companyEntities.create(user.id, body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: UpdateCompanyEntityDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.companyEntities.update(id, user.id, body);
  }

  @Post(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() body: UpdateCompanyEntityStatusDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.companyEntities.updateStatus(id, user.id, body);
  }
}
