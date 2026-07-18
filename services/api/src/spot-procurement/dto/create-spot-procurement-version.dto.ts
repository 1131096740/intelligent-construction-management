import { IsRequiredText } from "../../validation/static-field-validation";
import { SpotProcurementDraftDto } from "./create-spot-procurement.dto";

export class CreateSpotProcurementVersionDto extends SpotProcurementDraftDto {
  @IsRequiredText({
    requiredMessage: "请填写采购版本变更原因",
    typeMessage: "采购版本变更原因必须是文字",
    blankMessage: "采购版本变更原因不能为空白"
  })
  changeReason!: string;
}
