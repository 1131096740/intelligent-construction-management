import { IsDateString, IsOptional, IsUUID, Matches } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class RequestProjectFinancingQuotaDto {
  @IsUUID("4", { message: "项目垫资申请幂等键必须是 UUID" })
  idempotencyKey!: string;

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
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "融资额度申请原因不能超过 500 个字符"
  })
  reason!: string;

  @IsOptional()
  @Matches(
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/u,
    { message: "额度有效期格式不正确" }
  )
  @IsDateString({ strict: true }, { message: "额度有效期格式不正确" })
  validUntil?: string;

  @IsRequiredText({
    requiredMessage: "额度附件不能为空",
    typeMessage: "额度附件编号必须是文字",
    blankMessage: "额度附件不能为空白"
  })
  attachmentFileId!: string;
}
