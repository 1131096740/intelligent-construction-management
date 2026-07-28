import { IsIn, IsString, ValidateIf } from "class-validator";
import {
  IsMaxUnicodeTextLength,
  IsRequiredText
} from "../../validation/static-field-validation";

export class ReviewProjectFinancingQuotaDto {
  @IsIn(["approve", "reject"], { message: "审批决定不正确" })
  decision!: "approve" | "reject";

  @IsRequiredText({
    requiredMessage: "请输入当前登录密码",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请输入当前登录密码"
  })
  confirmationPassword!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "审批意见必须是文字" })
  comment?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "自审原因必须是文字" })
  @IsMaxUnicodeTextLength({ max: 500, message: "自审原因不能超过 500 个字符" })
  selfReviewReason?: string;
}
