import { IsString } from "class-validator";
import { IsMaxUnicodeTextLength } from "../../validation/static-field-validation";

export class AdjustExpenseClaimPaymentSubjectDto {
  @IsString({ message: "实际付款主体不能为空" })
  @IsMaxUnicodeTextLength({ max: 100, message: "实际付款主体格式不正确" })
  companyEntityId!: string;

  @IsString({ message: "调整原因必须是文字" })
  @IsMaxUnicodeTextLength({ max: 500, message: "调整原因不能超过 500 个字符" })
  reason!: string;
}
