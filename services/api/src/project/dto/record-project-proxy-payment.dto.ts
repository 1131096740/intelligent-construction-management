import {
  IsDateString,
  IsIn,
  IsString,
  ValidateIf
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export type ProjectProxyPaymentType =
  | "material"
  | "equipment"
  | "labor"
  | "professional_subcontract"
  | "other";

export class RecordProjectProxyPaymentDto {
  @IsDateString({ strict: true }, { message: "代付日期格式不正确" })
  paidAt!: string;

  @IsCanonicalMoneyText({
    typeMessage: "代付金额格式不正确",
    formatMessage: "代付金额必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsRequiredText({
    requiredMessage: "总包单位名称不能为空",
    typeMessage: "总包单位名称必须是文字",
    blankMessage: "总包单位名称不能为空白"
  })
  generalContractorName!: string;

  @IsRequiredText({
    requiredMessage: "代付对象名称不能为空",
    typeMessage: "代付对象名称必须是文字",
    blankMessage: "代付对象名称不能为空白"
  })
  paidTargetName!: string;

  @IsIn(["material", "equipment", "labor", "professional_subcontract", "other"], {
    message: "代付类型不正确"
  })
  paymentType!: ProjectProxyPaymentType;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "代付说明必须是文字" })
  description?: string;

  @IsRequiredText({
    requiredMessage: "代付凭证不能为空",
    typeMessage: "代付凭证编号必须是文字",
    blankMessage: "代付凭证不能为空白"
  })
  voucherFileId!: string;

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;

  @IsOptionalNonBlankText({
    typeMessage: "关联合同编号必须是文字",
    blankMessage: "关联合同编号不能为空白"
  })
  contractId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "关联结算编号必须是文字",
    blankMessage: "关联结算编号不能为空白"
  })
  settlementId?: string;
}
