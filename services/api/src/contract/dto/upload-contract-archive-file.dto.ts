import { IsRequiredText } from "../../validation/static-field-validation";

export class UploadContractArchiveFileDto {
  @IsRequiredText({
    requiredMessage: "合同归档文件不能为空",
    typeMessage: "合同归档文件编号必须是文字",
    blankMessage: "合同归档文件不能为空白"
  })
  fileId!: string;
}
