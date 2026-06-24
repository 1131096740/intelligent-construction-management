import { Body, Controller, Get, Post } from "@nestjs/common";
import { CompanyEntityService, type CreateCompanyEntityDto } from "./company-entity.service";

// 我方公司主体字典：列表供合同创建时选择；创建为低风险字典维护，仅要求登录。
@Controller("company-entities")
export class CompanyEntityController {
  constructor(private readonly companyEntities: CompanyEntityService) {}

  @Get()
  list() {
    return this.companyEntities.list();
  }

  @Post()
  create(@Body() body: CreateCompanyEntityDto) {
    return this.companyEntities.create(body);
  }
}
