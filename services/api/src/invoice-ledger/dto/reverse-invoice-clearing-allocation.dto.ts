import { IsBoolean, IsInt, Min } from "class-validator";
import {
  IsCanonicalMoneyText,
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class ReverseInvoiceClearingAllocationDto {
  @IsCanonicalMoneyText({ typeMessage: "反向分配金额格式不正确", formatMessage: "反向分配金额必须按分填写为 0 或更大的整数", rangeMessage: "反向分配金额超出系统可保存范围" })
  amountCents!: string;

  @IsRequiredText({ requiredMessage: "请填写结构化更正原因", typeMessage: "结构化更正原因必须是文字", blankMessage: "请填写结构化更正原因" })
  @IsMaxUnicodeTextLength({ max: 100, message: "结构化更正原因不能超过 100 个字符" })
  structuredReasonCode!: string;

  @IsRequiredText({ requiredMessage: "请填写幂等键", typeMessage: "幂等键必须是文字", blankMessage: "请填写幂等键" })
  @IsMaxUnicodeTextLength({ max: 128, message: "幂等键不能超过 128 个字符" })
  idempotencyKey!: string;

  @IsInt({ message: "预期版本必须是整数" })
  @Min(0, { message: "预期版本不能小于 0" })
  expectedRevision!: number;

  @IsOptionalNonBlankText({ typeMessage: "委托人编号必须是文字", blankMessage: "委托人编号不能为空白" })
  @IsMaxUnicodeTextLength({ max: 128, message: "委托人编号不能超过 128 个字符" })
  delegatorUserId?: string;

  @IsBoolean({ message: "请明确确认反向清算发票分配" })
  confirmReversal!: boolean;
}
