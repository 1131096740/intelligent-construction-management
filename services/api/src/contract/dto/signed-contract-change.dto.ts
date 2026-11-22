import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class SubmitSignedContractChangeDto {
  @IsRequiredText({
    requiredMessage: "请上传双方已签署的补充协议",
    typeMessage: "补充协议文件编号必须是文字",
    blankMessage: "补充协议文件编号不能为空白"
  })
  fileId!: string;

  @IsString({ message: "变更说明必须是文字" })
  @Length(1, 1000, { message: "变更说明须为 1 至 1000 个字符" })
  summary!: string;

  @IsString({ message: "变更金额必须以文字提交" })
  @Matches(/^-?(?:0|[1-9]\d{0,19})(?:\.\d{1,4})?$/u, { message: "请输入变更金额，最多保留四位小数" })
  amountDeltaYuan!: string;

  @IsOptional()
  @IsString({ message: "付款约定必须是文字" })
  @Length(1, 5000, { message: "付款约定须为 1 至 5000 个字符" })
  paymentAgreementText?: string;
}

export class ReviewSignedContractChangeDto {
  @IsIn(["approve", "reject"], { message: "请选择通过或驳回" })
  decision!: "approve" | "reject";

  @IsOptional()
  @IsString({ message: "复核意见必须是文字" })
  @Length(1, 1000, { message: "复核意见须为 1 至 1000 个字符" })
  reason?: string;

  @IsOptional()
  @IsString({ message: "自审原因必须是文字" })
  @Length(1, 1000, { message: "自审原因须为 1 至 1000 个字符" })
  selfReviewReason?: string;

  @IsOptional()
  @IsString({ message: "确认密码必须是文字" })
  confirmationPassword?: string;
}

export class SubmitContractTaxRevisionDto {
  @IsOptional()
  @IsIn(["vat_general", "vat_special"], { message: "请选择发票类型" })
  invoiceType?: "vat_general" | "vat_special";

  @IsOptional()
  @Matches(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?$/u, { message: "请输入有效税率，最多保留六位小数" })
  taxRate?: string;

  @IsRequiredText({
    requiredMessage: "请填写税务资料依据",
    typeMessage: "税务资料依据必须是文字",
    blankMessage: "税务资料依据不能为空白"
  })
  @Length(1, 1000, { message: "税务资料依据须为 1 至 1000 个字符" })
  explanation!: string;
}
