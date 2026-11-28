import { IsOptional, IsUUID, MaxLength, ValidateIf } from "class-validator";
import {
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

/**
 * 接管分工登记：三项职责必须同时有明确负责人。
 * 更换负责人必须填写原因；首次登记可省略。
 */
export class SaveContractTakeoverHandoverDto {
  @IsRequiredText({
    requiredMessage: "请选择合同办理负责人",
    typeMessage: "合同办理负责人无效",
    blankMessage: "请选择合同办理负责人"
  })
  @MaxLength(64, { message: "合同办理负责人无效" })
  contractUserId!: string;

  @IsRequiredText({
    requiredMessage: "请选择财务收付负责人",
    typeMessage: "财务收付负责人无效",
    blankMessage: "请选择财务收付负责人"
  })
  @MaxLength(64, { message: "财务收付负责人无效" })
  financeUserId!: string;

  @IsRequiredText({
    requiredMessage: "请选择合同复核负责人",
    typeMessage: "合同复核负责人无效",
    blankMessage: "请选择合同复核负责人"
  })
  @MaxLength(64, { message: "合同复核负责人无效" })
  supervisorUserId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({
    typeMessage: "更换接管责任人原因必须是文字",
    blankMessage: "更换接管责任人原因不能为空白"
  })
  @MaxLength(500, { message: "更换接管责任人原因不能超过 500 字" })
  reason?: string;

  @IsOptional()
  @IsUUID("4", { message: "接管分工登记请求无效，请刷新后重试" })
  idempotencyKey?: string;
}
