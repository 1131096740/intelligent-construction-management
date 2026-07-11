import { IsNotEmpty, IsString, Matches } from "class-validator";

export class AssignPaymentApprovalDto {
  @IsString({ message: "接收人编号必须是文字" })
  @IsNotEmpty({ message: "请选择接收人" })
  @Matches(/\S/u, { message: "请选择接收人" })
  toUserId!: string;
}
