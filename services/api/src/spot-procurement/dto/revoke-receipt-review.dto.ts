import { Equals, IsBoolean } from "class-validator";
import {
  IsRequiredText
} from "../../validation/static-field-validation";

export class RevokeReceiptReviewDto {
  @IsRequiredText({
    requiredMessage: "请选择需要撤销的收货复核",
    typeMessage: "收货复核编号必须是文字",
    blankMessage: "请选择需要撤销的收货复核"
  })
  targetReviewId!: string;

  @IsRequiredText({
    requiredMessage: "撤销收货复核必须填写原因",
    typeMessage: "撤销收货复核原因必须是文字",
    blankMessage: "撤销收货复核必须填写原因"
  })
  reason!: string;

  @IsBoolean({
    message: "撤销收货复核确认值必须是布尔值"
  })
  @Equals(true, {
    message: "请明确确认撤销本次收货复核"
  })
  confirmReviewRevocation!: boolean;
}
