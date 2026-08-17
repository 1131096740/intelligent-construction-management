import { IsDateString } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class AddProjectParticipatingCompanyDto {
  @IsRequiredText({
    requiredMessage: "请选择我方参与公司",
    typeMessage: "我方参与公司编号必须是文字",
    blankMessage: "请选择我方参与公司"
  })
  companyEntityId!: string;

  @IsDateString({ strict: true }, { message: "参与公司生效日格式不正确" })
  effectiveFrom!: string;

  @IsRequiredText({
    requiredMessage: "请填写参与公司加入原因",
    typeMessage: "参与公司加入原因必须是文字",
    blankMessage: "请填写参与公司加入原因"
  })
  changeReason!: string;
}
