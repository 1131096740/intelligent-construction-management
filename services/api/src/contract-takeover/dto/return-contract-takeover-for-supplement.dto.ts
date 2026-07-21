import { MaxLength } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class ReturnContractTakeoverForSupplementDto {
  @IsRequiredText({
    requiredMessage: "请填写退回补充原因",
    typeMessage: "退回补充原因必须是文字",
    blankMessage: "请填写退回补充原因"
  })
  @MaxLength(500, { message: "退回补充原因不能超过 500 个字" })
  reason!: string;
}
