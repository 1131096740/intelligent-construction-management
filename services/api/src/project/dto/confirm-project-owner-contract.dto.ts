import { IsNotEmpty, IsString, Matches } from "class-validator";

export class ConfirmProjectOwnerContractDto {
  @IsString({ message: "当前登录密码必须是文字" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  @Matches(/\S/u, { message: "请输入当前登录密码" })
  confirmationPassword!: string;
}
