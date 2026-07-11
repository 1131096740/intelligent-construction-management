import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";

export class ReviewSettlementExceptionQuotaDto {
  @IsIn(["approve", "reject"], { message: "审批决定不正确" })
  decision!: "approve" | "reject";

  @IsString({ message: "当前登录密码必须是文字" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  confirmationPassword!: string;

  @IsOptional()
  @IsString({ message: "审批意见必须是文字" })
  comment?: string;
}
