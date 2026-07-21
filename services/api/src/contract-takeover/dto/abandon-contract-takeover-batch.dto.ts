import { IsString, Length, MaxLength, MinLength } from "class-validator";

export class AbandonContractTakeoverBatchDto {
  @IsString({ message: "批次预览校验值必须是文字" })
  @Length(64, 64, { message: "批次预览已失效，请重新预览" })
  previewHash!: string;

  @IsString({ message: "批量放弃原因必须是文字" })
  @MinLength(1, { message: "请填写批量放弃原因" })
  @MaxLength(200, { message: "批量放弃原因不能超过 200 个字" })
  reason!: string;
}
