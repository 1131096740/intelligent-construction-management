import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class ContractEndedRetentionHoldDto {
  @IsString({ message: "结束申请保留原因必须是文本" })
  @IsNotEmpty({ message: "结束申请保留操作必须填写原因" })
  @MaxLength(500, { message: "结束申请保留原因不能超过 500 个字符" })
  reason!: string;
}
