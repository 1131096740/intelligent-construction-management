import { IsIn, IsNotEmpty, IsString, Matches } from "class-validator";

export class CreateContractChangeDraftDto {
  @IsIn(["change"], { message: "新建流程仅支持合同变更" })
  changeType!: "change";

  @IsString()
  @IsNotEmpty()
  changeReason!: string;

  @IsIn(["increase", "decrease", "unchanged"])
  changeDirection!: "increase" | "decrease" | "unchanged";

  @IsString()
  @Matches(/^\d+$/)
  changeAmountCents!: string;
}
