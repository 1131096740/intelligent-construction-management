import { IsIn, IsNotEmpty, IsString, Matches } from "class-validator";

export class CreateContractChangeDraftDto {
  @IsIn(["change", "supplement"])
  changeType!: "change" | "supplement";

  @IsString()
  @IsNotEmpty()
  changeReason!: string;

  @IsIn(["increase", "decrease", "unchanged"])
  changeDirection!: "increase" | "decrease" | "unchanged";

  @IsString()
  @Matches(/^\d+$/)
  changeAmountCents!: string;
}
