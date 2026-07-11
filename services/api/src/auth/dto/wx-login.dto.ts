import { IsNotEmpty, IsString } from "class-validator";

export class WxLoginDto {
  @IsString({ message: "微信登录凭证必须是字符串" })
  @IsNotEmpty({ message: "微信登录凭证不能为空" })
  code!: string;
}
