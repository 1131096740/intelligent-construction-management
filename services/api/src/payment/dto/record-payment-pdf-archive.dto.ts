import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class RecordPaymentPdfArchiveDto {
  @IsString({ message: "PDF 文件编号必须是文字" })
  @IsNotEmpty({ message: "PDF 文件不能为空" })
  fileId!: string;

  @IsOptional()
  @IsString({ message: "模板标识必须是文字" })
  templateKey?: string;

  @IsOptional()
  @IsString({ message: "部门范围必须是文字" })
  departmentScope?: string;
}
