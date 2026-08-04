import {
  IsBoolean,
  IsIn,
  Matches,
  MaxLength,
  IsObject,
  IsOptional,
  IsString
} from "class-validator";
import {
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";

export interface SaveBillRowDto {
  expectedBillRevision: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
  isProvisional?: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}

export interface ReorderBillRowsDto {
  expectedBillRevision: number;
  rowKeys: string[];
}

export interface ReplaceBillRowDto {
  clientRowKey: string;
  rowKey?: string;
  sortOrder: number;
  itemCode?: string;
  itemName: string;
  specification?: string;
  unit: string;
  quantity?: string;
  unitPrice: string;
  taxRatePercent?: string;
  taxRateSource?: "version_default" | "row_override";
  isProvisional?: boolean;
  settlementBasis?: string;
  customData: Record<string, unknown>;
}

export interface ReplaceBillRowsDto {
  expectedBillRevision: number;
  idempotencyKey: string;
  rows: ReplaceBillRowDto[];
}

export class CancelBillRowRemainderDto {
  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "合同清单修订号必须是整数",
    rangeMessage: "合同清单修订号必须大于等于 1"
  })
  expectedBillRevision!: number;

  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "合同草稿修订号必须是整数",
    rangeMessage: "合同草稿修订号必须大于等于 1"
  })
  expectedDraftRevision!: number;

  @IsRequiredText({
    requiredMessage: "历史占用校验令牌不能为空",
    typeMessage: "历史占用校验令牌必须是文字",
    blankMessage: "历史占用校验令牌不能为空白"
  })
  @Matches(/^[a-f0-9]{64}$/, { message: "历史占用校验令牌格式无效" })
  expectedOccupancyToken!: string;

  @IsRequiredText({
    requiredMessage: "取消未实施余量必须填写原因",
    typeMessage: "取消未实施余量原因必须是文字",
    blankMessage: "取消未实施余量必须填写原因"
  })
  @MaxLength(500, { message: "取消未实施余量原因不能超过 500 个字符" })
  reason!: string;
}

export class SaveContractBillRowDto {
  @IsRequiredText({
    requiredMessage: "客户端清单行键不能为空",
    typeMessage: "客户端清单行键必须是文字",
    blankMessage: "客户端清单行键不能为空白"
  })
  clientRowKey!: string;

  @IsOptional()
  @IsRequiredText({
    requiredMessage: "清单行键不能为空",
    typeMessage: "清单行键必须是文字",
    blankMessage: "清单行键不能为空白"
  })
  rowKey?: string;

  @IsIntegerInRange({
    min: 0,
    max: 2_147_483_647,
    typeMessage: "清单行顺序必须是整数",
    rangeMessage: "清单行顺序必须大于等于 0"
  })
  sortOrder!: number;

  @IsOptional()
  @IsString({ message: "清单项目编码必须是文字" })
  itemCode?: string;

  @IsRequiredText({
    requiredMessage: "清单项目名称不能为空",
    typeMessage: "清单项目名称必须是文字",
    blankMessage: "清单项目名称不能为空白"
  })
  itemName!: string;

  @IsOptional()
  @IsString({ message: "清单规格必须是文字" })
  specification?: string;

  @IsRequiredText({
    requiredMessage: "清单单位不能为空",
    typeMessage: "清单单位必须是文字",
    blankMessage: "清单单位不能为空白"
  })
  unit!: string;

  @IsOptional()
  @IsString({ message: "清单数量必须是十进制文字" })
  quantity?: string;

  @IsRequiredText({
    requiredMessage: "清单单价不能为空",
    typeMessage: "清单单价必须是十进制文字",
    blankMessage: "清单单价不能为空白"
  })
  unitPrice!: string;

  @IsOptional()
  @IsString({ message: "清单税率必须是十进制文字" })
  taxRatePercent?: string;

  @IsOptional()
  @IsIn(["version_default", "row_override"], {
    message: "清单税率来源不正确"
  })
  taxRateSource?: "version_default" | "row_override";

  @IsOptional()
  @IsBoolean({ message: "清单暂定标记必须是布尔值" })
  isProvisional?: boolean;

  @IsOptional()
  @IsString({ message: "清单结算依据必须是文字" })
  settlementBasis?: string;

  @IsObject({ message: "清单自定义字段必须是对象" })
  customData!: Record<string, unknown>;
}
