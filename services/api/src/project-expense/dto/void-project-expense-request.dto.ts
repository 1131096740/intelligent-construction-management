import { IsNotEmpty, IsString, Matches } from "class-validator";

export class VoidProjectExpenseRequestDto {
  @IsString({ message: "作废原因必须是文字" })
  @IsNotEmpty({ message: "请填写作废原因" })
  @Matches(/\S/u, { message: "请填写作废原因" })
  reason!: string;
}
