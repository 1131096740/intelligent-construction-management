import { IsBoolean, IsIn, IsString, ValidateIf } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

class CompanyEntityFactsDto {
  @IsRequiredText({
    requiredMessage: "请填写公司主体名称",
    typeMessage: "公司主体名称必须是文字",
    blankMessage: "请填写公司主体名称"
  })
  name!: string;

  @IsRequiredText({
    requiredMessage: "请填写统一社会信用代码",
    typeMessage: "统一社会信用代码必须是文字",
    blankMessage: "请填写统一社会信用代码"
  })
  unifiedSocialCreditCode!: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString({ message: "注册地址必须是文字" })
  registeredAddress?: string | null;
}

export class CreateCompanyEntityDto extends CompanyEntityFactsDto {}

export class UpdateCompanyEntityDto extends CompanyEntityFactsDto {}

export class UpdateCompanyEntityStatusDto {
  @IsBoolean({ message: "公司主体状态必须是布尔值" })
  isActive!: boolean;
}

export class CompanyEntityManagementQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "公司主体搜索关键字必须是文字" })
  keyword?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["all", "active", "inactive"], {
    message: "公司主体状态筛选不正确，请选择全部、启用或停用"
  })
  status?: "all" | "active" | "inactive";
}
