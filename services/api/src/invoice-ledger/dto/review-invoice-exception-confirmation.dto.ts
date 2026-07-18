import { IsBoolean, IsIn, ValidateIf } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsOptionalNonBlankText
} from "../../validation/static-field-validation";
import {
  INVOICE_CONFIRMATION_REVIEW_OPERATIONS,
  type InvoiceConfirmationReviewOperation
} from "./review-no-invoice-confirmation.dto";

export class ReviewInvoiceExceptionConfirmationDto {
  @IsIn(INVOICE_CONFIRMATION_REVIEW_OPERATIONS, {
    message: "票据异常复核操作不正确"
  })
  operation!: InvoiceConfirmationReviewOperation;

  @ValidateIf((_object, value) => value !== undefined)
  @IsOptionalNonBlankText({
    typeMessage: "票据异常复核意见必须是文字",
    blankMessage: "票据异常复核意见不能为空白"
  })
  @IsMaxUnicodeTextLength({
    max: 500,
    message: "票据异常复核意见不能超过 500 个字符"
  })
  comment?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean({ message: "票据异常冲销确认值必须是布尔值" })
  confirmReversal?: boolean;
}
