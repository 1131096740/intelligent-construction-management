import {
  IsDateString,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateIf
} from "class-validator";

const SCOPE_KINDS = ["project", "company", "projects"] as const;
export const OPERATING_PROJECTION_EXPORT_KINDS = [
  "project_operating_ledger_detail",
  "construction_enterprise_funds_reconciliation",
  "company_project_funds_subledger",
  "receivable_payable_cashflow_detail",
  "takeover_coverage_evidence_gap"
] as const;
export type OperatingProjectionExportKind =
  (typeof OPERATING_PROJECTION_EXPORT_KINDS)[number];
const VALUE_MAX_LENGTH = 256;
const LIST_MAX_LENGTH = 2_048;

export class OperatingProjectionExportDto {
  @IsString({ message: "经营投影范围必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "经营投影范围不能超过 256 个字符" })
  @IsIn(SCOPE_KINDS, { message: "经营投影范围必须是单项目、公司或多项目" })
  scopeKind!: "project" | "company" | "projects";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "项目标识必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "项目标识不能超过 256 个字符" })
  projectId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "项目集合必须是逗号分隔字符串" })
  @MaxLength(LIST_MAX_LENGTH, { message: "项目集合不能超过 2048 个字符" })
  projectIds?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "公司主体标识必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "公司主体标识不能超过 256 个字符" })
  companyEntityId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "经营投影日期必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "经营投影日期不能超过 256 个字符" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "经营投影日期必须是 YYYY-MM-DD" })
  @IsDateString({ strict: true, strictSeparator: true }, {
    message: "经营投影日期必须是真实日历日期"
  })
  asOf?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "施工企业筛选必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "施工企业筛选不能超过 256 个字符" })
  constructionEnterpriseId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "往来方筛选必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "往来方筛选不能超过 256 个字符" })
  counterpartyId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "成本分类筛选必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "成本分类筛选不能超过 256 个字符" })
  costCategoryCode?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "来源筛选必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "来源筛选不能超过 256 个字符" })
  sourceType?: string;

  @IsString({ message: "导出类型必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "导出类型不能超过 256 个字符" })
  @IsIn(OPERATING_PROJECTION_EXPORT_KINDS, { message: "导出类型无效" })
  exportKind!: OperatingProjectionExportKind;

  @IsString({ message: "二次确认密码必须是字符串" })
  @MaxLength(VALUE_MAX_LENGTH, { message: "二次确认密码不能超过 256 个字符" })
  confirmationPassword!: string;
}
