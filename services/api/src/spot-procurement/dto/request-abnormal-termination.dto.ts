import { IsRequiredText } from "../../validation/static-field-validation";

export class RequestAbnormalTerminationDto {
  @IsRequiredText({
    requiredMessage: "请填写异常终止原因",
    typeMessage: "异常终止原因必须是文字",
    blankMessage: "异常终止原因不能为空白"
  })
  reason!: string;
}
