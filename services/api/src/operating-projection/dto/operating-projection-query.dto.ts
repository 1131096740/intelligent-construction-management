import {
  IsDateString,
  IsIn,
  IsString,
  Matches,
  MaxLength,
  ValidateIf
} from "class-validator";

const SCOPE_KINDS = ["project", "company", "projects"] as const;
const QUERY_VALUE_MAX_LENGTH = 256;
const QUERY_LIST_MAX_LENGTH = 2_048;

export class OperatingProjectionScopedQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "经营投影截止日期必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "经营投影截止日期不能超过 256 个字符" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "经营投影截止日期必须是 YYYY-MM-DD" })
  @IsDateString({ strict: true, strictSeparator: true }, {
    message: "经营投影截止日期必须是真实日历日期"
  })
  asOf?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "施工企业筛选必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "施工企业筛选不能超过 256 个字符" })
  constructionEnterpriseId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "公司主体筛选必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "公司主体筛选不能超过 256 个字符" })
  companyEntityId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "往来方筛选必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "往来方筛选不能超过 256 个字符" })
  counterpartyId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "成本类别筛选必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "成本类别筛选不能超过 256 个字符" })
  costCategoryCode?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "来源类型筛选必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "来源类型筛选不能超过 256 个字符" })
  sourceType?: string;
}

export class OperatingProjectionProjectQueryDto extends OperatingProjectionScopedQueryDto {}

export class OperatingProjectionCompanyQueryDto extends OperatingProjectionScopedQueryDto {}

export class OperatingProjectionAsOfQueryDto extends OperatingProjectionScopedQueryDto {
  @IsString({ message: "经营投影范围必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "经营投影范围不能超过 256 个字符" })
  @IsIn(SCOPE_KINDS, { message: "经营投影范围必须是单项目、公司或多项目" })
  scopeKind!: "project" | "company" | "projects";

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "项目标识必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "项目标识不能超过 256 个字符" })
  projectId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "项目标识集合必须是逗号分隔字符串" })
  @MaxLength(QUERY_LIST_MAX_LENGTH, { message: "项目标识集合不能超过 2048 个字符" })
  projectIds?: string;
}

class OperatingProjectionDetailQueryDto extends OperatingProjectionScopedQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "经营投影明细游标必须是字符串" })
  @MaxLength(QUERY_LIST_MAX_LENGTH, { message: "经营投影明细游标不能超过 2048 个字符" })
  cursor?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "经营投影明细每页条数必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "经营投影明细每页条数不能超过 256 个字符" })
  @Matches(/^(?:[1-9]|[1-9]\d|1\d\d|200)$/, {
    message: "经营投影明细每页条数必须是 1 到 200 的十进制整数"
  })
  pageSize?: string;
}

export class OperatingProjectionProjectDetailQueryDto
  extends OperatingProjectionDetailQueryDto {}

export class OperatingProjectionCompanyDetailQueryDto
  extends OperatingProjectionDetailQueryDto {}

export class OperatingProjectionAsOfDetailQueryDto extends OperatingProjectionAsOfQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "经营投影明细游标必须是字符串" })
  @MaxLength(QUERY_LIST_MAX_LENGTH, { message: "经营投影明细游标不能超过 2048 个字符" })
  cursor?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "经营投影明细每页条数必须是字符串" })
  @MaxLength(QUERY_VALUE_MAX_LENGTH, { message: "经营投影明细每页条数不能超过 256 个字符" })
  @Matches(/^(?:[1-9]|[1-9]\d|1\d\d|200)$/, {
    message: "经营投影明细每页条数必须是 1 到 200 的十进制整数"
  })
  pageSize?: string;
}
