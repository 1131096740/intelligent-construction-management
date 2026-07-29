import { IsIn } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class ReviewContractTakeoverCorrectionDto {
  @IsIn(["apply", "reject"], {
    message: "历史更正复核结论不正确"
  })
  decision!: "apply" | "reject";

  @IsRequiredText({
    requiredMessage: "请填写历史更正复核意见",
    typeMessage: "历史更正复核意见必须是文字",
    blankMessage: "请填写历史更正复核意见"
  })
  reviewComment!: string;

  @IsRequiredText({
    requiredMessage: "请填写当前登录密码后再复核历史更正",
    typeMessage: "当前登录密码必须是文字",
    blankMessage: "请填写当前登录密码后再复核历史更正"
  })
  currentPassword!: string;
}
