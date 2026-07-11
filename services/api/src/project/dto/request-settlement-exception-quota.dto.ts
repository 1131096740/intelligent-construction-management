import { IsDateString } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class RequestSettlementExceptionQuotaDto {
  @IsRequiredText({
    requiredMessage: "合同编号不能为空",
    typeMessage: "合同编号必须是文字",
    blankMessage: "合同编号不能为空白"
  })
  contractId!: string;

  @IsCanonicalMoneyText({
    typeMessage: "结算例外额度格式不正确",
    formatMessage: "结算例外额度必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsRequiredText({
    requiredMessage: "请填写额度申请原因",
    typeMessage: "额度申请原因必须是文字",
    blankMessage: "请填写额度申请原因"
  })
  reason!: string;

  @IsDateString({ strict: true }, { message: "额度有效期格式不正确" })
  validUntil!: string;

  @IsRequiredText({
    requiredMessage: "额度附件不能为空",
    typeMessage: "额度附件编号必须是文字",
    blankMessage: "额度附件不能为空白"
  })
  attachmentFileId!: string;
}
