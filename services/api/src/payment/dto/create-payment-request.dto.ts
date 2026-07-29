import { IsIn, ValidateIf } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class CreatePaymentRequestDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["settlement", "contract_advance", "contract_due"], {
    message: "付款来源类型不正确"
  })
  sourceType?: "settlement" | "contract_advance" | "contract_due";

  @IsOptionalNonBlankText({
    typeMessage: "结算单编号必须是文字",
    blankMessage: "结算单编号不能为空白"
  })
  settlementId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "合同版本编号必须是文字",
    blankMessage: "合同版本编号不能为空白"
  })
  contractVersionId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "付款条款版本编号必须是文字",
    blankMessage: "付款条款版本编号不能为空白"
  })
  paymentTermsVersionId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "付款阶段编号必须是文字",
    blankMessage: "付款阶段编号不能为空"
  })
  paymentTermsStageId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "本次付款事项必须是文字",
    blankMessage: "本次付款事项不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "本次付款事项不能超过 500 个字"
  })
  paymentMatter?: string;

  @IsOptionalNonBlankText({
    typeMessage: "金额计算说明必须是文字",
    blankMessage: "金额计算说明不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 2000,
    message: "金额计算说明不能超过 2000 个字"
  })
  amountCalculationExplanation?: string;

  @IsRequiredText({
    requiredMessage: "付款单号不能为空",
    typeMessage: "付款单号必须是文字",
    blankMessage: "付款单号不能为空白"
  })
  code!: string;

  @IsCanonicalMoneyText({
    typeMessage: "付款申请金额格式不正确",
    formatMessage: "付款申请金额必须按分填写为 0 或更大的整数"
  })
  requestedAmountCents!: string;
}
