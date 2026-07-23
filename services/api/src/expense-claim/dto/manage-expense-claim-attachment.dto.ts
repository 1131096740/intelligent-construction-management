import { IsIn, IsString, ValidateIf } from "class-validator";
import { IsMaxUnicodeTextLength, IsOptionalNonBlankText, IsRequiredText } from "../../validation/static-field-validation";

export const EXPENSE_CLAIM_ATTACHMENT_CATEGORIES = [
  "invoice",
  "receipt_or_other",
  "other"
] as const;

export class AttachExpenseClaimAttachmentDto {
  @IsRequiredText({
    requiredMessage: "请选择费用附件",
    typeMessage: "费用附件编号必须是文字",
    blankMessage: "请选择费用附件"
  })
  fileId!: string;

  @IsIn(EXPENSE_CLAIM_ATTACHMENT_CATEGORIES, { message: "费用附件类别不正确" })
  category!: (typeof EXPENSE_CLAIM_ATTACHMENT_CATEGORIES)[number];

  @IsOptionalNonBlankText({
    typeMessage: "关联费用类别必须是文字",
    blankMessage: "关联费用类别不能为空白"
  })
  expenseCategory?: string;
}

export class RemoveExpenseClaimAttachmentDto {
  @IsString({ message: "移除原因必须是文字" })
  @ValidateIf((_object, value) => value !== undefined)
  @IsMaxUnicodeTextLength({ max: 200, message: "移除原因不能超过 200 个字符" })
  reason?: string;
}
