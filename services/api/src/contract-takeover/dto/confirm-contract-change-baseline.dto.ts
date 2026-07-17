import { IsRequiredText } from "../../validation/static-field-validation";
import { IsString, Matches } from "class-validator";

export class ConfirmContractChangeBaselineDto {
  @IsString({ message: "原始签约含税金额必须是规范分值" })
  @Matches(/^\d+$/, { message: "原始签约含税金额必须是大于等于 0 的整数分值" })
  originalSignedAmountCents!: string;

  @IsString({ message: "接管前累计正向增项必须是规范分值" })
  @Matches(/^\d+$/, { message: "接管前累计正向增项必须是大于等于 0 的整数分值" })
  preTakeoverPositiveIncreaseCents!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  currentPassword!: string;
}
