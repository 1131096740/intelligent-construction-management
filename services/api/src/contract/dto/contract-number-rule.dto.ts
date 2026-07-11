import { ValidateIf } from "class-validator";
import {
  IsIntegerInRange,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

function AllowsNullScope(): PropertyDecorator {
  return ValidateIf((_object, value) => value !== null);
}

export class CreateContractNumberRuleDto {
  @IsRequiredText({
    requiredMessage: "请填写合同编号规则名称",
    typeMessage: "合同编号规则名称必须是文字",
    blankMessage: "请填写合同编号规则名称"
  })
  name!: string;

  @IsRequiredText({
    requiredMessage: "请填写合同编号规则格式",
    typeMessage: "合同编号规则格式必须是文字",
    blankMessage: "请填写合同编号规则格式"
  })
  pattern!: string;

  @AllowsNullScope()
  @IsOptionalNonBlankText({
    typeMessage: "签约主体编号必须是文字",
    blankMessage: "签约主体编号不能为空白"
  })
  companyEntityId?: string | null;

  @AllowsNullScope()
  @IsOptionalNonBlankText({
    typeMessage: "项目编号必须是文字",
    blankMessage: "项目编号不能为空白"
  })
  projectId?: string | null;

  @AllowsNullScope()
  @IsOptionalNonBlankText({
    typeMessage: "合同类型必须是文字",
    blankMessage: "合同类型不能为空白"
  })
  contractTypeKey?: string | null;

  @IsIntegerInRange({
    min: 1,
    max: 12,
    typeMessage: "编号流水号位数必须是整数",
    rangeMessage: "编号流水号位数必须在 1 到 12 之间"
  })
  sequenceWidth!: number;
}

export class UpdateContractNumberRuleDto {
  @IsOptionalNonBlankText({
    typeMessage: "合同编号规则名称必须是文字",
    blankMessage: "请填写合同编号规则名称"
  })
  name?: string;

  @IsOptionalNonBlankText({
    typeMessage: "合同编号规则格式必须是文字",
    blankMessage: "请填写合同编号规则格式"
  })
  pattern?: string;

  @AllowsNullScope()
  @IsOptionalNonBlankText({
    typeMessage: "签约主体编号必须是文字",
    blankMessage: "签约主体编号不能为空白"
  })
  companyEntityId?: string | null;

  @AllowsNullScope()
  @IsOptionalNonBlankText({
    typeMessage: "项目编号必须是文字",
    blankMessage: "项目编号不能为空白"
  })
  projectId?: string | null;

  @AllowsNullScope()
  @IsOptionalNonBlankText({
    typeMessage: "合同类型必须是文字",
    blankMessage: "合同类型不能为空白"
  })
  contractTypeKey?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIntegerInRange({
    min: 1,
    max: 12,
    typeMessage: "编号流水号位数必须是整数",
    rangeMessage: "编号流水号位数必须在 1 到 12 之间"
  })
  sequenceWidth?: number;
}
