import { IsIn, IsOptional, IsString } from "class-validator";
import { IsCanonicalMoneyText, IsRequiredText } from "../../validation/static-field-validation";

export class RecordSettlementRecoveryDto {
  @IsIn(["refund", "offset"], { message: "回收登记类型不正确" })
  entryType!: "refund" | "offset";

  @IsCanonicalMoneyText({
    typeMessage: "回收金额格式不正确",
    formatMessage: "回收金额必须按分填写为大于 0 的整数",
    rangeMessage: "回收金额超出系统可保存范围"
  })
  amountCents!: string;

  @IsRequiredText({ requiredMessage: "请填写发生日期", typeMessage: "发生日期必须是文字", blankMessage: "请填写发生日期" })
  occurredOn!: string;

  @IsOptional()
  @IsString({ message: "关联付款申请必须是文字" })
  relatedPaymentId?: string;

  @IsRequiredText({ requiredMessage: "请上传回收凭证", typeMessage: "回收凭证必须是文字", blankMessage: "请上传回收凭证" })
  evidenceFileId!: string;

  @IsRequiredText({ requiredMessage: "请填写回收原因", typeMessage: "回收原因必须是文字", blankMessage: "请填写回收原因" })
  reason!: string;

  @IsRequiredText({ requiredMessage: "幂等键不能为空", typeMessage: "幂等键必须是文字", blankMessage: "幂等键不能为空" })
  idempotencyKey!: string;

  @IsRequiredText({ requiredMessage: "登记回收需要当前登录密码", typeMessage: "当前登录密码必须是文字", blankMessage: "登记回收需要当前登录密码" })
  confirmationPassword!: string;
}

export class ReverseSettlementRecoveryDto {
  @IsRequiredText({ requiredMessage: "请填写反向更正原因", typeMessage: "反向更正原因必须是文字", blankMessage: "请填写反向更正原因" })
  reason!: string;

  @IsRequiredText({ requiredMessage: "请上传反向更正凭证", typeMessage: "反向更正凭证必须是文字", blankMessage: "请上传反向更正凭证" })
  evidenceFileId!: string;

  @IsRequiredText({ requiredMessage: "幂等键不能为空", typeMessage: "幂等键必须是文字", blankMessage: "幂等键不能为空" })
  idempotencyKey!: string;

  @IsRequiredText({ requiredMessage: "登记反向更正需要当前登录密码", typeMessage: "当前登录密码必须是文字", blankMessage: "登记反向更正需要当前登录密码" })
  confirmationPassword!: string;
}
