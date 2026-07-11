import { IsString, ValidateIf } from "class-validator";
import { IsRequiredText } from "../../validation/static-field-validation";

export class RecordPaymentPdfArchiveDto {
  @IsRequiredText({
    requiredMessage: "PDF 文件不能为空",
    typeMessage: "PDF 文件编号必须是文字",
    blankMessage: "PDF 文件不能为空白"
  })
  fileId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "模板标识必须是文字" })
  templateKey?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "部门范围必须是文字" })
  departmentScope?: string;
}
