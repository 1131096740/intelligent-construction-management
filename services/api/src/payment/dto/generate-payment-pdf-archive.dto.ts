import { IsOptional, IsString } from "class-validator";

export class GeneratePaymentPdfArchiveDto {
  @IsOptional()
  @IsString({ message: "模板标识必须是文字" })
  templateKey?: string;

  @IsOptional()
  @IsString({ message: "部门范围必须是文字" })
  departmentScope?: string;
}
