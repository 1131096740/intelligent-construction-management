import { IsDateString } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class AssignProjectConstructionEnterpriseDto {
  @IsRequiredText({
    requiredMessage: "施工企业版本不能为空",
    typeMessage: "施工企业版本编号必须是文字",
    blankMessage: "施工企业版本不能为空白"
  })
  businessPartyVersionId!: string;

  @IsDateString({ strict: true }, { message: "施工企业生效时间格式不正确" })
  effectiveFrom!: string;

  @IsRequiredText({
    requiredMessage: "施工企业配置或变更原因不能为空",
    typeMessage: "施工企业配置或变更原因必须是文字",
    blankMessage: "施工企业配置或变更原因不能为空白"
  })
  changeReason!: string;
}
