import { IsBoolean, IsInt, Min } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText,
  IsRequiredText
} from "../../validation/static-field-validation";

export class ResolveInvoiceEvidenceRepairDto {
  @IsRequiredText({ requiredMessage: "请选择替代发票", typeMessage: "替代发票编号必须是文字", blankMessage: "请选择替代发票" })
  @IsMaxUnicodeTextLength({ max: 128, message: "替代发票编号不能超过 128 个字符" })
  replacementInvoiceRecordId!: string;

  @IsRequiredText({ requiredMessage: "请选择替代发票证据", typeMessage: "替代发票文件编号必须是文字", blankMessage: "请选择替代发票证据" })
  @IsMaxUnicodeTextLength({ max: 128, message: "替代发票文件编号不能超过 128 个字符" })
  replacementFileId!: string;

  @IsRequiredText({ requiredMessage: "请填写证据修复原因", typeMessage: "证据修复原因必须是文字", blankMessage: "请填写证据修复原因" })
  @IsMaxUnicodeTextLength({ max: 100, message: "证据修复原因不能超过 100 个字符" })
  reasonCode!: string;

  @IsRequiredText({ requiredMessage: "请填写幂等键", typeMessage: "幂等键必须是文字", blankMessage: "请填写幂等键" })
  @IsMaxUnicodeTextLength({ max: 128, message: "幂等键不能超过 128 个字符" })
  idempotencyKey!: string;

  @IsInt({ message: "预期版本必须是整数" })
  @Min(0, { message: "预期版本不能小于 0" })
  expectedRevision!: number;

  @IsOptionalNonBlankText({ typeMessage: "委托人编号必须是文字", blankMessage: "委托人编号不能为空白" })
  @IsMaxUnicodeTextLength({ max: 128, message: "委托人编号不能超过 128 个字符" })
  delegatorUserId?: string;

  @IsBoolean({ message: "请明确确认证据修复" })
  confirmRepair!: boolean;
}
