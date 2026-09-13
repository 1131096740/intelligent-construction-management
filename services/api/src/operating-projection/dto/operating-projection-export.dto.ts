import { IsIn, IsString, ValidateIf } from "class-validator";

const SCOPE_KINDS = ["project", "company", "projects"] as const;

export class OperatingProjectionExportDto {
  @IsString({ message: "经营投影范围必须是字符串" })
  @IsIn(SCOPE_KINDS, { message: "经营投影范围必须是单项目、公司或多项目" })
  scopeKind!: "project" | "company" | "projects";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "项目标识必须是字符串" })
  projectId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "项目集合必须是逗号分隔字符串" })
  projectIds?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "公司主体标识必须是字符串" })
  companyEntityId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "经营投影日期必须是字符串" })
  asOf?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "施工企业筛选必须是字符串" })
  constructionEnterpriseId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "往来方筛选必须是字符串" })
  counterpartyId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "成本分类筛选必须是字符串" })
  costCategoryCode?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "来源筛选必须是字符串" })
  sourceType?: string;

  @IsString({ message: "二次确认密码必须是字符串" })
  confirmationPassword!: string;
}
