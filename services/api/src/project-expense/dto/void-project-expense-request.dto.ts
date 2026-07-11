import { IsRequiredText } from "../../validation/static-field-validation";

export class VoidProjectExpenseRequestDto {
  @IsRequiredText({
    requiredMessage: "请填写作废原因",
    typeMessage: "作废原因必须是文字",
    blankMessage: "请填写作废原因"
  })
  reason!: string;
}
