import { IsNotEmpty, IsString } from "class-validator";

export class VoidProjectExpenseRequestDto {
  @IsString({ message: "作废原因必须是文字" })
  @IsNotEmpty({ message: "请填写作废原因" })
  reason!: string;
}
