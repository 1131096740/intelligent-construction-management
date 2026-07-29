import {
  IsBoolean,
  IsDateString,
  IsString,
  ValidateIf
} from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class RecordProjectUpstreamSettlementDto {
  @IsDateString({ strict: true }, { message: "对上结算日期格式不正确" })
  settledAt!: string;

  @IsCanonicalMoneyText({
    typeMessage: "报送金额格式不正确",
    formatMessage: "报送金额必须按分填写为 0 或更大的整数"
  })
  reportedAmountCents!: string;

  @IsCanonicalMoneyText({
    typeMessage: "审定金额格式不正确",
    formatMessage: "审定金额必须按分填写为 0 或更大的整数"
  })
  approvedAmountCents!: string;

  @IsRequiredText({
    requiredMessage: "审定方名称不能为空",
    typeMessage: "审定方名称必须是文字",
    blankMessage: "审定方名称不能为空白"
  })
  approvingPartyName!: string;

  @IsRequiredText({
    requiredMessage: "结算期间不能为空",
    typeMessage: "结算期间必须是文字",
    blankMessage: "结算期间不能为空白"
  })
  periodLabel!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "最终结算标记必须是布尔值" })
  isFinal?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "对上结算说明必须是文字" })
  description?: string;

  @IsRequiredText({
    requiredMessage: "对上结算凭证不能为空",
    typeMessage: "对上结算凭证编号必须是文字",
    blankMessage: "对上结算凭证不能为空白"
  })
  voucherFileId!: string;
}
