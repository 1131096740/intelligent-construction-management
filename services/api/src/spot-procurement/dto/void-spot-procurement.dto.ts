import { IsRequiredText } from "../../validation/static-field-validation";

export class VoidSpotProcurementDto {
  @IsRequiredText({
    requiredMessage: "请填写采购撤销原因",
    typeMessage: "采购撤销原因必须是文字",
    blankMessage: "采购撤销原因不能为空白"
  })
  reason!: string;
}
