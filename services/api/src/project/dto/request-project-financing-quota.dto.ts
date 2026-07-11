import { IsDateString } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class RequestProjectFinancingQuotaDto {
  @IsCanonicalMoneyText({
    typeMessage: "融资额度格式不正确",
    formatMessage: "融资额度必须按分填写为 0 或更大的整数"
  })
  amountCents!: string;

  @IsRequiredText({
    requiredMessage: "请填写融资额度申请原因",
    typeMessage: "融资额度申请原因必须是文字",
    blankMessage: "请填写融资额度申请原因"
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
