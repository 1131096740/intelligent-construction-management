import { IsBoolean, IsIn, ValidateIf } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText
} from "../../validation/static-field-validation";

export const INVOICE_CONFIRMATION_REVIEW_OPERATIONS = [
  "confirm",
  "return",
  "reverse"
] as const;

export type InvoiceConfirmationReviewOperation =
  (typeof INVOICE_CONFIRMATION_REVIEW_OPERATIONS)[number];

export class ReviewNoInvoiceConfirmationDto {
  @IsIn(INVOICE_CONFIRMATION_REVIEW_OPERATIONS, {
    message: "无票确认复核操作不正确"
  })
  operation!: InvoiceConfirmationReviewOperation;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({
    typeMessage: "无票确认复核意见必须是文字",
    blankMessage: "无票确认复核意见不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "无票确认复核意见不能超过 500 个字符"
  })
  comment?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "无票确认冲销确认值必须是布尔值" })
  confirmReversal?: boolean;
}
