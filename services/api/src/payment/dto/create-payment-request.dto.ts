import { IsIn, Matches, ValidateIf } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class CreatePaymentRequestDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["settlement", "signed_settlement", "contract_advance", "contract_due"], {
    message: "付款来源类型不正确"
  })
  sourceType?: "settlement" | "signed_settlement" | "contract_advance" | "contract_due";

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(["our_company", "affiliate"], { message: "付款主体类型不正确" })
  paymentSubjectType?: "our_company" | "affiliate";

  @IsOptionalNonBlankText({
    typeMessage: "结算单编号必须是文字",
    blankMessage: "结算单编号不能为空白"
  })
  settlementId?: string;

  @IsOptionalNonBlankText({
    typeMessage: "已签结算编号必须是文字",
    blankMessage: "已签结算编号不能为空白"
  })
  signedSettlementId?: string;

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

  @ValidateIf((_object, value) => value !== undefined)
  @Matches(/^[a-f0-9]{64}$/u, { message: "付款约定核对凭据不正确，请重新读取合同" })
  expectedAgreementFingerprint?: string;

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
