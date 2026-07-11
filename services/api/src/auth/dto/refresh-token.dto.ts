import { IsNotEmpty, IsString } from "class-validator";

export class RefreshTokenDto {
  @IsString({ message: "登录凭证必须是字符串" })
  @IsNotEmpty({ message: "登录凭证不能为空，请重新登录" })
  refreshToken!: string;
}
