import { IsIn, IsInt, IsOptional, IsString, IsUUID, ValidateIf, MaxLength, Min } from "class-validator";

export class OperatingCostAttributionRequestDto {
  @IsString({ message: "请选择成本承担公司" })
  @MaxLength(100)
  companyEntityId!: string;

  @IsString({ message: "请填写归属确认原因" })
  @MaxLength(500)
  reason!: string;

  @IsString({ message: "缺少幂等键" })
  @MaxLength(100)
  idempotencyKey!: string;

  @ValidateIf((_input, value) => value !== undefined)
  @IsUUID("4", { message: "请选择有效的原费用现金分摊" })
  expenseCashCostLinkId?: string;
}

export class OperatingCostAttributionReviewDto {
  @IsIn(["confirm", "return"], { message: "请选择确认或退回" })
  decision!: "confirm" | "return";

  @IsInt({ message: "成本归属确认版本不正确" })
  @Min(1, { message: "成本归属确认版本不正确" })
  revision!: number;

  @IsOptional()
  @IsString({ message: "请填写原因" })
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString({ message: "本人自审须确认密码" })
  @MaxLength(200)
  password?: string;
}
