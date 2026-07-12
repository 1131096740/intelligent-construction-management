import { IsBoolean, IsString, MaxLength, ValidateIf } from "class-validator";
import {
  IsIntegerInRange,
  IsRequiredText
} from "../../validation/static-field-validation";

export class CreateContractBusinessScenarioDto {
  @IsRequiredText({
    requiredMessage: "业务场景编码不能为空",
    typeMessage: "业务场景编码必须是文字",
    blankMessage: "业务场景编码不能为空白"
  })
  @MaxLength(100, { message: "业务场景编码不能超过 100 个字符" })
  code!: string;

  @IsRequiredText({
    requiredMessage: "业务场景名称不能为空",
    typeMessage: "业务场景名称必须是文字",
    blankMessage: "业务场景名称不能为空白"
  })
  @MaxLength(200, { message: "业务场景名称不能超过 200 个字符" })
  name!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "业务场景说明必须是文字" })
  @MaxLength(1000, { message: "业务场景说明不能超过 1000 个字符" })
  description?: string;
}

export class UpdateContractBusinessScenarioDto {
  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "业务场景修订号必须是整数",
    rangeMessage: "业务场景修订号不正确"
  })
  expectedRevision!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsRequiredText({
    requiredMessage: "业务场景名称不能为空",
    typeMessage: "业务场景名称必须是文字",
    blankMessage: "业务场景名称不能为空白"
  })
  @MaxLength(200, { message: "业务场景名称不能超过 200 个字符" })
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "业务场景说明必须是文字" })
  @MaxLength(1000, { message: "业务场景说明不能超过 1000 个字符" })
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "业务场景启用状态必须是布尔值" })
  active?: boolean;
}

export class CreateContractScenarioTemplateMappingDto {
  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "业务场景修订号必须是整数",
    rangeMessage: "业务场景修订号不正确"
  })
  expectedScenarioRevision!: number;

  @IsRequiredText({
    requiredMessage: "业务模板版本不能为空",
    typeMessage: "业务模板版本必须是文字",
    blankMessage: "业务模板版本不能为空白"
  })
  businessTemplateVersionId!: string;

  @IsRequiredText({
    requiredMessage: "推荐理由不能为空",
    typeMessage: "推荐理由必须是文字",
    blankMessage: "推荐理由不能为空白"
  })
  @MaxLength(1000, { message: "推荐理由不能超过 1000 个字符" })
  reason!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: 0,
    max: 1_000_000,
    typeMessage: "映射排序值必须是整数",
    rangeMessage: "映射排序值不正确"
  })
  priority?: number;
}

export class UpdateContractScenarioTemplateMappingDto {
  @IsIntegerInRange({
    min: 1,
    max: 2_147_483_647,
    typeMessage: "映射修订号必须是整数",
    rangeMessage: "映射修订号不正确"
  })
  expectedRevision!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsRequiredText({
    requiredMessage: "推荐理由不能为空",
    typeMessage: "推荐理由必须是文字",
    blankMessage: "推荐理由不能为空白"
  })
  @MaxLength(1000, { message: "推荐理由不能超过 1000 个字符" })
  reason?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: 0,
    max: 1_000_000,
    typeMessage: "映射排序值必须是整数",
    rangeMessage: "映射排序值不正确"
  })
  priority?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "映射启用状态必须是布尔值" })
  active?: boolean;
}
