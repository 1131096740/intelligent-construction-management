import { IsNotEmpty, IsString, Matches, ValidateIf } from "class-validator";

export class RecordPaymentPdfArchiveDto {
  @IsString({ message: "PDF 文件编号必须是文字" })
  @IsNotEmpty({ message: "PDF 文件不能为空" })
  @Matches(/\S/u, { message: "PDF 文件不能为空白" })
  fileId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "模板标识必须是文字" })
  templateKey?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString({ message: "部门范围必须是文字" })
  departmentScope?: string;
}
