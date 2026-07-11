import { IsRequiredText } from "../../validation/static-field-validation";

export class UploadSettlementArchiveFileDto {
  @IsRequiredText({
    requiredMessage: "请选择结算归档文件",
    typeMessage: "结算归档文件编号必须是文字",
    blankMessage: "请选择结算归档文件"
  })
  fileId!: string;
}
