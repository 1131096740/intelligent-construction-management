import { IsDateString } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class DeactivateProjectParticipatingCompanyDto {
  @IsDateString({ strict: true }, { message: "停止新增业务日期格式不正确" })
  endedOn!: string;

  @IsRequiredText({
    requiredMessage: "请填写停止新增业务原因",
    typeMessage: "停止新增业务原因必须是文字",
    blankMessage: "请填写停止新增业务原因"
  })
  changeReason!: string;
}
